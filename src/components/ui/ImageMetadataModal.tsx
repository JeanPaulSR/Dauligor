import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './dialog';
import { Button } from './button';
import { Input } from './input';
import { Badge } from './badge';
import { Edit2, Save, X, Image as ImageIcon } from 'lucide-react';
import { ImageMetadata, saveImageMetadata, getImageMetadataByPath } from '../../lib/imageMetadata';
import { toast } from 'sonner';
import { auth } from '../../lib/firebase';

export interface ImageMetadataModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageUrl: string;
}

export function ImageMetadataModal({ isOpen, onClose, imageUrl }: ImageMetadataModalProps) {
  const [metadata, setMetadata] = useState<ImageMetadata | null>(null);
  const [editedMeta, setEditedMeta] = useState<Partial<ImageMetadata>>({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  // We infer the fullPath from the imageUrl for metadata lookups
  // This assumes standard R2 URL structure ending in the path
  const urlObj = new URL(imageUrl || 'http://localhost');
  const pathParts = urlObj.pathname.split('/');
  const inferredPath = pathParts.slice(1).join('/'); // remove leading slash

  useEffect(() => {
    if (!isOpen || !imageUrl) return;
    setLoading(true);
    getImageMetadataByPath(inferredPath)
      .then((meta) => {
        setMetadata(meta);
        if (meta) setEditedMeta(meta);
      })
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
  }, [isOpen, imageUrl, inferredPath]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const user = auth.currentUser;
      const filename = inferredPath.split('/').pop() || 'image';
      const folder = inferredPath.split('/').slice(0, -1).join('/') + '/';

      await saveImageMetadata(inferredPath, {
        url: imageUrl,
        filename,
        folder,
        uploadedBy: metadata?.uploadedBy || user?.uid,
        uploadedByName: metadata?.uploadedByName || user?.displayName || 'Unknown',
        ...editedMeta,
      });
      const refreshed = await getImageMetadataByPath(inferredPath);
      setMetadata(refreshed);
      toast.success('Metadata saved');
    } catch (err: any) {
      toast.error('Save failed: ' + (err.message ?? 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md bg-card border-gold/20 p-0 overflow-hidden flex flex-col h-[80vh] sm:h-[600px]">
        {/* Metadata Panel */}
        <div className="w-full bg-background/95 p-6 flex flex-col overflow-y-auto h-full">
          <DialogHeader className="mb-6">
            <DialogTitle className="text-gold font-bold flex items-center justify-between">
              Image Details
            </DialogTitle>
          </DialogHeader>

          {loading ? (
            <p className="text-sm text-ink/40">Loading metadata...</p>
          ) : (
            <div className="space-y-4 flex-1 flex flex-col">
              <div className="space-y-4 flex-1">
                {([
                  { key: 'creator', label: 'Creator / Artist' },
                  { key: 'description', label: 'Description' },
                  { key: 'license', label: 'License (e.g. CC BY 3.0)' },
                  { key: 'source', label: 'Source / Link' },
                ] as const).map(({ key, label }) => (
                  <div key={key}>
                    <label className="text-[10px] uppercase tracking-widest text-ink/40 block mb-1">{label}</label>
                    <Input
                      value={(editedMeta as any)[key] ?? ''}
                      onChange={(e) => setEditedMeta({ ...editedMeta, [key]: e.target.value })}
                      className="h-8 text-xs bg-background/50 border-gold/20"
                    />
                  </div>
                ))}
                <div>
                  <label className="text-[10px] uppercase tracking-widest text-ink/40 block mb-1">Tags (comma-separated)</label>
                  <Input
                    value={(editedMeta.tags ?? []).join(', ')}
                    onChange={(e) =>
                      setEditedMeta({ ...editedMeta, tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })
                    }
                    className="h-8 text-xs bg-background/50 border-gold/20"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-4 mt-auto border-t border-gold/10">
                <Button size="sm" variant="ghost" className="flex-1 h-8 text-xs text-ink/40 hover:text-blood" onClick={onClose}>
                  <X className="w-3 h-3 mr-1" /> Close
                </Button>
                <Button size="sm" className="flex-1 h-8 text-xs btn-gold gap-1" onClick={handleSave} disabled={saving}>
                  <Save className="w-3 h-3" />{saving ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
