import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ACTIVE_EFFECT_KEYS,
  ACTIVE_EFFECT_KEY_CATEGORY_ORDER,
  ActiveEffectKeyEntry,
  searchActiveEffectKeys,
} from '../../lib/activeEffectKeys';

/**
 * Autocomplete-enabled "Attribute Key" input for the Active Effect editor.
 *
 * Foundry's built-in AE editor seeds its key field from the live actor's
 * data model — every nested path of `actor.system` is offered as a
 * completion. We're authoring offline (no live actor in the React app),
 * so this component shops from a curated catalog instead — common
 * dnd5e 5.x paths plus the canonical midi-qol / dnd5e / DAE flag
 * conventions. See `src/lib/activeEffectKeys.ts` for the catalog itself.
 *
 * UX
 * --
 * - Free-text input: the user can always type any key, even one we
 *   haven't catalogued. The dropdown is suggestions, not a hard list.
 * - Dropdown opens on focus and stays open while typing.
 * - Each suggestion shows `key`, an optional human `label`, and a short
 *   `description`. Categories group the results (Abilities, Skills,
 *   Bonuses, Midi-QOL — Advantage, …) in a stable order.
 * - Mouse: click to pick. Keyboard: arrow up/down + enter to pick,
 *   escape to dismiss without picking.
 */
export interface ActiveEffectKeyInputProps {
  value: string;
  onChange: (next: string) => void;
  /** Optional id for label association. */
  id?: string;
  placeholder?: string;
  className?: string;
}

/** Internal: flat list of suggestions in display order. */
interface OrderedGroup {
  category: string;
  entries: ActiveEffectKeyEntry[];
}

function groupAndOrder(entries: ActiveEffectKeyEntry[]): OrderedGroup[] {
  const byCategory = new Map<string, ActiveEffectKeyEntry[]>();
  for (const e of entries) {
    const bucket = byCategory.get(e.category);
    if (bucket) bucket.push(e);
    else byCategory.set(e.category, [e]);
  }
  const orderIndex = new Map<string, number>();
  ACTIVE_EFFECT_KEY_CATEGORY_ORDER.forEach((c, i) => orderIndex.set(c, i));
  const groups: OrderedGroup[] = [];
  for (const [category, list] of byCategory.entries()) {
    list.sort((a, b) => a.key.localeCompare(b.key));
    groups.push({ category, entries: list });
  }
  groups.sort((a, b) => {
    const ai = orderIndex.has(a.category) ? orderIndex.get(a.category)! : 9999;
    const bi = orderIndex.has(b.category) ? orderIndex.get(b.category)! : 9999;
    if (ai !== bi) return ai - bi;
    return a.category.localeCompare(b.category);
  });
  return groups;
}

/** Max suggestions rendered at once — keeps the dropdown navigable. */
const MAX_VISIBLE_SUGGESTIONS = 60;

