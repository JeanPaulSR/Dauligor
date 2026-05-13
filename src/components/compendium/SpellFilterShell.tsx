import React, { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { FilterBar } from './FilterBar';
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
  type ActivationBucket,
  type DurationBucket,
  type PropertyFilter,
  type RangeBucket,
  type ShapeBucket,
} from '../../lib/spellFilters';
import type { UseSpellFiltersResult } from '../../hooks/useSpellFilters';

const LEVEL_VALUES = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

export type SpellFilterShellProps = {
  filters: UseSpellFiltersResult;
  /** Source records — for the Source filter section + chip labels. */
  sources: { id: string; name?: string; abbreviation?: string; shortName?: string }[];
  /** Tag records — for the per-group tag filter sections + chip labels. */
  tags: { id: string; name: string; groupId: string | null }[];
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
 * Reusable filter shell for spell-browsing surfaces. Renders the FilterBar modal
 * (with all eight standard filter sections) plus an optional active-filter chip
 * strip below. Pages provide their own filter-state via the `useSpellFilters` hook
 * and add page-specific controls / chips through the `extraControls` / `extraChips`
 * slots.
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
    () => Object.fromEntries(tags.map(t => [t.id, t])) as Record<string, { id: string; name: string; groupId: string | null }>,
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
                <ShellFilterSection
                  title="Source"
                  values={sources.map(s => ({ value: s.id, label: String(s.abbreviation || s.shortName || s.name || s.id) }))}
                  selected={filters.sourceFilterIds}
                  onToggle={v => toggleArray(filters.sourceFilterIds, filters.setSourceFilterIds, v)}
                  onIncludeAll={() => filters.setSourceFilterIds(sources.map(s => s.id))}
                  onClear={() => filters.setSourceFilterIds([])}
                />
                <ShellFilterSection
                  title="Spell Level"
                  values={LEVEL_VALUES.map(lvl => ({ value: lvl, label: lvl === '0' ? 'Cantrip' : `Level ${lvl}` }))}
                  selected={filters.levelFilters}
                  onToggle={v => toggleArray(filters.levelFilters, filters.setLevelFilters, v)}
                  onIncludeAll={() => filters.setLevelFilters([...LEVEL_VALUES])}
                  onClear={() => filters.setLevelFilters([])}
                />
                <ShellFilterSection
                  title="Spell School"
                  values={Object.entries(SCHOOL_LABELS).map(([k, label]) => ({ value: k, label }))}
                  selected={filters.schoolFilters}
                  onToggle={v => toggleArray(filters.schoolFilters, filters.setSchoolFilters, v)}
                  onIncludeAll={() => filters.setSchoolFilters(Object.keys(SCHOOL_LABELS))}
                  onClear={() => filters.setSchoolFilters([])}
                />
                {tagGroups.map(group => {
                  const groupTags = tagsByGroup[group.id] || [];
                  if (!groupTags.length) return null;
                  return (
                    <ShellFilterSection
                      key={group.id}
                      title={group.name}
                      values={groupTags.map(t => ({ value: t.id, label: t.name }))}
                      selected={filters.tagFilterIds}
                      onToggle={v => toggleArray(filters.tagFilterIds, filters.setTagFilterIds, v)}
                      onIncludeAll={() => filters.setTagFilterIds(prev => Array.from(new Set([...prev, ...groupTags.map(t => t.id)])))}
                      onClear={() => filters.setTagFilterIds(prev => prev.filter(id => !groupTags.some(t => t.id === id)))}
                    />
                  );
                })}
                <ShellFilterSection
                  title="Casting Time"
                  values={ACTIVATION_ORDER.map(b => ({ value: b, label: ACTIVATION_LABELS[b] }))}
                  selected={filters.activationFilters}
                  onToggle={v => toggleArray(filters.activationFilters, filters.setActivationFilters, v as ActivationBucket)}
                  onIncludeAll={() => filters.setActivationFilters([...ACTIVATION_ORDER])}
                  onClear={() => filters.setActivationFilters([])}
                />
                <ShellFilterSection
                  title="Range"
                  values={RANGE_ORDER.map(b => ({ value: b, label: RANGE_LABELS[b] }))}
                  selected={filters.rangeFilters}
                  onToggle={v => toggleArray(filters.rangeFilters, filters.setRangeFilters, v as RangeBucket)}
                  onIncludeAll={() => filters.setRangeFilters([...RANGE_ORDER])}
                  onClear={() => filters.setRangeFilters([])}
                />
                <ShellFilterSection
                  title="Shape"
                  values={SHAPE_ORDER.map(b => ({ value: b, label: SHAPE_LABELS[b] }))}
                  selected={filters.shapeFilters}
                  onToggle={v => toggleArray(filters.shapeFilters, filters.setShapeFilters, v as ShapeBucket)}
                  onIncludeAll={() => filters.setShapeFilters([...SHAPE_ORDER])}
                  onClear={() => filters.setShapeFilters([])}
                />
                <ShellFilterSection
                  title="Duration"
                  values={DURATION_ORDER.map(b => ({ value: b, label: DURATION_LABELS[b] }))}
                  selected={filters.durationFilters}
                  onToggle={v => toggleArray(filters.durationFilters, filters.setDurationFilters, v as DurationBucket)}
                  onIncludeAll={() => filters.setDurationFilters([...DURATION_ORDER])}
                  onClear={() => filters.setDurationFilters([])}
                />
                <ShellFilterSection
                  title="Properties"
                  values={PROPERTY_ORDER.map(p => ({ value: p, label: PROPERTY_LABELS[p] }))}
                  selected={filters.propertyFilters}
                  onToggle={v => toggleArray(filters.propertyFilters, filters.setPropertyFilters, v as PropertyFilter)}
                  onIncludeAll={() => filters.setPropertyFilters([...PROPERTY_ORDER])}
                  onClear={() => filters.setPropertyFilters([])}
                />
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
          {filters.sourceFilterIds.map(id => {
            const s = sourceById[id];
            const label = s?.abbreviation || s?.shortName || s?.name || id;
            return <FilterChip key={`src-${id}`} label={`Source: ${label}`} onRemove={() => filters.setSourceFilterIds(prev => prev.filter(x => x !== id))} />;
          })}
          {filters.levelFilters.slice().sort((a, b) => Number(a) - Number(b)).map(lvl => (
            <FilterChip key={`lvl-${lvl}`} label={lvl === '0' ? 'Cantrip' : `Level ${lvl}`} onRemove={() => filters.setLevelFilters(prev => prev.filter(x => x !== lvl))} />
          ))}
          {filters.schoolFilters.map(k => (
            <FilterChip key={`sch-${k}`} label={SCHOOL_LABELS[k] || k} onRemove={() => filters.setSchoolFilters(prev => prev.filter(x => x !== k))} />
          ))}
          {filters.tagFilterIds.map(id => {
            const t = tagsById[id];
            return <FilterChip key={`tag-${id}`} label={`Tag: ${t?.name || id}`} onRemove={() => filters.setTagFilterIds(prev => prev.filter(x => x !== id))} />;
          })}
          {filters.activationFilters.map(b => (
            <FilterChip key={`act-${b}`} label={`Cast: ${ACTIVATION_LABELS[b]}`} onRemove={() => filters.setActivationFilters(prev => prev.filter(x => x !== b))} />
          ))}
          {filters.rangeFilters.map(b => (
            <FilterChip key={`rng-${b}`} label={`Range: ${RANGE_LABELS[b]}`} onRemove={() => filters.setRangeFilters(prev => prev.filter(x => x !== b))} />
          ))}
          {filters.durationFilters.map(b => (
            <FilterChip key={`dur-${b}`} label={`Dur: ${DURATION_LABELS[b]}`} onRemove={() => filters.setDurationFilters(prev => prev.filter(x => x !== b))} />
          ))}
          {filters.shapeFilters.map(b => (
            <FilterChip key={`shp-${b}`} label={`Shape: ${SHAPE_LABELS[b]}`} onRemove={() => filters.setShapeFilters(prev => prev.filter(x => x !== b))} />
          ))}
          {filters.propertyFilters.map(p => (
            <FilterChip key={`prop-${p}`} label={PROPERTY_LABELS[p]} onRemove={() => filters.setPropertyFilters(prev => prev.filter(x => x !== p))} />
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

function toggleArray<T extends string>(list: T[], set: React.Dispatch<React.SetStateAction<T[]>>, value: T) {
  set(list.includes(value) ? list.filter(v => v !== value) : [...list, value]);
}

function ShellFilterSection({
  title,
  values,
  selected,
  onToggle,
  onIncludeAll,
  onClear,
}: {
  title: string;
  values: { value: string; label: string }[];
  selected: string[];
  onToggle: (value: string) => void;
  onIncludeAll: () => void;
  onClear: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="h3-title uppercase text-ink">{title}</span>
        <div className="flex items-center gap-3">
          <button type="button" onClick={onIncludeAll} className="label-text hover:underline">Include All</button>
          <span className="text-gold/20">|</span>
          <button type="button" onClick={onClear} className="label-text hover:underline">Clear</button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {values.map(({ value, label }) => {
          const active = selected.includes(value);
          return (
            <button
              key={value}
              type="button"
              onClick={() => onToggle(value)}
              className={cn(
                'rounded border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide transition-colors',
                active
                  ? 'border-gold/60 bg-gold/15 text-gold'
                  : 'border-gold/15 text-ink/55 hover:border-gold/30 hover:text-gold/80',
              )}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function FilterChip({ label, onRemove }: { label: React.ReactNode; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-gold/30 bg-gold/10 pl-2 pr-1 py-0.5 text-[10px] uppercase tracking-widest text-gold">
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove filter"
        className="rounded-full hover:bg-gold/20 p-0.5"
      >
        <X className="w-3 h-3" />
      </button>
    </span>
  );
}
