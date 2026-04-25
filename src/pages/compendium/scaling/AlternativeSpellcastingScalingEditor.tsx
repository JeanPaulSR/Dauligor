import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { db } from '../../../lib/firebase';
import { doc, getDoc, setDoc, updateDoc, collection, addDoc, deleteDoc, onSnapshot, query, orderBy } from 'firebase/firestore';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { ChevronLeft, Save, Plus, Trash2, Wand2 } from 'lucide-react';

export default function AlternativeSpellcastingScalingEditor({ userProfile }: { userProfile: any }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const [name, setName] = useState('');
  const [levels, setLevels] = useState<Record<string, any>>({});
  const [allScalings, setAllScalings] = useState<any[]>([]);

  useEffect(() => {
    // Fetch all scalings for copy functionality
    const unsubscribe = onSnapshot(query(collection(db, 'pactMagicScalings'), orderBy('name')), (snap) => {
      setAllScalings(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    if (id) {
      const fetchScaling = async () => {
        const docSnap = await getDoc(doc(db, 'pactMagicScalings', id));
        if (docSnap.exists()) {
          const data = docSnap.data();
          setName(data.name || '');
          setLevels(data.levels || {});
        }
      };
      fetchScaling();
    }
    return () => unsubscribe();
  }, [id]);

  const handleCopy = (scalingId: string) => {
    const scaling = allScalings.find(s => s.id === scalingId);
    if (scaling) {
      setLevels(scaling.levels || {});
      toast.success(`Copied progression from ${scaling.name}`);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Fill in placeholders
      const finalLevels = { ...levels };
      let lastSlotCount = 0;
      let lastSlotLevel = 1;
      
      for (let level = 1; level <= 20; level++) {
        const levelStr = level.toString();
        const currentLevelData = levels[levelStr];
        
        if (currentLevelData) {
          if (currentLevelData.slotCount !== undefined) lastSlotCount = currentLevelData.slotCount;
          if (currentLevelData.slotLevel !== undefined) lastSlotLevel = currentLevelData.slotLevel;
          finalLevels[levelStr] = { slotCount: lastSlotCount, slotLevel: lastSlotLevel };
        } else {
          finalLevels[levelStr] = { slotCount: lastSlotCount, slotLevel: lastSlotLevel };
        }
      }

      const scalingData = {
        name,
        levels: finalLevels,
        updatedAt: new Date().toISOString()
      };

      if (id) {
        await updateDoc(doc(db, 'pactMagicScalings', id), scalingData);
      } else {
        await addDoc(collection(db, 'pactMagicScalings'), {
          ...scalingData,
          createdAt: new Date().toISOString()
        });
      }
      navigate(-1);
      toast.success('Pact Magic scaling saved');
    } catch (error) {
      console.error("Error saving pact magic scaling:", error);
      toast.error('Failed to save.');
    } finally {
      setLoading(false);
    }
  };

  const updateLevel = (level: number, field: string, value: string) => {
    setLevels(prev => {
      const newLevels = { ...prev };
      const levelStr = level.toString();
      
      if (value === '') {
        if (newLevels[levelStr]) {
          const updated = { ...newLevels[levelStr] };
          delete updated[field];
          if (Object.keys(updated).length === 0) {
            delete newLevels[levelStr];
          } else {
            newLevels[levelStr] = updated;
          }
        }
      } else {
        const numVal = parseInt(value) || 0;
        newLevels[levelStr] = {
          ...(newLevels[levelStr] || {}),
          [field]: numVal
        };
      }
      
      return newLevels;
    });
  };

  const getPlaceholder = (level: number, field: string) => {
    for (let l = level - 1; l >= 1; l--) {
      const levelData = levels[l.toString()];
      if (levelData && levelData[field] !== undefined) {
        return levelData[field];
      }
    }
    return field === 'slotCount' ? 0 : 1;
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-20">
      <div className="section-header">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="text-gold gap-2 hover:bg-gold/5">
            <ChevronLeft className="w-4 h-4" /> Back
          </Button>
          <h1 className="text-2xl font-serif font-bold text-ink uppercase tracking-tight">
            {id ? `Edit ${name || 'Scaling'}` : 'New Pact Magic Scaling'}
          </h1>
        </div>
        <Button onClick={handleSave} disabled={loading} size="sm" className="btn-gold-solid gap-2">
          <Save className="w-4 h-4" /> Save Scaling
        </Button>
      </div>

      <div className="p-4 border border-gold/20 bg-card/50 space-y-6">
        <div className="space-y-1">
          <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40">Progression Name</label>
          <div className="flex gap-4">
            <Input 
              value={name} 
              onChange={e => setName(e.target.value)} 
              placeholder="e.g. Warlock" 
              className="h-8 text-sm bg-background/50 border-gold/10 focus:border-gold flex-1"
              required
            />
            <div className="flex items-center gap-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40 whitespace-nowrap">Copy From:</label>
              <select 
                onChange={e => handleCopy(e.target.value)}
                className="h-8 px-2 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-xs"
                value=""
              >
                <option value="" disabled>Select scaling...</option>
                {allScalings.filter(s => s.id !== id).map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="section-header">
            <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40">Level Progression</label>
            <span className="text-[9px] text-ink/30 italic uppercase">Define pact slots and their level</span>
          </div>
          
          <table className="w-full text-[10px] border-collapse">
            <thead>
              <tr className="text-gold/60 uppercase tracking-tighter">
                <th className="p-1 text-left w-10">Lvl</th>
                <th className="p-1 text-center">Slot Count</th>
                <th className="p-1 text-center">Slot Level</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gold/5">
              {Array.from({ length: 20 }, (_, i) => i + 1).map(level => {
                const levelData = levels[level.toString()];
                const isDefined = !!levelData;
                const slotCount = levelData?.slotCount ?? '';
                const slotLevel = levelData?.slotLevel ?? '';
                
                const countPlaceholder = getPlaceholder(level, 'slotCount');
                const levelPlaceholder = getPlaceholder(level, 'slotLevel');

                return (
                  <tr key={level} className="hover:bg-gold/5 transition-colors">
                    <td className="p-1 font-mono text-gold/40">{level}</td>
                    <td className="p-1">
                      <Input 
                        type="number"
                        value={slotCount}
                        onChange={e => updateLevel(level, 'slotCount', e.target.value)}
                        placeholder={countPlaceholder.toString()}
                        className={`h-6 text-[10px] text-center bg-transparent border-gold/10 focus:border-gold ${isDefined && levelData.slotCount !== undefined ? 'text-gold font-bold' : 'text-ink/20'}`}
                      />
                    </td>
                    <td className="p-1">
                      <select
                        value={slotLevel}
                        onChange={e => updateLevel(level, 'slotLevel', e.target.value)}
                        className={`w-full h-6 text-[10px] text-center bg-transparent border border-gold/10 rounded focus:border-gold outline-none ${!isDefined || levelData.slotLevel === undefined ? 'text-ink/20' : 'text-gold font-bold'}`}
                      >
                        {(!isDefined || levelData.slotLevel === undefined) && <option value="">{levelPlaceholder}{levelPlaceholder === 1 ? 'st' : levelPlaceholder === 2 ? 'nd' : levelPlaceholder === 3 ? 'rd' : 'th'}</option>}
                        {[1, 2, 3, 4, 5].map(lvl => (
                          <option key={lvl} value={lvl}>{lvl}{lvl === 1 ? 'st' : lvl === 2 ? 'nd' : lvl === 3 ? 'rd' : 'th'}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {id && (
        <div className="p-4 border border-blood/20 bg-blood/5">
          <Button 
            variant="ghost" 
            size="sm"
            className="w-full btn-danger border border-blood/20 gap-2 text-[10px] uppercase"
            onClick={async () => {
              if (confirm('Delete this scaling?')) {
                try {
                  await deleteDoc(doc(db, 'pactMagicScalings', id));
                  toast.success('Pact Magic scaling deleted');
                  navigate(-1);
                } catch (error) {
                  toast.error('Failed to delete scaling');
                }
              }
            }}
          >
            <Trash2 className="w-3 h-3" /> Delete Scaling
          </Button>
        </div>
      )}
    </div>
  );
}
