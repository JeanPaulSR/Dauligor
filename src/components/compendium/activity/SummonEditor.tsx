import React, { useState } from 'react';
import { Minus, Settings, ChevronDown } from 'lucide-react';
import { Input } from '../../ui/input';
import { Checkbox } from '../../ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { ActivitySection, FieldRow, Field, EmptyRow } from './primitives';
import { CREATURE_SIZE_OPTIONS, CREATURE_TYPE_OPTIONS } from './constants';
import { cn } from '../../../lib/utils';
import SingleSelectSearch, { type SingleSelectSearchOption } from '../../ui/SingleSelectSearch';
import MultiSelect from './MultiSelect';
import type { SemanticActivity } from '../../../types/activities';

type SummonShape = NonNullable<SemanticActivity['summon']>;
type SummonProfile = SummonShape['profiles'][number];

// Foundry's `summon.mode` (CONFIG.DND5E summon modes): "" = By Direct Link
// (drop/link a specific creature), "cr" = By Challenge Rating & Type.
const SUMMON_MODE_OPTIONS = [
  { value: '__direct', label: 'By Direct Link' },
  { value: 'cr', label: 'By Challenge Rating & Type' },
];

export interface SummonEditorProps {
  summon: SummonShape;
  /** Merge-patches into the activity's `summon` (the host's updateSummon). */
  onChange: (patch: Partial<SummonShape>) => void;
  /** Ability options for "Match Ability" (slug + display label). */
  abilityOptions: { value: string; label: string }[];
  /** 16-char id factory for new profiles (the host's makeFoundryId). */
  makeId: () => string;
  /** Which inner sub-tab to render — Foundry's Profiles | Changes. Omit ⇒ both. */
  tab?: 'profiles' | 'changes';
  /**
   * Options for the per-profile "Linked Creature" search (Direct-link mode) —
   * Foundry drops an actor here. The app has no creature/monster compendium yet,
   * so this defaults to empty (the searcher shows a "pending" message). Wire the
   * monster source through this prop once it exists.
   */
  creatureOptions?: SingleSelectSearchOption[];
}

/**
 * Summon activity Effect tab — mirrors Foundry dnd5e 5.3.1's `summon-effect.hbs`
 * (its `summon-profiles.hbs` + `summon-changes.hbs` parts). Foundry splits these
 * into inner Profiles / Changes sub-tabs; we render the same fieldsets stacked,
 * keeping every label, hint, field, and order:
 *
 *   • Summons Profiles — Mode (By Direct Link / By Challenge Rating & Type) + a
 *     repeatable profile list. Each profile: Count × (CR in cr-mode, else a
 *     Linked-Creature UUID) + Display Name + delete, plus an "Additional
 *     Settings" tray (Creature Types in cr-mode + Level Limit).
 *   • Creature Changes — match disposition/proficiency, bonus AC/HD/HP, Temp HP,
 *     Creature Sizes, Creature Types.
 *   • Item Changes — match ability/attacks/saves, bonus attack/save/healing.
 *
 * NOTE: a profile's creature is a Foundry actor UUID. The app has no creature
 * compendium yet (monsters are a separate upcoming workstream), so the linked
 * creature is a raw UUID input for now — drag-drop / picker lands with monsters.
 * `summon.prompt` / `summon.identifier` live on Foundry's Identity tab, not the
 * Effect tab, so they're intentionally absent here.
 */
