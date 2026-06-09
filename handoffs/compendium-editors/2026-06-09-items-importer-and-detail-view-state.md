# Items — importer + reader-view pass — compaction pickup — 2026-06-09

**Branch:** `compendium-editors` · **worktree:** `…/.claude/worktrees/nostalgic-lamport-76d78d`
**PROD is at `46f3b21`** — `compendium-editors` == `origin/main`, clean tree, tsc baseline = 3.

## TL;DR
The per-type Items **editor** rebuild shipped earlier (`b83f4b3`; weapon was the last type — see
`2026-06-08-items-editor-precompaction-weapon-next.md`). This session was driven by the user
**importing the real Foundry export** (`E:/DnD/Professional/Foundry Export/Items/items-items-export.json`,
1,669 items) and **iterating on the public item reader view**. All work is **SHIPPED to main** and live.
Two tracks landed:

1. **Foundry importers — feature parity + 4 prod hotfixes** (items/spells/feats/species-background).
2. **`ItemDetailPanel` reader-view cleanup** (the public item page + the editor live-preview).

Everything below is DONE + pushed unless under "Open follow-ups."

## Importer work (all 4 Foundry import workbenches)
Source files: `src/components/compendium/{Item,Spell,Feat,SpeciesBackground}ImportWorkbench.tsx`,
`src/lib/{itemImport,spellImport,...}.ts`, `src/lib/compendium.ts` (the `upsert*Batch` helpers).

- **Source assignment** — now in ALL 4 importers. Per-candidate Source picker (`SingleSelectSearch`) +
  a bulk "Set source for unresolved…" header control + `effectiveSourceId = override ?? matched`
  applied to the source FK at import + **source-aware dedupe** (resolve the existing row by
  `(effectiveSource, identifier)`). Feats already had it via `candidateOverrides`/`EditableSourceBlock`
  (the most advanced — also edits name/identifier); spells were ADDED; items/species had it.
  Pattern source = `SpeciesBackgroundImportWorkbench`. (Feats lacks only the *bulk* control — minor gap.)
- **Remove-candidate** — in ALL 4. A `dismissedIds` Set filtered out of the visible list + Import Visible,
  a **Remove** button in the detail pane, a **"Restore N removed"** header chip; selection auto-advances.
- **4 PROD IMPORT HOTFIXES** (all root-caused on the real export, all shipped):
  1. `e06afc4` — **tagIds→tags**: `upsertItemBatch` lacked the `tagIds → tags` remap its siblings have
     (`upsertItem`/`upsertFeatBatch`/`prepareSpellPayloadForWrite` all remap; items column is `tags`).
     → "no column named tagIds" 500. **Tag-audit: all 4 importers OK now** (species writes `tags` directly).
  2. `9595e40` — **intra-batch dedup**: the item batch minted a new id per candidate so two candidates with
     the same effective `(source,identifier)` both INSERTed → `UNIQUE` 500. Added keep-first dedup (safety net).
  3. `8985a77` — **per-source identifier uniqueness** (the real fix for the dup-skip): Foundry ships DISTINCT
     items under ONE shared `system.identifier` in the same source (Ball Bearing + "bag of 1,000" both
     `ball-bearings`; 3 Armor of Vulnerability variants all `armor-of-vulnerability`). The dedup was SKIPPING
     them (data loss). FIX in `buildItemImportCandidates`: per-source pass — base id = `slugify(system.identifier
     ||name)`; on collision within `COALESCE(source_id,'')`, fall back to the full **name slug** (distinct per
     variant). Override `savePayload.identifier`. Verified on the export: **0 remaining collisions, nothing dropped**
     (`ball-bearings` + `ball-bearings-bag-of-1-000`, `armor-of-vulnerability` + `-piercing`/`-slashing`).
     Genuinely same-NAMED rows still collapse (dual-key intent: "one source shipping X twice = one entry").
  4. `8985a77` — **container_id FK**: was stamping the raw Foundry `system.container` _id into
     `items.container_id` (FK→items.id) → FK 500. Now NULL on import; catalog nesting lives in `container_contents`.
- **Dual-key design** (migration `20260526-2300`): `UNIQUE INDEX items_source_identifier_uniq ON
  items(COALESCE(source_id,''), identifier)` — identifier unique PER SOURCE. Same id across sources OK.

