# Character Entity Schema

Clinical specification for the `characters/{charId}` document.

## 1. Core Identity
- **`name`**: `string` - Character's full name.
- **`userId`**: `string` - Owner UID.
- **`imageUrl`**: `string` - URL to character portrait.
- **`campaignId`**: `string` - Associated Campaign UID (optional).
- **`level`**: `number` - Current total level. Defaults to 1.
- **`isLevelLocked`**: `boolean` - Prevents level adjustments when true.

## 2. Vitals & Combat
- **`hp`**: `object`
    - `current`: `number`
    - `max`: `number`
    - `temp`: `number`
- **`hitDie`**: `object`
    - `current`: `number`
    - `max`: `number`
    - `type`: `string` (e.g., "d10")
- **`ac`**: `number` - Armor Class.
- **`initiative`**: `number` - Modifier or fixed score.
- **`speed`**: `number` - Walking speed in feet.
- **`hasInspiration`**: `boolean` - Whether the character has Heroic Inspiration.
- **`exhaustion`**: `number` - Current level of exhaustion (0-6).
- **`spellPoints`**: `object`
    - `current`: `number`
    - `max`: `number`

## 3. Ability Scores (`stats`)
- **`method`**: `string` ("point-buy", "standard-array", "manual")
- **`base`**: `object` - Keys: `STR`, `DEX`, `CON`, `INT`, `WIS`, `CHA`. Values: `number`.

## 4. Proficiencies & Traits
- **`proficiencyBonus`**: `number`.
- **`savingThrows`**: `string[]` - List of ability keys (e.g., `["STR", "CON"]`).
- **`halfProficientSavingThrows`**: `string[]`.
- **`proficientSkills`**: `string[]` - Skill IDs.
- **`expertiseSkills`**: `string[]` - Skill IDs.
- **`halfProficientSkills`**: `string[]` - Skill IDs.
- **`overriddenSkillAbilities`**: `Record<string, string>` - Map of skill ID to Ability ID (e.g., `{"intimidation": "STR"}`).
- **`armorProficiencies`**: `string[]`.
- **`weaponProficiencies`**: `string[]`.
- **`toolProficiencies`**: `string[]`.
- **`languages`**: `string[]`.
- **`resistances`**: `string[]`.
- **`immunities`**: `string[]`.
- **`vulnerabilities`**: `string[]`.

## 5. Metadata
- **`raceId`**: `string` - Reference to Race document.
- **`classId`**: `string` - Reference to Class document.
- **`subclassId`**: `string` - Reference to Subclass document.
- **`backgroundId`**: `string` - Reference to Background details.
- **`raceData`**: `object`
    - `creatureType`: `string`
    - `size`: `string`
- **`senses`**: `object`
    - `passivePerception`: `number`
    - `passiveInvestigation`: `number`
    - `passiveInsight`: `number`
    - `additional`: `string`
- **`info`**: `object` - Physical and personal details (alignment, age, weight, ideals, bonds, etc.).
- **`bookmarks`**: `string[]` - Reference IDs for pinned content.
- **`createdAt`**: `ISO8601 string`.
- **`updatedAt`**: `ISO8601 string`.
