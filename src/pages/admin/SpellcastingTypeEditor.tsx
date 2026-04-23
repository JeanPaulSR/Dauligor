import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { db } from '../../lib/firebase';
import { 
  collection, 
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
import { Plus, Trash2, Edit, Calculator } from 'lucide-react';
import { handleFirestoreError, OperationType } from '../../lib/firebase';

export default function SpellcastingTypeEditor({ userProfile }: { userProfile: any }) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Form State
  const [editingItem, setEditingItem] = useState<any>(null);
  const [name, setName] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [foundryName, setFoundryName] = useState('');
  const [formula, setFormula] = useState('');

  const isAdmin = userProfile?.role === 'admin';
  const collectionName = 'spellcastingTypes';

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, collectionName),
      (snapshot) => {
        setItems(
          snapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .sort((a: any, b: any) => String(a.name || '').localeCompare(String(b.name || '')))
        );
        setLoading(false);
      },
      (err) => {
        console.error(`Error in ${collectionName} snapshot:`, err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) return;

    try {
      const itemData = {
        name,
        identifier: identifier.trim() || slugify(name),
        foundryName: foundryName.trim(),
        formula: formula.trim(),
        updatedAt: new Date().toISOString()
      };

      if (editingItem) {
        await updateDoc(doc(db, collectionName, editingItem.id), itemData);
        toast.success(`Spellcasting type updated`);
      } else {
        await addDoc(collection(db, collectionName), itemData);
        toast.success(`Spellcasting type created`);
      }

      resetForm();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, collectionName);
    }
  };

  const resetForm = () => {
    setEditingItem(null);
    setName('');
    setIdentifier('');
    setFoundryName('');
    setFormula('');
  };

  const startEdit = (item: any) => {
    setEditingItem(item);
    setName(item.name);
    setIdentifier(item.identifier || '');
    setFoundryName(item.foundryName || '');
    setFormula(item.formula || '');
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!isAdmin || !window.confirm(`Are you sure you want to delete this spellcasting type?`)) return;
    try {
      await deleteDoc(doc(db, collectionName, id));
      toast.success(`Spellcasting type deleted`);
    } catch (error) {
       handleFirestoreError(error, OperationType.DELETE, collectionName);
    }
  };

  if (loading) return <div className="text-center py-10 opacity-50 font-serif italic text-sm">Loading Spellcasting Types...</div>;

  return (
    <div className="grid lg:grid-cols-3 gap-8">
      <div className="lg:col-span-1 space-y-6">
        <div className="space-y-2">
            <h2 className="label-text text-gold shrink-0">Spellcasting Type Creator</h2>
            <p className="text-ink/60 font-serif italic">Define the scaling mathematical formula for slot determination (e.g. 1 * level vs floor(0.5 * level)).</p>
        </div>

        <form onSubmit={handleSave} className="space-y-4 bg-card/50 p-6 rounded-lg border border-gold/10">
          <div className="space-y-2">
            <label className="text-[10px] uppercase font-black text-ink/60">Display Name</label>
            <Input 
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Full-Caster"
              className="h-9 bg-background/50 border-gold/10"
              required
            />
          </div>

          <div className="space-y-2">
            <label className="text-[10px] uppercase font-black text-ink/60">Identifier</label>
            <Input 
              value={identifier}
              onChange={e => setIdentifier(e.target.value)}
              placeholder={slugify(name)}
              className="h-9 bg-background/50 border-gold/10 placeholder:text-ink/20 font-mono"
            />
          </div>

          <div className="space-y-2">
            <label className="text-[10px] uppercase font-black text-ink/60">Foundry Flat Name</label>
            <Input 
              value={foundryName}
              onChange={e => setFoundryName(e.target.value)}
              placeholder="e.g. full, half"
              className="h-9 bg-background/50 border-gold/10 font-mono text-xs"
            />
          </div>

          <div className="space-y-2">
            <label className="text-[10px] uppercase font-black text-ink/60">Scaling Formula</label>
            <Input 
              value={formula}
              onChange={e => setFormula(e.target.value)}
              placeholder="e.g. 1 * level, floor(0.5 * level)"
              className="h-9 bg-background/50 border-gold/10 font-mono text-xs"
            />
            <p className="text-[9px] text-gold/60 italic">Use 'level' as variable. Supported: floor(), ceil()</p>
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
              className={`border-gold/10 bg-card/40 hover:bg-card/60 transition-all cursor-pointer group ${editingItem?.id === item.id ? 'ring-1 ring-gold shadow-sm' : ''}`}
              onClick={() => startEdit(item)}
            >
              <CardContent className="p-4 flex items-start gap-4">
                <div className="w-10 h-10 rounded border border-gold/10 bg-background flex items-center justify-center shrink-0">
                  <Calculator className="w-4 h-4 text-gold/60" />
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="h3-title text-ink font-bold truncate">{item.name}</h3>
                    {isAdmin && (
                      <Button variant="ghost" size="sm" onClick={(e) => handleDelete(e, item.id)} className="h-6 w-6 p-0 text-blood hover:bg-blood/10 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                  <div className="mt-1 flex flex-col gap-1">
                    <div className="flex items-center gap-1.5 font-mono text-[9px] text-gold/70">
                      <span className="text-ink/40">Foundry:</span> {item.foundryName || '-'}
                    </div>
                    <div className="flex items-center gap-1.5 font-mono text-[9px] text-gold/70">
                      <span className="text-ink/40">Formula:</span> {item.formula || '-'}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {items.length === 0 && (
            <div className="sm:col-span-2 p-12 border border-dashed border-gold/20 rounded-xl text-center">
              <Calculator className="w-8 h-8 text-gold/20 mx-auto mb-3" />
              <p className="text-ink/40 font-serif italic text-sm">No spellcasting types defined yet.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
