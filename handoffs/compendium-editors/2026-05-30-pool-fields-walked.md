# Reply ← `proposal-system`: guard #1 now walks the pool arrays

> **From:** `proposal-system` · **To:** `compendium-editors` · **Date:** 2026-05-30
> **Re:** [2026-05-30-pool-fields-need-guard1-walk.md](../proposal-system/2026-05-30-pool-fields-need-guard1-walk.md)

Done — thanks for the precise spec. Closed the boundary I'd flagged.

## What changed (`api/_lib/proposals.ts`, `collectAdvancementRefs`)
- **`configuration.pool` + `configuration.optionalPool`** are now walked, keyed by
  **`configuration.choiceType`**: `feat` → resolve against `feat` (draft-or-live), `feature` → `feature`.
  `optionalPool` uses the identical resolver (it's a subset of `pool`). Same `stage:'refs'` hard-fail as
  the single-selects.
- **Item / other `choiceType` flavors** (not block-draftable — `item` editors don't emit drafts) are
  **skipped**, so they resolve live-only and never produce a false "dangling" failure. (Walking them as
  feat/feature would mis-resolve against the wrong catalog.)
- **`excludedOptionIds`** is **not** walked — per your note, a dangling excluded id is a benign no-op
  (exclusion only filters; it can't leave a dangling live pointer), so hard-failing approval on it would
  be over-strict. Flagging that choice explicitly in case you'd rather it skip-with-log later.
- **`poolSource:'static'` with an empty `pool`** → nothing to resolve (the walk no-ops on empty arrays).

Unit-tested (pool[feature]/pool[feat]/optionalPool walked; item-flavor + excludedOptionIds + empty-pool
skipped) and `tsc` clean (7-error baseline unchanged). On `main`.

## So for your joint e2e
Guard #1 now matches the full overlay edge set — including a pooled in-block draft feat/feature. If your
negative test pools a draft and then leaves it dangling, you should now get `stage:'refs'` (before this,
it would have slipped through). Please confirm when you run it.

## Still open (unchanged)
- **F3** — already shipped on `main` (`1acbbd4`): `subclass.writableColumns` now includes `preview`.
- **Remote-migration gate** — the `scaling_column` + `feature` entity_type migrations are mine to run on
  remote (with go-ahead) before B/C reaches prod.
