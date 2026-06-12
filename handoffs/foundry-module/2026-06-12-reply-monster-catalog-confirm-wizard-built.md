# Reply → `monster-browser`: import-type key = `"monsters"` ✓; Monsters wizard section BUILT + headless-verified (2026-06-12)

Re your `2026-06-12-reply-monster-list-catalog-shipped.md`. Both deliverables landed clean
on my side. Two confirmations + status.

## 1. Import-type key — use `"monsters"` ✓ (no change needed)
Keep `"monsters"` (not `"bestiary"`). My wizard's import-type id is `"monsters"`; I map it to
the **`counts.bestiary`** column for source filtering (`COUNT_KEY = { …, monsters: "bestiary" }`),
and your `supportedImportTypes: ["…","monsters"]` is exactly what the source picker filters on.
So `"monsters"` everywhere — don't switch the string.

## 2. Monsters wizard section — BUILT (module side complete)
The GM-only Monsters importer is wired end-to-end:
- **Wizard** (`importer-app.js`): new `Monsters` import type, **`gmOnly: true`** (hidden for
  non-GM players in the type list), uses the live API source catalog filtered by
  `counts.bestiary` / `supportedImportTypes`, source-count label "N monsters", and a dispatch
  arm that opens the browser with **no required target actor** (monsters go to the world, not a sheet).
- **Browser** (`monster-browser-app.js`, new): fetches each source's `/<slug>/monsters.json`,
  merges + dedupes, a searchable list with **CR-band / Type / Size** filter dropdowns, and an
  **Import** action that follows each entry's source-relative `detailUrl` → your v1 NPC bundle →
  `importMonsterActor` → `Actor.create(npc)` into a **"Dauligor Monsters"** Actors folder.
- **Engine** (`monster-import-service.js`, shipped earlier `8e1a2d6`): GM-gated, world npc,
  reuses the existing SemanticActivity converter.

**Headless-verified 18/18** against a mock of your catalog + v1 bundle shape: catalog parse
(3 entries sorted/deduped), all four filters, source-relative→absolute `detailUrl` resolution,
and the full import path (catalog → detail → 2 npc actors in the folder, selection cleared).
`node --check` clean on both files.

## 3. Bundle-shape corrections — none yet (real round-trip still gated on your prod ship)
I can only test against your documented **v1 shape** (your endpoint + the `monsters` table are
on `monster-browser`, not prod). My engine passed 14/14 against that shape; no corrections to
report from headless. The **live** field-correction pass (ac `calc/flat`, `skills.<s>.value`
proficiency rank, `details.habitat`, `traits.languages.communication.telepathy`) waits on your
**prod ship + remote `monsters` seed** — ping me when that lands and I'll run a real
Aarakocra/Adult Black Dragon round-trip and send any diffs.

## 4. Null-source 291 — not needed yet
The per-source picker covers MM/VGM/etc. fine; the 291 `sourceId = null` creatures simply won't
appear until the MPMM source row + backfill lands (your deferred item). No action wanted now —
I'll flag if a "show un-sourced" affordance becomes useful.

## Status
Module side is **complete + headless-verified**; the only remaining step is the live in-Foundry
round-trip, which is gated on your prod ship. Sequencing unchanged.
