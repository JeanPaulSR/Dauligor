/**
 * Catalog of common Active Effect attribute keys for the dnd5e 5.x
 * system on Foundry v13, plus the flag namespaces added by the canonical
 * automation stack (midi-qol, dae, dnd5e core flags).
 *
 * Why this exists
 * ---------------
 * In Foundry, the Active Effect editor's "Attribute Key" input has an
 * autocomplete fed by the live actor's data model — `Object.keys`
 * walked over `actor.system`, `actor.flags`, etc. We're authoring
 * effects offline (no live actor), so we ship a curated catalog
 * instead. Keys here are the ones authors actually reach for: stat
 * paths that move numbers on the sheet, plus the midi-qol / dnd5e /
 * DAE flag conventions documented at:
 *
 *   - https://github.com/foundryvtt/dnd5e/wiki/Active-Effect-Guide
 *   - https://gitlab.com/tposney/midi-qol/-/blob/master/Readme.md
 *   - https://gitlab.com/tposney/dae#flags
 *
 * The list is intentionally curated — not exhaustive — because an
 * exhaustive list (every nested `system.*` path) would be hundreds of
 * keys long and would drown the genuinely useful ones in noise. Add
 * more here as you find them missing during authoring.
 *
 * Shape
 * -----
 * Each entry is `{ key, label?, description?, category }`. The editor's
 * autocomplete filters by substring match against `key` + `label` +
 * `description`, then groups results by `category` for the visible
 * dropdown.
 */

export type ActiveEffectKeyCategory =
  | 'Abilities'
  | 'Skills'
  | 'Bonuses'
  | 'HP & AC'
  | 'Speed & Senses'
  | 'Spellcasting'
  | 'Resistances'
  | 'Traits'
  | 'Resources'
  | 'Initiative'
  | 'Concentration'
  | 'Death Saves'
  | 'dnd5e Flags'
  | 'Midi-QOL — Advantage'
  | 'Midi-QOL — Disadvantage'
  | 'Midi-QOL — Granted (to attackers)'
  | 'Midi-QOL — Auto-success/fail'
  | 'Midi-QOL — Optional Bonus'
  | 'Midi-QOL — Resistance Tweaks'
  | 'Midi-QOL — Feature Flags'
  | 'DAE — Macros & Specials';

export interface ActiveEffectKeyEntry {
  /** Canonical dot-path written into `changes[].key`. */
  key: string;
  /** Short human label (often the same as the suffix of `key`). */
  label?: string;
  /** One-line description shown under the key in the dropdown. */
  description?: string;
  category: ActiveEffectKeyCategory;
}

// ─── Reference vocab ─────────────────────────────────────────────────────

const ABILITIES = [
  { key: 'str', label: 'Strength' },
  { key: 'dex', label: 'Dexterity' },
  { key: 'con', label: 'Constitution' },
  { key: 'int', label: 'Intelligence' },
  { key: 'wis', label: 'Wisdom' },
  { key: 'cha', label: 'Charisma' },
] as const;

const SKILLS = [
  { key: 'acr', label: 'Acrobatics' },
  { key: 'ani', label: 'Animal Handling' },
  { key: 'arc', label: 'Arcana' },
  { key: 'ath', label: 'Athletics' },
  { key: 'dec', label: 'Deception' },
  { key: 'his', label: 'History' },
  { key: 'ins', label: 'Insight' },
  { key: 'inv', label: 'Investigation' },
  { key: 'itm', label: 'Intimidation' },
  { key: 'med', label: 'Medicine' },
  { key: 'nat', label: 'Nature' },
  { key: 'per', label: 'Persuasion' },
  { key: 'prc', label: 'Perception' },
  { key: 'prf', label: 'Performance' },
  { key: 'pry', label: 'Sleight of Hand (sic; dnd5e uses `slt`)' },
  { key: 'rel', label: 'Religion' },
  { key: 'slt', label: 'Sleight of Hand' },
  { key: 'ste', label: 'Stealth' },
  { key: 'sur', label: 'Survival' },
] as const;

const ATTACK_KINDS = [
  { key: 'mwak', label: 'Melee Weapon' },
  { key: 'rwak', label: 'Ranged Weapon' },
  { key: 'msak', label: 'Melee Spell' },
  { key: 'rsak', label: 'Ranged Spell' },
] as const;

const DAMAGE_TYPES = [
  'acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic',
  'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder',
] as const;

