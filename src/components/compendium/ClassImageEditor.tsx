import React, { useRef, useEffect, useState } from 'react';
import { ImageUpload } from '../ui/ImageUpload';
import { Button } from '../ui/button';
import { Image as ImageIcon, X, ZoomIn, ZoomOut, Info } from 'lucide-react';
import { cn } from '../../lib/utils';
import { ImageMetadataModal } from '../ui/ImageMetadataModal';

// ── types ─────────────────────────────────────────────────────────────────────

export interface ImageDisplay {
  x: number;     // 0–100 objectPosition x
  y: number;     // 0–100 objectPosition y
  scale: number; // 1.0+  zoom multiplier
}

export const DEFAULT_DISPLAY: ImageDisplay = { x: 50, y: 50, scale: 1 };

// ── shared image renderer ─────────────────────────────────────────────────────
// Use this helper anywhere you render a class image so every site looks identical.

interface ClassImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  display: ImageDisplay;
}
export function ClassImageStyle({ display }: { display: ImageDisplay }): React.CSSProperties {
  return {
    objectPosition: `${display.x}% ${display.y}%`,
    ...(display.scale !== 1 && {
      transform: `scale(${display.scale})`,
      transformOrigin: `${display.x}% ${display.y}%`,
    }),
  };
}

// ── context panel ─────────────────────────────────────────────────────────────

interface ContextPanelProps {
  label: string;
  subtitle: string;
  aspectClass: string;
  image: string;
  display: ImageDisplay;
  onDisplayChange: (d: ImageDisplay) => void;
  onDisplayCommit: (d: ImageDisplay) => void;
  overlay?: React.ReactNode;
  // Override controls (omit = no override for this panel)
  overrideImageUrl?: string;
  onOverrideChange?: (url: string) => void;
  storagePath?: string;
  usingDefault?: boolean;
}

