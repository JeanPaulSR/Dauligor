# Table: characters

The central table for player characters, storing base identity and state.

| Column | Type | Description |
| :--- | :--- | :--- |
| **id** | TEXT (PK) | Unique character ID. |
| **user_id** | TEXT | ID of the owner. |
| **campaign_id** | TEXT | ID of the assigned campaign. |
| **name** | TEXT | Character name. |
| **image_url** | TEXT | Portrait URL. |
| **race_id** | TEXT | ID of the character's race. |
| **background_id** | TEXT | ID of the character's background. |
| **level** | INTEGER | Total character level. |
| **exhaustion** | INTEGER | Current exhaustion level. |
| **has_inspiration** | BOOLEAN | Inspiration state. |
| **current_hp** | INTEGER | Current hit points. |
| **temp_hp** | INTEGER | Temporary hit points. |
| **max_hp_override** | INTEGER | Manual HP max override. |
| **stats_json** | TEXT (JSON) | Base ability scores (STR, DEX, etc.). |
| **info_json** | TEXT (JSON) | Bio/Flavor details (Alignment, Height, Weight, etc.). |
| **senses_json** | TEXT (JSON) | Passive senses and special vision. |
| **metadata_json** | TEXT (JSON) | UI/Builder settings (e.g., `isLevelLocked`). |
| **created_at** | DATETIME | ISO timestamp. |
| **updated_at** | DATETIME | ISO timestamp. |

---

# Table: character_progression

Tracks the level-by-level class progression (multiclassing).

| Column | Type | Description |
| :--- | :--- | :--- |
| **id** | TEXT (PK) | Unique progression ID. |
| **character_id** | TEXT (FK) | Reference to characters. |
| **class_id** | TEXT (FK) | Reference to classes. |
| **subclass_id** | TEXT (FK) | Reference to subclasses (nullable). |
| **level_index** | INTEGER | Which character level this represents (1-20). |
| **hp_roll** | INTEGER | HP gained at this specific level. |

---

# Table: character_selections

Stores specific choices made via the advancement system (Feats, Fighting Styles, etc.).

| Column | Type | Description |
| :--- | :--- | :--- |
| **id** | TEXT (PK) | Unique selection ID. |
| **character_id** | TEXT (FK) | Reference to characters. |
| **advancement_id** | TEXT | ID of the advancement rule. |
| **level** | INTEGER | Level at which the choice was made. |
| **selected_ids** | TEXT (JSON) | Array of selected entity IDs. |
| **source_scope** | TEXT | Context of the selection (e.g. `class:fighter`, `subclass:champion`). |

---

# Table: character_inventory

Items currently owned by the character.

| Column | Type | Description |
| :--- | :--- | :--- |
| **id** | TEXT (PK) | Unique inventory item ID. |
| **character_id** | TEXT (FK) | Reference to characters. |
| **item_id** | TEXT (FK) | Reference to compendium items. |
| **quantity** | INTEGER | Amount owned. |
| **is_equipped** | BOOLEAN | Equipment state. |
| **container_id** | TEXT | Reference to another inventory item (for nested containers). |
| **custom_data** | TEXT (JSON) | Overrides or unique properties. |

---

# Table: character_spells

Spells known, prepared, or granted by features.

| Column | Type | Description |
| :--- | :--- | :--- |
| **id** | TEXT (PK) | Unique spell instance ID. |
| **character_id** | TEXT (FK) | Reference to characters. |
| **spell_id** | TEXT (FK) | Reference to spells table. |
| **source_id** | TEXT | Reference to class/subclass/feature that granted it. |
| **is_prepared** | BOOLEAN | Preparation state. |
| **is_always_prepared**| BOOLEAN | If the spell is always prepared (e.g. Domain Spells). |

---

# Table: character_proficiencies

Explicit overrides or manually added proficiencies.

| Column | Type | Description |
| :--- | :--- | :--- |
| **id** | TEXT (PK) | Unique proficiency ID. |
| **character_id** | TEXT (FK) | Reference to characters. |
| **entity_id** | TEXT | ID of the proficiency (skill ID, attribute ID, etc.). |
| **entity_type** | TEXT | Type (skill, save, armor, weapon, tool, language). |
| **proficiency_level** | REAL | Level: 0.5 (Half), 1 (Full), 2 (Expertise). |
