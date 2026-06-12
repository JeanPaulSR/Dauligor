# Monster Browser + NPC Editor — resume (2026-06-10, pre-compaction)

**Read-this-first.** The public Monster Browser is shipped; the admin **NPC/Monster Editor**
at `/compendium/monsters/manage` is built through **P4** + an **activity-shape rework** + a
working **Foundry export endpoint**. Everything below is the current state + the exact next steps.

---

## 0. Where the knowledge lives
| What | Where |
|---|---|
| **Live running state + full detail** | memory `C:\Users\Jean\.claude\projects\E--DnD-Professional-Dev-Dauligor\memory\project_monster_browser.md` (authoritative). Index: `MEMORY.md`. |
| **Editor design + phasing** | `docs/_drafts/npc-editor-design-2026-06-10.html` (parchment doc). |
| **Foundry-export design** (the "general idea" + why the old tuple was inert) | the `understand-foundry-export` workflow synthesis (in the session transcript); summarized in the project memory's export section. |
| **Schema** | `docs/database/structure/monsters.md` (57 camelCase cols). |
| **Stat-block shapes** | `docs/_drafts/monster-statblock-shapes-and-schema-2026-06-09.html`. |
| **Prior resume (browser P1–4)** | `handoffs/monster-browser/2026-06-10-phase3-done-phase4-resume.md`. |
| **Cross-branch port + process rules** | memory `feedback_cross_branch_handoff.md` (port table, inspector-collision fix, scoped-kill rule). |

---

## 1. Git state
Branch **`monster-browser`** (worktree `jolly-mayer-71aa42`). HEAD `c6276e1`. **`origin/monster-browser`
is way behind (`e553743`) — many commits unpushed. NOTHING pushed to main / remote D1.** `main` =
production (auto-deploys) — **never push without explicit permission**; show `git log origin/main..HEAD` first.

Recent commits (newest first):
```
c6276e1 docs: R5 handoff (foundry-module NPC-actor import)
2f85b0b feat: Foundry export endpoint /api/module/<src>/monsters/<id>.json   ← R4
95530ec refactor: activities are now real SemanticActivity (Foundry-exportable)
16ad138 feat: NPC editor P4 — actions & traits section editors
62d8af9 feat: NPC editor P3 — damage/condition/language/habitat + tags/images/lore
3d96569 feat: NPC editor P2 — abilities/saves-skills/movement-senses
4ccbaa4 feat: NPC editor P1 — scaffold + header + camelCase save + live preview
b73b212 chore: remove other branches' stale launchers from this worktree
b068960 chore: remove stale dev-sysapp.mjs
a3dd540 fix: console/formatting cleanup (DOM nesting, asChild, HMR, VirtualizedList key)
```
Clean tree. **tsc baseline = 2** (`characterShared.ts` + `SpellList.tsx:779` asChild — not ours).

---

## 2. What's DONE
**Public browser** (read-only, `/compendium/monsters`) — shipped earlier (P1–4 + cleanup).

**NPC Editor** (`/compendium/monsters/manage`, admin entry = "Monster Manager" button on the public
list, gated admin+co-DM). Built on the shared **`CompendiumEditorShell`** (list | form sub-tabs |
live preview — the public `MonsterDetailPanel` via its `row` prop). Files:
- `src/pages/compendium/MonstersEditor.tsx` — the page (state, list+filters, save/delete, sub-tabs, preview).
- `src/components/compendium/monster/` — `fields.tsx` (shared primitives + `MonsterForm`/`SetForm`),
  `MonsterBasicsTab` (identity+type+core+abilities+images), `MonsterDefensesTab` (saves/skills +
  damage R/I/V + condition + languages), `MonsterMovementSensesTab` (movement+senses+habitat),
  `MonsterActionsTab` (7 sections), `MonsterSectionListEditor` (accordion: name+prose+uses/costs+
  **shared `ActivityEditor`**), `ChipMultiSelect`, `DamageModEditor`.
- `src/lib/compendium.ts` — `upsertMonster`/`fetchMonster`/`deleteMonster` (**camelCase-native, NO
  normalizeCompendiumData** — form keys === column names).
- `src/lib/monsterDisplay.ts` — display helpers + enums (CR/size/type/ability/skill, DAMAGE_TYPES/
  BYPASSES/CONDITIONS/HABITATS, SKILL_ABILITY, derived crToXp/crToProfBonus/computePassivePerception).

Phases: **P1** header+save+preview · **P2** abilities+saves/skills+movement/senses (prefill + "→ +N"
recompute nudge; XP auto, others keep authored values) · **P3** damage/condition/languages/habitat +
tags (`TagPicker`) + images (`ImageUpload` ×2) + biography (`MarkdownEditor`) · **P4** the 7 body
sections as accordion editors.

**⭐ Activity-shape rework (`95530ec`) — the important architecture decision.** The P4 activities
were a LOSSY display tuple (baked numbers) → INERT if re-exported to Foundry. Reworked to the shared
**`SemanticActivity`** (formula-bearing). `src/lib/monsterImport.ts` `buildAction` now maps each
Foundry activity through the shared **`foundryActivityToSemantic`** (`src/lib/foundryActivities.ts`)
— formulas preserved (`attack.bonus:"@mod"`, `save.dc.formula`, damage dice components). Deleted the
lossy helpers + the bespoke `MonsterActivityEditor`; the editor now uses the **shared `ActivityEditor`**
(`context="feat"`). Reader is prose-driven (dropped `synthesizeActivityLine`). **Re-imported all 1001.**

