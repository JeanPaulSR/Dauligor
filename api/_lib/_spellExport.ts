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
import { getSemanticSourceId } from "./_classExport.js";
import { bbcodeToHtml } from "./_bbcode.js";

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

  // Description rendering: prefer the BBCode column (`spells.description`)
  // rendered through `bbcodeToHtml`. Rationale:
  //   - The BBCode column is the authoritative post-import shape
  //     (Foundry HTML → BBCode at import time, see
  //     `docs/features/compendium-spells.md`). It carries inline
  //     emphasis ([b]/[i]) authors typed in the editor.
  //   - The raw `foundry_data.description.value` we used to ship is
  //     stripped of inline emphasis by Foundry's serializer — paragraph
  //     wrappers only. Visible on the actor sheet + Prepare Spells
  //     manager as "everything is the same weight, no bold for the
  //     sub-headings like 'Clenched Fist.'".
  //   - bbcodeToHtml preserves Foundry rich-text patterns
  //     (`[[/r ...]]`, `&Reference[...]`) as plain text; dnd5e's
  //     enrichHTML on the actor's side picks them up and renders the
  //     interactive widgets normally.
  // Falls back to the foundry_data value when BBCode is empty (e.g. a
  // Foundry-only spell that never round-tripped through the app
  // editor).
  const bbcodeDescription = trimString(row.description);
  if (bbcodeDescription) {
    foundrySystem.description = {
      ...(foundrySystem.description ?? {}),
      value: bbcodeToHtml(bbcodeDescription),
    };
  }

  // Resolve the spell's source FK to its public semantic id to match
  // the lightweight summary endpoint and the sources catalog. Single
  // sources lookup per per-spell fetch — cheap and consistent.
  let spellSourceIdSemantic: string | null = null;
  if (row.source_id) {
    const sourceRow: any = await fetchDocument<any>("sources", String(row.source_id));
    if (sourceRow) {
      const sourceData = {
        slug: sourceRow.slug,
        abbreviation: sourceRow.abbreviation,
        rules: sourceRow.rules_version || "2014",
      };
      spellSourceIdSemantic = getSemanticSourceId(sourceData, sourceRow.id);
    } else {
      // FK miss (shouldn't happen for valid rows); preserve raw id so
      // older clients still see SOMETHING they can match against.
      spellSourceIdSemantic = String(row.source_id);
    }
  }

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
        spellSourceId: spellSourceIdSemantic,
        requiredTagIds: Array.isArray(requiredTagIds)
          ? requiredTagIds.map(String)
          : [],
        prerequisiteText: String(row.prerequisite_text || ""),
        tagIds: Array.isArray(tagIds) ? tagIds.map(String) : [],
        // Same filter facets shipped in the lightweight summary —
        // keeps the actor's embedded spell item flag set identical
        // to what the picker saw, so any future sheet-side filter
        // chip code can read from a single source.
        activationBucket: String(row.activation_bucket || "special"),
        rangeBucket: String(row.range_bucket || "special"),
        durationBucket: String(row.duration_bucket || "instant"),
        shapeBucket: String(row.shape_bucket || "none"),
        componentsVocal: Boolean(row.components_vocal),
        componentsSomatic: Boolean(row.components_somatic),
        componentsMaterial: Boolean(row.components_material),
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
