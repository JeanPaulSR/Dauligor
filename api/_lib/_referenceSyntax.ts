export type ReferenceMode = "formula" | "text";

export interface ReferenceExample {
  label: string;
  semantic: string;
  native: string;
  description: string;
}

export interface ReferenceSheetRow {
  label: string;
  authoring: string;
  foundry: string;
}

export interface ReferenceSheetSection {
  id: string;
  title: string;
  description: string;
  rows: ReferenceSheetRow[];
  notes?: string[];
  isDropdown?: boolean;
  /** Skills / tools sections render their dropdown rows in two columns. */
  isSplit?: boolean;
}

export interface ReferenceColumnExample {
  name: string;
  identifier?: string;
  sourceId?: string;
  parentType?: string;
}

export interface SpellFormulaShortcutRow {
  label: string;
  authoring: string;
  preview: string;
  description: string;
}

export interface ReferenceContext {
  classIdentifier?: string;
  classLabel?: string;
  subclassIdentifier?: string;
  subclassLabel?: string;
  spellcastingAbility?: string;
  scaleIdentifier?: string;
  classColumns?: ReferenceColumnExample[];
}

const ABILITY_KEYS = new Set(["str", "dex", "con", "int", "wis", "cha"]);
const ABILITY_ORDER = ["str", "dex", "con", "int", "wis", "cha"] as const;
const ABILITY_LABELS: Record<(typeof ABILITY_ORDER)[number], string> = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma",
};

// ─── Shorthand vocabularies ──────────────────────────────────────────
//
// Each map keys the short authoring form (what the user types) to the
// Foundry-native fragment. Anything in these maps is recognised by the
// scalar regex and resolved at export / display time. Keep these as
// the single source of truth: the sheet UI, the regex builder, and
// the resolver all read from these constants — keeping them in sync
// is a manual edit on every site otherwise.
//
// Naming convention:
//   - Skills: full human name, hyphen-separated (`animal-handling`).
//   - Tools : possessive dropped (`alchemists-supplies`, not
//             `alchemist-s-supplies`) so the shortcut reads naturally.
//   - Lang  : Foundry's stem (`deep`) plus an alias for the natural
//             name (`deep-speech` → also resolves to `deep`).

const SKILL_SHORTCUTS: Record<string, string> = {
  acrobatics: "acr",
  "animal-handling": "ani",
  arcana: "arc",
  athletics: "ath",
  deception: "dec",
  history: "his",
  insight: "ins",
  intimidation: "itm",
  investigation: "inv",
  medicine: "med",
  nature: "nat",
  perception: "prc",
  performance: "prf",
  persuasion: "per",
  religion: "rel",
  "sleight-of-hand": "slt",
  stealth: "ste",
  survival: "sur",
};

const TOOL_SHORTCUTS: Record<string, string> = {
  "alchemists-supplies": "alch",
  "brewers-supplies": "brew",
  "calligraphers-supplies": "call",
  "carpenters-tools": "carp",
  "cartographers-tools": "cart",
  "cobblers-tools": "cobb",
  "cooks-utensils": "cook",
  "disguise-kit": "disg",
  "forgery-kit": "forg",
  "glassblowers-tools": "glas",
  "herbalism-kit": "herb",
  "jewelers-tools": "jewl",
  "land-vehicles": "land",
  "leatherworkers-tools": "leat",
  "masons-tools": "maso",
  "navigators-tools": "navg",
  "painters-supplies": "pain",
  "poisoners-kit": "pois",
  "potters-tools": "pott",
  "smiths-tools": "smit",
  "thieves-tools": "thie",
  "tinkers-tools": "tink",
  "water-vehicles": "watr",
  "weavers-tools": "weav",
  "woodcarvers-tools": "wood",
};

const LANGUAGE_SHORTCUTS: Record<string, string> = {
  abyssal: "abyssal",
  celestial: "celestial",
  common: "common",
  // "Deep Speech" — natural English alias maps to Foundry's stem `deep`.
  "deep-speech": "deep",
  deep: "deep",
  draconic: "draconic",
  dwarvish: "dwarvish",
  elvish: "elvish",
  giant: "giant",
  gnomish: "gnomish",
  goblin: "goblin",
  halfling: "halfling",
  infernal: "infernal",
  orc: "orc",
  primordial: "primordial",
  sylvan: "sylvan",
  undercommon: "undercommon",
};

