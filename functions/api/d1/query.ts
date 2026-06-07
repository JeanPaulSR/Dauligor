// /api/d1/query — generic D1 query proxy.
//
// Delegates to the (req, res)-shaped handler in api/_lib/d1-proxy.ts via
// the Pages-to-Vercel adapter. d1-proxy.ts is still Vercel-shaped because
// it's a substantial chunk of code (table-aware gates, body buffering,
// upstream forwarding) and refactoring it to native Fetch API is a
// separate cleanup pass. The adapter pattern here is the smallest
// possible shim — the actual proxy logic doesn't care which runtime
// invoked it.

import { runVercelHandler } from "../../../api/_lib/pages-adapter.js";
import { handleD1Query } from "../../../api/_lib/d1-proxy.js";

// CORS so the Foundry module (a cross-origin browser client) can read the
// player-readable tables it needs (system_pages / system_page_blocks) through
// the generic D1 proxy with a Bearer token. Mirrors the wrapper /api/auth,
// /api/lore, /api/campaigns, and /api/module/* already use; Bearer-token auth,
// no cookies, so `*` is safe and the proxy's existing table/role gates are
// unchanged.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, PUT, DELETE",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const onRequest = async (context: any): Promise<Response> => {
  // Short-circuit the preflight BEFORE the proxy — it requires an auth header
  // and 401s on the OPTIONS request, which would kill the cross-origin preflight.
  if (context.request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  const response = await runVercelHandler(context.request, context.env, handleD1Query);
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
};
