# Handoff — Live-content Bridge (2026-05-27)

> **Read first** (in order):
> - This handoff (you're here) — current state + pickup notes
> - [docs/roadmap.md § "Live-content bridge — Phase 2+ work"](roadmap.md) — the 5-phase plan + Phase 1 status
> - [docs/_drafts/foundry-enricher-deep-dive-2026-05-26.html](_drafts/foundry-enricher-deep-dive-2026-05-26.html) — working spec with full reference-enricher detail, the 4 use-case verdicts, and the architectural rationale for the live-fetch + drag-construct hybrid
> - [AGENTS.md](../AGENTS.md) — the non-negotiable rules (especially #2 INSERT OR REPLACE, #4 JSON column passthrough, #7 remote D1 permission)

---

## TL;DR

The **live-content bridge** is a planned multi-phase architecture that turns Foundry VTT from a "static content importer" into a "live viewer of canonical Dauligor content." Foundry windows fetch from `/api/module/*` instead of consuming pre-baked compendium documents, eliminating the stale-journal problem entirely. Mechanical drag-and-drop still creates real Foundry documents — but the JSON payload is fetched live + cached.

**Phase 1 foundation is shipped to `origin/main`** (commit `2b7dea4`). Phase 2 (read-only live viewer) is gated on an article-schema revamp that must land first. The full plan is in [roadmap.md](roadmap.md).

---

## What's shipped

### Class routing (2026-05-26 → main `a3ebb4f`)

User-facing class URLs migrated from primary-key form (`/compendium/classes/view/sjsnEpcMI1KSHbb1GeUO`) to `<identifier>_<sourceAbbrev>` slug form (`/compendium/classes/view/cleric_phb`), matching the 5etools-style convention already used by `useCompendiumHashLink` for the Feat / Spell / Item / Facilities browsers.

- New helper [src/lib/useClassRouteId.ts](../src/lib/useClassRouteId.ts) — `useClassRouteId()` hook + `buildClassSlug()` composer
- 3 routes in [src/App.tsx](../src/App.tsx) changed `:id` → `:slug` (admin only; `/proposals/edit/classes/edit/:id` intentionally keeps primary-key form because CREATE drafts use synthetic ids)
- 7 link sites across ClassList / ClassView / ClassEditor / SourceDetail / SpellList / SubclassEditor updated to build slugs

### Phase 1 foundation patches (2026-05-27 → main `2b7dea4`)

Three D1 migrations + one Foundry helper, all on local D1 only. **Remote D1 awaits per-migration permission per AGENTS.md #7.**

| File | Purpose |
|---|---|
| `worker/migrations/20260527-1400_composite_identifier_uniqueness.sql` | `UNIQUE(source_id, identifier)` on **spells**, **classes**, **subclasses**. Mirrors the pattern set by `20260526-2300_feats_items_composite_identifier_uniq.sql`. |
| `worker/migrations/20260527-1410_features_parent_scoped_identifier.sql` | `UNIQUE(parent_type, parent_id, identifier)` on **features** + fixes 1 pre-existing duplicate (Arcane Archer subclass had `arcane-archer-spells` slug on two features — buggy double-insert from May 2026 import; second row renamed to `arcane-quiver` to match its display name). |
| `worker/migrations/20260527-1420_content_hash_columns.sql` | `content_hash TEXT` column on spells / feats / items / classes / subclasses / features / unique_option_groups. Empty/NULL on existing rows; population happens in Phase 1.5 (see below). |
| `module/dauligor-pairing/scripts/foundry-id.js` | Deterministic Foundry document `_id` derivation. `foundryIdFromSourceId(sourceId)` returns a 16-char base62 string via SHA-256(MODULE_ID + ':' + sourceId). Stable across re-imports. Async (crypto.subtle); pre-warm pattern documented for sync `dragstart` handlers. |

**Remote D1 commands when ready (require explicit per-migration permission):**
```bash
npx wrangler d1 execute dauligor-db --remote --file=worker/migrations/20260527-1400_composite_identifier_uniqueness.sql --config worker/wrangler.toml
npx wrangler d1 execute dauligor-db --remote --file=worker/migrations/20260527-1410_features_parent_scoped_identifier.sql --config worker/wrangler.toml
npx wrangler d1 execute dauligor-db --remote --file=worker/migrations/20260527-1420_content_hash_columns.sql --config worker/wrangler.toml
```

Before running `--remote`: check current state of the remote DB with
`PRAGMA table_info(<table>)` to confirm the column / index isn't already there
from a parallel branch's work.

---

## What's next — in order

### 1. Phase 1.5 — hash-on-upsert wiring

`content_hash` columns exist but are NULL on every row. Need:

- App-side: compute SHA-256 of a canonical JSON serialization of the row's content fields on every upsert. Add the compute hook in [src/lib/d1.ts](../src/lib/d1.ts) `upsertDocument` or in the per-entity upsert helpers in [src/lib/compendium.ts](../src/lib/compendium.ts).
- Server-side mirror: same hook in any server-side upsert path (`api/_lib/d1-internal.ts`).
- One-shot backfill: a small script that walks every existing row, computes its hash, and persists.

Hash recipe (recommended):
```ts
const canonical = JSON.stringify({
  name: row.name,
  description: row.description,
  activities: row.activities,
  effects: row.effects,
  advancements: row.advancements,
  // ... explicit allowlist of content fields; exclude id, timestamps,
  //     caller-specific state
}, sortedKeys);  // deterministic key order
const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
const hex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
```

Phase 4 update-detection consumes this column — it's how the module's batch-status endpoint detects "this Fireball on the actor was authored against a stale version of the source."

### 2. Article system unification — blocks Phase 2

[lore_articles](../docs/database/structure/lore_articles.md) is the odd one out. Every other content table uses `(identifier, source_id)` as identity; `lore_articles` uses `slug + parent_id` (hierarchy-based). That's fine for the existing wiki but breaks down when articles need to participate in the reference-link system:

- `@article[deep-shadow-cult]` — what scope does the slug live in? Currently global, no namespacing. Two campaigns shipping articles with the same name collide.
- "System page" article type (parent + glossary children) needs addressable child identifiers that aren't just the parent's row id.
- Foundry-side `DauligorViewer` needs to compose stable deep-link URLs.

Recommended path (per [roadmap § "Article system unification"](roadmap.md#article-system-unification-blocks-live-content-bridge-phase-2)):

1. Migration: `ALTER TABLE lore_articles ADD COLUMN identifier TEXT NOT NULL DEFAULT ''`, backfill from `slug`.
2. Migration: `ALTER TABLE lore_articles ADD COLUMN source_id TEXT REFERENCES sources(id)`.
3. After backfilling + de-duping, migration: `UNIQUE(COALESCE(source_id, ''), identifier)`.
4. Add `content_hash TEXT` (matches Phase 1 pattern).
5. Update [src/pages/wiki/Wiki.tsx](../src/pages/wiki/Wiki.tsx) routes to consume identifier instead of slug.
6. Update BBCode (`src/lib/bbcode.ts`) `[article=…]` resolver to compile to identifier-based hrefs.

### 3. Phase 2 — read-only live viewer

The first time Foundry sees Dauligor reference-link content live. Per the roadmap's Phase 2 entry:

- New `GET /api/module/<source>/articles/<slug>` (full HTML, BBCode → HTML server-side) and `/articles/<slug>/summary` (short HTML for hover tooltips) endpoints
- `DauligorViewer` ApplicationV2 class in the module — opens when a `<a class="dauligor-link">` is clicked, fetches HTML, renders in a Foundry window
- Custom enricher registration via `CONFIG.TextEditor.enrichers.push(...)` for `@article[slug]`, `@condition[key]`, `@rule[key]`, etc.
- Hover tooltips populated via `data-tooltip-html` from lazy `/summary` fetches
- World-local cache (Foundry world `setFlag`) keyed by `kind/source/key/hash` — offline reads fall through
- "System page" article type (parent + glossary children) on the app side — mirrors dnd5e's Conditions / Rules journal structure

### 4. Phases 3-5

Sketched in [roadmap.md](roadmap.md). Phase 3 (drag-construct) depends on Phase 1's `foundry-id.js` + Phase 1.5's hash-on-upsert. Phase 4 (update detection) depends on Phase 1.5's hashes being populated. Phase 5 is hardening (offline snapshot button, auth audit, architecture doc).

---

## Open gotchas

### The harness keeps switching branches

Mid-session, automated commit + branch-switching has happened multiple times. Symptoms:

- `git switch -c <new-branch>` succeeds but you find yourself on the previous branch a few tool calls later.
- `git stash` succeeds but `git stash pop` happens against the wrong branch.
- Uncommitted work appears in the working tree from branches you weren't on.
- New commits appear in the log that you didn't author.

**What helps:**
- Do all branch-relevant operations in a **single Bash chain** so the automation can't insert a switch mid-flight (e.g. `git switch X && git rebase Y && git push origin X:main`).
- Use `claude/<descriptive-name>` branches that are clearly mine — other agents don't touch these.
- After every `git stash`, check `git stash list` to make sure your work landed in stash@{0}.
- After every `git switch`, verify with `git branch --show-current` before committing.

### Leftover stashes

Currently in the stash list (all from harness juggling, not new work):

```
stash@{0}: On feat/feats-tagging: harness-leaked WIP from feat/feats-tagging (pre-phase1-patches)
stash@{1}: On feat/feats-tagging: FeatsEditor TagPicker WIP (not class-routing — leaked during branch dance)
stash@{2}: On feat/compendium-ui-quickwins: wip-uncommitted from session start
```

`stash@{0}` and `stash@{1}` contain WIP from `feat/feats-tagging` that the other agent's pushes have *probably* captured. Cross-reference each stash's content against `origin/feat/feats-tagging` tip before dropping:
```bash
git stash show -p "stash@{0}" | head -50
git log --oneline origin/feat/feats-tagging | head -5
```
`stash@{2}` is a single `.claude/settings.local.json` change from session bootstrap — unrelated, leave it.

### Orphan claude/* remote branches

`origin/claude/class-slug-routes` and `origin/claude/phase1-foundation` exist on GitHub but their commits are already in `origin/main` (squash-merged via the `push origin claude/X:main` pattern). Safe to delete via:
```bash
git push origin --delete claude/class-slug-routes
git push origin --delete claude/phase1-foundation
```
Doing this also helps the harness — fewer branches = less to shuffle.

### Working tree untracked files (carried across sessions)

| File | Status |
|---|---|
| `cleanup-branches.bat` | Pre-existing; presumably a helper script for the orphan-branch cleanup above. Safe to keep. |
| `docs/_drafts/foundry-enricher-deep-dive-2026-05-26.html` | Working spec for the live-content bridge plan. **Roadmap points to this — do not delete until Phase 2 ships its own architecture doc.** |
| `docs/handoff-foundry-alignment-2026-05-25.md` | Older handoff, superseded by `docs/handoff-compendium-shell-2026-05-25.md` per its own header. Safe to delete when ready. |

---

## Conventions to honor

### From AGENTS.md (rules 1-7)
- **No `INSERT OR REPLACE`** — cascade-delete bug; always `ON CONFLICT(id) DO UPDATE`
- **No backwards-compat dual reads** — update sources to fit new schema
- **`queryD1` JSON column passthrough** — `typeof X === 'string' ? JSON.parse(X) : (X ?? <default>)`
- **Drift-managed `api/_lib/_*.ts` sibling pairs** — touch both `src/lib/X.ts` AND `api/_lib/_X.ts` for `classExport`, `classProgression`, `referenceSyntax`, `requirements`
- **D1 migrations: local first, remote with explicit per-migration permission** — this is THE rule that gets accidentally violated under time pressure

### From recent sessions (memorialized)
- **No push to `origin/main` without explicit green-light in current conversation**
- **`Foundry module junction`** — `%LOCALAPPDATA%\FoundryVTT\Data\modules\dauligor-pairing` is an NTFS junction → repo `module/dauligor-pairing`. Never repoint at a `.claude/worktrees/*` sandbox.
- **Survey first, no DB touches** — verify code against doc claims before refactoring
- **Don't touch contents of complex pages** — ClassView / ClassEditor specifically; their content is intentional even when it looks visually different from desired end-state

### For the live-content bridge specifically
- **Foundry's enricher system is the right extension point** — register custom enrichers via `CONFIG.TextEditor.enrichers.push(...)`. **Do not override** `TextEditor.enrichHTML` or its pipeline stages; that would break interop with dnd5e and every other module.
- **Where dnd5e already covers a case, ride it** — `&Reference[condition=prone]` works for SRD conditions, skills, abilities, damage types, etc. The viewer only needs to handle Dauligor-specific entity kinds.

---

## Delete this handoff when

- Phase 1.5 hash-on-upsert wiring has landed
- The article schema revamp has landed (lore_articles has `identifier` + `source_id` + composite UNIQUE)
- Phase 2 has started in earnest with its own architecture doc at `docs/architecture/live-content-bridge.md` and the planning content folded into that
