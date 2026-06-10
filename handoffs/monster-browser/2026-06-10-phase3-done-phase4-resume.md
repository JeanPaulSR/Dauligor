# Monster Browser — Phase 1–3 DONE, Phase 4 resume (2026-06-10)

**Read-this-first resume doc** (written pre-compaction so nothing is lost). The public Monster
Browser at `/compendium/monsters` — Phases 1 (schema), 2 (seed), 3 (importer) are **done,
committed, and adversarially verified**. **Next = Phase 4: the browser UI** (`MonsterList` +
`MonsterDetailPanel` + route). Everything below is the state + the exact resume steps.

---

## 0. Where the project's knowledge lives (READ THESE to resume)

| What | Where |
|---|---|
| **Live cross-session state + Phase 4 resume plan** | **memory** → `C:\Users\Jean\.claude\projects\E--DnD-Professional-Dev-Dauligor\memory\project_monster_browser.md` (the authoritative running note; has the detailed Phase 4 build plan). Index: `MEMORY.md` in the same dir. |
| **Schema + render rules + 3-way field map** (the deep design) | `docs/_drafts/monster-statblock-shapes-and-schema-2026-06-09.html` (parchment doc — open in a browser) |
| **`monsters` table schema doc** | `docs/database/structure/monsters.md` (camelCase columns + JSON shapes) |
| **Branch coordination** | `handoffs/monster-browser/manifest.md` (ownership, progress, local-dev), `handoffs/BRANCH_REGISTRY.md` (row, status `active`) |
| **Kickoff (pattern files to copy)** | `handoffs/monster-browser/2026-06-09-monster-browser-kickoff.md` |
| **Raw research / scratch** (outside repo) | `E:\DnD\Professional\Foundry Export\_research\` — `SYNTHESIS.md`, `CRITIQUE.md`, `VERIFY_CRITIQUE.md`, `finder1..4_*.md`, the `extract.py`/`probe*.py`/`coverage.py`/`validate.py`, sample `creature_<Name>.json` + `reconstructed/<Name>.json`, the 5etools `etools_*.html` |
| **Foundry-module export-enrichment thread** | `handoffs/foundry-module/2026-06-09-from-monster-browser-enrich-creature-export.md` (request), `…-reply-monster-browser-enrich-creature-export.md` (their reply, commit `84424a2`), `…-ack-enrich-done.md` (our ack) |

---

## 1. Git state

Branch **`monster-browser`** (worktree `jolly-mayer-71aa42`), based off `origin/main` @ `f79c806`.
6 local commits; **last 4 are UNPUSHED** (`origin/monster-browser` is at `e553743`):

```
167fa06 feat(monsters): Phase 3 — importer            ← unpushed
e7d93f0 chore: add isolated dev stack launcher         ← unpushed
f5910b8 feat(monsters): Phase 1 — create monsters table ← unpushed
c158dad docs: ack foundry-module enrich + request re-export ← unpushed
e553743 docs: shape study + proposed schema + module handoff ← origin/monster-browser tip
037b215 docs(handoff): kick off monster-browser branch
```
Clean tree. **`main` = production (auto-deploys) — never push to main without explicit permission.**
Pushing the *feature* branch (`origin/monster-browser`) is safe (no deploy) — offer it; user hasn't
asked yet. **Nothing has been applied to remote D1; nothing pushed to main.**

---

## 2. Data layer (DONE)

- **Table `monsters`** — migration `worker/migrations/20260609-1600_create_monsters.sql`, **applied to
  LOCAL D1 only** (binding `DB` = `dauligor-db`). **57 columns, camelCase** (per the species/backgrounds
  convention — NO `compendium.ts` snake↔camel mapping needed). Full column list + JSON shapes →
  `docs/database/structure/monsters.md`. Indexes: `idx_monsters_{cr,type,size,source}` + source-scoped
  unique. Registered in: `src/lib/d1.ts` `jsonFields`, `api/_lib/d1-fetchers-server.ts` (map +
  `JSON_COLUMNS`), `src/lib/d1Tables.ts` (`monsters:'monsters'`), `docs/platform/d1-architecture.md`.
- **Local D1 is SEEDED** from remote (schema-then-data — combined dump trips deferred-FK): **93 tables,
  84 sources, 542 spells, 1669 items, 500 feats**, and **1001 monsters** imported. (Remote read-only;
  no remote writes.)
- **Column groups** (camelCase): identity (`id` PK=Foundry actor id, `name`, `identifier`, `sourceId`,
  `page`, `sourceBook`, `sourceRules`, `imageUrl`, `tokenImageUrl`, `tags`); header scalars (`cr` REAL,
  `xp`, `creatureType`, `typeSubtype`, `swarmSize`, `size`, `alignment`, `ac`, `acNote`, `acFormula`,
  `hp`, `hpFormula`, `proficiencyBonus`, `passivePerception`, `hasLegendary`, `hasLair`,
  `hasSpellcasting`, `legendaryActionCount`, `legendaryResistanceCount`, `lairInitiative`,
  `legendaryActionsPreamble`); JSON (`movement`, `abilities`, `saves`, `skills`, `senses`,
  `damageResistances`, `damageImmunities`, `damageVulnerabilities`, `conditionImmunities`, `languages`,
  `habitat`, `traits`, `actions`, `bonusActions`, `reactions`, `legendaryActions`, `lairActions`,
  `regionalEffects`, `spellcasting`, `variantBlocks`, `foundryData`); text (`biography`, `description`);
  meta (`contentHash`, `createdAt`, `updatedAt`).

---

## 3. The importer (DONE — `167fa06`)

- **`src/lib/monsterImport.ts`** — the reusable transform (`creatureEntryToMonsterRow(entry, ctx)`).
  Mirrors `itemImport.ts`/`spellImport.ts`. Reconstruction logic:
  - Header DERIVED values copied **exact** from the *enriched* `creatureSummary` (ac/proficiencyBonus/
    `abilities.<a>.save`/`skills.<s>.total`/`passivePerception`/`spellcasting.{dc,attack,level}`) — the
    foundry-module enriched the export (`84424a2`) so these are real (no app-side recompute).
  - Authored data from `sourceDocument.system.*` (damage-trait bypasses/custom, languages
    telepathy/custom, habitat, full biography, resources, embedded items).
  - Body sections from `sourceDocument.items[]` bucketed by `flags.plutonium.page`
    (`monsterTrait/Action/Bonus/Reaction/Legendary/LairActions/RegionalEffects`), **with per-activity
    refinement** (a `monsterTrait`-paged feat with a `bonus` activation → `bonusActions`). Weapons →
    actions. The activity-less "Legendary Actions" wrapper feat → `legendaryActionsPreamble` (dropped).
    `monsterSpellcasting` feats → `spellcasting[]`.
  - Each action carries `activities[]` tuples (attack{bonus,type,reach/range/long}, save{abilities,dc,
    onSave}, damageParts[{average,formula,types}], uses, costs). Prose via `htmlToBbcode` (regex, Node-safe).
  - Spells link to OUR `spells` catalog by `identifier = slugify(name)` (handles the 2 `/`-name spells).
- **`scripts/import-monsters.ts`** — seed runner: reads the export + `sources`/`spells` (fetched via
  wrangler `--json`), transforms all 1001, writes `monsters.sql` (`BATCH=1` — D1 caps a single statement
  at ~100KB `SQLITE_TOOBIG`; prepends `DELETE FROM monsters;` for clean re-import).

### Re-import recipe (if needed)
```bash
cd <worktree>
mkdir -p worker/.wrangler/_import
npx wrangler d1 execute dauligor-db --local --config=worker/wrangler.toml --json --command="SELECT id, abbreviation, slug FROM sources" 2>/dev/null > worker/.wrangler/_import/sources.json
npx wrangler d1 execute dauligor-db --local --config=worker/wrangler.toml --json --command="SELECT identifier FROM spells" 2>/dev/null > worker/.wrangler/_import/spells.json
NODE_OPTIONS=--max-old-space-size=8192 npx tsx scripts/import-monsters.ts
npx wrangler d1 execute dauligor-db --local --config=worker/wrangler.toml --file=worker/.wrangler/_import/monsters.sql
```
(EXPORT defaults to `E:/DnD/Professional/Foundry Export/creatures/creatures-creatures-export.json`.)

### Verification (DONE) + deferred follow-ups
- Adversarial workflow (9 archetype verifiers + completeness critic, all 1001). **Verified exact vs
  5etools:** Aarakocra, Adult Black Dragon, Mage, Goblin. Bucketing 0 mismatches; source resolution
  exact; CR/XP perfect; recharge carries through; **export is clean UTF-8** (the earlier "corruption"
  was a dump-script artifact — no sanitize needed).
- **5 bugs found & fixed before commit:** (1) spell-list dedup (export ships each spell 2×); (2) weapon
  `includeBase` damage dropped the ability mod; (3) melee reach mislabeled as `range`; (4) unnamed MM
  lair/regional bullets; (5) `monsterTrait`-paged `bonus` features (97) misfiled into traits.
- **Deferred (graceful) follow-ups:** dual-spellcaster per-feat spell grouping (38 creatures — all
  spells land on `spellcasting[0]`, block 1 `spells:[]`, proses intact); 1 recharge edge (Black
  Abishai "Creeping Darkness", flagged `monsterSpellcasting`); **add an MPMM source row** via
  `/admin/sources` so the 291 Mordenkainen's-Multiverse creatures resolve (they keep
  `sourceBook="MPMM"` with `sourceId=null` today — MM'14→MM and VGM→VGM resolve fine).

---

## 4. Dev server (RUNNING)

- **`node scripts/dev-monster-browser.mjs`** → app **http://localhost:3006**, worker **:8793**,
  inspector :9234. ⚠ **NOT :3000** (main checkout). `.env` + `worker/.dev.vars` are copied from the
  parent repo (done). Launched in background; verified HTTP 200.
- **No-watch** (`tsx server.ts`) — the junctioned `node_modules` makes `tsx watch` loop in a worktree.
  **Restart the launcher to pick up source edits.** Vite HMR WS (port 24678) collides with sibling
  worktree stacks → HMR disabled; the app serves fine, just **manually refresh** the browser.
- If the bg process died after compaction: relaunch (run_in_background, sandbox off). Verify with
  `curl -s -o /dev/null -w "%{http_code}" http://localhost:3006/`.
