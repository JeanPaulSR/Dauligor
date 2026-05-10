import React, { useEffect, useMemo, useState } from 'react';
import { Label } from '../ui/label';
import { fetchCollection } from '../../lib/d1';
import { fetchSpellSummaries } from '../../lib/spellSummary';
import { fetchAllRules, type SpellRule } from '../../lib/spellRules';
import EntityPicker from '../ui/EntityPicker';
import { cn } from '../../lib/utils';

/**
 * Editor sub-components for the two Layer 2 advancement types — `GrantSpells`
 * and `ExtendSpellList`. Both load their own foundation data (spells, rules,
 * classes) so AdvancementManager doesn't need to grow new responsibilities; the
 * d1 cache makes repeat loads free across mounts.
 *
 * GrantSpells: writes to character_spells when resolved on level-up.
 * ExtendSpellList: writes to character_spell_list_extensions; the spell still
 * has to be learned via the class's normal progression.
 */

type SpellOption = { id: string; name: string; level: number; school: string };
type ClassOption = { id: string; name: string };

const PREP_MODES: { value: string; label: string }[] = [
  { value: 'spell', label: 'Spell' },
  { value: 'pact', label: 'Pact' },
  { value: 'always', label: 'Always Prepared' },
  { value: 'innate', label: 'Innate' },
  { value: 'ritual', label: 'Ritual Only' },
];

const SCOPE_OPTIONS: { value: 'self' | 'all-spellcasting' | 'specific'; label: string; help: string }[] = [
  { value: 'self', label: 'Self (parent class only)', help: 'For subclass features — extends just the parent class\'s list (e.g. Divine Soul → Sorcerer)' },
  { value: 'all-spellcasting', label: 'All spellcasting classes', help: 'For feats — extends every class with a Spellcasting/Pact Magic feature (e.g. Chronomancy Initiate)' },
  { value: 'specific', label: 'Specific class', help: 'Pick which class this extension applies to' },
];

// ---------------------------------------------------------------------------
// GrantSpells
// ---------------------------------------------------------------------------

