import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  fetchCollection,
  fetchDocument,
  upsertDocument,
  deleteDocument,
} from '../../lib/d1';
import { slugify } from '../../lib/utils';
import { reportClientError, OperationType } from '../../lib/firebase';
import { matchesSingleAxisFilter } from '../../lib/spellFilters';
import { useAxisFilters } from '../../hooks/useAxisFilters';
import {
  CompendiumEditorShell,
  type EditorMode,
  type EditorSubTab,
  type TagsSubTab,
  type EditorListColumn,
} from '../../components/compendium/CompendiumEditorShell';
import { SectionFilterPanel, type FilterSection } from '../../components/compendium/SectionFilterPanel';
import TagPicker from '../../components/compendium/TagPicker';
import { normalizeTagRow } from '../../lib/tagHierarchy';
import ActiveEffectEditor from '../../components/compendium/ActiveEffectEditor';
import MarkdownEditor from '../../components/MarkdownEditor';
import { ImageUpload } from '../../components/ui/ImageUpload';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';

/**
 * BackgroundFeatureEditor
 * ───────────────────────
 * Admin editor for the dedicated `background_features` table (migration
 * 20260601-1400) — the special feature(s) a background grants (e.g.
 * "Shelter of the Faithful"). First-class content of their own (design
 * decision 2026-06-01); a background references them via an ItemGrant
 * (wired in a later milestone). 2014-style features are hand-authored
 * here. Pattern E (CompendiumEditorShell), camelCase columns →
 * direct upsertDocument / fetchDocument (no normalize/denormalize); the
 * only boundary rename is tags (column) ↔ tagIds (form).
 *
 * Route: /compendium/background-features/manage (admin / content-creator).
 */

type FeatureForm = {
  id?: string;
  name: string;
  identifier: string;
  sourceId: string;
  page: string;
  imageUrl: string;
  description: string;
  effects: any[];
  tagIds: string[];
  createdAt?: string;
  updatedAt?: string;
  [key: string]: any;
};

function makeInitialForm(sources: any[] = []): FeatureForm {
  return {
    name: '', identifier: '', sourceId: sources[0]?.id || '', page: '', imageUrl: '',
    description: '', effects: [], tagIds: [],
  };
}

const NOOP_CYCLE_TAG = () => { /* no tag axes */ };
const NOOP_SET_TAG_STATES: React.Dispatch<React.SetStateAction<Record<string, number>>> = () => { /* no tag axes */ };
const EMPTY_TAG_STATES: Record<string, number> = {};
const AXIS_KEYS = ['source'] as const;
const COLLECTION = 'backgroundFeatures';

