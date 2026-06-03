/**
 * EntityListSection — shared toolbar + sortable table chrome.
 *
 * Used by both ProficiencyEntityShell (taxonomy and rich-entity tabs
 * under /admin/proficiencies) and StatusesEditor's Conditions tab on
 * /admin/statuses. Encapsulates the patterns these editors had in
 * common:
 *   • A toolbar with a search input, "X / Y" count, optional trailing
 *     buttons (Import JSON, Seed Defaults, etc.), and a primary
 *     "+ New Thing" affordance.
 *   • A responsive sortable header row whose columns can be hidden
 *     at narrow viewports (`minBreakpoint`).
 *   • Body rows rendered via a per-column render callback, with hover
 *     highlight + click-to-edit semantics + an optional active-row
 *     indicator.
 *   • Loading / empty / no-search-match states.
 *
 * The component is generic over row type — the consumer passes its
 * already-filtered-and-sorted `rows` (we don't want this component
 * making domain decisions about how rows are filtered or sorted; we
 * only own the toolbar state and the sort *direction*).
 *
 * Hover-reveal action buttons live inside a column's `render`
 * callback: the row's wrapping <div> always carries `group`, so any
 * cell can include `opacity-0 group-hover:opacity-100` styling on
 * its action UI.
 */

import { useMemo, type ReactNode } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { Button } from '../ui/button';
import { SearchInput } from '../ui/SearchInput';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { Plus } from 'lucide-react';

/**
 * One column in the entity table. `render(row)` returns the cell
 * content for that column in a given row. The `key` doubles as the
 * sort key when `sortable` is true — keep it stable.
 */
export interface ColumnDef<T> {
  key: string;
  /** Header text. Empty string suppresses the label (e.g. icon column). */
  label: string;
  /** Any value valid in `grid-template-columns` (e.g. `"40px"`, `"minmax(0,1fr)"`). */
  width: string;
  /** When true, the header cell becomes a sort toggle. */
  sortable?: boolean;
  /** Hides the column below this Tailwind breakpoint. Default `'always'`. */
  minBreakpoint?: 'always' | 'sm' | 'md' | 'lg';
  /** Per-row cell renderer. */
  render: (row: T) => ReactNode;
}

export interface EntityListSectionProps<T> {
  // ── Toolbar ────────────────────────────────────────────────────────
  search: string;
  onSearchChange: (next: string) => void;
  searchPlaceholder?: string;
  /** Already-filtered count (typically `rows.length`). Displayed as `visibleCount / totalCount`. */
  visibleCount: number;
  /** Pre-filter total. */
  totalCount: number;
  /** Button label, e.g. `"New Condition"`. */
  createLabel: string;
  onCreate: () => void;
  /** Extra buttons that sit between the count and the New button. */
  toolbarTrailing?: ReactNode;

  // ── Table data ─────────────────────────────────────────────────────
  columns: ColumnDef<T>[];
  /** Already filtered AND sorted by the consumer. */
  rows: T[];
  rowKey: (row: T) => string;
  /** Optional `title` attribute (browser tooltip) for the row. */
  rowTitle?: (row: T) => string;
  /** When provided and returns true, the row gets an "active" highlight. */
  rowIsActive?: (row: T) => boolean;
  onRowClick: (row: T) => void;

  // ── Sort ────────────────────────────────────────────────────────────
  sortKey: string | null;
  sortDir: 'asc' | 'desc';
  /** Called with the column key. Consumer decides flip-or-set semantics. */
  onSortChange: (key: string) => void;

  // ── States ──────────────────────────────────────────────────────────
  loading?: boolean;
  /** Custom empty UI when `totalCount === 0`. Default is a centred message. */
  emptyState?: ReactNode;
  /** Used for the no-match message; default uses the search query in quotes. */
  noMatchMessage?: string;

  // ── Container behaviour ────────────────────────────────────────────
  /**
   * When `true`, the list fills its flex-parent's available height and
   * only the body rows scroll (the shell's fullscreen-embedded use
   * case under /admin/proficiencies). When `false`/unset, the list
   * sizes to content and the document scrolls naturally (StatusesEditor's
   * /admin/statuses use case). Safe to leave unset for most callers.
   */
  fillContainer?: boolean;
}

// ─────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────

