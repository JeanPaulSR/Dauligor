import React, { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronLeft, Castle } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { Button } from '../../components/ui/button';
import DevelopmentCompendiumManager from '../../components/compendium/DevelopmentCompendiumManager';
import { Checkbox } from '../../components/ui/checkbox';
import { Input } from '../../components/ui/input';
import { ActivitySection, FieldRow } from '../../components/compendium/activity/primitives';
import SingleSelectSearch from '../../components/ui/SingleSelectSearch';

/**
 * Facilities (Bastions) — separate from items per migration
 * 20260526-2000. Mirrors ItemsEditor's outer-shell + manual-editor
 * pattern but skips the Foundry-Import tab for now: the importer
 * routing for facilities is C7-follow-up work, not landed yet.
 *
 * The editor body is a thin DevelopmentCompendiumManager delegate.
 * The order dropdown drives a conditional sub-block (Craft / Trade /
 * generic Progress) — same pattern as the dynamic ItemsEditor's
 * type-dispatch. Defenders + hirelings stay as raw UUID arrays for
 * now because there's no actor picker on the admin side; the
 * character sheet rewrite will close that gap.
 */

// ─── Vocabularies (mirror CONFIG.DND5E.facilities in dnd5e v5) ────

const FACILITY_TYPES: [string, string][] = [
  ['basic', 'Basic Facility'],
  ['special', 'Special Facility'],
];

const FACILITY_SIZES: [string, string][] = [
  ['cramped', 'Cramped (4 sq, 500gp, 20d)'],
  ['roomy', 'Roomy (16 sq, 1000gp, 45d)'],
  ['vast', 'Vast (36 sq, 3000gp, 125d)'],
];

const FACILITY_BASIC_SUBTYPES: [string, string][] = [
  ['bedroom', 'Bedroom'],
  ['courtyard', 'Courtyard'],
  ['diningRoom', 'Dining Room'],
  ['kitchen', 'Kitchen'],
  ['parlor', 'Parlor'],
  ['storage', 'Storage'],
];

const FACILITY_SPECIAL_SUBTYPES: [string, string][] = [
  ['archive', 'Archive'],
  ['arcaneStudy', 'Arcane Study'],
  ['armory', 'Armory'],
  ['barrack', 'Barrack'],
  ['demiplane', 'Demiplane'],
  ['garden', 'Garden'],
  ['gamingHall', 'Gaming Hall'],
  ['greenhouse', 'Greenhouse'],
  ['guildhall', 'Guildhall'],
  ['laboratory', 'Laboratory'],
  ['library', 'Library'],
  ['meditationChamber', 'Meditation Chamber'],
  ['menagerie', 'Menagerie'],
  ['observatory', 'Observatory'],
  ['pub', 'Pub'],
  ['reliquary', 'Reliquary'],
  ['sacristy', 'Sacristy'],
  ['sanctum', 'Sanctum'],
  ['scriptorium', 'Scriptorium'],
  ['smithy', 'Smithy'],
  ['stable', 'Stable'],
  ['storehouse', 'Storehouse'],
  ['teleportationCircle', 'Teleportation Circle'],
  ['theater', 'Theater'],
  ['trainingArea', 'Training Area'],
  ['trophyRoom', 'Trophy Room'],
  ['warRoom', 'War Room'],
  ['workshop', 'Workshop'],
];

const FACILITY_ORDERS: [string, string][] = [
  ['', '— No active order —'],
  ['build', 'Build'],
  ['change', 'Change'],
  ['craft', 'Craft'],
  ['empower', 'Empower'],
  ['enlarge', 'Enlarge'],
  ['harvest', 'Harvest'],
  ['maintain', 'Maintain'],
  ['recruit', 'Recruit'],
  ['repair', 'Repair (forced when disabled)'],
  ['research', 'Research'],
  ['trade', 'Trade'],
];

// ─── Page shell ────────────────────────────────────────────────────

