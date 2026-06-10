import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchLoreArticle, upsertLoreArticle } from '../../lib/lore';
import { fetchLoreArticleBlocks, saveLoreArticleBlocks } from '../../lib/loreArticleBlocks';
import { makeBlock, parseLayoutBlock, LAYOUT_BLOCK_TYPES, type LayoutBlock, type LayoutBlockType } from '../../lib/layoutBlocks';
import LayoutEditor from '../../components/layout/LayoutEditor';
import LayoutBlocks from '../../components/layout/LayoutBlocks';
import { fetchCollection } from '../../lib/d1';
import { getSessionToken } from '../../lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ImageSetEditor, DEFAULT_DISPLAY } from '@/components/ui/ImageSetEditor';
import MarkdownEditor from '@/components/MarkdownEditor';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { cn } from '../../lib/utils';
import {
  Users, MapPin, Sparkles, Shield, Package, ChevronLeft, Save, Eye, EyeOff,
  Image as ImageIcon, FileText, Tags, Library, Building, Flag, Sword, Zap, Mountain,
  Dna, Ship, Home as HomeIcon, Biohazard, Swords, Scroll, Footprints, Languages, Coins,
  Layers, Flame, Scale, ListChecks, Hammer, Quote, Crown, Wand2, FlaskConical, Heart,
  BookOpen, Lock, Unlock, Plus, Trash2, Globe, Check, X, Edit, Settings as SettingsIcon,
  ChevronDown, PanelLeftClose, PanelLeftOpen, HelpCircle, Link as LinkIcon,
} from 'lucide-react';

// Category templates — same set the classic LoreEditor offers (kept inline so the
// classic editor stays untouched during the transition; can extract to a shared
// module when the classic editor is retired in Phase 5).
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
  { id: 'settlement', label: 'Settlement', icon: HomeIcon },
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

// Article block set = the shared layout set MINUS the campaign-only `recommended`.
const ARTICLE_BLOCK_TYPES = LAYOUT_BLOCK_TYPES.filter((t) => t !== 'recommended') as LayoutBlockType[];

const EMPTY_METADATA = {
  age: '', race: '', alignment: '', occupation: '', lifeStatus: 'Alive', gender: '', pronouns: '',
  birthDate: '', deathDate: '', locationType: '', population: '', climate: '', ruler: '',
  foundingDate: '', parentLocation: '', owningOrganization: '', domains: '', holySymbol: '',
  motto: '', headquarters: '', leader: '',
};

/** Concatenate text-block BBCode bodies (depth-first) — the same mirror the
 *  server derives, kept in `content` for search / excerpts / mentions. */
function deriveContent(blocks: LayoutBlock[]): string {
  const out: string[] = [];
  const visit = (b: any) => {
    if (!b || typeof b !== 'object') return;
    if (b.blockType === 'text' && typeof b.body === 'string' && b.body.trim()) out.push(b.body.trim());
    if (Array.isArray(b.children)) b.children.forEach(visit);
  };
  blocks.forEach(visit);
  return out.join('\n\n');
}

/** Pull linked article ids out of the BBCode/markdown content so `lore_links`
 *  mention extraction keeps working. Same patterns the classic editor used. */
function extractLinkedIds(content: string): string[] {
  const ids = new Set<string>();
  let m: RegExpExecArray | null;
  const bb = /\[url=\/wiki\/article\/([^\]]+)\]/gi;
  while ((m = bb.exec(content)) !== null) ids.add(m[1]);
  const md = /\]\(\/wiki\/article\/([^)]+)\)/gi;
  while ((m = md.exec(content)) !== null) ids.add(m[1]);
  return Array.from(ids);
}

/** A fresh empty text block — the starting canvas for a brand-new article. */
function newTextBlock(): LayoutBlock {
  return makeBlock('text', crypto.randomUUID());
}

/** Article ids/slugs referenced by `reference` blocks (depth-first) — folded into
 *  linkedArticleIds so the mention graph (lore_links) includes block references. */
function collectReferenceArticleIds(blocks: LayoutBlock[]): string[] {
  const out: string[] = [];
  const visit = (b: any) => {
    if (!b || typeof b !== 'object') return;
    if (b.blockType === 'reference' && b.ref && b.ref.kind === 'article' && b.ref.id) out.push(b.ref.id);
    if (Array.isArray(b.children)) b.children.forEach(visit);
  };
  blocks.forEach(visit);
  return out;
}

