import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { useNavigate, Link } from 'react-router-dom';
import { db } from '../../lib/firebase';
import { 
  collection, 
  query, 
  orderBy, 
  onSnapshot, 
  doc, 
  addDoc, 
  updateDoc, 
  deleteDoc
} from 'firebase/firestore';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Card, CardContent } from '../../components/ui/card';
import { slugify } from '../../lib/utils';
import { 
  Plus, 
  Trash2, 
  Edit, 
  ChevronLeft,
  Hammer,
  Wrench
} from 'lucide-react';
import { handleFirestoreError, OperationType } from '../../lib/firebase';
import MarkdownEditor from '../../components/MarkdownEditor';

export default function ToolsEditor({ userProfile, hideHeader }: { userProfile: any, hideHeader?: boolean }) {
  const navigate = useNavigate();
  const [tools, setTools] = useState<any[]>([]);
  const [toolCategories, setToolCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Form State
  const [editingTool, setEditingTool] = useState<any>(null);
  const [name, setName] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [description, setDescription] = useState('');
  const [foundryAlias, setFoundryAlias] = useState('');
  const [source, setSource] = useState('PHB');
  const [page, setPage] = useState<number | ''>('');
  const [basicRules, setBasicRules] = useState(false);
  const [ability, setAbility] = useState('DEX');

  const isAdmin = userProfile?.role === 'admin';

  useEffect(() => {
    const unsubscribe = onSnapshot(
      query(collection(db, 'tools'), orderBy('name', 'asc')),
      (snapshot) => {
        setTools(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      },
      (err) => {
        console.error("Error in Tools snapshot:", err);
      }
    );

      // Fetch All Option Groups
      const unsubscribeCategories = onSnapshot(
        query(collection(db, 'toolCategories'), orderBy('name', 'asc')),
        (snapshot) => {
          const cats = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          setToolCategories(cats);
          
          // If we are NOT editing and don't have a categoryId yet, default to the first one
          setCategoryId(prev => {
            if (prev) return prev;
            return cats.length > 0 ? cats[0].id : '';
          });
          
          setLoading(false);
        },
        (err) => {
          console.error("Error in toolCategories snapshot:", err);
          setLoading(false);
        }
      );

      return () => {
        unsubscribe();
        unsubscribeCategories();
      };
    }, []);

    const handleSave = async (e: React.FormEvent) => {
      e.preventDefault();
      
      const effectiveCategoryId = categoryId || toolCategories[0]?.id;
      if (!name || !effectiveCategoryId) {
        toast.error('Name and Category are required');
        return;
      }

      try {
        const toolData = {
          name,
          identifier: identifier.trim() || slugify(name),
          categoryId: effectiveCategoryId,
          foundryAlias: foundryAlias.trim(),
          source,
          ability,
          page: page === '' ? null : Number(page),
          basicRules,
          description,
          updatedAt: new Date().toISOString()
        };

      if (editingTool) {
        await updateDoc(doc(db, 'tools', editingTool.id), toolData);
        toast.success('Tool updated');
      } else {
        await addDoc(collection(db, 'tools'), toolData);
        toast.success('Tool created');
      }

      resetForm();
    } catch (error) {
      console.error("Error saving tool:", error);
      toast.error('Failed to save tool');
      handleFirestoreError(error, OperationType.WRITE, 'tools');
    }
  };

  const resetForm = () => {
    setEditingTool(null);
    setName('');
    setIdentifier('');
    setCategoryId(toolCategories[0]?.id || '');
    setDescription('');
    setFoundryAlias('');
    setSource('PHB');
    setPage('');
    setAbility('DEX');
    setBasicRules(false);
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('Delete this tool?')) {
      try {
        await deleteDoc(doc(db, 'tools', id));
        toast.success('Tool deleted');
      } catch (error) {
        console.error("Error deleting tool:", error);
        toast.error('Failed to delete tool');
        handleFirestoreError(error, OperationType.DELETE, 'tools');
      }
    }
  };

  if (!isAdmin) {
    return <div className="text-center py-20">Access Denied. Admins only.</div>;
  }

  return (
    <div className={`${hideHeader ? '' : 'max-w-6xl mx-auto space-y-8 pb-20'}`}>
      {!hideHeader && (
        <>
          <div className="flex items-center gap-3 text-gold mb-2">
            <Hammer className="w-6 h-6" />
            <span className="text-sm font-bold uppercase tracking-[0.3em]">Compendium</span>
          </div>
          
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div className="space-y-2">
              <div className="flex items-center gap-4 mb-2">
                <Link to="/compendium/classes">
                  <Button variant="ghost" size="sm" className="text-gold gap-2 hover:bg-gold/5">
                    <ChevronLeft className="w-4 h-4" /> Back to Classes
                  </Button>
                </Link>
              </div>
              <h1 className="text-4xl font-serif font-bold text-ink tracking-tight uppercase">Tool Manager</h1>
              <p className="text-ink/60 font-serif italic">Define the tools and instruments available in your game system.</p>
            </div>
          </div>
        </>
      )}

      <div className="grid lg:grid-cols-3 gap-8">
        {/* Left Column: Form */}
        <div className="space-y-6">
          <Card className="border-gold/20 bg-card/50 sticky top-24 h-[calc(100vh-8rem)] flex flex-col">
            <CardContent className="p-6 flex flex-col h-full overflow-hidden">
              <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-gold border-b border-gold/10 pb-2 flex-shrink-0">
                {editingTool ? 'Edit Tool' : 'New Tool'}
              </h2>
              <form onSubmit={handleSave} className="flex flex-col h-full overflow-hidden mt-4">
                <div className="flex-grow overflow-y-auto custom-scrollbar space-y-4 pr-2">
                  <div className="space-y-1">
                    <label className="text-xs font-bold uppercase tracking-widest text-ink/40">Tool Name</label>
                    <Input 
                      value={name}
                      onChange={e => setName(e.target.value)}
                      placeholder="e.g. Thieves' Tools"
                      className="bg-background/50 border-gold/10 focus:border-gold"
                      required
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs font-bold uppercase tracking-widest text-ink/40">Semantic Identifier (Slug)</label>
                      <Input 
                        value={identifier}
                        onChange={e => setIdentifier(e.target.value)}
                        placeholder="e.g. thieves-tools"
                        className="bg-background/50 border-gold/10 focus:border-gold font-mono"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold uppercase tracking-widest text-ink/40">Foundry Alias (3-letter)</label>
                      <Input 
                        value={foundryAlias}
                        onChange={e => setFoundryAlias(e.target.value)}
                        placeholder="e.g. thv"
                        maxLength={3}
                        className="bg-background/50 border-gold/10 focus:border-gold font-mono"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs font-bold uppercase tracking-widest text-ink/40">Category</label>
                      <select 
                        value={categoryId}
                        onChange={e => setCategoryId(e.target.value)}
                        className="w-full h-10 px-3 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-sm"
                      >
                        {toolCategories.map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold uppercase tracking-widest text-ink/40">Ability Score</label>
                      <select 
                        value={ability}
                        onChange={e => setAbility(e.target.value)}
                        className="w-full h-10 px-3 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-sm"
                      >
                        {["STR", "DEX", "CON", "INT", "WIS", "CHA"].map(a => (
                          <option key={a} value={a}>{a}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs font-bold uppercase tracking-widest text-ink/40">Source</label>
                      <Input 
                        value={source}
                        onChange={e => setSource(e.target.value)}
                        placeholder="e.g. PHB"
                        className="bg-background/50 border-gold/10 focus:border-gold"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold uppercase tracking-widest text-ink/40">Page</label>
                      <Input 
                        type="number"
                        value={page}
                        onChange={e => setPage(e.target.value === '' ? '' : Number(e.target.value))}
                        placeholder="e.g. 175"
                        className="bg-background/50 border-gold/10 focus:border-gold"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-6 pt-2 pb-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input 
                        type="checkbox"
                        checked={basicRules}
                        onChange={e => setBasicRules(e.target.checked)}
                        className="rounded border-gold/20 text-gold focus:ring-gold"
                      />
                      <span className="text-sm font-bold text-ink/70">Basic Rules</span>
                    </label>
                  </div>
                  <div className="space-y-1 pb-4">
                    <label className="text-xs font-bold uppercase tracking-widest text-ink/40">Description</label>
                    <textarea
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                      placeholder="Describe what this tool is used for..."
                      className="w-full min-h-[200px] p-3 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-sm resize-y"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-4 border-t border-gold/10 mt-auto flex-shrink-0">
                  {editingTool && (
                    <Button type="button" variant="ghost" size="sm" onClick={resetForm}>Cancel</Button>
                  )}
                  <Button type="submit" size="sm" className="btn-gold-solid">
                    {editingTool ? 'Update Tool' : 'Create Tool'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: List */}
        <div className="lg:col-span-2 space-y-4">
          {loading ? (
            <div className="text-center py-10 font-serif italic opacity-50">Loading tools...</div>
          ) : tools.length === 0 ? (
            <div className="text-center py-20 border border-dashed border-gold/20 rounded-xl">
              <p className="text-ink/40 italic">No tools defined yet.</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {tools.map(tool => (
                <Card key={tool.id} className="border-gold/10 bg-card/30 hover:border-gold/30 transition-all">
                  <CardContent className="p-4 flex items-start justify-between gap-4">
                    <div className="flex-grow space-y-1">
                      <div className="flex items-center gap-3">
                        <h3 className="font-serif font-bold text-xl text-ink uppercase tracking-tight">{tool.name}</h3>
                        {tool.identifier && (
                          <span className="text-[10px] px-2 py-0.5 bg-ink/5 text-ink/40 rounded border border-ink/10 font-mono italic">
                            {tool.identifier}
                          </span>
                        )}
                        <span className="text-[10px] px-2 py-0.5 bg-gold/10 text-gold rounded-full font-bold">
                          {toolCategories.find(c => c.id === tool.categoryId)?.name || 'Other'}
                        </span>
                        {tool.ability && (
                          <span className="text-[10px] px-2 py-0.5 bg-ink/10 text-ink/70 rounded-full font-bold">{tool.ability}</span>
                        )}
                        {tool.source && (
                          <span className="text-[10px] px-2 py-0.5 bg-ink/40 text-background rounded-full font-medium shadow-sm">{tool.source}{tool.page ? ` p.${tool.page}` : ''}</span>
                        )}
                      </div>
                      {tool.description && (
                        <div className="text-sm text-ink/60 line-clamp-2 italic font-serif">
                          {tool.description.replace(/\[.*?\]/g, '')}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" onClick={() => {
                        setEditingTool(tool);
                        setName(tool.name);
                        setIdentifier(tool.identifier || '');
                        setFoundryAlias(tool.foundryAlias || '');
                        
                        // Try to find categoryId, fallback to finding by name if it was old style
                        const cid = tool.categoryId || toolCategories.find((c: any) => c.name === tool.category)?.id || '';
                        setCategoryId(cid);
                        
                        setAbility(tool.ability || 'DEX');
                        setDescription(tool.description || '');
                        setSource(tool.source || '');
                        setPage(tool.page || '');
                        setBasicRules(tool.basicRules || false);
                      }} className="h-8 w-8 p-0 text-gold"><Edit className="w-4 h-4" /></Button>
                      <Button variant="ghost" size="sm" onClick={() => handleDelete(tool.id)} className="h-8 w-8 p-0 text-blood"><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
