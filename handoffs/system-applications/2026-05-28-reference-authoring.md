# Handoff — Reference Authoring (2026-05-28)

Pickup context for the **reference-authoring** track on branch `system-applications`,
after BBCode-audit work and the live-content-bridge re-prioritisation. Written before a
context compaction.

## TL;DR

Building a Foundry-aligned **reference system** (cross-links between content) on the app side.
The spec is **locked**. Phases 1–3 are shipped on the branch (local, not pushed). Phase 3
(the inline `@`/`&` autocomplete) **just landed and is awaiting the user's in-browser
confirmation** — they were about to test on `/dev/bbcode`. Remaining: **P4 hover card**,
**P5 summary field**.

## Read first

- **Locked spec**: `docs/_drafts/reference-system-spec.html` — the full contract.
- **Hover card design**: `docs/_drafts/feat-hover-card-concepts.html` — Concept A + pin/nest, built on real feats.
- Both are **local drafts, NOT pushed to main** (per user: only push docs once it's real
  functionality, not forward specs).
- Manifest: `handoffs/system-applications/manifest.md`. Memory:
  `project_system_applications_architecture.md` (has full phase status + decisions).

## Branch state

- `git branch --show-current` → `system-applications`. **25 commits ahead of `origin/main`**, working tree clean.
- **Branch is NOT pushed** to origin (local only).
- **Docs ARE on main** already (synced earlier at `19ea010`): `handoffs/` structure +
  `docs/system-overview.html` + `docs/roadmap.html`. The reference _drafts are NOT on main.
- A `system-applications-backup` local branch exists (pre-rebase safety from the doc-sync rebase).

## The locked spec (decisions)

- **Grammar** (Foundry-aligned, replaces the retired `[ref|kind|id]…[/ref]`):
  - `@kind[semantic-id]{display}` — entity reference (`@` sigil)
  - `&kind[semantic-id]{display}` — rule reference (`&` sigil; reuse dnd5e `&Reference` on the Foundry side)
  - optional `#anchor` after the id for section deep-links
  - `{display}` optional; falls back to a humanised id
- **Semantic ids, NEVER raw Foundry UUIDs.** App stores `kind[slug]`; the module translates to
  `@UUID`/`&Reference` at import (deferred bridge). Non-negotiable.
- **Kinds**: `spell, class, subclass, feat, item, condition, article` (+ `race`/`background` when
  those tables exist). `@` = entity family (spell/class/subclass/feat/item/article); `&` = rule
  family (condition).
- **Editor = plain editable text**, NOT atomic chips. References only render in the *reader*; in
  the editor they stay as `@kind[id]{Name}` text. This is the user's explicit call and it kills
  the old corruption-on-edit bug.
- **Hover card = Concept A**: name + kind badge + prereq + scrollable summary; source in the
  footer; NO "open" arrow; **pin button → pops out a draggable, persistent window** (follows you
  across navigation) with a "Go to" row; **nested pop-ups** (hovering a truncated prereq or an
  inner ref opens a child card; child never closes parent).
- **Prereq source**: `requirements_short_text`, else the automated combined requirements; truncation
  → nested popup with the full text.
- **Summary field**: add a brief "summary" field to articles + any kind lacking one. NOTE:
  `lore_articles` already has `excerpt`; `classes` has `preview`. Many rows are empty though.
- **No migration** — old `[ref|…]` was unused; nothing to carry over.
- **Build order**: reference authoring first; the **condition↔article attachment** (let a condition
  link to an article section) is a *separate later track* that depends on the article-identifier
  revamp. **That attachment does NOT exist yet** (verified: not in `AdminProficiencies.tsx` or
  `StatusesEditor.tsx`).
- **Deferred**: dynamic/query references ("all CR 1 creatures"); Foundry-side resolution (the bridge).

## What's built (commits on branch)