export default function BackgroundFeatureEditor({ userProfile }: { userProfile: any }) {
  const isAdmin = userProfile?.role === 'admin';
  const isContentCreator = !!userProfile?.permissions &&
    Object.prototype.hasOwnProperty.call(userProfile.permissions, 'content-creator');
  const canManage = isAdmin || isContentCreator;

  const [entries, setEntries] = useState<any[]>([]);
  const [sources, setSources] = useState<any[]>([]);
  const [tags, setTags] = useState<Array<{ id: string; name: string; groupId: string | null; parentTagId: string | null }>>([]);
  const [tagGroups, setTagGroups] = useState<Array<{ id: string; name: string }>>([]);

  const { axisFilters, cyclers, activeFilterCount, resetAll: resetAxisFilters } = useAxisFilters(AXIS_KEYS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  const [urlSearchParams, setUrlSearchParams] = useSearchParams();
  const [editingId, setEditingId] = useState<string | null>(urlSearchParams.get('editingId'));
  const [formData, setFormData] = useState<FeatureForm>(makeInitialForm());

  useEffect(() => {
    const current = urlSearchParams.get('editingId');
    if (editingId && editingId !== current) {
      setUrlSearchParams((prev) => { const n = new URLSearchParams(prev); n.set('editingId', editingId); return n; }, { replace: true });
    } else if (!editingId && current) {
      setUrlSearchParams((prev) => { const n = new URLSearchParams(prev); n.delete('editingId'); return n; }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId]);
  useEffect(() => {
    const u = urlSearchParams.get('editingId');
    if ((u || null) !== editingId) setEditingId(u || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlSearchParams]);

  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    (async () => {
      try {
        const [rows, sourceRows, tagRows, tagGroupRows] = await Promise.all([
          fetchCollection<any>(COLLECTION, { orderBy: 'name ASC' }),
          fetchCollection<any>('sources', { orderBy: 'name ASC' }),
          fetchCollection<any>('tags', { orderBy: 'name ASC' }),
          fetchCollection<any>('tagGroups', { orderBy: 'name ASC' }),
        ]);
        if (cancelled) return;
        setEntries(rows);
        setSources(sourceRows);
        setTags(tagRows.map((row: any) => {
          const n = normalizeTagRow(row);
          return { id: String(n.id), name: String(n.name || ''), groupId: n.groupId ?? null, parentTagId: n.parentTagId ?? null };
        }));
        setTagGroups(tagGroupRows.map((row: any) => ({ id: String(row.id), name: String(row.name || '') })));
        setLoading(false);
      } catch (err) {
        console.error('[BackgroundFeatureEditor] load failed:', err);
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [canManage]);

  useEffect(() => {
    if (editingId) return;
    if (formData.sourceId || sources.length === 0) return;
    setFormData((prev) => ({ ...prev, sourceId: sources[0].id }));
  }, [editingId, formData.sourceId, sources]);

  const sourceNameById = useMemo(() => Object.fromEntries(sources.map((s) => [s.id, s.name || s.abbreviation || s.id])), [sources]);
  const sourceAbbrevById = useMemo(() => Object.fromEntries(sources.map((s) => [s.id, s.abbreviation || s.shortName || s.name || s.id])), [sources]);

  const resetForm = () => {
    const initial = makeInitialForm(sources);
    setEditingId(null);
    setFormData(initial);
  };

  useEffect(() => {
    if (!editingId) return;
    let active = true;
    const hydrate = (row: any) => {
      const defaults = makeInitialForm(sources);
      setFormData({
        ...defaults,
        ...row,
        id: row.id,
        name: row.name || '',
        identifier: row.identifier || '',
        sourceId: row.sourceId || sources[0]?.id || '',
        page: String(row.page || ''),
        imageUrl: row.imageUrl || '',
        description: row.description || '',
        effects: Array.isArray(row.effects) ? row.effects : [],
        tagIds: Array.isArray(row.tags) ? row.tags : [],
      });
    };
    const cached = entries.find((e) => String(e.id) === editingId);
    if (cached) { hydrate(cached); return; }
    (async () => {
      try {
        const row = await fetchDocument<any>(COLLECTION, editingId);
        if (!active || !row) return;
        hydrate(row);
      } catch (err) {
        console.error('[BackgroundFeatureEditor] load row failed:', err);
      }
    })();
    return () => { active = false; };
  }, [editingId, entries, sources]);

  const refreshEntries = async () => {
    try {
      const rows = await fetchCollection<any>(COLLECTION, { orderBy: 'name ASC' });
      setEntries(rows);
    } catch (err) {
      console.error('[BackgroundFeatureEditor] refresh failed:', err);
    }
  };

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!formData.name.trim()) { toast.error('Feature name is required'); return; }
    if (!formData.sourceId) { toast.error('Source is required'); return; }
    setSaving(true);
    try {
      const payload: Record<string, any> = {
        name: formData.name.trim(),
        identifier: formData.identifier.trim() || slugify(formData.name),
        sourceId: formData.sourceId,
        page: formData.page.trim() || null,
        imageUrl: formData.imageUrl || null,
        description: formData.description || '',
        effects: Array.isArray(formData.effects) ? formData.effects : [],
        tags: Array.isArray(formData.tagIds) ? formData.tagIds : [],
        updatedAt: new Date().toISOString(),
      };
      const wasCreate = !editingId;
      const entryId = editingId || crypto.randomUUID();
      await upsertDocument(COLLECTION, entryId, { ...payload, createdAt: formData.createdAt || new Date().toISOString() });
      toast.success(`Feature ${wasCreate ? 'created' : 'updated'}`);
      await refreshEntries();
      resetForm();
    } catch (error) {
      console.error('[BackgroundFeatureEditor] save failed:', error);
      toast.error('Failed to save feature');
      reportClientError(error, editingId ? OperationType.UPDATE : OperationType.CREATE, `${COLLECTION}/${editingId || '(new)'}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editingId) return;
    if (!window.confirm('Delete this background feature?')) return;
    try {
      await deleteDocument(COLLECTION, editingId);
      toast.success('Feature deleted');
      await refreshEntries();
      resetForm();
    } catch (error) {
      console.error('[BackgroundFeatureEditor] delete failed:', error);
      toast.error('Failed to delete feature');
      reportClientError(error, OperationType.DELETE, `${COLLECTION}/${editingId}`);
    }
  };

  const filteredEntries = useMemo(() => {
    const lowered = search.trim().toLowerCase();
    return entries.filter((entry) => {
      if (lowered) {
        const abbrev = String(sourceAbbrevById[entry.sourceId] || '').toLowerCase();
        const hit = String(entry.name || '').toLowerCase().includes(lowered)
          || String(entry.identifier || '').toLowerCase().includes(lowered)
          || abbrev.includes(lowered);
        if (!hit) return false;
      }
      if (!matchesSingleAxisFilter(String(entry.sourceId ?? ''), axisFilters.source)) return false;
      return true;
    });
  }, [entries, search, sourceAbbrevById, axisFilters]);

  const filterAxes = useMemo<FilterSection[]>(() => ([{
    key: 'source', name: 'Sources', kind: 'axis',
    values: sources.map((s) => ({
      value: s.id,
      label: String(s.abbreviation || s.shortName || s.name || s.id),
      labelAlt: String(s.name || s.shortName || s.abbreviation || s.id),
    })),
  }]), [sources]);

  const editorSubTabs: EditorSubTab[] = useMemo(() => [
    {
      key: 'basics', label: 'Basics', layout: 'fill',
      render: () => <BasicsFields formData={formData} setFormData={setFormData} sources={sources} editingId={editingId} />,
    },
    {
      key: 'effects', label: 'Effects',
      render: () => (
        <div className="border-t border-gold/10 pt-4">
          <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-gold mb-2">Active Effects</h3>
          <p className="text-[10px] text-ink/40 italic mb-3">Optional — most background features are passive prose. Add effects only for ones that mechanically change the character.</p>
          <ActiveEffectEditor
            effects={formData.effects}
            onChange={(effects: any[]) => setFormData((prev) => ({ ...prev, effects }))}
            defaultImg={formData.imageUrl || null}
          />
        </div>
      ),
    },
  ], [formData, sources, editingId]);

  const tagsSubTabs: TagsSubTab[] = useMemo(() => [{
    key: 'tags',
    label: (<>Tags {formData.tagIds.length > 0 && <span className="ml-1 text-gold/70">({formData.tagIds.length})</span>}</>),
    render: () => (
      <TagPicker
        tags={tags}
        tagGroups={tagGroups}
        selectedIds={formData.tagIds}
        onChange={(next) => setFormData((prev) => ({ ...prev, tagIds: next }))}
        hint="Tag rules use these to decide which entries they include."
        emptyHint="No tags loaded yet."
      />
    ),
  }], [tags, tagGroups, formData.tagIds]);

  const listColumns: EditorListColumn<any>[] = useMemo(() => [
    {
      key: 'name', label: 'Name', width: 'minmax(0,1fr)', align: 'start',
      render: (entry: any) => (
        <span className="truncate font-serif text-sm text-ink">{entry.name || <em className="text-ink/40">Untitled</em>}</span>
      ),
    },
    {
      key: 'source', label: 'Src', width: '50px', align: 'center',
      render: (entry: any) => <span className="text-[10px] font-bold text-gold/80">{sourceAbbrevById[entry.sourceId] || '—'}</span>,
    },
  ], [sourceAbbrevById]);

  const modes: EditorMode[] = [{ key: 'manual-editor', label: 'Manual Editor', render: null }];

  if (!canManage) {
    return <div className="text-center py-20">Access Denied. Admins or content-creators only.</div>;
  }

  return (
    <CompendiumEditorShell<any>
      entityName={{ singular: 'Background Feature', plural: 'Background Features' }}
      backPath="/compendium/backgrounds"
      backLabel="Back To Backgrounds"
      modes={modes}
      defaultModeKey="manual-editor"
      manualEditorModeKey="manual-editor"
      isAdmin={isAdmin}
      listRows={filteredEntries}
      listColumns={listColumns}
      listRowHeight={36}
      loading={loading}
      selectedId={editingId}
      onSelect={(id) => setEditingId(id)}
      onNew={resetForm}
      getRowId={(row) => String(row.id)}
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder="Search feature name, identifier, or source"
      activeFilterCount={activeFilterCount}
      isFilterOpen={isFilterOpen}
      setIsFilterOpen={setIsFilterOpen}
      resetFilters={() => { setSearch(''); resetAxisFilters(); }}
      renderFilters={
        <SectionFilterPanel
          axes={filterAxes}
          axisFilters={axisFilters}
          tagStates={EMPTY_TAG_STATES}
          setTagStates={NOOP_SET_TAG_STATES}
          cycleAxisState={cyclers.cycleAxisState}
          cycleAxisStateReverse={cyclers.cycleAxisStateReverse}
          cycleTagState={NOOP_CYCLE_TAG}
          cycleTagStateReverse={NOOP_CYCLE_TAG}
          cycleAxisCombineMode={cyclers.cycleAxisCombineMode}
          cycleAxisCombineModeReverse={cyclers.cycleAxisCombineModeReverse}
          cycleAxisExclusionMode={cyclers.cycleAxisExclusionMode}
          cycleAxisExclusionModeReverse={cyclers.cycleAxisExclusionModeReverse}
          axisIncludeAll={cyclers.axisIncludeAll}
          axisExcludeAll={cyclers.axisExcludeAll}
          axisClear={cyclers.axisClear}
          search={search}
          setSearch={setSearch}
          searchPlaceholder="Search feature name, identifier, or source"
          activeFilterCount={activeFilterCount}
          resetAll={() => { setSearch(''); resetAxisFilters(); }}
          embedded
        />
      }
      filterTitle="Filter Background Features"
      identityName={formData.name}
      identitySourceAbbrev={formData.sourceId ? String(sourceAbbrevById[formData.sourceId] || formData.sourceId) : undefined}
      identitySourceFullName={formData.sourceId ? String(sourceNameById[formData.sourceId] || formData.sourceId) : undefined}
      identitySubtitle="Background Feature"
      onSave={(e) => void handleSave(e)}
      onDelete={editingId ? handleDelete : undefined}
      onReset={resetForm}
      saving={saving}
      formId="background-feature-editor-form"
      editorSubTabs={editorSubTabs}
      tagsSubTabs={tagsSubTabs}
      tagsSuperTabCount={formData.tagIds.length}
      renderPreview={(id) => {
        if (!id && !formData.name) {
          return <div className="px-6 py-12 text-center text-ink/50">Select or create a background feature to preview it here.</div>;
        }
        return (
          <div className="p-5 space-y-3">
            <div className="flex items-center gap-3">
              {formData.imageUrl ? <img src={formData.imageUrl} alt="" className="h-12 w-12 rounded border border-gold/20 object-cover" /> : null}
              <div>
                <h2 className="font-serif text-lg font-bold text-ink leading-tight">{formData.name || 'Untitled Feature'}</h2>
                <div className="text-[11px] text-ink/55 flex items-center gap-2">
                  {formData.sourceId ? <span className="font-bold text-gold/80">{sourceAbbrevById[formData.sourceId] || ''}</span> : null}
                  {formData.identifier ? <span className="font-mono">{formData.identifier}</span> : null}
                </div>
              </div>
            </div>
            {formData.effects.length > 0 && (
              <div className="text-[11px] text-ink/60">{formData.effects.length} active effect{formData.effects.length === 1 ? '' : 's'}</div>
            )}
            <p className="text-xs text-ink/45 italic border-t border-gold/10 pt-3">
              Authored as standalone content; a background grants it via an ItemGrant (wiring coming in the next milestone).
            </p>
          </div>
        );
      }}
    />
  );
}

// ─── Basics fields ──────────────────────────────────────────────────

function BasicsFields({
  formData,
  setFormData,
  sources,
  editingId,
}: {
  formData: FeatureForm;
  setFormData: React.Dispatch<React.SetStateAction<FeatureForm>>;
  sources: any[];
  editingId: string | null;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-[80px_minmax(0,1fr)] shrink-0">
        <ImageUpload
          currentImageUrl={formData.imageUrl}
          storagePath={`images/background-features/${editingId || 'draft'}/`}
          onUpload={(url) => setFormData((prev) => ({ ...prev, imageUrl: url }))}
          imageType="icon"
          compact
          className="h-[80px] w-[80px]"
        />
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
          <div className="space-y-0.5">
            <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/40">Name</Label>
            <Input
              value={formData.name}
              onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
              className="h-8 bg-background/50 border-gold/10 focus:border-gold text-sm"
              placeholder="e.g. Shelter of the Faithful"
              required
            />
          </div>
          <div className="space-y-0.5">
            <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/40">Identifier</Label>
            <Input
              value={formData.identifier}
              onChange={(e) => setFormData((prev) => ({ ...prev, identifier: e.target.value }))}
              className="h-8 bg-background/50 border-gold/10 focus:border-gold font-mono text-sm"
              placeholder={slugify(formData.name || 'feature')}
            />
          </div>
          <div className="space-y-0.5">
            <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/40">Source</Label>
            <select
              value={formData.sourceId}
              onChange={(e) => setFormData((prev) => ({ ...prev, sourceId: e.target.value }))}
              className="w-full h-8 px-2 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-sm"
            >
              <option value="">Select a source</option>
              {sources.map((source) => (<option key={source.id} value={source.id}>{source.name}</option>))}
            </select>
          </div>
          <div className="space-y-0.5">
            <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/40">Page</Label>
            <Input
              value={formData.page}
              onChange={(e) => setFormData((prev) => ({ ...prev, page: e.target.value }))}
              className="h-8 bg-background/50 border-gold/10 focus:border-gold text-sm"
              placeholder="e.g. 127"
            />
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-h-0 space-y-1">
        <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/40">Description</Label>
        <MarkdownEditor
          value={formData.description}
          onChange={(description) => setFormData((prev) => ({ ...prev, description }))}
          fillContainer
        />
      </div>
    </div>
  );
}
