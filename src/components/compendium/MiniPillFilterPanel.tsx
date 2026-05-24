import React, { useEffect, useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Filter, RotateCcw, ChevronDown, ChevronRight } from 'lucide-react';
import { Tabs, TabsContent } from '../ui/tabs';
import { AccentTabsList, type AccentTab } from '../ui/AccentTabsList';
import { SearchInput } from '../ui/SearchInput';
import { StatusEmblem } from '../ui/StatusEmblem';
import { cn } from '../../lib/utils';
import type { AxisState } from '../../hooks/useSpellFilters';
import { useFilterBarContext } from './FilterBar';

/**
 * Persistent mini-pill filter panel — production version of Variant E
 * from /mockup/filter-modal (the 5e.tools-inspired pattern). Every
 * (axis, value) pair renders as a tri-state pill, all axes visible
 * simultaneously.
 *
 * State model
 * -----------
 * Reuses the existing useSpellFilters tri-state record:
 *   0 (or missing) = off, 1 = include, 2 = exclude
 * The panel doesn't own filter state — every interaction calls back
 * through the cyclers the caller passes in.
 *
 * Two pill flavours
 * -----------------
 * - kind: 'axis'  — state lives in `axisFilters[axisKey].states[value]`.
 *                   Click cycles via `cycleAxisState(axisKey, value)`.
 *                   Used for source / level / school / activation /
 *                   range / duration / shape / property.
 * - kind: 'tag'   — state lives in `tagStates[value]` directly (value
 *                   IS the tagId). Click cycles via `cycleTagState`.
 *                   Each tag GROUP becomes its own row in the wall.
 *
 * Tri-state controls (pill click)
 * -------------------------------
 * - Left click  → forward cycle: off → include(1) → exclude(2) → off
 * - Right click → reverse cycle: off → exclude(2) → include(1) → off
 *   (`onContextMenu` preventDefault so the browser menu doesn't show)
 *
 * Per-axis controls (5e.tools-style row above each axis's pills)
 * --------------------------------------------------------------
 * - all     — set every value in this axis to include
 * - clear   — remove every entry (back to all-off)
 * - none    — set every value to exclude
 * - default — alias to clear (no per-axis defaults configured yet;
 *             if a caller needs meaningful defaults later, add a
 *             `defaultStates?: Record<string, 0|1|2>` field on
 *             MiniPillAxis and consult it here)
 * - combine mode (OR/AND/XOR) — how multiple includes combine
 * - exclude mode (OR/AND/XOR) — how multiple excludes combine
 * - hide — collapse to header only (local state, not persisted)
 *
 * Each control renders only when the caller has wired the
 * corresponding handler. A consumer that skips the bulk helpers
 * still gets a working pill wall — just without those buttons.
 *
 * Tabs
 * ----
 * When `tabs` is provided, the panel groups axes into tabs via
 * AccentTabsList. Useful when a page wants to split base filters
 * from advanced (e.g. SpellList puts Source/Level/School/buckets
 * on a Filters tab and tag groups on Advanced). When omitted, all
 * axes render in one flat wall.
 *
 * Embedded mode
 * -------------
 * `embedded` skips the standalone header (search + filter icon +
 * leading/trailing slots). Use when the host page already owns a
 * toolbar (FilterBar inside `renderFilters`, etc.).
 */

export type MiniPillAxis = {
  /** Unique key. For 'axis' kind this is the axisFilters key
   *  (e.g. 'source'). For 'tag' kind it's a synthetic id used as
   *  the React `key` (e.g. `tag-group:${groupId}`). */
  key: string;
  name: string;
  icon?: LucideIcon;
  values: Array<{
    value: string;
    label: string;
    /**
     * Optional alternate label. When the axis carries values with
     * `labelAlt` set, a small abbr/full toggle button appears in
     * the axis header letting the user swap between the primary
     * label and the alternate. Used for Sources: `label` is the
     * abbreviation (PHB / XGtE), `labelAlt` is the full name
     * (Player's Handbook / Xanathar's Guide to Everything).
     */
    labelAlt?: string;
    count?: number;
    title?: string;
    /**
     * Optional parent value within the same axis. Used to express
     * a hierarchy among tag-kind values: when set, the panel
     * treats this value as a subtag and hides it from the flat
     * wall by default. Each parent with subtags gets a chevron in
     * the wall (click to open a drawer with its children) and
     * each tag-kind axis carries a "Subtags" expand-all button
     * that opens every parent drawer at once.
     */
    parentValue?: string;
  }>;
  /**
   * Where the per-value state lives in the caller's filter shape:
   *   'axis' — read from `axisFilters[axisKey].states[value]`,
   *            cycle via `cycleAxisState(axisKey, value)`.
   *   'tag'  — read from `tagStates[value]` (value === tagId),
   *            cycle via `cycleTagState(value)`.
   */
  kind: 'axis' | 'tag';
  /** Only used when kind === 'axis' — defaults to `key` if omitted. */
  axisKey?: string;
  /** Only used when kind === 'tag'. The tag-group id used to look
   *  up combine/exclusion modes and to call the per-group cyclers. */
  groupId?: string;
};

