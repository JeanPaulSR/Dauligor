import { saveAs } from "file-saver";
import { queryD1 } from "./d1";
import { buildCharacterExport } from "./characterShared";
import { slugify } from "./characterLogic";

/**
 * Client-side trigger for character export.
 */
export async function exportCharacterJSON(characterId: string) {
  const payload = await buildCharacterExport(characterId, queryD1);
  if (!payload) {
    throw new Error("Character not found or could not be loaded for export.");
  }

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const safeName = slugify(payload.actor?.name || "character");
  saveAs(blob, `dauligor-character-${safeName}-${characterId}.json`);
}
