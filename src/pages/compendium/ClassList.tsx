import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../../lib/firebase';
import { collection, query, orderBy, onSnapshot, doc, getDoc, where } from 'firebase/firestore';
import { calculateEffectiveCastingLevel, getSpellSlotsForLevel } from '../../lib/spellcasting';
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
import { motion, AnimatePresence } from 'motion/react';
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
import { ClassImageStyle, DEFAULT_DISPLAY } from '../../components/compendium/ClassImageEditor';
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
  const [allSkills, setAllSkills] = useState<any[]>([]);
  const [allTools, setAllTools] = useState<any[]>([]);
  const [allToolCategories, setAllToolCategories] = useState<any[]>([]);
  const [allWeaponCategories, setAllWeaponCategories] = useState<any[]>([]);
  const [allArmorCategories, setAllArmorCategories] = useState<any[]>([]);
  const [allArmor, setAllArmor] = useState<any[]>([]);
  const [allWeapons, setAllWeapons] = useState<any[]>([]);
  const [allAttributes, setAllAttributes] = useState<any[]>([]);
  const [spellcastingTypes, setSpellcastingTypes] = useState<any[]>([]);
  const [masterMulticlassChart, setMasterMulticlassChart] = useState<any | null>(null);
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

    const unsubscribeSkills = onSnapshot(collection(db, 'skills'), (snap) => {
      setAllSkills(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    const unsubscribeTools = onSnapshot(collection(db, 'tools'), (snap) => {
      setAllTools(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    const unsubscribeToolCategories = onSnapshot(collection(db, 'toolCategories'), (snap) => {
      setAllToolCategories(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    const unsubscribeWeaponCategories = onSnapshot(collection(db, 'weaponCategories'), (snap) => {
      setAllWeaponCategories(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    const unsubscribeArmorCategories = onSnapshot(collection(db, 'armorCategories'), (snap) => {
      setAllArmorCategories(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    const unsubscribeArmor = onSnapshot(collection(db, 'armor'), (snap) => {
      setAllArmor(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    const unsubscribeWeapons = onSnapshot(collection(db, 'weapons'), (snap) => {
      setAllWeapons(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    const unsubscribeAttributes = onSnapshot(collection(db, 'attributes'), (snap) => {
      const attrs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const uniqueAttrsMap = new Map();
      attrs.forEach((item: any) => {
        const key = (item.identifier || item.id).toUpperCase();
        if (!uniqueAttrsMap.has(key) || item.identifier) {
          uniqueAttrsMap.set(key, item);
        }
      });
      const uniqueAttrs = Array.from(uniqueAttrsMap.values());
      setAllAttributes(uniqueAttrs);
    });

    const unsubscribeTypes = onSnapshot(collection(db, 'spellcastingTypes'), (snap) => {
      setSpellcastingTypes(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    const unsubscribeMaster = onSnapshot(doc(db, 'standardMulticlassProgression', 'master'), (snap) => {
      if (snap.exists()) setMasterMulticlassChart(snap.data());
    });

    return () => {
      unsubscribeSources();
      unsubscribeTagGroups();
      unsubscribeTags();
      unsubscribeSkills();
      unsubscribeTools();
      unsubscribeToolCategories();
      unsubscribeWeaponCategories();
      unsubscribeArmorCategories();
      unsubscribeArmor();
      unsubscribeWeapons();
      unsubscribeAttributes();
      unsubscribeTypes();
      unsubscribeMaster();
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

        const classTagsInGroup = classTagIds.filter((tid: string) => groupTags.some(gt => gt.id === tid));

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
      const featuresQ = query(
        collection(db, 'features'),
        where('parentId', '==', selectedClass.id),
        where('parentType', '==', 'class'),
        orderBy('level', 'asc')
      );
      
      const scalingsQ = query(
        collection(db, 'scalingColumns'),
        where('parentId', '==', selectedClass.id),
        where('parentType', '==', 'class'),
        orderBy('name', 'asc')
      );

      const allGroupIds = (selectedClass.uniqueOptionMappings || [])
        .map((m: any) => m.groupId)
        .filter((v: any, i: number, a: any[]) => v && a.indexOf(v) === i);

      // We'll use a promise-based approach for non-snapshot data to coordinate loading
      const loadingPromises: Promise<any>[] = [];

      // Always reset first so stale data from the previous class never bleeds through
      setPreviewSpellcasting(null);
      setPreviewAltSpellcasting(null);
      setPreviewSpellsKnown(null);

      if (selectedClass.spellcasting?.hasSpellcasting) {
        const sc = selectedClass.spellcasting;
        if (sc.manualProgressionId) {
          loadingPromises.push(getDoc(doc(db, 'spellcastingScalings', sc.manualProgressionId)).then(s => setPreviewSpellcasting(s.exists() ? s.data() : null)));
        } else if (sc.progressionId && spellcastingTypes.length > 0 && masterMulticlassChart) {
          const type = spellcastingTypes.find(t => t.id === sc.progressionId);
          if (type) {
            const virtualLevels: Record<string, any> = {};
            for (let level = 1; level <= 20; level++) {
              const effectiveLevel = calculateEffectiveCastingLevel(level, type.formula);
              const slots = getSpellSlotsForLevel(effectiveLevel, masterMulticlassChart.levels || []);
              virtualLevels[level.toString()] = { slots };
            }
            setPreviewSpellcasting({ name: type.name, levels: virtualLevels });
          }
        }
        if (sc.altProgressionId) {
          loadingPromises.push(getDoc(doc(db, 'pactMagicScalings', sc.altProgressionId)).then(s => setPreviewAltSpellcasting(s.exists() ? s.data() : null)));
        }
        if (sc.spellsKnownId) {
          loadingPromises.push(getDoc(doc(db, 'spellsKnownScalings', sc.spellsKnownId)).then(s => setPreviewSpellsKnown(s.exists() ? s.data() : null)));
        }
      }

      const unsubFeatures = onSnapshot(featuresQ, (snap) => {
        setPreviewFeatures(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      });

      const unsubScalings = onSnapshot(scalingsQ, (snap) => {
        setPreviewScalings(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      });

      let unsubGroups = () => {};
      let unsubItems = () => {};

      if (allGroupIds.length > 0) {
        const cappedIds = allGroupIds.slice(0, 30);
        unsubGroups = onSnapshot(query(collection(db, 'uniqueOptionGroups'), where('__name__', 'in', cappedIds)), (snap) => {
          setPreviewOptionGroups(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        });
        unsubItems = onSnapshot(query(collection(db, 'uniqueOptionItems'), where('groupId', 'in', cappedIds), orderBy('name', 'asc')), (snap) => {
          setPreviewOptionItems(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        });
      }

      // Final synchronization to stop loading
      Promise.all(loadingPromises).then(() => {
        // Simple delay to ensure snapshots also arrive
        setTimeout(() => setPreviewLoading(false), 300);
      });

      return () => {
        unsubFeatures();
        unsubScalings();
        unsubGroups();
        unsubItems();
      };
    }
  }, [selectedClass?.id, spellcastingTypes.length, !!masterMulticlassChart]);

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

    // Add root advancements for this level (only Ability Score Improvements)
    const rootAdvs = (selectedClass?.advancements || []).filter((a: any) => a.level === level && a.type === 'AbilityScoreImprovement');
    rootAdvs.forEach((adv: any) => {
      if (!levelFeatures.some(f => f.name === 'Ability Score Improvement')) {
         levelFeatures.push({ 
           name: 'Ability Score Improvement', 
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

  const maxSpellLevel = React.useMemo(() => {
    if (!previewSpellcasting?.levels) return 0;
    let max = 0;
    Object.values(previewSpellcasting.levels).forEach((lvl: any) => {
      if (lvl.slots) {
        for (let i = lvl.slots.length - 1; i >= 0; i--) {
          if (lvl.slots[i] > 0) {
            if (i + 1 > max) max = i + 1;
            break;
          }
        }
      }
    });
    return max;
  }, [previewSpellcasting]);

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
                <Button className="btn-gold-solid gap-2 shadow-lg shadow-gold/20">
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
                <img
                  src={cls.cardImageUrl || cls.imageUrl}
                  className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                  style={ClassImageStyle({ display: cls.cardDisplay || cls.imageDisplay || DEFAULT_DISPLAY })}
                  referrerPolicy="no-referrer"
                  draggable={false}
                  alt=""
                />
              ) : (
                <div className="absolute inset-0 bg-ink/5 flex items-center justify-center">
                  <Shield className="w-16 h-16 text-gold/10" />
                </div>
              )}
              <div className={`absolute inset-0 bg-gradient-to-t from-black via-black/60 to-transparent pointer-events-none transition-opacity ${cls.imageUrl ? 'opacity-80 group-hover:opacity-100' : 'opacity-20 group-hover:opacity-30'}`} />
              
              <div className="relative z-10 p-4 pt-6 text-center">
                <h3
                  className="h3-title text-gold group-hover:text-white transition-colors block text-3xl group-hover:drop-shadow-[0_0_8px_rgba(212,175,55,0.8)]"
                  style={{ textShadow: '-2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000, -2px 0 0 #000, 2px 0 0 #000, 0 -2px 0 #000, 0 2px 0 #000' }}
                >
                  {cls.name}
                </h3>
                <p
                  className="label-text text-gold/80 block mt-1 text-sm"
                  style={{ textShadow: '-2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000, -2px 0 0 #000, 2px 0 0 #000, 0 -2px 0 #000, 0 2px 0 #000' }}
                >
                  {sources[cls.sourceId]?.abbreviation || sources[cls.sourceId]?.name || 'Unknown'}
                </p>
              </div>

              <div className="mt-auto relative z-10 p-4 border-t border-gold/20 bg-black/10 backdrop-blur-md h-[45%] flex flex-col items-center text-center group-hover:bg-black/30 group-hover:-translate-y-2 transition-all duration-300">
                <div className="text-white/80 text-xs italic line-clamp-4 overflow-hidden w-full font-serif leading-relaxed">
                  <Markdown>{cls.preview || cls.description || "No preview description available."}</Markdown>
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
        <DialogContent className="max-w-[95vw] md:max-w-4xl max-h-[90vh] bg-card border-gold p-0 flex flex-col shadow-2xl shadow-gold/20 overflow-hidden">
          {selectedClass && (
            <>
              {/* Background image — fills top half of the dialog, mask-fades to transparent */}
              {selectedClass.imageUrl && (
                <div className="absolute inset-x-0 top-0 h-1/2 pointer-events-none z-0">
                  <img
                    src={selectedClass.previewImageUrl || selectedClass.imageUrl}
                    className="absolute inset-0 w-full h-full object-cover opacity-30"
                    style={{
                      ...ClassImageStyle({ display: selectedClass.previewDisplay || selectedClass.imageDisplay || DEFAULT_DISPLAY }),
                      maskImage: 'linear-gradient(to bottom, black 40%, transparent 100%)',
                      WebkitMaskImage: 'linear-gradient(to bottom, black 40%, transparent 100%)',
                    }}
                    referrerPolicy="no-referrer"
                    draggable={false}
                    alt=""
                  />
                </div>
              )}

              {/* Header */}
              <div className="relative bg-black/10 flex-shrink-0 z-10">
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
                           <Button size="sm" onClick={() => onSelectClass && onSelectClass(selectedClass)} className="btn-gold-solid shadow-lg shadow-gold/20 uppercase tracking-widest text-[10px] h-8">
                             Select Class
                           </Button>
                        </div>
                      ) : (
                        <Link to={`/compendium/classes/view/${selectedClass.id}`}>
                          <Button size="sm" className="btn-gold-solid shadow-lg shadow-gold/20 uppercase tracking-widest text-[10px] h-8">
                            View Class Page
                          </Button>
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Scrollable Content */}
              <div className="flex-1 overflow-y-auto min-h-0 p-6 px-8 border-t border-gold/10 relative z-10">
                <div className="space-y-10">
                  {/* Class Table */}
                  {previewLoading ? (
                    <div className="h-64 flex flex-col items-center justify-center border border-gold/20 bg-card/50 backdrop-blur-sm rounded-lg space-y-4">
                      <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" />
                      <span className="text-[10px] uppercase font-bold tracking-widest text-gold/60">Loading class table...</span>
                    </div>
                  ) : (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3 }}
                      className="border border-gold/20 bg-card/50 backdrop-blur-sm rounded-lg overflow-x-auto"
                    >
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
                            <th colSpan={maxSpellLevel} className="p-1 px-2 label-text italic text-gold text-center text-[10px]">Spell Slots per Level</th>
                          )}
                        </tr>
                        {hasAnySpellcasting && (
                          <tr className="border-b border-gold/10 bg-gold/5">
                            <th colSpan={3 + previewScalings.length + (hasAnySpellsKnown ? 2 : 0) + (hasAnyAltSpellcasting ? 2 : 0)} className="border-r border-gold/10"></th>
                            {Array.from({ length: maxSpellLevel }, (_, i) => i + 1).map(lvl => (
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
                                      {f.name.split(' (')[0]}{idx < levelFeatures.length - 1 ? ',' : ''}
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
                              {hasAnySpellcasting && (levelScaling?.slots || Array(maxSpellLevel).fill(0)).slice(0, maxSpellLevel).map((slots: number, idx: number) => (
                                <td key={idx} className={`p-1 text-center font-mono text-[10px] border-r border-gold/5 last:border-r-0 ${slots > 0 ? 'text-ink font-bold' : 'text-ink/20'}`}>
                                  {slots > 0 ? slots : '—'}
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                      </table>
                    </motion.div>
                  )}

                  <div className="grid md:grid-cols-[1fr_250px] gap-8">
                    {/* Left Column: Core Features and Lore */}
                    <div className="space-y-8">
                      {/* Description Preview */}
                      {selectedClass.description && (
                        <div className="space-y-2">
                          <h3 className="h3-title text-gold border-b border-gold/10 pb-1 w-full">Class Description</h3>
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
                                  hideAdvancementTypes={true}
                                  hideAdvancements={true}
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
                        {['armor', 'weapons'].map(key => {
                          const prof = selectedClass.proficiencies?.[key];
                          const displayName = selectedClass.proficiencies?.[`${key}DisplayName`];
                          const categories = key === 'armor' ? allArmorCategories : allWeaponCategories;
                          
                          let displayVal = 'None';
                          if (typeof prof === 'string') displayVal = prof;
                          else if (displayName) displayVal = displayName;
                          else if (prof && typeof prof === 'object') {
                             const fixed = prof.fixedIds || [];
                             const categoryIds = prof.categoryIds || [];
                             const catNames = categoryIds.map((cid: string) => categories.find(c => c.id === cid)?.name).filter(Boolean);
                             
                             // If we have selected categories, show them first
                             if (catNames.length > 0) {
                               displayVal = catNames.join(', ');
                             } else if (fixed.length > 0) {
                               const items = key === 'armor' ? allArmor : allWeapons;
                               displayVal = fixed.map((id: string) => items.find(i => i.id === id)?.name).filter(Boolean).join(', ');
                             }
                          }

                          return (
                            <div key={key}>
                              <span className="block text-[10px] uppercase font-bold text-ink/40 mb-1">{key}</span>
                              <span className="text-xs text-ink/80">{displayVal}</span>
                            </div>
                          );
                        })}
                        <div className="space-y-1">
                          <span className="block text-[10px] uppercase font-bold text-ink/40 mb-1">Tools</span>
                          <span className="text-xs text-ink/80">
                            {(() => {
                              const tools = selectedClass.proficiencies?.tools;
                              if (!tools || typeof tools === 'string') return tools || 'None';
                              
                              const categoryIds = tools.categoryIds || [];
                              const catNames = categoryIds.map((cid: string) => allToolCategories.find(c => c.id === cid)?.name).filter(Boolean);
                              
                              const fixed = (tools.fixedIds || [])
                                .filter((id: string) => {
                                  // Hide if part of a selected category
                                  const tool = allTools.find(t => t.id === id);
                                  return !categoryIds.includes(tool?.categoryId);
                                })
                                .map((id: string) => allTools.find(t => t.id === id)?.name)
                                .filter(Boolean);

                              const options = (tools.optionIds || []).map((id: string) => allTools.find(t => t.id === id)?.name).filter(Boolean);
                              let parts = [];
                              if (catNames.length > 0) parts.push(catNames.join(', '));
                              if (fixed.length > 0) parts.push(fixed.join(', '));
                              if (tools.choiceCount > 0 && options.length > 0) parts.push(`Choose ${tools.choiceCount} from: ${options.join(', ')}`);
                              return parts.length > 0 ? parts.join('; ') : 'None';
                            })()}
                          </span>
                        </div>
                        <div className="space-y-1">
                          <span className="block text-[10px] uppercase font-bold text-ink/40 mb-1">Skills</span>
                          <span className="text-xs text-ink/80">
                            {(() => {
                              const skills = selectedClass.proficiencies?.skills;
                              if (!skills || typeof skills === 'string') return skills || 'None';
                              const fixed = (skills.fixedIds || []).map((id: string) => allSkills.find(s => s.id === id)?.name).filter(Boolean);
                              const options = (skills.optionIds || []).map((id: string) => allSkills.find(s => s.id === id)?.name).filter(Boolean);
                              let parts = [];
                              if (fixed.length > 0) parts.push(fixed.join(', '));
                              if (skills.choiceCount > 0 && options.length > 0) parts.push(`Choose ${skills.choiceCount} from: ${options.join(', ')}`);
                              return parts.length > 0 ? parts.join('; ') : 'None';
                            })()}
                          </span>
                        </div>
                        <div>
                          <span className="block text-[10px] uppercase font-bold text-ink/40 mb-1">Saving Throws</span>
                          <span className="text-xs text-ink/80">
                            {(() => {
                              const st = selectedClass.proficiencies?.savingThrows;
                              let fixedIds = (st?.fixedIds || []);
                              if (!Array.isArray(fixedIds)) fixedIds = [];
                              // Fallback for legacy class structures
                              if (fixedIds.length === 0 && Array.isArray(selectedClass.savingThrows)) {
                                fixedIds = selectedClass.savingThrows.map((id: string) => id.toUpperCase());
                              } else {
                                fixedIds = fixedIds.map((id: string) => id.toUpperCase());
                              }
                              
                              let fixedNames = allAttributes
                                .filter(a => fixedIds.includes((a.identifier || a.id).toUpperCase()))
                                .map(a => a.name);
                              
                              if (fixedNames.length < fixedIds.length) {
                                fixedNames = fixedIds.map((id: string) => {
                                  const found = allAttributes.find(a => (a.identifier || a.id).toUpperCase() === id.toUpperCase());
                                  return found ? found.name : id.charAt(0) + id.slice(1).toLowerCase();
                                });
                              }

                              let choiceStr = "";
                             if (st?.choiceCount > 0 && st?.optionIds?.length > 0) {
                               const options = st.optionIds.map((id: string) => {
                                 const attr = allAttributes.find(a => (a.identifier || a.id).toUpperCase() === id.toUpperCase());
                                 return attr ? attr.name : id;
                               }).filter(Boolean);
                               
                               if (options.length > 0) {
                                 if (st.choiceCount === 1 && options.length === 2) {
                                   choiceStr = options.join(' or ');
                                 } else {
                                   const last = options.pop();
                                   choiceStr = `Choose ${st.choiceCount} from ${options.join(', ')}${options.length > 0 ? ', or ' : ''}${last}`;
                                 }
                               }
                             }
                             const allParts = [...fixedNames];
                             if (choiceStr) allParts.push(choiceStr);
                             
                             if (allParts.length > 1) {
                               const last = allParts.pop();
                               return allParts.join(', ') + ' and ' + last;
                             }
                             return allParts[0] || 'None';
                            })()}
                          </span>
                        </div>
                      </div>
                    </div>
                    {/* Multiclassing Requirements */} 
                    <div className="bg-background/50 border border-gold/10 rounded-md p-4 space-y-4">
                      <h4 className="label-text text-gold border-b border-gold/10 pb-1">Multiclassing Requirements</h4>
                      {(() => {
                        const fixedNames = (selectedClass.primaryAbility || []).map((id: string) => {
                          const attr = allAttributes.find(a => (a.identifier || a.id).toUpperCase() === id.toUpperCase());
                          return attr ? attr.name : id.toUpperCase();
                        });
                        const choiceNames = (selectedClass.primaryAbilityChoice || []).map((id: string) => {
                          const attr = allAttributes.find(a => (a.identifier || a.id).toUpperCase() === id.toUpperCase());
                          return attr ? attr.name : id.toUpperCase();
                        });

                        if (fixedNames.length === 0 && choiceNames.length === 0) {
                          return <BBCodeRenderer content={selectedClass.multiclassing || 'None'} className="text-xs" />;
                        }

                        let requirementPart = "";
                        if (fixedNames.length > 0) {
                          requirementPart = fixedNames.join(" and ");
                        }
                        
                        if (choiceNames.length > 0) {
                          if (requirementPart) requirementPart += " and ";
                          requirementPart += choiceNames.join(" or ");
                        }

                        if (selectedClass.multiclassing && selectedClass.multiclassing.trim() !== '') {
                          return <BBCodeRenderer content={selectedClass.multiclassing} />;
                        }

                        if (!requirementPart) return null;

                        return (
                          <div className="text-sm">
                            You must have a {requirementPart} score of 13 or higher in order to multiclass in or out of this class.
                          </div>
                        );
                      })()}
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