| Commit | Phase | What |
|---|---|---|
| `7edfe00` | P1 | Grammar parser/renderer in `src/lib/bbcode.ts` |
| `53fffd1` | — | `/dev/bbcode` presets use real DB ids |
| `a290ebd` | P2 | `src/lib/references.ts` resolve/search helper |
| `aa3596f` | P3 | `src/components/ReferenceAutocomplete.tsx` inline `@`/`&` autocomplete |

### P1 — `src/lib/bbcode.ts` (+ `api/_lib/_bbcode.ts`)
- `bbcodeToHtml(text, context)` renders `@kind[id]#anchor{display}` / `&amp;kind[id]…` (the `&`
  arrives escaped as `&amp;` after the XSS pass) to `<a class="ref-link ref-<kind>" data-ref-*>`
  for routed kinds, `<span class="ref-link ... ref-dangling">` for unrouteable kinds (subclass +
  unknown today). Gated on **`context.editor`** — skipped in the editor so refs stay as text.
- `export function resolveRefRoute(kind, id, anchor?)` — kind→route map (spell/class/feat/item→
  `?focus=`, condition→`/admin/statuses?focus=`, article→`/wiki/article/`; subclass/unknown→null).
- `humanizeRefId(kind, id)` — fallback display.
- `BbcodeViewContext.editor?: boolean` added. `RefKind` updated. Old `[ref|…]` forward+reverse removed.
- `htmlToBbcode` needs NO ref handling (refs are text in editor; it already decodes entities so
  `&`-sigil refs round-trip).
- `MarkdownEditor.tsx`: passes `{ editor: true }` at the 3 editor-content `bbcodeToHtml` calls; the
  preview pane (1 call) stays reader mode.
- `_bbcode.ts` (Foundry export): dead `[ref|…]` + helpers removed; refs INTENTIONALLY left as text
  for the module's enrichers (documented divergence from the app renderer — do NOT mirror ref
  rendering here).

### P2 — `src/lib/references.ts`
- `searchReferences(kind, query, limit)` → `[{kind,id,name}]` (single kind).
- `resolveReference(kind, id)` → `{kind,id,name,summary,route} | null` (hover card data).
- `searchReferenceFamily(family, query, limit)` → UNION across a sigil family (`entity`/`rule`) in
  one query. Used by the autocomplete.
- `KIND_CONFIG` (table/idCol/nameCol/summaryExpr per kind), `FAMILY_KINDS`, `REFERENCEABLE_KINDS`.
- Reuses `queryD1` (the proxy) — **no new server endpoint**. Proxy admits these reads
  (`PROTECTED_READ_TABLES` only blocks users/lore_secrets/characters/character_*).

### P3 — `src/components/ReferenceAutocomplete.tsx`
- Dependency-free inline autocomplete (no `@tiptap/suggestion`, no tippy). Detects the trigger from
  editor state, positions with ProseMirror `editor.view.coordsAtPos`, intercepts arrow/enter/
  escape via a **capture-phase keydown on `editor.view.dom`**, debounced (140ms) `searchReferenceFamily`,
  inserts `@kind[id]{Name} ` via `insertContentAt({from,to}, refText)`.
- Trigger regex `TRIGGER_RE = /([@&])([^\s@&[\]{}]{0,40})$/`; single-token query (no spaces) for now.
- Rendered in `MarkdownEditor` WYSIWYG branch: `{editor && <ReferenceAutocomplete editor={editor} enabled={isWYSIWYG} />}`.

## OPEN: verify P3 in-browser (user was about to test)

