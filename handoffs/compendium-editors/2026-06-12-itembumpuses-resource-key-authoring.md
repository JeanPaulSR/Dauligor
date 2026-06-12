# Handoff → compendium-editors: `ItemBumpUses` resource-key authoring

From `settings-pages` (worktree kind-wright). Written 2026-06-12.
**The RUNTIME resolver is done and shipped-ready on this branch (uncommitted, local).
This handoff is the AUTHORING half — the bits that live in your territory.**

## TL;DR
The `ItemBumpUses` advancement (your "beta" type) was generalized from "bump one
explicit feature/feat by row-id" to **"bump a named RESOURCE, resolved to its holder."**
The runtime resolver ([src/lib/characterLogic.ts](../../src/lib/characterLogic.ts) →
`collectItemBumpUses`) now resolves by a **resource key** matched against a holder's
`identifier`, with an optional **manual preferred target**. The authoring surface
(`AdvancementManager.tsx` editor block + `advancementState.ts` config shape/normalize +
the list-row subtitle) still writes the OLD shape and needs to be updated to match the
new contract below.

**Zero migration needed:** the runtime reads the legacy `configuration.target` field AS
the preferred target, so existing beta-authored rows keep resolving exactly as before.
New authoring should write `resourceKey` (primary) + optional `preferredTarget`.

## The new configuration shape (the contract the runtime reads)
```ts
configuration: {
  resourceKey: string;            // NEW primary — the identifier slug to match,
                                  // e.g. 'sorcery-points'. Lower-cased + matched
                                  // against a holder's `identifier`.
  amount: string;                 // unchanged — verbatim formula ('+1', '@prof',
                                  // '@scale.<owner>.<col>', arithmetic).
  preferredTarget:                // OPTIONAL manual override (was `target`).
    { kind: 'item' | 'feature' | 'feat'; id: string } | null;
}
```
- The runtime accepts `preferredTarget` OR the legacy `target` (it reads
  `cfg.preferredTarget || cfg.target`). Please RENAME the authored field to
  `preferredTarget` going forward, but you do NOT need to migrate old rows — `target`
  still works as the fallback. (No-backcompat applies to *new* writes; old data is safe.)
- `preferredTarget.kind` now includes **`'item'`** (was only `'feature' | 'feat'`).

## Resolution contract (so authoring + runtime agree)
Per the user (locked 2026-06-12), each advancement resolves to **ONE holder**, first
match wins:
1. **preferredTarget** — used only if that entity is actually present on the character.
2. **resource key → an ITEM** whose `identifier === resourceKey`, ordered class → subclass → feat.
3. **resource key → a FEATURE** whose `identifier === resourceKey`, ordered class → subclass → feat.
4. none present → a DM-facing warning (`resource-not-found`), never a hard failure.

So: the author types a resource key (a slug that equals the holder's `identifier`), and
optionally pins a specific holder via the preferred target. Item beats feature; within a
type, class beats subclass beats feat.

## What to change (your files — line refs from the 2026-06-12 survey)
1. **`src/lib/advancementState.ts`**
   - `buildDefaultAdvancementConfiguration('ItemBumpUses')` (~L85-93): return
     `{ resourceKey: '', amount: '', preferredTarget: null }` (was `{ target: null, amount: '' }`).
   - `normalizeAdvancementForEditor` (~L191-210): add `resourceKey = String(cfg.resourceKey||'').trim()`;
     coerce `preferredTarget` like the old `target` (kind ∈ item|feature|feat + non-empty id, else null);
     **read legacy `cfg.target` into `preferredTarget` if `preferredTarget` is absent** (so opening an
     old row in the editor surfaces it as the preferred target). Drop the requirement that a target exist.
   - Update the `CanonicalAdvancementType` shape comment (~L12-16).
2. **`src/components/compendium/AdvancementManager.tsx`** (editor block ~L3091-3214)
   - Make **Resource Key** the primary control (a text `<Input>`, or a `SingleSelectSearch`
     autocompleting over `availableFeatures` identifiers — see note). Placeholder e.g. `sorcery-points`.
   - Demote the existing kind `<Select>` + id `SingleSelectSearch` to an **optional "Preferred target"**
     fieldset that may be left empty. Add an **`item`** option to the kind select (Class Feature / Feat /
     **Item**); when kind === 'item', the id picker pool should be items (you'll need an `availableItems`
     prop analogous to `availableFeatures`/`availableFeats`, or reuse a global item pool).
   - List-row subtitle (~L1010-1023): currently keys off `target?.kind` and prints
     "+N to a feature's uses" / "(target / amount not set)". Rewrite to read `resourceKey`
     (e.g. `+1 to sorcery-points`), falling back to the preferred target's kind, falling back to
     "(resource / amount not set)".
   - Update the type/help comments (~L41-46, L3079-3089) — they document `{target,amount}` and call
     runtime "deferred". Runtime is now LIVE on settings-pages; the help "Resolution" box should describe
     resource-key resolution + the item-first/source-order/preferred-target rules above.
3. **Resource-key source** (open decision — your call): the key must equal a holder's `identifier`.
   Simplest correct option: **free-text slug input** with optional autocomplete suggestions drawn from
   `availableFeatures.map(f => f.identifier)` (and items, once an item pool is wired). Do NOT couple this
   to the Feature-Interaction `interactionKey`/`stackingKey` system — that's a separate concern (pooled
   resources / non-stacking compensation), not the uses-bump resource. Keep them independent.

## Known gap (NOT yours to fix — noted so you don't trip on it)
The Foundry exporter does **not emit inventory items**, so an *item*-resolved bump can't yet bake onto
an exported item. The runtime therefore keeps `ownedItemHolders` **empty** in both live callers for now
(item resolution is fully implemented + unit-tested, but only feature/feat holders are live). Authoring
should still allow item preferred targets / item resource matches — when the exporter starts emitting +
baking inventory-item `uses`, settings-pages will feed item candidates to the walker from both callers.
This does not block your authoring work.

## Verify after your change
The runtime already round-trips: an `ItemBumpUses` with `resourceKey: 'sorcery-points'` on a class
resolves to the character's `sorcery-points` FEATURE (matched by `identifier`) and bakes
`+1` onto its `system.uses.max` in the Foundry export. Confirm the editor writes
`{ resourceKey, amount, preferredTarget }` and that an old `{ target, amount }` row still opens and
resolves. (Runtime resolver verified 21/21 unit tests on settings-pages 2026-06-12.)
