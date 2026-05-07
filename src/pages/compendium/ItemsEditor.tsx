import React from 'react';
import { Hammer } from 'lucide-react';
import DevelopmentCompendiumManager from '../../components/compendium/DevelopmentCompendiumManager';
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
const DENOMINATIONS = ['cp', 'sp', 'ep', 'gp', 'pp'];

export default function ItemsEditor({ userProfile }: { userProfile: any }) {
  return (
    <DevelopmentCompendiumManager
      userProfile={userProfile}
      collectionName="items"
      title="Item Manager"
      singularLabel="Item"
      icon={Hammer}
      backPath="/compendium"
      description="Admin-only drafting surface for non-spell items. This is aimed at the Foundry item shell first: structured item metadata at the root, with activities and effects handling runtime use."
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
        weight: '',
        priceValue: '',
        priceDenomination: 'gp',
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

          <div className="grid md:grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label className="text-xs font-bold uppercase tracking-widest text-ink/40">Weight</Label>
              <Input
                value={formData.weight || ''}
                onChange={e => setFormData(prev => ({ ...prev, weight: e.target.value }))}
                className="bg-background/50 border-gold/10 focus:border-gold"
                placeholder="0.5"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-bold uppercase tracking-widest text-ink/40">Price</Label>
              <Input
                value={formData.priceValue || ''}
                onChange={e => setFormData(prev => ({ ...prev, priceValue: e.target.value }))}
                className="bg-background/50 border-gold/10 focus:border-gold"
                placeholder="50"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-bold uppercase tracking-widest text-ink/40">Denomination</Label>
              <select
                value={formData.priceDenomination || 'gp'}
                onChange={e => setFormData(prev => ({ ...prev, priceDenomination: e.target.value }))}
                className="w-full h-10 px-3 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-sm"
              >
                {DENOMINATIONS.map(value => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
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
