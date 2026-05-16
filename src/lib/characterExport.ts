import { saveAs } from "file-saver";
import { queryD1 } from "./d1";
import { auth } from "./firebase";
import { buildCharacterExport } from "./characterShared";
import { slugify } from "./characterLogic";

/**
 * Client-side trigger for character export.
 *
 * The character payload itself is loaded via /api/characters/[id] so the
 * server gates ownership / DM access — closes the H4 export-leak path
 * where exportCharacterJSON('any-id') would previously return the full
 * sheet to any signed-in user. The downstream compendium lookups
 * (classes / subclasses / spell content) still go through queryD1; that
 * data isn't owner-scoped.
 */
export async function exportCharacterJSON(characterId: string) {
  const idToken = await auth.currentUser?.getIdToken();
  const res = await fetch(`/api/characters/${encodeURIComponent(characterId)}`, {
    headers: idToken ? { Authorization: `Bearer ${idToken}` } : {},
  });
  if (res.status === 404 || res.status === 403) {
    throw new Error("Character not found or you don't have access to it.");
  }
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || `Failed to load character (HTTP ${res.status})`);
  }
  const { character } = await res.json();
  if (!character) {
    throw new Error("Character not found or could not be loaded for export.");
  }

  const payload = await buildCharacterExport(characterId, queryD1, character);
  if (!payload) {
    throw new Error("Character could not be exported.");
  }

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const safeName = slugify(payload.actor?.name || "character");
  saveAs(blob, `dauligor-character-${safeName}-${characterId}.json`);
}
