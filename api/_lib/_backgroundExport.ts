// Builder for the full Foundry-ready background item — served by
// `/api/module/backgrounds/<dbId>.json`. Parallel to `_featExport.ts`.
//
// Backgrounds now live in their own `backgrounds` table (migration
// 20260601-1200), promoted out of the shared `feats` table. The shared
// description / advancement / source machinery comes from
// `buildSpeciesBackgroundItem`; this builder layers on the two
// background-only `system` fields the dnd5e BackgroundData schema adds via
// StartingEquipmentTemplate:
//
//   system.startingEquipment[]  — EquipmentEntryData tree
//                                  ({_id, group, sort, type, count, key,
//                                   requiresProficiency}); type ∈
//                                   AND|OR|armor|tool|weapon|focus|currency|linked
//   system.wealth               — FormulaField (starting-gold alternative)
//
// dnd5e BackgroundData mixins: AdvancementTemplate + ItemDescriptionTemplate
// + StartingEquipmentTemplate (verified against dnd5e master
// module/data/item/background.mjs). `singleton: true` — an actor holds one.
//
// Storage: read straight from the `backgrounds` table's camelCase columns
// (`startingEquipment` JSON, `wealth` TEXT). These are empty in the current
// 5etools-sourced catalog but the columns ship anyway; entries round-trip
// once authored / imported.

import type { ExportFetchers } from "./_classExport.js";
import { buildSpeciesBackgroundItem, parseJsonField } from "./_speciesBackgroundShared.js";
import { buildBackgroundFeatureItem, type BackgroundFeatureItem } from "./_backgroundFeatureExport.js";

// ── structured proficiencies → dnd5e Trait advancements ────────────
//
// Backgrounds store proficiencies on the SHARED class model
// (`{type: {choiceCount, fixedIds, optionIds, categoryIds}}`, ids = table ROW
// ids). On export we map those row ids → trait IDENTIFIERS (the dnd5e-aligned
// keys: his / cartographer / common) and emit the Dauligor-internal Trait
// advancement shape the Foundry module consumes for class Trait advancements.

const TRAIT_KINDS = ["skills", "tools", "languages"] as const;
type TraitKind = (typeof TRAIT_KINDS)[number];

function advId(seed: string): string {
  const base = ("bgp" + seed).replace(/[^a-zA-Z0-9]/g, "");
  return (base + "0000000000000000").slice(0, 16);
}

function traitAdvancement(traitType: string, fixed: string[], options: string[], choiceCount: number, seed: string) {
  return {
    _id: advId(seed),
    type: "Trait",
    level: 1,
    title: "",
    configuration: {
      type: traitType,
      mode: "default",
      poolSource: "static",
      fixed,
      options,
      choiceCount,
      choiceSource: "",
      allowReplacements: false,
      categoryIds: [],
    },
    value: {},
  };
}

type TraitVocab = {
  /** row id → trait identifier, per kind. */
  idToIdent: Record<TraitKind, Record<string, string>>;
  /** all trait identifiers per kind — pool for "choose N of ANY" (empty pool). */
  allIdents: Record<TraitKind, string[]>;
};

/**
 * Build advancement objects from a background's structured `proficiencies`
 * (class model). `vocab` resolves stored row ids → trait identifiers.
 */
function proficienciesToAdvancements(prof: any, vocab: TraitVocab): any[] {
  if (!prof || typeof prof !== "object") return [];
  const out: any[] = [];

  for (const kind of TRAIT_KINDS) {
    const sel = prof[kind];
    if (!sel || typeof sel !== "object") continue;
    const map = (ids: any): string[] =>
      (Array.isArray(ids) ? ids : [])
        .map((id) => vocab.idToIdent[kind]?.[String(id)] || "")
        .filter(Boolean);

    const fixed = map(sel.fixedIds);
    if (fixed.length) out.push(traitAdvancement(kind, fixed, [], 0, `${kind}-fixed`));

    const choiceCount = Math.max(0, Number(sel.choiceCount) || 0);
    if (choiceCount > 0) {
      const mappedOptions = map(sel.optionIds);
      const options = mappedOptions.length ? mappedOptions : (vocab.allIdents[kind] || []);
      out.push(traitAdvancement(kind, [], options, choiceCount, `${kind}-choice`));
    }
  }

  return out;
}

export interface BackgroundItemBundle {
  kind: "dauligor.background-item.v1";
  schemaVersion: 1;
  dbId: string;
  sourceId: string;
  background: {
    name: string;
    type: "background";
    img?: string;
    system: Record<string, any>;
    effects: unknown[];
    flags: Record<string, any>;
  };
  /** Full feature items this background grants (referenced by the ItemGrant
   *  advancements on `background.system.advancement`, matched by
   *  `flags.dauligor-pairing.sourceId`). Empty when the background owns none. */
  features: BackgroundFeatureItem[];
  generatedAt: number;
}

