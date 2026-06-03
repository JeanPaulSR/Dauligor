import React, { useEffect, useRef, useState } from 'react';
import { Search, Check } from 'lucide-react';
import { cn } from '../../lib/utils';

export type EntityOption = {
  id: string;
  name: string;
  /** Optional secondary label (e.g., source abbreviation, level) shown to the right of the name. */
  hint?: string;
};

export type EntityPickerProps = {
  /** All available entities to pick from. */
  entities: EntityOption[];
  /** Currently selected ids. */
  selectedIds: string[];
  /** Called with the new selected-ids array on every toggle. */
  onChange: (next: string[]) => void;
  /** Search-input placeholder. */
  searchPlaceholder?: string;
  /** Empty-state text when no entities match the search. */
  emptyText?: string;
  /** Empty-state text when there are no entities at all. */
  noEntitiesText?: string;
  /** Single-select mode — picking another deselects the first. Defaults to multi. */
  single?: boolean;
  /** Ids that should appear disabled (e.g., already linked elsewhere). */
  disabledIds?: string[];
  /** Cap the inner list height. Default 144px (`max-h-36`). */
  maxHeightClass?: string;
  /** When true, show selected-ids as removable chips above the search input. */
  showChips?: boolean;
  /**
   * Open/close behavior for the entity dropdown list.
   *
   * - `true` (default): the dropdown collapses to a single search-input
   *   pill and only floats open (as an absolute overlay below the
   *   input) when the search field is focused. Click outside or
   *   `Escape` closes it. Saves vertical space everywhere — most
   *   pickers in the app sit inline inside form panels where keeping
   *   the full list visible permanently wastes screen real estate.
   *
   * - `false`: legacy always-open inline layout. Pass this when the
   *   picker is the primary content of its surface (e.g. an overflow
   *   modal dedicated to picking one thing) and never benefits from
   *   collapsing.
   */
  collapsible?: boolean;
};

/**
 * Generic searchable multi-select with chip display + scrollable checkbox list.
 *
 * Originally extracted from `UniqueOptionGroupEditor`'s class-restriction picker.
 * Used wherever the user needs to pick a subset of named entities (classes,
 * spells, rules, etc.) — the pattern is identical and was being copy-pasted
 * across the codebase.
 */
