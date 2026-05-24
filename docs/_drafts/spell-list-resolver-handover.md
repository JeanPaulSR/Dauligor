# Spell list resolution v2 — deploy checklist (2026-05-23)

Phase 4 (Proposal D — runtime query + opportunistic cache replacing the
materialised `class_spell_lists` table) is **done in local + git** as of
this update. This doc now exists only to track what's left before the
work ships to prod. Delete it once the migrations are applied to remote
D1 and `main` is pushed.

## What landed

All phases shipped as a chain of commits on `main`:

| Phase | Commit | Notes |
|---|---|---|
| P4.0 | (in P4.1 commit) | `spell_rules.manual_exclusions` + `consumer_spell_list_cache` migration |
| P4.1 + P4.2 | `1d68283` | Resolver library + read-path swap |
| P4.3 | `ef8a862` | SpellListManager rule-routed mutations + Tag Usage + Exceptions |
| P4.3.5 | `2b47ca5` | Rule Membership panel in SpellsEditor |
| StatusEmblem | `c411f16` | Shared status chip component |
| P4.2b | `8ac633f` | Foundry export endpoint reads via drift-managed resolver twin |
| P4.4 | `e5be33a` | Dead recalc apparatus deleted |
| P4.6 | `dc3c9be` | Proposal-mode rule-edits + `class_spell_lists` table drop |
| #152 + P4.5 | `05bd653` | Foundation-fetch dedup + cron pre-warm cache |

Plus `4a75420` (filter mockup variants) sits ahead of the chain — unrelated
to Phase 4 but in the same uncommitted-since-deploy window.

**Total: 9 commits ahead of `origin/main`.**

## Deploy gate

Before this work is fully live, three things must happen, in this order:

1. **Apply pending D1 migrations to remote.** Two migrations are in
   `worker/migrations/` but only applied to local D1 so far:
   - `20260523-1500_spell_list_resolution_v2.sql` — adds the
     `manual_exclusions` column + `consumer_spell_list_cache` table.
   - `20260523-1530_drop_class_spell_lists.sql` — drops the old
     materialised table.
   Per AGENTS.md rule #7, every `--remote` invocation requires an
   explicit per-migration ask. **Do not batch-apply both** — confirm
   each one separately. Order matters: 1500 must land before 1530
   (which itself can be reverted by re-running the 1500 migration
   alone if rollback is needed mid-deploy).
2. **Push `main` to origin.** Triggers the Pages build + deploys the
   new `/api/admin/prewarm-spell-cache` endpoint, the resolver-backed
   read paths, and the dropped legacy table's UI fallout.
3. **Update worker.** `wrangler deploy` from `worker/` to ship the
   scheduled-handler change that calls the new prewarm endpoint. Worker
   needs `APP_URL` set (in `wrangler.toml` `[vars]` for prod; in
   `.dev.vars` for local).

After deploy, two smoke checks:

- POST `/api/admin/prewarm-spell-cache` with the worker secret and
  confirm a 200 + non-zero `scanned` count.
- Open `/compendium/spell-lists`, pick any class, confirm the list
  renders. Check the network panel — first page-mount should fetch
  `tags`/`spells`/`sources` once each (not 3-4× — that was the #152
  dedup we just shipped).

Once both checks pass, **delete this doc**.

## Open follow-ups (not deploy-blocking)

- **Filter modal redesign** — 5 variants live at `/mockup/filter-modal`
  awaiting a pick. Once chosen, wire into `FilterBar.tsx` and delete
  the mockup file + route.
- **Class/Subclass filter axis** on `/compendium/spells` — user's
  original P4 bullet #5. Now trivial post-resolver ("does spell X
  match any rule applied to class Y?" is a one-liner) but never built.
- **SpellsEditor filter modal** — extend with Casting Time / Range /
  Duration / Shape / Tag-as-filter (parked from May 14).
- **Fullscreen 3-col treatment** for `/compendium/spell-lists` and
  `/compendium/spell-rules` (parked from May 14 — match the
  TagsExplorer / AdminProficiencies layout).
- **Rule-compare** — "what would change if I added this rule? diff
  manual list vs. rule-derived." Library shape leaves room; no code
  yet.
- **Lost-update window in proposal-mode** — two concurrent unapproved
  spell_rule proposals against the same rule can clobber each other on
  staggered approval. Documented in the `dc3c9be` commit message; no
  current fix beyond "admins review in order".

## Architectural canon (post-Phase 4)

Where to look when something about spell-list resolution needs
debugging or extending:

| Topic | File |
|---|---|
| Resolver compute path (in-app) | `src/lib/spellListResolver.ts` |
| Resolver compute path (server, drift twin) | `api/_lib/_spellListResolver.ts` |
| Cron pre-warm helpers | `api/_lib/_spellListResolver.ts` (bottom block) |
| Pre-warm endpoint | `functions/api/admin/prewarm-spell-cache.ts` |
| Worker scheduled handler | `worker/index.js` (`runSpellCachePrewarm`) |
| Cache table schema | `worker/migrations/20260523-1500_spell_list_resolution_v2.sql` |
| Rule type + helpers | `src/lib/spellRules.ts` |
| Rule writers (manual_spells / manual_exclusions) | `addSpellToRuleManual` et al. in `spellRules.ts` |
| SpellListManager (admin UI) | `src/pages/compendium/SpellListManager.tsx` |
| Rule Membership panel (SpellsEditor) | `src/components/compendium/RuleMembershipPanel.tsx` |
| Foundry export uses resolver | `api/_lib/_classSpellList.ts` |

## Process discipline (still applies)

These rules from the original handover are still load-bearing for
future agents working in this codebase:

1. **Never apply a migration to remote D1 without explicit
   per-migration permission.** An earlier "go ahead" does not transfer.
   AGENTS.md rule #7.
2. **Drive the local dev stack yourself** via `run_in_background`,
   don't tell the user to start `wrangler dev` / `npm run dev`.
   AGENTS.md rule #6.
3. **Keep local D1 in sync with remote schema** when migrations land.
   Apply locally first, remote on permission.
