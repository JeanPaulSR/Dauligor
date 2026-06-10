# Live Foundry verification checklist — shipped module work (2026-06-09)

Everything below shipped to `main` verified **headless only** — this is the in-Foundry
pass (task #13). Run as a **GM**, logged into a **Dauligor account** (refs + import +
debug export need auth/GM). Reload the world (F5) after pulling `main` into the
Foundry-linked checkout.

**Known data caveats (not bugs):**
- **Subclass thumbnails** in the import wizard show a glyph until `compendium-editors`'
  catalog `img` change reaches prod (it rides their pending push). On a selected class
  they fill in from the bundle (our backfill). Both are expected.
- **Species pickers** are empty on prod until the remote `species` table is seeded
  (their open data item). Backgrounds work.

---

## 1. Reference interactions
Put some refs in a journal / item description / chat: `@spell[fireball]`,
`@item[longsword]`, `@feat[...]`, `@background[acolyte]`, `@class[wizard]`, plus a
deliberately bad one like `@spell[does-not-exist]`.

- [ ] **Cards render** — each resolved ref shows an image + title + summary card.
- [ ] **"Reference not yet made"** — the bad/unresolved ref shows that distinct state (not a broken link).
- [ ] **Hover preview** — hovering a `.dauligor-ref` shows a preview card; hovering a Foundry `@UUID` content-link also previews (via `fromUuid`).
- [ ] **Click → temp item sheet** — clicking `@spell`/`@item`/`@feat`/`@background`/`@species` opens a **temporary** Foundry item sheet (NOT added to the world). **Click into an activity** in that temp sheet — it behaves like a normal item.
- [ ] **Drag → import** — hover the ref first (warms the cache), then drag it onto an actor sheet → the item imports.
- [ ] **`@class` → standalone window** — clicking a class ref opens the class-detail window (the rich ClassView), not a website tab, not a temp item.

## 2. Import wizard — Classes & Subclasses (the big one)
Open the importer → **Classes & Subclasses** → pick source(s).

- [ ] **Creator-style list (left):** class rows show **thumbnail + name + source tag**, grouped **Core / Alternate / New**.
- [ ] **Collapsed by default:** no subclasses shown until you expand.
- [ ] **Chevron** toggles a class's subclasses; **clicking a class** selects it AND auto-expands it.
- [ ] **Inline ClassView (right):** selecting a class shows the rich preview (header, level/PB table, Features/Subclass/Spell-List/Info tabs, Core-Traits sidebar).
- [ ] **Subclass thumbnails** appear under a selected class (bundle backfill; catalog once their push lands).
- [ ] **Click a subclass** → the preview **jumps to its Subclass section** (Subclass tab).
- [ ] **Two-way subclass sync** — the ClassView dropdown ↔ the card-grid radio stay in lockstep; the footer "Selected …" matches.
- [ ] **Search doesn't reload images** — type in the search box; thumbnails don't flicker/reload and the right pane doesn't churn.
- [ ] **Import still works** — "Configure & Import" (with an actor) / "Import Selected" imports the class as before.

## 3. Debug export → controls dropdown
- [ ] Open an **item / activity / effect** sheet as GM → the header **⋮ (controls) dropdown** → **"Dauligor Debug Export"** is there (no longer a raw always-visible header button). Clicking it exports the window.

## 4. Container contents round-trip
- [ ] **Export** an Actor/Item folder containing a populated container → in the JSON, the container's **children ride along** as sibling entries with `system.container` = the container's `_id` (even if they were `folder:null`).
- [ ] **Import** a container item that has `contents[]` onto an actor (e.g. via Import-from-URL of `/api/module/items/<containerId>.json`) → the container is created with its **children nested inside it**, quantities preserved.

## 5. Activity import (normalizeWorldItem)
- [ ] Import a **weapon with an activity** (e.g. attack + cast) and a **feat with a save** → the Activities tab shows the **native** Attack/Cast/Save with correct damage/attack/save config (not blank/invalid). Spot-check `item.system.activities[<id>].type` is a Foundry slug + `attack.type` is the nested `{value,classification}`.
- [ ] **Regression:** import a **spell** → its activities still come through (the guard skipped re-conversion — they come from `foundry_data`).

## 6. Item field round-trip (per type)
Import one of each and confirm the sheet:
- [ ] **Consumable (ammo):** type + subtype (arrow/…), damage, properties.
- [ ] **Container:** capacity (count/volume/weight), currency, attunement (when magical).
- [ ] **Weapon:** type (martialM/simpleR/…), base weapon, damage, range, ammunition (when `amm`), magical bonus.
- [ ] **Equipment (armor):** category + base armor, AC/dex/magical-bonus, strength; **vehicle:** AC/cover/crew/hp/speed.
- [ ] **Tool:** category + base tool, ability, proficiency (incl. expertise/half), bonus.

## 7. Creature export (derived values)
- [ ] Export the **Creatures** folder → in `creatureSummary`, confirm **`ac.value` is the real AC** (non-zero even for creatures with no armor item), **`proficiencyBonus`** is set, **`abilities.<a>.save`**, **`skills.<s>.total`/`.passive`**, **`passivePerception`**, **`spellcasting.dc`/`.attack`/`.level`** are populated, and **`source.rules`** ("2014"/"2024") is present. (`sourceDocument` stays raw.)

## 8. Character creator (older, still owed — #1)
- [ ] Open the creator → walk Class / Species / Background / Ability Scores tabs; confirm pickers, the ClassView preview, ability-score math, and HP-at-level-up behave.

---

When something here fails, capture the console error + which step — most of this is
DOM/Foundry-runtime behavior that headless can't reach, so live notes are the fix path.
