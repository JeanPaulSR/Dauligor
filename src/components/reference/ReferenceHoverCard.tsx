import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { resolveReference, type RefResolved } from '../../lib/references';
import HoverCardView from './HoverCardView';

/**
 * App-wide reference hover card.
 *
 *  - 4a: hover any resolved `.ref-link` → an ephemeral Concept A card.
 *  - 4b: a pin button promotes the card to a draggable, session-persistent
 *    window with a close button and a "Go to" row.
 *  - 4c (here): cards STACK. Hovering a ref inside a card body — or an
 *    overflowing prerequisite line — opens a CHILD card without closing its
 *    parent; dismissing a child returns you to the parent. The ephemeral
 *    state is a chain (depth 0 = the page ref; depth d+1 = spawned from
 *    something inside depth d). Pinned windows are separate and persist.
 *
 * Grace logic: cards never close on the spawn event; a single delayed
 * "reap" re-reads the live `:hover` state and keeps depth 0..(deepest thing
 * the pointer is currently over), closing anything deeper. Re-reading
 * `:hover` AFTER the grace delay is what makes crossing the gap between a
 * parent and its child reliable.
 */

const SHOW_DELAY = 130;
const HIDE_DELAY = 200;
const CARD_W = 380;
const STORAGE_KEY = 'dauligor_pinned_refs_v1';

interface CardPos {
  left: number;
  top?: number;
  bottom?: number;
}

interface ChainCard {
  key: string;
  variant: 'ref' | 'prereq';
  kind: string;
  id: string;
  pos: CardPos;
  data: RefResolved | null;
  loading: boolean;
  prereqText?: string;
}

interface PinnedCard {
  pinId: string;
  kind: string;
  id: string;
  data: RefResolved | null;
  left: number;
  top: number;
}

function computePos(rect: DOMRect): CardPos {
  const left = Math.min(Math.max(8, rect.left), window.innerWidth - CARD_W - 8);
  const placeAbove = rect.bottom > window.innerHeight * 0.6;
  return placeAbove
    ? { left, bottom: window.innerHeight - rect.top + 6 }
    : { left, top: rect.bottom + 6 };
}

