// =============================================================================
// FocalImageField — generic "system image with focal positioning" control.
// =============================================================================
//
// A single image slot you can drag-to-pan, scroll/±-to-zoom, and swap via an
// override upload. Not tied to any entity — classes, campaigns, eras, etc. can
// all use it. ClassImageEditor composes three of these; campaigns use one.
// =============================================================================

import React, { useRef, useEffect, useState } from 'react';
import { ImageUpload } from './ImageUpload';
import { IconPickerModal } from './IconPickerModal';
import { Button } from './button';
import { Image as ImageIcon, X, ZoomIn, ZoomOut, Search } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface ImageDisplay {
  x: number;     // 0–100 objectPosition x
  y: number;     // 0–100 objectPosition y
  scale: number; // 1.0+  zoom multiplier
}

export const DEFAULT_DISPLAY: ImageDisplay = { x: 50, y: 50, scale: 1 };

// Shared style helper — use anywhere a focal image is rendered so every site
// positions identically. (Exported from ClassImageEditor as ClassImageStyle
// for back-compat with existing callers.)
export function imageFocalStyle({ display }: { display?: ImageDisplay | null }): React.CSSProperties {
  const cur = display || DEFAULT_DISPLAY;
  return {
    objectPosition: `${cur.x}% ${cur.y}%`,
    ...(cur.scale !== 1 && {
      transform: `scale(${cur.scale})`,
      transformOrigin: `${cur.x}% ${cur.y}%`,
    }),
  };
}

export interface FocalImageFieldProps {
  image: string;
  // Focal positioning is OPTIONAL. Provide display + onDisplayChange to enable
  // drag-to-pan / scroll-zoom (e.g. an avatar you frame). Omit them for a
  // static cover preview (e.g. a page background that always renders centered).
  display?: ImageDisplay;
  onDisplayChange?: (d: ImageDisplay) => void;
  onDisplayCommit?: (d: ImageDisplay) => void;
  storagePath: string;
  aspectClass?: string;          // default aspect-square
  label?: string;                // omit → no header text (surrounding UI labels it)
  subtitle?: string;
  overrideImageUrl?: string;     // omit override props → no swap control
  onOverrideChange?: (url: string) => void;
  overlay?: React.ReactNode;     // decorative content drawn over the preview
  usingDefault?: boolean;        // show a small "default" badge
  backdrop?: boolean;            // dim + "page backdrop" hint (faint full-bleed art)
  browseRoot?: string;          // R2 prefix to browse for an existing image (omit → no browse)
  // How to set/replace the image: an inline dropzone (default) or a button that
  // opens the image manager (browse the library + upload).
  uploadVariant?: 'dropzone' | 'manager';
  // Render the set/replace control ABOVE the framed preview, so a row of fields
  // keeps its controls aligned at the top while the variable-height previews hang
  // below.
  controlsOnTop?: boolean;
  // Restrict the image manager's root to these folder names (the "System Images"
  // sections), so the picker browses curated system art, not the user library.
  imageManagerFolders?: readonly string[];
  className?: string;
}

