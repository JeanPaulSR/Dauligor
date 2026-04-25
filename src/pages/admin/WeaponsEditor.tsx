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

export default function WeaponsEditor({ userProfile, hideHeader }: { userProfile: any, hideHeader?: boolean }) {
  const [weapons, setWeapons] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [allProperties, setAllProperties] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Form State
  const [editingWeapon, setEditingWeapon] = useState<any>(null);
  const [name, setName] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [weaponType, setWeaponType] = useState<'Melee' | 'Ranged'>('Melee');
  const [propertyIds, setPropertyIds] = useState<string[]>([]);
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
      },
      (err) => {
        console.error("Error in Weapons snapshot:", err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      query(collection(db, 'weaponCategories'), orderBy('name', 'asc')),
      (snapshot) => {
        setCategories(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        if (!editingWeapon && !categoryId && snapshot.docs.length > 0) {
          setCategoryId(snapshot.docs[0].id);
        }
      },
      (err) => {
        console.error("Error in Weapon Categories snapshot:", err);
      }
    );

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      query(collection(db, 'weaponProperties'), orderBy('name', 'asc')),
      (snapshot) => {
        setAllProperties(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      },
      (err) => {
        console.error("Error in Weapon Properties snapshot:", err);
      }
    );

    return () => unsubscribe();
  }, []);

    const handleSave = async (e: React.FormEvent) => {
      e.preventDefault();
      
      const effectiveCategoryId = categoryId || categories[0]?.id;
      if (!name || !effectiveCategoryId) {
        toast.error('Name and Category are required');
        return;
      }
  
      try {
        const weaponData = {
          name,
          identifier: identifier.trim() || slugify(name),
          categoryId: effectiveCategoryId,
          weaponType,
          propertyIds,
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
        console.error("Error saving weapon:", error);
        toast.error('Failed to save weapon');
        handleFirestoreError(error, OperationType.WRITE, 'weapons');
      }
    };

  const resetForm = () => {
    setEditingWeapon(null);
    setName('');
    setIdentifier('');
    setCategoryId(categories.length > 0 ? categories[0].id : '');
    setWeaponType('Melee');
    setPropertyIds([]);
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
        console.error("Error deleting weapon:", error);
        toast.error('Failed to delete weapon');
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
          <Card className="border-gold/20 bg-card/50 sticky top-24 flex flex-col">
            <CardContent className="p-6 flex flex-col">
              <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-gold border-b border-gold/10 pb-2 flex-shrink-0">
                {editingWeapon ? 'Edit Weapon' : 'New Weapon'}
              </h2>
              <form onSubmit={handleSave} className="flex flex-col mt-4 gap-4">
                <div className="space-y-4">
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
                      <select 
                        value={categoryId}
                        onChange={e => setCategoryId(e.target.value)}
                        className="w-full h-10 px-3 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-sm"
                        required
                      >
                        <option value="" disabled>Select Category</option>
                        {categories.map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold uppercase tracking-widest text-ink/40">Weapon Type</label>
                      <select 
                        value={weaponType}
                        onChange={e => setWeaponType(e.target.value as any)}
                        className="w-full h-10 px-3 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-sm"
                      >
                        <option value="Melee">Melee</option>
                        <option value="Ranged">Ranged</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
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
                  <div className="space-y-2 border-t border-gold/10 pt-4 mt-2">
                    <label className="text-xs font-bold uppercase tracking-widest text-ink/40 block">Weapon Properties</label>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 max-h-[150px] overflow-y-auto p-2 border border-gold/5 bg-background/30 rounded-md custom-scrollbar">
                      {allProperties.map(prop => (
                        <label key={prop.id} className="flex items-center gap-2 cursor-pointer group">
                          <input 
                            type="checkbox"
                            checked={propertyIds.includes(prop.id)}
                            onChange={e => {
                              if (e.target.checked) {
                                setPropertyIds([...propertyIds, prop.id]);
                              } else {
                                setPropertyIds(propertyIds.filter(id => id !== prop.id));
                              }
                            }}
                            className="rounded border-gold/20 text-gold focus:ring-gold"
                          />
                          <span className="text-[11px] font-medium text-ink/60 group-hover:text-ink transition-colors truncate">
                            {prop.name}
                          </span>
                        </label>
                      ))}
                      {allProperties.length === 0 && (
                        <p className="col-span-2 text-[10px] text-ink/40 italic py-2">No properties defined. Create them in the Properties tab.</p>
                      )}
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
                  <Button type="submit" size="sm" className="btn-gold-solid">
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
                        {(weapon.categoryId || weapon.category) && (
                          <span className="text-[10px] px-2 py-0.5 bg-gold/10 text-gold rounded-full font-bold">
                            {categories.find(c => c.id === weapon.categoryId)?.name || weapon.category}
                          </span>
                        )}
                        {weapon.weaponType && (
                          <span className="text-[10px] px-2 py-0.5 bg-ink/10 text-ink/70 rounded-full font-bold">{weapon.weaponType}</span>
                        )}
                        {weapon.ability && (
                          <span className="text-[10px] px-2 py-0.5 bg-ink/10 text-ink/70 rounded-full font-bold">{weapon.ability}</span>
                        )}
                        {weapon.source && (
                          <span className="text-[10px] px-2 py-0.5 bg-ink/40 text-background rounded-full font-medium shadow-sm">{weapon.source}{weapon.page ? ` p.${weapon.page}` : ''}</span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {weapon.propertyIds?.map((pid: string) => {
                          const prop = allProperties.find(p => p.id === pid);
                          if (!prop) return null;
                          return (
                            <span key={pid} title={prop.description} className="text-[9px] px-1.5 py-0.5 bg-ink/5 border border-ink/10 text-ink/60 rounded uppercase tracking-tighter cursor-help">
                              {prop.name}
                            </span>
                          );
                        })}
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
                        
                        // Try to derive categoryId from category name if missing
                        const cid = weapon.categoryId || categories.find((c: any) => c.name === weapon.category)?.id || '';
                        setCategoryId(cid);
                        
                        setWeaponType(weapon.weaponType || 'Melee');
                        setPropertyIds(weapon.propertyIds || []);
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
