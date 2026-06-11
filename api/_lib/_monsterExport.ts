// Builder for the full Foundry-ready NPC actor — served by
// `/api/module/<source>/monsters/<identifier>.json`. The Foundry module's
// monster-import path (foundry-module branch, NEW work — see the handoff)
// creates an Actor from this bundle, embeds the action/trait Items, and runs
// each item's `system.activities` through `normalizeSemanticActivityCollection`
// (the SAME converter classes/feats/items use) so the activities become
// functional Foundry attack/save/damage rolls.
//
// Parallel to `_featExport.ts`. Monster actions/traits are emitted as `feat`
// Items whose `system.activities` is the keyed-object map of our stored
// SemanticActivity[] (formula-bearing — the whole point of the activity-shape
// rework). The actor `system.*` is reconstructed from the camelCase `monsters`
// columns (the inverse of `src/lib/monsterImport.ts`).
//
// Foundry shape (an Actor document handed to `Actor.create`):
//   type: "npc"
//   img / prototypeToken.texture.src
//   system: { abilities, attributes{ac,hp,movement,senses}, details{cr,type,
//             alignment,biography,habitat}, traits{size,di,dr,dv,ci,languages},
//             skills, resources{legact,legres,lair}, source }
//   items: [ { type:"feat", system:{ description, activities, uses, type, source },
//             flags.plutonium.page } , ... ]

import type { ExportFetchers } from "./_classExport.js";
import { bbcodeToHtml } from "./_bbcode.js";

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;

// Skill slug → governing ability (mirrors src/lib/monsterDisplay SKILL_ABILITY).
const SKILL_ABILITY: Record<string, string> = {
  acr: "dex", ani: "wis", arc: "int", ath: "str", dec: "cha", his: "int",
  ins: "wis", itm: "cha", inv: "int", med: "wis", nat: "int", prc: "wis",
  prf: "cha", per: "cha", rel: "int", slt: "dex", ste: "dex", sur: "wis",
};

