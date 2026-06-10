import React, { useEffect, useMemo, useState } from 'react';
import { fetchCollection } from '../../lib/d1';
import { upsertMonster, fetchMonster, deleteMonster } from '../../lib/compendium';
import { makeFoundryId, slugify } from '../../lib/utils';
import {
  CompendiumEditorShell,
  type EditorListColumn,
} from '../../components/compendium/CompendiumEditorShell';
import { SectionFilterPanel, type FilterSection } from '../../components/compendium/SectionFilterPanel';
import { useAxisFilters } from '../../hooks/useAxisFilters';
import { matchesSingleAxisFilter } from '../../lib/spellFilters';
import MonsterDetailPanel from '../../components/compendium/MonsterDetailPanel';
import {
  formatCr, crToXp, CREATURE_TYPE_LABEL, SIZE_LABEL, CR_BANDS, crToBand,
} from '../../lib/monsterDisplay';
import MonsterBasicsTab from '../../components/compendium/monster/MonsterBasicsTab';
import MonsterDefensesTab from '../../components/compendium/monster/MonsterDefensesTab';
import MonsterMovementSensesTab from '../../components/compendium/monster/MonsterMovementSensesTab';
import { numOrNull, type MonsterForm, type SetForm } from '../../components/compendium/monster/fields';
import MarkdownEditor from '../../components/MarkdownEditor';
import TagPicker from '../../components/compendium/TagPicker';

/**
 * Admin monster (NPC) editor — `/compendium/monsters/manage`. Built on the
 * shared `CompendiumEditorShell` (list | form sub-tabs | live preview, the
 * public `MonsterDetailPanel` via its `row` prop). The `monsters` table is
 * camelCase with NO alias layer, so `upsertMonster` writes form keys verbatim.
 *
 * P1 = Basics header. P2 = abilities + saves/skills (Defenses) + movement/senses.
 * Loaded rows keep their structured JSON columns (actions/traits/spellcasting/…)
 * in form state and round-trip untouched until later phases add their sub-editors.
 */

type SourceRecord = {
  id: string; name?: string; abbreviation?: string; shortName?: string; [k: string]: any;
};

type MonsterRow = {
  id: string; name?: string; identifier?: string; sourceId?: string;
  cr?: number | null; creatureType?: string; size?: string; [k: string]: any;
};

const MONSTER_EDITOR_SELECT = 'id, name, identifier, sourceId, cr, creatureType, size';

const CREATURE_TYPE_OPTIONS = Object.entries(CREATURE_TYPE_LABEL);
const SIZE_OPTIONS = Object.entries(SIZE_LABEL);
const AXIS_KEYS = ['cr', 'creatureType', 'size', 'source'] as const;

function blankForm(): MonsterForm {
  return {
    name: '', identifier: '', sourceId: '', page: '', sourceBook: '', sourceRules: '',
    cr: null, xp: null, creatureType: '', typeSubtype: '', swarmSize: '', size: '', alignment: '',
    ac: null, acNote: '', acFormula: '', hp: null, hpFormula: '',
    proficiencyBonus: null, passivePerception: null,
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    saves: {}, skills: {},
    movement: { walk: 30, units: 'ft' },
    senses: { units: 'ft' },
  };
}

export default function MonstersEditor({ userProfile }: { userProfile: any }) {
  const canManage = userProfile?.role === 'admin' || userProfile?.role === 'co-dm';

  const [monsters, setMonsters] = useState<MonsterRow[]>([]);
  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [languages, setLanguages] = useState<Array<{ id: string; name?: string; identifier?: string }>>([]);
  const [tags, setTags] = useState<any[]>([]);
  const [tagGroups, setTagGroups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formData, setFormData] = useState<MonsterForm>(blankForm);
  const set: SetForm = (patch) => setFormData((prev) => ({ ...prev, ...patch }));

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
        const [, srcRes, langRes, tagRes, groupRes] = await Promise.all([
          reloadList(),
          fetchCollection<SourceRecord>('sources', { orderBy: 'name ASC' }),
          fetchCollection<any>('languages', { orderBy: 'name ASC' }).catch(() => []),
          fetchCollection<any>('tags', { orderBy: 'name ASC' }).catch(() => []),
          fetchCollection<any>('tagGroups', { orderBy: 'name ASC' }).catch(() => []),
        ]);
        if (cancelled) return;
        setSources(srcRes);
        setLanguages(langRes);
        setTags(tagRes.map((t: any) => ({ ...t, groupId: t.group_id ?? t.groupId ?? null })));
        setTagGroups(groupRes.map((g: any) => ({ id: g.id, name: g.name })));
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

  // Language chip options — value = the slug the imported corpus stores
  // (lowercase identifier), label = the display name.
  const languageOptions = useMemo<Array<[string, string]>>(
    () => languages.map((l) => [
      String(l.identifier || slugify(l.name || '') || l.id).toLowerCase(),
      String(l.name || l.identifier || l.id),
    ]),
    [languages],
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
      const { id: _omit, ...rest } = formData;
      const bio = String(formData.biography || '');
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
        // Short teaser mirrors the importer (first slice of the biography).
        description: bio ? bio.slice(0, 240) : (rest.description ?? ''),
      };
      await upsertMonster(id, payload);
      const rows = await reloadList();
      setSelectedId(id);
      const saved = rows.find((r) => r.id === id);
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

  // Live-preview row: form state + derived XP.
  const previewRow = useMemo(() => ({
    ...formData,
    xp: crToXp(numOrNull(formData.cr)),
  }), [formData]);

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
      editorSubTabs={[
        { key: 'basics', label: 'Basics', layout: 'scroll', render: () => <MonsterBasicsTab form={formData} set={set} sources={sources} monsterId={selectedId} /> },
        { key: 'defenses', label: 'Defenses', layout: 'scroll', render: () => <MonsterDefensesTab form={formData} set={set} languages={languageOptions} /> },
        { key: 'movement', label: 'Move & Senses', layout: 'scroll', render: () => <MonsterMovementSensesTab form={formData} set={set} /> },
        { key: 'lore', label: 'Lore', layout: 'fill', render: () => (
          <div className="flex flex-col flex-1 min-h-0">
            <span className="block text-[10px] font-bold uppercase tracking-widest text-gold/75 pb-1">Biography</span>
            <MarkdownEditor
              value={String(formData.biography || '')}
              onChange={(v) => set({ biography: v })}
              fillContainer
              className="flex-1 min-h-0"
            />
          </div>
        ) },
      ]}
      tagsSuperTabCount={(formData.tags || []).length}
      tagsSubTabs={[{ key: 'tags', label: 'Tags', render: () => (
        <TagPicker
          tags={tags}
          tagGroups={tagGroups}
          selectedIds={formData.tags || []}
          onChange={(next: string[]) => set({ tags: next })}
          hint="Tags categorise monsters for browsing + future encounter tooling."
          emptyHint="No tags loaded yet."
        />
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
