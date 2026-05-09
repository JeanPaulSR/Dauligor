import React, { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog';
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
import MarkdownEditor from '@/components/MarkdownEditor';
import BBCodeRenderer from '@/components/BBCodeRenderer';
import { ImageUpload } from '../../components/ui/ImageUpload';

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
  const groupDescRef = useRef<HTMLTextAreaElement>(null);
  const itemDescRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const loadAll = async () => {
      setLoading(true);
      try {
        const [sourcesData, classesData] = await Promise.all([
          fetchCollection('sources', { orderBy: 'name ASC' }),
          fetchCollection('classes', { orderBy: 'name ASC' }),
        ]);
        setSources(sourcesData);
        setClasses(classesData);

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

          // 4. Items
          const itemsData = await fetchCollection('uniqueOptionItems', {
            where: 'group_id = ?',
            params: [id],
            orderBy: 'name ASC',
          });
          setItems(itemsData);
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

  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;

    try {
      const d1Data = {
        name: editingItem?.name || 'New Option',
        description: editingItem?.description || '',
        group_id: id,
        source_id: editingItem?.source_id || editingItem?.sourceId || sourceId,
        level_prerequisite: parseInt(editingItem?.levelPrerequisite || editingItem?.level_prerequisite) || 0,
        is_repeatable: Boolean(editingItem?.isRepeatable || editingItem?.is_repeatable) ? 1 : 0,
        string_prerequisite: editingItem?.stringPrerequisite || editingItem?.string_prerequisite || '',
        page: editingItem?.page || '',
        class_ids: Array.isArray(editingItem?.classIds) ? editingItem.classIds : (editingItem?.class_ids || []),
        // IDs of other option items in this group that must be picked
        // first before this option becomes available in the picker.
        // Stored as a JSON array; the module enforces it at prompt time.
        requires_option_ids: Array.isArray(editingItem?.requiresOptionIds)
          ? editingItem.requiresOptionIds
          : (Array.isArray(editingItem?.requires_option_ids) ? editingItem.requires_option_ids : []),
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
    setEditingItem({ levelPrerequisite: 0, isRepeatable: false, classIds: [] });
    setIsItemModalOpen(true);
  };

  const openEditModal = (item: any) => {
    setEditingItem({ ...item });
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
                {items.map((item) => (
                  <div key={item.id} className="py-2 flex items-center justify-between group">
                    <div className="flex items-center gap-3">
                      {item.iconUrl && (
                        <img src={item.iconUrl} alt="" className="w-6 h-6 object-contain opacity-70 shrink-0" />
                      )}
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-ink">{item.name}</span>
                          {item.is_repeatable && (
                            <Repeat className="w-3 h-3 text-gold/40" />
                          )}
                        </div>
                        {((item.level_prerequisite || 0) > 0 || item.string_prerequisite) && (
                          <div className="text-[10px] text-ink/40">
                            <span className="font-bold uppercase tracking-wider">Prerequisites:</span>{' '}
                            {[
                              (item.level_prerequisite || 0) > 0 ? `Level ${item.level_prerequisite}+` : null,
                              item.string_prerequisite || null
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
                ))}
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
        <DialogContent className="dialog-content max-w-[95vw] lg:max-w-4xl flex flex-col max-h-[90vh] overflow-y-auto">
          <DialogHeader className="dialog-header">
            <DialogTitle className="dialog-title">
              {editingItem?.id ? 'Edit Option' : 'Add New Option'}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSaveItem} className="dialog-body space-y-4">
            {/* Icon + Name */}
            <div className="flex gap-4 items-start">
              <div className="shrink-0 space-y-1">
                <label className="text-xs font-bold uppercase tracking-widest text-ink/40">Icon</label>
                <div className="w-16 h-16">
                  <ImageUpload
                    storagePath="icons/features/"
                    imageType="icon"
                    compact
                    currentImageUrl={editingItem?.iconUrl || ''}
                    onUpload={(url) => setEditingItem((prev: any) => ({ ...(prev || { levelPrerequisite: 0, isRepeatable: false }), iconUrl: url }))}
                    className="w-full h-full"
                  />
                </div>
              </div>
              <div className="flex-1 space-y-1">
                <label className="text-xs font-bold uppercase tracking-widest text-ink/40">Option Name</label>
                <Input
                  value={editingItem?.name || ''}
                  onChange={e => setEditingItem((prev: any) => ({ ...(prev || { levelPrerequisite: 0, isRepeatable: false }), name: e.target.value }))}
                  className="h-8 text-sm bg-background/50 border-gold/10 focus:border-gold"
                  placeholder="e.g. Agonizing Blast"
                  required={!!editingItem}
                  autoFocus
                />
              </div>
            </div>

            {/* Grid fields */}
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
                <label className="text-xs font-bold uppercase tracking-widest text-ink/40">Level Prerequisite</label>
                <Input
                  type="number"
                  value={editingItem?.level_prerequisite || editingItem?.levelPrerequisite || 0}
                  onChange={e => setEditingItem((prev: any) => ({ ...(prev || { level_prerequisite: 0, is_repeatable: false }), level_prerequisite: parseInt(e.target.value) || 0 }))}
                  className="h-8 text-sm bg-background/50 border-gold/10 focus:border-gold"
                />
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
                <label className="text-xs font-bold uppercase tracking-widest text-ink/40">String Prerequisite</label>
                <Input
                  value={editingItem?.string_prerequisite || editingItem?.stringPrerequisite || ''}
                  onChange={e => setEditingItem((prev: any) => ({ ...(prev || { level_prerequisite: 0, is_repeatable: false }), string_prerequisite: e.target.value }))}
                  placeholder="e.g. Eldritch Blast cantrip"
                  className="h-8 text-sm bg-background/50 border-gold/10 focus:border-gold"
                />
              </div>
              <div className="flex items-center gap-2 pt-5">
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

            {/* Required Options — multi-select of other options in this group that must be picked first */}
            <div className="space-y-1">
              <label className="text-xs font-bold uppercase tracking-widest text-ink/40">Requires Options</label>
              <p className="text-[10px] text-ink/40 italic">
                This option only becomes available after the player has picked every option checked here, in the same import.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 p-2 rounded-md border border-gold/10 bg-background/30 max-h-40 overflow-y-auto">
                {items.filter((other: any) => other.id !== editingItem?.id).length === 0 ? (
                  <p className="text-[10px] text-ink/30 italic col-span-2">No other options in this group yet.</p>
                ) : (
                  items
                    .filter((other: any) => other.id !== editingItem?.id)
                    .map((other: any) => {
                      // Store the row PK; the exporter remaps PK → per-option
                      // sourceId before shipping so the module sees stable
                      // "class-option-<slug>" identifiers in
                      // `requiresOptionIds`.
                      const otherId = other.id;
                      const required: string[] = Array.isArray(editingItem?.requiresOptionIds)
                        ? editingItem.requiresOptionIds
                        : (Array.isArray(editingItem?.requires_option_ids) ? editingItem.requires_option_ids : []);
                      const isChecked = required.includes(otherId);
                      return (
                        <label key={other.id} className="flex items-center gap-2 cursor-pointer text-xs text-ink/70 hover:text-ink">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            disabled={!otherId}
                            onChange={e => {
                              const next = new Set(required);
                              if (e.target.checked) next.add(otherId);
                              else next.delete(otherId);
                              setEditingItem((prev: any) => ({
                                ...(prev || {}),
                                requiresOptionIds: Array.from(next),
                                requires_option_ids: Array.from(next)
                              }));
                            }}
                            className="w-3 h-3 rounded border-gold/20 text-gold focus:ring-gold"
                          />
                          <span className="truncate">{other.name || '(unnamed)'}</span>
                        </label>
                      );
                    })
                )}
              </div>
            </div>

            {/* Description */}
            <MarkdownEditor
              textareaRef={itemDescRef}
              value={editingItem?.description || ''}
              onChange={(val) => setEditingItem((prev: any) => ({ ...(prev || { levelPrerequisite: 0, isRepeatable: false }), description: val }))}
              placeholder="Enter the full text of the feature..."
              minHeight="120px"
              className="italic"
              label="Description"
            />

            <DialogFooter className="dialog-footer pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => { setIsItemModalOpen(false); setEditingItem(null); }}
                className="text-ink/40 text-xs"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={!editingItem?.name}
                className="btn-gold-solid"
              >
                {editingItem?.id ? 'Update Option' : 'Add Option'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
