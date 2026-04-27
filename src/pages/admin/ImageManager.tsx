import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../../lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import { r2List, r2Delete, r2Rename, r2Upload, r2MoveFolder } from '../../lib/r2';
import { convertToWebP } from '../../lib/imageUtils';
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

interface UploadQueueItem {
  id: string;
  name: string;
  progress: number;
  status: 'pending' | 'uploading' | 'done' | 'error';
  error?: string;
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

// Recursively collect files from a drag event, walking into dropped folders.
// Returns { file, relativePath } where relativePath preserves sub-folder structure.
async function readDroppedItems(
  dataTransfer: DataTransfer,
): Promise<{ file: File; relativePath: string }[]> {
  const results: { file: File; relativePath: string }[] = [];

  async function readEntry(entry: FileSystemEntry, parentPath: string): Promise<void> {
    const entryPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject),
      );
      if (file.type.startsWith('image/')) results.push({ file, relativePath: entryPath });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
          reader.readEntries(resolve, reject),
        );
        if (batch.length === 0) break;
        await Promise.all(batch.map((e) => readEntry(e, entryPath)));
      }
    }
  }

  if (dataTransfer.items?.length) {
    await Promise.all(
      Array.from(dataTransfer.items)
        .map((item) => item.webkitGetAsEntry?.())
        .filter((e): e is FileSystemEntry => e != null)
        .map((entry) => readEntry(entry, '')),
    );
  } else {
    // Fallback: items API unavailable
    results.push(
      ...Array.from(dataTransfer.files)
        .filter((f) => f.type.startsWith('image/'))
        .map((f) => ({ file: f, relativePath: f.name })),
    );
  }

  return results;
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

async function countFolderFiles(prefix: string): Promise<number> {
  const p = prefix.endsWith('/') ? prefix : `${prefix}/`;
  const result = await r2List(p, '/');
  const here = result.objects.filter(
    (o) => !o.key.endsWith('/.keep') && !o.key.endsWith('/.gitkeep'),
  ).length;
  const subCounts = await Promise.all(result.delimitedPrefixes.map(countFolderFiles));
  return here + subCounts.reduce((a, b) => a + b, 0);
}

