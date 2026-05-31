# Resume point — proposal-system (post-compaction)

> **Read this first to resume.** Branch `proposal-system` == `main` == **`6be599a`**, clean tree.
> The cross-referential-cluster feature is **functionally complete and in prod**; current work is a
> **UX redesign of the block experience** (admin side shipped, authoring side awaiting the owner's
> mockup pick).

---

## Where we are right now (the live thread)

The owner is **reviewing two HTML mockups** and will pick a direction. That's the next decision gate.

1. **Admin block review — Option C (split-pane): BUILT + shipped** (`9f610e8`). Owner is testing it on
   the dev stack. Replaced the flat revision list with a roomy split-pane: grouped rail + field-level
   diff detail (`BlockReview` + `FieldDiff` in `src/pages/admin/AdminProposals.tsx`). Mockup:
   `docs/_drafts/block-review-redesign.html`.
2. **Authoring-side block — MOCKED UP, awaiting pick.** Owner said all of it is lacking; mockup at
   **`docs/_drafts/authoring-block-redesign.html`** with 3 surfaces:
   - **S1** block picker/switcher (cards), **S2** block bar + "your block" drawer (everyday win),
     **S3** Review & Submit (reuse the admin `BlockReview`/`FieldDiff` with Remove/Submit footer).
   - **My lean (told owner): build all three, order S2 → S3 → S1.** S3 reuses the admin components;
     the drawer reads the drafts the wrapper already tracks; "remove" reuses the existing draft-drop
     path. Build target: `src/components/proposals/ProposalEditorWrapper.tsx` +
     `ProposalEditorHeader` + `PickOrCreateBlockDialog`, reusing AdminProposals' `BlockReview`/`FieldDiff`
     (consider extracting those two into a shared component when wiring S3).

   **On resume:** once the owner names which surfaces, build them. No code started on the authoring
   redesign yet — it's mockup-only.

## Dev stack (how the owner is testing)

- **`node scripts/dev-proposal.mjs`** → app **http://localhost:3002**, worker **:8789**, inspector :9231,
  against THIS worktree's local D1. (Mirror of `dev-sysapp.mjs`; default :3000 / sysapp :3001 are other
  stacks.) `--var R2_PUBLIC_URL:http://localhost:8789` makes uploaded images render in dev (worker now
  serves `GET /images/<key>` publicly — `worker/index.js`).
- If the app isn't up: relaunch the script. It's currently running (PID may change). A **stray :3000
  proposal-system app** was killed this session — proposal-system must live on **3002 only**.
- Local D1 state: migrations applied (scaling_column / feature / subclass_preview), ~82 classes; **old
  test blocks were deleted** (clean slate) — to see the review UIs the owner must author + **submit** a
  block (an `open` block with drafts won't appear in admin review).

## Shipped this session (all on `main`)

- **Part D** — block-atomic approve (`POST /api/admin/proposals/bundle/:id/approve` + `/reject`): guard #1
  reference walk → guard #2 drift → topo order → one atomic `env.DB.batch()`. Pure logic unit-tested +
  **live data-layer e2e passed 19/19**. (`api/_lib/proposals.ts`, `functions/api/admin/proposals/[[path]].ts`)
- **Guard #1 pool-fields extension** — walks `advancements[].configuration.pool/optionalPool` by
  `choiceType` (`collectAdvancementRefs`).
- **R4** — atomic submit flush + create→update fold-race closure (`functions/api/proposals/[[path]].ts`
  `handleSubmit` now one `env.DB.batch()`; `BlockProvider.refresh()` returns fresh drafts;
  `ProposalEditorWrapper` serializes flushes).
- **F3** — `subclass.writableColumns` += `preview`. **F2** — verified already-wired.
- **Remote entity_type migrations applied** (scaling_column + feature) with go-ahead; 10 rows preserved.
  Restore bookmark: `000000cf-00000002-0000507b-588e9ef29c56c263be8601faa6903cfa`.
- **Live-testing bug pass:** **#1** block isolation (per-uid `activeBundleId` in `proposalBlock.tsx`);
  **#2** image upload — proposal-mode gate (`r2-proxy.ts` allows upload when caller owns the open block;
  client sends `x-proposal-bundle-id`) + dev multipart body fix (`server.ts` `express.raw`) + dev image
  proxy; **#4** broken review nav — **subsumed by the admin redesign** (in-place review, no navigation).

## Open items

- **#3 BBCode spurious bold** — typed plain text saves as `[b]…[/b]`. **Handed to system-applications**
  (`handoffs/system-applications/2026-05-30-bbcode-spurious-bold.md`); their domain (`bbcode.ts` + the
  preview TipTap editor). Not proposal-specific. No action from us unless reassigned.
- **#39** backfill remote `d1_migrations` rows for the two entity_type migrations (applied via
  execute-file, so the tracking table doesn't record them — a `migrations apply --remote` would re-run).
- Minor: dev uploads store under `images/classes/new/…` (route param "new" instead of the minted id) —
  cosmetic, unique filenames, not blocking.
- Owner offered the choice to render rich fields (description/preview) BBCode-rendered in the diff detail
  — deferred unless requested.

## Gotchas for whoever resumes

- **Push to BOTH `main` and `proposal-system`.** `main` is a shared trunk (system-applications,
  compendium-editors, foundry-module all push). If a `main` push is rejected: `git fetch origin` →
  `git merge origin/main --no-edit` → push both. (Done ~6× this session.)
- **Bash CWD** is flaky with compound `cd` — prefer absolute `cd "E:/DnD/Professional/Dev/Dauligor/.claude/worktrees/loving-banach-d76c40"` in each command.
- **wrangler CLI on Windows** sometimes prints a libuv exit-assertion after a command (the query already
  ran — harmless). For local-D1 reads/writes prefer `curl` to the running worker `/query` (`:8789`,
  `Authorization: Bearer dauligor-asset-secret`).
- **HMR**: `src/` edits hot-reload on :3002; `server.ts` / `worker/index.js` / launcher-arg changes need
  a stack restart.
- The owner is sensitive to anything that reads like data loss — be precise about destructive ops, never
  run `wrangler d1 migrations apply` (a destructive `9999_cleanup.sql` was moved to `worker/scripts/`).
