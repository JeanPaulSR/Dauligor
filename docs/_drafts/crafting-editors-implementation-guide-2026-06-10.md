# Crafting Editors — Implementation Guide (anti-compaction reference)

Durable code + styling reference for building the remaining crafting surfaces
(EnchantmentsEditor, CraftingMaterials editor, shop) on the `compendium-editors` branch.
Captures everything learned building **RecipesEditor** + the **crafting-disciplines tab** so a
fresh session can build the next editor by copying the pattern, not re-discovering it.

**Companion docs**
- Design (technical): `docs/_drafts/crafting-commerce-design-2026-06-09.html`
- Kibbles reconciliation (what to model / defer / cut): `docs/_drafts/kibbles-reconciliation-2026-06-09.html`
- Friendly overview: `docs/_drafts/crafting-commerce-explained-2026-06-09.html`
- Schemas: `docs/database/structure/{recipes,enchantments,crafting_materials,crafting_disciplines}.md`
- Style guide (READ before UI): `docs/ui/style-guide.md`

---

## 0. Status & non-negotiables

- **Built & committed** (`b4cbbb4` on `compendium-editors`): 4 migrations (enchantments-1300,
  disciplines-1350, recipes-1400, materials-1500), d1 wiring, **`RecipesEditor.tsx`** (+ route +
  sidebar link), crafting-disciplines admin tab.
- **origin/main = `79fb59c`** — contains ONLY the requirements fixes, NOT the crafting work.
- **Next:** apply the 4 migrations to LOCAL D1 → live-test RecipesEditor → build EnchantmentsEditor →
  CraftingMaterials editor → magic-items tab → shop.
- **Rules:** `tsc` baseline = **3** (`npx tsc --noEmit`); keep there. `main` = prod (auto-deploys) —
  never push without explicit permission, show the diff first. Migrations are **local-first**; NEVER
  `wrangler d1 migrations apply --remote` (apply one file via `d1 execute --remote --file <m>
  --config worker/wrangler.toml -y`, only with permission). NEVER `npm install` in the worktree
  (node_modules is junctioned). Style-guide tokens only (gold/ink/blood); documented classes; square
  corners; lucide icons only.

---

## 1. File map

| Concern | Path |
|---|---|
| **Reference editor (COPY THIS)** | `src/pages/compendium/RecipesEditor.tsx` |
| Shared entity-editor shell | `src/components/compendium/CompendiumEditorShell.tsx` |
| Taxonomy editor shell | `src/components/compendium/ProficiencyEntityShell.tsx` (disciplines tab in `src/pages/admin/AdminProficiencies.tsx`) |
| Migrations | `worker/migrations/20260609-1300..1500_*.sql` |
| JSON auto-parse (client) | `src/lib/d1.ts` → `jsonFields` array (~line 290) |
| JSON auto-parse (server mirror) | `api/_lib/d1-fetchers-server.ts` → `JSON_COLUMNS` set |
| Collection→table map | `src/lib/d1Tables.ts` → `D1_TABLE_MAP` |
| Schemas | `docs/database/structure/{recipes,enchantments,crafting_materials,crafting_disciplines}.md` |
| Pickers/widgets | `src/components/ui/SingleSelectSearch.tsx`, `src/components/ui/ImageUpload.tsx`, `src/components/MarkdownEditor.tsx`, `src/components/compendium/TagPicker.tsx`, `src/components/ui/{input,label}.tsx` |
| Enchantment mechanics | `src/components/compendium/ActivityEditor.tsx` (`enchant` kind) + `ActiveEffectEditor.tsx`; `SemanticActivity.enchant` in `src/types/activities.ts` |

---

## 2. Data-layer conventions (NEW tables = camelCase, NO alias layer)

The 4 crafting **entity** tables (recipes, enchantments, crafting_materials) use **camelCase
columns** (Foundry is camelCase end-to-end; the ordering field is `sort`). They therefore **SKIP**
the `src/lib/compendium.ts` `normalize`/`denormalize` alias layer entirely.

- **Load:** `const rows = await fetchCollection<any>('recipes', { orderBy: 'name ASC' })` → rows come
  back camelCase already. **Do NOT call `denormalizeCompendiumData`** (that's for legacy snake tables
  like feats/spells/items). Spread the row straight into form state.
