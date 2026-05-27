/**
 * ItemImportWorkbench — multi-target item-side mirror of
 * `FeatImportWorkbench` / `SpellImportWorkbench`. The single biggest
 * structural difference: items split across **4 Dauligor tables** via
 * routing logic in `itemImport.ts`. Each candidate row carries its
 * `targetTable` ('items' / 'weapons' / 'armor' / 'tools') and a
 * pre-built `savePayload` for that target.
 *
 * Imports use `upsertItemBatch` for the items-routed rows and
 * `upsertDocumentBatch` directly for the weapons/armor/tools-routed
 * rows. Each table's batch fires independently so a failure in one
 * doesn't block the others.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, BookOpen, Download, FileJson, Layers3, Shield, Sparkles, Sword, Upload, Wand2, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { reportClientError, OperationType } from '../../lib/firebase';
import { upsertItemBatch } from '../../lib/compendium';
import { extractAndPersistScalingColumns } from '../../lib/scalingImport';
import { fetchCollection } from '../../lib/d1';
import { cn } from '../../lib/utils';
import {
  buildItemImportCandidates,
  formatFoundryItemDescriptionForDisplay,
  type FoundryItemFolderExport,
  type ItemImportCandidate,
  type ItemTargetTable,
} from '../../lib/itemImport';
import { matchesSingleAxisFilter, matchesMultiAxisFilter } from '../../lib/spellFilters';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
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

type AbilityRecord = {
  id: string;
  name?: string;
  identifier?: string;
  [key: string]: any;
};

type UploadedBatch = {
  id: string;
  fileName: string;
  payload: FoundryItemFolderExport;
};

// Axis-value sets for SectionFilterPanel. No 'all' sentinels — the
// tri-state pill UX treats "no filter set" as the default; the user
// includes the values they want or excludes the ones they don't.
const FOUNDRY_TYPE_AXIS_VALUES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'weapon',      label: 'Weapon' },
  { value: 'equipment',   label: 'Equipment' },
  { value: 'consumable',  label: 'Consumable' },
  { value: 'tool',        label: 'Tool' },
  { value: 'loot',        label: 'Loot' },
  { value: 'container',   label: 'Container' },
  { value: 'backpack',    label: 'Backpack (legacy)' },
];

const RARITY_AXIS_VALUES: ReadonlyArray<{ value: string; label: string }> = [
  // The Foundry `none` rarity collapses to "common" in spec language
  // but is a distinct authored value, so keep it explicit.
  { value: 'none',      label: 'Common (none)' },
  { value: 'common',    label: 'Common' },
  { value: 'uncommon',  label: 'Uncommon' },
  { value: 'rare',      label: 'Rare' },
  { value: 'veryRare',  label: 'Very Rare' },
  { value: 'legendary', label: 'Legendary' },
  { value: 'artifact',  label: 'Artifact' },
];

// Match-status axis — surfaces candidate-level mismatch flags so
// admins can isolate rows that need triage before bulk import.
const STATUS_AXIS_VALUES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'unresolvedSource', label: 'Unresolved Source' },
  { value: 'hasWarning', label: 'Has Warning' },
];

// Local mirror of useSpellFilters' AxisState — kept inline so the
// workbench doesn't need to consume the full filter hook.
type AxisState = {
  states: Record<string, number>;
  combineMode?: 'AND' | 'OR' | 'XOR';
  exclusionMode?: 'AND' | 'OR' | 'XOR';
};

const TARGET_ICONS: Record<ItemTargetTable, React.ComponentType<any>> = {
  items: Layers3,
  weapons: Sword,
  armor: Shield,
  tools: Wrench,
};

const TARGET_BADGE_COLORS: Record<ItemTargetTable, string> = {
  items: 'bg-ink/15 text-ink/80 border-ink/20',
  weapons: 'bg-blood/15 text-blood border-blood/30',
  armor: 'bg-sky-500/15 text-sky-200 border-sky-400/30',
  tools: 'bg-amber-500/15 text-amber-200 border-amber-400/30',
};

function buildDisplayHtml(html: string) {
  return formatFoundryItemDescriptionForDisplay(html || '');
}

export default function ItemImportWorkbench({ userProfile }: { userProfile: any }) {
  const isAdmin = userProfile?.role === 'admin';
  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [abilities, setAbilities] = useState<AbilityRecord[]>([]);
  // Existing items rows for dedupe by (identifier, source_id). Single
  // table now — all imports land here. The weapons / armor / tools
  // arrays below are PROFICIENCY DEFINITIONS (managed by
  // AdminProficiencies), used by the importer's base-item FK resolver
  // — NOT a dedupe target.
  const [existingItems, setExistingItems] = useState<any[]>([]);
  const [weaponProficiencies, setWeaponProficiencies] = useState<any[]>([]);
  const [armorProficiencies, setArmorProficiencies] = useState<any[]>([]);
  const [toolProficiencies, setToolProficiencies] = useState<any[]>([]);

  const [uploadedBatches, setUploadedBatches] = useState<UploadedBatch[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState('');
  const [search, setSearch] = useState('');
  // Tri-state axis filters — replaces the single-value Target / Foundry
  // Type / Rarity / Source dropdowns. Same shape useSpellFilters'
  // axisFilters and FeatList consume so SectionFilterPanel can plug
  // in directly.
  const [axisFilters, setAxisFilters] = useState<Record<string, AxisState>>({});
  // Whether the FilterBar's filter modal is open. The pill wall lives
  // inside the modal so it doesn't push the candidate browser off the
  // rail. Same affordance pattern FeatList / SpellList consume.
  const [filterOpen, setFilterOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;

    (async () => {
      // Use Promise.allSettled so one failed table (e.g. an empty
      // `tools` table on a fresh world) doesn't block the others
      // from loading. The previous Promise.all approach silently
      // dropped sources whenever ANY query failed — which is how the
      // source-matcher kept returning null for every row.
      //
      // Abilities live in the `attributes` table (see d1Tables.ts
      // mapping — there's no `abilities` collection alias; tools and
      // weapons reference attributes via `ability_id` FK).
      const settled = await Promise.allSettled([
        fetchCollection<any>('sources', { orderBy: 'name ASC' }),
        fetchCollection<any>('attributes'),
        fetchCollection<any>('items'),
        fetchCollection<any>('weapons'),
        fetchCollection<any>('armor'),
        fetchCollection<any>('tools'),
      ]);
      if (cancelled) return;

      const [sourcesRes, abilitiesRes, itemsRes, weaponsRes, armorRes, toolsRes] = settled;
      const pickOrEmpty = <T,>(r: PromiseSettledResult<T[]>, label: string): T[] => {
        if (r.status === 'fulfilled') return r.value;
        console.error(`[ItemImportWorkbench] failed to load ${label}:`, r.reason);
        return [];
      };
      setSources(pickOrEmpty(sourcesRes, 'sources'));
      setAbilities(pickOrEmpty(abilitiesRes, 'attributes'));
      setExistingItems(pickOrEmpty(itemsRes, 'items'));
      // weapons / armor / tools are loaded as PROFICIENCY definitions
      // (the catalogue managed at /admin/proficiencies). The importer
      // matches Foundry's `system.type.baseItem` slug against the
      // `identifier` column on each to resolve the items.base_*_id FK.
      setWeaponProficiencies(pickOrEmpty(weaponsRes, 'weapons'));
      setArmorProficiencies(pickOrEmpty(armorRes, 'armor'));
      setToolProficiencies(pickOrEmpty(toolsRes, 'tools'));
    })();

    return () => { cancelled = true; };
  }, [isAdmin]);

  const candidates = useMemo<ItemImportCandidate[]>(() => (
    uploadedBatches.flatMap((batch) =>
      buildItemImportCandidates(batch.payload, batch.fileName, sources, abilities, existingItems, {
        weapons: weaponProficiencies,
        armor: armorProficiencies,
        tools: toolProficiencies,
      })
    )
  ), [uploadedBatches, sources, abilities, existingItems, weaponProficiencies, armorProficiencies, toolProficiencies]);

  // Source axis values — built from the loaded Dauligor `sources`
  // table so filtering pairs cleanly with the candidate-side
  // `matchedSourceId`. Unresolved candidates fall out of any source
  // include filter and surface via the Match Status axis instead.
  const sourceAxisValues = useMemo<ReadonlyArray<{ value: string; label: string; labelAlt?: string }>>(() => {
    return sources.map(s => ({
      value: s.id,
      label: String(s.abbreviation || s.shortName || s.name || s.id),
      labelAlt: String(s.name || s.shortName || s.abbreviation || s.id),
    }));
  }, [sources]);

  // Axis-state cyclers + bulk controls — mirrors the FeatList /
  // SpellImportWorkbench / FeatImportWorkbench pattern.
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
    Object.keys(axisFilters.foundryType?.states ?? {}).length
    + Object.keys(axisFilters.rarity?.states ?? {}).length
    + Object.keys(axisFilters.source?.states ?? {}).length
    + Object.keys(axisFilters.status?.states ?? {}).length;

  // Axis descriptors for SectionFilterPanel. Target Table dropped —
  // every item now writes to the items table, so filtering by target
  // would be a no-op. Foundry Type stays since `item_type` is what
  // discriminates shape inside the unified items table.
  const filterAxes = useMemo<FilterSection[]>(() => ([
    {
      key: 'foundryType', name: 'Foundry Type', kind: 'axis',
      values: FOUNDRY_TYPE_AXIS_VALUES.map(v => ({ ...v })),
    },
    {
      key: 'rarity', name: 'Rarity', kind: 'axis',
      values: RARITY_AXIS_VALUES.map(v => ({ ...v })),
    },
    {
      key: 'source', name: 'Sources', kind: 'axis',
      values: sourceAxisValues.map(v => ({ ...v })),
    },
    {
      key: 'status', name: 'Match Status', kind: 'axis',
      values: STATUS_AXIS_VALUES.map(v => ({ ...v })),
    },
  ]), [sourceAxisValues]);

  const visibleCandidates = useMemo(() => {
    const term = search.trim().toLowerCase();
    return candidates.filter((c) => {
      const sourceLabel = c.matchedSourceLabel || c.sourceBook;
      // Match-status flag set — surfaced via the Status axis. Each
      // value corresponds to a derived boolean on the candidate.
      const statusFlags = new Set<string>();
      if (!c.sourceResolved) statusFlags.add('unresolvedSource');
      if (c.importWarnings.length > 0) statusFlags.add('hasWarning');
      return (
        matchesSingleAxisFilter(c.foundryType, axisFilters.foundryType)
        && matchesSingleAxisFilter(c.rarity || 'none', axisFilters.rarity)
        && matchesSingleAxisFilter(c.matchedSourceId || '', axisFilters.source)
        && matchesMultiAxisFilter(statusFlags, axisFilters.status)
        && (
          !term
          || c.name.toLowerCase().includes(term)
          || c.identifier.toLowerCase().includes(term)
          || sourceLabel.toLowerCase().includes(term)
        )
      );
    });
  }, [candidates, axisFilters, search]);

  useEffect(() => {
    if (!visibleCandidates.length) {
      setSelectedCandidateId('');
      return;
    }
    if (!selectedCandidateId || !visibleCandidates.some((c) => c.candidateId === selectedCandidateId)) {
      setSelectedCandidateId(visibleCandidates[0].candidateId);
    }
  }, [visibleCandidates, selectedCandidateId]);

  const selectedCandidate = visibleCandidates.find((c) => c.candidateId === selectedCandidateId)
    || candidates.find((c) => c.candidateId === selectedCandidateId)
    || null;

  const batchSummary = useMemo(() => {
    // `byShape` is purely informational — every candidate writes to the
    // items table. The buckets help admins gauge what they're about to
    // import (e.g. "850 weapons + 200 consumables").
    const byShape: Record<ItemTargetTable, number> = { items: 0, weapons: 0, armor: 0, tools: 0 };
    let unresolvedSources = 0;
    let existingMatches = 0;
    let magical = 0;
    for (const c of candidates) {
      byShape[c.targetTable]++;
      if (!c.sourceResolved) unresolvedSources++;
      if (c.existingEntryId) existingMatches++;
      if (c.magical) magical++;
    }
    return { total: candidates.length, byShape, unresolvedSources, existingMatches, magical };
  }, [candidates]);

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList?.length) return;
    const nextBatches: UploadedBatch[] = [];
    for (const file of Array.from(fileList)) {
      try {
        const raw = await file.text();
        const payload = JSON.parse(raw);
        if (payload?.kind !== 'dauligor.foundry-item-folder-export.v1' || !Array.isArray(payload?.items)) {
          throw new Error('Expected a dauligor.foundry-item-folder-export.v1 payload.');
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

    toast.success(`Loaded ${nextBatches.length} Foundry item export ${nextBatches.length === 1 ? 'file' : 'files'}.`);
  };

  const handleImportVisible = async () => {
    const importable = visibleCandidates.filter((c) => c.sourceResolved);
    if (!importable.length) {
      toast.error('No visible items have resolved sources — fix the source mapping first.');
      return;
    }

    setSaving(true);
    try {
      // Single-target architecture: every candidate writes to the items
      // table. The save payload already covers weapon / armor / tool
      // shape columns + the polymorphic base_*_id FKs.
      //
      // Phase B.3 (items): item id is minted upfront so we can persist
      // ScaleValue advancements (carried on `sourceDocument.system.advancement`
      // per the folder-export contract) as `scaling_columns` rows
      // owned by the imported item BEFORE the item upsert lands.
      // The items table itself doesn't store advancements (no column);
      // their scale data lives in `scaling_columns` and authors edit it
      // through ItemsEditor's Scaling tab.
      const now = new Date().toISOString();
      const entries = await Promise.all(importable.map(async (candidate) => {
        const existingRow = candidate.existingEntryId
          ? existingItems.find((r: any) => r.id === candidate.existingEntryId)
          : null;
        const createdAt = existingRow?.createdAt || existingRow?.created_at || now;
        const itemId = candidate.existingEntryId || crypto.randomUUID();
        const payload: Record<string, any> = {
          ...candidate.savePayload,
          updated_at: now,
          created_at: candidate.existingEntryId ? createdAt : now,
        };
        Object.keys(payload).forEach((key) => {
          if (payload[key] === undefined) delete payload[key];
        });

        // Pull advancements off the Foundry `sourceDocument` and
        // run them through the shared extractor. Foundry stores
        // `system.advancement` as a `{ <_id>: Advancement }` keyed
        // map; the extractor only cares about the ScaleValue
        // entries. Failures here are caught + logged so the item
        // upsert still proceeds.
        const rawAdvancement = candidate.sourceDocument?.system?.advancement;
        const incomingAdvancements = Array.isArray(rawAdvancement)
          ? rawAdvancement
          : rawAdvancement && typeof rawAdvancement === 'object'
            ? Object.values(rawAdvancement)
            : [];
        if (incomingAdvancements.length > 0) {
          try {
            await extractAndPersistScalingColumns({
              parentId: itemId,
              parentType: 'item',
              advancements: incomingAdvancements,
            });
          } catch (err) {
            console.error('[ItemImportWorkbench] batch scaling extraction failed:', err);
          }
        }

        return { id: itemId, data: payload };
      }));

      try {
        await upsertItemBatch(entries);
        // Create-vs-update count: every entry has a non-null `id`
        // after the upfront mint, so derive from the original
        // `importable` array via `existingEntryId`.
        const created = importable.filter((c) => !c.existingEntryId).length;
        const updated = importable.filter((c) => !!c.existingEntryId).length;
        toast.success(`Imported ${entries.length} items (${created} new, ${updated} updated).`);
      } catch (err) {
        console.error('Error importing items:', err);
        reportClientError(err, OperationType.CREATE, 'items/(batch import)');
        toast.error('Failed to import items.');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleImportSelected = async () => {
    if (!selectedCandidate) return;
    if (!selectedCandidate.sourceResolved) {
      toast.error('Resolve the source mapping before importing this item.');
      return;
    }

    setSaving(true);
    try {
      const now = new Date().toISOString();
      const existingRow = selectedCandidate.existingEntryId
        ? existingItems.find((r: any) => r.id === selectedCandidate.existingEntryId)
        : null;
      const createdAt = existingRow?.createdAt || existingRow?.created_at || now;
      const itemId = selectedCandidate.existingEntryId || crypto.randomUUID();
      const payload: Record<string, any> = {
        ...selectedCandidate.savePayload,
        updated_at: now,
        created_at: selectedCandidate.existingEntryId ? createdAt : now,
      };
      Object.keys(payload).forEach((key) => {
        if (payload[key] === undefined) delete payload[key];
      });

      // Same scaling-column extraction as the batch path above.
      // Pulls ScaleValue entries off `sourceDocument.system.advancement`
      // and persists them as `scaling_columns` rows owned by the
      // imported item. See `src/lib/scalingImport.ts` for the helper.
      const rawAdvancement = selectedCandidate.sourceDocument?.system?.advancement;
      const incomingAdvancements = Array.isArray(rawAdvancement)
        ? rawAdvancement
        : rawAdvancement && typeof rawAdvancement === 'object'
          ? Object.values(rawAdvancement)
          : [];
      if (incomingAdvancements.length > 0) {
        try {
          await extractAndPersistScalingColumns({
            parentId: itemId,
            parentType: 'item',
            advancements: incomingAdvancements,
          });
        } catch (err) {
          console.error('[ItemImportWorkbench] scaling extraction failed:', err);
        }
      }

      const entries = [{ id: itemId, data: payload }];
      await upsertItemBatch(entries);

      toast.success(`${selectedCandidate.name} ${selectedCandidate.existingEntryId ? 'updated' : 'imported'}.`);
    } catch (error) {
      console.error('Error importing item:', error);
      toast.error(`Failed to import ${selectedCandidate.name}.`);
      reportClientError(
        error,
        selectedCandidate.existingEntryId ? OperationType.UPDATE : OperationType.CREATE,
        `items/${selectedCandidate.existingEntryId || '(new)'}`,
      );
    } finally {
      setSaving(false);
    }
  };

  if (!isAdmin) return null;

  // Outer layout strategy: the workbench is locked to the viewport via
  // `h-full flex flex-col`, with the header fixed at the top and the
  // body grid (filter rail + detail pane) claiming the rest. Each
  // column has its own internal scroll so the list and detail panes
  // are independently scrollable — fixes the "detail content runs off
  // the page" problem when items have tall type-specific previews
  // (weapon damage, armor stats, etc.).
  return (
    <div className="h-full flex flex-col">
      <Card className="border-gold/20 bg-card/50 overflow-hidden h-full flex flex-col">
        <CardContent className="p-0 flex-1 flex flex-col min-h-0">
          {/* Compact header — title + actions on row 1, inline stat
              pills on row 2. Previous version used a 3-line title
              block + two grids of vertical SummaryStat cards (≈280px
              tall); this version collapses to ≈80px so the
              candidate/detail panes get most of the viewport. */}
          <div className="border-b border-gold/10 bg-card px-6 py-3 relative overflow-hidden shrink-0">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(192,160,96,0.14),transparent_52%)] pointer-events-none" aria-hidden />
            <div className="relative flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 text-gold">
                <Wand2 className="h-4 w-4 shrink-0" />
                <h2 className="text-base font-bold uppercase tracking-[0.22em] text-ink">Item Browser</h2>
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
                  disabled={saving || !visibleCandidates.some((c) => c.sourceResolved)}
                >
                  <Download className="h-3.5 w-3.5" />
                  Import Visible
                </Button>
              </div>
            </div>

            {/* Inline stat pills — 8 metrics on a single wrap-row.
                Each pill is icon + value + label so the row reads as
                a quick numeric summary without claiming a full grid
                of cards. */}
            <div className="relative mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink/70">
              <InlineStat icon={Layers3} label="loaded"      value={batchSummary.total} />
              <InlineStat icon={Sword}   label="weapons"  value={batchSummary.byShape.weapons} />
              <InlineStat icon={Shield}  label="armor"    value={batchSummary.byShape.armor} />
              <InlineStat icon={Wrench}  label="tools"    value={batchSummary.byShape.tools} />
              <InlineStat icon={Layers3} label="other"    value={batchSummary.byShape.items} />
              <InlineStat icon={AlertTriangle} label="unresolved" value={batchSummary.unresolvedSources} tone="warn" />
              <InlineStat icon={BookOpen} label="existing"  value={batchSummary.existingMatches} />
              <InlineStat icon={Sparkles} label="magical"   value={batchSummary.magical} />
            </div>
          </div>

          {/* Body — fills the remaining height. A full-width FilterBar
              owns the search + filter button on its own row, then the
              grid below claims the rest of the column for the
              candidate list + detail pane. The pill wall (the
              SectionFilterPanel that used to crowd the rail) now lives
              inside FilterBar's modal — clicking Filters pops it open
              as a full-screen overlay. */}
          <div className="p-6 flex-1 min-h-0 flex flex-col gap-4">
            {!uploadedBatches.length ? (
              <div className="rounded-xl border border-dashed border-gold/20 bg-background/30 px-6 py-12 text-center">
                <FileJson className="mx-auto mb-4 h-10 w-10 text-gold/60" />
                <p className="text-lg font-serif italic text-ink/70">No Foundry item exports loaded yet.</p>
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
                  searchPlaceholder="Search item name, source, or identifier"
                  filterTitle="Item Import Filters"
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
              {/* Flex master-detail — same pattern TagsExplorer
                  consumes. With grid + grid-rows the row sizing was
                  inconsistent across browsers; flex + flex-1 + min-h-0
                  is reliable. Each column owns its own internal
                  scroll via `overflow-y-auto` on a direct child
                  that has a defined height via the flex chain. */}
              <div className="flex gap-6 flex-1 min-h-0">
                {/* Candidate list rail — fixed 360px width, flex-col
                    so its inner Card claims the full column height. */}
                <div className="w-[360px] shrink-0 flex flex-col min-h-0">
                  <div className="flex-1 min-h-0 rounded-xl border border-gold/10 bg-background/20 overflow-y-auto custom-scrollbar">
                        <div className="space-y-2 p-3">
                          {visibleCandidates.map((candidate) => {
                            const TargetIcon = TARGET_ICONS[candidate.targetTable];
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
                                  <div className="flex-1 min-w-0">
                                    <div className="font-serif text-lg text-ink truncate">{candidate.name}</div>
                                    <div className="text-[10px] uppercase tracking-[0.2em] text-gold/70">
                                      {candidate.foundryType}
                                      {candidate.foundryCategory ? ` · ${candidate.foundryCategory}` : ''}
                                    </div>
                                  </div>
                                  <span className="text-[10px] font-mono text-ink/35 shrink-0">{sourceLabel}</span>
                                </div>

                                <div className="mt-2 flex flex-wrap gap-2">
                                  <Badge className={cn('gap-1 border', TARGET_BADGE_COLORS[candidate.targetTable])}>
                                    <TargetIcon className="h-3 w-3" />
                                    → {candidate.targetTableLabel}
                                  </Badge>
                                  {candidate.existingEntryId ? <Badge className="bg-sky-500/15 text-sky-200 border-sky-400/20">Saved</Badge> : null}
                                  {unresolved ? <Badge className="bg-blood/20 text-blood border-blood/30">Unresolved Source</Badge> : null}
                                  {candidate.magical ? <Badge className="bg-gold/15 text-gold border-gold/20">Magical</Badge> : null}
                                  {candidate.rarity !== 'none' && candidate.rarity !== '' ? (
                                    <Badge className="bg-violet-500/15 text-violet-200 border-violet-400/20">{candidate.rarityLabel}</Badge>
                                  ) : null}
                                  {candidate.attunement ? (
                                    <Badge className="bg-blood/15 text-blood/80 border-blood/20">Attune ({candidate.attunementLabel})</Badge>
                                  ) : null}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                  </div>
                </div>

                {/* Detail column — own scroll. Direct child of the
                    flex container with `flex-1 min-h-0` gives it a
                    defined height; `overflow-y-auto` then engages
                    when content overflows. */}
                <div className="flex-1 min-w-0 min-h-0 overflow-y-auto custom-scrollbar space-y-4 pr-1">
                  {selectedCandidate ? (
                    <DetailPane
                      candidate={selectedCandidate}
                      onImport={handleImportSelected}
                      saving={saving}
                    />
                  ) : (
                    <Card className="border-gold/10 bg-background/25">
                      <CardContent className="px-6 py-12 text-center text-ink/50">
                        Select an item from the left to inspect and import it.
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

// ─── Sub-components ────────────────────────────────────────────────

function DetailPane({
  candidate,
  onImport,
  saving,
}: {
  candidate: ItemImportCandidate;
  onImport: () => void;
  saving: boolean;
}) {
  const TargetIcon = TARGET_ICONS[candidate.targetTable];
  return (
    <Card className="border-gold/10 bg-background/25 overflow-hidden">
      <CardContent className="p-0">
        <div className="border-b border-gold/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),transparent)] px-6 py-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-3 flex-wrap">
                <h3 className="font-serif text-4xl font-bold text-ink">{candidate.name}</h3>
                <Badge className={cn('gap-1 border', TARGET_BADGE_COLORS[candidate.targetTable])}>
                  <TargetIcon className="h-3 w-3" />
                  → {candidate.targetTableLabel}
                </Badge>
                {candidate.matchedSourceLabel ? (
                  <Badge className="border-gold/20 bg-gold/10 text-gold">{candidate.matchedSourceLabel}</Badge>
                ) : null}
                {candidate.sourcePage ? (
                  <span className="text-xs uppercase tracking-widest text-ink/40">p{candidate.sourcePage}</span>
                ) : null}
              </div>
              <p className="font-serif italic text-ink/70">
                {candidate.foundryType}
                {candidate.foundryCategory ? ` · ${candidate.foundryCategory}` : ''}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground"
                onClick={onImport}
                disabled={saving || !candidate.sourceResolved}
              >
                <Download className="h-4 w-4" />
                {candidate.existingEntryId
                  ? `Update ${candidate.targetTableLabel.slice(0, -1)}`
                  : `Import ${candidate.targetTableLabel.slice(0, -1)}`}
              </Button>
            </div>
          </div>
        </div>

        <div className="border-b border-gold/10 px-6 py-5">
          <div className="grid gap-y-3 text-sm text-ink md:grid-cols-2 md:gap-x-8">
            <DetailRow label="Rarity" value={candidate.rarityLabel} />
            <DetailRow label="Quantity" value={String(candidate.quantity)} />
            <DetailRow
              label="Weight"
              value={`${candidate.weight}${candidate.weight ? ' lb' : ''}`}
            />
            <DetailRow
              label="Price"
              value={candidate.price.value ? `${candidate.price.value} ${candidate.price.denomination}` : '—'}
            />
            <DetailRow label="Attunement" value={candidate.attunementLabel} />
            <DetailRow label="Magical" value={candidate.magical ? 'Yes' : 'No'} />
          </div>
          {candidate.properties.length ? (
            <div className="mt-3">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-gold/70">Foundry Properties</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {candidate.properties.map((p) => (
                  <Badge key={p} className="border-gold/15 bg-background/40 text-ink/60">{p}</Badge>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {/* Type-specific preview blocks. */}
        {candidate.weaponPreview ? <WeaponPreview preview={candidate.weaponPreview} /> : null}
        {candidate.armorPreview ? <ArmorPreview preview={candidate.armorPreview} /> : null}
        {candidate.toolPreview ? <ToolPreview preview={candidate.toolPreview} /> : null}
        {candidate.consumablePreview ? <ConsumablePreview preview={candidate.consumablePreview} /> : null}
        {candidate.containerPreview ? <ContainerPreview preview={candidate.containerPreview} /> : null}

        <div className="space-y-4 px-6 py-5">
          {candidate.importWarnings.length ? (
            <div className="rounded-lg border border-blood/30 bg-blood/10 p-4 text-sm text-blood">
              <div className="mb-2 flex items-center gap-2 font-bold uppercase tracking-widest">
                <AlertTriangle className="h-4 w-4" />
                Import Warnings
              </div>
              <ul className="space-y-1 list-disc pl-5">
                {candidate.importWarnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
            <div className="space-y-3">
              <div
                className="prose prose-invert max-w-none prose-p:text-ink/90 prose-strong:text-ink prose-em:text-ink/80 prose-li:text-ink/85 prose-headings:text-ink"
                dangerouslySetInnerHTML={{ __html: buildDisplayHtml(candidate.descriptionHtml) || '<p>No description.</p>' }}
              />
            </div>
            <div className="space-y-3">
              <InfoBlock title="Batch File" value={candidate.batchLabel} />
              <InfoBlock title="Identifier" value={candidate.identifier} />
              <InfoBlock title="Foundry Type" value={`${candidate.foundryType}${candidate.foundryCategory ? ` · ${candidate.foundryCategory}` : ''}`} />
              <InfoBlock
                title="Source Match"
                value={candidate.sourceResolved ? (candidate.matchedSourceLabel || candidate.matchedSourceId) : 'Unresolved'}
              />
              <InfoBlock title="Activities" value={String(candidate.activities.length)} />
              <InfoBlock title="Effects" value={String(candidate.effects.length)} />
              {candidate.existingEntryId ? (
                <InfoBlock title="Existing Row" value={candidate.existingEntryName || candidate.existingEntryId} />
              ) : null}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function WeaponPreview({ preview }: { preview: NonNullable<ItemImportCandidate['weaponPreview']> }) {
  const base = preview.damageBase ?? {};
  const damageLine = base.number && base.denomination
    ? `${base.number}d${base.denomination}${base.bonus ? ` + ${base.bonus}` : ''}${base.types?.length ? ` ${base.types.join('/')}` : ''}`
    : '—';
  const range = preview.range ?? {};
  const rangeLine = range.value ? `${range.value}/${range.long ?? '—'} ${range.units || 'ft'}` : `Reach ${range.reach ?? 5} ft`;
  return (
    <div className="border-b border-gold/10 px-6 py-5">
      <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-gold/70 mb-2">Weapon Stats</div>
      <div className="grid gap-y-2 text-sm text-ink md:grid-cols-2 md:gap-x-8">
        <DetailRow label="Damage" value={damageLine} />
        <DetailRow label="Range" value={rangeLine} />
        <DetailRow label="Mastery" value={preview.mastery || '—'} />
        <DetailRow label="Magic Bonus" value={String(preview.magicalBonus ?? 0)} />
      </div>
    </div>
  );
}

function ArmorPreview({ preview }: { preview: NonNullable<ItemImportCandidate['armorPreview']> }) {
  return (
    <div className="border-b border-gold/10 px-6 py-5">
      <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-gold/70 mb-2">Armor Stats</div>
      <div className="grid gap-y-2 text-sm text-ink md:grid-cols-2 md:gap-x-8">
        <DetailRow label="Armor Type" value={preview.armorType || '—'} />
        <DetailRow label="AC Value" value={preview.armorValue === null || preview.armorValue === undefined ? '—' : String(preview.armorValue)} />
        <DetailRow label="Dex Cap" value={preview.armorDex === null || preview.armorDex === undefined ? 'No cap' : String(preview.armorDex)} />
        <DetailRow label="Magic Bonus" value={String(preview.magicalBonus ?? 0)} />
        <DetailRow label="STR Req" value={preview.strength === null || preview.strength === undefined ? 'None' : String(preview.strength)} />
        <DetailRow label="Stealth" value={preview.stealth ? 'Disadvantage' : '—'} />
      </div>
    </div>
  );
}

function ToolPreview({ preview }: { preview: NonNullable<ItemImportCandidate['toolPreview']> }) {
  return (
    <div className="border-b border-gold/10 px-6 py-5">
      <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-gold/70 mb-2">Tool Stats</div>
      <div className="grid gap-y-2 text-sm text-ink md:grid-cols-2 md:gap-x-8">
        <DetailRow label="Ability" value={preview.ability || '—'} />
        <DetailRow label="Bonus" value={preview.bonus || '—'} />
      </div>
    </div>
  );
}

function ConsumablePreview({ preview }: { preview: NonNullable<ItemImportCandidate['consumablePreview']> }) {
  return (
    <div className="border-b border-gold/10 px-6 py-5">
      <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-gold/70 mb-2">Consumable Stats</div>
      <div className="grid gap-y-2 text-sm text-ink md:grid-cols-2 md:gap-x-8">
        <DetailRow label="Type" value={preview.consumableType || '—'} />
        <DetailRow label="Destroy on Empty" value={preview.destroyOnEmpty ? 'Yes' : 'No'} />
      </div>
    </div>
  );
}

function ContainerPreview({ preview }: { preview: NonNullable<ItemImportCandidate['containerPreview']> }) {
  const cap = preview.capacity ?? {};
  // dnd5e v5 stores capacity as `{ weight: {value, units}, volume: {units} }`.
  // Some older items use the flat `{ type, value }` shape.
  const weightCap = cap.weight ? `${cap.weight.value ?? '—'} ${cap.weight.units || 'lb'}` : null;
  const volumeCap = cap.volume?.units ? `volume (${cap.volume.units})` : null;
  const legacyCap = cap.type && cap.value !== undefined ? `${cap.value} ${cap.type}` : null;
  return (
    <div className="border-b border-gold/10 px-6 py-5">
      <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-gold/70 mb-2">Container Stats</div>
      <div className="grid gap-y-2 text-sm text-ink md:grid-cols-2 md:gap-x-8">
        <DetailRow label="Weight Capacity" value={weightCap || legacyCap || '—'} />
        <DetailRow label="Volume Capacity" value={volumeCap || '—'} />
      </div>
    </div>
  );
}

/**
 * Inline stat pill — icon + bold value + dim label, all on one line.
 * Replaces the old vertical SummaryStat card so 8 metrics fit on a
 * single header row instead of two grids of 5/3 cards each.
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

function DetailRow({ label, value }: { label: string; value: string }) {
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
