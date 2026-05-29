import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Trash2, Save } from 'lucide-react';
import { fetchDocument } from '../../lib/d1';
import { slugify } from '../../lib/utils';
import { useProposalAccumulator, useProposalContextOptional } from '../../lib/proposalAccumulator';
import { useProposalEntityDrafts } from '../../hooks/useProposalEntityDrafts';
import { actionLabel } from '../../lib/proposalAware';

/**
 * ScalingMatrixEditor — the level-by-level scaling-column editor as a
 * reusable, prop-driven WIDGET (not a route page).
 *
 * Extracted from the old `pages/compendium/scaling/ScalingEditor` page so
 * the same matrix editor can be mounted in-place (as a modal inside
 * `ScalingColumnsPanel`) instead of navigating to a separate route. That
 * matters for two reasons:
 *   1. It's a genuine shared widget — class / subclass / feat / item
 *      scaling all edit the same shape, so it shouldn't be a one-off page.
 *   2. Mounting it in-place keeps it inside the parent editor's
 *      <ProposalEditorWrapper>, so a content-creator's save QUEUES into
 *      the active block. The old separate-route page was unwrapped, so a
 *      column authored there became a standalone proposal outside the
 *      block (the "route-boundary" problem). A widget has no such seam.
 *
 * The legacy `/compendium/scaling/*` route still works — its page is now a
 * thin wrapper around this widget (back-compat / direct links).
 *
 * Writes route through `useProposalAccumulator('scaling_column')`:
 * admins write directly, content-creators in a block queue.
 *
 * NOTE (flagged to proposal-system): the `scaling_column` proposal config's
 * writableColumns currently omits `type` / `identifier` / `distance_units`
 * (real columns, migration 20260508-1158), so a *proposed* column loses
 * them on approval until their config is widened. The direct (admin) path
 * is unaffected.
 */

export type ScaleType = 'number' | 'dice' | 'string' | 'cr' | 'distance';

const SCALE_TYPES: { value: ScaleType; label: string; hint: string }[] = [
  { value: 'number', label: 'Number', hint: 'Plain numeric value per level (Rages, Maneuvers Known, Brutal Critical Dice).' },
  { value: 'dice', label: 'Dice', hint: 'Dice expression per level (Sneak Attack, Spirit Shield, Superiority Dice). Accepted: 1d6, 2d8, d10, 3d6+2.' },
  { value: 'string', label: 'String', hint: 'Free-form text (Rage Damage "+2", flavor labels). Foundry will not coerce.' },
  { value: 'cr', label: 'Challenge Rating', hint: 'Numeric CR (used by features like Polymorph that scale on CR).' },
  { value: 'distance', label: 'Distance', hint: 'Numeric distance with units (Mage Hand range, Aura radius).' }
];

const DISTANCE_UNITS = [
  { value: 'ft', label: 'Feet' },
  { value: 'mi', label: 'Miles' },
  { value: 'm', label: 'Metres' },
  { value: 'km', label: 'Kilometres' }
];

export interface ScalingMatrixEditorProps {
  /** Column id to edit. `null` / `undefined` = create a new column. */
  columnId?: string | null;
  /** Owning entity id (class / subclass / feat / item …). */
  parentId: string;
  /** Owning entity kind — drives `parent_type`. */
  parentType: string;
  /** Active profile — drives the proposal-aware writer (admin vs content-creator-in-block). */
  userProfile: any;
  /** Fired after a successful save (parent closes the modal / navigates back). */
  onSaved?: () => void;
  /** Fired after a successful delete. */
  onDeleted?: () => void;
}

