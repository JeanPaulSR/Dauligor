import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/react';
import { searchOptionGroupItems, searchReferenceFamily, type RefSearchResult } from '../lib/references';

/**
 * Inline @/& reference autocomplete for the TipTap editor.
 *
 * Dependency-free: detects the trigger from editor state, positions a
 * dropdown with ProseMirror's coordsAtPos, intercepts arrow/enter/escape
 * via a capture-phase keydown on the editor DOM, and inserts the reference
 * as plain `@kind[id]{Name}` text.
 *
 *   @<query>  → searches the ENTITY family (spell/class/subclass/feat/item/article/option-group)
 *   &<query>  → searches the RULE family (condition)
 *
 * Option-group drill-down: picking a group doesn't insert — it lists the
 * group's options (filterable; the typed filter is captured into the dropdown
 * so the editor's trigger text stays put), with a "whole group" entry at the
 * bottom. Picking an option inserts `@option-group[group:item]{Item}`; picking
 * the group entry inserts `@option-group[group]{Group}`. Esc backs out.
 */

interface MenuState {
  family: 'entity' | 'rule';
  query: string;
  from: number; // doc position of the sigil
  to: number; // cursor position
  left: number; // viewport px (for position: fixed)
  top: number;
}

// A search result + optional display label (the "whole group" drill entry
// shows a label distinct from the name it inserts).
interface Suggestion extends RefSearchResult {
  label?: string;
}

interface DrillState {
  groupSlug: string;
  groupName: string;
}

// A trigger is a sigil + query at the cursor, where the sigil follows
// start-of-block or whitespace/paren (so mid-word @ doesn't fire).
const TRIGGER_RE = /([@&])([^\s@&[\]{}]{0,40})$/;

interface Props {
  editor: Editor | null;
  enabled: boolean;
}

