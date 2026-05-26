import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronLeft, Hammer, X } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { Button } from '../../components/ui/button';
import DevelopmentCompendiumManager from '../../components/compendium/DevelopmentCompendiumManager';
import ItemImportWorkbench from '../../components/compendium/ItemImportWorkbench';
import { Checkbox } from '../../components/ui/checkbox';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { ActivitySection, FieldRow } from '../../components/compendium/activity/primitives';
import SingleSelectSearch from '../../components/ui/SingleSelectSearch';
import ItemUsesField from '../../components/compendium/ItemUsesField';
import { fetchCollection } from '../../lib/d1';
import { denormalizeCompendiumData } from '../../lib/compendium';
import { ABILITY_OPTIONS, FALLBACK_ABILITY_LABELS, DAMAGE_TYPE_OPTIONS, DAMAGE_DIE_DENOMINATIONS } from '../../components/compendium/activity/constants';

// ─── Vocabularies ──────────────────────────────────────────────────
//
// Foundry dnd5e v5 system.type enums. The (value, label) tuples keep
// the canonical slugs as the value so the export round-trips cleanly
// to Foundry; UI labels are display-only.

const ITEM_TYPES: [string, string][] = [
  ['weapon', 'Weapon'],
  ['equipment', 'Equipment / Armor'],
  ['consumable', 'Consumable'],
  ['tool', 'Tool'],
  ['container', 'Container'],
  ['loot', 'Loot / Wondrous'],
];

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
  ['cp', 'cp'],
  ['sp', 'sp'],
  ['ep', 'ep'],
  ['gp', 'gp'],
  ['pp', 'pp'],
];

const WEIGHT_UNITS: [string, string][] = [
  ['lb', 'lb'],
  ['kg', 'kg'],
];

// dnd5e v5 `system.type.value` enum for equipment items. Armor-bearing
// subtypes (light/medium/heavy/shield) drive a conditional armor block
// inside the equipment sub-form.
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

const CONSUMABLE_SUBTYPES: [string, string][] = [
  ['potion', 'Potion'],
  ['scroll', 'Scroll'],
  ['poison', 'Poison'],
  ['ammo', 'Ammunition'],
  ['wand', 'Wand'],
  ['rod', 'Rod'],
  ['food', 'Food / Drink'],
  ['trinket', 'Trinket'],
];

// dnd5e v5 nested `system.type.subtype` enums. Only applicable when the
// parent type's value drives a second-axis dropdown (poison delivery,
// ammo physical shape, loot kind).
const CONSUMABLE_POISON_SUBTYPES: [string, string][] = [
  ['contact', 'Contact'],
  ['ingested', 'Ingested'],
  ['inhaled', 'Inhaled'],
  ['injury', 'Injury'],
];

const CONSUMABLE_AMMO_SUBTYPES: [string, string][] = [
  ['arrow', 'Arrow'],
  ['bolt', 'Crossbow Bolt'],
  ['bullet', 'Sling Bullet'],
  ['energyCell', 'Energy Cell'],
  ['firearmBullet', 'Firearm Bullet'],
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
  ['ft', 'feet'],
  ['mi', 'miles'],
  ['m', 'meters'],
  ['km', 'kilometers'],
  ['spec', 'special'],
];

const CAPACITY_TYPES: [string, string][] = [
  ['items', 'Item Count'],
  ['weight', 'Weight Capacity'],
];

const CAPACITY_WEIGHT_UNITS: [string, string][] = [
  ['lb', 'lb'],
  ['kg', 'kg'],
];

// ─── Page shell ────────────────────────────────────────────────────

/**
 * Outer page shell — mirrors SpellsEditor + FeatsEditor's tabs
 * structure. Top toolbar carries the Back link + tab switcher; tab
 * content delegates to either `ItemImportWorkbench` (admin bulk
 * import from a Foundry export) or `ItemManualEditor` (the
 * DevelopmentCompendiumManager-driven single-row editor with the new
 * type-dispatching form body).
 */