- **Save:** `await upsertDocument('recipes', id, payload)` with a **camelCase** payload. `d1.ts`
  auto-`JSON.stringify`s any column whose name is in the `jsonFields` allowlist.
- **JSON columns** must be registered in BOTH `d1.ts` `jsonFields` AND
  `api/_lib/d1-fetchers-server.ts` `JSON_COLUMNS` (drift-synced). The list is **GLOBAL** (applies to
  every table) → use **distinctive** names. We deliberately avoided bare `level`/`time`/`cost`/
  `requirements` (would corrupt other tables' scalar columns); recipes uses `goldCost`/`craftTime`/
  `craftRequirements`, materials uses `usedFor`.
- **`D1_TABLE_MAP`** (`d1Tables.ts`) maps the camelCase alias → snake table name, e.g.
  `recipes:'recipes'`, `craftingDisciplines:'crafting_disciplines'`, `craftingMaterials:'crafting_materials'`.
- **Slim list/picker loads:** `fetchCollection('items', { select: 'id, name, item_type, rarity', orderBy })`.
  `select` is a comma-separated snake-column string (items is a legacy snake table).
- **Source-scoped uniqueness** index on every entity table: `UNIQUE(COALESCE(sourceId,''), identifier)`.
- **Taxonomy tables are snake_case** (see §6) — different convention from entity tables.

---

## 3. Entity editor pattern (CompendiumEditorShell) — the RecipesEditor mold

`RecipesEditor.tsx` is the canonical template. Build EnchantmentsEditor / CraftingMaterials editor by
copying it and swapping the form fields. Key facts:

- **It's a clean admin-only editor — the proposal-system props are ALL optional** (cascadeBanner,
  isReadOnly, onUnlockBase, proposalMode, etc.). Omit them. Gate on `userProfile?.role === 'admin'`.
- **Minimal required props** (everything else optional):
  `entityName={{singular,plural}}`, `backPath="/compendium"`,
  `modes={[{ key:'manual-editor', label:'Manual Editor', render: null }]}`,
  `defaultModeKey="manual-editor"`, `manualEditorModeKey="manual-editor"`, `isAdmin`,
  `listRows`, `listColumns`, `loading`, `selectedId`, `onSelect`, `onNew`, `getRowId`,
  `search`, `onSearchChange`, `searchPlaceholder`,
  `activeFilterCount={0}`, `isFilterOpen={false}`, `setIsFilterOpen={()=>{}}`, `resetFilters={()=>{}}`
  (filters unused → stub them), `identityName`, `onSave`, `onReset`, `saving`,
  `formId="recipe-manual-editor-form"`, `editorSubTabs`, `tagsSubTabs`, `renderPreview`.
  Optional but used: `onDelete` (omit to hide Delete), `identitySourceAbbrev`, `identitySubtitle`,
  `tagsSuperTabCount`.
- `editorSubTabs: EditorSubTab[]` = `[{ key, label, layout?: 'scroll'|'fill', render: () => JSX }]`.
  `tagsSubTabs: TagsSubTab[]` = `[{ key, label, render: () => JSX }]`.
- `listColumns: EditorListColumn<any>[]` = `[{ key, label, width:'minmax(0,1fr)'|'108px', align?, render:(row)=>JSX }]`.
- The shell wraps the whole editor in `<form id={formId}>`; the Save button submits it. All fields
  controlled via local `form` state. After save: `upsertDocument` → reload via `fetchCollection` →
  `setSelectedId(id)`.
- Types: `import { CompendiumEditorShell, type EditorSubTab, type TagsSubTab, type EditorListColumn }
  from '../../components/compendium/CompendiumEditorShell'`. Rows are typed `<any>` (codebase norm).

---

## 4. Reusable components (props VERIFIED this session — tsc-clean in RecipesEditor)

