import { useEffect, useMemo, useRef, useState } from 'react';
import BBCodeRenderer from '../BBCodeRenderer';
import LayoutBlocks from '../layout/LayoutBlocks';
import { collectAnchoredBlocks, type LayoutBlock } from '../../lib/layoutBlocks';
import type { SystemPage, ResolvedEntry } from '../../lib/systemPages';

/**
 * Reader for a system page. A system page is one block layout: prose/structure
 * blocks for the body, plus `definition` blocks for the addressable entries (the
 * `&kind[anchor]` / `#anchor` targets). When the page has definition blocks we
 * render the whole layout and build the Contents rail + scroll-spy from those
 * blocks. Pages not yet block-migrated fall back to the legacy flow: the block
 * (or description) body, then the `system_page_entries` glossary below.
 *
 * The right-hand Contents rail is pure typography — no border, no icons; the
 * active entry resolves to the accent colour in serif. `#anchor` deep-links from
 * `&condition[prone]` light up the matching entry on arrival.
 */
/* The space (px) the sticky site header / `scroll-mt-24` reserve at the top.
   A jumped-to section must clear this so its heading isn't hidden behind it. */
const HEADER_OFFSET = 96;

/**
 * Scroll a section into view CENTERED — but if the section is too tall to center
 * without pushing its top up behind the header, align its top just below the
 * header instead, so a large section always starts from the top rather than
 * landing the reader in its middle with the heading off-screen.
 */
function scrollSectionIntoView(el: HTMLElement, behavior: ScrollBehavior) {
  const rect = el.getBoundingClientRect();
  const absTop = rect.top + window.scrollY;
  // Where the section's top would sit in the viewport if perfectly centered.
  const centeredViewportTop = (window.innerHeight - rect.height) / 2;
  const top = centeredViewportTop >= HEADER_OFFSET
    ? absTop - centeredViewportTop   // fits — center it
    : absTop - HEADER_OFFSET;        // too tall — start at its top, below the header
  window.scrollTo({ top: Math.max(0, top), behavior });
}

interface SystemPageGlossaryProps {
  page: SystemPage;
  entries: ResolvedEntry[];
  /** Page content as a block layout. Includes `definition` blocks (entries) once
   *  the page is block-authored; falls back to a text block of the description. */
  blocks?: LayoutBlock[];
}

