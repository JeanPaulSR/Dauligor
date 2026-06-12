# Reply → settings-pages: `ItemBumpUses` resource-key authoring — DONE (2026-06-12)

Re: `handoffs/compendium-editors/2026-06-12-itembumpuses-resource-key-authoring.md`.
Implemented the authoring half on `compendium-editors` to match your runtime contract.

## What changed
### `src/lib/advancementState.ts`
- `buildDefaultAdvancementConfiguration('ItemBumpUses')` → `{ resourceKey: '', amount: '', preferredTarget: null }`.
- `normalizeAdvancementForEditor`:
  - Adds `resourceKey` (trimmed), coerces `preferredTarget` (`kind ∈ item|feature|feat` + non-empty id, else `null`), trims `amount`.
  - **Back-compat:** reads legacy `cfg.target` into `preferredTarget` when the new field is absent, then **drops `target`** from the editor shape (new writes are `resourceKey` + `preferredTarget`; untouched old rows keep their `target` column, which your runtime still honors via `preferredTarget || target`).
  - `CanonicalAdvancementType` comment updated to the new shape.

### `src/components/compendium/AdvancementManager.tsx`
- **Resource Key** is now the primary control — a free-text `<Input>` (placeholder `sorcery-points`) with a `<datalist>` autocomplete drawn from locally-known `identifier`s (`availableFeatures` + `availableFeats` + `availableItems`). Any slug allowed.
- **Preferred Target** demoted to an **optional** fieldset (Kind select gains **Item** → Class Feature / Feat / Item; id `SingleSelectSearch` over the kind's pool; a **Clear** button; empty = resolve by key alone).
- **List-row subtitle** now reads `resourceKey` (`+1 to sorcery-points`), falling back to the preferred target's kind, falling back to `Bump uses (resource / amount not set)`.
- Help/comment + **Resolution** box rewritten to describe the resource-key + item-first + source-order + preferred-target rules (no longer says "runtime deferred").
- Added an **`availableItems?: any[]`** prop (default `[]`), analogous to `availableFeats`.

## Verified
- **tsc**: 3 baseline / 0 new.
- **Normalize contract** (headless): legacy `{target,amount}` → `preferredTarget` set + `target` dropped; new `{resourceKey,amount,preferredTarget}` trimmed + `item` kind kept; empty/invalid preferred id or bad kind → `preferredTarget: null`; default config correct.
- Editor writes `{ resourceKey, amount, preferredTarget }`; an old `{ target, amount }` row opens with the target surfaced as the preferred target.

## Notes / open
- **Item preferred-target pool**: `availableItems` defaults to `[]`, so the item picker shows the
  same "pass `availableItems` from the parent editor" hint that feats/features show when unwired.
  The host (`ClassEditor`/feature editor) isn't yet passing it — a small parent-wiring follow-up.
  **Low priority**: item *resolution* isn't live yet (your known exporter gap), and item targeting
  already works via `resourceKey` matched against an item's `identifier`. Flagging so you're aware.
- Per your instruction, this is kept **independent** of the Feature-Interaction
  `interactionKey`/`stackingKey` system — no coupling.

## Status
Committed on `compendium-editors` (awaiting owner go-ahead to push to `main`). No DB change, no migration.
