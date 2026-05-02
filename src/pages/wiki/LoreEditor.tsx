import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useNavigate, useParams } from 'react-router-dom';
import { db, OperationType, handleFirestoreError } from '../../lib/firebase';
import { collection, doc, getDoc, setDoc, addDoc, updateDoc, getDocs, query, orderBy, deleteDoc, where, onSnapshot } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ClassImageEditor } from '@/components/compendium/ClassImageEditor';
import { ImageUpload } from '@/components/ui/ImageUpload';
import { 
  Users, MapPin, Sparkles, History, Shield, 
  Package, HelpCircle, ChevronLeft, Save, 
  Eye, EyeOff, Image as ImageIcon, Type,
  FileText, Tags, Info, BookOpen, Link as LinkIcon,
  Check, Library, Building, Flag, Sword, Zap, Mountain,
  Dna, Ship, Home, Biohazard, Swords, Scroll,
  Footprints, Languages, Coins, Layers, Flame,
  Scale, ListChecks, Hammer, Quote, Crown,
  Wand2, FlaskConical, Heart, Lock, Unlock, Plus, Trash2,
  Calendar, User, Globe, Landmark, Crosshair, ScrollText,
  Dna as SpeciesIcon, Anchor, Activity, Swords as ConflictIcon,
  FileCode, Languages as LangIcon, Gem, Layers as FormationIcon,
  Flame as MythIcon, Atom, ClipboardList, Hammer as ProfIcon,
  Quote as ProseIcon, Award, Sparkle, FlaskConical as TechIcon,
  Heart as TradIcon, BookOpen as SessionIcon, Edit, X
} from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import MarkdownEditor from '@/components/MarkdownEditor';

const CATEGORIES = [
  { id: 'generic', label: 'Generic', icon: Library, description: 'General world-building articles' },
  { id: 'building', label: 'Building', icon: Building, description: 'Structures, towers, and architecture' },
  { id: 'character', label: 'Character', icon: Users, description: 'People, NPCs, and historical figures' },
  { id: 'country', label: 'Country', icon: Flag, description: 'Nations, empires, and kingdoms' },
  { id: 'military', label: 'Military', icon: Sword, description: 'Armies, units, and military history' },
  { id: 'deity', label: 'God/Deity', icon: Zap, description: 'Gods, demigods, and divine beings' },
  { id: 'geography', label: 'Geography', icon: Mountain, description: 'Landscapes, mountains, and biomes' },
  { id: 'item', label: 'Item', icon: Package, description: 'Artifacts, equipment, and relics' },
  { id: 'organization', label: 'Organization', icon: Shield, description: 'Guilds, factions, and nations' },
  { id: 'religion', label: 'Religion', icon: Sparkles, description: 'Deities, cults, and holy orders' },
  { id: 'species', label: 'Species', icon: Dna, description: 'Races, creatures, and biological life' },
  { id: 'vehicle', label: 'Vehicle', icon: Ship, description: 'Ships, carriages, and transport' },
  { id: 'settlement', label: 'Settlement', icon: Home, description: 'Villages, towns, and cities' },
  { id: 'condition', label: 'Condition', icon: Biohazard, description: 'Diseases, curses, and states of being' },
  { id: 'conflict', label: 'Conflict', icon: Swords, description: 'Wars, battles, and duels' },
  { id: 'document', label: 'Document', icon: Scroll, description: 'Treaties, letters, and scrolls' },
  { id: 'culture', label: 'Culture / Ethnicity', icon: Footprints, description: 'Traditions, customs, and peoples' },
  { id: 'language', label: 'Language', icon: Languages, description: 'Dialects, scripts, and tongues' },
  { id: 'material', label: 'Material', icon: Coins, description: 'Metals, herbs, and resources' },
  { id: 'formation', label: 'Military Formation', icon: Layers, description: 'Tactical setups and unit structures' },
  { id: 'myth', label: 'Myth', icon: Flame, description: 'Legends, fables, and creation stories' },
  { id: 'law', label: 'Natural Law', icon: Scale, description: 'Physics, magic laws, and constants' },
  { id: 'plot', label: 'Plot', icon: ListChecks, description: 'Quests, storylines, and arcs' },
  { id: 'profession', label: 'Profession', icon: Hammer, description: 'Jobs, crafts, and trades' },
  { id: 'prose', label: 'Prose', icon: Quote, description: 'Stories, poems, and excerpts' },
  { id: 'title', label: 'Title', icon: Crown, description: 'Ranks, honors, and positions' },
  { id: 'spell', label: 'Spell', icon: Wand2, description: 'Magic, rituals, and incantations' },
  { id: 'technology', label: 'Technology', icon: FlaskConical, description: 'Inventions, alchemy, and science' },
  { id: 'tradition', label: 'Tradition', icon: Heart, description: 'Holidays, rites, and social norms' },
  { id: 'session', label: 'Session Report', icon: BookOpen, description: 'Records of campaign sessions' },
];

