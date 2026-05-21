import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { fetchCollection, upsertDocument, deleteDocument } from '../../lib/d1';
import { normalizeCompendiumData, denormalizeCompendiumData } from '../../lib/compendium';
import { ChevronLeft, Edit, Save, Trash2, Wrench } from 'lucide-react';
import { slugify, cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { ImageUpload } from '../ui/ImageUpload';
import MarkdownEditor from '../MarkdownEditor';
import ActivityEditor from './ActivityEditor';
import {
  useProposalAccumulator,
  useProposalContextOptional,
} from '../../lib/proposalAccumulator';
import { useProposalEntityDrafts } from '../../hooks/useProposalEntityDrafts';
import { actionLabel, type ProposalEntityType } from '../../lib/proposalAware';
import { useProposalReview, resolveReviewPayload, ReviewFieldHighlight } from '../../lib/proposalReview';
import { TombstoneRow } from '../proposals/TombstoneRow';
import { useBlock } from '../../lib/proposalBlock';

type DevelopmentFormData = {
  id?: string;
  name: string;
  identifier: string;
  sourceId: string;
  imageUrl: string;
  description: string;
  activities: any[];
  effectsStr: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: any;
};

interface DevelopmentCompendiumManagerProps {
  userProfile: any;
  collectionName: string;
  /**
   * Optional proposal entity-type. When set AND the component is
   * rendered inside a <ProposalEditorWrapper>, writes route through
   * the proposal accumulator (queue locally → flush via Submit
   * Changes) instead of upsertDocument. Outside a wrapper the value
   * is ignored — admin direct route keeps the old behavior.
   */
  entityType?: ProposalEntityType;
  title: string;
  singularLabel: string;
  icon: LucideIcon;
  description: string;
  backPath?: string;
  defaultData: Omit<DevelopmentFormData, 'sourceId'> & { sourceId?: string };
  renderSpecificFields: (
    formData: DevelopmentFormData,
    setFormData: React.Dispatch<React.SetStateAction<DevelopmentFormData>>
  ) => React.ReactNode;
  summarizeEntry?: (entry: any, sourceLabel: string) => React.ReactNode;
  normalizeBeforeSave?: (formData: DevelopmentFormData) => Record<string, any>;
}

function makeInitialForm(defaultData: DevelopmentCompendiumManagerProps['defaultData'], sources: any[] = []): DevelopmentFormData {
  return {
    ...defaultData,
    sourceId: defaultData.sourceId || sources[0]?.id || '',
    activities: Array.isArray(defaultData.activities) ? defaultData.activities : [],
    effectsStr: defaultData.effectsStr ?? '[]'
  } as DevelopmentFormData;
}

export default function DevelopmentCompendiumManager({
  userProfile,
  collectionName,
  entityType,
  title,
  singularLabel,
  icon: Icon,
  description,
  backPath = '/compendium',
  defaultData,
  renderSpecificFields,
  summarizeEntry,
  normalizeBeforeSave
}: DevelopmentCompendiumManagerProps) {
  const isAdmin = userProfile?.role === 'admin';
  const isContentCreator =
    !!userProfile?.permissions &&
    Object.prototype.hasOwnProperty.call(userProfile.permissions, 'content-creator');
  const canManage = isAdmin || isContentCreator;

  // Proposal-mode plumbing — when the manager is mounted inside a
  // <ProposalEditorWrapper> AND the parent passes an entityType, the
  // writer queues locally instead of POSTing directly. Outside a
  // wrapper (or with no entityType) this falls through to direct
  // upsertDocument / deleteDocument behavior.
  const proposalContext = useProposalContextOptional();
  // useProposalAccumulator needs an entity type to bind the writer
  // closure; pass a safe placeholder if the caller didn't provide one
  // (the writer is only USED when entityType is truthy + the wrapper
  // is mounted, so a placeholder is fine).
  const entityWriter = useProposalAccumulator(
    entityType ?? 'tag',
    userProfile,
  );
  const isProposalMode =
    !!entityType && !!proposalContext &&
    (entityWriter.mode === 'proposal' || entityWriter.mode === 'block');
  const { drafts: allDrafts, activeBundleId } = useBlock();
  const focusMode = proposalContext?.focusMode ?? 'drafts';
  const focusModeEnabled = proposalContext?.focusModeEnabled ?? false;
  // Review-mode wiring. When this manager owns the entityType being
  // reviewed (e.g. /proposals/edit/items + a feat proposal is a no-op),
  // we inject the proposed payload into entries + auto-select it.
  const reviewMode = useProposalReview();
  const reviewPayload = entityType
    ? resolveReviewPayload(reviewMode, entityType, null)
    : null;
  const isReviewingThis =
    !!reviewMode && !!entityType && !!reviewPayload &&
    reviewMode.entityType === entityType;

  const [entries, setEntries] = useState<any[]>([]);
  const [sources, setSources] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<DevelopmentFormData>(makeInitialForm(defaultData));

  // editingId mirror + dirty-detection refs for the auto-stage-on-
  // switch flow (same pattern as SpellsEditor + FeatsEditor).
  const editingIdRef = useRef<string | null>(null);
  useEffect(() => { editingIdRef.current = editingId; }, [editingId]);
  const formDataRef = useRef<DevelopmentFormData | null>(null);
  useEffect(() => { formDataRef.current = formData; }, [formData]);
  const lastLoadedFormRef = useRef<string>('');

  // Ids the user has staged in the active block — drives My Drafts
  // filtering AND the row-highlight in Browse mode.
  const draftedIds = useMemo(() => {
    const ids = new Set<string>();
    if (!entityType) return ids;
    if (proposalContext) {
      for (const q of proposalContext.queue) {
        if (q.entity_type === entityType && q.entity_id) ids.add(q.entity_id);
      }
    }
    if (activeBundleId) {
      for (const d of allDrafts) {
        if (
          d.entity_type === entityType &&
          d.entity_id &&
          d.bundle_id === activeBundleId
        ) {
          ids.add(d.entity_id);
        }
      }
    }
    return ids;
  }, [entityType, proposalContext, allDrafts, activeBundleId]);

  // Base entries the user has flipped to editable via "Edit Base ..."
  // — unlocks persist for the session, mirroring SpellsEditor.
  const [unlockedBaseIds, setUnlockedBaseIds] = useState<Set<string>>(new Set());
  const unlockBaseEntry = (id: string) => {
    setUnlockedBaseIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  // Read-only when focus mode is on AND the user hasn't claimed the
  // entry (no draft, not explicitly unlocked). New entries are never
  // read-only — they're the user's own work from the start.
  const isReadOnly =
    focusModeEnabled &&
    !!editingId &&
    !unlockedBaseIds.has(editingId) &&
    !draftedIds.has(editingId);

  const loadEntries = async () => {
    try {
      const items = await fetchCollection<any>(collectionName, { orderBy: 'name ASC' });

      // Denormalize: Map snake_case to camelCase and restore automation object
      const denormalized = items.map((item: any) => denormalizeCompendiumData(item));

      setEntries(denormalized);
      setLoading(false);
    } catch (err) {
      console.error(`Error loading ${collectionName}:`, err);
      setLoading(false);
    }
  };

  const loadSources = async () => {
    try {
      const data = await fetchCollection('sources', { orderBy: 'name ASC' });
      setSources(data);
    } catch (err) {
      console.error(`[${title}] Error loading sources:`, err);
    }
  };

  useEffect(() => {
    if (!canManage) return;
    loadEntries();
    loadSources();

    return () => {
      // No more unsubscribe needed for fetchCollection
    };
  }, [collectionName, canManage, title]);

  useEffect(() => {
    if (editingId) return;
    if (formData.sourceId || sources.length === 0) return;
    setFormData(prev => ({ ...prev, sourceId: sources[0].id }));
  }, [editingId, formData.sourceId, sources]);

  // Review mode: when sources finish loading and we're reviewing an
  // entity owned by this manager, inject the denormalized payload into
  // entries (replace existing row or append for create proposals) and
  // auto-select it so the right pane hydrates from the proposal.
  useEffect(() => {
    if (!isReviewingThis || !reviewPayload || sources.length === 0) return;
    const denormalized = denormalizeCompendiumData(reviewPayload);
    const targetId = reviewMode!.entityId ?? denormalized.id;
    if (!targetId) return;
    setEntries((prev) => {
      const exists = prev.some((e) => e.id === targetId);
      if (exists) {
        return prev.map((e) => (e.id === targetId ? { ...e, ...denormalized } : e));
      }
      return [...prev, { ...denormalized, id: targetId }];
    });
    if (editingId !== targetId) {
      const loaded: DevelopmentFormData = {
        ...makeInitialForm(defaultData, sources),
        ...denormalized,
        id: targetId,
        sourceId: denormalized.sourceId || sources[0]?.id || '',
        activities: Array.isArray(denormalized.automation?.activities)
          ? denormalized.automation.activities
          : Array.isArray(denormalized.activities)
            ? denormalized.activities
            : [],
        effectsStr: JSON.stringify(
          denormalized.automation?.effects || denormalized.effects || [],
          null,
          2,
        ),
      };
      setEditingId(targetId);
      setFormData(loaded);
      lastLoadedFormRef.current = JSON.stringify(loaded);
    }
  }, [isReviewingThis, reviewMode?.entityId, reviewPayload, sources, defaultData, editingId]);

  const resetForm = () => {
    const initial = makeInitialForm(defaultData, sources);
    setEditingId(null);
    setFormData(initial);
    lastLoadedFormRef.current = JSON.stringify(initial);
  };

  // Queued + drafted entity payloads for this entityType. Used to
  // surface in-progress items in the catalog before flush + approval.
  // useProposalEntityDrafts handles the null-entityType case for
  // generic-manager callers that don't pass one.
  const draftedEntities = useProposalEntityDrafts(entityType ?? null);

  // Merge queued/drafted payloads into the live catalog so a newly-
  // created item is visible + selectable for further editing without
  // having to flush first. Updates overlay on the existing row;
  // creates append as new rows; deletions stay in the list with a
  // __pendingDelete marker (Phase 1 tombstone UX — row renderer
  // switches to TombstoneRow for those, with undo).
  const displayEntries = useMemo(() => {
    if (
      draftedEntities.byId.size === 0 &&
      draftedEntities.deletedIds.size === 0
    ) {
      return entries;
    }
    const merged = entries.map((e) => {
      if (draftedEntities.deletedIds.has(String(e.id))) {
        return { ...e, __pendingDelete: true };
      }
      const overlay = draftedEntities.byId.get(String(e.id));
      return overlay ? { ...e, ...denormalizeCompendiumData(overlay) } : e;
    });
    for (const [draftId, payload] of draftedEntities.byId.entries()) {
      if (merged.some((e) => String(e.id) === draftId)) continue;
      merged.push({ ...denormalizeCompendiumData(payload), id: draftId });
    }
    return merged;
  }, [entries, draftedEntities]);

  // Filter to apply the focus-mode + dirty-aware load. Filters list
  // by drafted ids when focus mode = 'drafts'.
  const filteredEntries = useMemo(() => {
    if (!focusModeEnabled || focusMode !== 'drafts') return displayEntries;
    return displayEntries.filter((e) => draftedIds.has(String(e.id)));
  }, [displayEntries, focusModeEnabled, focusMode, draftedIds]);

  // Auto-stage on switch: in proposal mode, clicking a different
  // entry queues the outgoing one as a draft before loading the new
  // one. Without this, in-flight edits would vanish on row switch.
  const startEditing = async (entry: any) => {
    if (
      isProposalMode &&
      editingIdRef.current &&
      entry.id !== editingIdRef.current
    ) {
      const currentSerialized = JSON.stringify(formDataRef.current ?? formData);
      if (currentSerialized !== lastLoadedFormRef.current) {
        try {
          await handleSaveRef.current({ silent: true });
        } catch (err) {
          console.error('[DevelopmentCompendiumManager] auto-stage failed:', err);
          toast.error(`Could not stage previous ${singularLabel.toLowerCase()} — switching anyway.`);
        }
      }
    }
    const loaded: DevelopmentFormData = {
      ...makeInitialForm(defaultData, sources),
      ...entry,
      id: entry.id,
      sourceId: entry.sourceId || sources[0]?.id || '',
      activities: Array.isArray(entry.automation?.activities)
        ? entry.automation.activities
        : Array.isArray(entry.activities)
          ? entry.activities
          : [],
      effectsStr: JSON.stringify(entry.automation?.effects || entry.effects || [], null, 2)
    };
    setEditingId(entry.id);
    setFormData(loaded);
    lastLoadedFormRef.current = JSON.stringify(loaded);
  };

  const sourceNameById = useMemo(() => {
    return Object.fromEntries(sources.map(source => [source.id, source.name]));
  }, [sources]);

  const handleSave = async (
    eOrOpts?: React.FormEvent | { silent?: boolean },
    optsArg?: { silent?: boolean },
  ) => {
    // Distinguish form-event call from silent programmatic call.
    let opts: { silent?: boolean } = {};
    if (eOrOpts && typeof eOrOpts === 'object' && 'preventDefault' in eOrOpts) {
      (eOrOpts as React.FormEvent).preventDefault();
      opts = optsArg ?? {};
    } else if (eOrOpts) {
      opts = eOrOpts as { silent?: boolean };
    }

    if (!formData.name.trim()) {
      if (!opts.silent) toast.error(`${singularLabel} name is required`);
      return;
    }
    if (!formData.sourceId) {
      if (!opts.silent) toast.error('Source is required');
      return;
    }

    let parsedEffects: any[] = [];
    try {
      parsedEffects = formData.effectsStr ? JSON.parse(formData.effectsStr) : [];
      if (!Array.isArray(parsedEffects)) throw new Error('Effects must be a JSON array');
    } catch (error: any) {
      if (!opts.silent) toast.error(error.message || 'Effects must be valid JSON');
      return;
    }

    if (!opts.silent) setSaving(true);
    try {
      const basePayload: Record<string, any> = {
        ...formData,
        identifier: formData.identifier.trim() || slugify(formData.name),
        automation: {
          activities: Array.isArray(formData.activities)
            ? formData.activities
            : Object.values(formData.activities || {}),
          effects: parsedEffects
        },
        updatedAt: new Date().toISOString(),
        status: 'development'
      };

      delete basePayload.id;
      delete basePayload.activities;
      delete basePayload.effectsStr;

      const normalizedPayload = normalizeBeforeSave
        ? { ...basePayload, ...normalizeBeforeSave(formData) }
        : basePayload;

      // Final normalization for D1 columns (camelCase -> snake_case)
      const d1Payload = normalizeCompendiumData(normalizedPayload);

      Object.keys(d1Payload).forEach(key => {
        if (d1Payload[key] === undefined) delete d1Payload[key];
      });

      const entryIdAtStart = editingId;
      const wasCreate = !entryIdAtStart;
      const entryId = entryIdAtStart || crypto.randomUUID();

      if (isProposalMode) {
        // Proposal route — route through the writer (queues into
        // the active block) instead of upsertDocument. Strip server-
        // managed timestamps the proposal endpoint also drops.
        const { updated_at: _droppedUpdatedAt, ...proposalPayload } = d1Payload;
        if (wasCreate) {
          await entityWriter.create({ ...proposalPayload, id: entryId });
        } else {
          await entityWriter.update(entryId, proposalPayload);
        }
        if (!opts.silent) {
          toast.success(actionLabel(entityWriter.mode, wasCreate ? 'created' : 'updated'));
        }
        // Sync the dirty baseline to the just-sent form so a follow-
        // up Submit Changes (or switch) doesn't re-queue the same
        // payload as a no-op UPDATE for a row that may not have a
        // live entry yet. Mirrors SpellsEditor + FeatsEditor.
        lastLoadedFormRef.current = JSON.stringify(formDataRef.current ?? formData);
        // Adopt the saved id on create only when the user hasn't
        // navigated away during the await.
        if (wasCreate && !opts.silent && editingIdRef.current === entryIdAtStart) {
          setEditingId(entryId);
        }
      } else {
        // Admin direct route — same upsertDocument + refresh +
        // reset behavior as before this wiring.
        await upsertDocument(collectionName, entryId, d1Payload);
        if (!opts.silent) toast.success(`${singularLabel} ${entryIdAtStart ? 'updated' : 'created'}`);
        if (!opts.silent) resetForm();
        // Trigger a reload to show the new/updated entry.
        loadEntries();
      }
    } catch (error) {
      console.error(`Error saving ${collectionName} entry:`, error);
      if (!opts.silent) toast.error(`Failed to save ${singularLabel.toLowerCase()}`);
      if (opts.silent) throw error;
    } finally {
      if (!opts.silent) setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(`Delete this ${singularLabel.toLowerCase()}?`)) return;
    try {
      if (isProposalMode) {
        await entityWriter.remove(id);
        toast.success(actionLabel(entityWriter.mode, 'deleted'));
        // Live row stays until admin approval — no setEntries filter.
        if (editingId === id) resetForm();
      } else {
        await deleteDocument(collectionName, id);
        toast.success(`${singularLabel} deleted`);
        setEntries(prev => prev.filter(e => e.id !== id));
        if (editingId === id) resetForm();
      }
    } catch (error) {
      console.error(`Error deleting ${collectionName} entry:`, error);
      toast.error(`Failed to delete ${singularLabel.toLowerCase()}`);
    }
  };

  // Ref-mirrors for async callbacks (auto-stage, pre-flush).
  const handleSaveRef = useRef(handleSave);
  useEffect(() => { handleSaveRef.current = handleSave; });

  // Pre-flush: Submit Changes captures the currently-edited entry
  // before draining the wrapper's queue. Same dirty-check skips an
  // idle Submit so it doesn't queue a no-op.
  useEffect(() => {
    if (!isProposalMode || !proposalContext) return;
    return proposalContext.registerPreFlush(async () => {
      if (!editingIdRef.current) return;
      const currentSerialized = JSON.stringify(formDataRef.current ?? formData);
      if (currentSerialized === lastLoadedFormRef.current) return;
      try {
        await handleSaveRef.current({ silent: true });
      } catch (err) {
        console.error('[DevelopmentCompendiumManager] pre-flush stage failed:', err);
      }
    });
  }, [isProposalMode, proposalContext]);

  if (!canManage) {
    return <div className="text-center py-20">Access Denied. Admins or content-creators only.</div>;
  }

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-20">
      <div className="flex items-center gap-3 text-gold mb-2">
        <Icon className="w-6 h-6" />
        <span className="text-sm font-bold uppercase tracking-[0.3em]">Compendium Development</span>
      </div>

      {/* In proposal mode the wrapper already labels the page
          ("PROPOSAL EDITOR | <entity>") + provides Submit Changes.
          Slim the header to just the Back link so the form starts
          tight under the wrapper — same treatment as the other
          editors. Admin direct route keeps the full title block. */}
      {isProposalMode ? (
        <div className="flex items-center justify-between gap-2 pb-2 border-b border-gold/10">
          <Link to={backPath}>
            <Button variant="ghost" size="sm" className="text-gold gap-2 hover:bg-gold/5">
              <ChevronLeft className="w-4 h-4" /> Back
            </Button>
          </Link>
        </div>
      ) : (
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-4 mb-2">
              <Link to={backPath}>
                <Button variant="ghost" size="sm" className="text-gold gap-2 hover:bg-gold/5">
                  <ChevronLeft className="w-4 h-4" /> Back
                </Button>
              </Link>
            </div>
            <div className="flex items-center gap-4">
              <h1 className="text-4xl font-serif font-bold text-ink tracking-tight uppercase">{title}</h1>
            </div>
            <p className="text-ink/60 font-serif italic max-w-3xl">{description}</p>
            <p className="text-xs text-gold/80 border border-gold/10 bg-gold/5 rounded px-3 py-2 max-w-3xl">
              Admin development surface. These entries are for schema shaping and Foundry alignment while the workflow is still in progress.
            </p>
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-8">
        <div className="space-y-6 lg:col-span-2">
          <Card className="border-gold/20 bg-card/50">
            <CardContent className="p-6">
              <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-gold border-b border-gold/10 pb-2">
                {editingId ? `Edit ${singularLabel}` : `New ${singularLabel}`}
              </h2>

              <form onSubmit={handleSave} className="space-y-6 mt-4">
                <div className="grid md:grid-cols-2 gap-4">
                  <ReviewFieldHighlight columnKey="name" className="space-y-1">
                    <Label className="text-xs font-bold uppercase tracking-widest text-ink/40">Name</Label>
                    <Input
                      value={formData.name}
                      onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
                      className="bg-background/50 border-gold/10 focus:border-gold"
                      placeholder={`e.g. ${singularLabel}`}
                      required
                    />
                  </ReviewFieldHighlight>
                  <ReviewFieldHighlight columnKey="identifier" className="space-y-1">
                    <Label className="text-xs font-bold uppercase tracking-widest text-ink/40">Identifier</Label>
                    <Input
                      value={formData.identifier}
                      onChange={e => setFormData(prev => ({ ...prev, identifier: e.target.value }))}
                      className="bg-background/50 border-gold/10 focus:border-gold font-mono"
                      placeholder={slugify(formData.name || singularLabel)}
                    />
                  </ReviewFieldHighlight>
                  <ReviewFieldHighlight columnKey="source_id" className="space-y-1">
                    <Label className="text-xs font-bold uppercase tracking-widest text-ink/40">Source</Label>
                    <select
                      value={formData.sourceId}
                      onChange={e => setFormData(prev => ({ ...prev, sourceId: e.target.value }))}
                      className="w-full h-10 px-3 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-sm"
                    >
                      <option value="">Select a source</option>
                      {sources.map(source => (
                        <option key={source.id} value={source.id}>{source.name}</option>
                      ))}
                    </select>
                  </ReviewFieldHighlight>
                </div>

                <ReviewFieldHighlight columnKey="image_url" className="space-y-2">
                  <Label className="text-xs font-bold uppercase tracking-widest text-ink/40">Image</Label>
                  <ImageUpload
                    currentImageUrl={formData.imageUrl}
                    storagePath={`images/${collectionName}/${editingId || 'draft'}/`}
                    onUpload={(url) => setFormData(prev => ({ ...prev, imageUrl: url }))}
                  />
                </ReviewFieldHighlight>

                <ReviewFieldHighlight columnKey="description">
                  <MarkdownEditor
                    value={formData.description}
                    onChange={value => setFormData(prev => ({ ...prev, description: value }))}
                    label="Description"
                    placeholder={`Describe the ${singularLabel.toLowerCase()} in game terms and Foundry-facing behavior. Activities should carry runtime mechanics.`}
                    minHeight="220px"
                  />
                </ReviewFieldHighlight>

                {renderSpecificFields(formData, setFormData)}

                <div className="space-y-3">
                  <div className="border-t border-gold/10 pt-4">
                    <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-gold mb-2">Activities</h3>
                    <ActivityEditor
                      activities={formData.activities}
                      onChange={(activities) => setFormData(prev => ({ ...prev, activities }))}
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs font-bold uppercase tracking-widest text-ink/40">Effects (JSON)</Label>
                    <textarea
                      value={formData.effectsStr}
                      onChange={e => setFormData(prev => ({ ...prev, effectsStr: e.target.value }))}
                      className="w-full min-h-[160px] rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-xs font-mono p-3"
                      placeholder="[]"
                    />
                    <p className="text-[10px] text-ink/40">
                      Raw effect scaffolding for now. Activities should be the primary runtime surface, with effects for persistent states and automation support.
                    </p>
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                  {isReadOnly ? (
                    <Button
                      type="button"
                      className="bg-gold text-white gap-2"
                      onClick={() => editingId && unlockBaseEntry(editingId)}
                    >
                      <Edit className="w-4 h-4" />
                      Edit Base{formData.name ? ` "${formData.name}"` : ` ${singularLabel}`}
                    </Button>
                  ) : (
                    <>
                      {/* In proposal mode the wrapper's Submit Changes
                          captures the current entry via pre-flush, so the
                          per-entry Save button is redundant for existing
                          entries. New entries keep their explicit Save
                          (the user expects one-shot create + post-save
                          editingId hop). */}
                      {(!isProposalMode || !editingId) && (
                        <Button type="submit" className="bg-primary hover:bg-primary/90 text-primary-foreground gap-2" disabled={saving}>
                          <Save className="w-4 h-4" /> {saving ? 'Saving...' : `Save ${singularLabel}`}
                        </Button>
                      )}
                      <Button type="button" variant="ghost" className="text-ink/60 hover:text-gold" onClick={resetForm}>
                        Reset
                      </Button>
                    </>
                  )}
                </div>
              </form>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="border-gold/20 bg-card/50">
            <CardContent className="p-6">
              <div className="flex items-center justify-between border-b border-gold/10 pb-2 mb-4">
                <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-gold">{title} Drafts</h2>
                <div className="flex items-center gap-2 text-ink/40 text-xs">
                  <Wrench className="w-3 h-3" />
                  {entries.length}
                </div>
              </div>

              {loading ? (
                <div className="text-sm text-ink/40 italic">Loading…</div>
              ) : filteredEntries.length === 0 ? (
                <div className="text-sm text-ink/40 italic">
                  {focusModeEnabled && focusMode === 'drafts' && entries.length > 0
                    ? `No staged ${title.toLowerCase()} yet — switch to Browse Base to find one to edit.`
                    : `No ${title.toLowerCase()} drafted yet.`}
                </div>
              ) : (
                <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
                  {filteredEntries.map(entry => {
                    // Tombstone branch — render queued/drafted DELETEs
                    // with strike + Undo. Item delete is rare today
                    // (the Delete button is admin-only) but the path
                    // is here for consistency once propose-delete is
                    // wired into the manager.
                    if ((entry as any).__pendingDelete) {
                      return (
                        <TombstoneRow
                          key={entry.id}
                          size="md"
                          name={entry.name || `Untitled ${singularLabel}`}
                          onUndo={async () => {
                            if (proposalContext) await proposalContext.dropEntity(String(entry.id));
                          }}
                        >
                          {sourceNameById[entry.sourceId] || entry.sourceId || ''}
                        </TombstoneRow>
                      );
                    }
                    const sourceLabel = sourceNameById[entry.sourceId] || entry.sourceId || 'Unknown source';
                    // Highlight rows the user has staged in the active
                    // block — same archive-blue accents as SpellsEditor
                    // and FeatsEditor.
                    const drafted = focusModeEnabled && draftedIds.has(String(entry.id));
                    const selected = entry.id === editingId;
                    return (
                      <div
                        key={entry.id}
                        className={cn(
                          'border rounded-md p-3 space-y-2 transition-colors',
                          selected
                            ? 'border-gold/50 bg-gold/10'
                            : drafted
                              ? 'border-archive-blue/40 bg-archive-blue/5'
                              : 'border-gold/10 bg-background/30',
                        )}
                        title={
                          drafted
                            ? `${entry.name} — staged in this block`
                            : entry.name
                        }
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h3 className={cn(
                              "font-bold text-sm",
                              drafted && !selected ? 'text-archive-blue' : 'text-ink',
                            )}>
                              {entry.name}
                            </h3>
                            <p className="text-[10px] uppercase tracking-widest text-gold/70">{sourceLabel}</p>
                          </div>
                          <div className="flex gap-1">
                            <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0 text-gold" onClick={() => startEditing(entry)}>
                              <Edit className="w-3 h-3" />
                            </Button>
                            {!isProposalMode && (
                              <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0 text-blood" onClick={() => handleDelete(entry.id)}>
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            )}
                          </div>
                        </div>
                        <p className="text-[10px] text-ink/50 font-mono">{entry.identifier || '(no identifier)'}</p>
                        <div className="text-xs text-ink/70">
                          {summarizeEntry ? summarizeEntry(entry, sourceLabel) : `${(entry.automation?.activities || []).length || 0} activities`}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
