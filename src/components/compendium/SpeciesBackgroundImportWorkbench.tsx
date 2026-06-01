import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, BookOpen, Download, FileJson, ImageOff, Layers3, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { reportClientError, OperationType } from '../../lib/firebase';
import { fetchCollection, upsertDocument, upsertDocumentBatch } from '../../lib/d1';
import { cn } from '../../lib/utils';
import {
  buildSpeciesBackgroundCandidates,
  IMPORT_KIND_META,
  type SpeciesBackgroundImportKind,
  type SpeciesBackgroundImportCandidate,
} from '../../lib/speciesBackgroundImport';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Input } from '../ui/input';

/**
 * Foundry-import workbench for Species + Backgrounds (mode inside
 * SpeciesBackgroundEditor). Mirrors SpellImportWorkbench — the working
 * reference for image capture — trimmed to what these tables need.
 *
 * The detail pane shows the resolved image prominently so the importer
 * can confirm at a glance that `imageUrl` was captured (the thing that
 * silently broke for feats). A "Missing image" filter surfaces any rows
 * whose Foundry item had no `img`.
 */

type SourceRecord = { id: string; name?: string; abbreviation?: string; shortName?: string; slug?: string; rules?: string; [key: string]: any };
type UploadedBatch = { id: string; fileName: string; payload: any };
type StatusFilter = 'all' | 'unresolved' | 'missingImage' | 'existing';

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
  const [uploadedBatches, setUploadedBatches] = useState<UploadedBatch[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
      } catch (err) {
        console.error(`[${meta.singular}Import] load failed:`, err);
      }
    })();
    return () => { cancelled = true; };
  }, [isAdmin, meta.collection, meta.singular]);

  const candidates = useMemo(
    () => uploadedBatches.flatMap((batch) =>
      buildSpeciesBackgroundCandidates(kind, batch.payload, batch.fileName, sources, existingEntries)),
    [uploadedBatches, sources, existingEntries, kind],
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
      if (statusFilter === 'unresolved' && c.sourceResolved) return false;
      if (statusFilter === 'missingImage' && c.imageUrl) return false;
      if (statusFilter === 'existing' && !c.existingEntryId) return false;
      if (lowered) {
        const hit = c.name.toLowerCase().includes(lowered)
          || c.identifier.toLowerCase().includes(lowered)
          || c.sourceBook.toLowerCase().includes(lowered)
          || c.matchedSourceLabel.toLowerCase().includes(lowered);
        if (!hit) return false;
      }
      return true;
    });
  }, [candidates, search, statusFilter]);

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
      updatedAt: new Date().toISOString(),
      createdAt: existing?.createdAt || new Date().toISOString(),
    };
    Object.keys(data).forEach((k) => { if (data[k] === undefined) delete data[k]; });
    return data;
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

  const FILTERS: Array<[StatusFilter, string, number | null]> = [
    ['all', 'All', null],
    ['unresolved', 'Unresolved source', batchSummary.unresolved],
    ['missingImage', 'Missing image', batchSummary.missingImage],
    ['existing', 'Already imported', batchSummary.existing],
  ];

  return (
    <div className="h-full flex flex-col">
      <Card className="border-gold/20 bg-card/50 overflow-hidden h-full flex flex-col">
        <CardContent className="p-0 flex-1 flex flex-col min-h-0">
          {/* Header */}
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
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={`Search ${meta.plural.toLowerCase()} name, source, or identifier`}
                    className="h-8 max-w-xs bg-background/50 border-gold/10 focus:border-gold text-sm"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <div className="flex flex-wrap gap-1">
                    {FILTERS.map(([value, label, count]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setStatusFilter(value)}
                        className={cn(
                          'rounded-md border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] transition-colors',
                          statusFilter === value ? 'border-gold bg-gold/10 text-gold' : 'border-gold/15 bg-background/40 text-ink/55 hover:border-gold/35 hover:text-gold',
                        )}
                      >
                        {label}{count != null && count > 0 ? ` (${count})` : ''}
                      </button>
                    ))}
                  </div>
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
                                {!c.sourceResolved ? <Badge className="bg-blood/20 text-blood border-blood/30 text-[9px] px-1 py-0">No source</Badge> : null}
                                {!c.imageUrl ? <Badge className="bg-amber-500/15 text-amber-200 border-amber-400/20 text-[9px] px-1 py-0">No image</Badge> : null}
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
                          <div className="border-b border-gold/10 px-5 py-4 flex items-start gap-4">
                            <DetailImage src={selectedCandidate.imageUrl} alt={selectedCandidate.name} />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="font-serif text-2xl font-bold text-ink">{selectedCandidate.name}</h3>
                                {selectedCandidate.matchedSourceLabel ? (
                                  <Badge className="border-gold/20 bg-gold/10 text-gold">{selectedCandidate.matchedSourceLabel}</Badge>
                                ) : (
                                  <Badge className="border-blood/30 bg-blood/15 text-blood">{selectedCandidate.sourceBook || 'No source'}</Badge>
                                )}
                                {selectedCandidate.sourcePage ? <span className="text-xs uppercase tracking-widest text-ink/40">p{selectedCandidate.sourcePage}</span> : null}
                              </div>
                              <div className="mt-1 font-mono text-[11px] text-ink/45">{selectedCandidate.identifier}</div>
                              <Button
                                type="button"
                                size="sm"
                                className="mt-3 gap-2 btn-gold-solid"
                                onClick={handleImportSelected}
                                disabled={saving}
                              >
                                <Download className="h-4 w-4" />
                                {selectedCandidate.existingEntryId ? `Update ${meta.singular}` : `Import ${meta.singular}`}
                              </Button>
                            </div>
                          </div>

                          <div className="px-5 py-4 space-y-4">
                            {selectedCandidate.importWarnings.length ? (
                              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
                                <div className="mb-1.5 flex items-center gap-2 font-bold uppercase tracking-widest text-xs">
                                  <AlertTriangle className="h-4 w-4" /> Notes
                                </div>
                                <ul className="space-y-1 list-disc pl-5 text-[12px]">
                                  {selectedCandidate.importWarnings.map((w) => <li key={w}>{w}</li>)}
                                </ul>
                              </div>
                            ) : null}

                            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs">
                              {selectedCandidate.facts.map(([label, value]) => (
                                <React.Fragment key={label}>
                                  <dt className="font-bold uppercase tracking-widest text-[10px] text-gold/70 pt-0.5">{label}</dt>
                                  <dd className="text-ink/85">{value}</dd>
                                </React.Fragment>
                              ))}
                              <dt className="font-bold uppercase tracking-widest text-[10px] text-gold/70 pt-0.5">Image URL</dt>
                              <dd className="text-ink/60 break-all font-mono text-[10px]">{selectedCandidate.imageUrl || '— none —'}</dd>
                            </dl>

                            <div
                              className="prose prose-sm max-w-none text-ink/85 border-t border-gold/10 pt-3"
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
      <div className="h-[88px] w-[88px] shrink-0 rounded-lg border border-amber-500/30 bg-amber-500/5 flex flex-col items-center justify-center gap-1">
        <ImageOff className="h-6 w-6 text-amber-400/60" />
        <span className="text-[9px] uppercase tracking-widest text-amber-400/60">no image</span>
      </div>
    );
  }
  return <img src={src} alt={alt} className="h-[88px] w-[88px] shrink-0 rounded-lg border border-gold/20 object-cover" />;
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
