import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { ArrowRight, GripHorizontal, Pin, X } from 'lucide-react';
import type { RefResolved } from '../../lib/references';
import BBCodeRenderer from '../BBCodeRenderer';

/**
 * Presentational reference card (Concept A). Shared by the ephemeral hover
 * state (`variant="hover"`, shows a pin button) and the pinned pop-out
 * (`variant="pinned"`, shows a drag titlebar + close + "Go to" row). All
 * positioning, portalling, and interaction wiring live in the controller
 * (ReferenceHoverCard); this component is pure chrome.
 */

interface HoverCardViewProps {
  kind: string;
  data: RefResolved | null;
  loading: boolean;
  variant: 'hover' | 'pinned';
  style: CSSProperties;
  containerRef?: (el: HTMLDivElement | null) => void;
  depth?: number;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onPin?: () => void;
  onClose?: () => void;
  onTitlePointerDown?: (e: ReactPointerEvent) => void;
  onGoto?: () => void;
}

export default function HoverCardView({
  kind,
  data,
  loading,
  variant,
  style,
  containerRef,
  depth,
  onMouseEnter,
  onMouseLeave,
  onPin,
  onClose,
  onTitlePointerDown,
  onGoto,
}: HoverCardViewProps) {
  const pinned = variant === 'pinned';
  return (
    <div
      ref={containerRef}
      {...(variant === 'hover' ? { 'data-hc-card': '', 'data-hc-depth': depth } : {})}
      className="fixed w-[380px] rounded-lg border border-gold/30 bg-card shadow-2xl shadow-black/50 overflow-hidden"
      style={style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {pinned && (
        <div
          className="flex items-center gap-2 px-2 py-1 bg-white/5 border-b border-gold/15 cursor-grab active:cursor-grabbing select-none"
          onPointerDown={onTitlePointerDown}
        >
          <GripHorizontal className="w-3.5 h-3.5 text-ink/40" />
          <span className="text-[10px] uppercase tracking-wide text-ink/40">drag to move</span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto text-ink/40 hover:text-blood rounded p-0.5"
            title="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="relative px-3.5 pt-3 pb-2 border-b border-gold/15 bg-gradient-to-b from-gold/10 to-transparent">
        {!pinned && (
          <button
            type="button"
            onClick={onPin}
            className="absolute top-2 right-2 text-ink/40 hover:text-gold hover:bg-gold/10 rounded p-1 leading-none"
            title="Pin — pop out into a movable window"
          >
            <Pin className="w-3.5 h-3.5" />
          </button>
        )}
        <div className="font-serif text-lg font-semibold text-gold leading-tight pr-6">
          {loading ? 'Loading…' : (data?.name ?? '—')}
        </div>
        <div className="flex items-center gap-2 mt-1 min-w-0">
          <span className="shrink-0 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-gold/15 text-gold/80">
            {kind}
          </span>
          {data?.prereq ? (
            <span
              data-hc-prereq={data.prereqFull || data.prereq}
              className="min-w-0 truncate text-xs italic text-gold/70 cursor-help"
            >
              Prerequisite: {data.prereq}
            </span>
          ) : null}
        </div>
      </div>

      <div className="px-3.5 py-2.5 max-h-[215px] overflow-y-auto custom-scrollbar">
        {loading ? (
          <p className="text-sm text-ink/40 italic">Loading…</p>
        ) : data?.summary ? (
          <BBCodeRenderer content={data.summary} className="prose-sm" />
        ) : (
          <p className="text-sm text-ink/40 italic">No summary available.</p>
        )}
      </div>

      {pinned && data?.route ? (
        <div className="px-3.5 py-2 border-t border-dashed border-gold/20">
          <button
            type="button"
            onClick={onGoto}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-gold hover:underline"
          >
            <ArrowRight className="w-3.5 h-3.5" /> Go to {data.name}
          </button>
        </div>
      ) : null}
    </div>
  );
}