```tsx
// Searchable single-select (handles the ~1700-item catalog; portaled dropdown works in modals)
import SingleSelectSearch, { type SingleSelectSearchOption } from '../../components/ui/SingleSelectSearch';
<SingleSelectSearch
  value={form.outputItemId}                       // string | undefined
  onChange={(v) => setForm(p => ({ ...p, outputItemId: v }))}
  options={items.map(i => ({ id: String(i.id), name: String(i.name), hint: i.item_type }))} // {id,name,hint?}
  placeholder="Select item…"
  noEntitiesText="No items yet."
  className="w-full" triggerClassName="w-full h-9"
/>   // also: emptyText, disabled, allowClear (default true)

// Image / icon picker
import { ImageUpload } from '../../components/ui/ImageUpload';
<ImageUpload currentImageUrl={form.imageUrl} storagePath={`images/recipes/${selectedId || 'draft'}/`}
  onUpload={(url) => setForm(p => ({ ...p, imageUrl: url }))} imageType="icon" compact className="h-[80px] w-[80px]" />

// Rich text (BBCode storage)
import MarkdownEditor from '../../components/MarkdownEditor';   // default export
<MarkdownEditor value={form.description} onChange={(v)=>...} placeholder="…" minHeight="160px" maxHeight="360px" />

// Tags
import TagPicker from '../../components/compendium/TagPicker';            // default export
import { normalizeTagRow } from '../../lib/tagHierarchy';
// load: tags = (await fetchCollection('tags',{orderBy:'name ASC'})).map(normalizeTagRow);
//       tagGroups = (await fetchCollection('tagGroups',{})).map(g => ({ id:String(g.id), name:String(g.name) }));
<TagPicker tags={tags} tagGroups={tagGroups} selectedIds={form.tagIds}
  onChange={(next)=>setForm(p=>({...p, tagIds: next}))} hint="…" emptyHint="No tags available yet." />

import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
// Source = a plain <select> over fetchCollection('sources', {orderBy:'name ASC'})
```

---

## 5. Styling (style-guide classes — tokens ONLY, never raw palette)

Source of truth: `docs/ui/style-guide.md` (classes defined in `src/index.css`). Read before any UI.

- **Field label:** `className="field-label"` on `<Label>` — small uppercase tracked label.
- **Field input:** `className="field-input h-9"` on `<Input>` / `<select>` — standard bordered input.
- **Tokens:** `gold` = accent/highlight, `ink` = text, `blood` = warnings/destructive. Opacity scales:
  `text-ink/65`, `text-ink/45`, `border-gold/15`, `bg-background/50`, `text-gold/65`.
- **Common idioms** (from RecipesEditor): grids `grid grid-cols-2 gap-3` / `grid-cols-[1fr_90px]`;
  list cells `text-xs font-bold text-ink truncate` (name) and `text-[10px] text-ink/65` (secondary);
  selectable cards `border rounded text-xs ${active?'border-gold bg-gold/10':'border-gold/15 hover:border-gold/40'}`;
  add/remove `text-gold` / `text-blood/70 hover:text-blood`; section labels reuse `field-label`.
- **Square corners** (no large radii), **minimal icons** (only at-a-glance type glyphs + real action
  controls), **lucide-react** icons only.

---

## 6. Taxonomy editors (ProficiencyEntityShell + the new `columnCase` prop)

Small admin-managed lists (like crafting_disciplines) are a **tab in `AdminProficiencies.tsx`**, not a
standalone page. Pattern:

```tsx
// 1) add a TABS entry:
{ id:'craftingDisciplines', label:'Crafting Disciplines', icon: Hammer, group:'items', countTable:'craftingDisciplines' },
// 2) add a render block:
{activeTab === 'craftingDisciplines' && (
  <ProficiencyEntityShell userProfile={userProfile} hideHeader
    table="craftingDisciplines" singular="Crafting Discipline" plural="Crafting Disciplines"
    icon={Hammer} description="…" columnCase="camel" {...TAXONOMY_TAB_BASE} />
)}
```

- `TAXONOMY_TAB_BASE = { includeAbility:false, includeFoundryAlias:false, includeSource:false,
  includeBasicRules:false, includeOrder:true }`.
- **`columnCase` prop (added this session):** `'snake'` (default — legacy taxonomies persist
  `order`/`updated_at`) | `'camel'` (NEW camelCase tables persist `sort`/`updatedAt`). The shell
  handles all CRUD (modal, `upsertDocument`, delete). The shell form field stays `order` internally;
  only the persisted column name changes. This prop is the first step of migrating legacy taxonomies
  off snake_case — see `docs/database/camelcase-column-migration.md`.

