import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/react';
import { searchReferenceFamily, type RefSearchResult } from '../lib/references';

/**
 * Inline @/& reference autocomplete for the TipTap editor (Phase 3).
 *
 * Dependency-free: detects the trigger from editor state, positions a
 * dropdown with ProseMirror's coordsAtPos, intercepts arrow/enter/escape
 * via a capture-phase keydown on the editor DOM, and inserts the reference
 * as plain `@kind[id]{Name}` text (matching the spec's text-based refs).
 *
 *   @<query>  → searches the ENTITY family (spell/class/subclass/feat/item/article)
 *   &<query>  → searches the RULE family (condition)
 *
 * Query is a single token (no spaces) — LIKE matching means "@fire" finds
 * "Fire Bolt". Multi-word search is a later refinement.
 */

interface MenuState {
  family: 'entity' | 'rule';
  query: string;
  from: number; // doc position of the sigil
  to: number; // cursor position
  left: number; // viewport px (for position: fixed)
  top: number;
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
  const [results, setResults] = useState<RefSearchResult[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);

  // Mirrors for the stable keydown listener (closure can't see fresh state).
  const menuRef = useRef<MenuState | null>(null);
  const resultsRef = useRef<RefSearchResult[]>([]);
  const activeRef = useRef(0);
  menuRef.current = menu;
  resultsRef.current = results;
  activeRef.current = active;

  const close = useCallback(() => {
    setMenu(null);
    setResults([]);
    setActive(0);
  }, []);

  const select = useCallback(
    (r: RefSearchResult) => {
      const m = menuRef.current;
      if (!editor || !m) return;
      const sigil = m.family === 'entity' ? '@' : '&';
      const refText = `${sigil}${r.kind}[${r.id}]{${r.name}} `;
      editor.chain().focus().insertContentAt({ from: m.from, to: m.to }, refText).run();
      close();
    },
    [editor, close],
  );

  // Detect the trigger on edits + caret moves.
  useEffect(() => {
    if (!editor || !enabled) return;
    const detect = () => {
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

  // Debounced search whenever the family or query changes.
  useEffect(() => {
    if (!menu) return;
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await searchReferenceFamily(menu.family, menu.query, 8);
        if (!cancelled) {
          setResults(r);
          setActive(0);
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
  }, [menu?.family, menu?.query]);

  // Keyboard: intercept nav/select/close before ProseMirror handles them.
  useEffect(() => {
    if (!editor || !enabled) return;
    const dom = editor.view.dom as HTMLElement;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!menuRef.current) return;
      const items = resultsRef.current;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
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
      }
    };
    dom.addEventListener('keydown', onKeyDown, true);
    return () => dom.removeEventListener('keydown', onKeyDown, true);
  }, [editor, enabled, close, select]);

  // Keep the menu glued to the trigger text while the view scrolls. The
  // coords captured at trigger time are viewport-relative (position:fixed),
  // so without this the menu stays put on screen while the text scrolls out
  // from under it. Recompute from the sigil's doc position on any scroll
  // (capture phase catches scroll in the editor's own scroll container too)
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

  return createPortal(
    <div
      className="fixed z-[100] w-72 max-h-64 overflow-y-auto custom-scrollbar rounded-md border border-gold/30 bg-card shadow-xl shadow-black/30 py-1"
      style={{ left: menu.left, top: menu.top + 4 }}
      onMouseDown={(e) => e.preventDefault() /* keep editor focus */}
    >
      <div className="px-2.5 py-1 text-[10px] uppercase tracking-wider text-gold/60 border-b border-gold/10 flex items-center justify-between">
        <span>{menu.family === 'entity' ? '@ reference' : '& rule'}</span>
        {loading && <span className="text-ink/40">…</span>}
      </div>
      {results.length === 0 ? (
        <div className="px-2.5 py-2 text-xs text-ink/50">
          {loading ? 'Searching…' : menu.query ? 'No matches' : 'Type to search…'}
        </div>
      ) : (
        results.map((r, i) => (
          <button
            key={`${r.kind}:${r.id}`}
            type="button"
            onMouseEnter={() => setActive(i)}
            onClick={() => select(r)}
            className={`w-full text-left px-2.5 py-1.5 flex items-center gap-2 text-sm ${
              i === active ? 'bg-gold/15 text-gold' : 'text-ink/80 hover:bg-gold/5'
            }`}
          >
            <span className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-gold/15 text-gold/80 shrink-0">
              {r.kind}
            </span>
            <span className="truncate">{r.name}</span>
          </button>
        ))
      )}
    </div>,
    document.body,
  );
}
