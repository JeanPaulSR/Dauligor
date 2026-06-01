/**
 * FeatImportWorkbench — the feat-side mirror of `SpellImportWorkbench`.
 *
 * Loads one or more `dauligor.foundry-feat-folder-export.v1` JSON
 * payloads, renders a 5etools-style two-pane browser (filter rail +
 * candidate list on the left, detail preview on the right), and
 * commits selected feats (or the entire visible batch) to the `feats`
 * D1 table via `upsertFeat` / `upsertFeatBatch`.
 *
 * Intentional parity points with SpellImportWorkbench:
 *   - Same outer Card layout + summary stats row
 *   - Same SourceMatch / Existing Match / Saved badges
 *   - Same per-candidate tag picker + filter rail
 *
 * Intentional divergences:
 *   - Filter axes are Feat Type / Subtype / Source instead of
 *     Level / School / Source. The level + school filters don't
 *     map onto feats — feats have a different category model.
 *   - Tag groups are filtered by `classifications.includes('feat')`
 *     instead of `'spell'`.
 *   - The 4th summary stat is "With Activities" instead of
 *     "Scaling Spells" — for feats, the most useful at-a-glance signal
 *     is how many rows have automated activities attached.
 *   - The header still uses BookOpen / Wand2 / etc., but reads "Foundry
 *     Feat Import" + "Feat Browser" so authors don't confuse the two.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, BookOpen, Download, FileJson, Layers3, Search, Sparkles, Tag, Upload, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { reportClientError, OperationType } from '../../lib/clientError';
import { upsertFeat, upsertFeatBatch } from '../../lib/compendium';
import {
  extractAndPersistScalingColumns,
  scalingOwnerTypeForFeatType,
} from '../../lib/scalingImport';
import { fetchCollection } from '../../lib/d1';
import { cn } from '../../lib/utils';
import {
  buildFeatImportCandidates,
  formatFoundryFeatDescriptionForDisplay,
  FEAT_TYPE_LABELS,
  type FoundryFeatFolderExport,
  type FeatImportCandidate,
} from '../../lib/featImport';
import { matchesSingleAxisFilter, matchesMultiAxisFilter } from '../../lib/spellFilters';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Input } from '../ui/input';
import { FilterBar } from './FilterBar';
import { SectionFilterPanel, type FilterSection } from './SectionFilterPanel';

// Match-status axis values — surfaces the candidate-level mismatch
// flags so admins can isolate rows that need triage before bulk
// import. Each value is checked as set-membership on the candidate's
// derived flag set (see matchesMultiAxisFilter call below).
const STATUS_AXIS_VALUES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'unresolvedSource', label: 'Unresolved Source' },
  { value: 'hasWarning', label: 'Has Warning' },
];

// Sentinel value used by the Subtype axis to surface candidates with
// no subtype set. Kept distinct from any real subtype so the filter
// can address "(none)" explicitly.
const SUBTYPE_NONE = '__none__';

// Local mirror of useSpellFilters' AxisState — kept inline so the
// workbench doesn't need to consume the full filter hook.
type AxisState = {
  states: Record<string, number>;
  combineMode?: 'AND' | 'OR' | 'XOR';
  exclusionMode?: 'AND' | 'OR' | 'XOR';
};

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

// `feats` rows post-fetch, denormalized into the camelCase the workbench
// renders against. Same shape `FeatsEditor` builds in its initial load
// effect — keeping the field names aligned makes the existing-match
// dedupe (`identifier + sourceId`) a single equality check.
type ExistingFeatRow = {
  id: string;
  name?: string;
  identifier?: string;
  sourceId?: string;
  tagIds?: string[];
  createdAt?: string;
  [key: string]: any;
};

type UploadedBatch = {
  id: string;
  fileName: string;
  payload: FoundryFeatFolderExport;
};

function buildDisplayHtml(html: string) {
  return formatFoundryFeatDescriptionForDisplay(html || '');
}

// Per-candidate edit overrides. The detail panel surfaces editable
// inputs for these three fields so authors can fix identifier
// collisions, rename a feat, or correct a wrong source match before
// committing the import. Any field the user leaves blank falls back
// to the candidate's parser-derived value.
type CandidateOverrides = { name?: string; identifier?: string; sourceId?: string };

// Resolve the effective (name, identifier, source_id) for a candidate
// given the current override map, and re-run the existing-entry
// dedup against the EDITED (identifier, sourceId) pair so the upsert
// flips between create / update correctly when the user changes
// either field. Pulled out of the component so handleImportSelected,
// handleImportVisible, and the UI can all read the same projection.
function effectiveCandidateValues(
  candidate: FeatImportCandidate,
  overrides: CandidateOverrides | undefined,
  existingEntries: ExistingFeatRow[],
) {
  const o = overrides || {};
  // Defensive trim+fallback: empty-string overrides fall through to
  // the candidate's parsed values so the importer never tries to
  // write an empty name or identifier.
  const name = String(o.name ?? candidate.name).trim() || candidate.name;
  const identifier = String(o.identifier ?? candidate.identifier).trim() || candidate.identifier;
  const sourceId = String(o.sourceId ?? candidate.matchedSourceId ?? '');
  const existingEntry = existingEntries.find((entry) =>
    String(entry.identifier ?? '') === identifier
    && String(entry.sourceId ?? '') === sourceId,
  );
  return {
    name,
    identifier,
    sourceId,
    existingEntryId: existingEntry?.id || '',
    existingEntryName: existingEntry?.name || '',
    // `sourceResolved` is recomputed off the effective value so the
    // detail-panel "Import" button enables/disables correctly when
    // the user picks an override source that resolves a previously
    // unresolved row.
    sourceResolved: !!sourceId,
  };
}

export default function FeatImportWorkbench({
  userProfile,
  onImportComplete,
}: {
  userProfile: any;
  // Fired after every successful upsert (single or batch). The
  // FeatPickerDialog uses this to refresh its catalog so a freshly-
  // imported feat appears in the picker without a page reload. Existing
  // callers (FeatsEditor) don't pass it — undefined is a no-op.
  onImportComplete?: () => void | Promise<void>;
}) {
  const isAdmin = userProfile?.role === 'admin';
  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [existingEntries, setExistingEntries] = useState<ExistingFeatRow[]>([]);
  const [tagGroups, setTagGroups] = useState<TagGroupRecord[]>([]);
  const [allTags, setAllTags] = useState<TagRecord[]>([]);
  const [uploadedBatches, setUploadedBatches] = useState<UploadedBatch[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState('');
  const [search, setSearch] = useState('');
  // Tri-state axis filters — replaces the single-value Feat Type /
  // Subtype / Source dropdowns. Mirror of useSpellFilters' axisFilters
  // shape so SectionFilterPanel can plug in directly.
  const [axisFilters, setAxisFilters] = useState<Record<string, AxisState>>({});
  // Whether the FilterBar's filter modal is open. The pill wall lives
  // inside the modal so it doesn't crowd the candidate browser rail.
  const [filterOpen, setFilterOpen] = useState(false);
  const [tagSearch, setTagSearch] = useState('');
  const [selectedFilterTagIds, setSelectedFilterTagIds] = useState<string[]>([]);
  const [candidateTagIds, setCandidateTagIds] = useState<Record<string, string[]>>({});
  // Per-candidate edit overrides (name / identifier / source_id).
  // Empty by default — each row falls back to its parser-derived
  // values unless the author types into one of the detail-panel
  // inputs. Persists for the session so editing → switching rows →
  // coming back preserves the edits.
  const [candidateOverrides, setCandidateOverrides] = useState<Record<string, CandidateOverrides>>({});
  const setCandidateOverride = (candidateId: string, field: keyof CandidateOverrides, value: string) => {
    setCandidateOverrides((prev) => ({
      ...prev,
      [candidateId]: { ...(prev[candidateId] || {}), [field]: value },
    }));
  };
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;

    (async () => {
      try {
        const [sourcesData, tagGroupsData, tagsData, featsData] = await Promise.all([
          fetchCollection<any>('sources', { orderBy: 'name ASC' }),
          fetchCollection<any>('tagGroups'),
          fetchCollection<any>('tags', { orderBy: 'name ASC' }),
          fetchCollection<any>('feats', { orderBy: 'name ASC' }),
        ]);
        if (cancelled) return;

        setSources(sourcesData);
        // Feats own their own tag classification key (`feat`), distinct
        // from spells. Filter client-side — there are typically fewer
        // than 20 tag groups, so a server-side filter isn't worth a
        // dedicated endpoint.
        setTagGroups(tagGroupsData.filter((g: any) => Array.isArray(g.classifications) && g.classifications.includes('feat')));
        setAllTags(tagsData);

        // Denormalise the snake_case D1 rows into the camelCase shape
        // the dedupe checks against. Same approach SpellImportWorkbench
        // uses for its mapping (`row.source_id → row.sourceId`).
        const mappedFeats = featsData.map((row: any) => ({
          ...row,
          sourceId: row.source_id,
          imageUrl: row.image_url,
          featType: row.feat_type,
          featSubtype: row.feat_subtype,
          tagIds: Array.isArray(row.tags) ? row.tags : [],
        }));
        setExistingEntries(mappedFeats);
      } catch (error) {
        console.error('FeatImportWorkbench load error:', error);
      }
    })();

    return () => { cancelled = true; };
  }, [isAdmin]);

  const candidates = useMemo(() => (
    uploadedBatches.flatMap((batch) => buildFeatImportCandidates(batch.payload, batch.fileName, sources, existingEntries))
  ), [uploadedBatches, sources, existingEntries]);

  // Axis-state cyclers + bulk controls — mirrors the FeatList /
  // SpellImportWorkbench pattern. Forward + reverse cyclers power
  // SectionFilterPanel's left-click / right-click chip cycling.
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
    + Object.keys(axisFilters.featType?.states ?? {}).length
    + Object.keys(axisFilters.subtype?.states ?? {}).length
    + Object.keys(axisFilters.status?.states ?? {}).length;

  // Seed each new candidate's tag picker with whatever the existing
  // feat row already has (if any). Same effect SpellImportWorkbench
  // runs for parity — admins resume tagging without losing context.
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

  // Axis values — derived from the candidates and the loaded
  // `sources` table. Feat Type uses FEAT_TYPE_LABELS for display;
  // Subtype carries the candidate's featSubtypeLabel when set and a
  // SUBTYPE_NONE sentinel for un-subtyped rows; Source uses Dauligor
  // source ids so filtering pairs cleanly with `matchedSourceId`.
  const featTypeAxisValues = useMemo<ReadonlyArray<{ value: string; label: string }>>(() => {
    const seen = new Map<string, string>();
    for (const candidate of candidates) {
      if (!candidate.featType) continue;
      if (!seen.has(candidate.featType)) {
        seen.set(candidate.featType, FEAT_TYPE_LABELS[candidate.featType] || candidate.featType);
      }
    }
    return Array.from(seen.entries()).map(([value, label]) => ({ value, label }));
  }, [candidates]);

  const subtypeAxisValues = useMemo<ReadonlyArray<{ value: string; label: string }>>(() => {
    const seen = new Map<string, string>();
    let hasEmpty = false;
    for (const candidate of candidates) {
      if (!candidate.featSubtype) {
        hasEmpty = true;
        continue;
      }
      if (!seen.has(candidate.featSubtype)) {
        seen.set(candidate.featSubtype, candidate.featSubtypeLabel || candidate.featSubtype);
      }
    }
    const entries: { value: string; label: string }[] = [];
    if (hasEmpty) entries.push({ value: SUBTYPE_NONE, label: '(No Subtype)' });
    for (const [value, label] of seen) entries.push({ value, label });
    return entries;
  }, [candidates]);

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
      // Subtype value normalized through the SUBTYPE_NONE sentinel so
      // un-subtyped candidates can be filtered explicitly.
      const subtypeValue = candidate.featSubtype || SUBTYPE_NONE;
      // Match-status flag set — surfaced via the Status axis. Each
      // value corresponds to a derived boolean on the candidate.
      const statusFlags = new Set<string>();
      if (!candidate.sourceResolved) statusFlags.add('unresolvedSource');
      if (candidate.importWarnings.length > 0) statusFlags.add('hasWarning');
      return (
        matchesSingleAxisFilter(candidate.featType, axisFilters.featType)
        && matchesSingleAxisFilter(subtypeValue, axisFilters.subtype)
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

  // Effective values for the selected row (= original parsed values
  // overlaid with any per-candidate overrides). Used by every label /
  // input / button check in the detail panel so the rename / re-source
  // edits flow through consistently.
  const selectedEff = selectedCandidate
    ? effectiveCandidateValues(selectedCandidate, candidateOverrides[selectedCandidate.candidateId], existingEntries)
    : null;

  // Resolve the effective source's display label off the sources list
  // when the user picks an override source — the candidate's
  // matchedSourceLabel is stale once overrides apply.
  const selectedEffSourceLabel = (() => {
    if (!selectedEff?.sourceId) return '';
    const src = sources.find((s) => s.id === selectedEff.sourceId);
    return String(src?.abbreviation || src?.shortName || src?.name || src?.id || '');
  })();

  const batchSummary = useMemo(() => {
    return {
      totalFeats: candidates.length,
      unresolvedSources: candidates.filter((candidate) => !candidate.sourceResolved).length,
      existingMatches: candidates.filter((candidate) => candidate.existingEntryId).length,
      withActivities: candidates.filter((candidate) => candidate.hasActivities).length,
    };
  }, [candidates]);

  // Axis descriptors for SectionFilterPanel. Four axes: Source,
  // Feat Type, Subtype, Status. Source uses Dauligor `sources` ids
  // so filtering pairs cleanly with the candidate-side
  // `matchedSourceId`; Status surfaces unresolved + warning rows.
  const filterAxes = useMemo<FilterSection[]>(() => ([
    {
      key: 'source', name: 'Sources', kind: 'axis',
      values: sourceAxisValues.map(v => ({ ...v })),
    },
    {
      key: 'featType', name: 'Feat Type', kind: 'axis',
      values: featTypeAxisValues.map(v => ({ ...v })),
    },
    {
      key: 'subtype', name: 'Subtype', kind: 'axis',
      values: subtypeAxisValues.map(v => ({ ...v })),
    },
    {
      key: 'status', name: 'Match Status', kind: 'axis',
      values: STATUS_AXIS_VALUES.map(v => ({ ...v })),
    },
  ]), [sourceAxisValues, featTypeAxisValues, subtypeAxisValues]);

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
          : [...existing, tagId],
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
        if (payload?.kind !== 'dauligor.foundry-feat-folder-export.v1' || !Array.isArray(payload?.feats)) {
          throw new Error('Expected a dauligor.foundry-feat-folder-export.v1 payload.');
        }

        nextBatches.push({
          id: `${file.name}-${payload.exportedAt || Date.now()}`,
          fileName: file.name,
          payload,
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

    toast.success(`Loaded ${nextBatches.length} Foundry feat export ${nextBatches.length === 1 ? 'file' : 'files'}.`);
  };

  const saveCandidate = async (candidate: FeatImportCandidate) => {
    // Merge in any per-candidate edit overrides (name / identifier /
    // source_id) before building the upsert payload. existingEntryId
    // is re-resolved off the effective (identifier, sourceId) pair
    // so editing either field correctly switches between create and
    // update — matching the (source_id, identifier) composite UNIQUE
    // index the schema now enforces.
    const eff = effectiveCandidateValues(candidate, candidateOverrides[candidate.candidateId], existingEntries);
    const payload = {
      ...candidate.savePayload,
      name: eff.name,
      identifier: eff.identifier,
      source_id: eff.sourceId || null,
      updated_at: new Date().toISOString(),
      created_at: undefined,
    } as Record<string, any>;

    Object.keys(payload).forEach((key) => {
      if (payload[key] === undefined) delete payload[key];
    });

    // Determine the final feat id + parent_type up front so we can
    // persist scaling columns BEFORE the feat upsert. `eff.existingEntryId`
    // identifies an update; otherwise we mint a fresh UUID and pass
    // the same id to both `extractAndPersistScalingColumns` and the
    // final `upsertFeat` call below.
    const featId = eff.existingEntryId || crypto.randomUUID();
    const featTypeForScaling = scalingOwnerTypeForFeatType(payload.feat_type);
    const incomingAdvancements = Array.isArray(payload.advancements)
      ? payload.advancements
      : [];
    let advancementsWithColumnLinks = incomingAdvancements;
    if (featTypeForScaling && incomingAdvancements.length > 0) {
      try {
        const result = await extractAndPersistScalingColumns({
          parentId: featId,
          parentType: featTypeForScaling,
          advancements: incomingAdvancements,
        });
        advancementsWithColumnLinks = result.scaledAdvancements;
      } catch (err) {
        console.error('[FeatImportWorkbench] scaling extraction failed:', err);
        // Fall through with the original advancements — better to
        // commit the feat row than to fail the whole import over a
        // scaling-column write. The author can re-author columns
        // manually in the FeatsEditor sidebar.
      }
    }

    if (eff.existingEntryId) {
      const existingCreatedAt = existingEntries.find((entry) => entry.id === eff.existingEntryId)?.createdAt
        || existingEntries.find((entry) => entry.id === eff.existingEntryId)?.created_at
        || new Date().toISOString();
      const updatedPayload = {
        ...payload,
        advancements: advancementsWithColumnLinks,
        tagIds: candidateTagIds[candidate.candidateId] || [],
        created_at: existingCreatedAt,
      };
      await upsertFeat(featId, updatedPayload);
      return 'updated';
    }

    await upsertFeat(featId, {
      ...payload,
      advancements: advancementsWithColumnLinks,
      tagIds: candidateTagIds[candidate.candidateId] || [],
      created_at: new Date().toISOString(),
    });
    return 'created';
  };

  const handleImportSelected = async () => {
    if (!selectedCandidate) return;
    // Re-check resolution against the effective sourceId — the user
    // may have picked an override source that fixes a previously
    // unresolved row.
    const eff = effectiveCandidateValues(selectedCandidate, candidateOverrides[selectedCandidate.candidateId], existingEntries);
    if (!eff.sourceResolved) {
      toast.error('Resolve the source mapping before importing this feat.');
      return;
    }

    setSaving(true);
    try {
      const action = await saveCandidate(selectedCandidate);
      toast.success(`${selectedCandidate.name} ${action}.`);
      // Notify consumers (e.g. FeatPickerDialog) so they can refresh
      // their local feat catalog without a full page reload.
      if (onImportComplete) await onImportComplete();
    } catch (error) {
      console.error('Error importing feat:', error);
      toast.error(`Failed to import ${selectedCandidate.name}.`);
      reportClientError(
        error,
        selectedCandidate.existingEntryId ? OperationType.UPDATE : OperationType.CREATE,
        `feats/${selectedCandidate.existingEntryId || '(new)'}`,
      );
    } finally {
      setSaving(false);
    }
  };

  const handleImportVisible = async () => {
    // Use the effective sourceResolved (post-overrides) so a row the
    // user just rescued by picking a source no longer gets filtered
    // out of the batch.
    const allRows = visibleCandidates.map((candidate) => ({
      candidate,
      eff: effectiveCandidateValues(candidate, candidateOverrides[candidate.candidateId], existingEntries),
    }));
    const resolved = allRows.filter(({ eff }) => eff.sourceResolved);
    const unresolvedRows = allRows.filter(({ eff }) => !eff.sourceResolved);
    const unresolvedCount = unresolvedRows.length;

    // Per-book histogram of unresolved candidates — surfaces which
    // book labels in the export failed to find a matching `sources`
    // row. After the matcher tightened to exact-only matching, the
    // user needs to either (a) add a source row whose abbreviation
    // matches the book code, or (b) use the per-row source picker
    // to remap each unresolved feat manually.
    const unresolvedByBook: Record<string, number> = {};
    for (const { candidate } of unresolvedRows) {
      const book = candidate.sourceBook || '(no book)';
      unresolvedByBook[book] = (unresolvedByBook[book] ?? 0) + 1;
    }
    if (unresolvedCount > 0) {
      console.warn('Unresolved-source candidates (no matching source row), by book:', unresolvedByBook);
    }

    // ── Intra-batch dedup ─────────────────────────────────────
    // The schema enforces UNIQUE(COALESCE(source_id, ''), identifier)
    // — two rows in the same batch with the same effective
    // (sourceId, identifier) would have BOTH passed the dedup vs.
    // existingEntries check (because existingEntries is the DB
    // snapshot at load time, not the in-flight batch), then BOTH
    // tried to INSERT, and the second one would fail with the new
    // composite UNIQUE.
    //
    // Common causes:
    //   - Multiple homebrew sources ship a "tough" / "athlete" /
    //     "grappler" identifier; user picks the same source override
    //     for several rows; collision.
    //   - Two rows share an identifier because their Foundry
    //     `system.identifier` field is the same string.
    //
    // We keep the FIRST candidate per (sourceId, identifier) and
    // surface the rest in a toast + console table so the author
    // can edit identifier/source/name on the duplicates and re-run.
    const byKey = new Map<string, { candidate: FeatImportCandidate; eff: ReturnType<typeof effectiveCandidateValues> }>();
    const dupSkipped: Array<{ name: string; keptName: string; sourceLabel: string; identifier: string }> = [];
    for (const row of resolved) {
      const key = `${row.eff.sourceId}||${row.eff.identifier}`;
      const existing = byKey.get(key);
      if (existing) {
        // Resolve a human-readable source label for the toast.
        const src = sources.find((s) => s.id === row.eff.sourceId);
        const sourceLabel = String(src?.abbreviation || src?.shortName || src?.name || row.eff.sourceId || '(none)');
        dupSkipped.push({
          name: row.candidate.name,
          keptName: existing.candidate.name,
          sourceLabel,
          identifier: row.eff.identifier,
        });
      } else {
        byKey.set(key, row);
      }
    }
    const importable = [...byKey.values()];

    if (dupSkipped.length) {
      // Loud + actionable warning. The table goes to console too so
      // the author can copy-paste the dropped names back into the
      // filter rail and edit them one by one.
      console.warn('Skipped duplicates within batch (same source + identifier):', dupSkipped);
      const preview = dupSkipped.slice(0, 3).map((d) => `"${d.name}"`).join(', ');
      const suffix = dupSkipped.length > 3 ? ` +${dupSkipped.length - 3} more` : '';
      toast.warning(
        `Skipping ${dupSkipped.length} duplicate ${dupSkipped.length === 1 ? 'feat' : 'feats'} (same source + identifier): ${preview}${suffix}. Edit identifier or source on the duplicates and re-run.`,
        { duration: 8000 },
      );
    }

    if (!importable.length) {
      if (unresolvedCount > 0) {
        // Show top 3 unresolved books so the user knows which to
        // create sources for. Full histogram is already in the
        // console.warn above.
        const topBooks = Object.entries(unresolvedByBook)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([book, n]) => `${book} (${n})`)
          .join(', ');
        const extra = Object.keys(unresolvedByBook).length > 3
          ? ` + ${Object.keys(unresolvedByBook).length - 3} more book(s)`
          : '';
        toast.error(
          `No visible feats are ready to import. ${unresolvedCount} skipped — no matching source row for: ${topBooks}${extra}. Create the missing sources or use the per-row Source Match dropdown.`,
          { duration: 10000 },
        );
      } else {
        toast.error('No visible feats are ready to import.');
      }
      return;
    }

    setSaving(true);
    try {
      // Mint final feat ids upfront so scaling-column rows can FK
      // against them before the batch upsert lands. `upsertFeatBatch`
      // would mint a UUID itself for any entry with id=null, but
      // that's too late for our scaling extraction (which needs the
      // parent_id to write scaling_columns rows with the correct
      // ownership). Doing it here keeps the two writes in the same
      // logical transaction.
      const entries = await Promise.all(importable.map(async ({ candidate, eff }) => {
        const existing = existingEntries.find((entry) => entry.id === eff.existingEntryId);
        const existingCreatedAt = existing?.createdAt || existing?.created_at || new Date().toISOString();
        const featId = eff.existingEntryId || crypto.randomUUID();
        const payload = {
          ...candidate.savePayload,
          name: eff.name,
          identifier: eff.identifier,
          source_id: eff.sourceId || null,
          tagIds: candidateTagIds[candidate.candidateId] || [],
          updated_at: new Date().toISOString(),
          created_at: eff.existingEntryId ? existingCreatedAt : new Date().toISOString(),
        } as Record<string, any>;

        Object.keys(payload).forEach((key) => {
          if (payload[key] === undefined) delete payload[key];
        });

        // Extract scaling columns + patch advancements. Non-class-
        // feature feat_types only (class features inherit columns
        // from their parent class). Failures here are logged but
        // don't block the import — see the single-row commit path
        // for the same try/catch pattern.
        const featTypeForScaling = scalingOwnerTypeForFeatType(payload.feat_type);
        const incomingAdvancements = Array.isArray(payload.advancements)
          ? payload.advancements
          : [];
        if (featTypeForScaling && incomingAdvancements.length > 0) {
          try {
            const result = await extractAndPersistScalingColumns({
              parentId: featId,
              parentType: featTypeForScaling,
              advancements: incomingAdvancements,
            });
            payload.advancements = result.scaledAdvancements;
          } catch (err) {
            console.error('[FeatImportWorkbench] batch scaling extraction failed:', err);
          }
        }

        return {
          id: featId,
          data: payload,
        };
      }));

      await upsertFeatBatch(entries);

      // Create-vs-update count: we mint UUIDs upfront for new feats
      // (so scaling-column FKs can write before the feat row), which
      // means every entry's `id` is non-null here. Derive the count
      // from the original `importable` array, where `eff.existingEntryId`
      // is still the authoritative create/update signal.
      const createdCount = importable.filter(({ eff }) => !eff.existingEntryId).length;
      const updatedCount = importable.filter(({ eff }) => !!eff.existingEntryId).length;

      // Compose a success message that also accounts for skipped
      // rows (unresolved source + intra-batch duplicates) so the
      // author has a complete picture of what landed vs. what
      // needs follow-up edits.
      const successParts = [
        `Imported ${entries.length} ${entries.length === 1 ? 'feat' : 'feats'} (${createdCount} new, ${updatedCount} updated)`,
      ];
      if (unresolvedCount > 0) successParts.push(`${unresolvedCount} skipped (no source match)`);
      if (dupSkipped.length > 0) successParts.push(`${dupSkipped.length} skipped (in-batch duplicate)`);
      toast.success(successParts.join(' · ') + '.');
      if (onImportComplete) await onImportComplete();
    } catch (error) {
      console.error('Error importing visible feats:', error);
      toast.error('Failed to import visible feats.');
      reportClientError(error, OperationType.CREATE, 'feats/(batch import)');
    } finally {
      setSaving(false);
    }
  };

  if (!isAdmin) return null;

  // Outer layout: viewport-locked via `h-full flex flex-col` so the
  // compact header pins at the top and the body grid claims the
  // remaining viewport.
  return (
    <div className="h-full flex flex-col">
      <Card className="border-gold/20 bg-card/50 overflow-hidden h-full flex flex-col">
        <CardContent className="p-0 flex-1 flex flex-col min-h-0">
          {/* Compact header — title + actions on row 1, inline stat
              pills on row 2. Collapses the previous ~280px hero block
              to ≈80px so the candidate browser gets the viewport. */}
          <div className="border-b border-gold/10 bg-card px-6 py-3 relative overflow-hidden shrink-0">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(192,160,96,0.14),transparent_52%)] pointer-events-none" aria-hidden />
            <div className="relative flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 text-gold">
                <Wand2 className="h-4 w-4 shrink-0" />
                <h2 className="text-base font-bold uppercase tracking-[0.22em] text-ink">Feat Browser</h2>
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
              <InlineStat icon={Layers3} label="loaded" value={batchSummary.totalFeats} />
              <InlineStat icon={AlertTriangle} label="unresolved" value={batchSummary.unresolvedSources} tone="warn" />
              <InlineStat icon={BookOpen} label="existing" value={batchSummary.existingMatches} />
              <InlineStat icon={Sparkles} label="with activities" value={batchSummary.withActivities} />
            </div>
          </div>

          {/* Body — FilterBar owns the search + filter button at the
              top; the pill wall lives inside FilterBar's modal so the
              candidate browser rail below isn't crowded.
              `flex-1 min-h-0 flex flex-col gap-4` gives the grid the
              remaining height so the detail pane can scroll inside. */}
          <div className="p-6 flex-1 min-h-0 flex flex-col gap-4">
            {!uploadedBatches.length ? (
              <div className="rounded-xl border border-dashed border-gold/20 bg-background/30 px-6 py-12 text-center">
                <FileJson className="mx-auto mb-4 h-10 w-10 text-gold/60" />
                <p className="text-lg font-serif italic text-ink/70">No Foundry feat exports loaded yet.</p>
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
                  searchPlaceholder="Search feat name, source, or identifier"
                  filterTitle="Feat Import Filters"
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
                      <CardContent className="space-y-4 p-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-gold/70">
                            <Tag className="h-3.5 w-3.5" />
                            Feat Tags
                          </div>
                          <p className="text-[11px] text-ink/45">Filter the feat list by your Dauligor feat tags.</p>
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
                                      {candidate.featTypeLabel}
                                      {candidate.featSubtypeLabel ? ` · ${candidate.featSubtypeLabel}` : ''}
                                    </div>
                                  </div>
                                  <span className="text-[10px] font-mono text-ink/35">{sourceLabel}</span>
                                </div>

                                <div className="mt-2 flex flex-wrap gap-2">
                                  {candidate.existingEntryId ? <Badge className="bg-sky-500/15 text-sky-200 border-sky-400/20">Saved</Badge> : null}
                                  {unresolved ? <Badge className="bg-blood/20 text-blood border-blood/30">Unresolved Source</Badge> : null}
                                  {candidate.repeatable ? <Badge className="bg-gold/15 text-gold border-gold/20">Repeatable</Badge> : null}
                                  {candidate.hasPrereqs ? <Badge className="bg-amber-500/15 text-amber-200 border-amber-400/20">Prereqs</Badge> : null}
                                  {candidate.hasUses ? <Badge className="bg-cyan-500/15 text-cyan-200 border-cyan-400/20">Uses</Badge> : null}
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
                                  <span>{candidate.activationLabel || '—'}</span>
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
                    <Card className="border-gold/10 bg-background/25 overflow-hidden">
                      <CardContent className="p-0">
                        <div className="border-b border-gold/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),transparent)] px-6 py-5">
                          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                            <div className="space-y-2 flex-1 min-w-0">
                              <div className="flex items-center gap-3">
                                {/* Editable name. Styled to look like the
                                    original h3 so the visual weight of the
                                    detail panel header doesn't change — the
                                    border-bottom only shows on focus. */}
                                <input
                                  type="text"
                                  value={selectedEff?.name ?? selectedCandidate.name}
                                  onChange={(e) => setCandidateOverride(selectedCandidate.candidateId, 'name', e.target.value)}
                                  className="font-serif text-4xl font-bold text-ink bg-transparent border-0 border-b border-transparent outline-none focus:border-gold/40 focus:bg-background/40 px-1 -mx-1 flex-1 min-w-0"
                                  spellCheck={false}
                                />
                                {selectedEffSourceLabel ? (
                                  <Badge className="border-gold/20 bg-gold/10 text-gold">{selectedEffSourceLabel}</Badge>
                                ) : null}
                                {selectedCandidate.sourcePage ? (
                                  <span className="text-xs uppercase tracking-widest text-ink/40">p{selectedCandidate.sourcePage}</span>
                                ) : null}
                              </div>
                              <p className="font-serif italic text-ink/70">
                                {selectedCandidate.featTypeLabel}
                                {selectedCandidate.featSubtypeLabel ? ` · ${selectedCandidate.featSubtypeLabel}` : ''}
                              </p>
                            </div>

                            <div className="flex flex-wrap gap-2">
                              <Button
                                type="button"
                                className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground"
                                onClick={handleImportSelected}
                                disabled={saving || !(selectedEff?.sourceResolved)}
                              >
                                <Download className="h-4 w-4" />
                                {selectedEff?.existingEntryId ? 'Update Feat' : 'Import Feat'}
                              </Button>
                            </div>
                          </div>
                        </div>

                        <div className="border-b border-gold/10 px-6 py-5">
                          <div className="grid gap-6 lg:grid-cols-[126px_minmax(0,1fr)]">
                            <FeatArtPreview
                              src={selectedCandidate.imageUrl}
                              alt={selectedCandidate.name}
                              size={126}
                            />
                            <div className="grid gap-y-3 text-sm text-ink md:grid-cols-2 md:gap-x-8">
                              <FeatRow label="Activation" value={selectedCandidate.activationLabel} />
                              <FeatRow label="Uses" value={selectedCandidate.usesLabel} />
                              <FeatRow label="Requirements" value={selectedCandidate.requirements} />
                              <FeatRow label="Type" value={selectedCandidate.featTypeLabel} />
                              <FeatRow label="Subtype" value={selectedCandidate.featSubtypeLabel || '—'} />
                              <FeatRow label="Repeatable" value={selectedCandidate.repeatable ? 'Yes' : 'No'} />
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
                                    Feat Tags
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
                              {/* Editable identifier. Edits feed into
                                  candidateOverrides; effectiveCandidateValues
                                  re-resolves the existing-entry match so
                                  the row flips between create / update
                                  as you type. */}
                              <EditableInfoBlock
                                title="Identifier"
                                value={selectedEff?.identifier ?? selectedCandidate.identifier}
                                onChange={(value) => setCandidateOverride(selectedCandidate.candidateId, 'identifier', value)}
                                hint="Slug must be unique within its source. Two sources can share an identifier."
                              />
                              {/* Editable source picker. Defaults to the
                                  parser's matched source. Selecting a
                                  different source can rescue rows the
                                  Foundry book/page lookup couldn't
                                  resolve. */}
                              <EditableSourceBlock
                                title="Source Match"
                                value={selectedEff?.sourceId ?? selectedCandidate.matchedSourceId}
                                sources={sources}
                                onChange={(value) => setCandidateOverride(selectedCandidate.candidateId, 'sourceId', value)}
                              />
                              <InfoBlock title="Activities" value={String(selectedCandidate.activities.length)} />
                              <InfoBlock title="Effects" value={String(selectedCandidate.effects.length)} />
                              {selectedEff?.existingEntryId ? (
                                <InfoBlock title="Existing Draft" value={selectedEff.existingEntryName || selectedEff.existingEntryId} />
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ) : (
                    <Card className="border-gold/10 bg-background/25">
                      <CardContent className="px-6 py-12 text-center text-ink/50">
                        Select a feat from the left to inspect and import it.
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

// ─── Local atoms (mirror SpellImportWorkbench's primitives) ────────

/**
 * Inline stat pill — icon + bold value + dim label, all on one line.
 * Replaces the older vertical SummaryStat card.
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

function FeatRow({ label, value }: { label: string; value: string }) {
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

/**
 * Editable variant of InfoBlock. Same visual frame, but renders a
 * full-width text input under the label so authors can override the
 * field's value (identifier, name, etc.) before commit. Optional
 * `hint` line shows in a smaller dim font under the input.
 */
function EditableInfoBlock({
  title,
  value,
  onChange,
  hint,
}: {
  title: string;
  value: string;
  onChange: (next: string) => void;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-gold/10 bg-background/30 px-4 py-3">
      <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-gold/70">{title}</div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-2 w-full bg-transparent border border-gold/15 rounded px-2 py-1 text-sm text-ink/90 outline-none focus:border-gold/40 focus:bg-background/40"
        spellCheck={false}
      />
      {hint ? <div className="mt-1.5 text-[10px] text-ink/40 italic">{hint}</div> : null}
    </div>
  );
}

/**
 * Editable source picker. Renders a native `<select>` so authors can
 * override the parser's source match — useful when the Foundry
 * `system.source.book` field is empty or points at a homebrew label
 * the source library doesn't have a row for yet.
 *
 * Empty value (`""`) means "no source" / unresolved. The select
 * shows it as "— Unresolved —" so it's visible at a glance.
 */
function EditableSourceBlock({
  title,
  value,
  sources,
  onChange,
}: {
  title: string;
  value: string;
  sources: SourceRecord[];
  onChange: (next: string) => void;
}) {
  return (
    <div className="rounded-lg border border-gold/10 bg-background/30 px-4 py-3">
      <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-gold/70">{title}</div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-2 w-full bg-background/40 border border-gold/15 rounded px-2 py-1 text-sm text-ink/90 outline-none focus:border-gold/40"
      >
        <option value="">— Unresolved —</option>
        {sources.map((s) => (
          <option key={s.id} value={s.id}>
            {s.abbreviation || s.shortName || s.name || s.id}
            {s.name && (s.abbreviation || s.shortName) ? ` · ${s.name}` : ''}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Tiny inlined art preview — feats don't have the elaborate
 * `SpellArtPreview` component (with overlays / fallback art). Keep it
 * simple: a fixed-size rounded thumb that falls back to a gold dashed
 * border + the feat's first initial when the image fails to load.
 */
function FeatArtPreview({ src, alt, size }: { src: string; alt: string; size: number }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [src]);

  if (!src || failed) {
    return (
      <div
        className="flex items-center justify-center rounded-xl border-2 border-dashed border-gold/30 bg-background/20 text-3xl font-serif text-gold/40"
        style={{ width: size, height: size }}
      >
        {alt?.[0]?.toUpperCase() || '?'}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      onError={() => setFailed(true)}
      className="rounded-xl border border-gold/15 bg-background/30 object-cover"
      style={{ width: size, height: size }}
    />
  );
}
