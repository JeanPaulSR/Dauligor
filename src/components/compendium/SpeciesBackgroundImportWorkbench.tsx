import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, BookOpen, Download, FileJson, ImageOff, Layers3, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { reportClientError, OperationType } from '../../lib/firebase';
import { fetchCollection, upsertDocument, upsertDocumentBatch } from '../../lib/d1';
import { buildNameToId, type ProficiencyLookups } from '../../lib/backgroundProficiencies';
import { matchesSingleAxisFilter, matchesMultiAxisFilter } from '../../lib/spellFilters';
import { useAxisFilters } from '../../hooks/useAxisFilters';
import { cn } from '../../lib/utils';
import {
  buildSpeciesBackgroundCandidates,
  IMPORT_KIND_META,
  type SpeciesBackgroundImportKind,
  type SpeciesBackgroundImportCandidate,
} from '../../lib/speciesBackgroundImport';
import { FilterBar } from './FilterBar';
import { SectionFilterPanel, type FilterSection } from './SectionFilterPanel';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';

/**
 * Foundry-import workbench for Species + Backgrounds (mode inside
 * SpeciesBackgroundEditor). Mirrors SpellImportWorkbench / FeatImportWorkbench
 * — the working references — including the shared <FilterBar> +
 * <SectionFilterPanel> for search + filtering (Source + Status axes) and a
 * feat-style detail panel.
 *
 * The detail pane shows the resolved image prominently + its URL so the
 * importer can confirm at a glance that `imageUrl` was captured. The Status
 * axis lets you isolate Resolved / Unresolved / Missing-image / Already-imported
 * candidates and then Import Visible.
 */

type SourceRecord = { id: string; name?: string; abbreviation?: string; shortName?: string; slug?: string; rules?: string; [key: string]: any };
type UploadedBatch = { id: string; fileName: string; payload: any };

// SectionFilterPanel needs tag-axis handlers even with no tag-kind axes.
// Stable module-level no-ops so memoised axes don't re-key.
const NOOP_CYCLE_TAG = () => { /* no tag axes here */ };
const NOOP_SET_TAG_STATES: React.Dispatch<React.SetStateAction<Record<string, number>>> = () => { /* no tag axes here */ };
const EMPTY_TAG_STATES: Record<string, number> = {};
const AXIS_KEYS = ['source', 'status'] as const;

// Match-status flags — surfaced via the Status axis (multi-flag membership).
const STATUS_VALUES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'resolved', label: 'Resolved source' },
  { value: 'unresolved', label: 'Unresolved source' },
  { value: 'missingImage', label: 'Missing image' },
  { value: 'existing', label: 'Already imported' },
];

function statusFlagsOf(c: SpeciesBackgroundImportCandidate): Set<string> {
  const flags = new Set<string>();
  flags.add(c.sourceResolved ? 'resolved' : 'unresolved');
  if (!c.imageUrl) flags.add('missingImage');
  if (c.existingEntryId) flags.add('existing');
  return flags;
}

