import React, { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { FilterBar, AxisFilterSection, TagGroupFilter } from './FilterBar';
import { cn } from '../../lib/utils';
import { SCHOOL_LABELS } from '../../lib/spellImport';
import {
  ACTIVATION_LABELS,
  ACTIVATION_ORDER,
  DURATION_LABELS,
  DURATION_ORDER,
  PROPERTY_LABELS,
  PROPERTY_ORDER,
  RANGE_LABELS,
  RANGE_ORDER,
  SHAPE_LABELS,
  SHAPE_ORDER,
} from '../../lib/spellFilters';
import type { UseSpellFiltersResult } from '../../hooks/useSpellFilters';

const LEVEL_VALUES = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

export type SpellFilterShellProps = {
  filters: UseSpellFiltersResult;
  /** Source records — for the Source filter section + chip labels. */
  sources: { id: string; name?: string; abbreviation?: string; shortName?: string }[];
  /** Tag records — for the per-group tag filter sections + chip labels. */
  tags: { id: string; name: string; groupId: string | null; parentTagId?: string | null }[];
  /** Tag group records — for grouping the tag filter sections. */
  tagGroups: { id: string; name: string }[];
  /** Optional extra controls rendered next to the search/filter row (e.g., per-page toggles). */
  extraControls?: React.ReactNode;
  /** Optional extra chips rendered in the active-filter strip (e.g., manager's "On list only"). */
  extraChips?: React.ReactNode;
  /** Whether to render the active-filter chip strip. Default true. */
  showActiveChips?: boolean;
  /** Search placeholder. */
  searchPlaceholder?: string;
};

/**
 * Reusable filter shell for spell-browsing surfaces. Renders the FilterBar
 * modal with every axis (Source / Spell Level / Spell School / Casting Time
 * / Range / Shape / Duration / Properties) as a rich `<AxisFilterSection>`
 * — 3-state include/exclude chips + per-section AND/OR/XOR combinator +
 * Exclusion Logic toggle. Tag groups live in a collapsible Advanced
 * Options disclosure at the bottom. Same vocabulary as
 * /compendium/spells and /compendium/spell-rules so authors don't learn
 * a different control set when they swap between surfaces.
 *
 * Pages provide their own filter-state via the `useSpellFilters` hook
 * and add page-specific controls / chips through the `extraControls` /
 * `extraChips` slots.
 */
export default function SpellFilterShell({
  filters,
  sources,
  tags,
  tagGroups,
  extraControls,
  extraChips,
  showActiveChips = true,
  searchPlaceholder = 'Search spells by name or tag...',
}: SpellFilterShellProps) {
  const [filterOpen, setFilterOpen] = useState(false);

  const tagsById = useMemo(
    () => Object.fromEntries(tags.map(t => [t.id, t])) as Record<string, { id: string; name: string; groupId: string | null; parentTagId?: string | null }>,
    [tags],
  );
  const sourceById = useMemo(
    () => Object.fromEntries(sources.map(s => [s.id, s])) as Record<string, { id: string; name?: string; abbreviation?: string; shortName?: string }>,
    [sources],
  );
  const tagsByGroup = useMemo(() => {
    const map: Record<string, typeof tags> = {};
    for (const tag of tags) {
      if (!tag.groupId) continue;
      (map[tag.groupId] = map[tag.groupId] || []).push(tag);
    }
    return map;
  }, [tags]);

  // Helpers to derive include-only arrays from the rich axisFilters
  // state — used by the active-filter chip strip below to render the
  // currently-active includes as removable chips.
  const includesFor = (axisKey: string): string[] =>
    Object.entries(filters.axisFilters[axisKey]?.states ?? {})
      .filter(([, s]) => s === 1)
      .map(([v]) => v);

  const trimmed = filters.search.trim();
  const showChips = showActiveChips && (filters.activeFilterCount > 0 || trimmed || extraChips);

  return (
    <div className="bg-background border border-gold/20 rounded-md p-4 space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-[280px]">
          <FilterBar
            search={filters.search}
            setSearch={filters.setSearch}
            isFilterOpen={filterOpen}
            setIsFilterOpen={setFilterOpen}
            activeFilterCount={filters.activeFilterCount}
            resetFilters={filters.resetAll}
            searchPlaceholder={searchPlaceholder}
            filterTitle="Spell Filters"
            renderFilters={
              <>
                <AxisFilterSection
                  title="Source"
                  values={sources.map(s => ({ value: s.id, label: String(s.abbreviation || s.shortName || s.name || s.id) }))}
                  states={filters.axisFilters.source?.states || {}}
                  cycleState={(v) => filters.cycleAxisState('source', v)}
                  combineMode={filters.axisFilters.source?.combineMode}
                  cycleCombineMode={() => filters.cycleAxisCombineMode('source')}
                  exclusionMode={filters.axisFilters.source?.exclusionMode}
                  cycleExclusionMode={() => filters.cycleAxisExclusionMode('source')}
                  includeAll={() => filters.axisIncludeAll('source', sources.map(s => s.id))}
                  clearAll={() => filters.axisClear('source')}
                />
                <AxisFilterSection
                  title="Spell Level"
                  values={LEVEL_VALUES.map(lvl => ({ value: lvl, label: lvl === '0' ? 'Cantrip' : `Level ${lvl}` }))}
                  states={filters.axisFilters.level?.states || {}}
                  cycleState={(v) => filters.cycleAxisState('level', v)}
                  combineMode={filters.axisFilters.level?.combineMode}
                  cycleCombineMode={() => filters.cycleAxisCombineMode('level')}
                  exclusionMode={filters.axisFilters.level?.exclusionMode}
                  cycleExclusionMode={() => filters.cycleAxisExclusionMode('level')}
                  includeAll={() => filters.axisIncludeAll('level', LEVEL_VALUES)}
                  clearAll={() => filters.axisClear('level')}
                />
                <AxisFilterSection
                  title="Spell School"
                  values={Object.entries(SCHOOL_LABELS).map(([k, label]) => ({ value: k, label }))}
                  states={filters.axisFilters.school?.states || {}}
                  cycleState={(v) => filters.cycleAxisState('school', v)}
                  combineMode={filters.axisFilters.school?.combineMode}
                  cycleCombineMode={() => filters.cycleAxisCombineMode('school')}
                  exclusionMode={filters.axisFilters.school?.exclusionMode}
                  cycleExclusionMode={() => filters.cycleAxisExclusionMode('school')}
                  includeAll={() => filters.axisIncludeAll('school', Object.keys(SCHOOL_LABELS))}
                  clearAll={() => filters.axisClear('school')}
                />
                <AxisFilterSection
                  title="Casting Time"
                  values={ACTIVATION_ORDER.map(b => ({ value: b, label: ACTIVATION_LABELS[b] }))}
                  states={filters.axisFilters.activation?.states || {}}
                  cycleState={(v) => filters.cycleAxisState('activation', v)}
                  combineMode={filters.axisFilters.activation?.combineMode}
                  cycleCombineMode={() => filters.cycleAxisCombineMode('activation')}
                  exclusionMode={filters.axisFilters.activation?.exclusionMode}
                  cycleExclusionMode={() => filters.cycleAxisExclusionMode('activation')}
                  includeAll={() => filters.axisIncludeAll('activation', ACTIVATION_ORDER as readonly string[])}
                  clearAll={() => filters.axisClear('activation')}
                />
                <AxisFilterSection
                  title="Range"
                  values={RANGE_ORDER.map(b => ({ value: b, label: RANGE_LABELS[b] }))}
                  states={filters.axisFilters.range?.states || {}}
                  cycleState={(v) => filters.cycleAxisState('range', v)}
                  combineMode={filters.axisFilters.range?.combineMode}
                  cycleCombineMode={() => filters.cycleAxisCombineMode('range')}
                  exclusionMode={filters.axisFilters.range?.exclusionMode}
                  cycleExclusionMode={() => filters.cycleAxisExclusionMode('range')}
                  includeAll={() => filters.axisIncludeAll('range', RANGE_ORDER as readonly string[])}
                  clearAll={() => filters.axisClear('range')}
                />
                <AxisFilterSection
                  title="Shape"
                  values={SHAPE_ORDER.map(b => ({ value: b, label: SHAPE_LABELS[b] }))}
                  states={filters.axisFilters.shape?.states || {}}
                  cycleState={(v) => filters.cycleAxisState('shape', v)}
                  combineMode={filters.axisFilters.shape?.combineMode}
                  cycleCombineMode={() => filters.cycleAxisCombineMode('shape')}
                  exclusionMode={filters.axisFilters.shape?.exclusionMode}
                  cycleExclusionMode={() => filters.cycleAxisExclusionMode('shape')}
                  includeAll={() => filters.axisIncludeAll('shape', SHAPE_ORDER as readonly string[])}
                  clearAll={() => filters.axisClear('shape')}
                />
                <AxisFilterSection
                  title="Duration"
                  values={DURATION_ORDER.map(b => ({ value: b, label: DURATION_LABELS[b] }))}
                  states={filters.axisFilters.duration?.states || {}}
                  cycleState={(v) => filters.cycleAxisState('duration', v)}
                  combineMode={filters.axisFilters.duration?.combineMode}
                  cycleCombineMode={() => filters.cycleAxisCombineMode('duration')}
                  exclusionMode={filters.axisFilters.duration?.exclusionMode}
                  cycleExclusionMode={() => filters.cycleAxisExclusionMode('duration')}
                  includeAll={() => filters.axisIncludeAll('duration', DURATION_ORDER as readonly string[])}
                  clearAll={() => filters.axisClear('duration')}
                />
                <AxisFilterSection
                  title="Properties"
                  values={PROPERTY_ORDER.map(p => ({ value: p, label: PROPERTY_LABELS[p] }))}
                  states={filters.axisFilters.property?.states || {}}
                  cycleState={(v) => filters.cycleAxisState('property', v)}
                  combineMode={filters.axisFilters.property?.combineMode}
                  cycleCombineMode={() => filters.cycleAxisCombineMode('property')}
                  exclusionMode={filters.axisFilters.property?.exclusionMode}
                  cycleExclusionMode={() => filters.cycleAxisExclusionMode('property')}
                  includeAll={() => filters.axisIncludeAll('property', PROPERTY_ORDER as readonly string[])}
                  clearAll={() => filters.axisClear('property')}
                />

                {/* Tags — collapsed by default. Same Advanced Options
                    pattern as /compendium/spells. */}
                <details className="group">
                  <summary className="cursor-pointer list-none flex items-center justify-between border border-gold/15 rounded-md px-4 py-2 hover:border-gold/30 transition-colors">
                    <span className="text-xs font-bold uppercase tracking-[0.2em] text-gold/80">
                      Advanced Options — Tags
                      {Object.keys(filters.tagStates).length > 0 && (
                        <span className="ml-2 text-gold/60">({Object.keys(filters.tagStates).length} selected)</span>
                      )}
                    </span>
                    <span className="text-[10px] text-ink/40 group-open:rotate-90 transition-transform">▶</span>
                  </summary>
                  <div className="mt-4 space-y-6 pl-1">
                    {tagGroups.map(group => (
                      <TagGroupFilter
                        key={group.id}
                        group={group}
                        tags={(tagsByGroup[group.id] || []) as any}
                        tagStates={filters.tagStates}
                        setTagStates={filters.setTagStates}
                        cycleTagState={filters.cycleTagState}
                        combineMode={filters.groupCombineModes[group.id]}
                        cycleGroupMode={filters.cycleGroupMode}
                        exclusionMode={filters.groupExclusionModes[group.id]}
                        cycleExclusionMode={filters.cycleExclusionMode}
                      />
                    ))}
                  </div>
                </details>
              </>
            }
          />
        </div>
        {extraControls}
      </div>

      {showChips ? (
        <div className="flex items-center gap-2 flex-wrap">
          {trimmed ? (
            <FilterChip label={<>Search: "{trimmed}"</>} onRemove={() => filters.setSearch('')} />
          ) : null}
          {extraChips}
          {includesFor('source').map(id => {
            const s = sourceById[id];
            const label = s?.abbreviation || s?.shortName || s?.name || id;
            return <FilterChip key={`src-${id}`} label={`Source: ${label}`} onRemove={() => filters.removeAxisValue('source', id)} />;
          })}
          {includesFor('level').slice().sort((a, b) => Number(a) - Number(b)).map(lvl => (
            <FilterChip key={`lvl-${lvl}`} label={lvl === '0' ? 'Cantrip' : `Level ${lvl}`} onRemove={() => filters.removeAxisValue('level', lvl)} />
          ))}
          {includesFor('school').map(k => (
            <FilterChip key={`sch-${k}`} label={SCHOOL_LABELS[k] || k} onRemove={() => filters.removeAxisValue('school', k)} />
          ))}
          {Object.entries(filters.tagStates).filter(([, s]) => s === 1).map(([id]) => {
            const t = tagsById[id];
            return (
              <FilterChip
                key={`tag-${id}`}
                label={`Tag: ${t?.name || id}`}
                onRemove={() => filters.setTagStates(prev => { const next = { ...prev }; delete next[id]; return next; })}
              />
            );
          })}
          {includesFor('activation').map(b => (
            <FilterChip key={`act-${b}`} label={`Cast: ${ACTIVATION_LABELS[b as keyof typeof ACTIVATION_LABELS] || b}`} onRemove={() => filters.removeAxisValue('activation', b)} />
          ))}
          {includesFor('range').map(b => (
            <FilterChip key={`rng-${b}`} label={`Range: ${RANGE_LABELS[b as keyof typeof RANGE_LABELS] || b}`} onRemove={() => filters.removeAxisValue('range', b)} />
          ))}
          {includesFor('duration').map(b => (
            <FilterChip key={`dur-${b}`} label={`Dur: ${DURATION_LABELS[b as keyof typeof DURATION_LABELS] || b}`} onRemove={() => filters.removeAxisValue('duration', b)} />
          ))}
          {includesFor('shape').map(b => (
            <FilterChip key={`shp-${b}`} label={`Shape: ${SHAPE_LABELS[b as keyof typeof SHAPE_LABELS] || b}`} onRemove={() => filters.removeAxisValue('shape', b)} />
          ))}
          {includesFor('property').map(p => (
            <FilterChip key={`prop-${p}`} label={PROPERTY_LABELS[p as keyof typeof PROPERTY_LABELS] || p} onRemove={() => filters.removeAxisValue('property', p)} />
          ))}
          {(filters.activeFilterCount > 0 || trimmed) ? (
            <button
              type="button"
              onClick={() => { filters.resetAll(); filters.setSearch(''); }}
              className="ml-1 text-[10px] uppercase tracking-widest text-ink/45 hover:text-gold"
            >
              Reset all
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function FilterChip({ label, onRemove }: { label: React.ReactNode; onRemove: () => void }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded-full border border-gold/30 bg-gold/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-gold/90'
    )}>
      {label}
      <button
        type="button"
        aria-label="Remove"
        onClick={onRemove}
        className="ml-0.5 -mr-0.5 rounded-full hover:bg-gold/20 p-0.5 transition-colors"
      >
        <X className="w-2.5 h-2.5" />
      </button>
    </span>
  );
}
