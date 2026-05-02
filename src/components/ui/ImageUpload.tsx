import React, { useState, useRef } from 'react';
import { r2Upload } from '../../lib/r2';
import { convertToWebP } from '../../lib/imageUtils';
import { IconPickerModal } from './IconPickerModal';
import { Button } from './button';
import { Upload, X, Loader2, Image as ImageIcon, Search } from 'lucide-react';
import { cn } from '../../lib/utils';

// ── image type definitions ────────────────────────────────────────────────────

export type ImageType = 'standard' | 'icon' | 'token';

const TYPE_SIZES: Record<ImageType, { width: number; height: number } | null> = {
  standard: null,
  icon: { width: 126, height: 126 },
  token: { width: 400, height: 400 },
};

const TYPE_LABELS: Record<ImageType, string> = {
  standard: 'Standard',
  icon: 'Icon (126×126)',
  token: 'Token (400×400)',
};

// ── props ─────────────────────────────────────────────────────────────────────

interface ImageUploadProps {
  onUpload: (url: string) => void;
  storagePath: string;
  currentImageUrl?: string;
  className?: string;
  imageType?: ImageType;        // locks the type — no selector shown
  allowTypeSelection?: boolean; // show type picker (only when imageType is not set)
  filename?: string;            // override auto-generated filename (no extension)
  compact?: boolean;            // avatar-style picker for icon slots in editors
}

// ── component ─────────────────────────────────────────────────────────────────

