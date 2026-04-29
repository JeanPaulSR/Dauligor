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
  description: string;
}

export interface ReferenceSheetSection {
  id: string;
  title: string;
  description: string;
  rows: ReferenceSheetRow[];
  notes?: string[];
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
          description: "Actor proficiency bonus.",
        },
        {
          label: "Total Character Level",
          authoring: "@level",
          foundry: "@details.level",
          description: "Overall character level across every class.",
        },
        {
          label: "Current Class Level",
          authoring: `@class.${classIdentifier}.level`,
          foundry: `@classes.${classIdentifier}.levels`,
          description: `Uses the stable class identifier for ${classLabel}.`,
        },
        {
          label: "Current Subclass Level",
          authoring: `@subclass.${subclassIdentifier}.level`,
          foundry: `@subclasses.${subclassIdentifier}.levels`,
          description: `Uses the stable subclass identifier for ${subclassLabel}.`,
        },
        {
          label: "Current HP",
          authoring: "@attr.hp.value",
          foundry: "@attributes.hp.value",
          description: "Current hit points.",
        },
        {
          label: "Max HP",
          authoring: "@attr.hp.max",
          foundry: "@attributes.hp.max",
          description: "Maximum hit points.",
        },
        {
          label: "Class Hit Die",
          authoring: `@class.${classIdentifier}.hit-die`,
          foundry: `@classes.${classIdentifier}.hd.denomination`,
          description: "Returns the die denomination such as d8 or d10.",
        },
        {
          label: "Hit Die Faces",
          authoring: `@class.${classIdentifier}.hit-die-faces`,
          foundry: "derived from @classes.<identifier>.hd.denomination",
          description: "Semantic helper for the numeric face count like 8 or 10.",
        },
        {
          label: "Spell Save DC",
          authoring: "@attributes.spell.dc",
          foundry: "@attributes.spell.dc",
          description: "Native Foundry roll-data path. Use directly until a semantic alias is introduced.",
        },
        {
          label: "Spell Attack",
          authoring: "@attributes.spell.attack",
          foundry: "@attributes.spell.attack",
          description: "Native Foundry roll-data path for spell attack bonus.",
        },
        {
          label: `${spellcastingAbility.toUpperCase()} Modifier`,
          authoring: `@ability.${spellcastingAbility}.mod`,
          foundry: `@abilities.${spellcastingAbility}.mod`,
          description: "Default spellcasting and limited-use modifier example.",
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
        "These are the most common ability and attribute references authors will use in formulas and usage fields.",
      rows: [
        ...ABILITY_ORDER.map((ability) => ({
          label: `${ABILITY_LABELS[ability]} Score`,
          authoring: `@ability.${ability}.score`,
          foundry: `@abilities.${ability}.value`,
          description: "Raw ability score.",
        })),
        {
          label: "Dexterity Modifier",
          authoring: "@ability.dex.mod",
          foundry: "@abilities.dex.mod",
          description: "Common initiative, AC, and weapon modifier.",
        },
        {
          label: "Constitution Modifier",
          authoring: "@ability.con.mod",
          foundry: "@abilities.con.mod",
          description: "HP-related and concentration-related modifier.",
        },
        {
          label: "Armor Class",
          authoring: "@attributes.ac.value",
          foundry: "@attributes.ac.value",
          description: "Native Foundry AC path.",
        },
      ],
    },
    {
      id: "skills",
      title: "Skills",
      description:
        "Skill references currently follow Foundry-native roll-data paths. These are safe to display and author directly.",
      rows: [
        {
          label: "Arcana Total",
          authoring: "@skills.arc.total",
          foundry: "@skills.arc.total",
          description: "Total Arcana bonus.",
        },
        {
          label: "Perception Passive",
          authoring: "@skills.prc.passive",
          foundry: "@skills.prc.passive",
          description: "Passive Perception score.",
        },
        {
          label: "Stealth Total",
          authoring: "@skills.ste.total",
          foundry: "@skills.ste.total",
          description: "Total Stealth bonus.",
        },
        {
          label: "Insight Total",
          authoring: "@skills.ins.total",
          foundry: "@skills.ins.total",
          description: "Total Insight bonus.",
        },
        {
          label: "Tool Total",
          authoring: "@tools.thief.total",
          foundry: "@tools.thief.total",
          description: "Native tool total example.",
        },
      ],
    },
    {
      id: "features",
      title: "Class Features",
      description:
        "Entity references should stay semantic in authoring and become UUID links during import when matching documents exist.",
      rows: [
        {
          label: "Class Link",
          authoring: `@class[class-${classIdentifier}]{${classLabel}}`,
          foundry: "@UUID[...]",
          description: "Semantic class link that can become a Foundry UUID link later.",
        },
        {
          label: "Subclass Link",
          authoring: `@subclass[subclass-${subclassIdentifier}]{${subclassLabel}}`,
          foundry: "@UUID[...]",
          description: "Semantic subclass link.",
        },
        {
          label: "Feature Link",
          authoring: "@feature[class-feature-sample]{Feature Name}",
          foundry: "@UUID[...]",
          description: "Use stable semantic source ids for features, not local database ids.",
        },
        {
          label: "Option Link",
          authoring: "@option[class-option-sample]{Option Name}",
          foundry: "@UUID[...]",
          description: "Use for option items such as infusions, invocations, or metamagic choices.",
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
      const parentScope = column.parentType ? `${startCaseIdentifier(column.parentType)} column` : "Class column";
      return {
        label: displayName,
        authoring: `@scale.${classIdentifier}.${identifier}`,
        foundry: `@scale.${classIdentifier}.${identifier}`,
        description: `${parentScope} resolved by identifier "${identifier}", not only by the visible label "${displayName}".`,
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
      description: "Base ScaleValue reference for a class or subclass column.",
    },
    {
      label: "Column Number",
      authoring: `@scale.${classIdentifier}.${scaleIdentifier}.number`,
      foundry: `@scale.${classIdentifier}.${scaleIdentifier}.number`,
      description: "Numeric scale result when the value is number-shaped.",
    },
    {
      label: "Column Die Faces",
      authoring: `@scale.${classIdentifier}.${scaleIdentifier}.faces`,
      foundry: `@scale.${classIdentifier}.${scaleIdentifier}.faces`,
      description: "Die face count for die-based scale columns.",
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
