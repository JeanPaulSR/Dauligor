import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, BookOpen, Download, FileJson, Layers3, Search, Sparkles, Tag, Upload, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { reportClientError, OperationType } from '../../lib/clientError';
import { upsertSpell, upsertSpellBatch } from '../../lib/compendium';
import { fetchCollection } from '../../lib/d1';
import { cn } from '../../lib/utils';
import { buildSpellImportCandidates, formatFoundrySpellDescriptionForDisplay, type FoundrySpellFolderExport, type SpellImportCandidate } from '../../lib/spellImport';
import { type SpellSummaryRecord } from '../../lib/spellSummary';
import { matchesSingleAxisFilter, matchesMultiAxisFilter } from '../../lib/spellFilters';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Input } from '../ui/input';
import SpellArtPreview from './SpellArtPreview';
import { FilterBar } from './FilterBar';
import { SectionFilterPanel, type FilterSection } from './SectionFilterPanel';

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

// Level axis values for SectionFilterPanel. No 'all' sentinel — the
// tri-state pill UX treats "no filter set" as the default; the user
// includes the levels they want or excludes the ones they don't.
const LEVEL_AXIS_VALUES: ReadonlyArray<{ value: string; label: string }> = [
  { value: '0', label: 'Cantrip' },
  ...Array.from({ length: 9 }, (_, index) => ({
    value: String(index + 1),
    label: `Lvl ${index + 1}`,
  })),
];

// Match-status axis — surfaces the candidate-level mismatch flags so
// admins can quickly isolate rows that need attention before bulk
// import. Each value is checked as set-membership on the candidate's
// derived flag set (see matchesMultiAxisFilter call below). Include
// "Unresolved Source" to see only candidates whose source didn't map;
// exclude "Has Warning" to hide everything with import warnings.
const STATUS_AXIS_VALUES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'unresolvedSource', label: 'Unresolved Source' },
  { value: 'hasWarning', label: 'Has Warning' },
];

