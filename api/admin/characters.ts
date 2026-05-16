// /api/admin/characters — list every character in the database.
//
// Used by CharacterList in "Archive Administration View" mode (DMs see
// all characters; players see only their own via /api/me/characters).
// Restricted to `admin` / `co-dm` (the DM role set) — `lore-writer` is
// deliberately not included.
//
// Returns minimal columns by default so the staff list page doesn't drag
// the JSON blobs (info_json / metadata_json) over the wire just to render
// a name + level row. A full character read still requires
// `/api/characters/[id]`.

import type { IncomingMessage } from "node:http";
import {
  HttpError,
  getCredentialErrorMessage,
  isCharacterDM,
  requireAuthenticatedUser,
} from "../_lib/firebase-admin.js";
import { executeD1QueryInternal } from "../_lib/d1-internal.js";

type NodeLikeRequest = IncomingMessage & {
  headers: Record<string, string | string[] | undefined>;
};

type NodeLikeResponse = {
  status: (code: number) => NodeLikeResponse;
  setHeader?: (name: string, value: string) => void;
  json: (body: unknown) => void;
};

export default async function handler(req: NodeLikeRequest, res: NodeLikeResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: `Method ${req.method} not allowed.` });
  }

  try {
    const { role } = await requireAuthenticatedUser(req.headers.authorization);
    if (!isCharacterDM(role)) {
      throw new HttpError(403, "DM access required.");
    }

    // List view only — name / level / owner / updated_at. The base table
    // has 18 columns including JSON blobs; pulling them all for a list
    // page would balloon the response. Detail still goes through
    // `/api/characters/[id]`.
    const result = await executeD1QueryInternal({
      sql: `SELECT id, user_id, campaign_id, name, level, image_url, race_id, background_id,
                   current_hp, temp_hp, max_hp_override, exhaustion, has_inspiration,
                   updated_at, created_at
            FROM characters
            ORDER BY updated_at DESC`,
    });
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
    console.error("/api/admin/characters failed:", error);
    return res.status(500).json({ error: message || "Failed to load characters." });
  }
}
