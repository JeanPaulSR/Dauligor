# Draft — `ProficiencyEntityShell` design

Status: **locked design**. Decisions captured 2026-05-21. Implementation starts with the shell + SkillsEditor migration.

**Locked decisions:**
- Shell name: `ProficiencyEntityShell`
- Home: `src/components/compendium/ProficiencyEntityShell.tsx`
- Role gate stays admin-only (the revamp is purely UX-side)
- Sequencing: shell migration ships first (Skills POC → user-verified locally → Tools / Armor / Weapons), then the AdminProficiencies revamp
- Type safety: `T extends Record<string, any>` for now; revisit when Kysely lands

---

## What it consolidates

Four current editors — [SkillsEditor](../../src/pages/compendium/SkillsEditor.tsx) (319), [ToolsEditor](../../src/pages/compendium/ToolsEditor.tsx) (355), [ArmorEditor](../../src/pages/admin/ArmorEditor.tsx) (342), [WeaponsEditor](../../src/pages/admin/WeaponsEditor.tsx) (406) — share ~80% of their code. They all run the same shape:

```
load entries + FK lookups in parallel
hold form state (name, identifier, foundry_alias, ability, source, page, basic_rules, description, [+ entity-specific])
form on left (sticky, scroll-internal) + grid of cards on right
Save → upsertDocument, optimistic state update, toast
Edit → click pencil, populate form
Delete → window.confirm, deleteDocument
```

Total today: **1,422 lines across 4 files**.

---

## Layer split

The shell does **only** the parts that are common:

| Owned by shell | Owned by per-editor config |
|---|---|
| Load `<table>` rows + `attributes` table + (optional) `<categoryTable>` | The fields list for the entity type |
| The form-left + list-right grid scaffolding | Custom field rendering (e.g., weapon properties multi-select) |
| `name`, `identifier`, `foundry_alias`, `source`, `page`, `basic_rules` fields | Custom list-card badges (e.g., weapon type) |
| `ability_id` select (sourced from the `attributes` table — **not** hardcoded) | Anything else genuinely specific to that entity type |
| Save / edit / delete handlers + toast |  |
| Admin gate |  |

