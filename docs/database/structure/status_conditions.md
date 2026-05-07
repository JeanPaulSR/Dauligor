# Table Structure: `status_conditions`

Mechanical states and status icons applied to actors.

## Layout Specs

| SQL Column | Type | Firestore Equivalent | Note |
| :--- | :--- | :--- | :--- |
| `id` | TEXT (PK) | Document ID | |
| `identifier` | TEXT (INDEX) | `identifier` | Foundry key (e.g., `blinded`). |
| `name` | TEXT | `name` | |
| `image_url` | TEXT | `img` | R2 URL for the icon. |
| `reference` | TEXT | `reference` | Foundry compendium path. |
| `description` | TEXT | `description` | |
| `order` | INTEGER | `order` | |
| `implied_ids` | JSON | `impliedStatuses` | Array of condition identifiers. |
| `changes` | JSON | `changes` | Array of ActiveEffect changes. |
| `source` | TEXT | `source` | dnd5e, custom, imported. |
| `created_at` | DATETIME | `createdAt` | |
| `updated_at` | DATETIME | `updatedAt` | |

## Implementation Notes
- **Active Effects**: The `changes` column stores a list of mechanical adjustments (e.g., `{"key": "system.attributes.movement.walk", "mode": 5, "value": "0"}`).
- **Condition Hierarchy**: `implied_ids` allows the system to automatically apply parent conditions (e.g., being Paralyzed implies being Incapacitated).
