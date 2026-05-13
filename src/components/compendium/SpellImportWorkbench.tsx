import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, BookOpen, Download, FileJson, Layers3, Search, Sparkles, Tag, Upload, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { reportClientError, OperationType } from '../../lib/firebase';
import { upsertSpell, upsertSpellBatch } from '../../lib/compendium';
import { fetchCollection } from '../../lib/d1';
import { cn } from '../../lib/utils';
import { buildSpellImportCandidates, formatFoundrySpellDescriptionForDisplay, type FoundrySpellFolderExport, type SpellImportCandidate } from '../../lib/spellImport';
import { type SpellSummaryRecord } from '../../lib/spellSummary';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { ScrollArea } from '../ui/scroll-area';
import SpellArtPreview from './SpellArtPreview';

type SourceRecord = {
  id: string;
  name?: string;
  abbreviation?: string;
  shortName?: string;
  slug?: string;
  rules?: string;
  [key: string]: any;
};

type TagGroupRecord = {
  id: string;
  name?: string;
  category?: string;
  classifications?: string[];
  [key: string]: any;
};

type TagRecord = {
  id: string;
  name?: string;
  groupId?: string;
  [key: string]: any;
};

type UploadedBatch = {
  id: string;
  fileName: string;
  payload: FoundrySpellFolderExport;
};

const LEVEL_OPTIONS = [
  { value: 'all', label: 'All Levels' },
  { value: '0', label: 'Cantrips' },
  ...Array.from({ length: 9 }, (_, index) => ({ value: String(index + 1), label: `Level ${index + 1}` }))
];

function buildDisplayHtml(html: string) {
  return formatFoundrySpellDescriptionForDisplay(html || '');
}

