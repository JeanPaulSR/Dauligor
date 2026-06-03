import React from 'react';
import { Search } from 'lucide-react';
import { Input } from './input';
import { cn } from '@/lib/utils';

/**
 * Site-standard search input. Wraps shadcn `<Input>` with the
 * absolute-positioned `<Search>` icon affordance used everywhere
 * the codebase has a "search this list" / "filter this list"
 * affordance. Matches the canonical pattern from FilterBar:
 *
 *   <SearchInput value={search} onChange={setSearch} placeholder="…" />
 *
 * The icon is `pointer-events-none` so the input's focus + click
 * targets behave normally despite the visual overlay.
 *
 * Two size variants:
 *   - `md` (default) — FilterBar's canonical chrome: 32px tall,
 *     `field-input` background, w-3 icon at left-3. Use this for
 *     toolbar-prominent searches.
 *   - `sm` — Compact for tight surfaces (icon picker / image
 *     manager / proficiency rail): same height, smaller icon at
 *     left-2.5, text-xs body. Reads as a denser variant.
 *
 * Any additional Tailwind classes pass through via `className` and
 * are merged onto the underlying `<Input>` via `cn()`, so callers
 * can still override `w-64` etc. for layout constraints.
 */
export interface SearchInputProps
  extends Omit<
    React.ComponentProps<typeof Input>,
    'value' | 'onChange' | 'size'
  > {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  /** Layout size. Default `md` mirrors FilterBar. */
  size?: 'sm' | 'md';
  /** Extra classes forwarded to the `<Input>` element. */
  className?: string;
  /** Extra classes forwarded to the outer relative wrapper. */
  wrapperClassName?: string;
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  size = 'md',
  className,
  wrapperClassName,
  ...rest
}: SearchInputProps) {
  const iconPlacement =
    size === 'sm'
      ? 'left-2.5 w-3.5 h-3.5'
      : 'left-3 w-3 h-3';
  const inputSize = size === 'sm' ? 'h-8 pl-8 text-xs' : 'h-8 pl-8';

  return (
    <div className={cn('relative w-full', wrapperClassName)}>
      <Search
        className={cn(
          'absolute top-1/2 -translate-y-1/2 text-ink/35 pointer-events-none',
          iconPlacement,
        )}
      />
      {/*
        Suppress browser autofill / history dropdown on filter inputs.
        SearchInput is universally used for "search this list" / "filter
        this list" affordances — the visible suggestion list (when there
        is one) comes from the page's own data, never from browser
        history. Set the attributes BEFORE the spread so a caller that
        genuinely wants history-style autocomplete can still pass
        `autoComplete="on"` (or a credential category like "username")
        and have it win.

        - `autoComplete="off"` is the canonical hint.
        - `data-form-type="other"` covers Chrome's heuristic autofill
          which sometimes ignores `autoComplete="off"` when the input
          isn't inside a <form>.
      */}
      <Input
        autoComplete="off"
        data-form-type="other"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn('field-input focus:border-gold', inputSize, className)}
        {...rest}
      />
    </div>
  );
}

export default SearchInput;
