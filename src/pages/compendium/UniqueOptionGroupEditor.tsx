import React, { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { doc, getDoc, updateDoc, collection, addDoc, deleteDoc, onSnapshot, query, where, orderBy, deleteField } from 'firebase/firestore';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog';
import {
  ChevronLeft,
  Save,
  Plus,
  Trash2,
  Edit,
  Repeat,
  Check,
  Search
} from 'lucide-react';
import MarkdownEditor from '@/components/MarkdownEditor';
import BBCodeRenderer from '@/components/BBCodeRenderer';
import { ImageUpload } from '../../components/ui/ImageUpload';

export default function UniqueOptionGroupEditor({ userProfile }: { userProfile: any }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [sources, setSources] = useState<any[]>([]);

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
    const unsubscribeSources = onSnapshot(query(collection(db, 'sources'), orderBy('name')), (snap) => {
      setSources(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    const unsubscribeClasses = onSnapshot(query(collection(db, 'classes'), orderBy('name')), (snap) => {
      setClasses(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    if (id) {
      const fetchGroup = async () => {
        const docSnap = await getDoc(doc(db, 'uniqueOptionGroups', id));
        if (docSnap.exists()) {
          const data = docSnap.data();
          setName(data.name || '');
          setDescription(data.description || '');
          setSourceId(data.sourceId || '');
          setGroupClassIds(data.classIds || []);
        }
      };
      fetchGroup();

      const itemsQuery = query(
        collection(db, 'uniqueOptionItems'),
        where('groupId', '==', id)
      );
      const unsubscribeItems = onSnapshot(itemsQuery, (snap) => {
        const sortedItems = snap.docs
          .map(doc => ({ id: doc.id, ...doc.data() }))
          .sort((a: any, b: any) => (a.name || '').localeCompare(b.name || ''));
        setItems(sortedItems);
      }, (error) => {
        console.error("Error fetching items:", error);
      });

      return () => {
        unsubscribeSources();
        unsubscribeClasses();
        unsubscribeItems();
      };
    }

    return () => {
      unsubscribeSources();
      unsubscribeClasses();
    };
  }, [id]);

  const handleSaveGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const groupData: any = {
        name,
        description,
        sourceId,
        classIds: groupClassIds,
        updatedAt: new Date().toISOString()
      };

      if (id) {
        groupData.maxSelections = deleteField();
        groupData.scalingColumnId = deleteField();
        groupData.featureId = deleteField();
        await updateDoc(doc(db, 'uniqueOptionGroups', id), groupData);
        toast.success('Group saved successfully');
      } else {
        const docRef = await addDoc(collection(db, 'uniqueOptionGroups'), {
          ...groupData,
          createdAt: new Date().toISOString()
        });
        toast.success('Group created successfully');
        navigate(`/compendium/unique-options/edit/${docRef.id}`);
      }
    } catch (error) {
      console.error("Error saving group:", error);
      handleFirestoreError(error, id ? OperationType.UPDATE : OperationType.CREATE, id ? `/uniqueOptionGroups/${id}` : '/uniqueOptionGroups');
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
          await deleteDoc(doc(db, 'uniqueOptionItems', item.id));
        }
        await deleteDoc(doc(db, 'uniqueOptionGroups', id));
        toast.success('Option group deleted');
        navigate('/compendium/unique-options');
      } catch (error) {
        console.error("Error deleting group:", error);
        handleFirestoreError(error, OperationType.DELETE, `/uniqueOptionGroups/${id}`);
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
      const itemData: any = {
        ...editingItem,
        levelPrerequisite: parseInt(editingItem?.levelPrerequisite) || 0,
        isRepeatable: Boolean(editingItem?.isRepeatable),
        stringPrerequisite: editingItem?.stringPrerequisite || '',
        page: editingItem?.page || '',
        description: editingItem?.description || '',
        classIds: Array.isArray(editingItem?.classIds) ? editingItem.classIds : [],
        groupId: id,
        sourceId: editingItem?.sourceId || sourceId,
        name: editingItem?.name || 'New Option',
        updatedAt: new Date().toISOString()
      };

      if (editingItem.id) {
        itemData.featureId = deleteField();
        Object.keys(itemData).forEach(key => {
          if (itemData[key] === undefined) delete itemData[key];
        });
        await updateDoc(doc(db, 'uniqueOptionItems', editingItem.id), itemData);
      } else {
        itemData.createdAt = new Date().toISOString();
        Object.keys(itemData).forEach(key => {
          if (itemData[key] === undefined) delete itemData[key];
        });
        await addDoc(collection(db, 'uniqueOptionItems'), itemData);
      }
      setEditingItem(null);
      setIsItemModalOpen(false);
      toast.success('Option saved successfully');
    } catch (error) {
      console.error("Error saving item:", error);
      handleFirestoreError(error, editingItem.id ? OperationType.UPDATE : OperationType.CREATE, editingItem.id ? `/uniqueOptionItems/${editingItem.id}` : '/uniqueOptionItems');
      toast.error('Failed to save option');
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    if (window.confirm('Delete this option?')) {
      try {
        await deleteDoc(doc(db, 'uniqueOptionItems', itemId));
        toast.success('Option deleted');
      } catch (error) {
        console.error("Error deleting item:", error);
        handleFirestoreError(error, OperationType.DELETE, `/uniqueOptionItems/${itemId}`);
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
                          {item.isRepeatable && (
                            <Repeat className="w-3 h-3 text-gold/40" />
                          )}
                        </div>
                        {((item.levelPrerequisite || 0) > 0 || item.stringPrerequisite) && (
                          <div className="text-[10px] text-ink/40">
                            <span className="font-bold uppercase tracking-wider">Prerequisites:</span>{' '}
                            {[
                              (item.levelPrerequisite || 0) > 0 ? `Level ${item.levelPrerequisite}+` : null,
                              item.stringPrerequisite || null
                            ].filter(Boolean).join(' · ')}
                          </div>
                        )}
                        {item.classIds?.length > 0 && (
                          <div className="text-[10px] text-gold/60">
                            {item.classIds.map((cid: string) => classes.find(c => c.id === cid)?.name).filter(Boolean).join(', ')}
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
                  value={editingItem?.sourceId || ''}
                  onChange={e => setEditingItem((prev: any) => ({ ...(prev || { levelPrerequisite: 0, isRepeatable: false }), sourceId: e.target.value }))}
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
                  value={editingItem?.levelPrerequisite || 0}
                  onChange={e => setEditingItem((prev: any) => ({ ...(prev || { levelPrerequisite: 0, isRepeatable: false }), levelPrerequisite: parseInt(e.target.value) || 0 }))}
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
                  value={editingItem?.stringPrerequisite || ''}
                  onChange={e => setEditingItem((prev: any) => ({ ...(prev || { levelPrerequisite: 0, isRepeatable: false }), stringPrerequisite: e.target.value }))}
                  placeholder="e.g. Eldritch Blast cantrip"
                  className="h-8 text-sm bg-background/50 border-gold/10 focus:border-gold"
                />
              </div>
              <div className="flex items-center gap-2 pt-5">
                <input
                  type="checkbox"
                  id="isRepeatable"
                  checked={editingItem?.isRepeatable || false}
                  onChange={e => setEditingItem((prev: any) => ({ ...(prev || { levelPrerequisite: 0, isRepeatable: false, classIds: [] }), isRepeatable: e.target.checked }))}
                  className="w-3 h-3 rounded border-gold/20 text-gold focus:ring-gold"
                />
                <label htmlFor="isRepeatable" className="text-xs text-ink/40 uppercase font-bold cursor-pointer">
                  Repeatable
                </label>
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
