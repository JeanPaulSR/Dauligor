import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { db, OperationType, handleFirestoreError } from '../../lib/firebase';
import { collection, doc, onSnapshot, deleteDoc, query, where, getDocs, updateDoc, getDoc } from 'firebase/firestore';
import BBCodeRenderer from '@/components/BBCodeRenderer';
import { useWikiPreview } from '@/lib/wikiPreviewContext';
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
  ChevronDown, Link as LinkIcon, Globe, X
} from 'lucide-react';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Check } from 'lucide-react';

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
  const [mentions, setMentions] = useState<any[]>([]);
  const [allCampaigns, setAllCampaigns] = useState<any[]>([]);
  const [activeCampaignEraId, setActiveCampaignEraId] = useState<string | null>(null);
  
  const [hoveredArticleId, setHoveredArticleId] = useState<string | null>(null);
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });
  const [hoveredArticleData, setHoveredArticleData] = useState<any>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { previewCampaign, setPreviewCampaign } = useWikiPreview();

  const isStaff = userProfile?.role === 'admin' || userProfile?.role === 'co-dm' || userProfile?.role === 'lore-writer';

  // Resolve view context: preview campaign takes priority for staff, else use player's active campaign
  const viewContext = (() => {
    if (isStaff && previewCampaign) {
      return { eraId: previewCampaign.eraId, campaignId: previewCampaign.id, isStaff: false };
    }
    if (isStaff) return { isStaff: true, eraId: null, campaignId: null };
    return {
      eraId: activeCampaignEraId,
      campaignId: userProfile?.activeCampaignId ?? null,
      isStaff: false
    };
  })();

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

    // Fetch Campaigns for labeling and context resolution
    const fetchCampaigns = async () => {
      try {
        const snap = await getDocs(collection(db, 'campaigns'));
        const all = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setCampaigns(all);
        setAllCampaigns(all);
        // Resolve the active player campaign's eraId
        if (!isStaff && userProfile?.activeCampaignId) {
          const active = all.find((c: any) => c.id === userProfile.activeCampaignId);
          setActiveCampaignEraId(active?.eraId ?? null);
        }
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

    let unsubscribeMentions = () => {};
    const mentionsQuery = query(collection(db, 'lore'), where('linkedArticleIds', 'array-contains', id));
    unsubscribeMentions = onSnapshot(mentionsQuery, (snapshot) => {
      setMentions(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => {
      console.error("Error fetching mentions:", error);
    });

    return () => {
      unsubscribeArticle();
      unsubscribeNotes();
      unsubscribeSecrets();
      unsubscribeMentions();
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

  // Fetch hovered article data for quick-preview popover
  useEffect(() => {
    if (!hoveredArticleId) {
      setHoveredArticleData(null);
      return;
    }
    let cancelled = false;
    getDoc(doc(db, 'lore', hoveredArticleId))
      .then(snap => {
        if (!cancelled && snap.exists()) {
          setHoveredArticleData({ id: snap.id, ...snap.data() });
        }
      })
      .catch(() => setHoveredArticleData(null));
    return () => { cancelled = true; };
  }, [hoveredArticleId]);

  // Event delegation: detect hovering over internal wiki anchor tags
  const handleContentMouseOver = (e: React.MouseEvent<HTMLDivElement>) => {
    const anchor = (e.target as HTMLElement).closest('a[href*="/wiki/article/"]') as HTMLAnchorElement | null;
    if (anchor) {
      const href = anchor.getAttribute('href') || '';
      const match = href.match(/\/wiki\/article\/([^/]+)/);
      if (match) {
        if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
        hoverTimeoutRef.current = setTimeout(() => {
          setHoveredArticleId(match[1]);
          setHoverPos({ x: e.clientX, y: e.clientY });
        }, 400);
      }
    }
  };

  const handleContentMouseOut = (e: React.MouseEvent<HTMLDivElement>) => {
    const anchor = (e.target as HTMLElement).closest('a[href*="/wiki/article/"]');
    if (anchor) {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
      // Small delay so cursor can move onto the popover
      hoverTimeoutRef.current = setTimeout(() => setHoveredArticleId(null), 200);
    }
  };

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

  // Article-level visibility check for players (staff always see everything)
  if (!isStaff || previewCampaign) {
    const effectiveEraId = isStaff && previewCampaign ? previewCampaign.eraId : activeCampaignEraId;
    const effectiveCampaignId = isStaff && previewCampaign ? previewCampaign.id : (userProfile?.activeCampaignId ?? null);

    const hasEraScope = article.visibilityEraIds?.length > 0;
    const hasCampaignScope = article.visibilityCampaignIds?.length > 0;

    if (hasCampaignScope && !article.visibilityCampaignIds.includes(effectiveCampaignId)) {
      return (
        <div className="text-center py-32 space-y-4">
          <Globe className="w-16 h-16 text-gold/10 mx-auto" />
          <h2 className="font-serif text-xl text-ink/40 italic">This article is not available in your current campaign.</h2>
        </div>
      );
    }
    if (hasEraScope && effectiveEraId && !article.visibilityEraIds.includes(effectiveEraId)) {
      return (
        <div className="text-center py-32 space-y-4">
          <Globe className="w-16 h-16 text-gold/10 mx-auto" />
          <h2 className="font-serif text-xl text-ink/40 italic">This article belongs to a different era.</h2>
        </div>
      );
    }
  }

  const CategoryIcon = CATEGORIES.find(c => c.id === article.category)?.icon || HelpCircle;
  const canEdit = isStaff;

  // Filter secrets based on visibility and user campaign
  const visibleSecrets = secrets.filter(secret => {
    if (isStaff && !previewCampaign) return true;
    const activeCid = previewCampaign?.id ?? userProfile?.activeCampaignId;
    return activeCid && secret.revealedCampaignIds?.includes(activeCid);
  });

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-20 relative">

      {/* Hover Quick-Preview Popover */}
      {hoveredArticleId && hoveredArticleData && (
        <div
          className="fixed z-[9999] w-72 bg-card border border-gold/20 rounded-xl shadow-2xl overflow-hidden pointer-events-none animate-in fade-in zoom-in-95 duration-150"
          style={{ left: Math.min(hoverPos.x + 16, window.innerWidth - 300), top: hoverPos.y - 10 }}
        >
          {hoveredArticleData.imageUrl && (
            <div className="h-28 overflow-hidden">
              <img
                src={hoveredArticleData.imageUrl}
                alt={hoveredArticleData.title}
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
            </div>
          )}
          <div className="p-4 space-y-1">
            <p className="label-text text-gold text-[10px] uppercase tracking-widest">{hoveredArticleData.category}</p>
            <p className="font-serif font-semibold text-ink leading-tight">{hoveredArticleData.title}</p>
            {hoveredArticleData.excerpt && (
              <p className="text-xs text-ink/60 italic line-clamp-3 mt-1">{hoveredArticleData.excerpt}</p>
            )}
          </div>
        </div>
      )}

      {/* Staff Campaign Preview Banner */}
      {isStaff && (
        <div className={`flex items-center gap-3 px-4 py-2.5 rounded-lg border text-sm ${previewCampaign ? 'bg-primary/10 border-primary/30 text-primary' : 'bg-gold/5 border-gold/10 text-ink/40'}`}>
          <Eye className="w-4 h-4 shrink-0" />
          <span className="label-text uppercase tracking-widest text-[10px] shrink-0">
            {previewCampaign ? `Previewing as: ${previewCampaign.name}` : 'Preview as Campaign:'}
          </span>
          <div className="flex-grow max-w-[220px]">
            <Popover>
              <PopoverTrigger asChild>
                <button type="button" className="flex items-center justify-between w-full h-7 px-2 rounded-md border border-gold/10 bg-background/50 hover:bg-background/80 hover:border-gold/30 transition-colors text-left text-xs font-normal">
                  <span className="truncate">
                    {previewCampaign ? previewCampaign.name : "None (Staff View)"}
                  </span>
                  <ChevronDown className="w-3 h-3 text-ink/30 shrink-0" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-56 p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search campaigns..." className="h-8" />
                  <CommandList className="max-h-48">
                    <CommandEmpty>No campaigns found.</CommandEmpty>
                    <CommandGroup>
                      <CommandItem
                        onSelect={() => setPreviewCampaign(null)}
                        className="flex items-center gap-2 cursor-pointer text-xs"
                      >
                        <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${!previewCampaign ? 'bg-primary border-primary' : 'border-primary/30'}`}>
                          {!previewCampaign && <Check className="w-2.5 h-2.5 text-white" />}
                        </div>
                        <span>None (Staff View)</span>
                      </CommandItem>
                      {allCampaigns.map((c: any) => {
                        const isSelected = previewCampaign?.id === c.id;
                        return (
                          <CommandItem
                            key={c.id}
                            onSelect={() => {
                              setPreviewCampaign({ id: c.id, name: c.name, eraId: c.eraId ?? null });
                            }}
                            className="flex items-center gap-2 cursor-pointer text-xs"
                          >
                            <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${isSelected ? 'bg-primary border-primary' : 'border-primary/30'}`}>
                              {isSelected && <Check className="w-2.5 h-2.5 text-white" />}
                            </div>
                            <span className="truncate">{c.name}</span>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
          {previewCampaign && (
            <button onClick={() => setPreviewCampaign(null)} className="ml-auto text-primary/60 hover:text-primary transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

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
                <Button variant="ghost" size="icon" className="btn-danger" onClick={handleDelete}>
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

          <div
            ref={contentRef}
            onMouseOver={handleContentMouseOver}
            onMouseOut={handleContentMouseOut}
          >
            <BBCodeRenderer content={article.content} viewContext={viewContext} />
          </div>

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

          {/* Mentions Section */}
          {mentions.length > 0 && (
            <div className="mt-8 space-y-4">
              <h2 className="label-text text-gold flex items-center gap-2">
                <LinkIcon className="w-4 h-4" /> Mentioned In
              </h2>
              <div className="flex flex-col gap-2 border-l-2 border-gold/20 pl-4">
                {mentions.map((mention) => (
                  <Link key={mention.id} to={`/wiki/article/${mention.id}`} className="text-gold hover:underline flex items-center gap-2">
                    <span className="font-serif italic">{mention.title}</span>
                    <Badge variant="outline" className="border-gold/20 text-gold/60 text-[10px] scale-75 transform origin-left">
                      {mention.category}
                    </Badge>
                  </Link>
                ))}
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
