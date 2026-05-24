import React, { useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Filter, RotateCcw, EyeOff, Eye } from 'lucide-react';
import { Tabs, TabsContent } from '../ui/tabs';
import { AccentTabsList, type AccentTab } from '../ui/AccentTabsList';
import { SearchInput } from '../ui/SearchInput';
import { StatusEmblem } from '../ui/StatusEmblem';
import { cn } from '../../lib/utils';
import type { AxisState } from '../../hooks/useSpellFilters';

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
  values: Array<{ value: string; label: string; count?: number; title?: string }>;
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
  cycleAxisExclusionMode?: (axisKey: string) => void;
  axisIncludeAll?: (axisKey: string, values: readonly string[]) => void;
  axisExcludeAll?: (axisKey: string, values: readonly string[]) => void;
  axisClear?: (axisKey: string) => void;

  // Per-group combinators for tag-kind axes. Same gating as above.
  cycleGroupMode?: (groupId: string) => void;
  cycleExclusionMode?: (groupId: string) => void;
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
  cycleAxisExclusionMode,
  axisIncludeAll,
  axisExcludeAll,
  axisClear,
  cycleGroupMode,
  cycleExclusionMode,
  groupCombineModes,
  groupExclusionModes,
  setTagStates,
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
  cycleAxisExclusionMode?: (axisKey: string) => void;
  axisIncludeAll?: (axisKey: string, values: readonly string[]) => void;
  axisExcludeAll?: (axisKey: string, values: readonly string[]) => void;
  axisClear?: (axisKey: string) => void;
  cycleGroupMode?: (groupId: string) => void;
  cycleExclusionMode?: (groupId: string) => void;
  groupCombineModes?: Record<string, 'AND' | 'OR' | 'XOR'>;
  groupExclusionModes?: Record<string, 'AND' | 'OR' | 'XOR'>;
  setTagStates?: React.Dispatch<React.SetStateAction<Record<string, number>>>;
}) {
  const Icon = axis.icon;
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
  // Default — for now, no axis carries an explicit default state, so
  // we alias to Clear. When a caller needs meaningful defaults (e.g.
  // Sources = PHB pre-selected), add a `defaultStates` field on
  // MiniPillAxis and dispatch to a per-value setter here.
  const handleDefault = handleClear;
  const handleCombineCycle = isTag
    ? axis.groupId && cycleGroupMode
      ? () => cycleGroupMode(axis.groupId!)
      : undefined
    : cycleAxisCombineMode
      ? () => cycleAxisCombineMode(axisKey)
      : undefined;
  const handleExclusionCycle = isTag
    ? axis.groupId && cycleExclusionMode
      ? () => cycleExclusionMode(axis.groupId!)
      : undefined
    : cycleAxisExclusionMode
      ? () => cycleAxisExclusionMode(axisKey)
      : undefined;

  return (
    <div className="rounded border border-gold/10 bg-background/20 p-1.5">
      <div className="flex items-baseline gap-2 mb-1 px-0.5 flex-wrap">
        {Icon ? <Icon className="w-3 h-3 text-ink/40 shrink-0" /> : null}
        <span className="text-[9px] uppercase tracking-[0.22em] text-ink/60 font-bold">{axis.name}</span>
        <span className="text-[9px] text-ink/30">{axis.values.length}</span>
        {axisActive > 0 && (
          <span className="text-[9px] text-gold/70 font-bold">· {axisActive} active</span>
        )}
        {/* Per-axis controls — only the ones the caller wired show
            up. Wrapped in `ml-auto` so they all sit at the right
            edge of the header row, mirroring 5e.tools' layout. */}
        <div className="ml-auto flex items-center gap-0.5 flex-wrap">
          <AxisControlButton onClick={handleAll} label="all" hoverColor="emerald" title="Include every value in this axis" />
          <AxisControlButton onClick={handleClear} label="clear" title="Remove every entry in this axis" />
          <AxisControlButton onClick={handleNone} label="none" hoverColor="blood" title="Exclude every value in this axis" />
          <AxisControlButton onClick={handleDefault} label="default" title="Reset this axis to its default state" />
          {handleCombineCycle && (
            <AxisControlButton
              onClick={handleCombineCycle}
              label={`+${combineMode}`}
              title={`Include combinator (${combineMode}) — click to cycle OR / AND / XOR`}
              hoverColor="emerald"
            />
          )}
          {handleExclusionCycle && (
            <AxisControlButton
              onClick={handleExclusionCycle}
              label={`−${exclusionMode}`}
              title={`Exclude combinator (${exclusionMode}) — click to cycle OR / AND / XOR`}
              hoverColor="blood"
            />
          )}
          <AxisControlButton
            onClick={toggleHidden}
            icon={hidden ? Eye : EyeOff}
            title={hidden ? 'Show this axis again' : 'Collapse this axis to just the header'}
          />
        </div>
      </div>
      {/* Pills — hidden when the user collapsed the axis. */}
      {!hidden && (
        <div className="flex flex-wrap gap-1">
          {axis.values.map(v => {
            const state = isTag ? tagStates[v.value] : axisStates![v.value];
            const dimmed = queryLower !== '' && !matchesPillSearch(v.label, axis.name, search);
            return (
              <button
                key={v.value}
                type="button"
                onClick={() => {
                  if (isTag) cycleTagState(v.value);
                  else cycleAxisState(axisKey, v.value);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (isTag) cycleTagStateReverse(v.value);
                  else cycleAxisStateReverse(axisKey, v.value);
                }}
                className={cn(
                  'inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide transition-colors select-none',
                  !state && 'border-gold/15 bg-card text-ink/55 hover:border-gold/40 hover:text-ink/90',
                  state === 1 && 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300',
                  state === 2 && 'border-blood/50 bg-blood/15 text-blood line-through',
                  dimmed && 'opacity-20',
                )}
                title={
                  v.title ??
                  (!state
                    ? `"${v.label}"\nLeft click: include\nRight click: exclude`
                    : state === 1
                      ? `Including "${v.label}"\nLeft click: exclude\nRight click: clear`
                      : `Excluding "${v.label}"\nLeft click: clear\nRight click: include`)
                }
              >
                {state === 1 && <span className="text-emerald-400/80">+</span>}
                {state === 2 && <span className="text-blood/70">−</span>}
                <span>{v.label}</span>
                {v.count !== undefined && !state && (
                  <span className="text-[8px] text-ink/30 ml-0.5">·{v.count}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
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
 * Visual: looks like a real button at rest (visible border, subtle
 * card-tinted background, gold-leaning text) so the seven controls
 * read as a distinct toolbar cluster rather than a row of bare
 * labels. Hover bumps the border + text into the action's
 * semantic colour (emerald for include-flavour, blood for
 * exclude-flavour, gold for neutral).
 */
function AxisControlButton({
  onClick,
  label,
  icon: Icon,
  title,
  hoverColor,
}: {
  onClick?: () => void;
  label?: string;
  icon?: LucideIcon;
  title: string;
  hoverColor?: 'emerald' | 'blood';
}) {
  if (!onClick) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border text-[9px] uppercase tracking-widest font-bold transition-colors',
        // Rest state — visible border + card-tinted background so
        // each button reads as a real button at a glance. Gold-leaning
        // text keeps the cluster cohesive against the axis label.
        'border-gold/25 bg-card/60 text-ink/70',
        // Hover treatment — semantic colour for the action.
        !hoverColor && 'hover:bg-gold/15 hover:border-gold/50 hover:text-gold',
        hoverColor === 'emerald' && 'hover:bg-emerald-500/15 hover:border-emerald-500/50 hover:text-emerald-300',
        hoverColor === 'blood' && 'hover:bg-blood/15 hover:border-blood/50 hover:text-blood',
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
    cycleAxisExclusionMode,
    axisIncludeAll,
    axisExcludeAll,
    axisClear,
    cycleGroupMode,
    cycleExclusionMode,
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

  // Flatten the tabs->axes if tabs provided; the flat list is what
  // the include/exclude count + flat-fallback render path use.
  const flatAxes: MiniPillAxis[] = tabs ? tabs.flatMap(t => t.axes) : (axes ?? []);

  const queryLower = search.trim().toLowerCase();

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
  // and the tabbed render path.
  const renderAxisRow = (axis: MiniPillAxis) => (
    <MiniPillAxisRow
      key={axis.key}
      axis={axis}
      axisFilters={axisFilters}
      tagStates={tagStates}
      hidden={hiddenAxes.has(axis.key)}
      toggleHidden={() => toggleAxisHidden(axis.key)}
      queryLower={queryLower}
      search={search}
      cycleAxisState={cycleAxisState}
      cycleAxisStateReverse={cycleAxisStateReverse}
      cycleTagState={cycleTagState}
      cycleTagStateReverse={cycleTagStateReverse}
      cycleAxisCombineMode={cycleAxisCombineMode}
      cycleAxisExclusionMode={cycleAxisExclusionMode}
      axisIncludeAll={axisIncludeAll}
      axisExcludeAll={axisExcludeAll}
      axisClear={axisClear}
      cycleGroupMode={cycleGroupMode}
      cycleExclusionMode={cycleExclusionMode}
      groupCombineModes={groupCombineModes}
      groupExclusionModes={groupExclusionModes}
      setTagStates={setTagStates}
    />
  );

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

      {/* Embedded mode emblems strip — counts + Reset live INSIDE the
          modal body since the host FilterBar doesn't natively show
          the include/exclude split. */}
      {embedded && (includeCount > 0 || excludeCount > 0 || activeFilterCount > 0) && (
        <div className="flex items-center gap-2 flex-wrap mb-2">
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
          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={resetAll}
              className="ml-auto inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-ink/55 hover:text-blood px-2 py-1 rounded border border-gold/10 hover:border-blood/40 transition-colors"
              title={`Clear ${activeFilterCount} active filter${activeFilterCount === 1 ? '' : 's'}`}
            >
              <RotateCcw className="w-3 h-3" />
              Reset
            </button>
          )}
        </div>
      )}

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