export default function ItemsEditor({ userProfile }: { userProfile: any }) {
  const isAdmin = userProfile?.role === 'admin';
  const location = useLocation();
  const isProposalRoute = location.pathname.startsWith('/proposals/edit/');
  const backPath = isProposalRoute ? '/my-proposals' : '/compendium';
  const backLabel = isProposalRoute ? 'Back to My Proposals' : 'Back to Compendium';

  useEffect(() => {
    document.body.classList.add('spell-list-fullscreen');
    return () => document.body.classList.remove('spell-list-fullscreen');
  }, []);

  return (
    <Tabs defaultValue="manual-editor" className="h-[calc(100vh-4rem)] flex flex-col gap-2 p-2">
      <div className="shrink-0 flex items-center gap-2 bg-card p-2 rounded-lg border border-gold/10 shadow-sm flex-wrap">
        <Link to={backPath}>
          <Button variant="ghost" size="sm" className="h-8 text-gold gap-2 hover:bg-gold/5">
            <ChevronLeft className="w-4 h-4" />
            {backLabel}
          </Button>
        </Link>
        <TabsList variant="line" className="gap-1 bg-transparent p-0">
          {isAdmin && (
            <TabsTrigger
              value="foundry-import"
              className="h-8 rounded-md border border-gold/15 bg-background/30 px-3 py-1 text-xs uppercase tracking-[0.18em] text-ink/65 data-active:border-gold/40 data-active:bg-gold/10 data-active:text-gold"
            >
              Foundry Import
            </TabsTrigger>
          )}
          <TabsTrigger
            value="manual-editor"
            className="h-8 rounded-md border border-gold/15 bg-background/30 px-3 py-1 text-xs uppercase tracking-[0.18em] text-ink/65 data-active:border-gold/40 data-active:bg-gold/10 data-active:text-gold"
          >
            Manual Editor
          </TabsTrigger>
        </TabsList>
      </div>

      {isAdmin && (
        <TabsContent value="foundry-import" className="flex-1 min-h-0">
          <ItemImportWorkbench userProfile={userProfile} />
        </TabsContent>
      )}

      <TabsContent value="manual-editor" className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
        <ItemManualEditor userProfile={userProfile} />
      </TabsContent>
    </Tabs>
  );
}

// ─── Manual editor ─────────────────────────────────────────────────

function ItemManualEditor({ userProfile }: { userProfile: any }) {
  return (
    <DevelopmentCompendiumManager
      userProfile={userProfile}
      collectionName="items"
      entityType="item"
      title="Item Manager"
      singularLabel="Item"
      icon={Hammer}
      backPath="/compendium"
      description="Drafting surface for non-spell items. Type-driven body — the item type dropdown swaps the secondary fields (weapon damage, armor AC, container capacity, etc.) so the form only ever shows what's relevant. Activities + effects drive runtime use."
      defaultData={{
        // Identity (rendered by the outer shell)
        name: '',
        identifier: '',
        imageUrl: '',
        description: '',
        activities: [],
        effectsStr: '[]',

        // Type discriminators
        itemType: 'loot',
        typeSubtype: '',

        // Physical
        rarity: 'none',
        quantity: 1,
        weight: { value: 0, units: 'lb' },
        price: { value: 0, denomination: 'gp' },

        // Equippability (attunement is 3-state TEXT post 20260526-1700)
        attunement: '',
        equipped: false,
        identified: true,
        magical: false,

        // Properties pool (slugs)
        properties: [],

        // Uses block — new shape from C5 ItemUsesField
        uses: { max: '', spent: 0, recovery: [], autoDestroy: false },

        // Weapon-specific
        damage: null,
        range: null,
        mastery: '',
        magicalBonus: 0,
        ammunition: null,

        // Armor-specific (equipment with armor subtype)
        armorValue: 10,
        armorDex: null,
        armorMagicalBonus: 0,
        strength: null,
        armorType: '',

        // Tool-specific
        toolType: '',
        bonus: '',
        chatFlavor: '',
        abilityId: '',

        // Container-specific
        capacity: null,
        currency: null,
        containerId: '',

        // Base-item FKs (proficiency-table refs)
        baseWeaponId: '',
        baseArmorId: '',
        baseToolId: '',
        baseItem: '',

        // Unidentified copy
        unidentifiedDescription: '',
      }}
      renderSpecificFields={(formData, setFormData) => (
        <DynamicItemFields formData={formData} setFormData={setFormData} />
      )}
      summarizeEntry={(entry) => (
        <div className="space-y-1">
          <div>{entry.itemType || 'loot'} item</div>
          <div className="text-[10px] text-ink/50">
            {(entry.automation?.activities || []).length || 0} activities
            {entry.rarity && entry.rarity !== 'none' ? ` • ${entry.rarity}` : ''}
            {entry.attunement ? ` • ${entry.attunement} attunement` : ''}
          </div>
        </div>
      )}
    />
  );
}

