import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { r2List, r2Upload } from '../../lib/r2';
import { useBlock } from '../../lib/proposalBlock';
import { convertToWebP } from '../../lib/imageUtils';
import { auth } from '../../lib/firebase';
import { isAdmin } from '../../lib/currentUser';
import { Button } from './button';
import { Input } from './input';
import { SearchInput } from './SearchInput';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './dialog';
import {
  Folder, Search, Upload,
  Loader2, X, RefreshCw, Image as ImageIcon,
  ArrowUp, FolderPlus, Eye, EyeOff, LayoutGrid, List as ListIcon,
  Star,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';

// ── types ─────────────────────────────────────────────────────────────────────

type Source = 'icons' | 'tokens';

// Sources currently surfaced as tabs in the picker UI. The source machinery
// supports both 'icons' and 'tokens', but tokens are reserved for the future
// creature/NPC system, so the tab strip is hidden when only one source is
// available. To re-enable, add 'tokens' here.
const AVAILABLE_SOURCES: readonly Source[] = ['icons'];

interface BrowseIcon {
  key: string;
  url: string;
  name: string;
  size: number;
  uploaded: string | null;
}

interface BrowseFolder {
  name: string;
  fullPath: string;
}

interface Favorite {
  source: Source;
  path: string;
}

interface UploadQueueItem {
  id: string;
  name: string;
  progress: number; // 0–100
  status: 'pending' | 'uploading' | 'done' | 'error';
  error?: string;
}

type DisplayMode = 'tiles' | 'list';

export interface IconPickerModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (url: string) => void;
  rootFolder?: Source;
  imageType?: 'icon' | 'token';
}

// ── helpers ───────────────────────────────────────────────────────────────────

const isDotFile = (key: string) => {
  const name = key.split('/').pop() || '';
  return name.startsWith('.');
};

const isUnderPrivateFolder = (key: string) =>
  key.split('/').slice(0, -1).some((seg) => seg.startsWith('_'));

const formatBytes = (n: number) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};

const formatDate = (iso: string | null) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
};

const sanitizeFolderName = (raw: string) =>
  raw.trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');

const normalizeRelPath = (raw: string) =>
  raw.split('/').map(s => s.trim()).filter(s => s && s !== '..').join('/');

// Favorites are stored in localStorage, keyed by Firebase user id so multiple
// admins sharing a machine don't see each other's pins.
const FAVORITES_KEY_PREFIX = 'dauligor.iconPicker.favorites.v1.';

const favoritesKeyForCurrentUser = (): string | null => {
  const uid = auth.currentUser?.uid;
  return uid ? `${FAVORITES_KEY_PREFIX}${uid}` : null;
};

const loadFavorites = (): Favorite[] => {
  try {
    const key = favoritesKeyForCurrentUser();
    if (!key) return [];
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((f): f is Favorite =>
      f && typeof f.path === 'string' && (f.source === 'icons' || f.source === 'tokens'),
    );
  } catch { return []; }
};

const saveFavorites = (favs: Favorite[]) => {
  try {
    const key = favoritesKeyForCurrentUser();
    if (!key) return; // signed out — don't persist anonymously
    localStorage.setItem(key, JSON.stringify(favs));
  } catch { /* quota / private mode */ }
};

// ── component ─────────────────────────────────────────────────────────────────

