// /api/r2/[action] — single dispatcher for all R2 storage operations.
//
// Consolidates what used to be five separate Vercel serverless functions
// (delete.ts, list.ts, move-folder.ts, rename.ts, upload.ts) into one
// dynamic route. Each old file was a 5-line passthrough to a handler in
// api/_lib/r2-proxy.ts; collapsing them saves four function slots
// against the Hobby plan's 12-function deployment limit so the rest of
// the per-route endpoint migration (characters / me / profiles, plus
// what's still ahead) can deploy.
//
// Vercel filesystem routing maps `/api/r2/<action>` to this file with
// `req.query.action` set to the path segment, so every existing client
// URL (`/api/r2/list`, `/api/r2/delete`, etc.) keeps working unchanged.
// No client edits required — this is pure file reorganization.
//
// HTTP method enforcement deliberately stays inside each handler so the
// dispatcher doesn't have to know which verbs each action accepts. The
// previous per-file Vercel functions also didn't gate on method — they
// just called the handler — so behavior is identical.

import type { IncomingMessage } from "node:http";
import {
  handleR2Delete,
  handleR2List,
  handleR2MoveFolder,
  handleR2Rename,
  handleR2Upload,
} from "../_lib/r2-proxy.js";

type NodeLikeRequest = IncomingMessage & {
  query?: Record<string, unknown>;
  body?: unknown;
};

function getAction(req: NodeLikeRequest): string {
  const raw = req.query?.action;
  if (typeof raw === "string" && raw) return raw;
  if (Array.isArray(raw) && raw[0]) return String(raw[0]);
  // Path-regex fallback in case the runtime ever stops attaching query
  // params for dynamic segments. Same defensive pattern used by the
  // character + profile endpoints.
  const url = req.url || "";
  const match = url.match(/\/api\/r2\/([^\/\?]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : "";
}

export default async function handler(req: NodeLikeRequest, res: any) {
  const action = getAction(req);
  switch (action) {
    case "list":
      return handleR2List(req as any, res);
    case "delete":
      return handleR2Delete(req as any, res);
    case "rename":
      return handleR2Rename(req as any, res);
    case "move-folder":
      return handleR2MoveFolder(req as any, res);
    case "upload":
      return handleR2Upload(req as any, res);
    default:
      return res.status(404).json({ error: `Unknown R2 action: ${action || "(empty)"}` });
  }
}