export default function SpellImportWorkbench({ userProfile }: { userProfile: any }) {
  const isAdmin = userProfile?.role === 'admin';
  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [existingEntries, setExistingEntries] = useState<SpellSummaryRecord[]>([]);
  const [tagGroups, setTagGroups] = useState<TagGroupRecord[]>([]);
  const [allTags, setAllTags] = useState<TagRecord[]>([]);
  const [uploadedBatches, setUploadedBatches] = useState<UploadedBatch[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState('');
  const [search, setSearch] = useState('');
  const [levelFilter, setLevelFilter] = useState('all');
  const [schoolFilter, setSchoolFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [tagSearch, setTagSearch] = useState('');
  const [selectedFilterTagIds, setSelectedFilterTagIds] = useState<string[]>([]);
  const [candidateTagIds, setCandidateTagIds] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;

    (async () => {
      try {
        const [sourcesData, tagGroupsData, tagsData, spellsData] = await Promise.all([
          fetchCollection<any>('sources', { orderBy: 'name ASC' }),
          fetchCollection<any>('tagGroups'),
          fetchCollection<any>('tags', { orderBy: 'name ASC' }),
          fetchCollection<any>('spells', { orderBy: 'name ASC' }),
        ]);
        if (cancelled) return;

        setSources(sourcesData);
        // tagGroups carries `classifications` as a JSON array (auto-parsed by queryD1).
        // The Firestore query previously filtered server-side; D1 has only a few rows
        // so client-side filtering for the 'spell' classification is the simpler call.
        setTagGroups(tagGroupsData.filter((g: any) => Array.isArray(g.classifications) && g.classifications.includes('spell')));
        setAllTags(tagsData);

        // Map D1 spell rows (snake_case) to camelCase the workbench expects.
        const mappedSpells = spellsData.map((row: any) => ({
          ...row,
          sourceId: row.source_id,
          imageUrl: row.image_url,
          level: Number(row.level || 0),
          school: row.school,
          preparationMode: row.preparation_mode,
          tagIds: Array.isArray(row.tags) ? row.tags : []
        }));
        setExistingEntries(mappedSpells);
      } catch (error) {
        console.error('SpellImportWorkbench load error:', error);
      }
    })();

    return () => { cancelled = true; };
  }, [isAdmin]);

  const candidates = useMemo(() => (
    uploadedBatches.flatMap((batch) => buildSpellImportCandidates(batch.payload, batch.fileName, sources, existingEntries))
  ), [uploadedBatches, sources, existingEntries]);

  useEffect(() => {
    if (!candidates.length) return;

    setCandidateTagIds((current) => {
      const next = { ...current };
      let changed = false;

      for (const candidate of candidates) {
        if (next[candidate.candidateId]) continue;
        const existing = existingEntries.find((entry) => entry.id === candidate.existingEntryId);
        next[candidate.candidateId] = Array.isArray(existing?.tagIds) ? existing.tagIds : [];
        changed = true;
      }

      return changed ? next : current;
    });
  }, [candidates, existingEntries]);

  const schoolOptions = useMemo(() => {
    const schools = Array.from(new Set(candidates.map((candidate) => candidate.school))).filter(Boolean);
    return [
      { value: 'all', label: 'All Schools' },
      ...schools.map((school) => ({
        value: school,
        label: candidates.find((candidate) => candidate.school === school)?.schoolLabel || school.toUpperCase()
      }))
    ];
  }, [candidates]);

  const sourceOptions = useMemo(() => {
    const sourceLabels = Array.from(new Set(candidates.map((candidate) => candidate.matchedSourceLabel || candidate.sourceBook))).filter(Boolean);
    return [
      { value: 'all', label: 'All Sources' },
      ...sourceLabels.map((label) => ({ value: label, label }))
    ];
  }, [candidates]);

  const tagsByGroup = useMemo(() => {
    const map: Record<string, TagRecord[]> = {};
    for (const tag of allTags) {
      if (!tag.groupId) continue;
      if (!map[tag.groupId]) map[tag.groupId] = [];
      map[tag.groupId].push(tag);
    }
    return map;
  }, [allTags]);

  const visibleCandidates = useMemo(() => {
    return candidates.filter((candidate) => {
      const sourceLabel = candidate.matchedSourceLabel || candidate.sourceBook;
      const assignedTagIds = candidateTagIds[candidate.candidateId] || [];
      return (
        (levelFilter === 'all' || String(candidate.level) === levelFilter)
        && (schoolFilter === 'all' || candidate.school === schoolFilter)
        && (sourceFilter === 'all' || sourceLabel === sourceFilter)
        && (selectedFilterTagIds.length === 0 || selectedFilterTagIds.every((tagId) => assignedTagIds.includes(tagId)))
        && (
          !search.trim()
          || candidate.name.toLowerCase().includes(search.trim().toLowerCase())
          || candidate.identifier.toLowerCase().includes(search.trim().toLowerCase())
          || sourceLabel.toLowerCase().includes(search.trim().toLowerCase())
        )
      );
    });
  }, [candidates, candidateTagIds, levelFilter, schoolFilter, sourceFilter, selectedFilterTagIds, search]);

  useEffect(() => {
    if (!visibleCandidates.length) {
      setSelectedCandidateId('');
      return;
    }
    if (!selectedCandidateId || !visibleCandidates.some((candidate) => candidate.candidateId === selectedCandidateId)) {
      setSelectedCandidateId(visibleCandidates[0].candidateId);
    }
  }, [visibleCandidates, selectedCandidateId]);

  const selectedCandidate = visibleCandidates.find((candidate) => candidate.candidateId === selectedCandidateId)
    || candidates.find((candidate) => candidate.candidateId === selectedCandidateId)
    || null;

  const batchSummary = useMemo(() => {
    return {
      totalSpells: candidates.length,
      unresolvedSources: candidates.filter((candidate) => !candidate.sourceResolved).length,
      existingMatches: candidates.filter((candidate) => candidate.existingEntryId).length,
      scalingSpells: candidates.filter((candidate) => candidate.descriptionHtml.toLowerCase().includes('higher level')).length
    };
  }, [candidates]);

  const selectedCandidateTagIds = selectedCandidate ? (candidateTagIds[selectedCandidate.candidateId] || []) : [];

  const filteredTagGroups = useMemo(() => {
    if (!tagSearch.trim()) return tagGroups;
    const lowered = tagSearch.trim().toLowerCase();
    return tagGroups.filter((group) => {
      const groupName = String(group.name ?? '').toLowerCase();
      if (groupName.includes(lowered)) return true;
      return (tagsByGroup[group.id] || []).some((tag) => String(tag.name ?? '').toLowerCase().includes(lowered));
    });
  }, [tagGroups, tagSearch, tagsByGroup]);

  const toggleCandidateTag = (candidateId: string, tagId: string) => {
    setCandidateTagIds((current) => {
      const existing = current[candidateId] || [];
      return {
        ...current,
        [candidateId]: existing.includes(tagId)
          ? existing.filter((entry) => entry !== tagId)
          : [...existing, tagId]
      };
    });
  };

  const toggleFilterTag = (tagId: string) => {
    setSelectedFilterTagIds((current) =>
      current.includes(tagId)
        ? current.filter((entry) => entry !== tagId)
        : [...current, tagId]
    );
  };

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList?.length) return;

    const nextBatches: UploadedBatch[] = [];

    for (const file of Array.from(fileList)) {
      try {
        const raw = await file.text();
        const payload = JSON.parse(raw);
        if (payload?.kind !== 'dauligor.foundry-spell-folder-export.v1' || !Array.isArray(payload?.spells)) {
          throw new Error('Expected a dauligor.foundry-spell-folder-export.v1 payload.');
        }

        nextBatches.push({
          id: `${file.name}-${payload.exportedAt || Date.now()}`,
          fileName: file.name,
          payload
        });
      } catch (error: any) {
        toast.error(`${file.name}: ${error?.message || 'Could not parse file.'}`);
      }
    }

    if (!nextBatches.length) return;

    setUploadedBatches((current) => {
      const merged = [...current];
      for (const batch of nextBatches) {
        const existingIndex = merged.findIndex((entry) => entry.fileName === batch.fileName);
        if (existingIndex >= 0) merged[existingIndex] = batch;
        else merged.push(batch);
      }
      return merged;
    });

    toast.success(`Loaded ${nextBatches.length} Foundry spell export ${nextBatches.length === 1 ? 'file' : 'files'}.`);
  };

  const saveCandidate = async (candidate: SpellImportCandidate) => {
    const payload = {
      ...candidate.savePayload,
      updatedAt: new Date().toISOString(),
      createdAt: undefined
    } as Record<string, any>;

    Object.keys(payload).forEach((key) => {
      if (payload[key] === undefined) delete payload[key];
    });

    if (candidate.existingEntryId) {
      const updatedPayload = {
        ...payload,
        tagIds: candidateTagIds[candidate.candidateId] || [],
        createdAt: existingEntries.find((entry) => entry.id === candidate.existingEntryId)?.createdAt || new Date().toISOString()
      };
      await upsertSpell(candidate.existingEntryId, updatedPayload);
      return 'updated';
    }

    await upsertSpell(crypto.randomUUID(), {
      ...payload,
      tagIds: candidateTagIds[candidate.candidateId] || [],
      createdAt: new Date().toISOString()
    });
    return 'created';
  };

  const handleImportSelected = async () => {
    if (!selectedCandidate) return;
    if (!selectedCandidate.sourceResolved) {
      toast.error('Resolve the source mapping before importing this spell.');
      return;
    }

    setSaving(true);
    try {
      const action = await saveCandidate(selectedCandidate);
      toast.success(`${selectedCandidate.name} ${action}.`);
    } catch (error) {
      console.error('Error importing spell:', error);
      toast.error(`Failed to import ${selectedCandidate.name}.`);
      reportClientError(
        error,
        selectedCandidate.existingEntryId ? OperationType.UPDATE : OperationType.CREATE,
        `spells/${selectedCandidate.existingEntryId || '(new)'}`
      );
    } finally {
      setSaving(false);
    }
  };

  const handleImportVisible = async () => {
    const importable = visibleCandidates.filter((candidate) => candidate.sourceResolved);
    if (!importable.length) {
      toast.error('No visible spells are ready to import.');
      return;
    }

    setSaving(true);
    try {
      const entries = importable.map((candidate) => {
        const existingCreatedAt = existingEntries.find((entry) => entry.id === candidate.existingEntryId)?.createdAt || new Date().toISOString();
        const payload = {
          ...candidate.savePayload,
          tagIds: candidateTagIds[candidate.candidateId] || [],
          updatedAt: new Date().toISOString(),
          createdAt: candidate.existingEntryId ? existingCreatedAt : new Date().toISOString()
        } as Record<string, any>;

        Object.keys(payload).forEach((key) => {
          if (payload[key] === undefined) delete payload[key];
        });

        return {
          id: candidate.existingEntryId || null,
          data: payload
        };
      });

      const results = await upsertSpellBatch(entries);
      
      const createdCount = entries.filter(e => !e.id).length;
      const updatedCount = entries.filter(e => !!e.id).length;
      
      toast.success(`Imported ${entries.length} spells (${createdCount} new, ${updatedCount} updated).`);
    } catch (error) {
      console.error('Error importing visible spells:', error);
      toast.error('Failed to import visible spells.');
      reportClientError(error, OperationType.CREATE, 'spells/(batch import)');
    } finally {
      setSaving(false);
    }
  };

  if (!isAdmin) return null;

  return (
    <div className="space-y-6">
      <Card className="border-gold/20 bg-card/50 overflow-hidden">
        <CardContent className="p-0">
          <div className="border-b border-gold/10 bg-[radial-gradient(circle_at_top_left,rgba(192,160,96,0.14),transparent_52%),linear-gradient(180deg,rgba(12,16,24,0.75),rgba(12,16,24,0.98))] p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="space-y-3">
                <div className="flex items-center gap-3 text-gold">
                  <Wand2 className="h-5 w-5" />
                  <span className="text-xs font-bold uppercase tracking-[0.3em]">Foundry Spell Import</span>
                </div>
                <div className="space-y-2">
                  <h2 className="text-3xl font-serif font-bold uppercase tracking-tight text-ink">Spell Browser</h2>
                  <p className="max-w-3xl font-serif italic text-ink/60">
                    Load one or more Foundry spell-folder exports, review them in a 5etools-style browser, and import single spells or the entire visible batch into Dauligor.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,application/json"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    void handleFiles(event.target.files);
                    event.currentTarget.value = '';
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="gap-2 border-gold/20 bg-background/40 text-ink hover:bg-gold/5"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-4 w-4" />
                  Load Foundry Exports
                </Button>
                <Button
                  type="button"
                  className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground"
                  onClick={handleImportVisible}
                  disabled={saving || !visibleCandidates.some((candidate) => candidate.sourceResolved)}
                >
                  <Download className="h-4 w-4" />
                  Import Visible Batch
                </Button>
              </div>
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-4">
              <SummaryStat icon={Layers3} label="Loaded Spells" value={String(batchSummary.totalSpells)} />
              <SummaryStat icon={AlertTriangle} label="Unresolved Sources" value={String(batchSummary.unresolvedSources)} />
              <SummaryStat icon={BookOpen} label="Existing Matches" value={String(batchSummary.existingMatches)} />
              <SummaryStat icon={Sparkles} label="Scaling Spells" value={String(batchSummary.scalingSpells)} />
            </div>
          </div>

          <div className="p-6">
            {!uploadedBatches.length ? (
              <div className="rounded-xl border border-dashed border-gold/20 bg-background/30 px-6 py-12 text-center">
                <FileJson className="mx-auto mb-4 h-10 w-10 text-gold/60" />
                <p className="text-lg font-serif italic text-ink/70">No Foundry spell exports loaded yet.</p>
                <p className="mx-auto mt-2 max-w-2xl text-sm text-ink/50">
                  Use the Load Foundry Exports button to begin reviewing available imports.
                </p>
              </div>
            ) : (
              <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
                <div className="space-y-4">
                  <div className="grid gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs font-bold uppercase tracking-widest text-ink/40">Search</Label>
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink/30" />
                        <Input
                          value={search}
                          onChange={(event) => setSearch(event.target.value)}
                          placeholder="Search spell name, source, or identifier"
                          className="bg-background/50 border-gold/10 pl-9 focus:border-gold"
                          autoComplete="off"
                          spellCheck={false}
                        />
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
                      <FilterSelect label="Level" value={levelFilter} onChange={setLevelFilter} options={LEVEL_OPTIONS} />
                      <FilterSelect label="School" value={schoolFilter} onChange={setSchoolFilter} options={schoolOptions} />
                      <FilterSelect label="Source" value={sourceFilter} onChange={setSourceFilter} options={sourceOptions} />
                    </div>
                  </div>

                  {tagGroups.length ? (
                    <Card className="border-gold/10 bg-background/20">
                      <CardContent className="space-y-4 p-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-gold/70">
                            <Tag className="h-3.5 w-3.5" />
                            Spell Tags
                          </div>
                          <p className="text-[11px] text-ink/45">Filter the spell list by your Dauligor spell tags.</p>
                        </div>
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink/30" />
                          <Input
                            value={tagSearch}
                            onChange={(event) => setTagSearch(event.target.value)}
                            placeholder="Search tags"
                            className="bg-background/50 border-gold/10 pl-9 focus:border-gold"
                            autoComplete="off"
                            spellCheck={false}
                          />
                        </div>
                        <div className="max-h-80 space-y-4 overflow-y-auto pr-1">
                          {filteredTagGroups.map((group) => {
                            const tags = tagsByGroup[group.id] || [];
                            if (!tags.length) return null;
                            return (
                              <div key={group.id} className="space-y-2">
                                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-ink/45">{group.name}</div>
                                <div className="flex flex-wrap gap-2">
                                  {tags.map((tag) => {
                                    const active = selectedFilterTagIds.includes(tag.id);
                                    return (
                                      <button
                                        key={tag.id}
                                        type="button"
                                        onClick={() => toggleFilterTag(tag.id)}
                                        className={cn(
                                          'rounded-md border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] transition-colors',
                                          active
                                            ? 'border-gold bg-gold text-background'
                                            : 'border-gold/15 bg-background/40 text-ink/60 hover:border-gold/35 hover:text-gold'
                                        )}
                                      >
                                        {tag.name}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </CardContent>
                    </Card>
                  ) : null}

                  <Card className="border-gold/10 bg-background/20">
                    <CardContent className="p-0">
                      <ScrollArea className="h-[850px]">
                        <div className="space-y-2 p-3">
                          {visibleCandidates.map((candidate) => {
                            const unresolved = !candidate.sourceResolved;
                            const selected = candidate.candidateId === selectedCandidateId;
                            const sourceLabel = candidate.matchedSourceLabel || candidate.sourceBook || 'Unknown Source';
                            return (
                              <button
                                type="button"
                                key={candidate.candidateId}
                                onClick={() => setSelectedCandidateId(candidate.candidateId)}
                                className={cn(
                                  'w-full rounded-xl border p-3 text-left transition-colors',
                                  selected
                                    ? 'border-gold/50 bg-gold/10 shadow-[0_0_0_1px_rgba(192,160,96,0.2)]'
                                    : 'border-gold/10 bg-background/30 hover:border-gold/30 hover:bg-background/50'
                                )}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <div className="font-serif text-lg text-ink">{candidate.name}</div>
                                    <div className="text-[10px] uppercase tracking-[0.2em] text-gold/70">
                                      {candidate.level === 0 ? 'Cantrip' : `Level ${candidate.level}`} {candidate.schoolLabel}
                                    </div>
                                  </div>
                                  <span className="text-[10px] font-mono text-ink/35">{sourceLabel}</span>
                                </div>

                                <div className="mt-2 flex flex-wrap gap-2">
                                  {candidate.existingEntryId ? <Badge className="bg-sky-500/15 text-sky-200 border-sky-400/20">Saved</Badge> : null}
                                  {unresolved ? <Badge className="bg-blood/20 text-blood border-blood/30">Unresolved Source</Badge> : null}
                                  {candidate.descriptionHtml.toLowerCase().includes('higher level') ? (
                                    <Badge className="bg-gold/15 text-gold border-gold/20">Scaling</Badge>
                                  ) : null}
                                  {candidate.effects.length ? (
                                    <Badge className="bg-violet-500/15 text-violet-200 border-violet-400/20">{candidate.effects.length} Effects</Badge>
                                  ) : null}
                                  {(candidateTagIds[candidate.candidateId] || []).slice(0, 2).map((tagId) => {
                                    const tag = allTags.find((entry) => entry.id === tagId);
                                    return tag?.name ? (
                                      <Badge key={tagId} className="bg-emerald-500/15 text-emerald-200 border-emerald-400/20">{tag.name}</Badge>
                                    ) : null;
                                  })}
                                </div>

                                <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-ink/55">
                                  <span>{candidate.methodLabel}</span>
                                  <span className="text-right">{candidate.activities.length} activities</span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </ScrollArea>
                    </CardContent>
                  </Card>
                </div>

                <div className="space-y-4">
                  {selectedCandidate ? (
                    <>
                      <Card className="border-gold/10 bg-background/25 overflow-hidden">
                        <CardContent className="p-0">
                          <div className="border-b border-gold/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),transparent)] px-6 py-5">
                            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                              <div className="space-y-2">
                                <div className="flex items-center gap-3">
                                  <h3 className="font-serif text-4xl font-bold text-ink">{selectedCandidate.name}</h3>
                                  {selectedCandidate.matchedSourceLabel ? (
                                    <Badge className="border-gold/20 bg-gold/10 text-gold">{selectedCandidate.matchedSourceLabel}</Badge>
                                  ) : null}
                                  {selectedCandidate.sourcePage ? (
                                    <span className="text-xs uppercase tracking-widest text-ink/40">p{selectedCandidate.sourcePage}</span>
                                  ) : null}
                                </div>
                                <p className="font-serif italic text-ink/70">
                                  {selectedCandidate.level === 0 ? 'Cantrip' : `Level ${selectedCandidate.level}`} {selectedCandidate.schoolLabel}
                                </p>
                              </div>

                              <div className="flex flex-wrap gap-2">
                                <Button
                                  type="button"
                                  className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground"
                                  onClick={handleImportSelected}
                                  disabled={saving || !selectedCandidate.sourceResolved}
                                >
                                  <Download className="h-4 w-4" />
                                  {selectedCandidate.existingEntryId ? 'Update Spell' : 'Import Spell'}
                                </Button>
                              </div>
                            </div>
                          </div>

                            <div className="border-b border-gold/10 px-6 py-5">
                            <div className="grid gap-6 lg:grid-cols-[126px_minmax(0,1fr)]">
                              <SpellArtPreview
                                src={selectedCandidate.imageUrl}
                                alt={selectedCandidate.name}
                                size={126}
                              />
                              <div className="grid gap-y-3 text-sm text-ink md:grid-cols-2 md:gap-x-8">
                                <SpellRow label="Casting Time" value={selectedCandidate.activationLabel} />
                                <SpellRow label="Range" value={selectedCandidate.rangeLabel} />
                                <SpellRow label="Components" value={selectedCandidate.componentsLabel} />
                                <SpellRow label="Duration" value={selectedCandidate.durationLabel} />
                                <SpellRow label="Target" value={selectedCandidate.targetLabel} />
                                <SpellRow label="Method" value={selectedCandidate.methodLabel} />
                              </div>
                            </div>
                          </div>

                          <div className="space-y-4 px-6 py-5">
                            {selectedCandidate.importWarnings.length ? (
                              <div className="rounded-lg border border-blood/30 bg-blood/10 p-4 text-sm text-blood">
                                <div className="mb-2 flex items-center gap-2 font-bold uppercase tracking-widest">
                                  <AlertTriangle className="h-4 w-4" />
                                  Import Warnings
                                </div>
                                <ul className="space-y-1 list-disc pl-5">
                                  {selectedCandidate.importWarnings.map((warning) => (
                                    <li key={warning}>{warning}</li>
                                  ))}
                                </ul>
                              </div>
                            ) : null}

                            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
                              <div className="space-y-3">
                                <div
                                  className="prose prose-invert max-w-none prose-p:text-ink/90 prose-strong:text-ink prose-em:text-ink/80 prose-li:text-ink/85 prose-headings:text-ink"
                                  dangerouslySetInnerHTML={{ __html: buildDisplayHtml(selectedCandidate.descriptionHtml) || '<p>No description.</p>' }}
                                />
                              </div>

                              <div className="space-y-3">
                                {tagGroups.length ? (
                                  <div className="rounded-lg border border-gold/10 bg-background/25 p-4">
                                    <div className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-gold/70">
                                      <Tag className="h-3.5 w-3.5" />
                                      Spell Tags
                                    </div>
                                    <div className="space-y-3">
                                      {tagGroups.map((group) => {
                                        const tags = tagsByGroup[group.id] || [];
                                        if (!tags.length) return null;
                                        return (
                                          <div key={group.id} className="space-y-2">
                                            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-ink/45">{group.name}</div>
                                            <div className="flex flex-wrap gap-2">
                                              {tags.map((tag) => {
                                                const active = selectedCandidateTagIds.includes(tag.id);
                                                return (
                                                  <button
                                                    key={tag.id}
                                                    type="button"
                                                    onClick={() => toggleCandidateTag(selectedCandidate.candidateId, tag.id)}
                                                    className={cn(
                                                      'rounded-md border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] transition-colors',
                                                      active
                                                        ? 'border-gold bg-gold text-background'
                                                        : 'border-gold/15 bg-background/40 text-ink/60 hover:border-gold/35 hover:text-gold'
                                                    )}
                                                  >
                                                    {tag.name}
                                                  </button>
                                                );
                                              })}
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                ) : null}

                                <InfoBlock title="Batch File" value={selectedCandidate.batchLabel} />
                                <InfoBlock title="Identifier" value={selectedCandidate.identifier} />
                                <InfoBlock
                                  title="Source Match"
                                  value={selectedCandidate.sourceResolved ? (selectedCandidate.matchedSourceLabel || selectedCandidate.matchedSourceId) : 'Unresolved'}
                                />
                                <InfoBlock title="Activities" value={String(selectedCandidate.activities.length)} />
                                <InfoBlock title="Effects" value={String(selectedCandidate.effects.length)} />
                                <InfoBlock title="Materials" value={selectedCandidate.materialLabel || 'None'} />
                                {selectedCandidate.existingEntryId ? (
                                  <InfoBlock title="Existing Draft" value={selectedCandidate.existingEntryName || selectedCandidate.existingEntryId} />
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </>
                  ) : (
                    <Card className="border-gold/10 bg-background/25">
                      <CardContent className="px-6 py-12 text-center text-ink/50">
                        Select a spell from the left to inspect and import it.
                      </CardContent>
                    </Card>
                  )}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryStat({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gold/10 bg-background/35 px-4 py-3">
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-gold/70">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-2 font-serif text-2xl text-ink">{value}</div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-bold uppercase tracking-widest text-ink/40">{label}</Label>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-md border border-gold/10 bg-background/50 px-3 text-sm outline-none focus:border-gold"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </div>
  );
}

function SpellRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-gold/70">{label}</div>
      <div className="mt-1 text-sm text-ink/90">{value || '—'}</div>
    </div>
  );
}

function InfoBlock({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-lg border border-gold/10 bg-background/30 px-4 py-3">
      <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-gold/70">{title}</div>
      <div className="mt-2 break-words text-sm text-ink/90">{value}</div>
    </div>
  );
}