// ─── Catalog assembly ────────────────────────────────────────────────────

const entries: ActiveEffectKeyEntry[] = [];
const push = (e: ActiveEffectKeyEntry) => { entries.push(e); };

// Abilities — value + bonuses + proficiency
for (const { key, label } of ABILITIES) {
  push({ key: `system.abilities.${key}.value`, label: `${label} Score`, description: `Raw ability score for ${label}.`, category: 'Abilities' });
  push({ key: `system.abilities.${key}.bonuses.check`, label: `${label} Check Bonus`, description: `Adds to ${label} ability checks (not skills).`, category: 'Abilities' });
  push({ key: `system.abilities.${key}.bonuses.save`, label: `${label} Save Bonus`, description: `Adds to ${label} saving throws.`, category: 'Abilities' });
  push({ key: `system.abilities.${key}.checkProf.multiplier`, label: `${label} Check Proficiency`, description: '0 = none, 1 = proficient, 2 = expertise.', category: 'Abilities' });
  push({ key: `system.abilities.${key}.saveProf.multiplier`, label: `${label} Save Proficiency`, description: '0 = none, 1 = proficient.', category: 'Abilities' });
}
push({ key: 'system.bonuses.abilities.check', label: 'All Ability Check Bonus', description: 'Adds to every ability check.', category: 'Bonuses' });
push({ key: 'system.bonuses.abilities.save', label: 'All Saving Throw Bonus', description: 'Adds to every saving throw.', category: 'Bonuses' });
push({ key: 'system.bonuses.abilities.skill', label: 'All Skill Bonus', description: 'Adds to every skill check.', category: 'Bonuses' });

// Skills — check + passive bonuses + proficiency
for (const { key, label } of SKILLS) {
  if (key === 'pry') continue; // legacy alias; canonical is `slt`
  push({ key: `system.skills.${key}.bonuses.check`, label: `${label} Bonus`, description: `Adds to ${label} skill checks.`, category: 'Skills' });
  push({ key: `system.skills.${key}.bonuses.passive`, label: `Passive ${label} Bonus`, description: `Adds to passive ${label}.`, category: 'Skills' });
  push({ key: `system.skills.${key}.value`, label: `${label} Proficiency`, description: '0 = none, 0.5 = half, 1 = prof, 2 = expertise.', category: 'Skills' });
}

// Attack bonuses
for (const { key, label } of ATTACK_KINDS) {
  push({ key: `system.bonuses.${key}.attack`, label: `${label} Attack Bonus`, description: `Adds to ${label.toLowerCase()} attack rolls.`, category: 'Bonuses' });
  push({ key: `system.bonuses.${key}.damage`, label: `${label} Damage Bonus`, description: `Adds to ${label.toLowerCase()} damage rolls.`, category: 'Bonuses' });
}
push({ key: 'system.bonuses.spell.dc', label: 'Spell DC Bonus', description: 'Adds to all spell save DCs.', category: 'Bonuses' });

// HP & AC
push({ key: 'system.attributes.hp.max', label: 'Max HP', description: 'Sets/adds to maximum hit points.', category: 'HP & AC' });
push({ key: 'system.attributes.hp.tempmax', label: 'Temporary Max HP', description: 'Temporary bonus to the HP cap (e.g. Aid, Heroes\' Feast).', category: 'HP & AC' });
push({ key: 'system.attributes.hp.temp', label: 'Temporary HP', description: 'Temp HP pool (does not stack — Override only).', category: 'HP & AC' });
push({ key: 'system.attributes.hp.bonuses.level', label: 'HP Per-Level Bonus', description: 'Bonus HP gained per character level.', category: 'HP & AC' });
push({ key: 'system.attributes.hp.bonuses.overall', label: 'HP Total Bonus', description: 'Flat bonus added to overall HP.', category: 'HP & AC' });
push({ key: 'system.attributes.ac.bonus', label: 'AC Bonus', description: 'Flat numeric bonus to AC (most common AC effect).', category: 'HP & AC' });
push({ key: 'system.attributes.ac.flat', label: 'AC Flat Override', description: 'Sets AC to a flat value, ignoring formula.', category: 'HP & AC' });
push({ key: 'system.attributes.ac.calc', label: 'AC Calculation', description: '"flat", "natural", "default", "draconic", "mage", "unarmoredMonk", "unarmoredBarb", "custom".', category: 'HP & AC' });
push({ key: 'system.attributes.ac.formula', label: 'AC Custom Formula', description: 'Roll formula for AC when calc = "custom".', category: 'HP & AC' });
push({ key: 'system.attributes.ac.cover', label: 'Cover Bonus', description: 'Numeric cover bonus (e.g. +2 for half cover).', category: 'HP & AC' });

