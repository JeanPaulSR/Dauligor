import { useState, useEffect } from 'react';
import { fetchDocument, upsertDocument } from '../../lib/d1';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Loader2, Save, Moon } from 'lucide-react';
import { toast } from 'sonner';

// Pact Magic master chart. Unlike standard (multiclass) spellcasting — where
// slots are spread across levels 1-9 — pact magic grants a fixed number of slots
// that are all the SAME level, scaling with the pact-caster's level. So each row
// is just { level, slots (count), slotLevel (1-5) }, stored as the `levels` JSON
// of a row in the shared `multiclass_master_chart` table (id 'pact').

interface PactRow {
  level: number;
  slots: number;     // number of pact slots at this caster level
  slotLevel: number; // the level those slots are cast at (1-5)
}

// SRD Warlock pact-magic progression — the sensible default when no chart exists.
const PACT_DEFAULT: PactRow[] = [
  { level: 1, slots: 1, slotLevel: 1 },
  { level: 2, slots: 2, slotLevel: 1 },
  { level: 3, slots: 2, slotLevel: 2 },
  { level: 4, slots: 2, slotLevel: 2 },
  { level: 5, slots: 2, slotLevel: 3 },
  { level: 6, slots: 2, slotLevel: 3 },
  { level: 7, slots: 2, slotLevel: 4 },
  { level: 8, slots: 2, slotLevel: 4 },
  { level: 9, slots: 2, slotLevel: 5 },
  { level: 10, slots: 2, slotLevel: 5 },
  { level: 11, slots: 3, slotLevel: 5 },
  { level: 12, slots: 3, slotLevel: 5 },
  { level: 13, slots: 3, slotLevel: 5 },
  { level: 14, slots: 3, slotLevel: 5 },
  { level: 15, slots: 3, slotLevel: 5 },
  { level: 16, slots: 3, slotLevel: 5 },
  { level: 17, slots: 4, slotLevel: 5 },
  { level: 18, slots: 4, slotLevel: 5 },
  { level: 19, slots: 4, slotLevel: 5 },
  { level: 20, slots: 4, slotLevel: 5 },
];

export default function PactCastingMasterEditor() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<PactRow[]>([]);

  useEffect(() => {
    fetchDocument<any>('pactMasterChart', 'pact')
      .then((doc) => {
        if (doc) {
          const levels = typeof doc.levels === 'string' ? JSON.parse(doc.levels) : doc.levels;
          setData(Array.isArray(levels) && levels.length ? levels : PACT_DEFAULT);
        } else {
          setData(PACT_DEFAULT);
        }
        setLoading(false);
      })
      .catch((err) => {
        console.error('Error loading pact magic progression:', err);
        toast.error('Failed to load pact magic progression.');
        setLoading(false);
      });
  }, []);

  const setField = (levelIndex: number, field: 'slots' | 'slotLevel', value: string) => {
    const next = [...data];
    const num = parseInt(value) || 0;
    next[levelIndex] = { ...next[levelIndex], [field]: num };
    setData(next);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await upsertDocument('pactMasterChart', 'pact', {
        levels: JSON.stringify(data),
        updated_at: new Date().toISOString(),
      });
      toast.success('Pact magic progression saved!');
    } catch (err) {
      console.error(err);
      toast.error('Failed to save progression');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="p-8 text-center animate-pulse text-gold/65 italic font-serif">Consulting the patron's pact...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-serif font-bold text-ink">Pact Magic Progression</h2>
          <p className="text-xs text-ink/45 italic">Fixed-level slots that scale with the pact caster's level (Warlock-style casting).</p>
        </div>
        <Button
          onClick={handleSave}
          disabled={saving}
          className="bg-gold text-[var(--primary-foreground)] hover:bg-gold/95 shadow-lg shadow-gold/25 gap-2"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save Progression
        </Button>
      </div>

      <div className="border border-gold/15 rounded-xl bg-card/30 overflow-hidden shadow-inner shadow-gold/5">
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gold/5 border-b border-gold/15">
                <th className="p-3 text-[10px] font-black uppercase tracking-widest text-gold text-center border-r border-gold/5">Lvl</th>
                <th className="p-3 text-[10px] font-black uppercase tracking-widest text-gold text-center">Pact Slots</th>
                <th className="p-3 text-[10px] font-black uppercase tracking-widest text-gold text-center">Slot Level</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gold/5">
              {data.map((row, lIdx) => (
                <tr key={row.level} className="hover:bg-white/5 transition-colors group">
                  <td className="p-2 text-xs font-bold text-ink/65 text-center bg-gold/5 border-r border-gold/5 w-12 group-hover:text-gold transition-colors">
                    {row.level}
                  </td>
                  <td className="p-1">
                    <Input
                      type="number" min="0" max="9"
                      value={row.slots || 0}
                      onChange={(e) => setField(lIdx, 'slots', e.target.value)}
                      className={`w-full h-8 text-center text-xs bg-transparent border-none focus:ring-1 focus:ring-gold/35 rounded-none ${row.slots > 0 ? 'text-gold font-bold' : 'text-ink/25'}`}
                    />
                  </td>
                  <td className="p-1">
                    <Input
                      type="number" min="0" max="9"
                      value={row.slotLevel || 0}
                      onChange={(e) => setField(lIdx, 'slotLevel', e.target.value)}
                      className={`w-full h-8 text-center text-xs bg-transparent border-none focus:ring-1 focus:ring-gold/35 rounded-none ${row.slotLevel > 0 ? 'text-gold font-bold' : 'text-ink/25'}`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="p-4 bg-gold/5 border border-gold/15 rounded-lg flex gap-3">
        <Moon className="w-5 h-5 text-gold shrink-0 mt-0.5" />
        <div className="space-y-1">
          <h4 className="text-xs font-bold text-ink/85">Pact Magic Rules</h4>
          <p className="text-[10px] leading-relaxed text-ink/65">
            Pact magic slots are separate from standard spell slots and recharge on a short or long rest.
            All pact slots are the same level, set by the caster's pact-caster level in this table.
            When multiclassing, pact slots stay independent of the Multiclass Master Chart.
          </p>
        </div>
      </div>
    </div>
  );
}
