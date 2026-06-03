import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, CornerLeftUp, Settings, Star, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { FilterBar } from './FilterBar';
import { SectionFilterPanel, type FilterSection } from './SectionFilterPanel';
import VirtualizedList from '../ui/VirtualizedList';
import type { AxisCyclers, AxisState } from '../../hooks/useAxisFilters';
import { useMediaQuery } from '../../hooks/useMediaQuery';

/**
 * Shared shell for the public compendium browser pages
 * (`/compendium/spells`, `/compendium/feats`, `/compendium/items`).
 * Owns the chrome that's identical across all three:
 *
 *   - Viewport-lock: adds `body.spell-list-fullscreen` on mount,
 *     tracks `paneHeight` (= viewport - 140px chrome budget) via a
 *     resize listener.
 *   - Outer flex layout (`h-full flex flex-col gap-2 p-2`).
 *   - FilterBar at the top — search field + Filter button + Settings
 *     popover + optional trailing actions slot for admin links /
 *     scope chips.
 *   - Three-tier responsive layout (mirrors TagsExplorer's pattern,
 *     priority pair = list+detail):
 *       • xl+   — favorites | list | detail (3 panes inline).
 *       • lg–xl — list | detail (favorites collapses first; accessed
 *                 via a slide-out overlay opened from a "Favorites"
 *                 button in the FilterBar's trailing slot).
 *       • < lg  — single pane drilldown: list shows by default; clicking
 *                 a row advances to the detail pane; a sticky back-nav
 *                 row at the top of the detail returns to the list.
 *                 Internal `activeView: 'list' | 'detail'` state drives
 *                 the toggle.
 *   - Favorites pane card with header, count, empty-state copy.
 *   - Main list card with column-header strip + VirtualizedList rows.
 *   - Detail pane card wrapper (scrolls internally).
 *   - Column-visibility state — persisted to localStorage under the
 *     key the consumer passes via `columnsLocalStorageKey`.
 *
 * Pages supply:
 *   - `rows` (filtered, sorted) + `totalRowCount` (for the X/Y badge)
 *   - `columns` descriptors with per-cell render functions
 *   - `filterAxes` + `axisFilters` + `cyclers` from useAxisFilters
 *   - `favorites` set + toggle handler + per-row pane render
 *   - `detailPanel` ReactNode (the entity-specific detail UI)
 *   - Optional `trailingActions` / `leadingActions` ReactNodes for
 *     entity-specific FilterBar widgets (admin link, class scope chip,
 *     etc.)
 *   - Optional `favoritesScopePicker` ReactNode that replaces the
 *     default "Favorites · N" header (SpellList uses this for its
 *     universal-vs-per-character dropdown).
 *
 * Anything truly entity-specific (sort headers, scope dropdowns, per-
 * row affordances) goes through these slot props. The shell stays
 * generic over the row type via the TRow type parameter.
 */

// Height of the column-header strip above the virtualized list. Used
// to subtract from paneHeight when computing the VirtualizedList's
// inner height. Conservative — slight underestimate is fine.
const LIST_HEADER_PX = 44;

export type CompendiumColumn<TRow> = {
  /** Stable key — also used as the localStorage entry for the
   *  "hidden" set. Keep it consistent across releases. */
  key: string;
  label: string;
  /** CSS grid track width (e.g. `'minmax(0,1fr)'`, `'96px'`). */
  width: string;
  /** When true, this column can't be toggled off via the Settings
   *  popover. Use for the row's primary identifier (name). */
  alwaysVisible?: boolean;
  /** Align — defaults to `start` for the name column and `center`
   *  for everything else. */
  align?: 'start' | 'center' | 'end';
  /** Renders the cell for this column given the row. */
  render: (row: TRow) => React.ReactNode;
  /** When true, the column header renders as a button that calls
   *  `onSortChange(key)` when clicked. The shell only handles the UI
   *  affordance (chevron + click handler) — actual sorting lives on
   *  the page (it knows how to compare row values for this column). */
  sortable?: boolean;
  /** Automatically hide this column when the viewport is below the
   *  given Tailwind breakpoint. Used to reclaim horizontal room for
   *  the name column at narrow widths — e.g. `'xl'` on the School /
   *  Source columns of SpellList so they vanish when favorites
   *  collapses and the list takes ~520px. Independent of the user's
   *  Settings popover toggle: this is a layout decision, not a
   *  preference. */
  hideBelow?: 'sm' | 'md' | 'lg' | 'xl';
};

