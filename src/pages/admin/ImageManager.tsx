import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../../lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import { r2List, r2Delete, r2Rename } from '../../lib/r2';
import {
  ImageMetadata,
  saveImageMetadata,
  getImageMetadataByPath,
  deleteImageMetadata,
  scanForReferences,
  updateImageReferences,
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
  Upload, Lock, Shield,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';

// ── constants ─────────────────────────────────────────────────────────────────

const ALLOWED_ROLES = ['admin', 'co-dm', 'lore-writer'];

// Subfolders of images/ whose contents are managed by entity editors.
// Hidden in Image Library; shown (read-only) in System Images.
const SYSTEM_FOLDER_NAMES = ['classes', 'subclasses', 'lore', 'characters', 'sources', 'users'];

const SYSTEM_SECTIONS = [
  {
    key: 'classes',
    label: 'Classes',
    prefix: 'images/classes/',
    col: 'classes',
    nameField: 'name',
    description: 'Class artwork, card and preview images',
  },
  {
    key: 'subclasses',
    label: 'Subclasses',
    prefix: 'images/subclasses/',
    col: 'subclasses',
    nameField: 'name',
    description: 'Subclass artwork',
  },
  {
    key: 'lore',
    label: 'Article Headers',
    prefix: 'images/lore/',
    col: 'loreArticles',
    nameField: 'title',
    description: 'Lore article header / cover images',
  },
  {
    key: 'characters',
    label: 'Characters',
    prefix: 'images/characters/',
    col: 'characters',
    nameField: 'name',
    description: 'Character portraits',
  },
  {
    key: 'sources',
    label: 'Sources',
    prefix: 'images/sources/',
    col: 'sources',
    nameField: 'name',
    description: 'Source book cover images',
  },
  {
    key: 'users',
    label: 'Users',
    prefix: 'images/users/',
    col: 'users',
    nameField: 'displayName',
    description: 'User avatar images',
  },
] as const;

type SysSection = typeof SYSTEM_SECTIONS[number];

// ── types ─────────────────────────────────────────────────────────────────────

interface StorageItem {
  key: string;
  url: string;
  name: string;
  fullPath: string;
  size?: number;
  timeCreated?: string;
}

interface StorageFolder {
  name: string;
  fullPath: string;
  displayName?: string;
}

interface IconEntry {
  id: string;
  name: string;
  category: string;
  url: string;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

async function fetchNameMap(col: string, nameField: string): Promise<Map<string, string>> {
  try {
    const snap = await getDocs(collection(db, col));
    return new Map(snap.docs.map((d) => [d.id, (d.data()[nameField] as string) || d.id]));
  } catch {
    return new Map();
  }
}

function mapObjects(objects: { key: string; url: string; size: number; uploaded: string | null }[]): StorageItem[] {
  return objects.map((obj) => ({
    key: obj.key,
    url: obj.url,
    name: obj.key.split('/').pop() || obj.key,
    fullPath: obj.key,
    size: obj.size,
    timeCreated: obj.uploaded ?? undefined,
  }));
}

// ── shared sub-components ─────────────────────────────────────────────────────

function MetadataPanel({
  metadata,
  editedMeta,
  editing,
  saving,
  onEdit,
  onCancel,
  onSave,
  onChange,
}: {
  metadata: ImageMetadata | null;
  editedMeta: Partial<ImageMetadata>;
  editing: boolean;
  saving: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  onChange: (updates: Partial<ImageMetadata>) => void;
}) {
  return (
    <div className="border border-gold/20 rounded-lg p-4 space-y-3 bg-card/30">
      <div className="flex items-center justify-between">
        <p className="label-text text-gold/80">Metadata</p>
        {!editing ? (
          <Button size="sm" variant="ghost" className="h-6 text-xs btn-gold gap-1" onClick={onEdit}>
            <Edit2 className="w-3 h-3" /> Edit
          </Button>
        ) : (
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-ink/40 hover:text-blood" onClick={onCancel}>
              <X className="w-3 h-3" />
            </Button>
            <Button size="sm" variant="ghost" className="h-6 text-xs btn-gold gap-1" onClick={onSave} disabled={saving}>
              <Save className="w-3 h-3" />{saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        )}
      </div>

      {editing ? (
        <div className="space-y-2">
          {([
            { key: 'creator',     label: 'Creator / Artist' },
            { key: 'description', label: 'Description' },
            { key: 'license',     label: 'License (e.g. CC BY 3.0)' },
            { key: 'source',      label: 'Source / Link' },
          ] as const).map(({ key, label }) => (
            <div key={key}>
              <label className="text-[10px] uppercase tracking-widest text-ink/40 block mb-0.5">{label}</label>
              <Input
                value={(editedMeta as any)[key] ?? ''}
                onChange={(e) => onChange({ [key]: e.target.value })}
                className="h-7 text-xs bg-background/50 border-gold/20"
              />
            </div>
          ))}
          <div>
            <label className="text-[10px] uppercase tracking-widest text-ink/40 block mb-0.5">Tags (comma-separated)</label>
            <Input
              value={(editedMeta.tags ?? []).join(', ')}
              onChange={(e) =>
                onChange({ tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })
              }
              className="h-7 text-xs bg-background/50 border-gold/20"
            />
          </div>
        </div>
      ) : metadata ? (
        <div className="space-y-1.5 text-xs">
          {metadata.creator && <p><span className="text-ink/40">Creator: </span>{metadata.creator}</p>}
          {metadata.description && <p><span className="text-ink/40">Description: </span>{metadata.description}</p>}
          {metadata.license && <p><span className="text-ink/40">License: </span>{metadata.license}</p>}
          {metadata.source && (
            <p>
              <span className="text-ink/40">Source: </span>
              <a href={metadata.source} className="text-gold hover:underline" target="_blank" rel="noreferrer">
                {metadata.source}
              </a>
            </p>
          )}
          {metadata.uploadedByName && <p><span className="text-ink/40">Uploaded by: </span>{metadata.uploadedByName}</p>}
          {(metadata.tags?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {metadata.tags!.map((t) => (
                <Badge key={t} variant="outline" className="text-[9px] h-4 px-1.5 border-gold/20 text-ink/60">{t}</Badge>
              ))}
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs text-ink/40 italic">No metadata yet. Click Edit to add creator details.</p>
      )}
    </div>
  );
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

  // ── IMAGE LIBRARY state ───────────────────────────────────────────────────

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
  const [uploadFilename, setUploadFilename] = useState('');

  const [renaming, setRenaming] = useState(false);
  const [renameFolder, setRenameFolder] = useState('');
  const [renameValue, setRenameValue] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);

  // ── SYSTEM IMAGES state ───────────────────────────────────────────────────

  const [sysSection, setSysSection] = useState<SysSection | null>(null);
  const [sysNameMap, setSysNameMap] = useState<Map<string, string>>(new Map());
  const [sysPath, setSysPath] = useState('');
  const [sysFolders, setSysFolders] = useState<StorageFolder[]>([]);
  const [sysItems, setSysItems] = useState<StorageItem[]>([]);
  const [sysLoading, setSysLoading] = useState(false);

  const [sysSelectedItem, setSysSelectedItem] = useState<StorageItem | null>(null);
  const [sysMetadata, setSysMetadata] = useState<ImageMetadata | null>(null);
  const [sysEditedMeta, setSysEditedMeta] = useState<Partial<ImageMetadata>>({});
  const [sysEditingMeta, setSysEditingMeta] = useState(false);
  const [sysSavingMeta, setSysSavingMeta] = useState(false);

  // ── ICON LIBRARY state ────────────────────────────────────────────────────

  const [iconSearch, setIconSearch] = useState('');
  const [iconCatalog, setIconCatalog] = useState<IconEntry[] | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  // ── IMAGE LIBRARY: folder loading ─────────────────────────────────────────

  const loadFolder = useCallback(async (path: string) => {
    setLoadingFolder(true);
    setSelectedItem(null);
    setReferences(null);
    setShowDeleteConfirm(false);
    setShowUpload(false);
    try {
      const prefix = path.endsWith('/') ? path : path + '/';
      const result = await r2List(prefix, '/');

      const allFolders = result.delimitedPrefixes.map((p) => {
        const cleaned = p.replace(/\/$/, '');
        return { name: cleaned.split('/').pop() || cleaned, fullPath: cleaned };
      });

      setFolders(
        path === 'images'
          ? allFolders.filter((f) => !SYSTEM_FOLDER_NAMES.includes(f.name))
          : allFolders,
      );
      setItems(mapObjects(result.objects));
    } catch (err: any) {
      toast.error('Failed to load folder: ' + (err.message ?? 'Unknown error'));
    } finally {
      setLoadingFolder(false);
    }
  }, []);

  useEffect(() => { loadFolder(currentPath); }, [currentPath, loadFolder]);

  // ── IMAGE LIBRARY: item selection ─────────────────────────────────────────

  const selectItem = async (item: StorageItem) => {
    setSelectedItem(item);
    setMetadata(null);
    setEditedMeta({});
    setEditingMeta(false);
    setReferences(null);
    setShowDeleteConfirm(false);
    setRenaming(false);
    const meta = await getImageMetadataByPath(item.fullPath);
    setMetadata(meta);
    if (meta) setEditedMeta(meta);
  };

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

  // ── IMAGE LIBRARY: rename / move ──────────────────────────────────────────

  const handleRename = async () => {
    if (!selectedItem || !renameValue.trim()) return;
    setRenameSaving(true);
    try {
      const ext = selectedItem.key.split('.').pop() || 'webp';
      const safeName = renameValue.trim().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-_]/g, '').toLowerCase();
      const safeFolder = renameFolder.trim().replace(/\/+$/, '');
      const newKey = safeFolder ? `${safeFolder}/${safeName}.${ext}` : `${safeName}.${ext}`;

      if (newKey === selectedItem.key) { setRenaming(false); return; }

      const { url } = await r2Rename(selectedItem.key, newKey);
      const refCount = await updateImageReferences(selectedItem.url, url);

      if (metadata) {
        await saveImageMetadata(newKey, { ...metadata, url, filename: `${safeName}.${ext}`, folder: safeFolder });
        await deleteImageMetadata(selectedItem.key);
      }

      const updated: StorageItem = { ...selectedItem, key: newKey, url, name: `${safeName}.${ext}`, fullPath: newKey };
      setItems((prev) => prev.map((i) => i.key === selectedItem.key ? updated : i));
      setSelectedItem(updated);
      setRenaming(false);

      toast.success(
        refCount > 0
          ? `Moved — ${refCount} reference${refCount > 1 ? 's' : ''} updated automatically`
          : 'Moved (no existing references)',
      );
    } catch (err: any) {
      toast.error('Move failed: ' + (err.message ?? 'Unknown error'));
    } finally {
      setRenameSaving(false);
    }
  };

  // ── IMAGE LIBRARY: delete ─────────────────────────────────────────────────

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
      await r2Delete(selectedItem.key);
      await deleteImageMetadata(selectedItem.fullPath);
      toast.success('Image deleted');
      setItems((prev) => prev.filter((i) => i.key !== selectedItem.key));
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

  // ── SYSTEM IMAGES: navigation ─────────────────────────────────────────────

  const enterSysSection = useCallback(async (section: SysSection) => {
    setSysSection(section);
    setSysPath(section.prefix);
    setSysSelectedItem(null);
    setSysMetadata(null);
    setSysLoading(true);
    try {
      const [result, nameMap] = await Promise.all([
        r2List(section.prefix, '/'),
        fetchNameMap(section.col, section.nameField),
      ]);
      setSysNameMap(nameMap);
      setSysFolders(
        result.delimitedPrefixes.map((p) => {
          const cleaned = p.replace(/\/$/, '');
          const id = cleaned.split('/').pop() || cleaned;
          return { name: id, fullPath: cleaned, displayName: nameMap.get(id) ?? id };
        }),
      );
      setSysItems(mapObjects(result.objects));
    } catch (err: any) {
      toast.error('Failed to load: ' + (err.message ?? 'Unknown error'));
    } finally {
      setSysLoading(false);
    }
  }, []);

  const enterSysFolder = async (folder: StorageFolder, nameMap: Map<string, string>) => {
    setSysPath(folder.fullPath + '/');
    setSysSelectedItem(null);
    setSysMetadata(null);
    setSysLoading(true);
    try {
      const result = await r2List(folder.fullPath + '/', '/');
      setSysFolders(
        result.delimitedPrefixes.map((p) => {
          const cleaned = p.replace(/\/$/, '');
          const id = cleaned.split('/').pop() || cleaned;
          return { name: id, fullPath: cleaned, displayName: nameMap.get(id) ?? id };
        }),
      );
      setSysItems(mapObjects(result.objects));
    } catch (err: any) {
      toast.error('Failed to load folder: ' + (err.message ?? 'Unknown error'));
    } finally {
      setSysLoading(false);
    }
  };

  const selectSysItem = async (item: StorageItem) => {
    setSysSelectedItem(item);
    setSysMetadata(null);
    setSysEditedMeta({});
    setSysEditingMeta(false);
    const meta = await getImageMetadataByPath(item.fullPath);
    setSysMetadata(meta);
    if (meta) setSysEditedMeta(meta);
  };

  const handleSaveSysMeta = async () => {
    if (!sysSelectedItem) return;
    setSysSavingMeta(true);
    try {
      await saveImageMetadata(sysSelectedItem.fullPath, {
        url: sysSelectedItem.url,
        filename: sysSelectedItem.name,
        folder: sysPath,
        uploadedBy: userProfile?.uid,
        uploadedByName: userProfile?.displayName,
        ...sysEditedMeta,
      });
      const refreshed = await getImageMetadataByPath(sysSelectedItem.fullPath);
      setSysMetadata(refreshed);
      setSysEditingMeta(false);
      toast.success('Metadata saved');
    } catch (err: any) {
      toast.error('Save failed: ' + (err.message ?? 'Unknown error'));
    } finally {
      setSysSavingMeta(false);
    }
  };

  // ── ICON LIBRARY ──────────────────────────────────────────────────────────

  const loadIconCatalog = async () => {
    setLoadingCatalog(true);
    setCatalogError(null);
    try {
      const result = await r2List('icons/', '');
      const icons: IconEntry[] = result.objects.map((obj) => {
        const parts = obj.key.split('/');
        const filename = parts[parts.length - 1];
        const name = filename.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
        const category = parts.length > 2 ? parts[parts.length - 2] : 'General';
        return { id: obj.key, name, category, url: obj.url };
      });
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
      icon.category.toLowerCase().includes(iconSearch.toLowerCase()),
  );

  // ── IMAGE LIBRARY: breadcrumb ─────────────────────────────────────────────

  // Relative to images/ root: 'images/content/battles' → ['content', 'battles']
  const breadcrumb = currentPath === 'images'
    ? []
    : currentPath.split('/').slice(1);

  const navigateToSegment = (index: number) => {
    setCurrentPath(['images', ...breadcrumb.slice(0, index + 1)].join('/'));
  };

  // ── SYSTEM IMAGES: breadcrumb helpers ────────────────────────────────────

  const sysPathParts = sysPath ? sysPath.replace(/\/$/, '').split('/').filter(Boolean) : [];
  const sysLevel = !sysSection
    ? 'overview'
    : sysPathParts.length <= 2
    ? 'section'
    : 'folder';

  const sysEntityId = sysLevel === 'folder' ? sysPathParts[sysPathParts.length - 1] : null;
  const sysEntityName = sysEntityId ? (sysNameMap.get(sysEntityId) ?? sysEntityId) : null;

  // Friendly location label for the detail panel (replaces the ID segment with the resolved name)
  const friendlyLocation = (fullPath: string) => {
    const parts = fullPath.split('/');
    const resolved = parts.map((p) => sysNameMap.get(p) ?? p);
    return resolved.join(' / ');
  };

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-20">
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
          <TabsTrigger value="system">System Images</TabsTrigger>
          <TabsTrigger value="icons">Icons</TabsTrigger>
        </TabsList>

        {/* ──────────────────────────────────────────────────────────────────
            IMAGE LIBRARY TAB — freely organised content images
        ─────────────────────────────────────────────────────────────────── */}
        <TabsContent value="images" className="mt-6">
          <div className="grid lg:grid-cols-[1fr_320px] gap-6 items-start">

            {/* Left: folder browser */}
            <div className="space-y-4">
              {/* Breadcrumb */}
              <div className="flex items-center gap-1 text-xs flex-wrap border border-gold/10 rounded-lg px-3 py-2 bg-card/30">
                <button
                  onClick={() => setCurrentPath('images')}
                  className="text-gold hover:text-white transition-colors flex items-center gap-1 shrink-0"
                >
                  <Home className="w-3 h-3" /> Images
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

              {/* Upload panel */}
              {showUpload && (
                <div className="border border-gold/20 rounded-lg p-4 bg-card/30 space-y-3">
                  <div>
                    <label className="text-[10px] uppercase tracking-widest text-ink/40 block mb-1">
                      Filename (optional — leave blank for auto)
                    </label>
                    <Input
                      value={uploadFilename}
                      onChange={(e) => setUploadFilename(e.target.value)}
                      placeholder="e.g. tavern-interior"
                      className="h-7 text-xs bg-background/50 border-gold/20"
                    />
                  </div>
                  <ImageUpload
                    storagePath={`${currentPath}/`}
                    filename={uploadFilename || undefined}
                    allowTypeSelection
                    onUpload={() => {
                      toast.success('Image uploaded');
                      setShowUpload(false);
                      setUploadFilename('');
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
                          <img src={item.url} alt={item.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                          <div className="absolute bottom-0 inset-x-0 bg-black/70 px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <p className="text-[9px] text-white truncate">{item.name}</p>
                            {item.size && <p className="text-[8px] text-white/50">{formatBytes(item.size)}</p>}
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : folders.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 border border-dashed border-gold/20 rounded-lg">
                      <ImageIcon className="w-10 h-10 text-gold/20 mb-3" />
                      <p className="text-sm text-ink/40 italic">No images in this folder</p>
                      <p className="text-xs text-ink/30 mt-1">Use Upload to add content images here</p>
                    </div>
                  ) : null}
                </div>
              )}
            </div>

            {/* Right: detail panel */}
            <div className="space-y-4 sticky top-4">
              {selectedItem ? (
                <>
                  <div className="rounded-lg overflow-hidden border border-gold/20 bg-card">
                    <img src={selectedItem.url} alt={selectedItem.name} className="w-full object-contain max-h-52" referrerPolicy="no-referrer" />
                  </div>

                  <div className="border border-gold/20 rounded-lg p-4 space-y-2 bg-card/30">
                    <p className="label-text text-gold/80">File Info</p>
                    <div className="space-y-1 text-xs text-ink/60">
                      <p className="break-all"><span className="text-ink/40">Name: </span>{selectedItem.name}</p>
                      <p className="break-all"><span className="text-ink/40">Path: </span>{selectedItem.fullPath}</p>
                      {selectedItem.size && <p><span className="text-ink/40">Size: </span>{formatBytes(selectedItem.size)}</p>}
                      {selectedItem.timeCreated && <p><span className="text-ink/40">Uploaded: </span>{new Date(selectedItem.timeCreated).toLocaleDateString()}</p>}
                    </div>
                    <div className="flex gap-2 pt-1">
                      <Button size="sm" variant="ghost" className="h-7 text-xs btn-gold flex-1 gap-1"
                        onClick={() => { navigator.clipboard.writeText(selectedItem.url); toast.success('URL copied'); }}>
                        <Copy className="w-3 h-3" /> Copy URL
                      </Button>
                      <Link to={`/images/view?url=${encodeURIComponent(selectedItem.url)}`} target="_blank">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 btn-gold">
                          <ExternalLink className="w-3 h-3" />
                        </Button>
                      </Link>
                    </div>
                    {/* Rename / Move */}
                    {!renaming ? (
                      <Button size="sm" variant="ghost" className="h-6 text-[10px] btn-gold gap-1 w-full justify-start mt-1"
                        onClick={() => {
                          setRenaming(true);
                          setRenameFolder(selectedItem.key.split('/').slice(0, -1).join('/'));
                          setRenameValue(selectedItem.name.replace(/\.[^.]+$/, ''));
                        }}>
                        <Edit2 className="w-3 h-3" /> Rename / Move
                      </Button>
                    ) : (
                      <div className="space-y-2 pt-1">
                        <div>
                          <label className="text-[9px] uppercase tracking-widest text-ink/40 block mb-0.5">Folder</label>
                          <Input value={renameFolder} onChange={(e) => setRenameFolder(e.target.value)}
                            placeholder="images/content" className="h-7 text-xs bg-background/50 border-gold/20 font-mono" />
                        </div>
                        <div>
                          <label className="text-[9px] uppercase tracking-widest text-ink/40 block mb-0.5">Filename</label>
                          <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)}
                            placeholder="filename" className="h-7 text-xs bg-background/50 border-gold/20 font-mono"
                            onKeyDown={(e) => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setRenaming(false); }}
                            autoFocus />
                        </div>
                        <p className="text-[9px] text-ink/30 font-mono truncate">
                          → {renameFolder ? `${renameFolder.replace(/\/+$/, '')}/` : ''}{renameValue || '…'}.{selectedItem.key.split('.').pop()}
                        </p>
                        <div className="flex gap-2">
                          <Button size="sm" variant="ghost" className="h-7 text-xs text-ink/40 border border-gold/10 flex-1" onClick={() => setRenaming(false)}>
                            Cancel
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs btn-gold gap-1 flex-1" onClick={handleRename} disabled={renameSaving}>
                            <Save className="w-3 h-3" /> {renameSaving ? 'Moving…' : 'Move & Update Links'}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>

                  <MetadataPanel
                    metadata={metadata}
                    editedMeta={editedMeta}
                    editing={editingMeta}
                    saving={savingMeta}
                    onEdit={() => { setEditingMeta(true); setEditedMeta(metadata ?? {}); }}
                    onCancel={() => setEditingMeta(false)}
                    onSave={handleSaveMeta}
                    onChange={(u) => setEditedMeta((prev) => ({ ...prev, ...u }))}
                  />

                  {isAdmin && (
                    <div className="border border-blood/20 rounded-lg p-4 space-y-3 bg-card/30">
                      <p className="label-text text-blood/70">Danger Zone</p>
                      {!showDeleteConfirm ? (
                        <Button size="sm" variant="ghost"
                          className="w-full h-8 text-xs text-blood/60 hover:text-blood hover:bg-blood/10 border border-blood/20 gap-2"
                          onClick={handleScanAndDelete} disabled={scanning}>
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
                                  Referenced in {references.length} place{references.length > 1 ? 's' : ''}. Deleting will break those links.
                                </p>
                              </div>
                              <div className="max-h-32 overflow-y-auto space-y-1">
                                {references.map((r, i) => (
                                  <div key={i} className="text-[10px] text-ink/60 flex gap-2 border-b border-gold/5 pb-1 last:border-0">
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
                            <Button size="sm" variant="ghost" className="flex-1 h-8 text-xs text-ink/40 border border-gold/10 hover:text-ink" onClick={() => setShowDeleteConfirm(false)}>
                              Cancel
                            </Button>
                            <Button size="sm" className="flex-1 h-8 text-xs bg-blood hover:bg-blood/90 text-white gap-1" onClick={handleConfirmDelete} disabled={deleting}>
                              <Trash2 className="w-3 h-3" />{deleting ? 'Deleting…' : 'Confirm Delete'}
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

        {/* ──────────────────────────────────────────────────────────────────
            SYSTEM IMAGES TAB — entity-linked images, read-only
        ─────────────────────────────────────────────────────────────────── */}
        <TabsContent value="system" className="mt-6">
          <div className="grid lg:grid-cols-[1fr_320px] gap-6 items-start">

            <div className="space-y-4">
              {/* Breadcrumb */}
              <div className="flex items-center gap-1 text-xs flex-wrap border border-gold/10 rounded-lg px-3 py-2 bg-card/30">
                <button
                  onClick={() => {
                    setSysSection(null);
                    setSysPath('');
                    setSysFolders([]);
                    setSysItems([]);
                    setSysSelectedItem(null);
                  }}
                  className="text-gold hover:text-white transition-colors flex items-center gap-1 shrink-0"
                >
                  <Shield className="w-3 h-3" /> System Images
                </button>
                {sysSection && (
                  <>
                    <ChevronRight className="w-3 h-3 text-ink/20 shrink-0" />
                    <button
                      onClick={() => enterSysSection(sysSection)}
                      className={cn(
                        'transition-colors',
                        sysLevel === 'section'
                          ? 'text-ink/50 cursor-default'
                          : 'text-gold hover:text-white',
                      )}
                    >
                      {sysSection.label}
                    </button>
                  </>
                )}
                {sysEntityName && (
                  <>
                    <ChevronRight className="w-3 h-3 text-ink/20 shrink-0" />
                    <span className="text-ink/50">{sysEntityName}</span>
                  </>
                )}
                {(sysLoading) && (
                  <RefreshCw className="w-3 h-3 text-gold/50 animate-spin ml-auto" />
                )}
              </div>

              {/* Read-only notice */}
              <div className="flex items-start gap-2 p-3 bg-gold/5 border border-gold/20 rounded text-xs text-ink/50">
                <Lock className="w-3.5 h-3.5 text-gold/50 shrink-0 mt-0.5" />
                <p>
                  These images are managed through their respective editors. You can browse, copy
                  URLs, and edit metadata — but rename and delete are disabled to prevent broken links.
                </p>
              </div>

              {/* Section overview */}
              {!sysSection && (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {SYSTEM_SECTIONS.map((section) => (
                    <button
                      key={section.key}
                      onClick={() => enterSysSection(section)}
                      className="flex items-start gap-3 p-4 border border-gold/20 rounded-lg bg-gold/5 hover:bg-gold/10 hover:border-gold/40 transition-all text-left group"
                    >
                      <Folder className="w-5 h-5 text-gold/60 group-hover:text-gold shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-semibold text-ink/80 group-hover:text-ink">
                          {section.label}
                        </p>
                        <p className="text-[10px] text-ink/40 mt-0.5">{section.description}</p>
                        <p className="text-[9px] font-mono text-ink/20 mt-1">{section.prefix}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* Entity folders or image grid */}
              {sysSection && (
                sysLoading ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div key={i} className="aspect-square bg-gold/5 animate-pulse rounded-lg border border-gold/10" />
                    ))}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Subfolders — display resolved names, show raw ID beneath */}
                    {sysFolders.length > 0 && (
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                        {sysFolders.map((folder) => (
                          <button
                            key={folder.fullPath}
                            onClick={() => enterSysFolder(folder, sysNameMap)}
                            className="flex items-start gap-2 p-3 border border-gold/20 rounded-lg bg-gold/5 hover:bg-gold/10 hover:border-gold/40 transition-all text-left group"
                          >
                            <Folder className="w-4 h-4 text-gold/60 group-hover:text-gold shrink-0 mt-0.5" />
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-ink/80 group-hover:text-ink truncate">
                                {folder.displayName ?? folder.name}
                              </p>
                              {folder.displayName && folder.displayName !== folder.name && (
                                <p className="text-[8px] font-mono text-ink/25 truncate">{folder.name}</p>
                              )}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Images */}
                    {sysItems.length > 0 ? (
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                        {sysItems.map((item) => (
                          <button
                            key={item.fullPath}
                            onClick={() => selectSysItem(item)}
                            className={cn(
                              'relative aspect-square rounded-lg overflow-hidden border-2 transition-all group',
                              sysSelectedItem?.fullPath === item.fullPath
                                ? 'border-gold shadow-lg shadow-gold/20'
                                : 'border-gold/20 hover:border-gold/50',
                            )}
                          >
                            <img src={item.url} alt={item.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                            <div className="absolute bottom-0 inset-x-0 bg-black/70 px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <p className="text-[9px] text-white truncate">{item.name}</p>
                              {item.size && <p className="text-[8px] text-white/50">{formatBytes(item.size)}</p>}
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : sysFolders.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-16 border border-dashed border-gold/20 rounded-lg">
                        <ImageIcon className="w-10 h-10 text-gold/20 mb-3" />
                        <p className="text-sm text-ink/40 italic">No images here yet</p>
                        <p className="text-xs text-ink/30 mt-1">Images appear here once uploaded via the editor</p>
                      </div>
                    ) : null}
                  </div>
                )
              )}
            </div>

            {/* Right: System Images detail panel — no rename / delete */}
            <div className="space-y-4 sticky top-4">
              {sysSelectedItem ? (
                <>
                  <div className="rounded-lg overflow-hidden border border-gold/20 bg-card">
                    <img src={sysSelectedItem.url} alt={sysSelectedItem.name} className="w-full object-contain max-h-52" referrerPolicy="no-referrer" />
                  </div>

                  <div className="border border-gold/20 rounded-lg p-4 space-y-2 bg-card/30">
                    <p className="label-text text-gold/80">File Info</p>
                    <div className="space-y-1 text-xs text-ink/60">
                      <p className="break-all"><span className="text-ink/40">Name: </span>{sysSelectedItem.name}</p>
                      <p className="break-all">
                        <span className="text-ink/40">Location: </span>
                        {friendlyLocation(sysSelectedItem.fullPath)}
                      </p>
                      {sysSelectedItem.size && <p><span className="text-ink/40">Size: </span>{formatBytes(sysSelectedItem.size)}</p>}
                      {sysSelectedItem.timeCreated && (
                        <p><span className="text-ink/40">Uploaded: </span>{new Date(sysSelectedItem.timeCreated).toLocaleDateString()}</p>
                      )}
                    </div>
                    <div className="flex gap-2 pt-1">
                      <Button size="sm" variant="ghost" className="h-7 text-xs btn-gold flex-1 gap-1"
                        onClick={() => { navigator.clipboard.writeText(sysSelectedItem.url); toast.success('URL copied'); }}>
                        <Copy className="w-3 h-3" /> Copy URL
                      </Button>
                      <Link to={`/images/view?url=${encodeURIComponent(sysSelectedItem.url)}`} target="_blank">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 btn-gold">
                          <ExternalLink className="w-3 h-3" />
                        </Button>
                      </Link>
                    </div>
                    <div className="flex items-center gap-1.5 pt-1 text-[9px] text-ink/30">
                      <Lock className="w-2.5 h-2.5" />
                      <span>Managed via {sysSection?.label ?? 'entity'} editor — rename and delete disabled</span>
                    </div>
                  </div>

                  <MetadataPanel
                    metadata={sysMetadata}
                    editedMeta={sysEditedMeta}
                    editing={sysEditingMeta}
                    saving={sysSavingMeta}
                    onEdit={() => { setSysEditingMeta(true); setSysEditedMeta(sysMetadata ?? {}); }}
                    onCancel={() => setSysEditingMeta(false)}
                    onSave={handleSaveSysMeta}
                    onChange={(u) => setSysEditedMeta((prev) => ({ ...prev, ...u }))}
                  />
                </>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 border border-dashed border-gold/20 rounded-lg text-center">
                  <Shield className="w-10 h-10 text-gold/20 mb-3" />
                  <p className="text-sm text-ink/40 italic">Select an image to view details</p>
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ──────────────────────────────────────────────────────────────────
            ICONS TAB
        ─────────────────────────────────────────────────────────────────── */}
        <TabsContent value="icons" className="mt-6 space-y-6">
          <div className="border border-gold/20 rounded-lg p-5 space-y-4 bg-card/30">
            <div className="flex items-center gap-2">
              <ImageIcon className="w-5 h-5 text-gold/60" />
              <h3 className="label-text text-gold">Icon Library</h3>
            </div>
            <div className="flex items-start gap-2 p-3 bg-gold/5 border border-gold/20 rounded text-xs text-ink/60">
              <Info className="w-3.5 h-3.5 text-gold/60 shrink-0 mt-0.5" />
              <p>
                Upload icons via the <strong className="text-ink/80">Image Library</strong> tab or the feature editor's
                compact uploader. Icons live in{' '}
                <code className="text-gold/70 bg-gold/10 px-1 rounded">icons/</code> — subfolders
                become categories. Click any icon to copy its URL.
              </p>
            </div>
            <Button
              size="sm"
              className="btn-gold-solid gap-2 h-8 text-xs"
              onClick={loadIconCatalog}
              disabled={loadingCatalog}
            >
              <RefreshCw className={`w-3 h-3 ${loadingCatalog ? 'animate-spin' : ''}`} />
              {loadingCatalog ? 'Loading…' : iconCatalog ? 'Reload' : 'Load Icons'}
            </Button>
          </div>

          {catalogError && (
            <div className="flex items-center gap-2 p-3 border border-blood/30 bg-blood/5 rounded text-sm text-blood/80">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>Could not load icons — {catalogError}</span>
            </div>
          )}

          {iconCatalog !== null && (
            <div className="space-y-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink/30 pointer-events-none" />
                <Input
                  placeholder="Search by name or category…"
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
                      title={`${icon.name} (${icon.category})`}
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
                        onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0.15'; }}
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
