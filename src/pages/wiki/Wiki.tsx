import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { db, OperationType, handleFirestoreError } from '../../lib/firebase';
import { collection, onSnapshot, query, orderBy, addDoc, deleteDoc, doc, where } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Search, Plus, BookOpen, MapPin, History, Users, Sparkles, Trash2, Shield, Package, Library, Building, Flag, Sword, Zap, Mountain, Dna, Ship, Home, Biohazard, Swords, Scroll, Footprints, Languages, Coins, Layers, Flame, Scale, ListChecks, Hammer, Quote, Crown, Wand2, FlaskConical, Heart, LayoutGrid, List, Folder, FileText, ChevronRight, ChevronDown } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

export default function Wiki({ userProfile }: { userProfile: any }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const categoryParam = searchParams.get('category');
  
  const [pages, setPages] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState(categoryParam || 'all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [expandedParents, setExpandedParents] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (categoryParam) {
      setActiveTab(categoryParam);
    } else {
      setActiveTab('all');
    }
  }, [categoryParam]);

  const handleTabChange = (id: string) => {
    setActiveTab(id);
    if (id === 'all') {
      searchParams.delete('category');
    } else {
      searchParams.set('category', id);
    }
    setSearchParams(searchParams);
  };

  const isStaff = userProfile?.role === 'admin' || userProfile?.role === 'co-dm' || userProfile?.role === 'lore-writer';

  useEffect(() => {
    let q;
    if (isStaff) {
      q = query(collection(db, 'lore'), orderBy('title'));
    } else {
      q = query(collection(db, 'lore'), where('status', '==', 'published'), orderBy('title'));
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      setPages(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'lore');
    });
    return () => unsubscribe();
  }, [isStaff]);

  const filteredPages = pages.filter(page => {
    const matchesSearch = page.title.toLowerCase().includes(search.toLowerCase()) || 
                          (page.content && page.content.toLowerCase().includes(search.toLowerCase()));
    const matchesTab = activeTab === 'all' || page.category === activeTab;
    const isVisible = page.status === 'published' || isStaff;
    return matchesSearch && matchesTab && isVisible;
  });

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this page?')) {
      try {
        await deleteDoc(doc(db, 'lore', id));
        toast.success('Wiki entry deleted');
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, 'lore');
      }
    }
  };

  const categories = [
    { id: 'all', label: 'All Articles', icon: BookOpen },
    { id: 'generic', label: 'Generic', icon: Library },
    { id: 'building', label: 'Buildings', icon: Building },
    { id: 'character', label: 'Characters', icon: Users },
    { id: 'country', label: 'Countries', icon: Flag },
    { id: 'military', label: 'Military', icon: Sword },
    { id: 'deity', label: 'Gods/Deities', icon: Zap },
    { id: 'geography', label: 'Geography', icon: Mountain },
    { id: 'item', label: 'Items', icon: Package },
    { id: 'organization', label: 'Organizations', icon: Shield },
    { id: 'religion', label: 'Religions', icon: Sparkles },
    { id: 'species', label: 'Species', icon: Dna },
    { id: 'vehicle', label: 'Vehicles', icon: Ship },
    { id: 'settlement', label: 'Settlements', icon: Home },
    { id: 'condition', label: 'Conditions', icon: Biohazard },
    { id: 'conflict', label: 'Conflicts', icon: Swords },
    { id: 'document', label: 'Documents', icon: Scroll },
    { id: 'culture', label: 'Culture / Ethnicity', icon: Footprints },
    { id: 'language', label: 'Languages', icon: Languages },
    { id: 'material', label: 'Materials', icon: Coins },
    { id: 'formation', label: 'Military Formations', icon: Layers },
    { id: 'myth', label: 'Myths', icon: Flame },
    { id: 'law', label: 'Natural Laws', icon: Scale },
    { id: 'plot', label: 'Plots', icon: ListChecks },
    { id: 'profession', label: 'Professions', icon: Hammer },
    { id: 'prose', label: 'Prose', icon: Quote },
    { id: 'title', label: 'Titles', icon: Crown },
    { id: 'spell', label: 'Spells', icon: Wand2 },
    { id: 'technology', label: 'Technology', icon: FlaskConical },
    { id: 'tradition', label: 'Traditions', icon: Heart },
    { id: 'session', label: 'Session Reports', icon: BookOpen },
  ];

  const renderArticleCard = (page: any) => (
    <Card 
      key={page.id} 
      className="lore-card group flex flex-col border-gold/10 hover:border-gold/40 transition-all cursor-pointer overflow-hidden bg-card/40 backdrop-blur-sm"
      onClick={() => navigate(`/wiki/article/${page.id}`)}
    >
      {page.imageUrl && (
        <div className="h-32 overflow-hidden border-b border-gold/10">
          <img 
            src={page.imageUrl} 
            alt={page.title} 
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            referrerPolicy="no-referrer"
          />
        </div>
      )}
      <CardHeader className="p-5 pb-2">
        <div className="flex justify-between items-start">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="label-text bg-gold/5 border-gold/20">
              {page.category}
            </Badge>
            {page.status === 'draft' && (
              <Badge variant="outline" className="border-blood/40 text-blood bg-blood/5 text-[10px]">DRAFT</Badge>
            )}
          </div>
          {isStaff && (
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-6 w-6 btn-danger text-blood/40 hover:text-blood"
              onClick={(e) => {
                e.stopPropagation();
                handleDelete(page.id);
              }}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
        <CardTitle className="h3-title mt-3 group-hover:text-gold transition-colors leading-tight">
          {page.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-5 pt-0 flex-grow">
        <p className="description-text line-clamp-2 text-xs text-ink/60 mb-4">
          {page.excerpt || (page.content?.substring(0, 100) + '...')}
        </p>
        <div className="flex flex-wrap gap-1 mt-auto">
          {page.tags?.slice(0, 3).map((tag: string) => (
            <span key={tag} className="text-[9px] bg-ink/5 px-2 py-0.5 rounded text-ink/40 border border-ink/5">#{tag}</span>
          ))}
          {page.tags?.length > 3 && <span className="text-[9px] text-ink/30">+{page.tags.length - 3}</span>}
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="flex flex-col lg:flex-row gap-8 min-h-[calc(100vh-200px)]">
      {/* Sidebar Navigation */}
      <aside className="w-full lg:w-64 space-y-6 shrink-0">
        <div className="space-y-4">
          <h2 className="label-text px-2">Archive Categories</h2>
          <ScrollArea className="h-[calc(100vh-350px)] pr-4">
            <nav className="space-y-1">
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => handleTabChange(cat.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-all ${
                    activeTab === cat.id 
                    ? 'bg-gold/10 text-gold font-bold shadow-sm' 
                    : 'text-ink/60 hover:bg-gold/5 hover:text-ink'
                  }`}
                >
                  <cat.icon className={`w-4 h-4 ${activeTab === cat.id ? 'text-gold' : 'text-ink/30'}`} />
                  {cat.label}
                  <span className="ml-auto text-[10px] opacity-40">
                    {pages.filter(p => (cat.id === 'all' || p.category === cat.id) && (p.status === 'published' || isStaff)).length}
                  </span>
                </button>
              ))}
            </nav>
          </ScrollArea>
        </div>

        {isStaff && (
          <div className="pt-6 border-t border-gold/10">
            <Link to="/wiki/new" className="block">
              <Button className="w-full btn-gold-solid gap-2 shadow-lg shadow-gold/20">
                <Plus className="w-4 h-4" /> New Entry
              </Button>
            </Link>
          </div>
        )}
      </aside>

      {/* Main Content Area */}
      <main className="flex-grow space-y-8 min-w-0">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="h2-title">
              {categories.find(c => c.id === activeTab)?.label}
            </h1>
          </div>
          
          <div className="flex items-center gap-4 w-full md:w-auto">
            <div className="flex bg-card/50 border border-gold/10 rounded-md p-1">
              <Button 
                variant="ghost" 
                size="sm" 
                className={`px-3 py-1 h-8 ${viewMode === 'grid' ? 'bg-gold/10 text-gold' : 'text-ink/40 hover:text-ink'}`}
                onClick={() => setViewMode('grid')}
              >
                <LayoutGrid className="w-4 h-4" />
              </Button>
              <Button 
                variant="ghost" 
                size="sm" 
                className={`px-3 py-1 h-8 ${viewMode === 'list' ? 'bg-gold/10 text-gold' : 'text-ink/40 hover:text-ink'}`}
                onClick={() => setViewMode('list')}
              >
                <List className="w-4 h-4" />
              </Button>
            </div>
            <div className="relative w-full md:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink/30" />
              <Input 
                className="pl-10 border-gold/10 focus:border-gold bg-card/50" 
                placeholder="Search the archive..." 
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>
        </div>

        {viewMode === 'grid' ? (
          /* Grid View */
          <>
            {activeTab === 'all' ? (
              <div className="space-y-12">
                {categories.filter(c => c.id !== 'all').map(category => {
                  const categoryPages = filteredPages.filter(p => p.category === category.id);
                  if (categoryPages.length === 0) return null;
                  return (
                    <div key={category.id} className="space-y-4">
                      <div className="flex items-center gap-3 border-b border-gold/20 pb-2">
                        <category.icon className="w-6 h-6 text-gold" />
                        <h2 className="h3-title">{category.label}</h2>
                      </div>
                      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-6">
                        {categoryPages.map(renderArticleCard)}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-6">
                {filteredPages.map(renderArticleCard)}
              </div>
            )}
            
            {filteredPages.length === 0 && (
              <div className="text-center py-32 bg-gold/5 rounded-2xl border border-dashed border-gold/20">
                <BookOpen className="w-16 h-16 text-gold/10 mx-auto mb-4" />
                <h3 className="h3-title text-ink/40">These categories are empty</h3>
                <p className="muted-text mt-1">Try a different search or category.</p>
              </div>
            )}
          </>
        ) : (
          /* List / Tree View */
          <div className="bg-card/40 border border-gold/10 rounded-lg p-6">
            {categories.filter(c => activeTab === 'all' || c.id === activeTab).map(category => {
              if (category.id === 'all') return null;
              
              const categoryPages = filteredPages.filter(p => p.category === category.id);
              if (categoryPages.length === 0) return null;

              // Group by folder
              const folders: Record<string, any[]> = {};
              categoryPages.forEach(page => {
                const folderName = page.folder || 'Uncategorized';
                if (!folders[folderName]) folders[folderName] = [];
                folders[folderName].push(page);
              });

              return (
                <div key={category.id} className="mb-8 last:mb-0">
                  <div className="flex items-center gap-2 mb-4 pb-2 border-b border-gold/10">
                    <category.icon className="w-5 h-5 text-gold" />
                    <h2 className="h3-title">{category.label}</h2>
                  </div>
                  
                  <div className="space-y-2 pl-2">
                    {Object.entries(folders).sort().map(([folderName, folderPages]) => {
                      const isExpanded = expandedFolders[`${category.id}-${folderName}`] !== false;
                      const toggleFolder = () => {
                        setExpandedFolders(prev => ({
                          ...prev,
                          [`${category.id}-${folderName}`]: !isExpanded
                        }));
                      };

                      // Separate roots and children
                      const roots = folderPages.filter(p => !p.parentId);
                      const childrenByParent: Record<string, any[]> = {};
                      folderPages.forEach(p => {
                        if (p.parentId) {
                          if (!childrenByParent[p.parentId]) childrenByParent[p.parentId] = [];
                          childrenByParent[p.parentId].push(p);
                        }
                      });

                      // If a child's parent isn't in this folder, treat it as a root for this folder view
                      const actualRoots = [...roots];
                      folderPages.forEach(p => {
                        if (p.parentId && !folderPages.find(fp => fp.id === p.parentId)) {
                          actualRoots.push(p);
                        }
                      });

                      const renderTreeItem = (page: any, depth: number = 0) => {
                        const children = childrenByParent[page.id] || [];
                        const hasChildren = children.length > 0;
                        const isParentExpanded = expandedParents[page.id] !== false;
                        
                        const toggleParent = (e: React.MouseEvent) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setExpandedParents(prev => ({
                            ...prev,
                            [page.id]: !isParentExpanded
                          }));
                        };

                        return (
                          <div key={page.id} className="flex flex-col">
                            <div className="flex items-center gap-2 py-1.5 hover:bg-gold/5 rounded px-2 group">
                              <div style={{ width: `${depth * 20}px` }} />
                              {hasChildren ? (
                                <button onClick={toggleParent} className="p-0.5 hover:bg-gold/10 rounded text-ink/40 hover:text-gold">
                                  {isParentExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                </button>
                              ) : (
                                <div className="w-4" />
                              )}
                              <FileText className="w-3.5 h-3.5 text-gold/60" />
                              <Link to={`/wiki/article/${page.id}`} className="text-sm font-medium text-ink/80 hover:text-gold transition-colors flex-grow">
                                {page.title}
                              </Link>
                              {page.status === 'draft' && (
                                <Badge variant="outline" className="border-blood/40 text-blood bg-blood/5 text-[9px] py-0 h-4">DRAFT</Badge>
                              )}
                              {isStaff && (
                                <Button 
                                  variant="ghost" 
                                  size="icon" 
                                  className="h-6 w-6 btn-danger text-blood/40 hover:text-blood opacity-0 group-hover:opacity-100 transition-opacity ml-2" 
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    handleDelete(page.id);
                                  }}
                                >
                                  <Trash2 className="w-3 h-3" />
                                </Button>
                              )}
                            </div>
                            {hasChildren && isParentExpanded && (
                              <div className="flex flex-col">
                                {children.map(child => renderTreeItem(child, depth + 1))}
                              </div>
                            )}
                          </div>
                        );
                      };

                      return (
                        <div key={folderName} className="flex flex-col">
                          <button 
                            onClick={toggleFolder}
                            className="flex items-center gap-2 py-2 text-sm font-bold text-ink/70 hover:text-gold transition-colors text-left"
                          >
                            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            <Folder className="w-4 h-4 text-gold/80" />
                            {folderName}
                            <span className="text-xs font-normal text-ink/40 ml-2">({folderPages.length})</span>
                          </button>
                          
                          {isExpanded && (
                            <div className="flex flex-col mt-1 mb-3">
                              {actualRoots.map(root => renderTreeItem(root, 1))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {filteredPages.length === 0 && (
              <div className="py-20 text-center text-ink/40 font-serif italic">
                No articles found matching your criteria.
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
