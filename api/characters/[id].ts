// /api/characters/[id] — GET / PUT / DELETE for a single character.
//
// Closes the H4 / H5 leaks: previously every CharacterBuilder load/save/
// delete went through the generic /api/d1/query proxy with no ownership
// check, so any signed-in user could read or mutate any character by
// guessing the id. Now:
//
//   GET    — returns the structured character object (8 character_* tables
//            collapsed via rebuildCharacterFromSql) IFF the caller owns the
//            row or has a DM role (admin / co-dm). 404 otherwise so we
//            don't leak which ids exist.
//   PUT    — same auth gate. Body is the character object the client used
//            to send into generateCharacterSaveQueries on the client. The
//            server now owns the query construction so the client can't
//            inject extra mutations into the batch.
//   DELETE — same auth gate. D1 FK cascade clears every character_* child
//            row in one shot.
//
// `lore-writer` is deliberately excluded from the DM set — see
// `api/_lib/firebase-admin.ts:CHARACTER_DM_ROLES`.

import type { IncomingMessage } from "node:http";
import {
  HttpError,
  getCredentialErrorMessage,
  requireCharacterAccess,
} from "../_lib/firebase-admin.js";
import { executeD1QueryInternal } from "../_lib/d1-internal.js";
import {
  generateCharacterSaveQueries,
  rebuildCharacterFromSql,
} from "../_lib/_characterShared.js";

type NodeLikeRequest = IncomingMessage & {
  headers: Record<string, string | string[] | undefined>;
  body?: any;
  query?: Record<string, string | string[] | undefined>;
};

type NodeLikeResponse = {
  status: (code: number) => NodeLikeResponse;
  setHeader?: (name: string, value: string) => void;
  json: (body: unknown) => void;
};

function getCharacterId(req: NodeLikeRequest): string {
  const raw = req.query?.id;
  if (typeof raw === "string" && raw) return raw;
  if (Array.isArray(raw) && raw[0]) return raw[0];
  const url = req.url || "";
  const match = url.match(/\/api\/characters\/([^\/\?]+)/);
  if (match?.[1]) return decodeURIComponent(match[1]);
  return "";
}

async function readJsonBody(req: NodeLikeRequest): Promise<any> {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks: Buffer[] = [];
  for await (const chunk of req as any) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as any));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

/**
 * Pulls every row the client needs to reconstruct a full character — 8
 * tables in parallel, same shape as the old CharacterBuilder load path
 * (which ran the same 8 SELECTs directly via queryD1). Returning all of
 * them in one network round trip is a side benefit; the original 8
 * `Promise.all`-batched calls were already running in parallel client-side
 * but they crossed the Cloudflare boundary 8 separate times.
 */
async function loadCharacterRows(id: string) {
  const [
    baseRes,
    progressionRes,
    selectionRes,
    inventoryRes,
    spellRes,
    proficiencyRes,
    extensionRes,
    loadoutRes,
  ] = await Promise.all([
    executeD1QueryInternal({ sql: "SELECT * FROM characters WHERE id = ? LIMIT 1", params: [id] }),
    executeD1QueryInternal({ sql: "SELECT * FROM character_progression WHERE character_id = ?", params: [id] }),
    executeD1QueryInternal({ sql: "SELECT * FROM character_selections WHERE character_id = ?", params: [id] }),
    executeD1QueryInternal({ sql: "SELECT * FROM character_inventory WHERE character_id = ?", params: [id] }),
    executeD1QueryInternal({ sql: "SELECT * FROM character_spells WHERE character_id = ?", params: [id] }),
    executeD1QueryInternal({ sql: "SELECT * FROM character_proficiencies WHERE character_id = ?", params: [id] }),
    executeD1QueryInternal({ sql: "SELECT * FROM character_spell_list_extensions WHERE character_id = ?", params: [id] }),
    executeD1QueryInternal({ sql: "SELECT * FROM character_spell_loadouts WHERE character_id = ?", params: [id] }),
  ]);

  return {
    baseRows: (baseRes?.results || []) as any[],
    progressionRows: (progressionRes?.results || []) as any[],
    selectionRows: (selectionRes?.results || []) as any[],
    inventoryRows: (inventoryRes?.results || []) as any[],
    spellRows: (spellRes?.results || []) as any[],
    proficiencyRows: (proficiencyRes?.results || []) as any[],
    extensionRows: (extensionRes?.results || []) as any[],
    loadoutRows: (loadoutRes?.results || []) as any[],
  };
}

export default async function handler(req: NodeLikeRequest, res: NodeLikeResponse) {
  const characterId = getCharacterId(req);
  if (!characterId) {
    return res.status(400).json({ error: "Missing character id in path." });
  }

  try {
    if (req.method === "GET") {
      // Gate first — requireCharacterAccess does its own existence check
      // and throws 404 for both "doesn't exist" and "not yours" so probes
      // can't enumerate ids.
      await requireCharacterAccess(req.headers.authorization, characterId);

      const rows = await loadCharacterRows(characterId);
      // The access gate already confirmed the base row exists; defensive
      // guard for the unlikely race where a concurrent delete drops it
      // between the gate query and the parallel load.
      if (rows.baseRows.length === 0) {
        return res.status(404).json({ error: "Character not found." });
      }

      const character = rebuildCharacterFromSql(
        rows.baseRows[0],
        rows.progressionRows,
        rows.selectionRows,
        rows.inventoryRows,
        rows.spellRows,
        rows.proficiencyRows,
        rows.extensionRows,
        rows.loadoutRows,
      );

      return res.status(200).json({ character });
    }

    if (req.method === "PUT") {
      const { decoded, isOwner } = await requireCharacterAccess(req.headers.authorization, characterId);

      const body = await readJsonBody(req);
      const character = body?.character;
      if (!character || typeof character !== "object") {
        throw new HttpError(400, "Missing `character` in request body.");
      }

      // Defense in depth: the client sets `userId` to the current user when
      // creating a new character (CharacterBuilder.tsx:3448). If the caller
      // is a DM editing someone else's character, the client-side `userId`
      // should already be the owner's id; if it isn't (malicious client,
      // stale state, etc.) we trust the existing row's owner over whatever
      // the body says. Owners are also pinned to their own uid so a player
      // can't reassign their character to another account.
      const characterToSave = {
        ...character,
        id: characterId, // ensure path id wins over body id
        userId: isOwner ? decoded.uid : character.userId,
      };

      const queries = generateCharacterSaveQueries(characterId, characterToSave);

      // executeD1QueryInternal accepts batched arrays — same shape the
      // client previously sent through `/api/d1/query`. The shared worker
      // executes them sequentially so a partial failure doesn't leave the
      // character in a half-written state.
      await executeD1QueryInternal(queries);

      return res.status(200).json({ ok: true, id: characterId });
    }

    if (req.method === "DELETE") {
      await requireCharacterAccess(req.headers.authorization, characterId);

      // FK cascade in the schema clears progression / selections / inventory
      // / spells / proficiencies / loadouts / extensions in one shot. See
      // memory/project_d1_upsert_idiom.md — we use a plain DELETE here
      // (not INSERT OR REPLACE) precisely so the cascade fires correctly.
      await executeD1QueryInternal({
        sql: "DELETE FROM characters WHERE id = ?",
        params: [characterId],
      });

      return res.status(200).json({ ok: true, id: characterId });
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
    console.error(`/api/characters/[id] (${req.method}) failed:`, error);
    return res.status(500).json({ error: message || "Character request failed." });
  }
}