export default function ScalingMatrixEditor({
  columnId,
  parentId: parentIdProp,
  parentType: parentTypeProp,
  userProfile,
  onSaved,
  onDeleted,
}: ScalingMatrixEditorProps) {
  const [loading, setLoading] = useState(false);
  const [parentId, setParentId] = useState(parentIdProp);
  const [parentType, setParentType] = useState(parentTypeProp);

  const [name, setName] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [identifierTouched, setIdentifierTouched] = useState(false);
  const [type, setType] = useState<ScaleType>('number');
  const [distanceUnits, setDistanceUnits] = useState('ft');
  const [values, setValues] = useState<Record<string, string>>({});

  // Proposal-aware writer — passthrough to direct upsert for admins,
  // queues into the active block for content-creators.
  const writer = useProposalAccumulator('scaling_column', userProfile);
  const inBlock = useProposalContextOptional() !== null;
  // When editing a column that's still a block draft (created in this block,
  // no live row yet), load it from the queue instead of a live fetch that
  // would come back empty. Empty outside a <ProposalEditorWrapper>.
  const columnDrafts = useProposalEntityDrafts('scaling_column');

  // Keep parent identity in sync if the host reuses the widget for a
  // different owner (the modal may stay mounted across selections).
  useEffect(() => {
    setParentId(parentIdProp);
    setParentType(parentTypeProp);
  }, [parentIdProp, parentTypeProp]);

  // Load the column when editing; reset to a blank form when creating.
  useEffect(() => {
    if (columnId) {
      let active = true;
      const load = async () => {
        const data = columnDrafts.byId.get(columnId) ?? await fetchDocument<any>('scaling_columns', columnId);
        if (!active || !data) return;
        setName(data.name || '');
        setIdentifier(data.identifier || '');
        setIdentifierTouched(Boolean(data.identifier));
        const dbType = String(data.type || 'number').toLowerCase();
        setType((SCALE_TYPES.find((t) => t.value === dbType)?.value as ScaleType) || 'number');
        setDistanceUnits(data.distance_units || data.distanceUnits || 'ft');
        setValues(typeof data.values === 'string' ? JSON.parse(data.values) : (data.values || {}));
        setParentId(data.parent_id || data.parentId || parentIdProp);
        setParentType(data.parent_type || data.parentType || parentTypeProp);
      };
      load();
      return () => { active = false; };
    } else {
      setName('');
      setIdentifier('');
      setIdentifierTouched(false);
      setType('number');
      setDistanceUnits('ft');
      setValues({});
    }
  }, [columnId, parentIdProp, parentTypeProp]);

  // Auto-derive identifier from name until the user manually edits it.
  useEffect(() => {
    if (!identifierTouched) {
      setIdentifier(slugify(name));
    }
  }, [name, identifierTouched]);

  const handleSave = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setLoading(true);

    try {
      // Fill in placeholders — a level inherits the last defined value.
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

      const saveId = columnId || crypto.randomUUID();
      if (columnId) {
        await writer.update(saveId, d1Data);
      } else {
        await writer.create({ ...d1Data, id: saveId });
      }

      toast.success(
        writer.mode === 'proposal'
          ? (inBlock ? 'Scaling column added to block' : 'Scaling column submitted for review')
          : 'Scaling column saved',
      );
      onSaved?.();
    } catch (error) {
      console.error('Error saving scaling column:', error);
      toast.error('Failed to save scaling column.');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!columnId) return;
    if (!confirm('Delete this scaling column?')) return;
    try {
      await writer.remove(columnId);
      toast.success(actionLabel(writer.mode, 'deleted'));
      onDeleted?.();
    } catch (error) {
      console.error('Error deleting scaling column:', error);
      toast.error('Failed to delete scaling column');
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
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-lg font-serif font-bold text-ink uppercase tracking-tight truncate">
          {columnId ? `Edit ${name || 'Scaling'}` : 'New Scaling Column'}
        </h3>
        <Button onClick={() => handleSave()} disabled={loading} size="sm" className="btn-gold-solid gap-2 shrink-0">
          <Save className="w-4 h-4" /> Save
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

      {columnId && (
        <div className="p-4 border border-blood/20 bg-blood/5">
          <Button
            variant="ghost"
            size="sm"
            className="w-full btn-danger border border-blood/20 gap-2 text-[10px] uppercase"
            onClick={handleDelete}
          >
            <Trash2 className="w-3 h-3" /> Delete Column
          </Button>
        </div>
      )}
    </div>
  );
}