**⭐ Foundry export endpoint (`2f85b0b`) — R4, app side, DONE.** The Monster Browser is THIS branch,
so its `/api/module` endpoint is ours (NOT a compendium-editors handoff — user clarified).
`api/_lib/_monsterExport.ts` (`buildMonsterBundleForIdentifier`) reconstructs a Foundry **NPC Actor**
from the camelCase columns (inverse of the importer) + emits each body entry as a `feat` Item whose
`system.activities = arrayToFoundryMap(entry.activities)` (the SemanticActivity[]). Routed live in
`functions/api/module/[[path]].ts` at `/api/module/<src>/monsters/<identifier>.json` → `serveLive`.
**Verified:** Adult Black Dragon → 200, npc, 19 items; Bite feat Item, `activities[0].kind=attack`,
`damage.parts[0].bonus="@mod"`.

---

## 3. What's NEXT
1. **P5 — spellcasting editor.** New `src/components/compendium/monster/MonsterSpellcastingTab.tsx`:
   edit the `spellcasting[]` block array (ability/level/method/dc/slots + a spell-catalog picker
   linked by `identifier` + prose `MarkdownEditor`). Wire it as a sub-tab in `MonstersEditor`.
   Shape: `Spellcasting[]` = `{ ability, level, saveDc, attackBonus, method, slots, prose,
   spells:[{identifier,name,level,method,uses?}] }`. `hasSpellcasting` already derives on save.
2. **P6 — Foundry import workbench.** Surface `monsterImport.ts` behind an admin UI (single/folder
   paste → `creatureEntryToMonsterRow` → preview → batch save) — a "Foundry Import" mode tab on the
   editor shell. Transform is battle-tested (1001 creatures).
3. **R5 (foundry-module, handed off).** `handoffs/foundry-module/2026-06-10-from-monster-browser-
   npc-actor-import.md` — the module must create the NPC Actor from the bundle + run each item's
   `system.activities` through the existing `normalizeSemanticActivityCollection`. Their territory;
   verify our `system.*` v1 reconstruction in real Foundry + send back field corrections.
4. **Gating tighten (handed off).** `handoffs/compendium-editors/2026-06-10-from-monster-browser-
   gate-monsters-writes-admin-codm.md` — narrow the proxy mutation gate from staff → admin+co-DM
   (frontend already hides the editor from non-(admin/co-dm)).
5. **Deferred:** add an MPMM `/admin/sources` row (291 creatures `sourceId=null`); dual-caster
   per-feat spell grouping (38); verify a monster bundle round-trips in Foundry once R5 lands.

---

## 4. Dev stack (IMPORTANT)
- **`node scripts/dev-monster-browser.mjs`** → app **:3006** / worker **:8793** / inspector :9234.
  ⚠ **Relaunch with `$env:WORKER_INSPECTOR_PORT='9244'`** — character-creator's stack squats :9234 and a
  wrangler inspector-port collision HARD-CRASHES the worker (symptom: app up, :8793 down, all D1
  `fetch failed`). Launch **detached** via `Start-Process` (the harness bg runner gets reaped mid-init).
- **no-watch** (`tsx server.ts`); restart the launcher to pick up source edits. **Pages Function
  changes** (`functions/`, `api/_lib/`) need an app restart (they're not Vite-transformed per request);
  client `.tsx` changes are picked up on browser reload.
- **Scoped kills ONLY** — walk the process subtree from THIS branch's `dev-monster-browser.mjs`
  launcher (`Get-Subtree`) + free only my ports (3006/8793/9244/24693). **NEVER** `taskkill /IM node`
  or blanket `Stop-Process workerd` — that kills the user's other stacks. This worktree's `scripts/`
  now holds ONLY `dev-monster-browser.mjs` (the sibling launchers were deleted). `taskkill /T` trips a
  harness path-guard — use `Stop-Process`.
- **Re-import recipe** (after any `monsterImport.ts` change): `mkdir -p worker/.wrangler/_import`;
  `wrangler d1 execute dauligor-db --local --config=worker/wrangler.toml --json --command="SELECT id,
  abbreviation, slug FROM sources" > .../sources.json` (+ `SELECT identifier FROM spells` → spells.json);
  `NODE_OPTIONS=--max-old-space-size=8192 npx tsx scripts/import-monsters.ts`; `wrangler d1 execute …
  --file=worker/.wrangler/_import/monsters.sql`. EXPORT defaults to
  `E:/DnD/Professional/Foundry Export/creatures/creatures-creatures-export.json`.
- Verify D1 directly with `wrangler d1 execute … --local --json --command="…"` + `json_extract`
  (the app `/api/d1/query` needs the browser's auth session; the worker `/query` needs the API_SECRET
  from `worker/.dev.vars`).

---

## 5. Constraints / gotchas
- `main` = production — don't push without permission; migrations **local-first** (never
  `migrations apply --remote`); D1 idiom `ON CONFLICT(id) DO UPDATE`.
- All `monsters` columns are **camelCase**; the save path must NOT run `normalizeCompendiumData`.
  JSON columns pass as objects (`upsertDocument` stringifies, `queryD1` auto-parses).
- **Activities are `SemanticActivity`** now (formula-bearing) — edited via the shared `ActivityEditor`,
  exported via `arrayToFoundryMap`. Do NOT reintroduce the baked-number tuple.
- **Shared widgets are import/read-only** (`ActivityEditor`, `MarkdownEditor`, `ImageUpload`,
  `TagPicker`, `CompendiumEditorShell`, `CompendiumBrowserShell`); a change to one = cross-branch handoff.
- Cross-branch boundary covers **running processes** too — never touch other branches' stacks/launchers.
- tsc baseline 2; verify headless (tsc clean + route 200 + module transform + D1 round-trip) — full UI
  render needs the browser's auth session.