function ContextPanel({
  label, subtitle, aspectClass,
  image, display, onDisplayChange, onDisplayCommit, overlay,
  overrideImageUrl, onOverrideChange, storagePath, usingDefault,
}: ContextPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const dragDistance = useRef(0);

  // Keep refs to latest values so the wheel listener (added once) can read them
  const displayRef = useRef(display);
  displayRef.current = display;
  const onDisplayChangeRef = useRef(onDisplayChange);
  onDisplayChangeRef.current = onDisplayChange;
  const onDisplayCommitRef = useRef(onDisplayCommit);
  onDisplayCommitRef.current = onDisplayCommit;

  const [showUpload, setShowUpload] = useState(false);
  const canOverride = !!onOverrideChange;
  const hasOverride = !!overrideImageUrl;

  const wheelTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Non-passive wheel listener for zoom
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const newScale = parseFloat(Math.max(0.1, Math.min(5, displayRef.current.scale * factor)).toFixed(2));
      const next = { ...displayRef.current, scale: newScale };
      onDisplayChangeRef.current(next);
      
      // Debounce the commit to prevent massive re-renders in the parent editor
      if (wheelTimeoutRef.current) clearTimeout(wheelTimeoutRef.current);
      wheelTimeoutRef.current = setTimeout(() => {
        onDisplayCommitRef.current(next);
      }, 500);
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => {
      el.removeEventListener('wheel', handler);
      if (wheelTimeoutRef.current) clearTimeout(wheelTimeoutRef.current);
    };
  }, []);

  const handlePointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    lastPointerRef.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!lastPointerRef.current || e.buttons === 0) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const dx = e.clientX - lastPointerRef.current.x;
    const dy = e.clientY - lastPointerRef.current.y;
    lastPointerRef.current = { x: e.clientX, y: e.clientY };

    const cur = displayRef.current;
    const dxPct = (dx / rect.width) * 100 / cur.scale;
    const dyPct = (dy / rect.height) * 100 / cur.scale;

    onDisplayChangeRef.current({
      ...cur,
      x: parseFloat(Math.max(0, Math.min(100, cur.x - dxPct)).toFixed(1)),
      y: parseFloat(Math.max(0, Math.min(100, cur.y - dyPct)).toFixed(1)),
    });
  };

  const handlePointerUp = () => {
    if (lastPointerRef.current !== null) {
      onDisplayCommitRef.current(displayRef.current);
    }
    lastPointerRef.current = null;
  };

  const step = (delta: number) => {
    const newScale = parseFloat(Math.max(0.1, Math.min(5, displayRef.current.scale + delta)).toFixed(2));
    const next = { ...displayRef.current, scale: newScale };
    onDisplayChange(next);
    onDisplayCommit(next);
  };

  return (
    <div className="space-y-2">
      {/* header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className="label-text text-gold/80 uppercase block">{label}</span>
          <span className="label-text text-ink/40">{subtitle}</span>
        </div>
        {canOverride && (
          <div className="flex items-center gap-1.5 shrink-0">
            {hasOverride && (
              <button
                type="button"
                onClick={() => { onOverrideChange!(''); setShowUpload(false); }}
                className="label-text text-ink/40 hover:text-blood flex items-center gap-1"
              >
                <X className="w-2.5 h-2.5" /> Reset
              </button>
            )}
            <Button
              type="button" size="sm" variant="ghost"
              className={cn('h-6 w-6 p-0', showUpload ? 'btn-gold-solid' : 'btn-gold')}
              onClick={() => setShowUpload(v => !v)}
              title="Use a different image for this view"
            >
              <ImageIcon className="w-3 h-3" />
            </Button>
          </div>
        )}
      </div>

      {/* draggable / zoomable preview */}
      <div
        ref={containerRef}
        className={cn(
          'relative overflow-hidden rounded-lg select-none border border-gold/10',
          image ? 'cursor-grab active:cursor-grabbing' : '',
          aspectClass
        )}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        {image ? (
          <>
            <img
              src={image}
              className="absolute inset-0 w-full h-full object-cover pointer-events-none"
              style={ClassImageStyle({ display })}
              referrerPolicy="no-referrer"
              draggable={false}
              alt=""
            />
            {overlay}
            {usingDefault && (
              <div className="absolute top-1.5 left-1.5 pointer-events-none z-10">
                <span className="text-[8px] font-black uppercase tracking-widest bg-black/50 text-white/50 px-1.5 py-0.5 rounded">
                  default
                </span>
              </div>
            )}
          </>
        ) : (
          <div className="absolute inset-0 bg-ink/5 flex items-center justify-center">
            <ImageIcon className="w-8 h-8 text-gold/10" />
          </div>
        )}
      </div>

      {/* zoom controls */}
      {image && (
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-background/50 rounded-md border border-gold/10 px-1 py-0.5">
            <Button type="button" size="sm" variant="ghost" className="h-6 w-6 p-0 btn-gold" onClick={() => step(-0.1)}>
              <ZoomOut className="w-3 h-3" />
            </Button>
            <span className="label-text text-ink/40 w-8 text-center text-[10px]">
              {Math.round(display.scale * 100)}%
            </span>
            <Button type="button" size="sm" variant="ghost" className="h-6 w-6 p-0 btn-gold" onClick={() => step(0.1)}>
              <ZoomIn className="w-3 h-3" />
            </Button>
          </div>
        </div>
      )}

      {/* inline override upload */}
      {canOverride && showUpload && (
        <div className="border border-gold/10 rounded-md p-3 bg-card/30">
          <ImageUpload
            currentImageUrl={overrideImageUrl}
            storagePath={storagePath!}
            onUpload={(url) => { onOverrideChange!(url); if (url) setShowUpload(false); }}
          />
        </div>
      )}
    </div>
  );
}

// ── main export ───────────────────────────────────────────────────────────────

export interface ClassImageEditorProps {
  imageUrl: string;
  onImageUrlChange?: (url: string) => void;
  imageDisplay: ImageDisplay;
  onImageDisplayChange: (d: ImageDisplay) => void;

  cardImageUrl: string;
  onCardImageUrlChange: (url: string) => void;
  cardDisplay: ImageDisplay;
  onCardDisplayChange: (d: ImageDisplay) => void;

  previewImageUrl: string;
  onPreviewImageUrlChange: (url: string) => void;
  previewDisplay: ImageDisplay;
  onPreviewDisplayChange: (d: ImageDisplay) => void;

  storagePath: string;
  className?: string;
}