export default function FacilitiesEditor({ userProfile }: { userProfile: any }) {
  const location = useLocation();
  const isProposalRoute = location.pathname.startsWith('/proposals/edit/');
  const backPath = isProposalRoute ? '/my-proposals' : '/compendium/facilities';
  const backLabel = isProposalRoute ? 'Back to My Proposals' : 'Back to Facilities';

  useEffect(() => {
    document.body.classList.add('spell-list-fullscreen');
    return () => document.body.classList.remove('spell-list-fullscreen');
  }, []);

  return (
    <Tabs defaultValue="manual-editor" className="h-[calc(100vh-4rem)] flex flex-col gap-2 p-2">
      <div className="shrink-0 flex items-center gap-2 bg-card p-2 rounded-lg border border-gold/15 shadow-sm flex-wrap">
        <Link to={backPath}>
          <Button variant="ghost" size="sm" className="h-8 text-gold gap-2 hover:bg-gold/5">
            <ChevronLeft className="w-4 h-4" />
            {backLabel}
          </Button>
        </Link>
        <TabsList variant="line" className="gap-1 bg-transparent p-0">
          <TabsTrigger
            value="manual-editor"
            className="h-8 rounded-md border border-gold/15 bg-background/30 px-3 py-1 text-xs uppercase tracking-[0.18em] text-ink/65 data-active:border-gold/45 data-active:bg-gold/15 data-active:text-gold"
          >
            Manual Editor
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="manual-editor" className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
        <FacilityManualEditor userProfile={userProfile} />
      </TabsContent>
    </Tabs>
  );
}

// ─── Manual editor ─────────────────────────────────────────────────

function FacilityManualEditor({ userProfile }: { userProfile: any }) {
  return (
    <DevelopmentCompendiumManager
      userProfile={userProfile}
      collectionName="facilities"
      title="Facility Manager"
      singularLabel="Facility"
      icon={Castle}
      backPath="/compendium/facilities"
      description="Bastion facilities — 2024 DMG. The order dropdown drives a conditional sub-block (Craft / Trade / generic Progress); state across orders is preserved so authors can flip back and forth without re-entering JSON."
      defaultData={{
        // Identity (rendered by the outer shell)
        name: '',
        identifier: '',
        imageUrl: '',
        description: '',
        activities: [],
        effectsStr: '[]',

        // Type discriminators
        facilityType: 'basic',
        facilitySubtype: '',

        // Sizing + level
        size: 'cramped',
        level: 5,

        // Build state (booleans)
        built: false,
        free: false,
        disabled: false,
        enlargeable: false,

        // Active order + per-order state
        facilityOrder: '',
        progress: null,    // {value, max, order}
        trade: null,       // {creatures, profit, stock, pending}
        craft: null,       // {item, quantity}
        defenders: null,   // {value: uuid[], max}
        hirelings: null,   // {value: uuid[], max}
      }}
      renderSpecificFields={(formData, setFormData) => (
        <FacilityFields formData={formData} setFormData={setFormData} />
      )}
      summarizeEntry={(entry) => (
        <div className="space-y-1">
          <div>
            {entry.facilityType || 'basic'} facility
            {entry.size ? ` · ${entry.size}` : ''}
          </div>
          <div className="text-[10px] text-ink/55">
            level {entry.level ?? 5}
            {entry.facilityOrder ? ` • order: ${entry.facilityOrder}` : ''}
            {entry.built ? ' • built' : ' • not built'}
          </div>
        </div>
      )}
    />
  );
}

// ─── Form body ────────────────────────────────────────────────────

function FacilityFields({
  formData,
  setFormData,
}: {
  formData: any;
  setFormData: React.Dispatch<React.SetStateAction<any>>;
}) {
  const facilityType: string = formData.facilityType || 'basic';
  const subtypeOptions = facilityType === 'special'
    ? FACILITY_SPECIAL_SUBTYPES
    : FACILITY_BASIC_SUBTYPES;
  const order: string = formData.facilityOrder || '';

  return (
    <div className="space-y-4">
      <TypeSection
        formData={formData}
        setFormData={setFormData}
        subtypeOptions={subtypeOptions}
      />
      <SizingSection formData={formData} setFormData={setFormData} />
      <StateSection formData={formData} setFormData={setFormData} />
      <OrderSection formData={formData} setFormData={setFormData} />

      {order === 'craft' && <CraftSection formData={formData} setFormData={setFormData} />}
      {order === 'trade' && <TradeSection formData={formData} setFormData={setFormData} />}

      <RosterSection
        formData={formData}
        setFormData={setFormData}
        kind="defenders"
      />
      <RosterSection
        formData={formData}
        setFormData={setFormData}
        kind="hirelings"
      />
    </div>
  );
}

