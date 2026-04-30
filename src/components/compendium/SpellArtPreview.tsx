import React, { useEffect, useState } from 'react';
import { Wand2 } from 'lucide-react';
import { cn } from '../../lib/utils';

type SpellArtPreviewProps = {
  src?: string;
  alt?: string;
  size?: number;
  containerClassName?: string;
  imageClassName?: string;
  placeholderClassName?: string;
};

export default function SpellArtPreview({
  src,
  alt = 'Spell art',
  size = 126,
  containerClassName,
  imageClassName,
  placeholderClassName
}: SpellArtPreviewProps) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>(() => src ? 'loading' : 'idle');

  useEffect(() => {
    const nextSrc = String(src ?? '').trim();
    if (!nextSrc) {
      setStatus('idle');
      return;
    }

    let cancelled = false;
    const image = new Image();
    setStatus('loading');
    image.onload = () => {
      if (!cancelled) setStatus('loaded');
    };
    image.onerror = () => {
      if (!cancelled) setStatus('error');
    };
    image.src = nextSrc;

    return () => {
      cancelled = true;
    };
  }, [src]);

  const dimensionStyle = { width: size, height: size };
  const showImage = status === 'loaded' && src;

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-lg border border-gold/10 bg-background/35',
        containerClassName
      )}
      style={dimensionStyle}
    >
      {showImage ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          className={cn('block rounded object-cover', imageClassName)}
          style={dimensionStyle}
        />
      ) : (
        <div
          className={cn(
            'flex items-center justify-center rounded bg-background/40 text-ink/30',
            placeholderClassName
          )}
          style={dimensionStyle}
        >
          {status === 'loading' ? (
            <div className="flex flex-col items-center justify-center gap-2">
              <div className="h-8 w-8 rounded-full border-2 border-gold border-t-transparent animate-spin" />
              <span className="text-[9px] uppercase font-bold tracking-widest text-gold/60">Loading</span>
            </div>
          ) : (
            <Wand2 className="h-8 w-8" />
          )}
        </div>
      )}
    </div>
  );
}
