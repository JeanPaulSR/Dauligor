import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, BookOpen, Download, FileJson, Layers3, PawPrint, Sparkles, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { upsertDocument, upsertDocumentBatch } from '../../../lib/d1';
import { matchesSingleAxisFilter, matchesMultiAxisFilter } from '../../../lib/spellFilters';
import { useAxisFilters } from '../../../hooks/useAxisFilters';
import { cn } from '../../../lib/utils';
import {
  buildMonsterImportCandidates, type MonsterImportCandidate,
} from '../../../lib/monsterImportCandidates';
import { formatCr, CREATURE_TYPE_LABEL, SIZE_LABEL } from '../../../lib/monsterDisplay';
import { FilterBar } from '../FilterBar';
import { SectionFilterPanel, type FilterSection } from '../SectionFilterPanel';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { Card, CardContent } from '../../ui/card';
import SingleSelectSearch from '../../ui/SingleSelectSearch';

/**
 * Foundry-import workbench for monsters (the admin "Foundry Import" mode inside
 * MonstersEditor). Mirrors SpeciesBackgroundImportWorkbench / FeatImportWorkbench
 * — shared <FilterBar> + <SectionFilterPanel> (Source + Status axes), a master
 * list + detail pane, per-candidate source override + bulk-assign-unresolved +
 * remove/restore. The transform is `monsterImport.ts` (battle-tested on 1001
 * creatures) behind `buildMonsterImportCandidates`.
 *
 * Difference from the other importers: monsters are keyed by their Foundry
 * **actor id** (the table PK), so a re-import overwrites that row by id rather
 * than matching on a source+identifier natural key.
 */

type SourceRecord = { id: string; name?: string; abbreviation?: string; shortName?: string; slug?: string; [k: string]: any };
type UploadedBatch = { id: string; label: string; payload: any };

const NOOP_CYCLE_TAG = () => { /* no tag axes here */ };
const NOOP_SET_TAG_STATES: React.Dispatch<React.SetStateAction<Record<string, number>>> = () => { /* no tag axes */ };
const EMPTY_TAG_STATES: Record<string, number> = {};
const AXIS_KEYS = ['source', 'status'] as const;

const STATUS_VALUES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'resolved', label: 'Resolved source' },
  { value: 'unresolved', label: 'Unresolved source' },
  { value: 'spellMissing', label: 'Missing spell link' },
  { value: 'existing', label: 'Already imported' },
];

function statusFlagsOf(c: MonsterImportCandidate, effSource: string): Set<string> {
  const flags = new Set<string>();
  flags.add(effSource ? 'resolved' : 'unresolved');
  if (c.spellMissing > 0) flags.add('spellMissing');
  if (c.existing) flags.add('existing');
  return flags;
}

