// =============================================================================
// Admin management console — shared page for Worlds / Eras / Campaigns.
// =============================================================================
//
// One console, three tabs — each its own route (/admin/worlds, /admin/eras,
// /admin/campaigns) so the whole thing is reachable from any entity's path
// with that tab active. The active tab is the `tab` prop from the route.
//
//   • Worlds (admin) / Eras — rendered as embedded list managers (AdminWorlds /
//     AdminEras with embedded). Each row opens that entity's dedicated editor.
//   • Campaigns — sortable table; create / open / edit / delete. Era and
//     Recommended-Lore are DISPLAY-ONLY here (badges/text); they're edited on
//     the campaign editor (/campaign/edit/:id), which owns those fields.
//
// Eras are loaded here (read-only) to drive the campaign era filter + badge.
// =============================================================================

import { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { fetchCollection } from '../../lib/d1';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { Badge } from '../../components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '../../components/ui/dialog';
import { Plus, Trash2, Pencil, ExternalLink, Search } from 'lucide-react';
import { getSessionToken } from '../../lib/auth';
import { ImageThumb, SortHead, makeToggle, type Dir } from '../../components/admin/consoleTable';
import AdminEras from './AdminEras';
import AdminWorlds from './AdminWorlds';

type TabKey = 'campaigns' | 'eras' | 'worlds';
type SortKey = 'name' | 'era' | 'players' | 'updated';

// Each tab is its own admin route, so the whole console is reachable from any
// entity's path with that tab active.
const TAB_PATHS: Record<TabKey, string> = {
  campaigns: '/admin/campaigns',
  eras: '/admin/eras',
  worlds: '/admin/worlds',
};

function initials(name?: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || name[0].toUpperCase();
}
function relTime(iso?: string): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  return new Date(t).toLocaleDateString();
}

