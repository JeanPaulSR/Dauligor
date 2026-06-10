import React from 'react';
import { slugify } from '../../../lib/utils';
import {
  formatCr, formatXp, crToXp, crToProfBonus, abilityMod, formatBonus,
  CREATURE_TYPE_LABEL, SIZE_LABEL, ABILITY_ORDER, ABILITY_ABBR,
} from '../../../lib/monsterDisplay';
import {
  Field, TextField, NumField, Sel, Nudge, MonsterFieldset, numOrNull,
  type MonsterForm, type SetForm,
} from './fields';
import { ImageUpload } from '../../ui/ImageUpload';

type SourceRecord = { id: string; name?: string; abbreviation?: string; [k: string]: any };

const CREATURE_TYPE_OPTIONS = Object.entries(CREATURE_TYPE_LABEL) as [string, string][];
const SIZE_OPTIONS = Object.entries(SIZE_LABEL) as [string, string][];
const CR_OPTIONS: ReadonlyArray<[string, string]> = [
  ['0', '0'], ['0.125', '1/8'], ['0.25', '1/4'], ['0.5', '1/2'],
  ...Array.from({ length: 30 }, (_, i) => [String(i + 1), String(i + 1)] as [string, string]),
];

export default function MonsterBasicsTab({ form, set, sources, monsterId }: {
  form: MonsterForm; set: SetForm; sources: SourceRecord[]; monsterId: string | null;
}) {
  const cr = numOrNull(form.cr);
  const suggestedProf = crToProfBonus(cr);
  const showProfNudge = suggestedProf != null && numOrNull(form.proficiencyBonus) !== suggestedProf;

  const setAbility = (ab: string, raw: string) => {
    const next = { ...(form.abilities || {}) };
    next[ab] = raw === '' ? null : Number(raw);
    set({ abilities: next });
  };

  return (
    <div className="space-y-4">
      <MonsterFieldset legend="Identity">
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
          <Field label="Name">
            <TextField value={form.name} onChange={(v) => set({ name: v })} placeholder="e.g. Goblin Boss" />
          </Field>
          <Field label="Identifier">
            <TextField value={form.identifier} onChange={(v) => set({ identifier: v })} mono placeholder={slugify(form.name || 'monster')} />
          </Field>
          <Field label="Source">
            <Sel value={form.sourceId ?? ''} onChange={(v) => set({ sourceId: v })}
              options={[['', '— none —'], ...sources.map((s): [string, string] => [String(s.id), String(s.name || s.abbreviation || s.id)])]} />
          </Field>
          <Field label="Page">
            <TextField value={form.page} onChange={(v) => set({ page: v })} placeholder="12" />
          </Field>
        </div>
      </MonsterFieldset>

      <MonsterFieldset legend="Type line">
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
          <Field label="Size">
            <Sel value={form.size ?? ''} onChange={(v) => set({ size: v })} options={[['', '— size —'], ...SIZE_OPTIONS]} />
          </Field>
          <Field label="Type">
            <Sel value={form.creatureType ?? ''} onChange={(v) => set({ creatureType: v })} options={[['', '— type —'], ...CREATURE_TYPE_OPTIONS]} />
          </Field>
          <Field label="Subtype">
            <TextField value={form.typeSubtype} onChange={(v) => set({ typeSubtype: v || null })} placeholder="goblinoid" />
          </Field>
          <Field label="Alignment">
            <TextField value={form.alignment} onChange={(v) => set({ alignment: v })} placeholder="Neutral Evil" />
          </Field>
        </div>
      </MonsterFieldset>

      <MonsterFieldset legend="Core stats">
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
          <Field label={`Challenge${cr != null ? ` · ${formatXp(crToXp(cr))} XP` : ''}`}>
            <Sel value={cr == null ? '' : String(cr)} onChange={(v) => set({ cr: v === '' ? null : Number(v) })}
              options={[['', '— CR —'], ...CR_OPTIONS]} />
          </Field>
          <Field label="Armor Class">
            <NumField value={form.ac} onChange={(v) => set({ ac: v })} placeholder="15" />
          </Field>
          <Field label="AC Note">
            <TextField value={form.acNote} onChange={(v) => set({ acNote: v })} placeholder="natural armor" />
          </Field>
          <Field label="Hit Points">
            <NumField value={form.hp} onChange={(v) => set({ hp: v })} placeholder="21" />
          </Field>
          <Field label="HP Formula">
            <TextField value={form.hpFormula} onChange={(v) => set({ hpFormula: v })} mono placeholder="6d8 + 6" />
          </Field>
          <Field label="Proficiency Bonus">
            <div className="flex items-center gap-1.5">
              <NumField value={form.proficiencyBonus} onChange={(v) => set({ proficiencyBonus: v })} placeholder="2" />
              {showProfNudge ? (
                <Nudge label={`→ +${suggestedProf}`} onClick={() => set({ proficiencyBonus: suggestedProf })}
                  title={`Adopt the CR-derived proficiency bonus (+${suggestedProf})`} />
              ) : null}
            </div>
          </Field>
        </div>
        <p className="text-[10px] text-ink/45 pt-1 px-1">XP follows the Challenge rating automatically. Proficiency bonus, saves, skills, and passive Perception keep authored values — use the nudge to adopt a derived value.</p>
      </MonsterFieldset>

      <MonsterFieldset legend="Portrait & token">
        <div className="flex flex-wrap gap-6">
          <div className="space-y-1">
            <span className="block text-[10px] font-bold uppercase tracking-widest text-ink/45">Portrait</span>
            <ImageUpload
              currentImageUrl={form.imageUrl}
              storagePath={`images/monsters/${monsterId || 'draft'}/portrait/`}
              onUpload={(url) => set({ imageUrl: url })}
              imageType="icon"
              compact
              className="h-[96px] w-[96px]"
            />
          </div>
          <div className="space-y-1">
            <span className="block text-[10px] font-bold uppercase tracking-widest text-ink/45">Token</span>
            <ImageUpload
              currentImageUrl={form.tokenImageUrl}
              storagePath={`images/monsters/${monsterId || 'draft'}/token/`}
              onUpload={(url) => set({ tokenImageUrl: url })}
              imageType="icon"
              compact
              className="h-[96px] w-[96px]"
            />
          </div>
        </div>
      </MonsterFieldset>

      <MonsterFieldset legend="Ability scores">
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {ABILITY_ORDER.map((ab) => {
            const raw = form.abilities?.[ab];
            const hasVal = raw != null && raw !== '';
            return (
              <Field key={ab} label={ABILITY_ABBR[ab]}>
                <div className="relative">
                  <NumField value={raw ?? null} onChange={(v) => setAbility(ab, v == null ? '' : String(v))} placeholder="10" />
                  <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-mono text-gold/70">
                    {hasVal ? formatBonus(abilityMod(Number(raw))) : ''}
                  </span>
                </div>
              </Field>
            );
          })}
        </div>
      </MonsterFieldset>
    </div>
  );
}
