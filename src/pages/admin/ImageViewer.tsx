import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { extractStoragePath, getImageMetadataByPath, ImageMetadata } from '../../lib/imageMetadata';
import { Badge } from '../../components/ui/badge';
import { X } from 'lucide-react';

export default function ImageViewer({ userProfile }: { userProfile: any }) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const imageUrl = searchParams.get('url') ?? '';
  const filename = imageUrl.split('/').pop()?.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ') ?? 'Image';

  const [metadata, setMetadata] = useState<ImageMetadata | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);

  useEffect(() => {
    if (!imageUrl) return;
    const storagePath = extractStoragePath(imageUrl);
    if (!storagePath) return;
    getImageMetadataByPath(storagePath)
      .then(setMetadata)
      .catch(() => {});
  }, [imageUrl]);

  // Escape to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') navigate(-1); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  const hasCaption = metadata && (
    metadata.creator || metadata.description || metadata.license ||
    metadata.source || (metadata.tags?.length ?? 0) > 0
  );

  if (!imageUrl) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90">
        <p className="text-ink/40 italic">No image URL provided.</p>
      </div>
    );
  }

  return (
    // Backdrop — click to close
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={() => navigate(-1)}
    >
      {/* Blurred image background */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `url(${imageUrl})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          filter: 'blur(28px) brightness(0.2) saturate(0.5)',
          transform: 'scale(1.12)',
        }}
      />
      <div className="absolute inset-0 bg-black/50" />

      {/* Foundry-style window */}
      <div
        className="relative z-10 flex flex-col rounded-sm border border-gold/20 shadow-2xl shadow-black/80"
        style={{
          background: 'rgba(8, 8, 12, 0.78)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          maxWidth: '88vw',
          maxHeight: '92vh',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title bar */}
        <div
          className="flex items-center gap-3 px-4 py-2"
          style={{ borderBottom: '2px groove rgba(255,255,255,0.08)' }}
        >
          <h4 className="flex-1 text-sm font-semibold text-ink/70 truncate capitalize">
            {metadata?.description || filename}
          </h4>
          <button
            onClick={() => navigate(-1)}
            className="shrink-0 text-ink/30 hover:text-ink transition-colors"
            title="Close (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Image + caption */}
        <figure className="flex flex-col items-center gap-4 p-4 overflow-auto m-0">
          <img
            src={imageUrl}
            alt={metadata?.description ?? filename}
            referrerPolicy="no-referrer"
            onLoad={() => setImgLoaded(true)}
            className="object-contain transition-opacity duration-300"
            style={{
              maxWidth: '80vw',
              maxHeight: '76vh',
              opacity: imgLoaded ? 1 : 0,
            }}
          />

          {hasCaption && (
            <figcaption
              className="w-full space-y-2 pt-3"
              style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
            >
              {metadata!.description && (
                <p className="text-sm italic text-center text-ink/55">{metadata!.description}</p>
              )}
              <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-xs text-ink/35">
                {metadata!.creator && <span>By {metadata!.creator}</span>}
                {metadata!.license && <span>{metadata!.license}</span>}
                {metadata!.source && (
                  <a
                    href={metadata!.source}
                    target="_blank"
                    rel="noreferrer"
                    className="text-gold/50 hover:text-gold transition-colors"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Source ↗
                  </a>
                )}
              </div>
              {(metadata!.tags?.length ?? 0) > 0 && (
                <div className="flex flex-wrap justify-center gap-1 pt-0.5">
                  {metadata!.tags!.map((t) => (
                    <Badge key={t} variant="outline" className="text-[9px] border-gold/15 text-ink/35">
                      {t}
                    </Badge>
                  ))}
                </div>
              )}
            </figcaption>
          )}
        </figure>
      </div>
    </div>
  );
}