// ─── Dynamic body ─────────────────────────────────────────────────

type ProficiencyBucket = {
  weapons: any[];
  armor: any[];
  tools: any[];
  abilities: any[];
  weaponProperties: any[];
};

const EMPTY_BUCKET: ProficiencyBucket = {
  weapons: [],
  armor: [],
  tools: [],
  abilities: [],
  weaponProperties: [],
};

/**
 * Top-level form body. Loads the lookup tables that every sub-form
 * needs (weapons / armor / tools for base-item dropdowns, attributes
 * for tool ability, weapon_properties for the properties multiselect)
 * once and passes the bucket down. Each sub-form gets only its own
 * slice of formData + the shared setter.
 */
function DynamicItemFields({
  formData,
  setFormData,
}: {
  formData: any;
  setFormData: React.Dispatch<React.SetStateAction<any>>;
}) {
  const [profs, setProfs] = useState<ProficiencyBucket>(EMPTY_BUCKET);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchCollection<any>('weapons'),
      fetchCollection<any>('armor'),
      fetchCollection<any>('tools'),
      fetchCollection<any>('attributes'),
      fetchCollection<any>('weaponProperties'),
    ])
      .then(([weapons, armor, tools, abilities, weaponProperties]) => {
        if (cancelled) return;
        setProfs({
          weapons: weapons.map((r) => denormalizeCompendiumData(r)),
          armor: armor.map((r) => denormalizeCompendiumData(r)),
          tools: tools.map((r) => denormalizeCompendiumData(r)),
          abilities: abilities.map((r) => denormalizeCompendiumData(r)),
          weaponProperties: weaponProperties.map((r) => denormalizeCompendiumData(r)),
        });
      })
      .catch((err) => {
        console.error('Failed to load item-editor lookup tables', err);
      });
    return () => { cancelled = true; };
  }, []);

  const itemType = formData.itemType || 'loot';

  return (
    <div className="space-y-4">
      <TypeSection formData={formData} setFormData={setFormData} profs={profs} />
      <PhysicalSection formData={formData} setFormData={setFormData} />
      {itemType !== 'loot' && (
        <EquippabilitySection formData={formData} setFormData={setFormData} />
      )}
      <PropertiesSection formData={formData} setFormData={setFormData} profs={profs} />
      {itemType !== 'loot' && itemType !== 'container' && (
        <ItemUsesField
          uses={formData.uses}
          onChange={(next) => setFormData((prev: any) => ({ ...prev, uses: next }))}
          showAutoDestroy={itemType === 'consumable'}
        />
      )}

      {itemType === 'weapon' && (
        <WeaponItemFields formData={formData} setFormData={setFormData} profs={profs} />
      )}
      {itemType === 'equipment' && (
        <EquipmentItemFields formData={formData} setFormData={setFormData} profs={profs} />
      )}
      {itemType === 'consumable' && (
        <ConsumableItemFields formData={formData} setFormData={setFormData} />
      )}
      {itemType === 'tool' && (
        <ToolItemFields formData={formData} setFormData={setFormData} profs={profs} />
      )}
      {itemType === 'container' && (
        <ContainerItemFields formData={formData} setFormData={setFormData} />
      )}
    </div>
  );
}

// ─── Shared sections (apply to every item type) ────────────────────

