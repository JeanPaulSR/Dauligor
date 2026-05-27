# Handoff — Firestore scrub + FeatsEditor tagIds fix (2026-05-27)

> **Read first** (in order):
> - This handoff (you're here) — what shipped on `feat/feats-tagging` on 2026-05-27 + verification + pickup notes
> - [manifest.md](manifest.md) — branch scope and shared-files protocol for `compendium-management`
> - [../README.md § "The shared-files protocol"](../README.md#the-shared-files-protocol) — coordination rules when this branch needs to touch files owned by another active branch
> - [../../AGENTS.md](../../AGENTS.md) — the non-negotiable rules (especially #1 D1-only data access, #4 JSON column passthrough, #7 remote D1 permission)

---

> **Status:** shipped on `feat/feats-tagging`. Two commits pushed to `origin/feat/feats-tagging`:
>
> - `292f193` `fix(compendium): persist tagIds on feat save`
> - `dc3e777` `chore(repo): scrub Firestore references from code, docs, and archived scripts`
>
> Branch is up-to-date with origin. Working tree on `compendium-management` is clean except for this handoff folder.

---

## TL;DR

1. **FeatsEditor was silently dropping tag changes on save** — the explicit-list save payload never included `formData.tagIds`. Fixed: one-line addition, downstream `upsertFeat` already renames `tagIds → tags`. Persists immediately and shows up in the Foundry feat-browser's tag flags within the live endpoint's 60-second HTTP cache window.

2. **Firestore audit + scrub.** The migration to Cloudflare D1 finished weeks ago, but stray "Firestore" mentions kept appearing in audits and confusing readers (including me, earlier in the session). All references outside `docs/_archive/` are now gone. The codebase reads as if D1 was always the database.

---

## What changed (`dc3e777` — Firestore scrub)

### Code (12 files, comments-only)

| File | Change |
|---|---|
| `src/lib/firebase.ts` | Dropped the "do not reintroduce `firebase/firestore` imports" guardrail comment; simplified `OperationType` preamble and `reportClientError` JSDoc (removed references to the long-gone `handleFirestoreError`) |
| `src/lib/d1.ts` | `fetchCollection` / `fetchDocument` JSDoc no longer mention "Firestore fallback support was removed" — just describe what they do now |
| `src/lib/compendium.ts` | Forbidden-field comment for `source` no longer attributes it to "Firestore publication metadata" |
| `src/lib/classExport.ts` + `api/_lib/_classExport.ts` | Empty-image-variant note dropped the parenthetical "(Firestore didn't carry the field)" |
| `api/_lib/_classSpellList.ts` | "Typically the original Firestore document id" → "a stable opaque string"; dropped the cross-ref to a soon-to-be-renamed section |
| `src/pages/sources/Sources.tsx` | `reloadPage` comment no longer references the historical `resetFirestore()` helper |
| `src/pages/characters/CharacterBuilder.tsx` | No-op fall-through branch comment no longer frames itself as "preserving the Firestore version's behavior" |
| `src/components/compendium/SpellImportWorkbench.tsx` | tagGroup client-side filter rationale dropped "Firestore query previously filtered server-side" framing |
| `module/dauligor-pairing/scripts/spell-preparation-app.js` | Source-id lookup comment: "legacy Firestore-style ids" → "legacy opaque ids" |
| `server.ts` | Placeholder `/api/characters/:id/json` endpoint rewritten without "in a real app we'd fetch from Firestore"; password-reset endpoint's "legacy Firestore write of …" note removed |

### Config (1 file)

- `firebase-applet-config.json` — dropped the unused `firestoreDatabaseId` key. `firebase/auth` doesn't read it.

### Docs (34 files)

The docs subagent scrubbed all active docs in `docs/`, plus `AGENTS.md`, `README.md`, `DIRECTORY_MAP.md`, and three module-side canonical docs (per per-doc permission grant). Approach:

- **Pure historical mentions** ("this used to live in Firestore") — deleted outright
- **Whole "Migration history (Firestore → D1, May 2026)" sections** in every `docs/database/structure/*.md` file — removed; standalone current-state content preserved under non-historical headings
- **Side-by-side "before/after" tables** — collapsed to the current state
- **Section renames + cross-reference updates** — e.g., `compendium-editor-patterns.md`'s `#post-migration-cleanup-roadmap` anchor renamed to `#cleanup-roadmap`; back-references in `docs/README.md` updated to match
- **`auth-firebase.md`** — "What's kept vs. what's gone" table rewritten as "Surface area"

The subagent's first pass kept 6 `firebase/firestore` import guardrails as technical rules; I overrode that choice (you explicitly chose "drop the guardrail too") and rephrased them positively — "All data access goes through `src/lib/d1.ts`" — across `AGENTS.md`, `DIRECTORY_MAP.md` ×2, `docs/platform/runtime.md`, `docs/database-memory.md`, `docs/features/spellbook-manager.md`.

~165 mentions removed across 34 docs.

### Deletions (10 archived scripts)

These were never imported and never invoked by build or runtime — one-shot migration / debug tools that imported `firebase-admin/firestore`:

- `scripts/_archive/check_firestore.js`
- `scripts/_archive/cleanup-firestore-orphans.js`
- `scripts/_archive/_audit_field_drift.js`
- `scripts/_archive/delete-replaced-sorcerer-set.js`
- `scripts/_archive/rename-blade-of-disaster.js`
- `scripts/_archive/migrate.js`
- `scripts/_archive/migrate_subclasses.js`
- `scratch/inspect_class.js`
- `scratch/inspect_feature.js`
- `scratch/inspect_subclass.js`

---

## What changed (`292f193` — FeatsEditor tagIds fix)

Single line addition in `src/pages/compendium/FeatsEditor.tsx`'s `handleSave` payload object, between `advancements` and `requirements_tree`:

```ts
tagIds: Array.isArray(formData.tagIds) ? formData.tagIds : [],
```

`upsertFeat` in `src/lib/compendium.ts` already handles the rename:

```ts
if (normalized.tagIds !== undefined) {
  normalized.tags = normalized.tagIds;
  delete normalized.tagIds;
}
```

The bug existed because `SpellsEditor` spreads `...formData` (which captures `tags` since its formData uses `tags: string[]`), but `FeatsEditor` enumerates the payload fields by hand and missed `tagIds`. The TagPicker would update `formData.tagIds`, the user would click Save, the upsert would run, and the `tags` column in D1 would not be touched — `ON CONFLICT(id) DO UPDATE SET <col> = excluded.<col>` only updates columns present in the payload, so existing tags were preserved (not wiped), but new tag edits never persisted.

Foundry-side symptom: the per-source feat list endpoint reads `row.tags` for the lightweight summary's `tagIds` flag, so stale tags here surfaced as wrong filter chips in the importer's per-source feat picker.

---

## What was deliberately preserved

| Path | Why |
|---|---|
| `docs/_archive/**` (16 files still contain "Firestore") | Historical paper trail. Includes `firestore-cut-punchlist.md`, `firestore-schema.md`, `troubleshooting-firestore-era.md`, archived versions of `core-concepts`, `auth-and-identity`, etc. |
| `module/dauligor-pairing/data/**/*.json` | Static snapshot data with "firestore" embedded inside JSON values from old exports. Not code. |
| `firebase-applet-config.json` keys other than `firestoreDatabaseId` | `firebase/auth` still reads `projectId`, `appId`, `apiKey`, `authDomain`, `storageBucket`, `messagingSenderId` |
| `firebase/auth` imports (`src/lib/firebase.ts`) | Firebase Authentication is still the JWT layer — distinct from Firestore. Exit plan tracked separately. |

---

## Verification

| Check | Result |
|---|---|
| `grep -ril "firestore" src api functions server.ts firebase-applet-config.json module/dauligor-pairing/scripts module/dauligor-pairing/docs` | **0 matches** |
| `grep -ril "firestore" docs AGENTS.md README.md DIRECTORY_MAP.md` (excluding `docs/_archive/`) | **0 matches** |
| `grep -ril "firestore" docs/_archive` | 16 matches (expected, preserved) |
| `npx tsc --noEmit` | No new errors in any touched file. 6 pre-existing errors in unrelated files unchanged: Button `asChild` prop drift in `CompendiumBrowserShell.tsx`, `CampaignEditor.tsx`, `SpellList.tsx`, `LoreEditor.tsx`; signature mismatch in `characterShared.ts` |
| `git status --short` after final push | Clean (only 3 pre-existing untracked files: `cleanup-branches.bat`, `docs/_drafts/foundry-enricher-deep-dive-2026-05-26.html`, `docs/handoff-foundry-alignment-2026-05-25.md`) |

---

## Resume notes for the next agent

### How to verify the FeatsEditor fix manually

1. Open `/compendium/feats?editingId=<existing-feat-with-no-tags>`
2. Tags super-tab → add 2-3 tags via TagPicker
3. Click Save → preview pane refreshes (the `previewBustKey` fix from earlier in this branch handles that)
4. Refresh the page → tags should still be there (this was broken before the fix)
5. Optional Foundry check: open Foundry, importer wizard → Feats → pick the same source → see the just-tagged feat's `flags.dauligor-pairing.tagIds` populated correctly. The endpoint has a 60-second HTTP cache, so allow a minute if you just saved.

### How to verify the firestore scrub

```bash
# Should print nothing:
grep -ril "firestore" src api functions server.ts firebase-applet-config.json module/dauligor-pairing/scripts module/dauligor-pairing/docs
grep -ril "firestore" docs AGENTS.md README.md DIRECTORY_MAP.md | grep -v "^docs/_archive/"

# Should print 16:
grep -ril "firestore" docs/_archive | wc -l
```

If any active-code or active-doc match returns, it's something added since 2026-05-27 — investigate that change rather than re-running the scrub.

### Branch-dance hazard

The session harness in this project sometimes swaps the working tree between branches mid-session when multiple agents are active. During this session I was silently moved from `feat/feats-tagging` to `claude/phase1-foundation` once, and another agent moved me back to `claude/phase1-foundation` again after I'd switched to `feat/feats-tagging`. Both times the work was recoverable via `git stash list` + `git stash apply` — auto-generated stash messages like `"harness-leaked WIP from feat/feats-tagging (pre-phase1-patches)"` flag the event.

Defensive habits if you're working on this codebase:

1. Run `git branch --show-current` before any commit
2. After any `git stash` or branch checkout that wasn't yours, check `git stash list` for an auto-generated harness stash
3. Push frequently to a feature branch so committed work survives the dance even if uncommitted work doesn't

### Out of scope follow-ups

The scrub is complete for "remove the word Firestore" — but adjacent cleanup opportunities surfaced:

| Item | Status |
|---|---|
| Delete `docs/_archive/` entirely | Not done. You chose to preserve as historical paper trail. Can be done in a future cleanup pass if you want a leaner repo. |
| Pre-existing TS errors (Button `asChild` drift × 5 files, `characterShared.ts` signature) | Untouched. Unrelated to this work; should be its own task. |
| `scripts/_archive/` still contains 7 non-Firestore archived scripts (`_audit-*.py` × 7, `_drift_report.txt`, `_rename_error_helper.mjs`, `_rewrite_fetchers.mjs`) | Left alone. Not in scope (no Firestore mentions). Candidate for separate archive sweep if desired. |
| `scratch/verify_foundation.js` | Left alone. No Firestore reference; not in scope. |
| Two module canonical docs (`spell-preparation-manager-guide.md`, `class-semantic-export-notes.md`) were scrubbed under explicit per-doc permission you granted — the module-side agent should be aware if they revisit those docs |
| `module/dauligor-pairing/docs/schema-crosswalk.md` had been scrubbed earlier by a prior sub-agent in this branch's history | Already clean before this session's work; left as-is |

---

## Cross-references

- `AGENTS.md` § "Non-negotiable rules" (rule #1 rephrased — now describes the positive D1 contract rather than the negative Firestore prohibition)
- `DIRECTORY_MAP.md` (firestore guardrail mentions removed from the `src/lib/firebase.ts` row and the "Add a D1 query path" workflow row)
- `docs/database-memory.md` § "Status" (migration-history section deleted; status reads as steady-state)
- `docs/platform/auth-firebase.md` (rewritten "Surface area" section in lieu of the former "What's kept vs. what's gone" table)
- `docs/platform/runtime.md` § "Process boundaries / what runs where" (positive D1 phrasing in place of "no `firebase/firestore` imports")
- `module/dauligor-pairing/docs/import-contract-index.md` is the master index for module-side canonical contracts — module-side agents working in that tree should consult that index first

---

## Commit graph (after this work)

```
dc3e777 (HEAD, origin/feat/feats-tagging) chore(repo): scrub Firestore references...
292f193 fix(compendium): persist tagIds on feat save
e0b2ef9 fix(feats): rebake catalog immediately on feat save instead of queueing
c774fdb feat(module-export): treat feat saves as catalog-rebake events
a1f5b4d fix(feats): bust FeatDetailPanel cache after save so preview updates
75fe288 fix(feats): scope FeatsEditor tag groups to feat classifications
a39a618 fix(feats): seed tagIds on FEAT_DEFAULTS to prevent empty-form crash
bd2391b feat(feats): add tag-axis filter to FeatList browser
d87d10b feat(feats): wire TagPicker into FeatsEditor (Tags sub-tab)
```

The 7 commits below `dc3e777` are the feats-tagging system this branch was created for; the two commits at the top are the polish work from this 2026-05-27 session. Branch is ready to merge once the feat-tagging system is signed off independently.
