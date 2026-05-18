// Pages Functions ↔ Vercel handler adapter.
//
// Every shim under `functions/api/**` calls into one of the existing
// `api/*.ts` handlers via this wrapper. The handlers were originally
// written for Vercel's `(req, res) => void` signature, and rewriting
// each one to native Fetch API is a bigger refactor than this migration
// wants to take on. Instead, this adapter translates the Pages
// `EventContext` into a minimal fake `(req, res)` pair, captures what
// the handler writes, and returns a real `Response`.
//
// Requires `compatibility_flags = ["nodejs_compat"]` in wrangler.toml —
// the existing handlers use `Buffer`, `process.env`, and a few other
// Node globals that only exist under the compat shim.
//
// Limitations (deliberately accepted):
//   - The fake `req` is NOT an async iterable. Handlers that bypass the
//     `if (req.body && typeof req.body === "object") return req.body;`
//     fast path and read chunks via `for await (const chunk of req)`
//     will see an immediate end-of-stream and behave as if the body
//     were empty. Audit pass shows every consumer in the repo checks
//     `req.body` first, so this is safe today; revisit if a future
//     handler starts streaming.
//   - Non-JSON request bodies are passed through as the raw text
//     string. JSON bodies are pre-parsed because every consumer that
//     wants JSON does so via the `req.body` short-circuit above.
//   - Streaming responses aren't supported (`res.write` accumulates
//     into a single buffer instead of flushing). No handler in the
//     repo streams today.

type VercelHandler = (req: any, res: any) => Promise<unknown> | unknown;

export async function runVercelHandler(
  request: Request,
  env: Record<string, unknown>,
  handler: VercelHandler,
): Promise<Response> {
  // Project Pages-runtime env onto `process.env`. The existing handlers
  // read every secret via `process.env.<NAME>`; on Pages those live on
  // the binding context. Only string values are copied — D1 / R2 / KV
  // bindings (objects) stay where they are and aren't used by the
  // current handlers (they call out to the existing storage worker
  // over HTTP, not via direct bindings).
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string" && !(process as any).env[key]) {
      (process as any).env[key] = value;
    }
  }

  const url = new URL(request.url);
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  // Pre-parse the body so the handler's `req.body && typeof req.body
  // === "object"` short-circuit fires immediately. JSON is the common
  // case; other content types pass through as text and the handler
  // can decide what to do with it.
  let body: unknown = null;
  if (request.method !== "GET" && request.method !== "HEAD") {
    const contentType = headers["content-type"] ?? "";
    const raw = await request.text();
    if (raw.trim().length === 0) {
      body = null;
    } else if (contentType.includes("application/json")) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
    } else {
      body = raw;
    }
  }

  const req: any = {
    url: url.pathname + url.search,
    method: request.method,
    headers,
    body,
    query: Object.fromEntries(url.searchParams),
  };

  let status = 200;
  const resHeaders = new Headers();
  let responseBody: BodyInit | null = null;

  const res: any = {
    get statusCode() {
      return status;
    },
    set statusCode(value: number) {
      status = value;
    },
    status(code: number) {
      status = code;
      return res;
    },
    setHeader(name: string, value: string | number | string[]) {
      if (Array.isArray(value)) {
        resHeaders.set(name, value.join(", "));
      } else {
        resHeaders.set(name, String(value));
      }
      return res;
    },
    getHeader(name: string) {
      return resHeaders.get(name);
    },
    json(payload: unknown) {
      resHeaders.set("content-type", "application/json");
      responseBody = JSON.stringify(payload);
      return res;
    },
    send(payload?: string | object | Uint8Array | null) {
      // Express-style res.send: string → text body, object → JSON,
      // Uint8Array → bytes. Used by d1-proxy / r2-proxy to pass
      // through upstream worker responses; in those call sites
      // setHeader("Content-Type", …) runs first, so we only default
      // the content-type if it isn't already pinned by the caller.
      if (payload == null) {
        return res;
      }
      if (typeof payload === "string") {
        responseBody = payload;
      } else if (payload instanceof Uint8Array) {
        responseBody = payload as BodyInit;
      } else if (typeof payload === "object") {
        if (!resHeaders.has("content-type")) {
          resHeaders.set("content-type", "application/json");
        }
        responseBody = JSON.stringify(payload);
      } else {
        responseBody = String(payload);
      }
      return res;
    },
    end(payload?: string | Uint8Array) {
      if (payload != null) {
        responseBody = payload as BodyInit;
      }
      return res;
    },
    write(payload: string | Uint8Array) {
      if (typeof payload === "string") {
        responseBody = (responseBody == null ? "" : String(responseBody)) + payload;
      } else {
        responseBody = payload as BodyInit;
      }
      return true;
    },
  };

  try {
    await handler(req, res);
  } catch (err: any) {
    // The existing handlers usually catch their own errors and shape
    // the response themselves. If one escapes the try/catch, render
    // it as JSON 500 (or whatever status the error carries) so the
    // caller doesn't see a Workers stack trace.
    if (responseBody == null) {
      status = typeof err?.status === "number" ? err.status : 500;
      responseBody = JSON.stringify({ error: err?.message ?? "Internal server error" });
      resHeaders.set("content-type", "application/json");
    }
  }

  return new Response(responseBody, {
    status,
    headers: resHeaders,
  });
}