- **Never `npm install` in this worktree** (node_modules junctioned to parent → dual-React breakage).

---

## 5. Styling / UI conventions (for Phase 4)

- **`docs/ui/style-guide.md` is the styling source of truth — READ IT before writing any UI.** Classes
  live in `src/index.css`. **Tokens only** (gold = accent/highlight, ink = text, blood = warnings) —
  never raw palette. **Square corners.** Use documented classes (`.config-fieldset`, `.field-label`,
  `.btn-gold-solid`, …). **Minimize icons** (only at-a-glance type glyphs + real action controls).
- **The public compendium browsers all wrap `src/components/compendium/CompendiumBrowserShell.tsx`**
  (the shared 3-pane list · filters · detail). Copy the freshest one, `ItemList.tsx`. Detail panels
  follow `ItemDetailPanel.tsx` / `FeatDetailPanel.tsx` (art preview = `Image()`-probe → glyph fallback).
- Render BBCode via `bbcodeToHtml` (from `src/lib/bbcode.ts`).
- (The parchment/gold style is for the **design DOCS** in `docs/_drafts/`, NOT the app UI — don't confuse
  the two. App UI = the style-guide tokens/classes.)

---

## 6. Phase 4 build plan (the actual next work)

Build in this order, restarting the launcher + refreshing `:3006` to confirm each piece:

