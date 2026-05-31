// =============================================================================
// Admin Worlds — top-level CRUD for the worlds taxonomy.
// =============================================================================
//
// Worlds are the largest scope dimension for compendium content. Phase 1
// just stands the table up + provides CRUD; per-entity world_id columns
// and scope enforcement against tags/spells/etc. arrive in later phases.
//
// The default world ("Dauligor") is seeded by migration. The UI:
//   - Surfaces it with a "Default" badge.
//   - Refuses delete (server also refuses).
//   - Allows rename + description edits (the slug is editable but care
//     should be taken — public catalog URLs reference it).
//
// Layout mirrors the existing admin index pages (AdminCampaigns,
// AdminProficiencies): page header, add-row button, table, edit dialog.
// =============================================================================

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '../../components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '../../components/ui/dialog';
import { Globe2, Plus, Trash2, Edit2 } from 'lucide-react';
import { getSessionToken } from "../../lib/auth";

type World = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  owner_user_id: string | null;
  is_default: number; // 0 | 1 from D1
  sort_order: number;
  created_at: string | null;
  updated_at: string | null;
};

const EMPTY_DRAFT = { name: '', slug: '', description: '', owner_user_id: '', sort_order: 0 };

export default function AdminWorlds({ userProfile }: { userProfile: any }) {
  const [worlds, setWorlds] = useState<World[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ ...EMPTY_DRAFT });

  const isAdmin = userProfile?.role === 'admin';

  // Centralised auth-aware fetch — every endpoint here is admin-only,
  // so the token is mandatory; surface the omission early rather than
  // letting the server 401.
  const authedFetch = async (input: string, init?: RequestInit) => {
    const idToken = await getSessionToken();
    if (!idToken) throw new Error('Not signed in.');
    return fetch(input, {
      ...init,
      headers: {
        ...(init?.headers || {}),
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
    });
  };

  const loadWorlds = async () => {
    setLoading(true);
    try {
      const res = await authedFetch('/api/admin/worlds');
      if (!res.ok) throw new Error(`Failed to load worlds (HTTP ${res.status})`);
      const body = await res.json();
      setWorlds(Array.isArray(body?.worlds) ? body.worlds : []);
    } catch (err: any) {
      console.error('Failed to load worlds:', err);
      setError(err?.message || 'Failed to load worlds.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isAdmin) return;
    void loadWorlds();
  }, [isAdmin]);

  const openCreate = () => {
    setDraft({ ...EMPTY_DRAFT });
    setError('');
    setIsCreateOpen(true);
  };

  const openEdit = (world: World) => {
    setDraft({
      name: world.name,
      slug: world.slug,
      description: world.description ?? '',
      owner_user_id: world.owner_user_id ?? '',
      sort_order: world.sort_order ?? 0,
    });
    setEditingId(world.id);
    setError('');
  };

  const handleCreate = async () => {
    if (!draft.name.trim()) {
      setError('Name is required.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await authedFetch('/api/admin/worlds', {
        method: 'POST',
        body: JSON.stringify({
          name: draft.name.trim(),
          slug: draft.slug.trim() || undefined,
          description: draft.description.trim() || null,
          owner_user_id: draft.owner_user_id.trim() || null,
          sort_order: Number(draft.sort_order) || 0,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to create world (HTTP ${res.status})`);
      }
      toast.success('World created.');
      setIsCreateOpen(false);
      void loadWorlds();
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Failed to create world.');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdate = async () => {
    if (!editingId) return;
    if (!draft.name.trim()) {
      setError('Name is required.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await authedFetch(`/api/admin/worlds/${encodeURIComponent(editingId)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: draft.name.trim(),
          slug: draft.slug.trim() || undefined,
          description: draft.description.trim() || null,
          owner_user_id: draft.owner_user_id.trim() || null,
          sort_order: Number(draft.sort_order) || 0,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to update world (HTTP ${res.status})`);
      }
      toast.success('World updated.');
      setEditingId(null);
      void loadWorlds();
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Failed to update world.');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (world: World) => {
    if (Number(world.is_default) === 1) {
      toast.error('The default world cannot be deleted.');
      return;
    }
    if (!confirm(`Delete the world "${world.name}"? This cannot be undone.`)) return;
    try {
      const res = await authedFetch(`/api/admin/worlds/${encodeURIComponent(world.id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to delete world (HTTP ${res.status})`);
      }
      toast.success('World deleted.');
      setWorlds((prev) => prev.filter((w) => w.id !== world.id));
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || 'Failed to delete world.');
    }
  };

  if (!isAdmin) {
    return <div className="text-center py-20">Access Denied. Admins only.</div>;
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-20">
      <div className="flex items-center gap-3 text-gold mb-2">
        <Globe2 className="w-6 h-6" />
        <span className="text-sm font-bold uppercase tracking-[0.3em]">Admin Tools</span>
      </div>

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-2">
          <h1 className="text-4xl font-serif font-bold text-ink tracking-tight uppercase">Worlds</h1>
          <p className="text-ink/60 font-serif italic">
            Top-level scope for compendium content. The default (<strong>Dauligor</strong>)
            world holds every shared, global entity; additional worlds will host
            user-owned content as scope-aware roles roll out.
          </p>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={(open) => { setIsCreateOpen(open); if (!open) setError(''); }}>
          <DialogTrigger render={
            <Button onClick={openCreate} className="gap-2">
              <Plus className="w-4 h-4" />
              Add World
            </Button>
          } />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New world</DialogTitle>
              <DialogDescription>
                Worlds scope future content authoring. The default world is seeded
                automatically and cannot be re-created here.
              </DialogDescription>
            </DialogHeader>
            <WorldForm draft={draft} setDraft={setDraft} error={error} />
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateOpen(false)} disabled={loading}>Cancel</Button>
              <Button onClick={handleCreate} disabled={loading}>Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All worlds</CardTitle>
        </CardHeader>
        <CardContent>
          {worlds.length === 0 ? (
            <p className="text-ink/60 italic py-8 text-center">
              {loading ? 'Loading…' : 'No worlds yet.'}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-24 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {worlds.map((world) => (
                  <TableRow key={world.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {world.name}
                        {Number(world.is_default) === 1 && (
                          <Badge variant="outline" className="border-gold text-gold">Default</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-ink/70">{world.slug}</TableCell>
                    <TableCell className="text-xs text-ink/60">
                      {world.owner_user_id || <span className="italic">—</span>}
                    </TableCell>
                    <TableCell className="text-xs text-ink/60">{world.sort_order ?? 0}</TableCell>
                    <TableCell className="text-xs text-ink/60 max-w-md truncate">
                      {world.description || <span className="italic">No description</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(world)} title="Edit">
                        <Edit2 className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(world)}
                        disabled={Number(world.is_default) === 1}
                        title={Number(world.is_default) === 1 ? 'The default world cannot be deleted' : 'Delete'}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={editingId !== null} onOpenChange={(open) => { if (!open) { setEditingId(null); setError(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit world</DialogTitle>
          </DialogHeader>
          <WorldForm draft={draft} setDraft={setDraft} error={error} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingId(null)} disabled={loading}>Cancel</Button>
            <Button onClick={handleUpdate} disabled={loading}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function WorldForm({
  draft,
  setDraft,
  error,
}: {
  draft: typeof EMPTY_DRAFT;
  setDraft: (next: typeof EMPTY_DRAFT) => void;
  error: string;
}) {
  return (
    <div className="space-y-4 py-2">
      <div className="space-y-1">
        <label className="text-sm font-medium">Name</label>
        <Input
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder="e.g. Eberron"
        />
      </div>
      <div className="space-y-1">
        <label className="text-sm font-medium">Slug</label>
        <Input
          value={draft.slug}
          onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
          placeholder="auto-derived from name if blank"
          className="font-mono"
        />
        <p className="text-xs text-ink/50">
          Lowercase letters, numbers, and dashes. Used in URLs once worlds scope public content.
        </p>
      </div>
      <div className="space-y-1">
        <label className="text-sm font-medium">Owner user ID <span className="text-ink/40">(optional)</span></label>
        <Input
          value={draft.owner_user_id}
          onChange={(e) => setDraft({ ...draft, owner_user_id: e.target.value })}
          placeholder="Leave blank for a shared/admin-owned world"
          className="font-mono text-xs"
        />
      </div>
      <div className="space-y-1">
        <label className="text-sm font-medium">Sort order</label>
        <Input
          type="number"
          value={draft.sort_order}
          onChange={(e) => setDraft({ ...draft, sort_order: Number(e.target.value) || 0 })}
        />
      </div>
      <div className="space-y-1">
        <label className="text-sm font-medium">Description <span className="text-ink/40">(optional)</span></label>
        <Textarea
          value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          rows={3}
          placeholder="One-line summary surfaced in pickers."
        />
      </div>
      {error && <p className="text-sm text-blood">{error}</p>}
    </div>
  );
}
