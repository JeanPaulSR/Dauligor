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

import {
  HttpError,
  getCredentialErrorMessage,
  isCharacterDM,
  requireAuthenticatedUser,
  requireCharacterAccess,
} from "../../../api/_lib/firebase-admin.js";
import { executeD1QueryInternal } from "../../../api/_lib/d1-internal.js";
import {
  generateCharacterSaveQueries,
  rebuildCharacterFromSql,
} from "../../../api/_lib/_characterShared.js";

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

export const onRequest = async (context: any): Promise<Response> => {
  const { request, params } = context;
  const characterId = String(params?.id || "");
  if (!characterId) {
    return Response.json({ error: "Missing character id in path." }, { status: 400 });
  }

  try {
    const authHeader = request.headers.get("authorization") ?? undefined;

    if (request.method === "GET") {
      // Gate first — requireCharacterAccess does its own existence check
      // and throws 404 for both "doesn't exist" and "not yours" so probes
      // can't enumerate ids.
      await requireCharacterAccess(authHeader, characterId);

      const rows = await loadCharacterRows(characterId);
      // The access gate already confirmed the base row exists; defensive
      // guard for the unlikely race where a concurrent delete drops it
      // between the gate query and the parallel load.
      if (rows.baseRows.length === 0) {
        return Response.json({ error: "Character not found." }, { status: 404 });
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

      return Response.json({ character });
    }

    if (request.method === "PUT") {
      // PUT is "create or update" — CharacterBuilder hits it with a
      // freshly-generated UUID when the user is saving a brand-new
      // character (no row in D1 yet) AND with an existing UUID when
      // they're editing one they (or a DM) already own. requireCharacterAccess
      // throws 404 for the create case because it expects a row to gate
      // against, so we do the gate inline here instead.
      const { decoded, role } = await requireAuthenticatedUser(authHeader);
      const callerUid: string = decoded.uid;
      const callerIsDM = isCharacterDM(role);

      const body = (await request.json().catch(() => ({}))) as any;
      const character = body?.character;
      if (!character || typeof character !== "object") {
        throw new HttpError(400, "Missing `character` in request body.");
      }

      // Does this character already exist?
      const existingResult = await executeD1QueryInternal({
        sql: "SELECT user_id FROM characters WHERE id = ? LIMIT 1",
        params: [characterId],
      });
      const existingRows = Array.isArray(existingResult?.results) ? existingResult.results : [];
      const existing = existingRows[0] as { user_id?: string } | undefined;

      // Resolve the user_id we'll persist. Update vs create take
      // different paths but end at the same shape (id from URL, userId
      // never trustable as-is from the client).
      let resolvedUserId: string;
      if (existing) {
        // UPDATE — owner or DM only. Same 404 pattern as
        // requireCharacterAccess so probes can't enumerate which ids
        // belong to whom by attempting writes.
        const existingUserId = String(existing.user_id ?? "");
        const isOwner = existingUserId === callerUid;
        if (!isOwner && !callerIsDM) {
          throw new HttpError(404, "Character not found.");
        }
        // Owner pinned to their own uid; DMs keep editing the original
        // owner's row without accidentally reassigning ownership.
        resolvedUserId = isOwner ? callerUid : existingUserId;
      } else {
        // CREATE — players can create their own, DMs can create for
        // any user (e.g. building a quick NPC sheet for a player).
        // Requested ownership comes from the body; we never trust it
        // blindly.
        const requestedUserId = typeof character.userId === "string" ? character.userId : "";
        if (callerIsDM) {
          resolvedUserId = requestedUserId || callerUid;
        } else {
          // Players are limited to creating their own characters. If
          // the client sent a different uid (stale state, malicious
          // mutation, anything), fail explicitly rather than silently
          // pinning it — surfacing the mismatch helps catch bugs in
          // the client's "isNew" branch.
          if (requestedUserId && requestedUserId !== callerUid) {
            throw new HttpError(403, "Cannot create a character for another user.");
          }
          resolvedUserId = callerUid;
        }
      }

      const characterToSave = {
        ...character,
        id: characterId, // ensure path id wins over body id
        userId: resolvedUserId,
      };

      const queries = generateCharacterSaveQueries(characterId, characterToSave);

      // executeD1QueryInternal accepts batched arrays — same shape the
      // client previously sent through `/api/d1/query`. The shared worker
      // executes them sequentially so a partial failure doesn't leave the
      // character in a half-written state.
      await executeD1QueryInternal(queries);

      return Response.json({ ok: true, id: characterId });
    }

    if (request.method === "DELETE") {
      await requireCharacterAccess(authHeader, characterId);

      // FK cascade in the schema clears progression / selections / inventory
      // / spells / proficiencies / loadouts / extensions in one shot. See
      // memory/project_d1_upsert_idiom.md — we use a plain DELETE here
      // (not INSERT OR REPLACE) precisely so the cascade fires correctly.
      await executeD1QueryInternal({
        sql: "DELETE FROM characters WHERE id = ?",
        params: [characterId],
      });

      return Response.json({ ok: true, id: characterId });
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
    console.error(`/api/characters/[id] (${request.method}) failed:`, error);
    return Response.json(
      { error: message || "Character request failed." },
      { status: 500 },
    );
  }
};
