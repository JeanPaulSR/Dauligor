import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check, X, Search } from 'lucide-react';

/**
 * Compact single-select combobox with type-to-search.
 *
 * Why this exists
 * ---------------
 * `<select>` is unusable when the option list grows past a few dozen —
 * scrolling to find one of ~50 modular option items inside a
 * requirements row is awful. `<EntityPicker>` solves that for
 * multi-select but renders chips + a permanent open dropdown, which
 * doesn't fit inline next to other small inputs. This component sits
 * in between: a single-line trigger that shows the current selection,
 * opens a search-as-you-type dropdown when clicked, picks one entity,
 * closes.
 *
 * Layout
 * ------
 * - Trigger is a button (h-7, same height as the surrounding inputs).
 * - Dropdown renders via `createPortal(document.body)` with
 *   `position: fixed` anchored to the trigger's bounding rect — same
 *   pattern as `ActiveEffectKeyInput`, so the dropdown can extend
 *   past any ancestor with `overflow: hidden` (modals, scroll
 *   containers).
 * - Flips above the trigger when there's less than
 *   `PREFERRED_DROPDOWN_HEIGHT` of room below.
 * - Keyboard: ArrowDown opens (when closed); ArrowDown/ArrowUp move
 *   the highlight; Enter picks; Escape closes.
 */

export interface SingleSelectSearchOption {
  id: string;
  name: string;
  /** Optional secondary label (category, level, etc.) shown right-aligned. */
  hint?: string;
}

export interface SingleSelectSearchProps {
  /** Currently selected id, or '' / undefined for unselected. */
  value: string | undefined;
  onChange: (next: string) => void;
  options: SingleSelectSearchOption[];
  /** Placeholder shown on the trigger when nothing is selected. */
  placeholder?: string;
  /** Text shown when the filter doesn't match anything. */
  emptyText?: string;
  /** Text shown when `options` is empty. */
  noEntitiesText?: string;
  /** Disabled trigger — non-interactive. */
  disabled?: boolean;
  /** Allow clearing the selection (renders an × on the trigger). Default true. */
  allowClear?: boolean;
  className?: string;
  /** Optional trigger-button override (e.g. for tighter inline use). */
  triggerClassName?: string;
}

/** Vertical room (px) the dropdown wants to reserve before flipping above. */
const PREFERRED_DROPDOWN_HEIGHT = 280;
/** Max suggestions rendered at once — keeps the dropdown navigable. */
const MAX_VISIBLE = 80;

interface DropdownCoords {
  left: number;
  top: number;
  width: number;
  placeAbove: boolean;
}