export default function LoreArticleDesigner({ userProfile }: { userProfile: any }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const isStaff = userProfile?.role === 'admin' || userProfile?.role === 'co-dm' || userProfile?.role === 'lore-writer';

  const [loading, setLoading] = useState(!!id);
  const [saving, setSaving] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [openSections, setOpenSections] = useState<Set<string>>(new Set(['details']));

  const [blocks, setBlocks] = useState<LayoutBlock[]>(() => [newTextBlock()]);
  // The article's real UUID once loaded — the route param may be a slug, but
  // saves MUST key off the UUID (else upsert would create a duplicate row and
  // blocks would FK against the wrong id).
  const [realId, setRealId] = useState<string | null>(null);

  const [allArticles, setAllArticles] = useState<any[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [eras, setEras] = useState<any[]>([]);
  const [tagGroups, setTagGroups] = useState<any[]>([]);
  const [allTags, setAllTags] = useState<any[]>([]);

  const [formData, setFormData] = useState<any>({
    title: '', excerpt: '', category: 'generic', folder: '', parentId: '', status: 'draft',
    imageUrl: '', imageDisplay: null, cardImageUrl: '', cardDisplay: null,
    previewImageUrl: '', previewDisplay: null,
    tags: [] as string[], visibilityEraIds: [] as string[], visibilityCampaignIds: [] as string[],
    metadata: { ...EMPTY_METADATA }, createdAt: undefined as string | undefined,
  });

  // Fullscreen: strip global <main> padding + lock body scroll (the embedded
  // LayoutEditor doesn't manage this — the designer page owns its chrome).
  useEffect(() => {
    document.documentElement.classList.add('admin-page-fullscreen');
    document.body.classList.add('admin-page-fullscreen');
    return () => {
      document.documentElement.classList.remove('admin-page-fullscreen');
      document.body.classList.remove('admin-page-fullscreen');
    };
  }, []);

  useEffect(() => {
    if (!isStaff) return;
    let cancelled = false;

    const loadFoundation = async () => {
      try {
        const idToken = await getSessionToken();
        const authHeaders = idToken ? { Authorization: `Bearer ${idToken}` } : {};
        const [campRes, erasData, groupsData, tagsData, loreRes] = await Promise.all([
          fetch('/api/campaigns', { headers: authHeaders }),
          fetchCollection('eras', { orderBy: '"order" ASC' }),
          fetchCollection('tagGroups', { where: "classifications LIKE '%lore%'" }),
          fetchCollection('tags'),
          fetch('/api/lore/articles?orderBy=title%20ASC', { headers: authHeaders }),
        ]);
        const campaignsBody = campRes.ok ? await campRes.json() : {};
        const loreBody = loreRes.ok ? await loreRes.json() : {};
        if (cancelled) return;
        setCampaigns(Array.isArray(campaignsBody?.campaigns) ? campaignsBody.campaigns : []);
        setEras(erasData);
        setTagGroups(groupsData);
        setAllTags(tagsData);
        setAllArticles(Array.isArray(loreBody?.articles) ? loreBody.articles : []);
      } catch (err) {
        console.error('Error loading foundation data for LoreArticleDesigner:', err);
      }
    };
    loadFoundation();

    if (id) {
      (async () => {
        try {
          const article = await fetchLoreArticle(id);
          if (article && !cancelled) {
            setRealId(article.id);
            setFormData({
              title: article.title, excerpt: article.excerpt || '', category: article.category,
              folder: article.folder || '', parentId: article.parentId || '', status: article.status || 'draft',
              imageUrl: article.imageUrl || '', imageDisplay: article.imageDisplay,
              cardImageUrl: article.cardImageUrl || '', cardDisplay: article.cardDisplay,
              previewImageUrl: article.previewImageUrl || '', previewDisplay: article.previewDisplay,
              tags: article.tags || [], visibilityEraIds: article.visibilityEraIds || [],
              visibilityCampaignIds: article.visibilityCampaignIds || [],
              metadata: { ...EMPTY_METADATA, ...(article.metadata || {}) },
              createdAt: article.createdAt,
            });
            // Blocks are the body. Prefer the article packet; fall back to a
            // dedicated fetch. Every article is block-native (storyteller notes +
            // secrets are `note`/`secret` blocks), so there are no legacy
            // content/dm_notes/lore_secrets paths to migrate here anymore.
            let parsed: LayoutBlock[] = (Array.isArray((article as any).blocks) ? (article as any).blocks : [])
              .map(parseLayoutBlock).filter(Boolean) as LayoutBlock[];
            if (parsed.length === 0) {
              parsed = await fetchLoreArticleBlocks(id);
            }
            if (!cancelled) setBlocks(parsed);
          }
        } catch (error) {
          console.error('Error loading lore article:', error);
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
    }

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isStaff]);

  const toggleSection = (key: string) =>
    setOpenSections((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const setForm = (patch: Record<string, any>) => setFormData((f: any) => ({ ...f, ...patch }));
  const setMeta = (patch: Record<string, any>) => setFormData((f: any) => ({ ...f, metadata: { ...f.metadata, ...patch } }));

  /* ── secret block inspector (host-supplied; needs era/campaign data) ── */
  const renderInspectorExtras = (block: LayoutBlock, set: (patch: Record<string, any>) => void): React.ReactNode => {
    if (block.blockType !== 'secret') return null;
    const eraIds = block.eraIds || [];
    const revealed = block.revealedCampaignIds || [];
    const eligibleCampaigns = campaigns.filter((c) => eraIds.includes(c.eraId));
    return (
      <div className="space-y-3">
        <p className="field-hint">Hidden from players unless revealed to their campaign. Staff always see it.</p>
        <Field label="Secret (BBCode)">
          <MarkdownEditor value={block.body} onChange={(v) => set({ body: v })} placeholder="What is the secret?" />
        </Field>
        <Field label="Eras">
          <div className="flex flex-wrap gap-1.5">
            {eras.map((era) => {
              const sel = eraIds.includes(era.id);
              return (
                <button key={era.id} onClick={() => {
                  const nextEras = sel ? eraIds.filter((i) => i !== era.id) : [...eraIds, era.id];
                  // Drop reveals for campaigns no longer eligible under the new era set.
                  const stillEligible = campaigns.filter((c) => nextEras.includes(c.eraId)).map((c) => c.id);
                  set({ eraIds: nextEras, revealedCampaignIds: revealed.filter((id2) => stillEligible.includes(id2)) });
                }} className={cn('px-2 py-0.5 rounded text-[10px] border', sel ? 'bg-primary text-primary-foreground border-primary font-bold' : 'border-primary/20 text-primary/60 hover:bg-primary/5')}>
                  {era.name}
                </button>
              );
            })}
            {eras.length === 0 && <span className="text-[10px] text-gold/25 italic">No eras defined.</span>}
          </div>
        </Field>
        <Field label="Reveal to campaigns">
          <div className="flex flex-wrap gap-1.5">
            {eligibleCampaigns.map((c) => {
              const rev = revealed.includes(c.id);
              return (
                <button key={c.id} onClick={() => set({ revealedCampaignIds: rev ? revealed.filter((i) => i !== c.id) : [...revealed, c.id] })}
                  className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border', rev ? 'bg-primary text-primary-foreground border-primary font-bold' : 'border-gold/15 text-gold/45 hover:bg-gold/5')}>
                  {rev ? <Unlock className="w-3 h-3" /> : <Lock className="w-3 h-3" />}{c.name}
                </button>
              );
            })}
            {eligibleCampaigns.length === 0 && <span className="text-[10px] text-gold/25 italic">Link an era to choose campaigns.</span>}
          </div>
        </Field>
      </div>
    );
  };

  /* ── unified save: article + blocks ── */
  const handleSave = async () => {
    if (!formData.title?.trim()) { toast.error('A title is required.'); setSettingsOpen(true); return; }
    setSaving(true);
    const content = deriveContent(blocks);
    const now = new Date().toISOString();
    // Always persist against the real UUID — never the route token (which may be a slug).
    const articleId = realId || id || crypto.randomUUID();
    // Mentions (lore_links) key off the target article's UUID. Links/refs may use
    // the slug, so normalize slug → UUID via the loaded article list.
    const slugToId = new Map<string, string>(allArticles.map((a: any) => [a.slug, a.id]));
    const idSet = new Set<string>(allArticles.map((a: any) => a.id));
    const normalizeArticleId = (x: string) => (idSet.has(x) ? x : slugToId.get(x) ?? x);
    const linkedArticleIds = Array.from(new Set(
      [...extractLinkedIds(content), ...collectReferenceArticleIds(blocks)].map(normalizeArticleId),
    ));
    const payload = {
      ...formData,
      content,
      tags: formData.tags || [],
      linkedArticleIds,
      updatedAt: now,
      authorId: userProfile?.id,
      createdAt: formData.createdAt || now,
    };
    try {
      // Article row first (creates the row a new article's blocks FK-reference),
      // then the blocks (the PUT re-derives the same content mirror server-side).
      // Storyteller notes + secrets are `note`/`secret` blocks — no separate
      // dm_notes / lore_secrets writes.
      await upsertLoreArticle(articleId, payload);
      await saveLoreArticleBlocks(articleId, blocks);
      toast.success(id ? 'Article updated' : 'Article created');
      // Stay in the designer after saving. For a brand-new article, switch to its
      // edit route (now that it has an id) so subsequent saves update in place and
      // the Secrets section becomes available — without leaving the editor.
      if (!id) navigate(`/wiki/edit/${articleId}`, { replace: true });
    } catch (error) {
      console.error('Error saving lore article:', error);
      toast.error('Failed to save article');
    } finally {
      setSaving(false);
    }
  };

  const CategoryIcon = useMemo(
    () => CATEGORIES.find((c) => c.id === formData.category)?.icon || HelpCircle,
    [formData.category],
  );

  if (!isStaff) return <div className="text-center py-20 font-serif italic text-ink/65">Access Denied</div>;
  if (loading) return <div className="text-center py-20 font-serif italic">Loading the archives…</div>;

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col w-full px-3 sm:px-4 py-2 lg:py-3 gap-2">
      {/* Top bar */}
      <div className="flex items-center gap-3 shrink-0 pb-2 border-b border-gold/25">
        <Button variant="ghost" onClick={() => navigate(id ? `/wiki/article/${id}` : '/wiki')} className="text-ink/65 hover:text-gold gap-2 px-2">
          <ChevronLeft className="w-4 h-4" /> {id ? 'Back to Article' : 'Back to Wiki'}
        </Button>
        <button
          onClick={() => setSettingsOpen((o) => !o)}
          className="inline-flex items-center gap-1.5 px-2 h-8 text-xs rounded border border-gold/25 text-ink/65 hover:text-gold hover:bg-gold/5 transition-colors"
          title={settingsOpen ? 'Hide settings' : 'Show settings'}
        >
          {settingsOpen ? <PanelLeftClose className="w-3.5 h-3.5" /> : <PanelLeftOpen className="w-3.5 h-3.5" />} Settings
        </button>
        <div className="min-w-0 flex-1 flex items-center gap-2">
          <CategoryIcon className="w-4 h-4 text-gold shrink-0" />
          <h2 className="text-lg font-serif font-bold text-ink truncate">
            {id ? 'Edit Article' : 'New Article'}
            {formData.title ? <span className="text-ink/45 font-normal">· {formData.title}</span> : null}
          </h2>
        </div>
        <Button
          variant="outline"
          onClick={() => setForm({ status: formData.status === 'published' ? 'draft' : 'published' })}
          className={formData.status === 'published' ? 'border-gold text-gold bg-gold/5 gap-2' : 'text-ink/45 gap-2'}
        >
          {formData.status === 'published' ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
          {formData.status === 'published' ? 'Published' : 'Draft'}
        </Button>
        <Button onClick={handleSave} disabled={saving} className="btn-gold-solid gap-2">
          <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save Article'}
        </Button>
      </div>

      {/* Body: settings panel + block canvas */}
      <div className="flex-1 min-h-0 flex gap-2">
        {settingsOpen && (
          <aside className="w-[380px] shrink-0 overflow-y-auto custom-scrollbar border border-gold/25 bg-card/40 rounded">
            <div className="p-2 space-y-1.5">
              {/* Details */}
              <Section title="Details" icon={FileText} k="details" open={openSections.has('details')} onToggle={toggleSection}>
                <Field label="Title">
                  <Input value={formData.title} onChange={(e) => setForm({ title: e.target.value })} placeholder="The name of your subject…" className="field-input" />
                </Field>
                <Field label="Category">
                  <select value={formData.category} onChange={(e) => setForm({ category: e.target.value })} className="field-input w-full">
                    {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Folder / Sub-category">
                    <Input value={formData.folder || ''} onChange={(e) => setForm({ folder: e.target.value })} placeholder="e.g. Major Cities" className="field-input" />
                  </Field>
                  <Field label="Parent Article">
                    <select value={formData.parentId || ''} onChange={(e) => setForm({ parentId: e.target.value })} className="field-input w-full">
                      <option value="">None (Root)</option>
                      {allArticles.filter((a) => a.id !== id).map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
                    </select>
                  </Field>
                </div>
                <Field label="Excerpt">
                  <textarea value={formData.excerpt} onChange={(e) => setForm({ excerpt: e.target.value })} placeholder="A short summary for previews…" className="field-input w-full h-20 italic text-sm" />
                </Field>
              </Section>

              {/* Visibility */}
              <Section title="Visibility" icon={Globe} k="visibility" open={openSections.has('visibility')} onToggle={toggleSection}>
                <p className="field-hint">Leave empty to show to all players. Restrict by era or campaign.</p>
                <Field label="Era Scope">
                  <Popover>
                    <PopoverTrigger render={<div role="button" tabIndex={0} className="w-full flex items-start gap-2 min-h-9 px-3 py-2 rounded-md border border-gold/15 bg-background/60 hover:border-gold/35 transition-colors text-left select-none cursor-pointer" />}>
                      <Globe className="w-3.5 h-3.5 text-ink/35 mt-0.5 shrink-0" />
                      {(formData.visibilityEraIds?.length ?? 0) === 0 ? (
                        <span className="text-xs text-ink/35 italic">All eras (no restriction)</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {formData.visibilityEraIds.map((eId: string) => {
                            const era = eras.find((e: any) => e.id === eId);
                            return era ? (
                              <span key={eId} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gold/15 border border-gold/35 text-gold text-[10px] font-medium">
                                {era.name}
                                <button type="button" onClick={(e) => { e.stopPropagation(); setForm({ visibilityEraIds: formData.visibilityEraIds.filter((i: string) => i !== eId) }); }} className="hover:text-blood"><X className="w-2.5 h-2.5" /></button>
                              </span>
                            ) : null;
                          })}
                        </div>
                      )}
                    </PopoverTrigger>
                    <PopoverContent className="w-72 p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Search eras…" className="h-8" />
                        <CommandList className="max-h-48">
                          <CommandEmpty>No eras found.</CommandEmpty>
                          <CommandGroup>
                            {eras.map((era: any) => {
                              const selected = formData.visibilityEraIds?.includes(era.id);
                              return (
                                <CommandItem key={era.id} onSelect={() => {
                                  const curr = formData.visibilityEraIds || [];
                                  setForm({ visibilityEraIds: selected ? curr.filter((i: string) => i !== era.id) : [...curr, era.id] });
                                }} className="flex items-center gap-2 cursor-pointer">
                                  <div className={cn('w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0', selected ? 'bg-gold border-gold' : 'border-gold/35')}>
                                    {selected && <Check className="w-2.5 h-2.5 text-white" />}
                                  </div>
                                  <span className="text-xs">{era.name}</span>
                                </CommandItem>
                              );
                            })}
                            {eras.length === 0 && <CommandItem disabled>No eras defined yet</CommandItem>}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </Field>
                <Field label="Campaign Scope">
                  <Popover>
                    <PopoverTrigger render={<div role="button" tabIndex={0} className="w-full flex items-start gap-2 min-h-9 px-3 py-2 rounded-md border border-gold/15 bg-background/60 hover:border-gold/35 transition-colors text-left select-none cursor-pointer" />}>
                      <Shield className="w-3.5 h-3.5 text-ink/35 mt-0.5 shrink-0" />
                      {(formData.visibilityCampaignIds?.length ?? 0) === 0 ? (
                        <span className="text-xs text-ink/35 italic">All campaigns (no restriction)</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {formData.visibilityCampaignIds.map((cId: string) => {
                            const camp = campaigns.find((c: any) => c.id === cId);
                            return camp ? (
                              <span key={cId} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/15 border border-primary/30 text-primary text-[10px] font-medium">
                                {camp.name}
                                <button type="button" onClick={(e) => { e.stopPropagation(); setForm({ visibilityCampaignIds: formData.visibilityCampaignIds.filter((i: string) => i !== cId) }); }} className="hover:text-blood"><X className="w-2.5 h-2.5" /></button>
                              </span>
                            ) : null;
                          })}
                        </div>
                      )}
                    </PopoverTrigger>
                    <PopoverContent className="w-72 p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Search campaigns…" className="h-8" />
                        <CommandList className="max-h-48">
                          <CommandEmpty>No campaigns found.</CommandEmpty>
                          <CommandGroup>
                            {campaigns.map((camp: any) => {
                              const selected = formData.visibilityCampaignIds?.includes(camp.id);
                              return (
                                <CommandItem key={camp.id} onSelect={() => {
                                  const curr = formData.visibilityCampaignIds || [];
                                  setForm({ visibilityCampaignIds: selected ? curr.filter((i: string) => i !== camp.id) : [...curr, camp.id] });
                                }} className="flex items-center gap-2 cursor-pointer">
                                  <div className={cn('w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0', selected ? 'bg-primary border-primary' : 'border-primary/30')}>
                                    {selected && <Check className="w-2.5 h-2.5 text-white" />}
                                  </div>
                                  <span className="text-xs">{camp.name}</span>
                                </CommandItem>
                              );
                            })}
                            {campaigns.length === 0 && <CommandItem disabled>No campaigns defined yet</CommandItem>}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </Field>
              </Section>

              {/* Imagery */}
              <Section title="Imagery" icon={ImageIcon} k="imagery" open={openSections.has('imagery')} onToggle={toggleSection}>
                <ImageSetEditor
                  label="Article Header"
                  baseImage={formData.imageUrl || ''}
                  onBaseImageChange={(val) => setForm({ imageUrl: val })}
                  storagePath={`images/lore/${id || 'new'}`}
                  systemImages
                  controlsOnTop
                  windows={[
                    {
                      key: 'header', base: true,
                      label: 'Article Header', subtitle: 'Full article page',
                      aspectClass: 'aspect-[5/2]',
                      display: formData.imageDisplay || DEFAULT_DISPLAY,
                      onDisplayChange: (val) => setForm({ imageDisplay: val }),
                    },
                    {
                      key: 'card',
                      label: 'Wiki Card', subtitle: 'Wiki grid listing',
                      aspectClass: 'aspect-[4/5]',
                      imageUrl: formData.cardImageUrl || '',
                      onImageUrlChange: (val) => setForm({ cardImageUrl: val }),
                      display: formData.cardDisplay || DEFAULT_DISPLAY,
                      onDisplayChange: (val) => setForm({ cardDisplay: val }),
                    },
                    {
                      key: 'preview',
                      label: 'Hover Preview', subtitle: 'Quick-peek popover',
                      aspectClass: 'aspect-[5/2]',
                      imageUrl: formData.previewImageUrl || '',
                      onImageUrlChange: (val) => setForm({ previewImageUrl: val }),
                      display: formData.previewDisplay || DEFAULT_DISPLAY,
                      onDisplayChange: (val) => setForm({ previewDisplay: val }),
                    },
                  ]}
                />
              </Section>

              {/* Tags & Template */}
              <Section title="Tags & Template" icon={Tags} k="taxonomy" open={openSections.has('taxonomy')} onToggle={toggleSection}>
                {tagGroups.map((group) => {
                  const groupTags = allTags.filter((t) => t.groupId === group.id);
                  if (groupTags.length === 0) return null;
                  return (
                    <div key={group.id} className="space-y-1.5">
                      <label className="label-text text-ink/65 uppercase tracking-widest">{group.name}</label>
                      <div className="flex flex-wrap gap-1.5">
                        {groupTags.map((tag) => {
                          const isSelected = formData.tags?.includes(tag.id);
                          return (
                            <button key={tag.id} onClick={() => {
                              const newTags = isSelected ? (formData.tags || []).filter((i: string) => i !== tag.id) : [...(formData.tags || []), tag.id];
                              setForm({ tags: newTags });
                            }} className={cn('px-2 py-1 text-[10px] font-bold uppercase tracking-widest transition-colors border', isSelected ? 'bg-gold text-[var(--primary-foreground)] border-gold' : 'bg-background/50 text-ink/65 border-gold/25 hover:border-gold/55')}>
                              {tag.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                {tagGroups.length === 0 && <p className="field-hint italic">No lore tags defined.</p>}

                <TemplateFields category={formData.category} metadata={formData.metadata} setMeta={setMeta} />
              </Section>

              {/* Storyteller Notes are now authored inline as a staff-only
                  "Storyteller Note" block on the canvas (Add block → Storyteller
                  Note), so they can sit next to the content they annotate. */}

              {/* Secrets are now authored inline as "Secret" blocks on the canvas
                  (Add block → Secret), each with its own era links + per-campaign
                  reveal toggles in the block inspector. */}
            </div>
          </aside>
        )}

        {/* Block canvas */}
        <LayoutEditor
          embedded
          controlled={{ blocks, onBlocksChange: setBlocks }}
          allowedTypes={ARTICLE_BLOCK_TYPES}
          imageStoragePath={`images/lore/${id || 'new'}`}
          paneStorageKey="dauligor:loreArticleDesigner:panes:v1"
          renderPreview={(b) => <LayoutBlocks blocks={b} viewContext={{ isStaff: true }} />}
          renderInspectorExtras={renderInspectorExtras}
        />
      </div>
    </div>
  );
}

/* ════════════════════ settings panel pieces ════════════════════ */
function Section({ title, icon: Icon, k, open, onToggle, badge, children }: {
  title: string; icon: any; k: string; open: boolean; onToggle: (k: string) => void; badge?: string; children: React.ReactNode;
}) {
  return (
    <div className="border border-gold/15 rounded overflow-hidden bg-background/40">
      <button onClick={() => onToggle(k)} className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gold/5 transition-colors">
        <Icon className="w-3.5 h-3.5 text-gold shrink-0" />
        <span className="text-xs font-bold font-serif text-ink flex-1">{title}</span>
        {badge && <span className="text-[8px] font-black uppercase tracking-widest text-gold/65 border border-gold/25 rounded px-1 py-0.5">{badge}</span>}
        <ChevronDown className={cn('w-3.5 h-3.5 text-ink/35 transition-transform', !open && '-rotate-90')} />
      </button>
      {open && <div className="p-3 pt-1 space-y-3 border-t border-gold/15">{children}</div>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><label className="field-label">{label}</label>{children}</div>;
}

/** Category-specific metadata sub-form (character/deity, location, org/religion). */
function TemplateFields({ category, metadata, setMeta }: { category: string; metadata: any; setMeta: (p: Record<string, any>) => void }) {
  const text = (key: string, label: string, placeholder = '') => (
    <Field label={label}><Input value={metadata[key] || ''} onChange={(e) => setMeta({ [key]: e.target.value })} placeholder={placeholder} className="field-input h-8 text-xs" /></Field>
  );
  const isChar = category === 'character' || category === 'deity';
  const isLoc = ['building', 'settlement', 'geography', 'country'].includes(category);
  const isOrg = category === 'organization' || category === 'religion';
  if (!isChar && !isLoc && !isOrg) return null;
  return (
    <div className="pt-3 border-t border-gold/15 space-y-3">
      <p className="label-text text-gold">Template Data</p>
      {isChar && (<>
        <div className="grid grid-cols-2 gap-2">{text('race', 'Race')}{text('alignment', 'Alignment')}</div>
        {text('occupation', 'Occupation')}
        <div className="grid grid-cols-2 gap-2">{text('gender', 'Gender')}{text('pronouns', 'Pronouns')}</div>
        <Field label="Life Status">
          <select value={metadata.lifeStatus || 'Alive'} onChange={(e) => setMeta({ lifeStatus: e.target.value })} className="field-input w-full h-8 text-xs">
            <option value="Alive">Alive</option><option value="Dead">Dead</option><option value="Undead">Undead</option><option value="Unknown">Unknown</option>
          </select>
        </Field>
        {category === 'deity' && <>{text('domains', 'Domains')}{text('holySymbol', 'Holy Symbol')}</>}
      </>)}
      {isLoc && (<>
        {text('locationType', 'Type', 'City, Ruins, etc')}
        {text('parentLocation', 'Parent Location', 'Region, Continent…')}
        {text('ruler', 'Ruler / Owner')}
        {text('owningOrganization', 'Owning Organization')}
        <div className="grid grid-cols-2 gap-2">{text('population', 'Population')}{text('foundingDate', 'Founding Date')}</div>
      </>)}
      {isOrg && (<>
        {text('leader', 'Leader')}
        {text('headquarters', 'Headquarters')}
        {text('motto', 'Motto')}
        {category === 'religion' && <>{text('domains', 'Domains')}{text('holySymbol', 'Holy Symbol')}</>}
      </>)}
    </div>
  );
}
