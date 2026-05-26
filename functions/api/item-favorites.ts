// Item favorites endpoint. Mediates between the React client
// (src/lib/itemFavorites.ts) and the `user_item_favorites` D1 table.
//
// Mirrors functions/api/feat-favorites.ts exactly — universal scope
// only, requireAuthenticatedUser, user_id always from the verified
// token. The only difference is the payload key (`itemIds`/`itemId`
// instead of `featIds`/`featId`) and the underlying table.
//
// Note that this table doesn't FK back to a specific entity table —
// items are split across four tables (items, weapons, armor, tools)
// and a single favorites table over all four is simpler than four
// parallel tables. The resolver on the client filters out any
// favorite whose ID isn't present in any of the loaded item corpora
// (e.g. a deleted row), so deletion still produces clean output even
// without an FK cascade.

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
        sql: `SELECT item_id FROM user_item_favorites WHERE user_id = ?`,
        params: [userId],
      });
      const rows = Array.isArray(result?.results) ? result.results : [];
      const itemIds = rows
        .map((r: any) => String(r?.item_id ?? ""))
        .filter(Boolean);
      return Response.json({ itemIds });
    }

    if (request.method === "POST") {
      const body = (await request.json().catch(() => ({}))) as any;
      const action = String(body?.action || "");

      if (action === "add") {
        const itemId = String(body?.itemId || "");
        if (!itemId) throw new HttpError(400, "Missing itemId.");
        await executeD1QueryInternal({
          sql: `INSERT INTO user_item_favorites (user_id, item_id) VALUES (?, ?)
                ON CONFLICT(user_id, item_id) DO NOTHING`,
          params: [userId, itemId],
        });
        return Response.json({ ok: true });
      }

      if (action === "remove") {
        const itemId = String(body?.itemId || "");
        if (!itemId) throw new HttpError(400, "Missing itemId.");
        await executeD1QueryInternal({
          sql: `DELETE FROM user_item_favorites WHERE user_id = ? AND item_id = ?`,
          params: [userId, itemId],
        });
        return Response.json({ ok: true });
      }

      if (action === "bulkAdd") {
        const ids: string[] = Array.isArray(body?.itemIds)
          ? body.itemIds.map(String).filter(Boolean)
          : [];
        if (ids.length === 0) return Response.json({ ok: true, added: 0 });
        const placeholders = ids.map(() => "(?, ?)").join(", ");
        const params: string[] = [];
        for (const iid of ids) params.push(userId, iid);
        await executeD1QueryInternal({
          sql: `INSERT INTO user_item_favorites (user_id, item_id) VALUES ${placeholders}
                ON CONFLICT(user_id, item_id) DO NOTHING`,
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
    console.error("item-favorites endpoint failed:", error);
    return Response.json(
      { error: message || "Item favorites request failed." },
      { status: 500 },
    );
  }
};
