import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { db, OperationType, handleFirestoreError } from '../../lib/firebase';
import { collection, onSnapshot, query, orderBy, addDoc, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../../components/ui/dialog';
import { Plus, Trash2, LayoutGrid, Calendar, Users, Sparkles } from 'lucide-react';

export default function AdminCampaigns({ userProfile }: { userProfile: any }) {
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [lorePages, setLorePages] = useState<any[]>([]);
  const [eras, setEras] = useState<any[]>([]);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isEraOpen, setIsEraOpen] = useState(false);
  const [newCampaign, setNewCampaign] = useState({ name: '', description: '', eraId: '' });
  const [newEra, setNewEra] = useState({ name: '', description: '', order: 0 });

  useEffect(() => {
    if (userProfile?.role !== 'admin' && userProfile?.role !== 'co-dm') return;

    const qCampaigns = query(collection(db, 'campaigns'), orderBy('createdAt', 'desc'));
    const unsubscribeCampaigns = onSnapshot(qCampaigns, (snapshot) => {
      setCampaigns(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'campaigns');
    });

    const qEras = query(collection(db, 'eras'), orderBy('order', 'asc'));
    const unsubscribeEras = onSnapshot(qEras, (snapshot) => {
      setEras(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'eras');
    });

    const qUsers = query(collection(db, 'users'));
    const unsubscribeUsers = onSnapshot(qUsers, (snapshot) => {
      setUsers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'users');
    });

    const qLore = query(collection(db, 'lore'), orderBy('title'));
    const unsubscribeLore = onSnapshot(qLore, (snapshot) => {
      setLorePages(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'lore');
    });

    return () => {
      unsubscribeCampaigns();
      unsubscribeUsers();
      unsubscribeLore();
      unsubscribeEras();
    };
  }, [userProfile]);

  const handleCreateCampaign = async () => {
    try {
      await addDoc(collection(db, 'campaigns'), {
        ...newCampaign,
        dmId: userProfile.uid,
        createdAt: new Date().toISOString()
      });
      setIsAddOpen(false);
      setNewCampaign({ name: '', description: '', eraId: '' });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'campaigns');
    }
  };

  const handleCreateEra = async () => {
    try {
      await addDoc(collection(db, 'eras'), {
        ...newEra,
        createdAt: new Date().toISOString()
      });
      setNewEra({ name: '', description: '', order: eras.length });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'eras');
    }
  };

  const handleDeleteEra = async (id: string) => {
    if (confirm('Are you sure? This will remove the Era but not the campaigns assigned to it.')) {
      try {
        await deleteDoc(doc(db, 'eras', id));
        toast.success('Era deleted');
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `eras/${id}`);
      }
    }
  };

  const handleSetCampaignEra = async (campaignId: string, eraId: string) => {
    try {
      await updateDoc(doc(db, 'campaigns', campaignId), {
        eraId: eraId
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `campaigns/${campaignId}`);
    }
  };

  const handleDeleteCampaign = async (id: string) => {
    if (confirm('Are you sure? This will not remove users from the campaign, but they will no longer be associated with it.')) {
      try {
        await deleteDoc(doc(db, 'campaigns', id));
        toast.success('Campaign deleted');
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `campaigns/${id}`);
      }
    }
  };

  const handleSetRecommendedLore = async (campaignId: string, loreId: string) => {
    try {
      await updateDoc(doc(db, 'campaigns', campaignId), {
        recommendedLoreId: loreId
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `campaigns/${campaignId}`);
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
                <div className="grid grid-cols-3 gap-2 items-end p-4 rounded-lg bg-gold/5 border border-gold/10">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase">Era Name</label>
                    <Input value={newEra.name} onChange={e => setNewEra({...newEra, name: e.target.value})} placeholder="e.g. The Second Age" className="h-8 text-xs" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase">Order</label>
                    <Input type="number" value={newEra.order} onChange={e => setNewEra({...newEra, order: parseInt(e.target.value)})} className="h-8 text-xs" />
                  </div>
                  <Button onClick={handleCreateEra} className="h-8 bg-gold text-white text-xs">Add Era</Button>
                </div>

                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
                  {eras.map(era => (
                    <div key={era.id} className="flex items-center justify-between p-3 rounded-md border border-gold/10 bg-card">
                      <div className="flex items-center gap-3">
                        <Badge variant="outline" className="text-gold border-gold/20 font-mono">{era.order}</Badge>
                        <span className="font-serif font-bold">{era.name}</span>
                      </div>
                      <Button variant="ghost" size="icon" className="text-blood hover:bg-blood/10 h-8 w-8" onClick={() => handleDeleteEra(era.id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger render={
            <Button className="bg-gold hover:bg-gold/90 text-white gap-2">
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
                  <Button variant="ghost" size="icon" className="text-blood hover:bg-blood/10 h-8 w-8" onClick={() => handleDeleteCampaign(campaign.id)}>
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
