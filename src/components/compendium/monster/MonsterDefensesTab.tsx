import React from 'react';
import { cn } from '../../../lib/utils';
import {
  abilityMod, formatBonus, crToProfBonus,
  ABILITY_ORDER, ABILITY_ABBR, ABILITY_NAME, SKILL_ORDER, SKILL_NAME, SKILL_ABILITY, CONDITIONS,
} from '../../../lib/monsterDisplay';
import { Field, TextField, NumField, Nudge, MonsterFieldset, numOrNull, type MonsterForm, type SetForm } from './fields';
import ChipMultiSelect from './ChipMultiSelect';
import DamageModEditor from './DamageModEditor';

/**
 * Defenses tab: saving throws + skills (prefill + recompute nudge) and the
 * damage modifiers / condition immunities / languages pickers. Saves & skills
 * are sparse maps keyed by ability/skill; toggling a proficiency prefills the
 * bonus from `abilityMod + proficiencyBonus` (×2 PB for expertise) but stays
 * editable, with a nudge to re-adopt the computed value when an input drifts.
 *
 * `languages` (the option list) is supplied by the editor from the languages
 * catalog so authored slugs match the imported corpus.
 */
export default function MonsterDefensesTab({ form, set, languages }: {
  form: MonsterForm; set: SetForm; languages: ReadonlyArray<[string, string]>;
}) {
  const pb = numOrNull(form.proficiencyBonus) ?? crToProfBonus(numOrNull(form.cr)) ?? 2;
  const abScore = (ab: string) => Number(form.abilities?.[ab] ?? 10);

  const saves: Record<string, number> = form.saves || {};
  const skills: Record<string, { bonus?: number; expertise?: boolean }> = form.skills || {};

  const setSaves = (next: Record<string, number>) => set({ saves: next });
  const setSkills = (next: Record<string, any>) => set({ skills: next });

  const toggleSave = (ab: string) => {
    const next = { ...saves };
    if (next[ab] != null) delete next[ab];
    else next[ab] = abilityMod(abScore(ab)) + pb;
    setSaves(next);
  };
  const toggleSkill = (slug: string) => {
    const next = { ...skills };
    if (next[slug]) delete next[slug];
    else next[slug] = { bonus: abilityMod(abScore(SKILL_ABILITY[slug])) + pb, expertise: false };
    setSkills(next);
  };

  return (
    <div className="space-y-4">
      <MonsterFieldset legend="Saving throws">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {ABILITY_ORDER.map((ab) => {
            const proficient = saves[ab] != null;
            const expected = abilityMod(abScore(ab)) + pb;
            const drift = proficient && saves[ab] !== expected;
            return (
              <div key={ab} className={cn('flex items-center gap-2 rounded border px-2 h-9', proficient ? 'border-gold/30 bg-gold/[0.04]' : 'border-gold/10')}>
                <label className="flex items-center gap-1.5 cursor-pointer select-none shrink-0" title={ABILITY_NAME[ab]}>
                  <input type="checkbox" checked={proficient} onChange={() => toggleSave(ab)} className="accent-[var(--gold,#9a7d3b)]" />
                  <span className="text-xs font-bold uppercase text-ink/80 w-8">{ABILITY_ABBR[ab]}</span>
                </label>
                {proficient ? (
                  <div className="flex items-center gap-1 ml-auto">
                    <NumField value={saves[ab]} onChange={(v) => setSaves({ ...saves, [ab]: v ?? 0 })} className="h-7 w-16" />
                    {drift ? <Nudge label={`→ ${formatBonus(expected)}`} onClick={() => setSaves({ ...saves, [ab]: expected })} title="Adopt mod + proficiency bonus" /> : null}
                  </div>
                ) : (
                  <span className="ml-auto text-[10px] text-ink/35 font-mono">{formatBonus(abilityMod(abScore(ab)))}</span>
                )}
              </div>
            );
          })}
        </div>
      </MonsterFieldset>

      <MonsterFieldset legend="Skills">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-1.5">
          {SKILL_ORDER.map((slug) => {
            const entry = skills[slug];
            const trained = !!entry;
            const expertise = !!entry?.expertise;
            const baseMod = abilityMod(abScore(SKILL_ABILITY[slug]));
            const expected = baseMod + pb * (expertise ? 2 : 1);
            const drift = trained && entry?.bonus !== expected;
            return (
              <div key={slug} className={cn('flex items-center gap-2 rounded border px-2 h-9', trained ? 'border-gold/30 bg-gold/[0.04]' : 'border-gold/10')}>
                <label className="flex items-center gap-1.5 cursor-pointer select-none min-w-0 shrink">
                  <input type="checkbox" checked={trained} onChange={() => toggleSkill(slug)} className="accent-[var(--gold,#9a7d3b)] shrink-0" />
                  <span className="text-xs text-ink/85 truncate">{SKILL_NAME[slug]}</span>
                  <span className="text-[9px] uppercase text-ink/35 shrink-0">{ABILITY_ABBR[SKILL_ABILITY[slug]]}</span>
                </label>
                {trained ? (
                  <div className="flex items-center gap-1 ml-auto shrink-0">
                    <label className="flex items-center gap-1 text-[9px] uppercase tracking-wide text-ink/55 cursor-pointer" title="Expertise (double proficiency)">
                      <input type="checkbox" checked={expertise} onChange={() => setSkills({ ...skills, [slug]: { ...entry, expertise: !expertise } })} className="accent-[var(--gold,#9a7d3b)]" />
                      Exp
                    </label>
                    <NumField value={entry?.bonus ?? null} onChange={(v) => setSkills({ ...skills, [slug]: { ...entry, bonus: v ?? 0 } })} className="h-7 w-16" />
                    {drift ? <Nudge label={`→ ${formatBonus(expected)}`} onClick={() => setSkills({ ...skills, [slug]: { ...entry, bonus: expected } })} title="Adopt mod + proficiency (×2 for expertise)" /> : null}
                  </div>
                ) : (
                  <span className="ml-auto text-[10px] text-ink/35 font-mono shrink-0">{formatBonus(baseMod)}</span>
                )}
              </div>
            );
          })}
        </div>
        <p className="text-[10px] text-ink/45 pt-1.5 px-1">Toggling a save/skill prefills its bonus from the ability modifier + proficiency bonus. Edit freely; the nudge re-adopts the computed value if you change an ability or the proficiency bonus.</p>
      </MonsterFieldset>

      <MonsterFieldset legend="Damage modifiers">
        <div className="space-y-2">
          <DamageModEditor label="Vulnerabilities" block={form.damageVulnerabilities} onChange={(b) => set({ damageVulnerabilities: b })} />
          <DamageModEditor label="Resistances" block={form.damageResistances} onChange={(b) => set({ damageResistances: b })} />
          <DamageModEditor label="Immunities" block={form.damageImmunities} onChange={(b) => set({ damageImmunities: b })} />
        </div>
      </MonsterFieldset>

      <MonsterFieldset legend="Condition immunities">
        <ChipMultiSelect options={CONDITIONS} value={form.conditionImmunities?.value}
          onChange={(v) => set({ conditionImmunities: { ...(form.conditionImmunities || {}), value: v } })} />
        <TextField className="mt-2" value={form.conditionImmunities?.custom}
          onChange={(v) => set({ conditionImmunities: { ...(form.conditionImmunities || {}), custom: v || undefined } })}
          placeholder="custom condition-immunity note" />
      </MonsterFieldset>

      <MonsterFieldset legend="Languages">
        <ChipMultiSelect options={languages} value={form.languages?.value}
          onChange={(v) => set({ languages: { ...(form.languages || {}), value: v } })} />
        <div className="flex flex-wrap gap-3 mt-2">
          <Field label="Telepathy (ft)" className="w-28">
            <NumField value={form.languages?.telepathy ?? null}
              onChange={(v) => set({ languages: { ...(form.languages || {}), telepathy: v ?? undefined } })} />
          </Field>
          <Field label="Custom" className="flex-1 min-w-[12rem]">
            <TextField value={form.languages?.custom}
              onChange={(v) => set({ languages: { ...(form.languages || {}), custom: v || undefined } })}
              placeholder="e.g. understands Common but can't speak it" />
          </Field>
        </div>
      </MonsterFieldset>
    </div>
  );
}
