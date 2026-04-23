import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../../lib/firebase';
import { collection, query, orderBy, onSnapshot, doc, getDoc, where } from 'firebase/firestore';
import { Card, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Input } from '../../components/ui/input';
import { 
  Sword, 
  Plus, 
  Search, 
  BookOpen, 
  Shield, 
  ChevronRight,
  ChevronLeft,
  Scroll,
  Filter,
  Settings2,
  X,
  Check,
  Trash2,
  AlertTriangle,
  Upload
} from 'lucide-react';
import { handleFirestoreError, OperationType } from '../../lib/firebase';
import { cn } from '../../lib/utils';
import { deleteDoc } from 'firebase/firestore';
import Markdown from 'react-markdown';
import BBCodeRenderer from '../../components/BBCodeRenderer';
import ModularChoiceView from '../../components/compendium/ModularChoiceView';
import FeaturesView from '../../components/compendium/FeaturesView';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { ScrollArea } from "../../components/ui/scroll-area";
import { FilterBar } from '../../components/compendium/FilterBar';
import { 
  importClassSemantic
} from '../../lib/classExport';
import { toast } from 'sonner';

export function ClassList({ 
  userProfile,
  selectionMode = false,
  onSelectClass,
  onCancelSelection
}: { 
  userProfile: any,
  selectionMode?: boolean,
  onSelectClass?: (classData: any) => void,
  onCancelSelection?: () => void
}) {
  const [classes, setClasses] = useState<any[]>([]);
  const [sources, setSources] = useState<Record<string, any>>({});
  const [tagGroups, setTagGroups] = useState<any[]>([]);
  const [allTags, setAllTags] = useState<any[]>([]);
  const [loadingStates, setLoadingStates] = useState({
    classes: true,
    sources: true,
    tagGroups: true,
    tags: true
  });
  const [search, setSearch] = useState('');
  
  // Filter State
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  // tagId -> state (0: none, 1: include, 2: exclude)
  const [tagStates, setTagStates] = useState<Record<string, number>>({});
  const [groupCombineModes, setGroupCombineModes] = useState<Record<string, 'AND' | 'OR' | 'XOR'>>({});
  const [groupExclusionModes, setGroupExclusionModes] = useState<Record<string, 'AND' | 'OR' | 'XOR'>>({});

  // Delete Confirmation State
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [classToDelete, setClassToDelete] = useState<{ id: string, name: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Selected Class (for Preview)
  const [selectedClass, setSelectedClass] = useState<any | null>(null);
  const [previewFeatures, setPreviewFeatures] = useState<any[]>([]);
  const [previewScalings, setPreviewScalings] = useState<any[]>([]);
  const [previewSpellcasting, setPreviewSpellcasting] = useState<any>(null);
  const [previewAltSpellcasting, setPreviewAltSpellcasting] = useState<any>(null);
  const [previewSpellsKnown, setPreviewSpellsKnown] = useState<any>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [expandedFeatureIds, setExpandedFeatureIds] = useState<Record<string, boolean>>({});
  const [previewOptionGroups, setPreviewOptionGroups] = useState<any[]>([]);
  const [previewOptionItems, setPreviewOptionItems] = useState<any[]>([]);
  const [previewExpandedGroups, setPreviewExpandedGroups] = useState<Record<string, boolean>>({});
  const [previewSelectedOptions, setPreviewSelectedOptions] = useState<Record<string, string>>({});
  const [isCoreFeaturesExpanded, setIsCoreFeaturesExpanded] = useState(false);
  const [selectedPreviewFeatureId, setSelectedPreviewFeatureId] = useState<string | null>(null);

  const isAdmin = userProfile?.role === 'admin' && !selectionMode;
  const isLoading = Object.values(loadingStates).some(state => state);

  useEffect(() => {
    const q = query(collection(db, 'classes'), orderBy('name', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const classData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setClasses(classData);
      setLoadingStates(prev => ({ ...prev, classes: false }));
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    // Fetch Sources
    const unsubscribeSources = onSnapshot(query(collection(db, 'sources')), (snap) => {
      const sourceMap: Record<string, any> = {};
      snap.docs.forEach(doc => {
        sourceMap[doc.id] = { id: doc.id, ...doc.data() };
      });
      setSources(sourceMap);
      setLoadingStates(prev => ({ ...prev, sources: false }));
    });

    // Fetch Tag Groups for Classes
    const unsubscribeTagGroups = onSnapshot(query(collection(db, 'tagGroups'), where('classifications', 'array-contains', 'class')), (snap) => {
      setTagGroups(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setLoadingStates(prev => ({ ...prev, tagGroups: false }));
    });

    // Fetch All Tags
    const unsubscribeTags = onSnapshot(query(collection(db, 'tags')), (snap) => {
      setAllTags(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setLoadingStates(prev => ({ ...prev, tags: false }));
    });

    return () => {
      unsubscribeSources();
      unsubscribeTagGroups();
      unsubscribeTags();
    };
  }, []);

  const cycleTagState = (tagId: string) => {
    setTagStates(prev => {
      const current = prev[tagId] || 0;
      const next = (current + 1) % 3;
      const newState = { ...prev };
      if (next === 0) {
        delete newState[tagId];
      } else {
        newState[tagId] = next;
      }
      return newState;
    });
  };

  const cycleGroupMode = (groupId: string) => {
    const modes: ('AND' | 'OR' | 'XOR')[] = ['AND', 'OR', 'XOR'];
    setGroupCombineModes(prev => {
      const current = prev[groupId] || 'OR';
      return {
        ...prev,
        [groupId]: modes[(modes.indexOf(current) + 1) % modes.length]
      };
    });
  };

  const cycleExclusionMode = (groupId: string) => {
    const modes: ('AND' | 'OR' | 'XOR')[] = ['AND', 'OR', 'XOR'];
    setGroupExclusionModes(prev => {
      const current = prev[groupId] || 'OR';
      return {
        ...prev,
        [groupId]: modes[(modes.indexOf(current) + 1) % modes.length]
      };
    });
  };

  // Pre-calculate tags by group for optimization
  const tagsByGroup = React.useMemo(() => {
    const map: Record<string, any[]> = {};
    allTags.forEach(tag => {
      if (!map[tag.groupId]) map[tag.groupId] = [];
      map[tag.groupId].push(tag);
    });
    return map;
  }, [allTags]);

  const filteredClasses = React.useMemo(() => {
    return classes.filter(c => {
      const sourceName = sources[c.sourceId]?.name || '';
      const matchesSearch = c.name.toLowerCase().includes(search.toLowerCase()) ||
        sourceName.toLowerCase().includes(search.toLowerCase());
      
      if (!matchesSearch) return false;
      
      const activeTagIds = Object.keys(tagStates);
      if (activeTagIds.length === 0) return true;

      const classTagIds = Array.isArray(c.tagIds) ? c.tagIds : [];

      // Group-based filtering
      const groupResults = tagGroups.map(group => {
        const groupTags = tagsByGroup[group.id] || [];
        const includedInGroup = groupTags.filter(t => tagStates[t.id] === 1);
        const excludedInGroup = groupTags.filter(t => tagStates[t.id] === 2);
        
        if (includedInGroup.length === 0 && excludedInGroup.length === 0) return null;

        const classTagsInGroup = classTagIds.filter(tid => groupTags.some(gt => gt.id === tid));

        // Inclusion check
        let inclusionMatch = true;
        if (includedInGroup.length > 0) {
          const mode = groupCombineModes[group.id] || 'OR';
          if (mode === 'OR') inclusionMatch = includedInGroup.some(st => classTagsInGroup.includes(st.id));
          else if (mode === 'AND') inclusionMatch = includedInGroup.every(st => classTagsInGroup.includes(st.id));
          else inclusionMatch = includedInGroup.filter(st => classTagsInGroup.includes(st.id)).length === 1;
        }

        // Exclusion check
        let exclusionMatch = false;
        if (excludedInGroup.length > 0) {
          const mode = groupExclusionModes[group.id] || 'OR';
          if (mode === 'OR') exclusionMatch = excludedInGroup.some(st => classTagsInGroup.includes(st.id));
          else if (mode === 'AND') exclusionMatch = excludedInGroup.every(st => classTagsInGroup.includes(st.id));
          else exclusionMatch = excludedInGroup.filter(st => classTagsInGroup.includes(st.id)).length === 1;
        }

        return { 
          inclusionMatch, 
          exclusionMatch, 
          hasInclusions: includedInGroup.length > 0, 
          hasExclusions: excludedInGroup.length > 0 
        };
      });
      
      const activeResults = groupResults.filter(r => r !== null);
      if (activeResults.length === 0) return true;

      // 1. If ANY group has an exclusion match, hide it.
      if (activeResults.some(r => r.exclusionMatch)) return false;

      // 2. Must match ALL groups that have inclusions.
      const activeInclusions = activeResults.filter(r => r.hasInclusions);
      if (activeInclusions.length > 0) {
        return activeInclusions.every(r => r.inclusionMatch);
      }

      return true;
    });
  }, [classes, sources, search, tagStates, tagGroups, tagsByGroup, groupCombineModes, groupExclusionModes]);

  const activeFilterCount = Object.keys(tagStates).length;

  const handleDeleteClass = (e: React.MouseEvent, id: string, name: string) => {
    e.preventDefault();
    e.stopPropagation();
    console.log(`[ClassList] Opening delete confirmation for: ${name} (${id})`);
    setClassToDelete({ id, name });
    setDeleteConfirmOpen(true);
  };

  const confirmDelete = async () => {
    if (!classToDelete) return;
    
    setIsDeleting(true);
    console.log(`[ClassList] Confirmed deletion of class: ${classToDelete.name} (${classToDelete.id})`);
    
    try {
      await deleteDoc(doc(db, 'classes', classToDelete.id));
      console.log(`[ClassList] Class deleted successfully: ${classToDelete.id}`);
      setDeleteConfirmOpen(false);
      setClassToDelete(null);
      if (selectedClass?.id === classToDelete.id) {
        setSelectedClass(null);
      }
    } catch (error) {
      console.error(`[ClassList] Error deleting class ${classToDelete.id}:`, error);
      handleFirestoreError(error, OperationType.DELETE, `classes/${classToDelete.id}`);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    const toastId = toast.loading("Importing class data...");

    try {
      const text = await file.text();
      const data = JSON.parse(text);
      
      const importedId = await importClassSemantic(data);
      toast.success(`Successfully imported class: ${data.class.name}`, { id: toastId });
      
      // Reset input
      e.target.value = '';
    } catch (error: any) {
      console.error("Import failed:", error);
      toast.error(`Import failed: ${error.message}`, { id: toastId });
    } finally {
      setIsImporting(false);
    }
  };

  useEffect(() => {
    if (selectedClass) {
      setPreviewLoading(true);
      const q = query(
        collection(db, 'features'),
        where('parentId', '==', selectedClass.id),
        where('parentType', '==', 'class'),
        orderBy('level', 'asc')
      );
      const unsubFeatures = onSnapshot(q, (snap) => {
        setPreviewFeatures(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        setPreviewLoading(false);
      });
      const qScalings = query(
        collection(db, 'scalingColumns'),
        where('parentId', '==', selectedClass.id),
        where('parentType', '==', 'class'),
        orderBy('name', 'asc')
      );
      const unsubScalings = onSnapshot(qScalings, (snap) => {
        setPreviewScalings(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      });

      setPreviewSpellcasting(null);
      setPreviewAltSpellcasting(null);
      setPreviewSpellsKnown(null);

      if (selectedClass.spellcasting) {
        const sc = selectedClass.spellcasting;
        if (sc.progressionId) {
          getDoc(doc(db, 'spellcastingScalings', sc.progressionId)).then(s => s.exists() && setPreviewSpellcasting(s.data()));
        }
        if (sc.altProgressionId) {
          getDoc(doc(db, 'pactMagicScalings', sc.altProgressionId)).then(s => s.exists() && setPreviewAltSpellcasting(s.data()));
        }
        if (sc.spellsKnownId) {
          getDoc(doc(db, 'spellsKnownScalings', sc.spellsKnownId)).then(s => s.exists() && setPreviewSpellsKnown(s.data()));
        }
      }

      // Fetch UNIQUE OPTION GROUPS for the class
      const allGroupIds = (selectedClass.uniqueOptionMappings || [])
        .map((m: any) => m.groupId)
        .filter((v: any, i: number, a: any[]) => v && a.indexOf(v) === i);

      let unsubGroups = () => {};
      let unsubItems = () => {};

      if (allGroupIds.length > 0) {
        const cappedIds = allGroupIds.slice(0, 30);
        
        unsubGroups = onSnapshot(query(
          collection(db, 'uniqueOptionGroups'),
          where('__name__', 'in', cappedIds)
        ), (snap) => {
          setPreviewOptionGroups(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        });

        unsubItems = onSnapshot(query(
          collection(db, 'uniqueOptionItems'),
          where('groupId', 'in', cappedIds),
          orderBy('name', 'asc')
        ), (snap) => {
          setPreviewOptionItems(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        });
      }

      return () => {
        unsubFeatures();
        unsubScalings();
        unsubGroups();
        unsubItems();
      };
    } else {
      setPreviewFeatures([]);
      setPreviewScalings([]);
      setPreviewOptionGroups([]);
      setPreviewOptionItems([]);
      setPreviewExpandedGroups({});
      setPreviewSelectedOptions({});
    }
  }, [selectedClass, previewFeatures.length]);

  useEffect(() => {
    // Reset selections on class change
    setExpandedFeatureIds({});
  }, [selectedClass]);

  const getProficiencyBonus = (level: number) => Math.floor((level - 1) / 4) + 2;

  const minSubclassFeatureLevel = previewFeatures.filter(f => f.isSubclassFeature).length > 0
    ? Math.min(...previewFeatures.filter(f => f.isSubclassFeature).map(f => f.level))
    : 0;

  const getPreviewFeaturesForLevel = (level: number) => {
    let levelFeatures = [...previewFeatures.filter(f => f.level === level)];

    // Add root advancements for this level (that aren't already linked to one of the features we just listed)
    const rootAdvs = (selectedClass?.advancements || []).filter((a: any) => a.level === level);
    rootAdvs.forEach((adv: any) => {
      // Avoid duplication if the advancement's name is basically the same as a feature's name
      if (!levelFeatures.some(f => f.name === (adv.title || adv.configuration?.title || adv.type))) {
         levelFeatures.push({ 
           name: adv.title || adv.configuration?.title || adv.type, 
           level: adv.level,
           isAdvancement: true 
         } as any);
      }
    });

    // Add subclass features from subclass progression
    const subclassLevels = selectedClass?.subclassFeatureLevels || [];
    if (subclassLevels.includes(level)) {
      const isFirst = level === Math.min(...subclassLevels);
      const title = selectedClass?.subclassTitle || 'Subclass';
      const name = isFirst ? title : `${title} Feature`;
      levelFeatures.push({ 
        name, 
        level,
        isSubclassFeaturePlaceholder: true 
      } as any);
    }

    if (selectedClass?.spellcasting?.hasSpellcasting && selectedClass.spellcasting.level === level) {
      if (!levelFeatures.some(f => f.name === 'Spellcasting')) {
        levelFeatures.push({ name: 'Spellcasting', description: selectedClass.spellcasting.description, level: selectedClass.spellcasting.level } as any);
      }
    }
    return levelFeatures;
  };

  const hasAnySpellsKnown = !!previewSpellsKnown;
  const hasAnyAltSpellcasting = !!previewAltSpellcasting;
  const hasAnySpellcasting = !!previewSpellcasting;

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-20">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
             {selectionMode && onCancelSelection ? (
               <Button variant="ghost" size="sm" onClick={onCancelSelection} className="text-ink/60 hover:text-ink -ml-2 mb-2 p-0 h-auto gap-1 text-[10px] uppercase font-bold tracking-widest">
                 <ChevronLeft className="w-3 h-3" /> Back
               </Button>
             ) : (
               !selectionMode && (
                 <div className="flex items-center gap-3 text-gold mb-2">
                   <Sword className="w-6 h-6" />
                   <span className="label-text">Compendium</span>
                 </div>
               )
             )}
          </div>
          <h1 className="h2-title uppercase">{selectionMode ? 'Select a Class' : 'Classes'}</h1>
        </div>

        <div className="flex items-center gap-3">
          {isAdmin && (
            <Link to="/compendium/tags">
              <Button variant="outline" size="sm" className="border-gold/20 text-gold gap-2 hover:bg-gold/10">
                <Settings2 className="w-4 h-4" /> Manage Tags
              </Button>
            </Link>
          )}
          {isAdmin && (
            <>
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileChange} 
                accept=".json" 
                className="hidden" 
              />
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleImportClick}
                disabled={isImporting}
                className="border-gold/20 text-gold gap-2 hover:bg-gold/10"
              >
                <Upload className="w-4 h-4" /> Import Class
              </Button>
              <Link to="/compendium/classes/new">
                <Button className="bg-gold hover:bg-gold/90 text-white gap-2 shadow-lg shadow-gold/20">
                  <Plus className="w-4 h-4" /> New Class
                </Button>
              </Link>
            </>
          )}
        </div>
      </div>

      <FilterBar 
        search={search}
        setSearch={setSearch}
        isFilterOpen={isFilterOpen}
        setIsFilterOpen={setIsFilterOpen}
        activeFilterCount={activeFilterCount}
        tagGroups={tagGroups}
        tagsByGroup={tagsByGroup}
        tagStates={tagStates}
        setTagStates={setTagStates}
        cycleTagState={cycleTagState}
        groupCombineModes={groupCombineModes}
        cycleGroupMode={cycleGroupMode}
        groupExclusionModes={groupExclusionModes}
        cycleExclusionMode={cycleExclusionMode}
        resetFilters={() => {
          setTagStates({});
          setGroupCombineModes({});
          setGroupExclusionModes({});
        }}
      />

      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="bg-card border-gold/30">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl text-blood flex items-center gap-2">
              <AlertTriangle className="w-6 h-6" />
              Confirm Deletion
            </DialogTitle>
            <DialogDescription className="text-ink/60">
              Are you sure you want to delete the class <span className="font-bold text-ink">"{classToDelete?.name}"</span>? 
              This action is permanent and will remove all associated data from the archive.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button 
              variant="ghost" 
              onClick={() => setDeleteConfirmOpen(false)}
              disabled={isDeleting}
              className="text-ink/40 hover:text-ink"
            >
              Cancel
            </Button>
            <Button 
              onClick={confirmDelete}
              disabled={isDeleting}
              className="bg-blood hover:bg-blood/90 text-white"
            >
              {isDeleting ? "Purging..." : "Delete Class"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="aspect-[4/3] bg-gold/5 animate-pulse rounded-lg border border-gold/10" />
          ))}
        </div>
      ) : filteredClasses.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {filteredClasses.map((cls) => (
            <div 
              key={cls.id} 
              onClick={() => setSelectedClass(cls)}
              className="group relative aspect-[4/3] sm:aspect-square md:aspect-[4/5] bg-card border border-gold/20 hover:border-gold hover:shadow-lg hover:shadow-gold/10 hover:-translate-y-1 transition-all overflow-hidden cursor-pointer flex flex-col rounded-xl"
            >
              {cls.imageUrl ? (
                <div className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-105" style={{ backgroundImage: `url(${cls.imageUrl})` }} />
              ) : (
                <div className="absolute inset-0 bg-ink/5 flex items-center justify-center">
                  <Shield className="w-16 h-16 text-gold/10" />
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-transparent pointer-events-none opacity-80 group-hover:opacity-100 transition-opacity" />
              
              <div className="relative z-10 p-4 pt-6 text-center">
                <h3 className="h3-title text-gold group-hover:text-white transition-colors block drop-shadow-md text-2xl group-hover:drop-shadow-[0_0_8px_rgba(212,175,55,0.8)]">
                  {cls.name}
                </h3>
                <p className="label-text text-gold/80 block drop-shadow-sm mt-1">
                  {sources[cls.sourceId]?.name || 'Unknown Source'}
                </p>
              </div>

              <div className="mt-auto relative z-10 p-4 border-t border-gold/20 bg-black/40 backdrop-blur-md h-[45%] flex flex-col items-center text-center group-hover:bg-black/60 group-hover:-translate-y-2 transition-all duration-300">
                <div className="text-white/80 text-xs italic line-clamp-4 overflow-hidden w-full font-serif leading-relaxed">
                  <Markdown>{cls.description || "No preview description available."}</Markdown>
                </div>
              </div>

              {isAdmin && (
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={(e) => handleDeleteClass(e, cls.id, cls.name)}
                  className="absolute top-2 right-2 h-8 w-8 p-0 text-white/50 hover:text-white hover:bg-blood/80 z-20 transition-colors"
                  title="Delete Class"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-20 bg-card rounded-3xl border border-dashed border-gold/20">
          <BookOpen className="w-12 h-12 text-gold/20 mx-auto mb-4" />
          <h3 className="font-serif text-xl text-ink/60 italic">No classes found matching your search.</h3>
          <Button 
            variant="link" 
            onClick={() => {
              setSearch('');
              setTagStates({});
            }}
            className="text-gold mt-2"
          >
            Clear all filters
          </Button>
        </div>
      )}

      {/* Class Preview Dialog */}
      <Dialog open={!!selectedClass} onOpenChange={(open) => !open && setSelectedClass(null)}>
        <DialogContent className="max-w-[95vw] md:max-w-4xl max-h-[90vh] bg-card border-gold p-0 flex flex-col shadow-2xl shadow-gold/20">
          {selectedClass && (
            <>
              {/* Header */}
              <div className="relative overflow-hidden bg-black flex-shrink-0">
                {selectedClass.imageUrl && (
                  <div className="absolute inset-0 bg-cover bg-center opacity-30" style={{ backgroundImage: `url(${selectedClass.imageUrl})` }} />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-background to-background/20 pointer-events-none" />
                <div className="relative p-6 px-8 flex items-center justify-between z-10">
                  <div>
                    <h2 className="h1-title text-gold drop-shadow-md text-4xl">{selectedClass.name}</h2>
                    <p className="label-text text-gold/60 mt-1">{sources[selectedClass.sourceId]?.name || 'Unknown Source'}</p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <div className="flex items-center gap-3">
                      <div className="bg-gold/10 border border-gold/20 px-3 py-1.5 rounded text-gold label-text">
                        Hit Die: d{selectedClass.hitDie || 8}
                      </div>
                      {selectionMode ? (
                        <div className="flex gap-2">
                           <Button size="sm" variant="outline" className="border-gold/20 text-gold uppercase tracking-widest text-[10px] h-8" onClick={() => setSelectedClass(null)}>
                             Cancel
                           </Button>
                           <Button size="sm" onClick={() => onSelectClass && onSelectClass(selectedClass)} className="bg-gold hover:bg-gold/90 text-white shadow-lg shadow-gold/20 uppercase tracking-widest text-[10px] h-8">
                             Select Class
                           </Button>
                        </div>
                      ) : (
                        <Link to={`/compendium/classes/view/${selectedClass.id}`}>
                          <Button size="sm" className="bg-gold hover:bg-gold/90 text-white shadow-lg shadow-gold/20 uppercase tracking-widest text-[10px] h-8">
                            View Class Page
                          </Button>
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Scrollable Content */}
              <div className="flex-1 overflow-y-auto min-h-0 p-6 px-8 border-t border-gold/10">
                <div className="space-y-10">
                  {/* Class Table */}
                  <div className="overflow-x-auto border border-gold/20 bg-card/50 backdrop-blur-sm rounded-lg max-h-[40vh] overflow-y-auto">
                    <table className="w-full text-left border-collapse">
                      <thead className="sticky top-0 bg-card z-10 shadow-md">
                        <tr className="border-b border-gold/20 bg-gold/5">
                          <th className="p-1 px-2 label-text italic text-gold text-center w-8 border-r border-gold/10 text-[10px]">Level</th>
                          <th className="p-1 px-2 label-text italic text-gold text-center w-10 border-r border-gold/10 text-[10px]">PB</th>
                          <th className="p-1 px-2 label-text italic text-gold border-r border-gold/10 text-[10px]">Features</th>
                          {previewScalings.map(col => (
                            <th key={col.id} className="p-1 px-2 label-text italic text-gold text-center border-r border-gold/10 text-[10px]">{col.name}</th>
                          ))}
                          {hasAnySpellsKnown && (
                            <>
                              <th className="p-1 px-2 label-text italic text-gold text-center border-r border-gold/10 text-[10px]">Cantrips</th>
                              <th className="p-1 px-2 label-text italic text-gold text-center border-r border-gold/10 text-[10px]">Spells Known</th>
                            </>
                          )}
                          {hasAnyAltSpellcasting && (
                            <>
                              <th className="p-1 px-2 label-text italic text-gold text-center border-r border-gold/10 text-[10px]">Slot Count</th>
                              <th className="p-1 px-2 label-text italic text-gold text-center border-r border-gold/10 text-[10px]">Slot Level</th>
                            </>
                          )}
                          {hasAnySpellcasting && (
                            <th colSpan={9} className="p-1 px-2 label-text italic text-gold text-center text-[10px]">Spell Slots per Level</th>
                          )}
                        </tr>
                        {hasAnySpellcasting && (
                          <tr className="border-b border-gold/10 bg-gold/5">
                            <th colSpan={3 + previewScalings.length + (hasAnySpellsKnown ? 2 : 0) + (hasAnyAltSpellcasting ? 2 : 0)} className="border-r border-gold/10"></th>
                            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(lvl => (
                              <th key={lvl} className="p-0.5 label-text italic text-gold text-center w-5 border-r border-gold/5 last:border-r-0 text-[10px]">
                                {lvl}{lvl === 1 ? 'st' : lvl === 2 ? 'nd' : lvl === 3 ? 'rd' : 'th'}
                              </th>
                            ))}
                          </tr>
                        )}
                      </thead>
                      <tbody>
                        {Array.from({ length: 20 }, (_, i) => i + 1).map(level => {
                          const levelFeatures = getPreviewFeaturesForLevel(level);
                          const pb = getProficiencyBonus(level);
                          const levelScaling = previewSpellcasting?.levels?.[level.toString()];
                          const levelAlt = previewAltSpellcasting?.levels?.[level.toString()];
                          const levelKnown = previewSpellsKnown?.levels?.[level.toString()];

                          return (
                            <tr key={level} className="border-b border-gold/5 hover:bg-gold/5 transition-colors group">
                              <td className="p-1 px-2 text-center text-[10px] font-mono text-ink/40 border-r border-gold/5">{level}</td>
                              <td className="p-1 px-2 text-center text-[10px] font-mono text-ink/60 border-r border-gold/5">+{pb}</td>
                              <td className="p-1 px-2 border-r border-gold/5">
                                <div className="flex flex-wrap gap-1">
                                  {levelFeatures.map((f, idx) => (
                                    <span 
                                      key={idx} 
                                      className={cn(
                                        "text-[10px]",
                                        f.isAdvancement ? "text-gold/60 italic font-medium" : "font-bold text-gold/80"
                                      )}
                                    >
                                      {f.name}{idx < levelFeatures.length - 1 ? ',' : ''}
                                    </span>
                                  ))}
                                  {levelFeatures.length === 0 && <span className="text-ink/20 text-[10px]">—</span>}
                                </div>
                              </td>
                              {previewScalings.map(col => {
                                let displayValue = '—';
                                for (let l = level; l >= 1; l--) {
                                  if (col.values[l.toString()]) {
                                    displayValue = col.values[l.toString()];
                                    break;
                                  }
                                }
                                return (
                                  <td key={col.id} className="p-1 px-2 text-center text-[10px] font-mono text-ink/60 border-r border-gold/5">
                                    {displayValue}
                                  </td>
                                );
                              })}
                              {hasAnySpellsKnown && (
                                <>
                                  <td className="p-1 px-2 text-center text-[10px] font-mono text-ink/60 border-r border-gold/5">{levelKnown?.cantrips ?? levelKnown?.cantripsKnown ?? '—'}</td>
                                  <td className="p-1 px-2 text-center text-[10px] font-mono text-ink/60 border-r border-gold/5">{levelKnown?.spellsKnown ?? levelKnown?.spells ?? '—'}</td>
                                </>
                              )}
                              {hasAnyAltSpellcasting && (
                                <>
                                  <td className="p-1 px-2 text-center text-[10px] font-mono text-ink/60 border-r border-gold/5">{levelAlt?.slotCount ?? '—'}</td>
                                  <td className="p-1 px-2 text-center text-[10px] font-mono text-ink/60 border-r border-gold/5">
                                    {levelAlt?.slotLevel ? `${levelAlt.slotLevel}${levelAlt.slotLevel === 1 ? 'st' : levelAlt.slotLevel === 2 ? 'nd' : levelAlt.slotLevel === 3 ? 'rd' : 'th'}` : '—'}
                                  </td>
                                </>
                              )}
                              {hasAnySpellcasting && (levelScaling?.slots || [0,0,0,0,0,0,0,0,0]).map((slots: number, idx: number) => (
                                <td key={idx} className={`p-1 text-center font-mono text-[10px] border-r border-gold/5 last:border-r-0 ${slots > 0 ? 'text-ink font-bold' : 'text-ink/20'}`}>
                                  {slots > 0 ? slots : '—'}
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="grid md:grid-cols-[1fr_250px] gap-8">
                    {/* Left Column: Core Features and Lore */}
                    <div className="space-y-8">
                      {/* Description Preview */}
                      {selectedClass.description && (
                        <div className="space-y-2">
                          <h3 className="h3-title text-gold border-b border-gold/10 pb-1 w-full">Description</h3>
                          <BBCodeRenderer content={selectedClass.description} className="body-text" />
                        </div>
                      )}

                      {/* Core Features Preview */}
                      <div className="space-y-4">
                        <div className="flex items-center gap-4">
                          <h2 className="label-text text-gold shrink-0 uppercase tracking-widest font-bold">Core Features</h2>
                          <div className="h-px bg-gold/10 w-full" />
                        </div>
                        {previewLoading ? (
                          <div className="animate-pulse h-10 bg-gold/5 border border-gold/10 rounded" />
                        ) : previewFeatures.length > 0 ? (
                          <div className="border border-gold/20 bg-background/30 rounded overflow-hidden">
                            <button 
                              onClick={() => setIsCoreFeaturesExpanded(!isCoreFeaturesExpanded)}
                              className="w-full flex items-center justify-between p-3 hover:bg-gold/5 transition-colors group"
                            >
                              <div className="flex items-center gap-3">
                                <div className="p-1.5 bg-gold/10 rounded group-hover:bg-gold/20 transition-colors">
                                  <Scroll className="w-4 h-4 text-gold" />
                                </div>
                                <div className="text-left">
                                  <h4 className="label-text text-gold">Core Features</h4>
                                  <p className="text-[10px] text-ink/40 italic font-normal">All class level features</p>
                                </div>
                              </div>
                              <div className={`transform transition-transform duration-300 ${isCoreFeaturesExpanded ? 'rotate-180' : ''}`}>
                                <ChevronLeft className="w-4 h-4 text-gold -rotate-90" />
                              </div>
                            </button>
                            {isCoreFeaturesExpanded && (
                              <div className="p-4 border-t border-gold/10 animate-in fade-in slide-in-from-top-2 duration-300">
                                <FeaturesView 
                                  items={previewFeatures.filter(f => !f.isSubclassFeature || f.level === minSubclassFeatureLevel)} 
                                  selectedId={selectedPreviewFeatureId} 
                                  onSelect={setSelectedPreviewFeatureId}
                                  optionGroups={previewOptionGroups}
                                  optionItems={previewOptionItems}
                                  selectedOptions={previewSelectedOptions}
                                  onSelectOption={(groupId, itemId) => setPreviewSelectedOptions(prev => ({ ...prev, [groupId]: itemId }))}
                                  classId={selectedClass.id}
                                  uniqueOptionMappings={selectedClass.uniqueOptionMappings}
                                  hideChoices={true}
                                  rootAdvancements={selectedClass.advancements || []}
                                />
                              </div>
                            )}
                          </div>
                        ) : (
                          <p className="text-sm text-ink/40 italic">No features defined yet.</p>
                        )}
                      </div>

                      {/* Lore Section */}
                      {selectedClass.lore && (
                        <div className="space-y-4">
                          <div className="flex items-center gap-4">
                            <h2 className="label-text text-gold shrink-0 uppercase tracking-widest font-bold">Class Lore within Setting</h2>
                            <div className="h-px bg-gold/10 w-full" />
                          </div>
                          <BBCodeRenderer content={selectedClass.lore} className="body-text" />
                        </div>
                      )}
                    </div>

                  {/* Right Column: Proficiencies & Actions */}
                  <div className="space-y-6">
                    <div className="bg-background/50 border border-gold/10 rounded-md p-4 space-y-4">
                      <h4 className="label-text text-gold border-b border-gold/10 pb-1">Proficiencies</h4>
                      <div className="space-y-3">
                        {['armor', 'weapons'].map(key => (
                          <div key={key}>
                            <span className="block text-[10px] uppercase font-bold text-ink/40 mb-1">{key}</span>
                            <span className="text-xs text-ink/80">{selectedClass.proficiencies?.[key] || 'None'}</span>
                          </div>
                        ))}
                        <div>
                          <span className="block text-[10px] uppercase font-bold text-ink/40 mb-1">Saving Throws</span>
                          <div className="flex flex-wrap gap-1">
                            {selectedClass.savingThrows?.map((st: string) => (
                              <Badge key={st} variant="outline" className="text-[10px] px-1 py-0 h-4 border-gold/20 text-ink/60">{st}</Badge>
                            )) || <span className="text-xs text-ink/80">None</span>}
                          </div>
                        </div>
                      </div>
                    </div>
                    {/* Multiclassing Requirements */} 
                    <div className="bg-background/50 border border-gold/10 rounded-md p-4 space-y-4">
                      <h4 className="label-text text-gold border-b border-gold/10 pb-1">Multiclassing Requirements</h4>
                      <BBCodeRenderer content={selectedClass.multiclassing || 'None'} className="text-xs" />
                    </div>

                    {/* Tags */} 
                    <div className="bg-background/50 border border-gold/10 rounded-md p-4 space-y-4">
                      <h4 className="label-text text-gold border-b border-gold/10 pb-1">Tags</h4>
                      <div className="flex flex-wrap gap-2">
                        {selectedClass.tagIds?.length > 0 ? selectedClass.tagIds.map((tagId: string) => {
                          const tagDef = allTags.find(t => t.id === tagId);
                          return tagDef ? (
                            <Badge key={tagId} variant="outline" className="text-[10px] px-2 py-0 h-5 border-gold/20 text-ink/60">
                              {tagDef.name}
                            </Badge>
                          ) : null;
                        }) : <span className="text-xs text-ink/80">None</span>}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default ClassList;
