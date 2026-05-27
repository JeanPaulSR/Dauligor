# Branch: `compendium-management`

---

Started: 2026-05-27
Owner: Claude (next agent to pick up the compendium-domain track)
Goal: Coordinate ongoing compendium-domain work — feat / spell / item / class editors, compendium browser shells, Foundry export pipeline for those entities, and cross-cutting cleanup that touches the compendium surface.
Status: **active**

## Background

`feat/feats-tagging` shipped the feat tagging system (TagPicker wiring, tag-axis filters, Foundry rebake plumbing, and on 2026-05-27 the FeatsEditor `tagIds` save-payload fix + the repo-wide Firestore reference scrub). Those commits are on `origin/feat/feats-tagging` (`292f193`, `dc3e777`) awaiting merge — see the 2026-05-27 handoff in this folder.

This branch is the umbrella for the compendium track going forward, separated from `feat/feats-tagging` so further session work doesn't tangle with that branch's pending merge. Future compendium-touching work either lands here directly or branches off here as `feat/compendium-<topic>` and the handoff records the trajectory.

## Primary files (exclusive)

No files claimed exclusively right now — `feat/feats-tagging` still has the compendium editor files in flight (FeatsEditor, FeatList, FeatDetailPanel, AdvancementManager touches). Claim per future task as work starts.

When new work begins, the candidate domain to claim from this branch:
- `src/pages/compendium/FeatsEditor.tsx` (after `feat/feats-tagging` merges)
- `src/pages/compendium/SpellsEditor.tsx` / `ItemsEditor.tsx` / `ClassEditor.tsx` (compendium editor parity work)
- `src/components/compendium/CompendiumEditorShell.tsx`, `CompendiumBrowserShell.tsx` (shell-level adjustments)
- `src/components/compendium/FeatDetailPanel.tsx`, `SpellDetailPanel.tsx`, `ItemDetailPanel.tsx`
- `api/_lib/_featExport.ts`, `_spellExport.ts`, `_itemExport.ts`, `_sourceFeatList.ts`, `_sourceSpellList.ts` (Foundry export pipeline for compendium content)

## Shared files (append-only)

Standard shared utilities — append-only discipline applies. See [BRANCH_REGISTRY.md § "Shared files (append-only) examples"](../BRANCH_REGISTRY.md#shared-files-append-only-examples).

- `src/lib/compendium.ts` — `normalizeCompendiumData` / `denormalizeCompendiumData` mapping tables, `upsertX` helpers
- `src/lib/d1.ts` — `jsonFields` auto-parse list
- `src/lib/d1Tables.ts` — table-name registry
- `src/App.tsx` — route definitions
- `src/components/Sidebar.tsx` — nav links
- `worker/migrations/` — new timestamped migrations
- `docs/roadmap.md` — update entries as work ships
- `AGENTS.md` — append guardrails / coordination notes only

## Open requests to other branches

- [ ] `(2026-05-27)` `feat/feats-tagging` — once those commits land on `main`, this branch can rebase and pick up the FeatsEditor + Foundry export work without conflict. Tracked in the 2026-05-27 handoff.

## Handoff log

Newest at the top.

- 2026-05-27 — [2026-05-27-firestore-scrub-and-feat-tagids.md](2026-05-27-firestore-scrub-and-feat-tagids.md) — FeatsEditor tagIds save fix + repo-wide Firestore reference scrub (both shipped on `feat/feats-tagging`)

## When to retire this manifest

This is a long-lived coordination branch by design, so retirement happens when the compendium domain is effectively dormant — no active editor / browser / export pipeline work for an extended period. At that point either merge the branch (if it carries unique commits beyond the handoff folder) or delete the row from `BRANCH_REGISTRY.md` and let the folder linger as institutional memory.

In the near term: do NOT retire while `feat/feats-tagging` is unmerged.
