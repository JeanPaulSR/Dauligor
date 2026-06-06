# Request → `compendium-editors`: add `category` to the per-source class catalog (2026-06-04)

**Ask:** please surface the class `category` field on the **per-source class
catalog** entries (`/api/module/<source>/classes/catalog.json`). It already
exists on the full class bundle and in the `classes` table — it's just not in
the catalog the Foundry side reads.

`foundry-module` is **not** touching the app-side files or your dev server for
this (per owner direction — `api/_lib` + the router + the `:3000` server are
yours). This is a request with the exact change inlined so it's a quick apply.

## Why

The Foundry character-creator's class picker now divides classes into **Core /
Alternate / New**, mirroring the website's class list
(`src/pages/compendium/ClassList.tsx`, which groups on `category`). The module
already does the grouping; it just needs the field in the catalog. Until it
ships, the picker falls back to a flat list (no breakage).

## The data is already there

`classes.category` holds `core` / `alternate` / `new` and survives
`denormalizeClassRow` (single-word column). Verified via bundles on `:3000`:

| class | category |
|---|---|
| `phb/barbarian`, `mm/blood-hunter` | `core` |
| `ll/alternate-artificer`, `ll/alternate-blood-hunter` | `alternate` |
| `ll/magus`, `nts/keeper` | `new` |

## Suggested change (one line)

In `api/_lib/module-export-pipeline.ts` → `buildSourceClassCatalog()`, in the
`entries = classes.map(...)` object, add:

```ts
// Drives Core / Alternate / New grouping in the website class list and the
// Foundry creator's class picker. Default "core" matches the site's
// `!category` fallback so the field is always present.
category: cls.category || "core",
```

## One gotcha — the R2 cache

The catalog route serves through `getOrBuild(sourceClassCatalogKey(slug), …)`,
which returns the **cached** blob first. After deploying the field you'll want
one of:

- **Self-healing (preferred):** pass `getOrBuild`'s existing `isValidCache`
  validator on that call so a cached catalog lacking `category` rebuilds on next
  read — no manual rebake:
  ```ts
  (cached: any) => Array.isArray(cached?.entries)
    && cached.entries.every((e: any) => typeof e?.category === "string"),
  ```
- **Or** rebake the source class catalogs once after deploy.

## Module side (mine — done, degrades gracefully)

The creator reads `entry.category` and groups the picker (sticky Core / Alternate
/ New headers) **only when the catalog ships the field**; otherwise it renders
the current flat list. So nothing breaks in the window before you apply this.

## Verify

```
curl -s http://localhost:3000/api/module/ll/classes/catalog.json \
  | python -c "import sys,json,collections;print(collections.Counter(e.get('category') for e in json.load(sys.stdin)['entries']))"
# want a mix of 'core' / 'alternate' / 'new', not {None: N}
```
