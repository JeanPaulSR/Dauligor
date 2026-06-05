# Handoff — manual-uploads import system (state snapshot)

**Date:** 2026-06-05 · **Branch:** `manual-uploads` · **Author:** Claude

A snapshot so a fresh context can continue the import work without re-deriving everything. (Supersedes the earlier "pre-compaction" snapshot — that captured only the manual-entry PoC; the text interpreter, mark-up workspace, batch, preview, format templates and HTML capture have all since shipped and are committed.)

## TL;DR

The **Mark & Build** window (`/compendium/import`, admin-only) is now a **text-interpreting importer**: paste a spell as plain text, PDF-wrapped text, or **HTML**, and it parses the 5e stat block into the structured fields, lets you fix anything by **selecting text and assigning it to a field**, shows a **live detail-pane preview**, handles **batch** pastes with an editable division editor, and writes through the **editors' real `upsertSpell`** so a created row is byte-identical to a hand-edited one. **Spells** are the proven type; the engine is generic (descriptor hooks) so feat/item/class can plug in next.

## Branch state

- On `manual-uploads`, **10 commits ahead / 5 behind `origin/main`** (origin advanced during the session; count includes this handoff refresh). Working tree clean except the untracked throwaway `scripts/_mint-token.mjs` (see token note). **NOT pushed** (local only). **Rebase onto `origin/main` before any merge/cherry-pick to main** (`git fetch origin && git rebase origin/main`).
- Commits (newest first):
  - `docs(handoff): compaction-ready import system snapshot` (this refresh)
  - `docs(import): component guide + how-to-add-a-type recipe` (**`cc6e296`** — adds `docs/architecture/import-system.md`)
  - `docs(handoff): refresh import system snapshot — interpreter, mark-up, batch, HTML` (**`bdc3cf9`**)
  - `feat(import): text-interpreting Mark & Build — parser, mark-up workspace, batch, HTML` (**`d49444f`** — this session's arc, one cohesive commit; the 5 files were rewritten across features so a per-feature split wasn't clean)
  - `docs(handoff): import system state snapshot (pre-compaction)`
  - `feat(import): persistent source picker + empty-source warning`
  - `chore(dev): branch dev stack launcher on port 3003`
  - `feat(import): manual-uploads import system (spells proof of concept)`
  - `docs(local-dev): D1 seed via schema-then-data; add refresh note`
  - `docs(auth): correct framing to native session tokens (Firebase = fallback)`
- The two `docs(...)` commits are cherry-pick candidates for `main` (they fix stale info everyone reads). **Never push to `main` without the user's explicit, in-conversation OK** — every push to main is a prod deploy. Show `git log origin/main..HEAD` first.

## Architecture (current)

**`src/lib/import/`** — pure, front-end-agnostic core:
- `types.ts` — `ImportDescriptor`, `ImportFieldDef`, `ResolvedEntity`, plus the interpreter types: `ParsedField` (value + `confidence` high/low/none + `span`), `ParseResult`, `ImportAssignTarget`. Descriptor optional hooks: **`parseText`**, **`assignTargets`/`assignField`**, **`splitBlocks`**.
- `registry.ts` — `resolveEntity` / `commitEntity` (unchanged fidelity path) + the interpreter wrappers: `parseEntityText`, `canParseText`, `getAssignTargets`, `assignFieldText`, `splitEntityBlocks`.
- `spell.ts` — spell descriptor. `buildPayload` mirrors `SpellsEditor.handleSave`; `commit` calls the REAL `upsertSpell` (materializes the activation/range/duration/shape buckets). Now also wires `parseText`, `splitBlocks`, `assignTargets` (name / level / school / castingTime / range / components / duration / description) and `assignField`.
- **`spellParse.ts`** (NEW, pure) — the deterministic 5e stat-block parser. Modular: `parseLevelSchool` (separate level/school spans, named `cantrip`/`tail` groups), `classifyCastingTime/Range/Components/Duration`, `classifyLevel/classifySchool`, `normalizeSpellName` (Capitals-At-The-Start, strips `[bbcode]` wrappers), `reflowDescription` (period-ends-paragraph + hyphen rejoin), `splitSpellBlocks` (name-line→level/school boundary). Regexes tolerate inline BBCode tags so HTML→BBCode labels still parse.
- `index.ts` — barrel.

