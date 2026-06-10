// =============================================================================
// ImageSetEditor — a default image + N framable "windows" onto it.
// =============================================================================
//
// The shared image-authoring control for entities that show the same artwork in
// several places (a class shows Detail / Card / Preview; an article shows Header
// / Wiki Card / Hover Preview). The model, per the class editor it was lifted
// from:
//
//   1. Pick ONE default image (the base artwork) — the standalone uploader.
//   2. "Edit Display" opens a dialog of WINDOWS. Each window defaults to the
//      base image and you drag-to-pan / scroll-to-zoom to choose the visible
//      crop for that aspect ratio.
//   3. A window can be OVERRIDDEN with a different image (its camera control) —
//      the explicit "replace this window's picture" action; clearing it falls
//      back to the base again.
//
// The window set (labels, aspect ratios, overlays) is supplied by the caller, so
// classes and articles share the exact same control with different windows.
// Built on FocalImageField (the single framable slot) + ImageUpload (the base
// dropzone). ImageDisplay / DEFAULT_DISPLAY come from FocalImageEditor.
// =============================================================================

import React, { useState, useEffect } from 'react';
import { Button } from './button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './dialog';
import { ImageUpload } from './ImageUpload';
import { ImageMetadataModal } from './ImageMetadataModal';
import { FocalImageField, DEFAULT_DISPLAY, type ImageDisplay } from './FocalImageEditor';
import { Sliders, Trash2, Check, Info, Image as ImageIcon } from 'lucide-react';
import { SYSTEM_IMAGE_FOLDERS } from '../../lib/imageLibrary';
import { cn } from '../../lib/utils';

// Convenience re-exports so callers can grab everything from one module.
export { DEFAULT_DISPLAY };
export type { ImageDisplay };

export interface ImageWindow {
  /** Stable key + React key. */
  key: string;
  label: string;
  subtitle?: string;
  /** Tailwind aspect class for this window's frame, e.g. 'aspect-square',
   *  'aspect-[4/5]', 'aspect-[5/2]'. This is the per-context "window shape". */
  aspectClass: string;
  display: ImageDisplay;
  onDisplayChange: (d: ImageDisplay) => void;
  /** Decorative content drawn over the frame (e.g. a name banner). */
  overlay?: React.ReactNode;
  /** The BASE window edits the default image directly and never falls back. */
  base?: boolean;
  /** Override image for a non-base window (falls back to the base when empty). */
  imageUrl?: string;
  onImageUrlChange?: (url: string) => void;
}

/**
 * One framed window. Holds the focal display in LOCAL state during a drag/zoom so
 * the (potentially heavy) host editor only re-renders on commit (pointer-up /
 * wheel-settle), not on every pointer move — mirroring the original
 * ClassImageEditor's local-state pattern.
 */
function WindowFrame({
  w, baseImage, storagePath, browseRoot, onMeta, onBaseImageChange, uploadVariant, controlsOnTop, imageManagerFolders,
}: {
  w: ImageWindow;
  baseImage: string;
  storagePath: string;
  browseRoot?: string;
  onMeta: (url: string) => void;
  onBaseImageChange: (url: string) => void;
  uploadVariant?: 'dropzone' | 'manager';
  controlsOnTop?: boolean;
  imageManagerFolders?: readonly string[];
}) {
  const [display, setDisplay] = useState(w.display);
  useEffect(() => { setDisplay(w.display); }, [w.display]);

  const effective = w.base ? baseImage : (w.imageUrl || baseImage);

  return (
    <div className="space-y-2">
      <FocalImageField
        label={w.label}
        subtitle={w.subtitle}
        aspectClass={w.aspectClass}
        image={effective}
        display={display}
        onDisplayChange={setDisplay}        // live (local) — no host re-render
        onDisplayCommit={w.onDisplayChange} // commit to the host on settle
        overrideImageUrl={w.base ? baseImage : w.imageUrl}
        onOverrideChange={w.base ? onBaseImageChange : w.onImageUrlChange}
        storagePath={storagePath}
        browseRoot={browseRoot}
        usingDefault={!w.base && !w.imageUrl}
        overlay={w.overlay}
        uploadVariant={uploadVariant}
        controlsOnTop={controlsOnTop}
        imageManagerFolders={imageManagerFolders}
      />
      {effective && (
        <Button
          type="button" size="sm" variant="ghost"
          className="w-full h-8 text-xs border border-gold/15 text-gold/65 hover:text-gold hover:border-gold/35"
          onClick={() => onMeta(effective)}
        >
          <Info className="w-3 h-3 mr-1.5" /> Edit Metadata
        </Button>
      )}
    </div>
  );
}