On `/dev/bbcode` (Visual editor), confirm:
1. Typing `@abs` shows a dropdown (Absorb Elements); `@aber` shows cross-kind (subclass/feat/spell); `&fr` shows Frightened.
2. Arrow up/down + Enter/Tab/click insert `@spell[absorb-elements]{Absorb Elements}` text; Escape closes.
3. **Watch**: dropdown POSITION (under cursor), KEYBOARD (arrows/enter shouldn't leak to editor), INSERT replaces exactly the trigger. These were built blind — likely need tuning.

## What's next

### Phase 4 — hover card component (Concept A + pin/nest)
- New component rendering the card per the design doc. On hover of a `.ref-link` (in the reader),
  call `resolveReference(kind, id)` (data-ref-kind / data-ref-id are on the anchor), show name +
  kind + summary (render BBCode summary via `bbcodeToHtml` reader-mode; **graceful "no summary"
  fallback — many entities have empty description/excerpt**) + prereq + source. Fixed size,
  scrollable. **Pin** → draggable persistent window (survives navigation, session-scoped) + "Go to"
  row. **Nested** pop-ups (child never closes parent).
- The reader's existing `.ref-link` click interception lives in `SpellDetailPanel.tsx` /
  `SpellList.tsx` (route on click). Reconcile/extend, or add a global `.ref-link` handler.
- Prereq: pull from `requirements_short_text`/combined requirements tree; truncation → nested popup.

### Phase 5 — summary field
- Migration (LOCAL FIRST per AGENTS.md #7) to add a brief `summary` field where missing
  (`lore_articles.excerpt` + `classes.preview` already exist; spells/feats/items/conditions use
  `description`). Editor UI to author it. Wire into the card.

## Conventions / gotchas

- **Dev servers** (AGENTS.md #6 — drive them yourself): `cd worker && npx wrangler dev` (8787) +
  `npm run dev` (3000, express+vite). Both were running in background; they have crashed during
  git rebase churn — restart if `curl localhost:3000` fails (exit 7 / HTTP 000).
- **Query local D1**: `cd worker && npx wrangler d1 execute dauligor-db --local --command "…"`
  (works while `wrangler dev` runs). Used throughout to pull real data.
- **Real-data facts**: `items` table is **EMPTY**. Some entities have empty summary
  (alchemist class, cagosia article). Real ids in use on `/dev/bbcode`: spells `absorb-elements`/
  `acid-splash`, class `alchemist`, feat `actor`, subclass `aberrant-mind`, conditions
  `frightened`/`blinded`/`charmed`, article `cagosia`.
- **Verification pattern**: write a throwaway `scratch/_*.mts`, run `npx tsx scratch/_x.mts`
  against the real module, then `rm` it. Used for all the bbcode/ref logic checks.
- **bbcode.ts ↔ _bbcode.ts** are a drift-managed pair, BUT reference rendering INTENTIONALLY
  diverges (app renders to anchors; server leaves refs as text for Foundry enrichers). Documented
  in both files.
- **AGENTS.md non-negotiables**: no `INSERT OR REPLACE`; `queryD1` JSON-column passthrough; D1
  migrations local-first, remote only with explicit per-migration permission; no push to
  `origin/main` without an explicit green-light in the conversation.
- **Theming**: `parchment` is a theme NAME not a colour. Use `bg-background`/`bg-card`/`bg-muted`/
  `text-ink`/`text-gold`. Prose colours need `!important` (the typography plugin wins otherwise) —
  see `.prose .ref-link` / `.prose a` in `index.css`. In the user's DARK theme, `--gold` resolves
  to BLUE (`#3b82f6`) per App.tsx, so refs/links render blue, matching headings.
- **General info → HTML**: per `feedback_general_info_as_html`, present specs/designs/overviews as
  readable HTML in `docs/_drafts/`, not chat walls.

## How to resume

1. `git branch --show-current` → expect `system-applications`. If on main, the harness switched you;
   switch back. `git log --oneline origin/main..HEAD | head` to see the commits above.
2. Ensure dev servers are up (restart per above if not). `curl localhost:3000/dev/bbcode` → 200.
3. If the user has feedback on P3 (autocomplete feel), tune `ReferenceAutocomplete.tsx` first.
4. Otherwise start **Phase 4** (hover card) using `resolveReference` from `references.ts` and the
   Concept A design in `feat-hover-card-concepts.html`.
5. Keep docs as **local drafts** unless the user says to push.
