import React, { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Dialog, DialogContent } from '../../components/ui/dialog';
import {
  Repeat,
  Check,
  Search,
  Database,
  CloudOff,
  ChevronLeft,
  Trash2,
  Save,
  Plus,
  Edit,
} from 'lucide-react';
import { fetchCollection, fetchDocument, upsertDocument, deleteDocument } from '../../lib/d1';
import { denormalizeCompendiumData } from '../../lib/compendium';
import MarkdownEditor from '@/components/MarkdownEditor';
import BBCodeRenderer from '@/components/BBCodeRenderer';
import { ImageUpload } from '../../components/ui/ImageUpload';
import EntityPicker from '../../components/ui/EntityPicker';
import ActivityEditor from '../../components/compendium/ActivityEditor';
import ActiveEffectEditor from '../../components/compendium/ActiveEffectEditor';
import AdvancementManager from '../../components/compendium/AdvancementManager';
import FeatureModalHero from '../../components/compendium/FeatureModalHero';
import RequirementsEditor from '../../components/compendium/RequirementsEditor';
import {
  Requirement,
  parseRequirementTree,
  serializeRequirementTree,
} from '../../lib/requirements';

export default function UniqueOptionGroupEditor({ userProfile }: { userProfile: any }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [sources, setSources] = useState<any[]>([]);
  const [isUsingD1, setIsUsingD1] = useState(false);

  // Group State
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [groupClassIds, setGroupClassIds] = useState<string[]>([]);
  const [groupClassSearch, setGroupClassSearch] = useState('');

  // Items State
  const [items, setItems] = useState<any[]>([]);
  const [editingItem, setEditingItem] = useState<any>(null);
  const [isItemModalOpen, setIsItemModalOpen] = useState(false);
  const [classes, setClasses] = useState<any[]>([]);
  // Lookups consumed by <RequirementsEditor>. Loaded once on mount alongside
  // the group's own data — keeps the option modal's leaf pickers populated
  // (subclasses, every other Modular Option Group's items, spell rules).
  // Features and spells are deferred until the picker grows a search UI;
  // they're optional in the editor's API so the leaves stay in the
  // type dropdown but their pickers report "(no … available)" until wired.
  const [subclasses, setSubclasses] = useState<any[]>([]);
  const [spellRules, setSpellRules] = useState<any[]>([]);
  /**
   * All Modular Option Groups with their items pre-attached, used by the
   * `optionItem` requirement leaf for its cascading group → item picker.
   * Includes the group currently being edited so an option can reference
   * a sibling (the previous `requires_option_ids` behaviour, now folded
   * into the tree).
   */
  const [allOptionGroups, setAllOptionGroups] = useState<Array<{
    id: string;
    name: string;
    items: Array<{ id: string; name: string }>;
  }>>([]);
  // Tab state for the option-item modal — mirrors ClassEditor's feature
  // modal so authoring an option (Maneuver / Invocation / Infusion) feels
  // identical to authoring a class feature.
  const [optionTab, setOptionTab] = useState<'description' | 'details' | 'activities' | 'effects' | 'advancement'>('description');
  const groupDescRef = useRef<HTMLTextAreaElement>(null);
  const itemDescRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const loadAll = async () => {
      setLoading(true);
      try {
        // Lookup fetches run in parallel — the option modal won't open
        // until at least the group itself is loaded below, so the extra
        // round-trips here just need to finish before authoring starts.
        const [sourcesData, classesData, subclassesData, spellRulesData, allGroups, allOptionItems] = await Promise.all([
          fetchCollection('sources', { orderBy: 'name ASC' }),
          fetchCollection('classes', { orderBy: 'name ASC' }),
          fetchCollection('subclasses', { orderBy: 'name ASC' }),
          fetchCollection('spellRules', { orderBy: 'name ASC' }),
          fetchCollection('uniqueOptionGroups', { orderBy: 'name ASC' }),
          // All option items across all groups, used to populate the
          // optionItem-leaf picker (so an item in group A can require an
          // item in group B — e.g. an Eldritch Invocation requiring a
          // Warlock Pact).
          fetchCollection('uniqueOptionItems', { orderBy: 'name ASC' }),
        ]);
        setSources(sourcesData);
        setClasses(classesData);
        setSubclasses(subclassesData);
        setSpellRules(spellRulesData);

        // Bucket items into their parent groups so the cascading picker
        // doesn't have to scan the flat list every render.
        const groupsWithItems = (allGroups as any[]).map((g: any) => ({
          id: g.id,
          name: g.name,
          items: (allOptionItems as any[])
            .filter((it: any) => (it.group_id || it.groupId) === g.id)
            .map((it: any) => ({ id: it.id, name: it.name })),
        }));
        setAllOptionGroups(groupsWithItems);

        if (id) {
          // 3. Group
          const groupData = await fetchDocument<any>('uniqueOptionGroups', id);

          if (groupData) {
            setName(groupData.name || '');
            setDescription(groupData.description || '');
            setSourceId(groupData.source_id || groupData.sourceId || '');
            setGroupClassIds(groupData.class_ids || groupData.classIds || []);
            setIsUsingD1(true);
          }

          // 4. Items — denormalize so camelCase keys (iconUrl, imageUrl,
          // usesMax, usesRecovery, classIds, etc.) the editor binds to
          // actually populate from the snake_case row returned by D1.
          // Without this the icon never re-displays after save and the
          // hero header looks empty on reopen.
          //
          // `requirements_tree` is auto-parsed by d1.ts (added in
          // migration 20260510-2152) but we run it through
          // parseRequirementTree() once on load so callers can rely on a
          // typed shape downstream rather than `any`.
          const itemsData = await fetchCollection('uniqueOptionItems', {
            where: 'group_id = ?',
            params: [id],
            orderBy: 'name ASC',
          });
          setItems(itemsData.map((row: any) => {
            const denorm = denormalizeCompendiumData(row);
            return {
              ...denorm,
              requirementsTree: parseRequirementTree(
                denorm.requirementsTree ?? denorm.requirements_tree
              ),
              levelPrereqIsTotal: Boolean(
                denorm.levelPrereqIsTotal ?? denorm.level_prereq_is_total
              ),
            };
          }));
        }
      } catch (err) {
        console.error("Error loading unique options data:", err);
      } finally {
        setLoading(false);
      }
    };

    loadAll();
  }, [id]);

  const handleSaveGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const d1Data = {
        name,
        description,
        source_id: sourceId,
        class_ids: groupClassIds,
        updated_at: new Date().toISOString(),
      };

      const targetId = id || crypto.randomUUID();
      await upsertDocument('uniqueOptionGroups', targetId, d1Data);

      if (id) {
        toast.success('Group saved successfully');
      } else {
        toast.success('Group created successfully');
        navigate(`/compendium/unique-options/edit/${targetId}`);
      }
    } catch (error) {
      console.error("Error saving group:", error);
      toast.error('Failed to save group');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteGroup = async () => {
    if (!id) return;
    if (window.confirm('Delete this entire group and all its options?')) {
      try {
        setLoading(true);
        for (const item of items) {
          await deleteDocument('uniqueOptionItems', item.id);
        }
        await deleteDocument('uniqueOptionGroups', id);
        toast.success('Option group deleted');
        navigate('/compendium/unique-options');
      } catch (error) {
        console.error("Error deleting group:", error);
        toast.error('Failed to delete option group');
      } finally {
        setLoading(false);
      }
    }
  };

  const handleSaveItem = async (e?: React.SyntheticEvent) => {
    e?.preventDefault();
    if (!id) return;

    try {
      // Pull JSON fields off either case, default to safe empty shapes.
      // Migration 20260509-1356 added the full feat-shape body
      // (activities/effects/advancements/properties/tags/uses_recovery/
      // image_url/quantity_column_id/scaling_column_id/feature_type/
      // subtype/requirements). The form may not surface all of these
      // yet (the tabs refactor is in flight), so the writes here are
      // pass-through — preserving whatever's on editingItem and
      // defaulting empty when the field hasn't been authored.
      const usesRecovery = Array.isArray(editingItem?.usesRecovery)
        ? editingItem.usesRecovery
        : (Array.isArray(editingItem?.uses_recovery) ? editingItem.uses_recovery : []);
      const properties = Array.isArray(editingItem?.properties) ? editingItem.properties : [];
      const activities = Array.isArray(editingItem?.activities) ? editingItem.activities : [];
      const effects = Array.isArray(editingItem?.effects) ? editingItem.effects : [];
      const advancements = Array.isArray(editingItem?.advancements) ? editingItem.advancements : [];
      const tags = Array.isArray(editingItem?.tags) ? editingItem.tags : [];

      const d1Data = {
        name: editingItem?.name || 'New Option',
        description: editingItem?.description || '',
        group_id: id,
        source_id: editingItem?.source_id || editingItem?.sourceId || sourceId,
        level_prerequisite: parseInt(editingItem?.levelPrerequisite || editingItem?.level_prerequisite) || 0,
        // When true the flat level_prerequisite gate is checked against
        // total character level instead of the importing-class level.
        // Default 0 (class level) matches the historical semantics —
        // option items are picked during a class advancement.
        level_prereq_is_total: Boolean(editingItem?.levelPrereqIsTotal ?? editingItem?.level_prereq_is_total) ? 1 : 0,
        is_repeatable: Boolean(editingItem?.isRepeatable || editingItem?.is_repeatable) ? 1 : 0,
        string_prerequisite: editingItem?.stringPrerequisite || editingItem?.string_prerequisite || '',
        page: editingItem?.page || '',
        class_ids: Array.isArray(editingItem?.classIds) ? editingItem.classIds : (editingItem?.class_ids || []),
        // Compound requirements (And/Or/Xor tree of typed leaves —
        // option items, classes, spell rules, ability scores, etc.).
        // Replaces the dropped `requires_option_ids` + `requirements`
        // text columns. Serialized to a JSON string here so D1 stores
        // it verbatim; on read, parseRequirementTree() normalizes it.
        requirements_tree: serializeRequirementTree(editingItem?.requirementsTree ?? null),
        // Feat-shape body — same columns the `features` table carries.
        // feature_type is derived from the parent group's name so dnd5e's
        // `system.type.subtype` always matches the user's group naming
        // (Battle Master Maneuvers → "Battle Master Maneuvers" subtype).
        // Authors don't need to remember to fill it in; it's locked to
        // the group identity.
        feature_type: name || editingItem?.featureType || editingItem?.feature_type || null,
        subtype: editingItem?.subtype || null,
        // `icon_url` is the field the hero-header ImageUpload binds to via
        // `editingItem.iconUrl`. Was being dropped on save until this fix
        // because only `image_url` was written.
        icon_url: editingItem?.iconUrl || editingItem?.icon_url || null,
        image_url: editingItem?.imageUrl || editingItem?.image_url || null,
        uses_max: editingItem?.usesMax || editingItem?.uses_max || null,
        uses_spent: Number(editingItem?.usesSpent ?? editingItem?.uses_spent ?? 0) || 0,
        uses_recovery: usesRecovery,
        properties,
        activities,
        effects,
        advancements,
        tags,
        quantity_column_id: editingItem?.quantityColumnId || editingItem?.quantity_column_id || null,
        scaling_column_id: editingItem?.scalingColumnId || editingItem?.scaling_column_id || null,
        updated_at: new Date().toISOString(),
      };

      const targetId = editingItem?.id || crypto.randomUUID();
      await upsertDocument('uniqueOptionItems', targetId, d1Data);

      const stateItem = { id: targetId, ...d1Data };
      if (editingItem?.id) {
        setItems(prev => prev.map(it => it.id === targetId ? stateItem : it));
      } else {
        setItems(prev => [...prev, stateItem].sort((a, b) => a.name.localeCompare(b.name)));
      }
      setEditingItem(null);
      setIsItemModalOpen(false);
      toast.success('Option saved successfully');
    } catch (error) {
      console.error("Error saving item:", error);
      toast.error('Failed to save option');
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    if (window.confirm('Delete this option?')) {
      try {
        await deleteDocument('uniqueOptionItems', itemId);
        setItems(prev => prev.filter(it => it.id !== itemId));
        toast.success('Option deleted');
      } catch (error) {
        console.error("Error deleting item:", error);
        toast.error('Failed to delete option');
      }
    }
  };

  const openAddModal = () => {
    setEditingItem({
      levelPrerequisite: 0,
      levelPrereqIsTotal: false,
      isRepeatable: false,
      classIds: [],
      requirementsTree: null,
    });
    setOptionTab('description');
    setIsItemModalOpen(true);
  };

  const openEditModal = (item: any) => {
    setEditingItem({ ...item });
    setOptionTab('description');
    setIsItemModalOpen(true);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-20">
      <div className="section-header">
        <div className="flex items-center gap-4">
          <Link to="/compendium/unique-options">
            <Button variant="ghost" size="sm" className="text-gold gap-2 hover:bg-gold/5">
              <ChevronLeft className="w-4 h-4" /> Back
            </Button>
          </Link>
          <h1 className="text-2xl font-serif font-bold text-ink uppercase tracking-tight">
            {id ? `Edit ${name || 'Group'}` : 'New Unique Option Group'}
          </h1>
          {id && (
            isUsingD1 ? (
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                <Database className="w-3 h-3 text-emerald-500" />
                <span className="text-[9px] font-bold text-emerald-500 uppercase tracking-tighter">D1 Linked</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20">
                <CloudOff className="w-3 h-3 text-amber-500" />
                <span className="text-[9px] font-bold text-amber-500 uppercase tracking-tighter">Legacy Firebase</span>
              </div>
            )
          )}
        </div>
        <div className="flex items-center gap-2">
          {id && (
            <Button onClick={handleDeleteGroup} disabled={loading} size="sm" variant="outline" className="border-blood/30 btn-danger gap-2">
              <Trash2 className="w-4 h-4" /> Delete Group
            </Button>
          )}
          <Button onClick={handleSaveGroup} disabled={loading} size="sm" className="btn-gold-solid gap-2">
            <Save className="w-4 h-4" /> {id ? 'Save Changes' : 'Create Group'}
          </Button>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Group Info */}
          <div className="p-4 border border-gold/20 bg-card/50 space-y-4">
            <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-gold border-b border-gold/10 pb-2">Group Details</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-bold uppercase tracking-widest text-ink/40">Group Name</label>
                <Input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Eldritch Invocations"
                  className="h-8 text-sm bg-background/50 border-gold/10 focus:border-gold"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold uppercase tracking-widest text-ink/40">Source</label>
                <select
                  value={sourceId}
                  onChange={e => setSourceId(e.target.value)}
                  className="w-full h-8 px-2 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-sm"
                >
                  <option value="">Select a Source</option>
                  {sources.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <MarkdownEditor
              textareaRef={groupDescRef}
              value={description}
              onChange={setDescription}
              placeholder="Describe what these options represent..."
              minHeight="60px"
              className="italic"
              label="Description"
            />
            {/* Class Restrictions (group-level) */}
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-widest text-ink/40">Class Restrictions</label>
              <p className="text-[9px] text-ink/30 italic -mt-1">If none selected, this group is visible to all classes in the advancement editor.</p>
              {groupClassIds.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {groupClassIds.map((cid: string) => {
                    const cls = classes.find(c => c.id === cid);
                    return cls ? (
                      <span key={cid} className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-gold/10 text-gold border border-gold/20 rounded">
                        {cls.name}
                        <button
                          type="button"
                          onClick={() => setGroupClassIds(prev => prev.filter(id => id !== cid))}
                          className="ml-0.5 text-gold/50 hover:text-gold leading-none"
                        >×</button>
                      </span>
                    ) : null;
                  })}
                </div>
              )}
              <div className="border border-gold/10 rounded-md bg-background/20 overflow-hidden">
                <div className="flex items-center gap-2 px-2 py-1.5 border-b border-gold/10">
                  <Search className="w-3 h-3 text-ink/30 shrink-0" />
                  <input
                    type="text"
                    placeholder="Search classes…"
                    value={groupClassSearch}
                    onChange={e => setGroupClassSearch(e.target.value)}
                    className="flex-1 bg-transparent text-xs outline-none placeholder:text-ink/30 text-ink"
                  />
                  {groupClassSearch && (
                    <button type="button" onClick={() => setGroupClassSearch('')} className="text-ink/30 hover:text-ink/60 text-sm leading-none">×</button>
                  )}
                </div>
                <div className="max-h-36 overflow-y-auto divide-y divide-gold/5">
                  {classes
                    .filter(cls => !groupClassSearch || cls.name.toLowerCase().includes(groupClassSearch.toLowerCase()))
                    .map(cls => {
                      const isSelected = groupClassIds.includes(cls.id);
                      return (
                        <label key={cls.id} className="flex items-center gap-2.5 px-3 py-1.5 cursor-pointer hover:bg-gold/5 transition-colors">
                          <div className={`w-3.5 h-3.5 rounded border shrink-0 flex items-center justify-center transition-all ${isSelected ? 'bg-gold border-gold' : 'border-gold/30 hover:border-gold/60'}`}>
                            {isSelected && <Check className="w-2.5 h-2.5 text-white" />}
                          </div>
                          <input
                            type="checkbox"
                            className="hidden"
                            checked={isSelected}
                            onChange={e => {
                              setGroupClassIds(prev => e.target.checked ? [...prev, cls.id] : prev.filter(cid => cid !== cls.id));
                            }}
                          />
                          <span className="text-xs text-ink">{cls.name}</span>
                        </label>
                      );
                    })}
                  {classes.length > 0 && groupClassSearch && classes.filter(c => c.name.toLowerCase().includes(groupClassSearch.toLowerCase())).length === 0 && (
                    <p className="px-3 py-3 text-[10px] text-ink/20 italic">No classes match "{groupClassSearch}".</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Individual Options */}
          {id && (
            <div className="p-4 border border-gold/20 bg-card/50 space-y-4">
              <div className="section-header">
                <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-gold">Individual Options</h2>
                <Button
                  size="sm"
                  onClick={openAddModal}
                  className="h-6 gap-1 btn-gold"
                >
                  <Plus className="w-3 h-3" /> Add Option
                </Button>
              </div>

              <div className="divide-y divide-gold/10">
                {items.map((item) => {
                  // Summary chips for the list row. The requirements tree
                  // can be arbitrarily complex (any of (A or B) and …) so
                  // we don't try to format it inline — a "Has requirements"
                  // tag plus level/string prereqs is the at-a-glance view;
                  // authors open the modal to see the tree itself.
                  const hasLevelReq = (item.level_prerequisite || 0) > 0;
                  const levelIsTotal = Boolean(item.levelPrereqIsTotal ?? item.level_prereq_is_total);
                  const hasStringReq = !!item.string_prerequisite;
                  const hasTreeReq = !!item.requirementsTree;
                  return (
                  <div key={item.id} className="py-2 flex items-center justify-between group">
                    <div className="flex items-center gap-3">
                      {item.iconUrl && (
                        <img src={item.iconUrl} alt="" className="w-6 h-6 object-contain opacity-70 shrink-0" />
                      )}
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-ink">{item.name}</span>
                          {/* Boolean() guard: SQLite stores is_repeatable as INTEGER 0/1
                              and `0 && X` short-circuits to 0, which JSX renders as
                              the literal text "0" next to the name. */}
                          {Boolean(item.is_repeatable) && (
                            <Repeat className="w-3 h-3 text-gold/40" />
                          )}
                        </div>
                        {(hasLevelReq || hasTreeReq || hasStringReq) && (
                          <div className="text-[10px] text-ink/40">
                            <span className="font-bold uppercase tracking-wider">Prerequisites:</span>{' '}
                            {[
                              hasLevelReq
                                ? `Level ${item.level_prerequisite}+${levelIsTotal ? ' (character)' : ''}`
                                : null,
                              hasTreeReq ? 'Compound requirements' : null,
                              hasStringReq ? item.string_prerequisite : null
                            ].filter(Boolean).join(' · ')}
                          </div>
                        )}
                        {(item.class_ids || []).length > 0 && (
                          <div className="text-[10px] text-gold/60">
                            {(item.class_ids || []).map((cid: string) => classes.find((c: any) => c.id === cid)?.name).filter(Boolean).join(', ')}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <Button variant="ghost" size="sm" onClick={() => openEditModal(item)} className="h-6 w-6 p-0 text-gold">
                        <Edit className="w-3 h-3" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => handleDeleteItem(item.id)} className="h-6 w-6 p-0 text-blood">
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                  );
                })}
                {items.length === 0 && (
                  <p className="py-4 text-center text-xs text-ink/30 italic">No options added yet.</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Item Edit Modal */}
      <Dialog open={isItemModalOpen} onOpenChange={(open) => {
        setIsItemModalOpen(open);
        if (!open) setEditingItem(null);
      }}>
        <DialogContent className="dialog-content max-w-[95vw] lg:max-w-6xl flex flex-col h-[90vh]">
          {editingItem && (
            <>
              <FeatureModalHero
                iconUrl={editingItem?.iconUrl || ''}
                onIconChange={(url) => setEditingItem((prev: any) => ({ ...(prev || { levelPrerequisite: 0, isRepeatable: false }), iconUrl: url }))}
                name={editingItem?.name || ''}
                onNameChange={(name) => setEditingItem((prev: any) => ({ ...(prev || { levelPrerequisite: 0, isRepeatable: false }), name }))}
                namePlaceholder="Option Name"
                required
                autoFocusName
                tabs={['description', 'details', 'activities', 'effects', 'advancement']}
                activeTab={optionTab}
                onTabChange={(v) => setOptionTab(v as any)}
              />


              <div className={`flex-1 min-h-0 p-6 bg-background/50 space-y-4 ${optionTab === 'description' ? 'overflow-hidden' : 'overflow-y-auto custom-scrollbar'}`}>
            {/* DESCRIPTION TAB — markdown body (icon + name live in the hero
                header above, visible across every tab). */}
            {optionTab === 'description' && (
              <div className="h-full min-h-0">
                <MarkdownEditor
                  textareaRef={itemDescRef}
                  value={editingItem?.description || ''}
                  onChange={(val) => setEditingItem((prev: any) => ({ ...(prev || { levelPrerequisite: 0, isRepeatable: false }), description: val }))}
                  placeholder="Enter the full text of the feature..."
                  minHeight="400px"
                  maxHeight="100%"
                  className="italic h-full min-h-0"
                  label="Description"
                />
              </div>
            )}

            {/* DETAILS TAB — feature classification, requirements,
                prerequisites, class restrictions. */}
            {optionTab === 'details' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold uppercase tracking-widest text-ink/40">Source</label>
                    <select
                      value={editingItem?.source_id || editingItem?.sourceId || ''}
                      onChange={e => setEditingItem((prev: any) => ({ ...(prev || { level_prerequisite: 0, is_repeatable: false }), source_id: e.target.value }))}
                      className="w-full h-8 px-2 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-sm"
                    >
                      <option value="">Same as Group</option>
                      {sources.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold uppercase tracking-widest text-ink/40">Page Reference</label>
                    <Input
                      value={editingItem?.page || ''}
                      onChange={e => setEditingItem((prev: any) => ({ ...(prev || { levelPrerequisite: 0, isRepeatable: false }), page: e.target.value }))}
                      placeholder="e.g. 155"
                      className="h-8 text-sm bg-background/50 border-gold/10 focus:border-gold"
                    />
                  </div>
                  <div className="space-y-1">
                    {/* Feature Type is locked to the parent Modular Option
                        Group's name — drives dnd5e's `system.type.subtype`
                        on the embedded item. Read-only; renames on the
                        group level flow through here on save. */}
                    <label className="text-xs font-bold uppercase tracking-widest text-ink/40">Modular Option Group</label>
                    <div className="h-8 px-3 flex items-center text-sm text-ink/70 bg-background/30 border border-gold/10 rounded-md select-none">
                      {name || <span className="italic text-ink/30">Save the group first</span>}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold uppercase tracking-widest text-ink/40">Subtype</label>
                    <Input
                      value={editingItem?.subtype || ''}
                      onChange={e => setEditingItem((prev: any) => ({ ...(prev || {}), subtype: e.target.value }))}
                      placeholder="optional secondary tag"
                      className="h-8 text-sm bg-background/50 border-gold/10 focus:border-gold"
                    />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <label className="text-xs font-bold uppercase tracking-widest text-ink/40">Requirements</label>
                    <Input
                      value={editingItem?.requirements || ''}
                      onChange={e => setEditingItem((prev: any) => ({ ...(prev || {}), requirements: e.target.value }))}
                      placeholder="Free-text requirement summary (e.g. 'Pact of the Blade')"
                      className="h-8 text-sm bg-background/50 border-gold/10 focus:border-gold"
                    />
                  </div>
                </div>

                {/* Prerequisites: flat level + free-text + compound tree.
                    The flat level_prerequisite / string_prerequisite live
                    side-by-side at the top — most options gate on level
                    alone, so the simple controls stay reachable without
                    opening the tree. The compound <RequirementsEditor/>
                    below handles everything else (option-item chains,
                    spell rules, ability scores, etc.). */}
                <div className="space-y-3 pt-2 border-t border-gold/10">
                  <h4 className="text-[10px] text-gold uppercase tracking-widest font-black">Prerequisites</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs font-bold uppercase tracking-widest text-ink/40">Level Prerequisite</label>
                      <Input
                        type="number"
                        value={editingItem?.level_prerequisite || editingItem?.levelPrerequisite || 0}
                        onChange={e => setEditingItem((prev: any) => ({ ...(prev || { level_prerequisite: 0, is_repeatable: false }), level_prerequisite: parseInt(e.target.value) || 0 }))}
                        className="h-8 text-sm bg-background/50 border-gold/10 focus:border-gold"
                      />
                      {/* Defaults to false (class level). When checked the
                          number is interpreted as total character level
                          rather than the importing-class level. Mirrors
                          the `level_prereq_is_total` column saved below. */}
                      <label className="flex items-center gap-1.5 cursor-pointer pt-1">
                        <input
                          type="checkbox"
                          checked={Boolean(editingItem?.levelPrereqIsTotal ?? editingItem?.level_prereq_is_total)}
                          onChange={e => setEditingItem((prev: any) => ({
                            ...(prev || {}),
                            levelPrereqIsTotal: e.target.checked,
                          }))}
                          className="w-3 h-3 rounded border-gold/20 text-gold focus:ring-gold"
                        />
                        <span className="text-[10px] text-ink/50 uppercase tracking-wider">
                          Total character level (default: class level)
                        </span>
                      </label>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold uppercase tracking-widest text-ink/40">String Prerequisite</label>
                      <Input
                        value={editingItem?.string_prerequisite || editingItem?.stringPrerequisite || ''}
                        onChange={e => setEditingItem((prev: any) => ({ ...(prev || { level_prerequisite: 0, is_repeatable: false }), string_prerequisite: e.target.value }))}
                        placeholder="e.g. Eldritch Blast cantrip"
                        className="h-8 text-sm bg-background/50 border-gold/10 focus:border-gold"
                      />
                    </div>
                  </div>

                  {/* Compound requirements tree. Authors can describe
                      arbitrary And/Or/Xor compositions — typically used
                      for option-item chains (Ultimate Pact Weapon needs
                      Pact of the Blade AND Superior Pact Weapon), spell
                      rules ("knows a 1st-level evocation"), or ability
                      score floors. The module enforces this at import
                      time via the show-but-mark-unmet pattern. */}
                  <RequirementsEditor
                    label="Compound Requirements"
                    value={(editingItem?.requirementsTree as Requirement | null) ?? null}
                    onChange={(next) => setEditingItem((prev: any) => ({
                      ...(prev || {}),
                      requirementsTree: next,
                    }))}
                    lookups={{
                      classes: classes.map((c: any) => ({ id: c.id, name: c.name })),
                      subclasses: subclasses.map((s: any) => ({ id: s.id, name: s.name })),
                      spellRules: spellRules.map((r: any) => ({ id: r.id, name: r.name })),
                      optionGroups: allOptionGroups,
                    }}
                  />
                </div>

                <div className="flex items-center gap-2 pt-2 border-t border-gold/10">
                  <input
                    type="checkbox"
                    id="isRepeatable"
                    checked={!!(editingItem?.is_repeatable || editingItem?.isRepeatable)}
                    onChange={e => setEditingItem((prev: any) => ({ ...(prev || { level_prerequisite: 0, is_repeatable: 0, class_ids: [] }), is_repeatable: e.target.checked ? 1 : 0 }))}
                    className="w-3 h-3 rounded border-gold/20 text-gold focus:ring-gold"
                  />
                  <label htmlFor="isRepeatable" className="text-xs text-ink/40 uppercase font-bold cursor-pointer">
                    Repeatable
                  </label>
                </div>
              </div>
            )}

            {/* ACTIVITIES TAB — same editor used by class features. */}
            {optionTab === 'activities' && (
              <div className="pt-2">
                <ActivityEditor
                  activities={editingItem?.activities || []}
                  onChange={(acts) => setEditingItem((prev: any) => ({ ...(prev || {}), activities: acts }))}
                  availableEffects={editingItem?.effects || []}
                />
              </div>
            )}

            {/* EFFECTS TAB — Active Effects (mostly used by Invocations and
                Infusions which apply passive modifiers). */}
            {optionTab === 'effects' && (
              <div className="pt-2">
                <ActiveEffectEditor
                  effects={editingItem?.effects || []}
                  onChange={(fx) => setEditingItem((prev: any) => ({ ...(prev || {}), effects: fx }))}
                  defaultImg={editingItem?.iconUrl || editingItem?.imageUrl || editingItem?.icon_url || editingItem?.image_url || null}
                />
              </div>
            )}

            {/* ADVANCEMENT TAB — option items can have their own
                advancements per dnd5e (rare, but used by Invocations that
                grant spells via ItemGrant). Full editor, not the
                feature-link variant — the option item is its own document. */}
            {optionTab === 'advancement' && (
              <div className="pt-2">
                <AdvancementManager
                  advancements={editingItem?.advancements || []}
                  onChange={(advs) => setEditingItem((prev: any) => ({ ...(prev || {}), advancements: advs }))}
                  availableFeatures={[]}
                  availableScalingColumns={[]}
                  availableOptionGroups={[]}
                />
              </div>
            )}

              </div>

              <div className="p-4 border-t border-gold/10 bg-background flex justify-end shrink-0 gap-3">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => { setIsItemModalOpen(false); setEditingItem(null); }}
                  className="label-text opacity-70 hover:opacity-100"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={handleSaveItem}
                  disabled={!editingItem?.name}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground gap-2 px-8 label-text"
                >
                  {editingItem?.id ? 'Update Option' : 'Add Option'}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