export interface ImageSetEditorProps {
  /** The default/base artwork — used by every window that has no override. */
  baseImage: string;
  onBaseImageChange: (url: string) => void;
  windows: ImageWindow[];
  storagePath: string;
  /** Label above the base uploader (e.g. "Class Icon / Artwork"). */
  label?: string;
  /** Dialog title. Defaults to "Edit Image Display". */
  dialogTitle?: string;
  /** R2 prefix to browse for an existing image (omit → upload only). */
  browseRoot?: string;
  /** Set/replace images via the image manager (browse the library + upload)
   *  instead of an inline dropzone. */
  useImageManager?: boolean;
  /** Align each window's controls at the top, previews below (tidy row). */
  controlsOnTop?: boolean;
  /** Browse the "System Images" sections (curated entity art under images/),
   *  not the general user library. Implies the image manager. */
  systemImages?: boolean;
  className?: string;
}

export function ImageSetEditor({
  baseImage, onBaseImageChange, windows, storagePath,
  label, dialogTitle = 'Edit Image Display', browseRoot, useImageManager, controlsOnTop, systemImages, className,
}: ImageSetEditorProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [modalImageUrl, setModalImageUrl] = useState<string | null>(null);
  const baseAspect = windows.find((w) => w.base)?.aspectClass ?? 'aspect-video';
  // System-images mode browses images/ but limited to the curated system folders.
  const effectiveBrowseRoot = systemImages ? 'images' : browseRoot;
  const folderAllowList = systemImages ? SYSTEM_IMAGE_FOLDERS : undefined;

  return (
    <div className={cn('space-y-2', className)}>
      {label && (
        <label className="label-text text-gold/65 block uppercase tracking-widest text-xs">{label}</label>
      )}

      {(useImageManager || systemImages) ? (
        /* Image-manager mode: the control opens the Edit Display dialog; each
           window inside picks its own image from the manager. */
        <div className="space-y-2">
          {baseImage && (
            <div className={cn('relative rounded-lg overflow-hidden border border-gold/15', baseAspect)}>
              <img src={baseImage} alt="" className="absolute inset-0 w-full h-full object-cover" referrerPolicy="no-referrer" />
            </div>
          )}
          <Button type="button" className="w-full btn-gold gap-2" onClick={() => setDialogOpen(true)}>
            <ImageIcon className="w-4 h-4" /> {baseImage ? 'Edit Images' : 'Choose Image'}
          </Button>
          {baseImage && (
            <Button
              type="button" size="sm" variant="ghost"
              className="w-full h-8 text-xs text-blood/60 hover:text-blood hover:bg-blood/10 border border-blood/20 gap-2"
              onClick={() => onBaseImageChange('')}
            >
              <Trash2 className="w-3 h-3" /> Delete Image
            </Button>
          )}
        </div>
      ) : (
        /* Dropzone mode: inline uploader + (once a base exists) Edit Display + Delete. */
        <>
          <ImageUpload
            currentImageUrl={baseImage}
            storagePath={storagePath}
            onUpload={onBaseImageChange}
            browseRoot={browseRoot}
          />
          {baseImage && (
            <div className="space-y-2">
              <Button
                type="button"
                size="sm"
                className="w-full btn-gold gap-2"
                onClick={() => setDialogOpen(true)}
              >
                <Sliders className="w-3 h-3" /> Edit Display
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="w-full h-8 text-xs text-blood/60 hover:text-blood hover:bg-blood/10 border border-blood/20 gap-2"
                onClick={() => onBaseImageChange('')}
              >
                <Trash2 className="w-3 h-3" /> Delete Image
              </Button>
            </div>
          )}
        </>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="dialog-content sm:max-w-5xl w-[95vw]">
          <DialogHeader className="dialog-header">
            <DialogTitle className="dialog-title">{dialogTitle}</DialogTitle>
          </DialogHeader>
          <div className="dialog-body max-h-[80vh] overflow-y-auto custom-scrollbar">
            <p className="label-text text-ink/45 mb-3">
              Drag to pan · Scroll or use ± to zoom · each window can override the default image
            </p>
            {/* auto-fit so any window count lays out without hardcoding columns */}
            <div
              className="grid gap-6 items-start"
              style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}
            >
              {windows.map((w) => (
                <WindowFrame
                  key={w.key}
                  w={w}
                  baseImage={baseImage}
                  storagePath={storagePath}
                  browseRoot={effectiveBrowseRoot}
                  onMeta={setModalImageUrl}
                  onBaseImageChange={onBaseImageChange}
                  uploadVariant={(useImageManager || systemImages) ? 'manager' : 'dropzone'}
                  controlsOnTop={controlsOnTop}
                  imageManagerFolders={folderAllowList}
                />
              ))}
            </div>
          </div>
          <DialogFooter className="dialog-footer">
            <Button onClick={() => setDialogOpen(false)} className="btn-gold-solid px-8">
              <Check className="w-4 h-4 mr-2" /> Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ImageMetadataModal
        isOpen={!!modalImageUrl}
        onClose={() => setModalImageUrl(null)}
        imageUrl={modalImageUrl!}
      />
    </div>
  );
}
