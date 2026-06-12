import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Plus, Trash2, ArrowUp, ArrowDown, X } from 'lucide-react';
import { cn } from '../../../lib/utils';
import MarkdownEditor from '../../MarkdownEditor';
import { Input } from '../../ui/input';
import { Field, NumField, Sel, Nudge, MonsterFieldset, type MonsterForm, type SetForm } from './fields';
import {
  ABILITY_NAME, ABILITY_ORDER, abilityMod, crToProfBonus, formatBonus, titleCase,
} from '../../../lib/monsterDisplay';

/** "1st level" … "9th level" for slot/level labels (local — the reader has its own `ordinal`). */
function ordinalSpellLevel(lvl: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = lvl % 100;
  return `${lvl}${s[(v - 20) % 10] || s[v] || s[0]} level`;
}

/**
 * Spellcasting tab (P5) — edits the `spellcasting[]` block array. Most casters
 * have one block; dual-casters (e.g. a creature with both Spellcasting and
 * Innate Spellcasting) have two, so this is an add/remove/reorder list. Each
 * block carries ability/level/save-DC/attack-bonus/method/slots/prose plus a
 * `spells[]` list linked to the spell catalog by `identifier` (the SAME shape
 * the reader's SpellcastingBlock renders + the export ships).
 *
 * DC and attack bonus get a recompute nudge from the creature's proficiency
 * bonus + the block ability's modifier (`8 + PB + mod` / `PB + mod`), mirroring
 * the saves/skills nudges on the Defenses tab — authored values otherwise stick.
 */

export type SpellCatalogEntry = { id?: string; identifier: string; name: string; level: number };

type SpellRef = { identifier?: string; name?: string; level?: number; method?: string; uses?: any };
type Block = {
  ability?: string; level?: number; saveDc?: number; attackBonus?: number;
  method?: string; slots?: Record<string, number>;
  pactSlots?: { count?: number; level?: number };
  prose?: string; spells?: SpellRef[];
};

const METHOD_OPTIONS: ReadonlyArray<[string, string]> = [
  ['spell', 'Prepared / Spellbook'],
  ['innate', 'Innate'],
  ['pact', 'Pact Magic'],
  ['atwill', 'At Will'],
];
const ABILITY_OPTIONS: ReadonlyArray<[string, string]> =
  ABILITY_ORDER.map((a) => [a, ABILITY_NAME[a]] as [string, string]);