export default function ReferenceAutocomplete({ editor, enabled }: Props) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [results, setResults] = useState<Suggestion[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [drill, setDrill] = useState<DrillState | null>(null);
  const [drillQuery, setDrillQuery] = useState('');

  // Mirrors for the stable keydown listener (closure can't see fresh state).
  const menuRef = useRef<MenuState | null>(null);
  const resultsRef = useRef<Suggestion[]>([]);
  const activeRef = useRef(0);
  const drillRef = useRef<DrillState | null>(null);
  menuRef.current = menu;
  resultsRef.current = results;
  activeRef.current = active;
  drillRef.current = drill;

  const close = useCallback(() => {
    setMenu(null);
    setResults([]);
    setActive(0);
    setDrill(null);
    setDrillQuery('');
  }, []);

  const exitDrill = useCallback(() => {
    setDrill(null);
    setDrillQuery('');
    setActive(0);
  }, []);

  const select = useCallback(
    (r: Suggestion) => {
      const m = menuRef.current;
      if (!editor || !m) return;
      // First pick of an option GROUP (id has no ':') drills into its options
      // instead of inserting. Picking an option, the "whole group" entry, or
      // any other kind inserts.
      if (!drillRef.current && r.kind === 'option-group' && !r.id.includes(':')) {
        setDrill({ groupSlug: r.id, groupName: r.name });
        setDrillQuery('');
        setActive(0);
        return;
      }
      const sigil = m.family === 'entity' ? '@' : '&';
      const refText = `${sigil}${r.kind}[${r.id}]{${r.name}} `;
      editor.chain().focus().insertContentAt({ from: m.from, to: m.to }, refText).run();
      close();
    },
    [editor, close],
  );

  // Detect the trigger on edits + caret moves. Frozen while drilling — typing
  // is intercepted then, so the editor doesn't change, but guard against stray
  // selection events resetting the menu mid-drill.
  useEffect(() => {
    if (!editor || !enabled) return;
    const detect = () => {
      if (drillRef.current) return;
      const sel = editor.state.selection;
      if (!sel.empty) return setMenu(null);
      const $from = sel.$from;
      const before = $from.parent.textBetween(0, $from.parentOffset, '\n', '￼');
      const m = TRIGGER_RE.exec(before);
      if (!m) return setMenu(null);
      const idx = m.index;
      const prev = idx > 0 ? before[idx - 1] : '';
      if (idx !== 0 && !/[\s(>]/.test(prev)) return setMenu(null);
      const from = $from.start() + idx;
      let coords;
      try {
        coords = editor.view.coordsAtPos(from);
      } catch {
        return setMenu(null);
      }
      setMenu({
        family: m[1] === '@' ? 'entity' : 'rule',
        query: m[2],
        from,
        to: sel.from,
        left: coords.left,
        top: coords.bottom,
      });
    };
    editor.on('update', detect);
    editor.on('selectionUpdate', detect);
    return () => {
      editor.off('update', detect);
      editor.off('selectionUpdate', detect);
    };
  }, [editor, enabled]);

  // Debounced search. Drilling → the group's options (filtered by drillQuery,
  // with a "whole group" entry appended); otherwise the sigil family.
  useEffect(() => {
    if (!menu) return;
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        if (drill) {
          const items = await searchOptionGroupItems(drill.groupSlug, drillQuery, 40);
          const groupEntry: Suggestion = {
            kind: 'option-group',
            id: drill.groupSlug,
            name: drill.groupName,
            label: `${drill.groupName} — whole group`,
          };
          if (!cancelled) {
            setResults([...items, groupEntry]);
            setActive(0);
          }
        } else {
          const r = await searchReferenceFamily(menu.family, menu.query, 8);
          if (!cancelled) {
            setResults(r);
            setActive(0);
          }
        }
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 140);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu?.family, menu?.query, drill?.groupSlug, drillQuery]);

  // Keyboard: intercept nav/select/close before ProseMirror handles them.
  // While drilling, also capture typing into drillQuery so it filters options
  // rather than landing in the editor.
  useEffect(() => {
    if (!editor || !enabled) return;
    const dom = editor.view.dom as HTMLElement;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!menuRef.current) return;
      const items = resultsRef.current;
      const drilling = !!drillRef.current;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (drilling) exitDrill();
        else close();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        setActive((a) => (items.length ? (a + 1) % items.length : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setActive((a) => (items.length ? (a - 1 + items.length) % items.length : 0));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (items.length) {
          e.preventDefault();
          e.stopPropagation();
          select(items[activeRef.current] ?? items[0]);
        }
      } else if (drilling && e.key === 'Backspace') {
        e.preventDefault();
        e.stopPropagation();
        setDrillQuery((q) => q.slice(0, -1));
      } else if (drilling && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Printable key while drilling → filter options, keep it out of the editor.
        e.preventDefault();
        e.stopPropagation();
        setDrillQuery((q) => q + e.key);
      }
    };
    dom.addEventListener('keydown', onKeyDown, true);
    return () => dom.removeEventListener('keydown', onKeyDown, true);
  }, [editor, enabled, close, exitDrill, select]);

  // Keep the menu glued to the trigger text while the view scrolls. The
  // coords captured at trigger time are viewport-relative (position:fixed),
  // so without this the menu stays put on screen while the text scrolls out
  // from under it. Recompute from the sigil's doc position on any scroll
  // and on resize. coordsAtPos can throw if the position is gone — close then.
  useEffect(() => {
    if (!editor || !enabled) return;
    const reposition = () => {
      const m = menuRef.current;
      if (!m) return;
      let coords;
      try {
        coords = editor.view.coordsAtPos(m.from);
      } catch {
        return close();
      }
      setMenu((prev) => (prev ? { ...prev, left: coords.left, top: coords.bottom } : prev));
    };
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [editor, enabled, close]);

  if (!menu) return null;

  const headerLabel = drill
    ? `${drill.groupName} ›${drillQuery ? ` ${drillQuery}` : ''}`
    : menu.family === 'entity'
      ? '@ reference'
      : '& rule';
  const emptyText = loading
    ? 'Searching…'
    : drill
      ? drillQuery
        ? 'No matching options'
        : 'No options'
      : menu.query
        ? 'No matches'
        : 'Type to search…';

  return createPortal(
    <div
      className="fixed z-[100] w-72 max-h-64 overflow-y-auto custom-scrollbar rounded-md border border-gold/35 bg-card shadow-xl shadow-black/30 py-1"
      style={{ left: menu.left, top: menu.top + 4 }}
      onMouseDown={(e) => e.preventDefault() /* keep editor focus */}
    >
      <div className="px-2.5 py-1 text-[10px] uppercase tracking-wider text-gold/65 border-b border-gold/15 flex items-center justify-between gap-2">
        <span className="truncate">{headerLabel}</span>
        {drill ? (
          <span className="text-ink/45 normal-case shrink-0">Esc: back</span>
        ) : loading ? (
          <span className="text-ink/45 shrink-0">…</span>
        ) : null}
      </div>
      {results.length === 0 ? (
        <div className="px-2.5 py-2 text-xs text-ink/55">{emptyText}</div>
      ) : (
        results.map((r, i) => {
          const isOptionItem = r.id.includes(':');
          const isGroupEntry = drill && r.kind === 'option-group' && !isOptionItem;
          const badge = isOptionItem ? 'option' : r.kind;
          return (
            <button
              key={`${r.kind}:${r.id}`}
              type="button"
              onMouseEnter={() => setActive(i)}
              onClick={() => select(r)}
              className={`w-full text-left px-2.5 py-1.5 flex items-center gap-2 text-sm ${
                i === active ? 'bg-gold/15 text-gold' : 'text-ink/85 hover:bg-gold/5'
              } ${isGroupEntry ? 'border-t border-gold/15' : ''}`}
            >
              <span className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-gold/15 text-gold/85 shrink-0">
                {badge}
              </span>
              <span className="flex-1 min-w-0 truncate">{r.label ?? r.name}</span>
              {!drill && r.kind === 'option-group' && !isOptionItem && (
                <span className="text-ink/35 shrink-0">›</span>
              )}
            </button>
          );
        })
      )}
    </div>,
    document.body,
  );
}