export default function MonsterImportWorkbench({
  userProfile,
  sources,
  spellCatalog,
  existingMonsters,
  onImported,
}: {
  userProfile: any;
  sources: SourceRecord[];
  spellCatalog: Array<{ identifier: string }>;
  existingMonsters: Array<{ id: string; identifier?: string }>;
  onImported?: () => void;
}) {
  const canManage = userProfile?.role === 'admin' || userProfile?.role === 'co-dm';

  const [uploadedBatches, setUploadedBatches] = useState<UploadedBatch[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [sourceOverrides, setSourceOverrides] = useState<Record<string, string>>({});
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => new Set());
  const [search, setSearch] = useState('');
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const { axisFilters, cyclers, activeFilterCount, resetAll: resetAxisFilters } = useAxisFilters(AXIS_KEYS);

  const spellIdents = useMemo(() => spellCatalog.map((s) => s.identifier), [spellCatalog]);
  const sourceById = useMemo(
    () => Object.fromEntries(sources.map((s) => [s.id, s])) as Record<string, SourceRecord>,
    [sources],
  );
  const sourceLabelOf = (id: string) => {
    const s = id ? sourceById[id] : undefined;
    return s ? String(s.abbreviation || s.shortName || s.name || s.id) : '';
  };

  const candidates = useMemo(
    () => uploadedBatches.flatMap((batch) =>
      buildMonsterImportCandidates(batch.payload, sources, spellIdents, existingMonsters)),
    [uploadedBatches, sources, spellIdents, existingMonsters],
  );

  const effectiveSourceId = (c: MonsterImportCandidate) =>
    sourceOverrides[c.candidateId] ?? c.matchedSourceId ?? '';

  const batchSummary = useMemo(() => ({
    total: candidates.length,
    unresolved: candidates.filter((c) => !effectiveSourceId(c)).length,
    spellMissing: candidates.filter((c) => c.spellMissing > 0).length,
    existing: candidates.filter((c) => c.existing).length,
  }), [candidates, sourceOverrides]);

  const visibleCandidates = useMemo(() => {
    const lowered = search.trim().toLowerCase();
    return candidates.filter((c) => {
      if (dismissedIds.has(c.candidateId)) return false;
      if (!matchesSingleAxisFilter(c.matchedSourceId || '', axisFilters.source)) return false;
      if (!matchesMultiAxisFilter(statusFlagsOf(c, effectiveSourceId(c)), axisFilters.status)) return false;
      if (lowered) {
        const hit = c.name.toLowerCase().includes(lowered)
          || c.creatureType.toLowerCase().includes(lowered)
          || c.sourceBook.toLowerCase().includes(lowered);
        if (!hit) return false;
      }
      return true;
    });
  }, [candidates, search, axisFilters, dismissedIds, sourceOverrides]);

  const filterAxes = useMemo<FilterSection[]>(() => {
    const srcMap = new Map<string, string>();
    for (const c of candidates) {
      if (c.matchedSourceId) srcMap.set(c.matchedSourceId, sourceLabelOf(c.matchedSourceId) || c.matchedSourceId);
    }
    const axes: FilterSection[] = [];
    if (srcMap.size) {
      axes.push({
        key: 'source', name: 'Source', kind: 'axis',
        values: Array.from(srcMap.entries()).sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label })),
      });
    }
    axes.push({ key: 'status', name: 'Status', kind: 'axis', values: STATUS_VALUES.map((v) => ({ ...v })) });
    return axes;
  }, [candidates, sourceById]);

  useEffect(() => {
    if (!visibleCandidates.length) { setSelectedId(''); return; }
    if (!selectedId || !visibleCandidates.some((c) => c.candidateId === selectedId)) {
      setSelectedId(visibleCandidates[0].candidateId);
    }
  }, [visibleCandidates, selectedId]);

  const selectedCandidate = visibleCandidates.find((c) => c.candidateId === selectedId)
    || candidates.find((c) => c.candidateId === selectedId)
    || null;

  // ─── loading exports ──────────────────────────────────────────────
  const addBatch = (label: string, payload: any) => {
    const cands = buildMonsterImportCandidates(payload, sources, spellIdents, existingMonsters);
    if (!cands.length) { toast.error(`${label}: no creature entries found.`); return false; }
    setUploadedBatches((cur) => {
      const merged = [...cur];
      const i = merged.findIndex((e) => e.label === label);
      const entry = { id: `${label}-${cands.length}`, label, payload };
      if (i >= 0) merged[i] = entry; else merged.push(entry);
      return merged;
    });
    toast.success(`Loaded ${cands.length} creature${cands.length === 1 ? '' : 's'} from ${label}.`);
    return true;
  };

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList?.length) return;
    for (const file of Array.from(fileList)) {
      try {
        addBatch(file.name, JSON.parse(await file.text()));
      } catch (err: any) {
        toast.error(`${file.name}: ${err?.message || 'Could not parse file.'}`);
      }
    }
  };

  const handlePaste = () => {
    const text = pasteText.trim();
    if (!text) return;
    try {
      if (addBatch('pasted JSON', JSON.parse(text))) { setPasteText(''); setPasteOpen(false); }
    } catch (err: any) {
      toast.error(`Paste: ${err?.message || 'Invalid JSON.'}`);
    }
  };

  // ─── saving ────────────────────────────────────────────────────────
  const payloadFor = (c: MonsterImportCandidate) => {
    const { id: _omit, ...rest } = c.row;
    return { ...rest, sourceId: effectiveSourceId(c) || null };
  };

  const assignSourceToUnresolvedVisible = (sourceId: string) => {
    if (!sourceId) return;
    const targets = visibleCandidates.filter((c) => !effectiveSourceId(c));
    if (!targets.length) { toast.error('No unresolved creatures in view.'); return; }
    setSourceOverrides((prev) => {
      const next = { ...prev };
      for (const c of targets) next[c.candidateId] = sourceId;
      return next;
    });
    toast.success(`Assigned ${sourceLabelOf(sourceId)} to ${targets.length} unresolved creature${targets.length === 1 ? '' : 's'}.`);
  };

  const handleImportSelected = async () => {
    if (!selectedCandidate) return;
    setSaving(true);
    try {
      await upsertDocument('monsters', selectedCandidate.row.id, payloadFor(selectedCandidate));
      toast.success(`${selectedCandidate.name} ${selectedCandidate.existing ? 'updated' : 'imported'}.`);
      onImported?.();
    } catch (err) {
      console.error('[MonsterImport] import failed:', err);
      toast.error(`Failed to import ${selectedCandidate.name}.`);
    } finally {
      setSaving(false);
    }
  };

  const handleImportVisible = async () => {
    if (!visibleCandidates.length) { toast.error('No visible creatures to import.'); return; }
    setSaving(true);
    try {
      // Dedup by Foundry id (the monsters PK) — two batches with the same
      // creature shouldn't write twice. Last one wins.
      const byId = new Map<string, { id: string | null; data: Record<string, any> }>();
      let collapsed = 0;
      for (const c of visibleCandidates) {
        const id = String(c.row.id);
        if (byId.has(id)) collapsed++;
        byId.set(id, { id, data: payloadFor(c) });
      }
      const entries = Array.from(byId.values());
      await upsertDocumentBatch('monsters', entries);
      const created = visibleCandidates.filter((c) => !c.existing).length;
      const dupNote = collapsed > 0 ? `, ${collapsed} duplicate${collapsed === 1 ? '' : 's'} merged` : '';
      toast.success(`Imported ${entries.length} creature${entries.length === 1 ? '' : 's'} (${created} new, ${entries.length - created} updated${dupNote}).`);
      onImported?.();
    } catch (err) {
      console.error('[MonsterImport] batch import failed:', err);
      toast.error('Failed to import visible creatures.');
    } finally {
      setSaving(false);
    }
  };

  if (!canManage) {
    return <div className="px-6 py-12 text-center text-ink/50">Foundry monster import is admin / co-DM only.</div>;
  }

  return (
    <div className="h-full flex flex-col">
      <Card className="border-gold/20 bg-card/50 overflow-hidden h-full flex flex-col">
        <CardContent className="p-0 flex-1 flex flex-col min-h-0">
          {/* Header */}
          <div className="border-b border-gold/10 bg-card px-5 py-3 shrink-0">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-bold uppercase tracking-[0.22em] text-ink">Monsters — Foundry Import</h2>
              <div className="flex flex-wrap items-center gap-2">
                <input ref={fileInputRef} type="file" accept=".json,application/json" multiple className="hidden"
                  onChange={(e) => { void handleFiles(e.target.files); e.currentTarget.value = ''; }} />
                <Button type="button" variant="outline" size="sm" className="gap-2 h-8 border-gold/20 bg-background/40 text-ink hover:bg-gold/5" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="h-3.5 w-3.5" /> Load Export
                </Button>
                <Button type="button" variant="outline" size="sm" className="gap-2 h-8 border-gold/20 bg-background/40 text-ink hover:bg-gold/5" onClick={() => setPasteOpen((v) => !v)}>
                  <FileJson className="h-3.5 w-3.5" /> Paste JSON
                </Button>
                <Button type="button" size="sm" className="gap-2 h-8 btn-gold-solid" onClick={handleImportVisible} disabled={saving || !visibleCandidates.length}>
                  <Download className="h-3.5 w-3.5" /> Import Visible ({visibleCandidates.length})
                </Button>
                {batchSummary.unresolved > 0 ? (
                  <div className="w-[210px]" title="Assign a source to all unresolved creatures currently in view">
                    <SingleSelectSearch
                      value=""
                      onChange={(next) => { if (next) assignSourceToUnresolvedVisible(next); }}
                      options={sources.map((s) => ({ id: s.id, name: sourceLabelOf(s.id) || s.id }))}
                      placeholder="Set source for unresolved…"
                      allowClear={false}
                      triggerClassName="h-8 w-full"
                    />
                  </div>
                ) : null}
                {dismissedIds.size > 0 ? (
                  <Button type="button" variant="outline" size="sm" className="gap-2 h-8 border-gold/20 bg-background/40 text-ink/70 hover:bg-gold/5"
                    onClick={() => setDismissedIds(new Set())} title="Restore the creatures you removed from this import">
                    Restore {dismissedIds.size} removed
                  </Button>
                ) : null}
              </div>
            </div>
            {pasteOpen ? (
              <div className="mt-3 flex flex-col gap-2">
                <textarea
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder='Paste a creature export — { "creatures": [ … ] }, a bare array, or a single creature entry.'
                  className="h-28 w-full rounded border border-gold/15 bg-background/50 px-2 py-1.5 font-mono text-xs text-ink focus:border-gold"
                />
                <div className="flex gap-2">
                  <Button type="button" size="sm" className="h-8 btn-gold-solid" onClick={handlePaste} disabled={!pasteText.trim()}>Parse</Button>
                  <Button type="button" size="sm" variant="outline" className="h-8 border-gold/20 text-ink/70" onClick={() => { setPasteText(''); setPasteOpen(false); }}>Cancel</Button>
                </div>
              </div>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink/70">
              <InlineStat icon={Layers3} label="loaded" value={batchSummary.total} />
              <InlineStat icon={AlertTriangle} label="unresolved" value={batchSummary.unresolved} tone="warn" />
              <InlineStat icon={Sparkles} label="missing spell link" value={batchSummary.spellMissing} tone="warn" />
              <InlineStat icon={BookOpen} label="already imported" value={batchSummary.existing} />
            </div>
          </div>

          {/* Body */}
          <div className="p-5 flex-1 min-h-0 flex flex-col gap-3">
            {!candidates.length ? (
              <div className="rounded-xl border border-dashed border-gold/20 bg-background/30 px-6 py-12 text-center">
                <FileJson className="mx-auto mb-4 h-10 w-10 text-gold/60" />
                <p className="text-lg font-serif italic text-ink/70">No Foundry creature export loaded yet.</p>
                <p className="mx-auto mt-2 max-w-2xl text-sm text-ink/50">
                  Load a <code className="font-mono text-gold/80">dauligor.foundry-creature-folder-export.v1</code> JSON
                  (or paste one creature) to review and import. The whole-library export is large — import a small export
                  or paste a single creature for incremental edits.
                </p>
              </div>
            ) : (
              <>
                <div className="shrink-0">
                  <FilterBar
                    search={search}
                    setSearch={setSearch}
                    isFilterOpen={isFilterOpen}
                    setIsFilterOpen={setIsFilterOpen}
                    activeFilterCount={activeFilterCount}
                    resetFilters={() => { setSearch(''); resetAxisFilters(); }}
                    searchPlaceholder="Search creature name, type, or source"
                    filterTitle="Filter Creatures"
                    resetLabel="Reset Filters"
                    trailingActions={
                      <div className="text-[11px] font-mono tabular-nums text-ink/55 whitespace-nowrap px-1" title={`${visibleCandidates.length} of ${candidates.length} shown`}>
                        {visibleCandidates.length} / {candidates.length}
                      </div>
                    }
                    renderFilters={
                      <SectionFilterPanel
                        axes={filterAxes}
                        axisFilters={axisFilters}
                        tagStates={EMPTY_TAG_STATES}
                        setTagStates={NOOP_SET_TAG_STATES}
                        cycleAxisState={cyclers.cycleAxisState}
                        cycleAxisStateReverse={cyclers.cycleAxisStateReverse}
                        cycleTagState={NOOP_CYCLE_TAG}
                        cycleTagStateReverse={NOOP_CYCLE_TAG}
                        cycleAxisCombineMode={cyclers.cycleAxisCombineMode}
                        cycleAxisCombineModeReverse={cyclers.cycleAxisCombineModeReverse}
                        cycleAxisExclusionMode={cyclers.cycleAxisExclusionMode}
                        cycleAxisExclusionModeReverse={cyclers.cycleAxisExclusionModeReverse}
                        axisIncludeAll={cyclers.axisIncludeAll}
                        axisExcludeAll={cyclers.axisExcludeAll}
                        axisClear={cyclers.axisClear}
                        search=""
                        setSearch={() => { /* search on FilterBar */ }}
                        activeFilterCount={activeFilterCount}
                        resetAll={() => { setSearch(''); resetAxisFilters(); }}
                        embedded
                      />
                    }
                  />
                </div>

                <div className="flex gap-4 flex-1 min-h-0">
                  {/* Master list */}
                  <div className="w-[320px] shrink-0 rounded-xl border border-gold/10 bg-background/20 overflow-y-auto custom-scrollbar">
                    <div className="space-y-1.5 p-2.5">
                      {visibleCandidates.map((c) => {
                        const selected = c.candidateId === selectedId;
                        const eff = effectiveSourceId(c);
                        return (
                          <button type="button" key={c.candidateId} onClick={() => setSelectedId(c.candidateId)}
                            className={cn('w-full rounded-lg border p-2.5 text-left transition-colors flex items-center gap-2.5',
                              selected ? 'border-gold/50 bg-gold/10' : 'border-gold/10 bg-background/30 hover:border-gold/30 hover:bg-background/50')}>
                            <CandidateThumb src={c.imageUrl} />
                            <div className="min-w-0 flex-1">
                              <div className="font-serif text-sm text-ink truncate">{c.name}</div>
                              <div className="text-[10px] uppercase tracking-[0.16em] text-gold/70 truncate">
                                CR {formatCr(c.cr)} · {CREATURE_TYPE_LABEL[c.creatureType] || c.creatureType || '—'}
                              </div>
                              <div className="mt-1 flex flex-wrap gap-1">
                                {c.existing ? <Badge className="bg-sky-500/15 text-sky-200 border-sky-400/20 text-[9px] px-1 py-0">Imported</Badge> : null}
                                {!eff ? <Badge className="bg-blood/20 text-blood border-blood/30 text-[9px] px-1 py-0">No source</Badge> : null}
                                {c.spellMissing > 0 ? <Badge className="bg-amber-500/15 text-amber-200 border-amber-400/20 text-[9px] px-1 py-0">{c.spellMissing} spell?</Badge> : null}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Detail */}
                  <div className="flex-1 min-w-0 min-h-0 overflow-y-auto custom-scrollbar pr-1">
                    {selectedCandidate ? (
                      <Card className="border-gold/10 bg-background/25 overflow-hidden">
                        <CardContent className="p-0">
                          <div className="border-b border-gold/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),transparent)] px-6 py-5">
                            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                              <div className="space-y-1 min-w-0">
                                <div className="flex items-center gap-3 flex-wrap">
                                  <h3 className="font-serif text-3xl font-bold text-ink break-words">{selectedCandidate.name}</h3>
                                  {effectiveSourceId(selectedCandidate) ? (
                                    <Badge className="border-gold/20 bg-gold/10 text-gold">{sourceLabelOf(effectiveSourceId(selectedCandidate))}</Badge>
                                  ) : (
                                    <Badge className="border-blood/30 bg-blood/15 text-blood">{selectedCandidate.sourceBook || 'No source'}</Badge>
                                  )}
                                </div>
                                <p className="font-serif italic text-ink/70">
                                  CR {formatCr(selectedCandidate.cr)} · {SIZE_LABEL[selectedCandidate.size] || selectedCandidate.size} {CREATURE_TYPE_LABEL[selectedCandidate.creatureType] || selectedCandidate.creatureType}
                                </p>
                              </div>
                              <div className="flex gap-2 shrink-0">
                                <Button type="button" className="gap-2 btn-gold-solid" onClick={handleImportSelected} disabled={saving}>
                                  <Download className="h-4 w-4" /> {selectedCandidate.existing ? 'Update' : 'Import'}
                                </Button>
                                <Button type="button" variant="outline" className="gap-2 border-blood/30 text-blood hover:bg-blood/10"
                                  onClick={() => setDismissedIds((prev) => { const n = new Set(prev); n.add(selectedCandidate.candidateId); return n; })}
                                  disabled={saving} title="Exclude this creature from the import (restorable)">
                                  <X className="h-4 w-4" /> Remove
                                </Button>
                              </div>
                            </div>
                          </div>

                          <div className="border-b border-gold/10 px-6 py-5">
                            <div className="grid gap-6 lg:grid-cols-[126px_minmax(0,1fr)]">
                              <DetailImage src={selectedCandidate.imageUrl} alt={selectedCandidate.name} />
                              <div className="space-y-3">
                                <div className="grid gap-y-3 text-sm md:grid-cols-2 md:gap-x-8">
                                  <FactRow label="AC" value={selectedCandidate.row.ac != null ? String(selectedCandidate.row.ac) : '—'} />
                                  <FactRow label="HP" value={selectedCandidate.row.hp != null ? String(selectedCandidate.row.hp) : '—'} />
                                  <FactRow label="Identifier" value={selectedCandidate.row.identifier} />
                                  <FactRow label="Prof. bonus" value={selectedCandidate.row.proficiencyBonus != null ? `+${selectedCandidate.row.proficiencyBonus}` : '—'} />
                                </div>
                                <div>
                                  <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-gold/70">Parsed sections</div>
                                  <div className="mt-1 flex flex-wrap gap-1.5">
                                    {SECTION_LABELS.map(([key, label]) => {
                                      const n = selectedCandidate.sectionCounts[key] || 0;
                                      if (!n) return null;
                                      return <Badge key={key} className="border-gold/15 bg-background/40 text-ink/80 text-[10px]">{label}: {n}</Badge>;
                                    })}
                                    {SECTION_LABELS.every(([key]) => !(selectedCandidate.sectionCounts[key])) ? <span className="text-xs text-ink/40">none</span> : null}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-gold/70">Source</div>
                                  <SingleSelectSearch
                                    value={effectiveSourceId(selectedCandidate)}
                                    onChange={(next) => setSourceOverrides((prev) => ({ ...prev, [selectedCandidate.candidateId]: next }))}
                                    options={sources.map((s) => ({ id: s.id, name: (s.abbreviation ? `${s.abbreviation} — ` : '') + (s.name || s.id) }))}
                                    placeholder="— none (import without a source) —"
                                    className="mt-1 w-full max-w-sm"
                                    triggerClassName="h-8 w-full"
                                  />
                                  {!selectedCandidate.sourceResolved && !effectiveSourceId(selectedCandidate) ? (
                                    <p className="mt-1 text-[10px] text-blood">
                                      Book "{selectedCandidate.sourceBook || '?'}" didn't match a source — pick one, or it imports without a source.
                                    </p>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          </div>

                          {selectedCandidate.warnings.length ? (
                            <div className="px-6 py-5">
                              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
                                <div className="mb-2 flex items-center gap-2 font-bold uppercase tracking-widest text-xs">
                                  <AlertTriangle className="h-4 w-4" /> Notes
                                </div>
                                <ul className="space-y-1 list-disc pl-5 text-[12px]">
                                  {selectedCandidate.warnings.map((w) => <li key={w}>{w}</li>)}
                                </ul>
                              </div>
                            </div>
                          ) : null}
                        </CardContent>
                      </Card>
                    ) : (
                      <Card className="border-gold/10 bg-background/25">
                        <CardContent className="px-6 py-12 text-center text-ink/50">Select a creature to inspect and import it.</CardContent>
                      </Card>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

const SECTION_LABELS: ReadonlyArray<[string, string]> = [
  ['traits', 'Traits'], ['actions', 'Actions'], ['bonusActions', 'Bonus'], ['reactions', 'Reactions'],
  ['legendaryActions', 'Legendary'], ['lairActions', 'Lair'], ['regionalEffects', 'Regional'], ['spellcasting', 'Spellcasting'],
];

function CandidateThumb({ src }: { src: string }) {
  if (!src) {
    return (
      <div className="h-9 w-9 shrink-0 rounded border border-gold/15 bg-background/40 flex items-center justify-center">
        <PawPrint className="h-4 w-4 text-ink/35" />
      </div>
    );
  }
  return <img src={src} alt="" loading="lazy" className="h-9 w-9 shrink-0 rounded border border-gold/20 object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />;
}

function DetailImage({ src, alt }: { src: string; alt: string }) {
  if (!src) {
    return (
      <div className="h-[126px] w-[126px] shrink-0 rounded-lg border border-gold/15 bg-background/40 flex flex-col items-center justify-center gap-1">
        <PawPrint className="h-7 w-7 text-ink/30" />
        <span className="text-[9px] uppercase tracking-widest text-ink/30">no image</span>
      </div>
    );
  }
  return <img src={src} alt={alt} className="h-[126px] w-[126px] shrink-0 rounded-lg border border-gold/20 object-cover" />;
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-gold/70">{label}</div>
      <div className="mt-1 text-sm text-ink/90">{value || '—'}</div>
    </div>
  );
}

function InlineStat({ icon: Icon, label, value, tone }: { icon: any; label: string; value: number; tone?: 'warn' }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Icon className="h-3 w-3 text-gold/60 shrink-0" />
      <span className={cn('font-bold tabular-nums', tone === 'warn' && value > 0 ? 'text-blood' : 'text-ink')}>{value}</span>
      <span className="text-ink/50 uppercase tracking-widest text-[10px]">{label}</span>
    </span>
  );
}
