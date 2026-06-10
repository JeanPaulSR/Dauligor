# Table Structure: `crafting_disciplines`

The admin-managed taxonomy that organizes **all** crafting (Alchemy, Blacksmithing,
Enchanting, …) — the organizing axis of the crafting editor. `recipes.disciplineId`
references it; `crafting_materials.usedFor` is a JSON array of its ids.

Migration `20260609-1350_create_crafting_disciplines.sql` — seeded from Kibbles' Chapter 6
disciplines (idempotent, admin-editable). **Lightweight by decision** (the 2026-06-09
[Kibbles reconciliation](../../_drafts/kibbles-reconciliation-2026-06-09.html)): the
execution fields (ability score / tool / forge facility) are **deferred to Phase D** (live
crafting).

> **camelCase columns.** Foundry is camelCase end-to-end (verified against real exports —
> `baseItem`, `magicalBonus`, and the ordering field is `sort`), and we are migrating off
> snake_case. So this taxonomy is camelCase. It is edited by the shared
> `ProficiencyEntityShell` driven in **camelCase mode** (`columnCase="camel"`): the shell
> then persists `sort` + `updatedAt` instead of the legacy `order` + `updated_at`. Edited
> via a tab in `AdminProficiencies.tsx` (Items group).

## Layout Specs

| SQL Column | Type | Notes |
|---|---|---|
| `id` | TEXT (PK) | Stable id (e.g. `cdisc-enchanting`); new rows get a UUID |
| `name` | TEXT NOT NULL | Display name (e.g. "Enchanting") |
| `identifier` | TEXT NOT NULL UNIQUE | Slug (e.g. `enchanting`) |
| `description` | TEXT | Optional |
| `sort` | INTEGER | Display order (Foundry's `sort` field name; the shell's `includeOrder` field) |
| `createdAt` / `updatedAt` | DATETIME | DEFAULT CURRENT_TIMESTAMP |

## Seeded values
`alchemy`, `poisoncraft`, `blacksmithing`, `cooking`, `enchanting`, `scrollscribing`,
`wand-whittling`, `leatherworking`, `tinkering`, `woodcarving`, `runecarving`,
`engineering`, `jewelcrafting`. (Admin can add/edit/remove — e.g. Kibbles' minor branches
Weaving/Cobbling/Masonry/Glassblowing/Painting/Brewing/Carpentry/Tailoring.)

## Future (Phase D — live crafting)
When crafting execution lands, extend this table with: ability score(s) (supporting
INT-or-WIS choices), tool/skill used, a consecutive-checks flag, and a facility
requirement (forge/heat/none).

## Related docs
- [`recipes.md`](recipes.md) — `recipes.disciplineId` references this
- [`crafting_materials.md`](crafting_materials.md) — `usedFor` references this