/**
 * Display labels for the reference sheet — keyed by Foundry stem so a
 * single map covers both `deep` and `deep-speech` aliases.
 */
const LANGUAGE_LABELS: Record<string, string> = {
  abyssal: "Abyssal",
  celestial: "Celestial",
  common: "Common",
  deep: "Deep Speech",
  draconic: "Draconic",
  dwarvish: "Dwarvish",
  elvish: "Elvish",
  giant: "Giant",
  gnomish: "Gnomish",
  goblin: "Goblin",
  halfling: "Halfling",
  infernal: "Infernal",
  orc: "Orc",
  primordial: "Primordial",
  sylvan: "Sylvan",
  undercommon: "Undercommon",
};

const SKILL_LABELS: Record<string, string> = {
  acrobatics: "Acrobatics",
  "animal-handling": "Animal Handling",
  arcana: "Arcana",
  athletics: "Athletics",
  deception: "Deception",
  history: "History",
  insight: "Insight",
  intimidation: "Intimidation",
  investigation: "Investigation",
  medicine: "Medicine",
  nature: "Nature",
  perception: "Perception",
  performance: "Performance",
  persuasion: "Persuasion",
  religion: "Religion",
  "sleight-of-hand": "Sleight of Hand",
  stealth: "Stealth",
  survival: "Survival",
};

const TOOL_LABELS: Record<string, string> = {
  "alchemists-supplies": "Alchemist's Supplies",
  "brewers-supplies": "Brewer's Supplies",
  "calligraphers-supplies": "Calligrapher's Supplies",
  "carpenters-tools": "Carpenter's Tools",
  "cartographers-tools": "Cartographer's Tools",
  "cobblers-tools": "Cobbler's Tools",
  "cooks-utensils": "Cook's Utensils",
  "disguise-kit": "Disguise Kit",
  "forgery-kit": "Forgery Kit",
  "glassblowers-tools": "Glassblower's Tools",
  "herbalism-kit": "Herbalism Kit",
  "jewelers-tools": "Jeweler's Tools",
  "land-vehicles": "Land Vehicles",
  "leatherworkers-tools": "Leatherworker's Tools",
  "masons-tools": "Mason's Tools",
  "navigators-tools": "Navigator's Tools",
  "painters-supplies": "Painter's Supplies",
  "poisoners-kit": "Poisoner's Kit",
  "potters-tools": "Potter's Tools",
  "smiths-tools": "Smith's Tools",
  "thieves-tools": "Thieves' Tools",
  "tinkers-tools": "Tinker's Tools",
  "water-vehicles": "Water Vehicles",
  "weavers-tools": "Weaver's Tools",
  "woodcarvers-tools": "Woodcarver's Tools",
};

// ─── Scalar regex ────────────────────────────────────────────────────
//
// Build the SCALAR_REFERENCE_PATTERN from the constants above so adding
// a new skill / tool / language only requires editing one place. The
// negative lookahead `(?![a-z0-9.-])` on each shorthand alternative
// prevents partial matches into longer tokens — `@stealth` must not
// be matched inside `@stealthy` or `@stealth.foo`.

function buildAlternation(keys: string[]): string {
  return keys.map((k) => k.replace(/-/g, "\\-")).join("|");
}

const SHORT_ABILITY_ALTERNATION = "(?:str|dex|con|int|wis|cha)\\.(?:score|mod)";
const SKILL_ALTERNATION = buildAlternation(Object.keys(SKILL_SHORTCUTS));
const TOOL_ALTERNATION = buildAlternation(Object.keys(TOOL_SHORTCUTS));
const LANGUAGE_ALTERNATION = buildAlternation(Object.keys(LANGUAGE_SHORTCUTS));

const SCALAR_REFERENCE_PATTERN = new RegExp(
  "@(?:" +
    "prof(?:\\.(?:term|flat|dice|multiplier))?" +
    "|level" +
    "|ability\\.(?:str|dex|con|int|wis|cha)\\.(?:score|mod)" +
    "|" + SHORT_ABILITY_ALTERNATION + "(?![a-z0-9.-])" +
    "|attr\\.hp\\.(?:value|max|temp|tempmax)" +
    "|class\\.[a-z0-9-]+\\.(?:level|tier|hit-die|hit-die-faces|hit-die-number)" +
    "|subclass\\.[a-z0-9-]+\\.level" +
    "|scale\\.[a-z0-9-]+\\.[a-z0-9-]+(?:\\.(?:number|die|faces|denom))?" +
    "|(?:" + SKILL_ALTERNATION + ")(?![a-z0-9.-])" +
    "|(?:" + TOOL_ALTERNATION + ")(?![a-z0-9.-])" +
    "|(?:" + LANGUAGE_ALTERNATION + ")(?![a-z0-9.-])" +
  ")",
  "gi",
);

