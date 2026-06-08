import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { X, ChevronLeft, Pencil } from 'lucide-react';
import ItemImportWorkbench from '../../components/compendium/ItemImportWorkbench';
import ActivityEditor from '../../components/compendium/ActivityEditor';
import ActiveEffectEditor from '../../components/compendium/ActiveEffectEditor';
import ItemDetailPanel from '../../components/compendium/ItemDetailPanel';
import ItemUsesField from '../../components/compendium/ItemUsesField';
import ContainerContentsPanel from '../../components/compendium/ContainerContentsPanel';
import TagPicker from '../../components/compendium/TagPicker';
import { normalizeTagRow } from '../../lib/tagHierarchy';
import MarkdownEditor from '../../components/MarkdownEditor';
import { useProposalAccumulator, useProposalContextOptional } from '../../lib/proposalAccumulator';
import { useProposalEntityDrafts } from '../../hooks/useProposalEntityDrafts';
import { useBlockDraftPickerOptions } from '../../hooks/useBlockDraftPickerOptions';
import { useProposalPreFlushSave } from '../../hooks/useProposalPreFlushSave';
import { useDraftedEntityIds } from '../../hooks/useDraftedEntityIds';
import { useEditBaseUnlocks } from '../../hooks/useEditBaseUnlocks';
import { useCascadeDependent } from '../../hooks/useCascadeDependent';
import { actionLabel, applyProposalWrite } from '../../lib/proposalAware';
import { useProposalReview, resolveReviewPayload, ReviewFieldHighlight } from '../../lib/proposalReview';
import { CascadeDependentBanner } from '../../components/proposals/CascadeDependentBanner';
import { TagReplacementPicker } from '../../components/proposals/TagReplacementPicker';
import { reportClientError, OperationType } from '../../lib/firebase';
import { upsertItem, deleteItem, fetchItem, denormalizeCompendiumData } from '../../lib/compendium';
import { fetchCollection } from '../../lib/d1';
import { slugify, cn } from '../../lib/utils';
import { matchesSingleAxisFilter, matchesMultiAxisFilter } from '../../lib/spellFilters';
import { useAxisFilters } from '../../hooks/useAxisFilters';
import {
  CompendiumEditorShell,
  type EditorMode,
  type EditorSubTab,
  type TagsSubTab,
  type EditorListColumn,
} from '../../components/compendium/CompendiumEditorShell';
import ScalingColumnsPanel from '../../components/compendium/ScalingColumnsPanel';
// Phase C — items-as-bump-authors. AdvancementManager is the same
// component classes / subclasses / feats mount; passing it the item's
// `availableFeatures` + `availableFeats` catalogs lets the Bump Uses
// target picker resolve. Item-authored ItemBumpUses bumps are stored
// on the items.advancements JSON column added by migration
// 20260527-1200_items_advancements.sql.
import AdvancementManager, { type Advancement } from '../../components/compendium/AdvancementManager';
import { SectionFilterPanel, type FilterSection } from '../../components/compendium/SectionFilterPanel';
import { Checkbox } from '../../components/ui/checkbox';
import { ImageUpload } from '../../components/ui/ImageUpload';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import SingleSelectSearch from '../../components/ui/SingleSelectSearch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { ActivitySection, FieldRow } from '../../components/compendium/activity/primitives';
import { ABILITY_OPTIONS, FALLBACK_ABILITY_LABELS, DAMAGE_TYPE_OPTIONS, DAMAGE_DIE_DENOMINATIONS } from '../../components/compendium/activity/constants';
import DamagePartEditor from '../../components/compendium/activity/DamagePartEditor';

// ─── Vocabularies ──────────────────────────────────────────────────
//
// Foundry dnd5e v5 system.type enums + the form-side vocab the editor
// surfaces. Slug values stay Foundry-canonical for round-trip; labels
// are display-only.

// Alphabetized by label so the Item Type dropdown reads in order.
const ITEM_TYPES: [string, string][] = [
  ['consumable', 'Consumable'],
  ['container', 'Container'],
  ['equipment', 'Equipment / Armor'],
  ['loot', 'Loot / Wondrous'],
  ['tool', 'Tool'],
  ['weapon', 'Weapon'],
];

const ITEM_TYPE_LABEL: Record<string, string> =
  Object.fromEntries(ITEM_TYPES.map(([v, l]) => [v, l]));

const RARITIES: [string, string][] = [
  ['none', 'None'],
  ['common', 'Common'],
  ['uncommon', 'Uncommon'],
  ['rare', 'Rare'],
  ['veryRare', 'Very Rare'],
  ['legendary', 'Legendary'],
  ['artifact', 'Artifact'],
];

const ATTUNEMENT_OPTIONS: [string, string][] = [
  ['', 'None'],
  ['required', 'Required'],
  ['optional', 'Optional'],
];

const DENOMINATIONS: [string, string][] = [
  ['cp', 'cp'], ['sp', 'sp'], ['ep', 'ep'], ['gp', 'gp'], ['pp', 'pp'],
];

const WEIGHT_UNITS: [string, string][] = [
  ['lb', 'lb'], ['kg', 'kg'],
];

// dnd5e v5 `system.type.value` enum for equipment. Armor-bearing
// subtypes (light/medium/heavy/shield) drive the conditional armor
// block in the equipment sub-form.
const EQUIPMENT_SUBTYPES: [string, string][] = [
  ['light', 'Light Armor'],
  ['medium', 'Medium Armor'],
  ['heavy', 'Heavy Armor'],
  ['shield', 'Shield'],
  ['clothing', 'Clothing'],
  ['trinket', 'Trinket'],
  ['ring', 'Ring'],
  ['rod', 'Rod'],
  ['wand', 'Wand'],
  ['wondrous', 'Wondrous Item'],
  ['vehicle', 'Vehicle (Mount/Carriage)'],
];

const EQUIPMENT_ARMOR_SUBTYPES = new Set(['light', 'medium', 'heavy', 'shield']);

// Alphabetized by label.
const CONSUMABLE_SUBTYPES: [string, string][] = [
  ['ammo', 'Ammunition'],
  ['food', 'Food / Drink'],
  ['poison', 'Poison'],
  ['potion', 'Potion'],
  ['rod', 'Rod'],
  ['scroll', 'Scroll'],
  ['trinket', 'Trinket'],
  ['wand', 'Wand'],
  ['wondrous', 'Wondrous Item'],
];

const TOOL_SUBTYPES: [string, string][] = [
  ['art', "Artisan's Tools"],
  ['game', 'Gaming Set'],
  ['music', 'Musical Instrument'],
];

const LOOT_SUBTYPES: [string, string][] = [
  ['art', 'Art Object'],
  ['gear', 'Adventuring Gear'],
  ['gem', 'Gemstone'],
  ['junk', 'Junk'],
  ['material', 'Crafting Material'],
  ['resource', 'Resource'],
  ['trade', 'Trade Good'],
  ['treasure', 'Treasure'],
];

const WEAPON_RANGE_UNITS: [string, string][] = [
  ['ft', 'feet'], ['mi', 'miles'], ['m', 'meters'], ['km', 'kilometers'], ['spec', 'special'],
];

// dnd5e 5.x container capacity units (CONFIG.DND5E.volumeUnits /
// weightUnits). Keys are Foundry-canonical so capacity round-trips as a
// pass-through. Defaults: volume → cubicFoot, weight → lb.
const CAPACITY_VOLUME_UNITS: [string, string][] = [
  ['cubicFoot', 'Cubic Feet'],
  ['liter', 'Liters'],
];

const CAPACITY_WEIGHT_UNITS: [string, string][] = [
  ['lb', 'Pounds'],
  ['kg', 'Kilograms'],
  ['tn', 'Tons'],
  ['Mg', 'Megagrams'],
];

// Foundry's 3-state attunement vocabulary, labelled to match the dnd5e
// sheet. '' (not required) rides the 'none' sentinel so the Select never
// carries an empty-string item value.
const CONTAINER_ATTUNEMENT_OPTIONS: [string, string][] = [
  ['none', 'Attunement Not Required'],
  ['required', 'Attunement Required'],
  ['optional', 'Optional Attunement'],
];

function getSubtypeOptions(itemType: string): [string, string][] | null {
  switch (itemType) {
    case 'equipment': return EQUIPMENT_SUBTYPES;
    case 'consumable': return CONSUMABLE_SUBTYPES;
    case 'tool': return TOOL_SUBTYPES;
    case 'loot': return LOOT_SUBTYPES;
    default: return null;
  }
}

// ─── Form data shape ───────────────────────────────────────────────

type UsesRecoveryRule = { period: string; type: string; formula: string };

type ItemFormData = {
  id?: string;
  // Identity
  name: string;
  identifier: string;
  sourceId: string;
  page: string;
  imageUrl: string;
  description: string;

  // Type discriminators
  itemType: string;
  typeSubtype: string;
  typeInnerSubtype: string;

  // Physical
  rarity: string;
  quantity: number;
  weight: { value: number; units: string };
  price: { value: number; denomination: string };

  // Equippability (attunement is 3-state TEXT post 20260526-1700)
  attunement: string;
  equipped: boolean;
  identified: boolean;
  magical: boolean;
  unidentifiedDescription: string;
  chatDescription: string;

  // Properties (slug array)
  properties: string[];

  // Uses block
  uses: { max: string; spent: number; recovery: UsesRecoveryRule[]; autoDestroy: boolean };

  // Weapon-specific
  damage: any;
  range: any;
  mastery: string;
  magicalBonus: number;
  ammunition: any;

  // Armor-specific
  armorValue: number;
  armorDex: number | null;
  armorMagicalBonus: number;
  strength: number | null;
  armorType: string;

  // Tool-specific
  toolType: string;
  bonus: string;
  chatFlavor: string;
  abilityId: string;

  // Container-specific
  capacity: any;
  currency: any;
  containerId: string;

  // Base-item FKs
  baseWeaponId: string;
  baseArmorId: string;
  baseToolId: string;
  baseItem: string;

  // Activities + effects
  activities: any[];
  effects: any[];

  // Phase C — authored advancements (ItemBumpUses, etc.). Persists
  // to the items.advancements JSON column. Mirrors the feat-shape
  // advancements field; the editor surfaces a dedicated sub-tab.
  advancements: Advancement[];

  // Tags
  tagIds: string[];

  createdAt?: string;
  updatedAt?: string;
  [key: string]: any;
};

const ITEM_DEFAULTS: Omit<ItemFormData, 'sourceId'> & { sourceId?: string } = {
  name: '',
  identifier: '',
  sourceId: '',
  page: '',
  imageUrl: '',
  description: '',
  itemType: 'loot',
  typeSubtype: '',
  typeInnerSubtype: '',
  rarity: 'none',
  quantity: 1,
  weight: { value: 0, units: 'lb' },
  price: { value: 0, denomination: 'gp' },
  attunement: '',
  equipped: false,
  identified: true,
  magical: false,
  unidentifiedDescription: '',
  chatDescription: '',
  properties: [],
  uses: { max: '', spent: 0, recovery: [], autoDestroy: false },
  damage: null,
  range: null,
  mastery: '',
  magicalBonus: 0,
  ammunition: null,
  armorValue: 10,
  armorDex: null,
  armorMagicalBonus: 0,
  strength: null,
  armorType: '',
  toolType: '',
  bonus: '',
  chatFlavor: '',
  abilityId: '',
  capacity: null,
  currency: null,
  containerId: '',
  baseWeaponId: '',
  baseArmorId: '',
  baseToolId: '',
  baseItem: '',
  activities: [],
  effects: [],
  advancements: [],
  tagIds: [],
};

function makeInitialItemForm(sources: any[] = []): ItemFormData {
  return {
    ...ITEM_DEFAULTS,
    sourceId: sources[0]?.id || '',
  } as ItemFormData;
}

type ProficiencyBucket = {
  weapons: any[];
  armor: any[];
  tools: any[];
  abilities: any[];
  weaponProperties: any[];
  itemProperties: any[];
  ammunitionTypes: any[];
  poisonTypes: any[];
};

const EMPTY_BUCKET: ProficiencyBucket = {
  weapons: [], armor: [], tools: [], abilities: [], weaponProperties: [],
  itemProperties: [], ammunitionTypes: [], poisonTypes: [],
};

// Property axis values — surfaced via the multi-axis property filter.
// Each item row pre-computes a Set<string> with the slugs that apply.
const ITEM_PROPERTY_AXIS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'magical',    label: 'Magical' },
  { value: 'attunement', label: 'Requires Attunement' },
];

