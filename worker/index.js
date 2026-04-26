export default {
  async fetch(request, env) {
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
      const body = await obj.arrayBuffer();
      await env.BUCKET.put(newKey, body, { httpMetadata: obj.httpMetadata });
      await env.BUCKET.delete(oldKey);
      return jsonResponse({ url: `${env.R2_PUBLIC_URL}/${newKey}`, key: newKey });
    }

    return jsonResponse({ error: 'Not found' }, 404);
  },
};

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
