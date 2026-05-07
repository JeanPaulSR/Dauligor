import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Card, CardContent } from '../../components/ui/card';
import { slugify } from '../../lib/utils';
import { Plus, Trash2, Edit, Database, CloudOff } from 'lucide-react';
import MarkdownEditor from '../../components/MarkdownEditor';
import { fetchCollection, upsertDocument, deleteDocument } from '../../lib/d1';

export default function SimpleProficiencyEditor({ 
    userProfile, 
    collectionName, 
    title, 
    descriptionText,
    icon: Icon,
    categoryCollectionName,
    categoryLabel = 'Category'
}: { 
    userProfile: any, 
    collectionName: string, 
    title: string, 
    descriptionText: string,
    icon: any,
    categoryCollectionName?: string,
    categoryLabel?: string
}) {
  const [items, setItems] = useState<any[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [isUsingD1, setIsUsingD1] = useState(false);
  
  // Form State
  const [editingItem, setEditingItem] = useState<any>(null);
  const [name, setName] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [order, setOrder] = useState<number | ''>('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');

  const isAdmin = userProfile?.role === 'admin';

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        const data = await fetchCollection(collectionName, { orderBy: '"order" ASC, name ASC' });
        setItems(data);
        if (data.length > 0) setIsUsingD1(true);
      } catch (err) {
        console.error(`Error loading ${collectionName}:`, err);
        setIsUsingD1(false);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [collectionName]);

  useEffect(() => {
    if (!categoryCollectionName) return;

    fetchCollection(categoryCollectionName, { orderBy: 'name ASC' })
      .then(data => {
        setCategories(
          data
            .map((d: any) => String(d.name || '').trim())
            .filter(Boolean)
        );
      })
      .catch(err => console.error(`Error loading ${categoryCollectionName}:`, err));
  }, [categoryCollectionName]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) return;

    try {
      const itemData: Record<string, any> = {
        name,
        identifier: identifier.trim() ? (categoryCollectionName === 'attributes' ? identifier.trim().toUpperCase() : identifier.trim()) : slugify(name).toUpperCase(),
        order: order === '' ? null : Number(order),
        ...(categoryCollectionName ? { category: category.trim() } : {}),
        description,
        updated_at: new Date().toISOString(),
      };

      const targetId = editingItem?.id || crypto.randomUUID();
      await upsertDocument(collectionName, targetId, itemData);

      if (editingItem) {
        setItems(prev => prev.map(it => it.id === targetId ? { ...it, ...itemData } : it));
        toast.success(`${title} updated`);
      } else {
        setItems(prev => [...prev, { id: targetId, ...itemData }]);
        toast.success(`${title} created`);
      }

      resetForm();
    } catch (error) {
      console.error(`Error saving ${collectionName}:`, error);
      toast.error(`Failed to save ${title}`);
    }
  };

  const resetForm = () => {
    setEditingItem(null);
    setName('');
    setIdentifier('');
    setOrder('');
    setCategory('');
    setDescription('');
  };

  const startEdit = (item: any) => {
    setEditingItem(item);
    setName(item.name);
    setIdentifier(item.identifier || '');
    setOrder(item.order ?? '');
    setCategory(item.category || '');
    setDescription(item.description || '');
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!isAdmin || !window.confirm(`Are you sure you want to delete this ${title.toLowerCase()}?`)) return;
    try {
      await deleteDocument(collectionName, id);
      setItems(prev => prev.filter(it => it.id !== id));
      toast.success(`${title} deleted`);
    } catch (error) {
      console.error(`Error deleting ${collectionName}:`, error);
      toast.error(`Failed to delete ${title}`);
    }
  };

  if (loading) return <div className="text-center py-10 opacity-50 font-serif italic text-sm">Loading {title}...</div>;

  return (
    <div className="grid lg:grid-cols-3 gap-8">
      <div className="lg:col-span-1 space-y-6">
        <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="label-text text-gold shrink-0">{title} Manager</h2>
              {isUsingD1 ? (
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                  <Database className="w-3 h-3 text-emerald-500" />
                  <span className="text-[9px] font-bold text-emerald-500 uppercase tracking-tighter">D1 Linked</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20">
                  <CloudOff className="w-3 h-3 text-amber-500" />
                  <span className="text-[9px] font-bold text-amber-500 uppercase tracking-tighter">Legacy Firebase</span>
                </div>
              )}
            </div>
            <br/>
            <p className="text-ink/60 font-serif italic">{descriptionText}</p>
        </div>

        <form onSubmit={handleSave} className="space-y-4 bg-card/50 p-6 rounded-lg border border-gold/10">
          <div className="space-y-2">
            <label className="field-label">Name</label>
            <Input 
              value={name}
              onChange={e => setName(e.target.value)}
              className="h-9 bg-background/50 border-gold/10"
              required
            />
          </div>

          <div className="space-y-2">
            <label className="field-label">Identifier</label>
            <Input 
              value={identifier}
              onChange={e => setIdentifier(e.target.value)}
              placeholder={slugify(name)}
              className="h-9 bg-background/50 border-gold/10 placeholder:text-ink/20 font-mono"
            />
            <p className="text-[9px] text-ink/40 uppercase tracking-widest font-bold">Fallback machine-readability alias</p>
          </div>

          <div className="space-y-2">
            <label className="field-label">Order</label>
            <Input 
              type="number"
              value={order}
              onChange={e => setOrder(e.target.value === '' ? '' : Number(e.target.value))}
              className="h-9 bg-background/50 border-gold/10 font-mono"
            />
            <p className="text-[9px] text-ink/40 uppercase tracking-widest font-bold">Display Priority (Lower values appear first)</p>
          </div>

          {categoryCollectionName && (
            <div className="space-y-2">
              <label className="field-label">{categoryLabel}</label>
              <Input
                list={`${collectionName}-categories`}
                value={category}
                onChange={e => setCategory(e.target.value)}
                className="h-9 bg-background/50 border-gold/10"
              />
              <datalist id={`${collectionName}-categories`}>
                {categories.map((entry) => (
                  <option key={entry} value={entry} />
                ))}
              </datalist>
            </div>
          )}

          <div className="space-y-2">
            <label className="field-label flex items-center justify-between">
              Description
            </label>
            <MarkdownEditor
              value={description}
              onChange={setDescription}
              placeholder="Enter details..."
            />
          </div>

          <div className="flex gap-2 pt-2">
            <Button type="submit" className="flex-1 btn-primary" disabled={!name}>
              {editingItem ? 'Save Changes' : 'Create'}
            </Button>
            {editingItem && (
              <Button type="button" variant="outline" onClick={resetForm} className="border-gold/20 text-gold/60 hover:text-gold hover:bg-gold/10">
                Cancel
              </Button>
            )}
          </div>
        </form>
      </div>

      <div className="lg:col-span-2">
        <div className="grid sm:grid-cols-2 gap-4">
          {items.map(item => (
            <Card 
              key={item.id} 
              className={`border-gold/10 bg-card/40 hover:bg-card/60 transition-colors cursor-pointer ${editingItem?.id === item.id ? 'ring-1 ring-gold shadow-sm' : ''}`}
              onClick={() => startEdit(item)}
            >
              <CardContent className="p-4 flex items-start gap-4">
                <div className="w-10 h-10 rounded border border-gold/10 bg-background flex flex-col items-center justify-center shrink-0 relative overflow-hidden">
                  <Icon className="w-4 h-4 text-gold/60" />
                  {typeof item.order === 'number' && (
                    <div className="absolute top-0 right-0 bg-gold/10 px-1 border-bl border-gold/10">
                      <span className="text-[8px] font-mono font-bold text-gold/60">{item.order}</span>
                    </div>
                  )}
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="h3-title text-ink font-bold truncate">{item.name}</h3>
                    {isAdmin && (
                      <Button variant="ghost" size="sm" onClick={(e) => handleDelete(e, item.id)} className="h-6 w-6 p-0 btn-danger opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                  {item.identifier && (
                    <div className="text-[10px] uppercase tracking-widest font-black text-gold/50 my-1 font-mono">
                      {item.identifier}
                    </div>
                  )}
                  {item.category && (
                    <div className="text-[10px] uppercase tracking-widest font-black text-ink/35">
                      {item.category}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
          {items.length === 0 && (
            <div className="sm:col-span-2 p-12 border border-dashed border-gold/20 rounded-xl text-center">
              <Icon className="w-8 h-8 text-gold/20 mx-auto mb-3" />
              <p className="text-ink/40 font-serif italic text-sm">No items created yet.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
