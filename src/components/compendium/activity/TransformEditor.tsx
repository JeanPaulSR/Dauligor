import React, { useState } from 'react';
import { Minus, Settings, ChevronDown, Lock } from 'lucide-react';
import { Input } from '../../ui/input';
import { Checkbox } from '../../ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { ActivitySection, FieldRow, Field, EmptyRow } from './primitives';
import {
  CREATURE_SIZE_OPTIONS,
  CREATURE_TYPE_OPTIONS,
  TRANSFORM_MOVEMENT_OPTIONS,
  TRANSFORM_PRESET_OPTIONS,
} from './constants';
import { cn } from '../../../lib/utils';
import SingleSelectSearch, { type SingleSelectSearchOption } from '../../ui/SingleSelectSearch';
import MultiSelect from './MultiSelect';
import type { SemanticActivity } from '../../../types/activities';

type TransformShape = NonNullable<SemanticActivity['transform']>;
type TransformProfile = TransformShape['profiles'][number];

interface TransformSettings {
  keep?: string[];
  merge?: string[];
  effects?: string[];
  other?: string[];
  minimumAC?: string;
  spellLists?: string[];
  tempFormula?: string;
  transformTokens?: boolean;
}

// Foundry's `transform.mode`: "" = By Direct Link, "cr" = By Challenge Rating.
const TRANSFORM_MODE_OPTIONS = [
  { value: '__direct', label: 'By Direct Link' },
  { value: 'cr', label: 'By Challenge Rating' },
];

// ── Transformation settings (Foundry's CONFIG.DND5E.transformation) ──
// The three boolean categories + the "Other Options" fields. Labels/hints are
// Foundry's; keys must match so the settings round-trip.
type SettingDef = { key: string; label: string; hint?: string };

const KEEP_SETTINGS: SettingDef[] = [
  { key: 'physical', label: 'Physical Abilities', hint: 'Keep strength, dexterity, and constitution scores.' },
  { key: 'mental', label: 'Mental Abilities', hint: 'Keep intelligence, wisdom, and charisma scores.' },
  { key: 'saves', label: 'Save Proficiencies' },
  { key: 'skills', label: 'Skill Proficiencies' },
  { key: 'gearProf', label: 'Gear Proficiency' },
  { key: 'languages', label: 'Languages' },
  { key: 'class', label: 'Proficiency Bonus' },
  { key: 'feats', label: 'Features' },
  { key: 'items', label: 'Equipment' },
  { key: 'spells', label: 'Spells' },
  { key: 'bio', label: 'Biography' },
  { key: 'type', label: 'Creature Type' },
  { key: 'hp', label: 'Hit Points & Hit Dice' },
  { key: 'tempHP', label: 'Temp HP' },
  { key: 'resistances', label: 'Damage Resistances' },
  { key: 'vision', label: 'Vision' },
  { key: 'self', label: 'Self', hint: 'Only change portrait and token artwork, other settings will be ignored.' },
];
const MERGE_SETTINGS: SettingDef[] = [
  { key: 'saves', label: 'Save Proficiencies' },
  { key: 'skills', label: 'Skill Proficiencies' },
];
const EFFECT_SETTINGS: SettingDef[] = [
  { key: 'all', label: 'All Effects', hint: 'Keep all effects, ignoring any other effects settings.' },
  { key: 'origin', label: 'This Actor', hint: 'Keep any effects created directly on this source actor.' },
  { key: 'otherOrigin', label: 'Other Actors', hint: 'Keep any effects imposed by an outside actor.' },
  { key: 'background', label: 'Background Effects' },
  { key: 'class', label: 'Class Effects' },
  { key: 'feat', label: 'Feature Effects' },
  { key: 'equipment', label: 'Equipment Effects' },
  { key: 'spell', label: 'Spell Effects' },
];
const CATEGORY_KEYS: Record<string, string[]> = {
  keep: KEEP_SETTINGS.map(s => s.key),
  merge: MERGE_SETTINGS.map(s => s.key),
  effects: EFFECT_SETTINGS.map(s => s.key),
};
// Foundry's `disables` — a selected key forces the listed targets off (locked).
const SETTING_DISABLES: Record<string, string[]> = {
  'keep.saves': ['merge.saves'],
  'keep.skills': ['merge.skills'],
  'keep.self': ['keep.*', 'merge.*', 'minimumAC', 'tempFormula'],
  'merge.saves': ['keep.saves'],
  'merge.skills': ['keep.skills'],
  'effects.all': ['effects.*'],
};
// The schema's `#initial` defaults (CONFIG items flagged `default: true`) — what
// the blank "Default" preset resolves to: keep Vision, and keep every effect
// origin except "All Effects". Shown (disabled) when Customize is off + Default.
const DEFAULT_SETTINGS: TransformSettings = {
  keep: ['vision'],
  effects: ['origin', 'otherOrigin', 'background', 'class', 'feat', 'equipment', 'spell'],
  transformTokens: true,
};

