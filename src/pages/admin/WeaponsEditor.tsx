import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
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
  Crosshair
} from 'lucide-react';
import { handleFirestoreError, OperationType } from '../../lib/firebase';
import MarkdownEditor from '../../components/MarkdownEditor';

const DEFAULT_CATEGORIES = [
  "Simple Melee Weapons",
  "Simple Ranged Weapons",
  "Martial Melee Weapons",
  "Martial Ranged Weapons",
  "Firearms"
];

export default function WeaponsEditor({ userProfile, hideHeader }: { userProfile: any, hideHeader?: boolean }) {
  const [weapons, setWeapons] = useState<any[]>([]);
  const [categories, setCategories] = useState<string[]>(DEFAULT_CATEGORIES);
  const [loading, setLoading] = useState(true);
  
  // Form State
  const [editingWeapon, setEditingWeapon] = useState<any>(null);
  const [name, setName] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [category, setCategory] = useState("Simple Melee Weapons");
  const [description, setDescription] = useState('');
  const [foundryAlias, setFoundryAlias] = useState('');
  const [source, setSource] = useState('PHB');
  const [page, setPage] = useState<number | ''>('');
  const [basicRules, setBasicRules] = useState(false);
  const [ability, setAbility] = useState('STR');

  const isAdmin = userProfile?.role === 'admin';

  useEffect(() => {
    const unsubscribe = onSnapshot(
      query(collection(db, 'weapons'), orderBy('name', 'asc')),
      (snapshot) => {
        setWeapons(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      query(collection(db, 'weaponCategories'), orderBy('name', 'asc')),
      (snapshot) => {
        const managed = snapshot.docs
          .map(doc => String(doc.data().name || '').trim())
          .filter(Boolean);
        setCategories(Array.from(new Set([...DEFAULT_CATEGORIES, ...managed])));
      }
    );

    return () => unsubscribe();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !category) return;

    try {
      const weaponData = {
        name,
        identifier: identifier.trim() || slugify(name),
        category,
        foundryAlias: foundryAlias.trim(),
        source,
        ability,
        page: page === '' ? null : Number(page),
        basicRules,
        description,
        updatedAt: new Date().toISOString()
      };

      if (editingWeapon) {
        await updateDoc(doc(db, 'weapons', editingWeapon.id), weaponData);
        toast.success('Weapon updated');
      } else {
        await addDoc(collection(db, 'weapons'), weaponData);
        toast.success('Weapon created');
      }

      resetForm();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'weapons');
    }
  };

  const resetForm = () => {
    setEditingWeapon(null);
    setName('');
    setIdentifier('');
    setCategory("Simple Melee Weapons");
    setDescription('');
    setFoundryAlias('');
    setSource('PHB');
    setPage('');
    setAbility('STR');
    setBasicRules(false);
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('Delete this weapon?')) {
      try {
        await deleteDoc(doc(db, 'weapons', id));
        toast.success('Weapon deleted');
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, 'weapons');
      }
    }
  };

  if (!isAdmin) {
    return <div className="text-center py-20">Access Denied. Admins only.</div>;
  }

  return (
    <div className={`${hideHeader ? '' : 'max-w-6xl mx-auto space-y-8 pb-20'}`}>
      {!hideHeader && (
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="space-y-2">
            <h1 className="text-4xl font-serif font-bold text-ink tracking-tight uppercase">Weapon Manager</h1>
            <p className="text-ink/60 font-serif italic">Define the weapons available in your game system.</p>
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-8">
        {/* Left Column: Form */}
        <div className="space-y-6">
          <Card className="border-gold/20 bg-card/50 sticky top-24 h-[calc(100vh-8rem)] flex flex-col">
            <CardContent className="p-6 flex flex-col h-full overflow-hidden">
              <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-gold border-b border-gold/10 pb-2 flex-shrink-0">
                {editingWeapon ? 'Edit Weapon' : 'New Weapon'}
              </h2>
              <form onSubmit={handleSave} className="flex flex-col h-full overflow-hidden mt-4">
                <div className="flex-grow overflow-y-auto custom-scrollbar space-y-4 pr-2">
                  <div className="space-y-1">
                    <label className="text-xs font-bold uppercase tracking-widest text-ink/40">Weapon Name</label>
                    <Input 
                      value={name}
                      onChange={e => setName(e.target.value)}
                      placeholder="e.g. Longsword"
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
                        placeholder="e.g. longsword"
                        className="bg-background/50 border-gold/10 focus:border-gold font-mono"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold uppercase tracking-widest text-ink/40">Foundry Alias (3-letter)</label>
                      <Input 
                        value={foundryAlias}
                        onChange={e => setFoundryAlias(e.target.value)}
                        placeholder="e.g. lng"
                        maxLength={3}
                        className="bg-background/50 border-gold/10 focus:border-gold font-mono"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs font-bold uppercase tracking-widest text-ink/40">Category</label>
                      <Input
                        list="weapon-category-options"
                        value={category}
                        onChange={e => setCategory(e.target.value)}
                        placeholder="e.g. Martial Melee Weapons or Exotic Weapons"
                        className="bg-background/50 border-gold/10 focus:border-gold"
                      />
                      <datalist id="weapon-category-options">
                        {categories.map(c => (
                          <option key={c} value={c} />
                        ))}
                      </datalist>
                      <p className="text-[9px] text-ink/35 italic">Use the shared category list or type a new homebrew category.</p>
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
                      placeholder="Describe the weapon..."
                      className="w-full min-h-[200px] p-3 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-sm resize-y"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-4 border-t border-gold/10 mt-auto flex-shrink-0">
                  {editingWeapon && (
                    <Button type="button" variant="ghost" size="sm" onClick={resetForm}>Cancel</Button>
                  )}
                  <Button type="submit" size="sm" className="bg-gold hover:bg-gold/90 text-white">
                    {editingWeapon ? 'Update Weapon' : 'Create Weapon'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: List */}
        <div className="lg:col-span-2 space-y-4">
          {loading ? (
            <div className="text-center py-10 font-serif italic opacity-50">Loading weapons...</div>
          ) : weapons.length === 0 ? (
            <div className="text-center py-20 border border-dashed border-gold/20 rounded-xl">
              <p className="text-ink/40 italic">No weapons defined yet.</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {weapons.map(weapon => (
                <Card key={weapon.id} className="border-gold/10 bg-card/30 hover:border-gold/30 transition-all">
                  <CardContent className="p-4 flex items-start justify-between gap-4">
                    <div className="flex-grow space-y-1">
                      <div className="flex items-center gap-3">
                        <h3 className="font-serif font-bold text-xl text-ink uppercase tracking-tight">{weapon.name}</h3>
                        {weapon.identifier && (
                          <span className="text-[10px] px-2 py-0.5 bg-ink/5 text-ink/40 rounded border border-ink/10 font-mono italic">
                            {weapon.identifier}
                          </span>
                        )}
                        <span className="text-[10px] px-2 py-0.5 bg-gold/10 text-gold rounded-full font-bold">{weapon.category}</span>
                        {weapon.ability && (
                          <span className="text-[10px] px-2 py-0.5 bg-ink/10 text-ink/70 rounded-full font-bold">{weapon.ability}</span>
                        )}
                        {weapon.source && (
                          <span className="text-[10px] px-2 py-0.5 bg-ink/40 text-background rounded-full font-medium shadow-sm">{weapon.source}{weapon.page ? ` p.${weapon.page}` : ''}</span>
                        )}
                      </div>
                      {weapon.description && (
                        <div className="text-sm text-ink/60 line-clamp-2 italic font-serif">
                          {weapon.description.replace(/\[.*?\]/g, '')}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" onClick={() => {
                        setEditingWeapon(weapon);
                        setName(weapon.name);
                        setIdentifier(weapon.identifier || '');
                        setFoundryAlias(weapon.foundryAlias || '');
                        setCategory(weapon.category || "Simple Melee Weapons");
                        setAbility(weapon.ability || 'STR');
                        setDescription(weapon.description || '');
                        setSource(weapon.source || '');
                        setPage(weapon.page || '');
                        setBasicRules(weapon.basicRules || false);
                      }} className="h-8 w-8 p-0 text-gold"><Edit className="w-4 h-4" /></Button>
                      <Button variant="ghost" size="sm" onClick={() => handleDelete(weapon.id)} className="h-8 w-8 p-0 text-blood"><Trash2 className="w-4 h-4" /></Button>
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