export function slugifyReferenceSegment(value: string | undefined | null): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeSemanticReferenceText(
  value: string | undefined | null,
  mode: ReferenceMode = "formula",
  context?: ReferenceContext,
): string {
  let normalized = String(value ?? "").replace(SCALAR_REFERENCE_PATTERN, (match) => {
    const resolved = resolveScalarReference(match, mode);
    return resolved ?? match;
  });

  // Class-column shorthand — context-dependent, runs after the scalar
  // pass so global tokens (skills / tools / languages / abilities) win
  // over class-local column names. Only activates when we have BOTH a
  // class identifier AND a list of known columns for it; otherwise we
  // never speculate about what `@<slug>` might mean. The user has to
  // use the full `@scale.<class>.<col>` form outside the class context.
  if (context?.classIdentifier && context.classColumns?.length) {
    normalized = applyClassColumnShorthand(normalized, mode, context);
  }

  return normalized;
}

export function normalizeSpellFormulaShortcuts(
  value: string | undefined | null,
  context: ReferenceContext = {},
): string {
  const { classIdentifier, spellcastingAbility } = getReferenceIdentifiers(context);
  let normalized = String(value ?? "");

  // Word boundary (`\b`) on every shortcut. Without it `/@level/giu` would
  // match the `@level` substring inside `@levels` (or someone typing
  // Foundry's plural `@classes.x.levels` half-remembered as `@levels`),
  // producing `@classes.druid.levelss`. Same hazard for `@mod` inside
  // `@module`/`@modifier`, `@value` inside `@values`, etc. Foundry-native
  // input like `@abilities.wis.mod` and `@classes.druid.levels` is also
  // safe: the `@` in those strings is followed by `abilities`/`classes`,
  // so the shortcut prefix never matches in the first place.
  // Order: longer prefixes first (`@totalLevel` before `@level`) so the
  // shorter rule can't strip the leading half of the longer token.
  normalized = normalized.replace(/@totallevel\b/giu, "@details.level");
  normalized = normalized.replace(/@level\b/giu, `@classes.${classIdentifier}.levels`);
  normalized = normalized.replace(
    /@mod\b/giu,
    `@abilities.${spellcastingAbility}.mod`,
  );
  normalized = normalized.replace(
    /@value\b/giu,
    `@abilities.${spellcastingAbility}.value`,
  );
  // `@prof` is Foundry-native already — no rewrite needed. (Previously
  // a no-op `@prof` → `@prof` replacement lived here.)

  return normalized;
}

function applyClassColumnShorthand(
  value: string,
  mode: ReferenceMode,
  context: ReferenceContext,
): string {
  const classIdentifier = slugifyReferenceSegment(context.classIdentifier) || "";
  if (!classIdentifier) return value;

  // Build the set of valid column identifiers for THIS class. Anything
  // not in this set is left alone (an unknown `@foo` may be a typo, a
  // future shortcut, or content we shouldn't touch — better to no-op
  // than to silently rewrite into a nonexistent scale path).
  const validColumns = new Set<string>();
  for (const column of context.classColumns ?? []) {
    const slug = getColumnIdentifier(column);
    if (slug) validColumns.add(slug);
  }
  if (!validColumns.size) return value;

  // Same negative-lookahead discipline as the scalar regex: don't
  // partial-match `@cantrip-damage-bonus` as `@cantrip-damage`.
  const pattern = /@([a-z][a-z0-9-]*)(?![a-z0-9.-])/gi;
  return value.replace(pattern, (match, slug) => {
    const normalized = String(slug).toLowerCase();
    if (!validColumns.has(normalized)) return match;
    return formatForMode(`@scale.${classIdentifier}.${normalized}`, mode);
  });
}

