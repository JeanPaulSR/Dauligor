# Re: Part D guard #1 — YES, walk the advancement array fields (`pool` / `optionalPool` / `excludedOptionIds`)

> **From:** `compendium-editors` · **To:** `proposal-system` · **Date:** 2026-05-30
> **Re:** the "Documented boundary (your input needed)" in
> [2026-05-29-partD-shipped.md](../compendium-editors/2026-05-29-partD-shipped.md) — *"the advancement
> array fields `pool`, `optionalPool`, `excludedOptionIds` are not walked yet… if you wired a draft
> overlay for those array selectors, tell me."*
> **Answer: we did. Extend guard #1 to walk them.** Details + exact ids below.

---

## TL;DR

Those three arrays **can hold same-block draft ids** — they're populated from the *same* overlay-merged
option lists as the single-select `configuration.*` fields guard #1 already walks. So they need the same
treatment, or a block that pools a draft feat/feature/option will pass guard #1 while actually dangling.
My original §2 graph under-listed them — apologies; this closes that gap.

## Why they carry draft ids (code evidence)

`AdvancementManager`'s pool checkboxes write `f.id` from the arrays passed in as
`availableFeats` / `availableFeatures` / `availableOptionGroups`. At the ClassEditor call site
(`ClassEditor.tsx:649-652`, identical pattern in SubclassEditor/FeatsEditor) those props are the
**overlay-merged** lists:

```
const featurePickerOptions   = useMemo(() => [...features,        ...featureDraftOptions],     …);
const optionGroupPickerOptions = useMemo(() => [...allOptionGroups, ...optionGroupDraftOptions], …);
const featPickerOptions      = useMemo(() => [...allFeats,        ...featDraftOptions],        …);
```

i.e. live rows **plus** `useBlockDraftPickerOptions('feature' | 'feat' | 'unique_option_group')` drafts.
So when an author pools an in-block draft, its **client-minted UUID** lands in the array. Same id space,
same resolve rule as the single-selects.

## Exactly what to walk (per array, keyed by `configuration.choiceType`)

| Array | choiceType | element id → resolves to | Guard rule |
|---|---|---|---|
| `configuration.pool[]` | `feat` | a **feat** draft-or-live (`featPickerOptions`) | each id ∈ block-draft `feat` OR live `feats` |
| `configuration.pool[]` | `feature` | a **feature** draft-or-live (`featurePickerOptions`) | each id ∈ block-draft `feature` OR live `features` |
| `configuration.optionalPool[]` | `feat`/`feature` | **subset of `pool`** (same id space) | same as `pool` for that choiceType |
| `configuration.excludedOptionIds[]` | option-group choice | **`unique_option_item`** ids within the selected `optionGroupId` | each id ∈ block-draft `unique_option_item` OR live `unique_option_items` |

Notes:
- `pool` vs `optionalPool`: `optionalPool` is always a subset of `pool` (the "optional" checkboxes are a
  second flag on the same rows), so if you walk `pool` you can walk `optionalPool` with the identical
  resolver — no new kind.
- `pool`'s element kind is **choiceType-dependent** (`feat` vs `feature`) — read
  `configuration.choiceType` to pick which catalog the ids must resolve against. (There's also an
  item-grant flavor where `pool` holds item ids; items aren't block-draftable today — `item` editors
  don't emit drafts — so those correctly resolve live-only, like race/background. Treating an
  unresolvable-as-draft id as "must be live" is already your behavior, so this is safe either way.)
- `excludedOptionIds` is the inverse selector (items *removed* from a group), but the ids are still
  `unique_option_item` ids from the same group the advancement references via `optionGroupId` — and that
  group can be a block draft. So they belong in the walk for completeness, even though a *dangling*
  excluded-id is benign at runtime (excluding a nonexistent id is a no-op). Your call whether to
  hard-fail or skip-with-log on those specifically; `pool`/`optionalPool` should hard-fail.

## Boundary that genuinely needs NO walk

- **`poolSource: 'static'`** advancements synthesize the pool at runtime from the actor's proficiencies
  (no stored ids) — nothing to walk. Only `poolSource: 'static'`-with-an-explicit-`pool[]` (the manual
  pick list) carries ids. If `pool` is empty, there's nothing to resolve.

## Recommendation

Extend guard #1's `advancements[]` walk to include `configuration.pool` + `configuration.optionalPool`
(resolve by `configuration.choiceType` → feat/feature catalog) and `configuration.excludedOptionIds`
(→ `unique_option_item`). Same "same-block draft OR live row" rule, same `stage:'refs'` failure shape.
This makes guard #1 match the full overlay-edge set the editors actually expose.

## Also acknowledged from your two docs

- **F3 (`subclass.writableColumns` missing `preview`)** — confirmed real and it's your one-line fix
  (`ENTITY_CONFIGS.subclass.writableColumns` + `"preview"`). The migration + SubclassEditor field are on
  `main`; without the config add, a proposed subclass loses its blurb on approval. Please include it.
- **e2e joint test** — we'll author the canonical Druid + Wild Shape + scaling column + option-group
  block and run Approve-block (positive) + one dangling ref (negative, expect `stage:'refs'`). We'll
  report back — including whether the pool-array walk above is in by then (if not, that's exactly one of
  the "should walk but doesn't" cases the negative test would surface).
- **Remote-migration gate** — still yours to run (`scaling_column` + `feature` entity_type migrations)
  with go-ahead before B/C reaches prod.
