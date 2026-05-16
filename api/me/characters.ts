// /api/me/characters — list the calling user's own characters.
//
// Used by Sidebar's recent-characters strip and (for non-staff) by the
// /characters list page. The caller's uid is derived from the verified
// token; we never trust a uid passed in the query string or body.
//
// `?fields=id,name,level` (allow-listed) shapes the response so the
// Sidebar's minimal `SELECT id, name, level` can stay minimal. `?limit=N`
// caps the result for the same reason. Both default to "everything".

import type { IncomingMessage } from "node:http";
import {
  HttpError,
  getCredentialErrorMessage,
  requireAuthenticatedUser,
} from "../_lib/firebase-admin.js";
import { executeD1QueryInternal } from "../_lib/d1-internal.js";

type NodeLikeRequest = IncomingMessage & {
  headers: Record<string, string | string[] | undefined>;
  query?: Record<string, string | string[] | undefined>;
};

type NodeLikeResponse = {
  status: (code: number) => NodeLikeResponse;
  setHeader?: (name: string, value: string) => void;
  json: (body: unknown) => void;
};

// Allow-list of columns the client may request via `?fields=`. The
// sensitive columns on `characters` are the JSON blobs (`info_json` /
// `metadata_json`) — those aren't in the list, so a `?fields=` request
// can never resurrect them. If you add a column, decide whether it
// belongs here.
const ALLOWED_FIELDS = new Set([
  "id",
  "name",
  "level",
  "image_url",
  "campaign_id",
  "race_id",
  "background_id",
  "current_hp",
  "temp_hp",
  "max_hp_override",
  "exhaustion",
  "has_inspiration",
  "updated_at",
  "created_at",
]);

function parseFields(req: NodeLikeRequest): string[] | null {
  const raw = req.query?.fields;
  const str = Array.isArray(raw) ? raw[0] : raw;
  if (!str) return null;
  const requested = str.split(",").map((s) => s.trim()).filter(Boolean);
  const safe = requested.filter((f) => ALLOWED_FIELDS.has(f));
  return safe.length > 0 ? safe : null;
}

function parseLimit(req: NodeLikeRequest): number | null {
  const raw = req.query?.limit;
  const str = Array.isArray(raw) ? raw[0] : raw;
  if (!str) return null;
  const n = Number(str);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(Math.floor(n), 500); // hard cap so a runaway client can't drain the table
}

export default async function handler(req: NodeLikeRequest, res: NodeLikeResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: `Method ${req.method} not allowed.` });
  }

  try {
    const { decoded } = await requireAuthenticatedUser(req.headers.authorization);
    const userId = decoded.uid;
    if (!userId) throw new HttpError(401, "Missing user id in token.");

    const fields = parseFields(req);
    const limit = parseLimit(req);

    const cols = fields ? fields.join(", ") : "*";
    let sql = `SELECT ${cols} FROM characters WHERE user_id = ? ORDER BY updated_at DESC`;
    const params: any[] = [userId];
    if (limit !== null) {
      sql += " LIMIT ?";
      params.push(limit);
    }

    const result = await executeD1QueryInternal({ sql, params });
    const rows = Array.isArray(result?.results) ? result.results : [];

    return res.status(200).json({ characters: rows });
  } catch (error) {
    const credentialMessage = getCredentialErrorMessage(error);
    if (credentialMessage) {
      return res.status(503).json({ error: credentialMessage });
    }
    if (error instanceof HttpError) {
      return res.status(error.status).json({ error: error.message });
    }
    const message = error instanceof Error ? error.message : String(error);
    // eslint-disable-next-line no-console
    console.error("/api/me/characters failed:", error);
    return res.status(500).json({ error: message || "Failed to load characters." });
  }
}