function resolveScalarReference(reference: string, mode: ReferenceMode): string | null {
  const ref = reference.trim().toLowerCase();

  if (ref === "@prof") return formatForMode("@prof", mode);
  if (ref === "@prof.term") return formatForMode("@prof.term", mode);
  if (ref === "@prof.flat") return formatForMode("@prof.flat", mode);
  if (ref === "@prof.dice") return formatForMode("@prof.dice", mode);
  if (ref === "@prof.multiplier") return formatForMode("@prof.multiplier", mode);
  if (ref === "@level") return formatForMode("@details.level", mode);

  let match = /^@ability\.(str|dex|con|int|wis|cha)\.(score|mod)$/u.exec(ref);
  if (match) {
    const [, ability, property] = match;
    return formatForMode(
      property === "score" ? `@abilities.${ability}.value` : `@abilities.${ability}.mod`,
      mode,
    );
  }

  // Short ability form: `@str.mod` / `@str.score`. Same Foundry target
  // as the long `@ability.X.Y` form above — both authoring shapes are
  // supported so existing content keeps working.
  match = /^@(str|dex|con|int|wis|cha)\.(score|mod)$/u.exec(ref);
  if (match) {
    const [, ability, property] = match;
    return formatForMode(
      property === "score" ? `@abilities.${ability}.value` : `@abilities.${ability}.mod`,
      mode,
    );
  }

  match = /^@attr\.hp\.(value|max|temp|tempmax)$/u.exec(ref);
  if (match) {
    return formatForMode(`@attributes.hp.${match[1]}`, mode);
  }

  match = /^@class\.([a-z0-9-]+)\.(level|tier|hit-die|hit-die-faces|hit-die-number)$/u.exec(ref);
  if (match) {
    const [, classIdentifier, property] = match;
    switch (property) {
      case "level":
        return formatForMode(`@classes.${classIdentifier}.levels`, mode);
      case "tier":
        return formatForMode(`@classes.${classIdentifier}.tier`, mode);
      case "hit-die":
        return formatForMode(`@classes.${classIdentifier}.hd.denomination`, mode);
      case "hit-die-faces":
        return null;
      case "hit-die-number":
        return "1";
      default:
        return null;
    }
  }

  match = /^@subclass\.([a-z0-9-]+)\.level$/u.exec(ref);
  if (match) {
    return formatForMode(`@subclasses.${match[1]}.levels`, mode);
  }

  match = /^@scale\.([a-z0-9-]+)\.([a-z0-9-]+)(?:\.(number|die|faces|denom))?$/u.exec(ref);
  if (match) {
    const [, parentIdentifier, scaleIdentifier, suffix] = match;
    const next = `@scale.${parentIdentifier}.${scaleIdentifier}${suffix ? `.${suffix}` : ""}`;
    return formatForMode(next, mode);
  }

  // Bare-name shortcuts — skills, tools, languages. These all collapse
  // to a single Foundry path with no parameters, so the regex matched
  // the full token and we just need to look it up.
  const bare = ref.replace(/^@/, "");
  if (Object.prototype.hasOwnProperty.call(SKILL_SHORTCUTS, bare)) {
    return formatForMode(`@skills.${SKILL_SHORTCUTS[bare]}.total`, mode);
  }
  if (Object.prototype.hasOwnProperty.call(TOOL_SHORTCUTS, bare)) {
    return formatForMode(`@tools.${TOOL_SHORTCUTS[bare]}.total`, mode);
  }
  if (Object.prototype.hasOwnProperty.call(LANGUAGE_SHORTCUTS, bare)) {
    return formatForMode(`@traits.languages.value.${LANGUAGE_SHORTCUTS[bare]}`, mode);
  }

  return null;
}

function formatForMode(value: string, mode: ReferenceMode): string {
  if (mode === "text" && value.startsWith("@")) {
    return `[[lookup ${value}]]`;
  }
  return value;
}

