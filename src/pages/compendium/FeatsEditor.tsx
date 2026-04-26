import React from 'react';
import { Scroll } from 'lucide-react';
import DevelopmentCompendiumManager from '../../components/compendium/DevelopmentCompendiumManager';
import { Checkbox } from '../../components/ui/checkbox';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';

const FEAT_TYPES = [
  ['general', 'General'],
  ['origin', 'Origin'],
  ['fightingStyle', 'Fighting Style'],
  ['epicBoon', 'Epic Boon'],
  ['classFeature', 'Class Feature Style']
];

export default function FeatsEditor({ userProfile }: { userProfile: any }) {
  return (
    <DevelopmentCompendiumManager
      userProfile={userProfile}
      collectionName="feats"
      title="Feat Manager"
      singularLabel="Feat"
      icon={Scroll}
      backPath="/compendium"
      description="Admin-only drafting surface for feat-style items. This follows the Foundry feat model: feat identity and requirements at the root, with activities and effects used only when the feat is mechanically active."
      defaultData={{
        name: '',
        identifier: '',
        imageUrl: '',
        description: '',
        activities: [],
        effectsStr: '[]',
        requirements: '',
        featType: 'general',
        repeatable: false,
        sourceType: 'feat',
        uses: {
          max: '',
          spent: 0
        }
      }}
      renderSpecificFields={(formData, setFormData) => (
        <div className="space-y-4 border border-gold/10 rounded-md p-4 bg-background/20">
          <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-gold">Foundry Feat Shell</h3>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-xs font-bold uppercase tracking-widest text-ink/40">Feat Type</Label>
              <select
                value={formData.featType || 'general'}
                onChange={e => setFormData(prev => ({ ...prev, featType: e.target.value }))}
                className="w-full h-10 px-3 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-sm"
              >
                {FEAT_TYPES.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-bold uppercase tracking-widest text-ink/40">Source Type</Label>
              <select
                value={formData.sourceType || 'feat'}
                onChange={e => setFormData(prev => ({ ...prev, sourceType: e.target.value }))}
                className="w-full h-10 px-3 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-sm"
              >
                <option value="feat">Feat</option>
                <option value="classFeature">Class Feature</option>
                <option value="subclassFeature">Subclass Feature</option>
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs font-bold uppercase tracking-widest text-ink/40">Requirements</Label>
            <Input
              value={formData.requirements || ''}
              onChange={e => setFormData(prev => ({ ...prev, requirements: e.target.value }))}
              className="bg-background/50 border-gold/10 focus:border-gold"
              placeholder="The ability to cast at least one spell"
            />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <label className="flex items-center justify-between gap-3 border border-gold/10 rounded-md p-3">
              <span className="text-xs font-bold uppercase tracking-widest text-ink/60">Repeatable</span>
              <Checkbox
                checked={!!formData.repeatable}
                onCheckedChange={checked => setFormData(prev => ({ ...prev, repeatable: !!checked }))}
              />
            </label>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="text-xs font-bold uppercase tracking-widest text-ink/40">Uses Max</Label>
                <Input
                  value={formData.uses?.max || ''}
                  onChange={e => setFormData(prev => ({
                    ...prev,
                    uses: { ...(prev.uses || {}), max: e.target.value }
                  }))}
                  className="bg-background/50 border-gold/10 focus:border-gold"
                  placeholder="@prof"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-bold uppercase tracking-widest text-ink/40">Uses Spent</Label>
                <Input
                  type="number"
                  min={0}
                  value={formData.uses?.spent ?? 0}
                  onChange={e => setFormData(prev => ({
                    ...prev,
                    uses: { ...(prev.uses || {}), spent: parseInt(e.target.value || '0', 10) || 0 }
                  }))}
                  className="bg-background/50 border-gold/10 focus:border-gold"
                />
              </div>
            </div>
          </div>
          <p className="text-[10px] text-ink/40">
            This is for general feats first. Class and subclass features still primarily travel through the class feature pipeline, even though they import as Foundry `feat` items.
          </p>
        </div>
      )}
      summarizeEntry={(entry) => (
        <div className="space-y-1">
          <div>{entry.featType || 'general'} feat</div>
          <div className="text-[10px] text-ink/50">
            {(entry.automation?.activities || []).length || 0} activities
            {entry.requirements ? ' • requirements set' : ''}
            {entry.repeatable ? ' • repeatable' : ''}
          </div>
        </div>
      )}
      normalizeBeforeSave={(formData) => ({
        sourceType: formData.sourceType || 'feat',
        type: 'feat'
      })}
    />
  );
}