export default function MonsterSpellcastingTab({
  form, set, spellCatalog,
}: { form: MonsterForm; set: SetForm; spellCatalog: SpellCatalogEntry[] }) {
  const blocks: Block[] = Array.isArray(form.spellcasting) ? form.spellcasting : [];
  const [open, setOpen] = useState<number | null>(blocks.length === 1 ? 0 : null);

  // Creature-level PB used for the DC / attack-bonus nudges. Prefer the exact
  // imported value; fall back to the CR-derived table.
  const pb = useMemo(() => {
    const exact = Number(form.proficiencyBonus);
    if (Number.isFinite(exact) && exact > 0) return exact;
    return crToProfBonus(form.cr ?? null) ?? 0;
  }, [form.proficiencyBonus, form.cr]);

  const update = (i: number, patch: Partial<Block>) =>
    set({ spellcasting: blocks.map((b, idx) => (idx === i ? { ...b, ...patch } : b)) });
  const remove = (i: number) => { set({ spellcasting: blocks.filter((_, idx) => idx !== i) }); setOpen(null); };
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= blocks.length) return;
    const next = blocks.slice();
    [next[i], next[j]] = [next[j], next[i]];
    set({ spellcasting: next });
    setOpen(j);
  };
  const addBlock = () => {
    const next = [...blocks, { ability: 'int', method: 'spell', spells: [], slots: {} } as Block];
    set({ spellcasting: next });
    setOpen(next.length - 1);
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink/50 leading-relaxed">
        Most creatures need a single block. Add a second only for a creature with two distinct
        casting features (e.g. <em>Spellcasting</em> plus <em>Innate Spellcasting</em>). Spells link to
        the catalog by identifier — the reader and Foundry export resolve them from there.
      </p>

      {blocks.map((block, i) => {
        const isOpen = open === i;
        const score = Number(form.abilities?.[String(block.ability || 'int')] ?? 10);
        const mod = abilityMod(score);
        const dcCalc = 8 + pb + mod;
        const atkCalc = pb + mod;
        const spellCount = Array.isArray(block.spells) ? block.spells.length : 0;
        const methodLabel = (METHOD_OPTIONS.find(([v]) => v === block.method)?.[1]) || 'Spellcasting';
        return (
          <div key={i} className="rounded border border-gold/15 bg-background/20">
            <div className="flex items-center gap-1.5 px-2 py-1.5">
              <div className="flex flex-col">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="text-ink/30 hover:text-gold disabled:opacity-20 leading-none" title="Move up"><ArrowUp className="w-3 h-3" /></button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === blocks.length - 1} className="text-ink/30 hover:text-gold disabled:opacity-20 leading-none" title="Move down"><ArrowDown className="w-3 h-3" /></button>
              </div>
              <span className="flex-1 text-sm font-serif text-ink">
                {methodLabel}
                <span className="text-ink/45 font-sans text-xs">
                  {' · '}{ABILITY_NAME[String(block.ability || 'int')] || 'Int'}
                  {block.saveDc ? ` · DC ${block.saveDc}` : ''}
                  {` · ${spellCount} spell${spellCount === 1 ? '' : 's'}`}
                </span>
              </span>
              <button type="button" onClick={() => setOpen(isOpen ? null : i)} className="h-8 px-1.5 text-gold/70 hover:text-gold" title={isOpen ? 'Collapse' : 'Expand'}>
                {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              <button type="button" onClick={() => remove(i)} className="h-8 px-1.5 text-blood/60 hover:text-blood" title="Delete block"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>

            {isOpen ? (
              <div className="border-t border-gold/10 p-2.5 space-y-3">
                <div className="flex flex-wrap items-end gap-3">
                  <Field label="Method" className="w-44"><Sel value={String(block.method || 'spell')} onChange={(v) => update(i, { method: v })} options={METHOD_OPTIONS} /></Field>
                  <Field label="Ability" className="w-40"><Sel value={String(block.ability || 'int')} onChange={(v) => update(i, { ability: v })} options={ABILITY_OPTIONS} /></Field>
                  <Field label="Caster level" className="w-28"><NumField value={block.level ?? null} onChange={(v) => update(i, { level: v ?? undefined })} placeholder="9" /></Field>
                </div>

                <div className="flex flex-wrap items-end gap-3">
                  <Field label="Spell save DC" className="w-32"><NumField value={block.saveDc ?? null} onChange={(v) => update(i, { saveDc: v ?? undefined })} placeholder="14" /></Field>
                  <Nudge label={`→ DC ${dcCalc}`} title={`8 + PB ${formatBonus(pb)} + ${ABILITY_NAME[String(block.ability || 'int')]} mod ${formatBonus(mod)}`} onClick={() => update(i, { saveDc: dcCalc })} />
                  <Field label="Spell attack" className="w-32"><NumField value={block.attackBonus ?? null} onChange={(v) => update(i, { attackBonus: v ?? undefined })} placeholder="6" /></Field>
                  <Nudge label={`→ ${formatBonus(atkCalc)}`} title={`PB ${formatBonus(pb)} + ${ABILITY_NAME[String(block.ability || 'int')]} mod ${formatBonus(mod)}`} onClick={() => update(i, { attackBonus: atkCalc })} />
                </div>

                {block.method === 'pact' ? (
                  <PactSlotsEditor block={block} onChange={(patch) => update(i, patch)} />
                ) : block.method === 'spell' || block.method == null ? (
                  <SpellSlotsEditor slots={block.slots} onChange={(slots) => update(i, { slots })} />
                ) : null}

                <SpellListEditor
                  block={block}
                  catalog={spellCatalog}
                  onChange={(spells) => update(i, { spells })}
                />

                <div>
                  <span className="block text-[10px] font-bold uppercase tracking-widest text-ink/45 pb-1">Description (prose)</span>
                  <MarkdownEditor value={String(block.prose || '')} onChange={(v) => update(i, { prose: v })} className="min-h-[110px]" />
                  <p className="text-[10px] text-ink/40 pt-1">The reader strips the spell-list menu from this prose and re-renders it from the linked spells above, so you needn't repeat the list here.</p>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}

      <button type="button" onClick={addBlock} className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-gold/80 hover:text-gold border border-gold/30 rounded px-2 h-8">
        <Plus className="w-3.5 h-3.5" /> Add spellcasting block
      </button>
    </div>
  );
}

// ─── slot editors ─────────────────────────────────────────────────
const SPELL_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

function SpellSlotsEditor({ slots, onChange }: { slots?: Record<string, number>; onChange: (s: Record<string, number>) => void }) {
  const setLevel = (lvl: number, n: number | null) => {
    const next: Record<string, number> = { ...(slots || {}) };
    if (n == null || n <= 0) delete next[`spell${lvl}`];
    else next[`spell${lvl}`] = n;
    onChange(next);
  };
  return (
    <MonsterFieldset legend="Spell slots">
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
        {SPELL_LEVELS.map((lvl) => (
          <Field key={lvl} label={ordinalSpellLevel(lvl)}>
            <NumField value={slots?.[`spell${lvl}`] ?? null} onChange={(v) => setLevel(lvl, v)} placeholder="0" />
          </Field>
        ))}
      </div>
    </MonsterFieldset>
  );
}

function PactSlotsEditor({ block, onChange }: { block: Block; onChange: (patch: Partial<Block>) => void }) {
  const pact = block.pactSlots || {};
  return (
    <MonsterFieldset legend="Pact magic slots">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Slots" className="w-24"><NumField value={pact.count ?? null} onChange={(v) => onChange({ pactSlots: { ...pact, count: v ?? undefined } })} placeholder="2" /></Field>
        <Field label="Slot level" className="w-28"><NumField value={pact.level ?? null} onChange={(v) => onChange({ pactSlots: { ...pact, level: v ?? undefined } })} placeholder="3" /></Field>
      </div>
    </MonsterFieldset>
  );
}

// ─── spell list editor (catalog picker + grouped list) ────────────
function SpellListEditor({
  block, catalog, onChange,
}: { block: Block; catalog: SpellCatalogEntry[]; onChange: (spells: SpellRef[]) => void }) {
  const spells: SpellRef[] = Array.isArray(block.spells) ? block.spells : [];
  const innate = block.method === 'innate' || block.method === 'atwill';
  const chosen = useMemo(() => new Set(spells.map((s) => String(s.identifier || '').toLowerCase())), [spells]);

  const addSpell = (entry: SpellCatalogEntry) => {
    if (chosen.has(entry.identifier.toLowerCase())) return;
    onChange([...spells, { identifier: entry.identifier, name: entry.name, level: entry.level, method: block.method || 'spell' }]);
  };
  const removeSpell = (identifier: string) =>
    onChange(spells.filter((s) => String(s.identifier) !== identifier));
  const updateSpell = (identifier: string, patch: Partial<SpellRef>) =>
    onChange(spells.map((s) => (String(s.identifier) === identifier ? { ...s, ...patch } : s)));

  // Group selected spells by level for display (cantrips first).
  const byLevel = useMemo(() => {
    const m = new Map<number, SpellRef[]>();
    for (const sp of spells) {
      const lvl = Number(sp.level ?? 0);
      if (!m.has(lvl)) m.set(lvl, []);
      m.get(lvl)!.push(sp);
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [spells]);

  return (
    <MonsterFieldset legend={`Spells (${spells.length})`}>
      <SpellPicker catalog={catalog} chosen={chosen} onAdd={addSpell} />
      {byLevel.length === 0 ? (
        <p className="text-xs italic text-ink/40 pt-2">No spells linked yet — search above to add them.</p>
      ) : (
        <div className="space-y-2 pt-2">
          {byLevel.map(([lvl, list]) => (
            <div key={lvl}>
              <span className="block text-[10px] font-bold uppercase tracking-widest text-gold/70 pb-1">
                {lvl === 0 ? 'Cantrips' : ordinalSpellLevel(lvl)}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {list.map((sp) => (
                  <span key={String(sp.identifier)} className="inline-flex items-center gap-1.5 rounded border border-gold/20 bg-background/40 pl-2 pr-1 h-7 text-xs text-ink">
                    {sp.name || titleCase(String(sp.identifier || ''))}
                    {innate ? (
                      <input
                        type="number"
                        value={usesPerDay(sp.uses) ?? ''}
                        onChange={(e) => updateSpell(String(sp.identifier), { uses: buildDayUses(e.target.value) })}
                        placeholder="/day"
                        title="Uses per day (innate) — blank = at will"
                        className="w-12 h-5 bg-background/60 border border-gold/15 rounded px-1 text-[11px] text-ink/80 tabular-nums"
                      />
                    ) : null}
                    <button type="button" onClick={() => removeSpell(String(sp.identifier))} className="text-blood/50 hover:text-blood" title="Remove spell"><X className="w-3 h-3" /></button>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </MonsterFieldset>
  );
}

function SpellPicker({
  catalog, chosen, onAdd,
}: { catalog: SpellCatalogEntry[]; chosen: Set<string>; onAdd: (e: SpellCatalogEntry) => void }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: SpellCatalogEntry[] = [];
    for (const e of catalog) {
      if (chosen.has(e.identifier.toLowerCase())) continue;
      if (e.name.toLowerCase().includes(q) || e.identifier.toLowerCase().includes(q)) out.push(e);
      if (out.length >= 40) break;
    }
    return out;
  }, [catalog, chosen, query]);

  return (
    <div className="relative">
      <Input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        placeholder="Search the spell catalog to add…"
        className="h-8 bg-background/50 border-gold/15 focus:border-gold text-sm"
      />
      {open && results.length > 0 ? (
        <div className="absolute z-20 mt-1 w-full max-h-60 overflow-auto rounded border border-gold/25 bg-parchment shadow-lg">
          {results.map((e) => (
            <button
              key={e.identifier}
              type="button"
              onMouseDown={(ev) => { ev.preventDefault(); onAdd(e); setQuery(''); }}
              className={cn('flex w-full items-center justify-between gap-2 px-2 py-1 text-left text-sm text-ink hover:bg-gold/10')}
            >
              <span className="truncate">{e.name}</span>
              <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-ink/40">{e.level === 0 ? 'Cantrip' : `Lv ${e.level}`}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ─── innate "N/Day" uses helpers (the shape the reader's formatUsesSuffix reads) ──
function usesPerDay(uses: any): number | null {
  const rec = uses?.recovery?.[0];
  if (rec && String(rec.period).toLowerCase() === 'day') {
    const n = Number(uses.max);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
function buildDayUses(raw: string): any {
  const n = Number(raw);
  if (!raw || !Number.isFinite(n) || n <= 0) return undefined;
  return { max: String(n), recovery: [{ period: 'day' }] };
}