/**
 * Build the full Foundry-ready background item bundle for one row.
 * Returns null when no row matches.
 */
export async function buildBackgroundItemBundle(
  backgroundId: string,
  fetchers: ExportFetchers,
): Promise<BackgroundItemBundle | null> {
  const built = await buildSpeciesBackgroundItem("backgrounds", backgroundId, fetchers, {
    foundryType: "background",
    entityKind: "background",
    scalingParentType: "background",
  });
  if (!built) return null;

  const { row, item, sourceId } = built;
  const system = item.system;

  // Background-only fields, read from the dedicated table's columns.
  // `startingEquipment` is an array of EquipmentEntryData; `wealth` is a
  // roll-formula string.
  system.startingEquipment = parseJsonField(row.startingEquipment, []) || [];
  system.wealth = typeof row.wealth === "string"
    ? row.wealth
    : row.wealth != null ? String(row.wealth) : "";

  // Structured proficiencies (class model) → dnd5e Trait / ASI / ItemGrant
  // advancements, merged into the advancement map the shared builder produced.
  // We resolve stored row ids → trait identifiers via the vocab tables.
  const proficiencies = parseJsonField(row.proficiencies, {});
  const hasProf = proficiencies && typeof proficiencies === "object" && ["skills", "tools", "languages"].some((k) => {
    const s = (proficiencies as any)[k];
    return s && ((s.fixedIds?.length || 0) > 0 || (s.optionIds?.length || 0) > 0 || (s.choiceCount || 0) > 0);
  });
  if (hasProf) {
    const emptyVocab: TraitVocab = {
      idToIdent: { skills: {}, tools: {}, languages: {} },
      allIdents: { skills: [], tools: [], languages: [] },
    };
    let vocab: TraitVocab = emptyVocab;
    try {
      const [sk, tl, lg] = await Promise.all([
        fetchers.fetchCollection<any>("skills", { orderBy: "name ASC" }),
        fetchers.fetchCollection<any>("tools", { orderBy: "name ASC" }),
        fetchers.fetchCollection<any>("languages", { orderBy: "name ASC" }),
      ]);
      const build = (rows: any[]) => {
        const map: Record<string, string> = {};
        const all: string[] = [];
        for (const r of rows || []) {
          const id = String(r?.id || "");
          const ident = String(r?.identifier || "");
          if (id && ident) map[id] = ident;
          if (ident) all.push(ident);
        }
        return { map, all };
      };
      const s = build(sk), t = build(tl), l = build(lg);
      vocab = {
        idToIdent: { skills: s.map, tools: t.map, languages: l.map },
        allIdents: { skills: s.all, tools: t.all, languages: l.all },
      };
    } catch { /* fall back to empty vocab — Trait fixed/options resolve to nothing */ }

    const profAdvancements = proficienciesToAdvancements(proficiencies, vocab);
    if (profAdvancements.length) {
      system.advancement = system.advancement && typeof system.advancement === "object"
        ? system.advancement
        : {};
      for (const adv of profAdvancements) system.advancement[adv._id] = adv;
    }
  }

  // Owned features (background_features.parentBackgroundId = this background)
  // → an ItemGrant advancement each (pool references the feature's sourceId)
  // plus the full feature items embedded in `features[]` so the module can
  // import + grant them without a second fetch.
  const features: BackgroundFeatureItem[] = [];
  try {
    const featureRows = await fetchers.fetchCollection<any>("background_features", {
      where: "parentBackgroundId = ?",
      params: [String(row.id)],
      orderBy: "name ASC",
    });
    for (const fr of featureRows || []) {
      const builtFeature = await buildBackgroundFeatureItem(String(fr.id), fetchers);
      if (!builtFeature) continue;
      features.push(builtFeature.item);
      const grant = {
        _id: advId(`feat-${builtFeature.sourceId}`),
        type: "ItemGrant",
        level: 1,
        title: "",
        configuration: {
          choiceType: "feature",
          count: 0,
          pool: [builtFeature.sourceId],
          optionalPool: [],
          optional: false,
        },
        value: {},
      };
      system.advancement = system.advancement && typeof system.advancement === "object"
        ? system.advancement
        : {};
      system.advancement[grant._id] = grant;
    }
  } catch { /* no owned features — background exports without grants */ }

  return {
    kind: "dauligor.background-item.v1",
    schemaVersion: 1,
    dbId: String(row.id),
    sourceId,
    background: { ...item, type: "background" },
    features,
    generatedAt: Date.now(),
  };
}
