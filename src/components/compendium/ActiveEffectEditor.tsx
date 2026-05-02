import React, { useState } from 'react';
import { Trash2, Search, Plus, Zap } from 'lucide-react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogFooter } from '../ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Checkbox } from '../ui/checkbox';
import { ImageUpload } from '../ui/ImageUpload';

// Mirrors Foundry's EFFECT_MODES constant
const EFFECT_MODE_OPTIONS = [
  { value: 0, label: 'Custom',     defaultPriority: 0  },
  { value: 1, label: 'Multiply',   defaultPriority: 10 },
  { value: 2, label: 'Add',        defaultPriority: 20 },
  { value: 3, label: 'Downgrade',  defaultPriority: 30 },
  { value: 4, label: 'Upgrade',    defaultPriority: 40 },
  { value: 5, label: 'Override',   defaultPriority: 50 },
];

export interface EffectChange {
  key: string;
  mode: number;
  value: string;
  priority?: number | null;
}

export interface FoundryActiveEffect {
  _id?: string;
  name: string;
  img?: string | null;
  description?: string;
  disabled?: boolean;
  transfer?: boolean;
  tint?: string;
  duration?: {
    seconds?: number | null;
    rounds?: number | null;
    turns?: number | null;
    startTime?: number | null;
    startRound?: number | null;
    startTurn?: number | null;
  };
  changes?: EffectChange[];
  statuses?: string[];
  type?: string;
  sort?: number;
  flags?: Record<string, any>;
}

interface ActiveEffectEditorProps {
  effects: FoundryActiveEffect[];
  onChange: (effects: FoundryActiveEffect[]) => void;
}

function makeId() {
  return Math.random().toString(36).slice(2, 18);
}

function emptyEffect(): FoundryActiveEffect {
  return {
    _id: makeId(),
    name: 'New Effect',
    img: null,
    description: '',
    disabled: false,
    transfer: true,
    tint: '#ffffff',
    duration: { seconds: null, rounds: null, turns: null, startTime: null, startRound: null, startTurn: null },
    changes: [],
    statuses: [],
    type: 'base',
    sort: 0,
  };
}

function emptyChange(): EffectChange {
  return { key: '', mode: 2, value: '', priority: null };
}

function defaultPriorityForMode(mode: number): number {
  return EFFECT_MODE_OPTIONS.find(o => o.value === mode)?.defaultPriority ?? 20;
}