// Axis keys this page consumes. Drives `useAxisFilters`'s
// `activeFilterCount` summation so stale keys from older versions
// don't inflate the badge.
const ITEM_AXIS_KEYS = [
  'itemType', 'rarity', 'source', 'weaponCategory',
  'armorCategory', 'toolCategory', 'damageType', 'property',
] as const;

// No-op tag-axis handlers — items don't have tag-kind axes (only the
// axis kind), but SectionFilterPanel requires the props. Stable
// top-level functions so React doesn't see "new" handlers on every
// render and re-key memoised axes.
const NOOP_CYCLE_TAG = () => { /* no tag axes on items */ };
const NOOP_SET_TAG_STATES: React.Dispatch<React.SetStateAction<Record<string, number>>> = () => { /* no tag axes on items */ };
const EMPTY_TAG_STATES: Record<string, number> = {};

// ─── Page ─────────────────────────────────────────────────────────

export default function ItemsEditor({ userProfile }: { userProfile: any }) {
  const location = useLocation();
  const isAdmin = userProfile?.role === 'admin';
  const isContentCreator = !!userProfile?.permissions &&
    Object.prototype.hasOwnProperty.call(userProfile.permissions, 'content-creator');
  const canManage = isAdmin || isContentCreator;
  const isProposalRoute = location.pathname.startsWith('/proposals/edit/');
  const backPath = isProposalRoute ? '/my-proposals' : '/compendium/items';
  const backLabel = isProposalRoute ? 'Back to My Proposals' : 'Back To Items';

  // ── Proposal-mode plumbing ────────────────────────────────────
  const itemWriter = useProposalAccumulator('item', userProfile);
  const proposalContext = useProposalContextOptional();
  const isProposalMode = itemWriter.mode === 'proposal' || itemWriter.mode === 'block';
  // Block-draft picker overlays (Part C L1). Drafts authored in the active block
  // (scaling columns, features, feats this item's advancements reference) have no
  // live row yet; surface them in the advancement picker (display-only,
  // "(in this block)" suffix). Empty outside a <ProposalEditorWrapper>.
  const scalingColumnDraftOptions = useBlockDraftPickerOptions('scaling_column');
  const featureDraftOptions = useBlockDraftPickerOptions('feature');
  const featDraftOptions = useBlockDraftPickerOptions('feat');
  const focusMode = proposalContext?.focusMode ?? 'drafts';
  const focusModeEnabled = proposalContext?.focusModeEnabled ?? false;
  const reviewMode = useProposalReview();
  const reviewPayload = resolveReviewPayload(reviewMode, 'item', null);
  const isReviewingItem = !!reviewMode && !!reviewPayload && reviewMode.entityType === 'item';

  // ── State ─────────────────────────────────────────────────────
  const [entries, setEntries] = useState<any[]>([]);
  const [itemDetailsById, setItemDetailsById] = useState<Record<string, any>>({});
  const [sources, setSources] = useState<any[]>([]);
  const [profs, setProfs] = useState<ProficiencyBucket>(EMPTY_BUCKET);
  // Tags + tagGroups feed the Tags super-tab's TagPicker. Loaded once
  // on mount alongside the items list; the tags are normalized through
  // normalizeTagRow so the picker's `parentTagId` / `groupId` shape
  // matches the canonical snake_case → camelCase translation used by
  // every other tag consumer.
  const [tags, setTags] = useState<Array<{ id: string; name: string; groupId: string | null; parentTagId: string | null }>>([]);
  const [tagGroups, setTagGroups] = useState<Array<{ id: string; name: string }>>([]);
  // Weapon-category lookup (homebrew-extensible — loaded from D1
  // alongside weapons themselves). Other category enums (armor / tool)
  // come from items.armor_type / items.tool_type directly since the
  // editor authors them as fixed Foundry slugs; no DB lookup needed.
  const [weaponCategories, setWeaponCategories] = useState<Array<{ id: string; name: string; identifier?: string }>>([]);

  // ── Filter state ──────────────────────────────────────────────
  // useAxisFilters bundles every cycler + activeFilterCount the
  // SectionFilterPanel needs. We pass ITEM_AXIS_KEYS so the count
  // only sums the axes this page actually consumes.
  const { axisFilters, cyclers, activeFilterCount, resetAll: resetAxisFilters } =
    useAxisFilters(ITEM_AXIS_KEYS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  // URL-backed editingId — mirrors FeatsEditor so navigating
  // away (e.g. + Add on a scaling column → ScalingEditor →
  // navigate(-1)) returns here with the row still selected.
  // ?editingId=<uuid> is the persistent slot; the useState
  // initializer hydrates from URL on mount, the two effects
  // below keep state and URL in sync.
  const [urlSearchParams, setUrlSearchParams] = useSearchParams();
  const initialEditingId = urlSearchParams.get('editingId');
  const [editingId, setEditingId] = useState<string | null>(initialEditingId);
  const [formData, setFormData] = useState<ItemFormData>(makeInitialItemForm());
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  // Cascade dependent state (parity with FeatsEditor / SpellsEditor).
  const cascadeDep = useCascadeDependent('item', editingId);
  const [replaceTagPickerOpen, setReplaceTagPickerOpen] = useState(false);

  // Scaling columns owned by the currently-edited item. Mirrors
  // FeatsEditor's pattern: rows in `scaling_columns` with
  // parent_type='item'. An item like Amulet of the Devout authors
  // a column (e.g. "Channel Divinity Bonus" = +1 at all levels)
  // and ScaleValue or activity formulas reference
  // `@scale.<item-identifier>.<column>` to surface the bump.
  const [scalingColumns, setScalingColumns] = useState<any[]>([]);
  const [scalingLoadTick, setScalingLoadTick] = useState(0);

  // Phase C — feats + features catalogs for the AdvancementManager
  // target picker on the new Advancement sub-tab. Loaded once on
  // mount alongside the other compendium fetches. Lightweight {id,
  // name} projections is all the picker needs; passing the full row
  // is fine since the dropdown only renders `name`.
  const [availableFeats, setAvailableFeats] = useState<any[]>([]);
  const [availableFeatures, setAvailableFeatures] = useState<any[]>([]);

  // Outgoing sync: editingId -> URL. `replace: true` keeps the
  // back stack clean while row-clicking. See FeatsEditor for the
  // matching pattern + rationale.
  useEffect(() => {
    const current = urlSearchParams.get('editingId');
    if (editingId && editingId !== current) {
      setUrlSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('editingId', editingId);
          return next;
        },
        { replace: true },
      );
    } else if (!editingId && current) {
      setUrlSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('editingId');
          return next;
        },
        { replace: true },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId]);

  // Inbound sync: URL -> editingId (back/forward, address-bar
  // edits). The equality guard prevents a feedback loop with the
  // outgoing effect.
  useEffect(() => {
    const urlEditingId = urlSearchParams.get('editingId');
    if ((urlEditingId || null) !== editingId) {
      setEditingId(urlEditingId || null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlSearchParams]);

  // Refs.
  const editingIdRef = useRef<string | null>(null);
  useEffect(() => { editingIdRef.current = editingId; }, [editingId]);
  const formDataRef = useRef<ItemFormData | null>(null);
  const lastLoadedFormRef = useRef<string>('');

  // Drafted / Edit-Base unlock state.
  const draftedItemIds = useDraftedEntityIds('item');
  const draftedItemEntities = useProposalEntityDrafts('item');
  const {
    unlockedBaseIds,
    unlock: unlockBaseItem,
    isReadOnly,
  } = useEditBaseUnlocks({
    focusModeEnabled,
    editingId,
    draftedIds: draftedItemIds,
    proposalContext,
  });

  // ── Initial load ──────────────────────────────────────────────
  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    (async () => {
      try {
        const [
          itemRows,
          sourceRows,
          weapons,
          armor,
          tools,
          abilities,
          weaponProperties,
          weaponCategoryRows,
          tagRows,
          tagGroupRows,
          featRows,
          featureRows,
          itemPropertyRows,
          ammunitionTypeRows,
          poisonTypeRows,
        ] = await Promise.all([
          fetchCollection<any>('items', { orderBy: 'name ASC' }),
          fetchCollection<any>('sources', { orderBy: 'name ASC' }),
          fetchCollection<any>('weapons', { orderBy: 'name ASC' }),
          fetchCollection<any>('armor', { orderBy: 'name ASC' }),
          fetchCollection<any>('tools', { orderBy: 'name ASC' }),
          fetchCollection<any>('attributes', { orderBy: 'name ASC' }),
          fetchCollection<any>('weaponProperties', { orderBy: 'name ASC' }),
          fetchCollection<any>('weaponCategories', { orderBy: '"order", name ASC' }),
          fetchCollection<any>('tags', { orderBy: 'name ASC' }),
          fetchCollection<any>('tagGroups', { orderBy: 'name ASC' }),
          // Phase C — feats + features catalogs for the ItemBumpUses
          // target picker. Same fetch pattern FeatsEditor uses for its
          // `availableFeats` source (`entries`).
          fetchCollection<any>('feats', { orderBy: 'name ASC' }),
          fetchCollection<any>('features', { orderBy: 'name ASC' }),
          // Item taxonomies for the per-type Details sub-forms: item
          // properties (carry valid_types) + the ammunition / poison
          // second-axis lists.
          fetchCollection<any>('itemProperties', { orderBy: 'name ASC' }),
          fetchCollection<any>('ammunitionTypes', { orderBy: 'sort_order, name' }),
          fetchCollection<any>('poisonTypes', { orderBy: 'sort_order, name' }),
        ]);
        if (cancelled) return;

        // Build the weapon-id → category-id map so per-item filter
        // axes can resolve baseWeaponId → weaponCategoryId without
        // re-joining at filter time. weapons rows from queryD1 are
        // snake_case (`category_id`).
        const weaponCategoryIdByWeaponId = new Map<string, string>();
        for (const w of weapons) {
          if (w?.id && w?.category_id) weaponCategoryIdByWeaponId.set(String(w.id), String(w.category_id));
        }

        const mapped = itemRows.map((row: any) => {
          const baseWeaponId = row.base_weapon_id ?? null;
          const weaponCategoryId = baseWeaponId
            ? (weaponCategoryIdByWeaponId.get(String(baseWeaponId)) || null)
            : null;
          // armor_type / tool_type already hold the Foundry slug
          // (light / medium / heavy / shield / clothing / etc.; art /
          // game / music) — no DB join needed.
          const armorCategoryId = row.armor_type ? String(row.armor_type) : null;
          const toolCategoryId = row.tool_type ? String(row.tool_type) : null;

          // Damage types live on items.damage.base.types[] AND on
          // items.damage.parts[i].types[]. Aggregate both so a weapon
          // with a primary + bonus damage type matches either axis pick.
          const damageTypeSet = new Set<string>();
          const damage = row.damage;
          if (damage && typeof damage === 'object') {
            const baseTypes = Array.isArray(damage.base?.types) ? damage.base.types : [];
            for (const t of baseTypes) damageTypeSet.add(String(t));
            const parts = Array.isArray(damage.parts) ? damage.parts : [];
            for (const p of parts) {
              const tt = Array.isArray(p?.types) ? p.types : [];
              for (const t of tt) damageTypeSet.add(String(t));
            }
          }

          const attunementRaw = row.attunement;
          const attunementFlag = !!(
            attunementRaw === 'required'
            || attunementRaw === 'optional'
            || attunementRaw === 1
            || attunementRaw === true
          );
          const magicalFlag = !!(row.magical === 1 || row.magical === true);

          return {
            ...row,
            sourceId: row.source_id,
            imageUrl: row.image_url,
            itemType: row.item_type,
            tagIds: Array.isArray(row.tags) ? row.tags : [],
            // Pre-computed filter-axis fields:
            weaponCategoryId,
            armorCategoryId,
            toolCategoryId,
            damageTypeSet,
            magicalFlag,
            attunementFlag,
          };
        });
        setEntries(mapped);
        setWeaponCategories(weaponCategoryRows.map((r: any) => ({
          id: String(r.id),
          name: String(r.name || r.identifier || r.id),
          identifier: r.identifier ? String(r.identifier) : undefined,
        })));
        setSources(sourceRows);
        setProfs({
          weapons: weapons.map((r) => denormalizeCompendiumData(r)),
          armor: armor.map((r) => denormalizeCompendiumData(r)),
          tools: tools.map((r) => denormalizeCompendiumData(r)),
          abilities: abilities.map((r) => denormalizeCompendiumData(r)),
          weaponProperties: weaponProperties.map((r) => denormalizeCompendiumData(r)),
          // Keep item_properties raw — valid_types stays a JSON string for
          // the per-type filter (mirrors ActivityEditor's enchant usage).
          itemProperties: itemPropertyRows,
          ammunitionTypes: ammunitionTypeRows,
          poisonTypes: poisonTypeRows,
        });
        // Phase C — feats + features for the ItemBumpUses target picker.
        // Raw rows are fine here; the AdvancementManager picker only
        // needs `{ id, name }` and we don't want to denormalize the
        // entire catalog just to filter the dropdown.
        setAvailableFeats(featRows);
        setAvailableFeatures(featureRows);
        // Tags + tagGroups for the TagPicker. normalizeTagRow handles
        // the snake_case → camelCase rename + the `parent_tag_id` →
        // `parentTagId` shape the picker expects.
        setTags(tagRows.map((row: any) => {
          const normalized = normalizeTagRow(row);
          return {
            id: String(normalized.id),
            name: String(normalized.name || ''),
            groupId: normalized.groupId ?? null,
            parentTagId: normalized.parentTagId ?? null,
          };
        }));
        setTagGroups(tagGroupRows.map((row: any) => ({
          id: String(row.id),
          name: String(row.name || ''),
        })));
        setLoading(false);
      } catch (err) {
        console.error('[ItemsEditor] failed to load:', err);
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [canManage]);

  // Default source on first New row.
  useEffect(() => {
    if (editingId) return;
    if (formData.sourceId || sources.length === 0) return;
    setFormData((prev) => ({ ...prev, sourceId: sources[0].id }));
  }, [editingId, formData.sourceId, sources]);

  const sourceNameById = useMemo(
    () => Object.fromEntries(sources.map((s) => [s.id, s.name || s.abbreviation || s.id])),
    [sources],
  );
  const sourceAbbrevById = useMemo(
    () => Object.fromEntries(sources.map((s) => [s.id, s.abbreviation || s.shortName || s.name || s.id])),
    [sources],
  );

  // ── Reset form ────────────────────────────────────────────────
  const resetForm = () => {
    const initial = makeInitialItemForm(sources);
    setEditingId(null);
    setFormData(initial);
    lastLoadedFormRef.current = JSON.stringify(initial);
  };

  // ── Review mode hydration ─────────────────────────────────────
  useEffect(() => {
    if (!isReviewingItem || !reviewMode?.entityId || !reviewPayload) return;
    setItemDetailsById((current) =>
      current[reviewMode.entityId!]
        ? current
        : { ...current, [reviewMode.entityId!]: denormalizeCompendiumData(reviewPayload) },
    );
    if (editingId !== reviewMode.entityId) {
      setEditingId(reviewMode.entityId);
    }
  }, [isReviewingItem, reviewMode?.entityId, reviewPayload, editingId]);

  // ── Form hydrate when editingId changes ───────────────────────
  useEffect(() => {
    if (!editingId) return;
    const draftedOverlay = draftedItemEntities.byId.get(editingId);
    if (draftedOverlay && !itemDetailsById[editingId]) {
      setItemDetailsById((current) => ({
        ...current,
        [editingId]: denormalizeCompendiumData(draftedOverlay),
      }));
    }
    const cached = itemDetailsById[editingId];
    if (cached) {
      const defaults = makeInitialItemForm(sources);
      const loaded: ItemFormData = {
        ...defaults,
        ...cached,
        id: cached.id,
        sourceId: cached.sourceId || cached.source_id || sources[0]?.id || '',
        page: String(cached.page || ''),
        imageUrl: cached.imageUrl || cached.image_url || '',
        description: cached.description || '',
        itemType: cached.itemType || cached.item_type || 'loot',
        typeSubtype: cached.typeSubtype || cached.type_subtype || '',
        typeInnerSubtype: cached.typeInnerSubtype || cached.type_inner_subtype || '',
        rarity: cached.rarity || 'none',
        quantity: Number(cached.quantity ?? 1) || 1,
        weight: cached.weight && typeof cached.weight === 'object'
          ? cached.weight
          : { value: Number(cached.weight ?? 0) || 0, units: 'lb' },
        price: cached.price && typeof cached.price === 'object'
          ? cached.price
          : { value: 0, denomination: 'gp' },
        attunement: (() => {
          const raw = cached.attunement;
          if (raw === 'required' || raw === 'optional') return raw;
          if (raw === true || raw === 1) return 'required';
          return '';
        })(),
        equipped: !!cached.equipped,
        identified: cached.identified !== false,
        magical: !!cached.magical,
        unidentifiedDescription: cached.unidentifiedDescription || cached.unidentified_description || '',
        chatDescription: cached.chatDescription || cached.chat_description || '',
        properties: Array.isArray(cached.properties) ? cached.properties : [],
        uses: cached.uses && typeof cached.uses === 'object'
          ? {
              max: String(cached.uses.max ?? ''),
              spent: Number(cached.uses.spent ?? 0) || 0,
              recovery: Array.isArray(cached.uses.recovery) ? cached.uses.recovery : [],
              autoDestroy: !!cached.uses.autoDestroy,
            }
          : { max: '', spent: 0, recovery: [], autoDestroy: false },
        damage: cached.damage ?? null,
        range: cached.range ?? null,
        mastery: cached.mastery || '',
        magicalBonus: Number(cached.magicalBonus ?? cached.magical_bonus ?? 0) || 0,
        ammunition: cached.ammunition ?? null,
        armorValue: Number(cached.armorValue ?? cached.armor_value ?? 10) || 10,
        armorDex: cached.armorDex ?? cached.armor_dex ?? null,
        armorMagicalBonus: Number(cached.armorMagicalBonus ?? cached.armor_magical_bonus ?? 0) || 0,
        strength: cached.strength ?? null,
        armorType: cached.armorType || cached.armor_type || '',
        toolType: cached.toolType || cached.tool_type || '',
        bonus: cached.bonus || '',
        chatFlavor: cached.chatFlavor || cached.chat_flavor || '',
        abilityId: cached.abilityId || cached.ability_id || '',
        capacity: cached.capacity ?? null,
        currency: cached.currency ?? null,
        containerId: cached.containerId || cached.container_id || '',
        baseWeaponId: cached.baseWeaponId || cached.base_weapon_id || '',
        baseArmorId: cached.baseArmorId || cached.base_armor_id || '',
        baseToolId: cached.baseToolId || cached.base_tool_id || '',
        baseItem: cached.baseItem || cached.base_item || '',
        activities: Array.isArray(cached.automation?.activities)
          ? cached.automation.activities
          : Array.isArray(cached.activities) ? cached.activities : [],
        effects: Array.isArray(cached.automation?.effects)
          ? cached.automation.effects
          : Array.isArray(cached.effects) ? cached.effects : [],
        // `advancements` is auto-parsed by d1.ts (it's in the jsonFields
        // list), so cached rows arrive as arrays. The fallback handles
        // legacy items written before migration 20260527-1200 added the
        // column — they come back undefined and we seed an empty array.
        advancements: Array.isArray(cached.advancements) ? cached.advancements : [],
        tagIds: Array.isArray(cached.tagIds) ? cached.tagIds : (Array.isArray(cached.tags) ? cached.tags : []),
      };
      setFormData(loaded);
      lastLoadedFormRef.current = JSON.stringify(loaded);
      return;
    }
    let active = true;
    (async () => {
      try {
        const data = await fetchItem(editingId);
        if (!active || !data) return;
        setItemDetailsById((current) => ({ ...current, [editingId]: data }));
      } catch (err) {
        console.error('[ItemsEditor] failed to load item details:', err);
      }
    })();
    return () => { active = false; };
  }, [editingId, sources, itemDetailsById, draftedItemEntities]);

  // Scaling columns owned by the currently-edited item. Loaded
  // by (parent_id, parent_type='item') just like classes load
  // their own and feats load theirs — same shared
  // `scaling_columns` table, just a different parent_type.
  useEffect(() => {
    if (!editingId) {
      setScalingColumns([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const rows = await fetchCollection<any>('scaling_columns', {
          where: 'parent_id = ? AND parent_type = ?',
          params: [editingId, 'item'],
          orderBy: 'name ASC',
        });
        if (cancelled) return;
        setScalingColumns(rows.map((r: any) => denormalizeCompendiumData(r)));
      } catch (err) {
        console.error('[ItemsEditor] scaling_columns load failed:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [editingId, scalingLoadTick]);

  // ── Switch handler — auto-stage in proposal mode ──────────────
  const startEditing = async (id: string) => {
    if (isProposalMode && editingIdRef.current && id !== editingIdRef.current) {
      const currentSerialized = JSON.stringify(formDataRef.current ?? formData);
      if (currentSerialized !== lastLoadedFormRef.current) {
        try {
          await handleSaveRef.current(undefined, { silent: true });
        } catch (err) {
          console.error('[ItemsEditor] auto-stage failed:', err);
          toast.error('Could not stage previous item — switching anyway.');
        }
      }
    }
    setEditingId(id);
  };

  // ── Save / Delete ─────────────────────────────────────────────
  const refreshEntries = async () => {
    try {
      const rows = await fetchCollection<any>('items', { orderBy: 'name ASC' });
      setEntries(rows.map((row: any) => ({
        ...row,
        sourceId: row.source_id,
        imageUrl: row.image_url,
        itemType: row.item_type,
        tagIds: Array.isArray(row.tags) ? row.tags : [],
      })));
      setItemDetailsById({});
    } catch (err) {
      console.error('[ItemsEditor] failed to refresh entries:', err);
    }
  };

  const handleSave = async (e?: React.FormEvent, opts: { silent?: boolean } = {}) => {
    if (e) e.preventDefault();
    if (!formData.name.trim()) {
      if (!opts.silent) toast.error('Item name is required');
      return;
    }
    if (!formData.sourceId) {
      if (!opts.silent) toast.error('Source is required');
      return;
    }

    if (!opts.silent) setSaving(true);
    try {
      const cleanedRecovery = (formData.uses.recovery || []).filter(
        (r) => r.period || r.type || (r.formula && r.formula.trim()),
      );

      // Build the canonical snake_case row. `upsertItem` runs
      // normalizeCompendiumData on the way in — we pre-snake some
      // keys (sourceId / imageUrl / itemType / etc.) but leave the
      // JSON sub-objects (weight / price / damage / range / uses /
      // capacity / currency / ammunition) alone since they map to
      // single-token JSON columns.
      const payload: Record<string, any> = {
        name: formData.name,
        identifier: formData.identifier.trim() || slugify(formData.name),
        source_id: formData.sourceId,
        page: formData.page || null,
        image_url: formData.imageUrl || null,
        description: formData.description || '',
        item_type: formData.itemType || 'loot',
        type_subtype: formData.typeSubtype || null,
        type_inner_subtype: formData.typeInnerSubtype || null,
        rarity: formData.rarity || 'none',
        quantity: Number(formData.quantity) || 1,
        weight: formData.weight,
        price: formData.price,
        attunement: formData.attunement || '',
        equipped: formData.equipped ? 1 : 0,
        identified: formData.identified ? 1 : 0,
        // Magical is now the `mgc` property (Details), not a Basics
        // checkbox — keep the legacy boolean column in sync so the list
        // filter + export's magical derivation still work.
        magical: (Array.isArray(formData.properties) && formData.properties.includes('mgc')) ? 1 : 0,
        unidentified_description: formData.unidentifiedDescription || null,
        chat_description: formData.chatDescription || null,
        properties: Array.isArray(formData.properties) ? formData.properties : [],
        uses: {
          max: formData.uses.max || '',
          spent: Number(formData.uses.spent) || 0,
          recovery: cleanedRecovery,
          autoDestroy: !!formData.uses.autoDestroy,
        },
        // Weapon stats — only weapons populate these; null for everything else.
        damage: (formData.itemType === 'weapon' || formData.itemType === 'consumable') ? formData.damage : null,
        range: formData.itemType === 'weapon' ? formData.range : null,
        mastery: formData.mastery || null,
        magical_bonus: Number(formData.magicalBonus) || 0,
        ammunition: formData.itemType === 'weapon' ? formData.ammunition : null,
        // Armor stats — only equipment-armor populate these.
        armor_value: Number(formData.armorValue) || 0,
        armor_dex: formData.armorDex,
        armor_magical_bonus: Number(formData.armorMagicalBonus) || 0,
        strength: formData.strength,
        armor_type: formData.armorType || null,
        // Tool stats.
        tool_type: formData.toolType || null,
        bonus: formData.bonus || null,
        chat_flavor: formData.chatFlavor || null,
        ability_id: formData.abilityId || null,
        // Container stats.
        capacity: formData.itemType === 'container' ? formData.capacity : null,
        currency: formData.itemType === 'container' ? formData.currency : null,
        container_id: formData.containerId || null,
        // Base-item FKs (polymorphic — only one is set per row).
        base_weapon_id: formData.baseWeaponId || null,
        base_armor_id: formData.baseArmorId || null,
        base_tool_id: formData.baseToolId || null,
        base_item: formData.baseItem || null,
        // Automation surface (activities + effects).
        activities: Array.isArray(formData.activities) ? formData.activities : [],
        effects: Array.isArray(formData.effects) ? formData.effects : [],
        tagIds: Array.isArray(formData.tagIds) ? formData.tagIds : [],
        updated_at: new Date().toISOString(),
      };

      Object.keys(payload).forEach((key) => {
        if (payload[key] === undefined) delete payload[key];
      });

      const entryIdAtStart = editingId;
      const wasCreate = !entryIdAtStart;
      const entryId = entryIdAtStart || crypto.randomUUID();

      if (isProposalMode) {
        const { updated_at: _droppedUpdatedAt, ...proposalPayload } = payload;
        await applyProposalWrite(itemWriter, proposalPayload, {
          id: entryId,
          isCreate: wasCreate,
          silent: opts.silent,
          submitNow: proposalContext?.submitNow,
        });
        lastLoadedFormRef.current = JSON.stringify(formDataRef.current ?? formData);
        if (wasCreate && !opts.silent && editingIdRef.current === entryIdAtStart) {
          setEditingId(entryId);
        }
      } else {
        await upsertItem(entryId, {
          ...payload,
          created_at: formData.createdAt || new Date().toISOString(),
        });
        if (!opts.silent) toast.success(`Item ${entryIdAtStart ? 'updated' : 'created'}`);
        await refreshEntries();
        if (!opts.silent) resetForm();
      }
    } catch (error) {
      console.error('[ItemsEditor] failed to save:', error);
      if (!opts.silent) toast.error('Failed to save item');
      reportClientError(
        error,
        editingId ? OperationType.UPDATE : OperationType.CREATE,
        `items/${editingId || '(new)'}`,
      );
      if (opts.silent) throw error;
    } finally {
      if (!opts.silent) setSaving(false);
    }
  };

  const handleSaveRef = useRef(handleSave);
  useEffect(() => { handleSaveRef.current = handleSave; });
  useEffect(() => { formDataRef.current = formData; }, [formData]);

  useProposalPreFlushSave({
    enabled: isProposalMode,
    proposalContext,
    handleSave,
    shouldRun: () => {
      if (!editingIdRef.current) return false;
      const currentSerialized = JSON.stringify(formDataRef.current ?? formData);
      return currentSerialized !== lastLoadedFormRef.current;
    },
    onError: (err) => console.error('[ItemsEditor] pre-flush stage failed:', err),
  });

  const handleDelete = async () => {
    if (!editingId) return;
    if (!window.confirm('Delete this item?')) return;
    try {
      if (isProposalMode) {
        await itemWriter.remove(editingId);
        toast.success(actionLabel(itemWriter.mode, 'deleted'));
        resetForm();
      } else {
        await deleteItem(editingId);
        toast.success('Item deleted');
        await refreshEntries();
        resetForm();
      }
    } catch (error) {
      console.error('[ItemsEditor] failed to delete:', error);
      toast.error('Failed to delete item');
      reportClientError(error, OperationType.DELETE, `items/${editingId}`);
    }
  };

  // ── Filter pipeline ───────────────────────────────────────────
  // Search + each axis ANDed together. Axis filters delegate to
  // matchesSingleAxisFilter / matchesMultiAxisFilter from spellFilters
  // — same machinery the public ItemList page and SpellsEditor use.
  const filteredEntries = useMemo(() => {
    const lowered = search.trim().toLowerCase();
    return entries.filter((entry) => {
      if (lowered) {
        const sourceAbbrev = String(sourceAbbrevById[entry.sourceId] || '').toLowerCase();
        const hit = String(entry.name || '').toLowerCase().includes(lowered)
          || String(entry.identifier || '').toLowerCase().includes(lowered)
          || String(entry.itemType || '').toLowerCase().includes(lowered)
          // Subtype slug so "wondrous" finds the consumable AND the
          // equipment wondrous items (both carry type_subtype = 'wondrous').
          || String(entry.type_subtype || '').toLowerCase().includes(lowered)
          || sourceAbbrev.includes(lowered);
        if (!hit) return false;
      }
      if (!matchesSingleAxisFilter(String(entry.itemType ?? ''), axisFilters.itemType)) return false;
      if (!matchesSingleAxisFilter(String(entry.rarity ?? 'none'), axisFilters.rarity)) return false;
      if (!matchesSingleAxisFilter(String(entry.sourceId ?? ''), axisFilters.source)) return false;
      if (!matchesSingleAxisFilter(String(entry.weaponCategoryId ?? ''), axisFilters.weaponCategory)) return false;
      if (!matchesSingleAxisFilter(String(entry.armorCategoryId ?? ''), axisFilters.armorCategory)) return false;
      if (!matchesSingleAxisFilter(String(entry.toolCategoryId ?? ''), axisFilters.toolCategory)) return false;
      if (!matchesMultiAxisFilter(entry.damageTypeSet || new Set<string>(), axisFilters.damageType)) return false;
      const propsHave = new Set<string>();
      if (entry.magicalFlag) propsHave.add('magical');
      if (entry.attunementFlag) propsHave.add('attunement');
      if (!matchesMultiAxisFilter(propsHave, axisFilters.property)) return false;
      return true;
    });
  }, [entries, search, sourceAbbrevById, axisFilters]);

  // ── Filter axes (drives the modal body) ──────────────────────
  // Hardcoded enums for axes whose vocab is fixed by Foundry/dnd5e
  // (item type, rarity, armor/tool subtype, damage type, property
  // flags). DB-loaded for weapon category since admins can extend it
  // with homebrew categories.
  const filterAxes = useMemo<FilterSection[]>(() => ([
    {
      key: 'itemType', name: 'Item Type', kind: 'axis',
      values: ITEM_TYPES.map(([value, label]) => ({ value, label })),
    },
    {
      key: 'rarity', name: 'Rarity', kind: 'axis',
      values: RARITIES.map(([value, label]) => ({ value, label })),
    },
    {
      key: 'weaponCategory', name: 'Weapon Category', kind: 'axis',
      values: weaponCategories.map((c) => ({ value: c.id, label: c.name })),
    },
    {
      key: 'armorCategory', name: 'Armor / Equipment Subtype', kind: 'axis',
      values: EQUIPMENT_SUBTYPES.map(([value, label]) => ({ value, label })),
    },
    {
      key: 'toolCategory', name: 'Tool Category', kind: 'axis',
      values: TOOL_SUBTYPES.map(([value, label]) => ({ value, label })),
    },
    {
      key: 'damageType', name: 'Damage Type', kind: 'axis',
      values: DAMAGE_TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
    },
    {
      key: 'source', name: 'Sources', kind: 'axis',
      values: sources.map((s) => ({
        value: s.id,
        label: String(s.abbreviation || s.shortName || s.name || s.id),
        labelAlt: String(s.name || s.shortName || s.abbreviation || s.id),
      })),
    },
    {
      key: 'property', name: 'Properties', kind: 'axis',
      values: ITEM_PROPERTY_AXIS.map((v) => ({ ...v })),
    },
  ]), [sources, weaponCategories]);

  // ── Identity subtitle ─────────────────────────────────────────
  const identitySubtitle = (() => {
    const typeLabel = ITEM_TYPE_LABEL[formData.itemType] || formData.itemType || 'Loot';
    const subParts: string[] = [typeLabel];
    if (formData.typeSubtype) {
      const subOpts = getSubtypeOptions(formData.itemType);
      const subLabel = subOpts?.find(([v]) => v === formData.typeSubtype)?.[1];
      if (subLabel) subParts.push(subLabel);
    }
    if (formData.rarity && formData.rarity !== 'none') {
      subParts.push(RARITIES.find(([v]) => v === formData.rarity)?.[1] || formData.rarity);
    }
    if (formData.attunement === 'required') subParts.push('attunement');
    return subParts.join(' · ');
  })();

  // ── Editor sub-tabs ───────────────────────────────────────────
  const editorSubTabs: EditorSubTab[] = useMemo(() => {
    const isContainer = (formData.itemType || 'loot') === 'container';
    const tabs: EditorSubTab[] = [
    {
      key: 'basics',
      label: 'Basics',
      layout: 'fill',
      render: () => (
        <BasicsTab
          formData={formData}
          setFormData={setFormData}
          sources={sources}
          editingId={editingId}
        />
      ),
    },
    {
      key: 'mechanics',
      label: 'Details',
      layout: 'scroll',
      render: () => (
        <MechanicsTab
          formData={formData}
          setFormData={setFormData}
          profs={profs}
        />
      ),
    },
    ];

    // Containers are Foundry-special: Details + Contents only — no
    // activities, effects, advancement, or scaling.
    if (isContainer) {
      tabs.push({
        key: 'contents',
        label: 'Contents',
        layout: 'scroll',
        render: () => (
          <ContainerContents
            formData={formData}
            setFormData={setFormData}
            containerId={editingId}
            itemCatalog={entries}
          />
        ),
      });
      return tabs;
    }

    tabs.push(
    {
      key: 'activities',
      label: 'Activities',
      render: () => (
        <div className="border-t border-gold/15 pt-4">
          <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-gold mb-2">Activities</h3>
          <ActivityEditor
            activities={formData.activities}
            onChange={(activities) => setFormData((prev) => ({ ...prev, activities }))}
            availableEffects={formData.effects}
            context="feat"
          />
        </div>
      ),
    },
    {
      // Phase C — items as bump authors. Mounts the same
      // AdvancementManager classes / subclasses / feats use,
      // with the item's own scaling columns + the global feat
      // and feature catalogs passed through so the ItemBumpUses
      // target picker resolves. We pass `parentContext="feat"`
      // because items behave like feats for runtime gating:
      // they're "always on while owned" by default and don't
      // surface HitPoints / Size in the type menu.
      key: 'advancement',
      label: 'Advancement',
      render: () => (
        <div className="border-t border-gold/15 pt-4 space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-gold">Advancement</h3>
            <span className="text-[10px] text-ink/45 italic">
              Default level <span className="font-mono">0</span> = always-on while item is owned.
              Use Bump Uses to add charges to a target feature or feat — Amulet of the Devout
              adds +1 to Channel Divinity, etc.
            </span>
          </div>
          <AdvancementManager
            advancements={formData.advancements}
            onChange={(advancements) => setFormData((prev) => ({ ...prev, advancements }))}
            parentContext="feat"
            availableScalingColumns={[...scalingColumns, ...scalingColumnDraftOptions]}
            availableFeats={[...availableFeats, ...featDraftOptions]}
            availableFeatures={[...availableFeatures, ...featureDraftOptions]}
            availableOptionGroups={[]}
            availableOptionItems={[]}
            defaultLevel={0}
            referenceContext={{
              classLabel: formData.name || 'Item',
              classIdentifier: formData.identifier || slugify(formData.name || 'item'),
            }}
            referenceSheetTitle="Item Reference Sheet"
          />
        </div>
      ),
    },
    {
      key: 'scaling',
      label: 'Scaling',
      render: () => (
        <div className="border-t border-gold/15 pt-4 space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-gold">Item Columns</h3>
            <span className="text-[10px] text-ink/45 italic">
              Per-level progression tables this item owns. Activity formulas
              can reference them as <span className="font-mono">@scale.&lt;identifier&gt;.&lt;column&gt;</span>
              — e.g. Amulet of the Devout adding +1 to Channel Divinity charges.
            </span>
          </div>
          {editingId ? (
            <ScalingColumnsPanel
              parentId={editingId}
              parentType="item"
              columns={scalingColumns}
              onColumnsChanged={() => setScalingLoadTick((t) => t + 1)}
              userProfile={userProfile}
              label="Item Columns"
            />
          ) : (
            // Same placeholder pattern FeatsEditor uses for unsaved
            // drafts — columns FK against parent_id, so the panel
            // can't appear until the item has a stable id.
            <div className="p-4 border border-gold/15 bg-card/30 rounded-xl space-y-2">
              <p className="text-[11px] text-ink/55 italic leading-relaxed">
                Save this item first to add scaling columns. Columns appear
                here once the row has a stable id to attach to.
              </p>
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'effects',
      label: 'Effects',
      render: () => (
        <div className="border-t border-gold/15 pt-4">
          <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-gold mb-2">Active Effects</h3>
          <ActiveEffectEditor
            effects={formData.effects}
            onChange={(effects) => setFormData((prev) => ({ ...prev, effects }))}
            defaultImg={formData.imageUrl || null}
          />
        </div>
      ),
    },
    );
    return tabs;
  }, [formData, sources, profs, editingId, entries, scalingColumns, availableFeats, availableFeatures]);

  const tagsSubTabsList: TagsSubTab[] = useMemo(() => [
    {
      key: 'tags',
      label: (
        <>
          Tags {formData.tagIds.length > 0 && (
            <span className="ml-1 text-gold/75">({formData.tagIds.length})</span>
          )}
        </>
      ),
      render: () => (
        <TagPicker
          tags={tags}
          tagGroups={tagGroups}
          selectedIds={formData.tagIds}
          onChange={(next) => setFormData((prev) => ({ ...prev, tagIds: next }))}
          hint="Tag rules + class spell list rules use these to decide which items they include."
          emptyHint="No tags loaded yet."
        />
      ),
    },
  ], [tags, tagGroups, formData.tagIds]);

  // ── List columns ──────────────────────────────────────────────
  const listColumns: EditorListColumn<any>[] = useMemo(() => [
    {
      key: 'name',
      label: 'Name',
      width: 'minmax(0,1fr)',
      align: 'start',
      render: (entry: any) => {
        if (entry.__pendingDelete) {
          return (
            <span className="truncate font-serif text-sm line-through text-blood/70">
              {entry.name || 'Untitled Item'}
            </span>
          );
        }
        const drafted = focusModeEnabled && draftedItemIds.has(String(entry.id));
        return (
          <span className={cn(
            'truncate font-serif text-sm',
            drafted ? 'text-archive-blue font-semibold' : 'text-ink',
          )}>
            {entry.name || <em className="text-ink/45">Untitled</em>}
          </span>
        );
      },
    },
    {
      key: 'type',
      label: 'Type',
      width: '90px',
      align: 'center',
      render: (entry: any) => (
        <span className="text-[10px] uppercase tracking-widest text-ink/65 truncate">
          {ITEM_TYPE_LABEL[String(entry.itemType || entry.item_type || 'loot')] || entry.itemType}
        </span>
      ),
    },
    {
      key: 'source',
      label: 'Src',
      width: '50px',
      align: 'center',
      render: (entry: any) => (
        <span className="text-[10px] font-bold text-gold/85">
          {sourceAbbrevById[entry.sourceId] || '—'}
        </span>
      ),
    },
  ], [sourceAbbrevById, focusModeEnabled, draftedItemIds]);

  // ── Empty-state copy ──────────────────────────────────────────
  const listEmptyContent = useMemo(() => {
    if (focusModeEnabled && focusMode === 'drafts') {
      return (
        <div className="px-6 py-12 text-center text-ink/65 max-w-sm mx-auto space-y-2">
          <p className="font-bold text-ink/85">No items in this block yet.</p>
          <p className="text-xs leading-relaxed text-ink/55">
            Click <span className="font-bold text-gold">New Item</span> above to author
            one from scratch, or switch to <span className="font-bold text-gold">Full Catalog</span>
            {' '}and open an existing item to propose changes.
          </p>
        </div>
      );
    }
    return 'No items match the current search.';
  }, [focusModeEnabled, focusMode]);

  // ── Mode tabs ─────────────────────────────────────────────────
  const modes: EditorMode[] = [
    ...(isAdmin ? [{
      key: 'foundry-import',
      label: 'Foundry Import',
      adminOnly: true,
      render: <ItemImportWorkbench userProfile={userProfile} />,
    } as EditorMode] : []),
    {
      key: 'manual-editor',
      label: 'Manual Editor',
      render: null,
    },
  ];

  if (!canManage) {
    return <div className="text-center py-20">Access Denied. Admins or content-creators only.</div>;
  }

  const cascadeBanner = cascadeDep ? (
    <CascadeDependentBanner
      description={cascadeDep.description}
      resolved={cascadeDep.resolved}
      onAccept={cascadeDep.accept}
      onReopen={cascadeDep.reopen}
      onReplace={() => setReplaceTagPickerOpen(true)}
    />
  ) : null;

  const handleListSelect = (id: string) => {
    const entry = filteredEntries.find((e) => String(e.id) === id);
    if (entry?.__pendingDelete) return;
    void startEditing(id);
  };

  // `isReadOnly` already comes from useEditBaseUnlocks — no need to
  // recompute. `unlockedBaseIds` mirrors FeatsEditor's draft-overlay
  // wiring; available for future "my work vs full catalog" filtering
  // (not used directly today since items don't have that toggle yet).
  void unlockedBaseIds;

  return (
    <>
      <CompendiumEditorShell<any>
        entityName={{ singular: 'Item', plural: 'Items' }}
        backPath={backPath}
        backLabel={backLabel}
        modes={modes}
        defaultModeKey="manual-editor"
        manualEditorModeKey="manual-editor"
        isAdmin={isAdmin}
        listRows={filteredEntries}
        listColumns={listColumns}
        listRowHeight={36}
        loading={loading}
        selectedId={editingId}
        onSelect={handleListSelect}
        onNew={resetForm}
        getRowId={(row) => String(row.id)}
        emptyListMessage={listEmptyContent}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search item name, type, source, or identifier"
        activeFilterCount={activeFilterCount}
        isFilterOpen={isFilterOpen}
        setIsFilterOpen={setIsFilterOpen}
        resetFilters={() => { setSearch(''); resetAxisFilters(); }}
        renderFilters={
          <SectionFilterPanel
            axes={filterAxes}
            axisFilters={axisFilters}
            tagStates={EMPTY_TAG_STATES}
            setTagStates={NOOP_SET_TAG_STATES}
            cycleAxisState={cyclers.cycleAxisState}
            cycleAxisStateReverse={cyclers.cycleAxisStateReverse}
            cycleTagState={NOOP_CYCLE_TAG}
            cycleTagStateReverse={NOOP_CYCLE_TAG}
            cycleAxisCombineMode={cyclers.cycleAxisCombineMode}
            cycleAxisCombineModeReverse={cyclers.cycleAxisCombineModeReverse}
            cycleAxisExclusionMode={cyclers.cycleAxisExclusionMode}
            cycleAxisExclusionModeReverse={cyclers.cycleAxisExclusionModeReverse}
            axisIncludeAll={cyclers.axisIncludeAll}
            axisExcludeAll={cyclers.axisExcludeAll}
            axisClear={cyclers.axisClear}
            search={search}
            setSearch={setSearch}
            searchPlaceholder="Search item name, type, source, or identifier"
            activeFilterCount={activeFilterCount}
            resetAll={() => { setSearch(''); resetAxisFilters(); }}
            embedded
          />
        }
        filterTitle="Filter Items"
        identityName={formData.name}
        identitySourceAbbrev={formData.sourceId ? String(sourceAbbrevById[formData.sourceId] || formData.sourceId) : undefined}
        identitySourceFullName={formData.sourceId ? String(sourceNameById[formData.sourceId] || formData.sourceId) : undefined}
        identitySubtitle={identitySubtitle}
        headerActionsLeading={
          <FieldSelect
            value={formData.itemType || 'loot'}
            onChange={(val) => setFormData((prev) => ({ ...prev, itemType: val, typeSubtype: '', typeInnerSubtype: '' }))}
            options={ITEM_TYPES}
            triggerClassName="w-44"
          />
        }
        onSave={(e) => void handleSave(e)}
        onDelete={editingId && !isProposalMode ? handleDelete : undefined}
        onReset={resetForm}
        saving={saving}
        formId="item-manual-editor-form"
        isReadOnly={isReadOnly}
        onUnlockBase={editingId ? () => unlockBaseItem(editingId) : undefined}
        cascadeBanner={cascadeBanner}
        proposalMode={!!proposalContext}
        editorSubTabs={editorSubTabs}
        tagsSubTabs={tagsSubTabsList}
        tagsSuperTabCount={formData.tagIds.length}
        renderPreview={(id) => {
          // The preview pane shows the LIVE form contents — feeds
          // formData straight into ItemDetailPanel rather than the
          // last-saved row. That way authors see the panel update as
          // they edit. The shape is camelCase from formData; the panel
          // tolerates both snake and camel so it Just Works.
          if (!id && !formData.name) {
            return (
              <div className="px-6 py-12 text-center text-ink/55">
                Select or create an item to preview it here.
              </div>
            );
          }
          const source = formData.sourceId
            ? sources.find((s) => s.id === formData.sourceId)
            : undefined;
          return (
            <ItemDetailPanel
              row={formData as any}
              source={source}
            />
          );
        }}
      />
      {cascadeDep && cascadeDep.parentEntityType === 'tag' && cascadeDep.parentEntityId && (
        <TagReplacementPicker
          open={replaceTagPickerOpen}
          onOpenChange={setReplaceTagPickerOpen}
          deletedTagId={cascadeDep.parentEntityId}
          onPicked={async (replacementTagId) => {
            try {
              await cascadeDep.replace(
                cascadeDep.parentEntityId!,
                replacementTagId,
                'tags',
              );
              toast.success('Replacement saved.');
            } catch (err: any) {
              toast.error(err?.message || 'Could not replace tag.');
            }
          }}
        />
      )}
    </>
  );
}

// ─── Description fields + focused editor window ────────────────────
//
// Foundry's item Description tab carries three rich-text blocks:
// Description, Unidentified Description, Chat Description. On Basics we
// show them as compact rows; clicking one opens a focused full-window
// editor (with a Back button) so there's real room to write.
const DESCRIPTION_FIELDS: {
  key: 'description' | 'unidentified' | 'chat';
  label: string;
  hint?: string;
  field: 'description' | 'unidentifiedDescription' | 'chatDescription';
}[] = [
  { key: 'description', label: 'Description', field: 'description' },
  {
    key: 'unidentified',
    label: 'Unidentified Description',
    hint: 'Shown to players before the item is identified. Optional.',
    field: 'unidentifiedDescription',
  },
  {
    key: 'chat',
    label: 'Chat Description',
    hint: 'Shown in the chat card when the item is used. Optional.',
    field: 'chatDescription',
  },
];

// Site-standard dropdown: the shared base-ui Select, styled to match
// the form inputs (height / background / gold border) so dropdowns and
// text inputs read as one consistent family instead of a mix of
// controls. Takes the same `[value, label][]` option shape as the
// vocabulary constants above.
function FieldSelect({
  value,
  onChange,
  options,
  placeholder,
  triggerClassName,
}: {
  value: string;
  onChange: (next: string) => void;
  options: [string, string][];
  placeholder?: string;
  triggerClassName?: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => { if (v == null) return; onChange(String(v)); }}>
      <SelectTrigger
        className={cn(
          'rounded-md border-gold/15 bg-background/50 text-sm dark:bg-background/50 focus-visible:border-gold focus-visible:ring-0',
          triggerClassName,
        )}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map(([v, l]) => (
          <SelectItem key={v} value={v}>{l}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ─── Basics tab ───────────────────────────────────────────────────
//
// Identity + physical fields, then the three description blocks. The
// Item Type discriminator lives in the editor header (top-right, beside
// Save) via `headerActionsLeading`. Identifier auto-derives from name.

function BasicsTab({
  formData,
  setFormData,
  sources,
  editingId,
}: {
  formData: ItemFormData;
  setFormData: React.Dispatch<React.SetStateAction<ItemFormData>>;
  sources: any[];
  editingId: string | null;
}) {
  const [editingDesc, setEditingDesc] = useState<null | 'description' | 'unidentified' | 'chat'>(null);
  const editingMeta = editingDesc ? DESCRIPTION_FIELDS.find((d) => d.key === editingDesc) : null;

  // Esc returns from the focused description editor to the field list.
  useEffect(() => {
    if (!editingDesc) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setEditingDesc(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editingDesc]);

  // Focused full-pane editor for one description — replaces the field
  // list (same dark, fill-height experience as the feature editor).
  if (editingMeta) {
    return (
      <div className="flex flex-1 min-h-0 flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-gold/15 pb-2">
          <button
            type="button"
            onClick={() => setEditingDesc(null)}
            className="flex items-center gap-1 text-sm font-medium text-gold transition-colors hover:text-gold/80"
          >
            <ChevronLeft className="h-4 w-4" /> Back
          </button>
          <span className="text-[11px] font-bold uppercase tracking-widest text-ink/65">{editingMeta.label}</span>
          {editingMeta.hint ? (
            <span className="text-[11px] italic text-ink/40">{editingMeta.hint}</span>
          ) : null}
        </div>
        <div className="mt-2 flex min-h-0 flex-1 flex-col">
          <MarkdownEditor
            value={String(formData[editingMeta.field] || '')}
            onChange={(v) => setFormData((prev) => ({ ...prev, [editingMeta.field]: v }))}
            fillContainer
            className="flex-1 min-h-0"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Type discriminator — distinctly styled to signal it drives
          the Mechanics tab. */}
      {/* Identity row — image + name/identifier/source/page. */}
      <div className="grid gap-3 md:grid-cols-[80px_minmax(0,1fr)] shrink-0">
        <ImageUpload
          currentImageUrl={formData.imageUrl}
          storagePath={`images/items/${editingId || 'draft'}/`}
          onUpload={(url) => setFormData((prev) => ({ ...prev, imageUrl: url }))}
          imageType="icon"
          compact
          className="h-[80px] w-[80px]"
        />
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
          <ReviewFieldHighlight columnKey="name" className="space-y-0.5">
            <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/45">Name</Label>
            <Input
              value={formData.name}
              onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
              className="h-8 bg-background/50 border-gold/15 focus:border-gold text-sm"
              placeholder="e.g. Flame Tongue Greatsword"
              required
            />
          </ReviewFieldHighlight>
          <ReviewFieldHighlight columnKey="identifier" className="space-y-0.5">
            <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/45">Identifier</Label>
            <Input
              value={formData.identifier}
              onChange={(e) => setFormData((prev) => ({ ...prev, identifier: e.target.value }))}
              className="h-8 bg-background/50 border-gold/15 focus:border-gold font-mono text-sm"
              placeholder={slugify(formData.name || 'item')}
            />
          </ReviewFieldHighlight>
          <ReviewFieldHighlight columnKey="source_id" className="space-y-0.5">
            <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/45">Source</Label>
            <FieldSelect
              value={formData.sourceId}
              onChange={(val) => setFormData((prev) => ({ ...prev, sourceId: val }))}
              options={sources.map((source): [string, string] => [String(source.id), String(source.name)])}
              placeholder="Select a source"
              triggerClassName="w-full"
            />
          </ReviewFieldHighlight>
          <ReviewFieldHighlight columnKey="page" className="space-y-0.5">
            <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/45">Page</Label>
            <Input
              value={formData.page}
              onChange={(e) => setFormData((prev) => ({ ...prev, page: e.target.value }))}
              className="h-8 bg-background/50 border-gold/15 focus:border-gold text-sm"
              placeholder="207"
            />
          </ReviewFieldHighlight>
        </div>
      </div>

      {/* Physical grid — rarity / quantity / weight / price. (Magical
          moved to each type's Details properties.) */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        <div className="space-y-0.5">
          <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/45">Rarity</Label>
          <FieldSelect
            value={formData.rarity || 'none'}
            onChange={(val) => setFormData((prev) => ({ ...prev, rarity: val }))}
            options={RARITIES}
            triggerClassName="w-full"
          />
        </div>
        <div className="space-y-0.5">
          <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/45">Quantity</Label>
          <Input
            type="number"
            min={0}
            value={formData.quantity ?? 1}
            onChange={(e) => setFormData((prev) => ({
              ...prev,
              quantity: parseInt(e.target.value || '0', 10) || 0,
            }))}
            className="h-8 bg-background/50 border-gold/15 focus:border-gold text-sm"
          />
        </div>
        <div className="space-y-0.5">
          <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/45">Weight</Label>
          <div className="flex gap-1">
            <Input
              type="number"
              step="0.1"
              value={formData.weight?.value ?? 0}
              onChange={(e) => setFormData((prev) => ({
                ...prev,
                weight: { value: parseFloat(e.target.value) || 0, units: prev.weight?.units || 'lb' },
              }))}
              className="h-8 bg-background/50 border-gold/15 focus:border-gold text-sm flex-1"
            />
            <FieldSelect
              value={formData.weight?.units || 'lb'}
              onChange={(val) => setFormData((prev) => ({
                ...prev,
                weight: { value: prev.weight?.value ?? 0, units: val },
              }))}
              options={WEIGHT_UNITS}
              triggerClassName="w-16 shrink-0"
            />
          </div>
        </div>
        <div className="space-y-0.5">
          <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/45">Price</Label>
          <div className="flex gap-1">
            <Input
              type="number"
              step="1"
              value={formData.price?.value ?? 0}
              onChange={(e) => setFormData((prev) => ({
                ...prev,
                price: { value: parseFloat(e.target.value) || 0, denomination: prev.price?.denomination || 'gp' },
              }))}
              className="h-8 bg-background/50 border-gold/15 focus:border-gold text-sm flex-1"
            />
            <FieldSelect
              value={formData.price?.denomination || 'gp'}
              onChange={(val) => setFormData((prev) => ({
                ...prev,
                price: { value: prev.price?.value ?? 0, denomination: val },
              }))}
              options={DENOMINATIONS}
              triggerClassName="w-16 shrink-0"
            />
          </div>
        </div>
      </div>

      {/* Descriptions — each row opens a focused full-window editor. */}
      <div className="space-y-2">
        {DESCRIPTION_FIELDS.map(({ key, label, field }) => {
          const filled = String(formData[field] || '').trim().length > 0;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setEditingDesc(key)}
              className="w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-md border border-gold/15 bg-background/30 hover:bg-gold/5 hover:border-gold/30 transition-colors text-left"
            >
              <span className="text-[11px] font-bold uppercase tracking-widest text-ink/65">{label}</span>
              <span className="flex items-center gap-2 shrink-0">
                <span className="text-[10px] italic text-ink/35">{filled ? 'Edit' : 'Empty'}</span>
                <Pencil className="w-3.5 h-3.5 text-gold/60" />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Mechanics tab ────────────────────────────────────────────────
//
// Item-type-driven body. Shared sections (equippability, properties,
// uses) sit alongside the per-type sub-form chosen via the Item Type
// dropdown on Basics. Loot suppresses everything except the subtype
// note since loot rows don't carry mechanical state.

function MechanicsTab({
  formData,
  setFormData,
  profs,
}: {
  formData: ItemFormData;
  setFormData: React.Dispatch<React.SetStateAction<ItemFormData>>;
  profs: ProficiencyBucket;
}) {
  const itemType = formData.itemType || 'loot';

  // Per-type Foundry-faithful Details layouts, built one type at a time.
  // Consumable is done; the other types fall through to the generic
  // layout below until each is rebuilt.
  if (itemType === 'consumable') {
    return <ConsumableDetails formData={formData} setFormData={setFormData} profs={profs} />;
  }
  if (itemType === 'container') {
    return <ContainerDetails formData={formData} setFormData={setFormData} profs={profs} />;
  }

  return (
    <div className="space-y-4 pt-4 border-t border-gold/15">
      {/* Base-item FK dropdown for shapes that have one. */}
      {itemType === 'weapon' && (
        <BaseItemSection
          label="Base Weapon"
          hint="Links to a row in the weapons proficiency table for character-sheet proficiency resolution."
          options={profs.weapons}
          value={formData.baseWeaponId || ''}
          onChange={(id) => setFormData((prev) => ({
            ...prev,
            baseWeaponId: id,
            baseArmorId: '',
            baseToolId: '',
            baseItem: profs.weapons.find((w) => w.id === id)?.identifier || prev.baseItem,
          }))}
        />
      )}
      {itemType === 'equipment' && EQUIPMENT_ARMOR_SUBTYPES.has(formData.typeSubtype) && (
        <BaseItemSection
          label="Base Armor"
          hint="Links to a row in the armor proficiency table."
          options={profs.armor}
          value={formData.baseArmorId || ''}
          onChange={(id) => setFormData((prev) => ({
            ...prev,
            baseArmorId: id,
            baseWeaponId: '',
            baseToolId: '',
            baseItem: profs.armor.find((a) => a.id === id)?.identifier || prev.baseItem,
          }))}
        />
      )}
      {itemType === 'tool' && (
        <BaseItemSection
          label="Base Tool"
          hint="Links to a row in the tools proficiency table."
          options={profs.tools}
          value={formData.baseToolId || ''}
          onChange={(id) => setFormData((prev) => ({
            ...prev,
            baseToolId: id,
            baseWeaponId: '',
            baseArmorId: '',
            baseItem: profs.tools.find((t) => t.id === id)?.identifier || prev.baseItem,
          }))}
        />
      )}

      {/* Equippability — hidden for loot (which is character-side
          treasure with no equip slot). */}
      {itemType !== 'loot' && (
        <EquippabilitySection formData={formData} setFormData={setFormData} />
      )}

      {/* Properties — hidden for loot. */}
      {itemType !== 'loot' && (
        <PropertiesSection formData={formData} setFormData={setFormData} profs={profs} />
      )}

      {/* Uses block — every shape except loot + container surfaces it.
          showAutoDestroy gates to consumables (the only shape that
          self-destructs on empty). */}
      {itemType !== 'loot' && itemType !== 'container' && (
        <ItemUsesField
          uses={formData.uses}
          onChange={(next) => setFormData((prev) => ({ ...prev, uses: next as any }))}
          showAutoDestroy={itemType === 'consumable'}
        />
      )}

      {/* Type-specific sub-form. */}
      {itemType === 'weapon' && <WeaponItemFields formData={formData} setFormData={setFormData} />}
      {itemType === 'equipment' && <EquipmentItemFields formData={formData} setFormData={setFormData} />}
      {itemType === 'consumable' && <ConsumableItemFields formData={formData} setFormData={setFormData} />}
      {itemType === 'tool' && <ToolItemFields formData={formData} setFormData={setFormData} profs={profs} />}
      {itemType === 'loot' && (
        <ActivitySection label="LOOT">
          <p className="text-[10px] text-ink/45 py-2">
            Loot rows carry no mechanical state — just the subtype (set on
            Basics) and the standard catalog fields. Use the Activities tab
            if the loot row should trigger anything when added to an
            inventory.
          </p>
        </ActivitySection>
      )}
    </div>
  );
}

// ─── Consumable Details (Foundry dnd5e 5.3.1 consumable sheet) ──────
//
// Two fieldsets mirroring the real sheet: CONSUMABLE DETAILS (type +
// properties) and USAGE (limited uses + destroy-on-empty). Magical,
// attunement, and the ammo-only magical bonus fold into the
// "Consumable Properties" step (built next); equipped/identified are
// dropped (Foundry doesn't surface them for consumables).
function ConsumableDetails({
  formData,
  setFormData,
  profs,
}: {
  formData: ItemFormData;
  setFormData: React.Dispatch<React.SetStateAction<ItemFormData>>;
  profs: ProficiencyBucket;
}) {
  const subtype = formData.typeSubtype || '';
  const isAmmo = subtype === 'ammo';
  const isPoison = subtype === 'poison';

  // Properties available for this consumable: ammo pulls the ammunition
  // set (item_properties whose valid_types includes 'ammo'); every other
  // consumable pulls the 'consumable' set. Both come from the admin-managed
  // item_properties table — same filter the Enchant activity uses.
  // A consumable's properties = item_properties valid for 'consumable'
  // (e.g. Magical) PLUS any valid for this specific subtype slug
  // (ammo → Adamantine / Returning / Silvered; scroll → spell components).
  const propertyCatalog = useMemo(() => {
    const list = Array.isArray(profs.itemProperties) ? profs.itemProperties : [];
    return list
      .filter((p: any) => {
        try {
          const vt = JSON.parse(p.valid_types || '[]');
          return vt.includes('consumable') || (!!subtype && vt.includes(subtype));
        } catch { return false; }
      })
      .map((p: any) => ({ id: String(p.identifier || p.id), name: String(p.name || p.identifier) }));
  }, [profs.itemProperties, subtype]);

  const properties = Array.isArray(formData.properties) ? formData.properties : [];
  const toggleProperty = (slug: string) => setFormData((prev) => {
    const cur = Array.isArray(prev.properties) ? prev.properties : [];
    return { ...prev, properties: cur.includes(slug) ? cur.filter((s) => s !== slug) : [...cur, slug] };
  });

  // Ammo damage rides the items.damage column in Foundry's `system.damage`
  // shape: { base: <DamagePart>, replace: <bool> }.
  const damage = (formData.damage && typeof formData.damage === 'object') ? formData.damage : {};
  const basePart = (damage.base && typeof damage.base === 'object') ? damage.base : {};
  const setDamage = (patch: Record<string, any>) =>
    setFormData((prev) => ({
      ...prev,
      damage: { ...((prev.damage && typeof prev.damage === 'object') ? prev.damage : {}), ...patch },
    }));

  const innerSource = isAmmo ? profs.ammunitionTypes : isPoison ? profs.poisonTypes : [];
  const innerOptions: [string, string][] = (Array.isArray(innerSource) ? innerSource : [])
    .map((r: any): [string, string] => [String(r.identifier || r.id), String(r.name || r.identifier)]);

  return (
    <div className="space-y-4 pt-4 border-t border-gold/15">
      <fieldset className="config-fieldset">
        <legend className="section-label text-gold/60 px-1">Consumable Details</legend>
        <FieldRow label="Consumable Type">
          <FieldSelect
            value={subtype}
            onChange={(val) => setFormData((prev) => ({ ...prev, typeSubtype: val, typeInnerSubtype: '' }))}
            options={CONSUMABLE_SUBTYPES}
            placeholder="— select —"
            triggerClassName="w-full"
          />
        </FieldRow>
        {(isAmmo || isPoison) && (
          <FieldRow label={isAmmo ? 'Ammunition Type' : 'Poison Type'}>
            <FieldSelect
              value={formData.typeInnerSubtype || ''}
              onChange={(val) => setFormData((prev) => ({ ...prev, typeInnerSubtype: val }))}
              options={innerOptions}
              placeholder="— select —"
              triggerClassName="w-full"
            />
          </FieldRow>
        )}
        {/* Properties — full-width checkbox grid (label on top), matching
            Foundry's stacked checkbox-grid rather than a cramped FieldRow. */}
        <div className="py-2 space-y-1.5">
          <p className="text-xs font-semibold text-ink/85 leading-tight">
            {isAmmo ? 'Ammunition Properties' : 'Consumable Properties'}
          </p>
          {propertyCatalog.length === 0 ? (
            <p className="field-hint">No properties for this type.</p>
          ) : (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
              {propertyCatalog.map((p) => (
                <label key={p.id} className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={properties.includes(p.id)}
                    onCheckedChange={() => toggleProperty(p.id)}
                  />
                  <span className="text-xs text-ink/75">{p.name}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </fieldset>

      {isAmmo && (
        <fieldset className="config-fieldset">
          <legend className="section-label text-gold/60 px-1">Ammunition Damage</legend>
          <FieldRow
            label="Replace Weapon Damage"
            hint="Replace the firing weapon's damage with this, rather than adding to it."
            inline
          >
            <Checkbox checked={!!damage.replace} onCheckedChange={(c) => setDamage({ replace: !!c })} />
          </FieldRow>
          <DamagePartEditor
            parts={[basePart]}
            onChange={(next) => setDamage({ base: next[0] || {} })}
            typeOptions={DAMAGE_TYPE_OPTIONS}
            canScale={false}
          />
        </fieldset>
      )}

      {/* Usage — the activity-level uses editor, always shown (a consumable
          always carries uses; there's no "whether to consume" choice like an
          activity's consumption config). */}
      <ItemUsesField
        uses={formData.uses}
        onChange={(next) => setFormData((prev) => ({ ...prev, uses: next as any }))}
        showAutoDestroy
      />
    </div>
  );
}

// ─── Shared sub-sections ──────────────────────────────────────────

function BaseItemSection({
  label,
  hint,
  options,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  options: any[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <ActivitySection label="BASE ITEM">
      <FieldRow label={label} hint={hint}>
        <SingleSelectSearch
          value={value}
          onChange={onChange}
          options={[
            { id: '', name: '— none —' },
            ...options.map((row) => ({ id: row.id, name: row.name || row.identifier })),
          ]}
          placeholder="Select base item..."
          triggerClassName="w-full"
        />
      </FieldRow>
    </ActivitySection>
  );
}

function EquippabilitySection({
  formData,
  setFormData,
}: {
  formData: ItemFormData;
  setFormData: React.Dispatch<React.SetStateAction<ItemFormData>>;
}) {
  return (
    <ActivitySection label="EQUIPABILITY">
      <FieldRow
        label="Attunement"
        hint="Foundry's 3-state vocabulary. 'Required' means the item must be attuned to use any attunement-gated effect."
      >
        <SingleSelectSearch
          value={formData.attunement ?? ''}
          onChange={(val) => setFormData((prev) => ({ ...prev, attunement: val }))}
          options={ATTUNEMENT_OPTIONS.map(([v, l]) => ({ id: v, name: l }))}
          placeholder="None"
          triggerClassName="w-full"
        />
      </FieldRow>
      <FieldRow label="Equipped By Default" inline>
        <Checkbox
          checked={!!formData.equipped}
          onCheckedChange={(checked) => setFormData((prev) => ({ ...prev, equipped: !!checked }))}
        />
      </FieldRow>
      <FieldRow label="Identified By Default" inline>
        <Checkbox
          checked={formData.identified !== false}
          onCheckedChange={(checked) => setFormData((prev) => ({ ...prev, identified: !!checked }))}
        />
      </FieldRow>
    </ActivitySection>
  );
}

function PropertiesSection({
  formData,
  setFormData,
  profs,
}: {
  formData: ItemFormData;
  setFormData: React.Dispatch<React.SetStateAction<ItemFormData>>;
  profs: ProficiencyBucket;
}) {
  const properties: string[] = Array.isArray(formData.properties) ? formData.properties : [];
  const propertyCatalog = useMemo(() => {
    const list = Array.isArray(profs.weaponProperties) ? profs.weaponProperties : [];
    return list.map((row) => ({
      id: row.identifier || row.id,
      name: row.name || row.identifier,
    }));
  }, [profs.weaponProperties]);

  const addProperty = (slug: string) => {
    if (!slug || properties.includes(slug)) return;
    setFormData((prev) => ({ ...prev, properties: [...properties, slug] }));
  };
  const removeProperty = (slug: string) => {
    setFormData((prev) => ({
      ...prev,
      properties: properties.filter((p) => p !== slug),
    }));
  };

  return (
    <ActivitySection label="PROPERTIES">
      <div className="py-2 space-y-2">
        {properties.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {properties.map((slug) => {
              const catEntry = propertyCatalog.find((p) => p.id === slug);
              const label = catEntry?.name || slug;
              return (
                <span
                  key={slug}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] uppercase tracking-widest font-black bg-gold/15 border border-gold/35 text-gold"
                >
                  {label}
                  <button
                    type="button"
                    onClick={() => removeProperty(slug)}
                    className="hover:text-blood transition-colors"
                    aria-label={`Remove ${label}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              );
            })}
          </div>
        )}
        <div className="flex gap-2 items-center">
          <SingleSelectSearch
            value=""
            onChange={(val) => addProperty(val)}
            options={propertyCatalog.filter((p) => !properties.includes(p.id))}
            placeholder="Add property..."
            triggerClassName="flex-1"
          />
          <span className="text-[9px] text-ink/35 italic">
            {properties.length} selected
          </span>
        </div>
        <p className="text-[10px] text-ink/45">
          Foundry-aligned slugs (post-20260526-1700: fin / hvy / lgt / lod / two / ver / thr / rch / amm / spc / sil
          for standards; custom slugs like 'lance' or 'superHeavy' pass through verbatim).
        </p>
      </div>
    </ActivitySection>
  );
}

// ─── Type-specific sub-forms ──────────────────────────────────────

function WeaponItemFields({
  formData,
  setFormData,
}: {
  formData: ItemFormData;
  setFormData: React.Dispatch<React.SetStateAction<ItemFormData>>;
}) {
  const damage = formData.damage || { base: { number: 1, denomination: 6, types: [], bonus: '' } };
  const damageBase = damage.base || { number: 1, denomination: 6, types: [], bonus: '' };
  const range = formData.range || { value: null, long: null, reach: null, units: 'ft' };

  const updateDamageBase = (patch: Record<string, any>) => {
    setFormData((prev) => ({
      ...prev,
      damage: { ...(prev.damage || {}), base: { ...damageBase, ...patch } },
    }));
  };
  const updateRange = (patch: Record<string, any>) => {
    setFormData((prev) => ({ ...prev, range: { ...range, ...patch } }));
  };

  return (
    <>
      <ActivitySection label="WEAPON · DAMAGE">
        <FieldRow label="Dice Count">
          <Input
            type="number"
            min={0}
            value={damageBase.number ?? 1}
            onChange={(e) => updateDamageBase({ number: parseInt(e.target.value || '0', 10) || 0 })}
            className="bg-background/50 border-gold/15"
          />
        </FieldRow>
        <FieldRow label="Die Size">
          <SingleSelectSearch
            value={String(damageBase.denomination ?? 6)}
            onChange={(val) => updateDamageBase({ denomination: parseInt(val, 10) || 6 })}
            options={DAMAGE_DIE_DENOMINATIONS.map((d) => ({ id: String(d), name: `d${d}` }))}
            triggerClassName="w-full"
          />
        </FieldRow>
        <FieldRow label="Damage Type" hint="First listed type is the canonical one.">
          <SingleSelectSearch
            value={(damageBase.types && damageBase.types[0]) || ''}
            onChange={(val) => updateDamageBase({ types: val ? [val] : [] })}
            options={[
              { id: '', name: '— none —' },
              ...DAMAGE_TYPE_OPTIONS.map((o) => ({ id: o.value, name: o.label })),
            ]}
            triggerClassName="w-full"
          />
        </FieldRow>
        <FieldRow label="Bonus Formula" hint="Adds to the rolled damage. e.g. '@mod' or '1d4'.">
          <Input
            value={damageBase.bonus ?? ''}
            onChange={(e) => updateDamageBase({ bonus: e.target.value })}
            className="bg-background/50 border-gold/15 text-xs font-mono"
            placeholder="@mod"
          />
        </FieldRow>
        <FieldRow label="Magical Bonus" hint="Flat int added to attack + damage. e.g. 1 for a Flame Tongue.">
          <Input
            type="number"
            value={formData.magicalBonus ?? 0}
            onChange={(e) => setFormData((prev) => ({
              ...prev,
              magicalBonus: parseInt(e.target.value || '0', 10) || 0,
            }))}
            className="bg-background/50 border-gold/15"
          />
        </FieldRow>
      </ActivitySection>

      <ActivitySection label="WEAPON · RANGE">
        <FieldRow label="Normal Range" hint="Feet (or units below). Blank for melee with no thrown property.">
          <Input
            type="number"
            value={range.value ?? ''}
            onChange={(e) => updateRange({ value: e.target.value === '' ? null : parseInt(e.target.value, 10) })}
            className="bg-background/50 border-gold/15"
            placeholder="—"
          />
        </FieldRow>
        <FieldRow label="Long Range" hint="Disadvantage past normal, up to long.">
          <Input
            type="number"
            value={range.long ?? ''}
            onChange={(e) => updateRange({ long: e.target.value === '' ? null : parseInt(e.target.value, 10) })}
            className="bg-background/50 border-gold/15"
            placeholder="—"
          />
        </FieldRow>
        <FieldRow label="Reach" hint="Melee reach in feet. Blank uses the default 5'.">
          <Input
            type="number"
            value={range.reach ?? ''}
            onChange={(e) => updateRange({ reach: e.target.value === '' ? null : parseInt(e.target.value, 10) })}
            className="bg-background/50 border-gold/15"
            placeholder="5"
          />
        </FieldRow>
        <FieldRow label="Range Units">
          <SingleSelectSearch
            value={range.units || 'ft'}
            onChange={(val) => updateRange({ units: val })}
            options={WEAPON_RANGE_UNITS.map(([v, l]) => ({ id: v, name: l }))}
            triggerClassName="w-full"
          />
        </FieldRow>
      </ActivitySection>
    </>
  );
}

function EquipmentItemFields({
  formData,
  setFormData,
}: {
  formData: ItemFormData;
  setFormData: React.Dispatch<React.SetStateAction<ItemFormData>>;
}) {
  const subtype = formData.typeSubtype || '';
  const isArmor = EQUIPMENT_ARMOR_SUBTYPES.has(subtype);

  if (!isArmor) {
    return (
      <ActivitySection label="EQUIPMENT">
        <p className="text-[10px] text-ink/45 py-2">
          Worn gear — no armor stats. Use the Properties section above for any
          item-shape flags (mgc / concentration / custom homebrew slugs).
        </p>
      </ActivitySection>
    );
  }

  return (
    <ActivitySection label="ARMOR">
      <FieldRow label="Armor Class" hint="Base AC. The character sheet adds Dex + magicalBonus.">
        <Input
          type="number"
          value={formData.armorValue ?? 10}
          onChange={(e) => setFormData((prev) => ({
            ...prev,
            armorValue: parseInt(e.target.value || '0', 10) || 0,
          }))}
          className="bg-background/50 border-gold/15"
        />
      </FieldRow>
      <FieldRow label="Dex Max" hint="Maximum Dex bonus allowed. Blank = unlimited (light); 2 = medium; 0 = heavy.">
        <Input
          type="number"
          value={formData.armorDex ?? ''}
          onChange={(e) => setFormData((prev) => ({
            ...prev,
            armorDex: e.target.value === '' ? null : parseInt(e.target.value, 10),
          }))}
          className="bg-background/50 border-gold/15"
          placeholder="—"
        />
      </FieldRow>
      <FieldRow label="Magical Bonus" hint="Flat int added to AC. e.g. 1 for +1 plate.">
        <Input
          type="number"
          value={formData.armorMagicalBonus ?? 0}
          onChange={(e) => setFormData((prev) => ({
            ...prev,
            armorMagicalBonus: parseInt(e.target.value || '0', 10) || 0,
          }))}
          className="bg-background/50 border-gold/15"
        />
      </FieldRow>
      <FieldRow label="Strength Required" hint="Heavy armor only — character STR must meet this or take −10ft speed.">
        <Input
          type="number"
          value={formData.strength ?? ''}
          onChange={(e) => setFormData((prev) => ({
            ...prev,
            strength: e.target.value === '' ? null : parseInt(e.target.value, 10),
          }))}
          className="bg-background/50 border-gold/15"
          placeholder="—"
        />
      </FieldRow>
      <p className="text-[10px] text-ink/45 py-2">
        Stealth disadvantage lives on the Properties section now —
        add the <code>stealthDisadvantage</code> property to flag it.
      </p>
    </ActivitySection>
  );
}

function ConsumableItemFields({
  formData,
  setFormData,
}: {
  formData: ItemFormData;
  setFormData: React.Dispatch<React.SetStateAction<ItemFormData>>;
}) {
  return (
    <ActivitySection label="CONSUMABLE">
      <FieldRow label="Magical Bonus" hint="Flat int added to any damage roll. e.g. 1 for a magical acid vial.">
        <Input
          type="number"
          value={formData.magicalBonus ?? 0}
          onChange={(e) => setFormData((prev) => ({
            ...prev,
            magicalBonus: parseInt(e.target.value || '0', 10) || 0,
          }))}
          className="bg-background/50 border-gold/15"
        />
      </FieldRow>
      <p className="text-[10px] text-ink/45 py-2">
        Damage rolls (e.g. potion of healing, acid vial) live in the item's
        Activities — add a Damage activity to author the dice and on-use
        behaviour.
      </p>
    </ActivitySection>
  );
}

function ToolItemFields({
  formData,
  setFormData,
  profs,
}: {
  formData: ItemFormData;
  setFormData: React.Dispatch<React.SetStateAction<ItemFormData>>;
  profs: ProficiencyBucket;
}) {
  return (
    <ActivitySection label="TOOL">
      <FieldRow label="Default Ability" hint="Default ability used when rolling a check with this tool. Players can override at roll time.">
        <SingleSelectSearch
          value={formData.abilityId || ''}
          onChange={(val) => setFormData((prev) => ({ ...prev, abilityId: val }))}
          options={[
            { id: '', name: '— none —' },
            ...profs.abilities.map((a) => ({ id: a.id, name: a.name || a.identifier })),
            ...ABILITY_OPTIONS.map((slug) => ({
              id: slug,
              name: FALLBACK_ABILITY_LABELS[slug] || slug,
            })).filter((o) => !profs.abilities.some((a) => a.identifier?.toLowerCase() === o.id)),
          ]}
          triggerClassName="w-full"
        />
      </FieldRow>
      <FieldRow label="Check Bonus" hint="Formula added to checks made with this tool. e.g. '+1' or '@prof'.">
        <Input
          value={formData.bonus || ''}
          onChange={(e) => setFormData((prev) => ({ ...prev, bonus: e.target.value }))}
          className="bg-background/50 border-gold/15 text-xs font-mono"
          placeholder="+1"
        />
      </FieldRow>
      <FieldRow label="Chat Flavor" hint="Short flavor line that prepends the chat card when the tool is used.">
        <Input
          value={formData.chatFlavor || ''}
          onChange={(e) => setFormData((prev) => ({ ...prev, chatFlavor: e.target.value }))}
          className="bg-background/50 border-gold/15"
          placeholder="Tinkering away..."
        />
      </FieldRow>
    </ActivitySection>
  );
}

// ─── Container Details (Foundry dnd5e 5.3.1 container sheet) ────────
//
// Containers are Foundry-special: a Details tab + a Contents tab, no
// activities or effects. Details = container properties (Magical /
// Weightless Contents — both `system.properties` slugs) + conditional
// attunement + capacity (count / volume / weight, the dnd5e 5.x shape).

function ContainerDetails({
  formData,
  setFormData,
  profs,
}: {
  formData: ItemFormData;
  setFormData: React.Dispatch<React.SetStateAction<ItemFormData>>;
  profs: ProficiencyBucket;
}) {
  // Container properties come from the admin-managed item_properties
  // table (valid_types includes 'container') — exactly Magical (mgc) +
  // Weightless Contents (weightlessContents). Same data-driven catalog
  // the consumable Details + Enchant activity use.
  const propertyCatalog = useMemo(() => {
    const list = Array.isArray(profs.itemProperties) ? profs.itemProperties : [];
    return list
      .filter((p: any) => {
        try { return JSON.parse(p.valid_types || '[]').includes('container'); }
        catch { return false; }
      })
      .map((p: any) => ({ id: String(p.identifier || p.id), name: String(p.name || p.identifier) }));
  }, [profs.itemProperties]);

  const properties = Array.isArray(formData.properties) ? formData.properties : [];
  const isMagical = properties.includes('mgc');
  const toggleProperty = (slug: string) => setFormData((prev) => {
    const cur = Array.isArray(prev.properties) ? prev.properties : [];
    return { ...prev, properties: cur.includes(slug) ? cur.filter((s) => s !== slug) : [...cur, slug] };
  });

  // Capacity — dnd5e 5.x shape: { count, volume:{value,units}, weight:{value,units} }.
  const capacity = (formData.capacity && typeof formData.capacity === 'object') ? formData.capacity : {};
  const volume = (capacity.volume && typeof capacity.volume === 'object') ? capacity.volume : {};
  const weight = (capacity.weight && typeof capacity.weight === 'object') ? capacity.weight : {};
  const setCapacity = (patch: Record<string, any>) => setFormData((prev) => {
    const cur = (prev.capacity && typeof prev.capacity === 'object') ? prev.capacity : {};
    return { ...prev, capacity: { ...cur, ...patch } };
  });
  const setVolume = (patch: Record<string, any>) => setCapacity({ volume: { ...volume, ...patch } });
  const setWeight = (patch: Record<string, any>) => setCapacity({ weight: { ...weight, ...patch } });

  return (
    <div className="space-y-4 pt-4 border-t border-gold/15">
      <fieldset className="config-fieldset">
        <legend className="section-label text-gold/60 px-1">Container Details</legend>
        {/* Properties — Magical + Weightless Contents (stacked grid, matching consumable). */}
        <div className="py-2 space-y-1.5">
          <p className="text-xs font-semibold text-ink/85 leading-tight">Container Properties</p>
          {propertyCatalog.length === 0 ? (
            <p className="field-hint">No properties for this type.</p>
          ) : (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
              {propertyCatalog.map((p) => (
                <label key={p.id} className="flex items-center gap-2 cursor-pointer">
                  <Checkbox checked={properties.includes(p.id)} onCheckedChange={() => toggleProperty(p.id)} />
                  <span className="text-xs text-ink/75">{p.name}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        {/* Attunement — only shown for magical containers (Foundry behaviour). */}
        {isMagical && (
          <FieldRow
            label="Attunement"
            hint="Whether a creature must attune to this magic item to use its properties."
          >
            <FieldSelect
              value={formData.attunement ? formData.attunement : 'none'}
              onChange={(val) => setFormData((prev) => ({ ...prev, attunement: val === 'none' ? '' : val }))}
              options={CONTAINER_ATTUNEMENT_OPTIONS}
              triggerClassName="w-full"
            />
          </FieldRow>
        )}
      </fieldset>

      <fieldset className="config-fieldset">
        <legend className="section-label text-gold/60 px-1">Capacity</legend>
        <div className="space-y-3 py-1">
          {/* Item Count — single field, blank = unlimited. */}
          <div className="space-y-0.5">
            <Label className="field-label">Item Count</Label>
            <Input
              type="number"
              min={0}
              value={capacity.count ?? ''}
              onChange={(e) => setCapacity({ count: e.target.value === '' ? null : (parseInt(e.target.value, 10) || 0) })}
              placeholder="Unlimited"
              className="h-8 bg-background/50 border-gold/15 text-sm no-number-spin"
            />
            <p className="field-hint">Maximum number of items the container can hold. Blank = unlimited.</p>
          </div>
          {/* Volume + Weight — each an amount + a unit. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <CapacityAxis
              label="Volume Capacity"
              value={volume.value}
              units={volume.units || 'cubicFoot'}
              unitOptions={CAPACITY_VOLUME_UNITS}
              onValue={(v) => setVolume({ value: v, units: volume.units || 'cubicFoot' })}
              onUnits={(u) => setVolume({ units: u })}
            />
            <CapacityAxis
              label="Weight Capacity"
              value={weight.value}
              units={weight.units || 'lb'}
              unitOptions={CAPACITY_WEIGHT_UNITS}
              onValue={(v) => setWeight({ value: v, units: weight.units || 'lb' })}
              onUnits={(u) => setWeight({ units: u })}
            />
          </div>
        </div>
      </fieldset>
    </div>
  );
}

// Amount + unit pair used by the container capacity (volume / weight).
function CapacityAxis({
  label,
  value,
  units,
  unitOptions,
  onValue,
  onUnits,
}: {
  label: string;
  value: number | null | undefined;
  units: string;
  unitOptions: [string, string][];
  onValue: (next: number | null) => void;
  onUnits: (next: string) => void;
}) {
  return (
    <div className="space-y-0.5">
      <Label className="field-label">{label}</Label>
      <div className="grid grid-cols-[1fr_auto] gap-1.5">
        <Input
          type="number"
          min={0}
          value={value ?? ''}
          onChange={(e) => onValue(e.target.value === '' ? null : (parseFloat(e.target.value) || 0))}
          placeholder="Amount"
          className="h-8 bg-background/50 border-gold/15 text-sm no-number-spin"
        />
        <FieldSelect
          value={units}
          onChange={onUnits}
          options={unitOptions}
          triggerClassName="h-8 w-28"
        />
      </div>
    </div>
  );
}

// ─── Container Contents (currency + stored-items model) ────────────
//
// Foundry's container Contents tab shows the stored currency and the
// items inside. Contained items live as their own rows that point back
// via `container_id`, so a catalog container is empty here; a
// character's saved bag (including Foundry imports) keeps whatever it
// holds.

function ContainerContents({
  formData,
  setFormData,
  containerId,
  itemCatalog,
}: {
  formData: ItemFormData;
  setFormData: React.Dispatch<React.SetStateAction<ItemFormData>>;
  containerId: string | null;
  itemCatalog: any[];
}) {
  const currency = (formData.currency && typeof formData.currency === 'object')
    ? formData.currency
    : { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
  const updateCurrency = (coin: string, val: number) => setFormData((prev) => {
    const cur = (prev.currency && typeof prev.currency === 'object')
      ? prev.currency
      : { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
    return { ...prev, currency: { ...cur, [coin]: val } };
  });

  return (
    <div className="space-y-4 pt-4 border-t border-gold/15">
      <fieldset className="config-fieldset">
        <legend className="section-label text-gold/60 px-1">Currency</legend>
        <p className="field-hint mb-2">Coins stored inside this container.</p>
        <div className="grid grid-cols-5 gap-2">
          {DENOMINATIONS.map(([coin, label]) => (
            <div key={coin} className="space-y-0.5">
              <Label className="field-label block text-center">{label}</Label>
              <Input
                type="number"
                min={0}
                value={(currency as any)[coin] ?? 0}
                onChange={(e) => updateCurrency(coin, parseInt(e.target.value || '0', 10) || 0)}
                className="h-8 bg-background/50 border-gold/15 text-center text-sm no-number-spin"
              />
            </div>
          ))}
        </div>
      </fieldset>

      {containerId ? (
        <ContainerContentsPanel containerId={containerId} itemCatalog={itemCatalog || []} />
      ) : (
        <fieldset className="config-fieldset">
          <legend className="section-label text-gold/60 px-1">Stored Items</legend>
          <p className="text-xs text-ink/55 leading-relaxed py-1">
            Save this container first to add contents. The recipe attaches to the
            saved container row, and materializes as a character's own copies when
            the container is added to a sheet or imported from Foundry.
          </p>
        </fieldset>
      )}
    </div>
  );
}