The shell does **not** include:
- Image upload (proficiencies don't have images)
- ActivityEditor / effects JSON (not domain-relevant)
- Source FK to `sources` table (proficiencies use a plain text source code, not the `sources` table)

---

## Props

```ts
interface ProficiencyEntityShellProps<T = Record<string, any>> {
  /** D1 table + verbiage */
  table: string;                  // 'skills' | 'tools' | 'armor' | 'weapons'
  singular: string;               // 'Skill'
  plural: string;                 // 'Skills'
  icon: LucideIcon;
  description: string;            // shown in header
  hideHeader?: boolean;           // for embedding under AdminProficiencies

  /** Optional category FK (Tools / Armor / Weapons have one; Skills doesn't) */
  categoryFK?: {
    column: string;               // 'category_id'
    referenceTable: string;       // 'toolCategories' | 'armorCategories' | 'weaponCategories'
    label: string;                // 'Category'
    required?: boolean;           // default false
  };

  /** Whether to show the ability_id select (default: true) */
  includeAbility?: boolean;

  /** Extra collections the editor needs (e.g., weapons need weaponProperties) */
  extraLookups?: Array<{
    key: string;                  // 'properties'
    collection: string;           // 'weaponProperties'
    orderBy?: string;             // default 'name ASC'
  }>;

  /** Entity-specific form fields (rendered after the standard fields) */
  renderExtraFields?: (args: {
    formData: T;
    setFormData: Dispatch<SetStateAction<T>>;
    lookups: Record<string, any[]>;
  }) => ReactNode;

  /** Entity-specific list-card badges (rendered after the standard badges) */
  renderExtraBadges?: (args: {
    entry: any;
    lookups: Record<string, any[]>;
  }) => ReactNode;

  /** Optional hook into the save payload (e.g., weapon's property_ids) */
  buildExtraPayload?: (formData: T) => Record<string, any>;

  /** Optional hook into the form-reset defaults */
  extraDefaults?: Partial<T>;

  /** Optional hook into the edit-load step (e.g., weapons need to populate property_ids) */
  hydrateExtras?: (entry: any) => Partial<T>;
}
```

The four bracketed callbacks (`renderExtraFields`, `renderExtraBadges`, `buildExtraPayload`, `hydrateExtras`) are the only escape hatches — most editors won't need all four.

---

## Each editor's config under this shell

### Skills — 0 extras
```tsx
<ProficiencyEntityShell
  table="skills"
  singular="Skill"
  plural="Skills"
  icon={Brain}
  description="Define the core skills available in your game system."
  hideHeader={hideHeader}
/>
```
~10 lines. Down from 319.

### Tools — categoryFK
```tsx
<ProficiencyEntityShell
  table="tools"
  singular="Tool"
  plural="Tools"
  icon={Hammer}
  description="Define the tools and instruments available in your game system."
  hideHeader={hideHeader}
  categoryFK={{ column: 'category_id', referenceTable: 'toolCategories', label: 'Category' }}
/>
```
~12 lines. Down from 355.

### Armor — categoryFK (required)
```tsx
<ProficiencyEntityShell
  table="armor"
  singular="Armor"
  plural="Armor"
  icon={ShieldCheck}
  description="Define the armor available in your game system."
  hideHeader={hideHeader}
  categoryFK={{ column: 'category_id', referenceTable: 'armorCategories', label: 'Category', required: true }}
/>
```
~12 lines. Down from 342.

### Weapons — categoryFK + properties multi-select + weapon_type
```tsx
<ProficiencyEntityShell
  table="weapons"
  singular="Weapon"
  plural="Weapons"
  icon={Crosshair}
  description="Define the weapons available in your game system."
  hideHeader={hideHeader}
  categoryFK={{ column: 'category_id', referenceTable: 'weaponCategories', label: 'Category', required: true }}
  extraLookups={[{ key: 'properties', collection: 'weaponProperties' }]}
  extraDefaults={{ weapon_type: 'Melee', property_ids: [] }}
  hydrateExtras={(entry) => ({
    weapon_type: entry.weapon_type || 'Melee',
    property_ids: entry.property_ids || [],
  })}
  buildExtraPayload={(form) => ({
    weapon_type: form.weapon_type,
    property_ids: form.property_ids,
  })}
  renderExtraFields={({ formData, setFormData, lookups }) => (
    <>
      <WeaponTypeSelect value={formData.weapon_type} onChange={(v) => setFormData(s => ({ ...s, weapon_type: v }))} />
      <WeaponPropertiesPicker
        value={formData.property_ids}
        options={lookups.properties}
        onChange={(ids) => setFormData(s => ({ ...s, property_ids: ids }))}
      />
    </>
  )}
  renderExtraBadges={({ entry, lookups }) => (
    <>
      {entry.weapon_type && <Badge>{entry.weapon_type}</Badge>}
      {(entry.property_ids || []).map((pid) => {
        const p = lookups.properties.find((x) => x.id === pid);
        return p && <PropertyChip key={pid} title={p.description}>{p.name}</PropertyChip>;
      })}
    </>
  )}
/>
```
~30 lines. Down from 406.

`<WeaponTypeSelect>` and `<WeaponPropertiesPicker>` are small extracted helpers (the weapon-specific bits today are inline in WeaponsEditor).

---

## Total post-migration line count

| Editor | Before | After (config + extras) | Δ |
|---|---|---|---|
| SkillsEditor | 319 | ~10 | -309 |
| ToolsEditor | 355 | ~12 | -343 |
| ArmorEditor | 342 | ~12 | -330 |
| WeaponsEditor | 406 | ~30 (+ 2 helpers ~60) | -316 |
| `ProficiencyEntityShell` (new) | 0 | ~280 (estimate) | +280 |
| `WeaponTypeSelect` (new helper) | 0 | ~20 | +20 |
| `WeaponPropertiesPicker` (new helper) | 0 | ~40 | +40 |
| **Total** | **1,422** | **~404** | **−1,018** |

Real saving: **~1,000 lines** + four near-duplicate codepaths collapse to one.

---

## What the migration physically does to each editor

1. SkillsEditor.tsx becomes a tiny config file (described above).
2. The shell file (new) holds the load/save/delete loop + the standard form scaffolding + the standard list-card layout.
3. AdminProficiencies.tsx is **untouched** by this migration — the tab strip still mounts `<SkillsEditor hideHeader />`, the import path is unchanged, the rendered output is pixel-identical aside from the ability-score select sourcing from `attributes` table data instead of the hardcoded `["STR",…,"CHA"]` array.

---

## Inter-related issues fixed in passing

1. **Hardcoded ABILITIES → DB-driven**. Each editor's hardcoded `["STR","DEX","CON","INT","WIS","CHA"]` array is removed. The shell renders `<option>`s from the `attributes` collection it already loads. Net behavior change: if a DM adds a 7th attribute via `/admin/proficiencies → Attributes`, it shows up in the ability-score select on Skills/Tools/Armor/Weapons editors automatically.
2. **Duplicate prerequisites block in compendium.ts** ([src/lib/compendium.ts:88-104](../../src/lib/compendium.ts:88)) — surgically remove the second copy. Not related to the shell but trivial to bundle in the same PR.

---

## What this migration does NOT touch

- The D1 schema. Zero migrations.
- The `attributes`, `toolCategories`, `armorCategories`, `weaponCategories`, `weaponProperties` tables. Read-only.
- The `skills`, `tools`, `armor`, `weapons` tables. Same column names, same save payload shape.
- The Foundry export pipeline. Proficiencies aren't in the class export bundle.
- The proposal system. None of these tables are on the proposal allowlist.
- The compendium-editor-patterns.md doc itself (separate stale-doc cleanup).

---

## Proof-of-concept order

1. Build `ProficiencyEntityShell` from this spec.
2. Migrate **Skills first** (simplest, no category FK, no multi-select).
3. Run locally per [docs/operations/local-dev.md](../operations/local-dev.md). Spot-check that:
   - `/admin/proficiencies → Skills` looks identical
   - Saving a skill works, edits round-trip, delete works
   - Adding/renaming an attribute in the Attributes tab updates the ability-score select on Skills
4. Migrate Tools, Armor, Weapons in sequence (Tools first — it's basically Skills + categoryFK).
5. Remove the duplicate prerequisites block in compendium.ts as a tiny commit alongside.

If step 3 surfaces an unforeseen shape mismatch, we stop and iterate on the shell before continuing.

---

## Resolved questions

1. **Shell name** → `ProficiencyEntityShell`
2. **Helper extraction** → extract `WeaponTypeSelect` + `WeaponPropertiesPicker` as standalone components when Weapons migrates
3. **Location** → `src/components/compendium/`
4. **Type safety** → loose `T extends Record<string, any>` for v1; tighten when Kysely lands
