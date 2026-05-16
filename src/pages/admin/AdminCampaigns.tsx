import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { auth, OperationType, reportClientError } from '../../lib/firebase';
import { fetchCollection, upsertDocument, deleteDocument, getSystemMetadata, setSystemMetadata } from '../../lib/d1';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../../components/ui/dialog';
import { Plus, Trash2, LayoutGrid, Calendar, Users, Sparkles } from 'lucide-react';
import { ImageUpload } from '../../components/ui/ImageUpload';

export default function AdminCampaigns({ userProfile }: { userProfile: any }) {
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [lorePages, setLorePages] = useState<any[]>([]);
  const [eras, setEras] = useState<any[]>([]);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isEraOpen, setIsEraOpen] = useState(false);
  const [newCampaign, setNewCampaign] = useState({ name: '', description: '', eraId: '' });
  const [newEra, setNewEra] = useState({ name: '', description: '', order: 0, backgroundImageUrl: '' });
  const [wikiSettings, setWikiSettings] = useState<{ defaultBackgroundImageUrl?: string }>({});

  useEffect(() => {
    if (userProfile?.role !== 'admin' && userProfile?.role !== 'co-dm') return;

    // D1 returns snake_case columns; the rest of this page reads camelCase.
    // Remap on load so the existing JSX/handlers don't need to change.
    const remapCampaign = (c: any) => ({
      ...c,
      eraId: c.era_id,
      dmId: c.dm_id,
      recommendedLoreId: c.recommended_lore_id,
      imageUrl: c.image_url,
      previewImageUrl: c.preview_image_url,
      cardImageUrl: c.card_image_url,
      backgroundImageUrl: c.background_image_url,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
    });
    const remapEra = (e: any) => ({
      ...e,
      backgroundImageUrl: e.background_image_url,
      createdAt: e.created_at,
      updatedAt: e.updated_at,
    });
    const remapLore = (l: any) => ({
      ...l,
      parentId: l.parent_id,
      authorId: l.author_id,
      imageUrl: l.image_url,
    });

    const loadAllAdminData = async () => {
      try {
        // /api/campaigns gives admins every campaign with
        // `memberCount` pre-computed, so we no longer need the
        // separate `fetchCollection('campaignMembers')` enumeration
        // for the dashboard counts. That was the worst single source
        // of H7 leakage on admin pages (and still leaked even on
        // staff-only routes since the network call fires before any
        // role check).
        const idToken = await auth.currentUser?.getIdToken();
        const authHeaders = idToken ? { Authorization: `Bearer ${idToken}` } : {};
        const campRes = await fetch('/api/campaigns', { headers: authHeaders });
        if (!campRes.ok) throw new Error(`Failed to load campaigns (HTTP ${campRes.status})`);
        const campBody = await campRes.json();
        const campaignsData: any[] = Array.isArray(campBody?.campaigns) ? campBody.campaigns : [];
        setCampaigns(campaignsData.map(remapCampaign));

        const erasData = await fetchCollection<any>('eras', { orderBy: '"order" ASC' });
        setEras(erasData.map(remapEra));

        // Users + membership enumeration still go through the legacy
        // SQL proxy (admin-gated by the route guard) until the
        // /api/admin/users family lands. That migration covers
        // column-scoping (M2) and the broader campaign_members
        // enumeration for the user picker.
        const usersData = await fetchCollection<any>('users');
        const memberRows = await fetchCollection<any>('campaignMembers');
        const membershipsByUser = new Map<string, string[]>();
        memberRows.forEach((m: any) => {
          const list = membershipsByUser.get(m.user_id) || [];
          list.push(m.campaign_id);
          membershipsByUser.set(m.user_id, list);
        });
        setUsers(usersData.map((u: any) => ({
          ...u,
          displayName: u.display_name,
          campaignIds: membershipsByUser.get(u.id) || [],
        })));

        // Per-route lore endpoint — admin context, server still strips
        // dm_notes (admin doesn't need it for the recommended-article
        // picker; if they ever do, the dedicated dm-notes route can
        // serve it).
        const idTokenLore = await auth.currentUser?.getIdToken();
        const loreRes = await fetch('/api/lore/articles?orderBy=title%20ASC', {
          headers: idTokenLore ? { Authorization: `Bearer ${idTokenLore}` } : {},
        });
        if (!loreRes.ok) throw new Error(`Failed to load lore (HTTP ${loreRes.status})`);
        const loreBody = await loreRes.json();
        const loreData: any[] = Array.isArray(loreBody?.articles) ? loreBody.articles : [];
        setLorePages(loreData.map(remapLore));

        const settings = await getSystemMetadata<{ defaultBackgroundImageUrl?: string }>('wiki_settings');
        if (settings) setWikiSettings(settings);
      } catch (err) {
        console.error("Error loading admin data:", err);
      }
    };

    loadAllAdminData();
  }, [userProfile]);

  const handleCreateCampaign = async () => {
    try {
      const id = crypto.randomUUID();
      const slug = newCampaign.name.toLowerCase().replace(/\s+/g, '-');
      await upsertDocument('campaigns', id, {
        name: newCampaign.name,
        description: newCampaign.description,
        era_id: newCampaign.eraId || null,
        slug,
        dm_id: userProfile.id,
        created_at: new Date().toISOString(),
      });
      setIsAddOpen(false);
      setNewCampaign({ name: '', description: '', eraId: '' });
      toast.success('Campaign created');

      // Refresh list through the per-route endpoint (server filters
      // by role + emits memberCount, same as the initial load).
      const refreshIdToken = await auth.currentUser?.getIdToken();
      const refreshRes = await fetch('/api/campaigns', {
        headers: refreshIdToken ? { Authorization: `Bearer ${refreshIdToken}` } : {},
      });
      const refreshBody = refreshRes.ok ? await refreshRes.json() : { campaigns: [] };
      const campaignsData: any[] = Array.isArray(refreshBody?.campaigns) ? refreshBody.campaigns : [];
      setCampaigns(campaignsData.map((c: any) => ({
        ...c,
        eraId: c.era_id,
        dmId: c.dm_id,
        recommendedLoreId: c.recommended_lore_id,
        imageUrl: c.image_url,
        previewImageUrl: c.preview_image_url,
        cardImageUrl: c.card_image_url,
        backgroundImageUrl: c.background_image_url,
        createdAt: c.created_at,
        updatedAt: c.updated_at,
      })));
    } catch (err) {
      console.error(err);
      toast.error('Failed to create campaign');
    }
  };

  const handleCreateEra = async () => {
    try {
      const id = crypto.randomUUID();
      await upsertDocument('eras', id, {
        name: newEra.name,
        description: newEra.description,
        order: newEra.order,
        background_image_url: newEra.backgroundImageUrl || '',
        created_at: new Date().toISOString(),
      });
      setNewEra({ name: '', description: '', order: eras.length + 1, backgroundImageUrl: '' });
      toast.success('Era created');

      // Refresh list (with same camelCase remap so the campaign cards' eras
      // dropdown reflects the new entry without needing a page reload).
      const erasData = await fetchCollection<any>('eras', { orderBy: '"order" ASC' });
      setEras(erasData.map((e: any) => ({
        ...e,
        backgroundImageUrl: e.background_image_url,
        createdAt: e.created_at,
        updatedAt: e.updated_at,
      })));
    } catch (err) {
      console.error(err);
      toast.error('Failed to create era');
    }
  };

  const handleDeleteEra = async (id: string) => {
    if (confirm('Are you sure? This will remove the Era but not the campaigns assigned to it.')) {
      try {
        await deleteDocument('eras', id);
        toast.success('Era deleted');
        setEras(prev => prev.filter(e => e.id !== id));
      } catch (err) {
        console.error(err);
        toast.error('Failed to delete era');
      }
    }
  };

  const handleSetCampaignEra = async (campaignId: string, eraId: string) => {
    try {
      // Partial upsert: only the fields actually changing. The ON CONFLICT
      // DO UPDATE SET clause leaves other columns alone, BUT SQLite still
      // validates NOT NULL on the INSERT-side row before routing — so
      // we must include `name` + `slug` (both NOT NULL on `campaigns`)
      // even though they aren't being changed. Pull from local state so
      // we don't have to re-fetch.
      const existing = campaigns.find(c => c.id === campaignId);
      if (!existing) {
        toast.error('Campaign not found in local state');
        return;
      }
      await upsertDocument('campaigns', campaignId, {
        name: existing.name,
        slug: existing.slug,
        era_id: eraId || null,
        updated_at: new Date().toISOString(),
      });
      setCampaigns(prev => prev.map(c => c.id === campaignId ? { ...c, era_id: eraId, eraId } : c));
      toast.success('Campaign era updated');
    } catch (err) {
      console.error(err);
      toast.error('Failed to update campaign era');
    }
  };

  const handleDeleteCampaign = async (id: string) => {
    if (confirm('Are you sure? This will not remove users from the campaign, but they will no longer be associated with it.')) {
      try {
        await deleteDocument('campaigns', id);
        toast.success('Campaign deleted');
        setCampaigns(prev => prev.filter(c => c.id !== id));
      } catch (err) {
        console.error(err);
        toast.error('Failed to delete campaign');
      }
    }
  };

  const handleSetRecommendedLore = async (campaignId: string, loreId: string) => {
    try {
      // Same NOT NULL gotcha as handleSetCampaignEra — see comment there.
      const existing = campaigns.find(c => c.id === campaignId);
      if (!existing) {
        toast.error('Campaign not found in local state');
        return;
      }
      await upsertDocument('campaigns', campaignId, {
        name: existing.name,
        slug: existing.slug,
        recommended_lore_id: loreId || null,
        updated_at: new Date().toISOString(),
      });
      setCampaigns(prev => prev.map(c => c.id === campaignId
        ? { ...c, recommended_lore_id: loreId, recommendedLoreId: loreId }
        : c
      ));
      toast.success('Recommended lore updated');
    } catch (err) {
      console.error(err);
      toast.error('Failed to update recommended lore');
    }
  };

  if (userProfile?.role !== 'admin' && userProfile?.role !== 'co-dm') {
    return <div className="text-center py-20 font-serif italic">Access Denied</div>;
  }

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-4xl font-serif font-bold text-ink">Campaign Management</h1>
          <p className="text-ink/60">Organize your players into adventure groups and historical eras.</p>
        </div>

        <Card className="border-gold/15 bg-[#111118]/80 backdrop-blur-md p-4 max-w-sm w-full">
          <CardHeader className="p-0 pb-2 border-b border-gold/10">
            <CardTitle className="text-sm font-serif text-gold flex items-center gap-2">
              <Sparkles className="w-4 h-4 shrink-0" /> Default Wiki Fallback Background
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 pt-2">
            <ImageUpload 
              currentImageUrl={wikiSettings.defaultBackgroundImageUrl || ''}
              storagePath="images/wiki/background"
              onUpload={async (url) => {
                try {
                  const next = { ...wikiSettings, defaultBackgroundImageUrl: url };
                  await setSystemMetadata('wiki_settings', next);
                  setWikiSettings(next);
                } catch (error) {
                  console.error("Error setting default background image:", error);
                }
              }}
            />
          </CardContent>
        </Card>

        <div className="flex gap-2">
          <Dialog open={isEraOpen} onOpenChange={setIsEraOpen}>
            <DialogTrigger render={
              <Button variant="outline" className="border-gold/20 text-gold hover:bg-gold/5 gap-2">
                <Calendar className="w-4 h-4" /> Manage Eras
              </Button>
            } />
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle className="font-serif text-2xl">World Eras</DialogTitle>
                <CardDescription>Define the time periods of your world.</CardDescription>
              </DialogHeader>
              <div className="space-y-6 py-4">
                <div className="p-4 rounded-lg bg-gold/5 border border-gold/10 space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold uppercase">Era Name</label>
                      <Input value={newEra.name} onChange={e => setNewEra({...newEra, name: e.target.value})} placeholder="e.g. The Second Age" className="h-8 text-xs" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold uppercase">Order</label>
                      <Input type="number" value={newEra.order} onChange={e => setNewEra({...newEra, order: parseInt(e.target.value)})} className="h-8 text-xs" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase block">Background Image</label>
                    <div className="flex gap-4 items-end">
                      <div className="flex-grow">
                        <ImageUpload 
                          currentImageUrl={newEra.backgroundImageUrl || ''}
                          storagePath="images/wiki/eras"
                          onUpload={(url) => setNewEra({...newEra, backgroundImageUrl: url})}
                        />
                      </div>
                      <Button onClick={handleCreateEra} className="h-10 bg-gold text-white text-xs px-4">Add Era</Button>
                    </div>
                  </div>
                </div>

                <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2">
                  {eras.map(era => (
                    <div key={era.id} className="p-3 rounded-md border border-gold/10 bg-card space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Badge variant="outline" className="text-gold border-gold/20 font-mono">{era.order}</Badge>
                          <span className="font-serif font-bold">{era.name}</span>
                        </div>
                        <Button variant="ghost" size="icon" className="btn-danger h-8 w-8" onClick={() => handleDeleteEra(era.id)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                      <div className="pt-2 border-t border-gold/5 space-y-1">
                        <label className="text-[9px] text-ink/40 uppercase tracking-wider block">Background Image</label>
                        <ImageUpload
                          currentImageUrl={era.backgroundImageUrl || ''}
                          storagePath="images/wiki/eras"
                          onUpload={async (url) => {
                            try {
                              await upsertDocument('eras', era.id, { ...era, background_image_url: url });
                              setEras(prev => prev.map(e => e.id === era.id ? { ...e, background_image_url: url } : e));
                              toast.success('Era background updated');
                            } catch (err) {
                              console.error(err);
                              toast.error('Failed to update background');
                            }
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger render={
            <Button className="btn-gold-solid gap-2">
              <Plus className="w-4 h-4" /> New Campaign
            </Button>
          } />
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="font-serif text-2xl">Create Campaign</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Campaign Name</label>
                <Input value={newCampaign.name} onChange={e => setNewCampaign({...newCampaign, name: e.target.value})} placeholder="e.g. The Shattered Isles" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Description</label>
                <textarea 
                  className="w-full min-h-[100px] p-3 rounded-md border border-input bg-background text-sm"
                  value={newCampaign.description}
                  onChange={e => setNewCampaign({...newCampaign, description: e.target.value})}
                  placeholder="A brief overview of the adventure..."
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Era</label>
                <select 
                  className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                  value={newCampaign.eraId}
                  onChange={e => setNewCampaign({...newCampaign, eraId: e.target.value})}
                >
                  <option value="">Select an Era...</option>
                  {eras.map(era => (
                    <option key={era.id} value={era.id}>{era.name}</option>
                  ))}
                </select>
              </div>
              <Button onClick={handleCreateCampaign} className="w-full bg-gold text-white">Create Campaign</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>

    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        {campaigns.map(campaign => {
          const campaignPlayers = users.filter(u => u.campaignIds?.includes(campaign.id) || u.campaignId === campaign.id);
          return (
            <Card key={campaign.id} className="border-gold/10 hover:border-gold/30 transition-colors">
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div className="bg-gold/10 p-2 rounded-lg">
                    <LayoutGrid className="w-5 h-5 text-gold" />
                  </div>
                  <Button variant="ghost" size="icon" className="btn-danger h-8 w-8" onClick={() => handleDeleteCampaign(campaign.id)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
                <CardTitle className="text-2xl font-serif mt-4">{campaign.name}</CardTitle>
                <Badge variant="outline" className="w-fit mt-1 border-gold/20 text-gold/60">
                  {eras.find(e => e.id === campaign.eraId)?.name || 'No Era Assigned'}
                </Badge>
                <CardDescription className="line-clamp-2 mt-2">{campaign.description || 'No description provided.'}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center gap-4 text-sm text-ink/60">
                  <div className="flex items-center gap-1">
                    <Users className="w-4 h-4" />
                    <span>{campaignPlayers.length} Players</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Calendar className="w-4 h-4" />
                    <span>{new Date(campaign.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-ink/40">
                      <Calendar className="w-3 h-3 text-gold" />
                      <span>Era</span>
                    </div>
                    <select 
                      className="w-full h-9 px-3 rounded-md border border-gold/10 bg-background text-sm font-serif italic"
                      value={campaign.eraId || ''}
                      onChange={(e) => handleSetCampaignEra(campaign.id, e.target.value)}
                    >
                      <option value="">No Era</option>
                      {eras.map(era => (
                        <option key={era.id} value={era.id}>{era.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-ink/40">
                      <Sparkles className="w-3 h-3 text-gold" />
                      <span>Recommended Lore</span>
                    </div>
                    <select 
                      className="w-full h-9 px-3 rounded-md border border-gold/10 bg-background text-sm font-serif italic"
                      value={campaign.recommendedLoreId || ''}
                      onChange={(e) => handleSetRecommendedLore(campaign.id, e.target.value)}
                    >
                      <option value="">No article</option>
                      {lorePages.map(page => (
                        <option key={page.id} value={page.id}>{page.title}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="pt-2">
                  <p className="text-xs font-bold uppercase tracking-wider text-ink/40 mb-2">Active Players</p>
                  <div className="flex flex-wrap gap-1">
                    {campaignPlayers.length > 0 ? (
                      campaignPlayers.map(p => (
                        <Badge key={p.id} variant="secondary" className="text-[10px]">
                          {p.displayName}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-xs text-ink/20 italic">No players assigned</span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {campaigns.length === 0 && (
        <div className="text-center py-20 bg-card/50 rounded-xl border border-dashed border-gold/20">
          <LayoutGrid className="w-12 h-12 text-gold/20 mx-auto mb-4" />
          <p className="text-ink/40 font-serif italic">No campaigns created yet.</p>
        </div>
      )}
    </div>
  );
}
