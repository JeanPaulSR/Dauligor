/**
 * Active Effect document-type vocabulary for dnd5e 5.x on Foundry v13.
 *
 * The status-condition catalog used to live in this file too, but the
 * editor now sources conditions from the application's own
 * `status_conditions` D1 table (aliased as the `statuses` collection in
 * `D1_TABLE_MAP`), so the picker stays in sync with whatever the
 * campaign has authored or seeded rather than a frozen hardcoded list.
 * See `ActiveEffectEditor.tsx` for the fetch path.
 */

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