// Initiative
push({ key: 'system.attributes.init.bonus', label: 'Initiative Bonus', description: 'Adds to initiative rolls.', category: 'Initiative' });
push({ key: 'system.attributes.init.ability', label: 'Initiative Ability', description: 'Three-letter key (e.g. "dex"); overrides default.', category: 'Initiative' });

// Speed & Senses
const SPEED_KINDS = ['walk', 'fly', 'swim', 'climb', 'burrow'] as const;
for (const m of SPEED_KINDS) {
  push({ key: `system.attributes.movement.${m}`, label: `${m[0].toUpperCase()}${m.slice(1)} Speed`, description: `${m} movement in feet (or system units).`, category: 'Speed & Senses' });
}
push({ key: 'system.attributes.movement.hover', label: 'Hover', description: 'Boolean — sets the fly-speed hover flag.', category: 'Speed & Senses' });
push({ key: 'system.attributes.movement.units', label: 'Speed Units', description: '"ft", "mi", "m", or "km".', category: 'Speed & Senses' });
const SENSES = ['darkvision', 'blindsight', 'tremorsense', 'truesight'] as const;
for (const s of SENSES) {
  push({ key: `system.attributes.senses.${s}`, label: `${s[0].toUpperCase()}${s.slice(1)}`, description: `${s} radius in feet.`, category: 'Speed & Senses' });
}
push({ key: 'system.attributes.senses.special', label: 'Special Senses', description: 'Free-text override for the senses tooltip.', category: 'Speed & Senses' });

// Spellcasting
push({ key: 'system.attributes.spellcasting', label: 'Spellcasting Ability', description: 'Three-letter ability key (e.g. "int", "wis", "cha").', category: 'Spellcasting' });
push({ key: 'system.attributes.spelldc', label: 'Spell Save DC', description: 'Overrides the computed spell DC.', category: 'Spellcasting' });
push({ key: 'system.attributes.spellmod', label: 'Spell Attack Mod', description: 'Overrides the computed spell attack modifier.', category: 'Spellcasting' });
for (let n = 1; n <= 9; n++) {
  push({ key: `system.spells.spell${n}.override`, label: `Lvl ${n} Spell Slots Override`, description: `Sets max ${n}-level slots regardless of class progression.`, category: 'Spellcasting' });
}
push({ key: 'system.spells.pact.override', label: 'Pact Slots Override', description: 'Overrides Warlock pact-slot count.', category: 'Spellcasting' });
push({ key: 'system.spells.pact.level', label: 'Pact Slot Level Override', description: 'Overrides Warlock pact-slot level (1–5).', category: 'Spellcasting' });

// Resistances (damage immunities / resistances / vulnerabilities / condition immunities)
push({ key: 'system.traits.di.value', label: 'Damage Immunities', description: 'Array of damage-type keys (e.g. ["fire","poison"]).', category: 'Resistances' });
push({ key: 'system.traits.dr.value', label: 'Damage Resistances', description: 'Array of damage-type keys.', category: 'Resistances' });
push({ key: 'system.traits.dv.value', label: 'Damage Vulnerabilities', description: 'Array of damage-type keys.', category: 'Resistances' });
push({ key: 'system.traits.ci.value', label: 'Condition Immunities', description: 'Array of condition keys (e.g. ["frightened","charmed"]).', category: 'Resistances' });
push({ key: 'system.traits.di.bypasses', label: 'Bypasses Immunity', description: 'Array of weapon properties that pierce immunity (e.g. ["mgc","sil"]).', category: 'Resistances' });
push({ key: 'system.traits.dr.bypasses', label: 'Bypasses Resistance', description: 'Same as bypasses Immunity but for resistance.', category: 'Resistances' });

