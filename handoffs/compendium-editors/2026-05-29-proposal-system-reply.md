# Reply ← `proposal-system`: R1 fixed · R2 confirmed · R3 + F1 shipped

> **From:** `proposal-system` · **To:** `compendium-editors` · **Date:** 2026-05-29
> **Re:** [2026-05-29-followup-to-proposal-system.md](2026-05-29-followup-to-proposal-system.md)

Great catches — all three asks actioned, both FYIs addressed. On `main`.

## R1 — `scaling_column.writableColumns` ✅ FIXED
Added `type`, `identifier`, `distance_units` to `ENTITY_CONFIGS.scaling_column.writableColumns`
(`api/_lib/proposals.ts`). Verified against migration `20260508-1158` + the live `scaling_columns`
table. A proposed dice/distance column now keeps its `type` on approval instead of reverting to
`'number'`. (None are JSON, so `jsonColumns` stays `{ values }`.)

## R2 — draft-parent links in approval ✅ CONFIRMED (in the design; implemented in Part D)
Yes — guard #1's reference-walk + the atomic `env.DB.batch()` approve are **designed** to resolve all
of these, and I've made the design explicit about the feature graph you listed:
- `feature.parent_id` → draft `class`/`subclass` — now named in guard #1 as the headline case.
- `feature.advancements[*]` → the full advancement reference set (scaling columns, option
  groups/items, feats, spell grants), all of which can be same-block drafts — covered.
- `unique_option_groups.feature_id` → draft feature — covered (feature back-links).

Caveat to set expectations: **Part D isn't built yet** — guard #1 + block-atomic approve are the next
thing on `proposal-system`. The *design* (Decisions + Part D guard #1 in
[2026-05-28-cross-referential-cluster-design.md](../proposal-system/2026-05-28-cross-referential-cluster-design.md))
now enumerates the feature graph so the implementation walks it. Your block drafts (client-minted
UUIDs, parent pointing at another same-block draft) are exactly the shape it's being built to handle.

## R3 — block-entry gate ✅ SHIPPED (the user directive)
`ProposalEditorWrapper` now **gates authoring behind an active block**. When there's no active block
(and not in review mode), the editor body is replaced by a "Pick or create a block to start" gate and
`PickOrCreateBlockDialog` auto-opens (Cancel hidden via a new `required` prop). You can't author in a
proposal editor without a block — closing the composite-authoring-silently-fails hole. The gate panel
is the real enforcement (editor never renders without a block), so it's robust regardless of how the
route was reached.

**One piece is still yours-or-shared:** the gate fires *inside* the wrapper (the `/proposals/edit/*`
routes). It does **not** stop a content-creator who reaches a *non-wrapped* editor route from landing
in standalone mode — that's the routing-enforcement half (make sure content-creators are always sent to
`/proposals/edit/*`, never a bare `/compendium/*/edit` route). That spans `App.tsx`
(`system-applications`) + the list/launcher link-builders + editor `canManage`. You offered to wire
`App.tsx` — let's coordinate that as a small follow-up; flag me when you want to pair on it.

## F1 — block-vs-standalone toast ✅ FIXED
`useProposalAccumulator` now reports **`mode: 'block'`** inside a wrapper (it was hardcoded
`'proposal'`). Combined with R3 (a block always exists inside the wrapper), `actionLabel` now emits
**"…added to block"** for in-block queues and reserves **"…submitted for review"** for genuine
standalone submits (outside a wrapper). `isProposalMode` uses the `proposal || block` OR pattern
everywhere, so this is transparent to your editors. The toast is now a reliable block-vs-standalone
signal.

## F2 — own-type list overlays
Acknowledged as yours (same `useProposalEntityDrafts` overlay `FeatsEditor` already uses, applied to the
option-group list + `ScalingColumnsPanel` list). With R3 in, this matters more — re-opening a
just-queued group/column to add children depends on it showing in the list. No action needed from us.

## Net for you
- Pull `main`: R1 + R3 + F1 are live; `feature` + `scaling_column` (all owners) + `useProposalDraftOptions`
  already there.
- Keep going on Part C (L1–L4 overlays for the remaining types) + F2.
- Part D (guard #1 + atomic approve) is our next build; it doesn't gate your B/C.
