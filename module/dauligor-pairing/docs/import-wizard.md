# Import Wizard (UI + flow)

The import wizard (`DauligorImporterApp`, `scripts/importer-app.js`) is the
in-Foundry UI for pulling published Dauligor content into a world or onto an
actor. This doc covers the **wizard flow and dispatch** — not the payload
formats, which live in the per-family `*-import-contract.md` files.

**Related docs**
- Data formats: [`class-import-contract.md`](class-import-contract.md), [`spell-import-contract.md`](spell-import-contract.md), [`feat-import-contract.md`](feat-import-contract.md), [`item-import-contract.md`](item-import-contract.md).
- [`source-library-contract.md`](source-library-contract.md) — the source catalog the wizard reads to populate Step 2.
- [`ui-entry-points-and-visibility.md`](ui-entry-points-and-visibility.md) — where the importer is opened from and who can open it.
- [`page-system.md`](page-system.md) — the *separate* read-only content viewer (not the importer).

## Steps

1. **Import type** — pick what to bring in.
2. **Data source** — pick one or more source books.
3. **Browse + import** — opens the family browser; selected entries import onto
   the target actor (or world, for classes).

## Import types

| Type | Status | Browser opened | Import target |
|---|---|---|---|
| `classes-subclasses` | ready | class browser | world items + actor |
| `spells` | ready | spell browser | actor-embedded |
| `feats` | ready | feat browser (`only: "feat"`) | actor-embedded |
| `backgrounds` | ready | feat browser (`only: "background"`) | actor-embedded |
| `species` | ready | feat browser (`only: "race"`) | actor-embedded |
| `items` | soon | — | — |

All types are shown to every user. What actually **succeeds** is governed by
Foundry's own permissions (see "Permissions" below) — the wizard does not gate by
role.

## Source loading (Step 2)

Types in `API_SOURCE_IMPORT_TYPES` (`classes-subclasses`, `spells`, `feats`,
`backgrounds`, `species`) load their source list live from the API source catalog
(`<host>/api/module/sources`), rather than the static `SOURCE_TYPES` map. The
helper `importTypeUsesApiSources(id)` is the single switch for this.

Sources are filtered by a generic count column: an entry is kept if it lists the
type in `supportedImportTypes` **or** has a positive `counts.<type>` — and an
entry whose count is *absent* is accepted (unknown → show it; legacy catalogs).
The active count is shown per source ("12 spells", "5 backgrounds", …). `species`
is its own plural.

## Dispatch (Step 3)

When the user confirms, `importTypeId` routes to a browser:

- **`spells`** → `openSpellBrowser(actor, { sourceSlugs })`.
- **`feats` / `backgrounds` / `species`** → `openFeatBrowser(actor, { sourceSlugs,
  only })` where `only` is `"feat"`, `"background"`, or `"race"`.
- **`classes-subclasses`** → `openDauligorClassBrowser({ actor, catalogUrls, … })`.

`sourceSlugs` are `entry.slug` (falling back to `entry.id`) and feed the per-source
catalog URLs.

### Backgrounds + Species reuse the feat browser

There is no separate background/species browser. The feat browser
(`scripts/feat-browser-app.js`) already fetches the background/species catalogs,
synthesizes feat-shaped pool entries (`flags.dauligor-pairing.featType` =
`"background"` / `"race"`), routes the correct detail endpoint, and embeds the
native `background` / `race` item. An **`only`** scope restricts it to one
`featType`:

- `openFeatBrowser(actor, { sourceSlugs, only })` → `DauligorFeatBrowserApp` with
  `_only` set.
- `_loadPool` fetches **only** that featType's catalog (so the pool and its source
  counts reflect the dedicated section); `only: null` loads the full merged pool.
- The window title and `setOnly()` reflect the scope ("Import Backgrounds" /
  "Import Species" / "Import Feats").

The `feats` dispatch passes `only: "feat"` so each section is dedicated rather than
a mixed feats+backgrounds+species pool.

## Catalog + detail endpoints (public, CORS-open)

These are `/api/module/*` (no auth):

| Family | List | Detail |
|---|---|---|
| Spells | `/api/module/<slug>/spells.json` (`dauligor.source-spell-list.v1`) | `/api/module/spells/<id>.json` |
| Feats | `/api/module/<slug>/feats.json` (`dauligor.source-feat-list.v1`) | `/api/module/feats/<id>.json` (`dauligor.feat-item.v1` → `payload.feat`) |
| Backgrounds | `/api/module/<slug>/backgrounds.json` (`dauligor.background-catalog.v1`) | `/api/module/backgrounds/<id>.json` (`dauligor.background-item.v1` → `payload.background`) |
| Species | `/api/module/<slug>/species.json` (`dauligor.species-catalog.v1`) | `/api/module/races/<id>.json` (`dauligor.race-item.v1` → `payload.race`) |

Note the species **detail** segment is `races` (Foundry's species item type is
`race`), while the **list** file is `species.json`.

## Document creation

- **Spells / feats / backgrounds / species** import as **embedded items** on the
  target actor: `actor.createEmbeddedDocuments("Item", [itemData])` (or
  `updateEmbeddedDocuments` when an existing match is found by `sourceId`, else
  name+type).
- **Classes / subclasses** create **world items** (`Item.createDocuments`) in the
  configured Classes folder, plus actor-side wiring. See
  [`class-import-and-advancement-guide.md`](class-import-and-advancement-guide.md).

## Permissions (multiplayer)

The wizard is permission-agnostic — it shows all types to everyone and lets
Foundry enforce what's allowed:
- A player owns their character, so embedded imports (spells / feats / backgrounds
  / species) onto **their own** actor succeed.
- Class import writes **world items**, which a non-GM can do only if the world
  grants the "Create New Items" permission. Otherwise Foundry blocks it with its
  own permission error — this is Foundry's gate, not a Dauligor restriction.