export function ClassImageEditor({
  imageUrl, onImageUrlChange,
  imageDisplay: propImageDisplay, onImageDisplayChange,
  cardImageUrl: propCardImageUrl, onCardImageUrlChange,
  cardDisplay: propCardDisplay, onCardDisplayChange,
  previewImageUrl: propPreviewImageUrl, onPreviewImageUrlChange,
  previewDisplay: propPreviewDisplay, onPreviewDisplayChange,
  storagePath, className,
}: ClassImageEditorProps) {
  // Local state for interactive editing — only commits to parent on pointer-up / wheel tick
  const [imageDisplay, setImageDisplay] = useState(propImageDisplay);
  const [cardImageUrl, setCardImageUrl] = useState(propCardImageUrl);
  const [cardDisplay, setCardDisplay] = useState(propCardDisplay);
  const [previewImageUrl, setPreviewImageUrl] = useState(propPreviewImageUrl);
  const [previewDisplay, setPreviewDisplay] = useState(propPreviewDisplay);

  // Sync from parent when props change (e.g. dialog reopened with fresh data)
  useEffect(() => { setImageDisplay(propImageDisplay); }, [propImageDisplay]);
  useEffect(() => { setCardDisplay(propCardDisplay); }, [propCardDisplay]);
  useEffect(() => { setCardImageUrl(propCardImageUrl); }, [propCardImageUrl]);
  useEffect(() => { setPreviewDisplay(propPreviewDisplay); }, [propPreviewDisplay]);
  useEffect(() => { setPreviewImageUrl(propPreviewImageUrl); }, [propPreviewImageUrl]);

  const cardImg = cardImageUrl || imageUrl;
  const prevImg = previewImageUrl || imageUrl;

  const [modalImageUrl, setModalImageUrl] = useState<string | null>(null);

  return (
    <div className={cn('space-y-2', className)}>
      <p className="label-text text-ink/40">
        Drag to pan · Scroll or use ± to zoom · <span className="text-gold/60">Camera icon</span> overrides the image for that view
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">

        {/* Detail View (primary, no override) */}
        <ContextPanel
          label="Detail View"
          subtitle="ClassView page"
          aspectClass="aspect-square"
          image={imageUrl}
          display={imageDisplay}
          onDisplayChange={setImageDisplay}
          onDisplayCommit={onImageDisplayChange}
          overrideImageUrl={imageUrl}
          onOverrideChange={onImageUrlChange}
          storagePath={storagePath}
        />

        {/* Card View */}
        <ContextPanel
          label="Card View"
          subtitle="ClassList grid"
          aspectClass="aspect-[4/5]"
          image={cardImg}
          display={cardDisplay}
          onDisplayChange={setCardDisplay}
          onDisplayCommit={onCardDisplayChange}
          overrideImageUrl={cardImageUrl}
          onOverrideChange={(url) => { setCardImageUrl(url); onCardImageUrlChange(url); }}
          storagePath={storagePath}
          usingDefault={!cardImageUrl}
          overlay={
            <>
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-transparent opacity-80" />
              <div className="absolute inset-x-0 bottom-0 p-2 text-center z-10">
                <span className="text-[9px] font-black uppercase text-gold tracking-widest drop-shadow-sm">Class Name</span>
              </div>
            </>
          }
        />

        {/* Preview Header */}
        <ContextPanel
          label="Preview Header"
          subtitle="Quick-view panel"
          aspectClass="aspect-[3/1]"
          image={prevImg}
          display={previewDisplay}
          onDisplayChange={setPreviewDisplay}
          onDisplayCommit={onPreviewDisplayChange}
          overrideImageUrl={previewImageUrl}
          onOverrideChange={(url) => { setPreviewImageUrl(url); onPreviewImageUrlChange(url); }}
          storagePath={storagePath}
          usingDefault={!previewImageUrl}
          overlay={
            <>
              <div className="absolute inset-0 bg-gradient-to-t from-background to-background/20" />
              <div className="absolute inset-0 opacity-30 bg-black" />
              <div className="absolute inset-x-0 bottom-0 p-2 pl-3 z-10">
                <span className="text-[9px] font-black uppercase text-gold tracking-widest drop-shadow-sm">Class Name</span>
              </div>
            </>
          }
        />

      </div>

      {/* Metadata Buttons Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2">
        <div>
          {imageUrl && (
            <Button type="button" size="sm" variant="ghost" className="w-full h-8 text-xs border border-gold/10 text-gold/60 hover:text-gold hover:border-gold/30" onClick={() => setModalImageUrl(imageUrl)}>
              <Info className="w-3 h-3 mr-1.5" /> Edit Metadata
            </Button>
          )}
        </div>
        <div>
          {cardImg && (
            <Button type="button" size="sm" variant="ghost" className="w-full h-8 text-xs border border-gold/10 text-gold/60 hover:text-gold hover:border-gold/30" onClick={() => setModalImageUrl(cardImg)}>
              <Info className="w-3 h-3 mr-1.5" /> Edit Metadata
            </Button>
          )}
        </div>
        <div>
          {prevImg && (
            <Button type="button" size="sm" variant="ghost" className="w-full h-8 text-xs border border-gold/10 text-gold/60 hover:text-gold hover:border-gold/30" onClick={() => setModalImageUrl(prevImg)}>
              <Info className="w-3 h-3 mr-1.5" /> Edit Metadata
            </Button>
          )}
        </div>
      </div>

      <ImageMetadataModal
        isOpen={!!modalImageUrl}
        onClose={() => setModalImageUrl(null)}
        imageUrl={modalImageUrl!}
      />
    </div>
  );
}
