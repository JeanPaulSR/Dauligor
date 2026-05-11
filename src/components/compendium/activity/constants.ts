/**
 * Option catalogs for the ActivityEditor and its sub-components.
 *
 * Every option carries a display `label` and an optional `hint`
 * (right-side badge in SingleSelectSearch). Slug values match
 * Foundry's dnd5e key conventions so the export round-trips
 * cleanly; the editor only ever shows labels to the author.
 *
 * Centralised here so each extracted sub-editor
 * (DamagePartEditor, ConsumptionEditor, etc.) can import the same
 * source of truth instead of receiving them as props or copying
 * the arrays.
 */

export const ABILITY_OPTIONS = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;

export const FALLBACK_ABILITY_LABELS: Record<string, string> = {
  str: 'Strength', dex: 'Dexterity', con: 'Constitution',
  int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma',
};

export const SPELL_PROPERTIES = ['vocal', 'somatic', 'material'] as const;

/** Recovery periods, grouped Foundry-style into Rests / Combat /
 *  Mechanical so authors can mentally bucket them. The hint is the
 *  category and renders as the picker's right-side badge. */
export const RECOVERY_PERIOD_OPTIONS: { value: string; label: string; hint: string }[] = [
  { value: 'lr',        label: 'Long Rest',   hint: 'Rests' },
  { value: 'sr',        label: 'Short Rest',  hint: 'Rests' },
  { value: 'day',       label: 'Day',         hint: 'Rests' },
  { value: 'dawn',      label: 'Dawn',        hint: 'Rests' },
  { value: 'dusk',      label: 'Dusk',        hint: 'Rests' },
  { value: 'turn',      label: 'Turn',        hint: 'Combat' },
  { value: 'turnStart', label: 'Turn Start',  hint: 'Combat' },
  { value: 'turnEnd',   label: 'Turn End',    hint: 'Combat' },
  { value: 'round',     label: 'Round',       hint: 'Combat' },
  { value: 'recharge',  label: 'Recharge',    hint: 'Mechanical' },
  { value: 'charges',   label: 'Charges',     hint: 'Mechanical' },
];

export const RECOVERY_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'recoverAll', label: 'Recover All' },
  { value: 'formula',    label: 'Formula' },
  { value: 'loseAll',    label: 'Lose All' },
];

export const TARGET_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'none',     label: 'None' },
  { value: 'self',     label: 'Self' },
  { value: 'creature', label: 'Creature' },
  { value: 'ally',     label: 'Ally' },
  { value: 'enemy',    label: 'Enemy' },
  { value: 'object',   label: 'Object' },
  { value: 'space',    label: 'Space' },
];

export const TEMPLATE_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'none',     label: 'None' },
  { value: 'cone',     label: 'Cone' },
  { value: 'cube',     label: 'Cube' },
  { value: 'cylinder', label: 'Cylinder' },
  { value: 'line',     label: 'Line' },
  { value: 'sphere',   label: 'Sphere' },
  { value: 'square',   label: 'Square' },
];

export const CONSUMPTION_TARGET_TYPES: { value: string; label: string }[] = [
  { value: 'activityUses', label: 'Activity Uses' },
  { value: 'itemUses',     label: 'Item Uses' },
  { value: 'material',     label: 'Material' },
  { value: 'hitDice',      label: 'Hit Dice' },
  { value: 'spellSlots',   label: 'Spell Slots' },
  { value: 'attribute',    label: 'Attribute' },
];

export const DAMAGE_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'acid',        label: 'Acid' },
  { value: 'bludgeoning', label: 'Bludgeoning' },
  { value: 'cold',        label: 'Cold' },
  { value: 'fire',        label: 'Fire' },
  { value: 'force',       label: 'Force' },
  { value: 'lightning',   label: 'Lightning' },
  { value: 'necrotic',    label: 'Necrotic' },
  { value: 'piercing',    label: 'Piercing' },
  { value: 'poison',      label: 'Poison' },
  { value: 'psychic',     label: 'Psychic' },
  { value: 'radiant',     label: 'Radiant' },
  { value: 'slashing',    label: 'Slashing' },
  { value: 'thunder',     label: 'Thunder' },
  { value: 'healing',     label: 'Healing' },
  { value: 'temphp',      label: 'Temp HP' },
];

export const SCALING_MODE_OPTIONS: { value: string; label: string }[] = [
  { value: '',      label: 'Off (no scaling)' },
  { value: 'whole', label: 'Whole Dice' },
  { value: 'half',  label: 'Half Dice' },
];

/** Damage-part scaling mode labels read more naturally as "Every Level"
 *  / "Every Other Level" inside the part editor where the context is a
 *  level-up cadence. Keep both in sync — slug values match. */
export const DAMAGE_SCALING_MODE_OPTIONS: { value: string; label: string }[] = [
  { value: '',      label: 'None' },
  { value: 'whole', label: 'Every Level' },
  { value: 'half',  label: 'Every Other Level' },
];

export const SUMMON_OR_TRANSFORM_MODE_OPTIONS: { value: string; label: string }[] = [
  { value: '',   label: 'Direct (level-based)' },
  { value: 'cr', label: 'Challenge Rating' },
];

export const MOVEMENT_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'walk',   label: 'Walk' },
  { value: 'burrow', label: 'Burrow' },
  { value: 'climb',  label: 'Climb' },
  { value: 'fly',    label: 'Fly' },
  { value: 'swim',   label: 'Swim' },
];

export const CREATURE_SIZE_OPTIONS: { value: string; label: string }[] = [
  { value: 'tiny', label: 'Tiny' },
  { value: 'sm',   label: 'Small' },
  { value: 'med',  label: 'Medium' },
  { value: 'lg',   label: 'Large' },
  { value: 'huge', label: 'Huge' },
  { value: 'grg',  label: 'Gargantuan' },
];

export const CREATURE_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'aberration',  label: 'Aberration' },
  { value: 'beast',       label: 'Beast' },
  { value: 'celestial',   label: 'Celestial' },
  { value: 'construct',   label: 'Construct' },
  { value: 'dragon',      label: 'Dragon' },
  { value: 'elemental',   label: 'Elemental' },
  { value: 'fey',         label: 'Fey' },
  { value: 'fiend',       label: 'Fiend' },
  { value: 'giant',       label: 'Giant' },
  { value: 'humanoid',    label: 'Humanoid' },
  { value: 'monstrosity', label: 'Monstrosity' },
  { value: 'ooze',        label: 'Ooze' },
  { value: 'plant',       label: 'Plant' },
  { value: 'undead',      label: 'Undead' },
];

export const DAMAGE_DIE_DENOMINATIONS = [4, 6, 8, 10, 12, 20, 100] as const;

export const parseCsv = (value: string) =>
  value.split(',').map(s => s.trim()).filter(Boolean);

export const parseNullableInteger = (value: string): number | null => {
  if (value === '') return null;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
};
