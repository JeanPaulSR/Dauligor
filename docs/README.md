# Dauligor Documentation Index

Topic-segmented documentation. If you're working on one area, you should not need to read another area's docs to make progress.

## "I'm working on…"

| Task | Start here |
|---|---|
| Setting up local dev | [operations/local-dev.md](operations/local-dev.md) |
| A new UI component / styling | [ui/style-guide.md](ui/style-guide.md) |
| A new feature in the wiki / lore system | [features/wiki-lore.md](features/wiki-lore.md) |
| A new compendium entity (class, spell, feat, item) | [features/](features/) — pick the matching feature doc |
| Character builder or sheet logic | [features/character-builder.md](features/character-builder.md) |
| Database schema change | [database/](database/) — read README first |
| Adding a new D1 query path | [platform/d1-architecture.md](platform/d1-architecture.md) |
| Adding an R2-stored asset type | [platform/r2-storage.md](platform/r2-storage.md) |
| Adding a Vercel function or Express route | [platform/runtime.md](platform/runtime.md) |
| Permissions / RBAC change | [architecture/permissions-rbac.md](architecture/permissions-rbac.md) |
| BBCode tag / TipTap extension | [ui/bbcode.md](ui/bbcode.md) |
| FoundryVTT pairing or export | [architecture/foundry-integration.md](architecture/foundry-integration.md) |
| Debugging an error | [operations/troubleshooting.md](operations/troubleshooting.md) |
| Backing up or restoring D1 | [operations/backup-restore.md](operations/backup-restore.md) |

## Topic trees

### [platform/](platform/) — runtime infrastructure
*Where things run, how they connect, and what env vars they need.*

- [runtime.md](platform/runtime.md) — the four runtimes (browser, Worker, Vercel functions, Express dev) and how requests flow between them
- [d1-architecture.md](platform/d1-architecture.md) — D1 client API, cache layers, foundation heartbeat, JSON columns
- [r2-storage.md](platform/r2-storage.md) — bucket layout, image types, WebP conversion, image-metadata table
- [auth-firebase.md](platform/auth-firebase.md) — what stays from Firebase (Auth only), JWT flow, RBAC server-side helpers
- [env-vars.md](platform/env-vars.md) — every env var, where it's read, and example values

### [database/](database/) — D1 schema
*The SQL data layer. Migration from Firestore is complete; that history lives under [_archive/](_archive/).*

- [README.md](database/README.md) — schema philosophy, migration index, reset workflow
- [structure/](database/structure/) — one doc per table (sources, classes, characters, lore_articles, …); 16 files

### [features/](features/) — domain-specific behaviour
*One doc per feature. UI work in feature X should not require reading feature Y.*

- [wiki-lore.md](features/wiki-lore.md) — articles, secrets, DM notes, nesting, era/campaign visibility
- [compendium-classes.md](features/compendium-classes.md) — classes, subclasses, features, advancements
- [compendium-spells.md](features/compendium-spells.md) — spell list, importer, summary index
- [compendium-feats-items.md](features/compendium-feats-items.md) — feats and item records
- [compendium-scaling.md](features/compendium-scaling.md) — scaling columns, spellcasting/pact-magic/spells-known progressions
- [compendium-options.md](features/compendium-options.md) — unique option groups, items, tags, requirements tree
- [active-effects.md](features/active-effects.md) — shared Active Effect editor: autocomplete catalog, status conditions + categories, change modes, export round-trip
- [character-builder.md](features/character-builder.md) — builder logic, progression-owned state
- [character-sheet.md](features/character-sheet.md) — sheet rendering, sub-tabs
- [campaigns-eras.md](features/campaigns-eras.md) — campaign and era management
- [admin-users.md](features/admin-users.md) — admin user panel, password reset, RBAC bootstrap
- [image-manager.md](features/image-manager.md) — image library UI, upload/rename/delete, reference scanning
- [foundry-export.md](features/foundry-export.md) — semantic export pipeline, `dauligor.actor-bundle.v1`
- [spellbook-manager.md](features/spellbook-manager.md) — *project:* per-class spell lists, spell rules, prereqs, Layer-2 GrantSpells/ExtendSpellList (all modes/resolvers), Layer-3 Spell Manager (filters/detail/caps/prereq gating/favourites/watchlist), Layer-4 Loadouts. **Foundry export round-trip handed off — see [handoff doc](handoff-spellbook-to-importer.md)**.

### [ui/](ui/) — visual layer
*Style guide, theming, rich text. No domain logic.*

- [style-guide.md](ui/style-guide.md) — every named CSS class, every component pattern
- [theming.md](ui/theming.md) — CSS variables, theme classes (`parchment`/`light`/`dark`)
- [bbcode.md](ui/bbcode.md) — supported tags, parser, TipTap extension config
- [content-rendering.md](ui/content-rendering.md) — `BBCodeRenderer` vs `Markdown`, recursive content shapes
- [components.md](ui/components.md) — Navbar, Sidebar, Dialog, FilterBar conventions

### [architecture/](architecture/) — cross-cutting design
*Things that span multiple features.*

- [routing.md](architecture/routing.md) — `App.tsx` route table, RBAC enforcement at the route boundary
- [permissions-rbac.md](architecture/permissions-rbac.md) — role matrix, `effectiveProfile`, preview mode
- [foundry-integration.md](architecture/foundry-integration.md) — pairing module philosophy, dual-state functionality
- [reference-syntax.md](architecture/reference-syntax.md) — `@prof` / `@level` / `@scale.*` formula references and exporter resolution
- [compendium-editor-patterns.md](architecture/compendium-editor-patterns.md) — the four CRUD patterns in use, decision tree, and **post-migration cleanup roadmap**

### [operations/](operations/) — running the app
*Setup, deployment, and what to do when things break.*

- [local-dev.md](operations/local-dev.md) — two-terminal setup, env vars, common gotchas
- [deployment.md](operations/deployment.md) — Vercel deploy flow, Worker deploy, D1 schema migrations
- [backup-restore.md](operations/backup-restore.md) — D1 backups, Time Travel recovery, restore workflows
- [troubleshooting.md](operations/troubleshooting.md) — D1 errors, cache resets, JWT issues, permission failures

### [_archive/](_archive/) — historical / pre-migration
*Reference only. Do not rely on these for current behaviour.*

- Pre-migration Firestore schema, rules, and session logs (`agent-memory.md`)
- Phase-by-phase migration plans (`migration-details/`) and the Firestore-cut punchlist
- Older versions of consolidated docs

---

## Conventions

- File paths are written as Markdown links so they're clickable in editors that support it.
- Each leaf doc aims for **focused depth** (50–250 lines) rather than breadth. If a doc starts spanning multiple domains, split it.
- New features must add or update the relevant doc in the same change set.
- Anything that becomes obsolete moves to [_archive/](_archive/), it doesn't get deleted (the file's history may still be useful for debugging).