export function buildReferenceExamples(context: ReferenceContext = {}): ReferenceExample[] {
  const { classIdentifier, subclassIdentifier, spellcastingAbility, scaleIdentifier } =
    getReferenceIdentifiers(context);

  return [
    {
      label: "Proficiency Bonus",
      semantic: "@prof",
      native: "@prof",
      description: "Actor proficiency bonus.",
    },
    {
      label: "Total Character Level",
      semantic: "@level",
      native: "@details.level",
      description: "Overall character level, not a specific class level.",
    },
    {
      label: `${spellcastingAbility.toUpperCase()} Modifier`,
      semantic: `@${spellcastingAbility}.mod`,
      native: `@abilities.${spellcastingAbility}.mod`,
      description: "Short form. Best default for spellcasting ability modifiers and limited uses.",
    },
    {
      label: "Ability Score",
      semantic: "@int.score",
      native: "@abilities.int.value",
      description: "Raw score instead of modifier. (Long form `@ability.int.score` also accepted.)",
    },
    {
      label: "Current HP",
      semantic: "@attr.hp.value",
      native: "@attributes.hp.value",
      description: "Current hit point value.",
    },
    {
      label: "Max HP",
      semantic: "@attr.hp.max",
      native: "@attributes.hp.max",
      description: "Maximum hit point value.",
    },
    {
      label: "Class Level",
      semantic: `@class.${classIdentifier}.level`,
      native: `@classes.${classIdentifier}.levels`,
      description: "Level in one specific class.",
    },
    {
      label: "Subclass Level",
      semantic: `@subclass.${subclassIdentifier}.level`,
      native: `@subclasses.${subclassIdentifier}.levels`,
      description: "Level reference for a subclass identifier.",
    },
    {
      label: "Class Scale",
      semantic: `@scale.${classIdentifier}.${scaleIdentifier}`,
      native: `@scale.${classIdentifier}.${scaleIdentifier}`,
      description: "ScaleValue-driven progression like sorcery points or cantrips known.",
    },
  ];
}

export function buildSpellFormulaShortcutRows(
  context: ReferenceContext = {},
): SpellFormulaShortcutRow[] {
  const { classIdentifier, spellcastingAbility } = getReferenceIdentifiers(context);

  return [
    {
      label: "Class Level",
      authoring: "@level",
      preview: `@classes.${classIdentifier}.levels`,
      description: "Current level in this class for spellcasting progression.",
    },
    {
      label: "Total Level",
      authoring: "@totalLevel",
      preview: "@details.level",
      description: "Overall character level across all classes.",
    },
    {
      label: "Proficiency",
      authoring: "@prof",
      preview: "@prof",
      description: "Current proficiency bonus.",
    },
    {
      label: "Chosen Ability Mod",
      authoring: "@mod",
      preview: `@abilities.${spellcastingAbility}.mod`,
      description: "Uses the modifier for the ability chosen in the dropdown.",
    },
    {
      label: "Chosen Ability Score",
      authoring: "@value",
      preview: `@abilities.${spellcastingAbility}.value`,
      description: "Uses the raw score for the chosen ability.",
    },
    {
      label: "Math Helpers",
      authoring: "min(), floor(), ceil()",
      preview: "min(), floor(), ceil()",
      description: "Useful for formulas like half-caster rounding or minimum thresholds.",
    },
  ];
}

