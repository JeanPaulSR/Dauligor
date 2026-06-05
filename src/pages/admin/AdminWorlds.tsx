// =============================================================================
// Admin Worlds — list/management page for the worlds taxonomy.
// =============================================================================
//
// Browsing surface (mirrors /admin/campaigns + /admin/eras). Fine details of
// each world are edited on its own page (/admin/worlds/edit/:id). Admin-only.
//
// Worlds are the largest scope dimension for compendium content. The default
// world ("Dauligor") is seeded by migration, surfaced with a "Default" badge,
// and cannot be deleted (server also refuses).
// =============================================================================

import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { Plus, Trash2, Pencil } from 'lucide-react';
import { getSessionToken } from '../../lib/auth';
import { ImageThumb, SortHead, makeToggle, type Dir } from '../../components/admin/consoleTable';

type World = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  owner_user_id: string | null;
  is_default: number;
  sort_order: number;
  background_image_url: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type SortKey = 'name' | 'slug' | 'owner' | 'order';

export default function AdminWorlds({ userProfile, embedded = false }: { userProfile: any; embedded?: boolean }) {
  const navigate = useNavigate();
  const isAdmin = userProfile?.role === 'admin';

  const [worlds, setWorlds] = useState<World[]>([]);
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: Dir }>({ key: 'order', dir: 'asc' });
  const toggleSort = makeToggle<SortKey>(setSort);

  const authedFetch = async (input: string, init?: RequestInit) => {
    const idToken = await getSessionToken();
    if (!idToken) throw new Error('Not signed in.');
    return fetch(input, {
      ...init,
      headers: { ...(init?.headers || {}), 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
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
      toast.error(err?.message || 'Failed to load worlds.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isAdmin) return;
    void loadWorlds();
  }, [isAdmin]);

  const visibleWorlds = useMemo(() => {
    const rows = worlds.slice();
    const dir = sort.dir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      let av: any; let bv: any;
      switch (sort.key) {
        case 'name': av = (a.name || '').toLowerCase(); bv = (b.name || '').toLowerCase(); break;
        case 'slug': av = (a.slug || '').toLowerCase(); bv = (b.slug || '').toLowerCase(); break;
        case 'owner': av = (a.owner_user_id || '').toLowerCase(); bv = (b.owner_user_id || '').toLowerCase(); break;
        case 'order': default: av = a.sort_order ?? 0; bv = b.sort_order ?? 0; break;
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    return rows;
  }, [worlds, sort]);

  const handleDelete = async (world: World) => {
    if (Number(world.is_default) === 1) { toast.error('The default world cannot be deleted.'); return; }
    if (!confirm(`Delete the world "${world.name}"? This cannot be undone.`)) return;
    try {
      const res = await authedFetch(`/api/admin/worlds/${encodeURIComponent(world.id)}`, { method: 'DELETE' });
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

  if (!isAdmin) return <div className="text-center py-20 font-serif italic">Access Denied. Admins only.</div>;

  return (
    <div className={embedded ? 'space-y-4 animate-in fade-in duration-200' : 'max-w-5xl mx-auto space-y-6 pb-20'}>
      {!embedded && (
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.25em] text-gold mb-1">Administration</div>
          <h1 className="text-4xl font-serif font-bold text-ink">Worlds</h1>
        </div>
      )}
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-ink/65 font-serif italic max-w-2xl">
          Top-level scope for compendium content. The default (<strong>Dauligor</strong>) world holds every shared,
          global entity; additional worlds will host user-owned content as scope-aware roles roll out.
        </p>
        <Button className="btn-gold-solid gap-2 shrink-0" onClick={() => navigate('/admin/worlds/edit/new')}>
          <Plus className="w-4 h-4" /> New World
        </Button>
      </div>

      {worlds.length === 0 ? (
        <div className="text-center py-20 bg-card/50 rounded-xl border border-dashed border-gold/25">
          <p className="text-ink/45 font-serif italic">{loading ? 'Loading…' : 'No worlds yet.'}</p>
        </div>
      ) : (
        <div className="border border-gold/15 rounded-xl overflow-hidden bg-card/60 shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">Image</TableHead>
                <SortHead label="Name" active={sort.key === 'name'} dir={sort.dir} onClick={() => toggleSort('name')} />
                <SortHead label="Slug" active={sort.key === 'slug'} dir={sort.dir} onClick={() => toggleSort('slug')} />
                <SortHead label="Owner" active={sort.key === 'owner'} dir={sort.dir} onClick={() => toggleSort('owner')} />
                <SortHead label="Order" className="w-16" active={sort.key === 'order'} dir={sort.dir} onClick={() => toggleSort('order')} />
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleWorlds.map((world) => (
                <TableRow key={world.id} className="cursor-pointer" onClick={() => navigate(`/admin/worlds/edit/${world.id}`)}>
                  <TableCell><ImageThumb url={world.background_image_url || undefined} className="w-12 h-8 rounded" /></TableCell>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <span className="font-serif font-bold text-ink">{world.name}</span>
                      {Number(world.is_default) === 1 && <Badge variant="outline" className="border-gold text-gold">Default</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-ink/75">{world.slug}</TableCell>
                  <TableCell className="text-xs text-ink/65">{world.owner_user_id || <span className="italic">—</span>}</TableCell>
                  <TableCell className="text-xs text-ink/65">{world.sort_order ?? 0}</TableCell>
                  <TableCell className="text-xs text-ink/65 max-w-md truncate">{world.description || <span className="italic">No description</span>}</TableCell>
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    <Button variant="ghost" size="icon" className="h-8 w-8" title="Edit" onClick={() => navigate(`/admin/worlds/edit/${world.id}`)}><Pencil className="w-4 h-4" /></Button>
                    <Button
                      variant="ghost" size="icon" className="btn-danger h-8 w-8"
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
        </div>
      )}
    </div>
  );
}
