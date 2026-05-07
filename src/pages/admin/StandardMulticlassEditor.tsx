import React, { useState, useEffect } from 'react';
import { fetchDocument, upsertDocument } from '../../lib/d1';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Loader2, Save, Wand2 } from 'lucide-react';
import { toast } from 'sonner';

const SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

export default function StandardMulticlassEditor() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<any[]>([]);

  useEffect(() => {
    fetchDocument<any>('standardMulticlassProgression', 'master')
      .then(doc => {
        if (doc) {
          const levels = typeof doc.levels === 'string' ? JSON.parse(doc.levels) : doc.levels;
          setData(levels || []);
        } else {
          setData(Array.from({ length: 20 }, (_, i) => ({ level: i + 1, slots: Array(9).fill(0) })));
        }
        setLoading(false);
      })
      .catch(err => {
        console.error('Error loading multiclass progression:', err);
        toast.error('Failed to load multiclass progression.');
        setLoading(false);
      });
  }, []);

  const handleSlotChange = (levelIndex: number, slotIndex: number, value: string) => {
    const newData = [...data];
    const numValue = parseInt(value) || 0;
    newData[levelIndex].slots[slotIndex] = numValue;
    setData(newData);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await upsertDocument('standardMulticlassProgression', 'master', {
        levels: JSON.stringify(data),
        updated_at: new Date().toISOString(),
      });
      toast.success('Multiclass progression saved!');
    } catch (err) {
      console.error(err);
      toast.error('Failed to save progression');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="p-8 text-center animate-pulse text-gold/60 italic font-serif">Consulting the ancient charts...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-serif font-bold text-ink">Standard Multiclass Progression</h2>
          <p className="text-xs text-ink/40 italic">This table determines spell slots when multiple casting levels are combined.</p>
        </div>
        <Button 
          onClick={handleSave} 
          disabled={saving}
          className="bg-gold text-white hover:bg-gold/90 shadow-lg shadow-gold/20 gap-2"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save Progression
        </Button>
      </div>

      <div className="border border-gold/10 rounded-xl bg-card/30 overflow-hidden shadow-inner shadow-gold/5">
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gold/5 border-b border-gold/10">
                <th className="p-3 text-[10px] font-black uppercase tracking-widest text-gold text-center border-r border-gold/5">Lvl</th>
                {SLOTS.map(s => (
                  <th key={s} className="p-3 text-[10px] font-black uppercase tracking-widest text-gold text-center">
                    {s}{s === 1 ? 'st' : s === 2 ? 'nd' : s === 3 ? 'rd' : 'th'}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gold/5">
              {data.map((row, lIdx) => (
                <tr key={row.level} className="hover:bg-white/5 transition-colors group">
                  <td className="p-2 text-xs font-bold text-ink/60 text-center bg-gold/5 border-r border-gold/5 w-12 group-hover:text-gold transition-colors">
                    {row.level}
                  </td>
                  {SLOTS.map((_, sIdx) => (
                    <td key={sIdx} className="p-1">
                      <Input
                        type="number"
                        min="0"
                        max="9"
                        value={row.slots[sIdx] || 0}
                        onChange={(e) => handleSlotChange(lIdx, sIdx, e.target.value)}
                        className={`w-full h-8 text-center text-xs bg-transparent border-none focus:ring-1 focus:ring-gold/30 rounded-none ${row.slots[sIdx] > 0 ? 'text-gold font-bold' : 'text-ink/20'}`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="p-4 bg-gold/5 border border-gold/10 rounded-lg flex gap-3">
        <Wand2 className="w-5 h-5 text-gold shrink-0 mt-0.5" />
        <div className="space-y-1">
          <h4 className="text-xs font-bold text-ink/80">Casting Level Rules</h4>
          <p className="text-[10px] leading-relaxed text-ink/60">
            Total your levels in the bard, cleric, druid, sorcerer, and wizard classes, 
            half your levels (rounded down) in the paladin and ranger classes, 
            and a third of your levels (rounded down) in the fighter (Eldritch Knight) or rogue (Arcane Trickster) subclasses. 
            Then use the resulting level to determine your available spell slots from this table.
          </p>
        </div>
      </div>
    </div>
  );
}