export type MiniPillTab = {
  key: string;
  label: string;
  icon?: LucideIcon;
  /** If true, the tab strip shows a small "data present" dot. */
  showDot?: boolean;
  axes: MiniPillAxis[];
};

export interface MiniPillFilterPanelProps {
  /** Either pass a flat axes list OR pass `tabs` (with axes
   *  inside each tab) — not both. When tabs is present, `axes`
   *  is ignored. */
  axes?: MiniPillAxis[];
  tabs?: MiniPillTab[];

  axisFilters: Record<string, AxisState>;
  tagStates: Record<string, number>;
  cycleAxisState: (axisKey: string, value: string) => void;
  cycleAxisStateReverse: (axisKey: string, value: string) => void;
  cycleTagState: (tagId: string) => void;
  cycleTagStateReverse: (tagId: string) => void;

  // Per-axis bulk controls — optional. Missing handlers hide the
  // corresponding button.
  cycleAxisCombineMode?: (axisKey: string) => void;
  /** Reverse direction of cycleAxisCombineMode (right-click). */
  cycleAxisCombineModeReverse?: (axisKey: string) => void;
  cycleAxisExclusionMode?: (axisKey: string) => void;
  /** Reverse direction of cycleAxisExclusionMode (right-click). */
  cycleAxisExclusionModeReverse?: (axisKey: string) => void;
  axisIncludeAll?: (axisKey: string, values: readonly string[]) => void;
  axisExcludeAll?: (axisKey: string, values: readonly string[]) => void;
  axisClear?: (axisKey: string) => void;
  /**
   * Restore an axis to its default state. When omitted the
   * default button on each axis falls back to clearing.
   */
  axisRestoreDefault?: (axisKey: string) => void;

  // Per-group combinators for tag-kind axes. Same gating as above.
  cycleGroupMode?: (groupId: string) => void;
  cycleGroupModeReverse?: (groupId: string) => void;
  cycleExclusionMode?: (groupId: string) => void;
  cycleExclusionModeReverse?: (groupId: string) => void;
  groupCombineModes?: Record<string, 'AND' | 'OR' | 'XOR'>;
  groupExclusionModes?: Record<string, 'AND' | 'OR' | 'XOR'>;
  /**
   * Setter for the entire tagStates record. Used by All/Clear/None
   * bulk controls on tag-kind axes — the panel inlines the merge
   * for the group's tagIds rather than asking the caller to add
   * three more wrapper helpers.
   */
  setTagStates?: React.Dispatch<React.SetStateAction<Record<string, number>>>;

  search: string;
  setSearch: (v: string) => void;
  searchPlaceholder?: string;

  activeFilterCount: number;
  resetAll: () => void;

  resultCount?: React.ReactNode;
  trailingActions?: React.ReactNode;
  leadingActions?: React.ReactNode;

  embedded?: boolean;
  className?: string;
}

function matchesPillSearch(label: string, axisName: string, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return label.toLowerCase().includes(q) || axisName.toLowerCase().includes(q);
}

/**
 * Sub-component that renders one axis row — header (with all-the-
 * controls), pill wall below. Kept inline (not exported) because
 * the wiring is heavily coupled to the parent's prop set and the
 * extraction would just be prop shuffling.
 */