// Traits (size, alignment, languages)
push({ key: 'system.traits.size', label: 'Creature Size', description: '"tiny","sm","med","lg","huge","grg".', category: 'Traits' });
push({ key: 'system.traits.languages.value', label: 'Languages', description: 'Array of language keys.', category: 'Traits' });
push({ key: 'system.traits.weaponProf.value', label: 'Weapon Proficiencies', description: 'Array of weapon-prof keys (e.g. ["sim","mar"] or specific weapon ids).', category: 'Traits' });
push({ key: 'system.traits.armorProf.value', label: 'Armor Proficiencies', description: 'Array of armor-prof keys (e.g. ["lgt","med","hvy","shl"]).', category: 'Traits' });
push({ key: 'system.traits.toolProf.value', label: 'Tool Proficiencies', description: 'Array of tool-prof keys.', category: 'Traits' });

// Resources
for (const slot of ['primary', 'secondary', 'tertiary'] as const) {
  push({ key: `system.resources.${slot}.value`, label: `${slot[0].toUpperCase()}${slot.slice(1)} Resource`, description: 'Current value.', category: 'Resources' });
  push({ key: `system.resources.${slot}.max`, label: `${slot[0].toUpperCase()}${slot.slice(1)} Resource Max`, description: 'Maximum value.', category: 'Resources' });
}

// Concentration
push({ key: 'system.attributes.concentration.ability', label: 'Concentration Ability', description: 'Three-letter ability key (default "con").', category: 'Concentration' });
push({ key: 'system.attributes.concentration.bonuses.save', label: 'Concentration Save Bonus', description: 'Adds to concentration saves (e.g. War Caster).', category: 'Concentration' });
push({ key: 'system.attributes.concentration.limit', label: 'Concentration Limit', description: 'Max number of simultaneously-concentrated spells (default 1).', category: 'Concentration' });
push({ key: 'system.attributes.concentration.roll.mode', label: 'Concentration Roll Mode', description: '"normal","advantage","disadvantage".', category: 'Concentration' });

// Death saves
push({ key: 'system.attributes.death.bonuses.save', label: 'Death Save Bonus', description: 'Adds to death-save rolls.', category: 'Death Saves' });

// ─── dnd5e Flags ─────────────────────────────────────────────────────────

const DND5E_FLAGS: Array<[string, string, string]> = [
  ['diamondSoul', 'Diamond Soul', 'Monk 14 — proficient in all saves.'],
  ['elvenAccuracy', 'Elven Accuracy', 'Reroll one attack die on advantage for DEX/INT/WIS/CHA attacks.'],
  ['halflingLucky', 'Halfling Lucky', 'Reroll a natural 1 on attack/check/save.'],
  ['initiativeAdv', 'Initiative Advantage', 'Boolean — sets advantage on initiative.'],
  ['initiativeAlert', 'Alert Feat', 'Boolean — +5 to initiative, can\'t be surprised.'],
  ['jackOfAllTrades', 'Jack of All Trades', 'Half proficiency on non-prof ability checks.'],
  ['observantFeat', 'Observant', '+5 to passive Perception/Investigation.'],
  ['powerfulBuild', 'Powerful Build', 'Counts as one size larger for carrying capacity.'],
  ['reliableTalent', 'Reliable Talent', 'Treat rolls under 10 as 10 for proficient checks.'],
  ['remarkableAthlete', 'Remarkable Athlete', 'Half-round-up proficiency on STR/DEX/CON checks.'],
  ['savageAttacks', 'Savage Attacks', 'Extra weapon damage die on crit.'],
  ['tavernBrawlerFeat', 'Tavern Brawler', 'Unarmed prof + grapple bonus.'],
  ['weaponCriticalThreshold', 'Weapon Crit Threshold', 'Lowest natural die that counts as a weapon crit.'],
  ['spellCriticalThreshold', 'Spell Crit Threshold', 'Lowest natural die that counts as a spell crit.'],
  ['meleeCriticalDamageDice', 'Bonus Melee Crit Dice', 'Extra dice on melee weapon crits (e.g. Brutal Critical).'],
];
for (const [k, label, description] of DND5E_FLAGS) {
  push({ key: `flags.dnd5e.${k}`, label, description, category: 'dnd5e Flags' });
}

// ─── Midi-QOL: Advantage / Disadvantage ──────────────────────────────────
//
// All Midi flag effects use mode = Custom (0) with value = "1" for the
// boolean conditions. Numeric bonus flags (optional.<name>.attack etc.)
// use Override or Add depending on intent.