function TypeSection({
  formData,
  setFormData,
  subtypeOptions,
}: {
  formData: any;
  setFormData: React.Dispatch<React.SetStateAction<any>>;
  subtypeOptions: [string, string][];
}) {
  return (
    <ActivitySection label="TYPE">
      <FieldRow label="Facility Type" hint="Basic = essential rooms (kitchen / bedroom). Special = adventuring-tier rooms (smithy / library / sanctum).">
        <SingleSelectSearch
          value={formData.facilityType || 'basic'}
          onChange={(val) => setFormData((prev: any) => ({
            ...prev,
            facilityType: val,
            // Subtype vocabularies don't overlap — reset on type change
            // to avoid stale subtype slugs that aren't in the new list.
            facilitySubtype: '',
          }))}
          options={FACILITY_TYPES.map(([v, l]) => ({ id: v, name: l }))}
          triggerClassName="w-full"
        />
      </FieldRow>
      <FieldRow label="Specific Subtype" hint="The catalog row this facility represents — kitchen, smithy, etc.">
        <SingleSelectSearch
          value={formData.facilitySubtype || ''}
          onChange={(val) => setFormData((prev: any) => ({ ...prev, facilitySubtype: val }))}
          options={[
            { id: '', name: '— pick one —' },
            ...subtypeOptions.map(([v, l]) => ({ id: v, name: l })),
          ]}
          triggerClassName="w-full"
        />
      </FieldRow>
    </ActivitySection>
  );
}

function SizingSection({
  formData,
  setFormData,
}: {
  formData: any;
  setFormData: React.Dispatch<React.SetStateAction<any>>;
}) {
  return (
    <ActivitySection label="SIZING">
      <FieldRow label="Size" hint="Drives footprint, price, and construction time per the 2024 DMG.">
        <SingleSelectSearch
          value={formData.size || 'cramped'}
          onChange={(val) => setFormData((prev: any) => ({ ...prev, size: val }))}
          options={FACILITY_SIZES.map(([v, l]) => ({ id: v, name: l }))}
          triggerClassName="w-full"
        />
      </FieldRow>
      <FieldRow label="Required Character Level" hint="Special facilities unlock at level 9/13/17; basic facilities at 5+.">
        <Input
          type="number"
          min={1}
          max={20}
          value={formData.level ?? 5}
          onChange={(e) => setFormData((prev: any) => ({
            ...prev,
            level: parseInt(e.target.value || '5', 10) || 5,
          }))}
          className="bg-background/50 border-gold/15"
        />
      </FieldRow>
    </ActivitySection>
  );
}

function StateSection({
  formData,
  setFormData,
}: {
  formData: any;
  setFormData: React.Dispatch<React.SetStateAction<any>>;
}) {
  return (
    <ActivitySection label="STATE">
      <FieldRow label="Built" hint="Has the structure physically been constructed?" inline>
        <Checkbox
          checked={!!formData.built}
          onCheckedChange={(checked) => setFormData((prev: any) => ({ ...prev, built: !!checked }))}
        />
      </FieldRow>
      <FieldRow label="Free" hint="Granted at no cost (e.g. starting bastion facilities at level 5)." inline>
        <Checkbox
          checked={!!formData.free}
          onCheckedChange={(checked) => setFormData((prev: any) => ({ ...prev, free: !!checked }))}
        />
      </FieldRow>
      <FieldRow label="Disabled" hint="Damaged — forces the active order to 'repair' until cleared." inline>
        <Checkbox
          checked={!!formData.disabled}
          onCheckedChange={(checked) => setFormData((prev: any) => ({ ...prev, disabled: !!checked }))}
        />
      </FieldRow>
      <FieldRow label="Enlargeable" hint="Can be upgraded to a larger size (Cramped → Roomy → Vast)." inline>
        <Checkbox
          checked={!!formData.enlargeable}
          onCheckedChange={(checked) => setFormData((prev: any) => ({ ...prev, enlargeable: !!checked }))}
        />
      </FieldRow>
    </ActivitySection>
  );
}

