import React from 'react';
import { Shield, Sword, Hammer, MessageCircle, Check, Star } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import {
  buildNextGroupedProficiencyCollection,
  buildGroupedProficiencyDisplayName,
} from '../../lib/proficiencySelection';

/**
 * Shared proficiency picker — the granted/choosable skills/tools/languages
 * (and armor/weapons/saving-throws) grid extracted from the class editor so
 * classes, backgrounds, and any future entity author proficiencies the same
 * way and export through the same `_classExport` normalization.
 *
 * Operates on the class proficiency model (per kind: `{choiceCount, fixedIds,
 * optionIds, categoryIds}`). Render only the kinds you need via `types`.
 *
 * Weapons support Melee/Ranged "pills" (toggle every melee- or ranged-type
 * weapon in a category at once) via the `renderCategoryExtra` hook. The class
 * editor (main + multiclass grids) and the background editor both consume this
 * component; backgrounds render only skills/tools/languages, so the weapon
 * pills are simply unused there.
 */

type Option = { id: string; name: string; categoryId?: string };
type Category = { id: string; name: string };

export type ProficiencyType = 'savingThrows' | 'skills' | 'armor' | 'weapons' | 'tools' | 'languages';

const TYPE_META: Record<ProficiencyType, { label: string; icon: React.ReactNode; grouped: boolean; uppercase?: boolean; displayKey?: string; manageLink?: string }> = {
  savingThrows: { label: 'Saving Throws', icon: <Shield className="w-3.5 h-3.5 text-gold/40" />, grouped: false, uppercase: true },
  skills: { label: 'Skills', icon: <Star className="w-3.5 h-3.5 text-gold/40" />, grouped: false, displayKey: 'skillsDisplayName', manageLink: '/compendium/skills' },
  armor: { label: 'Armor', icon: <Shield className="w-3.5 h-3.5 text-gold/40" />, grouped: true, displayKey: 'armorDisplayName' },
  weapons: { label: 'Weapons', icon: <Sword className="w-3.5 h-3.5 text-gold/40" />, grouped: true, displayKey: 'weaponsDisplayName' },
  tools: { label: 'Tools', icon: <Hammer className="w-3.5 h-3.5 text-gold/40" />, grouped: true, displayKey: 'toolsDisplayName', manageLink: '/compendium/tools' },
  languages: { label: 'Languages', icon: <MessageCircle className="w-3.5 h-3.5 text-gold/40" />, grouped: true },
};

interface ProficienciesEditorProps {
  proficiencies: any;
  setProficiencies: (val: any) => void;
  /** Which sections to render, in order. Defaults to all six. */
  types?: ProficiencyType[];
  /** Show the per-kind "display name + Sync" row (class authoring nicety). */
  showDisplayNames?: boolean;
  // Flat vocab.
  allAttributes?: Option[];
  allSkills?: Option[];
  // Grouped vocab (grouped map keyed by category NAME; cats give id↔name).
  groupedArmor?: Record<string, Option[]>;
  allArmor?: Option[];
  allArmorCategories?: Category[];
  groupedWeapons?: Record<string, Option[]>;
  allWeapons?: Option[];
  allWeaponCategories?: Category[];
  groupedTools?: Record<string, Option[]>;
  allTools?: Option[];
  allToolCategories?: Category[];
  groupedLanguages?: Record<string, Option[]>;
  allLanguages?: Option[];
  allLanguageCategories?: Category[];
}