export default function AdminCampaigns({ userProfile, tab: routeTab = 'campaigns' }: { userProfile: any; tab?: TabKey }) {
  const navigate = useNavigate();

  const isAdmin = userProfile?.role === 'admin';
  const isStaff = isAdmin || userProfile?.role === 'co-dm';

  // The active tab comes straight from the matched route. The admin-only
  // Worlds tab falls back to Campaigns for non-admin staff who land on it.
  const tab: TabKey = routeTab === 'worlds' && !isAdmin ? 'campaigns' : routeTab;
  const selectTab = (k: TabKey) => navigate(TAB_PATHS[k]);

  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [lorePages, setLorePages] = useState<any[]>([]);
  const [eras, setEras] = useState<any[]>([]);

  const [query, setQuery] = useState('');
  const [eraFilter, setEraFilter] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: Dir }>({ key: 'updated', dir: 'desc' });
  const toggleSort = makeToggle<SortKey>(setSort);

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newCampaign, setNewCampaign] = useState({ name: '', description: '', eraId: '' });

  const authedFetch = async (input: string, init?: RequestInit) => {
    const idToken = await getSessionToken();
    return fetch(input, {
      ...init,
      headers: {
        ...(init?.headers || {}),
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      },
    });
  };

  const remapCampaign = (c: any) => ({
    ...c,
    eraId: c.era_id,
    dmId: c.dm_id,
    recommendedLoreId: c.recommended_lore_id,
    imageUrl: c.image_url,
    cardImageUrl: c.card_image_url,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  });

  const loadCampaigns = async () => {
    const res = await authedFetch('/api/campaigns');
    if (!res.ok) throw new Error(`Failed to load campaigns (HTTP ${res.status})`);
    const body = await res.json();
    setCampaigns((Array.isArray(body?.campaigns) ? body.campaigns : []).map(remapCampaign));
  };

  useEffect(() => {
    if (!isStaff) return;
    const load = async () => {
      try {
        await loadCampaigns();

        const data = await fetchCollection<any>('eras', { orderBy: '"order" ASC' });
        setEras(data);

        const usersRes = await authedFetch('/api/admin/users');
        if (usersRes.ok) {
          const usersBody = await usersRes.json();
          const usersData: any[] = Array.isArray(usersBody?.users) ? usersBody.users : [];
          setUsers(usersData.map((u: any) => ({
            ...u,
            displayName: u.display_name,
            campaignIds: Array.isArray(u.campaign_ids) ? u.campaign_ids : [],
          })));
        }

        const loreRes = await authedFetch('/api/lore/articles?orderBy=title%20ASC');
        if (loreRes.ok) {
          const loreBody = await loreRes.json();
          setLorePages(Array.isArray(loreBody?.articles) ? loreBody.articles : []);
        }
      } catch (err) {
        console.error('Error loading campaigns:', err);
        toast.error('Failed to load campaign data');
      }
    };
    void load();
  }, [userProfile]);

  // Derived lookups
  const eraName = useMemo(() => {
    const m = new Map<string, string>();
    eras.forEach((e) => m.set(e.id, e.name));
    return m;
  }, [eras]);
  const loreTitle = useMemo(() => {
    const m = new Map<string, string>();
    lorePages.forEach((p) => m.set(p.id, p.title));
    return m;
  }, [lorePages]);
  const playersByCampaign = useMemo(() => {
    const m = new Map<string, any[]>();
    campaigns.forEach((c) => m.set(c.id, []));
    users.forEach((u) => {
      (u.campaignIds || []).forEach((cid: string) => {
        if (m.has(cid)) m.get(cid)!.push(u);
      });
    });
    return m;
  }, [campaigns, users]);

  const visibleCampaigns = useMemo(() => {
    let rows = campaigns.slice();
    const q = query.trim().toLowerCase();
    if (q) rows = rows.filter((c) =>
      (c.name || '').toLowerCase().includes(q) || (c.description || '').toLowerCase().includes(q));
    if (eraFilter) rows = rows.filter((c) => c.eraId === eraFilter);
    const dir = sort.dir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      let av: any; let bv: any;
      switch (sort.key) {
        case 'name': av = (a.name || '').toLowerCase(); bv = (b.name || '').toLowerCase(); break;
        case 'era': av = (eraName.get(a.eraId) || '').toLowerCase(); bv = (eraName.get(b.eraId) || '').toLowerCase(); break;
        case 'players': av = (playersByCampaign.get(a.id)?.length || 0); bv = (playersByCampaign.get(b.id)?.length || 0); break;
        case 'updated': default: av = Date.parse(a.updatedAt || a.createdAt || '') || 0; bv = Date.parse(b.updatedAt || b.createdAt || '') || 0; break;
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    return rows;
  }, [campaigns, query, eraFilter, sort, eraName, playersByCampaign]);

  // ---- campaign handlers ----
  const handleCreateCampaign = async () => {
    if (!newCampaign.name.trim()) { toast.error('Campaign name is required'); return; }
    try {
      const id = crypto.randomUUID();
      const slug = newCampaign.name.toLowerCase().replace(/\s+/g, '-');
      const res = await authedFetch('/api/campaigns', {
        method: 'POST',
        body: JSON.stringify({
          id, name: newCampaign.name, description: newCampaign.description,
          era_id: newCampaign.eraId || null, slug, dm_id: userProfile.id,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error || `Create failed (HTTP ${res.status})`);
      }
      setIsAddOpen(false);
      setNewCampaign({ name: '', description: '', eraId: '' });
      toast.success('Campaign created');
      await loadCampaigns();
    } catch (err) {
      console.error(err);
      toast.error('Failed to create campaign');
    }
  };

  const handleDeleteCampaign = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? Players stay, but will no longer be associated with it.`)) return;
    try {
      const res = await authedFetch(`/api/campaigns/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error || `Delete failed (HTTP ${res.status})`);
      }
      toast.success('Campaign deleted');
      setCampaigns((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      console.error(err);
      toast.error('Failed to delete campaign');
    }
  };

  if (!isStaff) {
    return <div className="text-center py-20 font-serif italic">Access Denied</div>;
  }

  const TABS: { key: TabKey; label: string; show: boolean }[] = [
    { key: 'worlds', label: 'Worlds', show: isAdmin },
    { key: 'eras', label: 'Eras', show: true },
    { key: 'campaigns', label: 'Campaigns', show: true },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-20">
      {/* Header */}
      <div>
        <div className="text-[11px] font-bold uppercase tracking-[0.25em] text-gold mb-1">Administration</div>
        <h1 className="text-4xl font-serif font-bold text-ink">Campaign Management</h1>
        <p className="text-ink/65">Organize players into adventure groups, historical eras, and worlds.</p>
      </div>

      {/* Tab strip */}
      <div className="flex items-center gap-1 border-b border-gold/15">
        {TABS.filter((t) => t.show).map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => selectTab(t.key)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-bold transition-colors border-b-2 -mb-px ${
                active ? 'border-gold text-gold' : 'border-transparent text-ink/55 hover:text-gold/85'
              }`}
            >
              {t.label}
              {(t.key === 'campaigns' || t.key === 'eras') && (
                <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${active ? 'bg-gold/15 text-gold' : 'bg-ink/5 text-ink/45'}`}>
                  {t.key === 'campaigns' ? campaigns.length : eras.length}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ============ WORLDS TAB ============ */}
      {tab === 'worlds' && isAdmin && <AdminWorlds userProfile={userProfile} embedded />}

      {/* ============ ERAS TAB ============ */}
      {tab === 'eras' && <AdminEras userProfile={userProfile} embedded />}

      {/* ============ CAMPAIGNS TAB ============ */}
      {tab === 'campaigns' && (
        <div className="space-y-4 animate-in fade-in duration-200">
          {/* toolbar */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 h-10 px-3 rounded-md border border-gold/15 bg-background/50 min-w-[240px] flex-1 max-w-sm">
              <Search className="w-4 h-4 text-ink/45 shrink-0" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search campaigns…"
                className="bg-transparent border-0 outline-none text-sm w-full text-ink placeholder:text-ink/40"
              />
            </div>
            <select
              className="h-10 px-3 rounded-md border border-gold/15 bg-background/50 text-sm font-serif italic text-ink/85"
              value={eraFilter}
              onChange={(e) => setEraFilter(e.target.value)}
            >
              <option value="">All Eras</option>
              {eras.map((era) => (<option key={era.id} value={era.id}>{era.name}</option>))}
            </select>
            <div className="flex-1" />
            <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
              <DialogTrigger render={<Button className="btn-gold-solid gap-2"><Plus className="w-4 h-4" /> New Campaign</Button>} />
              <DialogContent>
                <DialogHeader>
                  <DialogTitle className="font-serif text-2xl">Create Campaign</DialogTitle>
                  <DialogDescription>Era and recommended lore can be set on the campaign editor after creation.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Campaign Name</label>
                    <Input value={newCampaign.name} onChange={(e) => setNewCampaign({ ...newCampaign, name: e.target.value })} placeholder="e.g. The Shattered Isles" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Description</label>
                    <Textarea rows={3} value={newCampaign.description} onChange={(e) => setNewCampaign({ ...newCampaign, description: e.target.value })} placeholder="A brief overview of the adventure…" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Era <span className="text-ink/45">(optional)</span></label>
                    <select
                      className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                      value={newCampaign.eraId}
                      onChange={(e) => setNewCampaign({ ...newCampaign, eraId: e.target.value })}
                    >
                      <option value="">Select an Era…</option>
                      {eras.map((era) => (<option key={era.id} value={era.id}>{era.name}</option>))}
                    </select>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsAddOpen(false)}>Cancel</Button>
                  <Button onClick={handleCreateCampaign} className="btn-gold-solid">Create Campaign</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          {/* table */}
          {campaigns.length === 0 ? (
            <div className="text-center py-20 bg-card/50 rounded-xl border border-dashed border-gold/25">
              <p className="text-ink/45 font-serif italic">No campaigns created yet.</p>
            </div>
          ) : (
            <div className="border border-gold/15 rounded-xl overflow-hidden bg-card/60 shadow-sm">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortHead label="Campaign" active={sort.key === 'name'} dir={sort.dir} onClick={() => toggleSort('name')} />
                    <SortHead label="Era" active={sort.key === 'era'} dir={sort.dir} onClick={() => toggleSort('era')} />
                    <SortHead label="Players" active={sort.key === 'players'} dir={sort.dir} onClick={() => toggleSort('players')} />
                    <TableHead>Recommended Lore</TableHead>
                    <SortHead label="Updated" active={sort.key === 'updated'} dir={sort.dir} onClick={() => toggleSort('updated')} />
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleCampaigns.map((c) => {
                    const players = playersByCampaign.get(c.id) || [];
                    const shown = players.slice(0, 3);
                    const extra = players.length - shown.length;
                    return (
                      <TableRow key={c.id} className="group">
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <ImageThumb url={c.imageUrl} className="w-9 h-9 rounded-md shrink-0" />
                            <div className="min-w-0">
                              <Link to={`/campaign/${c.id}`} className="font-serif font-bold text-[15px] text-ink hover:text-gold transition-colors block truncate">
                                {c.name}
                              </Link>
                              {c.description && <div className="text-xs text-ink/45 truncate max-w-[34ch]">{c.description}</div>}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          {c.eraId && eraName.get(c.eraId)
                            ? <Badge variant="outline" className="border-gold/25 text-gold/85 font-normal">{eraName.get(c.eraId)}</Badge>
                            : <span className="text-xs text-ink/35 italic">No era</span>}
                        </TableCell>
                        <TableCell>
                          {players.length === 0
                            ? <span className="text-xs text-ink/35 italic">None</span>
                            : (
                              <div className="flex items-center">
                                {shown.map((p) => (
                                  <span key={p.id} title={p.displayName}
                                    className="w-6 h-6 rounded-full border-2 border-card -ml-1.5 first:ml-0 bg-gold/15 text-gold text-[9px] font-bold flex items-center justify-center">
                                    {initials(p.displayName)}
                                  </span>
                                ))}
                                {extra > 0 && <span className="w-6 h-6 rounded-full border-2 border-card -ml-1.5 bg-ink/10 text-ink/55 text-[9px] font-bold flex items-center justify-center">+{extra}</span>}
                              </div>
                            )}
                        </TableCell>
                        <TableCell>
                          {c.recommendedLoreId && loreTitle.get(c.recommendedLoreId)
                            ? <span className="text-xs text-ink/75">{loreTitle.get(c.recommendedLoreId)}</span>
                            : <span className="text-xs text-ink/35 italic">—</span>}
                        </TableCell>
                        <TableCell className="text-xs text-ink/55 whitespace-nowrap">{relTime(c.updatedAt || c.createdAt)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="icon" className="h-8 w-8" title="Open campaign" onClick={() => navigate(`/campaign/${c.id}`)}>
                              <ExternalLink className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8" title="Edit campaign" onClick={() => navigate(`/campaign/edit/${c.id}`)}>
                              <Pencil className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="btn-danger h-8 w-8" title="Delete" onClick={() => handleDeleteCampaign(c.id, c.name)}>
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {visibleCampaigns.length === 0 && (
                <p className="text-center py-10 text-sm text-ink/45 font-serif italic">No campaigns match your search.</p>
              )}
            </div>
          )}
        </div>
      )}

    </div>
  );
}
