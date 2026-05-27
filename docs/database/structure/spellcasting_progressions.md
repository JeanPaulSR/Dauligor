# Table Structure: Spellcasting Progressions

This system defines how characters gain spell slots, known spells, and scaling types.

## 1. Table: `spellcasting_types`
Defines the mathematical scaling for multiclassing and slot determination.

| SQL Column | Type | Note |
| :--- | :--- | :--- |
| `id` | TEXT (PK) | |
| `name` | TEXT | e.g., "Full-Caster", "Half-Caster". |
| `identifier` | TEXT UNIQUE NOT NULL | slug (e.g., `full`). |
| `foundry_name` | TEXT | Module compatibility key (e.g., `full`). |
| `formula` | TEXT | MathJS formula (e.g., `floor(0.5 * level)`). |
| `updated_at` | DATETIME | |

## 2. Table: `spellcasting_progressions`
Unified table for slots, known spells, and pact magic arrays.

| SQL Column | Type | Note |
| :--- | :--- | :--- |
| `id` | TEXT (PK) | |
| `name` | TEXT | e.g., "Standard Wizard Slots". |
| `type` | TEXT NOT NULL | `standard`, `pact`, or `known`. Enforced via CHECK constraint. |
| `levels` | JSON | Array of 20 level objects: `{level, slots: [], known: [], cantrips: []}`. |
| `updated_at` | DATETIME | |

## 3. Table: `multiclass_master_chart`
The definitive reference for combined casting levels.

| SQL Column | Type | Note |
| :--- | :--- | :--- |
| `id` | TEXT (PK) | Usually `master`. |
| `levels` | JSON | Array of 20 level objects: `{level, slots: [9]}`. |
| `updated_at` | DATETIME | |

---

## Design notes

### 1. Unified scaling table
A single `spellcasting_progressions` table with a `type` discriminator covers standard slots, pact magic, and known-spell progressions. The Class Editor only needs to query one table for all progression needs.

### 2. Formula determinism
The `formula` field is strictly validated against an allowed list of MathJS functions (`floor`, `ceil`) to prevent injection during runtime evaluation.