---

## 7. Routes + nav

- **Route** (`src/App.tsx`, near the other `/compendium/*/manage` routes): the editor self-gates on
  `isAdmin`, so NO `<AdminOnly>` wrapper —
  `<Route path="/compendium/recipes/manage" element={<RecipesEditor userProfile={effectiveProfile} />} />`.
  Add the `import RecipesEditor from './pages/compendium/RecipesEditor'` near the other editor imports.
- **Sidebar** (`src/components/Sidebar.tsx`): crafting editors have no public browser yet (Phase A =
  authoring), so the link goes in the **admin-only** block `...(isAdmin ? [ { label:'Recipes',
  path:'/compendium/recipes/manage' }, … ] : [])`.

---

## 8. The two remaining authoring editors

- **EnchantmentsEditor** (`enchantments` table): copy RecipesEditor. Sub-tabs likely Basics / Effect /
  Restrictions / Tags. Reuse the shared **`ActivityEditor` in `enchant` mode** + **`ActiveEffectEditor`**
  to author `effects` (the type:"enchantment" Active Effect changes); `restrictions` JSON
  ({allowMagical,type,categories[],properties[]}) — the categories/properties pickers can read the
  reference taxonomies seeded by migration `20260605-1200` (consumable_categories / loot_categories /
  item_properties). Scalars: `magicalBonus`, `rarity`, `attunement` (''/required/optional), `price`.
- **CraftingMaterials editor** (`crafting_materials` table): each material is backed by a `loot`-type
  `items` row (`type_subtype='material'`) via `itemId`. Fields: `category` (reagent/essence/ingot/
  hide/part/wood/gem…), `rarity` (incl. new `trivial` tier — app enum edit, no migration), `subtype`
  (freeform flavor by category), `usedFor` (JSON array of `crafting_disciplines` ids — multi-select),
  `price`, `weight`. Open impl detail: whether the editor auto-creates/pairs the backing loot row.

---

## 9. Shop (Phase C) — MULTIPLE shops, not one global list

**Design decision (user, 2026-06-10):** the Shop section must support **multiple distinct shops**, so
a DM can stock specific shops (e.g. "Waterdeep Smithy", "Black Market") instead of being limited to a
single global price list. Implied model:

- A **`shops`** table: `{ id, name, identifier, description, scope ('global'|'campaign'), campaignId
  (nullable), imageUrl, … }` — a global shop and per-campaign shops coexist.
- A **`shop_inventory`** join: `{ shopId, itemId, priceOverride (JSON {value,denomination}, nullable →
  falls back to items.price), stock (nullable=unlimited) }`.
- Players view a shop's catalog + prices; buy/sell hits `character_inventory` + the **character wallet
  (GAP — no character currency exists yet; add a `characters.currency` JSON column matching Foundry's
  `system.currency`)**.
- Sequence: read-only price view per shop first → then buy/sell once the wallet exists.

This supersedes the earlier open "global price list vs per-campaign inventories" question →
**both, via named shops.** Captured in the roadmap memory + the design doc.

---

## 10. Kibbles reconciliation (what we're modeling)

Full record: `docs/_drafts/kibbles-reconciliation-2026-06-09.html`. Headlines:
- Recipe = universal `inputs → output`; 3 output modes: `item` / `enchantment` / `enchant-item`
  (apply an enchantment to a base). `+1/+2/+3` = enchant-item + an enchantment; named magic items =
  outputType `item`. KEPT recipe-native numbers `craftChecks` + `craftDifficultyDC`.
- Materials taxonomy: category × rarity-tier (incl. `trivial`) × property/flavor × used-for-discipline
  × price. Disciplines (Alchemy/Blacksmithing/Enchanting…) = the organizing axis (seeded taxonomy).
- DEFERRED (not built): denormalized recipe rarity/value, base-item constraints + recursive upgrades,
  family/variant grouping, material equivalentGoldValue/salvageable/sourceMetadata, parametric weapon
  generator, in-place gear modification. CUT (already covered): caster-level gating (craftRequirements),
  charges/attunement (items), harvesting d100 tables + crafting-job state (execution / Phase D).