// Preset default settings (CONFIG.DND5E.transformation.presets[*].settings) — shown
// (disabled) when Customize is off so the author can see what each preset does.
const PRESET_DEFAULTS: Record<string, TransformSettings> = {
  polymorphSelf: { effects: ['all'], keep: ['self'] },
  polymorph: { effects: ['otherOrigin', 'origin', 'spell'], keep: ['hp', 'type'], tempFormula: '@source.attributes.hp.max' },
  wildshape: {
    effects: ['otherOrigin', 'origin', 'feat', 'spell', 'class', 'background'],
    keep: ['bio', 'class', 'feats', 'hp', 'languages', 'mental', 'tempHP', 'type'],
    merge: ['saves', 'skills'],
    tempFormula: 'max(@classes.druid.levels, @subclasses.moon.levels * 3)',
  },
};

/** Expand a settings object's `disables` into the set of locked `cat.key` paths. */
function computeDisabled(eff: TransformSettings): Set<string> {
  const out = new Set<string>();
  (['keep', 'merge', 'effects'] as const).forEach(cat => {
    (eff[cat] || []).forEach(key => {
      (SETTING_DISABLES[`${cat}.${key}`] || []).forEach(d => {
        if (d.endsWith('.*')) {
          const dc = d.slice(0, -2);
          (CATEGORY_KEYS[dc] || []).filter(k => !(dc === cat && k === key)).forEach(k => out.add(`${dc}.${k}`));
        } else {
          out.add(d);
        }
      });
    });
  });
  return out;
}

export interface TransformEditorProps {
  transform: TransformShape;
  /** Merge-patches into the activity's `transform` (the host's updateTransform). */
  onChange: (patch: Partial<TransformShape>) => void;
  /** 16-char id factory for new profiles (the host's makeFoundryId). */
  makeId: () => string;
  /** Which inner sub-tab to render — Foundry's Profiles | Settings. Omit ⇒ both. */
  tab?: 'profiles' | 'settings';
  /**
   * Options for the per-profile "Linked Actor" search (Direct-link mode). Empty
   * until the monster compendium exists — wire it in then.
   */
  creatureOptions?: SingleSelectSearchOption[];
  /**
   * Options for "Retained Spell Lists". Foundry uses its spell-list registry;
   * we use OUR spell rules instead (the host passes them). The transformation
   * settings are primarily authored for, and applied by, our own app.
   */
  spellListOptions?: { value: string; label: string }[];
}

/**
 * Transform activity Effect tab ("Transformation") — mirrors Foundry dnd5e
 * 5.3.1's `transform-effect.hbs` (Profiles | Settings sub-tabs).
 *
 *   • Transform Profiles — Mode + repeatable profiles (CR or a Linked-Actor
 *     search + Display Name + delete, with an Additional Settings tray:
 *     Creature Sizes / Types / Restricted Movement Types in cr-mode + Level Limit).
 *   • Settings — Transformation Details (Preset + Customize) followed by the
 *     Keep / Merge / Active Effects / Other Options panels. When Customize is off
 *     the panels show the selected preset's defaults (disabled); when on they're
 *     editable. Foundry's `disables` dependencies are honoured (e.g. "Self" or
 *     "All Effects" lock the dependent toggles — shown with a lock).
 *
 * NOTE (app-handled): the transformation settings are primarily authored for and
 * applied by OUR app at runtime — including resolving preset defaults, the
 * `default`-selected toggles, and "Retained Spell Lists" (sourced from our spell
 * rules, not Foundry's spell-list registry). Transform has NO Applied Effects.
 */