export default function ReferenceHoverCard() {
  const navigate = useNavigate();
  const [chain, setChain] = useState<ChainCard[]>([]);
  const [pinned, setPinned] = useState<PinnedCard[]>(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw) as Array<Omit<PinnedCard, 'data'>>;
      return arr.map((p) => ({ ...p, data: null }));
    } catch {
      return [];
    }
  });

  const cacheRef = useRef<Map<string, RefResolved | null>>(new Map());
  const chainRef = useRef<ChainCard[]>(chain);
  chainRef.current = chain;
  const cardElsRef = useRef<(HTMLDivElement | null)[]>([]);
  const rootSourceElRef = useRef<HTMLElement | null>(null);
  const hoveredSpawnRef = useRef<{ el: HTMLElement; depth: number } | null>(null);
  const showTimer = useRef<number | undefined>(undefined);
  const hideTimer = useRef<number | undefined>(undefined);

  const pinnedRef = useRef(pinned);
  pinnedRef.current = pinned;
  const dragRef = useRef<{ pinId: string; dx: number; dy: number } | null>(null);

  const cancelShow = useCallback(() => {
    if (showTimer.current) {
      clearTimeout(showTimer.current);
      showTimer.current = undefined;
    }
  }, []);
  const cancelHide = useCallback(() => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = undefined;
    }
  }, []);

  // Re-read live :hover and keep depth 0..(deepest thing under the pointer).
  const reap = useCallback(() => {
    const cur = chainRef.current;
    let keep = -1;
    for (let d = 0; d < cur.length; d++) {
      const el = cardElsRef.current[d];
      if (el && el.matches(':hover')) keep = Math.max(keep, d);
    }
    if (rootSourceElRef.current?.matches(':hover')) keep = Math.max(keep, 0);
    const hs = hoveredSpawnRef.current;
    if (hs && hs.el.matches(':hover')) keep = Math.max(keep, hs.depth);
    if (keep < 0) {
      rootSourceElRef.current = null;
      setChain([]);
    } else if (keep < cur.length - 1) {
      setChain(cur.slice(0, keep + 1));
    }
  }, []);

  const scheduleReap = useCallback(() => {
    cancelHide();
    hideTimer.current = window.setTimeout(reap, HIDE_DELAY);
  }, [cancelHide, reap]);

  // --- Hover detection (spawn root / child / prereq cards) -----------------
  useEffect(() => {
    const showRefCard = (el: HTMLElement, kind: string, id: string, depth: number) => {
      cancelShow();
      const rect = el.getBoundingClientRect();
      showTimer.current = window.setTimeout(() => {
        const pos = computePos(rect);
        const key = `${kind}:${id}`;
        if (depth === 0) rootSourceElRef.current = el;
        const cached = cacheRef.current.get(key);
        if (cached === null) {
          setChain((prev) => prev.slice(0, depth)); // known-missing → no card
          return;
        }
        setChain((prev) => {
          const next = prev.slice(0, depth);
          next[depth] = {
            key,
            variant: 'ref',
            kind,
            id,
            pos,
            data: cached ?? null,
            loading: cached === undefined,
          };
          return next;
        });
        if (cached === undefined) {
          resolveReference(kind, id)
            .then((data) => {
              cacheRef.current.set(key, data);
              setChain((prev) => {
                const card = prev[depth];
                if (!card || card.key !== key) return prev;
                if (data === null) return prev.slice(0, depth);
                const next = prev.slice();
                next[depth] = { ...card, data, loading: false };
                return next;
              });
            })
            .catch(() => {
              setChain((prev) => (prev[depth]?.key === key ? prev.slice(0, depth) : prev));
            });
        }
      }, SHOW_DELAY);
    };

    const showPrereqCard = (el: HTMLElement, text: string, depth: number) => {
      cancelShow();
      const rect = el.getBoundingClientRect();
      showTimer.current = window.setTimeout(() => {
        const pos = computePos(rect);
        setChain((prev) => {
          const next = prev.slice(0, depth);
          next[depth] = { key: `prereq:${depth}`, variant: 'prereq', kind: '', id: '', pos, data: null, loading: false, prereqText: text };
          return next;
        });
      }, SHOW_DELAY);
    };

    const depthOf = (node: HTMLElement | null): number => {
      const card = node?.closest('[data-hc-card]') as HTMLElement | null;
      return card ? Number(card.dataset.hcDepth) : -1;
    };

    const onOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest) return;

      const refEl = target.closest('.ref-link') as HTMLElement | null;
      if (refEl) {
        const kind = refEl.getAttribute('data-ref-kind');
        const id = refEl.getAttribute('data-ref-id');
        if (kind && id) {
          const childDepth = depthOf(refEl) + 1;
          hoveredSpawnRef.current = { el: refEl, depth: childDepth };
          cancelHide();
          if (chainRef.current[childDepth]?.key === `${kind}:${id}`) return;
          showRefCard(refEl, kind, id, childDepth);
        }
        return;
      }

      const pqEl = target.closest('[data-hc-prereq]') as HTMLElement | null;
      if (pqEl) {
        // Always reveal the full description on hover — the compact line may be
        // abbreviated (short override) or cut off. data-hc-prereq carries the
        // full text (free → composite → short).
        const full = pqEl.getAttribute('data-hc-prereq') || '';
        const childDepth = depthOf(pqEl) + 1;
        hoveredSpawnRef.current = { el: pqEl, depth: childDepth };
        cancelHide();
        if (!full) return;
        if (chainRef.current[childDepth]?.key === `prereq:${childDepth}`) return;
        showPrereqCard(pqEl, full, childDepth);
        return;
      }

      if (target.closest('[data-hc-card]')) {
        hoveredSpawnRef.current = null;
        cancelHide();
      }
    };

    const onOut = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t?.closest) return;
      if (t.closest('.ref-link') || t.closest('[data-hc-prereq]') || t.closest('[data-hc-card]')) {
        cancelShow();
        scheduleReap();
      }
    };

    const onScroll = () => {
      cancelShow();
      scheduleReap();
    };

    document.addEventListener('mouseover', onOver);
    document.addEventListener('mouseout', onOut);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mouseover', onOver);
      document.removeEventListener('mouseout', onOut);
      window.removeEventListener('scroll', onScroll, true);
      cancelShow();
      cancelHide();
    };
  }, [cancelShow, cancelHide, scheduleReap]);

  // --- Pinned-window persistence -------------------------------------------
  useEffect(() => {
    try {
      const descriptors = pinned.map(({ pinId, kind, id, left, top }) => ({ pinId, kind, id, left, top }));
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(descriptors));
    } catch {
      /* sessionStorage unavailable — pins just won't survive reload */
    }
  }, [pinned]);

  useEffect(() => {
    pinnedRef.current.forEach((p) => {
      if (p.data !== null) return;
      resolveReference(p.kind, p.id)
        .then((data) => {
          setPinned((prev) => prev.map((x) => (x.pinId === p.pinId && x.data === null ? { ...x, data } : x)));
        })
        .catch(() => {});
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Pin + drag -----------------------------------------------------------
  const onDragMove = useCallback((e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    setPinned((prev) => prev.map((p) => (p.pinId === d.pinId ? { ...p, left: e.clientX - d.dx, top: e.clientY - d.dy } : p)));
  }, []);

  const onDragEnd = useCallback(() => {
    dragRef.current = null;
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
  }, [onDragMove]);

  useEffect(
    () => () => {
      window.removeEventListener('pointermove', onDragMove);
      window.removeEventListener('pointerup', onDragEnd);
    },
    [onDragMove, onDragEnd],
  );

  const beginDrag = useCallback(
    (pinId: string, e: ReactPointerEvent) => {
      if ((e.target as HTMLElement).closest('button')) return;
      e.preventDefault();
      const p = pinnedRef.current.find((x) => x.pinId === pinId);
      if (!p) return;
      dragRef.current = { pinId, dx: e.clientX - p.left, dy: e.clientY - p.top };
      window.addEventListener('pointermove', onDragMove);
      window.addEventListener('pointerup', onDragEnd);
    },
    [onDragMove, onDragEnd],
  );

  const pin = (depth: number) => {
    const c = chainRef.current[depth];
    if (!c || c.variant !== 'ref' || !c.data) return;
    const rect = cardElsRef.current[depth]?.getBoundingClientRect();
    const left = rect ? Math.round(rect.left) : 120;
    const top = rect ? Math.round(rect.top) : 120;
    const pinId = `${c.key}:${Date.now()}`;
    setPinned((prev) => [...prev, { pinId, kind: c.kind, id: c.id, data: c.data, left, top }]);
    rootSourceElRef.current = null;
    setChain([]);
    cancelShow();
    cancelHide();
  };

  const closePin = (pinId: string) => setPinned((prev) => prev.filter((p) => p.pinId !== pinId));

  if (chain.length === 0 && pinned.length === 0) return null;

  return createPortal(
    <>
      {chain.map((c, d) => {
        const style = { left: c.pos.left, top: c.pos.top, bottom: c.pos.bottom, zIndex: 120 + d };
        if (c.variant === 'prereq') {
          return (
            <div
              key={`prereq-${d}`}
              ref={(el) => {
                cardElsRef.current[d] = el;
              }}
              data-hc-card=""
              data-hc-depth={d}
              className="fixed w-[260px] rounded-md border border-gold/30 bg-card shadow-xl shadow-black/40 px-3 py-2"
              style={style}
              onMouseEnter={cancelHide}
              onMouseLeave={scheduleReap}
            >
              <div className="text-[10px] uppercase tracking-wide text-gold/70 mb-1">Full prerequisite</div>
              <div className="text-xs text-ink/90">{c.prereqText}</div>
            </div>
          );
        }
        return (
          <HoverCardView
            key={`${c.key}-${d}`}
            variant="hover"
            depth={d}
            kind={c.kind}
            data={c.data}
            loading={c.loading}
            style={style}
            containerRef={(el) => {
              cardElsRef.current[d] = el;
            }}
            onMouseEnter={cancelHide}
            onMouseLeave={scheduleReap}
            onPin={() => pin(d)}
          />
        );
      })}
      {pinned.map((p) => (
        <HoverCardView
          key={p.pinId}
          variant="pinned"
          kind={p.kind}
          data={p.data}
          loading={false}
          style={{ left: p.left, top: p.top, zIndex: 115 }}
          onClose={() => closePin(p.pinId)}
          onTitlePointerDown={(e) => beginDrag(p.pinId, e)}
          onGoto={() => {
            if (p.data?.route) navigate(p.data.route);
          }}
        />
      ))}
    </>,
    document.body,
  );
}