export default function SingleSelectSearch({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  emptyText,
  noEntitiesText = 'Nothing to pick.',
  disabled = false,
  allowClear = true,
  className = '',
  triggerClassName = '',
}: SingleSelectSearchProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const [coords, setCoords] = useState<DropdownCoords | null>(null);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  const selected = useMemo(
    () => options.find(o => o.id === value),
    [options, value],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matched = q
      ? options.filter(o =>
          o.name.toLowerCase().includes(q) ||
          (o.hint?.toLowerCase().includes(q) ?? false),
        )
      : options;
    return matched.slice(0, MAX_VISIBLE);
  }, [options, search]);

  // Reset highlight when filtered list shape changes.
  useEffect(() => {
    setHighlightIdx(-1);
  }, [filtered.length, search]);

  // Click-outside closes. We don't blur-close because the user may
  // click an option (which blurs the search input first). Capture
  // pointer-down outside both trigger and dropdown.
  useEffect(() => {
    if (!open) return;
    const onDocPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        dropdownRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener('pointerdown', onDocPointerDown);
    return () => document.removeEventListener('pointerdown', onDocPointerDown);
  }, [open]);

  // Re-anchor on open + on scroll/resize. Same `capture: true` trick
  // as ActiveEffectKeyInput so nested-scroll containers (modal bodies)
  // re-trigger the position update.
  const recomputeCoords = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const placeAbove = spaceBelow < PREFERRED_DROPDOWN_HEIGHT && rect.top > spaceBelow;
    setCoords({
      left: rect.left,
      width: rect.width,
      top: placeAbove ? rect.top : rect.bottom,
      placeAbove,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setCoords(null);
      setSearch('');
      return;
    }
    recomputeCoords();
    // Focus the search input on open so the user can start typing
    // immediately. requestAnimationFrame so the portaled DOM exists.
    requestAnimationFrame(() => searchRef.current?.focus());
    const handler = () => recomputeCoords();
    window.addEventListener('resize', handler);
    window.addEventListener('scroll', handler, true);
    return () => {
      window.removeEventListener('resize', handler);
      window.removeEventListener('scroll', handler, true);
    };
  }, [open, recomputeCoords]);

  // Scroll the highlighted row into view as the user arrows through.
  useEffect(() => {
    if (highlightIdx < 0 || !dropdownRef.current) return;
    const el = dropdownRef.current.querySelector<HTMLElement>(
      `[data-suggestion-idx="${highlightIdx}"]`,
    );
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [highlightIdx]);

  const pick = (opt: SingleSelectSearchOption) => {
    onChange(opt.id);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx(i => Math.max(i - 1, -1));
    } else if (e.key === 'Enter') {
      if (highlightIdx >= 0 && highlightIdx < filtered.length) {
        e.preventDefault();
        pick(filtered[highlightIdx]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }
  };

  const onTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen(true);
    }
  };

  return (
    <div className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(o => !o)}
        onKeyDown={onTriggerKeyDown}
        className={`h-7 px-2 text-[11px] bg-background/50 border border-gold/10 rounded outline-none focus:border-gold flex items-center gap-1.5 truncate disabled:opacity-40 disabled:cursor-not-allowed ${triggerClassName}`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={`flex-1 text-left truncate ${selected ? 'text-ink' : 'text-ink/40'}`}>
          {selected ? selected.name : placeholder}
        </span>
        {selected?.hint ? (
          <span className="text-[9px] text-gold/60 truncate shrink-0">{selected.hint}</span>
        ) : null}
        {allowClear && selected && !disabled ? (
          <span
            // Render as a span (not nested button — invalid HTML) and
            // stop propagation so the parent button's onClick doesn't
            // toggle the dropdown open after the clear.
            role="button"
            tabIndex={-1}
            aria-label="Clear selection"
            onClick={(e) => {
              e.stopPropagation();
              onChange('');
            }}
            className="text-ink/30 hover:text-blood transition-colors leading-none shrink-0"
          >
            <X className="w-3 h-3" />
          </span>
        ) : null}
        <ChevronDown className="w-3 h-3 text-ink/40 shrink-0" />
      </button>

      {open && coords && createPortal(
        <div
          ref={dropdownRef}
          style={{
            position: 'fixed',
            left: `${coords.left}px`,
            top: `${coords.top}px`,
            width: `${Math.max(coords.width, 240)}px`,
            transform: coords.placeAbove ? 'translateY(-100%)' : 'translateY(4px)',
            zIndex: 9999,
            maxHeight: `${PREFERRED_DROPDOWN_HEIGHT}px`,
          }}
          className="rounded-md border border-gold/30 bg-card shadow-lg text-xs flex flex-col overflow-hidden"
          role="listbox"
        >
          {/* Search input — pinned at the top of the dropdown so the
              filter control stays visible while the list scrolls. */}
          <div className="flex items-center gap-2 px-2 py-1.5 border-b border-gold/10 bg-background/30 shrink-0">
            <Search className="w-3 h-3 text-ink/30 shrink-0" />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={onKeyDown}
              autoComplete="off"
              placeholder="Search…"
              className="flex-1 bg-transparent text-xs outline-none placeholder:text-ink/30 text-ink"
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="text-ink/30 hover:text-ink/60 text-sm leading-none shrink-0"
                aria-label="Clear search"
              >
                ×
              </button>
            ) : null}
          </div>

          <div className="overflow-y-auto custom-scrollbar flex-1 divide-y divide-gold/5">
            {options.length === 0 ? (
              <p className="px-3 py-3 text-[10px] text-ink/20 italic">{noEntitiesText}</p>
            ) : filtered.length === 0 ? (
              <p className="px-3 py-3 text-[10px] text-ink/20 italic">
                {emptyText || `No matches for "${search}".`}
              </p>
            ) : (
              filtered.map((opt, i) => {
                const isSelected = opt.id === value;
                const isHighlighted = i === highlightIdx;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    data-suggestion-idx={i}
                    onMouseEnter={() => setHighlightIdx(i)}
                    onClick={() => pick(opt)}
                    className={`block w-full text-left px-3 py-1.5 transition-colors ${
                      isHighlighted ? 'bg-gold/15' : 'hover:bg-gold/10'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {isSelected ? (
                        <Check className="w-3 h-3 text-gold shrink-0" />
                      ) : (
                        <span className="w-3 h-3 shrink-0" />
                      )}
                      <span className="flex-1 text-[11px] text-ink truncate">{opt.name}</span>
                      {opt.hint ? (
                        <span className="text-[10px] text-gold/60 shrink-0">{opt.hint}</span>
                      ) : null}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
