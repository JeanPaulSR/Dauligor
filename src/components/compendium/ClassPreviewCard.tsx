import type { MouseEvent } from 'react';
import { Shield, Trash2 } from 'lucide-react';
import Markdown from 'react-markdown';
import { Button } from '../ui/button';
import { imageFocalStyle as ClassImageStyle, DEFAULT_DISPLAY } from '../ui/FocalImageEditor';

// Heavy black outline so the gold title/source stay legible over any image.
const TEXT_OUTLINE =
  '-2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000, -2px 0 0 #000, 2px 0 0 #000, 0 -2px 0 #000, 0 2px 0 #000';

interface ClassPreviewCardProps {
  name: string;
  /** Card image (cardImageUrl || imageUrl); a Shield placeholder shows when empty. */
  imageUrl?: string | null;
  /** Image crop/position (cardDisplay || imageDisplay). */
  imageDisplay?: any;
  /** Preview text (preview || description), rendered as markdown. */
  preview?: string | null;
  /** Source label, e.g. "PHB". Defaults to "Unknown". */
  sourceLabel?: string;
  onClick?: () => void;
  /** Admin delete (ClassList only); omit to hide the button. */
  onDelete?: (e: MouseEvent) => void;
  /** Outer sizing/aspect classes supplied by the caller. */
  className?: string;
}

/**
 * The class selection/preview card — extracted from ClassList so the exact
 * same card renders in the class grid AND in a `@class[…]` reference hover.
 * Pure presentation: the caller resolves the source label + sizing and
 * supplies the click/delete handlers.
 */
export default function ClassPreviewCard({
  name,
  imageUrl,
  imageDisplay,
  preview,
  sourceLabel,
  onClick,
  onDelete,
  className = '',
}: ClassPreviewCardProps) {
  return (
    <div
      onClick={onClick}
      className={`group relative bg-card border border-gold/25 hover:border-gold hover:shadow-lg hover:shadow-gold/15 transition-all overflow-hidden flex flex-col rounded-xl ${
        onClick ? 'cursor-pointer' : ''
      } ${className}`}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          className="absolute inset-0 w-full h-full object-cover pointer-events-none"
          style={ClassImageStyle({ display: imageDisplay || DEFAULT_DISPLAY })}
          referrerPolicy="no-referrer"
          draggable={false}
          alt=""
        />
      ) : (
        <div className="absolute inset-0 bg-ink/5 flex items-center justify-center">
          <Shield className="w-16 h-16 text-gold/15" />
        </div>
      )}
      <div
        className={`absolute inset-0 bg-gradient-to-t from-black via-black/60 to-transparent pointer-events-none transition-opacity ${
          imageUrl ? 'opacity-80 group-hover:opacity-100' : 'opacity-20 group-hover:opacity-30'
        }`}
      />

      <div className="relative z-10 p-4 pt-6 text-center">
        <h3
          className="h3-title text-gold group-hover:text-white transition-colors block text-3xl group-hover:drop-shadow-[0_0_8px_rgba(212,175,55,0.8)]"
          style={{ textShadow: TEXT_OUTLINE }}
        >
          {name}
        </h3>
        <p className="label-text text-gold/85 block mt-1 text-sm" style={{ textShadow: TEXT_OUTLINE }}>
          {sourceLabel || 'Unknown'}
        </p>
      </div>

      <div className="mt-auto relative z-10 p-4 border-t border-gold/25 bg-black/10 backdrop-blur-md h-[45%] flex flex-col items-center text-center group-hover:bg-black/30 group-hover:-translate-y-2 transition-all duration-300">
        <div className="text-white/80 text-xs italic line-clamp-6 overflow-hidden w-full font-serif leading-relaxed">
          <Markdown>{preview || 'No preview description available.'}</Markdown>
        </div>
      </div>

      {onDelete && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          className="absolute top-2 right-2 h-8 w-8 p-0 text-white/50 hover:text-white hover:bg-blood/80 z-20 transition-colors"
          title="Delete Class"
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      )}
    </div>
  );
}
