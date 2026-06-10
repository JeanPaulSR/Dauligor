// =============================================================================
// ClassImageEditor — the three image variants a class/subclass uses, each with
// focal positioning: Detail (ClassView), Card (grid), Preview (quick-view).
// =============================================================================
//
// Built on the generic FocalImageField (../ui/FocalImageEditor). The image
// primitive lives there so non-class surfaces (campaigns, etc.) can reuse it
// without depending on this class-specific layout.
//
// Re-exports ImageDisplay / ClassImageStyle / DEFAULT_DISPLAY for the many
// existing callers that import them from here.
// =============================================================================

import { useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { Info } from 'lucide-react';
import { ImageMetadataModal } from '../ui/ImageMetadataModal';
import {
  FocalImageField,
  imageFocalStyle,
  DEFAULT_DISPLAY,
  type ImageDisplay,
} from '../ui/FocalImageEditor';

// Back-compat re-exports (callers historically import these from ClassImageEditor).
export { DEFAULT_DISPLAY };
export type { ImageDisplay };
export const ClassImageStyle = imageFocalStyle;

// ── panel labels ────────────────────────────────────────────────────────────

export interface PanelLabels {
  detail: { label: string; subtitle: string };
  card: { label: string; subtitle: string };
  preview: { label: string; subtitle: string };
}

const DEFAULT_PANEL_LABELS: PanelLabels = {
  detail:  { label: 'Detail View',     subtitle: 'ClassView page'   },
  card:    { label: 'Card View',        subtitle: 'ClassList grid'   },
  preview: { label: 'Preview Header',  subtitle: 'Quick-view panel' },
};

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
  panelLabels?: PanelLabels;
  className?: string;
}

export function ClassImageEditor({
  imageUrl, onImageUrlChange,
  imageDisplay: propImageDisplay, onImageDisplayChange,
  cardImageUrl: propCardImageUrl, onCardImageUrlChange,
  cardDisplay: propCardDisplay, onCardDisplayChange,
  previewImageUrl: propPreviewImageUrl, onPreviewImageUrlChange,
  previewDisplay: propPreviewDisplay, onPreviewDisplayChange,
  storagePath, panelLabels, className,
}: ClassImageEditorProps) {
  // Local state for interactive editing — commit to parent on pointer-up / wheel tick.
  const [imageDisplay, setImageDisplay] = useState(propImageDisplay);
  const [cardImageUrl, setCardImageUrl] = useState(propCardImageUrl);
  const [cardDisplay, setCardDisplay] = useState(propCardDisplay);
  const [previewImageUrl, setPreviewImageUrl] = useState(propPreviewImageUrl);
  const [previewDisplay, setPreviewDisplay] = useState(propPreviewDisplay);

  useEffect(() => { setImageDisplay(propImageDisplay); }, [propImageDisplay]);
  useEffect(() => { setCardDisplay(propCardDisplay); }, [propCardDisplay]);
  useEffect(() => { setCardImageUrl(propCardImageUrl); }, [propCardImageUrl]);
  useEffect(() => { setPreviewDisplay(propPreviewDisplay); }, [propPreviewDisplay]);
  useEffect(() => { setPreviewImageUrl(propPreviewImageUrl); }, [propPreviewImageUrl]);

  const cardImg = cardImageUrl || imageUrl;
  const prevImg = previewImageUrl || imageUrl;

  const labels = { ...DEFAULT_PANEL_LABELS, ...panelLabels };

  const [modalImageUrl, setModalImageUrl] = useState<string | null>(null);

  return (
    // `@container` + `@xl:` so the 3-up layout responds to the ACTUAL available
    // width, not the viewport. In a wide host (the class editor's max-w-5xl
    // dialog) it stays 3 columns; in a narrow host (the lore designer's settings
    // side-panel) it stacks to 1 column instead of crushing the panels.
    <div className={`@container space-y-2 ${className ?? ''}`}>
      <p className="label-text text-ink/45">
        Drag to pan · Scroll or use ± to zoom · <span className="text-gold/65">Camera icon</span> overrides the image for that view
      </p>
      <div className="grid grid-cols-1 @xl:grid-cols-3 gap-6 items-start">
        {/* Detail View (primary, no override) */}
        <FocalImageField
          label={labels.detail.label}
          subtitle={labels.detail.subtitle}
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
        <FocalImageField
          label={labels.card.label}
          subtitle={labels.card.subtitle}
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
        <FocalImageField
          label={labels.preview.label}
          subtitle={labels.preview.subtitle}
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
      <div className="grid grid-cols-1 @xl:grid-cols-3 gap-6 pt-2">
        <div>
          {imageUrl && (
            <Button type="button" size="sm" variant="ghost" className="w-full h-8 text-xs border border-gold/15 text-gold/65 hover:text-gold hover:border-gold/35" onClick={() => setModalImageUrl(imageUrl)}>
              <Info className="w-3 h-3 mr-1.5" /> Edit Metadata
            </Button>
          )}
        </div>
        <div>
          {cardImg && (
            <Button type="button" size="sm" variant="ghost" className="w-full h-8 text-xs border border-gold/15 text-gold/65 hover:text-gold hover:border-gold/35" onClick={() => setModalImageUrl(cardImg)}>
              <Info className="w-3 h-3 mr-1.5" /> Edit Metadata
            </Button>
          )}
        </div>
        <div>
          {prevImg && (
            <Button type="button" size="sm" variant="ghost" className="w-full h-8 text-xs border border-gold/15 text-gold/65 hover:text-gold hover:border-gold/35" onClick={() => setModalImageUrl(prevImg)}>
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
