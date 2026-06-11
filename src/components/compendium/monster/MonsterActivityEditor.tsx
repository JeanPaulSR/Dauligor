import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { DAMAGE_TYPES, ABILITY_ORDER, ABILITY_ABBR } from '../../../lib/monsterDisplay';
import { Field, NumField, TextField, Sel } from './fields';
import ChipMultiSelect from './ChipMultiSelect';

/**
 * Editor for a monster action's `activities[]` — the precomputed mechanical
 * tuples (NOT the items editor's rich `SemanticActivity`; the monster shape is
 * a flat, display-oriented tuple). An action carries an ARRAY (multi-attack
 * weapons + save riders) so this manages add/remove/edit of each.
 *
 * Shape per activity:
 *   { kind, activation,
 *     attack?: {bonus:number, type:'melee'|'ranged', reach?, range?, long?, units},
 *     save?:   {abilities:string[], dc:number, onSave?:'half'|'none'},
 *     damageParts?: [{average?, formula?, types?:string[]}] }
 */

export type MonsterActivity = {
  kind?: string;
  activation?: string;
  attack?: { bonus?: number; type?: string; reach?: number; range?: number; long?: number; units?: string };
  save?: { abilities?: string[]; dc?: number; onSave?: string };
  damageParts?: Array<{ average?: number; formula?: string; types?: string[] }>;
};

const KIND_OPTIONS: [string, string][] = [
  ['attack', 'Attack'], ['save', 'Save'], ['utility', 'Utility'], ['heal', 'Heal'], ['damage', 'Damage'],
];
const ACTIVATION_OPTIONS: [string, string][] = [
  ['action', 'Action'], ['bonus', 'Bonus'], ['reaction', 'Reaction'], ['legendary', 'Legendary'],
  ['lair', 'Lair'], ['special', 'Special'], ['', '—'],
];
const ATTACK_TYPE_OPTIONS: [string, string][] = [['melee', 'Melee'], ['ranged', 'Ranged']];
const ON_SAVE_OPTIONS: [string, string][] = [['', 'no effect'], ['half', 'half damage'], ['none', 'none']];
const ABILITY_OPTIONS = ABILITY_ORDER.map((ab) => [ab, ABILITY_ABBR[ab]] as [string, string]);

export default function MonsterActivityEditor({ activities, onChange }: {
  activities: MonsterActivity[] | undefined;
  onChange: (next: MonsterActivity[]) => void;
}) {
  const list = Array.isArray(activities) ? activities : [];
  const update = (i: number, patch: Partial<MonsterActivity>) =>
    onChange(list.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  const remove = (i: number) => onChange(list.filter((_, idx) => idx !== i));
  const add = () => onChange([...list, { kind: 'attack', activation: 'action' }]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-widest text-gold/70">Activities <span className="text-ink/35 normal-case">(structured)</span></span>
        <button type="button" onClick={add} className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-gold/80 hover:text-gold border border-gold/30 rounded px-1.5 h-7">
          <Plus className="w-3 h-3" /> Activity
        </button>
      </div>
      {list.length === 0 ? (
        <p className="text-[11px] text-ink/40 italic">No structured activities. The prose above is what renders; activities add the machine-readable attack/save/damage for Foundry export + automation.</p>
      ) : null}
      {list.map((act, i) => {
        const kind = act.kind || 'utility';
        const dmg = Array.isArray(act.damageParts) ? act.damageParts : [];
        const setDmg = (parts: any[]) => update(i, { damageParts: parts });
        return (
          <div key={i} className="rounded border border-gold/15 bg-background/30 p-2 space-y-2">
            <div className="flex items-end gap-2">
              <Field label="Kind" className="w-28"><Sel value={kind} onChange={(v) => update(i, { kind: v })} options={KIND_OPTIONS} /></Field>
              <Field label="Activation" className="w-28"><Sel value={act.activation || ''} onChange={(v) => update(i, { activation: v })} options={ACTIVATION_OPTIONS} /></Field>
              <button type="button" onClick={() => remove(i)} className="ml-auto h-8 px-2 text-blood/70 hover:text-blood" title="Remove activity"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>

            {kind === 'attack' ? (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                <Field label="To hit"><NumField value={act.attack?.bonus ?? null} onChange={(v) => update(i, { attack: { ...act.attack, bonus: v ?? undefined } })} placeholder="+5" /></Field>
                <Field label="Type"><Sel value={act.attack?.type || 'melee'} onChange={(v) => update(i, { attack: { ...act.attack, type: v } })} options={ATTACK_TYPE_OPTIONS} /></Field>
                <Field label="Reach"><NumField value={act.attack?.reach ?? null} onChange={(v) => update(i, { attack: { ...act.attack, reach: v ?? undefined } })} placeholder="5" /></Field>
                <Field label="Range"><NumField value={act.attack?.range ?? null} onChange={(v) => update(i, { attack: { ...act.attack, range: v ?? undefined } })} placeholder="—" /></Field>
                <Field label="Long"><NumField value={act.attack?.long ?? null} onChange={(v) => update(i, { attack: { ...act.attack, long: v ?? undefined } })} placeholder="—" /></Field>
              </div>
            ) : null}

            {kind === 'save' ? (
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-end gap-2">
                  <Field label="DC" className="w-16"><NumField value={act.save?.dc ?? null} onChange={(v) => update(i, { save: { ...act.save, dc: v ?? undefined } })} placeholder="13" /></Field>
                  <Field label="On save" className="w-32"><Sel value={act.save?.onSave || ''} onChange={(v) => update(i, { save: { ...act.save, onSave: v || undefined } })} options={ON_SAVE_OPTIONS} /></Field>
                </div>
                <Field label="Abilities">
                  <ChipMultiSelect options={ABILITY_OPTIONS} value={act.save?.abilities} onChange={(v) => update(i, { save: { ...act.save, abilities: v } })} />
                </Field>
              </div>
            ) : null}

            {/* Damage parts — apply to attack / save / damage activities. */}
            {kind !== 'utility' ? (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-bold uppercase tracking-widest text-ink/45">Damage parts</span>
                  <button type="button" onClick={() => setDmg([...dmg, { formula: '', types: [] }])} className="inline-flex items-center gap-1 text-[10px] text-gold/75 hover:text-gold"><Plus className="w-3 h-3" /> Part</button>
                </div>
                {dmg.map((part, pi) => (
                  <div key={pi} className="flex flex-wrap items-end gap-2 rounded border border-gold/10 p-1.5">
                    <Field label="Avg" className="w-14"><NumField value={part.average ?? null} onChange={(v) => setDmg(dmg.map((p, x) => x === pi ? { ...p, average: v ?? undefined } : p))} placeholder="9" /></Field>
                    <Field label="Formula" className="w-28"><TextField value={part.formula} onChange={(v) => setDmg(dmg.map((p, x) => x === pi ? { ...p, formula: v } : p))} mono placeholder="2d6 + 3" /></Field>
                    <Field label="Types" className="flex-1 min-w-[10rem]"><ChipMultiSelect options={DAMAGE_TYPES} value={part.types} onChange={(v) => setDmg(dmg.map((p, x) => x === pi ? { ...p, types: v } : p))} /></Field>
                    <button type="button" onClick={() => setDmg(dmg.filter((_, x) => x !== pi))} className="h-8 px-1.5 text-blood/60 hover:text-blood" title="Remove part"><Trash2 className="w-3 h-3" /></button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