export default function LoreEditor({ userProfile }: { userProfile: any }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const [loading, setLoading] = useState(id ? true : false);
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState(id ? 'edit' : 'select');
  const [allArticles, setAllArticles] = useState<any[]>([]);
  const [suggestionOpen, setSuggestionOpen] = useState(false);
  const [suggestionSearch, setSuggestionSearch] = useState('');
  const [cursorPos, setCursorPos] = useState({ top: 0, left: 0 });
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [eras, setEras] = useState<any[]>([]);
  const [dmNotes, setDmNotes] = useState('');
  const [secrets, setSecrets] = useState<any[]>([]);
  const [newSecret, setNewSecret] = useState({ content: '', eraIds: [] as string[] });
  const [editingSecretId, setEditingSecretId] = useState<string | null>(null);
  const [editSecretData, setEditSecretData] = useState({ content: '', eraIds: [] as string[] });
  
  const [tagGroups, setTagGroups] = useState<any[]>([]);
  const [allTags, setAllTags] = useState<any[]>([]);

  const [formData, setFormData] = useState<any>({
    title: '',
    excerpt: '',
    content: '',
    category: 'generic',
    folder: '',
    parentId: '',
    status: 'draft',
    imageUrl: '',
    imageDisplay: null,
    cardImageUrl: '',
    cardDisplay: null,
    previewImageUrl: '',
    previewDisplay: null,
    tags: [] as string[],
    visibilityEraIds: [] as string[],
    visibilityCampaignIds: [] as string[],
    metadata: {
      age: '',
      race: '',
      alignment: '',
      occupation: '',
      lifeStatus: 'Alive',
      gender: '',
      pronouns: '',
      birthDate: '',
      deathDate: '',
      locationType: '',
      population: '',
      climate: '',
      ruler: '',
      foundingDate: '',
      parentLocation: '',
      owningOrganization: '',
      domains: '',
      holySymbol: '',
      motto: '',
      headquarters: '',
      leader: ''
    }
  });

  const isStaff = userProfile?.role === 'admin' || userProfile?.role === 'co-dm' || userProfile?.role === 'lore-writer';

  useEffect(() => {
    if (!isStaff) return;

    const fetchCampaigns = async () => {
      try {
        const q = query(collection(db, 'campaigns'), orderBy('name'));
        const snap = await getDocs(q);
        setCampaigns(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      } catch (error) {
        console.error("Failed to fetch campaigns:", error);
      }
    };
    fetchCampaigns();

    const fetchEras = async () => {
      try {
        const q = query(collection(db, 'eras'), orderBy('order', 'asc'));
        const snap = await getDocs(q);
        setEras(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      } catch (error) {
        console.error("Failed to fetch eras:", error);
      }
    };
    fetchEras();
    const fetchAllArticles = async () => {
      try {
        const q = query(collection(db, 'lore'), orderBy('title'));
        const snap = await getDocs(q);
        setAllArticles(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      } catch (error) {
        console.error("Failed to fetch articles for linking:", error);
      }
    };
    fetchAllArticles();

    const unsubscribeTagGroups = onSnapshot(query(collection(db, 'tagGroups'), where('classifications', 'array-contains', 'lore')), (snap) => {
      setTagGroups(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    const unsubscribeTags = onSnapshot(collection(db, 'tags'), (snap) => {
      setAllTags(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    if (id) {
      const fetchPage = async () => {
        try {
          const docRef = doc(db, 'lore', id);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            const data = docSnap.data();
            setFormData({
              ...data,
              tags: Array.isArray(data.tags) ? data.tags : [],
              metadata: {
                ...formData.metadata,
                ...(data.metadata || {})
              }
            });

            // Fetch DM Notes
            const notesRef = doc(db, 'lore', id, 'dmData', 'notes');
            const notesSnap = await getDoc(notesRef);
            if (notesSnap.exists()) {
              setDmNotes(notesSnap.data().content);
            }

            // Fetch Secrets
            const secretsRef = collection(db, 'lore', id, 'secrets');
            const secretsSnap = await getDocs(secretsRef);
            setSecrets(secretsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, `lore/${id}`);
        } finally {
          setLoading(false);
        }
      };
      fetchPage();
    }

    return () => {
      unsubscribeTagGroups();
      unsubscribeTags();
    };
  }, [id, isStaff]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey && e.code === 'Space') {
      e.preventDefault();
      const textarea = contentRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const selectedText = textarea.value.substring(start, end);

      setSuggestionSearch(selectedText);
      
      // Basic position estimation (not perfect for textareas but works for a simple overlay)
      const rect = textarea.getBoundingClientRect();
      setCursorPos({ 
        top: rect.top + (textarea.scrollHeight > textarea.clientHeight ? 0 : 20), 
        left: rect.left + 20 
      });
      
      setSuggestionOpen(true);
    }
  };

  const insertLink = (article: any) => {
    const textarea = contentRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const selectedText = text.substring(start, end) || article.title;
    
    const before = text.substring(0, start);
    const after = text.substring(end);
    const link = `[${selectedText}](/wiki/article/${article.id})`;
    
    const newValue = before + link + after;
    setFormData({ ...formData, content: newValue });
    setSuggestionOpen(false);
    
    // Set focus back and move cursor
    setTimeout(() => {
      textarea.focus();
      const newPos = start + link.length;
      textarea.setSelectionRange(newPos, newPos);
    }, 0);
  };

  const handleAddSecret = async () => {
    if (!id) {
      toast.error('Please save the article first before adding secrets.');
      return;
    }
    if (!newSecret.content || newSecret.eraIds.length === 0) {
      toast.error('Please provide content and at least one Era.');
      return;
    }

    try {
      const secretsRef = collection(db, 'lore', id, 'secrets');
      const secretData = {
        ...newSecret,
        revealedCampaignIds: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      const docRef = await addDoc(secretsRef, secretData);
      setSecrets([...secrets, { id: docRef.id, ...secretData }]);
      setNewSecret({ content: '', eraIds: [] });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `lore/${id}/secrets`);
    }
  };

  const handleSaveSecret = async (secretId: string) => {
    if (!id) return;
    if (!editSecretData.content || editSecretData.eraIds.length === 0) {
      toast.error('Please provide content and at least one Era.');
      return;
    }

    try {
      const secretRef = doc(db, 'lore', id, 'secrets', secretId);
      await updateDoc(secretRef, {
        ...editSecretData,
        updatedAt: new Date().toISOString()
      });
      setSecrets(secrets.map(s => s.id === secretId ? { ...s, ...editSecretData } : s));
      setEditingSecretId(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `lore/${id}/secrets`);
    }
  };

  const handleDeleteSecret = async (secretId: string) => {
    if (!id) return;
    try {
      await deleteDoc(doc(db, 'lore', id, 'secrets', secretId));
      setSecrets(secrets.filter(s => s.id !== secretId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `lore/${id}/secrets`);
    }
  };

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
      setSecrets(secrets.map(s => s.id === secret.id ? { ...s, revealedCampaignIds: newRevealed } : s));
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `lore/${id}/secrets`);
    }
  };
  const handleSave = async () => {
    if (!formData.title || !formData.content) {
      toast.error('Title and Content are required.');
      return;
    }

    // Extract linked article IDs from content
    const linkRegex = /\[url=\/wiki\/article\/([^\]]+)\]/gi;
    const linkedIds = new Set<string>();
    let match;
    while ((match = linkRegex.exec(formData.content)) !== null) {
      linkedIds.add(match[1]);
    }
    // Also check standard markdown links
    const mdLinkRegex = /\]\(\/wiki\/article\/([^\)]+)\)/gi;
    while ((match = mdLinkRegex.exec(formData.content)) !== null) {
      linkedIds.add(match[1]);
    }

    setSaving(true);
    const payload = {
      ...formData,
      tags: formData.tags || [],
      linkedArticleIds: Array.from(linkedIds),
      updatedAt: new Date().toISOString(),
      authorId: userProfile?.uid,
      createdAt: formData.createdAt || new Date().toISOString()
    };

    try {
      let articleId = id;
      if (id) {
        await updateDoc(doc(db, 'lore', id), payload);
      } else {
        const docRef = await addDoc(collection(db, 'lore'), payload);
        articleId = docRef.id;
      }

      // Save DM Notes
      if (articleId) {
        const notesRef = doc(db, 'lore', articleId, 'dmData', 'notes');
        await setDoc(notesRef, { 
          content: dmNotes,
          updatedAt: new Date().toISOString()
        });
      }

      if (!id && articleId) {
        navigate(`/wiki/article/${articleId}`);
        return;
      }
      navigate(`/wiki/article/${id}`);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'lore');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="text-center py-20 font-serif italic">Loading the archives...</div>;

  if (!isStaff) {
    return <div className="text-center py-20 font-serif italic">Access Denied</div>;
  }

  if (step === 'select') {
    return (
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="text-center space-y-2">
          <h1 className="h1-title">What are you chronicling?</h1>
          <p className="description-text">Select a template to begin your entry.</p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => {
                setFormData({ ...formData, category: cat.id });
                setStep('edit');
              }}
              className="group p-6 rounded-xl border border-gold/10 bg-card hover:border-gold/40 hover:bg-gold/5 transition-all text-left space-y-4"
            >
              <div className="w-12 h-12 rounded-lg bg-gold/10 flex items-center justify-center text-gold group-hover:scale-110 transition-transform">
                <cat.icon className="w-6 h-6" />
              </div>
              <div>
                <h3 className="h3-title">{cat.label}</h3>
                <p className="description-text text-sm">{cat.description}</p>
              </div>
            </button>
          ))}
        </div>

        <div className="flex justify-center pt-8">
          <Button variant="ghost" onClick={() => navigate('/wiki')} className="text-ink/40">
            <ChevronLeft className="w-4 h-4 mr-2" /> Back to Wiki
          </Button>
        </div>
      </div>
    );
  }

  const CategoryIcon = CATEGORIES.find(c => c.id === formData.category)?.icon || HelpCircle;

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-20">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => id ? navigate(`/wiki/article/${id}`) : setStep('select')}>
            <ChevronLeft className="w-5 h-5" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <CategoryIcon className="w-4 h-4 text-gold" />
              <span className="label-text text-gold">{formData.category}</span>
            </div>
            <h1 className="h2-title">{id ? 'Edit Article' : 'New Article'}</h1>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button 
            variant="outline" 
            onClick={() => setFormData({ ...formData, status: formData.status === 'published' ? 'draft' : 'published' })}
            className={formData.status === 'draft' ? 'border-gold text-gold bg-gold/5' : 'text-ink/40'}
          >
            {formData.status === 'published' ? <Eye className="w-4 h-4 mr-2" /> : <EyeOff className="w-4 h-4 mr-2" />}
            {formData.status === 'published' ? 'Published' : 'Draft'}
          </Button>
          <Button onClick={handleSave} disabled={saving} className="bg-gold text-white gap-2">
            <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save Article'}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="content" className="space-y-6">
        <TabsList className="bg-gold/5 border border-gold/10 p-1 flex overflow-x-auto custom-scrollbar">
          <TabsTrigger value="content" className="data-[state=active]:bg-gold/20 data-[state=active]:text-gold">Content</TabsTrigger>
          <TabsTrigger value="metadata" className="data-[state=active]:bg-gold/20 data-[state=active]:text-gold">Metadata</TabsTrigger>
          <TabsTrigger value="notes" className="data-[state=active]:bg-gold/20 data-[state=active]:text-gold">Storyteller Notes</TabsTrigger>
          <TabsTrigger value="secrets" className="data-[state=active]:bg-gold/20 data-[state=active]:text-gold">Secrets</TabsTrigger>
        </TabsList>

        <TabsContent value="content" className="space-y-6">
          <Card className="border-gold/10">
            <CardContent className="p-6 space-y-6">
              <div className="space-y-2">
                <label className="label-text text-ink/40 flex items-center gap-2">
                  <Type className="w-3 h-3" /> Article Title
                </label>
                <Input 
                  value={formData.title} 
                  onChange={e => setFormData({ ...formData, title: e.target.value })}
                  placeholder="The name of your subject..."
                  className="h3-title h-14 border-gold/10 focus:border-gold"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="label-text text-ink/40 flex items-center gap-2">
                    <Library className="w-3 h-3" /> Folder / Sub-category
                  </label>
                  <Input 
                    value={formData.folder || ''} 
                    onChange={e => setFormData({ ...formData, folder: e.target.value })}
                    placeholder="e.g. Major Cities, NPCs - Allies"
                    className="border-gold/10 focus:border-gold"
                  />
                </div>
                <div className="space-y-2">
                  <label className="label-text text-ink/40 flex items-center gap-2">
                    <LinkIcon className="w-3 h-3" /> Parent Article
                  </label>
                  <select 
                    value={formData.parentId || ''}
                    onChange={e => setFormData({ ...formData, parentId: e.target.value })}
                    className="flex h-10 w-full rounded-md border border-gold/10 bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="">None (Root Article)</option>
                    {allArticles.filter(a => a.id !== id).map(article => (
                      <option key={article.id} value={article.id}>{article.title}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <label className="label-text text-ink/40 flex items-center gap-2">
                  <FileText className="w-3 h-3" /> Excerpt
                </label>
                <textarea 
                  value={formData.excerpt} 
                  onChange={e => setFormData({ ...formData, excerpt: e.target.value })}
                  placeholder="A short summary for previews..."
                  className="w-full h-20 p-3 rounded-md border border-gold/10 bg-background description-text text-sm italic"
                />
              </div>

              <div className="relative">
                <MarkdownEditor 
                  textareaRef={contentRef}
                  value={formData.content} 
                  onChange={(val) => setFormData({ ...formData, content: val })}
                  onKeyDown={handleKeyDown}
                  placeholder="Write the history, details, and stories here..."
                  minHeight="300px"
                  label="Main Content (Markdown)"
                />

                {suggestionOpen && (
                  <div className="absolute top-8 left-0 z-50 w-64 bg-card border border-gold/20 rounded-md shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
                    <Command className="bg-transparent">
                      <CommandInput 
                        placeholder="Search articles..." 
                        value={suggestionSearch}
                        onValueChange={setSuggestionSearch}
                        className="h-9 border-none focus:ring-0"
                        autoFocus
                      />
                      <CommandList className="max-h-[200px]">
                        <CommandEmpty>No articles found.</CommandEmpty>
                        <CommandGroup heading="Suggestions">
                          {allArticles
                            .filter(a => 
                              a.title.toLowerCase().includes(suggestionSearch.toLowerCase()) || 
                              a.tags?.some((t: string) => t.toLowerCase().includes(suggestionSearch.toLowerCase()))
                            )
                            .slice(0, 5)
                            .map(article => (
                              <CommandItem
                                key={article.id}
                                onSelect={() => insertLink(article)}
                                className="cursor-pointer hover:bg-gold/5 flex items-center gap-2 p-2"
                              >
                                <LinkIcon className="w-3 h-3 text-gold" />
                                <div className="flex flex-col">
                                  <span className="text-xs font-medium">{article.title}</span>
                                  <span className="text-[10px] text-ink/40 capitalize">{article.category}</span>
                                </div>
                              </CommandItem>
                            ))
                          }
                        </CommandGroup>
                      </CommandList>
                    </Command>
                    <div className="p-1 border-t border-gold/10 bg-gold/5 flex justify-end">
                      <Button variant="ghost" size="xs" onClick={() => setSuggestionOpen(false)} className="h-6 text-[10px]">Cancel</Button>
                    </div>
                  </div>
                )}
              </div>

              {/* Editor hints row */}
              <div className="flex items-center justify-between flex-wrap gap-2 pt-1">
                <span className="text-[10px] text-ink/30 flex items-center gap-1">
                  <LinkIcon className="w-2.5 h-2.5" />
                  Press <kbd className="mx-1 px-1.5 py-0.5 text-[9px] bg-ink/5 border border-ink/10 rounded font-mono">Ctrl+Space</kbd> inside the editor to insert an article link
                </span>
                <Popover>
                  <PopoverTrigger asChild>
                    <span role="button" tabIndex={0} className="inline-flex items-center justify-center rounded-lg border bg-background hover:bg-muted h-6 gap-1 px-2 border-gold/20 text-gold/60 hover:text-gold text-[10px] gap-1.5 transition-all select-none cursor-pointer">
                      <Globe className="w-2.5 h-2.5" /> Insert Era/Campaign Block
                    </span>
                  </PopoverTrigger>
                  <PopoverContent className="w-72 p-3 space-y-3" align="end">
                    <p className="label-text text-[10px] text-ink/40">Wraps selected text in a conditional block. Only players in the matching era/campaign will see this content.</p>
                    {eras.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-[9px] uppercase font-bold tracking-widest text-gold/50">Era Blocks</p>
                        <div className="flex flex-wrap gap-1.5">
                          {eras.map((era: any) => (
                            <button key={era.id} type="button"
                              className="px-2 py-1 rounded border border-gold/20 text-[10px] text-ink/70 hover:bg-gold/10 hover:text-gold transition-colors"
                              onClick={() => {
                                const textarea = contentRef.current;
                                if (!textarea) return;
                                const start = textarea.selectionStart, end = textarea.selectionEnd;
                                const selected = textarea.value.substring(start, end) || 'Content visible in this era...';
                                const tag = `[era id="${era.id}"]\n${selected}\n[/era]`;
                                setFormData({ ...formData, content: textarea.value.substring(0, start) + tag + textarea.value.substring(end) });
                              }}
                            >{era.name}</button>
                          ))}
                        </div>
                      </div>
                    )}
                    {campaigns.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-[9px] uppercase font-bold tracking-widest text-primary/50">Campaign Blocks</p>
                        <div className="flex flex-wrap gap-1.5">
                          {campaigns.map((camp: any) => (
                            <button key={camp.id} type="button"
                              className="px-2 py-1 rounded border border-primary/20 text-[10px] text-ink/70 hover:bg-primary/10 hover:text-primary transition-colors"
                              onClick={() => {
                                const textarea = contentRef.current;
                                if (!textarea) return;
                                const start = textarea.selectionStart, end = textarea.selectionEnd;
                                const selected = textarea.value.substring(start, end) || 'Content visible in this campaign...';
                                const tag = `[campaign id="${camp.id}"]\n${selected}\n[/campaign]`;
                                setFormData({ ...formData, content: textarea.value.substring(0, start) + tag + textarea.value.substring(end) });
                              }}
                            >{camp.name}</button>
                          ))}
                        </div>
                      </div>
                    )}
                  </PopoverContent>
                </Popover>
              </div>

            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notes" className="space-y-6">
          <Card className="border-gold/10">
            <CardContent className="p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="label-text text-gold flex items-center gap-2">
                    <Lock className="w-4 h-4" /> Storyteller Notes (Private)
                  </h2>
                  <Badge variant="outline" className="border-gold/20 text-gold/60 text-[10px]">STAFF ONLY</Badge>
                </div>
                <MarkdownEditor 
                  textareaRef={notesRef}
                  value={dmNotes} 
                  onChange={setDmNotes}
                  placeholder="General info for DMs, plot hooks, or background details..."
                  minHeight="120px"
                  className="bg-gold/5"
                  label="DM Notes"
                />

              {/* Secrets Section */}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="secrets" className="space-y-6">
          <Card className="border-gold/10">
            <CardContent className="p-6 space-y-6">
                <div className="flex items-center justify-between">
                  <h2 className="label-text text-gold flex items-center gap-2">
                    <Sparkles className="w-4 h-4" /> Secrets & Revelations
                  </h2>
                  <Badge variant="outline" className="border-gold/20 text-gold/60 text-[10px]">CAMPAIGN SPECIFIC</Badge>
                </div>

                <div className="space-y-4">
                  {secrets.map((secret) => {
                    const isEditing = editingSecretId === secret.id;
                    const linkedEras = eras.filter(e => (isEditing ? editSecretData.eraIds : secret.eraIds).includes(e.id));
                    const eligibleCampaigns = campaigns.filter(c => (isEditing ? editSecretData.eraIds : secret.eraIds).includes(c.eraId));
                    
                    return (
                      <div key={secret.id} className="p-4 rounded-lg border border-gold/10 bg-gold/5 space-y-4">
                        <div className="flex items-center justify-between">
                          <div className="flex flex-wrap gap-1">
                            {isEditing ? (
                              eras.map(era => {
                                const isSelected = editSecretData.eraIds.includes(era.id);
                                return (
                                  <Button
                                    key={era.id}
                                    variant="outline"
                                    size="xs"
                                    onClick={() => {
                                      const newEraIds = isSelected
                                        ? editSecretData.eraIds.filter(id => id !== era.id)
                                        : [...editSecretData.eraIds, era.id];
                                      setEditSecretData({ ...editSecretData, eraIds: newEraIds });
                                    }}
                                    className={`h-7 text-[10px] transition-all duration-200 ${isSelected ? 'bg-primary text-primary-foreground border-primary shadow-md scale-105 z-10 font-bold ring-2 ring-primary/20' : 'border-primary/20 text-primary/60 hover:bg-primary/5'}`}
                                  >
                                    {era.name}
                                  </Button>
                                );
                              })
                            ) : (
                              linkedEras.map(era => (
                                <Badge key={era.id} variant="outline" className="bg-primary/10 text-primary border-primary/20 text-[10px]">
                                  {era.name}
                                </Badge>
                              ))
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {isEditing ? (
                              <>
                                <Button variant="ghost" size="sm" onClick={() => setEditingSecretId(null)} className="h-8 text-xs text-ink/40">Cancel</Button>
                                <Button size="sm" onClick={() => handleSaveSecret(secret.id)} className="h-8 bg-primary text-primary-foreground text-xs">Save</Button>
                              </>
                            ) : (
                              <>
                                <Button variant="ghost" size="icon" onClick={() => {
                                  setEditingSecretId(secret.id);
                                  setEditSecretData({ content: secret.content, eraIds: secret.eraIds });
                                }} className="h-6 w-6 text-gold/40 hover:text-gold">
                                  <Edit className="w-3 h-3" />
                                </Button>
                                <Button variant="ghost" size="icon" onClick={() => handleDeleteSecret(secret.id)} className="h-6 w-6 text-blood/40 hover:text-blood">
                                  <Trash2 className="w-3 h-3" />
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                        
                        {isEditing ? (
                          <textarea 
                            value={editSecretData.content} 
                            onChange={e => setEditSecretData({...editSecretData, content: e.target.value})}
                            placeholder="What is the secret?"
                            className="w-full h-24 p-3 rounded-md border border-gold/10 bg-background description-text text-sm italic focus:ring-1 focus:ring-gold/20 outline-none"
                          />
                        ) : (
                          <p className="description-text text-sm italic">"{secret.content}"</p>
                        )}

                        {!isEditing && (
                          <div className="pt-2 border-t border-gold/10">
                            <p className="label-text text-gold/40 mb-2">Reveal to Campaigns</p>
                            <div className="flex flex-wrap gap-2">
                              {eligibleCampaigns.map(campaign => {
                                const isRevealed = secret.revealedCampaignIds.includes(campaign.id);
                                return (
                                  <Button
                                    key={campaign.id}
                                    variant="outline"
                                    size="xs"
                                    onClick={() => handleToggleSecretReveal(secret, campaign.id)}
                                    className={`h-7 text-[10px] gap-1 transition-all duration-200 ${isRevealed ? 'bg-primary text-primary-foreground border-primary shadow-md scale-105 z-10 font-bold ring-2 ring-primary/20' : 'border-gold/10 text-gold/40 hover:bg-gold/5'}`}
                                  >
                                    {isRevealed ? <Unlock className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                                    {campaign.name}
                                  </Button>
                                );
                              })}
                              {eligibleCampaigns.length === 0 && (
                                <span className="text-[10px] text-gold/20 italic">No campaigns found for these Eras.</span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  <div className="p-4 rounded-lg border border-dashed border-gold/20 space-y-4">
                    <p className="label-text text-gold/60">Add New Secret</p>
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <label className="label-text text-ink/40">Link to Eras</label>
                        <div className="flex flex-wrap gap-2">
                          {eras.map(era => {
                            const isSelected = newSecret.eraIds.includes(era.id);
                            return (
                              <Button
                                key={era.id}
                                variant="outline"
                                size="xs"
                                onClick={() => {
                                  const newEraIds = isSelected
                                    ? newSecret.eraIds.filter(id => id !== era.id)
                                    : [...newSecret.eraIds, era.id];
                                  setNewSecret({ ...newSecret, eraIds: newEraIds });
                                }}
                                className={`h-7 text-[10px] transition-all duration-200 ${isSelected ? 'bg-primary text-primary-foreground border-primary shadow-md scale-105 z-10 font-bold ring-2 ring-primary/20' : 'border-gold/20 text-gold/60 hover:bg-gold/5'}`}
                              >
                                {era.name}
                              </Button>
                            );
                          })}
                        </div>
                      </div>
                      
                      <div className="space-y-2">
                        <label className="label-text text-ink/40">Secret Content</label>
                        <textarea 
                          value={newSecret.content} 
                          onChange={e => setNewSecret({...newSecret, content: e.target.value})}
                          placeholder="What is the secret?"
                          className="w-full h-24 p-3 rounded-md border border-gold/10 bg-background description-text text-sm italic focus:ring-1 focus:ring-gold/20 outline-none"
                        />
                        <div className="flex justify-end">
                          <Button onClick={handleAddSecret} size="sm" className="h-8 bg-primary text-primary-foreground">
                            <Plus className="w-3 h-3 mr-1" /> Add Secret
                          </Button>
                        </div>
                      </div>
                    </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="metadata" className="space-y-6">

          {/* Visibility Scope */}
          <Card className="border-gold/10 bg-card/60">
            <CardHeader className="pb-2">
              <CardTitle className="label-text text-gold flex items-center gap-2">
                <Globe className="w-4 h-4" /> Visibility Scope
              </CardTitle>
              <p className="text-xs text-ink/40 mt-0.5">
                Leave empty to show this article to all players. Select eras or campaigns to restrict access.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">

              {/* Era Scope — searchable multi-select */}
              <div className="space-y-2">
                <label className="label-text text-xs text-ink/50 flex items-center gap-1.5">
                  <Globe className="w-3 h-3" /> Era Scope
                  <span className="font-normal text-ink/30">— visible to campaigns in these eras</span>
                </label>
                <Popover>
                  <PopoverTrigger asChild>
                    <div role="button" tabIndex={0} className="w-full flex items-start gap-2 min-h-9 px-3 py-2 rounded-md border border-gold/10 bg-background/60 hover:border-gold/30 transition-colors text-left select-none cursor-pointer">
                      <Globe className="w-3.5 h-3.5 text-ink/30 mt-0.5 shrink-0" />
                      {(formData.visibilityEraIds?.length ?? 0) === 0 ? (
                        <span className="text-xs text-ink/30 italic">All eras (no restriction)</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {formData.visibilityEraIds.map((eId: string) => {
                            const era = eras.find((e: any) => e.id === eId);
                            return era ? (
                              <span key={eId} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gold/15 border border-gold/30 text-gold text-[10px] font-medium">
                                {era.name}
                                <button type="button" onClick={(e) => { e.stopPropagation(); setFormData({ ...formData, visibilityEraIds: formData.visibilityEraIds.filter((i: string) => i !== eId) }); }} className="hover:text-blood">
                                  <X className="w-2.5 h-2.5" />
                                </button>
                              </span>
                            ) : null;
                          })}
                        </div>
                      )}
                    </div>
                  </PopoverTrigger>
                  <PopoverContent className="w-72 p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search eras..." className="h-8" />
                      <CommandList className="max-h-48">
                        <CommandEmpty>No eras found.</CommandEmpty>
                        <CommandGroup>
                          {eras.map((era: any) => {
                            const selected = formData.visibilityEraIds?.includes(era.id);
                            return (
                              <CommandItem key={era.id} onSelect={() => {
                                const curr = formData.visibilityEraIds || [];
                                setFormData({ ...formData, visibilityEraIds: selected ? curr.filter((i: string) => i !== era.id) : [...curr, era.id] });
                              }} className="flex items-center gap-2 cursor-pointer">
                                <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${selected ? 'bg-gold border-gold' : 'border-gold/30'}`}>
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
              </div>

              {/* Campaign Scope — searchable multi-select */}
              <div className="space-y-2">
                <label className="label-text text-xs text-ink/50 flex items-center gap-1.5">
                  <Shield className="w-3 h-3" /> Campaign Scope
                  <span className="font-normal text-ink/30">— visible only to these campaigns</span>
                </label>
                <Popover>
                  <PopoverTrigger asChild>
                    <div role="button" tabIndex={0} className="w-full flex items-start gap-2 min-h-9 px-3 py-2 rounded-md border border-gold/10 bg-background/60 hover:border-gold/30 transition-colors text-left select-none cursor-pointer">
                      <Shield className="w-3.5 h-3.5 text-ink/30 mt-0.5 shrink-0" />
                      {(formData.visibilityCampaignIds?.length ?? 0) === 0 ? (
                        <span className="text-xs text-ink/30 italic">All campaigns (no restriction)</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {formData.visibilityCampaignIds.map((cId: string) => {
                            const camp = campaigns.find((c: any) => c.id === cId);
                            return camp ? (
                              <span key={cId} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/15 border border-primary/30 text-primary text-[10px] font-medium">
                                {camp.name}
                                <button type="button" onClick={(e) => { e.stopPropagation(); setFormData({ ...formData, visibilityCampaignIds: formData.visibilityCampaignIds.filter((i: string) => i !== cId) }); }} className="hover:text-blood">
                                  <X className="w-2.5 h-2.5" />
                                </button>
                              </span>
                            ) : null;
                          })}
                        </div>
                      )}
                    </div>
                  </PopoverTrigger>
                  <PopoverContent className="w-72 p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search campaigns..." className="h-8" />
                      <CommandList className="max-h-48">
                        <CommandEmpty>No campaigns found.</CommandEmpty>
                        <CommandGroup>
                          {campaigns.map((camp: any) => {
                            const selected = formData.visibilityCampaignIds?.includes(camp.id);
                            return (
                              <CommandItem key={camp.id} onSelect={() => {
                                const curr = formData.visibilityCampaignIds || [];
                                setFormData({ ...formData, visibilityCampaignIds: selected ? curr.filter((i: string) => i !== camp.id) : [...curr, camp.id] });
                              }} className="flex items-center gap-2 cursor-pointer">
                                <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${selected ? 'bg-primary border-primary' : 'border-primary/30'}`}>
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
              </div>

              {/* Summary banner */}
              {(formData.visibilityEraIds?.length > 0 || formData.visibilityCampaignIds?.length > 0) && (
                <div className="text-xs bg-gold/5 border border-gold/10 rounded-md px-3 py-2 text-ink/60 flex items-start gap-2">
                  <Eye className="w-3 h-3 text-gold mt-0.5 shrink-0" />
                  <span>
                    {formData.visibilityCampaignIds?.length > 0
                      ? `Campaign-restricted — visible to ${formData.visibilityCampaignIds.length} campaign(s).`
                      : `Era-restricted — visible in ${formData.visibilityEraIds.length} era(s).`}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-gold/10 bg-card/60">
            <CardHeader className="pb-2">
              <CardTitle className="label-text text-gold flex items-center gap-2">
                <ImageIcon className="w-4 h-4" /> Article Images
              </CardTitle>
              <p className="text-xs text-ink/40 mt-0.5">Adjust how each image is cropped and positioned across different views.</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-background/60 rounded-lg border border-gold/10 overflow-hidden p-4">
                <ClassImageEditor
                  imageUrl={formData.imageUrl || ''}
                  onImageUrlChange={(val) => setFormData({...formData, imageUrl: val})}
                  imageDisplay={formData.imageDisplay}
                  onImageDisplayChange={(val) => setFormData({...formData, imageDisplay: val})}
                  cardImageUrl={formData.cardImageUrl || ''}
                  onCardImageUrlChange={(val) => setFormData({...formData, cardImageUrl: val})}
                  cardDisplay={formData.cardDisplay}
                  onCardDisplayChange={(val) => setFormData({...formData, cardDisplay: val})}
                  previewImageUrl={formData.previewImageUrl || ''}
                  onPreviewImageUrlChange={(val) => setFormData({...formData, previewImageUrl: val})}
                  previewDisplay={formData.previewDisplay}
                  onPreviewDisplayChange={(val) => setFormData({...formData, previewDisplay: val})}
                  storagePath={`images/lore/${id || 'new'}`}
                  panelLabels={{
                    detail:  { label: 'Article Header', subtitle: 'Full article page' },
                    card:    { label: 'Wiki Card',       subtitle: 'Wiki grid listing' },
                    preview: { label: 'Hover Preview',  subtitle: 'Quick-peek popover' },
                  }}
                />
              </div>

              <div className="space-y-6 pt-4 border-t border-gold/10">
                <label className="label-text text-ink/40 flex items-center gap-2 mb-2">
                  <Tags className="w-3 h-3" /> Lore Tags
                </label>
                {tagGroups.map(group => {
                  const groupTags = allTags.filter(t => t.groupId === group.id);
                  if (groupTags.length === 0) return null;

                  return (
                    <div key={group.id} className="space-y-2">
                      <label className="label-text text-ink/60 uppercase tracking-widest">{group.name}</label>
                      <div className="flex flex-wrap gap-1.5">
                        {groupTags.map(tag => {
                          const isSelected = formData.tags?.includes(tag.id);
                          return (
                            <button
                              key={tag.id}
                              onClick={() => {
                                const newTags = isSelected
                                  ? (formData.tags || []).filter((id: string) => id !== tag.id)
                                  : [...(formData.tags || []), tag.id];
                                setFormData({ ...formData, tags: newTags });
                              }}
                              className={`px-2 py-1 text-[10px] font-bold uppercase tracking-widest transition-colors border ${
                                isSelected 
                                  ? 'bg-gold text-white border-gold shadow-[0_0_10px_rgba(212,175,55,0.3)] scale-105' 
                                  : 'bg-background/50 text-ink/60 border-gold/20 hover:border-gold/50'
                              }`}
                            >
                              {tag.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                {tagGroups.length === 0 && (
                  <p className="muted-text italic">No lore tags defined.</p>
                )}
              </div>

              <div className="pt-4 border-t border-gold/10 space-y-4">
                <p className="label-text text-gold">Template Data</p>
                
                {/* Character Template */}
                {(formData.category === 'character' || formData.category === 'deity') && (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className="label-text text-ink/40">Race</label>
                        <Input value={formData.metadata.race} onChange={e => setFormData({...formData, metadata: {...formData.metadata, race: e.target.value}})} className="h-8 text-xs" />
                      </div>
                      <div className="space-y-1">
                        <label className="label-text text-ink/40">Alignment</label>
                        <Input value={formData.metadata.alignment} onChange={e => setFormData({...formData, metadata: {...formData.metadata, alignment: e.target.value}})} className="h-8 text-xs" />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="label-text text-ink/40">Occupation</label>
                      <Input value={formData.metadata.occupation} onChange={e => setFormData({...formData, metadata: {...formData.metadata, occupation: e.target.value}})} className="h-8 text-xs" />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className="label-text text-ink/40">Gender</label>
                        <Input value={formData.metadata.gender} onChange={e => setFormData({...formData, metadata: {...formData.metadata, gender: e.target.value}})} className="h-8 text-xs" />
                      </div>
                      <div className="space-y-1">
                        <label className="label-text text-ink/40">Pronouns</label>
                        <Input value={formData.metadata.pronouns} onChange={e => setFormData({...formData, metadata: {...formData.metadata, pronouns: e.target.value}})} className="h-8 text-xs" />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="label-text text-ink/40">Life Status</label>
                      <select 
                        value={formData.metadata.lifeStatus} 
                        onChange={e => setFormData({...formData, metadata: {...formData.metadata, lifeStatus: e.target.value}})}
                        className="w-full h-8 px-2 rounded-md border border-gold/10 bg-background text-xs"
                      >
                        <option value="Alive">Alive</option>
                        <option value="Dead">Dead</option>
                        <option value="Undead">Undead</option>
                        <option value="Unknown">Unknown</option>
                      </select>
                    </div>
                  </>
                )}

                {/* Location Template */}
                {(formData.category === 'building' || formData.category === 'settlement' || formData.category === 'geography' || formData.category === 'country') && (
                  <>
                    <div className="space-y-1">
                      <label className="text-[10px] text-ink/40">Type</label>
                      <Input value={formData.metadata.locationType} onChange={e => setFormData({...formData, metadata: {...formData.metadata, locationType: e.target.value}})} className="h-8 text-xs" placeholder="City, Ruins, etc" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-ink/40">Parent Location</label>
                      <Input value={formData.metadata.parentLocation} onChange={e => setFormData({...formData, metadata: {...formData.metadata, parentLocation: e.target.value}})} className="h-8 text-xs" placeholder="Region, Continent..." />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-ink/40">Ruler / Owner</label>
                      <Input value={formData.metadata.ruler} onChange={e => setFormData({...formData, metadata: {...formData.metadata, ruler: e.target.value}})} className="h-8 text-xs" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-ink/40">Owning Organization</label>
                      <Input value={formData.metadata.owningOrganization} onChange={e => setFormData({...formData, metadata: {...formData.metadata, owningOrganization: e.target.value}})} className="h-8 text-xs" />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className="text-[10px] text-ink/40">Population</label>
                        <Input value={formData.metadata.population} onChange={e => setFormData({...formData, metadata: {...formData.metadata, population: e.target.value}})} className="h-8 text-xs" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-ink/40">Founding Date</label>
                        <Input value={formData.metadata.foundingDate} onChange={e => setFormData({...formData, metadata: {...formData.metadata, foundingDate: e.target.value}})} className="h-8 text-xs" />
                      </div>
                    </div>
                  </>
                )}

                {/* Organization / Religion Template */}
                {(formData.category === 'organization' || formData.category === 'religion') && (
                  <>
                    <div className="space-y-1">
                      <label className="text-[10px] text-ink/40">Leader</label>
                      <Input value={formData.metadata.leader} onChange={e => setFormData({...formData, metadata: {...formData.metadata, leader: e.target.value}})} className="h-8 text-xs" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-ink/40">Headquarters</label>
                      <Input value={formData.metadata.headquarters} onChange={e => setFormData({...formData, metadata: {...formData.metadata, headquarters: e.target.value}})} className="h-8 text-xs" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-ink/40">Motto</label>
                      <Input value={formData.metadata.motto} onChange={e => setFormData({...formData, metadata: {...formData.metadata, motto: e.target.value}})} className="h-8 text-xs italic" />
                    </div>
                    {formData.category === 'religion' && (
                      <>
                        <div className="space-y-1">
                          <label className="text-[10px] text-ink/40">Domains</label>
                          <Input value={formData.metadata.domains} onChange={e => setFormData({...formData, metadata: {...formData.metadata, domains: e.target.value}})} className="h-8 text-xs" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] text-ink/40">Holy Symbol</label>
                          <Input value={formData.metadata.holySymbol} onChange={e => setFormData({...formData, metadata: {...formData.metadata, holySymbol: e.target.value}})} className="h-8 text-xs" />
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
