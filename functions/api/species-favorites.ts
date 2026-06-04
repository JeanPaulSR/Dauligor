// Species favorites endpoint. Mediates between the React client
// (src/lib/speciesBackgroundFavorites.ts) and the `user_species_favorites`
// D1 table. Universal scope only (no per-character variant), mirroring
// functions/api/feat-favorites.ts.
//
// All routes require `requireAuthenticatedUser` (not staff) — any
// signed-in user can read/write their OWN rows only. The user_id is
// always derived from the verified token and never trusted from the
// request body. Anonymous users keep favorites in localStorage; this
// endpoint is only called when the client has a Firebase ID token.

import {
  HttpError,
  getCredentialErrorMessage,
  requireAuthenticatedUser,
} from "../../api/_lib/firebase-admin.js";
import { executeD1QueryInternal } from "../../api/_lib/d1-internal.js";

export const onRequest = async (context: any): Promise<Response> => {
  const { request } = context;
  try {
    const authHeader = request.headers.get("authorization") ?? undefined;
    const { decoded } = await requireAuthenticatedUser(authHeader);
    const userId = decoded.uid;
    if (!userId) throw new HttpError(401, "Missing user id in token.");

    if (request.method === "GET") {
      const result = await executeD1QueryInternal({
        sql: `SELECT species_id FROM user_species_favorites WHERE user_id = ?`,
        params: [userId],
      });
      const rows = Array.isArray(result?.results) ? result.results : [];
      const speciesIds = rows
        .map((r: any) => String(r?.species_id ?? ""))
        .filter(Boolean);
      return Response.json({ speciesIds });
    }

    if (request.method === "POST") {
      const body = (await request.json().catch(() => ({}))) as any;
      const action = String(body?.action || "");

      if (action === "add") {
        const speciesId = String(body?.speciesId || "");
        if (!speciesId) throw new HttpError(400, "Missing speciesId.");
        await executeD1QueryInternal({
          sql: `INSERT INTO user_species_favorites (user_id, species_id) VALUES (?, ?)
                ON CONFLICT(user_id, species_id) DO NOTHING`,
          params: [userId, speciesId],
        });
        return Response.json({ ok: true });
      }

      if (action === "remove") {
        const speciesId = String(body?.speciesId || "");
        if (!speciesId) throw new HttpError(400, "Missing speciesId.");
        await executeD1QueryInternal({
          sql: `DELETE FROM user_species_favorites WHERE user_id = ? AND species_id = ?`,
          params: [userId, speciesId],
        });
        return Response.json({ ok: true });
      }

      if (action === "bulkAdd") {
        const ids: string[] = Array.isArray(body?.speciesIds)
          ? body.speciesIds.map(String).filter(Boolean)
          : [];
        if (ids.length === 0) return Response.json({ ok: true, added: 0 });
        const placeholders = ids.map(() => "(?, ?)").join(", ");
        const params: string[] = [];
        for (const sid of ids) params.push(userId, sid);
        await executeD1QueryInternal({
          sql: `INSERT INTO user_species_favorites (user_id, species_id) VALUES ${placeholders}
                ON CONFLICT(user_id, species_id) DO NOTHING`,
          params,
        });
        return Response.json({ ok: true, added: ids.length });
      }

      throw new HttpError(400, `Unknown action: ${action}`);
    }

    return Response.json(
      { error: `Method ${request.method} not allowed.` },
      { status: 405 },
    );
  } catch (error: any) {
    const credentialMessage = getCredentialErrorMessage(error);
    if (credentialMessage) {
      return Response.json({ error: credentialMessage }, { status: 503 });
    }
    if (error instanceof HttpError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error("species-favorites endpoint failed:", error);
    return Response.json(
      { error: message || "Species favorites request failed." },
      { status: 500 },
    );
  }
};
