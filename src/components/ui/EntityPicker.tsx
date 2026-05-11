import React, { useState } from 'react';
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
}: EntityPickerProps) {
  const [search, setSearch] = useState('');

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
                className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-gold/10 text-gold border border-gold/20 rounded"
              >
                {e.name}
                {/* Mirror the per-row hint badge from the dropdown list onto
                    the selected chip — keeps category / level / source info
                    visible after the user picks, without forcing them to
                    reopen the search list. Renders only when `hint` is set,
                    so call sites that don't supply one (Class Restrictions
                    in the option editor, etc.) are visually unchanged. */}
                {e.hint ? (
                  <span className="text-[9px] text-gold/60 normal-case tracking-normal">· {e.hint}</span>
                ) : null}
                <button
                  type="button"
                  onClick={() => onChange(selectedIds.filter(x => x !== id))}
                  className="ml-0.5 text-gold/50 hover:text-gold leading-none"
                  aria-label={`Remove ${e.name}`}
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
      ) : null}

      <div className="border border-gold/10 rounded-md bg-background/20 overflow-hidden">
        <div className="flex items-center gap-2 px-2 py-1.5 border-b border-gold/10">
          <Search className="w-3 h-3 text-ink/30 shrink-0" />
          <input
            type="text"
            placeholder={searchPlaceholder}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 bg-transparent text-xs outline-none placeholder:text-ink/30 text-ink"
          />
          {search ? (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="text-ink/30 hover:text-ink/60 text-sm leading-none"
              aria-label="Clear search"
            >
              ×
            </button>
          ) : null}
        </div>

        <div className={cn('overflow-y-auto divide-y divide-gold/5', maxHeightClass)}>
          {entities.length === 0 ? (
            <p className="px-3 py-3 text-[10px] text-ink/20 italic">{noEntitiesText}</p>
          ) : filtered.length === 0 ? (
            <p className="px-3 py-3 text-[10px] text-ink/20 italic">
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
                        : 'border-gold/30 hover:border-gold/60',
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
                    <span className="text-[9px] uppercase tracking-widest text-ink/40 shrink-0">{entity.hint}</span>
                  ) : null}
                </label>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
