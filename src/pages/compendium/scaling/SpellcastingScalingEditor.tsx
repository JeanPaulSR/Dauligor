import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { ChevronLeft, Save, Plus, Trash2, Wand2 } from 'lucide-react';
import { fetchDocument, fetchCollection, upsertDocument, deleteDocument } from '../../../lib/d1';

export default function SpellcastingScalingEditor({ userProfile }: { userProfile: any }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const [name, setName] = useState('');
  const [levels, setLevels] = useState<Record<string, any>>({});
  const [allScalings, setAllScalings] = useState<any[]>([]);

  useEffect(() => {
    // Fetch all scalings for copy functionality
    const loadAllScalings = async () => {
      const data = await fetchCollection<any>('spellcastingScalings', { where: "type = 'standard'", orderBy: 'name ASC' });
      setAllScalings(data);
    };
    loadAllScalings();

    if (id) {
      const fetchScaling = async () => {
        const data = await fetchDocument<any>('spellcastingScalings', id);
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
      let lastSlots = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      
      for (let level = 1; level <= 20; level++) {
        const levelStr = level.toString();
        const currentLevelData = levels[levelStr];
        
        if (currentLevelData && currentLevelData.slots) {
          lastSlots = currentLevelData.slots;
        } else {
          finalLevels[levelStr] = { slots: [...lastSlots] };
        }
      }

      const d1Data = {
        name,
        type: 'standard',
        levels: finalLevels,
        updated_at: new Date().toISOString()
      };

      const saveId = id || crypto.randomUUID();
      await upsertDocument('spellcastingScalings', saveId, d1Data);
      
      navigate(-1);
      toast.success('Spellcasting scaling saved');
    } catch (error) {
      console.error("Error saving spellcasting scaling:", error);
      toast.error('Failed to save.');
    } finally {
      setLoading(false);
    }
  };

  const updateLevel = (level: number, field: string, value: string) => {
    setLevels(prev => {
      const newLevels = { ...prev };
      const levelStr = level.toString();
      
      if (field.startsWith('slot-')) {
        const slotIdx = parseInt(field.split('-')[1]);
        
        if (value === '') {
          if (newLevels[levelStr]) {
            const updatedSlots = [...newLevels[levelStr].slots];
            updatedSlots[slotIdx] = undefined as any; // Mark as undefined to use placeholder
            
            // If all slots are undefined, remove the level
            if (updatedSlots.every(s => s === undefined)) {
              delete newLevels[levelStr];
            } else {
              newLevels[levelStr] = { ...newLevels[levelStr], slots: updatedSlots };
            }
          }
        } else {
          const numVal = parseInt(value) || 0;
          let currentSlots;
          if (newLevels[levelStr]) {
            currentSlots = [...newLevels[levelStr].slots];
          } else {
            // Find last defined slots or start with zeros
            let lastDefinedSlots = [0, 0, 0, 0, 0, 0, 0, 0, 0];
            for (let l = level - 1; l >= 1; l--) {
              if (newLevels[l.toString()]) {
                lastDefinedSlots = [...newLevels[l.toString()].slots];
                break;
              }
            }
            currentSlots = lastDefinedSlots;
          }
          currentSlots[slotIdx] = numVal;
          newLevels[levelStr] = { ...newLevels[levelStr], slots: currentSlots };
        }
      }
      
      return newLevels;
    });
  };

  const getPlaceholder = (level: number, slotIdx: number) => {
    for (let l = level - 1; l >= 1; l--) {
      const levelData = levels[l.toString()];
      if (levelData && levelData.slots && levelData.slots[slotIdx] !== undefined) {
        return levelData.slots[slotIdx];
      }
    }
    return 0;
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-20">
      <div className="section-header">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="text-gold gap-2 hover:bg-gold/5">
            <ChevronLeft className="w-4 h-4" /> Back
          </Button>
          <h1 className="text-2xl font-serif font-bold text-ink uppercase tracking-tight">
            {id ? `Edit ${name || 'Scaling'}` : 'New Spellcasting Scaling'}
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
              placeholder="e.g. Full Caster, Half Caster, Warlock" 
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
          <p className="text-[9px] text-ink/30 italic">Common names: Full Caster, Half Caster, Third Caster.</p>
        </div>

        <div className="space-y-4 overflow-x-auto">
          <div className="section-header">
            <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40">Level Progression</label>
            <span className="text-[9px] text-ink/30 italic uppercase">Define cantrips and spell slots for each level</span>
          </div>
          
          <table className="w-full text-[10px] border-collapse min-w-[800px]">
            <thead>
              <tr className="text-gold/60 uppercase tracking-tighter">
                <th className="p-1 text-left w-10">Lvl</th>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(lvl => (
                  <th key={lvl} className="p-1 text-center w-10">{lvl}{lvl === 1 ? 'st' : lvl === 2 ? 'nd' : lvl === 3 ? 'rd' : 'th'}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gold/5">
              {Array.from({ length: 20 }, (_, i) => i + 1).map(level => {
                const levelData = levels[level.toString()];
                const slots = levelData?.slots || [0, 0, 0, 0, 0, 0, 0, 0, 0];
                const isDefined = !!levelData;

                return (
                  <tr key={level} className="hover:bg-gold/5 transition-colors">
                    <td className="p-1 font-mono text-gold/40">{level}</td>
                    {slots.map((val: number, idx: number) => {
                      const placeholder = getPlaceholder(level, idx);
                      const displayValue = isDefined ? val : '';
                      
                      return (
                        <td key={idx} className="p-1">
                          <Input 
                            type="number"
                            value={displayValue}
                            onChange={e => updateLevel(level, `slot-${idx}`, e.target.value)}
                            placeholder={placeholder.toString()}
                            className={`h-6 text-[10px] text-center bg-transparent border-gold/10 focus:border-gold ${isDefined && val > 0 ? 'text-gold font-bold' : 'text-ink/20'}`}
                          />
                        </td>
                      );
                    })}
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
                  await deleteDocument('spellcastingScalings', id);
                  toast.success('Spellcasting scaling deleted');
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
