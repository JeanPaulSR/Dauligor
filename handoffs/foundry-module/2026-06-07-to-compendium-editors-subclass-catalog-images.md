# Request → `compendium-editors`: add subclass `img` to the per-source class catalog (2026-06-07)

**Ask:** please surface each subclass's image on the **per-source class catalog**
entries' `subclasses[]` array (`/api/module/<source>/classes/catalog.json`). The
catalog already ships `subclasses[]` as `{ sourceId, name, shortName }` — just add
`img`. The image already exists on the `subclasses` table (`image_url`) and on the
full class bundle; it's only missing from the catalog the Foundry side reads.

`foundry-module` is **not** touching the app-side files or your dev server for this
(per owner direction — `api/_lib` + the router + the `:3000` server are yours). This
is a request with the exact change inlined so it's a quick apply. Directly analogous
to the `category` request (`2026-06-04-to-compendium-editors-class-category.md`),
same function.

## Why

The Foundry import wizard's class list now follows the character creator: a
collapsible class list where each class expands to **image + name + source** subclass
rows. Class thumbnails come from the catalog's `entry.img` and work. Subclass rows
currently render a fallback glyph because the catalog's `subclasses[]` carry no image.

Module side already backfills subclass thumbnails from the **bundle** once a class is
selected (its bundle loads for the inline ClassView, and `subclasses[].imageUrl` is
copied onto the row — see `_enrichSubclassImages`). But that only covers the selected
class; classes the user merely expands (without selecting) still show glyphs until
selected. Shipping `img` in the catalog gives every subclass its thumbnail with no
bundle load. **Until it ships, nothing breaks — subclasses just show a glyph until
their class is selected.**

## The data is already there

`subclasses.image_url` is the per-subclass art; it survives `denormalizeSubclassRow`
as `imageUrl`. The catalog builder just doesn't SELECT or emit it.

## Suggested change (two edits, same function)

In `api/_lib/module-export-pipeline.ts` → `buildSourceClassCatalog()`:

1. Add `image_url` to the subclass batch query + carry it through (the
   `subclassesByClassId` map). Update the map's value type to include `img`:

```ts
// type: Map<string, Array<{ identifier: string; name: string; shortName: string; img: string }>>
const subRes = await executeD1QueryInternal({
  sql: `SELECT id, class_id, identifier, name, source_id, image_url FROM subclasses WHERE class_id IN (${placeholders})`,
  params: classIds,
});
// …in the row loop, on the pushed object:
list.push({
  identifier: row.identifier || row.id,
  name: row.name,
  shortName,
  img: row.image_url || "",   // ← add
});
```

2. Include `img` when mapping into the catalog entry's `subList` (matches the class
   entry's `img` field name, so the module reads them the same way):

```ts
const subList = (subclassesByClassId.get(cls.id) ?? [])
  .map((sub) => ({ sourceId: `subclass-${sub.identifier}`, name: sub.name, shortName: sub.shortName, img: sub.img }))
  .sort((a, b) => a.name.localeCompare(b.name));
```

## One gotcha — the R2 cache

Same as the `category` request: the catalog route serves the cached blob first
(`getOrBuild(sourceClassCatalogKey(slug), …)`). After deploy, either rebake the
source class catalogs once, or pass `getOrBuild` a validator that rebuilds a cached
catalog lacking the field — e.g. require the `img` **key** to be present on
subclasses (empty string is valid — not every subclass has art):

```ts
(cached: any) => Array.isArray(cached?.entries)
  && cached.entries.every((e: any) =>
    !Array.isArray(e?.subclasses) || e.subclasses.every((s: any) => typeof s?.img === "string")),
```

## Module side (mine — done, degrades gracefully)

The class list reads `subclass.img` and renders the thumbnail when present, else a
glyph. The select-time bundle backfill (`_enrichSubclassImages`) stays regardless —
it's harmless once the catalog ships `img` (it only fills empties). So nothing breaks
in the window before you apply this; subclasses just get their art sooner once it lands.

## Verify

```
curl -s http://localhost:3000/api/module/phb/classes/catalog.json \
  | python -c "import sys,json; e=json.load(sys.stdin)['entries']; print([ (s.get('name'), bool(s.get('img'))) for x in e for s in x.get('subclasses',[]) ][:8])"
# want subclass names paired with True where art exists, not a missing 'img' key
```
