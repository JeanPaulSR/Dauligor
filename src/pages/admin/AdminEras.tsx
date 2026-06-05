// =============================================================================
// Admin Eras — list/management page for the eras taxonomy.
// =============================================================================
//
// Browsing surface (mirrors /admin/campaigns + /admin/worlds). Fine details
// of each era are edited on its own page (/admin/eras/edit/:id), the same
// way campaigns split list ↔ editor. Staff (admin + co-dm) can view; only
// admins get create / edit / delete (era CRUD is admin-gated server-side).
// =============================================================================

import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { fetchCollection } from '../../lib/d1';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { Plus, Trash2, Pencil } from 'lucide-react';
import { getSessionToken } from '../../lib/auth';
import { ImageThumb, SortHead, makeToggle, type Dir } from '../../components/admin/consoleTable';

type SortKey = 'order' | 'name' | 'campaigns';

export default function AdminEras({ userProfile, embedded = false }: { userProfile: any; embedded?: boolean }) {
  const navigate = useNavigate();
  const isAdmin = userProfile?.role === 'admin';
  const isStaff = isAdmin || userProfile?.role === 'co-dm';

  const [eras, setEras] = useState<any[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [sort, setSort] = useState<{ key: SortKey; dir: Dir }>({ key: 'order', dir: 'asc' });
  const toggleSort = makeToggle<SortKey>(setSort);

  const authedFetch = async (input: string) => {
    const idToken = await getSessionToken();
    return fetch(input, { headers: idToken ? { Authorization: `Bearer ${idToken}` } : {} });
  };

  const loadEras = async () => {
    const data = await fetchCollection<any>('eras', { orderBy: '"order" ASC' });
    setEras(data.map((e: any) => ({ ...e, backgroundImageUrl: e.background_image_url })));
  };

  useEffect(() => {
    if (!isStaff) return;
    const load = async () => {
      try {
        await loadEras();
        const res = await authedFetch('/api/campaigns');
        if (res.ok) {
          const body = await res.json();
          setCampaigns(Array.isArray(body?.campaigns) ? body.campaigns : []);
        }
      } catch (err) {
        console.error('Failed to load eras:', err);
        toast.error('Failed to load eras');
      }
    };
    void load();
  }, [userProfile]);

  const eraCounts = useMemo(() => {
    const m = new Map<string, number>();
    campaigns.forEach((c) => { const eid = c.era_id; if (eid) m.set(eid, (m.get(eid) || 0) + 1); });
    return m;
  }, [campaigns]);

  const visibleEras = useMemo(() => {
    const rows = eras.slice();
    const dir = sort.dir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      let av: any; let bv: any;
      switch (sort.key) {
        case 'name': av = (a.name || '').toLowerCase(); bv = (b.name || '').toLowerCase(); break;
        case 'campaigns': av = eraCounts.get(a.id) || 0; bv = eraCounts.get(b.id) || 0; break;
        case 'order': default: av = a.order ?? 0; bv = b.order ?? 0; break;
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    return rows;
  }, [eras, sort, eraCounts]);

  const handleDelete = async (era: any) => {
    if (!confirm(`Delete the era "${era.name}"? Campaigns assigned to it stay but become unassigned.`)) return;
    try {
      const idToken = await getSessionToken();
      const res = await fetch(`/api/admin/eras/${encodeURIComponent(era.id)}`, {
        method: 'DELETE',
        headers: idToken ? { Authorization: `Bearer ${idToken}` } : {},
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error || `Delete failed (HTTP ${res.status})`);
      }
      toast.success('Era deleted');
      setEras((prev) => prev.filter((e) => e.id !== era.id));
    } catch (err) {
      console.error(err);
      toast.error('Failed to delete era');
    }
  };

  if (!isStaff) return <div className="text-center py-20 font-serif italic">Access Denied</div>;

  return (
    <div className={embedded ? 'space-y-4 animate-in fade-in duration-200' : 'max-w-5xl mx-auto space-y-6 pb-20'}>
      {!embedded && (
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.25em] text-gold mb-1">Administration</div>
          <h1 className="text-4xl font-serif font-bold text-ink">Eras</h1>
        </div>
      )}
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-ink/65 font-serif italic">The historical time periods of your world. Campaigns are grouped by era.</p>
        {isAdmin && (
          <Button className="btn-gold-solid gap-2" onClick={() => navigate('/admin/eras/edit/new')}>
            <Plus className="w-4 h-4" /> New Era
          </Button>
        )}
      </div>

      {eras.length === 0 ? (
        <div className="text-center py-20 bg-card/50 rounded-xl border border-dashed border-gold/25">
          <p className="text-ink/45 font-serif italic">No eras defined yet.</p>
        </div>
      ) : (
        <div className="border border-gold/15 rounded-xl overflow-hidden bg-card/60 shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <SortHead label="Order" className="w-16" active={sort.key === 'order'} dir={sort.dir} onClick={() => toggleSort('order')} />
                <TableHead className="w-20">Image</TableHead>
                <SortHead label="Name" active={sort.key === 'name'} dir={sort.dir} onClick={() => toggleSort('name')} />
                <TableHead>Description</TableHead>
                <SortHead label="Campaigns" className="w-24" active={sort.key === 'campaigns'} dir={sort.dir} onClick={() => toggleSort('campaigns')} />
                {isAdmin && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleEras.map((era) => (
                <TableRow key={era.id} className="cursor-pointer" onClick={() => isAdmin && navigate(`/admin/eras/edit/${era.id}`)}>
                  <TableCell><Badge variant="outline" className="text-gold border-gold/25 font-mono">{era.order ?? 0}</Badge></TableCell>
                  <TableCell><ImageThumb url={era.backgroundImageUrl} className="w-12 h-8 rounded" /></TableCell>
                  <TableCell className="font-serif font-bold text-ink">{era.name}</TableCell>
                  <TableCell className="text-xs text-ink/65 max-w-md truncate">{era.description || <span className="italic text-ink/35">No description</span>}</TableCell>
                  <TableCell className="text-xs text-ink/65">{eraCounts.get(era.id) || 0}</TableCell>
                  {isAdmin && (
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="icon" className="h-8 w-8" title="Edit" onClick={() => navigate(`/admin/eras/edit/${era.id}`)}><Pencil className="w-4 h-4" /></Button>
                      <Button variant="ghost" size="icon" className="btn-danger h-8 w-8" title="Delete" onClick={() => handleDelete(era)}><Trash2 className="w-4 h-4" /></Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
