# Firestore Schema

The application uses **Firebase Firestore** as the data persistence layer.

## 1. Core Collections

### `users`
- `uid` (string): Document ID.
- `displayName` (string): UI profile name.
- `username` (string): Slugified handle (e.g. `jean`).
- `hideUsername` (boolean): Toggle handle visibility.
- `isPrivate` (boolean): Restrict profile visibility.
- `recoveryEmail` (string): Target for password reset emails.
- `role` (string): `admin`, `co-dm`, `lore-writer`, `user`.
- `campaignIds` (array[string]): Campaign memberships.
- `activeCampaignId` (string): Current context ID.
- `theme` (string): `parchment`, `light`, `dark`.
- `accentColor` (string): Hex code (e.g. `#ff0000`).
- `avatarUrl` (string): Storage/CDN URL.
- `createdAt` (ISO 8601 string).

### `campaigns`
- `name` (string).
- `eraId` (string): Foreign key for `eras`.
- `description` (string).

### `eras`
- `name` (string).
- `order` (number): Sorting sequence.
- `description` (string).

### `lore`
- `title` (string).
- `content` (string): BBCode-formatted text.
- `category` (string): Article type enum.
- `status` (string): `draft`, `published`.
- `tags` (array[string]).
- `imageUrl` (string).
- `metadata` (map): Variable key-value pairs per category.
- `authorId` (string): Foreign key for `users`.
- `updatedAt` (ISO 8601 string).

#### Subcollection: `lore/{id}/secrets`
- `content` (string).
- `eraIds` (array[string]).
- `revealedCampaignIds` (array[string]).
- `updatedAt` (ISO 8601 string).

#### Subcollection: `lore/{id}/dmData`
- Document `notes`: Contains `content` (string).

### `characters`
- See **[schemas/characters.md](../../schemas/characters.md)** for detailed field specifications.
- **`name`** (string).
- **`userId`** (string): Owner UID.
- **`level`** (number).
- **`stats`** (object): Base ability scores.
- **`vitals`** (object): HP, AC, Speed, Initiative.
- **`proficiencies`** (array[string]): Skills, Saves, Languages.
- **`metadata`** (object): Race/Class data, senses, and appearance specifics.

## 2. Compendium Collections

### `sources`
- `sourceId` (string): Document ID (e.g. `phb`).
- `name` (string).
- `abbreviation` (string).
- `webpage` (string): Canonical URL.
- `imageUrl` (string): Cover image URL.

### `classes` / `subclasses`
- `identifier` (string): Slug (e.g. `cleric`).
- `sourceId` (string): Foreign key for `sources`.
- `hitDie` (number).
- `proficiencies` (map): `armor`, `weapons`, `tools`, `skills`.
- `advancements` (array[object]): List of progression steps (Grants, Choices, Subclass triggers).
- `advancementConfig` (object): Metadata for external system mapping.

### `features`
- `parentDocumentId` (string): Foreign key for `classes` or `subclasses`.
- `parentType` (string): `class`, `subclass`.
- `actionType` (string): Mechanic type.
- `description` (string): BBCode text.

## 3. Reference Data

### `spellcastingScalings` / `pactMagicScalings` / `spellsKnownScalings`
Stored level-by-level (1-20) data for spell resources.

### `uniqueOptionGroups` / `uniqueOptionItems`
Relational data for modular choices (Invocations, Feats).

### `tagGroups` / `tags`
Categorized taxonomy for filtering `classes` and `spells`.

### `languages` / `damageTypes` / `conditions` / `attributes`
Core system properties used for traits and character metadata.
- `name` (string).
- `identifier` (string): Slug.
- `description` (string): Optional detail.

---
*For a quick UI reference, see the **[DIRECTORY_MAP.md](../DIRECTORY_MAP.md)**.*
