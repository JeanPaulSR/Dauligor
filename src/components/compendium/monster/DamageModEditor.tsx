import React from 'react';
import { DAMAGE_TYPES, DAMAGE_BYPASSES } from '../../../lib/monsterDisplay';
import ChipMultiSelect from './ChipMultiSelect';
import { TextField } from './fields';

type DamageBlock = { value?: string[]; bypasses?: string[]; custom?: string };

/**
 * One damage-modifier block (Vulnerabilities / Resistances / Immunities).
 * Shape: `{ value: string[], bypasses: string[], custom?: string }`. The
 * bypass flags (mgc/sil/ada) are block-level — a block flagged `mgc` renders
 * as "…from nonmagical attacks". `bypasses` MUST survive edits (the schema
 * gotcha) so they're first-class here.
 */
export default function DamageModEditor({ label, block, onChange }: {
  label: string; block: DamageBlock | undefined; onChange: (next: DamageBlock) => void;
}) {
  const b: DamageBlock = block || { value: [], bypasses: [] };
  const toggleBypass = (slug: string) => {
    const set = new Set(b.bypasses || []);
    if (set.has(slug)) set.delete(slug); else set.add(slug);
    onChange({ ...b, bypasses: [...set] });
  };
  return (
    <div className="space-y-1.5 rounded border border-gold/10 p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-ink/45">{label}</span>
        <div className="flex items-center gap-2.5">
          <span className="text-[9px] uppercase tracking-wide text-ink/35">Bypassed by</span>
          {DAMAGE_BYPASSES.map(([slug, lbl]) => {
            const on = (b.bypasses || []).includes(slug);
            return (
              <label key={slug} className="flex items-center gap-1 text-[10px] text-ink/65 cursor-pointer select-none" title={`Rendered as "…from non${lbl.toLowerCase()} attacks"`}>
                <input type="checkbox" checked={on} onChange={() => toggleBypass(slug)} className="accent-[var(--gold,#9a7d3b)]" />
                {lbl}
              </label>
            );
          })}
        </div>
      </div>
      <ChipMultiSelect options={DAMAGE_TYPES} value={b.value} onChange={(v) => onChange({ ...b, value: v })} />
      <TextField value={b.custom} onChange={(v) => onChange({ ...b, custom: v || undefined })} placeholder="custom (e.g. damage from nonmagical attacks that aren't silvered)" />
    </div>
  );
}
