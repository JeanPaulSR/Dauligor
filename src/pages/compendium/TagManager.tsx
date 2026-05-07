import React, { useState, useEffect, useRef } from 'react';
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
  Settings
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { fetchCollection, upsertDocument, deleteDocument } from '../../lib/d1';
import { Database, CloudOff } from 'lucide-react';

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
        setTags(tagsData);
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
        const groupTags = tags.filter(t => (t.group_id || t.groupId) === id);
        for (const tag of groupTags) {
          await deleteDocument('tags', tag.id);
        }
        await deleteDocument('tagGroups', id);
        setTagGroups(prev => prev.filter(g => g.id !== id));
        setTags(prev => prev.filter(t => (t.group_id || t.groupId) !== id));
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
                const groupTags = tags.filter(t => (t.group_id || t.groupId) === group.id);
                const classifications = group.classifications || (group.category ? [group.category] : []);

                return (
                  <Card key={group.id} className="border border-gold/20 hover:border-gold/50 transition-all overflow-hidden bg-card/50 hover:shadow-md hover:shadow-gold/5 cursor-pointer">
                    <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 w-full text-left" onClick={() => navigate(`/compendium/tags/${group.id}`)}>
                      <div className="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-center gap-4">
                        <div className="w-10 h-10 bg-gold/10 text-gold flex items-center justify-center font-bold text-sm shrink-0 border border-gold/20">
                          {groupTags.length}
                        </div>
                        <div>
                          <h3 className="text-lg font-bold text-ink flex items-center gap-2">
                            {group.name}
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
                          {group.description && <p className="text-sm text-ink/60 mt-1 line-clamp-2">{group.description}</p>}
                        </div>
                      </div>

                      <div className="flex items-center gap-1 sm:ml-4 shrink-0">
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
                          className="w-full sm:w-auto mt-2 sm:mt-0 text-xs text-gold/60 hover:text-gold border border-transparent hover:border-gold/20"
                        >
                          <Settings className="w-4 h-4 sm:mr-1" />
                          <span className="hidden sm:inline">Manage Tags</span>
                        </Button>
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