function MiniPillAxisRow({
  axis,
  axisFilters,
  tagStates,
  hidden,
  toggleHidden,
  queryLower,
  search,
  // forward + reverse cyclers
  cycleAxisState,
  cycleAxisStateReverse,
  cycleTagState,
  cycleTagStateReverse,
  // bulk controls
  cycleAxisCombineMode,
  cycleAxisCombineModeReverse,
  cycleAxisExclusionMode,
  cycleAxisExclusionModeReverse,
  axisIncludeAll,
  axisExcludeAll,
  axisClear,
  axisRestoreDefault,
  cycleGroupMode,
  cycleGroupModeReverse,
  cycleExclusionMode,
  cycleExclusionModeReverse,
  groupCombineModes,
  groupExclusionModes,
  setTagStates,
  // local toggles, plumbed from the parent so each axis can set
  // them independently.
  showAllSubtags,
  toggleAllSubtags,
  useAltLabel,
  toggleUseAltLabel,
}: {
  axis: MiniPillAxis;
  axisFilters: Record<string, AxisState>;
  tagStates: Record<string, number>;
  hidden: boolean;
  toggleHidden: () => void;
  queryLower: string;
  search: string;
  cycleAxisState: (axisKey: string, value: string) => void;
  cycleAxisStateReverse: (axisKey: string, value: string) => void;
  cycleTagState: (tagId: string) => void;
  cycleTagStateReverse: (tagId: string) => void;
  cycleAxisCombineMode?: (axisKey: string) => void;
  cycleAxisCombineModeReverse?: (axisKey: string) => void;
  cycleAxisExclusionMode?: (axisKey: string) => void;
  cycleAxisExclusionModeReverse?: (axisKey: string) => void;
  axisIncludeAll?: (axisKey: string, values: readonly string[]) => void;
  axisExcludeAll?: (axisKey: string, values: readonly string[]) => void;
  axisClear?: (axisKey: string) => void;
  axisRestoreDefault?: (axisKey: string) => void;
  cycleGroupMode?: (groupId: string) => void;
  cycleGroupModeReverse?: (groupId: string) => void;
  cycleExclusionMode?: (groupId: string) => void;
  cycleExclusionModeReverse?: (groupId: string) => void;
  groupCombineModes?: Record<string, 'AND' | 'OR' | 'XOR'>;
  groupExclusionModes?: Record<string, 'AND' | 'OR' | 'XOR'>;
  setTagStates?: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  showAllSubtags: boolean;
  toggleAllSubtags: () => void;
  useAltLabel: boolean;
  toggleUseAltLabel: () => void;
}) {
  const isTag = axis.kind === 'tag';
  const axisKey = axis.axisKey ?? axis.key;
  const axisStates = isTag ? null : axisFilters[axisKey]?.states ?? {};

  // Active count across this axis (the small "X active" pill in the header).
  let axisActive = 0;
  for (const v of axis.values) {
    const s = isTag ? tagStates[v.value] : axisStates![v.value];
    if (s) axisActive++;
  }

  // Combine mode + exclusion mode — read from the right shape based
  // on axis kind. Default to 'OR' so the button always shows a label
  // even before the user has touched the mode (matches the matcher's
  // fallback behaviour).
  const combineMode: 'OR' | 'AND' | 'XOR' = isTag
    ? (axis.groupId && groupCombineModes?.[axis.groupId]) || 'OR'
    : (axisFilters[axisKey]?.combineMode ?? 'OR');
  const exclusionMode: 'OR' | 'AND' | 'XOR' = isTag
    ? (axis.groupId && groupExclusionModes?.[axis.groupId]) || 'OR'
    : (axisFilters[axisKey]?.exclusionMode ?? 'OR');

  // Handlers — for tag axes, dispatch to the group cyclers + the
  // setTagStates bulk merge; for axis axes, dispatch to axis cyclers.
  const handleAll = isTag
    ? setTagStates
      ? () => setTagStates(prev => {
          const next = { ...prev };
          for (const v of axis.values) next[v.value] = 1;
          return next;
        })
      : undefined
    : axisIncludeAll
      ? () => axisIncludeAll(axisKey, axis.values.map(v => v.value))
      : undefined;
  const handleNone = isTag
    ? setTagStates
      ? () => setTagStates(prev => {
          const next = { ...prev };
          for (const v of axis.values) next[v.value] = 2;
          return next;
        })
      : undefined
    : axisExcludeAll
      ? () => axisExcludeAll(axisKey, axis.values.map(v => v.value))
      : undefined;
  const handleClear = isTag
    ? setTagStates
      ? () => setTagStates(prev => {
          const next = { ...prev };
          for (const v of axis.values) delete next[v.value];
          return next;
        })
      : undefined
    : axisClear
      ? () => axisClear(axisKey)
      : undefined;
  // Default — caller-provided `axisRestoreDefault` handler when set
  // (e.g. SpellList wires Sources to re-include every source as the
  // "all included" default). Otherwise alias to Clear.
  const handleDefault = axisRestoreDefault
    ? () => axisRestoreDefault(axisKey)
    : handleClear;
  const handleCombineCycle = isTag
    ? axis.groupId && cycleGroupMode
      ? () => cycleGroupMode(axis.groupId!)
      : undefined
    : cycleAxisCombineMode
      ? () => cycleAxisCombineMode(axisKey)
      : undefined;
  const handleCombineCycleReverse = isTag
    ? axis.groupId && cycleGroupModeReverse
      ? () => cycleGroupModeReverse(axis.groupId!)
      : undefined
    : cycleAxisCombineModeReverse
      ? () => cycleAxisCombineModeReverse(axisKey)
      : undefined;
  const handleExclusionCycle = isTag
    ? axis.groupId && cycleExclusionMode
      ? () => cycleExclusionMode(axis.groupId!)
      : undefined
    : cycleAxisExclusionMode
      ? () => cycleAxisExclusionMode(axisKey)
      : undefined;
  const handleExclusionCycleReverse = isTag
    ? axis.groupId && cycleExclusionModeReverse
      ? () => cycleExclusionModeReverse(axis.groupId!)
      : undefined
    : cycleAxisExclusionModeReverse
      ? () => cycleAxisExclusionModeReverse(axisKey)
      : undefined;

  // "Subtags" expand-all button — only appears when this axis has at
  // least one value carrying a parent (i.e. there are subtags to
  // expand). Flips a parent-level boolean that PillBody reads to
  // force every drawer open.
  const hasSubtagsAnywhere = axis.values.some(v => !!v.parentValue);

  // Abbr / full toggle — only appears when the axis values carry
  // `labelAlt` (currently: Sources). Flips a parent-level boolean
  // that PillBody reads to swap each pill's rendered label.
  const hasAltLabel = axis.values.some(v => !!v.labelAlt);

  return (
    <div className="rounded border border-gold/10 bg-background/20 p-1.5">
      <div className="flex items-baseline gap-2 mb-1 px-0.5 flex-wrap">
        {/* All axis headers render at the same size now — base
            axes and tag groups share `text-xs` so the wall reads
            as a single rhythm of consistent section dividers
            rather than a two-tier hierarchy. */}
        <span className="text-xs uppercase tracking-[0.22em] text-ink/60 font-bold">
          {axis.name}
        </span>
        {axisActive > 0 && (
          <span className="text-[9px] text-gold/70 font-bold">· {axisActive} active</span>
        )}
        {/* Per-axis controls — only the ones the caller wired show
            up. Wrapped in `ml-auto` so they all sit at the right
            edge of the header row, mirroring 5e.tools' layout.
            Include / exclude combinator buttons carry persistent
            emerald / blood colour at all times so they're
            distinguishable from the neutral bulk controls (all /
            clear / none / default / hide) without needing a hover. */}
        <div className="ml-auto flex items-center gap-0.5 flex-wrap">
          <AxisControlButton onClick={handleAll} label="all" color="include-hover" title="Include every value in this axis" />
          <AxisControlButton onClick={handleClear} label="clear" title="Remove every entry in this axis" />
          <AxisControlButton onClick={handleNone} label="none" color="exclude-hover" title="Exclude every value in this axis" />
          <AxisControlButton onClick={handleDefault} label="default" title="Reset this axis to its default state" />
          {handleCombineCycle && (
            <AxisControlButton
              onClick={handleCombineCycle}
              onContextMenu={handleCombineCycleReverse}
              label={combineMode}
              title={`Include combinator (${combineMode}) — left click cycles forward, right click reverses`}
              color="include"
            />
          )}
          {handleExclusionCycle && (
            <AxisControlButton
              onClick={handleExclusionCycle}
              onContextMenu={handleExclusionCycleReverse}
              label={exclusionMode}
              title={`Exclude combinator (${exclusionMode}) — left click cycles forward, right click reverses`}
              color="exclude"
            />
          )}
          {hasSubtagsAnywhere && (
            <AxisControlButton
              onClick={toggleAllSubtags}
              label={showAllSubtags ? 'subtags ▾' : 'subtags ▸'}
              title={showAllSubtags ? 'Collapse every subtag drawer in this section' : 'Expand every subtag drawer in this section'}
            />
          )}
          {hasAltLabel && (
            <AxisControlButton
              onClick={toggleUseAltLabel}
              label={useAltLabel ? 'abbr' : 'full'}
              title={useAltLabel ? 'Show abbreviated labels (e.g. PHB)' : 'Show full labels (e.g. Player’s Handbook)'}
            />
          )}
          <AxisControlButton
            onClick={toggleHidden}
            label={hidden ? 'show' : 'hide'}
            title={hidden ? 'Show this axis again' : 'Collapse this axis to just the header'}
          />
        </div>
      </div>
      {/* Pills — flat row of roots; subtags live in collapsible
          drawers anchored to each parent. Matches the existing
          TagGroupFilter pattern in FilterBar so the two
          implementations share a mental model. */}
      {!hidden && (
        <PillBody
          axis={axis}
          isTag={isTag}
          axisKey={axisKey}
          axisStates={axisStates}
          tagStates={tagStates}
          queryLower={queryLower}
          search={search}
          forceExpandAll={showAllSubtags}
          useAltLabel={useAltLabel}
          cycleAxisState={cycleAxisState}
          cycleAxisStateReverse={cycleAxisStateReverse}
          cycleTagState={cycleTagState}
          cycleTagStateReverse={cycleTagStateReverse}
        />
      )}
    </div>
  );
}

