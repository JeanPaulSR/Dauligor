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

const SCALAR_REFERENCE_PATTERN =
  /@(?:prof(?:\.(?:term|flat|dice|multiplier))?|level|ability\.(?:str|dex|con|int|wis|cha)\.(?:score|mod)|attr\.hp\.(?:value|max|temp|tempmax)|class\.[a-z0-9-]+\.(?:level|tier|hit-die|hit-die-faces|hit-die-number)|subclass\.[a-z0-9-]+\.level|scale\.[a-z0-9-]+\.[a-z0-9-]+(?:\.(?:number|die|faces|denom))?)/gi;

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
): string {
  return String(value ?? "").replace(SCALAR_REFERENCE_PATTERN, (match) => {
    const resolved = resolveScalarReference(match, mode);
    return resolved ?? match;
  });
}

export function normalizeSpellFormulaShortcuts(
  value: string | undefined | null,
  context: ReferenceContext = {},
): string {
  const { classIdentifier, spellcastingAbility } = getReferenceIdentifiers(context);
  let normalized = String(value ?? "");

  normalized = normalized.replace(/@totallevel/giu, "@details.level");
  normalized = normalized.replace(/@level/giu, `@classes.${classIdentifier}.levels`);
  normalized = normalized.replace(
    /@mod/giu,
    `@abilities.${spellcastingAbility}.mod`,
  );
  normalized = normalized.replace(
    /@value/giu,
    `@abilities.${spellcastingAbility}.value`,
  );
  normalized = normalized.replace(/@prof/giu, "@prof");

  return normalized;
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
      semantic: `@ability.${spellcastingAbility}.mod`,
      native: `@abilities.${spellcastingAbility}.mod`,
      description: "Best default for spellcasting ability modifiers and limited uses.",
    },
    {
      label: "Ability Score",
      semantic: "@ability.int.score",
      native: "@abilities.int.value",
      description: "Raw score instead of modifier.",
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
    classLabel,
    subclassIdentifier,
    subclassLabel,
    spellcastingAbility,
    scaleIdentifier,
  } = getReferenceIdentifiers(context);

  const columns = buildClassColumnRows(context.classColumns || [], classIdentifier);

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
        "The following are the reference to each attribute. You can reference the score and modifier to each one with the following formulas. Replace [ATTR] with the 3-letter ability identifier.",
      rows: [
        {
          label: "Ability Identifiers",
          authoring: "str, dex, con, int, wis, cha",
          foundry: "str, dex, con, int, wis, cha",
        },
        {
          label: "Ability Score",
          authoring: "@ability.[ATTR].score",
          foundry: "@abilities.[ATTR].value",
        },
        {
          label: "Ability Modifier",
          authoring: "@ability.[ATTR].mod",
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
    },
    {
      id: "skills",
      title: "Skills",
      description: "Skill references currently follow Foundry-native roll-data paths.",
      isDropdown: true,
      isSplit: true,
      rows: [
        { label: "Acrobatics", authoring: "@skills.acr.total", foundry: "@skills.acr.total" },
        { label: "Animal Handling", authoring: "@skills.ani.total", foundry: "@skills.ani.total" },
        { label: "Arcana", authoring: "@skills.arc.total", foundry: "@skills.arc.total" },
        { label: "Athletics", authoring: "@skills.ath.total", foundry: "@skills.ath.total" },
        { label: "Deception", authoring: "@skills.dec.total", foundry: "@skills.dec.total" },
        { label: "History", authoring: "@skills.his.total", foundry: "@skills.his.total" },
        { label: "Insight", authoring: "@skills.ins.total", foundry: "@skills.ins.total" },
        { label: "Intimidation", authoring: "@skills.itm.total", foundry: "@skills.itm.total" },
        { label: "Investigation", authoring: "@skills.inv.total", foundry: "@skills.inv.total" },
        { label: "Medicine", authoring: "@skills.med.total", foundry: "@skills.med.total" },
        { label: "Nature", authoring: "@skills.nat.total", foundry: "@skills.nat.total" },
        { label: "Perception", authoring: "@skills.prc.total", foundry: "@skills.prc.total" },
        { label: "Performance", authoring: "@skills.prf.total", foundry: "@skills.prf.total" },
        { label: "Persuasion", authoring: "@skills.per.total", foundry: "@skills.per.total" },
        { label: "Religion", authoring: "@skills.rel.total", foundry: "@skills.rel.total" },
        { label: "Sleight of Hand", authoring: "@skills.slt.total", foundry: "@skills.slt.total" },
        { label: "Stealth", authoring: "@skills.ste.total", foundry: "@skills.ste.total" },
        { label: "Survival", authoring: "@skills.sur.total", foundry: "@skills.sur.total" },
      ],
    },
    {
      id: "tools",
      title: "Tools",
      description: "Tool references follow Foundry-native roll-data paths.",
      isDropdown: true,
      isSplit: true,
      rows: [
        { label: "Alchemist's Supplies", authoring: "@tools.alch.total", foundry: "@tools.alch.total" },
        { label: "Brewer's Supplies", authoring: "@tools.brew.total", foundry: "@tools.brew.total" },
        { label: "Calligrapher's Supplies", authoring: "@tools.call.total", foundry: "@tools.call.total" },
        { label: "Carpenter's Tools", authoring: "@tools.carp.total", foundry: "@tools.carp.total" },
        { label: "Cartographer's Tools", authoring: "@tools.cart.total", foundry: "@tools.cart.total" },
        { label: "Cobbler's Tools", authoring: "@tools.cobb.total", foundry: "@tools.cobb.total" },
        { label: "Cook's Utensils", authoring: "@tools.cook.total", foundry: "@tools.cook.total" },
        { label: "Disguise Kit", authoring: "@tools.disg.total", foundry: "@tools.disg.total" },
        { label: "Forgery Kit", authoring: "@tools.forg.total", foundry: "@tools.forg.total" },
        { label: "Glassblower's Tools", authoring: "@tools.glas.total", foundry: "@tools.glas.total" },
        { label: "Herbalism Kit", authoring: "@tools.herb.total", foundry: "@tools.herb.total" },
        { label: "Jeweler's Tools", authoring: "@tools.jewl.total", foundry: "@tools.jewl.total" },
        { label: "Land Vehicles", authoring: "@tools.land.total", foundry: "@tools.land.total" },
        { label: "Leatherworker's Tools", authoring: "@tools.leat.total", foundry: "@tools.leat.total" },
        { label: "Mason's Tools", authoring: "@tools.maso.total", foundry: "@tools.maso.total" },
        { label: "Navigator's Tools", authoring: "@tools.navg.total", foundry: "@tools.navg.total" },
        { label: "Painter's Supplies", authoring: "@tools.pain.total", foundry: "@tools.pain.total" },
        { label: "Poisoner's Kit", authoring: "@tools.pois.total", foundry: "@tools.pois.total" },
        { label: "Potter's Tools", authoring: "@tools.pott.total", foundry: "@tools.pott.total" },
        { label: "Smith's Tools", authoring: "@tools.smit.total", foundry: "@tools.smit.total" },
        { label: "Thieves' Tools", authoring: "@tools.thie.total", foundry: "@tools.thie.total" },
        { label: "Tinker's Tools", authoring: "@tools.tink.total", foundry: "@tools.tink.total" },
        { label: "Water Vehicles", authoring: "@tools.watr.total", foundry: "@tools.watr.total" },
        { label: "Weaver's Tools", authoring: "@tools.weav.total", foundry: "@tools.weav.total" },
        { label: "Woodcarver's Tools", authoring: "@tools.wood.total", foundry: "@tools.wood.total" },
      ],
    },
    {
      id: "languages",
      title: "Languages",
      description: "Language knowledge references.",
      isDropdown: true,
      isSplit: true,
      rows: [
        { label: "Abyssal", authoring: "@traits.languages.value.abyssal", foundry: "@traits.languages.value.abyssal" },
        { label: "Celestial", authoring: "@traits.languages.value.celestial", foundry: "@traits.languages.value.celestial" },
        { label: "Common", authoring: "@traits.languages.value.common", foundry: "@traits.languages.value.common" },
        { label: "Deep Speech", authoring: "@traits.languages.value.deep", foundry: "@traits.languages.value.deep" },
        { label: "Draconic", authoring: "@traits.languages.value.draconic", foundry: "@traits.languages.value.draconic" },
        { label: "Dwarvish", authoring: "@traits.languages.value.dwarvish", foundry: "@traits.languages.value.dwarvish" },
        { label: "Elvish", authoring: "@traits.languages.value.elvish", foundry: "@traits.languages.value.elvish" },
        { label: "Giant", authoring: "@traits.languages.value.giant", foundry: "@traits.languages.value.giant" },
        { label: "Gnomish", authoring: "@traits.languages.value.gnomish", foundry: "@traits.languages.value.gnomish" },
        { label: "Goblin", authoring: "@traits.languages.value.goblin", foundry: "@traits.languages.value.goblin" },
        { label: "Halfling", authoring: "@traits.languages.value.halfling", foundry: "@traits.languages.value.halfling" },
        { label: "Infernal", authoring: "@traits.languages.value.infernal", foundry: "@traits.languages.value.infernal" },
        { label: "Orc", authoring: "@traits.languages.value.orc", foundry: "@traits.languages.value.orc" },
        { label: "Primordial", authoring: "@traits.languages.value.primordial", foundry: "@traits.languages.value.primordial" },
        { label: "Sylvan", authoring: "@traits.languages.value.sylvan", foundry: "@traits.languages.value.sylvan" },
        { label: "Undercommon", authoring: "@traits.languages.value.undercommon", foundry: "@traits.languages.value.undercommon" },
      ],
    },
    {
      id: "features",
      title: "Class Features",
      description:
        "Entity references should stay semantic in authoring and become UUID links during import when matching documents exist.",
      rows: [
        {
          label: "Feature Skeleton",
          authoring: `@feature[identifier]{Name}`,
          foundry: "@UUID[...]",
        },
        {
          label: "Feature Example",
          authoring: `@feature[wild-shape]{Wild Shape}`,
          foundry: "@UUID[...]",
        },
        {
          label: "Option Skeleton",
          authoring: `@option[identifier]{Name}`,
          foundry: "@UUID[...]",
        },
        {
          label: "Option Example",
          authoring: `@option[infusion-enhanced-defense]{Enhanced Defense}`,
          foundry: "@UUID[...]",
        },
      ],
      notes: [
        "Do not author raw world UUIDs or embedded actor item ids directly in Dauligor source text.",
      ],
    },
    {
      id: "columns",
      title: "Class Columns",
      description:
        "Columns should resolve from the linked ScaleValue or scaling identifier, not just the visible column label shown in the UI.",
      rows: columns.length > 0 ? columns : buildDefaultClassColumnRows(classIdentifier, scaleIdentifier),
      notes: [
        "The displayed column name is for humans. The identifier is what formulas and import normalization should target.",
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
        authoring: `@scale.${classIdentifier}.${identifier}`,
        foundry: `@scale.${classIdentifier}.${identifier}`,
      };
    })
    .filter(Boolean) as ReferenceSheetRow[];
}

function buildDefaultClassColumnRows(
  classIdentifier: string,
  scaleIdentifier: string,
): ReferenceSheetRow[] {
  return [
    {
      label: "Column Value",
      authoring: `@scale.${classIdentifier}.${scaleIdentifier}`,
      foundry: `@scale.${classIdentifier}.${scaleIdentifier}`,
    },
    {
      label: "Column Number",
      authoring: `@scale.${classIdentifier}.${scaleIdentifier}.number`,
      foundry: `@scale.${classIdentifier}.${scaleIdentifier}.number`,
    },
    {
      label: "Column Die Faces",
      authoring: `@scale.${classIdentifier}.${scaleIdentifier}.faces`,
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
