import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { storage } from '../../lib/firebase';
import {
  ref, listAll, getDownloadURL, getMetadata, deleteObject,
  StorageReference,
} from 'firebase/storage';
import {
  ImageMetadata,
  saveImageMetadata,
  getImageMetadataByPath,
  deleteImageMetadata,
  scanForReferences,
  ImageReference,
} from '../../lib/imageMetadata';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs';
import { ImageUpload } from '../../components/ui/ImageUpload';
import {
  Image as ImageIcon, Folder, ChevronRight, Home, Copy, Edit2, Save,
  X, Trash2, RefreshCw, ExternalLink, AlertTriangle, Info, Search,
  Upload, Github,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';

// ── constants ─────────────────────────────────────────────────────────────────

const ALLOWED_ROLES = ['admin', 'co-dm', 'lore-writer'];
const CATALOG_URL =
  'https://cdn.jsdelivr.net/gh/JeanPaulSR/Dauligor-Assets@main/catalog.json';

// ── types ─────────────────────────────────────────────────────────────────────

interface StorageItem {
  ref: StorageReference;
  url: string;
  name: string;
  fullPath: string;
  size?: number;
  timeCreated?: string;
}

interface StorageFolder {
  ref: StorageReference;
  name: string;
  fullPath: string;
}

interface IconEntry {
  id: string;
  name: string;
  category: string;
  url: string;
  author?: string;
  license?: string;
  tags?: string[];
}

// ── helpers ───────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

// ── component ─────────────────────────────────────────────────────────────────

export default function ImageManager({ userProfile }: { userProfile: any }) {
  const role = userProfile?.role;

  if (!ALLOWED_ROLES.includes(role)) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <ImageIcon className="w-12 h-12 text-gold/20 mb-4" />
        <p className="text-ink/40 italic">You don't have permission to access the Image Manager.</p>
      </div>
    );
  }

  const isAdmin = role === 'admin';

  // ── image library state ───────────────────────────────────────────────────

  const [currentPath, setCurrentPath] = useState('images');
  const [folders, setFolders] = useState<StorageFolder[]>([]);
  const [items, setItems] = useState<StorageItem[]>([]);
  const [loadingFolder, setLoadingFolder] = useState(false);

  const [selectedItem, setSelectedItem] = useState<StorageItem | null>(null);
  const [metadata, setMetadata] = useState<ImageMetadata | null>(null);
  const [editedMeta, setEditedMeta] = useState<Partial<ImageMetadata>>({});
  const [editingMeta, setEditingMeta] = useState(false);
  const [savingMeta, setSavingMeta] = useState(false);

  const [scanning, setScanning] = useState(false);
  const [references, setReferences] = useState<ImageReference[] | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [showUpload, setShowUpload] = useState(false);

  // ── icon library state ────────────────────────────────────────────────────

  const [iconSearch, setIconSearch] = useState('');
  const [iconCatalog, setIconCatalog] = useState<IconEntry[] | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  // ── folder loading ────────────────────────────────────────────────────────

  const loadFolder = useCallback(async (path: string) => {
    setLoadingFolder(true);
    setSelectedItem(null);
    setReferences(null);
    setShowDeleteConfirm(false);
    setShowUpload(false);
    try {
      const result = await listAll(ref(storage, path));

      setFolders(
        result.prefixes.map((r) => ({ ref: r, name: r.name, fullPath: r.fullPath })),
      );

      const loaded: StorageItem[] = await Promise.all(
        result.items.map(async (r) => {
          try {
            const [url, meta] = await Promise.all([getDownloadURL(r), getMetadata(r)]);
            return { ref: r, url, name: r.name, fullPath: r.fullPath, size: meta.size, timeCreated: meta.timeCreated };
          } catch {
            return { ref: r, url: '', name: r.name, fullPath: r.fullPath };
          }
        }),
      );

      setItems(loaded.filter((i) => i.url));
    } catch (err: any) {
      toast.error('Failed to load folder: ' + (err.message ?? 'Unknown error'));
    } finally {
      setLoadingFolder(false);
    }
  }, []);

  useEffect(() => { loadFolder(currentPath); }, [currentPath, loadFolder]);

  // ── item selection ────────────────────────────────────────────────────────

  const selectItem = async (item: StorageItem) => {
    setSelectedItem(item);
    setMetadata(null);
    setEditedMeta({});
    setEditingMeta(false);
    setReferences(null);
    setShowDeleteConfirm(false);
    const meta = await getImageMetadataByPath(item.fullPath);
    setMetadata(meta);
    if (meta) setEditedMeta(meta);
  };

  // ── metadata save ─────────────────────────────────────────────────────────

  const handleSaveMeta = async () => {
    if (!selectedItem) return;
    setSavingMeta(true);
    try {
      await saveImageMetadata(selectedItem.fullPath, {
        url: selectedItem.url,
        filename: selectedItem.name,
        folder: currentPath,
        uploadedBy: userProfile?.uid,
        uploadedByName: userProfile?.displayName,
        ...editedMeta,
      });
      const refreshed = await getImageMetadataByPath(selectedItem.fullPath);
      setMetadata(refreshed);
      setEditingMeta(false);
      toast.success('Metadata saved');
    } catch (err: any) {
      toast.error('Save failed: ' + (err.message ?? 'Unknown error'));
    } finally {
      setSavingMeta(false);
    }
  };

  // ── delete with scan ──────────────────────────────────────────────────────

  const handleScanAndDelete = async () => {
    if (!selectedItem) return;
    setScanning(true);
    try {
      const refs = await scanForReferences(selectedItem.url);
      setReferences(refs);
      setShowDeleteConfirm(true);
    } catch (err: any) {
      toast.error('Scan failed: ' + (err.message ?? 'Unknown error'));
    } finally {
      setScanning(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!selectedItem) return;
    setDeleting(true);
    try {
      await deleteObject(selectedItem.ref);
      await deleteImageMetadata(selectedItem.fullPath);
      toast.success('Image deleted');
      setItems((prev) => prev.filter((i) => i.fullPath !== selectedItem.fullPath));
      setSelectedItem(null);
      setMetadata(null);
      setReferences(null);
      setShowDeleteConfirm(false);
    } catch (err: any) {
      toast.error('Delete failed: ' + (err.message ?? 'Unknown error'));
    } finally {
      setDeleting(false);
    }
  };

  // ── icon catalog ──────────────────────────────────────────────────────────

  const loadIconCatalog = async () => {
    setLoadingCatalog(true);
    setCatalogError(null);
    try {
      const res = await fetch(CATALOG_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const icons: IconEntry[] = (data.categories ?? []).flatMap((cat: any) =>
        (cat.icons ?? []).map((icon: any) => ({ ...icon, category: cat.name })),
      );
      setIconCatalog(icons);
    } catch (err: any) {
      setCatalogError(err.message);
      setIconCatalog(null);
    } finally {
      setLoadingCatalog(false);
    }
  };

  const filteredIcons = (iconCatalog ?? []).filter(
    (icon) =>
      !iconSearch ||
      icon.name.toLowerCase().includes(iconSearch.toLowerCase()) ||
      icon.category.toLowerCase().includes(iconSearch.toLowerCase()) ||
      icon.tags?.some((t) => t.toLowerCase().includes(iconSearch.toLowerCase())),
  );

  // ── breadcrumb ────────────────────────────────────────────────────────────

  const breadcrumb = currentPath ? currentPath.split('/').filter(Boolean) : [];

  const navigateToSegment = (index: number) => {
    setCurrentPath(breadcrumb.slice(0, index + 1).join('/'));
  };

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-20">
      {/* Header */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-gold mb-1">
            <ImageIcon className="w-5 h-5" />
            <span className="label-text">Admin</span>
          </div>
          <h1 className="h2-title uppercase">Image Manager</h1>
        </div>
      </div>

      <Tabs defaultValue="images">
        <TabsList>
          <TabsTrigger value="images">Image Library</TabsTrigger>
          <TabsTrigger value="icons">Icon Library</TabsTrigger>
        </TabsList>

        {/* ─────────────────────────────────────────────────────────────────
            IMAGE LIBRARY TAB
        ──────────────────────────────────────────────────────────────────── */}
        <TabsContent value="images" className="mt-6">
          <div className="grid lg:grid-cols-[1fr_320px] gap-6 items-start">

            {/* Left: folder browser */}
            <div className="space-y-4">
              {/* Breadcrumb + controls */}
              <div className="flex items-center gap-1 text-xs flex-wrap border border-gold/10 rounded-lg px-3 py-2 bg-card/30">
                <button
                  onClick={() => setCurrentPath('images')}
                  className="text-gold hover:text-white transition-colors flex items-center gap-1 shrink-0"
                >
                  <Home className="w-3 h-3" /> Root
                </button>
                {breadcrumb.map((seg, i) => (
                  <React.Fragment key={i}>
                    <ChevronRight className="w-3 h-3 text-ink/20 shrink-0" />
                    <button
                      onClick={() => navigateToSegment(i)}
                      className={cn(
                        'transition-colors',
                        i === breadcrumb.length - 1
                          ? 'text-ink/50 cursor-default'
                          : 'text-gold hover:text-white',
                      )}
                    >
                      {seg}
                    </button>
                  </React.Fragment>
                ))}
                <div className="ml-auto flex items-center gap-2">
                  <button
                    onClick={() => setShowUpload((v) => !v)}
                    className={cn(
                      'flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest border transition-colors',
                      showUpload
                        ? 'bg-gold/20 text-gold border-gold/40'
                        : 'text-ink/40 border-gold/10 hover:border-gold/30 hover:text-gold/60',
                    )}
                  >
                    <Upload className="w-2.5 h-2.5" /> Upload
                  </button>
                  <button
                    onClick={() => loadFolder(currentPath)}
                    className="text-ink/40 hover:text-gold transition-colors"
                    title="Refresh"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loadingFolder ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>

              {/* Inline upload */}
              {showUpload && (
                <div className="border border-gold/20 rounded-lg p-4 bg-card/30">
                  <ImageUpload
                    storagePath={`${currentPath}/`}
                    onUpload={(url) => {
                      toast.success('Image uploaded');
                      setShowUpload(false);
                      loadFolder(currentPath);
                    }}
                  />
                </div>
              )}

              {loadingFolder ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="aspect-square bg-gold/5 animate-pulse rounded-lg border border-gold/10" />
                  ))}
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Sub-folders */}
                  {folders.length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                      {folders.map((folder) => (
                        <button
                          key={folder.fullPath}
                          onClick={() => setCurrentPath(folder.fullPath)}
                          className="flex items-center gap-2 p-3 border border-gold/20 rounded-lg bg-gold/5 hover:bg-gold/10 hover:border-gold/40 transition-all text-left group"
                        >
                          <Folder className="w-4 h-4 text-gold/60 group-hover:text-gold shrink-0" />
                          <span className="text-xs font-medium text-ink/70 group-hover:text-ink truncate">
                            {folder.name}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Images grid */}
                  {items.length > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                      {items.map((item) => (
                        <button
                          key={item.fullPath}
                          onClick={() => selectItem(item)}
                          className={cn(
                            'relative aspect-square rounded-lg overflow-hidden border-2 transition-all group',
                            selectedItem?.fullPath === item.fullPath
                              ? 'border-gold shadow-lg shadow-gold/20'
                              : 'border-gold/20 hover:border-gold/50',
                          )}
                        >
                          <img
                            src={item.url}
                            alt={item.name}
                            className="w-full h-full object-cover"
                            referrerPolicy="no-referrer"
                          />
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                          <div className="absolute bottom-0 inset-x-0 bg-black/70 px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <p className="text-[9px] text-white truncate">{item.name}</p>
                            {item.size && (
                              <p className="text-[8px] text-white/50">{formatBytes(item.size)}</p>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : folders.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 border border-dashed border-gold/20 rounded-lg">
                      <ImageIcon className="w-10 h-10 text-gold/20 mb-3" />
                      <p className="text-sm text-ink/40 italic">No images in this folder</p>
                    </div>
                  ) : null}
                </div>
              )}
            </div>

            {/* Right: detail panel */}
            <div className="space-y-4 sticky top-4">
              {selectedItem ? (
                <>
                  {/* Preview */}
                  <div className="rounded-lg overflow-hidden border border-gold/20 bg-card">
                    <img
                      src={selectedItem.url}
                      alt={selectedItem.name}
                      className="w-full object-contain max-h-52"
                      referrerPolicy="no-referrer"
                    />
                  </div>

                  {/* File info */}
                  <div className="border border-gold/20 rounded-lg p-4 space-y-2 bg-card/30">
                    <p className="label-text text-gold/80">File Info</p>
                    <div className="space-y-1 text-xs text-ink/60">
                      <p className="break-all"><span className="text-ink/40">Name: </span>{selectedItem.name}</p>
                      <p className="break-all"><span className="text-ink/40">Path: </span>{selectedItem.fullPath}</p>
                      {selectedItem.size && (
                        <p><span className="text-ink/40">Size: </span>{formatBytes(selectedItem.size)}</p>
                      )}
                      {selectedItem.timeCreated && (
                        <p><span className="text-ink/40">Uploaded: </span>{new Date(selectedItem.timeCreated).toLocaleDateString()}</p>
                      )}
                    </div>
                    <div className="flex gap-2 pt-1">
                      <Button
                        size="sm" variant="ghost"
                        className="h-7 text-xs btn-gold flex-1 gap-1"
                        onClick={() => { navigator.clipboard.writeText(selectedItem.url); toast.success('URL copied'); }}
                      >
                        <Copy className="w-3 h-3" /> Copy URL
                      </Button>
                      <Link
                        to={`/images/view?url=${encodeURIComponent(selectedItem.url)}`}
                        target="_blank"
                      >
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 btn-gold">
                          <ExternalLink className="w-3 h-3" />
                        </Button>
                      </Link>
                    </div>
                  </div>

                  {/* Metadata */}
                  <div className="border border-gold/20 rounded-lg p-4 space-y-3 bg-card/30">
                    <div className="flex items-center justify-between">
                      <p className="label-text text-gold/80">Metadata</p>
                      {!editingMeta ? (
                        <Button
                          size="sm" variant="ghost"
                          className="h-6 text-xs btn-gold gap-1"
                          onClick={() => { setEditingMeta(true); setEditedMeta(metadata ?? {}); }}
                        >
                          <Edit2 className="w-3 h-3" /> Edit
                        </Button>
                      ) : (
                        <div className="flex gap-1">
                          <Button
                            size="sm" variant="ghost"
                            className="h-6 w-6 p-0 text-ink/40 hover:text-blood"
                            onClick={() => setEditingMeta(false)}
                          >
                            <X className="w-3 h-3" />
                          </Button>
                          <Button
                            size="sm" variant="ghost"
                            className="h-6 text-xs btn-gold gap-1"
                            onClick={handleSaveMeta}
                            disabled={savingMeta}
                          >
                            <Save className="w-3 h-3" />
                            {savingMeta ? 'Saving…' : 'Save'}
                          </Button>
                        </div>
                      )}
                    </div>

                    {editingMeta ? (
                      <div className="space-y-2">
                        {([
                          { key: 'creator',     label: 'Creator / Artist' },
                          { key: 'description', label: 'Description' },
                          { key: 'license',     label: 'License (e.g. CC BY 3.0)' },
                          { key: 'source',      label: 'Source / Link' },
                        ] as const).map(({ key, label }) => (
                          <div key={key}>
                            <label className="text-[10px] uppercase tracking-widest text-ink/40 block mb-0.5">
                              {label}
                            </label>
                            <Input
                              value={(editedMeta as any)[key] ?? ''}
                              onChange={(e) => setEditedMeta((prev) => ({ ...prev, [key]: e.target.value }))}
                              className="h-7 text-xs bg-background/50 border-gold/20"
                            />
                          </div>
                        ))}
                        <div>
                          <label className="text-[10px] uppercase tracking-widest text-ink/40 block mb-0.5">
                            Tags (comma-separated)
                          </label>
                          <Input
                            value={(editedMeta.tags ?? []).join(', ')}
                            onChange={(e) =>
                              setEditedMeta((prev) => ({
                                ...prev,
                                tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean),
                              }))
                            }
                            className="h-7 text-xs bg-background/50 border-gold/20"
                          />
                        </div>
                      </div>
                    ) : metadata ? (
                      <div className="space-y-1.5 text-xs">
                        {metadata.creator && (
                          <p><span className="text-ink/40">Creator: </span>{metadata.creator}</p>
                        )}
                        {metadata.description && (
                          <p><span className="text-ink/40">Description: </span>{metadata.description}</p>
                        )}
                        {metadata.license && (
                          <p><span className="text-ink/40">License: </span>{metadata.license}</p>
                        )}
                        {metadata.source && (
                          <p>
                            <span className="text-ink/40">Source: </span>
                            <a
                              href={metadata.source}
                              className="text-gold hover:underline"
                              target="_blank"
                              rel="noreferrer"
                            >
                              {metadata.source}
                            </a>
                          </p>
                        )}
                        {metadata.uploadedByName && (
                          <p><span className="text-ink/40">Uploaded by: </span>{metadata.uploadedByName}</p>
                        )}
                        {(metadata.tags?.length ?? 0) > 0 && (
                          <div className="flex flex-wrap gap-1 pt-1">
                            {metadata.tags!.map((t) => (
                              <Badge key={t} variant="outline" className="text-[9px] h-4 px-1.5 border-gold/20 text-ink/60">
                                {t}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-ink/40 italic">
                        No metadata yet. Click Edit to add creator details.
                      </p>
                    )}
                  </div>

                  {/* Delete (admin only) */}
                  {isAdmin && (
                    <div className="border border-blood/20 rounded-lg p-4 space-y-3 bg-card/30">
                      <p className="label-text text-blood/70">Danger Zone</p>
                      {!showDeleteConfirm ? (
                        <Button
                          size="sm" variant="ghost"
                          className="w-full h-8 text-xs text-blood/60 hover:text-blood hover:bg-blood/10 border border-blood/20 gap-2"
                          onClick={handleScanAndDelete}
                          disabled={scanning}
                        >
                          <Trash2 className="w-3 h-3" />
                          {scanning ? 'Scanning for references…' : 'Delete Image'}
                        </Button>
                      ) : (
                        <div className="space-y-3">
                          {references && references.length > 0 ? (
                            <div className="space-y-2">
                              <div className="flex items-start gap-2 p-2 bg-yellow-500/10 border border-yellow-500/30 rounded text-xs">
                                <AlertTriangle className="w-3.5 h-3.5 text-yellow-400 shrink-0 mt-0.5" />
                                <p className="text-yellow-200/80">
                                  Referenced in {references.length} place{references.length > 1 ? 's' : ''}.
                                  Deleting will break those links.
                                </p>
                              </div>
                              <div className="max-h-32 overflow-y-auto space-y-1">
                                {references.map((r, i) => (
                                  <div
                                    key={i}
                                    className="text-[10px] text-ink/60 flex gap-2 border-b border-gold/5 pb-1 last:border-0"
                                  >
                                    <span className="text-ink/40 capitalize shrink-0">{r.collection}</span>
                                    <span className="font-medium text-ink/70 truncate">{r.name}</span>
                                    <span className="text-ink/30 shrink-0">({r.field})</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 p-2 bg-green-500/10 border border-green-500/30 rounded text-xs text-green-300/80">
                              <Info className="w-3.5 h-3.5 shrink-0" />
                              No references found — safe to delete.
                            </div>
                          )}
                          <div className="flex gap-2">
                            <Button
                              size="sm" variant="ghost"
                              className="flex-1 h-8 text-xs text-ink/40 border border-gold/10 hover:text-ink"
                              onClick={() => setShowDeleteConfirm(false)}
                            >
                              Cancel
                            </Button>
                            <Button
                              size="sm"
                              className="flex-1 h-8 text-xs bg-blood hover:bg-blood/90 text-white gap-1"
                              onClick={handleConfirmDelete}
                              disabled={deleting}
                            >
                              <Trash2 className="w-3 h-3" />
                              {deleting ? 'Deleting…' : 'Confirm Delete'}
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 border border-dashed border-gold/20 rounded-lg text-center">
                  <ImageIcon className="w-10 h-10 text-gold/20 mb-3" />
                  <p className="text-sm text-ink/40 italic">Select an image to view details</p>
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ─────────────────────────────────────────────────────────────────
            ICON LIBRARY TAB
        ──────────────────────────────────────────────────────────────────── */}
        <TabsContent value="icons" className="mt-6 space-y-6">
          {/* Setup guide */}
          <div className="border border-gold/20 rounded-lg p-5 space-y-4 bg-card/30">
            <div className="flex items-center gap-2">
              <Github className="w-5 h-5 text-gold/60" />
              <h3 className="label-text text-gold">GitHub Assets Repo</h3>
              <a
                href="https://github.com/JeanPaulSR/Dauligor-Assets"
                target="_blank"
                rel="noreferrer"
                className="ml-auto text-xs text-gold/50 hover:text-gold flex items-center gap-1 transition-colors"
              >
                JeanPaulSR/Dauligor-Assets <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <p className="text-sm text-ink/60">
              Icons are served via jsDelivr CDN. Add a <code className="text-gold/80 bg-gold/10 px-1 rounded text-xs">catalog.json</code> to the repo root with this structure:
            </p>
            <pre className="bg-black/40 border border-gold/10 rounded p-3 text-xs overflow-x-auto text-ink/60 leading-relaxed">{`{
  "version": 1,
  "categories": [
    {
      "id": "magic",
      "name": "Magic",
      "icons": [
        {
          "id": "fireball",
          "name": "Fireball",
          "url": "https://cdn.jsdelivr.net/npm/game-icons@1.0.0/icons/lorc/originals/svg/fireball.svg",
          "author": "Lorc",
          "license": "CC BY 3.0",
          "tags": ["fire", "magic", "spell"]
        }
      ]
    }
  ]
}`}</pre>
            <div className="flex items-start gap-2 p-3 bg-gold/5 border border-gold/20 rounded text-xs text-ink/60">
              <Info className="w-3.5 h-3.5 text-gold/60 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p>
                  <strong className="text-ink/80">game-icons.net icons</strong> don't need to be copied — reference them by
                  CDN URL: <code className="text-gold/70">https://cdn.jsdelivr.net/npm/game-icons@1.0.0/icons/&#123;author&#125;/originals/svg/&#123;name&#125;.svg</code>
                </p>
                <p>
                  <strong className="text-ink/80">Custom icons</strong> stored in the repo use:
                  <code className="text-gold/70"> https://cdn.jsdelivr.net/gh/JeanPaulSR/Dauligor-Assets@main/icons/&#123;path&#125;</code>
                </p>
                <p>
                  game-icons.net icons are licensed <strong className="text-ink/80">CC BY 3.0</strong> — include an
                  ATTRIBUTION.md in your repo crediting individual artists.
                </p>
              </div>
            </div>
            <Button
              size="sm"
              className="btn-gold-solid gap-2 h-8 text-xs"
              onClick={loadIconCatalog}
              disabled={loadingCatalog}
            >
              <RefreshCw className={`w-3 h-3 ${loadingCatalog ? 'animate-spin' : ''}`} />
              {loadingCatalog ? 'Loading…' : iconCatalog ? 'Reload Catalog' : 'Load Catalog'}
            </Button>
          </div>

          {/* Error state */}
          {catalogError && (
            <div className="flex items-center gap-2 p-3 border border-blood/30 bg-blood/5 rounded text-sm text-blood/80">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>
                Could not load catalog — make sure <code>catalog.json</code> exists at the repo root. ({catalogError})
              </span>
            </div>
          )}

          {/* Icon grid */}
          {iconCatalog !== null && (
            <div className="space-y-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink/30 pointer-events-none" />
                <Input
                  placeholder="Search by name, category or tag…"
                  value={iconSearch}
                  onChange={(e) => setIconSearch(e.target.value)}
                  className="pl-9 bg-background/50 border-gold/20"
                />
              </div>

              <p className="text-xs text-ink/40">
                {filteredIcons.length} icon{filteredIcons.length !== 1 ? 's' : ''} — click any to copy URL
              </p>

              {filteredIcons.length === 0 ? (
                <p className="text-sm text-ink/40 italic text-center py-8">No icons match your search.</p>
              ) : (
                <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-12 gap-3">
                  {filteredIcons.map((icon) => (
                    <button
                      key={icon.id}
                      title={[icon.name, icon.author, icon.license].filter(Boolean).join(' · ')}
                      onClick={() => {
                        navigator.clipboard.writeText(icon.url);
                        toast.success(`Copied URL for "${icon.name}"`);
                      }}
                      className="flex flex-col items-center gap-1.5 p-2 border border-gold/10 rounded-lg hover:border-gold/40 hover:bg-gold/5 transition-all group"
                    >
                      <img
                        src={icon.url}
                        alt={icon.name}
                        className="w-8 h-8 object-contain filter invert opacity-60 group-hover:opacity-100 transition-opacity"
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.opacity = '0.15';
                        }}
                      />
                      <span className="text-[9px] text-ink/50 group-hover:text-ink/80 truncate w-full text-center leading-tight">
                        {icon.name}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
