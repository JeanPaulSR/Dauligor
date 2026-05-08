import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import {
  Plus,
  Trash2,
  ChevronLeft,
  Save,
  LayoutGrid
} from 'lucide-react';
import { fetchDocument, upsertDocument, deleteDocument } from '../../../lib/d1';
import { slugify } from '../../../lib/utils';

const SCALE_TYPES: { value: ScaleType; label: string; hint: string }[] = [
  { value: 'number', label: 'Number', hint: 'Plain numeric value per level (Rages, Maneuvers Known, Brutal Critical Dice).' },
  { value: 'dice', label: 'Dice', hint: 'Dice expression per level (Sneak Attack, Spirit Shield, Superiority Dice). Accepted: 1d6, 2d8, d10, 3d6+2.' },
  { value: 'string', label: 'String', hint: 'Free-form text (Rage Damage "+2", flavor labels). Foundry will not coerce.' },
  { value: 'cr', label: 'Challenge Rating', hint: 'Numeric CR (used by features like Polymorph that scale on CR).' },
  { value: 'distance', label: 'Distance', hint: 'Numeric distance with units (Mage Hand range, Aura radius).' }
];

type ScaleType = 'number' | 'dice' | 'string' | 'cr' | 'distance';

const DISTANCE_UNITS = [
  { value: 'ft', label: 'Feet' },
  { value: 'mi', label: 'Miles' },
  { value: 'm', label: 'Metres' },
  { value: 'km', label: 'Kilometres' }
];

export default function ScalingEditor({ userProfile }: { userProfile: any }) {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const [parentId, setParentId] = useState(searchParams.get('parentId') || '');
  const [parentType, setParentType] = useState(searchParams.get('parentType') || 'class');

  const [name, setName] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [identifierTouched, setIdentifierTouched] = useState(false);
  const [type, setType] = useState<ScaleType>('number');
  const [distanceUnits, setDistanceUnits] = useState('ft');
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (id) {
      const fetchScaling = async () => {
        const data = await fetchDocument<any>('scaling_columns', id);
        if (data) {
          setName(data.name || '');
          setIdentifier(data.identifier || '');
          setIdentifierTouched(Boolean(data.identifier));
          const dbType = String(data.type || 'number').toLowerCase();
          setType((SCALE_TYPES.find((t) => t.value === dbType)?.value as ScaleType) || 'number');
          setDistanceUnits(data.distance_units || data.distanceUnits || 'ft');
          setValues(typeof data.values === 'string' ? JSON.parse(data.values) : (data.values || {}));
          setParentId(data.parent_id || data.parentId || '');
          setParentType(data.parent_type || data.parentType || 'class');
        }
      };
      fetchScaling();
    }
  }, [id]);

  // Auto-derive identifier from name until the user manually edits it.
  useEffect(() => {
    if (!identifierTouched) {
      setIdentifier(slugify(name));
    }
  }, [name, identifierTouched]);

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

      const d1Data: Record<string, any> = {
        name,
        identifier: identifier || slugify(name),
        type,
        parent_id: parentId,
        parent_type: parentType,
        values: finalValues,
        updated_at: new Date().toISOString()
      };
      if (type === 'distance') {
        d1Data.distance_units = distanceUnits || 'ft';
      } else {
        // Clear stale units if the type changed away from distance.
        d1Data.distance_units = null;
      }

      const saveId = id || crypto.randomUUID();
      await upsertDocument('scaling_columns', saveId, d1Data);

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
      <div className="section-header">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="text-gold gap-2 hover:bg-gold/5">
            <ChevronLeft className="w-4 h-4" /> Back
          </Button>
          <h1 className="text-2xl font-serif font-bold text-ink uppercase tracking-tight">
            {id ? `Edit ${name || 'Scaling'}` : 'New Scaling Column'}
          </h1>
        </div>
        <Button onClick={handleSave} disabled={loading} size="sm" className="btn-gold-solid gap-2">
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

        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40">Identifier</label>
            <Input
              value={identifier}
              onChange={(e) => { setIdentifier(slugify(e.target.value)); setIdentifierTouched(true); }}
              placeholder={slugify(name) || 'auto-derived from name'}
              className="h-8 text-sm bg-background/50 border-gold/10 focus:border-gold font-mono"
            />
            <p className="text-[9px] text-ink/30 italic">
              Stable slug used in formula references (<code>@scale.&lt;class&gt;.{identifier || slugify(name) || '<id>'}</code>).
              Auto-derived from name until you edit it.
            </p>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40">Type</label>
            <Select value={type} onValueChange={(v) => setType(v as ScaleType)}>
              <SelectTrigger className="h-8 text-sm bg-background/50 border-gold/10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCALE_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[9px] text-ink/30 italic">
              {SCALE_TYPES.find((t) => t.value === type)?.hint}
            </p>
          </div>
        </div>

        {type === 'distance' && (
          <div className="space-y-1 max-w-xs">
            <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40">Distance Units</label>
            <Select value={distanceUnits} onValueChange={setDistanceUnits}>
              <SelectTrigger className="h-8 text-sm bg-background/50 border-gold/10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DISTANCE_UNITS.map((u) => (
                  <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="space-y-4">
          <div className="section-header">
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
            className="w-full btn-danger border border-blood/20 gap-2 text-[10px] uppercase"
            onClick={async () => {
              if (confirm('Delete this scaling column?')) {
                try {
                  await deleteDocument('scaling_columns', id);
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