// Helper: emit a full advantage / disadvantage tree under one namespace.
function pushAdvantageTree(ns: 'advantage' | 'disadvantage') {
  const cat: ActiveEffectKeyCategory =
    ns === 'advantage' ? 'Midi-QOL — Advantage' : 'Midi-QOL — Disadvantage';
  const tagLabel = ns === 'advantage' ? 'Advantage' : 'Disadvantage';

  // Attacks
  push({ key: `flags.midi-qol.${ns}.attack.all`, label: `${tagLabel} on All Attacks`, description: `Custom mode, value "1".`, category: cat });
  for (const { key, label } of ATTACK_KINDS) {
    push({ key: `flags.midi-qol.${ns}.attack.${key}`, label: `${tagLabel} on ${label} Attacks`, description: 'Custom mode, value "1".', category: cat });
  }
  // Per-ability attack (rare)
  for (const { key, label } of ABILITIES) {
    push({ key: `flags.midi-qol.${ns}.attack.${key}`, label: `${tagLabel} on ${label}-based Attacks`, description: 'Custom mode, value "1".', category: cat });
  }

  // Saves / checks / skills — generic + per-ability variants
  push({ key: `flags.midi-qol.${ns}.ability.save.all`, label: `${tagLabel} on All Saving Throws`, description: 'Custom mode, value "1".', category: cat });
  push({ key: `flags.midi-qol.${ns}.ability.check.all`, label: `${tagLabel} on All Ability Checks`, description: 'Custom mode, value "1".', category: cat });
  for (const { key, label } of ABILITIES) {
    push({ key: `flags.midi-qol.${ns}.ability.save.${key}`, label: `${tagLabel} on ${label} Saves`, description: 'Custom mode, value "1".', category: cat });
    push({ key: `flags.midi-qol.${ns}.ability.check.${key}`, label: `${tagLabel} on ${label} Checks`, description: 'Custom mode, value "1".', category: cat });
  }

  push({ key: `flags.midi-qol.${ns}.skill.all`, label: `${tagLabel} on All Skill Checks`, description: 'Custom mode, value "1".', category: cat });
  for (const { key, label } of SKILLS) {
    if (key === 'pry') continue;
    push({ key: `flags.midi-qol.${ns}.skill.${key}`, label: `${tagLabel} on ${label}`, description: 'Custom mode, value "1".', category: cat });
  }

  // Special: death saves, concentration, initiative
  push({ key: `flags.midi-qol.${ns}.deathSave`, label: `${tagLabel} on Death Saves`, description: 'Custom mode, value "1".', category: cat });
  push({ key: `flags.midi-qol.${ns}.concentration`, label: `${tagLabel} on Concentration`, description: 'Custom mode, value "1".', category: cat });
  push({ key: `flags.midi-qol.${ns}.attack.init`, label: `${tagLabel} on Initiative`, description: 'Custom mode, value "1".', category: cat });
}
pushAdvantageTree('advantage');
pushAdvantageTree('disadvantage');

// ─── Midi-QOL: Granted advantage/disadvantage (to attackers) ────────────

// "Attackers have <state> against this actor"
for (const ns of ['advantage', 'disadvantage'] as const) {
  const tag = ns === 'advantage' ? 'Advantage' : 'Disadvantage';
  push({ key: `flags.midi-qol.grants.${ns}.attack.all`, label: `Attackers Have ${tag} on All Attacks`, description: 'Granted to anyone attacking this actor (e.g. Faerie Fire, prone).', category: 'Midi-QOL — Granted (to attackers)' });
  for (const { key, label } of ATTACK_KINDS) {
    push({ key: `flags.midi-qol.grants.${ns}.attack.${key}`, label: `Attackers Have ${tag} on ${label}`, description: 'Granted to attackers of that kind.', category: 'Midi-QOL — Granted (to attackers)' });
  }
  push({ key: `flags.midi-qol.grants.${ns}.ability.save.all`, label: `Targets ${tag === 'Advantage' ? 'Have Adv' : 'Have Disadv'} on Saves Against`, description: 'Saves provoked by this actor.', category: 'Midi-QOL — Granted (to attackers)' });
  push({ key: `flags.midi-qol.grants.${ns}.ability.check.all`, label: `Targets ${tag === 'Advantage' ? 'Have Adv' : 'Have Disadv'} on Checks Against`, description: 'Checks provoked by this actor.', category: 'Midi-QOL — Granted (to attackers)' });
}
push({ key: 'flags.midi-qol.grants.critical.all', label: 'Attackers Always Crit', description: 'Paralyzed-style — any hit auto-crits.', category: 'Midi-QOL — Granted (to attackers)' });
push({ key: 'flags.midi-qol.fail.critical.all', label: 'Attackers Cannot Crit', description: 'Heavy Armor Master-style — crits become normal hits.', category: 'Midi-QOL — Granted (to attackers)' });

