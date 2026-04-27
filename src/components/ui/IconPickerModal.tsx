import React, { useState, useEffect, useRef, useCallback } from 'react';
import { r2List, r2Upload } from '../../lib/r2';
import { convertToWebP } from '../../lib/imageUtils';
import { Button } from './button';
import { Input } from './input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './dialog';
import {
  Folder, Home, ChevronRight, Search, Upload,
  Loader2, X, RefreshCw, Image as ImageIcon,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';

// ── types ─────────────────────────────────────────────────────────────────────

interface BrowseIcon {
  key: string;
  url: string;
  name: string;
}

interface BrowseFolder {
  name: string;
  fullPath: string;
}

export interface IconPickerModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (url: string) => void;
  rootFolder?: string;
  imageType?: 'icon' | 'token';
}

// ── component ─────────────────────────────────────────────────────────────────

export function IconPickerModal({
  open,
  onClose,
  onSelect,
  rootFolder = 'icons',
  imageType = 'icon',
}: IconPickerModalProps) {
  const [currentPath, setCurrentPath] = useState(rootFolder);
  const [folders, setFolders] = useState<BrowseFolder[]>([]);
  const [icons, setIcons] = useState<BrowseIcon[]>([]);
  const [loading, setLoading] = useState(false);

  const [search, setSearch] = useState('');
  const [allIcons, setAllIcons] = useState<BrowseIcon[] | null>(null);
  const [loadingAll, setLoadingAll] = useState(false);

  const [showUpload, setShowUpload] = useState(false);
  const [uploadToTemp, setUploadToTemp] = useState(false);
  const [uploading, setUploading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadFolder = useCallback(async (path: string) => {
    setLoading(true);
    try {
      const prefix = path.endsWith('/') ? path : path + '/';
      const result = await r2List(prefix, '/');
      setFolders(
        result.delimitedPrefixes.map((p) => {
          const cleaned = p.replace(/\/$/, '');
          return { name: cleaned.split('/').pop() || cleaned, fullPath: cleaned };
        }),
      );
      setIcons(
        result.objects.map((obj) => ({
          key: obj.key,
          url: obj.url,
          name: obj.key.split('/').pop()!.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
        })),
      );
    } catch (err: any) {
      toast.error('Failed to load folder: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setCurrentPath(rootFolder);
      setSearch('');
      setAllIcons(null);
      setShowUpload(false);
      setUploadToTemp(false);
    }
  }, [open, rootFolder]);

  useEffect(() => {
    if (open) loadFolder(currentPath);
  }, [open, currentPath, loadFolder]);

  // ── search ────────────────────────────────────────────────────────────────

  const handleSearch = async (value: string) => {
    setSearch(value);
    if (value && !allIcons && !loadingAll) {
      setLoadingAll(true);
      try {
        const result = await r2List(rootFolder + '/', '');
        setAllIcons(
          result.objects.map((obj) => ({
            key: obj.key,
            url: obj.url,
            name: obj.key.split('/').pop()!.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
          })),
        );
      } catch {
        setAllIcons([]);
      } finally {
        setLoadingAll(false);
      }
    }
  };

  const displayedIcons = search
    ? (allIcons ?? []).filter(
        (i) =>
          i.name.toLowerCase().includes(search.toLowerCase()) ||
          i.key.toLowerCase().includes(search.toLowerCase()),
      )
    : icons;

  // ── upload ────────────────────────────────────────────────────────────────

  const handleFileUpload = async (file: File) => {
    if (!file.type.startsWith('image/')) { toast.error('Please select an image file'); return; }
    setUploading(true);
    try {
      const targetSize = imageType === 'token' ? { width: 400, height: 400 } : { width: 126, height: 126 };
      const converted = await convertToWebP(file, 0.85, targetSize);
      const fileName = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}.webp`;
      const uploadPath = uploadToTemp
        ? `${rootFolder}/_temp/${fileName}`
        : `${currentPath}/${fileName}`;
      const { url } = await r2Upload(converted, uploadPath);
      toast.success(uploadToTemp ? 'Uploaded to _temp — move it via Image Manager' : 'Icon uploaded');
      if (!uploadToTemp) {
        setIcons((prev) => [...prev, { key: uploadPath, url, name: fileName.replace('.webp', '') }]);
        setAllIcons(null);
      }
      setShowUpload(false);
    } catch (err: any) {
      toast.error('Upload failed: ' + err.message);
    } finally {
      setUploading(false);
    }
  };

  // ── breadcrumb ────────────────────────────────────────────────────────────

  const pathSegments =
    currentPath === rootFolder
      ? []
      : currentPath.replace(rootFolder + '/', '').split('/').filter(Boolean);

  const navigateToSegment = (index: number) => {
    if (index < 0) { setCurrentPath(rootFolder); return; }
    setCurrentPath([rootFolder, ...pathSegments.slice(0, index + 1)].join('/'));
  };

  const title = imageType === 'token' ? 'Browse Tokens' : 'Browse Icons';
  const sizeLabel = imageType === 'token' ? '400×400' : '126×126';

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      {/*
        Override the shadcn DialogContent default sm:max-w-sm by explicitly
        passing sm:max-w-[700px]. tailwind-merge removes the conflicting default.
      */}
      <DialogContent className="sm:max-w-[700px] max-h-[88vh] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-4 pb-3 shrink-0 border-b border-gold/10">
          <DialogTitle className="text-base font-serif">{title}</DialogTitle>
        </DialogHeader>

        {/* Toolbar */}
        <div className="px-4 py-2 border-b border-gold/10 shrink-0 flex items-center gap-3">
          {/* Breadcrumb */}
          <div className="flex items-center gap-1 text-xs flex-1 min-w-0 overflow-hidden">
            <button
              onClick={() => { setCurrentPath(rootFolder); setSearch(''); }}
              className="text-gold hover:text-white transition-colors flex items-center gap-1 shrink-0"
            >
              <Home className="w-3.5 h-3.5" />
              <span>{rootFolder}</span>
            </button>
            {pathSegments.map((seg, i) => (
              <React.Fragment key={i}>
                <ChevronRight className="w-3 h-3 text-ink/20 shrink-0" />
                <button
                  onClick={() => navigateToSegment(i)}
                  className={cn(
                    'transition-colors truncate max-w-[160px]',
                    i === pathSegments.length - 1
                      ? 'text-ink/50 cursor-default'
                      : 'text-gold hover:text-white',
                  )}
                >
                  {seg}
                </button>
              </React.Fragment>
            ))}
          </div>

          {/* Search */}
          <div className="relative shrink-0">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink/30 pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Search all…"
              className="pl-8 h-8 text-xs w-44 bg-background/50 border-gold/20"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink/30 hover:text-ink/60"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Upload toggle */}
          <Button
            size="sm"
            variant="ghost"
            className={cn(
              'h-8 text-xs gap-1.5 shrink-0 uppercase tracking-widest font-bold',
              showUpload ? 'btn-gold-solid' : 'btn-gold',
            )}
            onClick={() => setShowUpload((v) => !v)}
          >
            <Upload className="w-3 h-3" /> Upload
          </Button>

          {/* Refresh */}
          <button
            onClick={() => { loadFolder(currentPath); setAllIcons(null); }}
            className="text-ink/40 hover:text-gold transition-colors shrink-0"
            title="Refresh"
          >
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
          </button>
        </div>

        {/* Upload panel */}
        {showUpload && (
          <div className="px-4 py-3 border-b border-gold/10 shrink-0 bg-gold/5 space-y-2.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] uppercase tracking-widest text-ink/40 shrink-0">Upload to:</span>
              {([
                { value: false, label: `Current (${currentPath.split('/').pop()})` },
                { value: true, label: 'Temp (_temp)' },
              ] as const).map(({ value, label }) => (
                <button
                  key={String(value)}
                  type="button"
                  onClick={() => setUploadToTemp(value)}
                  className={cn(
                    'px-2.5 py-0.5 text-[10px] font-black uppercase tracking-widest rounded border transition-colors',
                    uploadToTemp === value
                      ? 'bg-gold/20 text-gold border-gold/40'
                      : 'text-ink/40 border-gold/10 hover:border-gold/30 hover:text-gold/60',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <Button
                size="sm"
                variant="outline"
                className="border-gold/20 hover:bg-gold/10 gap-2 text-xs h-8"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                {uploading ? 'Uploading…' : 'Choose File'}
              </Button>
              <span className="text-[10px] text-ink/40">
                Auto-cropped to {sizeLabel} · WebP
              </span>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.[0]) handleFileUpload(e.target.files[0]);
                e.target.value = '';
              }}
            />
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 min-h-0 custom-scrollbar">
          {loading && !search ? (
            <div className="grid grid-cols-5 gap-2">
              {Array.from({ length: 15 }).map((_, i) => (
                <div key={i} className="aspect-square bg-gold/5 animate-pulse rounded border border-gold/10" />
              ))}
            </div>
          ) : search ? (
            loadingAll ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-6 h-6 animate-spin text-gold/40" />
              </div>
            ) : displayedIcons.length === 0 ? (
              <p className="text-center text-sm text-ink/40 italic py-12">
                No {imageType}s match "{search}"
              </p>
            ) : (
              <>
                <p className="text-xs text-ink/40 mb-3">
                  {displayedIcons.length} result{displayedIcons.length !== 1 ? 's' : ''}
                </p>
                <IconGrid icons={displayedIcons} onSelect={(url) => { onSelect(url); onClose(); }} />
              </>
            )
          ) : (
            <div className="space-y-3">
              {/* Sub-folders — full-width list rows like Foundry */}
              {folders.length > 0 && (
                <div className="space-y-0.5">
                  {folders.map((f) => (
                    <button
                      key={f.fullPath}
                      onClick={() => setCurrentPath(f.fullPath)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 border border-transparent hover:border-gold/20 hover:bg-gold/8 rounded transition-all text-left group"
                    >
                      <Folder className="w-4 h-4 text-gold/50 group-hover:text-gold/80 shrink-0" />
                      <span className="text-sm text-ink/65 group-hover:text-ink/90">
                        {f.name}
                      </span>
                    </button>
                  ))}
                  {displayedIcons.length > 0 && (
                    <div className="border-t border-gold/10 my-2" />
                  )}
                </div>
              )}

              {/* Icons */}
              {displayedIcons.length > 0 ? (
                <IconGrid icons={displayedIcons} onSelect={(url) => { onSelect(url); onClose(); }} />
              ) : folders.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 border border-dashed border-gold/20 rounded-lg">
                  <ImageIcon className="w-10 h-10 text-gold/20 mb-3" />
                  <p className="text-sm text-ink/40 italic">
                    No {imageType}s here yet — upload one to get started.
                  </p>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── icon grid ─────────────────────────────────────────────────────────────────

function IconGrid({
  icons,
  onSelect,
}: {
  icons: BrowseIcon[];
  onSelect: (url: string) => void;
}) {
  return (
    <div className="grid grid-cols-5 gap-1">
      {icons.map((icon) => (
        <button
          key={icon.key}
          onClick={() => onSelect(icon.url)}
          title={icon.name}
          className="flex flex-col items-center gap-1.5 p-2 border border-transparent rounded hover:border-gold/40 hover:bg-gold/8 transition-all group"
        >
          <div className="w-full aspect-square flex items-center justify-center">
            <img
              src={icon.url}
              alt={icon.name}
              className="w-full h-full object-contain"
              referrerPolicy="no-referrer"
              onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0.15'; }}
            />
          </div>
          <span className="text-[10px] text-ink/45 group-hover:text-ink/75 truncate w-full text-center leading-tight">
            {icon.name}
          </span>
        </button>
      ))}
    </div>
  );
}