export default function SystemPageGlossary({ page, entries, blocks = [] }: SystemPageGlossaryProps) {
  // Entries authored as `definition` blocks (the unified model). When present,
  // they ARE the entries and the legacy `entries` glossary is suppressed.
  const anchoredBlocks = useMemo(() => collectAnchoredBlocks(blocks), [blocks]);
  const unified = anchoredBlocks.length > 0;

  // The Contents rail / scroll-spy items — from definition blocks (unified) or
  // the legacy entries table.
  const railItems = useMemo(
    () => (unified
      ? anchoredBlocks.map((b) => ({ id: b.anchor, name: b.name || b.anchor }))
      : entries.map((e) => ({ id: e.identifier, name: e.name }))),
    [unified, anchoredBlocks, entries],
  );
  const railKey = railItems.map((r) => r.id).join('|');

  const [activeId, setActiveId] = useState<string | null>(railItems[0]?.id ?? null);
  // The section the reader just JUMPED to (rail click or `&`-ref deep-link). It
  // stays visually highlighted until the next click anywhere on the page —
  // distinct from `activeId`, which the scroll-spy keeps updating as you scroll.
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const railRef = useRef<HTMLElement | null>(null);
  // Suppresses the scroll-spy briefly after a click, so intermediate entries
  // don't steal the active state mid smooth-scroll. Stores an epoch ms cutoff.
  const scrollLockRef = useRef(0);

  // Clear the jump highlight on the next click anywhere — except inside the
  // Contents rail, where a click re-jumps (and re-highlights) instead. Attached
  // a tick late so the click that set the highlight doesn't immediately clear it.
  useEffect(() => {
    if (!highlightedId) return;
    const onDocClick = (e: MouseEvent) => {
      if (railRef.current?.contains(e.target as Node)) return;
      setHighlightedId(null);
    };
    const t = window.setTimeout(() => document.addEventListener('click', onDocClick), 0);
    return () => { window.clearTimeout(t); document.removeEventListener('click', onDocClick); };
  }, [highlightedId]);

  // Scroll-spy: highlight the entry whose vertical center is nearest the
  // viewport's. Works for normal scrolling AND for centered clicks.
  useEffect(() => {
    if (railItems.length === 0) return;
    const sections = railItems
      .map((r) => document.getElementById(r.id))
      .filter((el): el is HTMLElement => !!el);
    if (sections.length === 0) return;
    const recompute = () => {
      if (Date.now() < scrollLockRef.current) return;
      const vCenter = window.innerHeight / 2;
      let best: { id: string; dist: number } | null = null;
      for (const s of sections) {
        const r = s.getBoundingClientRect();
        if (r.bottom < 0 || r.top > window.innerHeight) continue;
        const c = r.top + r.height / 2;
        const dist = Math.abs(c - vCenter);
        if (!best || dist < best.dist) best = { id: s.id, dist };
      }
      if (best) setActiveId(best.id);
    };
    const observer = new IntersectionObserver(recompute, {
      threshold: [0, 0.25, 0.5, 0.75, 1],
    });
    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [railKey]);

  // Click handler for the Contents rail: instant active state + controlled
  // smooth scroll (respects the section's `scroll-mt-24`), with the spy locked
  // until the scroll settles. Also updates the URL hash so deep-links work.
  const jumpTo = (entryId: string) => {
    setActiveId(entryId);
    setHighlightedId(entryId);
    scrollLockRef.current = Date.now() + 800;
    const el = document.getElementById(entryId);
    if (el) scrollSectionIntoView(el, 'smooth');
    if (typeof history !== 'undefined' && history.replaceState) {
      history.replaceState(null, '', `#${entryId}`);
    }
  };

  // Deep-link from a URL hash (`/system/condition#incapacitated` arriving from a
  // `&condition[incapacitated]` ref). Goes through the same path as a rail click.
  // The "done" ref flips INSIDE the rAF so React StrictMode's double-effect still
  // completes the jump.
  const initialJumpDoneRef = useRef(false);
  useEffect(() => {
    if (initialJumpDoneRef.current) return;
    if (railItems.length === 0) return;
    if (typeof window === 'undefined' || !window.location.hash) return;
    const anchor = decodeURIComponent(window.location.hash.slice(1));
    if (!anchor) return;
    const raf = window.requestAnimationFrame(() => {
      if (initialJumpDoneRef.current) return;
      initialJumpDoneRef.current = true;
      const el = document.getElementById(anchor);
      if (!el) return;
      setActiveId(anchor);
      setHighlightedId(anchor);
      scrollLockRef.current = Date.now() + 800;
      scrollSectionIntoView(el, 'auto');
    });
    return () => window.cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [railKey]);

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_180px] gap-12 items-start">
      {/* Main column */}
      <div className="min-w-0 space-y-8">
        <header className="space-y-1.5">
          <p className="label-text text-gold">System Page</p>
          <h1 className="h1-title">{page.name}</h1>
        </header>

        {unified ? (
          /* Unified: the whole page IS the block layout — body + definition
             entries (each rendered with its #anchor by LayoutBlocks). */
          <LayoutBlocks blocks={blocks} className="space-y-6 max-w-none" highlightedAnchor={highlightedId ?? undefined} />
        ) : (
          <>
            {/* Legacy: block (or description) body, then the entries glossary. */}
            {blocks.length > 0
              ? <LayoutBlocks blocks={blocks} className="space-y-6 max-w-none" highlightedAnchor={highlightedId ?? undefined} />
              : page.description ? <BBCodeRenderer content={page.description} /> : null}

            {entries.length === 0 ? (
              <div className="empty-state">
                <p className="description-text">No entries yet.</p>
              </div>
            ) : (
              <div className="flex flex-col">
                {entries.map((entry) => {
                  const isActive = activeId === entry.identifier;
                  const isHot = highlightedId === entry.identifier;
                  return (
                    <section
                      key={entry.identifier}
                      id={entry.identifier}
                      className={
                        'scroll-mt-24 px-5 py-4 border-l-2 transition-colors ' +
                        (isHot
                          ? 'bg-gold/[0.07] border-gold'
                          : isActive
                            ? 'bg-gold/[0.04] border-gold'
                            : 'border-transparent hover:bg-gold/[0.04] hover:border-gold/45')
                      }
                    >
                      <div className="flex items-center gap-3 mb-1.5">
                        {entry.imageUrl ? (
                          <img
                            src={entry.imageUrl}
                            alt=""
                            className="w-9 h-9 object-cover border border-gold/25 shrink-0"
                          />
                        ) : null}
                        <h2 className="h2-title text-gold flex-1 min-w-0">{entry.name}</h2>
                      </div>
                      {entry.body ? (
                        <BBCodeRenderer content={entry.body} />
                      ) : (
                        <p className="description-text text-ink/45">No description.</p>
                      )}
                    </section>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Contents rail — pure typography. */}
      {railItems.length > 0 ? (
        <aside ref={railRef} className="hidden lg:block sticky top-24 self-start">
          <p className="label-text text-gold/65 mb-3">Contents</p>
          <nav className="flex flex-col">
            {railItems.map((item) => {
              const isActive = activeId === item.id;
              return (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    jumpTo(item.id);
                  }}
                  className={
                    'font-serif text-[15px] leading-snug py-1.5 transition-colors ' +
                    (isActive
                      ? 'text-gold font-semibold'
                      : 'text-ink/45 hover:text-ink/75')
                  }
                >
                  {item.name}
                </a>
              );
            })}
          </nav>
        </aside>
      ) : null}
    </div>
  );
}
