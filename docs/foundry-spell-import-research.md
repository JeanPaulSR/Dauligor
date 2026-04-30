## Foundry Spell Import Research

### Goal

Determine whether Dauligor can populate its admin `spells` collection by importing spell data directly from Foundry `dnd5e`, instead of hand-authoring each spell.

### Short Answer

Yes, but the practical source should be a native Foundry spell item export or a Foundry-side dump of `Item.toObject()` spell documents.

No, the raw `dnd5e` compendium folders on disk are not a good direct source. The installed packs under:

- `C:/Users/Jean/AppData/Local/FoundryVTT/Data/systems/dnd5e/packs/spells`
- `C:/Users/Jean/AppData/Local/FoundryVTT/Data/systems/dnd5e/packs/spells24`

are LevelDB-style pack stores, not plain JSON files that Dauligor can ingest directly.

### Primary Local Sources Checked

- `C:/Users/Jean/AppData/Local/FoundryVTT/Data/systems/dnd5e/dnd5e.mjs`
- `C:/Users/Jean/AppData/Local/FoundryVTT/Data/systems/dnd5e/templates/items/details/details-spell.hbs`
- `C:/Users/Jean/AppData/Local/FoundryVTT/Data/systems/dnd5e/templates/items/details/details-spellcasting.hbs`
- `C:/Users/Jean/AppData/Local/FoundryVTT/Data/systems/dnd5e/templates/items/parts/spell-block.hbs`
- `E:/DnD/Professional/Dev/Dauligor/src/pages/compendium/SpellsEditor.tsx`

### What Foundry `dnd5e` Stores on a Spell

The `SpellData` model is defined in:

- `C:/Users/Jean/AppData/Local/FoundryVTT/Data/systems/dnd5e/dnd5e.mjs`

Current `SpellData` schema fields:

- `system.ability`
- `system.activation`
- `system.duration`
- `system.level`
- `system.materials.value`
- `system.materials.consumed`
- `system.materials.cost`
- `system.materials.supply`
- `system.method`
- `system.prepared`
- `system.properties`
- `system.range`
- `system.school`
- `system.sourceItem`
- `system.target`

Because `SpellData` mixes in `ActivitiesTemplate`, spells also carry:

- `system.activities`
- `system.uses`

And the item document itself can also contain:

- top-level `name`
- top-level `type` = `spell`
- top-level `img`
- top-level `effects`
- top-level `flags`

### Important Migration Notes in Foundry

Foundry currently migrates older spell data forward when loading:

1. Old preparation data:

- old: `system.preparation.mode`
- old: `system.preparation.prepared`
- new: `system.method`
- new: `system.prepared`

2. Old class linkage:

- old: `system.sourceClass`
- new: `system.sourceItem`

This means older exported spell JSON may still import into Foundry, but Dauligor should target the newer field names when building its own spell records.

### What the Current Dauligor Spell Editor Already Matches

From `E:/DnD/Professional/Dev/Dauligor/src/pages/compendium/SpellsEditor.tsx`, the current admin spell schema already aligns with several Foundry concepts:

- `name`
- `identifier`
- `imageUrl`
- `description`
- `activities`
- `level`
- `school`
- `preparationMode`
- `ritual`
- `concentration`
- `components.vocal`
- `components.somatic`
- `components.material`
- `components.materialText`
- `components.consumed`
- `components.cost`

### What Does Not Line Up 1:1 Yet

Dauligor currently stores a creator-friendly shell, not the exact Foundry spell document shape.

Differences that would need conversion:

1. Components

Foundry uses a `Set`-style `system.properties` collection for component and spell tags, rather than booleans like:

- `components.vocal`
- `components.somatic`
- `components.material`
- `ritual`
- `concentration`

Dauligor can still author these ergonomically, but an importer would need to translate Foundry properties into the app-friendly booleans, and export would need to translate them back.

2. Material metadata

Foundry uses:

- `system.materials.value`
- `system.materials.cost` as a number
- `system.materials.consumed`
- `system.materials.supply`

Dauligor currently uses:

- `components.materialText`
- `components.cost` as free text
- `components.consumed`

So Foundry import is possible, but `cost` and `supply` are not modeled the same way yet.

3. Preparation

Foundry uses:

- `system.method`
- `system.prepared`

Dauligor currently uses:

- `preparationMode`

That is mappable, but it is not currently stored in the same shape.

4. Casting shell

Foundry spells include:

- `system.activation`
- `system.range`
- `system.duration`
- `system.target`

Dauligor's spell editor does not currently expose these root spell shell fields directly.

5. Source linkage

Foundry uses:

- `system.sourceItem`
- `system.ability`

These are especially relevant for actor-owned spells and class/subclass-granted spells, and are not yet part of the admin spell authoring surface.

### Activities and Effects

This is the most promising area for reuse.

Foundry spells use:

- `system.activities`
- top-level `effects`

Dauligor already intentionally models:

- `activities`
- `effectsStr`

That means a Foundry spell export is a much better seed source for Dauligor than the raw compendium database format, because the runtime model is already conceptually aligned.

### Practical Recommendation

The best path is:

1. Do not try to ingest raw `dnd5e/packs/spells*` folders directly.
2. Use one of these as the import source:
   - a native Foundry item JSON export of spells
   - a Foundry macro/module-side dump of compendium spells using `toObject()`
3. Build a Dauligor spell importer that maps:
   - Foundry root item fields
   - Foundry `system.*` spell shell fields
   - Foundry `system.activities`
   - Foundry `effects`
   into the current admin spell schema

### Recommended First Import Scope

Safe first-pass import:

- `name`
- `type`
- `img`
- `description`
- `level`
- `school`
- `method` -> `preparationMode`
- component flags from `properties`
- concentration from `properties`
- ritual from `properties`
- material text/value
- material consumed
- material cost
- `activities`
- `effects`

Second-pass import fields once the spell editor grows:

- `activation`
- `range`
- `duration`
- `target`
- `prepared`
- `sourceItem`
- `ability`
- `materials.supply`

### Bottom Line

Importing Foundry spell data should save time, but the importer should target exported Foundry spell item JSON, not the raw installed compendium database files.