export default function TransformEditor({
  transform, onChange, makeId, tab, creatureOptions = [], spellListOptions = [],
}: TransformEditorProps) {
  const [expandedProfile, setExpandedProfile] = useState<string | null>(null);
  const mode = transform.mode || '';
  const isCR = mode === 'cr';
  const profiles = transform.profiles || [];

  const setProfiles = (next: TransformProfile[]) => onChange({ profiles: next });
  const patchProfile = (idx: number, patch: Partial<TransformProfile>) => {
    const next = profiles.slice();
    next[idx] = { ...next[idx], ...patch };
    setProfiles(next);
  };
  const addProfile = () => setProfiles([
    ...profiles,
    { _id: makeId(), cr: '', level: { min: 0, max: 20 }, movement: [], name: '', sizes: [], types: [], uuid: null },
  ]);

  // ── Settings sub-tab state ──
  const settings = (transform.settings || {}) as TransformSettings;
  const customize = !!transform.customize;
  const preset = transform.preset || '';
  // Effective values: the author's own settings while customizing, else the
  // selected preset's defaults (so the panel previews what the preset does).
  const eff: TransformSettings = customize ? settings : (PRESET_DEFAULTS[preset] || DEFAULT_SETTINGS);
  const lockedKeys = computeDisabled(eff);

  const setSetting = (patch: Partial<TransformSettings>) => onChange({ settings: { ...(transform.settings || {}), ...patch } });
  const toggleCat = (cat: 'keep' | 'merge' | 'effects', key: string) => {
    const cur = (settings[cat] || []) as string[];
    setSetting({ [cat]: cur.includes(key) ? cur.filter(k => k !== key) : [...cur, key] });
  };
  const isChecked = (cat: 'keep' | 'merge' | 'effects', key: string) => ((eff[cat] || []) as string[]).includes(key);
  const isLocked = (path: string) => lockedKeys.has(path);

  const minusBtn = 'shrink-0 w-5 h-5 flex items-center justify-center cursor-pointer rounded border border-gold/30 bg-gold/10 text-gold/70 hover:bg-blood/15 hover:border-blood/45 hover:text-blood transition-colors';

  // A single boolean settings row: a lock when a dependency forces it, else a
  // checkbox (disabled unless Customize is on). Mirrors Foundry's fieldlist.
  const ToggleRow = (cat: 'keep' | 'merge' | 'effects', def: SettingDef) => {
    const path = `${cat}.${def.key}`;
    const locked = isLocked(path);
    return (
      <FieldRow key={path} label={def.label} hint={def.hint} inline>
        {locked
          ? <Lock className="w-3.5 h-3.5 text-ink/30" aria-label="Locked by another setting" />
          : <Checkbox checked={isChecked(cat, def.key)} disabled={!customize} onCheckedChange={() => toggleCat(cat, def.key)} />}
      </FieldRow>
    );
  };

  return (
    <>
      {/* ── Transform Profiles (Foundry's Profiles sub-tab) ── */}
      {tab !== 'settings' && (
      <ActivitySection label="Transform Profiles" onAdd={addProfile} addLabel="Create Profile">
        <FieldRow label="Mode" hint="Sets how the transformation source creatures are selected.">
          <Select value={mode || '__direct'} onValueChange={v => onChange({ mode: v === '__direct' ? '' : v })}>
            <SelectTrigger className="field-input border-gold/15 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {TRANSFORM_MODE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </FieldRow>
        {profiles.length === 0 ? (
          <EmptyRow>{isCR
            ? 'Use + above to create a profile.'
            : 'Use + above to create a profile, then link a creature (drag-drop lands with monsters).'}</EmptyRow>
        ) : (
          <div className="py-2 space-y-2">
            {profiles.map((p, idx) => {
              const key = p._id || String(idx);
              const expanded = expandedProfile === key;
              return (
                <div key={key} className="p-2 bg-gold/5 border border-gold/10 rounded">
                  <div className="flex items-end gap-1.5">
                    {isCR ? (
                      <Field label="CR" className="w-24 shrink-0">
                        <Input
                          value={p.cr || ''}
                          onChange={e => patchProfile(idx, { cr: e.target.value })}
                          autoComplete="off"
                          className="field-input border-gold/15 text-xs text-center font-mono"
                          placeholder="1"
                        />
                      </Field>
                    ) : (
                      <Field label="Linked Actor" className="flex-1">
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
                        <>
                          <FieldRow label="Creature Sizes" hint="List of creature sizes from which the source creature can be selected.">
                            <MultiSelect value={p.sizes || []} onChange={sizes => patchProfile(idx, { sizes })} options={CREATURE_SIZE_OPTIONS} placeholder="Any" />
                          </FieldRow>
                          <FieldRow label="Creature Types" hint="List of creature types from which the source creature can be selected.">
                            <MultiSelect value={p.types || []} onChange={types => patchProfile(idx, { types })} options={CREATURE_TYPE_OPTIONS} placeholder="Any" />
                          </FieldRow>
                          <FieldRow label="Restricted Movement Types" hint="Movement types that are not allowed on source creatures.">
                            <MultiSelect value={p.movement || []} onChange={movement => patchProfile(idx, { movement })} options={TRANSFORM_MOVEMENT_OPTIONS} placeholder="None" />
                          </FieldRow>
                        </>
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

      {/* ── Settings sub-tab (Foundry's transform-settings.hbs) ── */}
      {tab !== 'profiles' && (<>
        <ActivitySection label="Transformation Details">
          <FieldRow label="Preset" hint="Selecting a preset applies its default transformation settings.">
            <Select value={transform.preset || '__default'} onValueChange={v => onChange({ preset: v === '__default' ? '' : v })}>
              <SelectTrigger className="field-input border-gold/15 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TRANSFORM_PRESET_OPTIONS.map(o => <SelectItem key={o.value || '__default'} value={o.value || '__default'}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </FieldRow>
          <FieldRow label="Customize" hint="Use custom transformation settings rather than the defaults provided by the selected preset." inline>
            <Checkbox checked={customize} onCheckedChange={c => onChange({ customize: !!c })} />
          </FieldRow>
        </ActivitySection>

        <ActivitySection label="Keep">
          <p className="py-2 text-[10px] text-ink/50 italic leading-snug">These details will be retained from the source actor.</p>
          {KEEP_SETTINGS.map(def => ToggleRow('keep', def))}
        </ActivitySection>

        <ActivitySection label="Merge">
          <p className="py-2 text-[10px] text-ink/50 italic leading-snug">Merge these proficiencies, keeping whichever has the higher modifier.</p>
          {MERGE_SETTINGS.map(def => ToggleRow('merge', def))}
        </ActivitySection>

        <ActivitySection label="Active Effects">
          {EFFECT_SETTINGS.map(def => ToggleRow('effects', def))}
        </ActivitySection>

        <ActivitySection label="Other Options">
          <FieldRow label="Minimum Armor Class" hint="Formula defining the armor class for the transformed creature, if the target actor's AC is not already higher.">
            <Input
              value={eff.minimumAC || ''}
              disabled={!customize || isLocked('minimumAC')}
              onChange={e => setSetting({ minimumAC: e.target.value })}
              autoComplete="off"
              className="field-input border-gold/15 text-xs font-mono disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </FieldRow>
          <FieldRow label="Retained Spell Lists" hint="The spells on these spell lists will be kept if the actor has a matching item. (Sourced from our spell rules.)">
            {customize
              ? <MultiSelect value={eff.spellLists || []} onChange={spellLists => setSetting({ spellLists })} options={spellListOptions} placeholder="None" />
              : <div className="opacity-50 pointer-events-none"><MultiSelect value={eff.spellLists || []} onChange={() => {}} options={spellListOptions} placeholder="None" /></div>}
          </FieldRow>
          <FieldRow label="Temp Formula" hint="Formula for temp HP that will be added upon transformation.">
            <Input
              value={eff.tempFormula || ''}
              disabled={!customize || isLocked('tempFormula')}
              onChange={e => setSetting({ tempFormula: e.target.value })}
              autoComplete="off"
              className="field-input border-gold/15 text-xs font-mono disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </FieldRow>
          <FieldRow label="Transform Tokens" hint="Replace tokens on the scene with the transformed creature's token." inline>
            <Checkbox checked={eff.transformTokens ?? true} disabled={!customize} onCheckedChange={c => setSetting({ transformTokens: !!c })} />
          </FieldRow>
        </ActivitySection>
      </>)}
    </>
  );
}