export function ImageUpload({
  onUpload,
  storagePath,
  currentImageUrl,
  className,
  imageType,
  allowTypeSelection,
  filename,
  compact,
}: ImageUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<ImageType>('standard');
  const [pickerOpen, setPickerOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const effectiveType: ImageType = imageType ?? selectedType;
  const canUsePicker = imageType === 'icon' || imageType === 'token';
  const pickerRoot = imageType === 'token' ? 'tokens' : 'icons';

  const handleUpload = async (file: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('Please select a valid image file.'); return; }

    setError(null);
    setUploading(true);
    setProgress(0);

    try {
      const target = TYPE_SIZES[effectiveType] ?? undefined;
      const quality = effectiveType === 'icon' || effectiveType === 'token' ? 1.0 : 0.85;
      const converted = await convertToWebP(file, quality, target);

      if (converted.size > 5 * 1024 * 1024) {
        setError('Image is too large even after compression. Please use a smaller file.');
        setUploading(false);
        return;
      }

      const baseName = filename
        ? filename.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-_]/g, '').toLowerCase()
        : `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const filePath = `${storagePath.endsWith('/') ? storagePath : storagePath + '/'}${baseName}.webp`;

      const { url } = await r2Upload(converted, filePath, (pct) => setProgress(pct));
      onUpload(url);
      setUploading(false);
      setProgress(0);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'An error occurred during upload.');
      setUploading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) handleUpload(e.target.files[0]);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files?.[0]) handleUpload(e.dataTransfer.files[0]);
  };

  // ── compact mode ──────────────────────────────────────────────────────────
  // Avatar-style: click to browse, hover for quick-upload / clear buttons.

  if (compact) {
    return (
      <div className={cn('relative group w-full h-full', className)}>
        {/* Main area — click opens picker */}
        <div
          className="w-full h-full rounded-lg overflow-hidden border border-gold/20 bg-background cursor-pointer"
          onClick={() => canUsePicker ? setPickerOpen(true) : fileInputRef.current?.click()}
        >
          {currentImageUrl ? (
            <img
              src={currentImageUrl}
              alt=""
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center gap-1">
              <ImageIcon className="w-6 h-6 text-gold/20" />
              <span className="text-[9px] text-ink/30 uppercase tracking-widest">
                {imageType === 'token' ? 'Token' : 'Icon'}
              </span>
            </div>
          )}
        </div>

        {/* Hover overlay */}
        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5 rounded-lg pointer-events-none">
          <div className="pointer-events-auto flex gap-1.5">
            {canUsePicker && (
              <button
                type="button"
                title="Browse library"
                onClick={(e) => { e.stopPropagation(); setPickerOpen(true); }}
                className="p-1.5 bg-white/10 rounded hover:bg-white/20 transition"
              >
                <Search className="w-3.5 h-3.5 text-white" />
              </button>
            )}
            <button
              type="button"
              title="Upload new file"
              onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
              className="p-1.5 bg-white/10 rounded hover:bg-white/20 transition"
            >
              <Upload className="w-3.5 h-3.5 text-white" />
            </button>
            {currentImageUrl && (
              <button
                type="button"
                title="Clear"
                onClick={(e) => { e.stopPropagation(); onUpload(''); }}
                className="p-1.5 bg-white/10 rounded hover:bg-white/20 transition"
              >
                <X className="w-3.5 h-3.5 text-white" />
              </button>
            )}
          </div>
        </div>

        {/* Uploading overlay */}
        {uploading && (
          <div className="absolute inset-0 bg-background/80 flex items-center justify-center rounded-lg">
            <Loader2 className="w-5 h-5 animate-spin text-gold" />
          </div>
        )}

        <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/*" className="hidden" />

        {canUsePicker && (
          <IconPickerModal
            open={pickerOpen}
            onClose={() => setPickerOpen(false)}
            onSelect={(url) => { onUpload(url); setPickerOpen(false); }}
            rootFolder={pickerRoot}
            imageType={imageType as 'icon' | 'token'}
          />
        )}
      </div>
    );
  }

  // ── standard mode ─────────────────────────────────────────────────────────

  return (
    <div className={cn('space-y-3', className)}>
      {/* Type selector */}
      {allowTypeSelection && !imageType && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {(['standard', 'icon', 'token'] as ImageType[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setSelectedType(t)}
              className={cn(
                'px-2.5 py-1 text-[10px] font-black uppercase tracking-widest rounded border transition-colors',
                selectedType === t
                  ? 'bg-gold/20 text-gold border-gold/40'
                  : 'text-ink/40 border-gold/10 hover:border-gold/30 hover:text-gold/60',
              )}
            >
              {TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      )}
      {/* Locked type badge */}
      {imageType && imageType !== 'standard' && (
        <span className="inline-block px-2 py-0.5 text-[9px] font-black uppercase tracking-widest rounded border border-gold/30 text-gold/70 bg-gold/5">
          {TYPE_LABELS[imageType]}
        </span>
      )}

      <div
        className={cn(
          'border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center transition-colors relative overflow-hidden text-center',
          currentImageUrl ? 'border-gold/30 bg-card/30' : 'border-border hover:border-gold/50 bg-background/50 hover:bg-card/50',
          uploading && 'opacity-50 pointer-events-none',
        )}
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
      >
        {currentImageUrl ? (
          <div className="relative w-full">
            <img
              src={currentImageUrl}
              alt="Uploaded file"
              className="max-h-64 object-contain rounded-md w-full mx-auto"
              referrerPolicy="no-referrer"
            />
            <Button
              type="button"
              variant="destructive"
              size="icon"
              className="absolute top-2 right-2 rounded-full shadow-lg"
              onClick={(e) => { e.stopPropagation(); onUpload(''); }}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="mx-auto w-12 h-12 rounded-full bg-gold/10 flex items-center justify-center">
              <ImageIcon className="h-6 w-6 text-gold" />
            </div>
            <div>
              <p className="text-sm font-medium text-ink">Drag and drop an image, or click to browse</p>
              <p className="text-xs text-ink/50 mt-1">
                PNG, JPG, WEBP — auto-converted to WebP
                {effectiveType !== 'standard' && ` · resized to ${TYPE_SIZES[effectiveType]!.width}×${TYPE_SIZES[effectiveType]!.height}`}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="border-gold/20 hover:bg-gold/10 gap-2"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-4 w-4" /> Choose File
            </Button>
          </div>
        )}

        {uploading && (
          <div className="absolute inset-0 bg-background/80 flex flex-col items-center justify-center p-4">
            <Loader2 className="h-8 w-8 animate-spin text-gold mb-4" />
            <div className="w-full max-w-xs bg-muted rounded-full h-2.5">
              <div className="bg-gold h-2.5 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
            <span className="text-xs font-medium text-ink mt-2">Uploading… {Math.round(progress)}%</span>
          </div>
        )}

        <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/*" className="hidden" />
      </div>

      {error && <p className="text-sm text-destructive font-medium">{error}</p>}
    </div>
  );
}