export function buildReferenceSheetSections(
  context: ReferenceContext = {},
): ReferenceSheetSection[] {
  const {
    classIdentifier,
    subclassIdentifier,
    scaleIdentifier,
  } = getReferenceIdentifiers(context);

  const columns = buildClassColumnRows(context.classColumns || [], classIdentifier);
  const columnHasShorthand = Boolean(context.classIdentifier && context.classColumns?.length);

  return [
    {
      id: "core",
      title: "Core Information",
      description:
        "Use these for character-wide values and class identity. Class references should key by stable identifier, not the display name shown on a sheet.",
      rows: [
        {
          label: "Proficiency Bonus",
          authoring: "@prof",
          foundry: "@prof",
        },
        {
          label: "Total Character Level",
          authoring: "@level",
          foundry: "@details.level",
        },
        {
          label: "Current Class Level",
          authoring: `@class.${classIdentifier}.level`,
          foundry: `@classes.${classIdentifier}.levels`,
        },
        {
          label: "Current Subclass Level",
          authoring: `@subclass.${subclassIdentifier}.level`,
          foundry: `@subclasses.${subclassIdentifier}.levels`,
        },
        {
          label: "Current HP",
          authoring: "@attr.hp.value",
          foundry: "@attributes.hp.value",
        },
        {
          label: "Max HP",
          authoring: "@attr.hp.max",
          foundry: "@attributes.hp.max",
        },
        {
          label: "Class Hit Die",
          authoring: `@class.${classIdentifier}.hit-die`,
          foundry: `@classes.${classIdentifier}.hd.denomination`,
        },
        {
          label: "Spell Save DC",
          authoring: "@attributes.spell.dc",
          foundry: "@attributes.spell.dc",
        },
        {
          label: "Spell Attack",
          authoring: "@attributes.spell.attack",
          foundry: "@attributes.spell.attack",
        },
        {
          label: "Spellcasting Modifier",
          authoring: `@spell.mod`,
          foundry: `@attributes.spell.mod`,
        },
      ],
      notes: [
        "If two classes share the same display name, references must still use the stable identifier or semantic source id.",
      ],
    },
    {
      id: "attributes",
      title: "Attributes",
      description:
        "Short form drops the `ability.` prefix entirely. Replace [ATTR] with the 3-letter ability identifier (str, dex, con, int, wis, cha).",
      rows: [
        {
          label: "Ability Score",
          authoring: "@[ATTR].score",
          foundry: "@abilities.[ATTR].value",
        },
        {
          label: "Ability Modifier",
          authoring: "@[ATTR].mod",
          foundry: "@abilities.[ATTR].mod",
        },
        {
          label: "Armor Class",
          authoring: "@attributes.ac.value",
          foundry: "@attributes.ac.value",
        },
        {
          label: "Natural Armor",
          authoring: "@attributes.ac.base",
          foundry: "@attributes.ac.base",
        },
      ],
      notes: [
        "Long form `@ability.[ATTR].mod` / `@ability.[ATTR].score` is still accepted for existing content.",
      ],
    },
    {
      id: "skills",
      title: "Skills",
      description:
        "Type the skill name. The exporter translates to Foundry's 3-letter code automatically.",
      isDropdown: true,
      isSplit: true,
      rows: Object.keys(SKILL_SHORTCUTS).map((slug) => ({
        label: SKILL_LABELS[slug] || slug,
        authoring: `@${slug}`,
        foundry: `@skills.${SKILL_SHORTCUTS[slug]}.total`,
      })),
    },
    {
      id: "tools",
      title: "Tools",
      description:
        "Type the tool's slug (drop the apostrophe). The exporter maps to Foundry's 4-letter code.",
      isDropdown: true,
      isSplit: true,
      rows: Object.keys(TOOL_SHORTCUTS).map((slug) => ({
        label: TOOL_LABELS[slug] || slug,
        authoring: `@${slug}`,
        foundry: `@tools.${TOOL_SHORTCUTS[slug]}.total`,
      })),
    },
    {
      id: "languages",
      title: "Languages",
      description:
        "Type the language name. `@deep-speech` resolves to the same Foundry stem as `@deep`.",
      isDropdown: true,
      isSplit: true,
      rows: Object.keys(LANGUAGE_SHORTCUTS)
        // Hide the bare `deep` alias from the sheet — show `deep-speech`
        // as the canonical row and keep both resolving identically.
        .filter((slug) => slug !== "deep")
        .map((slug) => {
          const stem = LANGUAGE_SHORTCUTS[slug];
          return {
            label: LANGUAGE_LABELS[stem] || stem,
            authoring: `@${slug}`,
            foundry: `@traits.languages.value.${stem}`,
          };
        }),
    },
    {
      id: "features",
      title: "Class Features",
      description:
        "Entity references stay semantic in authoring and become UUID links at import time when matching documents exist. Use the feature / option `identifier` (the stable slug), not the display name.",
      rows: [
        {
          label: "Feature Skeleton",
          authoring: `@feature[identifier]{Display Name}`,
          foundry: "@UUID[Compendium...Item.<id>]{Display Name}",
        },
        {
          label: "Feature Example",
          authoring: `@feature[action-surge]{Action Surge}`,
          foundry: "@UUID[...action-surge...]{Action Surge}",
        },
        {
          label: "Feature Example",
          authoring: `@feature[second-wind]{Second Wind}`,
          foundry: "@UUID[...second-wind...]{Second Wind}",
        },
        {
          label: "Option Skeleton",
          authoring: `@option[identifier]{Display Name}`,
          foundry: "@UUID[Compendium...Item.<id>]{Display Name}",
        },
        {
          label: "Option Example",
          authoring: `@option[distant-spell]{Distant Spell}`,
          foundry: "@UUID[...distant-spell...]{Distant Spell}",
        },
        {
          label: "Option Example",
          authoring: `@option[trip-attack]{Trip Attack}`,
          foundry: "@UUID[...trip-attack...]{Trip Attack}",
        },
      ],
      notes: [
        "Examples pulled from live data: Action Surge / Second Wind (Fighter features), Distant Spell (Sorcerer metamagic), Trip Attack (Battle Master maneuver).",
        "Do not author raw world UUIDs or embedded actor item ids directly in Dauligor source text.",
      ],
    },
    {
      id: "columns",
      title: "Class Columns",
      description: columnHasShorthand
        ? `Inside this class you can use the column identifier directly. Outside the class (e.g. a feat referencing another class's column) use the full \`@scale.<class>.<column>\` form to avoid identifier collisions.`
        : "Reference a class scale column. Use the column's stable identifier, not its display label.",
      rows: columns.length > 0
        ? columns
        : buildDefaultClassColumnRows(classIdentifier, scaleIdentifier, columnHasShorthand),
      notes: [
        "The displayed column name is for humans. The identifier is what formulas and import normalization should target.",
        ...(columnHasShorthand
          ? ["Shorthand `@<column>` resolves only inside this class. The full form works anywhere."]
          : ["Open this sheet from inside a class editor to see the in-class shorthand form."]),
      ],
    },
  ];
}