export default function ActiveEffectEditor({ effects, onChange }: ActiveEffectEditorProps) {
  const [draft, setDraft] = useState<FoundryActiveEffect | null>(null);
  const [draftIdx, setDraftIdx] = useState<number | null>(null);
  const [tab, setTab] = useState('details');

  const openNew = () => { setDraft(emptyEffect()); setDraftIdx(null); setTab('details'); };
  const openEdit = (idx: number) => {
    setDraft({ ...effects[idx], changes: (effects[idx].changes || []).map(c => ({ ...c })) });
    setDraftIdx(idx);
    setTab('details');
  };
  const closeDialog = () => { setDraft(null); setDraftIdx(null); };

  const handleDelete = (idx: number) => onChange(effects.filter((_, i) => i !== idx));

  const handleSave = () => {
    if (!draft) return;
    const next = [...effects];
    if (draftIdx !== null) next[draftIdx] = draft; else next.push(draft);
    onChange(next);
    closeDialog();
  };

  const patch = (p: Partial<FoundryActiveEffect>) => setDraft(d => d ? { ...d, ...p } : d);
  const addChange = () => patch({ changes: [...(draft?.changes || []), emptyChange()] });
  const patchChange = (i: number, p: Partial<EffectChange>) =>
    patch({ changes: (draft?.changes || []).map((c, ci) => ci === i ? { ...c, ...p } : c) });
  const deleteChange = (i: number) =>
    patch({ changes: (draft?.changes || []).filter((_, ci) => ci !== i) });
  const parseNullableInt = (v: string) => v === '' ? null : parseInt(v, 10);

  return (
    <div>
      {/* ── Effect list ─────────────────────────────────── */}
      <div className="border border-gold/10 rounded-md overflow-hidden">
        {/* List header */}
        <div className="flex items-center gap-3 px-3 py-1.5 bg-gold/5 border-b border-gold/10">
          <span className="text-[10px] font-black uppercase tracking-wider text-ink/60 flex-1">Passive Effects</span>
          <span className="text-[10px] font-black uppercase tracking-wider text-ink/40 pr-16">Source</span>
        </div>

        {effects.length === 0 ? (
          <p className="text-xs text-ink/30 italic px-3 py-3">No active effects.</p>
        ) : (
          <div className="divide-y divide-gold/5">
            {effects.map((fx, idx) => (
              <div key={fx._id || idx} className="flex items-center gap-3 px-3 py-2 group hover:bg-gold/5">
                {fx.img
                  ? <img src={fx.img} alt="" className="w-6 h-6 object-contain opacity-70 shrink-0" />
                  : <Zap className="w-5 h-5 text-gold/50 shrink-0" />
                }
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-ink truncate">{fx.name || 'Unnamed Effect'}</span>
                    {fx.disabled && <span className="text-[9px] text-ink/30 uppercase tracking-wider shrink-0">suspended</span>}
                  </div>
                </div>
                {/* Source column placeholder */}
                <span className="text-xs text-ink/30 shrink-0 w-28 truncate text-right hidden sm:block">
                  {fx.transfer !== false ? 'Actor' : 'Item only'}
                </span>
                {/* Actions */}
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <button type="button" onClick={() => openEdit(idx)} className="h-6 w-6 flex items-center justify-center text-ink/40 hover:text-gold transition-colors">
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  </button>
                  <button type="button" onClick={() => handleDelete(idx)} className="h-6 w-6 flex items-center justify-center text-ink/40 hover:text-blood transition-colors">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Add button — bottom right, Foundry style */}
        <div className="flex justify-end px-2 py-1.5 border-t border-gold/10 bg-gold/5">
          <button
            type="button" onClick={openNew}
            className="h-7 w-7 flex items-center justify-center rounded border border-gold/20 text-gold/60 hover:text-gold hover:bg-gold/10 hover:border-gold/40 transition-colors"
            title="Add Active Effect"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ── Edit dialog ──────────────────────────────────── */}
      <Dialog open={!!draft} onOpenChange={open => { if (!open) closeDialog(); }}>
        <DialogContent className="max-w-[95vw] lg:max-w-xl flex flex-col max-h-[90vh] p-0 gap-0 overflow-hidden">

          {/* Dialog header — name + icon, Foundry-style */}
          {draft && (
            <div className="flex items-center gap-3 px-4 pt-4 pb-3 border-b border-gold/10">
              <div className="w-12 h-12 shrink-0">
                <ImageUpload
                  compact
                  imageType="icon"
                  storagePath="icons/effects/"
                  currentImageUrl={draft.img || ''}
                  onUpload={url => patch({ img: url || null })}
                  className="w-full h-full rounded border border-gold/20"
                />
              </div>
              <input
                value={draft.name}
                onChange={e => patch({ name: e.target.value })}
                placeholder="Effect Name"
                className="flex-1 bg-transparent text-xl font-bold text-ink border-b border-transparent hover:border-gold/30 focus:border-gold outline-none pb-0.5 transition-colors placeholder:text-ink/30"
              />
            </div>
          )}

          {draft && (
            <Tabs value={tab} onValueChange={setTab} className="flex-1 flex flex-col overflow-hidden">
              <TabsList className="w-full grid grid-cols-3 rounded-none border-b border-gold/10 bg-background/30 h-10 px-0">
                <TabsTrigger value="details" className="rounded-none data-[state=active]:border-b-2 data-[state=active]:border-gold data-[state=active]:bg-transparent text-xs">Details</TabsTrigger>
                <TabsTrigger value="duration" className="rounded-none data-[state=active]:border-b-2 data-[state=active]:border-gold data-[state=active]:bg-transparent text-xs">Duration</TabsTrigger>
                <TabsTrigger value="changes" className="rounded-none data-[state=active]:border-b-2 data-[state=active]:border-gold data-[state=active]:bg-transparent text-xs">
                  Changes{(draft.changes || []).length > 0 ? ` (${draft.changes!.length})` : ''}
                </TabsTrigger>
              </TabsList>

              {/* ── Details ──────────────────────────────── */}
              <TabsContent value="details" className="flex-1 overflow-y-auto px-4 py-3 mt-0 space-y-0 divide-y divide-gold/10">

                {/* Icon Tint Color */}
                <div className="flex items-center gap-3 py-2.5">
                  <span className="text-sm font-semibold text-ink/80 w-44 shrink-0">Icon Tint Color</span>
                  <div className="flex items-center gap-2 flex-1">
                    <Input
                      value={draft.tint || '#ffffff'}
                      onChange={e => patch({ tint: e.target.value })}
                      placeholder="#ffffff"
                      className="h-7 text-xs font-mono flex-1 bg-background/50 border-gold/10 focus:border-gold"
                    />
                    <input
                      type="color"
                      value={draft.tint || '#ffffff'}
                      onChange={e => patch({ tint: e.target.value })}
                      className="h-7 w-8 rounded border border-gold/20 bg-transparent cursor-pointer p-0.5 shrink-0"
                    />
                  </div>
                </div>

                {/* Effect Description */}
                <div className="py-2.5 space-y-1.5">
                  <span className="text-sm font-semibold text-ink/80 block">Effect Description</span>
                  <textarea
                    value={draft.description || ''}
                    onChange={e => patch({ description: e.target.value })}
                    rows={4}
                    className="w-full p-2.5 text-sm bg-background/50 border border-gold/10 rounded focus:border-gold outline-none resize-none"
                    placeholder="Optional description shown in Foundry"
                  />
                </div>

                {/* Effect Suspended */}
                <div className="flex items-center gap-3 py-2.5">
                  <span className="text-sm font-semibold text-ink/80 flex-1">Effect Suspended</span>
                  <Checkbox
                    id="fx-disabled"
                    checked={draft.disabled ?? false}
                    onCheckedChange={v => patch({ disabled: !!v })}
                    className="border-gold/30 data-[state=checked]:bg-gold data-[state=checked]:text-white"
                  />
                </div>

                {/* Apply Effect to Actor */}
                <div className="py-2.5">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold text-ink/80 flex-1">Apply Effect to Actor</span>
                    <Checkbox
                      id="fx-transfer"
                      checked={draft.transfer ?? true}
                      onCheckedChange={v => patch({ transfer: !!v })}
                      className="border-gold/30 data-[state=checked]:bg-gold data-[state=checked]:text-white"
                    />
                  </div>
                  <p className="text-[11px] text-ink/40 mt-1">If checked, this Effect will be applied to any Actor that owns this Effect's parent Item.</p>
                </div>

              </TabsContent>

              {/* ── Duration ─────────────────────────────── */}
              <TabsContent value="duration" className="flex-1 overflow-y-auto px-4 py-3 mt-0 space-y-3">
                <p className="text-xs text-ink/40">Leave all fields blank for permanent (passive) effects — typical for class features.</p>

                {/* Group 1: Seconds + Start Time */}
                <div className="border border-gold/10 rounded-md divide-y divide-gold/10 bg-background/20">
                  <div className="flex items-center gap-3 px-3 py-2.5">
                    <span className="text-xs font-semibold text-ink/70 w-44 shrink-0">Effect Duration (Seconds)</span>
                    <Input
                      type="number" min={0}
                      value={draft.duration?.seconds ?? ''}
                      onChange={e => patch({ duration: { ...draft.duration, seconds: parseNullableInt(e.target.value) } })}
                      placeholder="—"
                      className="h-7 text-xs flex-1 bg-background/50 border-gold/10 focus:border-gold"
                    />
                  </div>
                  <div className="flex items-center gap-3 px-3 py-2.5">
                    <span className="text-xs font-semibold text-ink/70 w-44 shrink-0">Effect Start Time</span>
                    <Input
                      type="number"
                      value={draft.duration?.startTime ?? ''}
                      onChange={e => patch({ duration: { ...draft.duration, startTime: parseNullableInt(e.target.value) } })}
                      placeholder="—"
                      className="h-7 text-xs flex-1 bg-background/50 border-gold/10 focus:border-gold"
                    />
                  </div>
                </div>

                {/* Group 2: Combat duration */}
                <div className="border border-gold/10 rounded-md divide-y divide-gold/10 bg-background/20">
                  <div className="flex items-center gap-3 px-3 py-2.5">
                    <span className="text-xs font-semibold text-ink/70 w-44 shrink-0">Effect Duration (Combat)</span>
                    <div className="flex items-center gap-2 flex-1">
                      <span className="text-xs text-ink/50 shrink-0">Rounds</span>
                      <Input
                        type="number" min={0}
                        value={draft.duration?.rounds ?? ''}
                        onChange={e => patch({ duration: { ...draft.duration, rounds: parseNullableInt(e.target.value) } })}
                        placeholder="—"
                        className="h-7 text-xs w-20 bg-background/50 border-gold/10 focus:border-gold"
                      />
                      <span className="text-xs text-ink/50 shrink-0">Turns</span>
                      <Input
                        type="number" min={0}
                        value={draft.duration?.turns ?? ''}
                        onChange={e => patch({ duration: { ...draft.duration, turns: parseNullableInt(e.target.value) } })}
                        placeholder="—"
                        className="h-7 text-xs w-20 bg-background/50 border-gold/10 focus:border-gold"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-3 px-3 py-2.5">
                    <span className="text-xs font-semibold text-ink/70 w-44 shrink-0">Effect Start</span>
                    <div className="flex items-center gap-2 flex-1">
                      <span className="text-xs text-ink/50 shrink-0">Round</span>
                      <Input
                        type="number" min={0}
                        value={draft.duration?.startRound ?? ''}
                        onChange={e => patch({ duration: { ...draft.duration, startRound: parseNullableInt(e.target.value) } })}
                        placeholder="—"
                        className="h-7 text-xs w-20 bg-background/50 border-gold/10 focus:border-gold"
                      />
                      <span className="text-xs text-ink/50 shrink-0">Turn</span>
                      <Input
                        type="number" min={0}
                        value={draft.duration?.startTurn ?? ''}
                        onChange={e => patch({ duration: { ...draft.duration, startTurn: parseNullableInt(e.target.value) } })}
                        placeholder="—"
                        className="h-7 text-xs w-20 bg-background/50 border-gold/10 focus:border-gold"
                      />
                    </div>
                  </div>
                </div>
              </TabsContent>

              {/* ── Changes ──────────────────────────────── */}
              <TabsContent value="changes" className="flex-1 overflow-y-auto mt-0 flex flex-col">
                {/* Column headers */}
                <div className="flex items-center gap-2 px-3 py-2 border-b border-gold/10 bg-background/30">
                  <div className="w-6 shrink-0" /> {/* search icon col */}
                  <div className="flex-[2] min-w-0">
                    <span className="text-[10px] font-black uppercase tracking-wider text-ink/50">Attribute Key</span>
                    <a
                      href="https://github.com/foundryvtt/dnd5e/wiki/Active-Effect-Guide"
                      target="_blank" rel="noreferrer"
                      className="ml-1 text-[10px] text-gold/50 hover:text-gold transition-colors"
                      title="For a list of common keys, see the wiki"
                    >?</a>
                  </div>
                  <div className="w-28 shrink-0">
                    <span className="text-[10px] font-black uppercase tracking-wider text-ink/50">Change Mode</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-[10px] font-black uppercase tracking-wider text-ink/50">Value</span>
                  </div>
                  <div className="w-16 shrink-0">
                    <span className="text-[10px] font-black uppercase tracking-wider text-ink/50">Priority</span>
                  </div>
                  {/* Add button in header */}
                  <button
                    type="button" onClick={addChange}
                    className="h-5 w-5 flex items-center justify-center rounded border border-gold/30 text-gold/60 hover:text-gold hover:border-gold/60 transition-colors shrink-0"
                    title="Add change"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>

                {/* Change rows */}
                {(draft.changes || []).length === 0 ? (
                  <p className="text-xs text-ink/30 italic px-3 py-4 text-center">
                    No changes. Click <span className="font-mono text-gold/50">+</span> to add one.
                  </p>
                ) : (
                  <div className="divide-y divide-gold/5 flex-1 overflow-y-auto">
                    {(draft.changes || []).map((c, i) => (
                      <div key={i} className="flex items-center gap-2 px-3 py-2">
                        {/* Search icon (decorative, matches Foundry) */}
                        <div className="w-6 shrink-0 flex justify-center">
                          <Search className="w-3 h-3 text-ink/25" />
                        </div>
                        {/* Key */}
                        <Input
                          value={c.key}
                          onChange={e => patchChange(i, { key: e.target.value })}
                          placeholder="system.attributes.ac.calc"
                          className="flex-[2] min-w-0 h-7 text-xs font-mono bg-background/50 border-gold/10 focus:border-gold"
                        />
                        {/* Mode */}
                        <Select value={String(c.mode)} onValueChange={v => patchChange(i, { mode: parseInt(v, 10) })}>
                          <SelectTrigger className="w-28 h-7 text-xs shrink-0 bg-background/50 border-gold/10 focus:border-gold">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {EFFECT_MODE_OPTIONS.map(opt => (
                              <SelectItem key={opt.value} value={String(opt.value)}>{opt.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {/* Value */}
                        <Input
                          value={c.value}
                          onChange={e => patchChange(i, { value: e.target.value })}
                          placeholder="value or formula"
                          className="flex-1 min-w-0 h-7 text-xs font-mono bg-background/50 border-gold/10 focus:border-gold"
                        />
                        {/* Priority — greyed when null (auto) */}
                        <Input
                          type="number"
                          value={c.priority ?? ''}
                          onChange={e => patchChange(i, { priority: parseNullableInt(e.target.value) })}
                          placeholder={String(defaultPriorityForMode(c.mode))}
                          className={`w-16 shrink-0 h-7 text-xs text-center bg-background/50 border-gold/10 focus:border-gold ${c.priority === null ? 'text-ink/30' : ''}`}
                        />
                        {/* Delete */}
                        <button
                          type="button" onClick={() => deleteChange(i)}
                          className="h-6 w-6 flex items-center justify-center text-ink/30 hover:text-blood transition-colors shrink-0"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          )}

          <DialogFooter className="px-4 py-3 border-t border-gold/10 gap-2">
            <Button type="button" variant="outline" onClick={closeDialog} className="text-xs h-8">Cancel</Button>
            <Button type="button" onClick={handleSave} disabled={!draft?.name?.trim()} className="text-xs h-8">
              Save Effect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