const parseJsonField = (val: any, fallback: any) => {
  if (val == null) return fallback;
  if (typeof val !== "string") return val;
  try { return JSON.parse(val); } catch { return fallback; }
};
const trimString = (val: any) => String(val ?? "").trim();
const numOr = (v: any, d: number | null = null) => {
  if (v === "" || v == null) return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

/**
 * Coerce a SemanticActivity[] (or already-keyed map) into Foundry's keyed-object
 * `system.activities` map. The module re-derives each Foundry `_id` from the
 * SemanticActivity's `id` during normalization, so the outer key only needs to
 * be stable+unique. Mirrors `_featExport.ts`'s arrayToFoundryMap (kept local so
 * a tweak here can't cascade into the feat path).
 */
function arrayToFoundryMap(entries: any): Record<string, any> {
  if (entries && typeof entries === "object" && !Array.isArray(entries)) {
    return entries as Record<string, any>;
  }
  const list = Array.isArray(entries) ? entries : [];
  const map: Record<string, any> = {};
  for (let i = 0; i < list.length; i++) {
    const entry = list[i] ?? {};
    const key = trimString(entry?.id || entry?._id) || `act${String(i).padStart(13, "0")}`;
    map[key] = entry;
  }
  return map;
}

export interface MonsterActorBundle {
  kind: "dauligor.monster-actor.v1";
  schemaVersion: 1;
  dbId: string;
  sourceId: string;
  actor: {
    name: string;
    type: "npc";
    img?: string;
    prototypeToken?: Record<string, any>;
    system: Record<string, any>;
    items: any[];
    effects: unknown[];
    flags: Record<string, any>;
  };
  /**
   * The creature's spell list (linked by `identifier` to the spells catalog).
   * The module resolves these from `/api/module/<source>/spells.json` rather
   * than embedding spell Items here. Empty for non-casters.
   */
  spellcasting: any[];
  generatedAt: number;
}

// Build a single action/trait → a Foundry `feat` Item carrying its
// SemanticActivity[] as `system.activities`.
function buildActionItem(entry: any, source: { book: string; rules: string; page: string }): any {
  const descriptionBbcode = trimString(entry?.description);
  const uses = entry?.uses && typeof entry.uses === "object"
    ? {
        max: trimString(entry.uses.max),
        spent: 0,
        recovery: Array.isArray(entry.uses.recovery) ? entry.uses.recovery : [],
      }
    : { max: "", spent: 0, recovery: [] };
  return {
    name: trimString(entry?.name) || "Unnamed",
    type: "feat",
    system: {
      type: { value: "monster", subtype: "" },
      description: { value: descriptionBbcode ? bbcodeToHtml(descriptionBbcode) : "", chat: "" },
      activities: arrayToFoundryMap(entry?.activities),
      uses,
      properties: [],
      source: { book: source.book, page: source.page, rules: source.rules, revision: 1, custom: "", license: "" },
    },
    effects: [],
    flags: {
      plutonium: { page: trimString(entry?.pageBucket) || undefined },
      "dauligor-pairing": { schemaVersion: 1, entityKind: "monster-feature" },
    },
  };
}

/**
 * Build the Foundry-ready NPC actor bundle for one monster, resolved by
 * `identifier`. Returns null when no row matches.
 */
export async function buildMonsterBundleForIdentifier(
  identifier: string,
  fetchers: ExportFetchers,
): Promise<MonsterActorBundle | null> {
  const { fetchDocument, fetchCollection } = fetchers;
  const matches = await fetchCollection<any>("monsters", {
    where: "identifier = ?",
    params: [identifier],
    orderBy: "name ASC",
  });
  const row: any = (matches && matches[0]) || null;
  if (!row) return null;

  const j = (v: any, f: any) => parseJsonField(v, f);
  const abilities = j(row.abilities, {});
  const movement = j(row.movement, {});
  const senses = j(row.senses, {});
  const saves = j(row.saves, {});
  const skills = j(row.skills, {});
  const languages = j(row.languages, { value: [] });
  const habitat = j(row.habitat, { value: [] });

  // Source flag/citation.
  let sourceBook = trimString(row.sourceBook);
  let sourceRules = trimString(row.sourceRules) || "2014";
  if (row.sourceId) {
    const src: any = await fetchDocument<any>("sources", String(row.sourceId));
    if (src) {
      sourceBook = trimString(src.abbreviation || src.name) || sourceBook;
      sourceRules = trimString(src.rules_version) || sourceRules;
    }
  }
  const source = { book: sourceBook, page: trimString(row.page), rules: sourceRules };

  // Foundry npc system.abilities — value + proficient(save) flag.
  const sysAbilities: Record<string, any> = {};
  for (const a of ABILITIES) {
    sysAbilities[a] = { value: numOr(abilities[a], 10) ?? 10, proficient: saves[a] != null ? 1 : 0 };
  }
  // Foundry npc system.skills — proficiency rank (0/1/2) + governing ability.
  const sysSkills: Record<string, any> = {};
  for (const [slug, v] of Object.entries(skills) as [string, any][]) {
    sysSkills[slug] = { value: v?.expertise ? 2 : 1, ability: SKILL_ABILITY[slug] || "int" };
  }

  const system: Record<string, any> = {
    abilities: sysAbilities,
    attributes: {
      ac: { flat: numOr(row.ac), calc: trimString(row.acFormula) ? "custom" : "natural", formula: trimString(row.acFormula) },
      hp: { value: numOr(row.hp, 0), max: numOr(row.hp, 0), formula: trimString(row.hpFormula) },
      movement: { ...movement },
      senses: { ...senses },
      spellcasting: "",
    },
    details: {
      cr: numOr(row.cr),
      type: { value: trimString(row.creatureType), subtype: trimString(row.typeSubtype), swarm: trimString(row.swarmSize) },
      alignment: trimString(row.alignment),
      biography: { value: trimString(row.biography) ? bbcodeToHtml(row.biography) : "" },
      habitat: { value: Array.isArray(habitat.value) ? habitat.value.map((t: string) => ({ type: t })) : [], custom: trimString(habitat.custom) },
    },
    traits: {
      size: trimString(row.size) || "med",
      di: j(row.damageImmunities, { value: [], bypasses: [] }),
      dr: j(row.damageResistances, { value: [], bypasses: [] }),
      dv: j(row.damageVulnerabilities, { value: [], bypasses: [] }),
      ci: j(row.conditionImmunities, { value: [] }),
      languages: {
        value: Array.isArray(languages.value) ? languages.value : [],
        custom: trimString(languages.custom),
        communication: languages.telepathy != null ? { telepathy: { value: numOr(languages.telepathy), units: "ft" } } : {},
      },
    },
    skills: sysSkills,
    resources: {
      legact: { value: numOr(row.legendaryActionCount, 0) ?? 0, max: numOr(row.legendaryActionCount, 0) ?? 0 },
      legres: { value: numOr(row.legendaryResistanceCount, 0) ?? 0, max: numOr(row.legendaryResistanceCount, 0) ?? 0 },
      lair: { value: !!row.hasLair, initiative: numOr(row.lairInitiative), inside: false },
    },
    source: { ...source, revision: 1, custom: "", license: "" },
  };

  // Embedded Items — every body section becomes feat Items (in render order).
  // The reader's prose lives in system.description; the SemanticActivity[] lives
  // in system.activities for the module to convert.
  const items: any[] = [];
  for (const col of ["traits", "actions", "bonusActions", "reactions", "legendaryActions", "lairActions", "regionalEffects"]) {
    const entries = j(row[col], []);
    if (Array.isArray(entries)) for (const e of entries) items.push(buildActionItem(e, source));
  }
  // Legendary preamble → a passive feat carrying the wrapper prose, if present.
  const preamble = trimString(row.legendaryActionsPreamble);
  if (preamble) {
    items.push({
      name: "Legendary Actions",
      type: "feat",
      system: { type: { value: "monster", subtype: "" }, description: { value: bbcodeToHtml(preamble), chat: "" }, activities: {}, source: { ...source, revision: 1, custom: "", license: "" } },
      effects: [], flags: { plutonium: { page: null }, "dauligor-pairing": { schemaVersion: 1, entityKind: "monster-feature" } },
    });
  }

  return {
    kind: "dauligor.monster-actor.v1",
    schemaVersion: 1,
    dbId: String(row.id),
    sourceId: trimString(row.identifier) || `monster-${row.id}`,
    actor: {
      name: trimString(row.name),
      type: "npc",
      img: row.imageUrl || undefined,
      prototypeToken: row.tokenImageUrl ? { texture: { src: row.tokenImageUrl } } : undefined,
      system,
      items,
      effects: [],
      flags: {
        "dauligor-pairing": {
          schemaVersion: 1,
          entityKind: "monster",
          dbId: String(row.id),
          sourceId: trimString(row.identifier),
        },
      },
    },
    spellcasting: j(row.spellcasting, []),
    generatedAt: Date.now(),
  };
}
