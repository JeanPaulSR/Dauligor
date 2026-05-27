# Handoff — Phase C: `ItemBumpUses` advancement type

Pick-up doc for the next session. Phase A + Phase B of the
"advancements outside classes" track shipped on
`feat/scaling-non-class-owners` (9 commits, all pushed). This
file is the single entry point for resuming **Phase C** — the
actual new mechanic everything prior was scaffolding for.

> **Status**: not started. Branch + design calls captured.

## Read these first

In this order:

1. **`docs/handoff-scaling-non-class-owners.md`** — design calls
   from the prior conversation (owner scope, storage shape, Foundry
   round-trip requirement, Phase C specifics).
2. **`docs/roadmap.md#scaling-columns-for-non-class-owners--follow-ups`** —
   the canonical follow-up list. Phase C section has the
   implementation outline.
3. **`docs/verification-scaling-non-class-owners.md`** — checklist
   the user uses to validate. Phase C will need its own section
   appended when the work lands.
4. `docs/features/compendium-scaling.md` — non-class scaling
   feature doc, for context on how scaling columns work today.

Skim — don't re-derive. The forks are already locked.

---

## The mechanic in plain English

A feat or item can say "if you have feature X, bump its uses_max
by N." Used for things like:

- *Cleric: Divine Intervention Improvement* — bumps Channel
  Divinity uses from 1/rest to 2/rest at level 18.
- *Amulet of the Devout* — +1 Channel Divinity charge while
  attuned.
- A homebrew feat that adds +1 Bardic Inspiration die.

These all share the shape "find a feature on the sheet, mutate
its uses". Today there's no advancement type for that — authors
have to leave a note in the description and trust the DM.

## Design calls locked in the prior conversation

The user answered these in the design phase; don't re-prompt:

- **Separate advancement type, NOT a flag on `ItemGrant`.** Name:
  `ItemBumpUses`. Lives alongside `ItemGrant` / `ItemChoice` /
  `ScaleValue` in the `AdvancementType` union.
- **Target picker uses the requirements-tree `feature` / `feat`
  leaf shape.** Authors already know this picker — same UX they
  use for prereqs.
- **Target not found → warn, don't fail.** Per the user verbatim:
  *"Part of the feat is usually to have a requirement that already
  fits a class that would have the target. However, writing a
  notification would be useful and would let the user pass along
  the information to the dm."* Log a warning the user can surface
  to the DM; don't reject the feat.
- **Bake-time application, NOT runtime Active Effect.** When the
  parent (feat / item) is added to a character, the builder finds
  the target item and statically patches its `uses.max`. The
  exported actor data has the bumped value baked in. Trade-off:
  if a user adds the feat to a character directly in Foundry
  (skipping our builder), the bump doesn't apply. Accepted —
  the user authors content through the app, not in-Foundry.

## Implementation scope

Six files. Two of them are large (AdvancementManager + CharacterBuilder);
the rest are small.

### 1. Type definition
**File**: [src/components/compendium/AdvancementManager.tsx](../src/components/compendium/AdvancementManager.tsx)

Add `'ItemBumpUses'` to the `AdvancementType` union (around line
23-35). The union is exported, so it propagates automatically.

### 2. Default configuration
**File**: [src/lib/advancementState.ts](../src/lib/advancementState.ts)

Add a new branch to `buildDefaultAdvancementConfiguration()` for
`'ItemBumpUses'` returning:
```ts
{
  target: null,   // RequirementLeaf — feature / feat leaf only
  amount: '',     // formula string: e.g. '+1', '@prof', '@scale.<feat>.<col>'
}
```

Mirror how `ItemGrant` builds its default for comparison.

### 3. Editor UI block in AdvancementManager
**File**: [src/components/compendium/AdvancementManager.tsx](../src/components/compendium/AdvancementManager.tsx)

Add an editor block for `editingAdv.type === 'ItemBumpUses'`.
Pattern is established by the other type-specific blocks
(`AbilityScoreImprovement`, `Trait`, etc. around line 2920+).

The block needs:
- **Target picker**: reuse the requirements-tree leaf picker. The
  existing `RequirementsEditor` (in `src/components/compendium/RequirementsEditor.tsx`)
  has a `feature` / `feat` leaf — extract or inline the picker.
  Constraint: only feature / feat leaf types make sense here;
  hide the others.
- **Amount input**: a formula string `<input>` accepting `'+1'`,
  `'@prof'`, `'@scale.<owner>.<col>'`. Use the same input shape
  as `ScaleValue`'s value cell.
