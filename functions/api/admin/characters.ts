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

import {
  HttpError,
  getCredentialErrorMessage,
  isCharacterDM,
  requireAuthenticatedUser,
} from "../../../api/_lib/firebase-admin.js";
import { executeD1QueryInternal } from "../../../api/_lib/d1-internal.js";

export const onRequest = async (context: any): Promise<Response> => {
  const { request } = context;
  if (request.method !== "GET") {
    return Response.json(
      { error: `Method ${request.method} not allowed.` },
      { status: 405 },
    );
  }

  try {
    const authHeader = request.headers.get("authorization") ?? undefined;
    const { role } = await requireAuthenticatedUser(authHeader);
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

    return Response.json({ characters: rows });
  } catch (error: any) {
    const credentialMessage = getCredentialErrorMessage(error);
    if (credentialMessage) {
      return Response.json({ error: credentialMessage }, { status: 503 });
    }
    if (error instanceof HttpError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error("/api/admin/characters failed:", error);
    return Response.json(
      { error: message || "Failed to load characters." },
      { status: 500 },
    );
  }
};