export default function EntityPicker({
  entities,
  selectedIds,
  onChange,
  searchPlaceholder = 'Search…',
  emptyText,
  noEntitiesText = 'Nothing to pick.',
  single = false,
  disabledIds = [],
  maxHeightClass = 'max-h-36',
  showChips = true,
  collapsible = true,
}: EntityPickerProps) {
  const [search, setSearch] = useState('');

  // Open/closed state for the collapsible mode. Always-open hosts
  // (the legacy default) pin `open` to true so the list renders
  // unconditionally. Collapsible hosts start closed and toggle on
  // focus / click-outside.
  const [open, setOpen] = useState(!collapsible);
  const containerRef = useRef<HTMLDivElement>(null);

  // Click-outside listener. Uses `mousedown` (not `click`) because
  // mousedown fires BEFORE the input's blur — so a click on a list
  // item inside the container registers correctly, while a click on
  // anything outside closes the panel.
  useEffect(() => {
    if (!collapsible) return;
    const handler = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (containerRef.current.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [collapsible]);

  // Escape key closes the dropdown without blurring focus targets
  // elsewhere on the page.
  useEffect(() => {
    if (!collapsible || !open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [collapsible, open]);

  const handleSearchFocus = () => {
    if (collapsible) setOpen(true);
  };

  const trimmed = search.trim().toLowerCase();
  const filtered = entities.filter(e => !trimmed || e.name.toLowerCase().includes(trimmed));
  const disabledSet = new Set(disabledIds);
  const selectedSet = new Set(selectedIds);

  const toggle = (id: string) => {
    if (disabledSet.has(id)) return;
    if (single) {
      onChange(selectedSet.has(id) ? [] : [id]);
      return;
    }
    onChange(selectedSet.has(id) ? selectedIds.filter(x => x !== id) : [...selectedIds, id]);
  };

  return (
    <div className="space-y-2">
      {showChips && selectedIds.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {selectedIds.map(id => {
            const e = entities.find(en => en.id === id);
            if (!e) return null;
            return (
              <span
                key={id}
                className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-gold/15 text-gold border border-gold/25 rounded"
              >
                {e.name}
                {/* Mirror the per-row hint badge from the dropdown list onto
                    the selected chip — keeps category / level / source info
                    visible after the user picks, without forcing them to
                    reopen the search list. Renders only when `hint` is set,
                    so call sites that don't supply one (Class Restrictions
                    in the option editor, etc.) are visually unchanged. */}
                {e.hint ? (
                  <span className="text-[9px] text-gold/65 normal-case tracking-normal">· {e.hint}</span>
                ) : null}
                <button
                  type="button"
                  onClick={() => onChange(selectedIds.filter(x => x !== id))}
                  className="ml-0.5 text-gold/55 hover:text-gold leading-none"
                  aria-label={`Remove ${e.name}`}
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
      ) : null}

      <div ref={containerRef} className="relative">
        <div
          className={cn(
            'border border-gold/15 rounded-md bg-background/20 overflow-hidden',
          )}
        >
          <div
            className={cn(
              'flex items-center gap-2 px-2 py-1.5',
              // In always-open mode, the search row sits directly above
              // an in-flow list, so a divider reads as natural chrome.
              // In collapsible mode the list is an overlay below the
              // container, so the divider would be a stray hairline.
              !collapsible && 'border-b border-gold/15',
            )}
          >
            <Search className="w-3 h-3 text-ink/35 shrink-0" />
            {/*
              Suppress browser autofill / history dropdown on the picker
              search. The dropdown below this input is driven by the
              entity list we render; the browser's heuristic suggestion
              list would float on top and hide our picks.
              `data-form-type="other"` is Chrome's hint for inputs that
              sit outside a <form> element — Chrome ignores
              `autoComplete="off"` alone in some of those cases.
            */}
            <input
              type="text"
              placeholder={searchPlaceholder}
              value={search}
              onChange={e => setSearch(e.target.value)}
              onFocus={handleSearchFocus}
              onClick={handleSearchFocus}
              className="flex-1 bg-transparent text-xs outline-none placeholder:text-ink/35 text-ink"
              autoComplete="off"
              data-form-type="other"
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch('')}
                // Prevent the clear button from stealing focus from the
                // search input (which would close a collapsible picker).
                onMouseDown={(e) => e.preventDefault()}
                className="text-ink/35 hover:text-ink/65 text-sm leading-none"
                aria-label="Clear search"
              >
                ×
              </button>
            ) : null}
          </div>

          {/* Always-open mode: list renders in-flow below the search
              row, expanding the container vertically. Same layout the
              picker has shipped with since day one. */}
          {!collapsible && open ? renderList() : null}
        </div>

        {/* Collapsible mode: when open, list renders as an absolute
            overlay anchored to the container's bottom. Floats above
            sibling content via z-index so opening the picker doesn't
            push the host page's layout around. */}
        {collapsible && open ? (
          <div
            className="absolute top-full left-0 right-0 z-30 mt-1 border border-gold/35 rounded-md bg-card shadow-lg overflow-hidden"
          >
            {renderList()}
          </div>
        ) : null}
      </div>
    </div>
  );

  /**
   * Inline helper — render the filtered entity list. Defined as a
   * function so the always-open and overlay code paths share one
   * implementation. Closes over the lexical scope's `entities`,
   * `filtered`, `selectedSet`, etc., so no parameters needed.
   */
  function renderList() {
    return (
      <div className={cn('overflow-y-auto custom-scrollbar divide-y divide-gold/5', maxHeightClass)}>
        {entities.length === 0 ? (
          <p className="px-3 py-3 text-[10px] text-ink/25 italic">{noEntitiesText}</p>
        ) : filtered.length === 0 ? (
          <p className="px-3 py-3 text-[10px] text-ink/25 italic">
            {emptyText || `No matches for "${search}".`}
          </p>
        ) : (
          filtered.map(entity => {
            const isSelected = selectedSet.has(entity.id);
            const isDisabled = disabledSet.has(entity.id);
            return (
              <label
                key={entity.id}
                className={cn(
                  'flex items-center gap-2.5 px-3 py-1.5 transition-colors',
                  isDisabled
                    ? 'opacity-40 cursor-not-allowed'
                    : 'cursor-pointer hover:bg-gold/5',
                )}
              >
                <div
                  className={cn(
                    'w-3.5 h-3.5 rounded border shrink-0 flex items-center justify-center transition-all',
                    isSelected
                      ? 'bg-gold border-gold'
                      : 'border-gold/35 hover:border-gold/65',
                  )}
                >
                  {isSelected ? <Check className="w-2.5 h-2.5 text-white" /> : null}
                </div>
                <input
                  type="checkbox"
                  className="hidden"
                  checked={isSelected}
                  disabled={isDisabled}
                  onChange={() => toggle(entity.id)}
                />
                <span className="text-xs text-ink truncate flex-1">{entity.name}</span>
                {entity.hint ? (
                  <span className="text-[9px] uppercase tracking-widest text-ink/45 shrink-0">{entity.hint}</span>
                ) : null}
              </label>
            );
          })
        )}
      </div>
    );
  }
}
