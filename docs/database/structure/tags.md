# Table Structure: Tag Taxonomy

System for categorizing all entities (Classes, Spells, Items, Lore).

## Table: `tag_groups`

| SQL Column | Type | Firestore Equivalent | Note |
| :--- | :--- | :--- | :--- |
| `id` | TEXT (PK) | Document ID | |
| `name` | TEXT NOT NULL | `name` | e.g., "Damage Types". |
| `category` | TEXT | `category` | (Legacy) First classification. |
| `classifications`| JSON | `classifications` | Array of system types (spell, lore, etc). |
| `description` | TEXT | `description` | |
| `updated_at` | DATETIME | `updatedAt` | |

## Table: `tags`

| SQL Column | Type | Firestore Equivalent | Note |
| :--- | :--- | :--- | :--- |
| `id` | TEXT (PK) | Document ID | |
| `group_id` | TEXT NOT NULL (FK) | `groupId` | Links to `tag_groups.id`. |
| `name` | TEXT NOT NULL | `name` | e.g., "Fire". |
| `slug` | TEXT NOT NULL | `slug` | URL-safe identifier. Unique within `(group_id, parent_tag_id)` — see below. |
| `parent_tag_id` | TEXT (FK, nullable) | `parentTagId` | When non-NULL, this is a subtag whose direct parent is the referenced tag. NULL = root tag. Added in migration `20260512-1200`. |
| `updated_at` | DATETIME | `updatedAt` | |

### Indexes

- `idx_tags_group` on `(group_id)` — primary list query.
- `idx_tags_parent_tag` on `(parent_tag_id)` — "give me all children of this tag".
- `tags_group_parent_slug_uniq` UNIQUE on `(group_id, COALESCE(parent_tag_id, ''), slug)` — replaces the original `UNIQUE (group_id, slug)`. COALESCE collapses NULL parents into one bucket so duplicate **roots** still collide while subtags only need to be unique among siblings. Added in migration `20260512-1418`.

## Implementation Notes

### Visibility

Tag groups use `classifications` to determine where they appear in the UI. A group classified as `spell` will only appear in the Spell Editor tag selector.

### Hierarchy

Tags are 2-level by design: root tag → subtag. The schema doesn't enforce the depth cap because SQLite CHECK constraints can't run subqueries — the editor enforces it by only exposing the "Add Subtag" affordance on tags whose `parent_tag_id` is NULL. If you ever want to deepen the hierarchy, expect to revisit the unique-index expression and the per-group renderer in `TagGroupEditor.tsx`, which assumes exactly 2 levels.

### Hierarchical query matching

Tag matching in spell-rule queries and spell-list filters is **subtag-aware**: a spell tagged with a subtag is treated as also carrying its ancestor tags. So filtering for `Conjure` matches spells tagged with `Conjure`, `Conjure.Manifest`, or `Conjure.Summon`; filtering for `Conjure.Manifest` matches only `Conjure.Manifest` (siblings and the bare root do NOT match).

The expansion is **spell-side**, not query-side — the matcher reads `expandTagsWithAncestors(spell.tags, parentByTagId)` into a Set and checks each query tag for set membership. Equivalent semantically to expanding the query, cheaper because we walk ancestors per spell instead of descendants per query tag.

`expandTagsWithAncestors` and `buildTagParentMap` live in [`src/lib/tagHierarchy.ts`](../../../src/lib/tagHierarchy.ts). The same algorithm is inlined into [`api/_lib/_spellFilters.ts`](../../../api/_lib/_spellFilters.ts) because Vercel bundling can't reliably traverse cross-folder imports — drift contract: keep both copies in sync.

Call sites that pass `parentByTagId` to the matcher today:
  - `src/lib/spellFilters.ts` (`matchSpellAgainstRule`) — central matcher
  - `src/lib/classExport.ts` — bake-time `spellRuleAllowlists` resolution
  - `api/_lib/_classExport.ts` — server bake for module export
  - `src/hooks/useSpellFilters.ts` — public/admin spell-list filter
  - `src/pages/compendium/SpellList.tsx` — public browse filter (uses its own inline filter loop)
  - `src/pages/compendium/SpellListManager.tsx` — per-class spell-list filter

Module-side `requirements-walker.js` does NOT need an explicit hierarchy walk because allowlists are baked server-side and already include subtag-derived matches.

### Hierarchical prereq satisfaction (required_tags)

Spell `required_tags` checks against the character's **effective tag set** use the same hierarchy rule, applied in the symmetric direction:

- A spell that requires `Conjure` is satisfied by a character carrying `Conjure`, `Conjure.Manifest`, or `Conjure.Summon` — having a more-specific descendant covers the generic requirement.
- A spell that requires `Conjure.Manifest` is NOT satisfied by a character carrying only the bare `Conjure` or the sibling `Conjure.Summon`. The prereq asks for that exact subtag.

Implemented in [`src/lib/characterTags.ts`](../../../src/lib/characterTags.ts) — `characterMeetsSpellPrerequisites` and `missingPrerequisiteTags` both accept an optional `parentByTagId: Map<string, string | null>` and call `expandEffectiveTagSetWithAncestors` on the character's set before comparing. Without the map, matching falls back to flat exact-id comparison (back-compat).

Currently consumed by `src/pages/characters/CharacterBuilder.tsx` (Spell Manager — block-add and missing-tag highlight); the helpers are exported for any future surface that needs prereq evaluation.

### Migration traps — read before authoring another `tags` migration

