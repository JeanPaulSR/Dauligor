// /api/r2/[action] — single dispatcher for all R2 storage operations.
//
// Pages filesystem routing maps `/api/r2/<action>` to this file with
// `context.params.action` set to the path segment. The seven actions
// (list / delete / rename / move-folder / upload / scan-references /
// rewrite-references) all live as (req, res)-shaped handlers in
// api/_lib/r2-proxy.ts; this dispatcher selects the right one and
// delegates through the Pages-to-Vercel adapter. r2-proxy.ts will be
// rewritten to native Fetch API in a follow-up cleanup pass.
//
// HTTP method enforcement deliberately stays inside each handler so the
// dispatcher doesn't have to know which verbs each action accepts.

import { runVercelHandler } from "../../../api/_lib/pages-adapter.js";
import {
  handleR2Delete,
  handleR2List,
  handleR2MoveFolder,
  handleR2Rename,
  handleR2Upload,
  handleImageReferencesScan,
  handleImageReferencesRewrite,
} from "../../../api/_lib/r2-proxy.js";

type VercelHandler = (req: any, res: any) => Promise<unknown> | unknown;

const HANDLERS: Record<string, VercelHandler> = {
  list: handleR2List,
  delete: handleR2Delete,
  rename: handleR2Rename,
  "move-folder": handleR2MoveFolder,
  upload: handleR2Upload,
  // POST { url } → { references: ImageReference[] }. Replaces the
  // client-side fan-out across SCAN_TARGETS that ran through the
  // generic /api/d1/query proxy. Server-side path uses
  // executeD1QueryInternal so it can read `users` and `characters`
  // (both blocked by PROTECTED_READ_TABLES).
  "scan-references": handleImageReferencesScan,
  // POST { oldUrl, newUrl } → { count }. The (table, column) pair is
  // pinned server-side now instead of passed in from the client.
  "rewrite-references": handleImageReferencesRewrite,
};

export const onRequest = async (context: any): Promise<Response> => {
  const action = String(context.params?.action || "");
  const handler = HANDLERS[action];
  if (!handler) {
    return Response.json(
      { error: `Unknown R2 action: ${action || "(empty)"}` },
      { status: 404 },
    );
  }
  return runVercelHandler(context.request, context.env, handler);
};
