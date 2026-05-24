import React, { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { FilterBar } from './FilterBar';
import { MiniPillFilterPanel, type MiniPillAxis } from './MiniPillFilterPanel';
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

  // Axis descriptors for MiniPillFilterPanel. Same eight base axes
  // SpellList ships with, plus one row per tag group. Subtags get
  // their parentValue wired so the panel's chevron drawer treats
  // them as hierarchical children of the parent tag.
  const miniPillAxes = useMemo<MiniPillAxis[]>(() => {
    const axes: MiniPillAxis[] = [
      {
        key: 'source', name: 'Sources', kind: 'axis', hasDefault: true,
        values: sources.map(s => ({
          value: s.id,
          label: String(s.abbreviation || s.shortName || s.name || s.id),
          labelAlt: String(s.name || s.shortName || s.abbreviation || s.id),
        })),
      },
      {
        key: 'level', name: 'Spell Level', kind: 'axis',
        values: LEVEL_VALUES.map(lvl => ({ value: lvl, label: lvl === '0' ? 'Cantrip' : `Level ${lvl}` })),
      },
      {
        key: 'school', name: 'School', kind: 'axis',
        values: Object.entries(SCHOOL_LABELS).map(([k, label]) => ({ value: k, label })),
      },
      {
        key: 'activation', name: 'Casting Time', kind: 'axis',
        values: ACTIVATION_ORDER.map(b => ({ value: b, label: ACTIVATION_LABELS[b] })),
      },
      {
        key: 'range', name: 'Range', kind: 'axis',
        values: RANGE_ORDER.map(b => ({ value: b, label: RANGE_LABELS[b] })),
      },
      {
        key: 'duration', name: 'Duration', kind: 'axis',
        values: DURATION_ORDER.map(b => ({ value: b, label: DURATION_LABELS[b] })),
      },
      {
        key: 'shape', name: 'Shape', kind: 'axis',
        values: SHAPE_ORDER.map(b => ({ value: b, label: SHAPE_LABELS[b] })),
      },
      {
        key: 'property', name: 'Properties', kind: 'axis',
        values: PROPERTY_ORDER.map(p => ({ value: p, label: PROPERTY_LABELS[p] })),
      },
    ];
    for (const group of tagGroups) {
      const groupTags = tagsByGroup[group.id] || [];
      if (groupTags.length === 0) continue;
      const idSet = new Set(groupTags.map(t => t.id));
      axes.push({
        key: `tag-group:${group.id}`,
        name: group.name,
        kind: 'tag',
        groupId: group.id,
        values: groupTags.map(t => {
          const parent = t.parentTagId ?? null;
          return {
            value: t.id,
            label: t.name,
            parentValue: parent && idSet.has(parent) ? parent : undefined,
          };
        }),
      });
    }
    return axes;
  }, [sources, tagGroups, tagsByGroup]);

  // Per-axis "default" handler — sources defaults to "all included"
  // (matches SpellList's onboarding behaviour); every other axis's
  // default is identical to clear, so we just delegate.
  const handleAxisRestoreDefault = (axisKey: string) => {
    if (axisKey === 'source') {
      filters.axisIncludeAll('source', sources.map(s => s.id));
    } else {
      filters.axisClear(axisKey);
    }
  };

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
              // Mini-Pill Wall — same dense pill layout as
              // /compendium/spells. `embedded` skips the panel's
              // own search/header chrome since FilterBar's toolbar
              // already owns those.
              <MiniPillFilterPanel
                axes={miniPillAxes}
                axisFilters={filters.axisFilters}
                tagStates={filters.tagStates}
                cycleAxisState={filters.cycleAxisState}
                cycleAxisStateReverse={filters.cycleAxisStateReverse}
                cycleTagState={filters.cycleTagState}
                cycleTagStateReverse={filters.cycleTagStateReverse}
                cycleAxisCombineMode={filters.cycleAxisCombineMode}
                cycleAxisCombineModeReverse={filters.cycleAxisCombineModeReverse}
                cycleAxisExclusionMode={filters.cycleAxisExclusionMode}
                cycleAxisExclusionModeReverse={filters.cycleAxisExclusionModeReverse}
                axisIncludeAll={filters.axisIncludeAll}
                axisExcludeAll={filters.axisExcludeAll}
                axisClear={filters.axisClear}
                axisRestoreDefault={handleAxisRestoreDefault}
                cycleGroupMode={filters.cycleGroupMode}
                cycleGroupModeReverse={filters.cycleGroupModeReverse}
                cycleExclusionMode={filters.cycleExclusionMode}
                cycleExclusionModeReverse={filters.cycleExclusionModeReverse}
                groupCombineModes={filters.groupCombineModes}
                groupExclusionModes={filters.groupExclusionModes}
                setTagStates={filters.setTagStates}
                search={filters.search}
                setSearch={filters.setSearch}
                activeFilterCount={filters.activeFilterCount}
                resetAll={filters.resetAll}
                embedded
              />
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
