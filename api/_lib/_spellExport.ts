// Builder for the full Foundry-ready spell item — served by
// `/api/module/spells/<dbId>.json`. Used by the Foundry importer at
// embed time to fetch the heavy `system` block (description,
// activities, materials, range, duration, ...) and `effects` for the
// spells the user just picked.
//
// Why this is separate from the per-class spell list:
//   - `_classSpellList.ts` returns LIGHTWEIGHT summaries (name + img +
//     flags) for the picker. ~700 bytes per spell.
//   - This module returns the FULL spell item (~3-5 KB per spell)
//     ready to drop into `actor.createEmbeddedDocuments`.
//   - The split lets a picker open with a 26 KB pool fetch instead of
//     141 KB, and only pays the full-spell cost for the handful of
//     spells the user actually picks (typically 2-6 at level 1).
//
// Schema: identical to what the legacy `classSpellItems` array used
// to carry — the Foundry module's embed code reads the same fields.

import type { ExportFetchers } from "./_classExport.js";

const parseJsonField = (val: any, fallback: any) => {
  if (val == null) return fallback;
  if (typeof val !== "string") return val;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
};

const trimString = (val: any) => String(val ?? "").trim();

/**
 * Shape of the response payload. The `spell` field is the
 * Foundry-ready item that downstream code can hand straight to
 * `actor.createEmbeddedDocuments("Item", [spell])`.
 */
export interface SpellItemBundle {
  kind: "dauligor.spell-item.v1";
  schemaVersion: 1;
  dbId: string;
  sourceId: string;
  spell: {
    name: string;
    type: "spell";
    img?: string;
    system: Record<string, any>;
    effects: unknown[];
    flags: Record<string, any>;
  };
  generatedAt: number;
}

/**
 * Build the full Foundry-ready spell item bundle for one spell.
 *
 * Lookup is by DB id (`spells.id`), which is what the lightweight
 * summary in `/classes/<class>/spells.json` ships in
 * `flags.dauligor-pairing.dbId`. Direct PK lookup, single round-trip.
 *
 * Returns null when no row matches.
 */
export async function buildSpellItemBundle(
  spellId: string,
  fetchers: ExportFetchers,
): Promise<SpellItemBundle | null> {
  const { fetchDocument } = fetchers;
  const row: any = await fetchDocument<any>("spells", spellId);
  if (!row) return null;

  const foundrySystem = parseJsonField(row.foundry_data, {}) || {};
  const requiredTagIds = parseJsonField(row.required_tags, []) || [];
  const tagIds = parseJsonField(row.tags, []) || [];
  const sourceId = trimString(row.identifier) || `spell-${row.id}`;

  const spell = {
    name: String(row.name || ""),
    type: "spell" as const,
    img: row.image_url || undefined,
    system: foundrySystem,
    // The spells table's `effects` column is the Foundry-shape
    // effects array (parsed JSON). Empty array when no item-level
    // ActiveEffects are authored.
    effects: parseJsonField(row.effects, []) || [],
    flags: {
      "dauligor-pairing": {
        schemaVersion: 1,
        entityKind: "spell",
        sourceId,
        dbId: String(row.id),
        level: Number(row.level || 0),
        school: String(row.school || ""),
        spellSourceId: row.source_id || null,
        requiredTagIds: Array.isArray(requiredTagIds)
          ? requiredTagIds.map(String)
          : [],
        prerequisiteText: String(row.prerequisite_text || ""),
        tagIds: Array.isArray(tagIds) ? tagIds.map(String) : [],
        concentration: Boolean(row.concentration),
        ritual: Boolean(row.ritual),
      },
    },
  };

  return {
    kind: "dauligor.spell-item.v1",
    schemaVersion: 1,
    dbId: String(row.id),
    sourceId,
    spell,
    generatedAt: Date.now(),
  };
}
