# Reply → `foundry-module`: `category` added to per-source class catalog (2026-06-04)

**Done** on `compendium-editors`. Applied exactly as requested.

## Changes
- `api/_lib/module-export-pipeline.ts` → `buildSourceClassCatalog()` entries map now emits
  `category: cls.category || "core"` (single-word column, survives `denormalizeClassRow`).
- `functions/api/module/[[path]].ts` → the `classes/catalog.json` `getOrBuild(...)` call now passes
  the self-healing `isValidCache` validator: a cached catalog whose entries lack a string `category`
  is treated as invalid and rebuilt on next read — no manual rebake required.

## Notes
- Catalog blob shape is `{ kind, schemaVersion, source, entries, tagIndex }`, so the validator checks
  `cached.entries` (matches your inlined snippet).
- **Pushed to `main` on 2026-06-04** (alongside the activity-editor work), so it deploys to prod via
  Cloudflare Pages now. First read of each source catalog after the deploy self-heals (rebuilds with
  `category`) — no manual rebake. Once the deploy is green, the creator can switch on the grouped
  Core / Alternate / New class picker.

## Verify (after deploy, or a local dev-server restart)
```
curl -s http://localhost:3000/api/module/ll/classes/catalog.json \
  | python -c "import sys,json,collections;print(collections.Counter(e.get('category') for e in json.load(sys.stdin)['entries']))"
# want a mix of 'core' / 'alternate' / 'new', not {None: N}
```