function TypeSection({
  formData,
  setFormData,
  profs,
}: {
  formData: any;
  setFormData: React.Dispatch<React.SetStateAction<any>>;
  profs: ProficiencyBucket;
}) {
  const itemType: string = formData.itemType || 'loot';

  // Subtype dropdown options — driven off the parent itemType. Some
  // types (consumable / equipment / tool / loot) have a second-axis
  // enum; weapon / container don't.
  const subtypeOptions = getSubtypeOptions(itemType);

  return (
    <ActivitySection label="TYPE">
      <FieldRow label="Item Type" hint="Drives which secondary fields appear below.">
        <SingleSelectSearch
          value={itemType}
          onChange={(val) => setFormData((prev: any) => ({
            ...prev,
            itemType: val,
            // Reset subtype when the parent type changes — different
            // types use different second-axis enums.
            typeSubtype: '',
          }))}
          options={ITEM_TYPES.map(([value, label]) => ({ id: value, name: label }))}
          placeholder="Select type..."
          triggerClassName="w-full"
        />
      </FieldRow>
      {subtypeOptions && (
        <FieldRow label="Subtype" hint="Foundry's nested system.type.subtype.">
          <SingleSelectSearch
            value={formData.typeSubtype || ''}
            onChange={(val) => setFormData((prev: any) => ({ ...prev, typeSubtype: val }))}
            options={subtypeOptions.map(([value, label]) => ({ id: value, name: label }))}
            placeholder="Select subtype..."
            triggerClassName="w-full"
          />
        </FieldRow>
      )}
      {/* Base-item dropdown — proficiency table reference. Only shows
          when the item shape has an applicable proficiency table. */}
      {itemType === 'weapon' && (
        <BaseItemRow
          label="Base Weapon"
          hint="Links to a row in the weapons proficiency table for character-sheet proficiency resolution."
          options={profs.weapons}
          value={formData.baseWeaponId || ''}
          onChange={(id) => setFormData((prev: any) => ({
            ...prev,
            baseWeaponId: id,
            baseArmorId: '',
            baseToolId: '',
            baseItem: profs.weapons.find((w) => w.id === id)?.identifier || prev.baseItem,
          }))}
        />
      )}
      {itemType === 'equipment' && EQUIPMENT_ARMOR_SUBTYPES.has(formData.typeSubtype) && (
        <BaseItemRow
          label="Base Armor"
          hint="Links to a row in the armor proficiency table."
          options={profs.armor}
          value={formData.baseArmorId || ''}
          onChange={(id) => setFormData((prev: any) => ({
            ...prev,
            baseArmorId: id,
            baseWeaponId: '',
            baseToolId: '',
            baseItem: profs.armor.find((a) => a.id === id)?.identifier || prev.baseItem,
          }))}
        />
      )}
      {itemType === 'tool' && (
        <BaseItemRow
          label="Base Tool"
          hint="Links to a row in the tools proficiency table."
          options={profs.tools}
          value={formData.baseToolId || ''}
          onChange={(id) => setFormData((prev: any) => ({
            ...prev,
            baseToolId: id,
            baseWeaponId: '',
            baseArmorId: '',
            baseItem: profs.tools.find((t) => t.id === id)?.identifier || prev.baseItem,
          }))}
        />
      )}
    </ActivitySection>
  );
}

function BaseItemRow({
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
  );
}

function getSubtypeOptions(itemType: string): [string, string][] | null {
  switch (itemType) {
    case 'equipment': return EQUIPMENT_SUBTYPES;
    case 'consumable': return CONSUMABLE_SUBTYPES;
    case 'tool': return TOOL_SUBTYPES;
    case 'loot': return LOOT_SUBTYPES;
    default: return null;
  }
}

