import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom';
import { db } from '../../../lib/firebase';
import { doc, getDoc, setDoc, updateDoc, collection, addDoc, deleteDoc, onSnapshot } from 'firebase/firestore';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { 
  Plus, 
  Trash2, 
  ChevronLeft, 
  Save,
  LayoutGrid
} from 'lucide-react';

export default function ScalingEditor({ userProfile }: { userProfile: any }) {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const parentId = searchParams.get('parentId');
  const parentType = searchParams.get('parentType') || 'class';

  const [name, setName] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (id) {
      const fetchScaling = async () => {
        const docSnap = await getDoc(doc(db, 'scalingColumns', id));
        if (docSnap.exists()) {
          const data = docSnap.data();
          setName(data.name || '');
          setValues(data.values || {});
        }
      };
      fetchScaling();
    }
  }, [id]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Fill in placeholders
      const finalValues = { ...values };
      let lastValue = '';
      for (let level = 1; level <= 20; level++) {
        const currentVal = values[level.toString()];
        if (currentVal) {
          lastValue = currentVal;
        } else if (lastValue) {
          finalValues[level.toString()] = lastValue;
        }
      }

      const scalingData = {
        name,
        parentId: parentId || (id ? (await getDoc(doc(db, 'scalingColumns', id))).data()?.parentId : ''),
        parentType: parentType || (id ? (await getDoc(doc(db, 'scalingColumns', id))).data()?.parentType : 'class'),
        values: finalValues,
        updatedAt: new Date().toISOString()
      };

      if (id) {
        await updateDoc(doc(db, 'scalingColumns', id), scalingData);
      } else {
        await addDoc(collection(db, 'scalingColumns'), {
          ...scalingData,
          createdAt: new Date().toISOString()
        });
      }
      navigate(-1);
      toast.success('Scaling column saved');
    } catch (error) {
      console.error("Error saving scaling column:", error);
      toast.error('Failed to save scaling column.');
    } finally {
      setLoading(false);
    }
  };

  const updateValue = (level: number, val: string) => {
    setValues(prev => {
      const newValues = { ...prev };
      if (val === '') {
        delete newValues[level.toString()];
      } else {
        newValues[level.toString()] = val;
      }
      return newValues;
    });
  };

  const getPlaceholder = (level: number) => {
    for (let l = level - 1; l >= 1; l--) {
      if (values[l.toString()]) return values[l.toString()];
    }
    return '—';
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-20">
      <div className="flex items-center justify-between border-b border-gold/10 pb-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="text-gold gap-2 hover:bg-gold/5">
            <ChevronLeft className="w-4 h-4" /> Back
          </Button>
          <h1 className="text-2xl font-serif font-bold text-ink uppercase tracking-tight">
            {id ? `Edit ${name || 'Scaling'}` : 'New Scaling Column'}
          </h1>
        </div>
        <Button onClick={handleSave} disabled={loading} size="sm" className="bg-gold hover:bg-gold/90 text-white gap-2">
          <Save className="w-4 h-4" /> Save Scaling
        </Button>
      </div>

      <div className="p-4 border border-gold/20 bg-card/50 space-y-6">
        <div className="space-y-1">
          <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40">Column Name</label>
          <Input 
            value={name} 
            onChange={e => setName(e.target.value)} 
            placeholder="e.g. Invocations Known, Sorcery Points" 
            className="h-8 text-sm bg-background/50 border-gold/10 focus:border-gold"
            required
          />
          <p className="text-[9px] text-ink/30 italic">This name will appear as the header in the class table.</p>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between border-b border-gold/10 pb-2">
            <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40">Level Progression</label>
            <span className="text-[9px] text-ink/30 italic uppercase">Values persist until the next defined level</span>
          </div>
          
          <div className="space-y-2">
            {Array.from({ length: 20 }, (_, i) => i + 1).map(level => {
              const placeholder = getPlaceholder(level);
              return (
                <div key={level} className="flex items-center gap-4 p-2 border border-gold/5 bg-gold/5 rounded group hover:bg-gold/10 transition-colors">
                  <div className="w-12 flex items-center gap-2">
                    <span className="text-[10px] font-bold text-gold/40">LVL {level}</span>
                    {values[level.toString()] && (
                      <div className="w-1.5 h-1.5 rounded-full bg-gold shadow-[0_0_8px_rgba(212,175,55,0.5)]" />
                    )}
                  </div>
                  <Input 
                    value={values[level.toString()] || ''} 
                    onChange={e => updateValue(level, e.target.value)}
                    placeholder={placeholder}
                    className={`flex-1 h-8 text-sm font-mono transition-all border-none shadow-none focus:ring-1 focus:ring-gold/30 ${
                      values[level.toString()] 
                      ? 'bg-gold/10 text-gold font-bold' 
                      : 'bg-transparent text-ink/20'
                    }`}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {id && (
        <div className="p-4 border border-blood/20 bg-blood/5">
          <Button 
            variant="ghost" 
            size="sm"
            className="w-full text-blood hover:bg-blood/10 border border-blood/20 gap-2 text-[10px] uppercase"
            onClick={async () => {
              if (confirm('Delete this scaling column?')) {
                try {
                  await deleteDoc(doc(db, 'scalingColumns', id));
                  toast.success('Scaling column deleted');
                  navigate(-1);
                } catch (error) {
                  toast.error('Failed to delete scaling column');
                }
              }
            }}
          >
            <Trash2 className="w-3 h-3" /> Delete Column
          </Button>
        </div>
      )}
    </div>
  );
}