export default function ProficienciesEditor(props: ProficienciesEditorProps) {
  const {
    proficiencies,
    setProficiencies,
    types = ['savingThrows', 'armor', 'weapons', 'skills', 'tools', 'languages'],
    showDisplayNames = true,
  } = props;

  const flatVocab: Record<string, Option[]> = {
    savingThrows: props.allAttributes || [],
    skills: props.allSkills || [],
  };
  const groupedVocab: Record<string, { grouped: Record<string, Option[]>; all: Option[]; cats: Category[] }> = {
    armor: { grouped: props.groupedArmor || {}, all: props.allArmor || [], cats: props.allArmorCategories || [] },
    weapons: { grouped: props.groupedWeapons || {}, all: props.allWeapons || [], cats: props.allWeaponCategories || [] },
    tools: { grouped: props.groupedTools || {}, all: props.allTools || [], cats: props.allToolCategories || [] },
    languages: { grouped: props.groupedLanguages || {}, all: props.allLanguages || [], cats: props.allLanguageCategories || [] },
  };

  const setSection = (type: string, patch: any) =>
    setProficiencies({ ...proficiencies, [type]: { ...proficiencies[type], ...patch } });

  const toggleGroup = (items: Option[], type: string, target: 'fixedIds' | 'optionIds', categoryId?: string) =>
    setProficiencies(buildNextGroupedProficiencyCollection(proficiencies, items, type, target, categoryId));

  const syncDisplayName = (type: string, displayKey: string, all: Option[], cats: Category[]) =>
    setProficiencies({ ...proficiencies, [displayKey]: buildGroupedProficiencyDisplayName(proficiencies[type], all, cats) });

  // ── Weapon melee/ranged pills (weapons section only) ─────────────
  const allWeaponCategories = props.allWeaponCategories || [];

  const toggleWeaponType = (
    categoryItems: Option[],
    categoryId: string | undefined,
    weaponType: 'Melee' | 'Ranged',
    target: 'fixedIds' | 'optionIds',
  ) => {
    const matchType = (w: any) => String(w?.weaponType ?? w?.weapon_type ?? '').trim() === weaponType;
    const matching = (categoryItems || []).filter(matchType);
    if (matching.length === 0) return;
    const matchingIds = matching.map((w) => w.id).filter(Boolean) as string[];
    const matchingSet = new Set(matchingIds);
    const section = (proficiencies as any).weapons || {};
    const currentIds = new Set<string>((section[target] || []) as string[]);
    const allMatchingTicked = matchingIds.every((id) => currentIds.has(id));
    const nextIds = allMatchingTicked
      ? Array.from(currentIds).filter((id) => !matchingSet.has(id))
      : Array.from(new Set([...Array.from(currentIds), ...matchingIds]));
    const nextSection: any = { ...section, [target]: nextIds };
    // Section-level category state is maintained ONLY for the Fixed column.
    if (target === 'fixedIds' && categoryId) {
      const inAll = new Set<string>(section.categoryIds || []);
      const inMelee = new Set<string>(section.categoryMeleeIds || []);
      const inRanged = new Set<string>(section.categoryRangedIds || []);
      const targetSet = weaponType === 'Melee' ? inMelee : inRanged;
      const oppositeSet = weaponType === 'Melee' ? inRanged : inMelee;
      if (allMatchingTicked) { targetSet.delete(categoryId); inAll.delete(categoryId); }
      else if (oppositeSet.has(categoryId)) { oppositeSet.delete(categoryId); inAll.add(categoryId); }
      else { targetSet.add(categoryId); inAll.delete(categoryId); }
      nextSection.categoryIds = Array.from(inAll);
      nextSection.categoryMeleeIds = Array.from(inMelee);
      nextSection.categoryRangedIds = Array.from(inRanged);
    }
    setProficiencies({ ...proficiencies, weapons: nextSection });
  };

  const renderWeaponPills = (categoryName: string, items: Option[], target: 'fixedIds' | 'optionIds'): React.ReactNode => {
    if (!items || items.length === 0) return null;
    const matchType = (w: any) => String(w?.weaponType ?? w?.weapon_type ?? '').trim();
    const meleeItems = items.filter((w) => matchType(w) === 'Melee');
    const rangedItems = items.filter((w) => matchType(w) === 'Ranged');
    if (meleeItems.length === 0 && rangedItems.length === 0) return null;
    const baseCategory = categoryName.replace(/ (Melee|Ranged)$/i, '').trim();
    const catId = allWeaponCategories.find((c) => c.name === categoryName)?.id
      ?? allWeaponCategories.find((c) => c.name === baseCategory)?.id;
    const section = (proficiencies as any).weapons || {};
    const targetIds = new Set<string>(section[target] || []);
    const meleeActive = meleeItems.length > 0 && meleeItems.every((w) => targetIds.has(w.id));
    const rangedActive = rangedItems.length > 0 && rangedItems.every((w) => targetIds.has(w.id));
    const pillBase = 'ml-1 px-1.5 py-0.5 rounded text-[8px] uppercase tracking-widest font-black transition-all border';
    const pillOn = 'bg-gold/80 text-white border-gold/80';
    const pillOff = 'bg-card/50 text-gold/40 border-gold/15 hover:border-gold/40';
    return (
      <>
        {meleeItems.length > 0 && (
          <button type="button" onClick={() => toggleWeaponType(items, catId, 'Melee', target)} className={`${pillBase} ${meleeActive ? pillOn : pillOff}`} title="Toggle all melee weapons in this category">Melee</button>
        )}
        {rangedItems.length > 0 && (
          <button type="button" onClick={() => toggleWeaponType(items, catId, 'Ranged', target)} className={`${pillBase} ${rangedActive ? pillOn : pillOff}`} title="Toggle all ranged weapons in this category">Ranged</button>
        )}
      </>
    );
  };

  return (
    <div className="space-y-6">
      {types.map((type, idx) => {
        const meta = TYPE_META[type];
        const section = proficiencies[type] || { choiceCount: 0, fixedIds: [], optionIds: [] };
        return (
          <div key={type} className={idx > 0 ? 'space-y-4 pt-4 border-t border-gold/10' : 'space-y-4'}>
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-widest text-ink/60 flex items-center gap-2">
                {meta.icon} {meta.label}
              </h3>
              <div className="flex items-center gap-2">
                <label className="text-[10px] font-bold uppercase text-ink/40">Choices:</label>
                <Input
                  type="number"
                  min={0}
                  value={section.choiceCount || 0}
                  onChange={(e) => setSection(type, { choiceCount: parseInt(e.target.value) || 0 })}
                  className="w-12 h-6 text-center text-xs bg-background/50 border-gold/10"
                />
              </div>
            </div>

            {showDisplayNames && meta.displayKey && (
              <div className="space-y-1">
                <div className="flex gap-2">
                  <Input
                    value={proficiencies[meta.displayKey] || ''}
                    onChange={(e) => setProficiencies({ ...proficiencies, [meta.displayKey!]: e.target.value })}
                    placeholder={`${meta.label} display name (optional)`}
                    className="h-8 text-xs bg-background/50 border-gold/10 focus:border-gold"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 text-[10px] uppercase font-bold border-gold/20"
                    onClick={() => {
                      const v = meta.grouped ? groupedVocab[type] : { all: flatVocab[type] || [], cats: [] as Category[] };
                      syncDisplayName(type, meta.displayKey!, v.all, (v as any).cats || []);
                    }}
                  >
                    Sync
                  </Button>
                </div>
              </div>
            )}

            {meta.grouped ? (
              <GroupedColumns
                type={type}
                section={section}
                grouped={groupedVocab[type].grouped}
                cats={groupedVocab[type].cats}
                emptyAll={groupedVocab[type].all.length === 0}
                onToggleGroup={toggleGroup}
                onSetSection={setSection}
                renderCategoryExtra={type === 'weapons' ? renderWeaponPills : undefined}
              />
            ) : (
              <FlatColumns
                type={type}
                section={section}
                items={flatVocab[type] || []}
                uppercase={!!meta.uppercase}
                manageLink={meta.manageLink}
                onSetSection={setSection}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Flat (skills / saving throws) ──────────────────────────────────

function idOf(item: Option, uppercase: boolean) {
  const raw = String((item as any).identifier || item.id);
  return uppercase ? raw.toUpperCase() : raw;
}

function FlatColumns({
  type, section, items, uppercase, manageLink, onSetSection,
}: {
  type: string; section: any; items: Option[]; uppercase: boolean; manageLink?: string;
  onSetSection: (type: string, patch: any) => void;
}) {
  const optionIds: string[] = section.optionIds || [];
  const fixedIds: string[] = section.fixedIds || [];
  return (
    <div className="grid sm:grid-cols-2 gap-4">
      <div className="space-y-2">
        <label className="text-[10px] font-bold uppercase tracking-widest text-gold/60">Choice Options</label>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 p-3 border border-gold/10 bg-background/30 rounded-md min-h-[80px]">
          {items.map((item) => {
            const id = idOf(item, uppercase);
            const isOption = optionIds.includes(id);
            const isFixed = fixedIds.includes(id);
            return (
              <label key={`opt-${item.id}`} className={`flex items-center gap-2 cursor-pointer group ${isFixed ? 'opacity-50' : ''}`}>
                <CheckBox on={isOption || isFixed} />
                <input
                  type="checkbox" className="hidden" disabled={isFixed} checked={isOption || isFixed}
                  onChange={(e) => onSetSection(type, {
                    optionIds: e.target.checked ? [...optionIds, id] : optionIds.filter((x) => x !== id),
                  })}
                />
                <span className="text-[10px] font-bold text-ink/60 truncate">{item.name}</span>
              </label>
            );
          })}
          {items.length === 0 && (
            <p className="text-[10px] text-ink/30 italic col-span-2">
              None defined.{manageLink && <> <Link to={manageLink} className="text-gold underline">Manage</Link></>}
            </p>
          )}
        </div>
      </div>
      <div className="space-y-2">
        <label className="text-[10px] font-bold uppercase tracking-widest text-gold/60">Given (Fixed)</label>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 p-3 border border-gold/10 bg-background/30 rounded-md min-h-[80px]">
          {items.map((item) => {
            const id = idOf(item, uppercase);
            const isFixed = fixedIds.includes(id);
            return (
              <label key={`fix-${item.id}`} className="flex items-center gap-2 cursor-pointer group">
                <CheckBox on={isFixed} />
                <input
                  type="checkbox" className="hidden" checked={isFixed}
                  onChange={(e) => onSetSection(type, {
                    fixedIds: e.target.checked ? [...fixedIds, id] : fixedIds.filter((x) => x !== id),
                    optionIds: e.target.checked ? optionIds.filter((x) => x !== id) : optionIds,
                  })}
                />
                <span className="text-[10px] font-bold text-ink/60 truncate">{item.name}</span>
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Grouped (armor / weapons / tools / languages) ──────────────────

function GroupedColumns({
  type, section, grouped, cats, emptyAll, onToggleGroup, onSetSection, renderCategoryExtra,
}: {
  type: string; section: any; grouped: Record<string, Option[]>; cats: Category[]; emptyAll: boolean;
  onToggleGroup: (items: Option[], type: string, target: 'fixedIds' | 'optionIds', categoryId?: string) => void;
  onSetSection: (type: string, patch: any) => void;
  renderCategoryExtra?: (categoryName: string, items: Option[], target: 'fixedIds' | 'optionIds') => React.ReactNode;
}) {
  return (
    <div className="grid sm:grid-cols-2 gap-4">
      {(['optionIds', 'fixedIds'] as const).map((target) => (
        <div key={target} className="space-y-2">
          <label className="text-[10px] font-bold uppercase tracking-widest text-gold/60">
            {target === 'optionIds' ? 'Choice Options' : 'Given (Fixed)'}
          </label>
          <div className="p-3 border border-gold/10 bg-background/30 rounded-md space-y-4">
            {Object.entries(grouped).sort().map(([categoryName, items]) => {
              const catId = cats.find((c) => c.name === categoryName)?.id;
              const currentIds = new Set<string>(section[target] || []);
              const allExist = (items as Option[]).every((item) => currentIds.has(item.id));
              const otherTarget = target === 'optionIds' ? 'fixedIds' : 'optionIds';
              return (
                <div key={`${type}-${target}-${categoryName}`} className="space-y-1">
                  <div className="flex items-center gap-2 border-b border-gold/5 pb-1 mb-1">
                    <label className="flex items-center gap-2 cursor-pointer group/label">
                      <CheckBox on={allExist} />
                      <input
                        type="checkbox" className="hidden" checked={allExist}
                        onChange={() => onToggleGroup(items as Option[], type, target, catId)}
                      />
                      <span className="text-[10px] font-black uppercase tracking-widest text-gold/40 italic">{categoryName}</span>
                    </label>
                    {renderCategoryExtra?.(categoryName, items as Option[], target)}
                    {allExist && <span className="text-[9px] text-ink/20 ml-auto italic">All</span>}
                  </div>
                  {!allExist && (
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                      {(items as Option[]).map((item) => {
                        const on = (section[target] || []).includes(item.id);
                        return (
                          <label key={`${type}-${target}-${item.id}`} className="flex items-center gap-2 cursor-pointer group">
                            <CheckBox on={on} />
                            <input
                              type="checkbox" className="hidden" checked={on}
                              onChange={(e) => {
                                const cur: string[] = section[target] || [];
                                const next = e.target.checked ? [...cur, item.id] : cur.filter((x) => x !== item.id);
                                const patch: any = { [target]: next };
                                // Adding to fixed removes from options (mirror class behaviour).
                                if (target === 'fixedIds' && e.target.checked) {
                                  patch.optionIds = (section.optionIds || []).filter((x: string) => x !== item.id);
                                }
                                onSetSection(type, patch);
                                void otherTarget;
                              }}
                            />
                            <span className="text-[10px] font-bold text-ink/60 truncate">{item.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
            {emptyAll && <p className="text-[10px] text-ink/30 italic">None defined.</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

function CheckBox({ on }: { on: boolean }) {
  return (
    <div className={`w-3 h-3 rounded border flex items-center justify-center transition-all ${on ? 'bg-gold border-gold' : 'border-gold/30 group-hover:border-gold/50 group-hover/label:border-gold/50'}`}>
      {on && <Check className="w-2 h-2 text-white" />}
    </div>
  );
}
