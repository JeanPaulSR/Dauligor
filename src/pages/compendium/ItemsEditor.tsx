import React, { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronLeft, Hammer } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { Button } from '../../components/ui/button';
import DevelopmentCompendiumManager from '../../components/compendium/DevelopmentCompendiumManager';
import ItemImportWorkbench from '../../components/compendium/ItemImportWorkbench';
import { Checkbox } from '../../components/ui/checkbox';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';

const ITEM_TYPES = [
  ['weapon', 'Weapon'],
  ['equipment', 'Equipment / Armor'],
  ['consumable', 'Consumable'],
  ['tool', 'Tool'],
  ['loot', 'Loot / Wondrous'],
  ['backpack', 'Container']
];

const RARITIES = ['common', 'uncommon', 'rare', 'veryRare', 'legendary', 'artifact', 'none'];
// Foundry dnd5e v5 `system.price.denomination` vocabulary.
const DENOMINATIONS = ['cp', 'sp', 'ep', 'gp', 'pp'];
// Foundry dnd5e v5 `system.weight.units` vocabulary. Most compendium
// items use `lb` (Imperial pounds); `kg` is supported for tables
// authoring in metric.
const WEIGHT_UNITS = ['lb', 'kg'];

/**
 * Outer page shell — mirrors SpellsEditor + FeatsEditor's tabs
 * structure. Top toolbar carries the Back link + tab switcher; tab
 * content delegates to either `ItemImportWorkbench` (admin bulk
 * import from a Foundry export — routes to weapons/armor/tools/items
 * appropriately) or `ItemManualEditor` (the existing
 * DevelopmentCompendiumManager-driven single-row editor).
 *
 * The fullscreen body class (`spell-list-fullscreen`) is reused for
 * the import workbench because the 1700-item browser needs the
 * full viewport. The manual editor doesn't depend on it.
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

  // `h-[calc(100vh-4rem)]` (navbar = h-16 = 4rem) instead of `h-full`.
  // The global `<main>` is `flex-grow` (not a flex container with a
  // definite height), so `h-full` here can resolve to 0 OR to the
  // page's content height — neither lets internal `overflow-y-auto`
  // scroll cleanly. Explicit viewport-calc gives the Tabs a definite
  // pixel height that the inner flex chain (h-full → flex-1 → min-h-0)
  // can divide reliably. Mirrors TagsExplorer's direct-route pattern.
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
          {/* Foundry Import is admin-only — the multi-table routing
              + bulk-write doesn't fit the single-revision proposal
              shape, so content-creators on the proposal route only
              see the Manual Editor tab. */}
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

      {/* Foundry Import: workbench handles its own internal layout +
          scrolling (filter rail + detail pane scroll independently),
          so this tab content doesn't add an outer scroll. */}
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
      description="Drafting surface for non-spell items. Aimed at the Foundry item shell first: structured item metadata at the root, with activities and effects handling runtime use."
      defaultData={{
        name: '',
        identifier: '',
        imageUrl: '',
        description: '',
        activities: [],
        effectsStr: '[]',
        itemType: 'loot',
        rarity: 'none',
        quantity: 1,
        // Foundry dnd5e v5 stores weight + price as nested objects on
        // `system.weight` and `system.price`. We mirror that shape on
        // the form so the save payload flows through to the JSON
        // columns (items.weight, items.price) without any flattening.
        weight: { value: 0, units: 'lb' },
        price: { value: 0, denomination: 'gp' },
        attunement: false,
        equipped: false,
        identified: true,
        magical: false
      }}
      renderSpecificFields={(formData, setFormData) => (
        <div className="space-y-4 border border-gold/10 rounded-md p-4 bg-background/20">
          <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-gold">Foundry Item Shell</h3>
          <div className="grid md:grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label className="text-xs font-bold uppercase tracking-widest text-ink/40">Item Type</Label>
              <select
                value={formData.itemType || 'loot'}
                onChange={e => setFormData(prev => ({ ...prev, itemType: e.target.value }))}
                className="w-full h-10 px-3 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-sm"
              >
                {ITEM_TYPES.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-bold uppercase tracking-widest text-ink/40">Rarity</Label>
              <select
                value={formData.rarity || 'none'}
                onChange={e => setFormData(prev => ({ ...prev, rarity: e.target.value }))}
                className="w-full h-10 px-3 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-sm"
              >
                {RARITIES.map(value => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-bold uppercase tracking-widest text-ink/40">Quantity</Label>
              <Input
                type="number"
                min={0}
                value={formData.quantity ?? 1}
                onChange={e => setFormData(prev => ({ ...prev, quantity: parseInt(e.target.value || '0', 10) || 0 }))}
                className="bg-background/50 border-gold/10 focus:border-gold"
              />
            </div>
          </div>

          {/* Weight + Price authored as 2x2 micro-grids: value + units
              pair side-by-side under each label so the form matches
              Foundry's nested {value, units}/{value, denomination}
              shape exactly. */}
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-xs font-bold uppercase tracking-widest text-ink/40">Weight</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  step="0.1"
                  value={formData.weight?.value ?? 0}
                  onChange={e => setFormData(prev => ({
                    ...prev,
                    weight: { value: parseFloat(e.target.value) || 0, units: prev.weight?.units || 'lb' },
                  }))}
                  className="bg-background/50 border-gold/10 focus:border-gold"
                  placeholder="0.5"
                />
                <select
                  value={formData.weight?.units || 'lb'}
                  onChange={e => setFormData(prev => ({
                    ...prev,
                    weight: { value: prev.weight?.value ?? 0, units: e.target.value },
                  }))}
                  className="h-10 px-3 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-sm w-20"
                >
                  {WEIGHT_UNITS.map(value => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-bold uppercase tracking-widest text-ink/40">Price</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  step="1"
                  value={formData.price?.value ?? 0}
                  onChange={e => setFormData(prev => ({
                    ...prev,
                    price: { value: parseFloat(e.target.value) || 0, denomination: prev.price?.denomination || 'gp' },
                  }))}
                  className="bg-background/50 border-gold/10 focus:border-gold"
                  placeholder="50"
                />
                <select
                  value={formData.price?.denomination || 'gp'}
                  onChange={e => setFormData(prev => ({
                    ...prev,
                    price: { value: prev.price?.value ?? 0, denomination: e.target.value },
                  }))}
                  className="h-10 px-3 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-sm w-20"
                >
                  {DENOMINATIONS.map(value => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <label className="flex items-center justify-between gap-3 border border-gold/10 rounded-md p-3">
              <span className="text-xs font-bold uppercase tracking-widest text-ink/60">Requires Attunement</span>
              <Checkbox
                checked={!!formData.attunement}
                onCheckedChange={checked => setFormData(prev => ({ ...prev, attunement: !!checked }))}
              />
            </label>
            <label className="flex items-center justify-between gap-3 border border-gold/10 rounded-md p-3">
              <span className="text-xs font-bold uppercase tracking-widest text-ink/60">Magical</span>
              <Checkbox
                checked={!!formData.magical}
                onCheckedChange={checked => setFormData(prev => ({ ...prev, magical: !!checked }))}
              />
            </label>
            <label className="flex items-center justify-between gap-3 border border-gold/10 rounded-md p-3">
              <span className="text-xs font-bold uppercase tracking-widest text-ink/60">Equipped By Default</span>
              <Checkbox
                checked={!!formData.equipped}
                onCheckedChange={checked => setFormData(prev => ({ ...prev, equipped: !!checked }))}
              />
            </label>
            <label className="flex items-center justify-between gap-3 border border-gold/10 rounded-md p-3">
              <span className="text-xs font-bold uppercase tracking-widest text-ink/60">Identified By Default</span>
              <Checkbox
                checked={!!formData.identified}
                onCheckedChange={checked => setFormData(prev => ({ ...prev, identified: !!checked }))}
              />
            </label>
          </div>
          <p className="text-[10px] text-ink/40">
            Keep item mechanics structured. If the item can be used, consumed, rolled, or toggled, that behavior should move into activities and effects instead of raw description text.
          </p>
        </div>
      )}
      summarizeEntry={(entry) => (
        <div className="space-y-1">
          <div>{entry.itemType || 'loot'} item</div>
          <div className="text-[10px] text-ink/50">
            {(entry.automation?.activities || []).length || 0} activities
            {entry.rarity && entry.rarity !== 'none' ? ` • ${entry.rarity}` : ''}
            {entry.attunement ? ' • attunement' : ''}
          </div>
        </div>
      )}
    />
  );
}