1. **`src/pages/compendium/MonsterList.tsx`** ← copy `src/pages/compendium/ItemList.tsx`.
   - Shell: `CompendiumBrowserShell` + `src/hooks/useAxisFilters.ts` + `src/components/compendium/SectionFilterPanel.tsx`.
   - Columns: **Name / CR (display `0.25`→"1/4", `0.125`→"1/8") / creatureType / size / Source**.
   - Filter axes: `cr` (banded: 0, ⅛–1, 2–4, 5–10, 11–16, 17+), `creatureType`, `size`, `source`,
     `hasLegendary`, `hasSpellcasting`.
   - **Slim-load**: `fetchCollection('monsters', { select: '<display+filter cols only>' })` (stat blocks
     are heavy — don't load the JSON body cols for the list), then lazy `fetchDocument('monsters', id)`
     on select. (`monsters` collection alias is already in `d1Tables.ts`.)
2. **`src/components/compendium/MonsterDetailPanel.tsx`** ← copy `ItemDetailPanel.tsx` + `FeatDetailPanel.tsx`.
   - Art: `Image()`-probe on `imageUrl` → `tokenImageUrl` → glyph fallback (the `FeatArtPreview` pattern).
   - Render the stat block per design-doc §2: header (`ac`+`acNote`, `hp`+`hpFormula`, `movement`→speed
     line, abilities grid w/ derived mods, `saves`, `skills` w/ expertise badge, `senses`+
     `passivePerception`, damage `R/I/V` w/ `bypasses` → "from nonmagical attacks", `conditionImmunities`,
     `languages`+`telepathy`, `cr`+`xp`, `proficiencyBonus`) → **traits → actions → bonusActions →
     reactions → legendaryActions** (show `legendaryActionsPreamble` + per-entry `costs` → "(Costs N
     Actions)") **→ lairActions → regionalEffects → spellcasting[] →** `habitat` ("Environment:" line).
   - Action lines: `bbcodeToHtml(description)` + synthesized labels from `activities[]`
     (`attack.bonus`→"+N to hit", reach/range/long, `damageParts` → "avg (formula) types", `save`
     dc/ability/onSave, `uses`→"(Recharge 5–6)"/"(N/Day)"). Unnamed lair/regional entries (`name===''`)
     render as plain bullets.
   - Spellcasting: link each `spells[].identifier` to the spell's page (`/compendium/spells` route).
3. **Register** route `/compendium/monsters` in `src/App.tsx` (public) + nav link in
   `src/components/Sidebar.tsx` — **both APPEND-ONLY** shared files.
4. **Verify** in the browser at `:3006`: Aarakocra (simple), Adult Black Dragon (legendary+lair+
   spellcasting-free), Mage (spellcasting). Keep `tsc` at the baseline of **3** pre-existing errors
   (`CompendiumBrowserShell`/`SpellList` asChild + `characterShared` — not ours).
5. **Commit** Phase 4 when working (don't ask about every commit; user said STOP ASKING). Don't push to
   main.

---

## 7. Non-negotiable process constraints

- `main` = production, auto-deploys — **never push to main without explicit permission**; show
  `git log origin/main..HEAD` first.
- Migrations: **local-first**; remote only with explicit go-ahead — **never `wrangler d1 migrations
  apply --remote`** (replays all → corrupts prod). Apply one file via `d1 execute --local/--remote --file`.
- **Never `npm install`** in this worktree (junctioned node_modules).
- Cross-branch changes (e.g. the foundry-module exporter) = **handoff, not self-edit**.
- D1 idiom: `ON CONFLICT(id) DO UPDATE`, never `INSERT OR REPLACE`. Compound `UNION` capped at 5 terms
  on the worker (wrangler CLI doesn't enforce, but local miniflare via wrangler does — keep ≤5).
- All `monsters` columns are **camelCase** (creatureType, legendaryActions, damageResistances,
  hasLegendary…) — read them verbatim; the d1 layer does NOT snake↔camel by default.
