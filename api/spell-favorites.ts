// Per-user spell favorites endpoint. Mediates between the React client
// (src/lib/spellFavorites.ts) and the D1 `user_spell_favorites` table
// for logged-in users. Uses `requireAuthenticatedUser` (not staff) —
// any signed-in user can read/write their OWN row only; the user_id is
// always taken from the verified token and never from the request body.
//
// Anonymous users keep favorites in localStorage; this endpoint is only
// called when the client has a Firebase ID token.

import type { IncomingMessage } from "node:http";
import { HttpError, getCredentialErrorMessage, requireAuthenticatedUser } from "./_lib/firebase-admin.js";
import { executeD1QueryInternal } from "./_lib/d1-internal.js";

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

      if (action === "add") {
        const spellId = String(body?.spellId || "");
        if (!spellId) throw new HttpError(400, "Missing spellId.");
        await executeD1QueryInternal({
          sql: `INSERT INTO user_spell_favorites (user_id, spell_id) VALUES (?, ?)
                ON CONFLICT(user_id, spell_id) DO NOTHING`,
          params: [userId, spellId],
        });
        return res.status(200).json({ ok: true });
      }

      if (action === "remove") {
        const spellId = String(body?.spellId || "");
        if (!spellId) throw new HttpError(400, "Missing spellId.");
        await executeD1QueryInternal({
          sql: `DELETE FROM user_spell_favorites WHERE user_id = ? AND spell_id = ?`,
          params: [userId, spellId],
        });
        return res.status(200).json({ ok: true });
      }

      if (action === "bulkAdd") {
        const ids = Array.isArray(body?.spellIds) ? body.spellIds.map(String).filter(Boolean) : [];
        if (ids.length === 0) return res.status(200).json({ ok: true, added: 0 });
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