**`src/pages/compendium/ImportMarkWindow.tsx`** — the window (route + sidebar entry append-only in App.tsx / Sidebar.tsx, admin-gated). Pieces:
- **EntityWorkspace** (extracted, reusable) — annotated source text (left, gold-highlighted per field span, hover-link + select-to-assign popover) ↔ structured fields (right) with a **Fields / Preview** tab. Used by single mode AND each batch candidate's Review.
- **Single mode** — action bar (name/identifier/source + Create) + EntityWorkspace + "Edit text" / "Divide".
- **Batch mode** — `DivisionEditor` (left: gold bars per spell, hover `＋ split`, `Merge up` on each bar) + candidate list (right: name, flag count, leftovers, checkbox, Review) + "Create N".
- **HTML capture** — `onPaste` reads the `text/html` clipboard flavour; `htmlToSiteBbcode` parses it with **DOMParser** + schema-style DOM normalization (`normalizeClipboardDom`: promote inline styles → em/strong/u, rename `<b>/<i>` → clean tags, strip attrs, drop `<o:p>`/style/comments), then the canonical `htmlToBbcode(cleanFoundryHtml)`. `normalizeInput` does the same for literal-HTML-as-text on interpret. Toast "Captured HTML formatting" on a rich paste.
- **Format templates** — `Save as format` captures target→line-index from one marked-up spell into `localStorage['dauligor:importFormat:<type>:<source|default>']`; auto-applied over the heuristic parse on later interprets. "Format saved" badge + Clear in the source row.
- **Live preview** — `renderPreview` (spell only) feeds the real `SpellDetailPanel` via its `spellData` prop, adapting the resolved payload (derives `foundry_data.properties` + `materials`).
- Styling: theme tokens only per `docs/ui/style-guide.md` (gold = accent/highlight, blood = warnings, `.config-fieldset`/`.field-label`/`.btn-gold-solid`/…). No raw palette.

## Fidelity contract (CRITICAL when extending to new types)

Each descriptor's `commit()` MUST call the editor's real write function with the verbatim payload — **never reimplement the D1 write layer.** Verified per-type save paths live in `docs/_drafts/manual-uploads-import-system-2026-06-04.html`. Summary:
- **spell** → `upsertSpell(id, payload)`; **feat** → `upsertFeat`, **item** → `upsertItem`, **feature** → `upsertFeature` (+ `queueRebake('feature', id)`).
- **class** → `upsertDocument('classes', id, d1Data)` + `queueRebake('class', id)`; **subclass** similar (+ `class_id`, `class_identifier`).
- options / species / background / facility / source / system pages / spell_rules → direct `upsertDocument(collection, id, payload)` (or `saveRule`/`saveSystemPage*`).
- Universal idioms: `id` = `existingId ?? crypto.randomUUID()` (separate positional arg); `identifier = identifier.trim() || slugify(name)`; `tag` column is `tag_ids` for class/subclass, `tags` elsewhere; legacy tables snake_case, `backgrounds`/`species`/`species_options`/`background_features` camelCase.

## Verified this session (live on :3003 → local D1)

- Interpreter end-to-end: Hold Person, Black Hole (class list → leftover), Annihilation Disk (ALL-CAPS name), Arboreal Curse, cantrips (level highlights "cantrip"), ritual line. Real creates landed in D1 with correct `foundry_data` + materialized buckets (e.g. Batch Epsilon Ward: conc=1, bonus, minute/10).
- Mark-up: select-to-assign re-runs the classifier (corrupt range self/0 → select "60 feet" → ft/60); hover-link both ways; separate Level/School targets.
- Batch: 3-spell paste → 3 candidates; manual split 3→4 and merge 4→3; bulk-create → 3 correct rows.
- Format template: saved from a non-standard layout (school line / level line separate) → a second same-layout spell auto-parsed level 5 / nec.
- HTML: web-page, Word (mso/`<o:p>`), and Google-Docs (`<span style>`) clipboard payloads → clean `[b]/[i]` BBCode, no CSS/tag/comment leak; description renders italic in the Preview.
- `tsc --noEmit`: 0 errors in import files (project total still the 6 known pre-existing `asChild`/`characterShared`).