// ─── Midi-QOL: Auto-success / Auto-fail ──────────────────────────────────
for (const verb of ['success', 'fail'] as const) {
  const tag = verb === 'success' ? 'Auto-Succeed' : 'Auto-Fail';
  push({ key: `flags.midi-qol.${verb}.ability.save.all`, label: `${tag} All Saves`, description: 'Custom mode, value "1".', category: 'Midi-QOL — Auto-success/fail' });
  for (const { key, label } of ABILITIES) {
    push({ key: `flags.midi-qol.${verb}.ability.save.${key}`, label: `${tag} ${label} Saves`, description: 'Custom mode, value "1".', category: 'Midi-QOL — Auto-success/fail' });
  }
  push({ key: `flags.midi-qol.${verb}.attack.all`, label: `${tag} All Attacks`, description: 'Custom mode, value "1".', category: 'Midi-QOL — Auto-success/fail' });
}

// ─── Midi-QOL: Optional Bonus (Lucky/Bardic Inspiration style) ──────────

// `optional.<name>` is a namespaced "choice" bonus — the player gets a
// prompt to spend a resource for the bonus. <name> is author-defined;
// these entries seed a common shape rather than enumerate every flag.
push({ key: 'flags.midi-qol.optional.NAME.label', label: 'Optional Bonus Label', description: 'Display label for the optional-bonus prompt. NAME is a unique id you choose.', category: 'Midi-QOL — Optional Bonus' });
push({ key: 'flags.midi-qol.optional.NAME.count', label: 'Optional Bonus Count', description: 'How many uses (e.g. "ItemUses.<itemId>" or a number).', category: 'Midi-QOL — Optional Bonus' });
push({ key: 'flags.midi-qol.optional.NAME.attack.all', label: 'Optional Attack Bonus', description: 'Formula added to attack when the player accepts the prompt.', category: 'Midi-QOL — Optional Bonus' });
push({ key: 'flags.midi-qol.optional.NAME.damage.all', label: 'Optional Damage Bonus', description: 'Formula added to damage when the player accepts the prompt.', category: 'Midi-QOL — Optional Bonus' });
push({ key: 'flags.midi-qol.optional.NAME.save.all', label: 'Optional Save Bonus', description: 'Formula added to saving throws.', category: 'Midi-QOL — Optional Bonus' });
push({ key: 'flags.midi-qol.optional.NAME.check.all', label: 'Optional Check Bonus', description: 'Formula added to ability checks.', category: 'Midi-QOL — Optional Bonus' });
push({ key: 'flags.midi-qol.optional.NAME.skill.all', label: 'Optional Skill Bonus', description: 'Formula added to skill checks.', category: 'Midi-QOL — Optional Bonus' });
push({ key: 'flags.midi-qol.optional.NAME.criticalDamage', label: 'Optional Crit Damage', description: 'Treat hit as crit when accepted (Half-Orc Savage Attacker style).', category: 'Midi-QOL — Optional Bonus' });

// ─── Midi-QOL: Resistance / Absorption tweaks ────────────────────────────
push({ key: 'flags.midi-qol.magicResistance.all', label: 'Magic Resistance (Saves)', description: 'Advantage on saves vs spells.', category: 'Midi-QOL — Resistance Tweaks' });
push({ key: 'flags.midi-qol.magicVulnerability.all', label: 'Magic Vulnerability (Saves)', description: 'Disadvantage on saves vs spells.', category: 'Midi-QOL — Resistance Tweaks' });
for (const t of DAMAGE_TYPES) {
  push({ key: `flags.midi-qol.absorption.${t}`, label: `Absorb ${t[0].toUpperCase()}${t.slice(1)} Damage`, description: 'Heals instead of taking damage of this type.', category: 'Midi-QOL — Resistance Tweaks' });
}
push({ key: 'flags.midi-qol.DR.all', label: 'Flat DR (All)', description: 'Numeric damage reduction applied after resistance.', category: 'Midi-QOL — Resistance Tweaks' });
for (const t of DAMAGE_TYPES) {
  push({ key: `flags.midi-qol.DR.${t}`, label: `Flat DR (${t})`, description: 'Numeric damage reduction for this type.', category: 'Midi-QOL — Resistance Tweaks' });
}

