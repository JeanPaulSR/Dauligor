import React from 'react';
import { abilityMod, computePassivePerception } from '../../../lib/monsterDisplay';
import {
  Field, TextField, NumField, Nudge, MonsterFieldset, numOrNull,
  type MonsterForm, type SetForm,
} from './fields';

const MOVE_MODES: [string, string][] = [
  ['walk', 'Walk'], ['fly', 'Fly'], ['swim', 'Swim'], ['climb', 'Climb'], ['burrow', 'Burrow'],
];
const SENSE_MODES: [string, string][] = [
  ['blindsight', 'Blindsight'], ['darkvision', 'Darkvision'], ['tremorsense', 'Tremorsense'], ['truesight', 'Truesight'],
];

/**
 * Movement & Senses tab (P2). Movement / senses are JSON columns of nullable
 * numeric ranges (+ units / special / hover). Passive Perception is a scalar
 * column with a nudge that recomputes 10 + the Perception skill bonus (falling
 * back to the Wisdom modifier when Perception isn't trained). Habitat lands in P3.
 */
export default function MonsterMovementSensesTab({ form, set }: { form: MonsterForm; set: SetForm }) {
  const movement = form.movement || {};
  const senses = form.senses || {};
  const setMove = (k: string, v: any) => set({ movement: { units: 'ft', ...movement, [k]: v } });
  const setSense = (k: string, v: any) => set({ senses: { units: 'ft', ...senses, [k]: v } });

  const wisMod = abilityMod(Number(form.abilities?.wis ?? 10));
  const perceptionBonus = form.skills?.prc?.bonus;
  const expectedPassive = computePassivePerception(perceptionBonus != null ? perceptionBonus : wisMod);
  const passiveDrift = numOrNull(form.passivePerception) !== expectedPassive;

  return (
    <div className="space-y-4">
      <MonsterFieldset legend="Speed">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {MOVE_MODES.map(([k, label]) => (
            <Field key={k} label={label}>
              <NumField value={movement[k] ?? null} onChange={(v) => setMove(k, v)} placeholder={k === 'walk' ? '30' : '—'} />
            </Field>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3 pt-2">
          <label className="flex items-center gap-1.5 text-xs text-ink/70 cursor-pointer select-none h-8">
            <input type="checkbox" checked={!!movement.hover} onChange={() => setMove('hover', !movement.hover)} className="accent-[var(--gold,#9a7d3b)]" />
            Hover
          </label>
          <Field label="Units" className="w-20">
            <TextField value={movement.units ?? 'ft'} onChange={(v) => setMove('units', v || 'ft')} placeholder="ft" />
          </Field>
          <Field label="Special" className="flex-1 min-w-[10rem]">
            <TextField value={movement.special} onChange={(v) => setMove('special', v || undefined)} placeholder="e.g. equal to walking speed in beast form" />
          </Field>
        </div>
      </MonsterFieldset>

      <MonsterFieldset legend="Senses">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {SENSE_MODES.map(([k, label]) => (
            <Field key={k} label={label}>
              <NumField value={senses[k] ?? null} onChange={(v) => setSense(k, v)} placeholder="—" />
            </Field>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3 pt-2">
          <Field label="Passive Perception">
            <div className="flex items-center gap-1.5">
              <NumField value={form.passivePerception} onChange={(v) => set({ passivePerception: v })} placeholder={String(expectedPassive)} className="w-20" />
              {passiveDrift ? (
                <Nudge label={`→ ${expectedPassive}`} onClick={() => set({ passivePerception: expectedPassive })}
                  title={perceptionBonus != null ? 'Adopt 10 + Perception bonus' : 'Adopt 10 + Wisdom modifier (Perception not trained)'} />
              ) : null}
            </div>
          </Field>
          <Field label="Units" className="w-20">
            <TextField value={senses.units ?? 'ft'} onChange={(v) => setSense('units', v || 'ft')} placeholder="ft" />
          </Field>
          <Field label="Special" className="flex-1 min-w-[10rem]">
            <TextField value={senses.special} onChange={(v) => setSense('special', v || undefined)} placeholder="e.g. can't be surprised while…" />
          </Field>
        </div>
      </MonsterFieldset>
    </div>
  );
}