## Reader-view cleanup — `src/components/compendium/ItemDetailPanel.tsx`
Used by the **public ItemList** (`src/pages/compendium/ItemList.tsx`) AND the **ItemsEditor live-preview**.
Driven by user screenshots comparing to 5etools + the feat/spell panels. Shipped `0ae8d1a` + `46f3b21`:
- **Removed:** the Identifier row; the `— defined in /admin/proficiencies` dev hint (kept "Base item: X").
- **Weapon mechanics render readably** (5etools-style): properties → labels via `ITEM_PROPERTY_LABEL`
  + `titleCase` fallback, with `ver → "Versatile (1d10)"`, `thr → "Thrown (20/60 ft.)"`, `amm →
  "Ammunition (range …)"` (versatile die + range folded in); empty Range/Mastery rows hidden.
- **Armor:** hide misleading "Dex Cap 0" (heavy), strength as int, Stealth only on disadvantage
  (reads `stealthDisadvantage` property or legacy flag), title-cased Type.
- **Tool/Other:** readable tool-type label (`TOOL_TYPE_LABEL`), hide empty bonus, hide "Quantity 1".
- **Description** now renders via **`bbcodeToHtml(...)` + `dangerouslySetInnerHTML`** (the displayer feat/spell
  use) — imported BBCode like the "+1 Armor" base-items `[ul][li]…[/li][/ul]` list renders properly, not raw.
- **List rows** (`ItemList.tsx`): dropped the inline **Lock (attunement) + Sparkles (magical)** glyphs —
  feats deliberately removed those "legacy flags"; items now match. **Favorite Star KEPT** (user-confirmed —
  consistent with feat/spell; it's the favoriting toggle). `magicalFlag`/`attunementFlag` still feed the filters.
- **Convention:** make item views match the FEAT/SPELL panels. No identifier, no raw slugs, hide empty fields,
  render descriptions through the BBCode displayer, minimal icons (favorites star only).

## Open follow-ups (NOT done)
- **Missing homebrew base items** the importer warns on: weapon **`net`**, tool **`chess`**, and the homebrew
  ranged weapons (Atlatl/Repeating Crossbow/Boomerang/Chakram/Throwing Dagger). User adds these in
  **`/admin/proficiencies`** (Weapons/Tools) with correct category + Melee/Ranged; then re-import resolves the FK.
- **Enchantment system (FUTURE, gated on a crafting system — DO NOT BUILD yet):** generic magic items that apply
  to many bases (Flame Tongue) should become their own `enchantments` table + an Enchant activity (the user's
  data models them as baseless trinket/equipment + a damage Activity today; that round-trips). See the
  `project_items_editor_rebuild.md` memory "Future direction" note.
- **Minor parity:** feats lacks the *bulk* "set source for unresolved" control (has per-row). Species/background
  could get tool/other-style detail polish if desired.
- **Stealth capture:** Plate imported without stealth-disadvantage captured (description has it). The structured
  Stealth row now only shows on disadvantage; if the import should set the `stealthDisadvantage` property from
  Foundry `system.stealth`, that's an import-capture follow-up.

## Migrations (all applied LOCAL + REMOTE — none pending)
`20260608-1300_items_vehicle` (vehicle JSON col) · `20260609-1200_armor_identifier_foundry_align`
(armor ids → Foundry slugs: chain-mail→chainmail, studded-leather→studded, …, + local shields→shield).
Earlier batch (chat_description / consumable_taxonomies / ammo+scroll item_properties / container_contents) too.

## Dev stack + process (CRITICAL)
- **Worker:** `cd worker && WRANGLER_SEND_METRICS=false npx wrangler dev --port 8787` (local D1/R2 in
  `worker/.wrangler/`). **App:** `npm run dev:nowatch` (:3000, reads `.env` R2_WORKER_URL=:8787).
  API_SECRET (`worker/.dev.vars`): `q9nHN9H3Ny2ilWXWFlViQD5LBI63sc1KirhrwTyc`.
  **Client .tsx → hard-refresh; server-side (`api/_lib`, `server.ts`) → restart :3000.** Both servers
  go down on PC restart — relaunch both. NEVER `npm install` in the worktree (node_modules junctioned).
- **`main` = production, auto-deploys on push. NEVER push without explicit permission;** show
  `git log origin/main..HEAD` first. **Don't ask about commits** (commit when shipping). tsc baseline = 3.
- D1 migrations: local-first; **confirm before any `--remote`**; apply ONE file via `d1 execute --remote
  --file <m> --config worker/wrangler.toml -y` (NEVER `migrations apply --remote`). Remote reads safe.
- Module round-trip contract: `handoffs/foundry-module/2026-06-07-items-native-conversion.md` (all types incl weapon).
- **Verify against the real export** (`E:/DnD/Professional/Foundry Export/Items/items-items-export.json`) with
  a node script before claiming an import fix works — that's how the 4 hotfixes were root-caused.
