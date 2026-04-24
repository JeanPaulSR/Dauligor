import React, { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { doc, getDoc, updateDoc, collection, addDoc, deleteDoc, onSnapshot, query, where, orderBy, deleteField } from 'firebase/firestore';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { 
  ChevronLeft, 
  Save, 
  Plus, 
  Trash2, 
  Edit, 
  BookOpen,
  Hash,
  Type,
  Repeat
} from 'lucide-react';
import MarkdownEditor from '@/components/MarkdownEditor';
import BBCodeRenderer from '@/components/BBCodeRenderer';

export default function UniqueOptionGroupEditor({ userProfile }: { userProfile: any }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [sources, setSources] = useState<any[]>([]);

  // Group State
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sourceId, setSourceId] = useState('');

  // Items State
  const [items, setItems] = useState<any[]>([]);
  const [editingItem, setEditingItem] = useState<any>(null);
  const [classes, setClasses] = useState<any[]>([]);
  const formRef = useRef<HTMLDivElement>(null);
  const groupDescRef = useRef<HTMLTextAreaElement>(null);
  const itemDescRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Fetch Sources
    const unsubscribeSources = onSnapshot(query(collection(db, 'sources'), orderBy('name')), (snap) => {
      setSources(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    // Fetch Classes
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
        }
      };
      fetchGroup();

      // Fetch Items
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
        updatedAt: new Date().toISOString()
      };
      console.log("Saving Group:", {id, groupData});

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
      console.log("Deleting group:", id);
      try {
        setLoading(true);
        // Delete all items first
        for (const item of items) {
          await deleteDoc(doc(db, 'uniqueOptionItems', item.id));
        }
        // Delete the group
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
        sourceId: editingItem?.sourceId || sourceId, // Default to group source
        name: editingItem?.name || 'New Option',
        updatedAt: new Date().toISOString()
      };

      console.log("Saving Item Data:", {id: editingItem?.id, itemData});

      if (editingItem.id) {
        itemData.featureId = deleteField();
        
        // Remove undefined keys so Firestore doesn't error or we can use deleteField
        Object.keys(itemData).forEach(key => {
          if (itemData[key] === undefined) {
             delete itemData[key];
          }
        });
        
        await updateDoc(doc(db, 'uniqueOptionItems', editingItem.id), itemData);
      } else {
        itemData.createdAt = new Date().toISOString();
        // Remove undefined before adding
        Object.keys(itemData).forEach(key => {
          if (itemData[key] === undefined) {
             delete itemData[key];
          }
        });
        await addDoc(collection(db, 'uniqueOptionItems'), itemData);
      }
      setEditingItem(null);
      toast.success('Option saved successfully');
    } catch (error) {
      console.error("Error saving item:", error);
      handleFirestoreError(error, editingItem.id ? OperationType.UPDATE : OperationType.CREATE, editingItem.id ? `/uniqueOptionItems/${editingItem.id}` : '/uniqueOptionItems');
      toast.error('Failed to save option');
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    if (window.confirm('Delete this option?')) {
      console.log("Deleting item:", itemId);
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

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-20">
      <div className="flex items-center justify-between border-b border-gold/10 pb-4">
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
            <Button onClick={handleDeleteGroup} disabled={loading} size="sm" variant="outline" className="border-blood/30 text-blood hover:bg-blood/10 gap-2">
              <Trash2 className="w-4 h-4" /> Delete Group
            </Button>
          )}
          <Button onClick={handleSaveGroup} disabled={loading} size="sm" className="bg-gold hover:bg-gold/90 text-white gap-2">
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
          </div>

          {/* Inline Item Form */}
          {id && (
            <div ref={formRef} className="p-4 border border-gold/20 bg-card/50 space-y-4">
              <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-gold border-b border-gold/10 pb-2">
                {editingItem?.id ? 'Edit Option' : 'Add New Option'}
              </h2>
              <form onSubmit={handleSaveItem} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold uppercase tracking-widest text-ink/40">Option Name</label>
                    <Input 
                      value={editingItem?.name || ''} 
                      onChange={e => setEditingItem(prev => ({ ...(prev || { levelPrerequisite: 0, isRepeatable: false }), name: e.target.value }))}
                      className="h-8 text-sm bg-background/50 border-gold/10 focus:border-gold"
                      placeholder="e.g. Agonizing Blast"
                      required={!!editingItem}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold uppercase tracking-widest text-ink/40">Source</label>
                    <select 
                      value={editingItem?.sourceId || ''} 
                      onChange={e => setEditingItem(prev => ({ ...(prev || { levelPrerequisite: 0, isRepeatable: false }), sourceId: e.target.value }))}
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
                      onChange={e => setEditingItem(prev => ({ ...(prev || { levelPrerequisite: 0, isRepeatable: false }), levelPrerequisite: parseInt(e.target.value) || 0 }))}
                      className="h-8 text-sm bg-background/50 border-gold/10 focus:border-gold"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold uppercase tracking-widest text-ink/40">Page Reference</label>
                    <Input 
                      value={editingItem?.page || ''} 
                      onChange={e => setEditingItem(prev => ({ ...(prev || { levelPrerequisite: 0, isRepeatable: false }), page: e.target.value }))}
                      placeholder="e.g. 155"
                      className="h-8 text-sm bg-background/50 border-gold/10 focus:border-gold"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold uppercase tracking-widest text-ink/40">String Prerequisite</label>
                    <Input 
                      value={editingItem?.stringPrerequisite || ''} 
                      onChange={e => setEditingItem(prev => ({ ...(prev || { levelPrerequisite: 0, isRepeatable: false }), stringPrerequisite: e.target.value }))}
                      placeholder="e.g. Eldritch Blast cantrip"
                      className="h-8 text-sm bg-background/50 border-gold/10 focus:border-gold"
                    />
                  </div>
                  <div className="flex items-center gap-2 pt-6">
                    <input 
                      type="checkbox" 
                      id="isRepeatable"
                      checked={editingItem?.isRepeatable || false}
                      onChange={e => setEditingItem(prev => ({ ...(prev || { levelPrerequisite: 0, isRepeatable: false, classIds: [] }), isRepeatable: e.target.checked }))}
                      className="w-3 h-3 rounded border-gold/20 text-gold focus:ring-gold"
                    />
                    <label htmlFor="isRepeatable" className="text-xs text-ink/40 uppercase font-bold cursor-pointer">
                      Repeatable
                    </label>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-widest text-ink/40">Class Restrictions</label>
                  <div className="flex flex-wrap gap-2 p-3 border border-gold/10 bg-background/30 rounded-md">
                    {classes.map(cls => (
                      <label key={cls.id} className="flex items-center gap-2 cursor-pointer group">
                        <input 
                          type="checkbox"
                          checked={(editingItem?.classIds || []).includes(cls.id)}
                          onChange={e => {
                            const currentIds = editingItem?.classIds || [];
                            const newIds = e.target.checked 
                              ? [...currentIds, cls.id]
                              : currentIds.filter((cid: string) => cid !== cls.id);
                            setEditingItem(prev => ({ ...(prev || { levelPrerequisite: 0, isRepeatable: false }), classIds: newIds }));
                          }}
                          className="w-3 h-3 rounded border-gold/20 text-gold focus:ring-gold"
                        />
                        <span className="text-[10px] font-bold uppercase tracking-tighter text-ink/60 group-hover:text-gold transition-colors">{cls.name}</span>
                      </label>
                    ))}
                    {classes.length === 0 && <p className="text-[10px] text-ink/20 italic">No classes found.</p>}
                  </div>
                  <p className="text-[9px] text-ink/30 italic">If none selected, all classes with access to this group can see this option.</p>
                </div>
                <MarkdownEditor 
                  textareaRef={itemDescRef}
                  value={editingItem?.description || ''} 
                  onChange={(val) => setEditingItem(prev => ({ ...(prev || { levelPrerequisite: 0, isRepeatable: false }), description: val }))}
                  placeholder="Enter the full text of the feature..."
                  minHeight="100px"
                  className="italic"
                  label="Description"
                />
                <div className="flex justify-end gap-2 pt-2">
                  {editingItem && (
                    <Button 
                      type="button" 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => setEditingItem(null)}
                      className="text-ink/40 text-xs"
                    >
                      Cancel
                    </Button>
                  )}
                  <Button 
                    type="submit" 
                    size="sm" 
                    disabled={!editingItem?.name}
                    className="bg-gold hover:bg-gold/90 text-white"
                  >
                    {editingItem?.id ? 'Update Option' : 'Add Option'}
                  </Button>
                </div>
              </form>
            </div>
          )}

          {/* Individual Options */}
          {id && (
            <div className="p-4 border border-gold/20 bg-card/50 space-y-4">
              <div className="flex items-center justify-between border-b border-gold/10 pb-2">
                <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-gold">Individual Options</h2>
              </div>
              
              <div className="space-y-4">
                {items.map((item) => (
                  <div key={item.id} className="p-4 border border-gold/10 bg-gold/5 group relative">
                    <div className="flex items-start justify-between mb-2">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold text-ink uppercase tracking-tight">{item.name}</h3>
                          {item.isRepeatable && (
                            <Repeat className="w-3 h-3 text-gold/40" />
                          )}
                        </div>
                        <div className="flex flex-wrap gap-3 text-xs font-bold uppercase tracking-widest text-ink/40">
                          <span className="flex items-center gap-1">
                            <Hash className="w-3 h-3" /> Level {item.levelPrerequisite || 0}+
                          </span>
                          {item.stringPrerequisite && (
                            <span className="flex items-center gap-1">
                              <Type className="w-3 h-3" /> {item.stringPrerequisite}
                            </span>
                          )}
                        </div>
                        {item.classIds && item.classIds.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {item.classIds.map((cid: string) => (
                              <span key={cid} className="text-[8px] font-bold uppercase px-1.5 py-0.5 bg-gold/10 text-gold border border-gold/20 rounded">
                                {classes.find(c => c.id === cid)?.name || 'Unknown Class'}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button variant="ghost" size="sm" onClick={() => { setEditingItem(item); formRef.current?.scrollIntoView({ behavior: 'smooth' }); }} className="h-6 w-6 p-0 text-gold"><Edit className="w-3 h-3" /></Button>
                        <Button variant="ghost" size="sm" onClick={() => handleDeleteItem(item.id)} className="h-6 w-6 p-0 text-blood"><Trash2 className="w-3 h-3" /></Button>
                      </div>
                    </div>
                    <BBCodeRenderer content={item.description} className="prose-sm text-sm line-clamp-3" />
                  </div>
                ))}
                {items.length === 0 && (
                  <div className="py-12 text-center border border-dashed border-gold/10">
                    <p className="text-xs text-ink/30 italic uppercase tracking-widest">No options added yet.</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

      </div>

    </div>
  );
}
