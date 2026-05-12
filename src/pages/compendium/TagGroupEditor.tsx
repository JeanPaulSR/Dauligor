import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { toast } from 'sonner';
import { Tags as TagsIcon, ArrowLeft, Plus, X, Trash2, Edit2, Check, Database, CloudOff, CornerDownRight } from 'lucide-react';
import { cn } from '../../lib/utils';
import { fetchCollection, fetchDocument, upsertDocument, deleteDocument } from '../../lib/d1';

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
  const [isUsingD1, setIsUsingD1] = useState(false);

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

  // Subtag adding — when non-null, an inline form is open below that
  // root tag for typing the subtag name. The UI enforces single-level
  // nesting by only exposing "+ Subtag" on root tags (parent_tag_id is
  // null), so we never reach sub-sub-tags.
  const [addingSubtagOfId, setAddingSubtagOfId] = useState<string | null>(null);
  const [newSubtagName, setNewSubtagName] = useState('');

  useEffect(() => {
    if (!id || !isAdmin) return;

    const loadData = async () => {
      setLoading(true);
      try {
        // 1. Fetch Group
        const groupData = await fetchDocument<any>('tagGroups', id);

        if (groupData) {
          setGroup(groupData);
          setGroupName(groupData.name || '');
          setGroupDescription(groupData.description || '');
          setGroupClassifications(groupData.classifications || (groupData.category ? [groupData.category] : []));
          setIsUsingD1(true);
        } else {
          toast.error('Tag group not found');
          navigate('/compendium/tags');
          return;
        }

        // 2. Fetch Tags
        const tagsData = await fetchCollection('tags', {
          where: 'group_id = ?',
          params: [id],
          orderBy: 'name ASC',
        });

        setTags(tagsData);
      } catch (err) {
        console.error("Error loading tag group data:", err);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [id, navigate, isAdmin]);

  const handleSaveGroupInfo = async () => {
    if (!groupName.trim()) {
      toast.error('Group name is required');
      return;
    }
    try {
      const d1Data = {
        name: groupName,
        description: groupDescription,
        classifications: groupClassifications,
        updated_at: new Date().toISOString(),
      };
      await upsertDocument('tagGroups', id!, d1Data);
      setGroup({ ...group, ...d1Data });
      setIsEditingGroup(false);
      toast.success('Group updated');
    } catch (error) {
      console.error('Error saving group:', error);
      toast.error('Failed to save group');
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

  // Shared insert path for both root tags (parentTagId = null) and
  // subtags (parentTagId = the parent's tag id). The two callers
  // upstream are the bottom form (`onSubmit` -> handleAddRootTag) and
  // the inline subtag form (-> handleAddSubtag) — both feed into here.
  const addTag = async (name: string, parentTagId: string | null) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const newId = crypto.randomUUID();
    const slug = trimmed.toLowerCase().replace(/\s+/g, '-');
    const d1Data: Record<string, any> = {
      group_id: id,
      name: trimmed,
      slug,
      updated_at: new Date().toISOString(),
    };
    if (parentTagId) d1Data.parent_tag_id = parentTagId;
    await upsertDocument('tags', newId, d1Data);
    setTags(prev =>
      [...prev, { id: newId, ...d1Data }].sort((a, b) => a.name.localeCompare(b.name)),
    );
  };

  const handleAddTag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTagName.trim()) return;
    try {
      await addTag(newTagName, null);
      setNewTagName('');
      toast.success('Tag added');
    } catch (error) {
      console.error('Error adding tag:', error);
      toast.error('Failed to add tag');
    }
  };

  const handleAddSubtag = async (e: React.FormEvent, parentTagId: string) => {
    e.preventDefault();
    if (!newSubtagName.trim()) return;
    try {
      await addTag(newSubtagName, parentTagId);
      setNewSubtagName('');
      setAddingSubtagOfId(null);
      toast.success('Subtag added');
    } catch (error) {
      console.error('Error adding subtag:', error);
      toast.error('Failed to add subtag');
    }
  };

  const handleUpdateTag = async (tagId: string) => {
    if (!editingTagName.trim()) return;
    try {
      // upsertDocument runs `INSERT ... ON CONFLICT(id) DO UPDATE`, and
      // SQLite validates NOT NULL constraints against the would-be
      // inserted row BEFORE the conflict resolves to UPDATE. So even on
      // pure updates we must supply every NOT NULL column — for `tags`
      // that's `group_id` + `name` + `slug`. Slug stays in sync with
      // name on rename (matches the create-side derivation in
      // handleAddTag).
      const trimmedName = editingTagName.trim();
      const d1Data = {
        group_id: id,
        name: trimmedName,
        slug: trimmedName.toLowerCase().replace(/\s+/g, '-'),
        updated_at: new Date().toISOString(),
      };
      await upsertDocument('tags', tagId, d1Data);
      setTags(prev => prev.map(t => t.id === tagId ? { ...t, ...d1Data } : t));
      setEditingTagId(null);
      setEditingTagName('');
      toast.success('Tag updated');
    } catch (error) {
      console.error('Error updating tag:', error);
      toast.error('Failed to update tag');
    }
  };

  const handleDeleteTag = async (tagId: string) => {
    // Find subtags via parent_tag_id (or its camelCase alias, for the
    // brief window where state may still carry pre-rename rows). Cascade
    // explicitly in app code rather than relying on an FK ON DELETE
    // clause — the prompt gives the user a count and a chance to bail
    // before destructive work, which an FK can't.
    const children = tags.filter(t => (t.parent_tag_id ?? t.parentTagId) === tagId);
    const message = children.length > 0
      ? `Delete this tag and its ${children.length} subtag${children.length === 1 ? '' : 's'}?`
      : 'Delete this tag?';
    if (!window.confirm(message)) return;

    try {
      for (const child of children) {
        await deleteDocument('tags', child.id);
      }
      await deleteDocument('tags', tagId);
      setTags(prev => prev.filter(t => t.id !== tagId && (t.parent_tag_id ?? t.parentTagId) !== tagId));
      toast.success(children.length > 0
        ? `Deleted tag and ${children.length} subtag${children.length === 1 ? '' : 's'}`
        : 'Tag deleted');
    } catch (error) {
      console.error('Error deleting tag:', error);
      toast.error('Failed to delete tag');
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
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="h2-title text-ink break-words">{group?.name}</h1>
            {isUsingD1 ? (
              <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                <Database className="w-3 h-3 text-emerald-500" />
                <span className="text-[9px] font-bold text-emerald-500 uppercase tracking-tighter">D1 Linked</span>
              </div>
            ) : (
              <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20">
                <CloudOff className="w-3 h-3 text-amber-500" />
                <span className="text-[9px] font-bold text-amber-500 uppercase tracking-tighter">Legacy Firebase</span>
              </div>
            )}
          </div>
          <p className="label-text text-ink/40 mt-1 uppercase tracking-widest">{groupClassifications.join(', ')}</p>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-6 items-start">
        {/* Left Col: Tag Group Metadata */}
        <div className="md:col-span-1 space-y-4">
          <Card className="border-gold/20 bg-card p-4 space-y-4">
            <div className="section-header">
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
                      <Button type="submit" size="sm" className="h-7 px-2 btn-gold-solid text-[10px]">Add</Button>
                    </form>
                  </div>
                </div>
                <Button onClick={handleSaveGroupInfo} className="w-full h-8 btn-gold-solid text-xs">
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
                (() => {
                  // Build a 2-level tree from the flat list. Roots have
                  // parent_tag_id null/undefined; subtags index by their
                  // parent's id. Both levels stay alphabetical inside
                  // their bucket.
                  const parentIdOf = (t: any) => t.parent_tag_id ?? t.parentTagId ?? null;
                  const roots = tags
                    .filter(t => !parentIdOf(t))
                    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
                  const childrenByParent = new Map<string, any[]>();
                  for (const t of tags) {
                    const pid = parentIdOf(t);
                    if (!pid) continue;
                    if (!childrenByParent.has(pid)) childrenByParent.set(pid, []);
                    childrenByParent.get(pid)!.push(t);
                  }
                  for (const arr of childrenByParent.values()) {
                    arr.sort((a, b) => String(a.name).localeCompare(String(b.name)));
                  }

                  // Renders one row at a given depth. Same edit/delete
                  // affordances at both levels; subtags omit the
                  // "+ Subtag" button to enforce 2-level nesting.
                  const renderRow = (tag: any, depth: 0 | 1, zebraIdx: number) => {
                    const isEditing = editingTagId === tag.id;
                    return (
                      <div key={tag.id} className={cn(
                        "flex items-center justify-between group p-1 hover:bg-gold/5 transition-colors border-l-4 border-transparent hover:border-gold",
                        zebraIdx % 2 === 0 ? "bg-background/30" : "bg-transparent"
                      )}
                        style={depth === 1 ? { paddingLeft: '24px' } : undefined}
                      >
                        {isEditing ? (
                          <div className="flex-1 flex gap-2 items-center pl-2">
                            <Input
                              value={editingTagName}
                              onChange={e => setEditingTagName(e.target.value)}
                              autoFocus
                              className="h-7 text-sm font-bold w-full bg-background border-gold/30"
                              onKeyDown={e => { if (e.key === 'Enter') handleUpdateTag(tag.id); if (e.key === 'Escape') setEditingTagId(null); }}
                            />
                            <Button size="sm" onClick={() => handleUpdateTag(tag.id)} className="h-7 w-7 p-0 btn-gold-solid shrink-0"><Check className="w-4 h-4" /></Button>
                            <Button variant="ghost" size="sm" onClick={() => setEditingTagId(null)} className="h-7 w-7 p-0 text-ink/40 shrink-0"><X className="w-4 h-4" /></Button>
                          </div>
                        ) : (
                          <>
                            <span className="font-bold text-ink pl-2 truncate flex items-center gap-2">
                              {depth === 1 && <CornerDownRight className="w-3.5 h-3.5 text-ink/30 shrink-0" />}
                              {tag.name}
                            </span>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              {depth === 0 && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    setAddingSubtagOfId(tag.id);
                                    setNewSubtagName('');
                                  }}
                                  className="h-7 px-2 text-[10px] text-ink/40 hover:text-gold"
                                  title="Add a subtag under this tag"
                                >
                                  <Plus className="w-3 h-3 mr-1" /> Subtag
                                </Button>
                              )}
                              <Button variant="ghost" size="sm" onClick={() => { setEditingTagId(tag.id); setEditingTagName(tag.name); }} className="h-7 w-7 p-0 text-ink/40 hover:text-gold"><Edit2 className="w-3.5 h-3.5" /></Button>
                              <Button variant="ghost" size="sm" onClick={() => handleDeleteTag(tag.id)} className="h-7 w-7 p-0 text-ink/40 hover:text-blood hover:bg-blood/5"><Trash2 className="w-3.5 h-3.5" /></Button>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  };

                  // Inline form for adding a subtag — appears right
                  // under the parent root tag, indented to match
                  // subtag rows. Enter submits, Escape cancels.
                  const renderInlineSubtagForm = (parentTagId: string) => (
                    <form
                      key={`add-subtag-${parentTagId}`}
                      onSubmit={(e) => handleAddSubtag(e, parentTagId)}
                      className="flex items-center gap-2 p-1 bg-gold/5 border-l-4 border-gold/40"
                      style={{ paddingLeft: '24px' }}
                    >
                      <CornerDownRight className="w-3.5 h-3.5 text-gold/60 shrink-0" />
                      <Input
                        value={newSubtagName}
                        onChange={e => setNewSubtagName(e.target.value)}
                        placeholder="New subtag name..."
                        autoFocus
                        className="h-7 text-sm font-bold flex-1 bg-background border-gold/30"
                        onKeyDown={e => { if (e.key === 'Escape') { setAddingSubtagOfId(null); setNewSubtagName(''); } }}
                      />
                      <Button type="submit" size="sm" disabled={!newSubtagName.trim()} className="h-7 px-2 btn-gold-solid text-[10px] shrink-0">Add</Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => { setAddingSubtagOfId(null); setNewSubtagName(''); }} className="h-7 w-7 p-0 text-ink/40 shrink-0"><X className="w-4 h-4" /></Button>
                    </form>
                  );

                  let zebra = 0;
                  const out: React.ReactNode[] = [];
                  for (const root of roots) {
                    out.push(renderRow(root, 0, zebra++));
                    const children = childrenByParent.get(root.id) ?? [];
                    for (const child of children) {
                      out.push(renderRow(child, 1, zebra++));
                    }
                    if (addingSubtagOfId === root.id) {
                      out.push(renderInlineSubtagForm(root.id));
                    }
                  }
                  return out;
                })()
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
                <Button type="submit" disabled={!newTagName.trim()} className="btn-gold-solid gap-2">
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
