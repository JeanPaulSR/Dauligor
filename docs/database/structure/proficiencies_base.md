# Table Structure: Proficiencies (Base & Categories)

This document defines the foundation tables for the game system. These tables must be populated before migrating Classes, Spells, or Items.

## Architectural Decision: Explicit Normalization
We use separate tables for each property type instead of a catch-all "registry" table. This allows for strict Foreign Key enforcement and clear referential integrity.

---

## 1. Equipment & Tool Categories
These tables define the broad proficiency groups.

### Table: `armor_categories` / `weapon_categories` / `tool_categories`
| SQL Column | Type | Note |
| :--- | :--- | :--- |
| `id` | TEXT (PK) | |
| `name` | TEXT NOT NULL | e.g., "Heavy Armor", "Martial Weapons". |
| `identifier` | TEXT UNIQUE NOT NULL | slug (e.g., `heavy`, `martial`). |
| `order` | INTEGER | UI sort order. |
| `description` | TEXT | |
| `updated_at` | DATETIME | |

### Table: `weapon_properties`
Defines traits like "Finesse", "Versatile", or "Reach".
| SQL Column | Type | Note |
| :--- | :--- | :--- |
| `id` | TEXT (PK) | |
| `name` | TEXT NOT NULL | e.g., "Finesse". |
| `identifier` | TEXT UNIQUE NOT NULL | slug (e.g., `fin`). |
| `order` | INTEGER | UI sort order. |
| `description` | TEXT | |
| `updated_at` | DATETIME | |

---

## 2. Languages
Languages are organized into categories (Standard, Exotic).

### Table: `language_categories`
| SQL Column | Type | Note |
| :--- | :--- | :--- |
| `id` | TEXT (PK) | |
| `name` | TEXT NOT NULL | e.g., "Standard Languages". |
| `identifier` | TEXT UNIQUE NOT NULL | slug (e.g., `standard`). |
| `order` | INTEGER | UI sort order. |
| `description` | TEXT | |
| `updated_at` | DATETIME | |

### Table: `languages`
| SQL Column | Type | Note |
| :--- | :--- | :--- |
| `id` | TEXT (PK) | |
| `category_id` | TEXT (FK) | Links to `language_categories.id`. |
| `name` | TEXT NOT NULL | e.g., "Common". |
| `identifier` | TEXT UNIQUE NOT NULL | slug (e.g., `common`). |
| `description` | TEXT | |
| `updated_at` | DATETIME | |

---

## 3. Mechanical Tokens
Fundamental game engine constants.

### Table: `attributes`
| SQL Column | Type | Note |
| :--- | :--- | :--- |
| `id` | TEXT (PK) | |
| `name` | TEXT NOT NULL | e.g., "Strength". |
| `identifier` | TEXT UNIQUE NOT NULL | **UPPERCASE** 3-letter key (e.g., `STR`). |
| `order` | INTEGER | |
| `updated_at` | DATETIME | |

### Table: `damage_types`
| SQL Column | Type | Note |
| :--- | :--- | :--- |
| `id` | TEXT (PK) | |
| `name` | TEXT NOT NULL | e.g., "Fire". |
| `identifier` | TEXT UNIQUE NOT NULL | slug (e.g., `fire`). |
| `order` | INTEGER | UI sort order. |
| `description` | TEXT | |
| `updated_at` | DATETIME | |

---

## 4. Condition Immunity Categories
**Note**: These are separate from `status_conditions`. These define the *categories* used for damage/condition immunities in monster statblocks.

### Table: `condition_categories`
| SQL Column | Type | Note |
| :--- | :--- | :--- |
| `id` | TEXT (PK) | |
| `name` | TEXT NOT NULL | e.g., "Blinded", "Charmed". |
| `identifier` | TEXT UNIQUE NOT NULL | slug (e.g., `blinded`). |
| `order` | INTEGER | UI sort order. |
| `description` | TEXT | |
| `updated_at` | DATETIME | |

---

## Migration Refinements (The "Fresh Start")

### 1. String-to-ID Category Normalization
- **Old Practice**: `languages` and `tools` stored their category as a plain string (e.g., `category: "Standard"`).
- **Refinement**: These are now normalized into Foreign Keys (`category_id`). The migration script performs a lookup on the `language_categories` and `tool_categories` tables to map these strings to stable UUIDs.

### 2. Attribute Identifier Standardization
- **Old Practice**: Some attribute identifiers were inconsistent (e.g., `str`, `Strength`, `STR`).
- **Refinement**: All attribute identifiers are forced to **UPPERCASE 3-letter keys** (e.g., `STR`, `INT`) during migration to ensure math formulas and lookups are deterministic.

### 3. Image URL Resolution
- **Old Practice**: Many icons used relative paths or legacy Firebase Storage URLs.
- **Refinement**: All `image_url` fields are being verified and potentially rewritten to point to the **Cloudflare R2** public bucket during migration.