export function GrantSpellsConfigEditor({
  configuration,
  onChange,
}: {
  configuration: any;
  onChange: (next: any) => void;
}) {
  const cfg = useNormalizedGrantSpellsCfg(configuration);
  const { spells, rules, classes } = useSpellAdvancementFoundation();

  const updateField = (patch: Record<string, any>) => onChange({ ...configuration, ...patch });
  const updateResolver = (patch: Record<string, any>) =>
    onChange({ ...configuration, resolver: { ...(configuration.resolver || {}), ...patch } });

  const spellEntities = useMemo(
    () => spells.map(s => ({ id: s.id, name: s.name, hint: s.level === 0 ? 'C' : `L${s.level}` })),
    [spells],
  );
  const ruleEntities = useMemo(
    () => rules.map(r => ({ id: r.id, name: r.name, hint: r.description ? r.description.slice(0, 24) : undefined })),
    [rules],
  );
  const classEntities = useMemo(() => classes.map(c => ({ id: c.id, name: c.name })), [classes]);

  return (
    <div className="space-y-4">
      <ModeAndResolverPicker
        mode={cfg.mode}
        resolverKind={cfg.resolverKind}
        onModeChange={mode => updateField({ mode })}
        onResolverKindChange={kind => {
          if (kind === 'explicit') {
            updateField({ resolver: { kind: 'explicit', spellIds: cfg.resolver.spellIds || [] } });
          } else {
            updateField({ resolver: { kind: 'rule', ruleId: cfg.resolver.ruleId || '' } });
          }
        }}
      />

      {cfg.resolverKind === 'explicit' ? (
        <div className="space-y-1">
          <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/60">
            Spells {cfg.mode === 'choice' ? '(player picks from this pool)' : '(all granted)'}
          </Label>
          <EntityPicker
            entities={spellEntities}
            selectedIds={cfg.resolver.spellIds || []}
            onChange={spellIds => updateResolver({ spellIds })}
            searchPlaceholder="Search spells…"
            noEntitiesText="No spells loaded."
          />
        </div>
      ) : (
        <div className="space-y-1">
          <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/60">
            Source Rule {cfg.mode === 'choice' ? '(player picks from rule matches)' : '(all matches granted)'}
          </Label>
          <EntityPicker
            entities={ruleEntities}
            selectedIds={cfg.resolver.ruleId ? [cfg.resolver.ruleId] : []}
            onChange={ids => updateResolver({ ruleId: ids[0] || '' })}
            searchPlaceholder="Search rules…"
            noEntitiesText="No rules — author one on /compendium/spell-rules."
            single
          />
        </div>
      )}

      {cfg.mode === 'choice' ? (
        <div className="space-y-1">
          <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/60">Choice Count</Label>
          <input
            type="number"
            min={1}
            value={cfg.count}
            onChange={e => updateField({ count: Math.max(1, Number(e.target.value) || 1) })}
            className="w-24 h-9 px-3 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-sm"
          />
          <p className="text-[10px] text-ink/40">Player picks this many spells from the pool above.</p>
        </div>
      ) : null}

      <div className="space-y-1">
        <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/60">Counts as a Spell of Class</Label>
        <EntityPicker
          entities={classEntities}
          selectedIds={cfg.countsAsClassId ? [cfg.countsAsClassId] : []}
          onChange={ids => updateField({ countsAsClassId: ids[0] || null })}
          searchPlaceholder="Search classes…"
          single
          maxHeightClass="max-h-28"
        />
        <p className="text-[10px] text-ink/40">
          Determines spellcasting ability + slot pool. Leave empty for grants from feats / items / backgrounds —
          the spell will use whichever spellcasting class is active when cast.
        </p>
      </div>

      <div className="space-y-2">
        <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/60">Preparation</Label>
        <div className="grid grid-cols-1 gap-1.5">
          <ToggleRow
            label="Always prepared"
            help="The spell is always prepared once granted (Cleric Domain spells, Paladin Oath spells)."
            checked={cfg.alwaysPrepared}
            onChange={alwaysPrepared => updateField({ alwaysPrepared })}
          />
          <ToggleRow
            label="Doesn't count against prepared limit"
            help="Even when prepared, this spell doesn't consume a prepared-spell slot."
            checked={cfg.doesntCountAgainstPrepared}
            onChange={doesntCountAgainstPrepared => updateField({ doesntCountAgainstPrepared })}
          />
          <ToggleRow
            label="Doesn't count against spells known"
            help="For known-caster classes (Sorcerer, Bard, Wizard spellbook): doesn't consume a known/spellbook slot. (Magic Initiate, Chronomancy Initiate.)"
            checked={cfg.doesntCountAgainstKnown}
            onChange={doesntCountAgainstKnown => updateField({ doesntCountAgainstKnown })}
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/60">Default Preparation Mode</Label>
        <select
          value={cfg.preparationMode}
          onChange={e => updateField({ preparationMode: e.target.value })}
          className="w-full h-9 px-3 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-sm"
        >
          {PREP_MODES.map(m => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ExtendSpellList
// ---------------------------------------------------------------------------

export function ExtendSpellListConfigEditor({
  configuration,
  onChange,
}: {
  configuration: any;
  onChange: (next: any) => void;
}) {
  const cfg = useNormalizedExtendCfg(configuration);
  const { spells, rules, classes } = useSpellAdvancementFoundation();

  const updateField = (patch: Record<string, any>) => onChange({ ...configuration, ...patch });
  const updateResolver = (patch: Record<string, any>) =>
    onChange({ ...configuration, resolver: { ...(configuration.resolver || {}), ...patch } });

  const spellEntities = useMemo(
    () => spells.map(s => ({ id: s.id, name: s.name, hint: s.level === 0 ? 'C' : `L${s.level}` })),
    [spells],
  );
  const ruleEntities = useMemo(
    () => rules.map(r => ({ id: r.id, name: r.name })),
    [rules],
  );
  const classEntities = useMemo(() => classes.map(c => ({ id: c.id, name: c.name })), [classes]);

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/60">Source</Label>
        <select
          value={cfg.resolverKind}
          onChange={e => {
            const kind = e.target.value as 'rule' | 'explicit' | 'spellList';
            if (kind === 'rule') updateField({ resolver: { kind: 'rule', ruleId: cfg.resolver.ruleId || '' } });
            else if (kind === 'explicit') updateField({ resolver: { kind: 'explicit', spellIds: cfg.resolver.spellIds || [] } });
            else updateField({ resolver: { kind: 'spellList', classId: cfg.resolver.classId || '' } });
          }}
          className="w-full h-9 px-3 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-sm"
        >
          <option value="rule">From a Rule</option>
          <option value="spellList">Copy another class's spell list</option>
          <option value="explicit">Specific spells</option>
        </select>
      </div>

      {cfg.resolverKind === 'rule' ? (
        <div className="space-y-1">
          <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/60">Rule</Label>
          <EntityPicker
            entities={ruleEntities}
            selectedIds={cfg.resolver.ruleId ? [cfg.resolver.ruleId] : []}
            onChange={ids => updateResolver({ ruleId: ids[0] || '' })}
            searchPlaceholder="Search rules…"
            noEntitiesText="No rules — author one on /compendium/spell-rules."
            single
          />
        </div>
      ) : cfg.resolverKind === 'spellList' ? (
        <div className="space-y-1">
          <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/60">Source Class</Label>
          <EntityPicker
            entities={classEntities}
            selectedIds={cfg.resolver.classId ? [cfg.resolver.classId] : []}
            onChange={ids => updateResolver({ classId: ids[0] || '' })}
            searchPlaceholder="Search classes…"
            single
            maxHeightClass="max-h-28"
          />
          <p className="text-[10px] text-ink/40">
            Adds every spell from this class's master spell list. (Divine Soul Sorcerer copies Cleric's list.)
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/60">Spells</Label>
          <EntityPicker
            entities={spellEntities}
            selectedIds={cfg.resolver.spellIds || []}
            onChange={spellIds => updateResolver({ spellIds })}
            searchPlaceholder="Search spells…"
            noEntitiesText="No spells loaded."
          />
        </div>
      )}

      <div className="space-y-2">
        <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/60">Apply To</Label>
        <div className="space-y-1">
          {SCOPE_OPTIONS.map(opt => {
            const active = cfg.scope === opt.value;
            return (
              <label
                key={opt.value}
                className={cn(
                  'flex gap-2 px-3 py-2 rounded border cursor-pointer transition-colors',
                  active ? 'border-gold/60 bg-gold/[0.06]' : 'border-gold/15 hover:border-gold/30',
                )}
              >
                <input
                  type="radio"
                  name="extend-scope"
                  className="mt-1"
                  checked={active}
                  onChange={() => updateField({ scope: opt.value })}
                />
                <span className="space-y-0.5">
                  <span className="block text-sm text-ink font-bold">{opt.label}</span>
                  <span className="block text-[10px] text-ink/45">{opt.help}</span>
                </span>
              </label>
            );
          })}
        </div>
      </div>

      {cfg.scope === 'specific' ? (
        <div className="space-y-1">
          <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/60">Target Class</Label>
          <EntityPicker
            entities={classEntities}
            selectedIds={cfg.scopeClassId ? [cfg.scopeClassId] : []}
            onChange={ids => updateField({ scopeClassId: ids[0] || null })}
            searchPlaceholder="Search classes…"
            single
            maxHeightClass="max-h-28"
          />
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function useSpellAdvancementFoundation() {
  const [spells, setSpells] = useState<SpellOption[]>([]);
  const [rules, setRules] = useState<SpellRule[]>([]);
  const [classes, setClasses] = useState<ClassOption[]>([]);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetchSpellSummaries('level ASC, name ASC'),
      fetchAllRules(),
      fetchCollection<any>('classes', { orderBy: 'name ASC' }),
    ])
      .then(([spellData, ruleData, classData]) => {
        if (!active) return;
        setSpells(spellData.map((s: any) => ({
          id: s.id,
          name: s.name,
          level: Number(s.level || 0),
          school: s.school || '',
        })));
        setRules(ruleData);
        setClasses(classData.map((c: any) => ({ id: c.id, name: c.name })));
      })
      .catch(err => console.error('[SpellAdvancementEditors] foundation load failed:', err));
    return () => { active = false; };
  }, []);

  return { spells, rules, classes };
}

function useNormalizedGrantSpellsCfg(configuration: any) {
  const cfg = configuration || {};
  const resolverKind: 'explicit' | 'rule' = cfg.resolver?.kind === 'rule' ? 'rule' : 'explicit';
  return {
    mode: (cfg.mode === 'choice' ? 'choice' : 'fixed') as 'fixed' | 'choice',
    resolverKind,
    resolver: cfg.resolver || { kind: 'explicit', spellIds: [] },
    count: Number(cfg.count) > 0 ? Number(cfg.count) : 1,
    countsAsClassId: typeof cfg.countsAsClassId === 'string' && cfg.countsAsClassId ? cfg.countsAsClassId : null,
    alwaysPrepared: Boolean(cfg.alwaysPrepared),
    doesntCountAgainstPrepared: Boolean(cfg.doesntCountAgainstPrepared),
    doesntCountAgainstKnown: Boolean(cfg.doesntCountAgainstKnown),
    preparationMode: typeof cfg.preparationMode === 'string' && cfg.preparationMode ? cfg.preparationMode : 'spell',
  };
}

function useNormalizedExtendCfg(configuration: any) {
  const cfg = configuration || {};
  const resolverKind: 'rule' | 'explicit' | 'spellList' =
    cfg.resolver?.kind === 'explicit' ? 'explicit'
      : cfg.resolver?.kind === 'spellList' ? 'spellList'
        : 'rule';
  return {
    resolverKind,
    resolver: cfg.resolver || { kind: 'rule', ruleId: '' },
    scope: (['self', 'all-spellcasting', 'specific'].includes(cfg.scope) ? cfg.scope : 'self') as 'self' | 'all-spellcasting' | 'specific',
    scopeClassId: typeof cfg.scopeClassId === 'string' && cfg.scopeClassId ? cfg.scopeClassId : null,
  };
}

function ToggleRow({
  label,
  help,
  checked,
  onChange,
}: {
  label: string;
  help: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex gap-2 px-3 py-2 rounded border border-gold/15 hover:border-gold/30 cursor-pointer">
      <input
        type="checkbox"
        className="mt-1"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
      />
      <span className="space-y-0.5">
        <span className="block text-sm text-ink">{label}</span>
        <span className="block text-[10px] text-ink/45">{help}</span>
      </span>
    </label>
  );
}

function ModeAndResolverPicker({
  mode,
  resolverKind,
  onModeChange,
  onResolverKindChange,
}: {
  mode: 'fixed' | 'choice';
  resolverKind: 'explicit' | 'rule';
  onModeChange: (m: 'fixed' | 'choice') => void;
  onResolverKindChange: (k: 'explicit' | 'rule') => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1">
        <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/60">Mode</Label>
        <div className="flex gap-1.5">
          {(['fixed', 'choice'] as const).map(m => (
            <button
              key={m}
              type="button"
              onClick={() => onModeChange(m)}
              className={cn(
                'flex-1 h-9 rounded border text-xs font-bold uppercase tracking-wide transition-colors',
                mode === m
                  ? 'border-gold/60 bg-gold/15 text-gold'
                  : 'border-gold/15 text-ink/55 hover:border-gold/30 hover:text-gold/80',
              )}
            >
              {m === 'fixed' ? 'Fixed (auto-grant)' : 'Choice (player picks)'}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/60">Source</Label>
        <div className="flex gap-1.5">
          {(['explicit', 'rule'] as const).map(k => (
            <button
              key={k}
              type="button"
              onClick={() => onResolverKindChange(k)}
              className={cn(
                'flex-1 h-9 rounded border text-xs font-bold uppercase tracking-wide transition-colors',
                resolverKind === k
                  ? 'border-gold/60 bg-gold/15 text-gold'
                  : 'border-gold/15 text-ink/55 hover:border-gold/30 hover:text-gold/80',
              )}
            >
              {k === 'explicit' ? 'Specific Spells' : 'From a Rule'}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