function OrderSection({
  formData,
  setFormData,
}: {
  formData: any;
  setFormData: React.Dispatch<React.SetStateAction<any>>;
}) {
  const progress = formData.progress || { value: 0, max: 0, order: '' };
  const updateProgress = (patch: Record<string, any>) => {
    setFormData((prev: any) => ({
      ...prev,
      progress: { ...progress, ...patch },
    }));
  };

  return (
    <ActivitySection label="ACTIVE ORDER">
      <FieldRow label="Order" hint="Reveals a Craft or Trade sub-block when applicable. 'Repair' is auto-applied when Disabled is on.">
        <SingleSelectSearch
          value={formData.facilityOrder || ''}
          onChange={(val) => setFormData((prev: any) => ({
            ...prev,
            facilityOrder: val,
            progress: val
              ? { ...(progress || {}), order: val }
              : null,
          }))}
          options={FACILITY_ORDERS.map(([v, l]) => ({ id: v, name: l }))}
          triggerClassName="w-full"
        />
      </FieldRow>
      {formData.facilityOrder && (
        <>
          <FieldRow label="Progress Value" hint="Days already invested toward this order.">
            <Input
              type="number"
              min={0}
              value={progress.value ?? 0}
              onChange={(e) => updateProgress({ value: parseInt(e.target.value || '0', 10) || 0 })}
              className="bg-background/50 border-gold/15"
            />
          </FieldRow>
          <FieldRow label="Progress Max" hint="Total days required to complete this order.">
            <Input
              type="number"
              min={0}
              value={progress.max ?? 0}
              onChange={(e) => updateProgress({ max: parseInt(e.target.value || '0', 10) || 0 })}
              className="bg-background/50 border-gold/15"
            />
          </FieldRow>
        </>
      )}
    </ActivitySection>
  );
}

function CraftSection({
  formData,
  setFormData,
}: {
  formData: any;
  setFormData: React.Dispatch<React.SetStateAction<any>>;
}) {
  const craft = formData.craft || { item: '', quantity: 1 };
  const update = (patch: Record<string, any>) => {
    setFormData((prev: any) => ({
      ...prev,
      craft: { ...craft, ...patch },
    }));
  };

  return (
    <ActivitySection label="CRAFT ORDER">
      <FieldRow
        label="Item UUID"
        hint="Foundry-side reference to the item being crafted. UUIDs aren't pickable in the admin side; paste from Foundry or leave for later."
      >
        <Input
          value={craft.item || ''}
          onChange={(e) => update({ item: e.target.value })}
          className="bg-background/50 border-gold/15 text-xs font-mono"
          placeholder="Compendium.dnd5e.items.Item.xxxx"
        />
      </FieldRow>
      <FieldRow label="Quantity" hint="How many copies to produce.">
        <Input
          type="number"
          min={1}
          value={craft.quantity ?? 1}
          onChange={(e) => update({ quantity: parseInt(e.target.value || '1', 10) || 1 })}
          className="bg-background/50 border-gold/15"
        />
      </FieldRow>
    </ActivitySection>
  );
}