export type CompendiumBrowserShellProps<TRow> = {
  // ─── Data ───────────────────────────────────────────────────
  /** Filtered + sorted rows the main list should render. */
  rows: TRow[];
  /** Unfiltered corpus — used for the "X / Y" result count and the
   *  favorites pane (which filters the corpus, not the visible rows). */
  allRows: TRow[];
  loading: boolean;
  getRowId: (row: TRow) => string;
  selectedId: string;
  onSelect: (id: string) => void;

  // ─── Search ─────────────────────────────────────────────────
  search: string;
  onSearchChange: (search: string) => void;
  searchPlaceholder: string;

  // ─── Filters (modal) ────────────────────────────────────────
  filterAxes: FilterSection[];
  axisFilters: Record<string, AxisState>;
  cyclers: AxisCyclers;
  activeFilterCount: number;
  onResetFilters: () => void;
  filterTitle?: string;
  /**
   * Hide the Filters button + modal entirely. Threads to FilterBar's
   * `hideFilters` prop. Use when the browser is happy with just
   * search + the always-on column-level affordances and a per-axis
   * filter wall would be noise. The `filterAxes` etc. props remain
   * required so the type contract stays stable; pass `[]` and
   * no-op cyclers.
   */
  hideFilters?: boolean;

  // ─── Columns ────────────────────────────────────────────────
  columns: CompendiumColumn<TRow>[];
  /** localStorage key for the hidden-columns set. Use a stable name
   *  scoped to the entity (e.g. `'dauligor.itemListColumns'`). */
  columnsLocalStorageKey: string;
  /** Optional override of the per-row pixel height. Default 48. */
  rowHeight?: number;

  // ─── Favorites ──────────────────────────────────────────────
  favorites: Set<string>;
  onToggleFavorite: (id: string) => void;
  /** Render a single pinned row inside the favorites pane. Receives
   *  the row + selected state + a `toggleStar` shortcut that calls
   *  the same `onToggleFavorite` (passed in case the consumer wants
   *  to wire a star button in its custom layout). */
  favoritesRowRender: (args: { row: TRow; selected: boolean; toggleStar: () => void; onSelect: () => void }) => React.ReactNode;
  /** Optional slot that replaces the default favorites-pane header
   *  (icon + "Favorites" label + count). Use for per-character scope
   *  pickers à la SpellList. When omitted, the default header renders. */
  favoritesScopePicker?: React.ReactNode;
  /** Copy for the favorites empty state (e.g. "Star a feat to pin
   *  it here."). */
  favoritesEmptyMessage: string;

  // ─── Sort (optional) ────────────────────────────────────────
  /** Key of the column currently driving the sort. When unset the
   *  shell renders header labels as plain text (no chevrons). The
   *  page is responsible for actually sorting `rows` — the shell
   *  only manages the click affordance + visual indicator. */
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  /** Called when a sortable header is clicked. Convention: same key
   *  toggles direction; different key sets new column ASC. The page
   *  owns the toggle logic — pass a handler that updates its sort
   *  state and re-sorts `rows`. */
  onSortChange?: (key: string) => void;

  // ─── Detail ─────────────────────────────────────────────────
  detailPanel: React.ReactNode;
  /** Copy when nothing is selected — shown inside the detail card. */
  detailEmptyMessage?: string;

  // ─── Slots ──────────────────────────────────────────────────
  trailingActions?: React.ReactNode;
  leadingActions?: React.ReactNode;
  /** Children of SectionFilterPanel — usually the filter axes + tag
   *  states. Defaults to a SectionFilterPanel rendering `filterAxes` /
   *  `axisFilters` / `cyclers` with no tags. Override when the page
   *  needs tag-state plumbing (e.g. SpellList's tag axes). */
  renderFilters?: React.ReactNode;
  /** Empty-state copy for the main list. */
  emptyMessage?: string;
};

// ─── localStorage helpers ─────────────────────────────────────────

function readHiddenColumns(key: string, validKeys: Set<string>): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === 'string' && validKeys.has(v)));
  } catch {
    return new Set();
  }
}

function writeHiddenColumns(key: string, hidden: Set<string>) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(Array.from(hidden)));
  } catch { /* quota / disabled — silently degrade */ }
}

// ─── Component ────────────────────────────────────────────────────

