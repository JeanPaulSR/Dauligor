# Dauligor Module Schema (Internal)

This document defines the structured schema used internally by the Dauligor application for character classes and subclasses. This schema is designed specifically for high-fidelity interoperability with Foundry VTT via the `dauligor-pairing` module.

## Core Design Principles

1.  **Stable Identifiers**: Every entity (Class, Subclass, Feature) uses a slug-based `identifier` for linking within Foundry.
2.  **Resource Linkage**: Images and icons use absolute URLs (resolvable by anyone with the link) to avoid storage resolution complexity in the VTT.
3.  **Advancement Synthesis**: The schema defines the *rules* and *metadata* needed to synthesize Foundry `advancement` objects, rather than storing raw Foundry JSON.
4.  **Source Tracking**: All entities carry a `sourceId` for attribution and system filtering.

---

## 1. Class Schema (`classes` collection)

| Field | Type | Description | Foundry Mapping |
| :--- | :--- | :--- | :--- |
| `name` | string | Display name of the class. | `name` |
| `identifier` | string | URL-friendly slug (e.g., `fighter`). | `system.identifier` |
| `description` | string | BBCode rich text overview. | `system.description.value` |
| `imageUrl` | string | URL of class artwork or icon. | `img` |
| `hitDie` | number | Numeric value of hit die (e.g., 8, 10). | `system.hd` |
| `primaryAbility` | string[] | Array of abilities (e.g., `["STR", "DEX"]`). | `system.primaryAbility` |
| `wealth` | string | Starting gold formula (e.g., `5d4 * 10`). | `system.wealth` |
| `savingThrows` | string[] | Array of proficient saves. | `system.properties` |
| `proficiencies` | map | Armor, weapon, tool, and skill proficiencies. | `system.advancement` (Traits) |
| `spellcasting` | object | Spellcasting rules (casting ability, level, etc.). | `system.spellcasting` |
| `subclassGainLevel`| number | Level at which a subclass is selected. | `system.advancement` (Scale Value) |
| `tagIds` | string[] | References to global filtering tags. | `flags.dauligor.tags` |

---

## 2. Subclass Schema (`subclasses` collection)

| Field | Type | Description | Foundry Mapping |
| :--- | :--- | :--- | :--- |
| `name` | string | Display name of the subclass. | `name` |
| `identifier` | string | URL-friendly slug (e.g., `champion`). | `system.identifier` |
| `classIdentifier`| string | Slug of the parent class (e.g., `fighter`). | `system.classIdentifier` |
| `parentClassId` | string | Firestore ID of the parent class. | N/A |
| `description` | string | BBCode rich text overview. | `system.description.value` |
| `imageUrl` | string | URL of subclass artwork. | `img` |
| `spellcasting` | object | Subclass-specific spellcasting rules. | `system.spellcasting` |
| `updatedAt` | timestamp | Last modified date. | N/A |

---

## 3. Feature Schema (`features` collection)

| Field | Type | Description | Foundry Mapping |
| :--- | :--- | :--- | :--- |
| `name` | string | Feature name. | `name` |
| `description` | string | BBCode content. | `system.description.value` |
| `level` | number | Level gained. | Advancement Level |
| `parentDocumentId`| string | Reference to Class or Subclass ID. | N/A |
| `parentType` | string | `'class' \| 'subclass'`. | N/A |
| `mechanics` | object | Operational metadata (uses, action type). | `system.activities` |
| `quantityColumnId`| string | Reference to a Scaling Column. | `system.uses` |
| `scalingColumnId` | string | Reference to a Scaling Column. | `system.damage` / `system.save` |

---

## 4. Export Modes & Integration

The Dauligor application provides three distinct modes for exporting data to Foundry VTT:

### A. Class Skeleton (Single Item)
Exports a raw Foundry **Class** Item JSON (flat object). It includes the complete `advancement` table (Hit Points, Saving Throws, Skills, Scaling Columns) but **no features or subclasses**.
- **Use Case**: Best for using Foundry's "Import Data" feature directly on a Class item template.

### B. Full Bundle (Compendium Style)
Exports a JSON bundle (`kind: "dauligor.compendium.v1"`) containing the **Class**, all **Subclasses**, and every **Feature**.
- **Use Case**: Best for a batch import via the `dauligor-pairing` module or a custom structural import.

### C. Case-by-Case Export (Single Item)
Individual **Features** and **Subclasses** can be exported as standalone Foundry JSON items (flat objects).
- **Use Case**: Precise, modular updates to specific project pieces.

### D. Metadata & System Interoperability
While the export logic **models** the high-fidelity structure seen in advanced modular tools (like Plutonium), the primary goal is **standard Foundry VTT (dnd5e) compatibility**. 

The metadata flags included (under `flags.dauligor-pairing`) are designed to be consumed by an external pairing application/module. This module will use the stable `sourceId` and `identifier` fields to perform complex operations like automated level-ups, feature linking, and cross-referencing against the Dauligor Archive.

| Namespace | Field | Description |
| :--- | :--- | :--- |
| `dauligor-pairing` | `sourceId` | The unique Firestore ID of the original record. |
| `plutonium` (Model) | `hash` | A legacy-compatible locator string for interoperability. |
| `plutonium` (Model) | `propDroppable` | Identifies the entity type during drag-and-drop operations. |

---

## 5. Foundry VTT Mapping Logic (Internal)

### Data Consistency Philosophy
Our export logic follows a "Foundry-First" approach:

1.  **Spellcasting Object**: Even for non-spellcasting classes, the `system.spellcasting` object should be present with `progression: "none"` and a default `preparation` mode of `always`.
2.  **Flat vs Bundle**: Individual templates in Foundry (Class/Subclass/Feat) require a **flat object** (no `items` array wrapper) for direct "Import Data" functionality.
3.  **Source Identification**: The `system.source.book` field should ideally match the same identifier used in the `plutonium.source` flag for consistent filtering within the VTT.
