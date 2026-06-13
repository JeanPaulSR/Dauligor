# compendium-editors — cross-branch fixes + module rebake system — compaction pickup (2026-06-12)

**Branch:** `compendium-editors` · **worktree:** `…/.claude/worktrees/nostalgic-lamport-76d78d`
**`compendium-editors == origin/main == dbb2223`, clean tree, nothing unpushed.**
**tsc baseline = 2** (was 3; the monster-browser merge fixed one of the pre-existing `asChild` errors).

## TL;DR — everything below SHIPPED to `main` this session (all app-side, all live/auto-deploying)
A long session of cross-branch handoff fixes plus one new subsystem (the module rebake auto-baker).
Nothing is in flight. Two things are PARKED (see Open). One post-deploy action recommended (rebake classes).

## What shipped (newest first; SHAs are the on-main ones)
- `dbb2223` **fix(markdown-editor)** — StarterKit v3 bundles Link+Underline; `MarkdownEditor` also added them → TipTap "duplicate extension" warning. `StarterKit.configure({ link: false, underline: false })`.
- `b992c5b` **fix(subclass-editor)** — subclass-feature icons vanished after reload (class features survived). SubclassEditor's hand-rolled feature mapping omitted `icon_url→iconUrl`; ClassEditor gets it via `denormalizeCompendiumData`. Added `iconUrl`/`imageUrl` aliases to the `mappedFeatures` map (`SubclassEditor.tsx` ~L521). Data was fine (33/572 had `icon_url`); load was the bug.
- `a75258b` **fix(active-effects)** — swapped the typed-value `datalist` for `SingleSelectSearch` (shows the type NAME, e.g. "Fire") + widened the AE dialog `lg:max-w-xl→4xl`, taller, Value column `flex-[2]`.
- `ce649bc` **feat(active-effects)** — type-aware change `value` field. New `getActiveEffectKeyMeta(key)` in `src/lib/activeEffectKeys.ts` classifies a key → enum / enumArray / boolean / number / text + default mode. `ActiveEffectEditor` renders a DB-backed picker (damage_types/conditions/languages/tools, homebrew-aware) for array traits (Add mode, one value per row), fixed-enum dropdowns (size/ability/AC-calc/…), On/Off toggle for flags, free text for numbers/formulas.
- `c37d29c` **fix(module-export)** — free-plan subrequest fix (see Rebake System below).
- `18941b4` **docs(draft)** — `docs/_drafts/module-rebake-system-audit-2026-06-12.html` (the audit/proposal).
- `b663b53` **feat(module-export)** — the rebake auto-baker (see below).
- `86a965b` **fix(class-export)** — `cleanText` was a LOSSY BBCode→Markdown pass (converted `[h3]`/`[b]` but not `[table]` → mixed content rendered literally in Foundry). Now preserves BBCode intact (only encoding/newline cleanup) so the module's `bbcodeToFoundryHtml` renders it. BOTH drift files. Reply: `3eac800`.

### Earlier in the session (further down history, below the monster-browser merge)
- **class-export feature automation drop** — class feature `activities`/`effects` had NEVER exported (`feature.automation?.activities` read the wrong path; they live at `feature.activities` top-level). Fixed both drift files. This also un-blocked the f78b5bb shorthand expansion for features.
- **ActivityEditor normalize-effect** — the self-sanitize effect re-fired every render (unstable inline `onChange` dep); now `onChangeRef` + keyed to `[activities]`.
- **FeatDetailPanel** — added a read-only Activities summary (the preview showed no activities, so authors thought saves failed).
- **ClassEditor feature modal** — 25 non-functional `setEditingFeature({ ...editingFeature })` spreads → functional `(prev)=>` (clobber footgun).
- **monsters write-gate** (`requireDmAccess` + monster-write gate in `api/_lib/d1-proxy.ts`) — per monster-browser request.
- **items list endpoint** — `GET /api/module/<slug>/items.json` (`buildSourceItemCatalog`) + `counts.items` + `items` in `supportedImportTypes` + `itemCatalogUrl` + the **catalog self-heal validator** now also requires `itemCatalogUrl`. Per foundry-module request.
- **ItemBumpUses resource-key authoring** — `advancementState.ts` + `AdvancementManager.tsx`: `{ target }` → `{ resourceKey, amount, preferredTarget }` (legacy `target` read on load then dropped; runtime falls back to `target`, no migration). Reply to settings-pages.
- **crafting-commerce branch dedication** — `handoffs/crafting-commerce/` + BRANCH_REGISTRY row (planned, ports 3011/8798/9239).

### Reply handoffs written (institutional record, on main)
`handoffs/foundry-module/2026-06-12-reply-{feature-automation-dropped,items-list-endpoint,cleantext-bbcode-preserved}.md`,
`handoffs/monster-browser/2026-06-12-reply-gate-monsters-writes-admin-codm.md`,
`handoffs/compendium-editors/2026-06-12-reply-itembumpuses-authoring-done.md`.

## ⭐ The Module Rebake System (NEW subsystem — operationally important)
The debounce queue (`module_export_queue`, 1h-quiet) existed but was only drained opportunistically
(1 entry per module-API request) and a **code deploy enqueues nothing**, so cross-branch export fixes
always needed a manual per-class rebake. Built the missing auto-driver + an admin bulk trigger.

