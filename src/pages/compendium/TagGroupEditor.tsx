import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { doc, getDoc, updateDoc, collection, query, where, onSnapshot, addDoc, deleteDoc, orderBy } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { toast } from 'sonner';
import { Tags as TagsIcon, ArrowLeft, Plus, X, Trash2, Edit2, Check } from 'lucide-react';
import { cn } from '../../lib/utils';

const SYSTEM_CLASSIFICATIONS = [
  'class',
  'subclass',
  'race',
  'subrace',
  'feat',
  'background',
  'skill',
  'tool',
  'spell',
  'item',
  'lore'
];

export default function TagGroupEditor({ userProfile }: { userProfile: any }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isAdmin = userProfile?.role === 'admin';

  const [group, setGroup] = useState<any>(null);
  const [tags, setTags] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Group Editing
  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');
  const [groupClassifications, setGroupClassifications] = useState<string[]>([]);
  const [newClassification, setNewClassification] = useState('');
  const [isEditingGroup, setIsEditingGroup] = useState(false);

  // Tag Editing
  const [newTagName, setNewTagName] = useState('');
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [editingTagName, setEditingTagName] = useState('');

  useEffect(() => {
    if (!id || !isAdmin) return;

    const fetchGroup = async () => {
      try {
        const docRef = doc(db, 'tagGroups', id);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = { id: docSnap.id, ...(docSnap.data() as any) };
          setGroup(data);
          setGroupName(data.name || '');
          setGroupDescription(data.description || '');
          setGroupClassifications(data.classifications || (data.category ? [data.category] : []));
        } else {
          toast.error('Tag group not found');
          navigate('/compendium/tags');
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, `tagGroups/${id}`);
      } finally {
        setLoading(false);
      }
    };

    fetchGroup();

    const q = query(collection(db, 'tags'), where('groupId', '==', id));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedTags = snapshot.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      fetchedTags.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      setTags(fetchedTags);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'tags');
    });

    return () => unsubscribe();
  }, [id, navigate, isAdmin]);

  const handleSaveGroupInfo = async () => {
    if (!groupName.trim()) {
      toast.error('Group name is required');
      return;
    }
    try {
      await updateDoc(doc(db, 'tagGroups', id!), {
        name: groupName,
        description: groupDescription,
        classifications: groupClassifications,
        updatedAt: new Date().toISOString()
      });
      setGroup({ ...group, name: groupName, description: groupDescription, classifications: groupClassifications });
      setIsEditingGroup(false);
      toast.success('Group updated');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `tagGroups/${id}`);
    }
  };

  const toggleClassification = (cls: string) => {
    setGroupClassifications(prev => 
      prev.includes(cls) ? prev.filter(c => c !== cls) : [...prev, cls]
    );
  };

  const handleAddClassification = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClassification.trim() || groupClassifications.includes(newClassification.trim().toLowerCase())) return;
    setGroupClassifications([...groupClassifications, newClassification.trim().toLowerCase()]);
    setNewClassification('');
  };

  const handleRemoveClassification = (cls: string) => {
    setGroupClassifications(groupClassifications.filter(c => c !== cls));
  };

  const handleAddTag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTagName.trim()) return;

    try {
      await addDoc(collection(db, 'tags'), {
        name: newTagName.trim(),
        groupId: id,
        updatedAt: new Date().toISOString()
      });
      setNewTagName('');
      toast.success('Tag added');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'tags');
    }
  };

  const handleUpdateTag = async (tagId: string) => {
    if (!editingTagName.trim()) return;
    try {
      await updateDoc(doc(db, 'tags', tagId), {
        name: editingTagName.trim(),
        updatedAt: new Date().toISOString()
      });
      setEditingTagId(null);
      setEditingTagName('');
      toast.success('Tag updated');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `tags/${tagId}`);
    }
  };

  const handleDeleteTag = async (tagId: string) => {
    if (window.confirm('Delete this tag?')) {
      try {
        await deleteDoc(doc(db, 'tags', tagId));
        toast.success('Tag deleted');
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, `tags/${tagId}`);
      }
    }
  };

  if (!isAdmin) {
    return <div className="text-center py-20 font-serif text-2xl text-ink/40">Access Denied</div>;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-20">
        <div className="w-8 h-8 border-4 border-gold border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-20">
      <div className="flex items-center gap-4 border-b border-gold/10 pb-4">
        <Button variant="ghost" onClick={() => navigate('/compendium/tags')} className="text-ink/60 hover:text-gold px-2">
          <ArrowLeft className="w-5 h-5 mr-1" /> Back
        </Button>
        <div>
          <h1 className="h2-title text-ink break-words">{group?.name}</h1>
          <p className="label-text text-ink/40 mt-1 uppercase tracking-widest">{groupClassifications.join(', ')}</p>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-6 items-start">
        {/* Left Col: Tag Group Metadata */}
        <div className="md:col-span-1 space-y-4">
          <Card className="border-gold/20 bg-card p-4 space-y-4">
            <div className="flex items-center justify-between border-b border-gold/10 pb-2">
              <h2 className="label-text text-gold">Group Settings</h2>
              <Button variant="ghost" size="sm" onClick={() => setIsEditingGroup(!isEditingGroup)} className="h-6 px-2 text-[10px] text-ink/40 hover:text-gold">
                {isEditingGroup ? 'Cancel' : 'Edit'}
              </Button>
            </div>

            {isEditingGroup ? (
              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="label-text text-ink/60">Name</label>
                  <Input 
                    value={groupName} 
                    onChange={e => setGroupName(e.target.value)} 
                    className="bg-background/50 h-8 text-sm border-gold/20" 
                  />
                </div>
                <div className="space-y-1">
                  <label className="label-text text-ink/60">Description</label>
                  <textarea 
                    value={groupDescription} 
                    onChange={e => setGroupDescription(e.target.value)} 
                    className="w-full text-sm p-2 border border-gold/20 bg-background/50 outline-none min-h-[80px]" 
                  />
                </div>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="label-text text-ink/60">System Classifications</label>
                    <div className="flex flex-wrap gap-1">
                      {SYSTEM_CLASSIFICATIONS.map(cls => (
                        <button
                          key={cls}
                          type="button"
                          onClick={() => toggleClassification(cls)}
                          className={cn(
                            "px-2 py-1 text-[10px] font-bold uppercase tracking-widest transition-colors border",
                            groupClassifications.includes(cls) 
                              ? "bg-gold text-white border-gold" 
                              : "bg-background/50 text-ink/60 border-gold/20 hover:border-gold/40"
                          )}
                        >
                          {cls}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="label-text text-ink/60">Custom Classifications</label>
                    <div className="flex flex-wrap gap-1">
                      {groupClassifications.filter(c => !SYSTEM_CLASSIFICATIONS.includes(c)).map(cls => (
                        <span key={cls} className="pl-2 pr-1 py-0.5 bg-gold/10 text-gold text-[10px] font-bold uppercase tracking-widest flex items-center gap-1 border border-gold/20">
                          {cls}
                          <button type="button" onClick={() => handleRemoveClassification(cls)} className="p-0.5 hover:bg-gold/20"><X className="w-3 h-3" /></button>
                        </span>
                      ))}
                    </div>
                    <form onSubmit={handleAddClassification} className="flex gap-2">
                      <Input 
                        value={newClassification} 
                        onChange={e => setNewClassification(e.target.value)} 
                        placeholder="e.g. custom..." 
                        className="h-7 text-xs bg-background/50 border-gold/20"
                      />
                      <Button type="submit" size="sm" className="h-7 px-2 bg-gold hover:bg-gold/90 text-[10px] text-white">Add</Button>
                    </form>
                  </div>
                </div>
                <Button onClick={handleSaveGroupInfo} className="w-full h-8 bg-gold hover:bg-gold/90 text-white text-xs">
                  Save Changes
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-ink/70">{group?.description || <span className="italic text-ink/40">No description provided.</span>}</p>
              </div>
            )}
          </Card>
        </div>

        {/* Right Col: Tags List */}
        <div className="md:col-span-2 space-y-4">
          <Card className="border-gold/20 bg-card overflow-hidden flex flex-col h-[600px] shadow-lg">
            <div className="p-4 border-b border-gold/10 bg-gold/5 flex items-center justify-between">
              <h3 className="h3-title text-gold flex items-center gap-2">
                <TagsIcon className="w-5 h-5" /> Tags
                <span className="text-xs bg-gold/20 text-gold px-2 py-0.5">{tags.length}</span>
              </h3>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-1">
              <div className="grid grid-cols-[1fr_auto] gap-2 mb-2 p-2 border-b border-gold/20 pb-2">
                <span className="label-text text-ink/40 pl-2">Name</span>
                <span className="label-text text-ink/40 text-right pr-2">Actions</span>
              </div>
              {tags.length === 0 ? (
                <div className="text-center py-10 text-ink/40 italic">No tags in this group. Add one below.</div>
              ) : (
                tags.map((tag, idx) => (
                  <div key={tag.id} className={cn(
                    "flex items-center justify-between group p-1 hover:bg-gold/5 transition-colors border-l-4 border-transparent hover:border-gold",
             idx % 2 === 0 ? "bg-background/30" : "bg-transparent"
                  )}>
                    {editingTagId === tag.id ? (
                      <div className="flex-1 flex gap-2 items-center pl-2">
                        <Input 
                          value={editingTagName} 
                          onChange={e => setEditingTagName(e.target.value)} 
                          autoFocus
                          className="h-7 text-sm font-bold w-full bg-background border-gold/30"
                          onKeyDown={e => { if (e.key === 'Enter') handleUpdateTag(tag.id); if (e.key === 'Escape') setEditingTagId(null); }}
                        />
                        <Button size="sm" onClick={() => handleUpdateTag(tag.id)} className="h-7 w-7 p-0 bg-gold hover:bg-gold/90 text-white shrink-0"><Check className="w-4 h-4" /></Button>
                        <Button variant="ghost" size="sm" onClick={() => setEditingTagId(null)} className="h-7 w-7 p-0 text-ink/40 shrink-0"><X className="w-4 h-4" /></Button>
                      </div>
                    ) : (
                      <>
                        <span className="font-bold text-ink pl-2 truncate">{tag.name}</span>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button variant="ghost" size="sm" onClick={() => { setEditingTagId(tag.id); setEditingTagName(tag.name); }} className="h-7 w-7 p-0 text-ink/40 hover:text-gold"><Edit2 className="w-3.5 h-3.5" /></Button>
                          <Button variant="ghost" size="sm" onClick={() => handleDeleteTag(tag.id)} className="h-7 w-7 p-0 text-ink/40 hover:text-blood hover:bg-blood/5"><Trash2 className="w-3.5 h-3.5" /></Button>
                        </div>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="p-4 border-t border-gold/10 bg-background/50">
              <form onSubmit={handleAddTag} className="flex gap-2">
                <Input 
                  value={newTagName} 
                  onChange={e => setNewTagName(e.target.value)} 
                  placeholder="New tag name..." 
                  className="flex-1 bg-card border-gold/20 focus:border-gold"
                />
                <Button type="submit" disabled={!newTagName.trim()} className="bg-gold hover:bg-gold/90 text-white gap-2">
                  <Plus className="w-4 h-4" /> Add Tag
                </Button>
              </form>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
