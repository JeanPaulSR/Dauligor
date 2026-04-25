import React from 'react';
import { Shield, Sword, Hammer, MessageCircle, Check } from 'lucide-react';
import { Input } from '../../components/ui/input';
import { Button } from '../../components/ui/button';
import { Link } from 'react-router-dom';

interface ProficienciesEditorProps {
  proficiencies: any;
  setProficiencies: (val: any) => void;
  allAttributes: any[];
  allArmorCategories: any[];
  allArmor: any[];
  groupedArmor: Record<string, any[]>;
  allWeaponCategories: any[];
  allWeapons: any[];
  groupedWeapons: Record<string, any[]>;
  allTools: any[];
  groupedTools: Record<string, any[]>;
  allSkills: any[];
  groupedSkills: Record<string, any[]>;
  allLanguageCategories: any[];
  allLanguages: any[];
  groupedLanguages: Record<string, any[]>;
}

export default function ProficienciesEditor({
  proficiencies,
  setProficiencies,
  allAttributes,
  allArmorCategories,
  allArmor,
  groupedArmor,
  allWeaponCategories,
  allWeapons,
  groupedWeapons,
  allTools,
  groupedTools,
  allSkills,
  groupedSkills,
  allLanguageCategories,
  allLanguages,
  groupedLanguages
}: ProficienciesEditorProps) {

  const toggleGroup = (items: any[], type: 'armor' | 'weapons' | 'tools' | 'languages', target: 'fixedIds' | 'optionIds', categoryId?: string) => {
    const currentIds = new Set(proficiencies[type][target] || []);
    const allExist = items.every(item => currentIds.has(item.id));
    
    let nextIds: string[];
    const castIds = currentIds as Set<string>;
    if (allExist) {
      nextIds = Array.from(castIds).filter(id => !items.find(item => item.id === id));
    } else {
      nextIds = Array.from(new Set([...Array.from(castIds), ...items.map(item => item.id)]));
    }

    // If adding to one, remove from other
    const otherTarget = target === 'fixedIds' ? 'optionIds' : 'fixedIds';
    let nextOtherIds = proficiencies[type][otherTarget] || [];
    if (!allExist) {
      nextOtherIds = nextOtherIds.filter((id: string) => !items.find(item => item.id === id));
    }

    const currentCatIds = proficiencies[type].categoryIds || [];
    let nextCatIds = currentCatIds;

    if (categoryId) {
      if (!allExist) {
        if (!nextCatIds.includes(categoryId)) {
          nextCatIds = [...nextCatIds, categoryId];
        }
      } else {
        nextCatIds = nextCatIds.filter((id: string) => id !== categoryId);
      }
    }

    setProficiencies({
      ...proficiencies,
      [type]: {
        ...proficiencies[type],
        [target]: nextIds,
        [otherTarget]: nextOtherIds,
        categoryIds: nextCatIds
      }
    });
  };

  // I will now replace this with the entire JSX.
  return (
    <div className="space-y-8">
      {/* Saving Throws Section */}
      <div className="space-y-4">
        <div className="section-header">
          <h3 className="field-label flex items-center gap-2">
            <Shield className="w-3.5 h-3.5 text-gold/40" /> Saving Throws
          </h3>
          <div className="flex items-center gap-2">
            <label className="field-label opacity-70">Choices:</label>
            <Input 
              type="number"
              value={proficiencies.savingThrows?.choiceCount || 0}
              onChange={e => setProficiencies({
                ...proficiencies,
                savingThrows: { ...proficiencies.savingThrows, choiceCount: parseInt(e.target.value) || 0 }
              })}
              className="w-12 h-6 text-center text-xs bg-background/50 border-gold/10"
            />
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="section-label text-gold/60">Choice Options</label>
            <div className="flex flex-wrap gap-2">
              {allAttributes.map(attr => {
                const iden = (attr.identifier || attr.id).toUpperCase();
                const isSelected = proficiencies.savingThrows?.optionIds?.includes(iden);
                return (
                  <button
                    key={attr.id}
                    type="button"
                    onClick={() => {
                      const currentOptions = proficiencies.savingThrows?.optionIds || [];
                      setProficiencies({
                        ...proficiencies,
                        savingThrows: {
                          ...proficiencies.savingThrows,
                          optionIds: isSelected 
                            ? currentOptions.filter((id: string) => id !== iden)
                            : [...currentOptions, iden]
                        }
                      });
                    }}
                    className={`px-4 py-1.5 rounded text-xs font-bold transition-all border ${
                      isSelected
                      ? 'bg-gold text-white border-gold'
                      : 'bg-card text-gold/60 border-gold/10 hover:border-gold/20'
                    }`}
                  >
                    {attr.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <label className="section-label text-gold/60">Given (Fixed)</label>
            <div className="flex flex-wrap gap-2">
              {allAttributes.map(attr => {
                const iden = (attr.identifier || attr.id).toUpperCase();
                const isFixed = proficiencies.savingThrows?.fixedIds?.includes(iden);
                return (
                  <button
                    key={attr.id}
                    type="button"
                    onClick={() => {
                      const currentFixed = proficiencies.savingThrows?.fixedIds || [];
                      const newFixed = isFixed 
                        ? currentFixed.filter((id: string) => id !== iden)
                        : [...currentFixed, iden];
                      
                      setProficiencies({
                        ...proficiencies,
                        savingThrows: {
                          ...proficiencies.savingThrows,
                          fixedIds: newFixed
                        }
                      });
                    }}
                    className={`px-4 py-1.5 rounded text-xs font-bold transition-all border ${
                      isFixed
                      ? 'bg-gold text-white border-gold'
                      : 'bg-card text-gold/60 border-gold/10 hover:border-gold/20'
                    }`}
                  >
                    {attr.name}
                  </button>
                );
              })}
              {allAttributes.length === 0 && <p className="text-[10px] text-ink/30 italic col-span-2">No attributes defined. <Link to="/admin/proficiencies" className="text-gold underline">Manage Attributes</Link></p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
