import React from 'react';
import { Wand2 } from 'lucide-react';
import DevelopmentCompendiumManager from '../../components/compendium/DevelopmentCompendiumManager';
import { Checkbox } from '../../components/ui/checkbox';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';

const SPELL_SCHOOLS = [
  ['abj', 'Abjuration'],
  ['con', 'Conjuration'],
  ['div', 'Divination'],
  ['enc', 'Enchantment'],
  ['evo', 'Evocation'],
  ['ill', 'Illusion'],
  ['nec', 'Necromancy'],
  ['trs', 'Transmutation']
];

const PREPARATION_MODES = [
  ['prepared', 'Prepared'],
  ['always', 'Always'],
  ['atwill', 'At-Will'],
  ['innate', 'Innate'],
  ['pact', 'Pact']
];

export default function SpellsEditor({ userProfile }: { userProfile: any }) {
  return (
    <DevelopmentCompendiumManager
      userProfile={userProfile}
      collectionName="spells"
      title="Spell Manager"
      singularLabel="Spell"
      icon={Wand2}
      backPath="/compendium"
      description="Admin-only drafting surface for Foundry-facing spells. This stays close to the native dnd5e spell shell: spell metadata at the root, activities for runtime behavior, and effects for persistent state."
      defaultData={{
        name: '',
        identifier: '',
        imageUrl: '',
        description: '',
        activities: [],
        effectsStr: '[]',
        level: 0,
        school: 'evo',
        preparationMode: 'prepared',
        ritual: false,
        concentration: false,
        components: {
          vocal: true,
          somatic: true,
          material: false,
          materialText: '',
          consumed: false,
          cost: ''
        }
      }}
      renderSpecificFields={(formData, setFormData) => (
        <div className="space-y-4 border border-gold/10 rounded-md p-4 bg-background/20">
          <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-gold">Foundry Spell Shell</h3>
          <div className="grid md:grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label className="text-xs font-bold uppercase tracking-widest text-ink/40">Level</Label>
              <Input
                type="number"
                min={0}
                max={9}
                value={formData.level ?? 0}
                onChange={e => setFormData(prev => ({ ...prev, level: parseInt(e.target.value || '0', 10) || 0 }))}
                className="bg-background/50 border-gold/10 focus:border-gold"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-bold uppercase tracking-widest text-ink/40">School</Label>
              <select
                value={formData.school || 'evo'}
                onChange={e => setFormData(prev => ({ ...prev, school: e.target.value }))}
                className="w-full h-10 px-3 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-sm"
              >
                {SPELL_SCHOOLS.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-bold uppercase tracking-widest text-ink/40">Preparation Mode</Label>
              <select
                value={formData.preparationMode || 'prepared'}
                onChange={e => setFormData(prev => ({ ...prev, preparationMode: e.target.value }))}
                className="w-full h-10 px-3 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-sm"
              >
                {PREPARATION_MODES.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <label className="flex items-center justify-between gap-3 border border-gold/10 rounded-md p-3">
              <span className="text-xs font-bold uppercase tracking-widest text-ink/60">Ritual</span>
              <Checkbox
                checked={!!formData.ritual}
                onCheckedChange={checked => setFormData(prev => ({ ...prev, ritual: !!checked }))}
              />
            </label>
            <label className="flex items-center justify-between gap-3 border border-gold/10 rounded-md p-3">
              <span className="text-xs font-bold uppercase tracking-widest text-ink/60">Concentration</span>
              <Checkbox
                checked={!!formData.concentration}
                onCheckedChange={checked => setFormData(prev => ({ ...prev, concentration: !!checked }))}
              />
            </label>
          </div>

          <div className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-widest text-ink/60">Components</h4>
            <div className="grid md:grid-cols-3 gap-4">
              <label className="flex items-center justify-between gap-3 border border-gold/10 rounded-md p-3">
                <span className="text-xs uppercase text-ink/60 font-bold">Verbal</span>
                <Checkbox
                  checked={!!formData.components?.vocal}
                  onCheckedChange={checked => setFormData(prev => ({
                    ...prev,
                    components: { ...(prev.components || {}), vocal: !!checked }
                  }))}
                />
              </label>
              <label className="flex items-center justify-between gap-3 border border-gold/10 rounded-md p-3">
                <span className="text-xs uppercase text-ink/60 font-bold">Somatic</span>
                <Checkbox
                  checked={!!formData.components?.somatic}
                  onCheckedChange={checked => setFormData(prev => ({
                    ...prev,
                    components: { ...(prev.components || {}), somatic: !!checked }
                  }))}
                />
              </label>
              <label className="flex items-center justify-between gap-3 border border-gold/10 rounded-md p-3">
                <span className="text-xs uppercase text-ink/60 font-bold">Material</span>
                <Checkbox
                  checked={!!formData.components?.material}
                  onCheckedChange={checked => setFormData(prev => ({
                    ...prev,
                    components: { ...(prev.components || {}), material: !!checked }
                  }))}
                />
              </label>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="text-xs font-bold uppercase tracking-widest text-ink/40">Material Text</Label>
                <Input
                  value={formData.components?.materialText || ''}
                  onChange={e => setFormData(prev => ({
                    ...prev,
                    components: { ...(prev.components || {}), materialText: e.target.value }
                  }))}
                  className="bg-background/50 border-gold/10 focus:border-gold"
                  placeholder="a tiny ball of bat guano and sulfur"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <label className="flex items-center justify-between gap-3 border border-gold/10 rounded-md p-3">
                  <span className="text-xs uppercase text-ink/60 font-bold">Consumed</span>
                  <Checkbox
                    checked={!!formData.components?.consumed}
                    onCheckedChange={checked => setFormData(prev => ({
                      ...prev,
                      components: { ...(prev.components || {}), consumed: !!checked }
                    }))}
                  />
                </label>
                <div className="space-y-1">
                  <Label className="text-xs font-bold uppercase tracking-widest text-ink/40">Cost</Label>
                  <Input
                    value={formData.components?.cost || ''}
                    onChange={e => setFormData(prev => ({
                      ...prev,
                      components: { ...(prev.components || {}), cost: e.target.value }
                    }))}
                    className="bg-background/50 border-gold/10 focus:border-gold"
                    placeholder="100 gp"
                  />
                </div>
              </div>
            </div>
            <p className="text-[10px] text-ink/40">
              Spell metadata should stay lightweight here. Runtime behavior should live in native-style activities below.
            </p>
          </div>
        </div>
      )}
      summarizeEntry={(entry) => (
        <div className="space-y-1">
          <div>{`Level ${entry.level ?? 0} ${String(entry.school || '').toUpperCase()}`}</div>
          <div className="text-[10px] text-ink/50">
            {(entry.automation?.activities || []).length || 0} activities
            {entry.ritual ? ' • Ritual' : ''}
            {entry.concentration ? ' • Concentration' : ''}
          </div>
        </div>
      )}
      normalizeBeforeSave={(formData) => ({
        level: Number(formData.level || 0),
        sourceType: 'spell',
        type: 'spell'
      })}
    />
  );
}
