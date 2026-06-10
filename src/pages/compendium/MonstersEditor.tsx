import React, { useEffect, useMemo, useState } from 'react';
import { fetchCollection } from '../../lib/d1';
import { upsertMonster, fetchMonster, deleteMonster } from '../../lib/compendium';
import { makeFoundryId, slugify } from '../../lib/utils';
import { Input } from '../../components/ui/input';
import {
  CompendiumEditorShell,
  type EditorListColumn,
} from '../../components/compendium/CompendiumEditorShell';
import { type FilterSection } from '../../components/compendium/SectionFilterPanel';
import { SectionFilterPanel } from '../../components/compendium/SectionFilterPanel';
import { useAxisFilters } from '../../hooks/useAxisFilters';
import { matchesSingleAxisFilter } from '../../lib/spellFilters';
import MonsterDetailPanel from '../../components/compendium/MonsterDetailPanel';
import {
  formatCr, crToXp, crToProfBonus, formatXp,
  CREATURE_TYPE_LABEL, SIZE_LABEL, CR_BANDS, crToBand,
} from '../../lib/monsterDisplay';

/**
 * Admin monster (NPC) editor — `/compendium/monsters/manage`. Mirrors
 * ItemsEditor/FeatsEditor via the shared `CompendiumEditorShell`: list | form |
 * live preview (the public `MonsterDetailPanel` renders the in-progress form
 * state via its `row` prop).
 *
 * Phase 1: scaffold + header scalars + camelCase save + preview. The `monsters`
 * table is camelCase with NO alias layer, so `upsertMonster` writes form keys
 * verbatim (it does NOT run normalizeCompendiumData). Loaded rows keep their
 * structured JSON columns (actions/traits/spellcasting/…) in form state and
 * round-trip untouched until later phases add their sub-editors.
 */

type SourceRecord = {
  id: string; name?: string; abbreviation?: string; shortName?: string; [k: string]: any;
};

type MonsterRow = {
  id: string; name?: string; identifier?: string; sourceId?: string;
  cr?: number | null; creatureType?: string; size?: string; [k: string]: any;
};

// The editable form shape is just "a monster row" (camelCase === columns).
type MonsterForm = Record<string, any>;

// Slim list projection (display + filter columns only; the full row loads on select).
const MONSTER_EDITOR_SELECT =
  'id, name, identifier, sourceId, cr, creatureType, size';

// Standard 5e challenge ratings, value = numeric column value.
const CR_OPTIONS: ReadonlyArray<[string, string]> = [
  ['0', '0'], ['0.125', '1/8'], ['0.25', '1/4'], ['0.5', '1/2'],
  ...Array.from({ length: 30 }, (_, i) => [String(i + 1), String(i + 1)] as [string, string]),
];

const CREATURE_TYPE_OPTIONS = Object.entries(CREATURE_TYPE_LABEL);
const SIZE_OPTIONS = Object.entries(SIZE_LABEL);

const AXIS_KEYS = ['cr', 'creatureType', 'size', 'source'] as const;

function blankForm(): MonsterForm {
  return {
    name: '', identifier: '', sourceId: '', page: '', sourceBook: '', sourceRules: '',
    cr: null, xp: null, creatureType: '', typeSubtype: '', swarmSize: '', size: '', alignment: '',
    ac: null, acNote: '', acFormula: '', hp: null, hpFormula: '',
    proficiencyBonus: null, passivePerception: null,
  };
}

