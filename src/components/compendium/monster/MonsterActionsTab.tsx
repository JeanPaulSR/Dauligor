import React from 'react';
import MarkdownEditor from '../../MarkdownEditor';
import { Field, NumField, MonsterFieldset, type MonsterForm, type SetForm } from './fields';
import MonsterSectionListEditor from './MonsterSectionListEditor';

/**
 * Actions & Traits tab — the seven body sections plus their section-level
 * scalars. Each section is a `MonsterSectionListEditor` (name + prose + optional
 * uses/costs + structured activities). The reader renders the PROSE; the
 * structured activities are the machine-readable copy (Foundry export +
 * automation + the synthesized fallback).
 */
export default function MonsterActionsTab({ form, set }: { form: MonsterForm; set: SetForm }) {
  return (
    <div className="space-y-4">
      <MonsterFieldset legend="Traits">
        <MonsterSectionListEditor
          entries={form.traits}
          onChange={(v) => set({ traits: v })}
          options={{ activities: true, uses: true }}
          newDefaults={{ pageBucket: 'monsterTrait' }}
          addLabel="Add trait"
        />
        <Field label="Legendary Resistance / Day" className="w-48 pt-2">
          <NumField value={form.legendaryResistanceCount ?? null} onChange={(v) => set({ legendaryResistanceCount: v ?? undefined })} placeholder="3" />
        </Field>
      </MonsterFieldset>

      <MonsterFieldset legend="Actions">
        <MonsterSectionListEditor entries={form.actions} onChange={(v) => set({ actions: v })}
          options={{ activities: true, uses: true }} newDefaults={{ pageBucket: 'monsterAction' }} addLabel="Add action" />
      </MonsterFieldset>

      <MonsterFieldset legend="Bonus actions">
        <MonsterSectionListEditor entries={form.bonusActions} onChange={(v) => set({ bonusActions: v })}
          options={{ activities: true, uses: true }} newDefaults={{ pageBucket: 'monsterBonus' }} addLabel="Add bonus action" />
      </MonsterFieldset>

      <MonsterFieldset legend="Reactions">
        <MonsterSectionListEditor entries={form.reactions} onChange={(v) => set({ reactions: v })}
          options={{ activities: true, uses: true }} newDefaults={{ pageBucket: 'monsterReaction' }} addLabel="Add reaction" />
      </MonsterFieldset>

      <MonsterFieldset legend="Legendary actions">
        <div className="flex flex-wrap items-end gap-3 pb-2">
          <Field label="Actions / round" className="w-32"><NumField value={form.legendaryActionCount ?? null} onChange={(v) => set({ legendaryActionCount: v ?? undefined })} placeholder="3" /></Field>
        </div>
        <div className="pb-2">
          <span className="block text-[10px] font-bold uppercase tracking-widest text-ink/45 pb-1">Preamble</span>
          <MarkdownEditor value={String(form.legendaryActionsPreamble || '')} onChange={(v) => set({ legendaryActionsPreamble: v })} className="min-h-[90px]" />
        </div>
        <MonsterSectionListEditor entries={form.legendaryActions} onChange={(v) => set({ legendaryActions: v })}
          options={{ activities: true, costs: true }} newDefaults={{ pageBucket: 'monsterLegendary' }} addLabel="Add legendary action" />
      </MonsterFieldset>

      <MonsterFieldset legend="Lair actions">
        <Field label="Lair initiative count" className="w-40 pb-2"><NumField value={form.lairInitiative ?? null} onChange={(v) => set({ lairInitiative: v ?? undefined })} placeholder="20" /></Field>
        <MonsterSectionListEditor entries={form.lairActions} onChange={(v) => set({ lairActions: v })}
          options={{ activities: true }} newDefaults={{ pageBucket: 'monsterLairActions' }} addLabel="Add lair action" />
      </MonsterFieldset>

      <MonsterFieldset legend="Regional effects">
        <MonsterSectionListEditor entries={form.regionalEffects} onChange={(v) => set({ regionalEffects: v })}
          options={{}} newDefaults={{}} addLabel="Add regional effect" />
      </MonsterFieldset>
    </div>
  );
}