/**
 * Pill-rendering body for a single axis. Split into a sub-component
 * so the local `expandedParents` state lives at the row level (each
 * axis tracks its own expansions) without ballooning MiniPillAxisRow.
 *
 * Layout:
 *   - Roots flow horizontally in a wrap-row. Each root with subtags
 *     gets a small chevron button to the right of its pill that
 *     toggles a drawer.
 *   - Drawers render below the roots, indented and prefixed with
 *     the parent's name. One drawer per expanded parent.
 *
 * Auto-expand rules (the user shouldn't have to chase down a
 * matching subtag manually):
 *   1. Any parent whose child has a non-neutral state.
 *   2. Any parent whose child label matches the chip-search.
 *   3. The parent itself matches the chip-search (so its drawer
 *      pops open when the user types the parent's name).
 *
 * Non-matching pills are removed from the DOM during chip-search
 * — same disappear-on-search rule as before. Active pills stay
 * pinned regardless of search.
 */
function PillBody({
  axis,
  isTag,
  axisKey,
  axisStates,
  tagStates,
  queryLower,
  search,
  forceExpandAll,
  useAltLabel,
  cycleAxisState,
  cycleAxisStateReverse,
  cycleTagState,
  cycleTagStateReverse,
}: {
  axis: MiniPillAxis;
  isTag: boolean;
  axisKey: string;
  axisStates: Record<string, number> | null;
  tagStates: Record<string, number>;
  queryLower: string;
  search: string;
  /** When true, every parent drawer renders open regardless of
   *  the per-parent expandedParents Set. Driven by the axis's
   *  "Subtags" toggle button in the header. */
  forceExpandAll: boolean;
  /** When true, render each value's labelAlt instead of label. */
  useAltLabel: boolean;
  cycleAxisState: (axisKey: string, value: string) => void;
  cycleAxisStateReverse: (axisKey: string, value: string) => void;
  cycleTagState: (tagId: string) => void;
  cycleTagStateReverse: (tagId: string) => void;
}) {
  // Per-axis expanded parents. Local + ephemeral (not persisted),
  // matching TagGroupFilter's UX — opening the modal again starts
  // every parent collapsed.
  const [expandedParents, setExpandedParents] = useState<Set<string>>(() => new Set());
  const toggleExpanded = (parentValue: string) =>
    setExpandedParents(prev => {
      const next = new Set(prev);
      if (next.has(parentValue)) next.delete(parentValue);
      else next.add(parentValue);
      return next;
    });

  const stateFor = (value: string): number | undefined =>
    isTag ? tagStates[value] : axisStates![value];
  const getCyclers = () =>
    isTag
      ? { forward: cycleTagState, reverse: cycleTagStateReverse }
      : {
          forward: (v: string) => cycleAxisState(axisKey, v),
          reverse: (v: string) => cycleAxisStateReverse(axisKey, v),
        };
  const cyclers = getCyclers();

  // Partition values into roots + children-by-parent. A value is a
  // root either because it has no parentValue OR its parentValue
  // doesn't point to anything in this axis (cross-group orphan).
  const valueIds = new Set(axis.values.map(v => v.value));
  const roots = axis.values.filter(v => !v.parentValue || !valueIds.has(v.parentValue));
  const childrenByParent = new Map<string, typeof axis.values>();
  for (const v of axis.values) {
    if (!v.parentValue || !valueIds.has(v.parentValue)) continue;
    if (!childrenByParent.has(v.parentValue)) childrenByParent.set(v.parentValue, []);
    childrenByParent.get(v.parentValue)!.push(v);
  }

  // Auto-expand sets — driven by active state + chip-search.
  const searching = queryLower !== '';
  const autoExpanded = new Set<string>();
  for (const v of axis.values) {
    if (!v.parentValue || !valueIds.has(v.parentValue)) continue;
    const state = stateFor(v.value);
    const matchesSearch = searching && matchesPillSearch(v.label, axis.name, search);
    if (state || matchesSearch) autoExpanded.add(v.parentValue);
  }
  for (const root of roots) {
    if (!childrenByParent.has(root.value)) continue;
    if (searching && matchesPillSearch(root.label, axis.name, search)) {
      autoExpanded.add(root.value);
    }
  }
  const isExpanded = (parentValue: string) =>
    forceExpandAll || expandedParents.has(parentValue) || autoExpanded.has(parentValue);

  // Visible roots — under chip-search we keep a root visible if (a) it
  // matches itself, (b) any of its children matches (autoExpanded),
  // or (c) it has an active state. Otherwise hide.
  const visibleRoots = roots.filter(r => {
    const state = stateFor(r.value);
    if (state) return true;
    if (!searching) return true;
    if (matchesPillSearch(r.label, axis.name, search)) return true;
    if (autoExpanded.has(r.value)) return true;
    return false;
  });

  const renderPill = (
    v: typeof axis.values[number],
    opts?: { searchHide?: boolean },
  ) => {
    const state = stateFor(v.value);
    // Rendered label honors the per-axis abbr/full toggle when the
    // value carries an alt — falls back to the primary label
    // otherwise so axes with only primary labels still render fine.
    const renderedLabel = useAltLabel && v.labelAlt ? v.labelAlt : v.label;
    // Search filter for children inside drawers: hide non-matching
    // unless active. The match check considers BOTH labels so a
    // user searching by abbreviation finds the value even when
    // full-label mode is the active display.
    if (opts?.searchHide && !state) {
      if (searching
          && !matchesPillSearch(v.label, axis.name, search)
          && (!v.labelAlt || !matchesPillSearch(v.labelAlt, axis.name, search))) {
        return null;
      }
    }
    return (
      <button
        key={v.value}
        type="button"
        onClick={() => cyclers.forward(v.value)}
        onContextMenu={(e) => {
          e.preventDefault();
          cyclers.reverse(v.value);
        }}
        className={cn(
          'inline-flex items-center gap-0.5 rounded border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide transition-colors select-none',
          !state && 'border-gold/15 bg-card text-ink/55 hover:border-gold/40 hover:text-ink/90',
          state === 1 && 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300',
          state === 2 && 'border-blood/50 bg-blood/15 text-blood line-through',
        )}
        title={
          v.title ??
          (!state
            ? `"${renderedLabel}"\nLeft click: include\nRight click: exclude`
            : state === 1
              ? `Including "${renderedLabel}"\nLeft click: exclude\nRight click: clear`
              : `Excluding "${renderedLabel}"\nLeft click: clear\nRight click: include`)
        }
      >
        {state === 1 && <span className="text-emerald-400/80">+</span>}
        {state === 2 && <span className="text-blood/70">−</span>}
        <span>{renderedLabel}</span>
      </button>
    );
  };

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1">
        {visibleRoots.map(root => {
          const rootPill = renderPill(root);
          const subtags = childrenByParent.get(root.value) ?? [];
          const hasSubtags = subtags.length > 0;
          const expanded = hasSubtags && isExpanded(root.value);
          return (
            <span key={root.value} className="inline-flex items-center gap-0.5">
              {rootPill}
              {hasSubtags && (
                <button
                  type="button"
                  onClick={() => toggleExpanded(root.value)}
                  className={cn(
                    'inline-flex items-center justify-center h-[22px] w-[20px] rounded border transition-colors',
                    expanded
                      ? 'border-gold/50 bg-gold/15 text-gold'
                      : 'border-gold/20 bg-card/60 text-ink/55 hover:border-gold/40 hover:text-gold',
                  )}
                  title={
                    expanded
                      ? `Hide ${root.label} subtags (${subtags.length})`
                      : `Show ${root.label} subtags (${subtags.length})`
                  }
                  aria-expanded={expanded}
                  aria-label={expanded ? `Collapse ${root.label} subtags` : `Expand ${root.label} subtags`}
                >
                  {expanded
                    ? <ChevronDown className="w-3 h-3" />
                    : <ChevronRight className="w-3 h-3" />}
                </button>
              )}
            </span>
          );
        })}
      </div>
      {/* Drawers: one per expanded parent. Indented + with a left
          gold border so multiple expanded parents don't blur
          together. Each drawer is prefixed with its parent label
          so the user knows which children they're looking at. */}
      {visibleRoots.map(root => {
        if (!isExpanded(root.value)) return null;
        const subtags = childrenByParent.get(root.value) ?? [];
        const pills = subtags.map(v => renderPill(v, { searchHide: true })).filter(Boolean);
        if (pills.length === 0) return null;
        return (
          <div
            key={`drawer-${root.value}`}
            className="ml-3 pl-3 border-l border-gold/15 flex flex-wrap items-center gap-1"
          >
            <span className="text-[10px] uppercase tracking-widest text-ink/40 mr-1">{root.label}:</span>
            {pills}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Tiny control button used in each axis row's right-edge cluster.
 * Doesn't render at all when `onClick` is undefined — keeps the
 * "only show wired controls" contract simple at the call sites.
 */
/**
 * Tiny control button used in each axis row's right-edge cluster.
 * Doesn't render at all when `onClick` is undefined — keeps the
 * "only show wired controls" contract simple at the call sites.
 *
 * Color modes
 * -----------
 *   undefined / 'neutral'  — gold-leaning, hover gold. For
 *                            mode-neutral actions (clear / default /
 *                            hide / show).
 *   'include-hover'        — gold at rest, emerald on hover. For
 *                            "this adds include filters" actions
 *                            (all). Same energy as the include
 *                            pill colour, but only on commit.
 *   'exclude-hover'        — gold at rest, blood on hover. Mirror
 *                            of include-hover for "this adds
 *                            exclude filters" (none).
 *   'include' / 'exclude'  — emerald / blood at all times.
 *                            For mode-pinned controls that always
 *                            signal their semantic (the OR/AND/XOR
 *                            combinator cyclers). Reading the row
 *                            without hovering still reveals "this
 *                            one is the include combinator, that
 *                            one is the exclude combinator."
 */
function AxisControlButton({
  onClick,
  onContextMenu,
  label,
  icon: Icon,
  title,
  color,
}: {
  onClick?: () => void;
  /**
   * Optional right-click handler. Used by combinator buttons to
   * cycle OR / AND / XOR in reverse direction (matches the pill
   * left/right cycle UX). preventDefault is applied here so callers
   * don't have to remember.
   */
  onContextMenu?: () => void;
  label?: string;
  icon?: LucideIcon;
  title: string;
  color?: 'neutral' | 'include' | 'exclude' | 'include-hover' | 'exclude-hover';
}) {
  if (!onClick) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu ? (e) => { e.preventDefault(); onContextMenu(); } : undefined}
      title={title}
      className={cn(
        'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border text-[9px] uppercase tracking-widest font-bold transition-colors',
        // Rest + hover styles, picked by color mode.
        (!color || color === 'neutral' || color === 'include-hover' || color === 'exclude-hover') &&
          'border-gold/25 bg-card/60 text-ink/70',
        (!color || color === 'neutral') && 'hover:bg-gold/15 hover:border-gold/50 hover:text-gold',
        color === 'include-hover' && 'hover:bg-emerald-500/15 hover:border-emerald-500/50 hover:text-emerald-300',
        color === 'exclude-hover' && 'hover:bg-blood/15 hover:border-blood/50 hover:text-blood',
        color === 'include' && 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 hover:border-emerald-500/70',
        color === 'exclude' && 'border-blood/50 bg-blood/15 text-blood hover:bg-blood/25 hover:border-blood/70',
      )}
    >
      {Icon ? <Icon className="w-2.5 h-2.5" /> : null}
      {label}
    </button>
  );
}

export function MiniPillFilterPanel(props: MiniPillFilterPanelProps) {
  const {
    axes,
    tabs,
    axisFilters,
    tagStates,
    cycleAxisState,
    cycleAxisStateReverse,
    cycleTagState,
    cycleTagStateReverse,
    search,
    setSearch,
    searchPlaceholder = 'Search…',
    activeFilterCount,
    resetAll,
    resultCount,
    trailingActions,
    leadingActions,
    embedded = false,
    className,
    // Bulk handler grab-bag — re-passed to MiniPillAxisRow.
    cycleAxisCombineMode,
    cycleAxisCombineModeReverse,
    cycleAxisExclusionMode,
    cycleAxisExclusionModeReverse,
    axisIncludeAll,
    axisExcludeAll,
    axisClear,
    axisRestoreDefault,
    cycleGroupMode,
    cycleGroupModeReverse,
    cycleExclusionMode,
    cycleExclusionModeReverse,
    groupCombineModes,
    groupExclusionModes,
    setTagStates,
  } = props;

  // Per-axis collapse state. Local; not persisted. Keyed by axis.key
  // so it survives tab switches but not page reloads.
  const [hiddenAxes, setHiddenAxes] = useState<Set<string>>(() => new Set());
  const toggleAxisHidden = (key: string) =>
    setHiddenAxes(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Per-axis "expand every subtag drawer" toggle, driven by the
  // axis-header Subtags button. Same Set-keyed-by-axis.key shape
  // as hiddenAxes — local, not persisted, axis-scoped.
  const [allSubtagAxes, setAllSubtagAxes] = useState<Set<string>>(() => new Set());
  const toggleAllSubtags = (key: string) =>
    setAllSubtagAxes(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Per-axis "show alternate (full) labels" toggle, driven by the
  // abbr/full button. Same Set shape. When the axis is in this set
  // every value's `labelAlt` is rendered instead of its `label`.
  const [altLabelAxes, setAltLabelAxes] = useState<Set<string>>(() => new Set());
  const toggleAltLabel = (key: string) =>
    setAltLabelAxes(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Pill-name search — in embedded mode we subscribe to the host
  // FilterBar's `chipSearch` context value (the "Filter chip
  // labels…" input already in the modal header) so there's a
  // single search bar in the UI, not two competing ones. In
  // standalone mode (no FilterBar wrapping us) the context default
  // is an empty string and the parent-passed `search` prop drives
  // dim instead.
  const filterBarCtx = useFilterBarContext();
  const effectiveSearch = embedded ? filterBarCtx.chipSearch : search;

  // Hide All / Show All wiring. FilterBar bumps a monotonic counter
  // every time the user clicks the respective button; we react by
  // collapsing or expanding every axis. The version-counter dance
  // (rather than a boolean) matches the same pattern used by
  // FilterBar's own section components — lets repeated clicks fire
  // the effect every time even when state would otherwise be
  // idempotent.
  useEffect(() => {
    if (!embedded || filterBarCtx.hideAllVersion === 0) return;
    const allKeys = (tabs ? tabs.flatMap(t => t.axes) : (axes ?? [])).map(a => a.key);
    setHiddenAxes(new Set(allKeys));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterBarCtx.hideAllVersion]);
  useEffect(() => {
    if (!embedded || filterBarCtx.showAllVersion === 0) return;
    setHiddenAxes(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterBarCtx.showAllVersion]);

  // Flatten the tabs->axes if tabs provided; the flat list is what
  // the include/exclude count + flat-fallback render path use.
  const flatAxes: MiniPillAxis[] = tabs ? tabs.flatMap(t => t.axes) : (axes ?? []);

  const queryLower = effectiveSearch.trim().toLowerCase();

  // Active state counts — across ALL axes, not just the visible tab.
  // Users navigating tabs should see at a glance whether the other
  // tab has stuff configured.
  const includeCount = useMemo(() => {
    let n = 0;
    for (const axis of flatAxes) {
      if (axis.kind === 'tag') {
        for (const v of axis.values) if (tagStates[v.value] === 1) n++;
      } else {
        const states = axisFilters[axis.axisKey ?? axis.key]?.states ?? {};
        for (const v of axis.values) if (states[v.value] === 1) n++;
      }
    }
    return n;
  }, [flatAxes, axisFilters, tagStates]);

  const excludeCount = useMemo(() => {
    let n = 0;
    for (const axis of flatAxes) {
      if (axis.kind === 'tag') {
        for (const v of axis.values) if (tagStates[v.value] === 2) n++;
      } else {
        const states = axisFilters[axis.axisKey ?? axis.key]?.states ?? {};
        for (const v of axis.values) if (states[v.value] === 2) n++;
      }
    }
    return n;
  }, [flatAxes, axisFilters, tagStates]);

  // Active-state badge counts per tab (used as the AccentTabsList
  // `showDot` signal so the inactive tab still hints at its
  // populated state).
  const tabActiveCount = useMemo(() => {
    const out = new Map<string, number>();
    if (!tabs) return out;
    for (const t of tabs) {
      let n = 0;
      for (const axis of t.axes) {
        if (axis.kind === 'tag') {
          for (const v of axis.values) if (tagStates[v.value]) n++;
        } else {
          const states = axisFilters[axis.axisKey ?? axis.key]?.states ?? {};
          for (const v of axis.values) if (states[v.value]) n++;
        }
      }
      out.set(t.key, n);
    }
    return out;
  }, [tabs, axisFilters, tagStates]);

  // Row-rendering helper — shared between the flat-axes render path
  // and the tabbed render path. `effectiveSearch` is the value the
  // pill-dim logic consults; in embedded mode that's the chipSearch
  // from FilterBarContext, otherwise the parent's `search`.
  //
  // Empty-section hide: when chip-search is active and an axis has
  // no value matching it AND no actively-filtering pills, the whole
  // axis row vanishes. Keeps the wall short while typing — only
  // sections with relevant content stay.
  const renderAxisRow = (axis: MiniPillAxis): React.ReactNode => {
    if (queryLower !== '') {
      const states = axis.kind === 'tag'
        ? tagStates
        : axisFilters[axis.axisKey ?? axis.key]?.states ?? {};
      const anyMatchOrActive = axis.values.some(v => {
        if (states[v.value]) return true; // active pill — always pin section
        if (matchesPillSearch(v.label, axis.name, effectiveSearch)) return true;
        if (v.labelAlt && matchesPillSearch(v.labelAlt, axis.name, effectiveSearch)) return true;
        if (matchesPillSearch(axis.name, axis.name, effectiveSearch)) return true;
        return false;
      });
      if (!anyMatchOrActive) return null;
    }
    return (
      <MiniPillAxisRow
        key={axis.key}
        axis={axis}
        axisFilters={axisFilters}
        tagStates={tagStates}
        hidden={hiddenAxes.has(axis.key)}
        toggleHidden={() => toggleAxisHidden(axis.key)}
        queryLower={queryLower}
        search={effectiveSearch}
        showAllSubtags={allSubtagAxes.has(axis.key)}
        toggleAllSubtags={() => toggleAllSubtags(axis.key)}
        useAltLabel={altLabelAxes.has(axis.key)}
        toggleUseAltLabel={() => toggleAltLabel(axis.key)}
        cycleAxisState={cycleAxisState}
        cycleAxisStateReverse={cycleAxisStateReverse}
        cycleTagState={cycleTagState}
        cycleTagStateReverse={cycleTagStateReverse}
        cycleAxisCombineMode={cycleAxisCombineMode}
        cycleAxisCombineModeReverse={cycleAxisCombineModeReverse}
        cycleAxisExclusionMode={cycleAxisExclusionMode}
        cycleAxisExclusionModeReverse={cycleAxisExclusionModeReverse}
        axisIncludeAll={axisIncludeAll}
        axisExcludeAll={axisExcludeAll}
        axisClear={axisClear}
        axisRestoreDefault={axisRestoreDefault}
        cycleGroupMode={cycleGroupMode}
        cycleGroupModeReverse={cycleGroupModeReverse}
        cycleExclusionMode={cycleExclusionMode}
        cycleExclusionModeReverse={cycleExclusionModeReverse}
        groupCombineModes={groupCombineModes}
        groupExclusionModes={groupExclusionModes}
        setTagStates={setTagStates}
      />
    );
  };

  // The tabs branch wraps `renderAxisRow` calls inside <Tabs> +
  // AccentTabsList + per-tab <TabsContent>. Default tab is the first.
  const [activeTab, setActiveTab] = useState<string>(tabs?.[0]?.key ?? '');

  return (
    <div
      className={cn(
        !embedded && 'rounded-md border border-gold/15 bg-card/40',
        className,
      )}
    >
      {/* Standalone header — skipped when embedded. */}
      {!embedded && (
        <div className="px-3 py-2 border-b border-gold/10 bg-gold/[0.03] flex items-center gap-2 flex-wrap">
          {leadingActions}
          <Filter className="w-3.5 h-3.5 text-gold/80 shrink-0" />
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder={searchPlaceholder}
            className="h-8 min-w-[220px] flex-1"
          />
          {resultCount}
          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={resetAll}
              className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-ink/55 hover:text-blood px-2 py-1 rounded border border-gold/10 hover:border-blood/40 transition-colors"
              title={`Clear ${activeFilterCount} active filter${activeFilterCount === 1 ? '' : 's'}`}
            >
              <RotateCcw className="w-3 h-3" />
              Reset
            </button>
          )}
          {includeCount > 0 && (
            <StatusEmblem tone="success" size="sm" title={`${includeCount} include filter${includeCount === 1 ? '' : 's'}`}>
              +{includeCount}
            </StatusEmblem>
          )}
          {excludeCount > 0 && (
            <StatusEmblem tone="error" size="sm" title={`${excludeCount} exclude filter${excludeCount === 1 ? '' : 's'}`}>
              −{excludeCount}
            </StatusEmblem>
          )}
          {trailingActions ? <div className="ml-auto flex items-center gap-2 flex-wrap">{trailingActions}</div> : null}
        </div>
      )}

      {/* No duplicate search input in embedded mode — the host
          FilterBar already supplies "Filter chip labels…" in its
          own modal header, and this panel subscribes to that value
          via FilterBarContext. */}

      {/* Body — tabs OR flat list. */}
      {tabs ? (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <AccentTabsList<string>
            active={activeTab}
            tabs={tabs.map<AccentTab<string>>(t => ({
              value: t.key,
              label: t.label,
              icon: t.icon,
              showDot: (tabActiveCount.get(t.key) ?? 0) > 0,
              dotTitle: `${tabActiveCount.get(t.key)} active filter${tabActiveCount.get(t.key) === 1 ? '' : 's'} in this tab`,
            }))}
          />
          {tabs.map(t => (
            <TabsContent key={t.key} value={t.key} className="mt-2 space-y-1.5">
              {t.axes.map(renderAxisRow)}
            </TabsContent>
          ))}
        </Tabs>
      ) : (
        <div className={cn('space-y-1.5', !embedded && 'p-2')}>
          {flatAxes.map(renderAxisRow)}
        </div>
      )}
    </div>
  );
}

export default MiniPillFilterPanel;