export default function EntityListSection<T>({
  search,
  onSearchChange,
  searchPlaceholder = 'Search…',
  visibleCount,
  totalCount,
  createLabel,
  onCreate,
  toolbarTrailing,
  columns,
  rows,
  rowKey,
  rowTitle,
  rowIsActive,
  onRowClick,
  sortKey,
  sortDir,
  onSortChange,
  loading,
  emptyState,
  noMatchMessage,
  fillContainer,
}: EntityListSectionProps<T>) {
  // Tailwind-mirrored breakpoint flags. Match the values the shell and
  // the conditions table were already using before extraction.
  const atSm = useMediaQuery('(min-width: 640px)');
  const atMd = useMediaQuery('(min-width: 768px)');
  const atLg = useMediaQuery('(min-width: 1024px)');

  // Hide columns whose `minBreakpoint` isn't met. The grid-template
  // tracks only the visible columns, so cells never bleed into
  // reserved-but-empty space when narrow.
  const visibleColumns = useMemo(() => {
    return columns.filter((col) => {
      const bp = col.minBreakpoint ?? 'always';
      if (bp === 'always') return true;
      if (bp === 'sm') return atSm;
      if (bp === 'md') return atMd;
      if (bp === 'lg') return atLg;
      return true;
    });
  }, [columns, atSm, atMd, atLg]);

  const gridTemplate = visibleColumns.map((c) => c.width).join(' ');

  return (
    <section
      className={`border border-gold/15 rounded-lg bg-card/40 flex flex-col ${
        fillContainer ? 'min-h-0 flex-1' : ''
      }`}
    >
      {/* Toolbar — search + count + trailing buttons + New.
          When fillContainer is set, the toolbar becomes sticky just
          below the page-level back nav (which itself sticks below
          the fixed navbar). Final offset:
            navbar (4rem) + back nav (3rem) = 7rem.
          At lg+ the section's flex layout already keeps the toolbar
          pinned, so we drop sticky to avoid odd interactions with
          the body's overflow container. Solid bg-card makes the
          toolbar opaque when rows scroll under it. */}
      <div
        className={`bg-card px-3 py-2 border-b border-gold/15 flex items-center gap-3 shrink-0 ${
          fillContainer
            ? 'sticky top-[calc(var(--navbar-height)+3rem)] lg:static lg:top-auto z-10'
            : ''
        }`}
      >
        <SearchInput
          value={search}
          onChange={onSearchChange}
          placeholder={searchPlaceholder}
          size="sm"
          wrapperClassName="flex-grow"
        />
        <span className="hidden sm:inline text-[10px] font-mono text-ink/45 shrink-0">
          {visibleCount} / {totalCount}
        </span>
        {toolbarTrailing}
        <Button
          onClick={onCreate}
          size="sm"
          className="btn-gold-solid h-8 text-xs gap-1.5 shrink-0"
        >
          <Plus className="w-3 h-3" /> {createLabel}
        </Button>
      </div>

      {/* Header row — only emits cells for currently-visible columns */}
      <div
        className="grid gap-2 px-3 py-1.5 border-b border-gold/15 text-[9px] uppercase tracking-widest text-ink/55 shrink-0"
        style={{ gridTemplateColumns: gridTemplate }}
      >
        {visibleColumns.map((col) => {
          if (col.sortable) {
            const active = sortKey === col.key;
            return (
              <button
                key={col.key}
                type="button"
                onClick={() => onSortChange(col.key)}
                className={`flex items-center gap-1 text-left transition-colors hover:text-gold ${
                  active ? 'text-gold' : 'text-ink/55'
                }`}
              >
                {col.label}
                {active &&
                  (sortDir === 'asc' ? (
                    <ChevronUp className="w-3 h-3" />
                  ) : (
                    <ChevronDown className="w-3 h-3" />
                  ))}
              </button>
            );
          }
          return <div key={col.key}>{col.label}</div>;
        })}
      </div>

      {/* Body */}
      <div
        className={`divide-y divide-gold/5 ${
          fillContainer ? 'flex-1 overflow-y-auto custom-scrollbar min-h-0' : ''
        }`}
      >
        {loading ? (
          <div className="text-center py-10 font-serif italic opacity-50 text-sm">
            Loading…
          </div>
        ) : totalCount === 0 ? (
          emptyState ?? (
            <p className="text-center py-10 text-xs italic text-ink/45">
              No items defined yet.
            </p>
          )
        ) : rows.length === 0 ? (
          <p className="text-center py-10 text-xs italic text-ink/45">
            {noMatchMessage ?? `No items match “${search}”.`}
          </p>
        ) : (
          rows.map((row) => {
            const active = rowIsActive?.(row) ?? false;
            return (
              <div
                key={rowKey(row)}
                onClick={() => onRowClick(row)}
                className={`group grid gap-2 px-3 py-1.5 items-center cursor-pointer hover:bg-gold/5 transition-colors ${
                  active ? 'bg-gold/5' : ''
                }`}
                style={{ gridTemplateColumns: gridTemplate }}
                title={rowTitle?.(row)}
              >
                {visibleColumns.map((col) => (
                  <div key={col.key} className="min-w-0">
                    {col.render(row)}
                  </div>
                ))}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
