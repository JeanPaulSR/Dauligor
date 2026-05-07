# Feature: Sources & Foundry Export

The Sources system handles the documentation of all homebrew and official materials used in the archive. It also serves as the primary integration point for the **Foundry VTT (dauligor-pairing)** module.

## 1. Source Entity
Located in the `sources` Firestore collection.
- `name`: Full title of the source.
- `abbreviation`: Short version (e.g., PHB).
- `slug`: System-level ID used for file exports and URL paths.
- `rules`: Rules version (2014, 2024, or Universal).
- `status`: Readiness state (ready, draft, retired).
- `imageUrl`: Cover art.
- `tags`: Categories of content provided.

## 2. Foundry Export System
Accessible via the **Sources** list or **Source Detail** pages for Staff members.
The export system adheres to the `dauligor.source-catalog.v1` and `dauligor.semantic.class-export` contracts.

### Export Structure
The system generates a ZIP file with the following directory structure, ready to be extracted into the Foundry module's `data/sources/` directory.

```text
data/
  sources/
    catalog.json                # Master library index
    <source-slug>/
      source.json               # Source metadata
      classes/
        catalog.json            # Class index for this source
        <class-id>.json         # Full semantic class export
```

### Semantic Export contents
The class JSON in the export is a "Semantic Bundle" containing:
- Base class data
- Linked subclasses
- Associated class and subclass features
- Scaling tables
- Spellcasting tables
- Unique option groups and their options

## 3. Usage for Testing
1. Ensure the source has a valid `slug`.
2. Ensure linked content (Classes) is correctly assigned to the `SourceId`.
3. Click **Export for Foundry** or **Export Full Library**.
4. Extract the ZIP into `FoundryVTT/Data/modules/dauligor-pairing`.
5. In Foundry, the Importer will now see these local files as if they were live API endpoints.