async function moveR2Folder(
  oldPrefix: string,
  newPrefix: string,
  onProgress?: (moved: number) => void,
): Promise<{ count: number }> {
  return r2MoveFolder(oldPrefix, newPrefix, onProgress);
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

  // ── SHARED drag-and-move state ────────────────────────────────────────────

  const [draggingFolder, setDraggingFolder] = useState<StorageFolder | null>(null);
  const [draggingItem, setDraggingItem] = useState<StorageItem | null>(null);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const [movingFolder, setMovingFolder] = useState(false);
  const [folderMoveProgress, setFolderMoveProgress] = useState(0);
  const [folderMoveTotal, setFolderMoveTotal] = useState(0);

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

  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([]);

  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolderLoading, setCreatingFolderLoading] = useState(false);

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

  const [iconBrowsePath, setIconBrowsePath] = useState('icons');
  const [iconBrowseFolders, setIconBrowseFolders] = useState<StorageFolder[]>([]);
  const [iconBrowseItems, setIconBrowseItems] = useState<StorageItem[]>([]);
  const [iconBrowseLoading, setIconBrowseLoading] = useState(false);

  const [creatingIconFolder, setCreatingIconFolder] = useState(false);
  const [newIconFolderName, setNewIconFolderName] = useState('');
  const [creatingIconFolderLoading, setCreatingIconFolderLoading] = useState(false);

  const [showIconUpload, setShowIconUpload] = useState(false);
  const [isIconDragging, setIsIconDragging] = useState(false);
  const [iconUploadQueue, setIconUploadQueue] = useState<UploadQueueItem[]>([]);
  const iconFileInputRef = useRef<HTMLInputElement>(null);

  const [selectedIcon, setSelectedIcon] = useState<StorageItem | null>(null);
  const [iconMoveTarget, setIconMoveTarget] = useState('');
  const [iconMoving, setIconMoving] = useState(false);
  const [iconDeleting, setIconDeleting] = useState(false);
  const [iconDeleteConfirm, setIconDeleteConfirm] = useState(false);

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
      setItems(mapObjects(result.objects.filter((o) => !o.key.endsWith('/.keep') && !o.key.endsWith('/.gitkeep'))));
    } catch (err: any) {
      toast.error('Failed to load folder: ' + (err.message ?? 'Unknown error'));
    } finally {
      setLoadingFolder(false);
    }
  }, []);

  useEffect(() => { loadFolder(currentPath); }, [currentPath, loadFolder]);

  // ── ICON LIBRARY: folder loading ──────────────────────────────────────────

  const loadIconFolder = useCallback(async (path: string) => {
    setIconBrowseLoading(true);
    setSelectedIcon(null);
    try {
      const prefix = path.endsWith('/') ? path : path + '/';
      const result = await r2List(prefix, '/');
      setIconBrowseFolders(
        result.delimitedPrefixes.map((p) => {
          const cleaned = p.replace(/\/$/, '');
          return { name: cleaned.split('/').pop() || cleaned, fullPath: cleaned };
        }),
      );
      setIconBrowseItems(
        mapObjects(result.objects.filter((o) => !o.key.endsWith('/.keep') && !o.key.endsWith('/.gitkeep'))),
      );
    } catch (err: any) {
      toast.error('Failed to load folder: ' + (err.message ?? 'Unknown error'));
    } finally {
      setIconBrowseLoading(false);
    }
  }, []);

  useEffect(() => { loadIconFolder(iconBrowsePath); }, [iconBrowsePath, loadIconFolder]);

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

  // ── ICON LIBRARY: upload ─────────────────────────────────────────────────

  const uploadIconItems = async (items: { file: File; relativePath: string }[], targetPath?: string) => {
    if (items.length === 0) { toast.error('Only image files can be uploaded.'); return; }

    const baseFolder = (targetPath ?? iconBrowsePath).replace(/\/+$/, '') || 'icons/_temp';
    const initialQueue: UploadQueueItem[] = items.map(({ relativePath }) => ({
      id: Math.random().toString(36).slice(2),
      name: relativePath,
      progress: 0,
      status: 'pending',
    }));
    setIconUploadQueue(initialQueue);

    await Promise.all(
      items.map(async ({ file, relativePath }, i) => {
        const itemId = initialQueue[i].id;
        setIconUploadQueue((prev) =>
          prev.map((q) => q.id === itemId ? { ...q, status: 'uploading' } : q),
        );
        try {
          const converted = await convertToWebP(file, 0.85, { width: 126, height: 126 });
          const parts = relativePath.split('/');
          const isNested = parts.length > 1;
          const dirPath = isNested ? parts.slice(0, -1).join('/') + '/' : '';
          const baseName = isNested
            ? parts[parts.length - 1].replace(/\.[^.]+$/, '').replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-_]/g, '').toLowerCase() || 'icon'
            : `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
          await r2Upload(converted, `${baseFolder}/${dirPath}${baseName}.webp`, (pct) =>
            setIconUploadQueue((prev) =>
              prev.map((q) => q.id === itemId ? { ...q, progress: pct } : q),
            ),
          );
          setIconUploadQueue((prev) =>
            prev.map((q) => q.id === itemId ? { ...q, status: 'done', progress: 100 } : q),
          );
        } catch (err: any) {
          setIconUploadQueue((prev) =>
            prev.map((q) => q.id === itemId ? { ...q, status: 'error', error: err.message } : q),
          );
        }
      }),
    );

    loadIconFolder(iconBrowsePath);
    if (iconCatalog !== null) loadIconCatalog();
    setTimeout(() => setIconUploadQueue([]), 3000);
  };

  const handleIconDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsIconDragging(false);
    if (draggingFolder) {
      await performFolderMove(draggingFolder, iconBrowsePath, () => loadIconFolder(iconBrowsePath));
      return;
    }
    if (draggingItem) {
      const item = draggingItem;
      setDraggingItem(null);
      const newKey = `${iconBrowsePath}/${item.name}`;
      if (item.fullPath !== newKey) {
        try {
          await r2Rename(item.fullPath, newKey);
          toast.success(`Moved to ${iconBrowsePath}/`);
          if (selectedIcon?.fullPath === item.fullPath) setSelectedIcon(null);
          loadIconFolder(iconBrowsePath);
          if (iconCatalog !== null) loadIconCatalog();
        } catch (err: any) {
          toast.error('Move failed: ' + (err.message ?? 'Unknown error'));
        }
      }
      return;
    }
    uploadIconItems(await readDroppedItems(e.dataTransfer));
  };

  // ── ICON LIBRARY: selected icon operations ───────────────────────────────

  const handleMoveIcon = async () => {
    if (!selectedIcon || !iconMoveTarget.trim()) return;
    setIconMoving(true);
    try {
      const target = iconMoveTarget.trim().replace(/\/+$/, '');
      const newKey = `${target}/${selectedIcon.name}`;
      const { url } = await r2Rename(selectedIcon.fullPath, newKey);
      await deleteImageMetadata(selectedIcon.fullPath).catch(() => {});
      toast.success(`Moved to ${target}/`);
      setSelectedIcon(null);
      setIconMoveTarget('');
      loadIconFolder(iconBrowsePath);
      if (iconCatalog !== null) loadIconCatalog();
    } catch (err: any) {
      toast.error('Move failed: ' + (err.message ?? 'Unknown error'));
    } finally {
      setIconMoving(false);
    }
  };

  const handleDeleteIcon = async () => {
    if (!selectedIcon) return;
    setIconDeleting(true);
    try {
      await r2Delete(selectedIcon.fullPath);
      await deleteImageMetadata(selectedIcon.fullPath).catch(() => {});
      toast.success('Icon deleted');
      setSelectedIcon(null);
      setIconDeleteConfirm(false);
      loadIconFolder(iconBrowsePath);
      if (iconCatalog !== null) loadIconCatalog();
    } catch (err: any) {
      toast.error('Delete failed: ' + (err.message ?? 'Unknown error'));
    } finally {
      setIconDeleting(false);
    }
  };

  // ── ICON LIBRARY: folder creation ────────────────────────────────────────

  const handleCreateIconFolder = async () => {
    const safe = newIconFolderName.trim().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-_]/g, '').toLowerCase();
    if (!safe) return;
    setCreatingIconFolderLoading(true);
    try {
      const newPath = `${iconBrowsePath}/${safe}`;
      await r2Upload(new File([''], '.keep', { type: 'text/plain' }), `${newPath}/.keep`);
      setCreatingIconFolder(false);
      setNewIconFolderName('');
      setIconBrowsePath(newPath);
    } catch (err: any) {
      toast.error('Failed to create folder: ' + (err.message ?? 'Unknown error'));
    } finally {
      setCreatingIconFolderLoading(false);
    }
  };

  // ── ICON LIBRARY: breadcrumb ──────────────────────────────────────────────

  const iconBreadcrumb = iconBrowsePath === 'icons'
    ? []
    : iconBrowsePath.split('/').slice(1);

  const navigateToIconSegment = (index: number) => {
    setIconBrowsePath(['icons', ...iconBreadcrumb.slice(0, index + 1)].join('/'));
  };

  // ── IMAGE LIBRARY: folder creation ───────────────────────────────────────

  const handleCreateFolder = async () => {
    const safe = newFolderName.trim().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-_]/g, '').toLowerCase();
    if (!safe) return;
    setCreatingFolderLoading(true);
    try {
      const newPath = `${currentPath}/${safe}`;
      // Upload a tiny placeholder so the folder appears in R2 listings
      await r2Upload(new File([''], '.keep', { type: 'text/plain' }), `${newPath}/.keep`);
      setCreatingFolder(false);
      setNewFolderName('');
      setCurrentPath(newPath);
    } catch (err: any) {
      toast.error('Failed to create folder: ' + (err.message ?? 'Unknown error'));
    } finally {
      setCreatingFolderLoading(false);
    }
  };

  // ── IMAGE LIBRARY: folder drop ────────────────────────────────────────────

  const uploadImagesToPath = async (
    droppedItems: { file: File; relativePath: string }[],
    targetPath: string,
  ) => {
    if (droppedItems.length === 0) return;
    const prefix = targetPath.endsWith('/') ? targetPath : targetPath + '/';
    const initialQueue: UploadQueueItem[] = droppedItems.map(({ relativePath }) => ({
      id: Math.random().toString(36).slice(2),
      name: relativePath,
      progress: 0,
      status: 'pending',
    }));
    setUploadQueue(initialQueue);

    await Promise.all(
      droppedItems.map(async ({ file, relativePath }, i) => {
        const itemId = initialQueue[i].id;
        setUploadQueue((prev) =>
          prev.map((q) => q.id === itemId ? { ...q, status: 'uploading' } : q),
        );
        try {
          const converted = await convertToWebP(file, 0.85);
          const parts = relativePath.split('/');
          const isNested = parts.length > 1;
          const dirPath = isNested ? parts.slice(0, -1).join('/') + '/' : '';
          const baseName = isNested
            ? parts[parts.length - 1].replace(/\.[^.]+$/, '').replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-_]/g, '').toLowerCase() || 'image'
            : `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
          await r2Upload(converted, `${prefix}${dirPath}${baseName}.webp`, (pct) =>
            setUploadQueue((prev) =>
              prev.map((q) => q.id === itemId ? { ...q, progress: pct } : q),
            ),
          );
          setUploadQueue((prev) =>
            prev.map((q) => q.id === itemId ? { ...q, status: 'done', progress: 100 } : q),
          );
        } catch (err: any) {
          setUploadQueue((prev) =>
            prev.map((q) => q.id === itemId ? { ...q, status: 'error', error: err.message } : q),
          );
        }
      }),
    );

    loadFolder(currentPath);
    setTimeout(() => setUploadQueue([]), 3000);
  };

  const performFolderMove = async (folder: StorageFolder, targetPath: string, reload: () => void) => {
    // Clear drag state immediately so a bubbled duplicate drop event bails out here.
    setDraggingFolder(null);
    setDropTargetPath(null);
    const newPrefix = `${targetPath}/${folder.name}`;
    if (newPrefix === folder.fullPath) return;
    setMovingFolder(true);
    setFolderMoveProgress(0);
    setFolderMoveTotal(0);
    try {
      // Count total files first so we can show a percentage
      try {
        const total = await countFolderFiles(folder.fullPath);
        setFolderMoveTotal(total);
      } catch { /* non-fatal — progress bar falls back to count display */ }

      const { count } = await moveR2Folder(folder.fullPath, newPrefix, (moved) => {
        setFolderMoveProgress(moved);
      });
      reload();
      toast.success(`Moved "${folder.name}" → ${targetPath}/ (${count} file${count !== 1 ? 's' : ''})`);
    } catch (err: any) {
      toast.error('Move failed: ' + (err.message ?? 'Unknown error'));
    } finally {
      setMovingFolder(false);
      setFolderMoveProgress(0);
      setFolderMoveTotal(0);
    }
  };

  const handleFolderDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    if (draggingFolder) {
      // Internal folder dropped on the page background → move to current path
      await performFolderMove(draggingFolder, currentPath, () => loadFolder(currentPath));
      return;
    }
    const droppedItems = await readDroppedItems(e.dataTransfer);
    if (droppedItems.length === 0) {
      toast.error('No image files found in the dropped items.');
      return;
    }
    uploadImagesToPath(droppedItems, currentPath);
  };

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

            {/* Left: folder browser — also the primary drop zone */}
            <div
              className="space-y-4 relative"
              onDragEnter={(e) => {
                e.preventDefault();
                if (e.dataTransfer.types.includes('Files')) setIsDraggingOver(true);
              }}
              onDragOver={(e) => e.preventDefault()}
              onDragLeave={(e) => {
                if (!e.relatedTarget || !e.currentTarget.contains(e.relatedTarget as Node)) {
                  setIsDraggingOver(false);
                }
              }}
              onDrop={handleFolderDrop}
            >
              {/* Drag-over overlay */}
              {isDraggingOver && (
                <div className="absolute inset-0 z-20 rounded-lg border-2 border-dashed border-gold bg-gold/5 flex flex-col items-center justify-center gap-3 pointer-events-none">
                  <Upload className="w-10 h-10 text-gold" />
                  <p className="text-sm font-semibold text-gold">
                    Drop into {currentPath}/
                  </p>
                  <p className="text-xs text-gold/50">Files and folders supported · auto-converted to WebP</p>
                </div>
              )}

              {/* Breadcrumb */}
              <div className="flex items-center gap-1 text-xs flex-wrap border border-gold/10 rounded-lg px-3 py-2 bg-card/30">
                <button
                  onClick={() => setCurrentPath('images')}
                  onDragOver={(e) => { if (draggingFolder) { e.preventDefault(); setDropTargetPath('images'); }}}
                  onDragLeave={() => setDropTargetPath(null)}
                  onDrop={async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (draggingFolder) await performFolderMove(draggingFolder, 'images', () => loadFolder(currentPath));
                  }}
                  className={cn(
                    'transition-colors flex items-center gap-1 shrink-0 rounded px-1 -mx-1',
                    dropTargetPath === 'images'
                      ? 'text-white bg-gold/30 ring-1 ring-gold/60'
                      : 'text-gold hover:text-white',
                  )}
                >
                  <Home className="w-3 h-3" /> Images
                </button>
                {breadcrumb.map((seg, i) => {
                  const segPath = ['images', ...breadcrumb.slice(0, i + 1)].join('/');
                  return (
                  <React.Fragment key={i}>
                    <ChevronRight className="w-3 h-3 text-ink/20 shrink-0" />
                    <button
                      onClick={() => navigateToSegment(i)}
                      onDragOver={(e) => { if (draggingFolder) { e.preventDefault(); setDropTargetPath(segPath); }}}
                      onDragLeave={() => setDropTargetPath(null)}
                      onDrop={async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (draggingFolder) await performFolderMove(draggingFolder, segPath, () => loadFolder(currentPath));
                      }}
                      className={cn(
                        'transition-colors rounded px-1 -mx-1',
                        dropTargetPath === segPath
                          ? 'text-white bg-gold/30 ring-1 ring-gold/60'
                          : i === breadcrumb.length - 1
                          ? 'text-ink/50 cursor-default'
                          : 'text-gold hover:text-white',
                      )}
                    >
                      {seg}
                    </button>
                  </React.Fragment>
                  );
                })}
                <div className="ml-auto flex items-center gap-2">
                  {/* New Folder inline control */}
                  {creatingFolder ? (
                    <div className="flex items-center gap-1">
                      <Input
                        value={newFolderName}
                        onChange={(e) => setNewFolderName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleCreateFolder();
                          if (e.key === 'Escape') { setCreatingFolder(false); setNewFolderName(''); }
                        }}
                        placeholder="folder-name"
                        className="h-6 w-28 text-[10px] bg-background/50 border-gold/20 font-mono"
                        autoFocus
                      />
                      <button
                        onClick={handleCreateFolder}
                        disabled={creatingFolderLoading || !newFolderName.trim()}
                        className="text-gold hover:text-white transition-colors disabled:opacity-40"
                        title="Create folder"
                      >
                        {creatingFolderLoading
                          ? <RefreshCw className="w-3 h-3 animate-spin" />
                          : <Save className="w-3 h-3" />}
                      </button>
                      <button
                        onClick={() => { setCreatingFolder(false); setNewFolderName(''); }}
                        className="text-ink/40 hover:text-blood transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setCreatingFolder(true); setNewFolderName(''); }}
                      className="text-ink/40 border border-gold/10 hover:border-gold/30 hover:text-gold/60 transition-colors rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest"
                      title="New folder"
                    >
                      + Folder
                    </button>
                  )}
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

              {/* Folder move progress bar */}
              {movingFolder && (
                <div className="flex items-center justify-between px-3 py-2 bg-gold/10 border border-gold/20 rounded-lg text-xs text-gold/80">
                  <div className="flex items-center gap-2">
                    <RefreshCw className="w-3 h-3 animate-spin shrink-0" />
                    <span>Moving folder…</span>
                  </div>
                  {folderMoveTotal > 0 ? (
                    <span>{Math.min(100, Math.round((folderMoveProgress / folderMoveTotal) * 100))}%</span>
                  ) : folderMoveProgress > 0 ? (
                    <span>{folderMoveProgress} files moved</span>
                  ) : (
                    <span>0%</span>
                  )}
                </div>
              )}

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

              {/* Upload queue — visible while files are uploading */}
              {uploadQueue.length > 0 && (
                <div className="border border-gold/20 rounded-lg p-3 bg-card/30 space-y-2">
                  <p className="text-[10px] uppercase tracking-widest text-ink/40">
                    Uploading {uploadQueue.length} file{uploadQueue.length !== 1 ? 's' : ''}
                  </p>
                  <div className="space-y-2">
                    {uploadQueue.map((item) => (
                      <div key={item.id} className="text-xs">
                        <div className="flex items-center justify-between mb-0.5 gap-2">
                          <span className="text-ink/60 truncate">{item.name}</span>
                          {item.status === 'done' && (
                            <span className="text-green-400 text-[10px] shrink-0 font-bold">Done</span>
                          )}
                          {item.status === 'error' && (
                            <span className="text-blood text-[10px] shrink-0 font-bold">Failed</span>
                          )}
                          {item.status === 'uploading' && (
                            <span className="text-gold/60 text-[10px] shrink-0">{Math.round(item.progress)}%</span>
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
                        {item.status === 'done' && (
                          <div className="h-1 bg-green-500/30 rounded-full" />
                        )}
                        {item.status === 'error' && (
                          <p className="text-[10px] text-blood mt-0.5">{item.error}</p>
                        )}
                      </div>
                    ))}
                  </div>
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
                          draggable
                          onClick={() => setCurrentPath(folder.fullPath)}
                          onDragStart={(e) => {
                            setDraggingFolder(folder);
                            e.dataTransfer.setData('application/x-r2-folder', folder.fullPath);
                            e.dataTransfer.effectAllowed = 'move';
                          }}
                          onDragEnd={() => { setDraggingFolder(null); setDropTargetPath(null); }}
                          onDragEnter={(e) => { e.preventDefault(); setDropTargetPath(folder.fullPath); }}
                          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                          onDragLeave={(e) => {
                            if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTargetPath(null);
                          }}
                          onDrop={async (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setDropTargetPath(null);
                            if (draggingFolder && draggingFolder.fullPath !== folder.fullPath) {
                              await performFolderMove(draggingFolder, folder.fullPath, () => loadFolder(currentPath));
                            } else if (e.dataTransfer.files.length > 0) {
                              uploadImagesToPath(await readDroppedItems(e.dataTransfer), folder.fullPath);
                            }
                          }}
                          className={cn(
                            'flex items-center gap-2 p-3 border rounded-lg transition-all text-left group',
                            dropTargetPath === folder.fullPath
                              ? 'border-gold bg-gold/15 shadow-md shadow-gold/20'
                              : draggingFolder?.fullPath === folder.fullPath
                              ? 'opacity-40 border-gold/30 bg-gold/5'
                              : 'border-gold/20 bg-gold/5 hover:bg-gold/10 hover:border-gold/40',
                          )}
                        >
                          <Folder className={cn('w-4 h-4 shrink-0', dropTargetPath === folder.fullPath ? 'text-gold' : 'text-gold/60 group-hover:text-gold')} />
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
                      <Upload className="w-10 h-10 text-gold/20 mb-3" />
                      <p className="text-sm text-ink/40 italic">Drop images here to upload</p>
                      <p className="text-xs text-ink/30 mt-1">or use the Upload button for advanced options</p>
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
        <TabsContent value="icons" className="mt-6">
          <div className="grid lg:grid-cols-[1fr_300px] gap-6 items-start">

          {/* Left: browser + drop zone */}
          <div
            className="space-y-4 relative"
            onDragEnter={(e) => { e.preventDefault(); if (e.dataTransfer.types.includes('Files')) setIsIconDragging(true); }}
            onDragOver={(e) => e.preventDefault()}
            onDragLeave={(e) => {
              if (!e.relatedTarget || !e.currentTarget.contains(e.relatedTarget as Node)) {
                setIsIconDragging(false);
              }
            }}
            onDrop={handleIconDrop}
          >
            {/* Drag-over overlay */}
            {isIconDragging && (
              <div className="absolute inset-0 z-20 rounded-lg border-2 border-dashed border-gold bg-gold/5 flex flex-col items-center justify-center gap-3 pointer-events-none">
                <Upload className="w-10 h-10 text-gold" />
                <p className="text-sm font-semibold text-gold">Drop into {iconBrowsePath}/</p>
                <p className="text-xs text-gold/50">Files and folders supported · auto-cropped to 126×126</p>
              </div>
            )}

            {/* Breadcrumb toolbar */}
            <div className="flex items-center gap-1 text-xs flex-wrap border border-gold/10 rounded-lg px-3 py-2 bg-card/30">
              <button
                onClick={() => setIconBrowsePath('icons')}
                onDragOver={(e) => { if (draggingFolder || draggingItem) { e.preventDefault(); setDropTargetPath('icons'); }}}
                onDragLeave={() => setDropTargetPath(null)}
                onDrop={async (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (draggingFolder) {
                    await performFolderMove(draggingFolder, 'icons', () => loadIconFolder(iconBrowsePath));
                  } else if (draggingItem && draggingItem.fullPath !== `icons/${draggingItem.name}`) {
                    const item = draggingItem;
                    setDraggingItem(null);
                    setDropTargetPath(null);
                    try {
                      await r2Rename(item.fullPath, `icons/${item.name}`);
                      toast.success('Moved to icons/');
                      if (selectedIcon?.fullPath === item.fullPath) setSelectedIcon(null);
                      loadIconFolder(iconBrowsePath);
                      if (iconCatalog !== null) loadIconCatalog();
                    } catch (err: any) { toast.error('Move failed: ' + (err.message ?? 'Unknown error')); }
                  }
                }}
                className={cn(
                  'transition-colors flex items-center gap-1 shrink-0 rounded px-1 -mx-1',
                  dropTargetPath === 'icons'
                    ? 'text-white bg-gold/30 ring-1 ring-gold/60'
                    : 'text-gold hover:text-white',
                )}
              >
                <ImageIcon className="w-3 h-3" /> Icons
              </button>
              {iconBreadcrumb.map((seg, i) => {
                const segPath = ['icons', ...iconBreadcrumb.slice(0, i + 1)].join('/');
                return (
                <React.Fragment key={i}>
                  <ChevronRight className="w-3 h-3 text-ink/20 shrink-0" />
                  <button
                    onClick={() => navigateToIconSegment(i)}
                    onDragOver={(e) => { if (draggingFolder || draggingItem) { e.preventDefault(); setDropTargetPath(segPath); }}}
                    onDragLeave={() => setDropTargetPath(null)}
                    onDrop={async (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (draggingFolder) {
                        await performFolderMove(draggingFolder, segPath, () => loadIconFolder(iconBrowsePath));
                      } else if (draggingItem && draggingItem.fullPath !== `${segPath}/${draggingItem.name}`) {
                        const item = draggingItem;
                        setDraggingItem(null);
                        setDropTargetPath(null);
                        try {
                          await r2Rename(item.fullPath, `${segPath}/${item.name}`);
                          toast.success(`Moved to ${segPath}/`);
                          if (selectedIcon?.fullPath === item.fullPath) setSelectedIcon(null);
                          loadIconFolder(iconBrowsePath);
                          if (iconCatalog !== null) loadIconCatalog();
                        } catch (err: any) { toast.error('Move failed: ' + (err.message ?? 'Unknown error')); }
                      }
                    }}
                    className={cn(
                      'transition-colors rounded px-1 -mx-1',
                      dropTargetPath === segPath
                        ? 'text-white bg-gold/30 ring-1 ring-gold/60'
                        : i === iconBreadcrumb.length - 1
                        ? 'text-ink/50 cursor-default'
                        : 'text-gold hover:text-white',
                    )}
                  >
                    {seg}
                  </button>
                </React.Fragment>
                );
              })}
              <div className="ml-auto flex items-center gap-2">
                {creatingIconFolder ? (
                  <div className="flex items-center gap-1">
                    <Input
                      value={newIconFolderName}
                      onChange={(e) => setNewIconFolderName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleCreateIconFolder();
                        if (e.key === 'Escape') { setCreatingIconFolder(false); setNewIconFolderName(''); }
                      }}
                      placeholder="folder-name"
                      className="h-6 w-28 text-[10px] bg-background/50 border-gold/20 font-mono"
                      autoFocus
                    />
                    <button
                      onClick={handleCreateIconFolder}
                      disabled={creatingIconFolderLoading || !newIconFolderName.trim()}
                      className="text-gold hover:text-white transition-colors disabled:opacity-40"
                      title="Create folder"
                    >
                      {creatingIconFolderLoading
                        ? <RefreshCw className="w-3 h-3 animate-spin" />
                        : <Save className="w-3 h-3" />}
                    </button>
                    <button
                      onClick={() => { setCreatingIconFolder(false); setNewIconFolderName(''); }}
                      className="text-ink/40 hover:text-blood transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => { setCreatingIconFolder(true); setNewIconFolderName(''); }}
                    className="text-ink/40 border border-gold/10 hover:border-gold/30 hover:text-gold/60 transition-colors rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest"
                    title="New folder"
                  >
                    + Folder
                  </button>
                )}
                <button
                  onClick={() => setShowIconUpload((v) => !v)}
                  className={cn(
                    'flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest border transition-colors',
                    showIconUpload
                      ? 'bg-gold/20 text-gold border-gold/40'
                      : 'text-ink/40 border-gold/10 hover:border-gold/30 hover:text-gold/60',
                  )}
                >
                  <Upload className="w-2.5 h-2.5" /> Upload
                </button>
                <button
                  onClick={() => loadIconFolder(iconBrowsePath)}
                  className="text-ink/40 hover:text-gold transition-colors"
                  title="Refresh"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${iconBrowseLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            {/* Folder move progress bar */}
            {movingFolder && (
              <div className="flex items-center justify-between px-3 py-2 bg-gold/10 border border-gold/20 rounded-lg text-xs text-gold/80">
                <div className="flex items-center gap-2">
                  <RefreshCw className="w-3 h-3 animate-spin shrink-0" />
                  <span>Moving folder…</span>
                </div>
                {folderMoveTotal > 0 ? (
                  <span>{Math.min(100, Math.round((folderMoveProgress / folderMoveTotal) * 100))}%</span>
                ) : folderMoveProgress > 0 ? (
                  <span>{folderMoveProgress} files moved</span>
                ) : (
                  <span>0%</span>
                )}
              </div>
            )}

            {/* Info notice */}
            <div className="flex items-start gap-2 p-3 bg-gold/5 border border-gold/20 rounded text-xs text-ink/60">
              <Info className="w-3.5 h-3.5 text-gold/60 shrink-0 mt-0.5" />
              <p>
                Icons are auto-cropped to <strong className="text-ink/70">126×126 px</strong>.
                Click an icon to select it — then copy its URL, move, or delete it from the right panel.
                Drag icons onto a folder or breadcrumb to move them directly.
                Use <strong className="text-ink/70">Search</strong> to query across all categories at once.
              </p>
            </div>

            {/* Upload panel */}
            {showIconUpload && (
              <div className="border border-gold/20 rounded-lg p-4 bg-card/30 space-y-3">
                <p className="text-[10px] uppercase tracking-widest text-ink/40">
                  Upload to: <span className="font-mono text-gold/60">{iconBrowsePath}/</span>
                </p>
                <div
                  className="border-2 border-dashed border-gold/20 rounded-lg p-6 flex flex-col items-center gap-3 text-center hover:border-gold/40 hover:bg-gold/5 transition-colors cursor-pointer"
                  onClick={() => iconFileInputRef.current?.click()}
                >
                  <ImageIcon className="w-8 h-8 text-gold/30" />
                  <div>
                    <p className="text-sm text-ink/60">Click to browse, or drag files / folders anywhere on this page</p>
                    <p className="text-xs text-ink/30 mt-0.5">PNG, JPG, WebP · cropped to 126×126 · multiple files OK</p>
                  </div>
                  <Button type="button" variant="outline" size="sm" className="border-gold/20 hover:bg-gold/10 gap-2 h-7 text-xs pointer-events-none">
                    <Upload className="w-3 h-3" /> Choose Files
                  </Button>
                </div>
                <input
                  ref={iconFileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) {
                      uploadIconItems(
                        Array.from(e.target.files).map((f) => ({ file: f, relativePath: f.name })),
                      );
                    }
                    e.target.value = '';
                  }}
                />
              </div>
            )}

            {/* Upload queue */}
            {iconUploadQueue.length > 0 && (
              <div className="border border-gold/20 rounded-lg p-3 bg-card/30 space-y-2">
                <p className="text-[10px] uppercase tracking-widest text-ink/40">
                  Uploading {iconUploadQueue.length} icon{iconUploadQueue.length !== 1 ? 's' : ''}
                </p>
                <div className="space-y-2">
                  {iconUploadQueue.map((item) => (
                    <div key={item.id} className="text-xs">
                      <div className="flex items-center justify-between mb-0.5 gap-2">
                        <span className="text-ink/60 truncate">{item.name}</span>
                        {item.status === 'done' && <span className="text-green-400 text-[10px] shrink-0 font-bold">Done</span>}
                        {item.status === 'error' && <span className="text-blood text-[10px] shrink-0 font-bold">Failed</span>}
                        {item.status === 'uploading' && <span className="text-gold/60 text-[10px] shrink-0">{Math.round(item.progress)}%</span>}
                      </div>
                      {item.status === 'uploading' && (
                        <div className="h-1 bg-gold/10 rounded-full overflow-hidden">
                          <div className="h-full bg-gold rounded-full transition-all duration-200" style={{ width: `${item.progress}%` }} />
                        </div>
                      )}
                      {item.status === 'done' && <div className="h-1 bg-green-500/30 rounded-full" />}
                      {item.status === 'error' && <p className="text-[10px] text-blood mt-0.5">{item.error}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Search bar */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink/30 pointer-events-none" />
              <Input
                placeholder="Search all icons by name or folder…"
                value={iconSearch}
                onChange={(e) => {
                  setIconSearch(e.target.value);
                  if (e.target.value && iconCatalog === null && !loadingCatalog) loadIconCatalog();
                }}
                className="pl-9 bg-background/50 border-gold/20"
              />
              {iconSearch && (
                <button
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ink/30 hover:text-ink/60"
                  onClick={() => setIconSearch('')}
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Browse mode */}
            {!iconSearch && (
              iconBrowseLoading ? (
                <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-3">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <div key={i} className="aspect-square bg-gold/5 animate-pulse rounded-lg border border-gold/10" />
                  ))}
                </div>
              ) : (
                <div className="space-y-3">
                  {iconBrowseFolders.length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                      {iconBrowseFolders.map((folder) => (
                        <button
                          key={folder.fullPath}
                          draggable
                          onClick={() => setIconBrowsePath(folder.fullPath)}
                          onDragStart={(e) => {
                            setDraggingFolder(folder);
                            e.dataTransfer.setData('application/x-r2-folder', folder.fullPath);
                            e.dataTransfer.effectAllowed = 'move';
                          }}
                          onDragEnd={() => { setDraggingFolder(null); setDropTargetPath(null); }}
                          onDragEnter={(e) => { e.preventDefault(); setDropTargetPath(folder.fullPath); }}
                          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                          onDragLeave={(e) => {
                            if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTargetPath(null);
                          }}
                          onDrop={async (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setDropTargetPath(null);
                            if (draggingFolder && draggingFolder.fullPath !== folder.fullPath) {
                              await performFolderMove(draggingFolder, folder.fullPath, () => loadIconFolder(iconBrowsePath));
                            } else if (draggingItem && draggingItem.fullPath !== `${folder.fullPath}/${draggingItem.name}`) {
                              const item = draggingItem;
                              setDraggingItem(null);
                              try {
                                const newKey = `${folder.fullPath}/${item.name}`;
                                await r2Rename(item.fullPath, newKey);
                                toast.success(`Moved "${item.name}" to ${folder.name}/`);
                                if (selectedIcon?.fullPath === item.fullPath) setSelectedIcon(null);
                                loadIconFolder(iconBrowsePath);
                                if (iconCatalog !== null) loadIconCatalog();
                              } catch (err: any) {
                                toast.error('Move failed: ' + (err.message ?? 'Unknown error'));
                              }
                            } else if (!draggingFolder && !draggingItem && e.dataTransfer.files.length > 0) {
                              uploadIconItems(await readDroppedItems(e.dataTransfer), folder.fullPath);
                            }
                          }}
                          className={cn(
                            'flex items-center gap-2 p-3 border rounded-lg transition-all text-left group',
                            dropTargetPath === folder.fullPath
                              ? 'border-gold bg-gold/15 shadow-md shadow-gold/20'
                              : draggingFolder?.fullPath === folder.fullPath
                              ? 'opacity-40 border-gold/30 bg-gold/5'
                              : 'border-gold/20 bg-gold/5 hover:bg-gold/10 hover:border-gold/40',
                          )}
                        >
                          <Folder className={cn('w-4 h-4 shrink-0', dropTargetPath === folder.fullPath ? 'text-gold' : 'text-gold/60 group-hover:text-gold')} />
                          <span className="text-xs font-medium text-ink/70 group-hover:text-ink truncate">
                            {folder.name}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  {iconBrowseItems.length > 0 ? (
                    <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-3">
                      {iconBrowseItems.map((item) => (
                        <button
                          key={item.fullPath}
                          draggable
                          title={item.name}
                          onClick={() => {
                            setSelectedIcon(item);
                            setIconMoveTarget(item.fullPath.split('/').slice(0, -1).join('/'));
                            setIconDeleteConfirm(false);
                          }}
                          onDragStart={(e) => {
                            setDraggingItem(item);
                            e.dataTransfer.setData('application/x-r2-item', item.fullPath);
                            e.dataTransfer.effectAllowed = 'move';
                          }}
                          onDragEnd={() => setDraggingItem(null)}
                          className={cn(
                            'flex flex-col items-center gap-1.5 p-2 border rounded-lg transition-all group',
                            selectedIcon?.fullPath === item.fullPath
                              ? 'border-gold bg-gold/10'
                              : draggingItem?.fullPath === item.fullPath
                              ? 'opacity-40 border-gold/30 bg-gold/5'
                              : 'border-gold/10 hover:border-gold/40 hover:bg-gold/5',
                          )}
                        >
                          <img
                            src={item.url}
                            alt={item.name}
                            className="w-8 h-8 object-contain opacity-80 group-hover:opacity-100 transition-opacity"
                            referrerPolicy="no-referrer"
                            onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0.15'; }}
                          />
                          <span className="text-[9px] text-ink/50 group-hover:text-ink/80 truncate w-full text-center leading-tight">
                            {item.name.replace(/\.[^.]+$/, '')}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : iconBrowseFolders.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 border border-dashed border-gold/20 rounded-lg">
                      <Upload className="w-10 h-10 text-gold/20 mb-3" />
                      <p className="text-sm text-ink/40 italic">Empty folder — drop icons here to upload</p>
                      <p className="text-xs text-ink/30 mt-1">or use the Upload button above</p>
                    </div>
                  ) : null}
                </div>
              )
            )}

            {/* Search mode */}
            {iconSearch && (() => {
              const filtered = (iconCatalog ?? []).filter(
                (icon) =>
                  icon.name.toLowerCase().includes(iconSearch.toLowerCase()) ||
                  icon.category.toLowerCase().includes(iconSearch.toLowerCase()),
              );
              return (
                <div className="space-y-3">
                  {catalogError && (
                    <div className="flex items-center gap-2 p-3 border border-blood/30 bg-blood/5 rounded text-sm text-blood/80">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>Could not load search index — {catalogError}</span>
                    </div>
                  )}
                  {loadingCatalog && (
                    <div className="flex items-center gap-2 p-3 text-sm text-ink/40">
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Loading search index…</span>
                    </div>
                  )}
                  {iconCatalog !== null && (
                    <>
                      <p className="text-xs text-ink/40">
                        {filtered.length} icon{filtered.length !== 1 ? 's' : ''} matching "{iconSearch}"
                      </p>
                      {filtered.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 border border-dashed border-gold/20 rounded-lg">
                          <ImageIcon className="w-10 h-10 text-gold/20 mb-3" />
                          <p className="text-sm text-ink/40 italic">No icons match your search</p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-3">
                          {filtered.map((icon) => {
                            const item: StorageItem = {
                              key: icon.id,
                              url: icon.url,
                              name: icon.id.split('/').pop() || icon.id,
                              fullPath: icon.id,
                            };
                            return (
                              <button
                                key={icon.id}
                                draggable
                                title={`${icon.name} (${icon.category})`}
                                onClick={() => {
                                  setSelectedIcon(item);
                                  setIconMoveTarget(icon.id.split('/').slice(0, -1).join('/'));
                                  setIconDeleteConfirm(false);
                                }}
                                onDragStart={(e) => {
                                  setDraggingItem(item);
                                  e.dataTransfer.setData('application/x-r2-item', icon.id);
                                  e.dataTransfer.effectAllowed = 'move';
                                }}
                                onDragEnd={() => setDraggingItem(null)}
                                className={cn(
                                  'flex flex-col items-center gap-1.5 p-2 border rounded-lg transition-all group',
                                  selectedIcon?.fullPath === icon.id
                                    ? 'border-gold bg-gold/10'
                                    : draggingItem?.fullPath === icon.id
                                    ? 'opacity-40 border-gold/30 bg-gold/5'
                                    : 'border-gold/10 hover:border-gold/40 hover:bg-gold/5',
                                )}
                              >
                                <img
                                  src={icon.url}
                                  alt={icon.name}
                                  className="w-8 h-8 object-contain opacity-80 group-hover:opacity-100 transition-opacity"
                                  referrerPolicy="no-referrer"
                                  onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0.15'; }}
                                />
                                <span className="text-[9px] text-ink/50 group-hover:text-ink/80 truncate w-full text-center leading-tight">
                                  {icon.name}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })()}
          </div>

          {/* Right: selected icon detail panel */}
          <div className="space-y-4 sticky top-4">
            {selectedIcon ? (
              <>
                <div className="rounded-lg overflow-hidden border border-gold/20 bg-card/50 p-4 flex items-center justify-center min-h-24">
                  <img
                    src={selectedIcon.url}
                    alt={selectedIcon.name}
                    className="max-w-full max-h-32 object-contain"
                    referrerPolicy="no-referrer"
                  />
                </div>

                <div className="border border-gold/20 rounded-lg p-4 space-y-2 bg-card/30">
                  <p className="label-text text-gold/80">File Info</p>
                  <div className="space-y-1 text-xs text-ink/60">
                    <p className="break-all"><span className="text-ink/40">Name: </span>{selectedIcon.name}</p>
                    <p className="break-all"><span className="text-ink/40">Path: </span>{selectedIcon.fullPath}</p>
                    {selectedIcon.size && <p><span className="text-ink/40">Size: </span>{formatBytes(selectedIcon.size)}</p>}
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" variant="ghost" className="h-7 text-xs btn-gold flex-1 gap-1"
                      onClick={() => { navigator.clipboard.writeText(selectedIcon.url); toast.success('URL copied'); }}>
                      <Copy className="w-3 h-3" /> Copy URL
                    </Button>
                    <button onClick={() => setSelectedIcon(null)} title="Clear selection"
                      className="shrink-0 text-ink/30 hover:text-ink/60 transition-colors">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="border border-gold/20 rounded-lg p-4 space-y-2 bg-card/30">
                  <p className="label-text text-gold/80">Move To</p>
                  <Input
                    value={iconMoveTarget}
                    onChange={(e) => setIconMoveTarget(e.target.value)}
                    placeholder="icons/category"
                    className="h-7 text-xs bg-background/50 border-gold/20 font-mono"
                    onKeyDown={(e) => { if (e.key === 'Enter') handleMoveIcon(); }}
                  />
                  <p className="text-[9px] text-ink/30 font-mono truncate">
                    → {iconMoveTarget.trim().replace(/\/+$/, '') || '…'}/{selectedIcon.name}
                  </p>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="w-full h-7 text-xs btn-gold gap-1"
                    onClick={handleMoveIcon}
                    disabled={iconMoving || !iconMoveTarget.trim()}
                  >
                    <Save className="w-3 h-3" />{iconMoving ? 'Moving…' : 'Move Here'}
                  </Button>
                </div>

                {isAdmin && (
                  <div className="border border-blood/20 rounded-lg p-4 space-y-3 bg-card/30">
                    <p className="label-text text-blood/70">Danger Zone</p>
                    {!iconDeleteConfirm ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="w-full h-8 text-xs text-blood/60 hover:text-blood hover:bg-blood/10 border border-blood/20 gap-2"
                        onClick={() => setIconDeleteConfirm(true)}
                      >
                        <Trash2 className="w-3 h-3" /> Delete Icon
                      </Button>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-xs text-ink/60">Delete "{selectedIcon.name}"? This cannot be undone.</p>
                        <div className="flex gap-2">
                          <Button size="sm" variant="ghost"
                            className="flex-1 h-8 text-xs text-ink/40 border border-gold/10 hover:text-ink"
                            onClick={() => setIconDeleteConfirm(false)}>
                            Cancel
                          </Button>
                          <Button size="sm"
                            className="flex-1 h-8 text-xs bg-blood hover:bg-blood/90 text-white gap-1"
                            onClick={handleDeleteIcon} disabled={iconDeleting}>
                            <Trash2 className="w-3 h-3" />{iconDeleting ? 'Deleting…' : 'Delete'}
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
                <p className="text-sm text-ink/40 italic">Select an icon to manage</p>
                <p className="text-xs text-ink/30 mt-1">or drag it onto a folder to move</p>
              </div>
            )}
          </div>

          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
