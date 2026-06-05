// =============================================================================
// Shared bits for the admin "console table" pages (Campaigns / Eras / Worlds).
// =============================================================================

import { ArrowUpDown, ArrowUp, ArrowDown, Image as ImageIcon } from 'lucide-react';
import { TableHead } from '../ui/table';

export type Dir = 'asc' | 'desc';

// A no-image thumbnail using the same placeholder as the compendium editors:
// a faint ink panel with a muted image glyph.
export function ImageThumb({ url, className, icon = 'w-4 h-4' }: { url?: string; className: string; icon?: string }) {
  return (
    <div className={`relative overflow-hidden bg-ink/5 border border-gold/15 ${className}`}>
      {url
        ? <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${url})` }} />
        : <div className="absolute inset-0 flex items-center justify-center"><ImageIcon className={`${icon} text-gold/15`} /></div>}
    </div>
  );
}

// Generic sortable column header — toggles asc/desc, shows the active arrow.
export function SortHead({ active, dir, onClick, label, className = '' }:
  { active: boolean; dir: Dir; onClick: () => void; label: string; className?: string }) {
  return (
    <TableHead className={`cursor-pointer select-none ${className}`} onClick={onClick}>
      <span className="inline-flex items-center gap-1.5">
        {label}
        {active
          ? (dir === 'asc' ? <ArrowUp className="w-3 h-3 text-gold" /> : <ArrowDown className="w-3 h-3 text-gold" />)
          : <ArrowUpDown className="w-3 h-3 text-ink/25" />}
      </span>
    </TableHead>
  );
}

// Toggle helper for a {key, dir} sort state setter.
export function makeToggle<K extends string>(setState: (fn: (s: { key: K; dir: Dir }) => { key: K; dir: Dir }) => void) {
  return (key: K) => setState((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
}
