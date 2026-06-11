import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import { cn } from '../../../lib/utils';
import MarkdownEditor from '../../MarkdownEditor';
import { Field, NumField, Sel } from './fields';
import { Input } from '../../ui/input';
import ActivityEditor from '../ActivityEditor';
import { formatUsesSuffix } from '../../../lib/monsterDisplay';

/**
 * Generic accordion editor for an action-like section (traits / actions /
 * bonus / reactions / legendary / lair / regional). Each entry = name + prose
 * (BBCode via MarkdownEditor) + optional uses/costs + optional structured
 * activities. Collapsed by default so only the open entry mounts a heavy
 * editor. Existing entries keep their `pageBucket`/`order`/`source_book` (round-
 * trip); new entries get `newDefaults`.
 */

type Entry = Record<string, any>;

export default function MonsterSectionListEditor({
  entries, onChange, options = {}, newDefaults = {}, addLabel = 'Add entry',
}: {
  entries: Entry[] | undefined;
  onChange: (next: Entry[]) => void;
  options?: { activities?: boolean; uses?: boolean; costs?: boolean };
  newDefaults?: Entry;
  addLabel?: string;
}) {
  const list = Array.isArray(entries) ? entries : [];
  const [open, setOpen] = useState<number | null>(null);

  const update = (i: number, patch: Entry) => onChange(list.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));
  const remove = (i: number) => { onChange(list.filter((_, idx) => idx !== i)); setOpen(null); };
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const next = list.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
    setOpen(j);
  };
  const add = () => {
    const next = [...list, { name: '', description: '', activities: [], ...newDefaults }];
    onChange(next);
    setOpen(next.length - 1);
  };

  return (
    <div className="space-y-1.5">
      {list.map((entry, i) => {
        const isOpen = open === i;
        const usesSuffix = options.uses ? formatUsesSuffix(entry.uses) : '';
        return (
          <div key={i} className="rounded border border-gold/15 bg-background/20">
            <div className="flex items-center gap-1.5 px-2 py-1.5">
              <div className="flex flex-col">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="text-ink/30 hover:text-gold disabled:opacity-20 leading-none" title="Move up"><ArrowUp className="w-3 h-3" /></button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === list.length - 1} className="text-ink/30 hover:text-gold disabled:opacity-20 leading-none" title="Move down"><ArrowDown className="w-3 h-3" /></button>
              </div>
              <Input
                value={entry.name ?? ''}
                onChange={(e) => update(i, { name: e.target.value })}
                placeholder="Entry name (blank = unnamed bullet)"
                className="h-8 bg-background/50 border-gold/15 focus:border-gold text-sm flex-1"
              />
              {usesSuffix ? <span className="text-[10px] italic text-ink/45 shrink-0">{usesSuffix}</span> : null}
              {options.costs && entry.costs ? <span className="text-[10px] italic text-ink/45 shrink-0">(Costs {entry.costs})</span> : null}
              <button type="button" onClick={() => setOpen(isOpen ? null : i)} className="h-8 px-1.5 text-gold/70 hover:text-gold" title={isOpen ? 'Collapse' : 'Expand'}>
                {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              <button type="button" onClick={() => remove(i)} className="h-8 px-1.5 text-blood/60 hover:text-blood" title="Delete entry"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
            {isOpen ? (
              <div className="border-t border-gold/10 p-2 space-y-2.5">
                <div>
                  <span className="block text-[10px] font-bold uppercase tracking-widest text-ink/45 pb-1">Description</span>
                  <MarkdownEditor value={String(entry.description || '')} onChange={(v) => update(i, { description: v })} className="min-h-[120px]" />
                </div>
                {options.uses ? <UsesEditor uses={entry.uses} onChange={(u) => update(i, { uses: u })} /> : null}
                {options.costs ? (
                  <Field label="Costs (legendary actions)" className="w-44">
                    <NumField value={entry.costs ?? null} onChange={(v) => update(i, { costs: v ?? undefined })} placeholder="1" />
                  </Field>
                ) : null}
                {options.activities ? (
                  <ActivityEditor
                    activities={entry.activities || []}
                    onChange={(a) => update(i, { activities: a })}
                    context="feat"
                  />
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
      <button type="button" onClick={add} className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-gold/80 hover:text-gold border border-gold/30 rounded px-2 h-8">
        <Plus className="w-3.5 h-3.5" /> {addLabel}
      </button>
    </div>
  );
}

// ─── uses editor ──────────────────────────────────────────────────
const PERIOD_OPTIONS: [string, string][] = [
  ['none', 'Always available'], ['recharge', 'Recharge X–6'], ['day', 'N per Day'],
  ['dawn', 'Recharges at Dawn'], ['dusk', 'Recharges at Dusk'],
  ['sr', 'Short/Long Rest'], ['lr', 'Long Rest'],
];

function UsesEditor({ uses, onChange }: { uses: any; onChange: (u: any) => void }) {
  const period = uses?.recovery?.[0]?.period || 'none';
  const rechargeVal = uses?.recovery?.[0]?.formula || '5';
  const perDay = uses?.max || '1';

  const setPeriod = (p: string) => {
    if (p === 'none') return onChange(undefined);
    if (p === 'recharge') return onChange({ max: '1', recovery: [{ period: 'recharge', formula: rechargeVal, type: 'recoverAll' }] });
    if (p === 'day') return onChange({ max: perDay, recovery: [{ period: 'day' }] });
    return onChange({ max: '1', recovery: [{ period: p }] });
  };

  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="Usage" className="w-40"><Sel value={period} onChange={setPeriod} options={PERIOD_OPTIONS} /></Field>
      {period === 'recharge' ? (
        <Field label="Recharge on" className="w-24">
          <NumField value={Number(rechargeVal) || 5} onChange={(v) => onChange({ max: '1', recovery: [{ period: 'recharge', formula: String(v ?? 5), type: 'recoverAll' }] })} placeholder="5" />
        </Field>
      ) : null}
      {period === 'day' ? (
        <Field label="Per day" className="w-20">
          <NumField value={Number(perDay) || 1} onChange={(v) => onChange({ max: String(v ?? 1), recovery: [{ period: 'day' }] })} placeholder="3" />
        </Field>
      ) : null}
    </div>
  );
}