- **Drain endpoint** `POST /api/admin/process-export-queue` (`API_SECRET` auth, mirrors prewarm-spell-cache):
  pops a bounded budget of due entries, rebakes each. `DRAIN_BUDGET = 1`.
- **Worker cron** — `worker/index.js` `scheduled()` calls the drain **every tick**; `worker/wrangler.toml`
  cron is now `["30 3 * * *", "* * * * *"]` (every-minute drain; daily tasks gated on `event.cron`).
- **Admin bulk-rebake** — `enqueueAllOfKind('class'|'source')` (`api/_lib/module-export-queue.ts`, BATCHED
  inserts), `POST /api/module/queue-rebake-kind` (staff auth), `rebakeKind()` client, and the
  **`/admin/module-export` page** ("Rebake Export" in the admin sidebar). `rebakeClass` bakes the whole
  class bundle (features/subclasses/options embedded), so "Rebake all classes" covers feature-export fixes.
- **Why budget 1 + every-minute:** Cloudflare **FREE plan caps 50 subrequests/invocation**. One class
  rebake ≈ 25 subrequests; the original bulk-enqueue did 1 INSERT/class (82 = blew the cap → the user's
  "Too many subrequests" error). Fixed by batching the enqueue (~3 subreq) and budget-1 drains, every minute
  → drains a bulk "rebake all" in ~1–2h, gradually. If they move to **Workers Paid** (1000-subreq), bump
  `DRAIN_BUDGET` (in `process-export-queue.ts`) and slow the cron.
- **Verified e2e on the dev stack** (enqueue 82 → 2 round-trips; drain budget 1; 401 without bearer).

### 🔧 DEPLOY MODEL (critical operational fact)
- **Pages app auto-deploys from `main`** (Cloudflare Pages Git) — endpoints + UI go live on push.
- **The WORKER does NOT auto-deploy** (`dauligor-storage`; no Git/CI — deploy history is all manual CLI).
  It needs **`npx wrangler deploy --config worker/wrangler.toml`**. The cron + worker scheduled() changes
  ONLY take effect after that. **Already deployed this session** — `wrangler deploy` ran; the worker shows
  `schedule: 30 3 * * *` + `schedule: * * * * *` (Version 30e175ab). User is authenticated as
  jeanruizmelo@gmail.com (account aaaf1a8a…). If you re-deploy the worker, that's the command.

### ✅ Recommended post-deploy action (NOT yet confirmed done by user)
Open **Admin → Rebake Export → "Rebake all classes"** to propagate the **cleanText** + **feature-automation**
export fixes across all class bundles (they don't self-enqueue on a code deploy). The cron then drains
~1/min. (Now safe — the subrequest fix `c37d29c` is deployed.)

## Open / parked (pick up only if asked)
- **`aria-hidden` / retained-focus console warnings** — PARKED (user: "just the tiptap fix for now"). These
  are `@base-ui/react ^1.3.0` (dialog lib) modal-focus behavior — aria-hidden applied to outside/parent
  content during open/nesting focus transitions (both warnings: the feature modal aria-hiding itself when a
  nested editor dialog opens, and `<main>` aria-hidden while a trigger keeps focus). **Accessibility console
  WARNINGS, not functional breaks.** Real fix = Base UI version that uses `inert` (the warning's own advice)
  → a **`@base-ui/react` dependency bump, do it in the MAIN checkout, not this worktree** (node_modules is a
  junction — never `npm install` here). Alternative: app-side focus-management (`initialFocus`/`finalFocus`,
  or non-modal nested dialogs) — needs **live dev-stack testing** before shipping (can regress dialog UX).
- **crafting-commerce Phase B–D** — own branch (`handoffs/crafting-commerce/2026-06-12-…`).
- Deferred from earlier notes: import round-trip `@scale→@col` collapse; etc.

## Process (CRITICAL — unchanged)
- `main` = prod, auto-deploys on push. **NEVER push without explicit permission;** show `git log origin/main..HEAD` first. The worker is a SEPARATE manual `wrangler deploy`.
- Remote D1: one migration file at a time via `d1 execute --remote --file`; never `migrations apply --remote`. (No DB changes this session — `module_export_queue` already existed.)
- **Drift-paired files (update BOTH):** `src/lib/classExport.ts` ↔ `api/_lib/_classExport.ts`; `src/lib/referenceSyntax.ts` ↔ `api/_lib/_referenceSyntax.ts`.
- Dev ports this worktree: **3000/8787** (`PORT=3000 npx tsx server.ts` + `npx wrangler dev --config worker/wrangler.toml --port 8787 --local`). server.ts mounts Pages Functions EXPLICITLY (add new `functions/api/admin/*` endpoints to its mount list for local-dev parity — prod auto-discovers). Stop by killing the port PIDs only; never blanket-kill node.
- **git push can hang on the Windows Git Credential Manager** — symptom: push produces no output, `git-remote-https.exe` lingers. Fix: kill the stuck `git.exe`/`git-remote-https.exe` PIDs, retry with `GIT_TERMINAL_PROMPT=0 git push -v` (it then succeeds). Happened once this session; cleared immediately.
- New tables camelCase (skip compendium.ts alias). Never `npm install` in a worktree. Cross-branch = handoff.