## Dev / test setup (how to resume)

- **Local D1 seeded from remote** (84 tables, ~4.3k rows, FK-clean). Method = schema-then-data (`docs/operations/local-dev.md`). Has throwaway test spells (Batch *, Restart Check Bolt, Interpreter Test Bolt…) — local only, gone on reseed.
- **Dev stack on :3003** — `node scripts/dev-manual-uploads.mjs` (app 3003, worker 8790, inspector 9232; app **no-watch** — restart or reload the page to pick up source edits). Or `preview_start("manual-uploads")` (`.claude/launch.json`) → `serverId` changes each start; `preview_list` to get the current one. The stack survived a PC restart once (preview reused it); if it drops, `preview_start` again.
- **`.env` + `worker/.dev.vars`** copied from the parent repo (gitignored). `.env` has a local-only **`AUTH_JWT_SECRET`**.
- **Logging in for browser tests** (seeded users are prod rows with unknown passwords): `node scripts/_mint-token.mjs` prints an admin JWT (HS256, iss `dauligor`, aud `dauligor-app`, sub `n65elKlUnDhN8lGAiI1MfETUsHO2`, signed with `.env`'s `AUTH_JWT_SECRET`); inject with `localStorage.setItem('dauligor:authToken', <jwt>)` then reload. The script is **untracked** (throwaway, reads `.env`) — keep it out of commits. Browser localStorage clears on PC restart → re-inject.
- **Query local D1** through the running worker: `POST http://localhost:8790/query` with `Authorization: Bearer <API_SECRET from worker/.dev.vars>` and `{sql, params}`.

## Gotchas

- **Source-less entries are hidden from the public browsers** (filter by source); the window warns on empty source.
- **Worktree dev server must be no-watch** (`tsx watch` restart-loops on the junctioned `node_modules/.vite-temp`). Never `npm install` in a worktree. After a source edit, **reload the page** (no-watch won't auto-pick-up).
- **D1 seed is schema-then-data** + non-idempotent (wipe `worker/.wrangler/state/v3/d1`, stop the worker first). `PRAGMA integrity_check` blocked on local D1; use `foreign_key_check`. Big `UNION` count hits D1's compound-SELECT cap — chunk it.
- **`preview_screenshot` timed out the entire session** (capture-pipeline issue, not the page); verify via `preview_snapshot` / `preview_eval` instead. A `preview_eval` returning `{}` is a serialization quirk — return a string to confirm liveness.
- HTML clipboard reality: a `<textarea>` only gets `text/plain`; the rich `text/html` is captured by the `onPaste` handler. PDFs put only `text/plain` on the clipboard → formatting unrecoverable. `htmlToBbcode`'s raw `<i>` handler is buggy (leaves a stray `<`) and `<b>`/`<strong>` matchers are attribute-free — hence the DOM normalization (rename to clean `<strong>/<em>`, strip attrs) before conversion.
- Vite HMR WebSocket `24678` clash is cosmetic.

## Next work (open)

1. **Extend descriptors** using the fidelity table: feat / item / feature (helper path — easy), then class/subclass (`upsertDocument` + `queueRebake`), then options / species / background / facility / source. Each new type with a `parseText` gets the whole workspace (mark-up, batch, preview, format) for free.
2. **Activities stay out of scope** for the importer by design — author them in the spell editor after creating.
3. **Promote** the design draft (`docs/_drafts/manual-uploads-import-system-2026-06-04.html`) into `docs/features/` once the feature broadens past spells.
4. Consider committing the untracked test artifacts cleanup / a `.gitignore` line for `scripts/_mint-*.mjs` if it keeps reappearing.

## Pointers

- **Component guide + "how to add a type" recipe: [`docs/architecture/import-system.md`](../../docs/architecture/import-system.md)** — read this first when building the class/feat/item importers.
- Design spec (per-type save-path table): `docs/_drafts/manual-uploads-import-system-2026-06-04.html`.
- Branch manifest: `handoffs/manual-uploads/manifest.md`; registry row in `handoffs/BRANCH_REGISTRY.md`.
- Relevant memory: `reference_style_guide`, `project_d1_local_seed_method`, `project_worktree_node_modules_junction`, `feedback_main_is_production_deploy`, `feedback_handoffs_folder`.
