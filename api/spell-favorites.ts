// Spell favorites endpoint. Mediates between the React client
// (src/lib/spellFavorites.ts) and two D1 tables:
//
//   - `user_spell_favorites` for the "Universal Favorite" scope —
//     account-level, cross-character, cross-device.
//   - `character_spell_favorites` for the per-character scope —
//     same shape, plus a `character_id` column. Switched on by
//     passing `characterId` in the query string (GET) or body (POST).
//
// Both scopes use `requireAuthenticatedUser` (not staff) — any signed-
// in user can read/write their OWN rows only. The user_id is always
// derived from the verified token and never from the request body.
// For character-scoped operations the endpoint also verifies the
// character belongs to the caller before touching anything, so a
// malicious client passing someone else's characterId 404s instead
// of leaking their favorites.
//
// Anonymous users keep favorites in localStorage; this endpoint is
// only called when the client has a Firebase ID token.

import type { IncomingMessage } from "node:http";
import { HttpError, getCredentialErrorMessage, requireAuthenticatedUser } from "./_lib/firebase-admin.js";
import { executeD1QueryInternal } from "./_lib/d1-internal.js";

/**
 * Asserts the given character belongs to the caller. Throws 404 if
 * the character doesn't exist or is owned by someone else (we treat
 * "not yours" the same as "doesn't exist" to avoid leaking the
 * existence of other users' characters).
 */
async function assertCharacterOwnership(userId: string, characterId: string): Promise<void> {
  const result = await executeD1QueryInternal({
    sql: `SELECT 1 FROM characters WHERE id = ? AND user_id = ? LIMIT 1`,
    params: [characterId, userId],
  });
  const rows = Array.isArray(result?.results) ? result.results : [];
  if (rows.length === 0) {
    throw new HttpError(404, "Character not found.");
  }
}

type NodeLikeRequest = IncomingMessage & {
  headers: Record<string, string | string[] | undefined>;
  body?: any;
};

type NodeLikeResponse = {
  status: (code: number) => NodeLikeResponse;
  setHeader?: (name: string, value: string) => void;
  json: (body: unknown) => void;
};

async function readJsonBody(req: NodeLikeRequest): Promise<any> {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks: Buffer[] = [];
  for await (const chunk of req as any) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as any));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

export default async function handler(req: NodeLikeRequest, res: NodeLikeResponse) {
  try {
    const authHeader = req.headers.authorization;
    const { decoded } = await requireAuthenticatedUser(authHeader);
    const userId = decoded.uid;
    if (!userId) throw new HttpError(401, "Missing user id in token.");

    if (req.method === "GET") {
      // Scope: ?characterId=<id> selects per-character favorites; absent
      // / blank selects the universal scope. Character-scope reads
      // verify ownership first.
      const url = new URL(req.url || "/", "http://localhost");
      const characterId = url.searchParams.get("characterId") || "";

      if (characterId) {
        await assertCharacterOwnership(userId, characterId);
        const result = await executeD1QueryInternal({
          sql: `SELECT spell_id FROM character_spell_favorites
                WHERE user_id = ? AND character_id = ?`,
          params: [userId, characterId],
        });
        const rows = Array.isArray(result?.results) ? result.results : [];
        const spellIds = rows.map((r: any) => String(r?.spell_id ?? "")).filter(Boolean);
        return res.status(200).json({ spellIds });
      }

      const result = await executeD1QueryInternal({
        sql: `SELECT spell_id FROM user_spell_favorites WHERE user_id = ?`,
        params: [userId],
      });
      const rows = Array.isArray(result?.results) ? result.results : [];
      const spellIds = rows
        .map((r: any) => String(r?.spell_id ?? ""))
        .filter(Boolean);
      return res.status(200).json({ spellIds });
    }

    if (req.method === "POST") {
      const body = await readJsonBody(req);
      const action = String(body?.action || "");
      const characterId = body?.characterId ? String(body.characterId) : "";

      // For character-scoped writes the endpoint verifies ownership
      // ONCE at the top — every action handler below trusts the
      // verified characterId from that point on.
      if (characterId) await assertCharacterOwnership(userId, characterId);

      if (action === "add") {
        const spellId = String(body?.spellId || "");
        if (!spellId) throw new HttpError(400, "Missing spellId.");
        if (characterId) {
          await executeD1QueryInternal({
            sql: `INSERT INTO character_spell_favorites (user_id, character_id, spell_id)
                  VALUES (?, ?, ?)
                  ON CONFLICT(user_id, character_id, spell_id) DO NOTHING`,
            params: [userId, characterId, spellId],
          });
        } else {
          await executeD1QueryInternal({
            sql: `INSERT INTO user_spell_favorites (user_id, spell_id) VALUES (?, ?)
                  ON CONFLICT(user_id, spell_id) DO NOTHING`,
            params: [userId, spellId],
          });
        }
        return res.status(200).json({ ok: true });
      }

      if (action === "remove") {
        const spellId = String(body?.spellId || "");
        if (!spellId) throw new HttpError(400, "Missing spellId.");
        if (characterId) {
          await executeD1QueryInternal({
            sql: `DELETE FROM character_spell_favorites
                  WHERE user_id = ? AND character_id = ? AND spell_id = ?`,
            params: [userId, characterId, spellId],
          });
        } else {
          await executeD1QueryInternal({
            sql: `DELETE FROM user_spell_favorites WHERE user_id = ? AND spell_id = ?`,
            params: [userId, spellId],
          });
        }
        return res.status(200).json({ ok: true });
      }

      if (action === "bulkAdd") {
        const ids = Array.isArray(body?.spellIds) ? body.spellIds.map(String).filter(Boolean) : [];
        if (ids.length === 0) return res.status(200).json({ ok: true, added: 0 });
        if (characterId) {
          // 3-tuple multi-row insert for the character scope.
          const placeholders = ids.map(() => "(?, ?, ?)").join(", ");
          const params: string[] = [];
          for (const sid of ids) params.push(userId, characterId, sid);
          await executeD1QueryInternal({
            sql: `INSERT INTO character_spell_favorites (user_id, character_id, spell_id)
                  VALUES ${placeholders}
                  ON CONFLICT(user_id, character_id, spell_id) DO NOTHING`,
            params,
          });
        } else {
          // Build one INSERT with multi-row VALUES — favorites lists are
          // tiny (dozens, not thousands) so this stays well under any
          // single-statement size limit.
          const placeholders = ids.map(() => "(?, ?)").join(", ");
          const params: string[] = [];
          for (const sid of ids) params.push(userId, sid);
          await executeD1QueryInternal({
            sql: `INSERT INTO user_spell_favorites (user_id, spell_id) VALUES ${placeholders}
                  ON CONFLICT(user_id, spell_id) DO NOTHING`,
            params,
          });
        }
        return res.status(200).json({ ok: true, added: ids.length });
      }

      throw new HttpError(400, `Unknown action: ${action}`);
    }

    return res.status(405).json({ error: `Method ${req.method} not allowed.` });
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
    console.error("spell-favorites endpoint failed:", error);
    return res.status(500).json({ error: message || "Spell favorites request failed." });
  }
}