export function IconPickerModal({
  open,
  onClose,
  onSelect,
  rootFolder = 'icons',
}: IconPickerModalProps) {
  const [activeSource, setActiveSource] = useState<Source>(rootFolder);

  const [currentPath, setCurrentPath] = useState<string>(rootFolder);
  const [folders, setFolders] = useState<BrowseFolder[]>([]);
  const [icons, setIcons] = useState<BrowseIcon[]>([]);
  const [loading, setLoading] = useState(false);
  // Active proposal block (if any) — lets a content-creator upload an icon
  // into their own open block; the server validates ownership.
  const { activeBundleId } = useBlock();

  const [pathInput, setPathInput] = useState('');

  const [search, setSearch] = useState('');
  const [allIcons, setAllIcons] = useState<BrowseIcon[] | null>(null);
  const [loadingAll, setLoadingAll] = useState(false);

  const [showUpload, setShowUpload] = useState(false);
  const [uploadToTemp, setUploadToTemp] = useState(false);
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([]);

  // `uploading` derived from the queue — true while any item is pending or in flight.
  const uploading = uploadQueue.some((q) => q.status === 'uploading' || q.status === 'pending');

  const [showPrivate, setShowPrivate] = useState(false);
  const [displayMode, setDisplayMode] = useState<DisplayMode>('tiles');

  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [createBusy, setCreateBusy] = useState(false);

  const [favorites, setFavorites] = useState<Favorite[]>(loadFavorites);

  // Drag-and-drop upload onto the modal body
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  const canManage = isAdmin();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const newFolderInputRef = useRef<HTMLInputElement>(null);

  // ── loaders ────────────────────────────────────────────────────────────────

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
        result.objects
          .filter((obj) => !isDotFile(obj.key))
          .map((obj) => ({
            key: obj.key,
            url: obj.url,
            name: obj.key.split('/').pop()!.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
            size: obj.size,
            uploaded: obj.uploaded,
          })),
      );
    } catch (err: any) {
      toast.error('Failed to load folder: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const resetForSource = useCallback((src: Source) => {
    setActiveSource(src);
    setCurrentPath(src);
    setSearch('');
    setAllIcons(null);
    setShowUpload(false);
    setUploadToTemp(false);
    setCreatingFolder(false);
    setNewFolderName('');
  }, []);

  useEffect(() => {
    if (open) resetForSource(rootFolder);
  }, [open, rootFolder, resetForSource]);

  useEffect(() => {
    if (open) loadFolder(currentPath);
  }, [open, currentPath, loadFolder]);

  // Invalidate the recursive search cache when we move to a different folder —
  // search results are scoped to currentPath, so the cache from another folder
  // would silently mislead.
  useEffect(() => { setAllIcons(null); }, [currentPath]);

  useEffect(() => { saveFavorites(favorites); }, [favorites]);

  // Refresh favorites from storage when the modal opens — covers the race where
  // the component mounted before Firebase auth resolved so the initial load
  // returned [] under the missing-uid branch.
  useEffect(() => { if (open) setFavorites(loadFavorites()); }, [open]);

  const relPath = useMemo(
    () => currentPath === activeSource ? '' : currentPath.replace(activeSource + '/', ''),
    [currentPath, activeSource],
  );
  useEffect(() => { setPathInput(relPath); }, [relPath]);

  useEffect(() => {
    if (creatingFolder) newFolderInputRef.current?.focus();
  }, [creatingFolder]);

  // ── filtering ─────────────────────────────────────────────────────────────

  const visibleFolders = useMemo(
    () => showPrivate ? folders : folders.filter(f => !f.name.startsWith('_')),
    [folders, showPrivate],
  );

  const visibleIcons = useMemo(
    () => showPrivate ? icons : icons.filter(i => !isUnderPrivateFolder(i.key)),
    [icons, showPrivate],
  );

  // ── search ────────────────────────────────────────────────────────────────

  const handleSearch = async (value: string) => {
    setSearch(value);
    if (value && !allIcons && !loadingAll) {
      setLoadingAll(true);
      try {
        // Scope search to the current folder and its subtree — not the whole source
        const result = await r2List(currentPath + '/', '');
        setAllIcons(
          result.objects
            .filter((obj) => !isDotFile(obj.key))
            .map((obj) => ({
              key: obj.key,
              url: obj.url,
              name: obj.key.split('/').pop()!.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
              size: obj.size,
              uploaded: obj.uploaded,
            })),
        );
      } catch {
        setAllIcons([]);
      } finally {
        setLoadingAll(false);
      }
    }
  };

  const displayedIcons = useMemo(() => {
    if (!search) return visibleIcons;
    const base = (allIcons ?? []).filter(
      (i) =>
        i.name.toLowerCase().includes(search.toLowerCase()) ||
        i.key.toLowerCase().includes(search.toLowerCase()),
    );
    return showPrivate ? base : base.filter(i => !isUnderPrivateFolder(i.key));
  }, [search, visibleIcons, allIcons, showPrivate]);

  // ── upload ────────────────────────────────────────────────────────────────

  // Upload one queued item end-to-end: WebP conversion → r2Upload with progress
  // → optimistic insert into the current listing. Updates the queue entry as
  // it progresses (pending → uploading%→ done | error). Returns true on success.
  const runQueueUpload = async (
    file: File,
    queueId: string,
    opts: { toTemp: boolean },
  ): Promise<boolean> => {
    setUploadQueue((prev) =>
      prev.map((q) => q.id === queueId ? { ...q, status: 'uploading', progress: 0 } : q),
    );
    try {
      const targetSize = activeSource === 'tokens' ? { width: 400, height: 400 } : { width: 126, height: 126 };
      const converted = await convertToWebP(file, 1.0, targetSize);
      const fileName = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}.webp`;
      const uploadPath = opts.toTemp
        ? `${activeSource}/_temp/${fileName}`
        : `${currentPath}/${fileName}`;
      const { url } = await r2Upload(converted, uploadPath, (pct) => {
        setUploadQueue((prev) =>
          prev.map((q) => q.id === queueId ? { ...q, progress: pct } : q),
        );
      }, activeBundleId);
      setUploadQueue((prev) =>
        prev.map((q) => q.id === queueId ? { ...q, status: 'done', progress: 100 } : q),
      );
      if (!opts.toTemp) {
        setIcons((prev) => [
          ...prev,
          { key: uploadPath, url, name: fileName.replace('.webp', ''), size: converted.size, uploaded: new Date().toISOString() },
        ]);
        setAllIcons(null);
      }
      return true;
    } catch (err: any) {
      setUploadQueue((prev) =>
        prev.map((q) => q.id === queueId ? { ...q, status: 'error', error: err?.message ?? 'Unknown error' } : q),
      );
      return false;
    }
  };

  // Clear the queue a few seconds after the last upload settles so users see
  // the "Done" / "Failed" state before it disappears.
  const scheduleQueueClear = () => {
    setTimeout(() => {
      setUploadQueue((prev) =>
        prev.some((q) => q.status === 'uploading' || q.status === 'pending') ? prev : [],
      );
    }, 3000);
  };

  // Drag-and-drop: enqueue all files upfront, then upload sequentially so the
  // worker's WebP conversion path doesn't get slammed in parallel.
  const handleDroppedFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
    if (files.length === 0) { toast.error('Drop image files only'); return; }

    const newItems: UploadQueueItem[] = files.map((f) => ({
      id: Math.random().toString(36).slice(2),
      name: f.name,
      progress: 0,
      status: 'pending',
    }));
    setUploadQueue((prev) => [...prev, ...newItems]);

    let ok = 0;
    let fail = 0;
    for (let i = 0; i < files.length; i++) {
      // eslint-disable-next-line no-await-in-loop
      const success = await runQueueUpload(files[i], newItems[i].id, { toTemp: false });
      if (success) ok++; else fail++;
    }
    if (files.length === 1) {
      if (ok) toast.success(`${activeSource === 'tokens' ? 'Token' : 'Icon'} uploaded`);
      // single-file failures show their error in the queue entry; no separate toast
    } else {
      const parts: string[] = [];
      if (ok) parts.push(`${ok} uploaded`);
      if (fail) parts.push(`${fail} failed`);
      (fail && !ok ? toast.error : toast.success)(parts.join(' · '));
    }
    scheduleQueueClear();
  };

  // Single-file upload from the panel's Choose File button. Uses the same queue
  // pipeline so the user sees per-file progress instead of a generic spinner.
  const handleFileUpload = async (file: File) => {
    if (!file.type.startsWith('image/')) { toast.error('Please select an image file'); return; }
    const item: UploadQueueItem = {
      id: Math.random().toString(36).slice(2),
      name: file.name,
      progress: 0,
      status: 'pending',
    };
    setUploadQueue((prev) => [...prev, item]);
    const ok = await runQueueUpload(file, item.id, { toTemp: uploadToTemp });
    if (ok) {
      toast.success(uploadToTemp
        ? 'Uploaded to _temp — move it via Image Manager'
        : `${activeSource === 'tokens' ? 'Token' : 'Icon'} uploaded`);
      setShowUpload(false);
    }
    scheduleQueueClear();
  };

  // ── create folder ─────────────────────────────────────────────────────────

  const handleCreateFolder = async () => {
    const safe = sanitizeFolderName(newFolderName);
    if (!safe) { toast.error('Folder name cannot be empty'); return; }
    if (folders.some(f => f.name === safe)) { toast.error('A folder with that name already exists'); return; }
    setCreateBusy(true);
    try {
      const marker = new File(['placeholder'], '.keep', { type: 'text/plain' });
      await r2Upload(marker, `${currentPath}/${safe}/.keep`);
      setCreatingFolder(false);
      setNewFolderName('');
      setAllIcons(null);
      await loadFolder(currentPath);
      toast.success(`Created folder "${safe}"`);
    } catch (err: any) {
      toast.error('Failed to create folder: ' + err.message);
    } finally {
      setCreateBusy(false);
    }
  };

  // ── navigation ────────────────────────────────────────────────────────────

  const goUp = () => {
    if (currentPath === activeSource) return;
    const segs = currentPath.split('/');
    segs.pop();
    setCurrentPath(segs.join('/') || activeSource);
  };

  const commitPathInput = () => {
    const rel = normalizeRelPath(pathInput);
    const target = rel ? `${activeSource}/${rel}` : activeSource;
    setCurrentPath(target);
  };

  // ── favorites ─────────────────────────────────────────────────────────────

  const currentSourceFavorites = useMemo(
    () => favorites.filter(f => f.source === activeSource),
    [favorites, activeSource],
  );

  const isCurrentPathFavorited = useMemo(
    () => favorites.some(f => f.source === activeSource && f.path === currentPath),
    [favorites, activeSource, currentPath],
  );

  const toggleCurrentPathFavorite = () => {
    setFavorites((prev) => {
      const exists = prev.some(f => f.source === activeSource && f.path === currentPath);
      if (exists) return prev.filter(f => !(f.source === activeSource && f.path === currentPath));
      return [...prev, { source: activeSource, path: currentPath }];
    });
  };

  const removeFavorite = (fav: Favorite) => {
    setFavorites((prev) => prev.filter(f => !(f.source === fav.source && f.path === fav.path)));
  };

  const labelForFavorite = (fav: Favorite) => {
    const rel = fav.path === fav.source ? '' : fav.path.replace(fav.source + '/', '');
    return rel || fav.source;
  };

  // ── render helpers ────────────────────────────────────────────────────────

  const title = activeSource === 'tokens' ? 'Browse Tokens' : 'Browse Icons';
  const sizeLabel = activeSource === 'tokens' ? '400×400' : '126×126';
  const atRoot = currentPath === activeSource;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        // Do NOT add `relative` here — DialogContent ships with `position: fixed`
        // for centering. tailwind-merge would drop `fixed` in favour of `relative`,
        // dumping the modal at the bottom of the page. `fixed` already creates a
        // containing block for the absolutely-positioned drag overlay below.
        //
        // `dialog-content` brings the site bg/border tokens; sizing is per the
        // standard wide-editor pattern (95vw on mobile, capped at max-w-5xl).
        // Fixed h-[720px] keeps the modal a stable shape regardless of folder
        // content count (it doesn't grow/shrink as you navigate).
        className="dialog-content sm:max-w-[95vw] lg:max-w-5xl flex flex-col h-[720px] max-h-[90vh] gap-0"
        onDragEnter={(e) => {
          if (!canManage) return;
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          setIsDraggingOver(true);
        }}
        onDragOver={(e) => {
          if (!canManage) return;
          if (e.dataTransfer.types.includes('Files')) e.preventDefault();
        }}
        onDragLeave={(e) => {
          if (!isDraggingOver) return;
          const related = e.relatedTarget as Node | null;
          if (!related || !e.currentTarget.contains(related)) {
            setIsDraggingOver(false);
          }
        }}
        onDrop={(e) => {
          if (!canManage) return;
          if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
          e.preventDefault();
          setIsDraggingOver(false);
          handleDroppedFiles(e.dataTransfer.files);
        }}
      >
        {/* Drag-over overlay (admin only) */}
        {canManage && isDraggingOver && (
          <div className="absolute inset-0 z-30 rounded-xl border-2 border-dashed border-gold bg-gold/10 backdrop-blur-sm flex flex-col items-center justify-center gap-3 pointer-events-none">
            <Upload className="w-10 h-10 text-gold" />
            <p className="text-sm font-semibold text-gold">
              Drop into {currentPath}/
            </p>
            <p className="text-xs text-gold/60">Auto-cropped to {sizeLabel} · WebP</p>
          </div>
        )}

        <DialogHeader className="dialog-header shrink-0">
          <DialogTitle className="dialog-title">{title}</DialogTitle>
        </DialogHeader>

        {/* Source tabs — only rendered when more than one source is enabled */}
        {AVAILABLE_SOURCES.length > 1 && (
          <div className="px-4 pt-2 shrink-0 flex items-center gap-1 border-b border-gold/10">
            {AVAILABLE_SOURCES.map((src) => (
              <button
                key={src}
                onClick={() => resetForSource(src)}
                className={cn(
                  'px-3 py-1.5 text-[11px] uppercase tracking-widest font-bold transition-colors border-b-2 -mb-px',
                  activeSource === src
                    ? 'text-gold border-gold'
                    : 'text-ink/40 border-transparent hover:text-gold/70',
                )}
              >
                {src === 'icons' ? 'Icons' : 'Tokens'}
              </button>
            ))}
          </div>
        )}

        {/* Row 1 — path navigation */}
        <div className="px-4 py-2 border-b border-gold/10 shrink-0 flex items-center gap-2">
          <button
            onClick={goUp}
            disabled={atRoot}
            title="Up one level"
            className={cn(
              'p-1.5 rounded border border-gold/20 transition-colors shrink-0',
              atRoot
                ? 'text-ink/20 border-gold/5 cursor-not-allowed'
                : 'text-gold hover:bg-gold/10',
            )}
          >
            <ArrowUp className="w-3.5 h-3.5" />
          </button>

          <div className="relative flex-1 min-w-0">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] uppercase tracking-widest text-ink/30 pointer-events-none font-bold">
              {activeSource}/
            </span>
            <Input
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') commitPathInput(); }}
              onBlur={commitPathInput}
              placeholder=""
              spellCheck={false}
              className="h-8 text-xs bg-background/50 border-gold/20"
              style={{ paddingLeft: `${activeSource.length * 6 + 18}px` }}
            />
          </div>

          <button
            onClick={toggleCurrentPathFavorite}
            title={isCurrentPathFavorited ? 'Remove from favorites' : 'Add to favorites'}
            className={cn(
              'p-1.5 rounded border transition-colors shrink-0',
              isCurrentPathFavorited
                ? 'bg-gold/20 text-gold border-gold/40'
                : 'text-ink/40 hover:text-gold border-gold/20',
            )}
          >
            <Star
              className="w-3.5 h-3.5"
              fill={isCurrentPathFavorited ? 'currentColor' : 'none'}
            />
          </button>

          {canManage && (
            <button
              onClick={() => setCreatingFolder(v => !v)}
              title="Create folder"
              className={cn(
                'p-1.5 rounded border transition-colors shrink-0',
                creatingFolder
                  ? 'bg-gold/20 text-gold border-gold/40'
                  : 'text-gold hover:bg-gold/10 border-gold/20',
              )}
            >
              <FolderPlus className="w-3.5 h-3.5" />
            </button>
          )}

          {canManage && (
            <button
              onClick={() => setShowPrivate(v => !v)}
              title={showPrivate ? 'Hide private folders' : 'Show private folders (_temp, etc.)'}
              className={cn(
                'p-1.5 rounded border transition-colors shrink-0',
                showPrivate
                  ? 'bg-gold/20 text-gold border-gold/40'
                  : 'text-ink/40 hover:text-gold border-gold/20',
              )}
            >
              {showPrivate ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            </button>
          )}

          <button
            onClick={() => { loadFolder(currentPath); setAllIcons(null); }}
            className="p-1.5 rounded border border-gold/20 text-ink/40 hover:text-gold hover:bg-gold/10 transition-colors shrink-0"
            title="Refresh"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
          </button>
        </div>

        {/* Favorites strip */}
        {currentSourceFavorites.length > 0 && (
          <div className="px-4 py-2 border-b border-gold/10 shrink-0 flex items-start gap-2 flex-wrap">
            <span className="label-text shrink-0 pt-0.5">Favorites</span>
            <div className="flex items-center gap-1 flex-wrap">
              {currentSourceFavorites.map((fav) => {
                const isActive = fav.path === currentPath;
                return (
                  <div
                    key={fav.path}
                    className={cn(
                      'group flex items-center text-[11px] rounded border transition-colors',
                      isActive
                        ? 'bg-gold/20 text-gold border-gold/40'
                        : 'border-gold/15 text-ink/55 hover:text-gold hover:border-gold/30',
                    )}
                  >
                    <button
                      onClick={() => setCurrentPath(fav.path)}
                      className="pl-2 pr-1 py-0.5"
                      title={fav.path}
                    >
                      {labelForFavorite(fav)}
                    </button>
                    <button
                      onClick={() => removeFavorite(fav)}
                      title="Remove favorite"
                      className="pr-1.5 pl-0.5 py-0.5 text-ink/30 hover:text-ink/70"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Inline create-folder row (admin only) */}
        {canManage && creatingFolder && (
          <div className="px-4 py-2 border-b border-gold/10 shrink-0 bg-gold/5 flex items-center gap-2">
            <Folder className="w-3.5 h-3.5 text-gold/60 shrink-0" />
            <Input
              ref={newFolderInputRef}
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateFolder();
                else if (e.key === 'Escape') { setCreatingFolder(false); setNewFolderName(''); }
              }}
              placeholder="new-folder-name"
              spellCheck={false}
              className="h-7 text-xs bg-background/50 border-gold/20 flex-1"
            />
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-[10px] uppercase tracking-widest font-bold btn-gold-solid"
              onClick={handleCreateFolder}
              disabled={createBusy || !newFolderName.trim()}
            >
              {createBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Create'}
            </Button>
            <button
              onClick={() => { setCreatingFolder(false); setNewFolderName(''); }}
              className="text-ink/40 hover:text-ink/60 shrink-0"
              title="Cancel"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Row 2 — search, display mode, upload */}
        <div className="px-4 py-2 border-b border-gold/10 shrink-0 flex items-center gap-3">
          <div className="relative flex-1 min-w-0">
            <SearchInput
              value={search}
              onChange={handleSearch}
              placeholder="Filter results…"
              size="sm"
              className="bg-background/50 border-gold/20"
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

          <div className="flex items-center border border-gold/20 rounded shrink-0 overflow-hidden">
            <button
              onClick={() => setDisplayMode('list')}
              title="List view"
              className={cn(
                'p-1.5 transition-colors',
                displayMode === 'list'
                  ? 'bg-gold/20 text-gold'
                  : 'text-ink/40 hover:text-gold hover:bg-gold/10',
              )}
            >
              <ListIcon className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setDisplayMode('tiles')}
              title="Tile view"
              className={cn(
                'p-1.5 transition-colors border-l border-gold/20',
                displayMode === 'tiles'
                  ? 'bg-gold/20 text-gold'
                  : 'text-ink/40 hover:text-gold hover:bg-gold/10',
              )}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
          </div>

          {canManage && (
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
          )}
        </div>

        {/* Upload panel (admin only) */}
        {canManage && showUpload && (
          <div className="px-4 py-3 border-b border-gold/10 shrink-0 bg-gold/5 space-y-2.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="label-text shrink-0">Upload to:</span>
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

        {/* Upload queue — per-file progress with aggregate bar (cap visible to 10 rows) */}
        {uploadQueue.length > 0 && (() => {
          const total = uploadQueue.length;
          const settled = uploadQueue.filter((q) => q.status === 'done' || q.status === 'error').length;
          const failedCount = uploadQueue.filter((q) => q.status === 'error').length;
          // Aggregate counts each item 0–100; settled rows count as 100, the in-flight one contributes its current progress
          const aggregatePct = Math.round(
            uploadQueue.reduce((sum, q) =>
              sum + (q.status === 'done' || q.status === 'error' ? 100 : q.progress),
              0,
            ) / total,
          );
          // Sort uploading → pending → error → done so the most-relevant rows are at the top
          const sortRank = { uploading: 0, pending: 1, error: 2, done: 3 } as const;
          const sorted = [...uploadQueue].sort((a, b) => sortRank[a.status] - sortRank[b.status]);
          const VISIBLE_CAP = 10;
          const visible = sorted.slice(0, VISIBLE_CAP);
          const hidden = total - visible.length;
          const hiddenPending = sorted.slice(VISIBLE_CAP).filter((q) => q.status === 'pending' || q.status === 'uploading').length;
          const hiddenDone = sorted.slice(VISIBLE_CAP).filter((q) => q.status === 'done').length;
          const hiddenFailed = sorted.slice(VISIBLE_CAP).filter((q) => q.status === 'error').length;

          return (
            <div className="px-4 py-3 border-b border-gold/10 shrink-0 bg-card/40 space-y-2.5">
              {/* Aggregate row */}
              <div>
                <div className="flex items-center justify-between gap-3 mb-1">
                  <span className="text-[10px] uppercase tracking-widest text-ink/50">
                    {uploading
                      ? `Uploading · ${settled}/${total} complete${failedCount ? ` · ${failedCount} failed` : ''}`
                      : failedCount && failedCount === total
                        ? `Upload failed (${failedCount}/${total})`
                        : `Upload complete · ${settled}/${total}${failedCount ? ` (${failedCount} failed)` : ''}`}
                  </span>
                  <span className="text-[10px] text-gold/70 tabular-nums">{aggregatePct}%</span>
                </div>
                <div className="h-1.5 bg-gold/10 rounded-full overflow-hidden">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all duration-200',
                      failedCount && failedCount === total ? 'bg-blood/60' : 'bg-gold',
                    )}
                    style={{ width: `${aggregatePct}%` }}
                  />
                </div>
              </div>

              {/* Per-file rows (sorted, capped) */}
              <div className="space-y-1.5 max-h-32 overflow-y-auto custom-scrollbar">
                {visible.map((item) => (
                  <div key={item.id} className="text-xs">
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <span className="text-ink/60 truncate">{item.name}</span>
                      {item.status === 'done' && (
                        <span className="text-green-400 text-[10px] shrink-0 font-bold">Done</span>
                      )}
                      {item.status === 'error' && (
                        <span className="text-blood text-[10px] shrink-0 font-bold">Failed</span>
                      )}
                      {item.status === 'uploading' && (
                        <span className="text-gold/60 text-[10px] shrink-0 tabular-nums">{Math.round(item.progress)}%</span>
                      )}
                      {item.status === 'pending' && (
                        <span className="text-ink/30 text-[10px] shrink-0">Queued</span>
                      )}
                    </div>
                    {item.status === 'uploading' && (
                      <div className="h-1 bg-gold/10 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gold rounded-full transition-all duration-200"
                          style={{ width: `${item.progress}%` }}
                        />
                      </div>
                    )}
                    {item.status === 'done' && <div className="h-1 bg-green-500/30 rounded-full" />}
                    {item.status === 'error' && (
                      <p className="text-[10px] text-blood mt-0.5 truncate">{item.error}</p>
                    )}
                  </div>
                ))}
              </div>

              {hidden > 0 && (
                <p className="text-[10px] text-ink/35 italic">
                  …and {hidden} more
                  {hiddenPending ? ` · ${hiddenPending} queued` : ''}
                  {hiddenDone ? ` · ${hiddenDone} done` : ''}
                  {hiddenFailed ? ` · ${hiddenFailed} failed` : ''}
                </p>
              )}
            </div>
          );
        })()}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 min-h-0 custom-scrollbar">
          {loading && !search ? (
            displayMode === 'tiles' ? (
              <div className="grid grid-cols-5 sm:grid-cols-7 lg:grid-cols-9 gap-2">
                {Array.from({ length: 27 }).map((_, i) => (
                  <div key={i} className="aspect-square bg-gold/5 animate-pulse rounded border border-gold/10" />
                ))}
              </div>
            ) : (
              <div className="space-y-1">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-10 bg-gold/5 animate-pulse rounded border border-gold/10" />
                ))}
              </div>
            )
          ) : search ? (
            loadingAll ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-6 h-6 animate-spin text-gold/40" />
              </div>
            ) : displayedIcons.length === 0 ? (
              <div className="empty-state">
                <Search className="w-10 h-10 text-gold/20 mb-3" />
                <p className="text-sm text-ink/40 italic">
                  No {activeSource === 'tokens' ? 'tokens' : 'icons'} match "{search}"
                </p>
              </div>
            ) : (
              <>
                <p className="text-xs text-ink/40 mb-3">
                  {displayedIcons.length} result{displayedIcons.length !== 1 ? 's' : ''}
                </p>
                <IconResults
                  icons={displayedIcons}
                  mode={displayMode}
                  onSelect={(url) => { onSelect(url); onClose(); }}
                />
              </>
            )
          ) : (
            <div className="space-y-3">
              {visibleFolders.length > 0 && (
                <div className="space-y-0.5">
                  {visibleFolders.map((f) => (
                    <button
                      key={f.fullPath}
                      onClick={() => setCurrentPath(f.fullPath)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 border border-transparent hover:border-gold/20 hover:bg-gold/8 rounded transition-all text-left group"
                    >
                      <Folder className="w-4 h-4 text-gold/50 group-hover:text-gold/80 shrink-0" />
                      <span className="text-sm text-ink/65 group-hover:text-ink/90">
                        {f.name}
                      </span>
                      {f.name.startsWith('_') && (
                        <span className="text-[9px] uppercase tracking-widest text-ink/30 ml-auto">private</span>
                      )}
                    </button>
                  ))}
                  {displayedIcons.length > 0 && (
                    <div className="border-t border-gold/10 my-2" />
                  )}
                </div>
              )}

              {displayedIcons.length > 0 ? (
                <IconResults
                  icons={displayedIcons}
                  mode={displayMode}
                  onSelect={(url) => { onSelect(url); onClose(); }}
                />
              ) : visibleFolders.length === 0 ? (
                <div className="empty-state">
                  <ImageIcon className="w-10 h-10 text-gold/20 mb-3" />
                  <p className="text-sm text-ink/40 italic">
                    No {activeSource === 'tokens' ? 'tokens' : 'icons'} here yet
                    {canManage ? ' — upload one to get started.' : '.'}
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

// ── results renderers ─────────────────────────────────────────────────────────

function IconResults({
  icons,
  mode,
  onSelect,
}: {
  icons: BrowseIcon[];
  mode: DisplayMode;
  onSelect: (url: string) => void;
}) {
  if (mode === 'list') return <IconList icons={icons} onSelect={onSelect} />;
  return <IconGrid icons={icons} onSelect={onSelect} />;
}

function IconGrid({
  icons,
  onSelect,
}: {
  icons: BrowseIcon[];
  onSelect: (url: string) => void;
}) {
  return (
    <div className="grid grid-cols-5 sm:grid-cols-7 lg:grid-cols-9 gap-1.5">
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

function IconList({
  icons,
  onSelect,
}: {
  icons: BrowseIcon[];
  onSelect: (url: string) => void;
}) {
  return (
    <div className="space-y-0.5">
      {icons.map((icon) => (
        <button
          key={icon.key}
          onClick={() => onSelect(icon.url)}
          title={icon.key}
          className="w-full flex items-center gap-3 px-2 py-1.5 border border-transparent hover:border-gold/30 hover:bg-gold/8 rounded transition-all text-left group"
        >
          <div className="w-9 h-9 shrink-0 flex items-center justify-center bg-background/40 rounded border border-gold/10">
            <img
              src={icon.url}
              alt={icon.name}
              className="w-full h-full object-contain"
              referrerPolicy="no-referrer"
              onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0.15'; }}
            />
          </div>
          <span className="text-sm text-ink/70 group-hover:text-ink/95 truncate flex-1 min-w-0">
            {icon.name}
          </span>
          <span className="text-[10px] text-ink/30 tabular-nums shrink-0 w-16 text-right">
            {formatBytes(icon.size)}
          </span>
          <span className="text-[10px] text-ink/30 tabular-nums shrink-0 w-24 text-right">
            {formatDate(icon.uploaded)}
          </span>
        </button>
      ))}
    </div>
  );
}
