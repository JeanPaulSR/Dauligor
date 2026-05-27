# Handoff — Phase C: `ItemBumpUses` advancement type

Pick-up doc. Phase A + Phase B of the "advancements outside classes"
track shipped on `feat/scaling-non-class-owners` (10 commits, all on
origin/main). Phase C v1 — authoring + character-builder runtime +
Foundry actor export — then shipped on `feat/itembumpuses-advancement`
(four commits, branch only). This file documents what landed + the
remaining slices.

> **Status**: v1 end-to-end shipped — authors create the
> advancement, the character builder derives `character.derivedItemBumpUses`
> and toasts orphan warnings, and the Foundry actor export bakes the
> bumps into feature items' `system.uses.max`. Server-side feat-
> authored bumps + items as bump authors remain queued.

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

Six pieces. Sections 1-3 (authoring surface) **shipped on
`feat/itembumpuses-advancement`**. Sections 4-6 are still open.

### 1. Type definition ✅ shipped
**File**: [src/components/compendium/AdvancementManager.tsx](../src/components/compendium/AdvancementManager.tsx)

`'ItemBumpUses'` is in the `AdvancementType` union and the
exported `CanonicalAdvancementType` (advancementState.ts) too.
ADVANCEMENT_INFO entry uses the `Plus` icon + teal accent.

### 2. Default configuration ✅ shipped
**File**: [src/lib/advancementState.ts](../src/lib/advancementState.ts)

`buildDefaultAdvancementConfiguration()` returns:
```ts
{
  target: null,   // { kind: 'feature'|'feat', id: string } | null
  amount: '',     // formula string: e.g. '+1', '@prof', '@scale.<feat>.<col>'
}
```

`normalizeAdvancementForEditor` includes a defensive coercion
branch: `target.kind` is constrained to `'feature'|'feat'`, and
`{kind, id}` becomes `null` if either is empty.

### 3. Editor UI block in AdvancementManager ✅ shipped
**File**: [src/components/compendium/AdvancementManager.tsx](../src/components/compendium/AdvancementManager.tsx)

Editor block for `editingAdv.type === 'ItemBumpUses'` sits right
after `ExtendSpellList`. Two fieldsets:

- **Target**: kind picker (Class Feature / Feat) using the existing
  Select primitive, plus `SingleSelectSearch` bound to
  `availableFeatures` / `availableFeats` from the parent editor.
  Switching kind clears the id. We chose this over inlining the
  RequirementsEditor leaf shape because `feature` / `feat` are the
  only relevant leaf types and a dedicated picker reads cleaner
  than a constrained `LeafNode`.
- **Bump Amount**: a formula `<Input>` stored verbatim. Help text
  documents the supported forms. A "Resolution" help card explains
  bake-time application + the target-not-found warning behavior so
  authors understand what will happen at apply time.

The list-row subtitle for an `ItemBumpUses` advancement reads
`+<amount> to a feat's / feature's uses` (with smart sign handling
so authors can write `+1`, `1`, `@prof`, or `-1` and the prefix
stays sensible).

### 4. Character builder integration ✅ shipped
**Files**: [src/lib/characterLogic.ts](../src/lib/characterLogic.ts) + [src/pages/characters/CharacterBuilder.tsx](../src/pages/characters/CharacterBuilder.tsx)

A shared resolver `collectItemBumpUses({ progression, classCache,
subclassCache, featureCache, ownedFeats, totalCharacterLevel })`
walks every authored advancement on classes / subclasses /
features / feats at the character's effective levels and returns
`{ bumps: Record<key, ItemBumpEntry[]>, warnings: ItemBumpWarning[] }`.
Targets are keyed `${kind}:${id}` so feature-id and feat-id
namespaces stay distinct. Effective-level gating mirrors the
existing feat-trait pass (class advancements gate on class level,
feat advancements gate on the granting class's level if granted
by a class/subclass, else on total character level).

The CharacterBuilder effect (right after the synthesis walker)
stores the result on `character.derivedItemBumpUses` and emits a
deduped toast for each new warning. The dedupe is keyed by
`${sourceAdvancementId}|${targetKind}:${targetId}|${reason}` via a
ref-tracked Set so the toast doesn't re-fire on unrelated
re-renders but does surface NEW orphans.

### 5. Foundry export integration ✅ shipped
**File**: [src/lib/characterShared.ts](../src/lib/characterShared.ts)

`buildCharacterExport` now fetches feature rows from D1 alongside
class / subclass docs, builds a minimal `featureCacheMap` keyed
by `parent_id`, and calls the same `collectItemBumpUses` helper.
Each owned-feature item gets its bumps baked in via
`combineUsesMaxWithBumps(baseFeatureRow.usesMax, bumps)` and emits
`system.uses = { max, spent: 0, recovery }` when there's content.

Audit trails:
- Per-item: `flags['dauligor-pairing'].itemBumpUses = [...]` —
  one entry per applied bump on that specific feature.
- Top-level: `actor.flags['dauligor-pairing'].itemBumpUses =
  { bumps, warnings }` — the whole-actor map so the module side
  doesn't have to re-walk.

**Server-export caveat** — feat-authored bumps silently drop in
the export because `rebuildCharacterFromSql` (the API loader)
doesn't reconstruct `character.feats`. The synthesis lives entirely
in the client-side builder. Feat-authored bumps work in the runtime
toast + UI state but won't reach Foundry until a server-side feat
synthesizer ports the relevant slice. Class / subclass / feature
advancements ARE walked correctly because their advancements live
on the class/subclass/feature rows directly.

### 6. Verification doc + roadmap update ✅ shipped

- Phase C section landed in
  [docs/verification-scaling-non-class-owners.md § J](verification-scaling-non-class-owners.md#j-itembumpuses-end-to-end-phase-c-v1)
  with J.1 (authoring), J.2 (builder runtime), J.3 (Foundry export),
  J.4 (known limitations).
- Phase C roadmap entry updated to "v1 end-to-end shipped" with
  pointers to what's still open.

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