function getReferenceIdentifiers(context: ReferenceContext) {
  const classIdentifier = slugifyReferenceSegment(context.classIdentifier || "druid") || "druid";
  const subclassIdentifier =
    slugifyReferenceSegment(context.subclassIdentifier || "moon") || "moon";
  const spellcastingAbility = normalizeAbilityKey(context.spellcastingAbility || "wis");
  const scaleIdentifier =
    slugifyReferenceSegment(context.scaleIdentifier || "sorcery-points") || "sorcery-points";

  return {
    classIdentifier,
    classLabel: context.classLabel || startCaseIdentifier(classIdentifier),
    subclassIdentifier,
    subclassLabel: context.subclassLabel || startCaseIdentifier(subclassIdentifier),
    spellcastingAbility,
    scaleIdentifier,
  };
}

function buildClassColumnRows(
  columns: ReferenceColumnExample[],
  classIdentifier: string,
): ReferenceSheetRow[] {
  return columns
    .map((column) => {
      const identifier = getColumnIdentifier(column);
      if (!identifier) return null;
      const displayName = String(column.name || identifier).trim() || identifier;
      return {
        label: displayName,
        // In-class shorthand for the "Dauligor" column; full form for
        // "Foundry" so the sheet shows both — the author sees the
        // shorthand they should type AND the canonical path it expands
        // to (handy when copy-pasting into a feat outside this class).
        authoring: `@${identifier}`,
        foundry: `@scale.${classIdentifier}.${identifier}`,
      };
    })
    .filter(Boolean) as ReferenceSheetRow[];
}

function buildDefaultClassColumnRows(
  classIdentifier: string,
  scaleIdentifier: string,
  hasShorthand: boolean,
): ReferenceSheetRow[] {
  const authoringPrefix = hasShorthand
    ? `@${scaleIdentifier}`
    : `@scale.${classIdentifier}.${scaleIdentifier}`;
  return [
    {
      label: "Column Value",
      authoring: authoringPrefix,
      foundry: `@scale.${classIdentifier}.${scaleIdentifier}`,
    },
    {
      label: "Column Number",
      authoring: `${authoringPrefix}.number`,
      foundry: `@scale.${classIdentifier}.${scaleIdentifier}.number`,
    },
    {
      label: "Column Die Faces",
      authoring: `${authoringPrefix}.faces`,
      foundry: `@scale.${classIdentifier}.${scaleIdentifier}.faces`,
    },
  ];
}

function getColumnIdentifier(column: ReferenceColumnExample): string {
  if (column.identifier) return slugifyReferenceSegment(column.identifier);
  if (column.sourceId) return slugifyReferenceSegment(column.sourceId.replace(/^scaling-column-/u, ""));
  return slugifyReferenceSegment(column.name);
}

function startCaseIdentifier(value: string): string {
  return String(value || "")
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function normalizeAbilityKey(value: string | undefined | null): string {
  const key = String(value ?? "").trim().toLowerCase();
  return ABILITY_KEYS.has(key) ? key : "int";
}
