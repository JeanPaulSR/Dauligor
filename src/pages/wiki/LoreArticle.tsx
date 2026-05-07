import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { OperationType, reportClientError } from '../../lib/firebase';
import { fetchCollection, fetchDocument, queryD1, getSystemMetadata } from '../../lib/d1';
import { fetchLoreArticle, upsertLoreSecret, deleteLoreArticle } from '../../lib/lore';
import BBCodeRenderer from '@/components/BBCodeRenderer';
import { useWikiPreview } from '@/lib/wikiPreviewContext';
import { ClassImageStyle, DEFAULT_DISPLAY } from '@/components/compendium/ClassImageEditor';
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
import { Check, Database, CloudOff } from 'lucide-react';

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
  const [wikiSettings, setWikiSettings] = useState<{ defaultBackgroundImageUrl?: string }>({});
  const [isFoundationUsingD1, setIsFoundationUsingD1] = useState(false);
  const [isMetadataExpanded, setIsMetadataExpanded] = useState(false);
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
      campaignId: userProfile?.active_campaign_id ?? null,
      isStaff: false
    };
  })();

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const data = await getSystemMetadata<{ defaultBackgroundImageUrl?: string }>('wiki_settings');
        if (data) setWikiSettings(data);
      } catch (e) {
        console.error("Failed to load wiki settings", e);
      }
    };
    loadSettings();
  }, []);

  useEffect(() => {
    if (!id) return;

    const loadData = async () => {
      setLoading(true);
      try {
        // 1. Fetch main article
        const articleData = await fetchDocument<any>('lore', id);

        if (articleData) {
          // Normalize field names from SQL (snake_case to camelCase if needed, or just use as is)
          // The fetchDocument helper returns what SQL gives. SQL has parent_id, dm_notes.
          const normalizedArticle = {
            ...articleData,
            parentId: articleData.parent_id,
            dmNotes: articleData.dm_notes,
            imageUrl: articleData.image_url,
            imageDisplay: typeof articleData.image_display === 'string' ? JSON.parse(articleData.image_display) : articleData.image_display,
            cardImageUrl: articleData.card_image_url,
            cardDisplay: typeof articleData.card_display === 'string' ? JSON.parse(articleData.card_display) : articleData.card_display,
            previewImageUrl: articleData.preview_image_url,
            previewDisplay: typeof articleData.preview_display === 'string' ? JSON.parse(articleData.preview_display) : articleData.preview_display,
            createdAt: articleData.created_at,
            updatedAt: articleData.updated_at,
            authorId: articleData.author_id,
          };

          // Fetch specialized metadata based on category
          let metadata: any = {};
          if (normalizedArticle.category === 'character' || normalizedArticle.category === 'deity') {
            const metaRows = await queryD1<any>(`SELECT * FROM lore_meta_characters WHERE article_id = ?`, [id]);
            if (metaRows.length > 0) {
              const m = metaRows[0];
              metadata = { ...metadata, ...m, lifeStatus: m.life_status, birthDate: m.birth_date, deathDate: m.death_date };
            }
            if (normalizedArticle.category === 'deity') {
              const deityRows = await queryD1<any>(`SELECT * FROM lore_meta_deities WHERE article_id = ?`, [id]);
              if (deityRows.length > 0) metadata = { ...metadata, ...deityRows[0], holySymbol: deityRows[0].holy_symbol };
            }
          } else if (['building', 'settlement', 'geography', 'country'].includes(normalizedArticle.category)) {
            const metaRows = await queryD1<any>(`SELECT * FROM lore_meta_locations WHERE article_id = ?`, [id]);
            if (metaRows.length > 0) {
              const m = metaRows[0];
              metadata = { ...metadata, ...m, locationType: m.location_type, parentLocation: m.parent_location, owningOrganization: m.owning_organization, foundingDate: m.founding_date };
            }
          } else if (['organization', 'religion'].includes(normalizedArticle.category)) {
            const metaRows = await queryD1<any>(`SELECT * FROM lore_meta_organizations WHERE article_id = ?`, [id]);
            if (metaRows.length > 0) {
              const m = metaRows[0];
              metadata = { ...metadata, ...m, foundingDate: m.founding_date };
            }
            if (normalizedArticle.category === 'religion') {
              const deityRows = await queryD1<any>(`SELECT * FROM lore_meta_deities WHERE article_id = ?`, [id]);
              if (deityRows.length > 0) metadata = { ...metadata, ...deityRows[0], holySymbol: deityRows[0].holy_symbol };
            }
          }

          // Fetch Tags
          const tagRows = await queryD1<any>(`SELECT tag_id FROM lore_article_tags WHERE article_id = ?`, [id]);
          const tags = tagRows.map(r => r.tag_id);

          // Visibility Junctions
          const eraRows = await queryD1<any>(`SELECT era_id FROM lore_article_eras WHERE article_id = ?`, [id]);
          const campaignRows = await queryD1<any>(`SELECT campaign_id FROM lore_article_campaigns WHERE article_id = ?`, [id]);

          setArticle({
            ...normalizedArticle,
            metadata,
            tags,
            visibilityEraIds: eraRows.map(r => r.era_id),
            visibilityCampaignIds: campaignRows.map(r => r.campaign_id),
          });

          if (normalizedArticle.parentId) {
            const parent = await fetchDocument<any>('lore', normalizedArticle.parentId);
            setParentArticle(parent);
          }

          if (isStaff && normalizedArticle.dmNotes) {
            setDmNotes({ content: normalizedArticle.dmNotes });
          }
        } else {
          setArticle(null);
        }

        // 2. Fetch Secrets
        const secretsRows = await queryD1<any>(`
          SELECT s.*, 
                 (SELECT GROUP_CONCAT(era_id) FROM lore_secret_eras WHERE secret_id = s.id) as era_ids,
                 (SELECT GROUP_CONCAT(campaign_id) FROM lore_secret_campaigns WHERE secret_id = s.id) as revealed_campaign_ids
          FROM lore_secrets s 
          WHERE s.article_id = ?
        `, [id]);
        
        setSecrets(secretsRows.map(s => ({
          ...s,
          eraIds: s.era_ids ? s.era_ids.split(',') : [],
          revealedCampaignIds: s.revealed_campaign_ids ? s.revealed_campaign_ids.split(',') : [],
          createdAt: s.created_at,
          updatedAt: s.updated_at
        })));

        // 3. Fetch Mentions
        const mentionsRows = await queryD1<any>(`
          SELECT a.* FROM lore_articles a
          JOIN lore_links l ON a.id = l.article_id
          WHERE l.target_id = ?
        `, [id]);
        setMentions(mentionsRows.map(m => ({ ...m, title: m.title, category: m.category })));

        // 4. Foundation Data
        const [campaignsData, erasData] = await Promise.all([
          fetchCollection<any>('campaigns'),
          fetchCollection<any>('eras', { orderBy: '"order" ASC' })
        ]);


        setCampaigns(campaignsData);
        setAllCampaigns(campaignsData);
        setEras(erasData);
        setIsFoundationUsingD1(true);

        if (!isStaff && userProfile?.active_campaign_id) {
          const active = campaignsData.find((c: any) => c.id === userProfile.active_campaign_id);
          setActiveCampaignEraId(active?.era_id ?? null);
        }

      } catch (err) {
        console.error("Error loading lore article data:", err);
        setIsFoundationUsingD1(false);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [id, isStaff]);

  const [eras, setEras] = useState<any[]>([]);

  const handleToggleSecretReveal = async (secret: any, campaignId: string) => {
    if (!id) return;
    try {
      const isRevealed = secret.revealedCampaignIds.includes(campaignId);
      const newRevealed = isRevealed 
        ? secret.revealedCampaignIds.filter((cid: string) => cid !== campaignId)
        : [...secret.revealedCampaignIds, campaignId];
      
      const secretData = {
        ...secret,
        revealedCampaignIds: newRevealed,
        updatedAt: new Date().toISOString()
      };
      await upsertLoreSecret(id, secret.id, secretData);
      setSecrets(prev => prev.map(s => s.id === secret.id ? { ...s, revealedCampaignIds: newRevealed } : s));
    } catch (error) {
      console.error("Error toggling secret reveal:", error);
      toast.error('Failed to update revelation');
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
    fetchLoreArticle(hoveredArticleId)
      .then(article => {
        if (!cancelled && article) {
          setHoveredArticleData(article);
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
        await deleteLoreArticle(id);
        toast.success('Article deleted');
        navigate('/wiki');
      } catch (error) {
        console.error("Error deleting article:", error);
        toast.error('Failed to delete article');
      }
    }
  };

  if (loading) return <div className="text-center py-20 font-serif italic">Consulting the scrolls...</div>;
  if (!article) return <div className="text-center py-20 font-serif italic">This article has been lost to time.</div>;

  const PreviewBanner = isStaff && (
    <div className={`flex items-center gap-3 px-4 py-2.5 rounded-lg border text-sm ${previewCampaign ? 'bg-primary/10 border-primary/30 text-primary' : 'bg-gold/5 border-gold/10 text-ink/40'}`}>
      <Eye className="w-4 h-4 shrink-0 text-gold" />
      <span className="label-text uppercase tracking-widest text-[10px] shrink-0">
        {previewCampaign ? `Previewing as: ${previewCampaign.name}` : 'Preview as Campaign:'}
      </span>
      <div className="flex-grow max-w-[220px]">
        <Popover>
          <PopoverTrigger className="flex items-center justify-between w-full h-7 px-2 rounded border border-gold/10 bg-background/50 hover:bg-background/80 hover:border-gold/30 transition-colors text-left text-xs font-normal">
            <span className="truncate">
              {previewCampaign ? previewCampaign.name : "None (Staff View)"}
            </span>
            <ChevronDown className="w-3 h-3 text-ink/30 shrink-0" />
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
  );

  // Article-level visibility check for players (staff always see everything)
  if (!isStaff || previewCampaign) {
    const effectiveEraId = isStaff && previewCampaign ? previewCampaign.eraId : activeCampaignEraId;
    const effectiveCampaignId = isStaff && previewCampaign ? previewCampaign.id : (userProfile?.active_campaign_id ?? null);

    const hasEraScope = article.visibilityEraIds?.length > 0;
    const hasCampaignScope = article.visibilityCampaignIds?.length > 0;

    if (hasCampaignScope && !article.visibilityCampaignIds.includes(effectiveCampaignId)) {
      return (
        <div className="max-w-6xl mx-auto space-y-8 pb-20 relative px-4">
          {PreviewBanner}
          <div className="text-center py-32 space-y-4 animate-in fade-in duration-300">
            <Globe className="w-16 h-16 text-gold/10 mx-auto" />
            <h2 className="font-serif text-xl text-ink/40 italic">This article is not available in your current campaign.</h2>
          </div>
        </div>
      );
    }
    if (hasEraScope && effectiveEraId && !article.visibilityEraIds.includes(effectiveEraId)) {
      return (
        <div className="max-w-6xl mx-auto space-y-8 pb-20 relative px-4">
          {PreviewBanner}
          <div className="text-center py-32 space-y-4 animate-in fade-in duration-300">
            <Globe className="w-16 h-16 text-gold/10 mx-auto" />
            <h2 className="font-serif text-xl text-ink/40 italic">This article belongs to a different era.</h2>
          </div>
        </div>
      );
    }
  }

  const CategoryIcon = CATEGORIES.find(c => c.id === article.category)?.icon || HelpCircle;
  const canEdit = isStaff;

  // Filter secrets based on visibility and user campaign
  const visibleSecrets = secrets.filter(secret => {
    if (isStaff && !previewCampaign) return true;
    const activeCid = previewCampaign?.id ?? userProfile?.active_campaign_id;
    return activeCid && secret.revealedCampaignIds?.includes(activeCid);
  });

  // Resolve Background Image:
  let backgroundImageUrl = wikiSettings.defaultBackgroundImageUrl || 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?q=80&w=2000&auto=format&fit=crop';
  
  const effectiveCampaignId = isStaff && previewCampaign ? previewCampaign.id : (userProfile?.active_campaign_id ?? null);
  const activeCamp = allCampaigns.find((c: any) => c.id === effectiveCampaignId);
  const activeEraId = activeCamp ? activeCamp.era_id : (isStaff && previewCampaign ? previewCampaign.eraId : activeCampaignEraId);
  const activeEra = eras.find((e: any) => e.id === activeEraId);

  if (activeCamp?.backgroundImageUrl) {
    backgroundImageUrl = activeCamp.backgroundImageUrl;
  } else if (activeEra?.backgroundImageUrl) {
    backgroundImageUrl = activeEra.backgroundImageUrl;
  }

  const hasMetadata = article.metadata && Object.values(article.metadata).some(val => !!val);
  const hasTags = article.tags && article.tags.length > 0;
  const hasCardImage = !!article.cardImageUrl;
  const hasSidebarContent = hasTags || hasCardImage;

  return (
    <div className="relative min-h-screen">
      {/* Page Background Layer */}
      <div 
        className="fixed inset-0 bg-cover bg-center bg-no-repeat bg-fixed opacity-20 pointer-events-none z-0 select-none"
        style={{ backgroundImage: `url(${backgroundImageUrl})` }}
      />

      <div className="relative z-10 max-w-5xl mx-auto px-4 py-8 space-y-6">

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
        {PreviewBanner}

        {/* Header Actions */}
        <div className="flex items-center justify-between bg-card/80 backdrop-blur-md border border-gold/15 p-3 rounded-xl shadow-lg">
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

        {/* Centered World Anvil Container */}
        <div className="w-full bg-card/95 backdrop-blur-md border border-gold/15 rounded-xl shadow-2xl overflow-hidden animate-in fade-in duration-300">
          {article.imageUrl && (
            <div className="w-full h-[360px] relative overflow-hidden border-b border-gold/15">
              <img 
                src={article.imageUrl} 
                alt={article.title} 
                className="w-full h-full object-cover"
                style={ClassImageStyle({ display: article.imageDisplay })}
                referrerPolicy="no-referrer"
              />
            </div>
          )}

          <div className="p-6 md:p-10 space-y-8">
            {/* Title & Header Section */}
            <div className="space-y-4 text-center pb-6 border-b border-gold/10">
              <div className="flex items-center justify-center gap-2 flex-wrap">
                <CategoryIcon className="w-4 h-4 text-gold" />
                <span className="label-text text-gold text-xs">{article.category}</span>
                {article.folder && (
                  <>
                    <span className="text-ink/30 text-xs">/</span>
                    <span className="label-text text-ink/50 text-xs">{article.folder}</span>
                  </>
                )}
                {parentArticle && (
                  <>
                    <span className="text-ink/30 text-xs">/</span>
                    <Link to={`/wiki/article/${parentArticle.id}`} className="label-text text-gold hover:underline text-xs">
                      {parentArticle.title}
                    </Link>
                  </>
                )}
                {article.status === 'draft' && (
                  <Badge variant="outline" className="border-gold/40 text-gold bg-gold/5 text-[10px] ml-2">DRAFT</Badge>
                )}
              </div>

              <h1 className="text-4xl md:text-5xl font-serif font-bold text-center tracking-wide text-gold/90 drop-shadow-sm">{article.title}</h1>
              {article.excerpt && (
                <p className="text-lg md:text-xl font-serif italic text-ink/70 text-center max-w-2xl mx-auto leading-relaxed border-t border-b border-gold/10 py-3 mt-4">
                  "{article.excerpt}"
                </p>
              )}
            </div>

            {/* Dynamic sidebar collapse layout */}
            <div className={`grid ${hasSidebarContent ? 'lg:grid-cols-3 gap-10' : 'grid-cols-1'}`}>
              <div className={hasSidebarContent ? 'lg:col-span-2 space-y-8' : 'space-y-8'}>
                <div
                  ref={contentRef}
                  onMouseOver={handleContentMouseOver}
                  onMouseOut={handleContentMouseOut}
                  className="prose prose-invert max-w-none prose-gold leading-relaxed font-sans text-ink/90"
                >
                  <BBCodeRenderer content={article.content} viewContext={viewContext} />
                </div>

                {/* Storyteller Notes */}
                {isStaff && dmNotes && (
                  <div className="mt-12 p-6 rounded-2xl border border-primary/20 bg-primary/5 space-y-4">
                    <div className="flex items-center justify-between">
                      <h2 className="label-text text-primary flex items-center gap-2">
                        <Lock className="w-4 h-4" /> Storyteller Notes
                      </h2>
                      <Badge variant="outline" className="border-primary/20 text-primary/60 text-[10px]">PRIVATE</Badge>
                    </div>
                    <BBCodeRenderer content={dmNotes.content} className="prose-sm italic" />
                  </div>
                )}

                {/* Revelations Section */}
                {visibleSecrets.length > 0 && (
                  <div className="mt-8 space-y-4">
                    <h2 className="label-text text-primary flex items-center gap-2">
                      <Sparkles className="w-4 h-4" /> Revelations
                    </h2>
                    <div className="grid gap-4">
                      {visibleSecrets.map((secret) => {
                        const linkedEras = eras.filter(e => secret.eraIds?.includes(e.id));
                        const isRevealedToMe = userProfile?.active_campaign_id && secret.revealedCampaignIds?.includes(userProfile.active_campaign_id);
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
                                      const isAssignedCoDM = userProfile?.role === 'co-dm' && userProfile?.campaign_ids?.includes(campaign.id);
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

                {/* Unified Metadata / Details Card at the bottom of main column */}
                {(hasMetadata || article.updatedAt || article.authorId) && (
                  <div className="mt-12">
                    <Card className="border-gold/20 bg-gold/5 shadow-xl rounded">
                      <CardHeader className="p-0 border-b border-gold/10">
                        <Button 
                          variant="ghost" 
                          onClick={() => setIsMetadataExpanded(!isMetadataExpanded)}
                          className="w-full flex items-center justify-between p-4 hover:bg-gold/5 rounded-t text-left"
                        >
                          <span className="label-text text-gold flex items-center gap-2 font-serif">
                            <Info className="w-4 h-4" /> Quick Reference & Metadata
                          </span>
                          <ChevronDown className={`w-4 h-4 text-gold/60 transition-transform duration-200 ${isMetadataExpanded ? '' : '-rotate-90'}`} />
                        </Button>
                      </CardHeader>
                      {isMetadataExpanded && (
                        <CardContent className="p-0">
                          <div className="grid md:grid-cols-2 lg:grid-cols-3 divide-x divide-y divide-gold/10 animate-in fade-in duration-200">
                            {/* Dynamic Metadata Fields */}
                            {article.metadata && Object.entries(article.metadata).map(([key, value]) => {
                              if (!value) return null;
                              return (
                                <div key={key} className="px-6 py-4 flex flex-col gap-1">
                                  <span className="label-text text-[10px] tracking-wider uppercase text-ink/40">{key.replace(/([A-Z])/g, ' $1')}</span>
                                  <span className="body-text text-sm text-ink/80">{value as string}</span>
                                </div>
                              );
                            })}

                            {/* System Metadata */}
                            <div className="px-6 py-4 flex flex-col gap-1">
                              <span className="label-text text-ink/40 flex items-center gap-1">
                                <Calendar className="w-3 h-3" /> Updated
                              </span>
                              <span className="body-text text-sm text-ink/80">
                                {new Date(article.updatedAt).toLocaleDateString()}
                              </span>
                            </div>
                            <div className="px-6 py-4 flex flex-col gap-1">
                              <span className="label-text text-ink/40 flex items-center gap-1">
                                <User className="w-3 h-3" /> Chronicler
                              </span>
                              <span className="body-text text-sm text-ink/80">
                                {article.authorId === userProfile?.id ? 'You' : 'Archive Staff'}
                              </span>
                            </div>
                          </div>
                        </CardContent>
                      )}
                    </Card>
                  </div>
                )}
              </div>

              {/* Right Sidebar Column - collapsing if there's no info */}
              {hasSidebarContent && (
                <div className="lg:col-span-1 space-y-6 bg-card/60 backdrop-blur-md p-5 rounded-xl border border-gold/10 h-fit select-none">
                  {/* Card Image */}
                  {article.cardImageUrl && (
                    <div className="rounded-lg overflow-hidden border border-gold/10 shadow-lg">
                      <img 
                        src={article.cardImageUrl} 
                        alt={article.title} 
                        className="w-full h-auto object-cover"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                  )}

                  {/* Tag Cloud */}
                  {hasTags && (
                    <div className="pt-2 space-y-2">
                      <h4 className="text-[10px] font-bold uppercase tracking-widest text-gold/60">Tags</h4>
                      <div className="flex flex-wrap gap-1.5">
                        {article.tags?.map((tag: string) => (
                          <Badge key={tag} variant="outline" className="bg-ink/5 border-transparent text-ink/40 hover:bg-ink/10 cursor-default text-[10px]">
                            <Tag className="w-3 h-3 mr-1" /> {tag}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