function PhysicalSection({
  formData,
  setFormData,
}: {
  formData: any;
  setFormData: React.Dispatch<React.SetStateAction<any>>;
}) {
  return (
    <ActivitySection label="PHYSICAL">
      <FieldRow label="Rarity">
        <SingleSelectSearch
          value={formData.rarity || 'none'}
          onChange={(val) => setFormData((prev: any) => ({ ...prev, rarity: val }))}
          options={RARITIES.map(([value, label]) => ({ id: value, name: label }))}
          placeholder="Select rarity..."
          triggerClassName="w-full"
        />
      </FieldRow>
      <FieldRow label="Quantity">
        <Input
          type="number"
          min={0}
          value={formData.quantity ?? 1}
          onChange={(e) => setFormData((prev: any) => ({
            ...prev,
            quantity: parseInt(e.target.value || '0', 10) || 0,
          }))}
          className="bg-background/50 border-gold/10 focus:border-gold"
        />
      </FieldRow>
      <FieldRow label="Weight">
        <div className="flex gap-1">
          <Input
            type="number"
            step="0.1"
            value={formData.weight?.value ?? 0}
            onChange={(e) => setFormData((prev: any) => ({
              ...prev,
              weight: { value: parseFloat(e.target.value) || 0, units: prev.weight?.units || 'lb' },
            }))}
            className="bg-background/50 border-gold/10 focus:border-gold flex-1"
            placeholder="0.5"
          />
          <SingleSelectSearch
            value={formData.weight?.units || 'lb'}
            onChange={(val) => setFormData((prev: any) => ({
              ...prev,
              weight: { value: prev.weight?.value ?? 0, units: val },
            }))}
            options={WEIGHT_UNITS.map(([v, l]) => ({ id: v, name: l }))}
            triggerClassName="w-20"
          />
        </div>
      </FieldRow>
      <FieldRow label="Price">
        <div className="flex gap-1">
          <Input
            type="number"
            step="1"
            value={formData.price?.value ?? 0}
            onChange={(e) => setFormData((prev: any) => ({
              ...prev,
              price: { value: parseFloat(e.target.value) || 0, denomination: prev.price?.denomination || 'gp' },
            }))}
            className="bg-background/50 border-gold/10 focus:border-gold flex-1"
            placeholder="50"
          />
          <SingleSelectSearch
            value={formData.price?.denomination || 'gp'}
            onChange={(val) => setFormData((prev: any) => ({
              ...prev,
              price: { value: prev.price?.value ?? 0, denomination: val },
            }))}
            options={DENOMINATIONS.map(([v, l]) => ({ id: v, name: l }))}
            triggerClassName="w-20"
          />
        </div>
      </FieldRow>
      <FieldRow label="Magical" inline hint="True for any rarity above 'common' or via the 'mgc' property.">
        <Checkbox
          checked={!!formData.magical}
          onCheckedChange={(checked) => setFormData((prev: any) => ({ ...prev, magical: !!checked }))}
        />
      </FieldRow>
    </ActivitySection>
  );
}

function EquippabilitySection({
  formData,
  setFormData,
}: {
  formData: any;
  setFormData: React.Dispatch<React.SetStateAction<any>>;
}) {
  return (
    <ActivitySection label="EQUIPABILITY">
      <FieldRow
        label="Attunement"
        hint="Foundry's 3-state vocabulary. 'Required' means the item must be attuned to use any attunement-gated effect."
      >
        <SingleSelectSearch
          value={formData.attunement ?? ''}
          onChange={(val) => setFormData((prev: any) => ({ ...prev, attunement: val }))}
          options={ATTUNEMENT_OPTIONS.map(([v, l]) => ({ id: v, name: l }))}
          placeholder="None"
          triggerClassName="w-full"
        />
      </FieldRow>
      <FieldRow label="Equipped By Default" inline>
        <Checkbox
          checked={!!formData.equipped}
          onCheckedChange={(checked) => setFormData((prev: any) => ({ ...prev, equipped: !!checked }))}
        />
      </FieldRow>
      <FieldRow label="Identified By Default" inline>
        <Checkbox
          checked={formData.identified !== false}
          onCheckedChange={(checked) => setFormData((prev: any) => ({ ...prev, identified: !!checked }))}
        />
      </FieldRow>
      <FieldRow
        label="Unidentified Description"
        hint="Shown to players before the item is identified. Optional."
      >
        <textarea
          value={formData.unidentifiedDescription || ''}
          onChange={(e) => setFormData((prev: any) => ({ ...prev, unidentifiedDescription: e.target.value }))}
          className="w-full min-h-[60px] px-3 py-2 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-sm"
          placeholder="A nondescript [item]…"
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
  formData: any;
  setFormData: React.Dispatch<React.SetStateAction<any>>;
  profs: ProficiencyBucket;
}) {
  const properties: string[] = Array.isArray(formData.properties) ? formData.properties : [];

  // Weapon-property catalog from the admin table. Filter on relevance:
  // weapons show all properties; armor/equipment surfaces only the
  // armor-applicable ones (notably `stealthDisadvantage`); other shapes
  // show the full catalog as a fallback so authors can hand-pick.
  const itemType = formData.itemType || 'loot';
  const propertyCatalog = useMemo(() => {
    const list = Array.isArray(profs.weaponProperties) ? profs.weaponProperties : [];
    return list.map((row) => ({
      id: row.identifier || row.id,
      name: row.name || row.identifier,
    }));
  }, [profs.weaponProperties]);

  const addProperty = (slug: string) => {
    if (!slug || properties.includes(slug)) return;
    setFormData((prev: any) => ({ ...prev, properties: [...properties, slug] }));
  };

  const removeProperty = (slug: string) => {
    setFormData((prev: any) => ({
      ...prev,
      properties: properties.filter((p) => p !== slug),
    }));
  };

  // Hide for loot shape — properties don't drive any rules behaviour for
  // pure-treasure rows.
  if (itemType === 'loot') return null;

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
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] uppercase tracking-widest font-black bg-gold/15 border border-gold/30 text-gold"
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
          <span className="text-[9px] text-ink/30 italic">
            {properties.length} selected
          </span>
        </div>
        <p className="text-[10px] text-ink/40">
          Foundry-aligned slugs (post-20260526-1700: fin / hvy / lgt / lod / two / ver / thr / rch / amm / spc / sil
          for standards; custom slugs like 'lance' or 'superHeavy' pass through verbatim).
        </p>
      </div>
    </ActivitySection>
  );
}

