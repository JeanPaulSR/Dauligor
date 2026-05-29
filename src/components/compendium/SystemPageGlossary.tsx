import { useEffect, useRef, useState } from 'react';
import BBCodeRenderer from '../BBCodeRenderer';
import type { SystemPage, ResolvedEntry } from '../../lib/systemPages';

/**
 * Reader for a system page — a quiet article: title, the admin-authored
 * description (rendered straight, no imposed styling — the admin shapes it via
 * BBCode), and then each entry as a flat block. Blocks are chrome-free at rest;
 * a soft accent fill + left rule appears on hover or when an entry is targeted
 * (so a `&condition[prone]` deep-link lights its block up on arrival). The
 * right-hand Contents rail is pure typography — no border, no icons, the active
 * entry just resolves to the accent colour in serif.
 */
interface SystemPageGlossaryProps {
  page: SystemPage;
  entries: ResolvedEntry[];
}

export default function SystemPageGlossary({ page, entries }: SystemPageGlossaryProps) {
  const [activeId, setActiveId] = useState<string | null>(entries[0]?.identifier ?? null);
  // Suppresses the scroll-spy briefly after a click, so intermediate entries
  // don't steal the active state mid smooth-scroll. Stores an epoch ms cutoff.
  const scrollLockRef = useRef(0);

  // Scroll-spy: highlight the entry whose vertical center is nearest the
  // viewport's. Works for normal scrolling AND for centered clicks (a top-band
  // spy would let the entry above a centered one steal the active state).
  useEffect(() => {
    if (entries.length === 0) return;
    const sections = entries
      .map((e) => document.getElementById(e.identifier))
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
  }, [entries]);

  // Click handler for the Contents rail: instant active state + controlled
  // smooth scroll (respects the section's `scroll-mt-24`), with the spy locked
  // until the scroll settles. Also updates the URL hash so deep-links work.
  const jumpTo = (entryId: string) => {
    setActiveId(entryId);
    scrollLockRef.current = Date.now() + 800;
    const el = document.getElementById(entryId);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (typeof history !== 'undefined' && history.replaceState) {
      history.replaceState(null, '', `#${entryId}`);
    }
  };

  // Deep-link from a URL hash (`/system/condition#incapacitated` arriving from
  // a `&Reference[condition=incapacitated]` ref). Goes through the same path
  // as a rail click — set active + lock the spy — so the entry we jump to is
  // the one that ends up highlighted, even if it's short and the next entry
  // would otherwise win the "closest to viewport center" race. Instant scroll
  // (not smooth) since this is the initial landing, not an in-page nav.
  //
  // Subtle: the "done" ref is flipped INSIDE the rAF callback (not at effect
  // entry) so React StrictMode's double-effect in dev — cleanup cancels the
  // first rAF, then a second run schedules a fresh one — still completes the
  // jump. Otherwise the cleanup would cancel the jump and the second pass
  // would skip rescheduling, leaving the page wherever the browser's native
  // anchor handling put it (often the wrong entry once the page rendered).
  const initialJumpDoneRef = useRef(false);
  useEffect(() => {
    if (initialJumpDoneRef.current) return;
    if (entries.length === 0) return;
    if (typeof window === 'undefined' || !window.location.hash) return;
    const anchor = decodeURIComponent(window.location.hash.slice(1));
    if (!anchor) return;
    const raf = window.requestAnimationFrame(() => {
      if (initialJumpDoneRef.current) return;
      initialJumpDoneRef.current = true;
      const el = document.getElementById(anchor);
      if (!el) return;
      setActiveId(anchor);
      scrollLockRef.current = Date.now() + 800;
      el.scrollIntoView({ behavior: 'auto', block: 'center' });
    });
    return () => window.cancelAnimationFrame(raf);
  }, [entries]);

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_180px] gap-12 items-start">
      {/* Main column */}
      <div className="min-w-0 space-y-8">
        <header className="space-y-1.5">
          <p className="label-text text-gold">System Page</p>
          <h1 className="h1-title">{page.name}</h1>
        </header>

        {/* Description — rendered straight from the admin's BBCode, no wrapper
            styling. They control the styling via BBCode. */}
        {page.description ? <BBCodeRenderer content={page.description} /> : null}

        {entries.length === 0 ? (
          <div className="empty-state">
            <p className="description-text">No entries yet.</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {entries.map((entry) => {
              const isActive = activeId === entry.identifier;
              return (
                <section
                  key={entry.identifier}
                  id={entry.identifier}
                  className={
                    'scroll-mt-24 px-5 py-4 border-l-2 transition-colors ' +
                    (isActive
                      ? 'bg-gold/[0.04] border-gold'
                      : 'border-transparent hover:bg-gold/[0.04] hover:border-gold/40')
                  }
                >
                  <div className="flex items-center gap-3 mb-1.5">
                    {entry.imageUrl ? (
                      <img
                        src={entry.imageUrl}
                        alt=""
                        className="w-9 h-9 object-cover border border-gold/20 shrink-0"
                      />
                    ) : null}
                    <h2 className="h2-title text-gold flex-1 min-w-0">{entry.name}</h2>
                  </div>
                  {entry.body ? (
                    <BBCodeRenderer content={entry.body} />
                  ) : (
                    <p className="description-text text-ink/40">No description.</p>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>

      {/* Contents rail — pure typography, no chrome line, no icons. The active
          entry resolves to the accent colour in serif; everything else is muted
          ink and lifts on hover. */}
      {entries.length > 0 ? (
        <aside className="hidden lg:block sticky top-24 self-start">
          <p className="label-text text-gold/60 mb-3">Contents</p>
          <nav className="flex flex-col">
            {entries.map((entry) => {
              const isActive = activeId === entry.identifier;
              return (
                <a
                  key={entry.identifier}
                  href={`#${entry.identifier}`}
                  onClick={(e) => {
                    e.preventDefault();
                    jumpTo(entry.identifier);
                  }}
                  className={
                    'font-serif text-[15px] leading-snug py-1.5 transition-colors ' +
                    (isActive
                      ? 'text-gold font-semibold'
                      : 'text-ink/40 hover:text-ink/70')
                  }
                >
                  {entry.name}
                </a>
              );
            })}
          </nav>
        </aside>
      ) : null}
    </div>
  );
}
