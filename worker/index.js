export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (err) {
      return jsonResponse({ error: err?.message ?? 'Internal server error' }, 500);
    }
  },
};

async function handleRequest(request, env) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  const auth = request.headers.get('Authorization');
  if (!env.API_SECRET || auth !== `Bearer ${env.API_SECRET}`) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const url = new URL(request.url);

  if (url.pathname === '/upload' && request.method === 'POST') {
    const form = await request.formData();
    const file = form.get('file');
    const key = form.get('key');
    if (!file || !key) return jsonResponse({ error: 'Missing file or key' }, 400);

    await env.BUCKET.put(String(key), file.stream(), {
      httpMetadata: { contentType: file.type },
    });

    return jsonResponse({ url: `${env.R2_PUBLIC_URL}/${key}`, key });
  }

  if (url.pathname === '/list' && request.method === 'GET') {
    const prefix = url.searchParams.get('prefix') ?? '';
    const delimiter = url.searchParams.get('delimiter') ?? '/';

    const listed = await env.BUCKET.list({ prefix, delimiter });

    return jsonResponse({
      objects: listed.objects.map((obj) => ({
        key: obj.key,
        size: obj.size,
        uploaded: obj.uploaded?.toISOString() ?? null,
        url: `${env.R2_PUBLIC_URL}/${obj.key}`,
      })),
      delimitedPrefixes: listed.delimitedPrefixes,
    });
  }

  if (url.pathname === '/delete' && request.method === 'DELETE') {
    const key = url.searchParams.get('key');
    if (!key) return jsonResponse({ error: 'Missing key' }, 400);
    await env.BUCKET.delete(key);
    return jsonResponse({ success: true });
  }

  if (url.pathname === '/rename' && request.method === 'POST') {
    const { oldKey, newKey } = await request.json();
    if (!oldKey || !newKey) return jsonResponse({ error: 'Missing oldKey or newKey' }, 400);
    const obj = await env.BUCKET.get(oldKey);
    if (!obj) return jsonResponse({ error: 'Object not found' }, 404);
    await env.BUCKET.put(newKey, obj.body, { httpMetadata: obj.httpMetadata });
    await env.BUCKET.delete(oldKey);
    return jsonResponse({ url: `${env.R2_PUBLIC_URL}/${newKey}`, key: newKey });
  }

  // Move a batch of objects under oldPrefix/ to newPrefix/.
  // No cursor — we re-list from scratch each call because deleting objects
  // invalidates R2 cursors. Returns { count, done } where done=true when
  // the listing comes back empty (nothing left to move).
  if (url.pathname === '/move-folder' && request.method === 'POST') {
    const { oldPrefix, newPrefix } = await request.json();
    if (!oldPrefix || !newPrefix) return jsonResponse({ error: 'Missing oldPrefix or newPrefix' }, 400);
    const src = oldPrefix.endsWith('/') ? oldPrefix : `${oldPrefix}/`;
    const dst = newPrefix.endsWith('/') ? newPrefix : `${newPrefix}/`;
    const listed = await env.BUCKET.list({ prefix: src, limit: 20 });
    let count = 0;
    for (const obj of listed.objects) {
      const rel = obj.key.slice(src.length);
      const srcObj = await env.BUCKET.get(obj.key);
      if (srcObj) {
        const body = await srcObj.arrayBuffer();
        await env.BUCKET.put(`${dst}${rel}`, body, { httpMetadata: srcObj.httpMetadata });
        await env.BUCKET.delete(obj.key);
        count++;
      }
    }
    return jsonResponse({ count, done: listed.objects.length === 0 });
  }

  // Raw write — used by module-export bake pipeline. Multipart `/upload`
  // expects FormData with a File; this lets server-side code (Vercel
  // functions) PUT a JSON / text body directly without forging multipart.
  // Pass `?key=<r2-key>`; the request body is stored as-is with the supplied
  // Content-Type. Cache-Control on the request is forwarded to R2 so public
  // reads inherit the caching policy.
  if (url.pathname === '/raw' && request.method === 'PUT') {
    const key = url.searchParams.get('key');
    if (!key) return jsonResponse({ error: 'Missing key' }, 400);

    const contentType = request.headers.get('content-type') ?? 'application/octet-stream';
    const cacheControl = request.headers.get('cache-control') ?? undefined;

    const body = await request.arrayBuffer();
    await env.BUCKET.put(key, body, {
      httpMetadata: {
        contentType,
        ...(cacheControl ? { cacheControl } : {}),
      },
    });

    return jsonResponse({ url: `${env.R2_PUBLIC_URL}/${key}`, key });
  }

  if (url.pathname === '/query' && request.method === 'POST') {
    const body = await request.json();
    
    if (Array.isArray(body)) {
      // Batch mode
      try {
        const statements = body.map(q => {
          if (!q.sql) throw new Error('Missing sql in batch item');
          return env.DB.prepare(q.sql).bind(...(q.params || []));
        });
        const results = await env.DB.batch(statements);
        // Map to a success format similar to single query
        return jsonResponse({
          results,
          success: true
        });
      } catch (err) {
        return jsonResponse({ error: err.message, success: false }, 500);
      }
    }

    const { sql, params } = body;
    if (!sql) return jsonResponse({ error: 'Missing sql' }, 400);

    try {
      const result = await env.DB.prepare(sql).bind(...(params || [])).all();
      return jsonResponse(result);
    } catch (err) {
      return jsonResponse({ error: err.message }, 500);
    }
  }

  return jsonResponse({ error: 'Not found' }, 404);
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}
