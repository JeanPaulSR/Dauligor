import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { ChevronLeft, Save, Plus, Trash2, Wand2 } from 'lucide-react';
import { fetchDocument, fetchCollection, upsertDocument, deleteDocument } from '../../../lib/d1';

export default function SpellsKnownScalingEditor({ userProfile }: { userProfile: any }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const [name, setName] = useState('');
  const [levels, setLevels] = useState<Record<string, any>>({});
  const [allScalings, setAllScalings] = useState<any[]>([]);

  useEffect(() => {
    // Fetch all scalings for copy functionality
    const loadAllScalings = async () => {
      const data = await fetchCollection<any>('spellsKnownScalings', { where: "type = 'known'", orderBy: 'name ASC' });
      setAllScalings(data);
    };
    loadAllScalings();

    if (id) {
      const fetchScaling = async () => {
        const data = await fetchDocument<any>('spellsKnownScalings', id);
        if (data) {
          setName(data.name || '');
          setLevels(typeof data.levels === 'string' ? JSON.parse(data.levels) : (data.levels || {}));
        }
      };
      fetchScaling();
    }
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
      let lastCantrips = 0;
      let lastSpellsKnown = 0;
      
      for (let level = 1; level <= 20; level++) {
        const levelStr = level.toString();
        const currentLevelData = levels[levelStr];
        
        if (currentLevelData) {
          if (currentLevelData.cantrips !== undefined) lastCantrips = currentLevelData.cantrips;
          if (currentLevelData.spellsKnown !== undefined) lastSpellsKnown = currentLevelData.spellsKnown;
          finalLevels[levelStr] = { cantrips: lastCantrips, spellsKnown: lastSpellsKnown };
        } else {
          finalLevels[levelStr] = { cantrips: lastCantrips, spellsKnown: lastSpellsKnown };
        }
      }

      const d1Data = {
        name,
        type: 'known',
        levels: finalLevels,
        updated_at: new Date().toISOString()
      };

      const saveId = id || crypto.randomUUID();
      await upsertDocument('spellsKnownScalings', saveId, d1Data);
      
      navigate(-1);
      toast.success('Spells Known scaling saved');
    } catch (error) {
      console.error("Error saving spells known scaling:", error);
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
    return 0;
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-20">
      <div className="section-header">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="text-gold gap-2 hover:bg-gold/5">
            <ChevronLeft className="w-4 h-4" /> Back
          </Button>
          <h1 className="text-2xl font-serif font-bold text-ink uppercase tracking-tight">
            {id ? `Edit ${name || 'Scaling'}` : 'New Spells Known Scaling'}
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
              placeholder="e.g. Sorcerer, Bard" 
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
            <span className="text-[9px] text-ink/30 italic uppercase">Define cantrips and spells known for each level</span>
          </div>
          
          <table className="w-full text-[10px] border-collapse">
            <thead>
              <tr className="text-gold/60 uppercase tracking-tighter">
                <th className="p-1 text-left w-10">Lvl</th>
                <th className="p-1 text-center">Cantrips Known</th>
                <th className="p-1 text-center">Spells Known</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gold/5">
              {Array.from({ length: 20 }, (_, i) => i + 1).map(level => {
                const levelData = levels[level.toString()];
                const isDefined = !!levelData;
                const cantrips = levelData?.cantrips ?? '';
                const spellsKnown = levelData?.spellsKnown ?? '';
                
                const cantripsPlaceholder = getPlaceholder(level, 'cantrips');
                const spellsKnownPlaceholder = getPlaceholder(level, 'spellsKnown');

                return (
                  <tr key={level} className="hover:bg-gold/5 transition-colors">
                    <td className="p-1 font-mono text-gold/40">{level}</td>
                    <td className="p-1">
                      <Input 
                        type="number"
                        value={cantrips}
                        onChange={e => updateLevel(level, 'cantrips', e.target.value)}
                        placeholder={cantripsPlaceholder.toString()}
                        className={`h-6 text-[10px] text-center bg-transparent border-gold/10 focus:border-gold ${isDefined && levelData.cantrips !== undefined ? 'text-gold font-bold' : 'text-ink/20'}`}
                      />
                    </td>
                    <td className="p-1">
                      <Input 
                        type="number"
                        value={spellsKnown}
                        onChange={e => updateLevel(level, 'spellsKnown', e.target.value)}
                        placeholder={spellsKnownPlaceholder.toString()}
                        className={`h-6 text-[10px] text-center bg-transparent border-gold/10 focus:border-gold ${isDefined && levelData.spellsKnown !== undefined ? 'text-gold font-bold' : 'text-ink/20'}`}
                      />
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
                  await deleteDocument('spellsKnownScalings', id);
                  toast.success('Spells Known scaling deleted');
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
