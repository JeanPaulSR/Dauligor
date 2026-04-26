import React, { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { extractStoragePath, getImageMetadataByPath, ImageMetadata } from '../../lib/imageMetadata';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { ArrowLeft, Image as ImageIcon } from 'lucide-react';

export default function ImageViewer({ userProfile }: { userProfile: any }) {
  const [searchParams] = useSearchParams();
  const imageUrl = searchParams.get('url') ?? '';

  const [metadata, setMetadata] = useState<ImageMetadata | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!imageUrl) { setLoading(false); return; }
    const storagePath = extractStoragePath(imageUrl);
    if (!storagePath) { setLoading(false); return; }
    getImageMetadataByPath(storagePath)
      .then(setMetadata)
      .catch(() => setMetadata(null))
      .finally(() => setLoading(false));
  }, [imageUrl]);

  if (!imageUrl) {
    return (
      <div className="flex flex-col items-center justify-center min-h-64">
        <ImageIcon className="w-12 h-12 text-gold/20 mb-4" />
        <p className="text-ink/40 italic">No image URL provided.</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto py-8 space-y-6">
      <Link to={-1 as any}>
        <Button variant="ghost" size="sm" className="text-ink/40 hover:text-ink gap-1 -ml-2 text-xs uppercase tracking-widest font-bold">
          <ArrowLeft className="w-3 h-3" /> Back
        </Button>
      </Link>

      {/* Full image */}
      <div className="rounded-xl overflow-hidden border border-gold/20 bg-card shadow-xl shadow-black/20">
        <img
          src={imageUrl}
          alt={metadata?.description ?? 'Image'}
          className="w-full object-contain max-h-[70vh]"
          referrerPolicy="no-referrer"
        />
      </div>

      {/* Metadata card — only shown when there's something to display */}
      {!loading && metadata && (
        metadata.creator || metadata.description || metadata.license || metadata.source || (metadata.tags?.length ?? 0) > 0
      ) && (
        <div className="border border-gold/20 rounded-lg p-5 space-y-4 bg-card/30">
          {metadata.creator && (
            <div>
              <p className="text-[10px] uppercase tracking-widest text-ink/40 mb-0.5">Creator</p>
              <p className="text-sm text-ink/80 font-medium">{metadata.creator}</p>
            </div>
          )}
          {metadata.description && (
            <div>
              <p className="text-[10px] uppercase tracking-widest text-ink/40 mb-0.5">Description</p>
              <p className="text-sm text-ink/70">{metadata.description}</p>
            </div>
          )}
          {metadata.license && (
            <div>
              <p className="text-[10px] uppercase tracking-widest text-ink/40 mb-0.5">License</p>
              <p className="text-sm text-ink/70">{metadata.license}</p>
            </div>
          )}
          {metadata.source && (
            <div>
              <p className="text-[10px] uppercase tracking-widest text-ink/40 mb-0.5">Source</p>
              <a
                href={metadata.source}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-gold hover:underline break-all"
              >
                {metadata.source}
              </a>
            </div>
          )}
          {(metadata.tags?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {metadata.tags!.map((t) => (
                <Badge key={t} variant="outline" className="text-[10px] border-gold/20 text-ink/60">
                  {t}
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