1. **D1 forbids `BEGIN TRANSACTION` / `COMMIT` / `PRAGMA` in user SQL.** wrangler errors out with the `state.storage.transaction()` message. D1 wraps the file atomically on its side; write plain DDL only. (See the header of `20260512-1418_tags_parent_aware_unique.sql`.)
2. **Use the canonical SQLite rebuild order: CREATE new → INSERT → DROP old → RENAME.** The intuitive-looking reverse (RENAME tags → tags_old, then CREATE tags, then DROP tags_old) is silently broken: with `PRAGMA legacy_alter_table=OFF` (SQLite ≥ 3.26 default, including D1), `ALTER TABLE RENAME` auto-rewrites FK references in OTHER tables to point at the new name. The single inbound FK is `lore_article_tags.tag_id REFERENCES tags(id) ON DELETE CASCADE` — the wrong order leaves it dangling at a non-existent table, which won't visibly break production (the table is currently empty) but will fail FK validation the moment a lore article gets tagged.
3. **Self-references survive RENAME.** In a rebuild, declare `parent_tag_id TEXT REFERENCES <temp_table>(id)`; the RENAME auto-rewrites it to `REFERENCES tags(id)` (still a self-reference). The same FK-rewrite-on-rename behavior that hurts you with the wrong order helps you with the right one.

## Tag consumers — who actually references tags?

This list drives **`src/lib/tagUsage.ts`** (the scanner that powers the "Used by N" pill on every tag). If you add or remove a tag-consuming column anywhere in the schema, **update the scanner's SQL alongside the migration** or the count will be wrong:

| Consumer | Column shape | Storage |
|---|---|---|
| `spells.tags` | JSON array of tag ids | TEXT |
| `spells.required_tags` | JSON array (prerequisite usage — NOT counted as "descriptive" usage today) | TEXT |
| `feats.tags` | JSON array | TEXT |
| `features.tags` | JSON array | TEXT |
| `items.tags` | JSON array | TEXT |
| `classes.tag_ids` | JSON array (note the column name differs) | TEXT |
| `subclasses.tag_ids` | JSON array (note the column name differs) | TEXT |
| `unique_option_items.tags` | JSON array | TEXT |
| `lore_article_tags(article_id, tag_id)` | dedicated junction table | rows |

Skipped on purpose: `sources.tags` and `image_metadata.tags` (admin/meta layers, not user-curated taxonomy).

## Tag usage scanner design (`src/lib/tagUsage.ts`)

The pill on each tag row in `TagGroupEditor` shows "Used by N" with a per-kind tooltip breakdown. The scanner that powers it has three constraints worth knowing if you touch the helper or the consumer list:

### Constraint 1 — D1 caps compound SELECT at 5 terms

Vanilla SQLite's `SQLITE_MAX_COMPOUND_SELECT` defaults to 500, but D1's build sets it much lower. Smoke-tested in May 2026: **6 UNION ALL terms throws `too many terms in compound SELECT`, 5 terms succeeds**. Today's scanner has 8 consumer kinds, so the work splits into **two 4-term queries fired in parallel via `Promise.all`** (see `USAGE_SCAN_SQL_A` / `USAGE_SCAN_SQL_B` in the helper).

When adding a 9th consumer kind, you must either:
- Rebalance the two queries so neither exceeds 5 terms, or
- Add a third query and broaden the `Promise.all`.

Don't merge the two queries into one big UNION just because you found a way to make it fit — keep the explicit split so the limit is documented in code.

### Constraint 2 — Pre-aggregate server-side via `json_each` + `GROUP BY`

Each branch uses `FROM <consumer> JOIN json_each(<consumer>.<col>) je` to unnest the JSON tag array, then `GROUP BY je.value` so the worker returns one row per `(tag_id, kind)` pair instead of one row per entity. Payload is bounded by `tag_count × kinds_in_query`, almost always under a few hundred rows even for a fully-tagged catalog.

`json_valid` + `je.value IS NOT NULL AND je.value != ''` filters guard against malformed cells — a corrupt tag column on one entity won't crash the scan.

### Constraint 3 — In-memory cache, 30s TTL, explicit invalidation on delete

Scan results are module-scoped and time-bounded (`CACHE_TTL_MS = 30_000`). Rapid group-to-group navigation reuses the prior result; the helper's `invalidateTagUsageCache()` is called from `TagGroupEditor.handleDeleteTag` so destructive actions force a fresh scan on next read. **Tag add and rename don't invalidate** — the tag's id is stable across rename, and a brand-new tag has no usage yet, so the cached map remains correct.

If you add a new flow that changes existing entities' tag references (a planned "merge tags" action falls into this bucket), call `invalidateTagUsageCache()` after the write.

### Skipped categories

- `spells.required_tags` is intentionally not counted today. Prerequisite usage is conceptually distinct from descriptive tagging (the spell isn't "about" the tag, it requires it on the caster). Mixing the counts would muddle the "how often is this tag used to describe things" question the pill is meant to answer. Add a separate `required` column to `TagUsageBreakdown` if/when that flow gets its own surface.
- `sources.tags` and `image_metadata.tags` — admin/meta layers, not user-curated content.

## Related code

| File | Purpose |
|---|---|
| `src/lib/tagHierarchy.ts` | Normalize raw rows, order tags as roots-then-subtags, picker label prefix (`↳ `). |
| `src/lib/tagUsage.ts` | The two-query scanner + 30s cache + breakdown summarizer. |
| `src/pages/compendium/TagManager.tsx` | Top-level group list (preview chips, smarter count tile, empty-state). |
| `src/pages/compendium/TagGroupEditor.tsx` | Per-group editor with subtag adds, filter, collapse, "Used by N" pills, blast-radius delete confirm. |
| `worker/migrations/20260512-1200_tags_parent_tag_id.sql` | Adds `parent_tag_id` + index. |
| `worker/migrations/20260512-1418_tags_parent_aware_unique.sql` | Parent-aware unique rebuild. |
