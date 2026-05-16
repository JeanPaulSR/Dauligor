import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { auth, OperationType, reportClientError } from '@/lib/firebase';
import { fetchDocument, fetchCollection, upsertDocument, deleteDocuments } from '@/lib/d1';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command';
import { ClassImageEditor } from '@/components/compendium/ClassImageEditor';
import { ChevronLeft, Save, Sparkles, LayoutGrid, ImageIcon, Calendar, FileText, MapPin, Scroll, Users, History, Check, X } from 'lucide-react';
import { ImageUpload } from '@/components/ui/ImageUpload';

export default function CampaignEditor({ userProfile }: { userProfile: any }) {
  const { id } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [eras, setEras] = useState<any[]>([]);
  const [lorePages, setLorePages] = useState<any[]>([]);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState('info');

  const [formData, setFormData] = useState({
    name: '',
    // `slug` isn't user-editable here, but campaigns.slug is NOT NULL and
    // upsertDocument's INSERT-on-conflict-UPDATE pattern checks NOT NULL
    // against the would-be inserted row first — so we have to thread the
    // existing slug through the form state to preserve it on save.
    slug: '',
    description: '',
    eraId: '',
    recommendedLoreId: '',
    playerIds: [] as string[],
    imageUrl: '',
    imageDisplay: undefined as any,
    cardImageUrl: '',
    cardDisplay: undefined as any,
    previewImageUrl: '',
    previewDisplay: undefined as any,
    backgroundImageUrl: ''
  });

  const isStaff = userProfile?.role === 'admin' || userProfile?.role === 'co-dm' || userProfile?.role === 'lore-writer';

  const tabs = [
    { id: 'info', label: 'Campaign Info', icon: LayoutGrid },
    { id: 'characters', label: 'Player Characters', icon: Users },
    { id: 'articles', label: 'Articles', icon: FileText },
    { id: 'maps', label: 'Maps', icon: MapPin },
    { id: 'sessions', label: 'Session Notes', icon: Scroll },
    { id: 'players', label: 'Player Notes', icon: Users },
    { id: 'timeline', label: 'Timeline', icon: History }
  ];

  useEffect(() => {
    if (!isStaff) return;

    const loadAllData = async () => {
      try {
        // Fetch Eras via D1 helper (D1-only)
        const erasData = await fetchCollection<any>('eras', { orderBy: '"order" ASC' });
        setEras(erasData);

        // Per-route endpoint (server strips dm_notes). Staff edit
        // surface, so the article picker shows drafts too.
        const idToken = await auth.currentUser?.getIdToken();
        const loreRes = await fetch('/api/lore/articles?orderBy=title%20ASC', {
          headers: idToken ? { Authorization: `Bearer ${idToken}` } : {},
        });
        if (!loreRes.ok) throw new Error(`Failed to load lore (HTTP ${loreRes.status})`);
        const loreBody = await loreRes.json();
        setLorePages(Array.isArray(loreBody?.articles) ? loreBody.articles : []);

        // Fetch Users via D1 helper (D1-only)
        const usersData = await fetchCollection<any>('users');
        setAllUsers(usersData);

        // Per-route campaign endpoint + dedicated members sub-route.
        // Staff context (this page is gated to admin/co-dm), so the
        // member-or-staff check on the server always admits.
        if (id) {
          const editIdToken = await auth.currentUser?.getIdToken();
          const authHeaders = editIdToken ? { Authorization: `Bearer ${editIdToken}` } : {};
          const [campRes, membersRes] = await Promise.all([
            fetch(`/api/campaigns/${encodeURIComponent(id)}`, { headers: authHeaders }),
            fetch(`/api/campaigns/${encodeURIComponent(id)}/members`, { headers: authHeaders }),
          ]);
          if (!campRes.ok) {
            setLoading(false);
            return;
          }
          const campData = (await campRes.json())?.campaign;

          if (campData) {
            const membersBody = membersRes.ok ? await membersRes.json() : { members: [] };
            const memberUids: string[] = Array.isArray(membersBody?.members)
              ? membersBody.members.map((m: any) => m.user_id).filter(Boolean)
              : [];

            setFormData({
              name: campData.name || '',
              slug: campData.slug || '',
              description: campData.description || '',
              eraId: campData.era_id || '',
              recommendedLoreId: campData.recommended_lore_id || '',
              playerIds: memberUids,
              imageUrl: campData.image_url || '',
              imageDisplay: campData.image_display || undefined,
              cardImageUrl: campData.card_image_url || '',
              cardDisplay: campData.card_display || undefined,
              previewImageUrl: campData.preview_image_url || '',
              previewDisplay: campData.preview_display || undefined,
              backgroundImageUrl: campData.background_image_url || ''
            });
          }
        }
      } catch (err) {
        console.error("Error loading editor data:", err);
      } finally {
        setLoading(false);
      }
    };

    loadAllData();
  }, [id, isStaff]);

  const handleSave = async () => {
    if (!id || !isStaff) return;
    setSaving(true);
    try {
      // 1. Save the campaign
      const campaignData = {
        name: formData.name,
        slug: formData.slug,
        description: formData.description,
        era_id: formData.eraId,
        recommended_lore_id: formData.recommendedLoreId,
        image_url: formData.imageUrl,
        image_display: formData.imageDisplay,
        card_image_url: formData.cardImageUrl,
        card_display: formData.cardDisplay,
        preview_image_url: formData.previewImageUrl,
        preview_display: formData.previewDisplay,
        background_image_url: formData.backgroundImageUrl,
        updated_at: new Date().toISOString()
      };

      await upsertDocument('campaigns', id, campaignData);

      // 2. Update junction table — fetch current members via the
      // per-route endpoint so the read goes through the same gate as
      // the editor's initial load.
      const saveIdToken = await auth.currentUser?.getIdToken();
      const currentRes = await fetch(`/api/campaigns/${encodeURIComponent(id)}/members`, {
        headers: saveIdToken ? { Authorization: `Bearer ${saveIdToken}` } : {},
      });
      const currentBody = currentRes.ok ? await currentRes.json() : { members: [] };
      const currentMembers: any[] = Array.isArray(currentBody?.members) ? currentBody.members : [];
      const currentUids = currentMembers.map((m) => m.user_id);

      // Users to add
      const toAdd = formData.playerIds.filter(uid => !currentUids.includes(uid));
      for (const uid of toAdd) {
        await upsertDocument('campaignMembers', `${id}_${uid}`, {
          campaign_id: id,
          user_id: uid,
          role: 'player',
          joined_at: new Date().toISOString()
        });
      }

      // Users to remove
      const toRemove = currentUids.filter(uid => !formData.playerIds.includes(uid));
      for (const uid of toRemove) {
        await deleteDocuments('campaignMembers', 'campaign_id = ? AND user_id = ?', [id, uid]);
      }

      toast.success('Campaign saved successfully');
      navigate(`/campaign/${id}`);
    } catch (err) {
      console.error(err);
      toast.error('Failed to save campaign');
    } finally {
      setSaving(false);
    }
  };

  const handleTogglePlayer = (userId: string) => {
    const isSelected = formData.playerIds.includes(userId);
    setFormData({
      ...formData,
      playerIds: isSelected 
        ? formData.playerIds.filter(uid => uid !== userId) 
        : [...formData.playerIds, userId]
    });
  };

  if (!isStaff) {
    return <div className="text-center py-20 font-serif italic text-ink/60">Access Denied</div>;
  }

  if (loading) {
    return (
      <div className="text-center py-20 font-serif italic text-ink/60">
        Loading campaign editor...
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-20">
      {/* Header Actions */}
      <div className="page-header">
        <Button variant="ghost" onClick={() => navigate(-1)} className="text-ink/60 hover:text-gold transition-colors rounded">
          <ChevronLeft className="w-4 h-4 mr-2" /> Back
        </Button>
        <Button onClick={handleSave} disabled={saving} className="btn-gold-solid gap-2 rounded">
          <Save className="w-4 h-4" />
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>

      <div className="flex flex-col md:flex-row gap-8">
        {/* Left Side Tab Drawer Trigger Stack */}
        <div className="w-full md:w-60 shrink-0 flex flex-col gap-1">
          {tabs.map(tab => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-3 px-4 py-3 rounded text-xs lg:text-sm font-bold transition-all text-left border ${
                  isActive 
                    ? 'bg-gold/15 text-gold border-gold/30 shadow-sm' 
                    : 'text-ink/60 border-transparent hover:bg-gold/5 hover:text-gold/80'
                }`}
              >
                <tab.icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-gold' : 'text-ink/40'}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Right Tab Content Body */}
        <div className="flex-1 min-w-0">
          {activeTab === 'info' && (
            <div className="space-y-6 animate-in fade-in duration-300">
              {/* Campaign Basic Details */}
              <Card className="border-gold/10 bg-card/60 shadow-xl backdrop-blur-sm rounded">
                <CardHeader>
                  <CardTitle className="h2-title flex items-center gap-2">
                    <LayoutGrid className="w-5 h-5 text-gold shrink-0" /> Campaign Info
                  </CardTitle>
                  <p className="field-hint mt-1">Configure details, era scope, and custom images for this campaign.</p>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-2">
                    <label className="field-label flex items-center gap-1.5">Campaign Name</label>
                    <Input 
                      value={formData.name} 
                      onChange={e => setFormData({ ...formData, name: e.target.value })} 
                      placeholder="e.g. The Shattered Isles" 
                      className="field-input font-serif text-lg md:text-xl h-11 rounded"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="field-label flex items-center gap-1.5">Description</label>
                    <textarea 
                      className="w-full min-h-[100px] p-3 rounded border border-gold/10 bg-background/50 hover:border-gold/30 focus:border-gold/40 text-sm italic font-serif leading-relaxed text-ink/80 transition-colors"
                      value={formData.description}
                      onChange={e => setFormData({ ...formData, description: e.target.value })}
                      placeholder="A brief overview of the adventure..."
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="field-label flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 text-gold shrink-0" /> Historical Era
                      </label>
                      <select 
                        className="w-full h-10 px-3 rounded border border-gold/10 bg-background/50 hover:border-gold/30 text-sm font-serif italic text-ink/80 transition-colors"
                        value={formData.eraId}
                        onChange={e => setFormData({ ...formData, eraId: e.target.value })}
                      >
                        <option value="">No Era Assigned</option>
                        {eras.map(era => (
                          <option key={era.id} value={era.id}>{era.name}</option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-2">
                      <label className="field-label flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-gold shrink-0" /> Recommended Lore
                      </label>
                      <select 
                        className="w-full h-10 px-3 rounded border border-gold/10 bg-background/50 hover:border-gold/30 text-sm font-serif italic text-ink/80 transition-colors"
                        value={formData.recommendedLoreId}
                        onChange={e => setFormData({ ...formData, recommendedLoreId: e.target.value })}
                      >
                        <option value="">No Recommended Article</option>
                        {lorePages.map(page => (
                          <option key={page.id} value={page.id}>{page.title}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                   <div className="space-y-2 pt-2 border-t border-gold/10">
                     <label className="field-label flex items-center gap-1.5">
                       <ImageIcon className="w-3.5 h-3.5 text-gold shrink-0" /> Custom Background Image
                     </label>
                     <ImageUpload 
                       currentImageUrl={formData.backgroundImageUrl || ''} 
                       onUpload={url => setFormData({ ...formData, backgroundImageUrl: url })} 
                       storagePath="images/campaigns"
                     />
                   </div>
                 </CardContent>
               </Card>

              {/* Improved Player Assignment Design with Users Grid/Tags */}
              <Card className="border-gold/10 bg-card/60 shadow-xl backdrop-blur-sm rounded">
                <CardHeader>
                  <CardTitle className="h2-title flex items-center gap-2">
                    <Users className="w-4 h-4 text-gold shrink-0" /> Player Assignment
                  </CardTitle>
                  <p className="field-hint mt-0.5">Easily assign and manage dozens of players in the campaign.</p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-3">
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className="h-9 border-gold/20 text-gold hover:bg-gold/5 flex items-center gap-2 rounded">
                          <Users className="w-4 h-4" /> Add Player
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-72 p-0" align="start">
                        <Command>
                          <CommandInput placeholder="Search players..." className="h-9" />
                          <CommandList className="max-h-56">
                            <CommandEmpty>No users found.</CommandEmpty>
                            <CommandGroup>
                              {allUsers.map(u => {
                                const selected = formData.playerIds.includes(u.id);
                                return (
                                  <CommandItem key={u.id} onSelect={() => handleTogglePlayer(u.id)} className="flex items-center gap-2 cursor-pointer p-2 hover:bg-gold/5 transition-colors rounded">
                                    <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${selected ? 'bg-gold border-gold' : 'border-gold/30'}`}>
                                      {selected && <Check className="w-2.5 h-2.5 text-white" />}
                                    </div>
                                    <div className="flex flex-col min-w-0">
                                      <span className="text-xs truncate font-bold text-ink">{u.displayName}</span>
                                      <span className="text-[10px] text-ink/40 leading-none">@{u.username}</span>
                                    </div>
                                  </CommandItem>
                                );
                              })}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </div>

                  {/* Active Grid of assigned players */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 pt-1 border border-gold/10 bg-background/50 p-3 rounded">
                    {formData.playerIds.length === 0 ? (
                      <p className="text-xs text-ink/40 font-serif italic col-span-full">No active players assigned yet.</p>
                    ) : (
                      formData.playerIds.map(uid => {
                        const u = allUsers.find(u => u.id === uid);
                        if (!u) return null;
                        return (
                          <div key={uid} className="flex items-center justify-between p-2.5 rounded bg-gold/5 border border-gold/20 hover:border-gold/40 hover:bg-gold/10 transition-all duration-200">
                            <div className="flex flex-col min-w-0">
                              <span className="text-xs font-bold text-gold truncate font-serif">{u.displayName}</span>
                              <span className="text-[9px] text-ink/40">@{u.username}</span>
                            </div>
                            <Button 
                              size="icon" 
                              variant="ghost" 
                              onClick={() => handleTogglePlayer(uid)} 
                              className="w-6 h-6 hover:bg-blood/10 hover:text-blood text-ink/40 rounded transition-colors"
                            >
                              <X className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        );
                      })
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Image Display Focusing Editor */}
              <Card className="border-gold/10 bg-card/60 shadow-xl backdrop-blur-sm rounded">
                <CardHeader>
                  <CardTitle className="label-text text-gold flex items-center gap-2">
                    <ImageIcon className="w-4 h-4 shrink-0" /> Campaign Images
                  </CardTitle>
                  <p className="field-hint mt-0.5">Focus the imagery to match the aesthetic of your campaign views.</p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="bg-background/60 rounded border border-gold/10 overflow-hidden p-4">
                    <ClassImageEditor
                      imageUrl={formData.imageUrl || ''}
                      onImageUrlChange={(val) => setFormData({ ...formData, imageUrl: val })}
                      imageDisplay={formData.imageDisplay}
                      onImageDisplayChange={(val) => setFormData({ ...formData, imageDisplay: val })}
                      cardImageUrl={formData.cardImageUrl || ''}
                      onCardImageUrlChange={(val) => setFormData({ ...formData, cardImageUrl: val })}
                      cardDisplay={formData.cardDisplay}
                      onCardDisplayChange={(val) => setFormData({ ...formData, cardDisplay: val })}
                      previewImageUrl={formData.previewImageUrl || ''}
                      onPreviewImageUrlChange={(val) => setFormData({ ...formData, previewImageUrl: val })}
                      previewDisplay={formData.previewDisplay}
                      onPreviewDisplayChange={(val) => setFormData({ ...formData, previewDisplay: val })}
                      storagePath={`images/campaigns/${id}`}
                      panelLabels={{
                        detail:  { label: 'Campaign Header', subtitle: 'Campaign manager view' },
                        card:    { label: 'Sidebar Card',     subtitle: 'Sidebar active state' },
                        preview: { label: 'Hover Preview',   subtitle: 'Campaign hover peak' },
                      }}
                    />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {activeTab === 'characters' && (
            <Card className="border-gold/10 bg-card/60 shadow-xl backdrop-blur-sm rounded">
              <CardHeader>
                <CardTitle className="h2-title flex items-center gap-2">
                  <Users className="w-5 h-5 text-gold" /> Player Characters
                </CardTitle>
                <p className="field-hint mt-1">Review active player characters in the campaign.</p>
              </CardHeader>
              <CardContent>
                <p className="description-text py-4">No active player characters found.</p>
              </CardContent>
            </Card>
          )}

          {activeTab === 'articles' && (
            <Card className="border-gold/10 bg-card/60 shadow-xl backdrop-blur-sm rounded">
              <CardHeader>
                <CardTitle className="h2-title flex items-center gap-2">
                  <FileText className="w-5 h-5 text-gold" /> Articles
                </CardTitle>
                <p className="field-hint mt-1">Review and manage linked articles for this campaign.</p>
              </CardHeader>
              <CardContent>
                <p className="description-text py-4">No articles linked to this campaign yet.</p>
              </CardContent>
            </Card>
          )}

          {activeTab === 'maps' && (
            <Card className="border-gold/10 bg-card/60 shadow-xl backdrop-blur-sm rounded">
              <CardHeader>
                <CardTitle className="h2-title flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-gold" /> Maps
                </CardTitle>
                <p className="field-hint mt-1">A visual guide of the regions active in this campaign.</p>
              </CardHeader>
              <CardContent>
                <p className="description-text py-4">No maps assigned to this campaign yet.</p>
              </CardContent>
            </Card>
          )}

          {activeTab === 'sessions' && (
            <Card className="border-gold/10 bg-card/60 shadow-xl backdrop-blur-sm rounded">
              <CardHeader>
                <CardTitle className="h2-title flex items-center gap-2">
                  <Scroll className="w-5 h-5 text-gold" /> Session Notes
                </CardTitle>
                <p className="field-hint mt-1">Write, archive, and manage the game master's records of the sessions.</p>
              </CardHeader>
              <CardContent>
                <p className="description-text py-4">No session notes recorded for this campaign yet.</p>
              </CardContent>
            </Card>
          )}

          {activeTab === 'players' && (
            <Card className="border-gold/10 bg-card/60 shadow-xl backdrop-blur-sm rounded">
              <CardHeader>
                <CardTitle className="h2-title flex items-center gap-2">
                  <Users className="w-5 h-5 text-gold" /> Player Notes
                </CardTitle>
                <p className="field-hint mt-1">A private canvas for players to keep track of their discoveries.</p>
              </CardHeader>
              <CardContent>
                <p className="description-text py-4">No player notes recorded for this campaign yet.</p>
              </CardContent>
            </Card>
          )}

          {activeTab === 'timeline' && (
            <Card className="border-gold/10 bg-card/60 shadow-xl backdrop-blur-sm rounded">
              <CardHeader>
                <CardTitle className="h2-title flex items-center gap-2">
                  <History className="w-5 h-5 text-gold" /> Timeline
                </CardTitle>
                <p className="field-hint mt-1">Timeline logs of historical occurrences in the campaign.</p>
              </CardHeader>
              <CardContent>
                <p className="description-text py-4">No timeline events recorded for this campaign yet.</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
