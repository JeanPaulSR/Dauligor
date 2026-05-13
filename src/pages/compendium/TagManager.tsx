import React, { useState, useEffect, useRef, useMemo } from 'react';
import { toast } from 'sonner';
import { useNavigate, Link } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Card, CardContent } from '../../components/ui/card';
import {
  Tags as TagsIcon,
  Trash2,
  Edit,
  ChevronRight,
  ChevronDown,
  X,
  Search,
  Filter,
  Check,
  Plus,
  Settings,
  CornerDownRight,
  Star,
  Layers,
  Hash
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { fetchCollection, upsertDocument, deleteDocument } from '../../lib/d1';
import { Database, CloudOff } from 'lucide-react';
import { normalizeTagRow, orderTagsAsTree } from '../../lib/tagHierarchy';

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

export default function TagManager({ userProfile }: { userProfile: any }) {
  const [tagGroups, setTagGroups] = useState<any[]>([]);
  const [tags, setTags] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isUsingD1, setIsUsingD1] = useState(false);
  const [selectedTab, setSelectedTab] = useState('all');
  
  // Group Form State
  const [editingGroup, setEditingGroup] = useState<any>(null);
  const [groupName, setGroupName] = useState('');
  const [groupClassifications, setGroupClassifications] = useState<string[]>([]);
  const [newClassification, setNewClassification] = useState('');
  const [groupDescription, setGroupDescription] = useState('');
  
  const isAdmin = userProfile?.role === 'admin';
  const navigate = useNavigate();

  useEffect(() => {
    const loadAll = async () => {
      setLoading(true);
      try {
        const [groupsData, tagsData] = await Promise.all([
          fetchCollection('tagGroups', { orderBy: 'name ASC' }),
          fetchCollection('tags', { orderBy: 'name ASC' }),
        ]);
        setTagGroups(groupsData);

        setIsUsingD1(tagsData.length > 0 || groupsData.length > 0);
        // Normalize tags so downstream code can rely on a consistent
        // shape (`groupId`, `parentTagId`) without sprinkling
        // `t.group_id ?? t.groupId` / `t.parent_tag_id ?? t.parentTagId`
        // ternaries everywhere. The handleDeleteGroup cascade below
        // also reads `groupId` via this normalized shape.
        setTags(tagsData.map(normalizeTagRow));
      } catch (err) {
        console.error("Error loading tags data:", err);
      } finally {
        setLoading(false);
      }
    };

    loadAll();
  }, []);

  const handleSaveGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupName || groupClassifications.length === 0) {
      toast.error('Name and at least one classification required');
      return;
    }

    try {
      const d1Data = {
        name: groupName,
        category: groupClassifications.length > 0 ? groupClassifications[0] : 'General',
        classifications: groupClassifications,
        description: groupDescription,
        updated_at: new Date().toISOString(),
      };

      const targetId = editingGroup?.id || crypto.randomUUID();
      await upsertDocument('tagGroups', targetId, d1Data);

      const stateItem = { id: targetId, ...d1Data };
      if (editingGroup) {
        setTagGroups(prev => prev.map(g => g.id === targetId ? stateItem : g));
        toast.success('Tag group updated');
      } else {
        setTagGroups(prev => [...prev, stateItem].sort((a, b) => a.name.localeCompare(b.name)));
        toast.success('Tag group created');
      }

      resetGroupForm();
    } catch (error) {
      console.error('Error saving tag group:', error);
      toast.error('Failed to save tag group');
    }
  };

  const resetGroupForm = () => {
    setEditingGroup(null);
    setGroupName('');
    setGroupClassifications([]);
    setGroupDescription('');
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

  const handleDeleteGroup = async (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (window.confirm('Delete this group and all its tags?')) {
      try {
        const groupTags = tags.filter(t => t.groupId === id);
        for (const tag of groupTags) {
          await deleteDocument('tags', tag.id);
        }
        await deleteDocument('tagGroups', id);
        setTagGroups(prev => prev.filter(g => g.id !== id));
        setTags(prev => prev.filter(t => t.groupId !== id));
        toast.success('Tag group deleted');
      } catch (error) {
        console.error('Error deleting tag group:', error);
        toast.error('Failed to delete tag group');
      }
    }
  };


  const toggleClassification = (cls: string) => {
    setGroupClassifications(prev => 
      prev.includes(cls) ? prev.filter(c => c !== cls) : [...prev, cls]
    );
  };

  // Dynamically compute all unique classifications across all tag groups to construct tabs
  const allDynamicClassifications = Array.from(new Set(tagGroups.flatMap(g => g.classifications || (g.category ? [g.category] : []))));
  const allTabs = Array.from(new Set([...SYSTEM_CLASSIFICATIONS, ...allDynamicClassifications])).sort();

  // Per-group ordered tag list (roots followed by their subtags), built
  // once and reused by the stats banner + the card render. Keyed by
  // group id for O(1) lookup inside the .map().
  const orderedTagsByGroup = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const tag of tags) {
      if (!tag.groupId) continue;
      (map[tag.groupId] = map[tag.groupId] || []).push(tag);
    }
    for (const gid in map) map[gid] = orderTagsAsTree(map[gid]);
    return map;
  }, [tags]);

  // Stats banner data — same numbers admins glance for during cleanup
  // sessions (catching empty groups, runaway hierarchies, etc.).
  const stats = useMemo(() => {
    const totalGroups = tagGroups.length;
    const totalTags = tags.length;
    const subtags = tags.filter(t => t.parentTagId).length;
    const rootTags = totalTags - subtags;
    return { totalGroups, totalTags, rootTags, subtags };
  }, [tagGroups, tags]);

  const filteredGroups = tagGroups.filter(group => {
    const matchesSearch = group.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          (group.classifications || [group.category]).some((c: string) => c.toLowerCase().includes(searchQuery.toLowerCase()));
    
    const matchesTab = selectedTab === 'all' || (group.classifications || [group.category]).includes(selectedTab);
    
    return matchesSearch && matchesTab;
  });

  if (!isAdmin) {
    return <div className="text-center py-20 font-serif text-2xl text-ink/40">Access Denied</div>;
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-20">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-gold/10 pb-4">
        <div>
          <div className="flex items-center gap-4">
            <h1 className="h1-title text-ink flex items-center gap-2">
              <TagsIcon className="w-8 h-8 text-gold" />
              Tag Management
            </h1>
            {isUsingD1 ? (
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                <Database className="w-3.5 h-3.5 text-emerald-500" />
                <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest">D1 Linked</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20">
                <CloudOff className="w-3.5 h-3.5 text-amber-500" />
                <span className="text-[10px] font-bold text-amber-500 uppercase tracking-widest">Legacy Firebase</span>
              </div>
            )}
          </div>
          <p className="description-text mt-1 text-ink/60">Organize and classify the compendium.</p>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink/40" />
            <Input 
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search tags..."
              className="pl-9 field-input w-64 focus:border-gold"
            />
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-12 gap-8 items-start">
        {/* Left Side: Form */}
        <div className="lg:col-span-4 space-y-6">
          <Card className="border-gold/20 bg-card/50 shadow-md">
            <h2 className="h3-title p-4 border-b border-gold/10 text-gold flex justify-between items-center">
              {editingGroup ? 'Edit Tag Group' : 'Create Tag Group'}
            </h2>
            <form onSubmit={handleSaveGroup} className="p-4 space-y-4">
              <div className="space-y-1">
                <label className="label-text text-ink/60">Group Name</label>
                <Input 
                  value={groupName}
                  onChange={e => setGroupName(e.target.value)}
                  className="bg-background/50 border-gold/10 focus:border-gold"
                  placeholder="e.g. Damage Types"
                />
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="label-text text-ink/60">System Classifications</label>
                  <p className="text-[10px] text-ink/40 leading-tight">These are hardcoded system classifications ensuring standard features (like the Class Editor) can automatically find these tag groups.</p>
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
                  <p className="text-[10px] text-ink/40 leading-tight">Add your own classifications to organize tag groups in new ways.</p>
                  <div className="flex flex-wrap gap-1">
                    {groupClassifications.filter(c => !SYSTEM_CLASSIFICATIONS.includes(c)).map(cls => (
                      <span key={cls} className="pl-2 pr-1 py-0.5 bg-gold/10 text-gold text-[10px] font-bold uppercase tracking-widest flex items-center gap-1 border border-gold/20">
                        {cls}
                        <button type="button" onClick={() => handleRemoveClassification(cls)} className="p-0.5 hover:bg-gold/20"><X className="w-3 h-3" /></button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Input 
                      value={newClassification} 
                      onChange={e => setNewClassification(e.target.value)} 
                      placeholder="add custom classification..." 
                      className="h-8 text-xs bg-background/50 border-gold/20"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddClassification(e);
                        }
                      }}
                    />
                    <Button type="button" size="sm" onClick={handleAddClassification} className="btn-gold-solid h-8">Add</Button>
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <label className="label-text text-ink/60">Description</label>
                <textarea 
                  value={groupDescription}
                  onChange={e => setGroupDescription(e.target.value)}
                  className="w-full text-sm p-3 border border-gold/10 bg-background/50 focus:border-gold min-h-[80px] outline-none"
                  placeholder="Optional description..."
                />
              </div>

              <div className="flex gap-2 pt-2">
                {editingGroup && (
                  <Button type="button" variant="outline" className="flex-1 border-gold/20 text-ink/60 hover:text-ink" onClick={resetGroupForm}>
                    Cancel
                  </Button>
                )}
                <Button type="submit" className="flex-1 btn-gold-solid shadow-md shadow-gold/20">
                  {editingGroup ? 'Apply Changes' : 'Save Group'}
                </Button>
              </div>
            </form>
          </Card>

        </div>

        {/* Right Side: List */}
        <div className="lg:col-span-8 space-y-6">
          {/* Stats banner — quick at-a-glance numbers admins use during
            * cleanup ("are there empty groups?", "how many subtags?"). */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Groups',    value: stats.totalGroups, icon: Layers,            tint: 'text-gold' },
              { label: 'Tags',      value: stats.totalTags,   icon: Hash,              tint: 'text-emerald-500' },
              { label: 'Root Tags', value: stats.rootTags,    icon: Star,              tint: 'text-sky-500' },
              { label: 'Subtags',   value: stats.subtags,     icon: CornerDownRight,   tint: 'text-amber-500' },
            ].map(({ label, value, icon: Icon, tint }) => (
              <Card key={label} className="border-gold/10 bg-card/40 p-3 flex items-center gap-3">
                <div className={cn("w-9 h-9 rounded bg-background/50 flex items-center justify-center", tint)}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-bold uppercase tracking-widest text-ink/50">{label}</div>
                  <div className="text-xl font-bold text-ink leading-tight">{value}</div>
                </div>
              </Card>
            ))}
          </div>

          <div className="flex flex-wrap gap-2 border-b border-gold/10 pb-4">
            {['all', ...allTabs].map(tab => (
              <button
                key={tab}
                onClick={() => setSelectedTab(tab)}
                className={cn(
                  "px-4 py-1.5 text-xs font-bold uppercase tracking-widest transition-all border",
                  selectedTab === tab 
                    ? "bg-gold text-white border-gold shadow-md shadow-gold/20" 
                    : "bg-card border-gold/20 text-ink/60 hover:text-gold hover:border-gold/40"
                )}
              >
                {tab}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="text-center py-20">
              <div className="w-8 h-8 border-4 border-gold border-t-white rounded-full animate-spin mx-auto mb-4" />
              <p className="description-text">Loading the archives...</p>
            </div>
          ) : filteredGroups.length === 0 ? (
            <div className="text-center py-20 bg-card/30 border border-dashed border-gold/20">
              <p className="description-text text-ink/40">No tag groups found matching the criteria.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredGroups.map(group => {
                const groupTags = orderedTagsByGroup[group.id] ?? [];
                const subtagCount = groupTags.filter(t => t.parentTagId).length;
                const rootCount = groupTags.length - subtagCount;
                const classifications = group.classifications || (group.category ? [group.category] : []);

                // First 6 tags as a preview row. Subtags inherit their
                // root's adjacency from `orderedTagsByGroup` (the helper
                // groups parent + children). "+N more" rolls up the rest.
                const PREVIEW_CAP = 6;
                const previewTags = groupTags.slice(0, PREVIEW_CAP);
                const moreCount = Math.max(0, groupTags.length - PREVIEW_CAP);
                const isEmpty = groupTags.length === 0;

                return (
                  <Card key={group.id} className="border border-gold/20 hover:border-gold/50 transition-all overflow-hidden bg-card/50 hover:shadow-md hover:shadow-gold/5 cursor-pointer">
                    <div className="p-4 flex flex-col sm:flex-row sm:items-stretch gap-4 w-full text-left" onClick={() => navigate(`/compendium/tags/${group.id}`)}>
                      {/* Count tile — primary number is roots, secondary
                       *  small line shows "+N subtags" only when non-zero
                       *  so the common case (no hierarchy) stays clean. */}
                      <div className={cn(
                        "w-12 shrink-0 flex flex-col items-center justify-center border",
                        isEmpty
                          ? "bg-background/30 text-ink/30 border-gold/10"
                          : "bg-gold/10 text-gold border-gold/20",
                      )}>
                        <span className="font-bold text-base leading-none">{rootCount}</span>
                        {subtagCount > 0 && (
                          <span className="text-[9px] mt-1 text-amber-500/80 font-bold tracking-wide flex items-center gap-0.5">
                            <CornerDownRight className="w-2.5 h-2.5" />
                            {subtagCount}
                          </span>
                        )}
                      </div>

                      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="text-lg font-bold text-ink flex items-center gap-2 leading-tight">
                              {group.name}
                              {isEmpty && (
                                <span className="text-[10px] font-bold uppercase tracking-widest text-ink/30 border border-ink/10 px-1.5 py-0.5">Empty</span>
                              )}
                            </h3>
                            {classifications.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1">
                                {classifications.map((cls: string) => (
                                  <span key={cls} className="text-[9px] uppercase tracking-widest font-bold text-gold/80 bg-gold/10 border border-gold/10 px-1.5 py-0.5">
                                    {cls}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <Button
                              variant="ghost" size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingGroup(group);
                                setGroupName(group.name);
                                setGroupClassifications(classifications);
                                setGroupDescription(group.description || '');
                                window.scrollTo({ top: 0, behavior: 'smooth' });
                              }}
                              className="w-8 h-8 p-0 text-ink/40 hover:text-gold"
                              title="Edit Group Details"
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost" size="sm"
                              onClick={(e) => handleDeleteGroup(group.id, e)}
                              className="w-8 h-8 p-0 text-ink/40 hover:text-blood hover:bg-blood/5"
                              title="Delete Group"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost" size="sm"
                              className="text-xs text-gold/60 hover:text-gold border border-transparent hover:border-gold/20"
                            >
                              <Settings className="w-4 h-4 sm:mr-1" />
                              <span className="hidden sm:inline">Manage</span>
                            </Button>
                          </div>
                        </div>

                        {group.description && (
                          <p className="text-sm text-ink/60 line-clamp-1">{group.description}</p>
                        )}

                        {/* Tag preview row — subtags get the same `↳`
                         *  glyph used in the spell pickers and the
                         *  per-group editor, so the visual vocabulary
                         *  stays consistent across the surface. */}
                        {groupTags.length > 0 ? (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {previewTags.map(tag => (
                              <span
                                key={tag.id}
                                className={cn(
                                  "text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 border",
                                  tag.parentTagId
                                    ? "bg-amber-500/5 border-amber-500/20 text-amber-500/90"
                                    : "bg-gold/5 border-gold/15 text-ink/70"
                                )}
                              >
                                {tag.parentTagId && <span className="opacity-60 mr-0.5">↳</span>}
                                {tag.name}
                              </span>
                            ))}
                            {moreCount > 0 && (
                              <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 text-ink/40">
                                +{moreCount} more
                              </span>
                            )}
                          </div>
                        ) : (
                          <p className="text-[11px] italic text-ink/30 mt-1">No tags yet — click Manage to add some.</p>
                        )}
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