export function FocalImageField({
  image, display, onDisplayChange, onDisplayCommit,
  storagePath, aspectClass = 'aspect-square',
  label, subtitle, overrideImageUrl, onOverrideChange, overlay, usingDefault, backdrop, browseRoot,
  uploadVariant = 'dropzone', controlsOnTop, imageManagerFolders, className,
}: FocalImageFieldProps) {
  const positionable = !!onDisplayChange;
  const containerRef = useRef<HTMLDivElement>(null);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const validDisplay = display || DEFAULT_DISPLAY;

  // Refs so the (once-attached) wheel listener reads the latest values.
  const displayRef = useRef(validDisplay);
  displayRef.current = validDisplay;
  const onDisplayChangeRef = useRef(onDisplayChange);
  onDisplayChangeRef.current = onDisplayChange;
  const onDisplayCommitRef = useRef(onDisplayCommit);
  onDisplayCommitRef.current = onDisplayCommit;

  const canOverride = !!onOverrideChange;
  const hasOverride = !!overrideImageUrl;
  const hasHeader = !!label || canOverride;

  const wheelTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Non-passive wheel listener for zoom — only when positioning is enabled.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !positionable) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const cur = displayRef.current || DEFAULT_DISPLAY;
      const newScale = parseFloat(Math.max(0.1, Math.min(5, cur.scale * factor)).toFixed(2));
      const next = { ...cur, scale: newScale };
      onDisplayChangeRef.current?.(next);
      if (wheelTimeoutRef.current) clearTimeout(wheelTimeoutRef.current);
      wheelTimeoutRef.current = setTimeout(() => { onDisplayCommitRef.current?.(next); }, 500);
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => {
      el.removeEventListener('wheel', handler);
      if (wheelTimeoutRef.current) clearTimeout(wheelTimeoutRef.current);
    };
    // `image` is a dep so the listener (re)attaches when the positionable preview
    // box mounts — e.g. right after the first upload swaps the empty uploader for
    // the framed image.
  }, [positionable, image]);

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
    const cur = displayRef.current || DEFAULT_DISPLAY;
    const dxPct = (dx / rect.width) * 100 / cur.scale;
    const dyPct = (dy / rect.height) * 100 / cur.scale;
    onDisplayChangeRef.current?.({
      ...cur,
      x: parseFloat(Math.max(0, Math.min(100, cur.x - dxPct)).toFixed(1)),
      y: parseFloat(Math.max(0, Math.min(100, cur.y - dyPct)).toFixed(1)),
    });
  };

  const handlePointerUp = () => {
    if (lastPointerRef.current !== null) {
      onDisplayCommitRef.current?.(displayRef.current || DEFAULT_DISPLAY);
    }
    lastPointerRef.current = null;
  };

  const step = (delta: number) => {
    const cur = displayRef.current || DEFAULT_DISPLAY;
    const newScale = parseFloat(Math.max(0.1, Math.min(5, cur.scale + delta)).toFixed(2));
    const next = { ...cur, scale: newScale };
    onDisplayChange?.(next);
    onDisplayCommit?.(next);
  };

  // The set/replace control: either a button that opens the image manager, or the
  // inline dropzone. Defined once so it can sit above OR below the preview.
  const uploadControl = !canOverride ? null : uploadVariant === 'manager' ? (
    <Button
      type="button"
      variant="outline"
      className="w-full border-gold/25 hover:bg-gold/15 gap-2"
      onClick={() => setPickerOpen(true)}
    >
      <ImageIcon className="w-4 h-4" /> {image ? 'Replace Image' : 'Choose Image'}
    </Button>
  ) : (
    <ImageUpload
      currentImageUrl=""
      storagePath={storagePath}
      onUpload={(url) => { if (url) onOverrideChange!(url); }}
    />
  );

  return (
    <div className={cn('space-y-2', className)}>
      {hasHeader && (
        <div className={cn('flex items-start gap-2', label ? 'justify-between' : 'justify-end')}>
          {label && (
            <div>
              <span className="label-text text-gold/85 uppercase block">{label}</span>
              {subtitle && <span className="label-text text-ink/45">{subtitle}</span>}
            </div>
          )}
          {canOverride && (
            <div className="flex items-center gap-1.5 shrink-0">
              {hasOverride && (
                <button
                  type="button"
                  onClick={() => onOverrideChange!('')}
                  className="label-text text-ink/45 hover:text-blood flex items-center gap-1"
                >
                  <X className="w-2.5 h-2.5" /> Reset
                </button>
              )}
              {browseRoot && image && uploadVariant !== 'manager' && (
                <Button
                  type="button" size="sm" variant="ghost"
                  className="h-6 w-6 p-0 btn-gold"
                  onClick={() => setPickerOpen(true)}
                  title="Browse existing images"
                >
                  <Search className="w-3 h-3" />
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Controls above the preview (opt-in) — keeps a row of fields aligned. */}
      {controlsOnTop && uploadControl}

      {/* Framed, draggable / zoomable preview — shown once an image exists. */}
      {image ? (
        <div
          ref={containerRef}
          className={cn(
            'relative overflow-hidden rounded-lg select-none border border-gold/15',
            positionable ? 'cursor-grab active:cursor-grabbing' : '',
            aspectClass,
          )}
          onPointerDown={positionable ? handlePointerDown : undefined}
          onPointerMove={positionable ? handlePointerMove : undefined}
          onPointerUp={positionable ? handlePointerUp : undefined}
          onPointerLeave={positionable ? handlePointerUp : undefined}
        >
          <img
            src={image}
            className="absolute inset-0 w-full h-full object-cover pointer-events-none"
            style={imageFocalStyle({ display })}
            referrerPolicy="no-referrer"
            draggable={false}
            alt=""
          />
          {overlay}
          {backdrop && (
            <>
              <div className="absolute inset-0 bg-gradient-to-t from-background/80 via-background/25 to-transparent pointer-events-none" />
              <span className="absolute top-2 left-2 text-[9px] font-bold uppercase tracking-widest text-gold bg-background/70 px-2 py-0.5 rounded pointer-events-none">
                Page backdrop
              </span>
            </>
          )}
          {usingDefault && (
            <div className="absolute top-1.5 left-1.5 pointer-events-none z-10">
              <span className="text-[8px] font-black uppercase tracking-widest bg-black/50 text-white/50 px-1.5 py-0.5 rounded">
                default
              </span>
            </div>
          )}
        </div>
      ) : !canOverride ? (
        <div className={cn('relative overflow-hidden rounded-lg border border-gold/15', aspectClass)}>
          <div className="absolute inset-0 bg-ink/5 flex items-center justify-center">
            <ImageIcon className="w-8 h-8 text-gold/15" />
          </div>
        </div>
      ) : null}

      {/* zoom controls */}
      {image && positionable && (
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-background/50 rounded-md border border-gold/15 px-1 py-0.5">
            <Button type="button" size="sm" variant="ghost" className="h-6 w-6 p-0 btn-gold" onClick={() => step(-0.1)}>
              <ZoomOut className="w-3 h-3" />
            </Button>
            <span className="label-text text-ink/45 w-8 text-center text-[10px]">
              {Math.round(validDisplay.scale * 100)}%
            </span>
            <Button type="button" size="sm" variant="ghost" className="h-6 w-6 p-0 btn-gold" onClick={() => step(0.1)}>
              <ZoomIn className="w-3 h-3" />
            </Button>
          </div>
        </div>
      )}

      {/* Set / replace control below the preview (default placement). */}
      {!controlsOnTop && uploadControl}

      {canOverride && (browseRoot || uploadVariant === 'manager') && (
        <IconPickerModal
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onSelect={(url) => { onOverrideChange!(url); setPickerOpen(false); }}
          rootFolder={browseRoot || storagePath}
          title="Image Manager"
          allowUpload={uploadVariant === 'manager'}
          folderAllowList={imageManagerFolders}
        />
      )}
    </div>
  );
}