// Local mirror of useSpellFilters' AxisState — kept inline so the
// workbench doesn't need to consume the full filter hook (which also
// owns tag state, spell match predicates, etc. we don't need here).
type AxisState = {
  states: Record<string, number>;
  combineMode?: 'AND' | 'OR' | 'XOR';
  exclusionMode?: 'AND' | 'OR' | 'XOR';
};

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
  // Rich tri-state axis filters — replaces the single-value Level /
  // School / Source dropdowns. Same shape useSpellFilters / FeatList
  // consume so SectionFilterPanel can plug in directly. Each axis:
  //   { states: { [value]: 1=include | 2=exclude }, combineMode, exclusionMode }
  const [axisFilters, setAxisFilters] = useState<Record<string, AxisState>>({});
  // Whether the FilterBar's filter modal is open. The pill wall lives
  // inside the modal so it doesn't crowd the candidate browser rail.
  const [filterOpen, setFilterOpen] = useState(false);
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

  // Axis-state cyclers + bulk controls — mirrors the FeatList pattern.
  // Forward + reverse pairs power SectionFilterPanel's left-click /
  // right-click chip cycling. The reverse cycler lets a user jump
  // straight to "exclude" from off without first going through include.
  const cycleAxisState = (axisKey: string, value: string) => {
    setAxisFilters(prev => {
      const cur = prev[axisKey] || { states: {} };
      const states: Record<string, number> = { ...cur.states };
      const s = states[value] || 0;
      const nextState = s === 0 ? 1 : s === 1 ? 2 : 0;
      if (nextState === 0) delete states[value];
      else states[value] = nextState;
      return { ...prev, [axisKey]: { ...cur, states } };
    });
  };
  const cycleAxisStateReverse = (axisKey: string, value: string) => {
    setAxisFilters(prev => {
      const cur = prev[axisKey] || { states: {} };
      const states: Record<string, number> = { ...cur.states };
      const s = states[value] || 0;
      const nextState = s === 0 ? 2 : s === 2 ? 1 : 0;
      if (nextState === 0) delete states[value];
      else states[value] = nextState;
      return { ...prev, [axisKey]: { ...cur, states } };
    });
  };
  const cycleAxisCombineMode = (axisKey: string) => {
    setAxisFilters(prev => {
      const cur = prev[axisKey] || { states: {} };
      const m = (cur.combineMode || 'OR') as 'OR' | 'AND' | 'XOR';
      const next = m === 'OR' ? 'AND' : m === 'AND' ? 'XOR' : 'OR';
      return { ...prev, [axisKey]: { ...cur, combineMode: next } };
    });
  };
  const cycleAxisCombineModeReverse = (axisKey: string) => {
    setAxisFilters(prev => {
      const cur = prev[axisKey] || { states: {} };
      const m = (cur.combineMode || 'OR') as 'OR' | 'AND' | 'XOR';
      const next = m === 'OR' ? 'XOR' : m === 'XOR' ? 'AND' : 'OR';
      return { ...prev, [axisKey]: { ...cur, combineMode: next } };
    });
  };
  const cycleAxisExclusionMode = (axisKey: string) => {
    setAxisFilters(prev => {
      const cur = prev[axisKey] || { states: {} };
      const m = (cur.exclusionMode || 'OR') as 'OR' | 'AND' | 'XOR';
      const next = m === 'OR' ? 'AND' : m === 'AND' ? 'XOR' : 'OR';
      return { ...prev, [axisKey]: { ...cur, exclusionMode: next } };
    });
  };
  const cycleAxisExclusionModeReverse = (axisKey: string) => {
    setAxisFilters(prev => {
      const cur = prev[axisKey] || { states: {} };
      const m = (cur.exclusionMode || 'OR') as 'OR' | 'AND' | 'XOR';
      const next = m === 'OR' ? 'XOR' : m === 'XOR' ? 'AND' : 'OR';
      return { ...prev, [axisKey]: { ...cur, exclusionMode: next } };
    });
  };
  const axisIncludeAll = (axisKey: string, values: readonly string[]) => {
    setAxisFilters(prev => {
      const cur = prev[axisKey] || { states: {} };
      const states: Record<string, number> = { ...cur.states };
      for (const v of values) states[v] = 1;
      return { ...prev, [axisKey]: { ...cur, states } };
    });
  };
  const axisExcludeAll = (axisKey: string, values: readonly string[]) => {
    setAxisFilters(prev => {
      const cur = prev[axisKey] || { states: {} };
      const states: Record<string, number> = { ...cur.states };
      for (const v of values) states[v] = 2;
      return { ...prev, [axisKey]: { ...cur, states } };
    });
  };
  const axisClear = (axisKey: string) => {
    setAxisFilters(prev => {
      const cur = prev[axisKey] || { states: {} };
      return { ...prev, [axisKey]: { ...cur, states: {} } };
    });
  };
  const resetAxisFilters = () => setAxisFilters({});

  const activeFilterCount =
    Object.keys(axisFilters.source?.states ?? {}).length
    + Object.keys(axisFilters.level?.states ?? {}).length
    + Object.keys(axisFilters.school?.states ?? {}).length
    + Object.keys(axisFilters.status?.states ?? {}).length;

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

  // School axis values — derived from candidates so the panel only
  // surfaces schools actually present in the loaded batch. Each value
  // carries the candidate's schoolLabel for display; falls back to
  // the raw school code uppercased.
  const schoolAxisValues = useMemo<ReadonlyArray<{ value: string; label: string }>>(() => {
    const seen = new Map<string, string>();
    for (const candidate of candidates) {
      if (!candidate.school) continue;
      if (!seen.has(candidate.school)) {
        seen.set(candidate.school, candidate.schoolLabel || candidate.school.toUpperCase());
      }
    }
    return Array.from(seen.entries()).map(([value, label]) => ({ value, label }));
  }, [candidates]);

  // Source axis values — built from the loaded Dauligor `sources`
  // table, NOT from the candidate-side label. Filtering by source id
  // lets unresolved candidates (no matchedSourceId) fall out cleanly
  // when a Source include filter is set, and surfaces in the Status
  // axis's "Unresolved Source" pill instead. Mirrors FeatList's
  // source-axis pattern (id as value, abbreviation as label).
  const sourceAxisValues = useMemo<ReadonlyArray<{ value: string; label: string; labelAlt?: string }>>(() => {
    return sources.map(s => ({
      value: s.id,
      label: String(s.abbreviation || s.shortName || s.name || s.id),
      labelAlt: String(s.name || s.shortName || s.abbreviation || s.id),
    }));
  }, [sources]);

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
      // Match-status flag set — surfaced via the Status axis. Each
      // value corresponds to a derived boolean on the candidate; the
      // multi-axis matcher checks set membership.
      const statusFlags = new Set<string>();
      if (!candidate.sourceResolved) statusFlags.add('unresolvedSource');
      if (candidate.importWarnings.length > 0) statusFlags.add('hasWarning');
      return (
        matchesSingleAxisFilter(String(candidate.level), axisFilters.level)
        && matchesSingleAxisFilter(candidate.school, axisFilters.school)
        && matchesSingleAxisFilter(candidate.matchedSourceId || '', axisFilters.source)
        && matchesMultiAxisFilter(statusFlags, axisFilters.status)
        && (selectedFilterTagIds.length === 0 || selectedFilterTagIds.every((tagId) => assignedTagIds.includes(tagId)))
        && (
          !search.trim()
          || candidate.name.toLowerCase().includes(search.trim().toLowerCase())
          || candidate.identifier.toLowerCase().includes(search.trim().toLowerCase())
          || sourceLabel.toLowerCase().includes(search.trim().toLowerCase())
        )
      );
    });
  }, [candidates, candidateTagIds, axisFilters, selectedFilterTagIds, search]);

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

  // Axis descriptors for SectionFilterPanel. Four axes — Source,
  // Level, School, Status — built once per render. Source uses the
  // Dauligor `sources` table so filtering by source id pairs cleanly
  // with the candidate-side `matchedSourceId`. Status surfaces the
  // unresolved-source / has-warning flags so admins can isolate rows
  // that need triage before bulk import.
  const filterAxes = useMemo<FilterSection[]>(() => ([
    {
      key: 'source', name: 'Sources', kind: 'axis',
      values: sourceAxisValues.map(v => ({ ...v })),
    },
    {
      key: 'level', name: 'Level', kind: 'axis',
      values: LEVEL_AXIS_VALUES.map(v => ({ ...v })),
    },
    {
      key: 'school', name: 'School', kind: 'axis',
      values: schoolAxisValues.map(v => ({ ...v })),
    },
    {
      key: 'status', name: 'Match Status', kind: 'axis',
      values: STATUS_AXIS_VALUES.map(v => ({ ...v })),
    },
  ]), [sourceAxisValues, schoolAxisValues]);

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

  // Outer layout: viewport-locked via `h-full flex flex-col` so the
  // compact header pins to the top and the body grid claims the
  // remaining viewport. Without this, the body's `spell-list-fullscreen`
  // class hides the browser scrollbar but the page can't scroll either
  // — the detail pane runs off the bottom edge of the viewport.
  return (
    <div className="h-full flex flex-col">
      <Card className="border-gold/20 bg-card/50 overflow-hidden h-full flex flex-col">
        <CardContent className="p-0 flex-1 flex flex-col min-h-0">
          {/* Compact header — title + actions on one row, inline stat
              pills below. Replaces the previous ~280px hero block to
              give the candidate browser most of the viewport. */}
          <div className="border-b border-gold/10 bg-card px-6 py-3 relative overflow-hidden shrink-0">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(192,160,96,0.14),transparent_52%)] pointer-events-none" aria-hidden />
            <div className="relative flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 text-gold">
                <Wand2 className="h-4 w-4 shrink-0" />
                <h2 className="text-base font-bold uppercase tracking-[0.22em] text-ink">Spell Browser</h2>
              </div>

              <div className="flex flex-wrap items-center gap-2">
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
                  size="sm"
                  className="gap-2 h-8 border-gold/20 bg-background/40 text-ink hover:bg-gold/5"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-3.5 w-3.5" />
                  Load Exports
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="gap-2 h-8 bg-primary hover:bg-primary/90 text-primary-foreground"
                  onClick={handleImportVisible}
                  disabled={saving || !visibleCandidates.some((candidate) => candidate.sourceResolved)}
                >
                  <Download className="h-3.5 w-3.5" />
                  Import Visible
                </Button>
              </div>
            </div>

            <div className="relative mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink/70">
              <InlineStat icon={Layers3} label="loaded" value={batchSummary.totalSpells} />
              <InlineStat icon={AlertTriangle} label="unresolved" value={batchSummary.unresolvedSources} tone="warn" />
              <InlineStat icon={BookOpen} label="existing" value={batchSummary.existingMatches} />
              <InlineStat icon={Sparkles} label="scaling" value={batchSummary.scalingSpells} />
            </div>
          </div>

          {/* Body — FilterBar owns the search + filter button at the
              top; the pill wall (the SectionFilterPanel) lives inside
              FilterBar's modal — clicking Filters pops it open as a
              full-screen overlay. The candidate-list rail below is no
              longer crowded by the filter wall.
              `flex-1 min-h-0 flex flex-col gap-4` gives the grid the
              remaining height so the detail pane can scroll inside. */}
          <div className="p-6 flex-1 min-h-0 flex flex-col gap-4">
            {!uploadedBatches.length ? (
              <div className="rounded-xl border border-dashed border-gold/20 bg-background/30 px-6 py-12 text-center">
                <FileJson className="mx-auto mb-4 h-10 w-10 text-gold/60" />
                <p className="text-lg font-serif italic text-ink/70">No Foundry spell exports loaded yet.</p>
                <p className="mx-auto mt-2 max-w-2xl text-sm text-ink/50">
                  Use the Load Foundry Exports button to begin reviewing available imports.
                </p>
              </div>
            ) : (
              <>
                <FilterBar
                  search={search}
                  setSearch={setSearch}
                  isFilterOpen={filterOpen}
                  setIsFilterOpen={setFilterOpen}
                  activeFilterCount={activeFilterCount}
                  resetFilters={resetAxisFilters}
                  searchPlaceholder="Search spell name, source, or identifier"
                  filterTitle="Spell Import Filters"
                  resetLabel="Reset Filters"
                  renderFilters={
                    <SectionFilterPanel
                      axes={filterAxes}
                      axisFilters={axisFilters}
                      tagStates={{}}
                      cycleAxisState={cycleAxisState}
                      cycleAxisStateReverse={cycleAxisStateReverse}
                      cycleTagState={() => {}}
                      cycleTagStateReverse={() => {}}
                      cycleAxisCombineMode={cycleAxisCombineMode}
                      cycleAxisCombineModeReverse={cycleAxisCombineModeReverse}
                      cycleAxisExclusionMode={cycleAxisExclusionMode}
                      cycleAxisExclusionModeReverse={cycleAxisExclusionModeReverse}
                      axisIncludeAll={axisIncludeAll}
                      axisExcludeAll={axisExcludeAll}
                      axisClear={axisClear}
                      search=""
                      setSearch={() => {}}
                      activeFilterCount={activeFilterCount}
                      resetAll={resetAxisFilters}
                      embedded
                    />
                  }
                />
              {/* Flex master-detail — mirrors TagsExplorer's working
                  pattern. Grid was inconsistent on row sizing; flex
                  + flex-1 + min-h-0 is reliable across browsers. */}
              <div className="flex gap-6 flex-1 min-h-0">
                <div className="w-[360px] shrink-0 flex flex-col gap-4 min-h-0">
                  {tagGroups.length ? (
                    <Card className="border-gold/10 bg-background/20 shrink-0 max-h-[40%] py-0 gap-0">
                      <CardContent className="space-y-4 p-4 overflow-y-auto custom-scrollbar">
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

                  {/* Candidate list — plain `overflow-y-auto` div
                      with `flex-1 min-h-0` so it claims the rest of
                      the rail height after the optional tag picker.
                      Card + CardContent + ScrollArea was an extra
                      layer of opinions that fought the height chain. */}
                  <div className="flex-1 min-h-0 rounded-xl border border-gold/10 bg-background/20 overflow-y-auto custom-scrollbar">
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
                  </div>
                </div>

                {/* Detail column — direct child of the flex container,
                    `flex-1 min-h-0` gives it a defined height; the
                    `overflow-y-auto` engages when content overflows. */}
                <div className="flex-1 min-w-0 min-h-0 overflow-y-auto custom-scrollbar space-y-4 pr-1">
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
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Inline stat pill — icon + bold value + dim label, all on one line.
 * Replaces the older vertical SummaryStat card so the header collapses
 * to a single compact row of metrics instead of a grid of cards.
 *
 * `tone="warn"` swaps the value color to blood so unresolved /
 * warning counts read distinct from the neutral routing counts.
 */
function InlineStat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: any;
  label: string;
  value: number;
  tone?: 'warn';
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <Icon className="h-3 w-3 text-gold/60 shrink-0" />
      <span className={cn(
        'font-bold tabular-nums',
        tone === 'warn' && value > 0 ? 'text-blood' : 'text-ink',
      )}>
        {value}
      </span>
      <span className="text-ink/50 uppercase tracking-widest text-[10px]">{label}</span>
    </span>
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