// ─── Type-specific sub-forms ───────────────────────────────────────

function WeaponItemFields({
  formData,
  setFormData,
}: {
  formData: any;
  setFormData: React.Dispatch<React.SetStateAction<any>>;
  profs: ProficiencyBucket;
}) {
  const damage = formData.damage || { base: { number: 1, denomination: 6, types: [], bonus: '' } };
  const damageBase = damage.base || { number: 1, denomination: 6, types: [], bonus: '' };
  const range = formData.range || { value: null, long: null, reach: null, units: 'ft' };

  const updateDamageBase = (patch: Record<string, any>) => {
    setFormData((prev: any) => ({
      ...prev,
      damage: { ...(prev.damage || {}), base: { ...damageBase, ...patch } },
    }));
  };

  const updateRange = (patch: Record<string, any>) => {
    setFormData((prev: any) => ({
      ...prev,
      range: { ...range, ...patch },
    }));
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
            className="bg-background/50 border-gold/10"
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
        <FieldRow label="Damage Type" hint="First listed type is the canonical one. Hold Cmd/Ctrl to multi-select for choice damage.">
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
            className="bg-background/50 border-gold/10 text-xs font-mono"
            placeholder="@mod"
          />
        </FieldRow>
        <FieldRow label="Magical Bonus" hint="Flat int added to attack + damage. e.g. 1 for a Flame Tongue.">
          <Input
            type="number"
            value={formData.magicalBonus ?? 0}
            onChange={(e) => setFormData((prev: any) => ({
              ...prev,
              magicalBonus: parseInt(e.target.value || '0', 10) || 0,
            }))}
            className="bg-background/50 border-gold/10"
          />
        </FieldRow>
      </ActivitySection>

      <ActivitySection label="WEAPON · RANGE">
        <FieldRow label="Normal Range" hint="Feet (or units below). Blank for melee with no thrown property.">
          <Input
            type="number"
            value={range.value ?? ''}
            onChange={(e) => updateRange({ value: e.target.value === '' ? null : parseInt(e.target.value, 10) })}
            className="bg-background/50 border-gold/10"
            placeholder="—"
          />
        </FieldRow>
        <FieldRow label="Long Range" hint="Disadvantage past normal, up to long. Bows / crossbows.">
          <Input
            type="number"
            value={range.long ?? ''}
            onChange={(e) => updateRange({ long: e.target.value === '' ? null : parseInt(e.target.value, 10) })}
            className="bg-background/50 border-gold/10"
            placeholder="—"
          />
        </FieldRow>
        <FieldRow label="Reach" hint="Melee reach in feet. Blank uses the default 5'.">
          <Input
            type="number"
            value={range.reach ?? ''}
            onChange={(e) => updateRange({ reach: e.target.value === '' ? null : parseInt(e.target.value, 10) })}
            className="bg-background/50 border-gold/10"
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
  formData: any;
  setFormData: React.Dispatch<React.SetStateAction<any>>;
  profs: ProficiencyBucket;
}) {
  const subtype = formData.typeSubtype || '';
  const isArmor = EQUIPMENT_ARMOR_SUBTYPES.has(subtype);

  if (!isArmor) {
    return (
      <ActivitySection label="EQUIPMENT">
        <p className="text-[10px] text-ink/40 py-2">
          Worn gear — no armor stats. Use the Properties section for any
          item-shape flags ('mgc', 'concentration', custom homebrew slugs).
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
          onChange={(e) => setFormData((prev: any) => ({
            ...prev,
            armorValue: parseInt(e.target.value || '0', 10) || 0,
          }))}
          className="bg-background/50 border-gold/10"
        />
      </FieldRow>
      <FieldRow label="Dex Max" hint="Maximum Dex bonus allowed. Blank = unlimited (light armor); 2 for medium; 0 for heavy.">
        <Input
          type="number"
          value={formData.armorDex ?? ''}
          onChange={(e) => setFormData((prev: any) => ({
            ...prev,
            armorDex: e.target.value === '' ? null : parseInt(e.target.value, 10),
          }))}
          className="bg-background/50 border-gold/10"
          placeholder="—"
        />
      </FieldRow>
      <FieldRow label="Magical Bonus" hint="Flat int added to AC. e.g. 1 for +1 plate.">
        <Input
          type="number"
          value={formData.armorMagicalBonus ?? 0}
          onChange={(e) => setFormData((prev: any) => ({
            ...prev,
            armorMagicalBonus: parseInt(e.target.value || '0', 10) || 0,
          }))}
          className="bg-background/50 border-gold/10"
        />
      </FieldRow>
      <FieldRow label="Strength Required" hint="Heavy armor only — character STR must meet this or get -10ft speed.">
        <Input
          type="number"
          value={formData.strength ?? ''}
          onChange={(e) => setFormData((prev: any) => ({
            ...prev,
            strength: e.target.value === '' ? null : parseInt(e.target.value, 10),
          }))}
          className="bg-background/50 border-gold/10"
          placeholder="—"
        />
      </FieldRow>
      <p className="text-[10px] text-ink/40 py-2">
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
  formData: any;
  setFormData: React.Dispatch<React.SetStateAction<any>>;
}) {
  // Two-axis consumables (poison delivery: contact/inhaled/etc;
  // ammo shape: arrow/bolt/etc) — Foundry's `system.type.subtype` —
  // are currently lost on import + don't have an editor field; the
  // schema has no inner-subtype column. Flagged for follow-up: add
  // items.type_inner_subtype or move to a packed-slug convention.
  // For now, the primary subtype (potion/scroll/poison/ammo/etc.)
  // lives in the shared Type section above.
  return (
    <ActivitySection label="CONSUMABLE">
      <FieldRow label="Magical Bonus" hint="Flat int added to any damage roll. e.g. 1 for a magical acid vial.">
        <Input
          type="number"
          value={formData.magicalBonus ?? 0}
          onChange={(e) => setFormData((prev: any) => ({
            ...prev,
            magicalBonus: parseInt(e.target.value || '0', 10) || 0,
          }))}
          className="bg-background/50 border-gold/10"
        />
      </FieldRow>
      <p className="text-[10px] text-ink/40 py-2">
        Damage rolls (e.g. potion of healing, acid vial) live in the
        item's Activities — add a Damage activity to author the dice
        and on-use behaviour.
      </p>
    </ActivitySection>
  );
}

function ToolItemFields({
  formData,
  setFormData,
  profs,
}: {
  formData: any;
  setFormData: React.Dispatch<React.SetStateAction<any>>;
  profs: ProficiencyBucket;
}) {
  return (
    <ActivitySection label="TOOL">
      <FieldRow label="Default Ability" hint="Default ability used when rolling a check with this tool. Players can override at roll time.">
        <SingleSelectSearch
          value={formData.abilityId || ''}
          onChange={(val) => setFormData((prev: any) => ({ ...prev, abilityId: val }))}
          options={[
            { id: '', name: '— none —' },
            ...profs.abilities.map((a) => ({ id: a.id, name: a.name || a.identifier })),
            // Foundry-style short slugs as a fallback when the
            // attributes table is sparse.
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
          onChange={(e) => setFormData((prev: any) => ({ ...prev, bonus: e.target.value }))}
          className="bg-background/50 border-gold/10 text-xs font-mono"
          placeholder="+1"
        />
      </FieldRow>
      <FieldRow label="Chat Flavor" hint="Short flavor line that prepends the chat card when the tool is used.">
        <Input
          value={formData.chatFlavor || ''}
          onChange={(e) => setFormData((prev: any) => ({ ...prev, chatFlavor: e.target.value }))}
          className="bg-background/50 border-gold/10"
          placeholder="Tinkering away..."
        />
      </FieldRow>
    </ActivitySection>
  );
}

function ContainerItemFields({
  formData,
  setFormData,
}: {
  formData: any;
  setFormData: React.Dispatch<React.SetStateAction<any>>;
}) {
  const capacity = formData.capacity || { type: 'items', value: 0, units: 'lb' };
  const currency = formData.currency || { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };

  const updateCapacity = (patch: Record<string, any>) => {
    setFormData((prev: any) => ({
      ...prev,
      capacity: { ...capacity, ...patch },
    }));
  };

  const updateCurrency = (coin: string, val: number) => {
    setFormData((prev: any) => ({
      ...prev,
      currency: { ...currency, [coin]: val },
    }));
  };

  return (
    <>
      <ActivitySection label="CONTAINER · CAPACITY">
        <FieldRow label="Capacity Type" hint="Item-count caps how many objects fit; weight-based limits total weight carried.">
          <SingleSelectSearch
            value={capacity.type || 'items'}
            onChange={(val) => updateCapacity({ type: val })}
            options={CAPACITY_TYPES.map(([v, l]) => ({ id: v, name: l }))}
            triggerClassName="w-full"
          />
        </FieldRow>
        <FieldRow label="Capacity Value">
          <div className="flex gap-1">
            <Input
              type="number"
              min={0}
              value={capacity.value ?? 0}
              onChange={(e) => updateCapacity({ value: parseFloat(e.target.value) || 0 })}
              className="bg-background/50 border-gold/10 flex-1"
            />
            {capacity.type === 'weight' && (
              <SingleSelectSearch
                value={capacity.units || 'lb'}
                onChange={(val) => updateCapacity({ units: val })}
                options={CAPACITY_WEIGHT_UNITS.map(([v, l]) => ({ id: v, name: l }))}
                triggerClassName="w-20"
              />
            )}
          </div>
        </FieldRow>
        <FieldRow label="Weightless Contents" hint="If true, items inside don't count toward the carrier's encumbrance (Bag of Holding)." inline>
          <Checkbox
            checked={!!capacity.weightlessContents}
            onCheckedChange={(checked) => updateCapacity({ weightlessContents: !!checked })}
          />
        </FieldRow>
      </ActivitySection>

      <ActivitySection label="CONTAINER · CURRENCY">
        <div className="py-2">
          <p className="text-[10px] text-ink/40 mb-2">
            Pre-filled coins inside this container (e.g. a chest in a
            dungeon). Foundry's 5-coin grid.
          </p>
          <div className="grid grid-cols-5 gap-2">
            {DENOMINATIONS.map(([coin, label]) => (
              <div key={coin} className="space-y-1">
                <Label className="text-[9px] uppercase tracking-widest text-ink/40 text-center block">{label}</Label>
                <Input
                  type="number"
                  min={0}
                  value={(currency as any)[coin] ?? 0}
                  onChange={(e) => updateCurrency(coin, parseInt(e.target.value || '0', 10) || 0)}
                  className="bg-background/50 border-gold/10 text-center text-xs"
                />
              </div>
            ))}
          </div>
        </div>
      </ActivitySection>
    </>
  );
}