export default function SpeciesBackgroundImportWorkbench({
  userProfile,
  kind,
  onImported,
}: {
  userProfile: any;
  kind: SpeciesBackgroundImportKind;
  onImported?: () => void;
}) {
  const meta = IMPORT_KIND_META[kind];
  const isAdmin = userProfile?.role === 'admin';

  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [existingEntries, setExistingEntries] = useState<any[]>([]);
  // Skill/tool/language name→id lookups for resolving the prose proficiency
  // block into the structured field at import (backgrounds only).
  const [profLookups, setProfLookups] = useState<ProficiencyLookups | undefined>(undefined);
  const [uploadedBatches, setUploadedBatches] = useState<UploadedBatch[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState('');
  // Per-candidate manual source assignment (candidateId -> sourceId; '' = none).
  // Lets the importer set a source for entries whose book didn't auto-match.
  const [sourceOverrides, setSourceOverrides] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const { axisFilters, cyclers, activeFilterCount, resetAll: resetAxisFilters } = useAxisFilters(AXIS_KEYS);

  const loadExisting = async () => {
    const rows = await fetchCollection<any>(meta.collection, { orderBy: 'name ASC' });
    setExistingEntries(rows);
  };

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    (async () => {
      try {
        const [sourceRows, existingRows] = await Promise.all([
          fetchCollection<any>('sources', { orderBy: 'name ASC' }),
          fetchCollection<any>(meta.collection, { orderBy: 'name ASC' }),
        ]);
        if (cancelled) return;
        setSources(sourceRows);
        setExistingEntries(existingRows);
        if (kind === 'background') {
          const [sk, tl, lg] = await Promise.all([
            fetchCollection<any>('skills', { orderBy: 'name ASC' }),
            fetchCollection<any>('tools', { orderBy: 'name ASC' }),
            fetchCollection<any>('languages', { orderBy: 'name ASC' }),
          ]);
          if (!cancelled) {
            setProfLookups({
              skills: buildNameToId(sk),
              tools: buildNameToId(tl),
              languages: buildNameToId(lg),
            });
          }
        }
      } catch (err) {
        console.error(`[${meta.singular}Import] load failed:`, err);
      }
    })();
    return () => { cancelled = true; };
  }, [isAdmin, meta.collection, meta.singular, kind]);

  const sourceById = useMemo(
    () => Object.fromEntries(sources.map((s) => [s.id, s])) as Record<string, SourceRecord>,
    [sources],
  );
  // Effective source = the manual override (if the user set one) else the
  // auto-matched source. '' means "no source" — imports as NULL (FK-safe).
  const effectiveSourceId = (c: SpeciesBackgroundImportCandidate) =>
    sourceOverrides[c.candidateId] ?? c.matchedSourceId ?? '';
  const sourceLabelOf = (id: string) => {
    const s = id ? sourceById[id] : undefined;
    return s ? String(s.abbreviation || s.shortName || s.name || s.id) : '';
  };

  const candidates = useMemo(
    () => uploadedBatches.flatMap((batch) =>
      buildSpeciesBackgroundCandidates(kind, batch.payload, batch.fileName, sources, existingEntries, profLookups)),
    [uploadedBatches, sources, existingEntries, kind, profLookups],
  );

  const batchSummary = useMemo(() => ({
    total: candidates.length,
    unresolved: candidates.filter((c) => !c.sourceResolved).length,
    existing: candidates.filter((c) => c.existingEntryId).length,
    missingImage: candidates.filter((c) => !c.imageUrl).length,
  }), [candidates]);

  const visibleCandidates = useMemo(() => {
    const lowered = search.trim().toLowerCase();
    return candidates.filter((c) => {
      if (!matchesSingleAxisFilter(c.matchedSourceId || '', axisFilters.source)) return false;
      if (!matchesMultiAxisFilter(statusFlagsOf(c), axisFilters.status)) return false;
      if (lowered) {
        const hit = c.name.toLowerCase().includes(lowered)
          || c.identifier.toLowerCase().includes(lowered)
          || c.sourceBook.toLowerCase().includes(lowered)
          || c.matchedSourceLabel.toLowerCase().includes(lowered);
        if (!hit) return false;
      }
      return true;
    });
  }, [candidates, search, axisFilters]);

  // Filter axes — Source (only the matched sources present in the load) +
  // Status (resolved / unresolved / missing image / already imported).
  const filterAxes = useMemo<FilterSection[]>(() => {
    const srcMap = new Map<string, string>();
    for (const c of candidates) {
      if (c.matchedSourceId) srcMap.set(c.matchedSourceId, c.matchedSourceLabel || c.matchedSourceId);
    }
    const axes: FilterSection[] = [];
    if (srcMap.size) {
      axes.push({
        key: 'source', name: 'Source', kind: 'axis',
        values: Array.from(srcMap.entries())
          .sort((a, b) => a[1].localeCompare(b[1]))
          .map(([value, label]) => ({ value, label })),
      });
    }
    axes.push({ key: 'status', name: 'Status', kind: 'axis', values: STATUS_VALUES.map((v) => ({ ...v })) });
    return axes;
  }, [candidates]);

  useEffect(() => {
    if (!visibleCandidates.length) { setSelectedCandidateId(''); return; }
    if (!selectedCandidateId || !visibleCandidates.some((c) => c.candidateId === selectedCandidateId)) {
      setSelectedCandidateId(visibleCandidates[0].candidateId);
    }
  }, [visibleCandidates, selectedCandidateId]);

  const selectedCandidate = visibleCandidates.find((c) => c.candidateId === selectedCandidateId)
    || candidates.find((c) => c.candidateId === selectedCandidateId)
    || null;

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList?.length) return;
    const nextBatches: UploadedBatch[] = [];
    for (const file of Array.from(fileList)) {
      try {
        const payload = JSON.parse(await file.text());
        if (payload?.kind !== meta.expectedKind || !Array.isArray(payload?.[meta.arrayKey])) {
          throw new Error(`Expected a ${meta.expectedKind} payload.`);
        }
        nextBatches.push({ id: `${file.name}-${payload.exportedAt || ''}`, fileName: file.name, payload });
      } catch (err: any) {
        toast.error(`${file.name}: ${err?.message || 'Could not parse file.'}`);
      }
    }
    if (!nextBatches.length) return;
    setUploadedBatches((current) => {
      const merged = [...current];
      for (const batch of nextBatches) {
        const i = merged.findIndex((e) => e.fileName === batch.fileName);
        if (i >= 0) merged[i] = batch; else merged.push(batch);
      }
      return merged;
    });
    toast.success(`Loaded ${nextBatches.length} Foundry ${meta.plural} export ${nextBatches.length === 1 ? 'file' : 'files'}.`);
  };

  const payloadFor = (c: SpeciesBackgroundImportCandidate) => {
    const existing = existingEntries.find((e) => e.id === c.existingEntryId);
    const data: Record<string, any> = {
      ...c.savePayload,
      // Apply any manual source assignment; '' (none) -> null so the FK holds.
      sourceId: effectiveSourceId(c) || null,
      updatedAt: new Date().toISOString(),
      createdAt: existing?.createdAt || new Date().toISOString(),
    };
    Object.keys(data).forEach((k) => { if (data[k] === undefined) delete data[k]; });
    return data;
  };

  // Bulk-assign a source to every VISIBLE entry whose book didn't auto-match —
  // handy when a whole unmatched book needs the same source in one go.
  const assignSourceToUnresolvedVisible = (sourceId: string) => {
    if (!sourceId) return;
    const targets = visibleCandidates.filter((c) => !c.sourceResolved);
    if (!targets.length) { toast.error('No unresolved entries in view.'); return; }
    setSourceOverrides((prev) => {
      const next = { ...prev };
      for (const c of targets) next[c.candidateId] = sourceId;
      return next;
    });
    toast.success(`Assigned ${sourceLabelOf(sourceId)} to ${targets.length} unresolved ${meta.plural.toLowerCase()}.`);
  };

  const handleImportSelected = async () => {
    if (!selectedCandidate) return;
    setSaving(true);
    try {
      await upsertDocument(meta.collection, selectedCandidate.existingEntryId || crypto.randomUUID(), payloadFor(selectedCandidate));
      toast.success(`${selectedCandidate.name} ${selectedCandidate.existingEntryId ? 'updated' : 'imported'}.`);
      await loadExisting();
      onImported?.();
    } catch (err) {
      console.error(`[${meta.singular}Import] import failed:`, err);
      toast.error(`Failed to import ${selectedCandidate.name}.`);
      reportClientError(err, selectedCandidate.existingEntryId ? OperationType.UPDATE : OperationType.CREATE, `${meta.collection}/${selectedCandidate.existingEntryId || '(new)'}`);
    } finally {
      setSaving(false);
    }
  };

  const handleImportVisible = async () => {
    if (!visibleCandidates.length) { toast.error('No visible entries to import.'); return; }
    setSaving(true);
    try {
      const entries = visibleCandidates.map((c) => ({ id: c.existingEntryId || null, data: payloadFor(c) }));
      await upsertDocumentBatch(meta.collection, entries);
      const created = entries.filter((e) => !e.id).length;
      const updated = entries.filter((e) => !!e.id).length;
      toast.success(`Imported ${entries.length} ${meta.plural.toLowerCase()} (${created} new, ${updated} updated).`);
      await loadExisting();
      onImported?.();
    } catch (err) {
      console.error(`[${meta.singular}Import] batch import failed:`, err);
      toast.error('Failed to import visible entries.');
      reportClientError(err, OperationType.CREATE, `${meta.collection}/(batch import)`);
    } finally {
      setSaving(false);
    }
  };

  if (!isAdmin) {
    return <div className="px-6 py-12 text-center text-ink/50">Foundry import is admin-only.</div>;
  }

  return (
    <div className="h-full flex flex-col">
      <Card className="border-gold/20 bg-card/50 overflow-hidden h-full flex flex-col">
        <CardContent className="p-0 flex-1 flex flex-col min-h-0">
          {/* Header — title + load/import actions + inline stats */}
          <div className="border-b border-gold/10 bg-card px-5 py-3 shrink-0">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-bold uppercase tracking-[0.22em] text-ink">{meta.plural} — Foundry Import</h2>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,application/json"
                  multiple
                  className="hidden"
                  onChange={(e) => { void handleFiles(e.target.files); e.currentTarget.value = ''; }}
                />
                <Button type="button" variant="outline" size="sm" className="gap-2 h-8 border-gold/20 bg-background/40 text-ink hover:bg-gold/5" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="h-3.5 w-3.5" /> Load Exports
                </Button>
                <Button type="button" size="sm" className="gap-2 h-8 btn-gold-solid" onClick={handleImportVisible} disabled={saving || !visibleCandidates.length}>
                  <Download className="h-3.5 w-3.5" /> Import Visible ({visibleCandidates.length})
                </Button>
                {batchSummary.unresolved > 0 ? (
                  <select
                    value=""
                    onChange={(e) => { assignSourceToUnresolvedVisible(e.target.value); e.currentTarget.value = ''; }}
                    className="h-8 rounded-md border border-gold/20 bg-background/40 px-2 text-xs text-ink outline-none hover:bg-gold/5 focus:border-gold"
                    title="Assign a source to all unresolved entries currently in view"
                  >
                    <option value="">Set source for unresolved…</option>
                    {sources.map((s) => (
                      <option key={s.id} value={s.id}>{sourceLabelOf(s.id) || s.id}</option>
                    ))}
                  </select>
                ) : null}
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink/70">
              <InlineStat icon={Layers3} label="loaded" value={batchSummary.total} />
              <InlineStat icon={AlertTriangle} label="unresolved" value={batchSummary.unresolved} tone="warn" />
              <InlineStat icon={ImageOff} label="no image" value={batchSummary.missingImage} tone="warn" />
              <InlineStat icon={BookOpen} label="already imported" value={batchSummary.existing} />
            </div>
          </div>

          {/* Body */}
          <div className="p-5 flex-1 min-h-0 flex flex-col gap-3">
            {!uploadedBatches.length ? (
              <div className="rounded-xl border border-dashed border-gold/20 bg-background/30 px-6 py-12 text-center">
                <FileJson className="mx-auto mb-4 h-10 w-10 text-gold/60" />
                <p className="text-lg font-serif italic text-ink/70">No Foundry {meta.plural.toLowerCase()} exports loaded yet.</p>
                <p className="mx-auto mt-2 max-w-2xl text-sm text-ink/50">
                  Load the <code className="font-mono text-gold/80">{meta.arrayKey}</code> export JSON
                  (<code className="font-mono text-gold/80">{meta.expectedKind}</code>) to review and import.
                </p>
              </div>
            ) : (
              <>
                {/* Shared FilterBar — search + Filters modal (Source + Status axes) */}
                <div className="shrink-0">
                  <FilterBar
                    search={search}
                    setSearch={setSearch}
                    isFilterOpen={isFilterOpen}
                    setIsFilterOpen={setIsFilterOpen}
                    activeFilterCount={activeFilterCount}
                    resetFilters={() => { setSearch(''); resetAxisFilters(); }}
                    searchPlaceholder={`Search ${meta.plural.toLowerCase()} name, source, or identifier`}
                    filterTitle={`Filter ${meta.plural}`}
                    resetLabel="Reset Filters"
                    trailingActions={
                      <div
                        className="text-[11px] font-mono tabular-nums text-ink/55 whitespace-nowrap px-1"
                        title={`${visibleCandidates.length} of ${candidates.length} shown`}
                      >
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
                        setSearch={() => { /* candidate search lives on FilterBar */ }}
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
                        const selected = c.candidateId === selectedCandidateId;
                        return (
                          <button
                            type="button"
                            key={c.candidateId}
                            onClick={() => setSelectedCandidateId(c.candidateId)}
                            className={cn(
                              'w-full rounded-lg border p-2.5 text-left transition-colors flex items-center gap-2.5',
                              selected ? 'border-gold/50 bg-gold/10' : 'border-gold/10 bg-background/30 hover:border-gold/30 hover:bg-background/50',
                            )}
                          >
                            <CandidateThumb src={c.imageUrl} />
                            <div className="min-w-0 flex-1">
                              <div className="font-serif text-sm text-ink truncate">{c.name}</div>
                              <div className="text-[10px] uppercase tracking-[0.16em] text-gold/70 truncate">{c.summary || '—'}</div>
                              <div className="mt-1 flex flex-wrap gap-1">
                                {c.existingEntryId ? <Badge className="bg-sky-500/15 text-sky-200 border-sky-400/20 text-[9px] px-1 py-0">Saved</Badge> : null}
                                {!effectiveSourceId(c) ? <Badge className="bg-blood/20 text-blood border-blood/30 text-[9px] px-1 py-0">No source</Badge> : null}
                                {!c.imageUrl ? <Badge className="bg-amber-500/15 text-amber-200 border-amber-400/20 text-[9px] px-1 py-0">No image</Badge> : null}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Detail — feat-importer-style: header, image + facts grid, warnings, description */}
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
                                  {selectedCandidate.sourcePage ? (
                                    <span className="text-xs uppercase tracking-widest text-ink/40">p{selectedCandidate.sourcePage}</span>
                                  ) : null}
                                </div>
                                <p className="font-serif italic text-ink/70">{selectedCandidate.summary || meta.singular}</p>
                              </div>
                              <Button
                                type="button"
                                className="gap-2 btn-gold-solid shrink-0"
                                onClick={handleImportSelected}
                                disabled={saving}
                              >
                                <Download className="h-4 w-4" />
                                {selectedCandidate.existingEntryId ? `Update ${meta.singular}` : `Import ${meta.singular}`}
                              </Button>
                            </div>
                          </div>

                          <div className="border-b border-gold/10 px-6 py-5">
                            <div className="grid gap-6 lg:grid-cols-[126px_minmax(0,1fr)]">
                              <DetailImage src={selectedCandidate.imageUrl} alt={selectedCandidate.name} />
                              <div className="space-y-3">
                                <div className="grid gap-y-3 text-sm md:grid-cols-2 md:gap-x-8">
                                  {selectedCandidate.facts.map(([label, value]) => (
                                    <FactRow key={label} label={label} value={value} />
                                  ))}
                                  <FactRow label="Identifier" value={selectedCandidate.identifier} />
                                </div>
                                <div>
                                  <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-gold/70">Image URL</div>
                                  <div className="mt-1 break-all font-mono text-[10px] text-ink/55">{selectedCandidate.imageUrl || '— none —'}</div>
                                </div>
                                <div>
                                  <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-gold/70">Source</div>
                                  <select
                                    value={effectiveSourceId(selectedCandidate)}
                                    onChange={(e) => setSourceOverrides((prev) => ({ ...prev, [selectedCandidate.candidateId]: e.target.value }))}
                                    className="mt-1 h-8 w-full max-w-sm rounded-md border border-gold/20 bg-background/40 px-2 text-sm text-ink outline-none focus:border-gold"
                                  >
                                    <option value="">— none (import without a source) —</option>
                                    {sources.map((s) => (
                                      <option key={s.id} value={s.id}>
                                        {(s.abbreviation ? `${s.abbreviation} — ` : '') + (s.name || s.id)}
                                      </option>
                                    ))}
                                  </select>
                                  {!selectedCandidate.sourceResolved && !effectiveSourceId(selectedCandidate) ? (
                                    <p className="mt-1 text-[10px] text-blood">
                                      Book "{selectedCandidate.sourceBook || '?'}" didn't match a source — pick one, or it imports without a source.
                                    </p>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="space-y-4 px-6 py-5">
                            {selectedCandidate.importWarnings.length ? (
                              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
                                <div className="mb-2 flex items-center gap-2 font-bold uppercase tracking-widest text-xs">
                                  <AlertTriangle className="h-4 w-4" /> Notes
                                </div>
                                <ul className="space-y-1 list-disc pl-5 text-[12px]">
                                  {selectedCandidate.importWarnings.map((w) => <li key={w}>{w}</li>)}
                                </ul>
                              </div>
                            ) : null}
                            <div
                              className="prose prose-sm max-w-none prose-p:text-ink/90 prose-strong:text-ink prose-em:text-ink/80 prose-li:text-ink/85 prose-headings:text-ink"
                              dangerouslySetInnerHTML={{ __html: selectedCandidate.descriptionHtml || '<p>No description.</p>' }}
                            />
                          </div>
                        </CardContent>
                      </Card>
                    ) : (
                      <Card className="border-gold/10 bg-background/25">
                        <CardContent className="px-6 py-12 text-center text-ink/50">
                          Select an entry to inspect and import it.
                        </CardContent>
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

function CandidateThumb({ src }: { src: string }) {
  if (!src) {
    return (
      <div className="h-9 w-9 shrink-0 rounded border border-amber-500/30 bg-amber-500/5 flex items-center justify-center">
        <ImageOff className="h-4 w-4 text-amber-400/60" />
      </div>
    );
  }
  return <img src={src} alt="" loading="lazy" className="h-9 w-9 shrink-0 rounded border border-gold/20 object-cover" />;
}

function DetailImage({ src, alt }: { src: string; alt: string }) {
  if (!src) {
    return (
      <div className="h-[126px] w-[126px] shrink-0 rounded-lg border border-amber-500/30 bg-amber-500/5 flex flex-col items-center justify-center gap-1">
        <ImageOff className="h-7 w-7 text-amber-400/60" />
        <span className="text-[9px] uppercase tracking-widest text-amber-400/60">no image</span>
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
