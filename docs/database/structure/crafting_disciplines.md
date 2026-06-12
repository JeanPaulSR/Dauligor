# Table Structure: `crafting_disciplines`

The admin-managed taxonomy that organizes **all** crafting (Alchemy, Blacksmithing,
Enchanting, …) — the organizing axis of the crafting editor. `recipes.disciplineId`
references it; `crafting_materials.usedFor` is a JSON array of its ids.

Migration `20260609-1350_create_crafting_disciplines.sql` (idempotent, admin-editable).
Each discipline records its core mechanics — the **tool** it uses and the **ability** its
crafting roll keys off (migration `20260610-1300`). A **facility** requirement is
deliberately NOT stored: it is a per-case DM call handled in the Foundry module.

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
| `tool_id` | TEXT (FK) | → `tools.id` — the tool the discipline uses (alchemist's supplies, smith's tools…). The shell's `categoryFK` picker, pointed at `tools`. Migration `20260610-1300`. **snake_case** to match the shell. |
| `ability_id` | TEXT (FK) | → `attributes.id` — the ability the crafting roll keys off (INT/WIS/STR/…). The shell's `includeAbility` field. Single ability for now (Kibbles' "Int **or** Wis" choices capture one). Migration `20260610-1300`. **snake_case** (shell-hardcoded). |
| `createdAt` / `updatedAt` | DATETIME | DEFAULT CURRENT_TIMESTAMP |

## Seeded values
`alchemy`, `poisoncraft`, `blacksmithing`, `cooking`, `enchanting`, `scrollscribing`,
`wand-whittling`, `leatherworking`, `tinkering`, `woodcarving`, `runecarving`,
`engineering`, `jewelcrafting`. (Admin can add/edit/remove — e.g. Kibbles' minor branches
Weaving/Cobbling/Masonry/Glassblowing/Painting/Brewing/Carpentry/Tailoring.)

## Future (Phase D — live crafting)
`tool_id` + `ability_id` are now captured (above). If live crafting needs more, candidates
are: multi-ability support (Kibbles' INT-**or**-WIS choices, currently a single pick) and a
consecutive-checks flag. Facility stays out — it is a per-case DM call in the module.

## Related docs
- [`recipes.md`](recipes.md) — `recipes.disciplineId` references this
- [`crafting_materials.md`](crafting_materials.md) — `usedFor` references this
