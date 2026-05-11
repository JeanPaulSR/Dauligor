/**
 * Canonical status-condition list for dnd5e 5.x on Foundry v13.
 *
 * The `statuses` array on an Active Effect is a list of condition IDs
 * that are applied to the owning actor while the effect is active.
 * Foundry maps these IDs through `CONFIG.statusEffects` to the
 * condition icons shown on the token. Values here mirror that table —
 * id is the system key, label is the user-facing name.
 *
 * Source: dnd5e/module/config.mjs → conditionTypes / statusEffects.
 *
 * Authors can also free-text any string (the editor accepts any value),
 * but ids outside this list won't get a Foundry-rendered status icon —
 * they'll still apply as a logical condition flag on the actor.
 */

export interface ActiveEffectStatus {
  id: string;
  label: string;
  /** Standard PHB condition vs system-specific extras. */
  category: 'PHB Conditions' | 'Combat States' | 'Spell States' | 'System Extras';
}

export const ACTIVE_EFFECT_STATUSES: ActiveEffectStatus[] = [
  // PHB / SRD legal conditions — the canonical "you are X" list every
  // 5e player knows.
  { id: 'blinded',       label: 'Blinded',        category: 'PHB Conditions' },
  { id: 'charmed',       label: 'Charmed',        category: 'PHB Conditions' },
  { id: 'deafened',      label: 'Deafened',       category: 'PHB Conditions' },
  { id: 'exhaustion',    label: 'Exhaustion',     category: 'PHB Conditions' },
  { id: 'frightened',    label: 'Frightened',     category: 'PHB Conditions' },
  { id: 'grappled',      label: 'Grappled',       category: 'PHB Conditions' },
  { id: 'incapacitated', label: 'Incapacitated',  category: 'PHB Conditions' },
  { id: 'invisible',     label: 'Invisible',      category: 'PHB Conditions' },
  { id: 'paralyzed',     label: 'Paralyzed',      category: 'PHB Conditions' },
  { id: 'petrified',     label: 'Petrified',      category: 'PHB Conditions' },
  { id: 'poisoned',      label: 'Poisoned',       category: 'PHB Conditions' },
  { id: 'prone',         label: 'Prone',          category: 'PHB Conditions' },
  { id: 'restrained',    label: 'Restrained',     category: 'PHB Conditions' },
  { id: 'stunned',       label: 'Stunned',        category: 'PHB Conditions' },
  { id: 'unconscious',   label: 'Unconscious',    category: 'PHB Conditions' },

  // Combat / action-economy states surfaced by dnd5e and Midi.
  { id: 'dodging',       label: 'Dodging',        category: 'Combat States' },
  { id: 'hiding',        label: 'Hiding',         category: 'Combat States' },
  { id: 'surprised',     label: 'Surprised',      category: 'Combat States' },
  { id: 'marked',        label: 'Marked',         category: 'Combat States' },
  { id: 'raging',        label: 'Raging',         category: 'Combat States' },

  // Spell-related "you are X while concentrating / blessed / cursed".
  { id: 'concentrating', label: 'Concentrating',  category: 'Spell States' },
  { id: 'cursed',        label: 'Cursed',         category: 'Spell States' },
  { id: 'silenced',      label: 'Silenced',       category: 'Spell States' },
  { id: 'transformed',   label: 'Transformed',    category: 'Spell States' },
  { id: 'ethereal',      label: 'Ethereal',       category: 'Spell States' },

  // System extras — dnd5e 5.x ships these as full statuses.
  { id: 'bleeding',      label: 'Bleeding',       category: 'System Extras' },
  { id: 'burning',       label: 'Burning',        category: 'System Extras' },
  { id: 'dehydrated',    label: 'Dehydrated',     category: 'System Extras' },
  { id: 'diseased',      label: 'Diseased',       category: 'System Extras' },
  { id: 'falling',       label: 'Falling',        category: 'System Extras' },
  { id: 'flying',        label: 'Flying',         category: 'System Extras' },
  { id: 'hovering',      label: 'Hovering',       category: 'System Extras' },
  { id: 'malnourished',  label: 'Malnourished',   category: 'System Extras' },
  { id: 'sleeping',      label: 'Sleeping',       category: 'System Extras' },
  { id: 'stable',        label: 'Stable',         category: 'System Extras' },
  { id: 'suffocation',   label: 'Suffocation',    category: 'System Extras' },
  { id: 'dead',          label: 'Dead',           category: 'System Extras' },
];

/**
 * Effect document types in dnd5e 5.x.
 *
 *   - base        Standard Active Effect. The default for class features,
 *                 maneuvers, invocations, etc.
 *   - enchantment Bound to a magic-item enchantment workflow (the dnd5e
 *                 5.x Activity system's Enchant activity). Transfers to
 *                 whoever attunes/wields the parent item rather than
 *                 the item's owner.
 */
export interface ActiveEffectType {
  id: string;
  label: string;
  description: string;
}

export const ACTIVE_EFFECT_TYPES: ActiveEffectType[] = [
  {
    id: 'base',
    label: 'Base',
    description: 'Standard Active Effect — applies to the owning actor.',
  },
  {
    id: 'enchantment',
    label: 'Enchantment',
    description: 'Magic-item enchantment — bound through the Enchant activity workflow.',
  },
];