export default function ActiveEffectKeyInput({
  value,
  onChange,
  id,
  placeholder = 'system.attributes.ac.calc',
  className = '',
}: ActiveEffectKeyInputProps) {
  const [open, setOpen] = useState(false);
  // Index into the flat list of currently-rendered suggestions. -1 means
  // "no row pre-selected" — pressing Enter does nothing then.
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  // Recompute filtered + grouped suggestions on every value change.
  const groups = useMemo(() => {
    const matches = searchActiveEffectKeys(value);
    const grouped = groupAndOrder(matches);
    return grouped;
  }, [value]);

  // Flat list mirrors the rendered order so highlight-by-index can map
  // back to a concrete entry on Enter.
  const flat = useMemo(() => {
    const out: ActiveEffectKeyEntry[] = [];
    for (const g of groups) {
      for (const e of g.entries) {
        if (out.length >= MAX_VISIBLE_SUGGESTIONS) return out;
        out.push(e);
      }
    }
    return out;
  }, [groups]);

  // Reset the highlight whenever the filtered list shape changes — the
  // previous index may now point at a different entry.
  useEffect(() => {
    setHighlightIdx(-1);
  }, [flat.length, value]);

  // Click-outside closes the dropdown. We don't blur-close because the
  // user may click a suggestion (which blurs the input first) — a
  // click-outside listener captures both blur-elsewhere and ESC paths
  // without racing the suggestion click.
  useEffect(() => {
    if (!open) return;
    const onDocPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        inputRef.current?.contains(target) ||
        dropdownRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener('pointerdown', onDocPointerDown);
    return () => document.removeEventListener('pointerdown', onDocPointerDown);
  }, [open]);

  const pick = (entry: ActiveEffectKeyEntry) => {
    onChange(entry.key);
    setOpen(false);
    // Return focus to the input so the user can keep typing or tab away
    // — picking with the mouse otherwise leaves focus on the dropdown.
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) {
      // Re-open on arrow-down when collapsed; ESC noop.
      if (e.key === 'ArrowDown') {
        setOpen(true);
        e.preventDefault();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx(i => Math.min(i + 1, flat.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx(i => Math.max(i - 1, -1));
    } else if (e.key === 'Enter') {
      if (highlightIdx >= 0 && highlightIdx < flat.length) {
        e.preventDefault();
        pick(flat[highlightIdx]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  };

  // Scroll the highlighted row into view as the user arrows through.
  useEffect(() => {
    if (highlightIdx < 0 || !dropdownRef.current) return;
    const el = dropdownRef.current.querySelector<HTMLElement>(
      `[data-suggestion-idx="${highlightIdx}"]`
    );
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [highlightIdx]);

  const totalAvailable = ACTIVE_EFFECT_KEYS.length;
  const totalMatching = groups.reduce((sum, g) => sum + g.entries.length, 0);
  const showingCount = flat.length;

  return (
    <div className={`relative ${className}`}>
      <input
        ref={inputRef}
        id={id}
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className="w-full h-7 px-2 text-xs font-mono bg-background/50 border border-gold/10 rounded focus:border-gold outline-none"
        // The dropdown is custom React state; mark this as the
        // listbox controller for screen readers.
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
      />

      {open && (
        <div
          ref={dropdownRef}
          className="absolute left-0 right-0 top-full mt-1 z-50 max-h-72 overflow-y-auto rounded-md border border-gold/30 bg-card shadow-lg text-xs"
          role="listbox"
        >
          {flat.length === 0 ? (
            <div className="px-3 py-2 text-ink/40 italic">
              No matches in catalog — type any key you need; the input still saves what you type.
            </div>
          ) : (
            <>
              {groups.map(g => {
                // Filter the per-group entries down to the slice that
                // made it into the visible flat list (truncation may
                // chop a category in half if it pushed past the cap).
                const visibleStart = flat.findIndex(e => e.category === g.category);
                if (visibleStart === -1) return null;
                const visibleInGroup = flat
                  .map((e, i) => ({ e, i }))
                  .filter(({ e }) => e.category === g.category);
                if (visibleInGroup.length === 0) return null;
                return (
                  <div key={g.category} className="border-b border-gold/10 last:border-b-0">
                    <div className="px-2 py-1 text-[10px] font-black uppercase tracking-wider text-gold/70 bg-gold/5 sticky top-0">
                      {g.category}
                    </div>
                    <div>
                      {visibleInGroup.map(({ e, i }) => {
                        const isHighlighted = i === highlightIdx;
                        return (
                          <button
                            key={e.key}
                            type="button"
                            role="option"
                            aria-selected={isHighlighted}
                            data-suggestion-idx={i}
                            onMouseEnter={() => setHighlightIdx(i)}
                            onClick={() => pick(e)}
                            className={`block w-full text-left px-3 py-1.5 transition-colors ${
                              isHighlighted ? 'bg-gold/15' : 'hover:bg-gold/10'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-[11px] text-ink truncate">{e.key}</span>
                              {e.label && (
                                <span className="text-[10px] text-gold/70 truncate shrink-0">— {e.label}</span>
                              )}
                            </div>
                            {e.description && (
                              <div className="text-[10px] text-ink/40 mt-0.5 line-clamp-2">{e.description}</div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              <div className="px-3 py-1.5 text-[10px] text-ink/30 italic border-t border-gold/10 sticky bottom-0 bg-card/95">
                {showingCount < totalMatching
                  ? `Showing first ${showingCount} of ${totalMatching} matches. Keep typing to narrow.`
                  : `${showingCount} of ${totalAvailable} catalog keys.`}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