export default function MonstersEditor({ userProfile }: { userProfile: any }) {
  const isAdmin = userProfile?.role === 'admin';
  const canManage = isAdmin || userProfile?.role === 'co-dm';

  const [monsters, setMonsters] = useState<MonsterRow[]>([]);
  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formData, setFormData] = useState<MonsterForm>(blankForm);

  const { axisFilters, cyclers, activeFilterCount, resetAll: resetFilters } =
    useAxisFilters(AXIS_KEYS);

  // ─── Load the catalog ───────────────────────────────────────────
  const reloadList = async () => {
    const rows = await fetchCollection<MonsterRow>('monsters', {
      select: MONSTER_EDITOR_SELECT, orderBy: 'name ASC',
    });
    setMonsters(rows);
    return rows;
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [, srcRes] = await Promise.all([
          reloadList(),
          fetchCollection<SourceRecord>('sources', { orderBy: 'name ASC' }),
        ]);
        if (cancelled) return;
        setSources(srcRes);
      } catch (err) {
        console.error('[MonstersEditor] failed to load:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const sourceById = useMemo(
    () => Object.fromEntries(sources.map((s) => [s.id, s])) as Record<string, SourceRecord>,
    [sources],
  );

  // ─── Hydrate the form when a row is selected ────────────────────
  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    (async () => {
      try {
        const full = await fetchMonster(selectedId);
        if (cancelled || !full) return;
        setFormData(full as MonsterForm);
      } catch (err) {
        console.error('[MonstersEditor] failed to load monster:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedId]);

  // ─── Filtering ──────────────────────────────────────────────────
  const filteredMonsters = useMemo(() => {
    const lowered = search.trim().toLowerCase();
    return monsters.filter((row) => {
      const matchesSearch =
        !lowered
        || String(row.name ?? '').toLowerCase().includes(lowered)
        || String(row.identifier ?? '').toLowerCase().includes(lowered)
        || String(row.creatureType ?? '').toLowerCase().includes(lowered);
      return (
        matchesSearch
        && matchesSingleAxisFilter(crToBand(row.cr), axisFilters.cr)
        && matchesSingleAxisFilter(String(row.creatureType ?? ''), axisFilters.creatureType)
        && matchesSingleAxisFilter(String(row.size ?? ''), axisFilters.size)
        && matchesSingleAxisFilter(String(row.sourceId ?? ''), axisFilters.source)
      );
    });
  }, [monsters, search, axisFilters]);

  const filterAxes = useMemo<FilterSection[]>(() => ([
    { key: 'cr', name: 'Challenge', kind: 'axis', values: CR_BANDS.map((v) => ({ ...v })) },
    { key: 'creatureType', name: 'Type', kind: 'axis', values: CREATURE_TYPE_OPTIONS.map(([value, label]) => ({ value, label })) },
    { key: 'size', name: 'Size', kind: 'axis', values: SIZE_OPTIONS.map(([value, label]) => ({ value, label })) },
    { key: 'source', name: 'Sources', kind: 'axis', values: sources.map((s) => ({ value: s.id, label: String(s.abbreviation || s.shortName || s.name || s.id) })) },
  ]), [sources]);

  // ─── List columns ───────────────────────────────────────────────
  const listColumns = useMemo<EditorListColumn<MonsterRow>[]>(() => ([
    {
      key: 'name', label: 'Name', width: 'minmax(0,1fr)', align: 'start',
      render: (row) => <span className="truncate font-serif text-sm text-ink">{row.name}</span>,
    },
    {
      key: 'cr', label: 'CR', width: '48px',
      render: (row) => <span className="text-xs font-mono tabular-nums text-ink/75 justify-self-center">{formatCr(row.cr)}</span>,
    },
    {
      key: 'source', label: 'Src', width: '52px',
      render: (row) => {
        const s = sourceById[String(row.sourceId ?? '')];
        return <span className="text-[11px] font-bold text-gold/80 justify-self-center">{s?.abbreviation || s?.shortName || (row as any).sourceBook || '—'}</span>;
      },
    },
  ]), [sourceById]);

  // ─── Lifecycle handlers ─────────────────────────────────────────
  const handleNew = () => {
    setSelectedId(null);
    setFormData(blankForm());
  };

  const handleReset = () => {
    if (selectedId) {
      fetchMonster(selectedId).then((full) => { if (full) setFormData(full as MonsterForm); });
    } else {
      setFormData(blankForm());
    }
  };

  const handleSave = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const name = String(formData.name ?? '').trim();
    if (!name) { alert('Name is required.'); return; }
    setSaving(true);
    try {
      const id = selectedId || makeFoundryId();
      const identifier = String(formData.identifier ?? '').trim() || slugify(name);
      // Strip id (passed separately to upsert) + coerce the numeric header columns.
      const { id: _omit, ...rest } = formData;
      const payload: MonsterForm = {
        ...rest,
        name,
        identifier,
        cr: numOrNull(formData.cr),
        xp: crToXp(numOrNull(formData.cr)),
        ac: numOrNull(formData.ac),
        hp: numOrNull(formData.hp),
        proficiencyBonus: numOrNull(formData.proficiencyBonus),
        passivePerception: numOrNull(formData.passivePerception),
      };
      await upsertMonster(id, payload);
      const rows = await reloadList();
      setSelectedId(id);
      const saved = rows.find((r) => r.id === id);
      // Keep the form in sync with what persisted (identifier/xp may have changed).
      setFormData((prev) => ({ ...prev, ...payload, id, ...(saved || {}) }));
    } catch (err) {
      console.error('[MonstersEditor] save failed:', err);
      alert('Failed to save monster. See console for details.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedId) return;
    if (!window.confirm(`Delete "${formData.name || 'this monster'}"? This cannot be undone.`)) return;
    try {
      await deleteMonster(selectedId);
      await reloadList();
      handleNew();
    } catch (err) {
      console.error('[MonstersEditor] delete failed:', err);
      alert('Failed to delete monster.');
    }
  };

  // ─── Derived preview values ─────────────────────────────────────
  const previewRow = useMemo(() => ({
    ...formData,
    xp: crToXp(numOrNull(formData.cr)),
  }), [formData]);

  const suggestedProf = crToProfBonus(numOrNull(formData.cr));
  const showProfNudge =
    suggestedProf != null && numOrNull(formData.proficiencyBonus) !== suggestedProf;

  // ─── Basics form body ───────────────────────────────────────────
  const set = (patch: Partial<MonsterForm>) => setFormData((prev) => ({ ...prev, ...patch }));

  const basicsBody = (
    <div className="space-y-4">
      <fieldset className="config-fieldset">
        <legend className="text-[10px] font-bold uppercase tracking-widest text-gold/75 px-1">Identity</legend>
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4 pt-1">
          <Field label="Name">
            <Input value={formData.name ?? ''} onChange={(e) => set({ name: e.target.value })}
              className="h-8 bg-background/50 border-gold/15 focus:border-gold text-sm" placeholder="e.g. Goblin Boss" required />
          </Field>
          <Field label="Identifier">
            <Input value={formData.identifier ?? ''} onChange={(e) => set({ identifier: e.target.value })}
              className="h-8 bg-background/50 border-gold/15 focus:border-gold font-mono text-sm"
              placeholder={slugify(formData.name || 'monster')} />
          </Field>
          <Field label="Source">
            <Sel value={formData.sourceId ?? ''} onChange={(v) => set({ sourceId: v })}
              options={[['', '— none —'], ...sources.map((s): [string, string] => [String(s.id), String(s.name || s.abbreviation || s.id)])]} />
          </Field>
          <Field label="Page">
            <Input value={formData.page ?? ''} onChange={(e) => set({ page: e.target.value })}
              className="h-8 bg-background/50 border-gold/15 focus:border-gold text-sm" placeholder="12" />
          </Field>
        </div>
      </fieldset>

      <fieldset className="config-fieldset">
        <legend className="text-[10px] font-bold uppercase tracking-widest text-gold/75 px-1">Type line</legend>
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4 pt-1">
          <Field label="Size">
            <Sel value={formData.size ?? ''} onChange={(v) => set({ size: v })}
              options={[['', '— size —'], ...SIZE_OPTIONS as [string, string][]]} />
          </Field>
          <Field label="Type">
            <Sel value={formData.creatureType ?? ''} onChange={(v) => set({ creatureType: v })}
              options={[['', '— type —'], ...CREATURE_TYPE_OPTIONS as [string, string][]]} />
          </Field>
          <Field label="Subtype">
            <Input value={formData.typeSubtype ?? ''} onChange={(e) => set({ typeSubtype: e.target.value || null })}
              className="h-8 bg-background/50 border-gold/15 focus:border-gold text-sm" placeholder="goblinoid" />
          </Field>
          <Field label="Alignment">
            <Input value={formData.alignment ?? ''} onChange={(e) => set({ alignment: e.target.value })}
              className="h-8 bg-background/50 border-gold/15 focus:border-gold text-sm" placeholder="Neutral Evil" />
          </Field>
        </div>
      </fieldset>

      <fieldset className="config-fieldset">
        <legend className="text-[10px] font-bold uppercase tracking-widest text-gold/75 px-1">Core stats</legend>
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4 pt-1">
          <Field label={`Challenge${formData.cr != null ? ` · ${formatXp(crToXp(numOrNull(formData.cr)))} XP` : ''}`}>
            <Sel value={formData.cr == null ? '' : String(Number(formData.cr))} onChange={(v) => set({ cr: v === '' ? null : Number(v) })}
              options={[['', '— CR —'], ...CR_OPTIONS]} />
          </Field>
          <Field label="Armor Class">
            <Input type="number" value={formData.ac ?? ''} onChange={(e) => set({ ac: e.target.value === '' ? null : Number(e.target.value) })}
              className="h-8 bg-background/50 border-gold/15 focus:border-gold text-sm" placeholder="15" />
          </Field>
          <Field label="AC Note">
            <Input value={formData.acNote ?? ''} onChange={(e) => set({ acNote: e.target.value })}
              className="h-8 bg-background/50 border-gold/15 focus:border-gold text-sm" placeholder="natural armor" />
          </Field>
          <Field label="Hit Points">
            <Input type="number" value={formData.hp ?? ''} onChange={(e) => set({ hp: e.target.value === '' ? null : Number(e.target.value) })}
              className="h-8 bg-background/50 border-gold/15 focus:border-gold text-sm" placeholder="21" />
          </Field>
          <Field label="HP Formula">
            <Input value={formData.hpFormula ?? ''} onChange={(e) => set({ hpFormula: e.target.value })}
              className="h-8 bg-background/50 border-gold/15 focus:border-gold font-mono text-sm" placeholder="6d8 + 6" />
          </Field>
          <Field label="Proficiency Bonus">
            <div className="flex items-center gap-1.5">
              <Input type="number" value={formData.proficiencyBonus ?? ''} onChange={(e) => set({ proficiencyBonus: e.target.value === '' ? null : Number(e.target.value) })}
                className="h-8 bg-background/50 border-gold/15 focus:border-gold text-sm" placeholder="2" />
              {showProfNudge ? (
                <button type="button" onClick={() => set({ proficiencyBonus: suggestedProf })}
                  className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-gold/80 hover:text-gold border border-gold/30 rounded px-1.5 h-8"
                  title={`Set to the CR-derived proficiency bonus (+${suggestedProf})`}>
                  →&nbsp;+{suggestedProf}
                </button>
              ) : null}
            </div>
          </Field>
        </div>
        <p className="text-[10px] text-ink/45 pt-1 px-1">XP follows the Challenge rating automatically. Proficiency bonus, saves, skills, and passive Perception keep their authored values — use the nudge to adopt the CR-derived value.</p>
      </fieldset>

      <p className="text-xs text-ink/50 italic px-1">
        Abilities, defenses, movement/senses, actions &amp; traits, spellcasting, lore, and tags arrive in the next phases — a loaded monster keeps all of those columns intact while you edit the header.
      </p>
    </div>
  );

  // ─── Render ─────────────────────────────────────────────────────
  return (
    <CompendiumEditorShell<MonsterRow>
      entityName={{ singular: 'Monster', plural: 'Monsters' }}
      backPath="/compendium/monsters"
      modes={[{ key: 'manual-editor', label: 'Manual Editor', render: null }]}
      isAdmin={canManage}
      listRows={filteredMonsters}
      listColumns={listColumns}
      loading={loading}
      selectedId={selectedId}
      onSelect={setSelectedId}
      onNew={handleNew}
      getRowId={(row) => row.id}
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder="Search monster name, type, or identifier"
      activeFilterCount={activeFilterCount}
      isFilterOpen={isFilterOpen}
      setIsFilterOpen={setIsFilterOpen}
      resetFilters={resetFilters}
      renderFilters={
        <SectionFilterPanel
          axes={filterAxes}
          axisFilters={axisFilters}
          tagStates={{}}
          cycleAxisState={cyclers.cycleAxisState}
          cycleAxisStateReverse={cyclers.cycleAxisStateReverse}
          cycleTagState={() => {}}
          cycleTagStateReverse={() => {}}
          cycleAxisCombineMode={cyclers.cycleAxisCombineMode}
          cycleAxisCombineModeReverse={cyclers.cycleAxisCombineModeReverse}
          cycleAxisExclusionMode={cyclers.cycleAxisExclusionMode}
          cycleAxisExclusionModeReverse={cyclers.cycleAxisExclusionModeReverse}
          axisIncludeAll={cyclers.axisIncludeAll}
          axisExcludeAll={cyclers.axisExcludeAll}
          axisClear={cyclers.axisClear}
          search={search}
          setSearch={setSearch}
          activeFilterCount={activeFilterCount}
          resetAll={resetFilters}
          embedded
        />
      }
      identityName={formData.name || ''}
      identitySourceAbbrev={sourceById[String(formData.sourceId ?? '')]?.abbreviation}
      identitySubtitle={formData.cr != null ? `CR ${formatCr(numOrNull(formData.cr))}` : undefined}
      onSave={handleSave}
      onDelete={selectedId ? handleDelete : undefined}
      onReset={handleReset}
      saving={saving}
      formId="monster-manual-editor-form"
      editorSubTabs={[{ key: 'basics', label: 'Basics', layout: 'scroll', render: () => basicsBody }]}
      tagsSubTabs={[{ key: 'tags', label: 'Tags', render: () => (
        <p className="text-sm text-ink/50 italic">Tag editing arrives in a later phase.</p>
      ) }]}
      renderPreview={() => (
        <MonsterDetailPanel
          monsterId={selectedId}
          row={previewRow}
          source={sourceById[String(formData.sourceId ?? '')]}
        />
      )}
    />
  );
}

// ─── small form helpers ───────────────────────────────────────────
function numOrNull(v: any): number | null {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="space-y-0.5 block">
      <span className="block text-[10px] font-bold uppercase tracking-widest text-ink/45">{label}</span>
      {children}
    </label>
  );
}

function Sel({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: ReadonlyArray<[string, string]> }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 w-full bg-background/50 border border-gold/15 focus:border-gold rounded-md px-2 text-sm text-ink"
    >
      {options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
    </select>
  );
}