export function CompendiumBrowserShell<TRow>(props: CompendiumBrowserShellProps<TRow>) {
  const {
    rows,
    allRows,
    loading,
    getRowId,
    selectedId,
    onSelect,
    search,
    onSearchChange,
    searchPlaceholder,
    filterAxes,
    axisFilters,
    hideFilters,
    cyclers,
    activeFilterCount,
    onResetFilters,
    filterTitle = 'Filters',
    columns,
    columnsLocalStorageKey,
    rowHeight = 48,
    favorites,
    onToggleFavorite,
    favoritesRowRender,
    favoritesScopePicker,
    favoritesEmptyMessage,
    detailPanel,
    sortBy,
    sortDir,
    onSortChange,
    trailingActions,
    leadingActions,
    renderFilters,
    emptyMessage = 'No entries match the current search and filters.',
  } = props;

  // ─── Breakpoint subscriptions ─────────────────────────────────
  // Tailwind breakpoint pixel values. Used to:
  //   (a) Conditionally render the inline favorites pane vs the
  //       slide-out overlay so the consumer-supplied scope picker
  //       only mounts ONCE — otherwise its internal Popover state
  //       is shared across both copies and a single click opens
  //       both dropdowns at different positions on screen.
  //   (b) Apply per-column `hideBelow` auto-hides so narrow widths
  //       reclaim room for the name column.
  const isSm = useMediaQuery('(min-width: 640px)');
  const isMd = useMediaQuery('(min-width: 768px)');
  const isLg = useMediaQuery('(min-width: 1024px)');
  const isXl = useMediaQuery('(min-width: 1280px)');

  // ─── Viewport-lock ────────────────────────────────────────────
  // `body.spell-list-fullscreen` strips main padding + hides the
  // global footer, freeing the entire viewport for the browser
  // grid. paneHeight tracks the viewport so the 3-pane row always
  // fills "viewport minus chrome above" — same 140px chrome budget
  // SpellList originally established (navbar + FilterBar + spacing).
  useEffect(() => {
    document.body.classList.add('spell-list-fullscreen');
    return () => document.body.classList.remove('spell-list-fullscreen');
  }, []);
  const [paneHeight, setPaneHeight] = useState<number>(() =>
    typeof window === 'undefined' ? 720 : Math.max(420, window.innerHeight - 140),
  );
  useEffect(() => {
    const onResize = () => setPaneHeight(Math.max(420, window.innerHeight - 140));
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const listInnerHeight = Math.max(200, paneHeight - LIST_HEADER_PX);

  // ─── Column visibility ────────────────────────────────────────
  // Persisted to localStorage under the consumer-supplied key. The
  // hidden set is filtered through `validKeys` on load so a stale
  // entry from a renamed column doesn't poison the state.
  const validKeySet = useMemo(() => new Set(columns.map((c) => c.key)), [columns]);
  const alwaysVisibleSet = useMemo(
    () => new Set(columns.filter((c) => c.alwaysVisible).map((c) => c.key)),
    [columns],
  );
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(() =>
    readHiddenColumns(columnsLocalStorageKey, validKeySet),
  );
  const toggleColumn = (key: string) => {
    if (alwaysVisibleSet.has(key)) return;
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      writeHiddenColumns(columnsLocalStorageKey, next);
      return next;
    });
  };
  // Per-column `hideBelow` resolves against the current breakpoint.
  // A column with `hideBelow: 'xl'` stays visible only at xl+; below
  // xl it gets auto-hidden (independent of the user's Settings
  // toggle). The user can still uncheck it in Settings at any width.
  const responsivelyHidden = useMemo(() => {
    const hidden = new Set<string>();
    for (const c of columns) {
      if (!c.hideBelow) continue;
      const met =
        (c.hideBelow === 'sm' && isSm) ||
        (c.hideBelow === 'md' && isMd) ||
        (c.hideBelow === 'lg' && isLg) ||
        (c.hideBelow === 'xl' && isXl);
      if (!met) hidden.add(c.key);
    }
    return hidden;
  }, [columns, isSm, isMd, isLg, isXl]);

  const visibleColumns = useMemo(
    () => columns.filter((c) => !hiddenColumns.has(c.key) && !responsivelyHidden.has(c.key)),
    [columns, hiddenColumns, responsivelyHidden],
  );
  const gridTemplate = useMemo(
    () => visibleColumns.map((c) => c.width).join(' '),
    [visibleColumns],
  );

  // ─── Filter modal state ──────────────────────────────────────
  // Just the open/closed flag — the page owns the filter axes + state
  // and feeds them in through props. Modal body is either the
  // consumer-provided `renderFilters` slot or the default
  // SectionFilterPanel built from `filterAxes` + `cyclers`.
  const [filterOpen, setFilterOpen] = useState(false);

  // ─── Responsive view state ───────────────────────────────────
  // Drives single-pane drilldown at < lg widths. At lg+ both panes
  // (list + detail) are visible side-by-side and `activeView` is
  // effectively ignored by the CSS (the responsive classes flip
  // back to `lg:flex`).
  //
  // Initial value: if the consumer mounts with a non-empty selectedId
  // (e.g. deep-link `?focus=X` on SpellList) we start on detail so
  // phone users land on the focused entity. Otherwise start on list.
  const [activeView, setActiveView] = useState<'list' | 'detail'>(() =>
    selectedId ? 'detail' : 'list',
  );
  // When parent state advances selectedId from outside (deep link
  // navigation, programmatic selection) we follow it into detail at
  // narrow widths so the user sees the new focus immediately.
  useEffect(() => {
    if (selectedId) setActiveView('detail');
  }, [selectedId]);

  // Slide-out favorites panel toggle — only relevant at < xl widths
  // (above that the favorites pane is inline). The button lives in
  // the FilterBar's trailing slot with `xl:hidden`.
  const [favoritesOverlayOpen, setFavoritesOverlayOpen] = useState(false);
  // Close the overlay if the viewport grows past xl while it's open —
  // otherwise it lingers invisibly behind the inline favorites pane
  // and steals clicks via the backdrop.
  useEffect(() => {
    if (!favoritesOverlayOpen) return;
    const onResize = () => {
      // Tailwind's `xl` breakpoint = 1280px.
      if (window.innerWidth >= 1280) setFavoritesOverlayOpen(false);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [favoritesOverlayOpen]);

  // Wrap consumer's onSelect so clicking a row in list mode advances
  // to detail at narrow widths. Harmless at lg+ (activeView is unused
  // there because `lg:flex` overrides the hidden swap).
  const handleSelect = (id: string) => {
    onSelect(id);
    setActiveView('detail');
  };
  const handleSelectFromOverlay = (id: string) => {
    onSelect(id);
    setActiveView('detail');
    setFavoritesOverlayOpen(false);
  };

  // ─── Favorites pane data ─────────────────────────────────────
  // Filtered against `allRows` (not `rows`) — starred entries should
  // surface even when a filter would otherwise hide them. Matches the
  // SpellList semantic: favorites are a fixed list independent of the
  // current view.
  const favoritedRows = useMemo(() => {
    if (favorites.size === 0) return [];
    return allRows.filter((r) => favorites.has(getRowId(r)));
  }, [allRows, favorites, getRowId]);

  // ─── Trailing slot pieces ────────────────────────────────────
  // Settings popover lives inside the FilterBar's trailingActions
  // slot, joining whatever the page passes in (admin links, scope
  // chips). Order: page actions → result count → Settings.
  const settingsPopover = (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 border-gold/25 text-gold hover:bg-gold/5 gap-2"
          title="List settings"
        >
          <Settings className="w-3.5 h-3.5" />
          Settings
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-2">
        <div className="text-[10px] uppercase tracking-widest text-ink/45 px-1 pb-1.5 mb-1 border-b border-gold/15">
          Visible columns
        </div>
        <div className="space-y-0.5">
          {columns.filter((c) => !c.alwaysVisible).map((col) => {
            const visible = !hiddenColumns.has(col.key);
            return (
              <button
                key={col.key}
                type="button"
                onClick={() => toggleColumn(col.key)}
                className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded text-xs hover:bg-gold/5"
              >
                <span>{col.label}</span>
                <span className={cn(
                  'inline-flex items-center justify-center w-4 h-4 rounded border text-[10px]',
                  visible ? 'border-gold/45 bg-gold/15 text-gold' : 'border-gold/15 text-transparent',
                )}>
                  {visible ? '✓' : ''}
                </span>
              </button>
            );
          })}
        </div>
        <div className="text-[10px] text-ink/45 px-1 pt-1.5 mt-1 border-t border-gold/15 italic">
          Hiding columns widens the remaining ones.
        </div>
      </PopoverContent>
    </Popover>
  );

  const resultCount = (
    <div
      className="text-[11px] font-mono tabular-nums text-ink/55 whitespace-nowrap px-1"
      title={`${rows.length} match the current filters out of ${allRows.length} total`}
    >
      {loading ? '— / —' : `${rows.length} / ${allRows.length}`}
    </div>
  );

  // Favorites button — opens the slide-out overlay. Rendered only when
  // !isXl so it doesn't compete with the inline favorites pane at xl+.
  // Lives in the FilterBar's LEADING slot so favorites stay on the
  // left edge of the page (consistent with the xl+ inline pane being
  // the leftmost column).
  const favoritesButton = !isXl ? (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => setFavoritesOverlayOpen(true)}
      className="h-8 border-gold/25 text-gold hover:bg-gold/5 gap-2"
      title="Show favorites"
    >
      <Star className="w-3.5 h-3.5" />
      <span className="hidden sm:inline">Favorites</span>
      <span className="text-[10px] font-mono tabular-nums text-gold/75">{favorites.size}</span>
    </Button>
  ) : null;

  // ─── Default SectionFilterPanel ──────────────────────────────
  // Consumers can pass their own via `renderFilters` (e.g. SpellList
  // wires in tag-state plumbing); otherwise this default covers the
  // common case: axes only, no tag groups.
  const defaultFilters = (
    <SectionFilterPanel
      axes={filterAxes}
      axisFilters={axisFilters}
      tagStates={{}}
      cycleAxisState={cyclers.cycleAxisState}
      cycleAxisStateReverse={cyclers.cycleAxisStateReverse}
      cycleTagState={() => {}}
      cycleTagStateReverse={() => {}}
      cycleAxisCombineMode={cyclers.cycleAxisCombineMode}
      cycleAxisCombineModeReverse={cyclers.cycleAxisCombineModeReverse}
      cycleAxisExclusionMode={cyclers.cycleAxisExclusionMode}
      cycleAxisExclusionModeReverse={cyclers.cycleAxisExclusionModeReverse}
      axisIncludeAll={cyclers.axisIncludeAll}
      axisExcludeAll={cyclers.axisExcludeAll}
      axisClear={cyclers.axisClear}
      search={search}
      setSearch={onSearchChange}
      activeFilterCount={activeFilterCount}
      resetAll={onResetFilters}
      embedded
    />
  );

  // ─── Favorites pane content ──────────────────────────────────
  // Extracted into a function so it can render both inline (xl+ Card
  // in the flex row) and inside the slide-out overlay (< xl) without
  // duplicating the scope-picker / empty-state / row-render logic.
  //   • `onRowSelect` lets the overlay close itself after a click;
  //     the inline version just selects normally.
  //   • `skipDefaultHeader` is set by the overlay (which renders its
  //     own top bar with the close button) so the bare "Favorites · N"
  //     default header doesn't duplicate. The consumer-supplied
  //     `favoritesScopePicker` is always rendered when present — its
  //     dropdown is functional, not just a label.
  const renderFavoritesContent = (
    onRowSelect: (id: string) => void,
    skipDefaultHeader = false,
  ) => (
    <>
      {favoritesScopePicker ?? (skipDefaultHeader ? null : (
        <div className="flex items-center justify-between gap-2 border-b border-gold/15 bg-background/35 px-3 py-2.5 shrink-0">
          <div className="flex items-center gap-2">
            <Star className="w-3.5 h-3.5 text-gold/85 fill-gold/45" />
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gold/75">Favorites</span>
          </div>
          <span className="text-[10px] text-ink/45">{favorites.size}</span>
        </div>
      ))}
      {favorites.size === 0 ? (
        <div className="px-4 py-8 text-center text-xs text-ink/45 italic">
          {favoritesEmptyMessage}
        </div>
      ) : (
        <div className="divide-y divide-gold/5 flex-1 overflow-y-auto custom-scrollbar">
          {favoritedRows.map((row) => {
            const id = getRowId(row);
            const selected = selectedId === id;
            return (
              <React.Fragment key={id}>
                {favoritesRowRender({
                  row,
                  selected,
                  toggleStar: () => onToggleFavorite(id),
                  onSelect: () => onRowSelect(id),
                })}
              </React.Fragment>
            );
          })}
        </div>
      )}
    </>
  );

  return (
    <div className="h-full flex flex-col gap-2 p-2">
      <div className="shrink-0">
        <FilterBar
          search={search}
          setSearch={onSearchChange}
          isFilterOpen={filterOpen}
          setIsFilterOpen={setFilterOpen}
          activeFilterCount={activeFilterCount}
          resetFilters={onResetFilters}
          searchPlaceholder={searchPlaceholder}
          filterTitle={filterTitle}
          resetLabel="Reset Filters"
          leadingActions={
            // Favorites button sits leftmost (matches the xl+ inline
            // favorites pane being the leftmost column), followed by
            // any page-supplied leading actions (back buttons, scope
            // chips, etc.).
            <>
              {favoritesButton}
              {leadingActions}
            </>
          }
          trailingActions={
            <>
              {trailingActions}
              {resultCount}
              {settingsPopover}
            </>
          }
          renderFilters={renderFilters ?? defaultFilters}
          hideFilters={hideFilters}
        />
      </div>

      {/* Responsive shell — flex (not grid) so each pane controls its
          own visibility per breakpoint. Tiered collapse:
            • xl+   — favorites | list | detail (3 inline).
            • lg–xl — list | detail (favorites collapses; slide-out).
            • < lg  — single visible pane based on `activeView`. */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-4">

        {/* Favorites pane — JS-conditional (not just CSS `hidden`) so
            the consumer-supplied `favoritesScopePicker` only mounts
            in ONE place at a time. The picker carries internal
            Popover state; double-mounting it (inline + overlay) makes
            a single click open dropdowns at two screen positions. */}
        {isXl && (
          <div
            className="flex w-[260px] flex-none flex-col"
            style={{ height: `${paneHeight}px` }}
          >
            <Card className="border-gold/15 bg-card/50 overflow-hidden h-full">
              <CardContent className="p-0 flex flex-col h-full">
                {renderFavoritesContent((id) => onSelect(id))}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Main list — visible whenever activeView==='list' (the < lg
            single-pane case) and always at lg+ via `lg:flex`. At lg–xl
            it absorbs flex-1; at xl+ it pins to 520px so the detail
            pane gets the rest. */}
        <Card
          className={cn(
            'border-gold/15 bg-card/50 overflow-hidden flex-col flex-1 lg:flex lg:flex-1 xl:flex-none xl:w-[520px]',
            activeView === 'list' ? 'flex' : 'hidden lg:flex',
          )}
          style={{ height: `${paneHeight}px` }}
        >
          <CardContent className="p-0">
            <div className="border-b border-gold/15 bg-background/35">
              <div
                className="grid gap-2 px-3 py-2.5 text-[10px] font-bold uppercase tracking-[0.18em] text-gold/75 items-center"
                style={{ gridTemplateColumns: gridTemplate }}
              >
                {visibleColumns.map((col) => {
                  const align = col.align ?? (col.key === 'name' ? 'start' : 'center');
                  const justifyClass = align === 'start'
                    ? 'justify-self-start'
                    : align === 'end'
                      ? 'justify-self-end'
                      : 'justify-self-center';
                  const flexJustifyClass = align === 'start'
                    ? 'justify-start'
                    : align === 'end'
                      ? 'justify-end'
                      : 'justify-center';
                  // Sortable headers render as buttons. The shell only
                  // emits the click + chevron — the page receives the
                  // call via `onSortChange` and handles toggle logic.
                  if (col.sortable && onSortChange) {
                    const isActive = sortBy === col.key;
                    return (
                      <button
                        key={col.key}
                        type="button"
                        onClick={() => onSortChange(col.key)}
                        className={cn(
                          'inline-flex items-center gap-1 transition-colors hover:text-gold',
                          justifyClass,
                          flexJustifyClass,
                          isActive ? 'text-gold' : 'text-gold/75',
                        )}
                        title={`Sort by ${col.label}${isActive ? ` (${sortDir})` : ''}`}
                      >
                        <span>{col.label}</span>
                        {isActive
                          ? (sortDir === 'asc'
                              ? <ChevronUp className="w-3 h-3" />
                              : <ChevronDown className="w-3 h-3" />)
                          : null}
                      </button>
                    );
                  }
                  return (
                    <span key={col.key} className={justifyClass}>
                      {col.label}
                    </span>
                  );
                })}
              </div>
            </div>
            {loading ? (
              <div className="px-6 py-12 text-center text-ink/45">Loading...</div>
            ) : rows.length === 0 ? (
              <div className="px-6 py-12 text-center text-ink/45">{emptyMessage}</div>
            ) : (
              <VirtualizedList
                items={rows}
                height={listInnerHeight}
                itemHeight={rowHeight}
                className="custom-scrollbar overflow-y-auto"
                innerClassName="divide-y divide-gold/5"
                renderItem={(row: TRow) => {
                  const id = getRowId(row);
                  const selected = selectedId === id;
                  return (
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => handleSelect(id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleSelect(id);
                        }
                      }}
                      className={cn(
                        'grid w-full items-center gap-2 px-3 text-left transition-colors cursor-pointer',
                        selected ? 'bg-gold/15' : 'hover:bg-gold/5',
                      )}
                      style={{ gridTemplateColumns: gridTemplate, height: `${rowHeight}px` }}
                    >
                      {visibleColumns.map((col) => (
                        <React.Fragment key={col.key}>{col.render(row)}</React.Fragment>
                      ))}
                    </div>
                  );
                }}
              />
            )}
          </CardContent>
        </Card>

        {/* Detail pane — visible whenever activeView==='detail' (the
            < lg single-pane case) and always at lg+ via `lg:flex`. At
            lg+ it absorbs flex-1 so list+detail share the body width. */}
        <Card
          className={cn(
            'border-gold/15 bg-card/50 overflow-hidden flex-col flex-1 lg:flex lg:flex-1',
            activeView === 'detail' ? 'flex' : 'hidden lg:flex',
          )}
          style={{ height: `${paneHeight}px` }}
        >
          {/* Back-nav row — < lg only. Pops the user back from detail
              to the list. Matches TagsExplorer's sticky back-nav row
              at the top of its narrow-view panes. */}
          <div className="lg:hidden flex items-center gap-2 border-b border-gold/15 bg-background/35 px-3 py-2 shrink-0">
            <Button
              type="button"
              onClick={() => setActiveView('list')}
              variant="ghost"
              size="sm"
              className="text-gold gap-2 hover:bg-gold/5 px-2 h-8"
            >
              <CornerLeftUp className="w-4 h-4 rotate-90" /> Back to list
            </Button>
          </div>
          <CardContent className="p-0 flex-1 min-h-0 overflow-y-auto custom-scrollbar">
            {detailPanel}
          </CardContent>
        </Card>
      </div>

      {/* Favorites slide-out — mounts only when (!isXl &&
          favoritesOverlayOpen). The !isXl gate ensures we never have
          BOTH the inline pane and the overlay in the DOM at the same
          time — important because the consumer-supplied scope picker
          carries internal Popover state that would otherwise drive
          two dropdowns from a single click.
          Slides in from the LEFT to keep favorites on the left side
          of the page (matches the xl+ inline pane being the leftmost
          column and the leadingActions placement of the Favorites
          button). */}
      {!isXl && favoritesOverlayOpen && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
          {/* Backdrop — click to close. */}
          <div
            className="absolute inset-0 bg-ink/45 backdrop-blur-sm animate-in fade-in duration-150"
            onClick={() => setFavoritesOverlayOpen(false)}
          />
          {/* Slide-out panel from the left. */}
          <div className="absolute inset-y-0 left-0 w-[300px] max-w-[85vw] bg-card border-r border-gold/25 shadow-2xl flex flex-col animate-in slide-in-from-left duration-200">
            <div className="flex items-center justify-between border-b border-gold/15 px-3 py-2 shrink-0">
              <div className="flex items-center gap-2">
                <Star className="w-3.5 h-3.5 text-gold/85 fill-gold/45" />
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gold/75">Favorites</span>
                <span className="text-[10px] text-ink/45">{favorites.size}</span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setFavoritesOverlayOpen(false)}
                className="h-7 w-7 p-0 text-ink/55 hover:text-gold"
                title="Close favorites"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
            {/* Same content as the inline xl pane. The overlay's own
                top bar above replaces the default "Favorites · N"
                header (skipDefaultHeader=true). Consumers' scope
                pickers (e.g. SpellList's character dropdown) still
                render — they carry functional controls, not just a
                label, so they stack under the overlay header. */}
            <div className="flex-1 min-h-0 flex flex-col">
              {renderFavoritesContent(handleSelectFromOverlay, true)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