- **Hint copy**: "If the character has the target feature, add
  this to its `uses.max`. If they don't have the feature, the
  application silently skips and logs a warning."

### 4. Character builder integration
**File**: [src/pages/characters/CharacterBuilder.tsx](../src/pages/characters/CharacterBuilder.tsx)

This is the big one. Walk the character's chosen advancements;
for every `ItemBumpUses` entry:
1. Resolve the target via the requirements-tree leaf (the existing
   `resolveRequirementLeaf` or equivalent — check existing call
   sites for the pattern).
2. Find the target feature / feat in the character's currently-
   embedded items.
3. If found: parse the `amount` formula, evaluate against the
   character's roll data, and add to the target's `uses.max`.
4. If NOT found: append a warning to a per-character build log
   that surfaces in the character sheet (or via toast). User can
   pass the warning to the DM.

Test cases the builder needs to handle:
- Target is a class feature granted by another advancement in the
  same character — order of operations matters (parent must
  resolve BEFORE the bumper).
- Target's `uses.max` is a formula already (`@prof`) — sum the
  two formulas: `(@prof) + 1`.
- Target's `uses.max` is empty — skip + warn (the user said
  "Part of the feat usually to have a requirement that fits a
  class with the target" — so this is an edge case but real).
- Bumper applied twice (e.g. character has both Amulet of the
  Devout AND a feat that bumps the same feature) — both bumps
  apply additively.

### 5. Foundry export integration
**File**: [api/_lib/_classExport.ts](../api/_lib/_classExport.ts) (or wherever the actor export lives)

Apply the bake-time bump when exporting a character to Foundry.
Same logic as the builder integration — walk the character's
advancements, mutate target item's `uses.max` in the exported
JSON. The Foundry-side actor data carries the bumped value
statically; no runtime hook needed.

If the character builder applies the bump app-side and the
actor data already reflects it, the export might not need any
new logic — verify which layer owns `uses.max` resolution.

### 6. Verification doc + roadmap update

Once shipped:
- Add Phase C section to
  [docs/verification-scaling-non-class-owners.md](verification-scaling-non-class-owners.md):
  step-by-step checklist for authoring an ItemBumpUses, applying
  to a character, confirming the bumped value lands in both
  app-side display and Foundry export, target-not-found warning.
- Move Phase C entry in [docs/roadmap.md](roadmap.md) to "Shipped"
  section with the commit hash.

---

## What you can ignore in Phase C

These are flagged in the roadmap but DO NOT come up unless
explicitly requested:

- **B.2 module-side item importer** (Foundry-side companion to
  `_itemExport.ts`). Separate track; not a Phase C dependency.
- **B.4 canonical contract doc updates** for the module side.
  Owner-gated. Only relevant once Phase C touches feature-activity
  flags or item shape, which it shouldn't.
- **Future upgrade modes** (`'addToChoice'`, `'replace'`). The
  user explicitly scoped Phase C to bump-uses-only ("Bump uses
  first"). Treat the other two as Phase D / E.

---

## Branch state

- Working branch: `feat/scaling-non-class-owners`
- 10 commits ahead of `origin/main` (after Phase B.2 lands)
- All Phase A + Phase B work shipped; manual verification doc
  ready for the user to step through
- Pre-existing typecheck errors: 7 (all unrelated to this track —
  `asChild` on Button + characterShared.ts arg count)
- Recommended: branch off `feat/scaling-non-class-owners` into a
  new `feat/itembumpuses-advancement` for Phase C work, OR
  continue committing onto the same branch if Phase B hasn't
  merged yet. The user prefers branches over direct-to-main.

---

## Open questions for the user (only if relevant)

These came up during Phase B planning but were deferred. Ask only
if Phase C work surfaces them naturally; don't pre-empt:

1. **Multi-target bumps** — should one `ItemBumpUses` advancement
   ever target multiple features? The current design assumes
   one target per advancement. If the user wants "this feat bumps
   both Channel Divinity AND Bardic Inspiration," they author two
   advancements. Confirm if that's the right shape.
2. **Bump-uses-on-uninstall** — what happens if the granting feat
   is removed from the character later? Today's design bakes the
   bump in at apply time; removing the feat doesn't reverse the
   bump unless the builder re-runs from scratch. May be fine; may
   warrant explicit "revert" logic.
3. **Visibility of warnings** — should target-not-found warnings
   surface only in the build log, or also as a yellow chip on
   the character sheet next to the orphan advancement? UX detail
   the user might have opinions on.

Skip these unless they block your implementation. They're noted
so a future agent isn't surprised when the user raises them.