// ─── Midi-QOL: Feature flags ─────────────────────────────────────────────
const MIDI_FEATURE_FLAGS: Array<[string, string, string]> = [
  ['sharpShooter', 'Sharpshooter', '-5 attack / +10 damage on ranged.'],
  ['greatWeaponMaster', 'Great Weapon Master', '-5 attack / +10 damage on heavy melee.'],
  ['greatWeaponFighting', 'Great Weapon Fighting', 'Reroll 1s & 2s on two-handed weapon damage.'],
  ['superiorTechnicalFighting', 'Superior Technical Fighting', 'Reroll 1s on weapon damage.'],
  ['protection', 'Protection Fighting Style', 'Reaction: impose disadvantage on attacker.'],
  ['attack.fail.all', 'All Attacks Auto-Fail', 'Stunned/paralyzed style — same as `fail.attack.all`.'],
  ['challengeModifier.attackBonus', 'Indomitable Might / WWE override', 'Override the attack bonus for CR-driven NPCs.'],
];
for (const [k, label, description] of MIDI_FEATURE_FLAGS) {
  push({ key: `flags.midi-qol.${k}`, label, description, category: 'Midi-QOL — Feature Flags' });
}

// ─── DAE: Macros & specialDuration ───────────────────────────────────────
push({ key: 'macro.execute', label: 'Execute World Macro', description: 'Value = "MacroName arg1 arg2…". Runs the named macro when the effect applies.', category: 'DAE — Macros & Specials' });
push({ key: 'macro.itemMacro', label: 'Execute Item Macro', description: 'Runs the macro stored on the granting item (requires Item Macro module).', category: 'DAE — Macros & Specials' });
push({ key: 'macro.tokenMagic', label: 'Token Magic FX', description: 'Value = filter name (e.g. "fire", "glow"). Applies a token-magic filter.', category: 'DAE — Macros & Specials' });
push({ key: 'macro.actorUpdate', label: 'Direct Actor Update', description: 'Value = JSON patch applied to actor. Use sparingly.', category: 'DAE — Macros & Specials' });
push({ key: 'flags.dae.specialDuration', label: 'Special Duration Trigger', description: 'Array of trigger keys (e.g. ["1Attack","turnEnd"]) — DAE removes the effect on these events.', category: 'DAE — Macros & Specials' });
push({ key: 'flags.dae.transfer', label: 'DAE Transfer Override', description: 'Force transfer behavior independently of the effect\'s transfer flag.', category: 'DAE — Macros & Specials' });

export const ACTIVE_EFFECT_KEYS: readonly ActiveEffectKeyEntry[] = entries;

/**
 * Stable category order used by the autocomplete dropdown so the
 * groups appear consistently regardless of the original push order.
 * Categories not in this list fall to the end alphabetically.
 */
export const ACTIVE_EFFECT_KEY_CATEGORY_ORDER: readonly ActiveEffectKeyCategory[] = [
  'Abilities',
  'Skills',
  'Bonuses',
  'HP & AC',
  'Initiative',
  'Speed & Senses',
  'Spellcasting',
  'Resistances',
  'Traits',
  'Resources',
  'Concentration',
  'Death Saves',
  'dnd5e Flags',
  'Midi-QOL — Advantage',
  'Midi-QOL — Disadvantage',
  'Midi-QOL — Granted (to attackers)',
  'Midi-QOL — Auto-success/fail',
  'Midi-QOL — Optional Bonus',
  'Midi-QOL — Resistance Tweaks',
  'Midi-QOL — Feature Flags',
  'DAE — Macros & Specials',
];

/**
 * Filter the catalog for an autocomplete prompt. Matches substring case-
 * insensitively against `key`, `label`, and `description`. Returns a flat
 * array sorted by category-order, then by key.
 *
 * Empty query returns the full catalog (caller decides whether to render
 * everything or wait for input).
 */
export function searchActiveEffectKeys(query: string): ActiveEffectKeyEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...ACTIVE_EFFECT_KEYS];
  return ACTIVE_EFFECT_KEYS.filter(e => {
    return (
      e.key.toLowerCase().includes(q) ||
      (e.label?.toLowerCase().includes(q) ?? false) ||
      (e.description?.toLowerCase().includes(q) ?? false)
    );
  });
}
