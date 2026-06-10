import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { fetchCollection, fetchDocument, deleteDocument } from '../../lib/d1';
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
import { reportClientError, OperationType } from '../../lib/firebase';
import { cn } from '../../lib/utils';
import Markdown from 'react-markdown';
import BBCodeRenderer from '../../components/BBCodeRenderer';
import ModularChoiceView from '../../components/compendium/ModularChoiceView';
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
import { SectionFilterPanel, type FilterSection } from '../../components/compendium/SectionFilterPanel';
import { normalizeTagRow, expandTagsWithAncestors, buildTagParentMap } from '../../lib/tagHierarchy';
import {
  importClassSemantic
} from '../../lib/classExport';
import { buildClassSlug } from '../../lib/useClassRouteId';
import ClassPreviewCard from '../../components/compendium/ClassPreviewCard';
import ClassPreviewPane from '../../components/compendium/ClassPreviewPane';
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
  const [pactMasterChart, setPactMasterChart] = useState<any | null>(null);
  const [loadingStates, setLoadingStates] = useState({
    classes: true,
    foundation: true
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

  const isAdmin = userProfile?.role === 'admin' && !selectionMode;
  const isContentCreator =
    !selectionMode &&
    !!userProfile?.permissions &&
    Object.prototype.hasOwnProperty.call(userProfile.permissions, 'content-creator');
  // Route-aware: on /proposals/edit/classes the New / Edit buttons
  // target the proposal-mode editor; on /compendium/classes they
  // keep their admin-direct targets.
  const location = useLocation();
  const navigate = useNavigate();
  const isProposalRoute = location.pathname.startsWith('/proposals/edit/');
  // Content creators see the create-class affordance ONLY through the
  // proposal route — direct admin writes are admin-only. On the public
  // /compendium/classes page a content-creator should browse, then
  // pivot to /my-proposals to start a class proposal there.
  const canManage = isAdmin || (isContentCreator && isProposalRoute);
  const newClassHref = isProposalRoute
    ? '/proposals/edit/classes/new'
    : '/compendium/classes/new';
  const editClassHref = (cls: { id: string; identifier?: string; source_id?: string; sourceId?: string }) => {
    if (isProposalRoute) return `/proposals/edit/classes/edit/${cls.id}`;
    const sourceRow = sources[String(cls.source_id ?? cls.sourceId ?? '')];
    const abbrev = sourceRow?.abbreviation || sourceRow?.shortName;
    const slug = buildClassSlug({ identifier: cls.identifier }, abbrev);
    return `/compendium/classes/edit/${slug ?? cls.id}`;
  };
  const viewClassHref = (cls: { id: string; identifier?: string; source_id?: string; sourceId?: string }) => {
    const sourceRow = sources[String(cls.source_id ?? cls.sourceId ?? '')];
    const abbrev = sourceRow?.abbreviation || sourceRow?.shortName;
    const slug = buildClassSlug({ identifier: cls.identifier }, abbrev);
    return `/compendium/classes/view/${slug ?? cls.id}`;
  };
  const isLoading = loadingStates.classes || loadingStates.foundation;

  useEffect(() => {
    const loadClasses = async () => {
      try {
        const classData = await fetchCollection<any>('classes', { 
          select: 'id, name, identifier, source_id, category, tag_ids, image_url, card_image_url, preview_image_url, card_display, image_display, preview_display, preview, description',
          orderBy: 'name ASC' 
        });
        
        // Remap snake_case D1 columns to the camelCase shape the UI uses
        const mappedClasses = classData.map((c: any) => ({
          ...c,
          sourceId: c.source_id,
          tagIds: typeof c.tag_ids === 'string' ? JSON.parse(c.tag_ids) : (c.tag_ids ?? []),
          imageUrl: c.image_url,
          cardImageUrl: c.card_image_url,
          previewImageUrl: c.preview_image_url,
          cardDisplay: typeof c.card_display === 'string' ? JSON.parse(c.card_display) : (c.card_display ?? null),
          imageDisplay: typeof c.image_display === 'string' ? JSON.parse(c.image_display) : (c.image_display ?? null),
          previewDisplay: typeof c.preview_display === 'string' ? JSON.parse(c.preview_display) : (c.preview_display ?? null),
        }));

        setClasses(mappedClasses);
        setLoadingStates(prev => ({ ...prev, classes: false }));
      } catch (err) {
        console.error("Error loading classes:", err);
        setLoadingStates(prev => ({ ...prev, classes: false }));
      }
    };

    const loadFoundation = async () => {
      try {
        const [
          sourcesData,
          tagGroupsData,
          tagsData,
          skillsData,
          toolsData,
          toolCatsData,
          weaponCatsData,
          armorCatsData,
          armorData,
          weaponsData,
          attrsData,
          typesData,
          masterChartData,
          pactMasterChartData
        ] = await Promise.all([
          fetchCollection<any>('sources', { orderBy: 'name ASC' }),
          fetchCollection<any>('tagGroups', { where: "classifications LIKE '%class%'" }),
          fetchCollection<any>('tags'),
          fetchCollection<any>('skills'),
          fetchCollection<any>('tools'),
          fetchCollection<any>('toolCategories'),
          fetchCollection<any>('weaponCategories'),
          fetchCollection<any>('armorCategories'),
          fetchCollection<any>('armor'),
          fetchCollection<any>('weapons'),
          fetchCollection<any>('attributes'),
          fetchCollection<any>('spellcastingTypes'),
          fetchDocument<any>('standardMulticlassProgression', 'master'),
          fetchDocument<any>('pactMasterChart', 'pact')
        ]);

        const sourceMap: Record<string, any> = {};
        sourcesData.forEach(s => sourceMap[s.id] = s);
        setSources(sourceMap);
        setTagGroups(tagGroupsData.map((tg: any) => ({
          ...tg,
          classifications: typeof tg.classifications === 'string' ? JSON.parse(tg.classifications) : (tg.classifications || [])
        })));
        // Normalize tag rows on load. Raw D1 rows come back as snake_case
        // (`group_id`, `parent_tag_id`); the FilterBar default content
        // and the in-component `tagsByGroup` index assume `groupId` and
        // `parentTagId`. Without this normalize step every tag bucketed
        // under `map[undefined]` and no filter chips rendered at all —
        // that's the "class list filters broken" symptom. `normalizeTagRow`
        // centralizes the coercion so SpellListManager, SpellsEditor,
        // ClassList, etc. all share the same picker shape.
        setAllTags(tagsData.map((t: any) => ({ ...t, ...normalizeTagRow(t) })));
        setAllSkills(skillsData);
        setAllTools(toolsData);
        setAllToolCategories(toolCatsData);
        setAllWeaponCategories(weaponCatsData);
        setAllArmorCategories(armorCatsData);
        setAllArmor(armorData);
        setAllWeapons(weaponsData.map((w: any) => ({
          ...w,
          propertyIds: typeof w.property_ids === 'string' ? JSON.parse(w.property_ids) : (w.property_ids || w.propertyIds || [])
        })));

        const uniqueAttrsMap = new Map();
        attrsData.forEach((item: any) => {
          const key = (item.identifier || item.id).toUpperCase();
          if (!uniqueAttrsMap.has(key) || item.identifier) {
            uniqueAttrsMap.set(key, item);
          }
        });
        setAllAttributes(Array.from(uniqueAttrsMap.values()));
        
        setSpellcastingTypes(typesData);
        
        const chart = masterChartData ? {
          ...masterChartData,
          levels: typeof masterChartData.levels === 'string' ? JSON.parse(masterChartData.levels) : (masterChartData.levels || [])
        } : null;
        setMasterMulticlassChart(chart);

        const pactChart = pactMasterChartData ? {
          ...pactMasterChartData,
          levels: typeof pactMasterChartData.levels === 'string' ? JSON.parse(pactMasterChartData.levels) : (pactMasterChartData.levels || [])
        } : null;
        setPactMasterChart(pactChart);
        
        setLoadingStates(prev => ({ ...prev, foundation: false }));
      } catch (err) {
        console.error("Error loading foundation data for ClassList:", err);
        setLoadingStates(prev => ({ ...prev, foundation: false }));
      }
    };
      loadFoundation();
      loadClasses();
    }, []);

  // Tri-state cycle — left-click forward (off → include → exclude → off);
  // SectionFilterPanel's right-click affordance drives the reverse cycle
  // (off → exclude → include → off).
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
  const cycleTagStateReverse = (tagId: string) => {
    setTagStates(prev => {
      const current = prev[tagId] || 0;
      const next = current === 0 ? 2 : current === 2 ? 1 : 0;
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
  const cycleGroupModeReverse = (groupId: string) => {
    const modes: ('AND' | 'OR' | 'XOR')[] = ['AND', 'OR', 'XOR'];
    setGroupCombineModes(prev => {
      const current = prev[groupId] || 'OR';
      const idx = modes.indexOf(current);
      return {
        ...prev,
        [groupId]: modes[(idx - 1 + modes.length) % modes.length]
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
  const cycleExclusionModeReverse = (groupId: string) => {
    const modes: ('AND' | 'OR' | 'XOR')[] = ['AND', 'OR', 'XOR'];
    setGroupExclusionModes(prev => {
      const current = prev[groupId] || 'OR';
      const idx = modes.indexOf(current);
      return {
        ...prev,
        [groupId]: modes[(idx - 1 + modes.length) % modes.length]
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

  // Subtag-aware matching: a class tagged `Conjure.Manifest` should be
  // treated as also carrying its ancestor `Conjure`, so a filter on
  // `Conjure` matches the subtag-tagged class. Mirrors the spell-side
  // logic in SpellList / SpellListManager. The map is rebuilt only
  // when the tag set itself changes.
  const parentByTagId = React.useMemo(() => buildTagParentMap(allTags), [allTags]);

  // Axis descriptors for SectionFilterPanel. ClassList only has tag
  // groups (no source/level/etc. axes), so the wall is one row per
  // tag group. Subtags get `parentValue` wired so the panel's chevron
  // drawer treats them as hierarchical children of the parent tag —
  // matches the SpellFilterShell pattern.
  const miniPillAxes = React.useMemo<FilterSection[]>(() => {
    const axes: FilterSection[] = [];
    for (const group of tagGroups) {
      const groupTags = tagsByGroup[group.id] || [];
      if (groupTags.length === 0) continue;
      const idSet = new Set(groupTags.map(t => t.id));
      axes.push({
        key: `tag-group:${group.id}`,
        name: group.name,
        kind: 'tag',
        groupId: group.id,
        values: groupTags.map((t: any) => {
          const parent = t.parentTagId ?? null;
          return {
            value: t.id,
            label: t.name,
            parentValue: parent && idSet.has(parent) ? parent : undefined,
          };
        }),
      });
    }
    return axes;
  }, [tagGroups, tagsByGroup]);

  const filteredClasses = React.useMemo(() => {
    return classes.filter(c => {
      const sourceName = sources[c.sourceId]?.name || '';
      const matchesSearch = c.name.toLowerCase().includes(search.toLowerCase()) ||
        sourceName.toLowerCase().includes(search.toLowerCase());

      if (!matchesSearch) return false;

      const activeTagIds = Object.keys(tagStates);
      if (activeTagIds.length === 0) return true;

      // Expand the class's tag IDs with their ancestors so an
      // include/exclude on a parent tag also matches subtags. This is
      // the inverse of the SpellRule path (which expands at query time);
      // here we expand the entity's effective tag set.
      const rawClassTagIds = Array.isArray(c.tagIds) ? c.tagIds : [];
      const classTagIds = Array.from(expandTagsWithAncestors(rawClassTagIds, parentByTagId));

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
  }, [classes, sources, search, tagStates, tagGroups, tagsByGroup, groupCombineModes, groupExclusionModes, parentByTagId]);

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
      await deleteDocument('classes', classToDelete.id);
      console.log(`[ClassList] Class deleted successfully: ${classToDelete.id}`);
      setDeleteConfirmOpen(false);
      setClassToDelete(null);
      if (selectedClass?.id === classToDelete.id) {
        setSelectedClass(null);
      }
    } catch (error) {
      console.error(`[ClassList] Error deleting class ${classToDelete.id}:`, error);
      reportClientError(error, OperationType.DELETE, `classes/${classToDelete.id}`);
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


  const renderClassGrid = (classList: any[]) => (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
      {classList.map((cls) => (
        <ClassPreviewCard
          key={cls.id}
          name={cls.name}
          imageUrl={cls.cardImageUrl || cls.imageUrl}
          imageDisplay={cls.cardDisplay || cls.imageDisplay}
          preview={cls.preview || cls.description}
          sourceLabel={sources[cls.source_id || cls.sourceId]?.abbreviation || sources[cls.source_id || cls.sourceId]?.name}
          onClick={() => setSelectedClass(cls)}
          onDelete={isAdmin ? (e) => handleDeleteClass(e, cls.id, cls.name) : undefined}
          className="aspect-[4/3] sm:aspect-square md:aspect-[4/5] hover:-translate-y-1"
        />
      ))}
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-20">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
             {selectionMode && onCancelSelection ? (
               <Button variant="ghost" size="sm" onClick={onCancelSelection} className="text-ink/65 hover:text-ink -ml-2 mb-2 p-0 h-auto gap-1 text-[10px] uppercase font-bold tracking-widest">
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
          <div className="flex items-center gap-4">
            <h1 className="h2-title uppercase">{selectionMode ? 'Select a Class' : 'Classes'}</h1>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {isAdmin && (
            <Link to="/compendium/tags">
              <Button variant="outline" size="sm" className="border-gold/25 text-gold gap-2 hover:bg-gold/15">
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
                className="border-gold/25 text-gold gap-2 hover:bg-gold/15"
              >
                <Upload className="w-4 h-4" /> Import Class
              </Button>
            </>
          )}
          {canManage && (
            <Link to={newClassHref}>
              <Button className="btn-gold-solid gap-2 shadow-lg shadow-gold/25">
                <Plus className="w-4 h-4" /> New Class
              </Button>
            </Link>
          )}
        </div>
      </div>

      <FilterBar
        search={search}
        setSearch={setSearch}
        isFilterOpen={isFilterOpen}
        setIsFilterOpen={setIsFilterOpen}
        activeFilterCount={activeFilterCount}
        resetFilters={() => {
          setTagStates({});
          setGroupCombineModes({});
          setGroupExclusionModes({});
        }}
        renderFilters={
          <SectionFilterPanel
            axes={miniPillAxes}
            axisFilters={{}}
            tagStates={tagStates}
            cycleAxisState={() => {}}
            cycleAxisStateReverse={() => {}}
            cycleTagState={cycleTagState}
            cycleTagStateReverse={cycleTagStateReverse}
            cycleGroupMode={cycleGroupMode}
            cycleGroupModeReverse={cycleGroupModeReverse}
            cycleExclusionMode={cycleExclusionMode}
            cycleExclusionModeReverse={cycleExclusionModeReverse}
            groupCombineModes={groupCombineModes}
            groupExclusionModes={groupExclusionModes}
            setTagStates={setTagStates}
            search={search}
            setSearch={setSearch}
            activeFilterCount={activeFilterCount}
            resetAll={() => {
              setTagStates({});
              setGroupCombineModes({});
              setGroupExclusionModes({});
            }}
            embedded
          />
        }
      />

      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="bg-card border-gold/35">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl text-blood flex items-center gap-2">
              <AlertTriangle className="w-6 h-6" />
              Confirm Deletion
            </DialogTitle>
            <DialogDescription className="text-ink/65">
              Are you sure you want to delete the class <span className="font-bold text-ink">"{classToDelete?.name}"</span>? 
              This action is permanent and will remove all associated data from the archive.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button 
              variant="ghost" 
              onClick={() => setDeleteConfirmOpen(false)}
              disabled={isDeleting}
              className="text-ink/45 hover:text-ink"
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
            <div key={i} className="aspect-[4/3] bg-gold/5 animate-pulse rounded-lg border border-gold/15" />
          ))}
        </div>
      ) : filteredClasses.length > 0 ? (
        <div className="space-y-16">
          {filteredClasses.filter(c => !c.category || c.category === 'core').length > 0 && (
            <div className="space-y-6">
              <h2 className="h2-title text-gold border-b border-gold/25 pb-2">Core Classes</h2>
              {renderClassGrid(filteredClasses.filter(c => !c.category || c.category === 'core'))}
            </div>
          )}
          {filteredClasses.filter(c => c.category === 'alternate').length > 0 && (
            <div className="space-y-6">
              <h2 className="h2-title text-gold border-b border-gold/25 pb-2">Alternate Classes</h2>
              {renderClassGrid(filteredClasses.filter(c => c.category === 'alternate'))}
            </div>
          )}
          {filteredClasses.filter(c => c.category === 'new').length > 0 && (
            <div className="space-y-6">
              <h2 className="h2-title text-gold border-b border-gold/25 pb-2">New Classes</h2>
              {renderClassGrid(filteredClasses.filter(c => c.category === 'new'))}
            </div>
          )}
        </div>
      ) : (
        <div className="text-center py-20 bg-card rounded-3xl border border-dashed border-gold/25">
          <BookOpen className="w-12 h-12 text-gold/25 mx-auto mb-4" />
          <h3 className="font-serif text-xl text-ink/65 italic">No classes found matching your search.</h3>
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

      {/* Class preview pane — opened from the grid cards. The extracted pane
          owns its own data fetching; we pass the catalogue ClassList already
          loaded so it does not re-fetch. View Page / Edit / Select reuse the
          same routes and handlers the old inline dialog used. */}
      <ClassPreviewPane
        classData={selectedClass}
        open={!!selectedClass}
        onClose={() => setSelectedClass(null)}
        foundation={{
          allTags,
          allAttributes,
          allSkills,
          allTools,
          allArmorCategories,
          allWeaponCategories,
          allToolCategories,
          allArmor,
          allWeapons,
          sources,
          spellcastingTypes,
          masterMulticlassChart,
          pactMasterChart,
        }}
        selectionMode={selectionMode}
        onSelect={(cls) => onSelectClass?.(cls)}
        onViewPage={!isProposalRoute ? (cls) => navigate(viewClassHref(cls)) : undefined}
        onEdit={canManage ? (cls) => navigate(editClassHref(cls)) : undefined}
        editAsPrimary={isProposalRoute}
      />
    </div>
  );
}

export default ClassList;
