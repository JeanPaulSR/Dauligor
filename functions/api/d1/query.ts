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

export const onRequest = async (context: any): Promise<Response> => {
  return runVercelHandler(context.request, context.env, handleD1Query);
};