function TradeSection({
  formData,
  setFormData,
}: {
  formData: any;
  setFormData: React.Dispatch<React.SetStateAction<any>>;
}) {
  const trade = formData.trade || {
    creatures: { value: [], max: 0 },
    profit: 0,
    stock: { stocked: false, value: 0, max: 0 },
    pending: { creatures: [], operation: null, stocked: false, value: 0 },
  };
  const updateTrade = (patch: Record<string, any>) => {
    setFormData((prev: any) => ({
      ...prev,
      trade: { ...trade, ...patch },
    }));
  };
  const stock = trade.stock || { stocked: false, value: 0, max: 0 };
  const updateStock = (patch: Record<string, any>) => {
    updateTrade({ stock: { ...stock, ...patch } });
  };

  return (
    <ActivitySection label="TRADE ORDER">
      <FieldRow label="Daily Profit" hint="Gold pieces earned per day this order is active.">
        <Input
          type="number"
          value={trade.profit ?? 0}
          onChange={(e) => updateTrade({ profit: parseInt(e.target.value || '0', 10) || 0 })}
          className="bg-background/50 border-gold/15"
        />
      </FieldRow>
      <FieldRow label="Stock Stocked" hint="Is there currently a stock to sell?" inline>
        <Checkbox
          checked={!!stock.stocked}
          onCheckedChange={(checked) => updateStock({ stocked: !!checked })}
        />
      </FieldRow>
      <FieldRow label="Stock Value" hint="Current stock value (gp).">
        <Input
          type="number"
          min={0}
          value={stock.value ?? 0}
          onChange={(e) => updateStock({ value: parseInt(e.target.value || '0', 10) || 0 })}
          className="bg-background/50 border-gold/15"
        />
      </FieldRow>
      <FieldRow label="Stock Max" hint="Maximum stock value this facility can hold.">
        <Input
          type="number"
          min={0}
          value={stock.max ?? 0}
          onChange={(e) => updateStock({ max: parseInt(e.target.value || '0', 10) || 0 })}
          className="bg-background/50 border-gold/15"
        />
      </FieldRow>
      <p className="text-[10px] text-ink/45 py-2">
        Creature rosters (trade.creatures / trade.pending.creatures) are
        actor UUIDs — they'll be editable through the character sheet's
        bastion panel once that lands. For now, hand-edit the JSON if
        you need to seed them from a Foundry import.
      </p>
    </ActivitySection>
  );
}

function RosterSection({
  formData,
  setFormData,
  kind,
}: {
  formData: any;
  setFormData: React.Dispatch<React.SetStateAction<any>>;
  kind: 'defenders' | 'hirelings';
}) {
  const roster = formData[kind] || { value: [], max: 0 };
  const value: string[] = Array.isArray(roster.value) ? roster.value : [];
  const label = kind === 'defenders' ? 'DEFENDERS' : 'HIRELINGS';
  const hint = kind === 'defenders'
    ? 'Combat-capable creatures (PC allies, hired soldiers) assigned to defend this facility.'
    : 'Non-combat staff (gardeners, scribes, cooks) tied to the facility.';

  const updateMax = (next: number) => {
    setFormData((prev: any) => ({
      ...prev,
      [kind]: { ...roster, max: next },
    }));
  };

  const updateValueText = (text: string) => {
    // One UUID per line, trimmed and de-duplicated. Empty input clears
    // the array entirely.
    const nextValue = Array.from(new Set(
      text.split('\n').map((line) => line.trim()).filter(Boolean),
    ));
    setFormData((prev: any) => ({
      ...prev,
      [kind]: { ...roster, value: nextValue },
    }));
  };

  return (
    <ActivitySection label={label}>
      <FieldRow label="Maximum" hint={hint}>
        <Input
          type="number"
          min={0}
          value={roster.max ?? 0}
          onChange={(e) => updateMax(parseInt(e.target.value || '0', 10) || 0)}
          className="bg-background/50 border-gold/15"
        />
      </FieldRow>
      <FieldRow
        label="Actor UUIDs"
        hint={`One UUID per line. ${value.length} assigned.`}
      >
        <textarea
          value={value.join('\n')}
          onChange={(e) => updateValueText(e.target.value)}
          className="w-full min-h-[80px] px-3 py-2 rounded-md border border-gold/15 bg-background/50 focus:border-gold outline-none text-xs font-mono"
          placeholder="Compendium.dnd5e.actors.Actor.xxxx"
        />
      </FieldRow>
    </ActivitySection>
  );
}