export default function SummonEditor({ summon, onChange, abilityOptions, makeId, tab, creatureOptions = [] }: SummonEditorProps) {
  const [expandedProfile, setExpandedProfile] = useState<string | null>(null);
  const mode = summon.mode || '';
  const isCR = mode === 'cr';
  const profiles = summon.profiles || [];
  const match = summon.match || {};
  const bonuses = summon.bonuses || {};

  const setProfiles = (next: SummonProfile[]) => onChange({ profiles: next });
  const patchProfile = (idx: number, patch: Partial<SummonProfile>) => {
    const next = profiles.slice();
    next[idx] = { ...next[idx], ...patch };
    setProfiles(next);
  };
  const addProfile = () => setProfiles([
    ...profiles,
    { _id: makeId(), count: '1', cr: '', level: { min: 0, max: 20 }, name: '', types: [], uuid: null },
  ]);
  const setMatch = (patch: Partial<NonNullable<SummonShape['match']>>) => onChange({ match: { ...match, ...patch } });
  const setBonus = (key: keyof NonNullable<SummonShape['bonuses']>, val: string) =>
    onChange({ bonuses: { ...bonuses, [key]: val } });

  const minusBtn = 'shrink-0 w-5 h-5 flex items-center justify-center cursor-pointer rounded border border-gold/30 bg-gold/10 text-gold/70 hover:bg-blood/15 hover:border-blood/45 hover:text-blood transition-colors';

  return (
    <>
      {/* ── Summons Profiles (Foundry's Profiles sub-tab) ── */}
      {tab !== 'changes' && (
      <ActivitySection label="Summons Profiles" onAdd={addProfile} addLabel="Create Profile">
        <FieldRow label="Mode" hint="Sets how the creatures that are to be summoned are specified.">
          <Select value={mode || '__direct'} onValueChange={v => onChange({ mode: v === '__direct' ? '' : v })}>
            <SelectTrigger className="field-input border-gold/15 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SUMMON_MODE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </FieldRow>
        {profiles.length === 0 ? (
          <EmptyRow>{isCR
            ? 'Use + above to create a profile.'
            : 'Use + above to create a profile, then link a creature by UUID (drag-drop lands with monsters).'}</EmptyRow>
        ) : (
          <div className="py-2 space-y-2">
            {profiles.map((p, idx) => {
              const key = p._id || String(idx);
              const expanded = expandedProfile === key;
              return (
                <div key={key} className="p-2 bg-gold/5 border border-gold/10 rounded">
                  <div className="flex items-end gap-1.5">
                    <Field label="Count" className="w-14 shrink-0">
                      <Input
                        value={p.count}
                        onChange={e => patchProfile(idx, { count: e.target.value })}
                        autoComplete="off"
                        className="field-input border-gold/15 text-xs text-center"
                        placeholder="1"
                      />
                    </Field>
                    <span className="self-center text-ink/40 text-sm shrink-0 pb-1.5">&times;</span>
                    {isCR ? (
                      <Field label="CR" className="w-20 shrink-0">
                        <Input
                          value={p.cr}
                          onChange={e => patchProfile(idx, { cr: e.target.value })}
                          autoComplete="off"
                          className="field-input border-gold/15 text-xs text-center font-mono"
                          placeholder="1"
                        />
                      </Field>
                    ) : (
                      <Field label="Linked Creature" className="flex-1">
                        <SingleSelectSearch
                          value={p.uuid || ''}
                          onChange={uuid => patchProfile(idx, { uuid: uuid || null })}
                          options={creatureOptions}
                          placeholder="Search creatures…"
                          noEntitiesText="No creatures yet — the monster compendium is still pending."
                          emptyText="No matching creatures."
                          triggerClassName="w-full"
                        />
                      </Field>
                    )}
                    <Field label="Display Name" className="flex-1">
                      <Input
                        value={p.name}
                        onChange={e => patchProfile(idx, { name: e.target.value })}
                        autoComplete="off"
                        className="field-input border-gold/15 text-xs"
                      />
                    </Field>
                    <button
                      type="button"
                      onClick={() => setProfiles(profiles.filter((_, i) => i !== idx))}
                      className={minusBtn}
                      aria-label="Delete Profile"
                      title="Delete Profile"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setExpandedProfile(expanded ? null : key)}
                    className="mt-1.5 flex items-center justify-center gap-1.5 w-full cursor-pointer text-[10px] uppercase tracking-wider font-black text-gold/55 hover:text-gold/85 transition-colors"
                  >
                    <Settings className="w-3 h-3" />
                    Additional Settings
                    <ChevronDown className={cn('w-3 h-3 transition-transform', expanded && 'rotate-180')} />
                  </button>
                  {expanded && (
                    <div className="mt-1 pl-1">
                      {isCR && (
                        <FieldRow label="Creature Types" hint="List of creature types from which the summoned creature can be selected.">
                          <MultiSelect
                            value={p.types || []}
                            onChange={types => patchProfile(idx, { types })}
                            options={CREATURE_TYPE_OPTIONS}
                            placeholder="Any"
                          />
                        </FieldRow>
                      )}
                      <FieldRow label="Level Limit" hint="Range of levels required to use this profile.">
                        <div className="flex items-center gap-2 w-full">
                          <Input
                            type="number"
                            value={p.level?.min ?? ''}
                            placeholder="0"
                            onChange={e => patchProfile(idx, { level: { ...p.level, min: e.target.value === '' ? 0 : parseInt(e.target.value) } })}
                            autoComplete="off"
                            className="h-8 flex-1 min-w-0 bg-background/40 border-gold/15 text-center text-xs no-number-spin"
                          />
                          <span className="text-[10px] uppercase tracking-wider text-ink/40 shrink-0 select-none">to</span>
                          <Input
                            type="number"
                            value={p.level?.max ?? ''}
                            placeholder="∞"
                            onChange={e => patchProfile(idx, { level: { ...p.level, max: e.target.value === '' ? 20 : parseInt(e.target.value) } })}
                            autoComplete="off"
                            className="h-8 flex-1 min-w-0 bg-background/40 border-gold/15 text-center text-xs no-number-spin"
                          />
                        </div>
                      </FieldRow>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </ActivitySection>
      )}

      {/* ── Creature + Item Changes (Foundry's Changes sub-tab) ── */}
      {tab !== 'profiles' && (<>
      <ActivitySection label="Creature Changes">
        <p className="py-2 text-[10px] text-ink/50 italic leading-snug">
          Changes made to the summoned creature. <code className="text-gold/70">@</code> references use the summoner's stats; reference the creature's own stats with <code className="text-gold/70">@summon</code> (e.g. <code className="text-gold/70">@summon.attributes.hd.max</code>).
        </p>
        <FieldRow label="Match Disposition" hint="Modify the summoned creature's disposition to match that of the summoner." inline>
          <Checkbox checked={!!match.disposition} onCheckedChange={c => setMatch({ disposition: !!c })} />
        </FieldRow>
        <FieldRow label="Match Proficiency" hint="Modify the summoned creature's proficiency to match that of the summoner." inline>
          <Checkbox checked={!!match.proficiency} onCheckedChange={c => setMatch({ proficiency: !!c })} />
        </FieldRow>
        <FieldRow label="Bonus Armor Class" hint="Bonus to the AC on the summoned creature, added to their statblock.">
          <Input value={bonuses.ac || ''} onChange={e => setBonus('ac', e.target.value)} autoComplete="off" className="field-input border-gold/15 text-xs font-mono" />
        </FieldRow>
        <FieldRow label="Bonus Hit Dice" hint="Additional hit dice on top of the statblock. NPC actors only.">
          <Input value={bonuses.hd || ''} onChange={e => setBonus('hd', e.target.value)} autoComplete="off" className="field-input border-gold/15 text-xs font-mono" />
        </FieldRow>
        <FieldRow label="Bonus Hit Points" hint="Additional hit points on top of the statblock.">
          <Input value={bonuses.hp || ''} onChange={e => setBonus('hp', e.target.value)} autoComplete="off" className="field-input border-gold/15 text-xs font-mono" />
        </FieldRow>
        <FieldRow label="Temp HP" hint="Grant the summoned creature temp HP, replacing any existing temp HP.">
          <Input value={summon.tempHP || ''} onChange={e => onChange({ tempHP: e.target.value })} autoComplete="off" className="field-input border-gold/15 text-xs font-mono" />
        </FieldRow>
        <FieldRow label="Creature Sizes" hint="The creature/token changes to this size. Multiple ⇒ the player chooses when summoning.">
          <MultiSelect value={summon.creatureSizes || []} onChange={creatureSizes => onChange({ creatureSizes })} options={CREATURE_SIZE_OPTIONS} placeholder="Unchanged" />
        </FieldRow>
        <FieldRow label="Creature Types" hint="The creature changes to this type. Multiple ⇒ the player chooses when summoning.">
          <MultiSelect value={summon.creatureTypes || []} onChange={creatureTypes => onChange({ creatureTypes })} options={CREATURE_TYPE_OPTIONS} placeholder="Unchanged" />
        </FieldRow>
      </ActivitySection>

      {/* ── Item Changes ── */}
      <ActivitySection label="Item Changes">
        <p className="py-2 text-[10px] text-ink/50 italic leading-snug">Changes made to items on the summoned creature.</p>
        <FieldRow label="Match Ability" hint="Specific ability to use when matching attacks and save DCs.">
          <Select value={match.ability || '__none'} onValueChange={v => setMatch({ ability: v === '__none' ? '' : v })}>
            <SelectTrigger className="field-input border-gold/15 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none" className="min-h-7 items-center">{' '}</SelectItem>
              {abilityOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </FieldRow>
        <FieldRow label="Match Attacks" hint="Modify to-hit values on the creature's attacks to match the summoner." inline>
          <Checkbox checked={!!match.attacks} onCheckedChange={c => setMatch({ attacks: !!c })} />
        </FieldRow>
        <FieldRow label="Match Saves" hint="Modify saving throw DCs on the creature's abilities to match the summoner." inline>
          <Checkbox checked={!!match.saves} onCheckedChange={c => setMatch({ saves: !!c })} />
        </FieldRow>
        <FieldRow label="Bonus Attack Damage" hint="Additional damage done by the creature's attacks.">
          <Input value={bonuses.attackDamage || ''} onChange={e => setBonus('attackDamage', e.target.value)} autoComplete="off" className="field-input border-gold/15 text-xs font-mono" />
        </FieldRow>
        <FieldRow label="Bonus Save Damage" hint="Additional damage done by the creature's abilities that require saving throws.">
          <Input value={bonuses.saveDamage || ''} onChange={e => setBonus('saveDamage', e.target.value)} autoComplete="off" className="field-input border-gold/15 text-xs font-mono" />
        </FieldRow>
        <FieldRow label="Bonus Healing" hint="Additional healing provided by the creature's healing abilities.">
          <Input value={bonuses.healing || ''} onChange={e => setBonus('healing', e.target.value)} autoComplete="off" className="field-input border-gold/15 text-xs font-mono" />
        </FieldRow>
      </ActivitySection>
      </>)}
    </>
  );
}
