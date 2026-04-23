import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { db, OperationType, handleFirestoreError } from '../../lib/firebase';
import { collection, doc, onSnapshot, deleteDoc, query, where, getDocs, updateDoc, getDoc } from 'firebase/firestore';
import BBCodeRenderer from '@/components/BBCodeRenderer';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { 
  ChevronLeft, Edit, Trash2, Users, MapPin, 
  Sparkles, History, Shield, Package, HelpCircle,
  Calendar, User, Tag, Info, Share2, Printer,
  Lock, Unlock, Eye, EyeOff, Library, Building,
  Flag, Sword, Zap, Mountain, Dna, Ship, Home,
  Biohazard, Swords, Scroll, Footprints, Languages,
  Coins, Layers, Flame, Scale, ListChecks, Hammer,
  Quote, Crown, Wand2, FlaskConical, Heart, BookOpen,
  ChevronDown
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const CATEGORIES = [
  { id: 'generic', label: 'Generic', icon: Library },
  { id: 'building', label: 'Building', icon: Building },
  { id: 'character', label: 'Character', icon: Users },
  { id: 'country', label: 'Country', icon: Flag },
  { id: 'military', label: 'Military', icon: Sword },
  { id: 'deity', label: 'God/Deity', icon: Zap },
  { id: 'geography', label: 'Geography', icon: Mountain },
  { id: 'item', label: 'Item', icon: Package },
  { id: 'organization', label: 'Organization', icon: Shield },
  { id: 'religion', label: 'Religion', icon: Sparkles },
  { id: 'species', label: 'Species', icon: Dna },
  { id: 'vehicle', label: 'Vehicle', icon: Ship },
  { id: 'settlement', label: 'Settlement', icon: Home },
  { id: 'condition', label: 'Condition', icon: Biohazard },
  { id: 'conflict', label: 'Conflict', icon: Swords },
  { id: 'document', label: 'Document', icon: Scroll },
  { id: 'culture', label: 'Culture / Ethnicity', icon: Footprints },
  { id: 'language', label: 'Language', icon: Languages },
  { id: 'material', label: 'Material', icon: Coins },
  { id: 'formation', label: 'Military Formation', icon: Layers },
  { id: 'myth', label: 'Myth', icon: Flame },
  { id: 'law', label: 'Natural Law', icon: Scale },
  { id: 'plot', label: 'Plot', icon: ListChecks },
  { id: 'profession', label: 'Profession', icon: Hammer },
  { id: 'prose', label: 'Prose', icon: Quote },
  { id: 'title', label: 'Title', icon: Crown },
  { id: 'spell', label: 'Spell', icon: Wand2 },
  { id: 'technology', label: 'Technology', icon: FlaskConical },
  { id: 'tradition', label: 'Tradition', icon: Heart },
  { id: 'session', label: 'Session Report', icon: BookOpen },
];

export default function LoreArticle({ userProfile }: { userProfile: any }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [article, setArticle] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [dmNotes, setDmNotes] = useState<any>(null);
  const [secrets, setSecrets] = useState<any[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);

  const [parentArticle, setParentArticle] = useState<any>(null);

  const isStaff = userProfile?.role === 'admin' || userProfile?.role === 'co-dm' || userProfile?.role === 'lore-writer';

  useEffect(() => {
    if (!id) return;

    const unsubscribeArticle = onSnapshot(doc(db, 'lore', id), async (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setArticle({ id: docSnap.id, ...data });
        
        // Fetch parent article if it exists
        if (data.parentId) {
          try {
            const parentRef = doc(db, 'lore', data.parentId);
            const parentSnap = await getDoc(parentRef);
            if (parentSnap.exists()) {
              setParentArticle({ id: parentSnap.id, ...parentSnap.data() });
            }
          } catch (e) {
            console.error("Failed to fetch parent article", e);
          }
        } else {
          setParentArticle(null);
        }
      } else {
        setArticle(null);
      }
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `lore/${id}`);
      setLoading(false);
    });

    // Fetch DM Notes if staff
    let unsubscribeNotes = () => {};
    if (isStaff) {
      unsubscribeNotes = onSnapshot(doc(db, 'lore', id, 'dmData', 'notes'), (docSnap) => {
        if (docSnap.exists()) {
          setDmNotes(docSnap.data());
        }
      }, (error) => {
        handleFirestoreError(error, OperationType.GET, `lore/${id}/dmData/notes`);
      });
    }

    // Fetch Secrets
    let secretsQuery: any;
    if (isStaff) {
      secretsQuery = collection(db, 'lore', id, 'secrets');
    } else if (userProfile?.activeCampaignId) {
      secretsQuery = query(
        collection(db, 'lore', id, 'secrets'),
        where('revealedCampaignIds', 'array-contains', userProfile.activeCampaignId)
      );
    }

    let unsubscribeSecrets = () => {};
    if (secretsQuery) {
      unsubscribeSecrets = onSnapshot(secretsQuery, (snapshot: any) => {
        setSecrets(snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() })));
      }, (error: any) => {
        // Only log if it's not a permission error for players (which is expected if they have no campaign)
        if (isStaff || userProfile?.activeCampaignId) {
          handleFirestoreError(error, OperationType.LIST, `lore/${id}/secrets`);
        }
      });
    }

    // Fetch Campaigns for labeling
    const fetchCampaigns = async () => {
      try {
        const snap = await getDocs(collection(db, 'campaigns'));
        setCampaigns(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      } catch (error) {
        console.error("Error fetching campaigns in lore article:", error);
      }
    };
    fetchCampaigns();

    // Fetch Eras for labeling
    const fetchEras = async () => {
      try {
        const snap = await getDocs(collection(db, 'eras'));
        setEras(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      } catch (error) {
        console.error("Error fetching eras in lore article:", error);
      }
    };
    fetchEras();

    return () => {
      unsubscribeArticle();
      unsubscribeNotes();
      unsubscribeSecrets();
    };
  }, [id, isStaff]);

  const [eras, setEras] = useState<any[]>([]);

  const handleToggleSecretReveal = async (secret: any, campaignId: string) => {
    if (!id) return;
    try {
      const secretRef = doc(db, 'lore', id, 'secrets', secret.id);
      const isRevealed = secret.revealedCampaignIds.includes(campaignId);
      const newRevealed = isRevealed 
        ? secret.revealedCampaignIds.filter((cid: string) => cid !== campaignId)
        : [...secret.revealedCampaignIds, campaignId];
      
      await updateDoc(secretRef, { 
        revealedCampaignIds: newRevealed, 
        updatedAt: new Date().toISOString() 
      });
      // Local state update is handled by onSnapshot
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `lore/${id}/secrets`);
    }
  };

  useEffect(() => {
    if (article && article.id) {
      try {
        const historyStr = localStorage.getItem('articleHistory');
        let history = historyStr ? JSON.parse(historyStr) : [];
        history = history.filter((item: any) => item.id !== article.id);
        history.unshift({ id: article.id, title: article.title });
        if (history.length > 5) history = history.slice(0, 5);
        localStorage.setItem('articleHistory', JSON.stringify(history));
        window.dispatchEvent(new Event('articleHistoryUpdated'));
      } catch (e) {
        console.error("Failed to save article history", e);
      }
    }
  }, [article]);

  const handleDelete = async () => {
    if (!id) return;
    if (confirm('Are you sure you want to delete this article? This cannot be undone.')) {
      try {
        await deleteDoc(doc(db, 'lore', id));
        toast.success('Article deleted');
        navigate('/wiki');
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, `lore/${id}`);
      }
    }
  };

  if (loading) return <div className="text-center py-20 font-serif italic">Consulting the scrolls...</div>;
  if (!article) return <div className="text-center py-20 font-serif italic">This article has been lost to time.</div>;

  const CategoryIcon = CATEGORIES.find(c => c.id === article.category)?.icon || HelpCircle;
  const canEdit = isStaff;

  // Filter secrets based on visibility and user campaign
  const visibleSecrets = secrets.filter(secret => {
    if (isStaff) return true;
    // Check if user's active campaign is in the revealed list for this secret
    return userProfile?.activeCampaignId && secret.revealedCampaignIds?.includes(userProfile.activeCampaignId);
  });

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-20">
      {/* Header Actions */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => navigate('/wiki')} className="text-ink/60">
          <ChevronLeft className="w-4 h-4 mr-2" /> Back to Lore
        </Button>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="text-ink/40 hover:text-primary" onClick={() => window.print()}>
            <Printer className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" className="text-ink/40 hover:text-gold">
            <Share2 className="w-4 h-4" />
          </Button>
          {canEdit && (
            <>
              <Button variant="outline" onClick={() => navigate(`/wiki/edit/${id}`)} className="border-gold/20 text-gold hover:bg-gold/5">
                <Edit className="w-4 h-4 mr-2" /> Edit Article
              </Button>
              {(userProfile?.role === 'admin' || userProfile?.role === 'co-dm') && (
                <Button variant="ghost" size="icon" className="text-blood hover:bg-blood/10" onClick={handleDelete}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Article Layout */}
      <div className="grid lg:grid-cols-3 gap-12">
        {/* Main Body */}
        <div className="lg:col-span-2 space-y-8">
          <div className="space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              <CategoryIcon className="w-4 h-4 text-gold" />
              <span className="label-text text-gold">{article.category}</span>
              {article.folder && (
                <>
                  <span className="text-ink/30 text-xs">/</span>
                  <span className="label-text text-ink/60">{article.folder}</span>
                </>
              )}
              {parentArticle && (
                <>
                  <span className="text-ink/30 text-xs">/</span>
                  <Link to={`/wiki/article/${parentArticle.id}`} className="label-text text-gold hover:underline">
                    {parentArticle.title}
                  </Link>
                </>
              )}
              {article.status === 'draft' && (
                <Badge variant="outline" className="border-gold/40 text-gold bg-gold/5 text-[10px] ml-2">DRAFT</Badge>
              )}
            </div>
            <h1 className="h1-title leading-tight">{article.title}</h1>
            {article.excerpt && (
              <p className="description-text text-xl italic border-l-4 border-gold/20 pl-6 py-2">
                {article.excerpt}
              </p>
            )}
          </div>

          {article.imageUrl && (
            <div className="rounded-2xl overflow-hidden border border-gold/10 shadow-2xl">
              <img 
                src={article.imageUrl} 
                alt={article.title} 
                className="w-full h-auto max-h-[500px] object-cover"
                referrerPolicy="no-referrer"
              />
            </div>
          )}

          <BBCodeRenderer content={article.content} />

          {/* DM Notes Section (Staff Only) */}
          {isStaff && dmNotes && (
            <div className="mt-12 p-8 rounded-2xl border border-primary/20 bg-primary/5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="label-text text-primary flex items-center gap-2">
                  <Lock className="w-4 h-4" /> Storyteller Notes
                </h2>
                <Badge variant="outline" className="border-primary/20 text-primary/60 text-[10px]">PRIVATE</Badge>
              </div>
              <BBCodeRenderer content={dmNotes.content} className="prose-sm italic" />
            </div>
          )}

          {/* Revealed Secrets Section */}
          {visibleSecrets.length > 0 && (
            <div className="mt-8 space-y-4">
              <h2 className="label-text text-primary flex items-center gap-2">
                <Sparkles className="w-4 h-4" /> Revelations
              </h2>
              <div className="grid gap-4">
                {visibleSecrets.map((secret) => {
                  const linkedEras = eras.filter(e => secret.eraIds?.includes(e.id));
                  const isRevealedToMe = userProfile?.activeCampaignId && secret.revealedCampaignIds?.includes(userProfile.activeCampaignId);
                  const eligibleCampaigns = campaigns.filter(c => secret.eraIds?.includes(c.eraId));
                  
                  return (
                    <Card key={secret.id} className="border-primary/20 bg-primary/5 border-l-4 border-l-primary">
                      <CardContent className="p-4 space-y-4">
                        <div className="flex items-start gap-4">
                          <div className="mt-1">
                            {isRevealedToMe || isStaff ? <Unlock className="w-4 h-4 text-primary" /> : <Lock className="w-4 h-4 text-ink/40" />}
                          </div>
                          <div className="flex-grow space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              {linkedEras.map(era => (
                                <span key={era.id} className="label-text text-primary">
                                  {era.name}
                                </span>
                              ))}
                            </div>
                            <p className="description-text text-sm italic">"{secret.content}"</p>
                          </div>
                        </div>

                        {isStaff && (
                          <div className="pt-4 border-t border-primary/10">
                            <p className="label-text text-primary/40 mb-2">Manage Revelations</p>
                            <div className="flex flex-wrap gap-2">
                              {eligibleCampaigns.map(campaign => {
                                const isRevealed = secret.revealedCampaignIds?.includes(campaign.id);
                                const isAdmin = userProfile?.role === 'admin';
                                const isAssignedCoDM = userProfile?.role === 'co-dm' && userProfile?.campaignIds?.includes(campaign.id);
                                const canToggle = isAdmin || isAssignedCoDM;

                                return (
                                  <Button
                                    key={campaign.id}
                                    variant="outline"
                                    size="xs"
                                    disabled={!canToggle}
                                    onClick={() => handleToggleSecretReveal(secret, campaign.id)}
                                    className={`h-7 text-[10px] gap-1 transition-all duration-200 ${isRevealed ? 'bg-primary text-primary-foreground border-primary shadow-md scale-105 z-10 font-bold ring-2 ring-primary/20' : 'border-primary/10 text-primary/40 hover:bg-primary/5'}`}
                                  >
                                    {isRevealed ? <Unlock className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                                    {campaign.name}
                                    {!canToggle && <Shield className="w-2 h-2 ml-1 opacity-50" />}
                                  </Button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          <div className="pt-12 border-t border-gold/10 flex flex-wrap gap-2">
            {article.tags?.map((tag: string) => (
              <Badge key={tag} variant="outline" className="bg-ink/5 border-transparent text-ink/40 hover:bg-ink/10 cursor-default">
                <Tag className="w-3 h-3 mr-1" /> {tag}
              </Badge>
            ))}
          </div>

          {/* Moved Quick Reference to bottom */}
          <div className="pt-12">
            <Card className="border-gold/20 bg-gold/5 shadow-xl">
              <CardHeader className="border-b border-gold/10 pb-4">
                <CardTitle className="label-text text-gold flex items-center gap-2">
                  <Info className="w-4 h-4" /> Quick Reference
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="grid md:grid-cols-2 lg:grid-cols-3 divide-x divide-y divide-gold/10">
                  {/* Dynamic Metadata Fields */}
                  {article.metadata && Object.entries(article.metadata).map(([key, value]) => {
                    if (!value) return null;
                    return (
                      <div key={key} className="px-6 py-4 flex flex-col gap-1">
                        <span className="label-text text-ink/40">{key.replace(/([A-Z])/g, ' $1')}</span>
                        <span className="body-text text-sm">{value as string}</span>
                      </div>
                    );
                  })}

                  {/* System Metadata */}
                  <div className="px-6 py-4 flex flex-col gap-1">
                    <span className="label-text text-ink/40 flex items-center gap-1">
                      <Calendar className="w-3 h-3" /> Updated
                    </span>
                    <span className="body-text text-sm">
                      {new Date(article.updatedAt).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="px-6 py-4 flex flex-col gap-1">
                    <span className="label-text text-ink/40 flex items-center gap-1">
                      <User className="w-3 h-3" /> Chronicler
                    </span>
                    <span className="body-text text-sm">
                      {article.authorId === userProfile?.uid ? 'You' : 'Archive Staff'}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Sidebar removed or repurposed */}
        <div className="hidden lg:block space-y-8">
          {/* Related Links / Hierarchy could go here */}
        </div>
      </div>
    </div>
  );
}
