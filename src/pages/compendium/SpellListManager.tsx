import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronLeft, Wand2, Plus, Check, X, ChevronDown, ChevronRight, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../../components/ui/dialog';
import VirtualizedList from '../../components/ui/VirtualizedList';
import { FilterBar, TagGroupFilter, AxisFilterSection, matchesTagFilters } from '../../components/compendium/FilterBar';
import SpellDetailPanel from '../../components/compendium/SpellDetailPanel';
import { fetchCollection } from '../../lib/d1';
import { fetchSpellSummaries } from '../../lib/spellSummary';
import { expandTagsWithAncestors, normalizeTagRow, orderTagsAsTree, tagPickerLabel, buildTagIndex } from '../../lib/tagHierarchy';
import { cn } from '../../lib/utils';
import { SCHOOL_LABELS } from '../../lib/spellImport';
import {
  fetchClassSpellIds,
  fetchClassRuleSpellIds,
  fetchLastClassRuleRebuildAt,
  fetchClassesForSpells,
  addSpellsToClassList,
  removeSpellsFromClassList,
  type ClassMembership,
} from '../../lib/classSpellLists';
import {
  fetchAppliedRulesFor,
  rebuildClassSpellListFromAppliedRules,
  unapplyRule,
  applyRule,
  fetchAllRules,
  spellMatchesRule,
  type SpellRule,
} from '../../lib/spellRules';
import {
  ACTIVATION_LABELS,
  ACTIVATION_ORDER,
  DURATION_LABELS,
  DURATION_ORDER,
  PROPERTY_LABELS,
  PROPERTY_ORDER,
  RANGE_LABELS,
  RANGE_ORDER,
  SHAPE_LABELS,
  SHAPE_ORDER,
  deriveSpellFilterFacets,
  matchesSingleAxisFilter,
  matchesMultiAxisFilter,
  type ActivationBucket,
  type DurationBucket,
  type PropertyFilter,
  type RangeBucket,
  type ShapeBucket,
} from '../../lib/spellFilters';

// Inner virtualized list height — derived from the page's viewport
// paneHeight at render time so the list fills exactly the leftover
// vertical space after toolbar(s) and header strip. ROW_HEIGHT is
// the per-row cell height; matches the SpellList browser's compact
// 48px rhythm so a class curator and a reader scanning the public
// catalogue see the same visual cadence.
const ROW_HEIGHT = 48;
const LIST_HEADER_PX = 38; // sort/column-label strip above the rows

const LEVEL_VALUES = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

type SpellRow = {
  id: string;
  name: string;
  level: number;
  school: string;
  source_id: string | null;
  tags: string[];
  // Bucketed mechanical fields, derived once at load from foundry_data.system.*.
  // These slot directly into filter chips so filtering is a Set lookup, not JSON parsing.
  activationBucket: ActivationBucket;
  rangeBucket: RangeBucket;
  durationBucket: DurationBucket;
  shapeBucket: ShapeBucket;
  concentration: boolean;
  ritual: boolean;
  vocal: boolean;
  somatic: boolean;
  material: boolean;
};


type ClassRow = {
  id: string;
  name: string;
  identifier: string;
};

type SourceRow = {
  id: string;
  name?: string;
  abbreviation?: string;
  shortName?: string;
};

type TagRow = { id: string; name: string; groupId: string | null; parentTagId: string | null };
type TagGroupRow = { id: string; name: string };

type FilteredEntry = {
  spell: SpellRow;
  matchedTagNames: string[]; // tag names that the search query matched
};

export default function SpellListManager({ userProfile }: { userProfile: any }) {
  const isAdmin = userProfile?.role === 'admin';
  const [searchParams, setSearchParams] = useSearchParams();

  // Fullscreen-page opt-in. Same body class /compendium/spells and
  // /compendium/spells/manage use — strips <main>'s container
  // padding, hides the footer, locks body scroll so each pane
  // handles its own overflow.
  useEffect(() => {
    if (!isAdmin) return;
    document.body.classList.add('spell-list-fullscreen');
    return () => document.body.classList.remove('spell-list-fullscreen');
  }, [isAdmin]);

  // Viewport-derived pane height. The chrome above the working
  // grid is: navbar (~56) + page toolbar (~50) + FilterBar row
  // (~56) + maybe rules / chip strips when present + small gaps
  // ≈ 200-260 depending on whether the rules strip is showing.
  // We use a single conservative offset; the small underestimate
  // just leaves a few pixels of breathing room at the bottom of
  // the panes.
  const [paneHeight, setPaneHeight] = useState<number>(() =>
    typeof window === 'undefined' ? 720 : Math.max(420, window.innerHeight - 260),
  );
  useEffect(() => {
    const onResize = () => setPaneHeight(Math.max(420, window.innerHeight - 260));
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [spells, setSpells] = useState<SpellRow[]>([]);
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [tags, setTags] = useState<TagRow[]>([]);
  const [tagGroups, setTagGroups] = useState<TagGroupRow[]>([]);
  const [loading, setLoading] = useState(true);

  const initialClassId = searchParams.get('class') || '';
  const [selectedClassId, setSelectedClassId] = useState<string>(initialClassId);
  const [classListIds, setClassListIds] = useState<Set<string>>(new Set());
  const [classListLoading, setClassListLoading] = useState(false);

  // Map<spellId, ClassMembership[]> — every class that has each spell on its list.
  // Loaded once after spells, then mutated locally on add/remove to stay accurate.
  const [spellMembershipsBySpellId, setSpellMembershipsBySpellId] = useState<Map<string, ClassMembership[]>>(new Map());

  const [search, setSearch] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  // Rich live filter state — uniform with SpellList. Every axis lives
  // under one record keyed by axis name (source / level / school /
  // activation / range / duration / shape / property). Per-axis state:
  // { states (chip 1=include / 2=exclude), combineMode, exclusionMode }.
  type AxisState = { states: Record<string, number>; combineMode?: 'AND' | 'OR' | 'XOR'; exclusionMode?: 'AND' | 'OR' | 'XOR' };
  const [axisFilters, setAxisFilters] = useState<Record<string, AxisState>>({});
  // Rich tag filter state — same shape as every other list page.
  const [tagStates, setTagStates] = useState<Record<string, number>>({});
  const [groupCombineModes, setGroupCombineModes] = useState<Record<string, 'AND' | 'OR' | 'XOR'>>({});
  const [groupExclusionModes, setGroupExclusionModes] = useState<Record<string, 'AND' | 'OR' | 'XOR'>>({});
  const [showOnlyInList, setShowOnlyInList] = useState(false);
  const [showOrphansOnly, setShowOrphansOnly] = useState(false);
  const [linkedRules, setLinkedRules] = useState<SpellRule[]>([]);
  const [allRules, setAllRules] = useState<SpellRule[]>([]);
  const [rebuildPending, setRebuildPending] = useState(false);
  const [linkedRulesExpanded, setLinkedRulesExpanded] = useState(true);
  const [linkRuleDialogOpen, setLinkRuleDialogOpen] = useState(false);
  const [lastRebuildAt, setLastRebuildAt] = useState<string | null>(null);
  const [rebuildPreview, setRebuildPreview] = useState<{ toAdd: string[]; toRemove: string[]; staying: string[] } | null>(null);
  const [pendingSpellIds, setPendingSpellIds] = useState<Set<string>>(new Set());
  const [selectedSpellIds, setSelectedSpellIds] = useState<Set<string>>(new Set());
  const [bulkPending, setBulkPending] = useState(false);
  const [previewSpellId, setPreviewSpellId] = useState<string | null>(null);

  // Load classes + spells + sources + tags once, then bulk-fetch class memberships.
  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    (async () => {
      try {
        const [classData, spellData, sourceData, tagData, tagGroupData] = await Promise.all([
          fetchCollection<any>('classes', { orderBy: 'name ASC' }),
          fetchSpellSummaries('level ASC, name ASC'),
          fetchCollection<any>('sources', { orderBy: 'name ASC' }),
          fetchCollection<any>('tags', { orderBy: 'name ASC' }),
          fetchCollection<any>('tagGroups', { where: "classifications LIKE '%spell%'" }),
        ]);
        if (!active) return;
        setClasses(classData.map((c: any) => ({ id: c.id, name: c.name, identifier: c.identifier })));
        const mappedSpells: SpellRow[] = spellData.map((s: any) => ({
          id: s.id,
          name: s.name,
          level: Number(s.level || 0),
          school: s.school || '',
          source_id: s.source_id,
          tags: typeof s.tags === 'string' ? safeTagIds(s.tags) : (Array.isArray(s.tags) ? s.tags : []),
          ...deriveSpellFilterFacets(s),
        }));
        setSpells(mappedSpells);
        setSources(sourceData);
        setTags(tagData.map(normalizeTagRow));
        setTagGroups(tagGroupData.map((g: any) => ({ id: g.id, name: g.name || 'Tags' })));

        // Bulk-fetch class memberships for the "Also on" badge. One query, indexed lookup.
        try {
          const memberships = await fetchClassesForSpells(mappedSpells.map(s => s.id));
          if (active) setSpellMembershipsBySpellId(memberships);
        } catch (err) {
          console.error('[SpellListManager] Failed to load class memberships:', err);
        }
      } catch (err) {
        console.error('[SpellListManager] Failed to load foundation data:', err);
        toast.error('Failed to load spells or classes.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [isAdmin]);

  // Reload the selected class's list (membership + linked rules + last-rebuild ts) when the class changes.
  useEffect(() => {
    if (!selectedClassId) {
      setClassListIds(new Set());
      setLinkedRules([]);
      setLastRebuildAt(null);
      return;
    }
    let active = true;
    setClassListLoading(true);
    fetchClassSpellIds(selectedClassId)
      .then(ids => { if (active) setClassListIds(ids); })
      .catch(err => {
        console.error('[SpellListManager] Failed to load class spell list:', err);
        if (active) toast.error("Failed to load this class's spell list.");
      })
      .finally(() => { if (active) setClassListLoading(false); });
    fetchAppliedRulesFor('class', selectedClassId)
      .then(rs => { if (active) setLinkedRules(rs); })
      .catch(err => console.error('[SpellListManager] Failed to load linked rules:', err));
    fetchLastClassRuleRebuildAt(selectedClassId)
      .then(ts => { if (active) setLastRebuildAt(ts); })
      .catch(err => console.error('[SpellListManager] Failed to load last-rebuild timestamp:', err));
    return () => { active = false; };
  }, [selectedClassId]);

  // Load the full rule catalogue once for the "Link Rule" picker. Cheap (rules table
  // is small, and the d1 cache backs it after the first hit).
  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    fetchAllRules()
      .then(rs => { if (active) setAllRules(rs); })
      .catch(err => console.error('[SpellListManager] Failed to load rules catalogue:', err));
    return () => { active = false; };
  }, [isAdmin]);

  // Keep ?class= URL param in sync so the page is link-shareable.
  useEffect(() => {
    const current = searchParams.get('class') || '';
    if (current === selectedClassId) return;
    const next = new URLSearchParams(searchParams);
    if (selectedClassId) next.set('class', selectedClassId);
    else next.delete('class');
    setSearchParams(next, { replace: true });
  }, [selectedClassId, searchParams, setSearchParams]);

  const sourceById = useMemo(
    () => Object.fromEntries(sources.map(s => [s.id, s])) as Record<string, SourceRow>,
    [sources]
  );

  const tagsById = useMemo(
    () => Object.fromEntries(tags.map(t => [t.id, t])) as Record<string, TagRow>,
    [tags]
  );

  const tagsByGroup = useMemo(() => {
    // Each group's tags are reordered so subtags follow their parent.
    // Filter chips render through RuleFilterSection (flat value/label),
    // so the parent-child visual is applied via tagPickerLabel at the
    // mapping site (line ~750).
    const map: Record<string, TagRow[]> = {};
    for (const tag of tags) {
      if (!tag.groupId) continue;
      if (!map[tag.groupId]) map[tag.groupId] = [];
      map[tag.groupId].push(tag);
    }
    for (const groupId in map) {
      map[groupId] = orderTagsAsTree(map[groupId]);
    }
    return map;
  }, [tags]);

  // Subtag-aware tag matching: a spell tagged `Conjure.Manifest` is
  // treated as also carrying its ancestor `Conjure`, so a filter on
  // `Conjure` matches the subtag-tagged spell. See tagHierarchy.ts.
  const parentByTagId = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const t of tags) map.set(t.id, t.parentTagId ?? null);
    return map;
  }, [tags]);

  const filteredSpells = useMemo<FilteredEntry[]>(() => {
    const q = search.trim().toLowerCase();
    const out: FilteredEntry[] = [];
    for (const s of spells) {
      if (showOnlyInList && !classListIds.has(s.id)) continue;
      if (showOrphansOnly && (spellMembershipsBySpellId.get(s.id)?.length ?? 0) > 0) continue;
      // Rich axis filters — same matcher functions every page uses.
      if (!matchesSingleAxisFilter(String(s.level), axisFilters.level)) continue;
      if (!matchesSingleAxisFilter(s.school, axisFilters.school)) continue;
      if (!matchesSingleAxisFilter(String(s.source_id ?? ''), axisFilters.source)) continue;
      // Subtag-aware tag matching via the rich tag-state matcher.
      const effectiveTagIds = Array.from(expandTagsWithAncestors(s.tags, parentByTagId));
      if (!matchesTagFilters(effectiveTagIds, tagGroups, tagsByGroup, tagStates, groupCombineModes, groupExclusionModes)) continue;
      if (!matchesSingleAxisFilter(s.activationBucket, axisFilters.activation)) continue;
      if (!matchesSingleAxisFilter(s.rangeBucket, axisFilters.range)) continue;
      if (!matchesSingleAxisFilter(s.durationBucket, axisFilters.duration)) continue;
      if (!matchesSingleAxisFilter(s.shapeBucket, axisFilters.shape)) continue;
      // Properties: multi-valued axis (a spell can have V + S + M).
      const propsHave = new Set<string>();
      if ((s as any).concentration) propsHave.add('concentration');
      if ((s as any).ritual) propsHave.add('ritual');
      if ((s as any).vocal) propsHave.add('vocal');
      if ((s as any).somatic) propsHave.add('somatic');
      if ((s as any).material) propsHave.add('material');
      if (!matchesMultiAxisFilter(propsHave, axisFilters.property)) continue;

      let matchedTagNames: string[] = [];
      if (q) {
        const nameMatch = s.name.toLowerCase().includes(q);
        for (const tagId of s.tags) {
          const tagName = tagsById[tagId]?.name;
          if (tagName && tagName.toLowerCase().includes(q)) matchedTagNames.push(tagName);
        }
        if (!nameMatch && matchedTagNames.length === 0) continue;
      }
      out.push({ spell: s, matchedTagNames });
    }
    return out;
  }, [spells, classListIds, search, axisFilters, tagStates, tagGroups, tagsByGroup, groupCombineModes, groupExclusionModes, showOnlyInList, showOrphansOnly, spellMembershipsBySpellId, tagsById, parentByTagId]);

  const activeFilterCount =
    Object.keys(axisFilters.source?.states ?? {}).length
    + Object.keys(axisFilters.level?.states ?? {}).length
    + Object.keys(axisFilters.school?.states ?? {}).length
    + Object.keys(tagStates).length
    + Object.keys(axisFilters.activation?.states ?? {}).length
    + Object.keys(axisFilters.range?.states ?? {}).length
    + Object.keys(axisFilters.duration?.states ?? {}).length
    + Object.keys(axisFilters.shape?.states ?? {}).length
    + Object.keys(axisFilters.property?.states ?? {}).length;

  // Per-axis updaters — same generic pattern as SpellList.
  const cycleAxisState = (axisKey: string, value: string) => {
    setAxisFilters(prev => {
      const cur = prev[axisKey] || { states: {} };
      const states: Record<string, number> = { ...cur.states };
      const s = states[value] || 0;
      const nextState = s === 0 ? 1 : s === 1 ? 2 : 0;
      if (nextState === 0) delete states[value];
      else states[value] = nextState;
      return { ...prev, [axisKey]: { ...cur, states } };
    });
  };
  const cycleAxisCombineMode = (axisKey: string) => {
    setAxisFilters(prev => {
      const cur = prev[axisKey] || { states: {} };
      const m = (cur.combineMode || 'OR') as 'OR' | 'AND' | 'XOR';
      const next = m === 'OR' ? 'AND' : m === 'AND' ? 'XOR' : 'OR';
      return { ...prev, [axisKey]: { ...cur, combineMode: next } };
    });
  };
  const cycleAxisExclusionMode = (axisKey: string) => {
    setAxisFilters(prev => {
      const cur = prev[axisKey] || { states: {} };
      const m = (cur.exclusionMode || 'OR') as 'OR' | 'AND' | 'XOR';
      const next = m === 'OR' ? 'AND' : m === 'AND' ? 'XOR' : 'OR';
      return { ...prev, [axisKey]: { ...cur, exclusionMode: next } };
    });
  };
  const axisIncludeAll = (axisKey: string, values: readonly string[]) => {
    setAxisFilters(prev => {
      const cur = prev[axisKey] || { states: {} };
      const states: Record<string, number> = { ...cur.states };
      for (const v of values) states[v] = 1;
      return { ...prev, [axisKey]: { ...cur, states } };
    });
  };
  const axisExcludeAll = (axisKey: string, values: readonly string[]) => {
    setAxisFilters(prev => {
      const cur = prev[axisKey] || { states: {} };
      const states: Record<string, number> = { ...cur.states };
      for (const v of values) states[v] = 2;
      return { ...prev, [axisKey]: { ...cur, states } };
    });
  };
  const axisClear = (axisKey: string) => {
    setAxisFilters(prev => {
      const cur = prev[axisKey] || { states: {} };
      return { ...prev, [axisKey]: { ...cur, states: {} } };
    });
  };
  // Direct removal — clicks on the X of an active-filter chip in the
  // ActiveFilterChips strip clear that single value (any state) back to
  // neutral. Not a cycle; the strip's interaction model is "click X to
  // remove" rather than the modal's 3-state cycle.
  const cycleAxisStateRemove = (axisKey: string, value: string) => {
    setAxisFilters(prev => {
      const cur = prev[axisKey] || { states: {} };
      const states: Record<string, number> = { ...cur.states };
      delete states[value];
      return { ...prev, [axisKey]: { ...cur, states } };
    });
  };

  const cycleTagState = (tagId: string) => {
    setTagStates(prev => {
      const next = { ...prev };
      const state = next[tagId] || 0;
      if (state === 0) next[tagId] = 1;
      else if (state === 1) next[tagId] = 2;
      else delete next[tagId];
      return next;
    });
  };
  const cycleGroupMode = (groupId: string) => {
    setGroupCombineModes(prev => {
      const cur = prev[groupId] || 'OR';
      const nextMode = cur === 'OR' ? 'AND' : cur === 'AND' ? 'XOR' : 'OR';
      return { ...prev, [groupId]: nextMode };
    });
  };
  const cycleExclusionMode = (groupId: string) => {
    setGroupExclusionModes(prev => {
      const cur = prev[groupId] || 'OR';
      const nextMode = cur === 'OR' ? 'AND' : cur === 'AND' ? 'XOR' : 'OR';
      return { ...prev, [groupId]: nextMode };
    });
  };

  const resetFilters = () => {
    setAxisFilters({});
    setTagStates({});
    setGroupCombineModes({});
    setGroupExclusionModes({});
  };

  const inListCount = classListIds.size;
  const inListByLevel = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of spells) {
      if (!classListIds.has(s.id)) continue;
      const k = String(s.level);
      counts[k] = (counts[k] || 0) + 1;
    }
    return counts;
  }, [spells, classListIds]);

  const selectedClass = classes.find(c => c.id === selectedClassId);

  // Local mutator for spellMembershipsBySpellId so the "Also on" badges stay
  // accurate without a refetch round-trip after each Add/Remove.
  const mutateMembership = (spellId: string, classMembership: ClassMembership, mode: 'add' | 'remove') => {
    setSpellMembershipsBySpellId(prev => {
      const next = new Map(prev);
      const current = next.get(spellId) || [];
      if (mode === 'add') {
        if (!current.some(c => c.id === classMembership.id)) {
          next.set(spellId, [...current, classMembership].sort((a, b) => a.name.localeCompare(b.name)));
        }
      } else {
        const filtered = current.filter(c => c.id !== classMembership.id);
        if (filtered.length === 0) next.delete(spellId);
        else next.set(spellId, filtered);
      }
      return next;
    });
  };

  /**
   * Single source of truth for any add/remove action — single toggle, bulk add, bulk remove,
   * and the undo path all go through here. `silent` skips the success toast (used when an
   * undo action triggers another applyChange so we don't loop toasts forever).
   */
  const applyChange = async (
    classId: string,
    spellIds: string[],
    mode: 'add' | 'remove',
    opts: { silent?: boolean } = {},
  ) => {
    if (spellIds.length === 0) return;
    const cls = classes.find(c => c.id === classId);
    if (!cls) {
      toast.error('Class not found.');
      return;
    }
    const classMembership: ClassMembership = { id: cls.id, name: cls.name, identifier: cls.identifier };

    // Mark in-flight (so per-row buttons disable)
    setPendingSpellIds(prev => {
      const next = new Set(prev);
      for (const id of spellIds) next.add(id);
      return next;
    });

    // Optimistic apply
    setClassListIds(prev => {
      const next = new Set(prev);
      for (const id of spellIds) {
        if (mode === 'add') next.add(id);
        else next.delete(id);
      }
      return next;
    });
    for (const id of spellIds) mutateMembership(id, classMembership, mode);

    try {
      if (mode === 'add') await addSpellsToClassList(classId, spellIds);
      else await removeSpellsFromClassList(classId, spellIds);

      if (!opts.silent) {
        const verb = mode === 'add' ? 'Added' : 'Removed';
        const prep = mode === 'add' ? 'to' : 'from';
        const noun = spellIds.length === 1
          ? (spells.find(s => s.id === spellIds[0])?.name || '1 spell')
          : `${spellIds.length} spells`;
        toast(`${verb} ${noun} ${prep} ${cls.name}.`, {
          duration: 10_000,
          action: {
            label: 'Undo',
            onClick: () => {
              applyChange(classId, spellIds, mode === 'add' ? 'remove' : 'add', { silent: true })
                .then(() => toast(`${mode === 'add' ? 'Removed' : 'Re-added'} ${noun}.`));
            },
          },
        });
      }
    } catch (err) {
      console.error('[SpellListManager] applyChange failed:', err);
      toast.error(mode === 'add' ? 'Failed to add spells.' : 'Failed to remove spells.');
      // Revert
      setClassListIds(prev => {
        const next = new Set(prev);
        for (const id of spellIds) {
          if (mode === 'add') next.delete(id);
          else next.add(id);
        }
        return next;
      });
      for (const id of spellIds) mutateMembership(id, classMembership, mode === 'add' ? 'remove' : 'add');
    } finally {
      setPendingSpellIds(prev => {
        const next = new Set(prev);
        for (const id of spellIds) next.delete(id);
        return next;
      });
    }
  };

  const handleToggleSpell = (spellId: string) => {
    if (!selectedClassId) {
      toast.error('Pick a class first.');
      return;
    }
    if (pendingSpellIds.has(spellId)) return;
    const wasOnList = classListIds.has(spellId);
    void applyChange(selectedClassId, [spellId], wasOnList ? 'remove' : 'add');
  };

  const toggleSelected = (spellId: string) => {
    setSelectedSpellIds(prev => {
      const next = new Set(prev);
      if (next.has(spellId)) next.delete(spellId);
      else next.add(spellId);
      return next;
    });
  };

  const clearSelection = () => setSelectedSpellIds(new Set());

  // Reset multi-select + preview whenever the class changes — selections only make sense
  // in context of the currently-selected class's list state.
  useEffect(() => {
    clearSelection();
    setPreviewSpellId(null);
  }, [selectedClassId]);

  // Bulk computations: which selected spells would actually change on add vs remove.
  // (A selected spell already on the list is a no-op for Add, and vice versa.)
  const bulkAddableIds = useMemo(
    () => Array.from(selectedSpellIds).filter(id => !classListIds.has(id)),
    [selectedSpellIds, classListIds],
  );
  const bulkRemovableIds = useMemo(
    () => Array.from(selectedSpellIds).filter(id => classListIds.has(id)),
    [selectedSpellIds, classListIds],
  );

  // Visible-set helpers for "select all visible" / "deselect all visible".
  const visibleIdSet = useMemo(() => new Set(filteredSpells.map(e => e.spell.id)), [filteredSpells]);
  const visibleSelectedCount = useMemo(
    () => Array.from(selectedSpellIds).filter(id => visibleIdSet.has(id)).length,
    [selectedSpellIds, visibleIdSet],
  );
  const allVisibleSelected = filteredSpells.length > 0 && visibleSelectedCount === filteredSpells.length;
  const someVisibleSelected = visibleSelectedCount > 0 && !allVisibleSelected;

  const toggleAllVisible = () => {
    setSelectedSpellIds(prev => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const id of visibleIdSet) next.delete(id);
      } else {
        for (const id of visibleIdSet) next.add(id);
      }
      return next;
    });
  };

  const handleBulkAdd = async () => {
    if (!selectedClassId || bulkAddableIds.length === 0 || bulkPending) return;
    setBulkPending(true);
    try {
      await applyChange(selectedClassId, bulkAddableIds, 'add');
      clearSelection();
    } finally {
      setBulkPending(false);
    }
  };

  const handleBulkRemove = async () => {
    if (!selectedClassId || bulkRemovableIds.length === 0 || bulkPending) return;
    setBulkPending(true);
    try {
      await applyChange(selectedClassId, bulkRemovableIds, 'remove');
      clearSelection();
    } finally {
      setBulkPending(false);
    }
  };

  // ----- Linked Rules (Layer 1 v1.1, restructured) -----

  // Tag-hierarchy index used by every rich-tag rule matcher below.
  // Without this index, `spellMatchesRule` short-circuits to "match"
  // for any rule that uses `tagStates` (the defensive fallback in
  // `matchSpellAgainstRule` in src/lib/spellFilters.ts), so the live
  // match counts in this page would say "everything matches" and
  // wildly mislead the user. The server-side rebuild path
  // (`rebuildClassSpellListFromAppliedRules`) already builds its own
  // tagIndex, so a real Rebuild produced correct rows even when this
  // preview lied — fix is purely a UI-correctness one.
  const tagIndex = useMemo(() => buildTagIndex(tags as any), [tags]);

  // Per-rule live match counts. Cheap — runs the matcher across the local spell catalogue.
  const ruleMatchCounts = useMemo(() => {
    const out: Record<string, { matches: number; onList: number }> = {};
    for (const rule of linkedRules) {
      let matches = 0;
      let onList = 0;
      for (const s of spells) {
        if (!spellMatchesRule(s, rule, tagIndex)) continue;
        matches++;
        if (classListIds.has(s.id)) onList++;
      }
      out[rule.id] = { matches, onList };
    }
    return out;
  }, [linkedRules, spells, classListIds, tagIndex]);

  // Total spells contributed by all linked rules (deduped) — for the collapsed summary.
  const totalLinkedRuleMatches = useMemo(() => {
    if (linkedRules.length === 0) return 0;
    const set = new Set<string>();
    for (const rule of linkedRules) {
      for (const s of spells) if (spellMatchesRule(s, rule, tagIndex)) set.add(s.id);
    }
    return set.size;
  }, [linkedRules, spells, tagIndex]);

  // Per-rule stale detection. A rule is "stale" relative to this
  // class if it's been edited since the class was last rebuilt
  // (i.e. spell_rules.updated_at > MAX(class_spell_lists.added_at)
  // for the rule:% rows on this class). Also stale if the class
  // has never been rebuilt but does have rules linked — that's
  // the "linked but never baked" case.
  // String compare on ISO-shaped DATETIME columns works because
  // both fields are written by SQLite's CURRENT_TIMESTAMP, which
  // emits "YYYY-MM-DD HH:MM:SS" — lexicographically sortable.
  const staleRuleIds = useMemo(() => {
    const out = new Set<string>();
    for (const rule of linkedRules) {
      const updatedAt = rule.updatedAt || '';
      if (!lastRebuildAt) {
        // Class never rebuilt — every linked rule needs a bake.
        out.add(rule.id);
        continue;
      }
      if (updatedAt && updatedAt > lastRebuildAt) {
        out.add(rule.id);
      }
    }
    return out;
  }, [linkedRules, lastRebuildAt]);

  const handleLinkRule = async (rule: SpellRule) => {
    if (!selectedClassId) return;
    try {
      await applyRule(rule.id, 'class', selectedClassId);
      const refreshed = await fetchAppliedRulesFor('class', selectedClassId);
      setLinkedRules(refreshed);
      toast(`Linked "${rule.name}" to this class.`);
    } catch (err) {
      console.error('[SpellListManager] Link failed:', err);
      toast.error('Failed to link rule.');
    }
  };

  const handleUnlinkRule = async (rule: SpellRule) => {
    if (!selectedClassId) return;
    try {
      await unapplyRule(rule.id, 'class', selectedClassId);
      setLinkedRules(prev => prev.filter(r => r.id !== rule.id));
      toast(`Unlinked "${rule.name}".`);
    } catch (err) {
      console.error('[SpellListManager] Unlink failed:', err);
      toast.error('Failed to unlink rule.');
    }
  };

  // Open preview dialog: compute toAdd / toRemove / staying without mutating anything.
  const handleOpenRebuildPreview = async () => {
    if (!selectedClassId || rebuildPending) return;
    if (linkedRules.length === 0) {
      toast.error('No rules linked to this class.');
      return;
    }
    try {
      const currentRuleSet = await fetchClassRuleSpellIds(selectedClassId);
      const newRuleSet = new Set<string>();
      for (const rule of linkedRules) {
        for (const s of spells) if (spellMatchesRule(s, rule, tagIndex)) newRuleSet.add(s.id);
      }
      const toAdd: string[] = [];
      const toRemove: string[] = [];
      const staying: string[] = [];
      for (const id of newRuleSet) {
        if (currentRuleSet.has(id)) staying.push(id);
        else toAdd.push(id);
      }
      for (const id of currentRuleSet) {
        if (!newRuleSet.has(id)) toRemove.push(id);
      }
      setRebuildPreview({ toAdd, toRemove, staying });
    } catch (err) {
      console.error('[SpellListManager] Rebuild preview failed:', err);
      toast.error('Failed to preview rebuild.');
    }
  };

  const handleConfirmRebuild = async () => {
    if (!selectedClassId || rebuildPending) return;
    setRebuildPreview(null);
    setRebuildPending(true);
    try {
      const inputs = spells.map(s => ({
        id: s.id,
        level: s.level,
        school: s.school,
        source_id: s.source_id,
        tags: s.tags,
        activationBucket: s.activationBucket,
        rangeBucket: s.rangeBucket,
        durationBucket: s.durationBucket,
        shapeBucket: s.shapeBucket,
        concentration: s.concentration,
        ritual: s.ritual,
        vocal: s.vocal,
        somatic: s.somatic,
        material: s.material,
      }));
      const { added, rules } = await rebuildClassSpellListFromAppliedRules(selectedClassId, inputs);
      const [ids, memberships, ts] = await Promise.all([
        fetchClassSpellIds(selectedClassId),
        fetchClassesForSpells(spells.map(s => s.id)),
        fetchLastClassRuleRebuildAt(selectedClassId),
      ]);
      setClassListIds(ids);
      setSpellMembershipsBySpellId(memberships);
      setLastRebuildAt(ts);
      toast(`Rebuilt: ${added} spell${added === 1 ? '' : 's'} matched across ${rules} linked rule${rules === 1 ? '' : 's'}.`);
    } catch (err) {
      console.error('[SpellListManager] Rebuild failed:', err);
      toast.error('Rebuild failed.');
    } finally {
      setRebuildPending(false);
    }
  };

  function toggleFromArray<T extends string>(
    value: T,
    list: T[],
    set: React.Dispatch<React.SetStateAction<T[]>>,
  ) {
    set(list.includes(value) ? list.filter(v => v !== value) : [...list, value]);
  }

  if (!isAdmin) {
    return <div className="text-center py-20 text-ink/70">Access Denied. Admins only.</div>;
  }

  return (
    // Fullscreen layout — toolbar rows shrink to natural height,
    // working-area grid (list | detail) fills the remaining viewport.
    // Mirrors /compendium/spells and /compendium/spells/manage.
    <div className="h-full flex flex-col gap-2 p-2">
      {/* Consolidated top toolbar: Back link + class picker + summary.
          Replaces the old gradient-header card so the page chrome
          shrinks from ~200px to a single ~48px row. */}
      <div className="shrink-0 flex items-center gap-3 bg-card p-2 rounded-lg border border-gold/10 shadow-sm flex-wrap">
        <Link to="/compendium/classes">
          <Button variant="ghost" size="sm" className="h-8 text-gold gap-2 hover:bg-gold/5">
            <ChevronLeft className="w-4 h-4" />
            Back
          </Button>
        </Link>
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-gold/70 shrink-0">Class</span>
        <select
          value={selectedClassId}
          onChange={(e) => setSelectedClassId(e.target.value)}
          className="h-8 rounded-md border border-gold/20 bg-background/40 px-2 py-1 text-sm text-ink focus:border-gold/50 focus:outline-none"
          disabled={loading}
        >
          <option value="">— Select a class —</option>
          {classes.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        {selectedClass ? (
          <div className="text-xs text-ink/60 flex items-center gap-2 min-w-0">
            <span className="text-gold font-bold tabular-nums">{inListCount}</span>
            <span className="shrink-0">spell{inListCount === 1 ? '' : 's'} on {selectedClass.name}'s list</span>
            {inListCount > 0 ? (
              <span className="text-ink/40 truncate">
                ({Object.entries(inListByLevel).sort(([a], [b]) => Number(a) - Number(b)).map(([lvl, n]) => `${lvl === '0' ? 'C' : `L${lvl}`}:${n}`).join(' · ')})
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Linked-rules strip — only when a class is selected. The
          panel itself already has an internal collapse/expand for
          the rule list, so it shrinks naturally when not in use. */}
      {selectedClassId ? (
        <div className="shrink-0">
          <LinkedRulesPanel
            linkedRules={linkedRules}
            rebuildPending={rebuildPending}
            ruleMatchCounts={ruleMatchCounts}
            totalLinkedRuleMatches={totalLinkedRuleMatches}
            expanded={linkedRulesExpanded}
            onToggleExpanded={() => setLinkedRulesExpanded(v => !v)}
            onUnlink={handleUnlinkRule}
            onOpenLinkPicker={() => setLinkRuleDialogOpen(true)}
            onRebuild={handleOpenRebuildPreview}
            lastRebuildAt={lastRebuildAt}
            staleRuleIds={staleRuleIds}
          />
        </div>
      ) : null}

      {/* FilterBar + extras row. The toggle buttons + count live in
          the trailingActions slot so everything stays on one line. */}
      <div className="shrink-0 space-y-2">
          <FilterBar
              search={search}
              setSearch={setSearch}
              isFilterOpen={filterOpen}
              setIsFilterOpen={setFilterOpen}
              activeFilterCount={activeFilterCount}
              resetFilters={resetFilters}
              searchPlaceholder="Search spells by name or tag..."
              filterTitle="Spell Filters"
              renderFilters={
                <>
                  <AxisFilterSection
                    title="Source"
                    values={sources.map(s => ({ value: s.id, label: String(s.abbreviation || s.shortName || s.name || s.id) }))}
                    states={axisFilters.source?.states || {}}
                    cycleState={(v) => cycleAxisState('source', v)}
                    combineMode={axisFilters.source?.combineMode}
                    cycleCombineMode={() => cycleAxisCombineMode('source')}
                    exclusionMode={axisFilters.source?.exclusionMode}
                    cycleExclusionMode={() => cycleAxisExclusionMode('source')}
                    includeAll={() => axisIncludeAll('source', sources.map(s => s.id))}
                    excludeAll={() => axisExcludeAll('source', sources.map(s => s.id))}
                    clearAll={() => axisClear('source')}
                  />
                  <AxisFilterSection
                    title="Spell Level"
                    values={LEVEL_VALUES.map(lvl => ({ value: lvl, label: lvl === '0' ? 'Cantrip' : `Level ${lvl}` }))}
                    states={axisFilters.level?.states || {}}
                    cycleState={(v) => cycleAxisState('level', v)}
                    combineMode={axisFilters.level?.combineMode}
                    cycleCombineMode={() => cycleAxisCombineMode('level')}
                    exclusionMode={axisFilters.level?.exclusionMode}
                    cycleExclusionMode={() => cycleAxisExclusionMode('level')}
                    includeAll={() => axisIncludeAll('level', LEVEL_VALUES)}
                    excludeAll={() => axisExcludeAll('level', LEVEL_VALUES)}
                    clearAll={() => axisClear('level')}
                  />
                  <AxisFilterSection
                    title="Spell School"
                    values={Object.entries(SCHOOL_LABELS).map(([k, label]) => ({ value: k, label }))}
                    states={axisFilters.school?.states || {}}
                    cycleState={(v) => cycleAxisState('school', v)}
                    combineMode={axisFilters.school?.combineMode}
                    cycleCombineMode={() => cycleAxisCombineMode('school')}
                    exclusionMode={axisFilters.school?.exclusionMode}
                    cycleExclusionMode={() => cycleAxisExclusionMode('school')}
                    includeAll={() => axisIncludeAll('school', Object.keys(SCHOOL_LABELS))}
                    excludeAll={() => axisExcludeAll('school', Object.keys(SCHOOL_LABELS))}
                    clearAll={() => axisClear('school')}
                  />
                  <AxisFilterSection
                    title="Casting Time"
                    values={ACTIVATION_ORDER.map(b => ({ value: b, label: ACTIVATION_LABELS[b] }))}
                    states={axisFilters.activation?.states || {}}
                    cycleState={(v) => cycleAxisState('activation', v)}
                    combineMode={axisFilters.activation?.combineMode}
                    cycleCombineMode={() => cycleAxisCombineMode('activation')}
                    exclusionMode={axisFilters.activation?.exclusionMode}
                    cycleExclusionMode={() => cycleAxisExclusionMode('activation')}
                    includeAll={() => axisIncludeAll('activation', ACTIVATION_ORDER as readonly string[])}
                    excludeAll={() => axisExcludeAll('activation', ACTIVATION_ORDER as readonly string[])}
                    clearAll={() => axisClear('activation')}
                  />
                  <AxisFilterSection
                    title="Range"
                    values={RANGE_ORDER.map(b => ({ value: b, label: RANGE_LABELS[b] }))}
                    states={axisFilters.range?.states || {}}
                    cycleState={(v) => cycleAxisState('range', v)}
                    combineMode={axisFilters.range?.combineMode}
                    cycleCombineMode={() => cycleAxisCombineMode('range')}
                    exclusionMode={axisFilters.range?.exclusionMode}
                    cycleExclusionMode={() => cycleAxisExclusionMode('range')}
                    includeAll={() => axisIncludeAll('range', RANGE_ORDER as readonly string[])}
                    excludeAll={() => axisExcludeAll('range', RANGE_ORDER as readonly string[])}
                    clearAll={() => axisClear('range')}
                  />
                  <AxisFilterSection
                    title="Shape"
                    values={SHAPE_ORDER.map(b => ({ value: b, label: SHAPE_LABELS[b] }))}
                    states={axisFilters.shape?.states || {}}
                    cycleState={(v) => cycleAxisState('shape', v)}
                    combineMode={axisFilters.shape?.combineMode}
                    cycleCombineMode={() => cycleAxisCombineMode('shape')}
                    exclusionMode={axisFilters.shape?.exclusionMode}
                    cycleExclusionMode={() => cycleAxisExclusionMode('shape')}
                    includeAll={() => axisIncludeAll('shape', SHAPE_ORDER as readonly string[])}
                    excludeAll={() => axisExcludeAll('shape', SHAPE_ORDER as readonly string[])}
                    clearAll={() => axisClear('shape')}
                  />
                  <AxisFilterSection
                    title="Duration"
                    values={DURATION_ORDER.map(b => ({ value: b, label: DURATION_LABELS[b] }))}
                    states={axisFilters.duration?.states || {}}
                    cycleState={(v) => cycleAxisState('duration', v)}
                    combineMode={axisFilters.duration?.combineMode}
                    cycleCombineMode={() => cycleAxisCombineMode('duration')}
                    exclusionMode={axisFilters.duration?.exclusionMode}
                    cycleExclusionMode={() => cycleAxisExclusionMode('duration')}
                    includeAll={() => axisIncludeAll('duration', DURATION_ORDER as readonly string[])}
                    excludeAll={() => axisExcludeAll('duration', DURATION_ORDER as readonly string[])}
                    clearAll={() => axisClear('duration')}
                  />
                  <AxisFilterSection
                    title="Properties"
                    values={PROPERTY_ORDER.map(p => ({ value: p, label: PROPERTY_LABELS[p] }))}
                    states={axisFilters.property?.states || {}}
                    cycleState={(v) => cycleAxisState('property', v)}
                    combineMode={axisFilters.property?.combineMode}
                    cycleCombineMode={() => cycleAxisCombineMode('property')}
                    exclusionMode={axisFilters.property?.exclusionMode}
                    cycleExclusionMode={() => cycleAxisExclusionMode('property')}
                    includeAll={() => axisIncludeAll('property', PROPERTY_ORDER as readonly string[])}
                    excludeAll={() => axisExcludeAll('property', PROPERTY_ORDER as readonly string[])}
                    clearAll={() => axisClear('property')}
                  />

                  {/* Tag-group rich filter — Advanced Options disclosure
                      to keep the modal scannable; expands to per-group
                      AND/OR/XOR + Exclusion Logic chips. */}
                  <details className="group">
                    <summary className="cursor-pointer list-none flex items-center justify-between border border-gold/15 rounded-md px-4 py-2 hover:border-gold/30 transition-colors">
                      <span className="text-xs font-bold uppercase tracking-[0.2em] text-gold/80">
                        Advanced Options — Tags
                        {Object.keys(tagStates).length > 0 && (
                          <span className="ml-2 text-gold/60">({Object.keys(tagStates).length} selected)</span>
                        )}
                      </span>
                      <span className="text-[10px] text-ink/40 group-open:rotate-90 transition-transform">▶</span>
                    </summary>
                    <div className="mt-4 space-y-6 pl-1">
                      {tagGroups.map(group => (
                        <TagGroupFilter
                          key={group.id}
                          group={group}
                          tags={(tagsByGroup[group.id] || []) as any}
                          tagStates={tagStates}
                          setTagStates={setTagStates}
                          cycleTagState={cycleTagState}
                          combineMode={groupCombineModes[group.id]}
                          cycleGroupMode={cycleGroupMode}
                          exclusionMode={groupExclusionModes[group.id]}
                          cycleExclusionMode={cycleExclusionMode}
                        />
                      ))}
                    </div>
                  </details>
                </>
              }
              trailingActions={
                <>
                  <div
                    className="text-[11px] font-mono tabular-nums text-ink/55 whitespace-nowrap px-1"
                    title={`${filteredSpells.length} of ${spells.length} total`}
                  >
                    {loading ? '— / —' : `${filteredSpells.length} / ${spells.length}`}
                  </div>
                  <Button
                    type="button"
                    variant={showOnlyInList ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setShowOnlyInList(v => !v)}
                    className={cn(
                      'h-8 border-gold/20 text-[10px] uppercase tracking-[0.18em] shrink-0',
                      showOnlyInList ? 'bg-gold/15 text-gold hover:bg-gold/20' : 'text-ink/70 hover:bg-gold/5'
                    )}
                    disabled={!selectedClassId}
                    title={selectedClassId ? "Toggle list to show only spells already on this class's list" : 'Pick a class first'}
                  >
                    On list
                  </Button>
                  <Button
                    type="button"
                    variant={showOrphansOnly ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setShowOrphansOnly(v => !v)}
                    className={cn(
                      'h-8 border-gold/20 text-[10px] uppercase tracking-[0.18em] shrink-0',
                      showOrphansOnly ? 'bg-blood/15 text-blood hover:bg-blood/20' : 'text-ink/70 hover:bg-gold/5'
                    )}
                    title="Spells not on any class's spell list"
                  >
                    Orphans
                  </Button>
                </>
              }
            />

        {(activeFilterCount > 0 || showOnlyInList || showOrphansOnly || search.trim()) ? (
          <ActiveFilterChips
            search={search}
            onClearSearch={() => setSearch('')}
            showOnlyInList={showOnlyInList}
            onClearShowOnlyInList={() => setShowOnlyInList(false)}
            showOrphansOnly={showOrphansOnly}
            onClearShowOrphansOnly={() => setShowOrphansOnly(false)}
            // Derive include-only arrays from the rich state for the
            // active-chip strip. (Exclude chips live in the filter
            // modal but don't appear up here — we can revisit if the
            // strip needs to express the full 3-state semantic later.)
            sourceFilterIds={Object.entries(axisFilters.source?.states ?? {}).filter(([, s]) => s === 1).map(([id]) => id)}
            onRemoveSource={id => cycleAxisStateRemove('source', id)}
            sourceById={sourceById}
            levelFilters={Object.entries(axisFilters.level?.states ?? {}).filter(([, s]) => s === 1).map(([id]) => id)}
            onRemoveLevel={lvl => cycleAxisStateRemove('level', lvl)}
            schoolFilters={Object.entries(axisFilters.school?.states ?? {}).filter(([, s]) => s === 1).map(([id]) => id)}
            onRemoveSchool={k => cycleAxisStateRemove('school', k)}
            tagFilterIds={Object.entries(tagStates).filter(([, s]) => s === 1).map(([id]) => id)}
            onRemoveTag={id => setTagStates(prev => { const next = { ...prev }; delete next[id]; return next; })}
            tagsById={tagsById}
            activationFilters={Object.entries(axisFilters.activation?.states ?? {}).filter(([, s]) => s === 1).map(([id]) => id) as ActivationBucket[]}
            onRemoveActivation={b => cycleAxisStateRemove('activation', b as string)}
            rangeFilters={Object.entries(axisFilters.range?.states ?? {}).filter(([, s]) => s === 1).map(([id]) => id) as RangeBucket[]}
            onRemoveRange={b => cycleAxisStateRemove('range', b as string)}
            durationFilters={Object.entries(axisFilters.duration?.states ?? {}).filter(([, s]) => s === 1).map(([id]) => id) as DurationBucket[]}
            onRemoveDuration={b => cycleAxisStateRemove('duration', b as string)}
            propertyFilters={Object.entries(axisFilters.property?.states ?? {}).filter(([, s]) => s === 1).map(([id]) => id) as PropertyFilter[]}
            onRemoveProperty={p => cycleAxisStateRemove('property', p as string)}
            onResetAll={() => { resetFilters(); setShowOnlyInList(false); setShowOrphansOnly(false); setSearch(''); }}
          />
        ) : null}

        {selectedSpellIds.size > 0 ? (
          <div className="border border-gold/30 bg-gold/[0.06] rounded px-3 py-2 flex items-center gap-3 flex-wrap">
            <span className="text-xs text-gold font-bold">
              {selectedSpellIds.size} selected
              {visibleSelectedCount < selectedSpellIds.size ? (
                <span className="ml-1 text-gold/50 font-normal">({visibleSelectedCount} visible)</span>
              ) : null}
            </span>
            <div className="flex-1" />
            <Button
              type="button"
              size="sm"
              onClick={handleBulkAdd}
              disabled={!selectedClassId || bulkAddableIds.length === 0 || bulkPending}
              className="h-7 px-3 text-[10px] uppercase tracking-[0.18em] bg-gold/15 text-gold border border-gold/30 hover:bg-gold/25"
            >
              <Plus className="w-3 h-3 mr-1" />Add Selected ({bulkAddableIds.length})
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleBulkRemove}
              disabled={!selectedClassId || bulkRemovableIds.length === 0 || bulkPending}
              className="h-7 px-3 text-[10px] uppercase tracking-[0.18em] border-gold/30 text-ink/70 hover:bg-blood/10 hover:text-blood hover:border-blood/40"
            >
              Remove Selected ({bulkRemovableIds.length})
            </Button>
            <button
              type="button"
              onClick={clearSelection}
              className="text-[10px] uppercase tracking-widest text-ink/45 hover:text-gold"
            >
              Clear
            </button>
          </div>
        ) : null}
      </div>

      {/* Working area — list (flex-1) | detail panel (420px). The
          list pane scrolls internally via VirtualizedList; the
          detail card scrolls via overflow-y-auto. Outer flex-1
          min-h-0 lets the grid claim the viewport's leftover
          vertical space without forcing the page to scroll. */}
      <div className="flex-1 min-h-0 grid gap-2 lg:grid-cols-[minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card
          className="border-gold/20 bg-card/50 overflow-hidden"
          style={{ height: `${paneHeight}px` }}
        >
          <CardContent className="p-0 h-full flex flex-col">
            {!selectedClassId ? (
              <div className="px-8 py-20 text-center text-ink/45">
                Pick a class to begin curating its spell list.
              </div>
            ) : loading || classListLoading ? (
              <div className="px-8 py-20 text-center text-ink/45">Loading...</div>
            ) : filteredSpells.length === 0 ? (
              <div className="px-8 py-20 text-center text-ink/45">No spells match the current filters.</div>
            ) : (
              <>
                {/* Header strip — column labels above the rows. Same
                    grid template the rows use so labels line up with
                    cell content. */}
                <div className="grid grid-cols-[32px_28px_minmax(0,1fr)_40px_64px_56px_88px] gap-2 border-b border-gold/10 bg-background/35 px-3 py-2.5 text-[10px] font-bold uppercase tracking-[0.18em] text-gold/70 shrink-0">
                  <div className="flex items-center justify-center">
                    <SelectionBox
                      state={allVisibleSelected ? 'checked' : someVisibleSelected ? 'mixed' : 'unchecked'}
                      onToggle={toggleAllVisible}
                      ariaLabel="Select all visible spells"
                    />
                  </div>
                  <span></span>
                  <span>Name</span>
                  <span className="text-center">Lv</span>
                  <span className="text-center">School</span>
                  <span className="text-center">Src</span>
                  <span className="text-right">Action</span>
                </div>
                <VirtualizedList
                  items={filteredSpells}
                  height={Math.max(200, paneHeight - LIST_HEADER_PX)}
                  itemHeight={ROW_HEIGHT}
                  className="custom-scrollbar overflow-y-auto"
                  innerClassName="divide-y divide-gold/5"
                  renderItem={(entry) => {
                    const { spell, matchedTagNames } = entry;
                    const onList = classListIds.has(spell.id);
                    const isPending = pendingSpellIds.has(spell.id);
                    const isSelected = selectedSpellIds.has(spell.id);
                    const isPreviewing = previewSpellId === spell.id;
                    const sourceRecord = sourceById[spell.source_id || ''];
                    const sourceLabel = sourceRecord?.abbreviation || sourceRecord?.shortName || '—';
                    const otherClasses = (spellMembershipsBySpellId.get(spell.id) || [])
                      .filter(c => c.id !== selectedClassId);
                    const query = search.trim();
                    // Compose the row's title attribute so the dropped
                    // "Also on / via tag" sub-line still surfaces on
                    // hover. Keeps the row scannable while preserving
                    // the diagnostic data curators relied on.
                    const reqTagIds = Array.isArray((spell as any).required_tags)
                      ? (spell as any).required_tags as string[]
                      : [];
                    const hasFreeText = !!(spell as any).prerequisite_text;
                    const tooltipParts: string[] = [];
                    if (otherClasses.length > 0) {
                      tooltipParts.push(`Also on: ${otherClasses.map(c => c.name).join(', ')}`);
                    }
                    if (matchedTagNames.length > 0) {
                      tooltipParts.push(`Via tag: ${matchedTagNames.join(', ')}`);
                    }
                    if (reqTagIds.length > 0) {
                      tooltipParts.push(`Requires: ${reqTagIds.map(tid => tagsById[tid]?.name || tid).join(', ')}`);
                    }
                    if (hasFreeText) {
                      tooltipParts.push(`Note: ${(spell as any).prerequisite_text}`);
                    }
                    const rowTitle = tooltipParts.join('  ·  ') || spell.name;
                    return (
                      <div
                        key={spell.id}
                        onClick={() => setPreviewSpellId(spell.id)}
                        title={rowTitle}
                        className={cn(
                          'grid w-full grid-cols-[32px_28px_minmax(0,1fr)_40px_64px_56px_88px] gap-2 items-center px-3 transition-colors cursor-pointer border-b border-gold/5',
                          onList ? 'bg-gold/[0.04]' : '',
                          isSelected ? 'ring-1 ring-inset ring-gold/30' : '',
                          isPreviewing ? 'bg-gold/15' : 'hover:bg-gold/[0.06]',
                        )}
                        style={{ height: ROW_HEIGHT }}
                      >
                        <div className="flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
                          <SelectionBox
                            state={isSelected ? 'checked' : 'unchecked'}
                            onToggle={() => toggleSelected(spell.id)}
                            ariaLabel={`Select ${spell.name}`}
                          />
                        </div>
                        <div className="flex items-center justify-center">
                          {onList ? (
                            <Check className="w-4 h-4 text-emerald-500" aria-label="On list" />
                          ) : (
                            <span className="w-3 h-3 rounded-full border border-gold/20" aria-hidden />
                          )}
                        </div>
                        <div className="min-w-0 flex items-center gap-1.5">
                          <span className="truncate font-serif text-sm text-ink">
                            <HighlightedText text={spell.name} query={query} />
                          </span>
                          {(reqTagIds.length > 0 || hasFreeText) && (
                            <Lock className="w-3 h-3 text-blood/70 shrink-0" aria-label="Has prerequisites" />
                          )}
                          {(otherClasses.length > 0 || matchedTagNames.length > 0) && (
                            <span
                              className="text-[9px] text-ink/35 truncate ml-1"
                              aria-hidden
                            >
                              {otherClasses.length > 0 ? `+${otherClasses.length}` : ''}
                              {otherClasses.length > 0 && matchedTagNames.length > 0 ? ' · ' : ''}
                              {matchedTagNames.length > 0 ? 'tag' : ''}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-ink/75 text-center">
                          {spell.level === 0 ? 'C' : spell.level}
                        </div>
                        <div className="text-xs text-ink/75 text-center truncate" title={SCHOOL_LABELS[spell.school] || ''}>
                          {(() => {
                            const full = SCHOOL_LABELS[spell.school] || spell.school?.toUpperCase() || '—';
                            return full.length > 6 ? full.slice(0, 4) + '.' : full;
                          })()}
                        </div>
                        <div className="text-[10px] font-bold text-gold/80 text-center truncate">{sourceLabel}</div>
                        <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
                          <Button
                            type="button"
                            variant={onList ? 'outline' : 'default'}
                            size="sm"
                            onClick={() => handleToggleSpell(spell.id)}
                            disabled={isPending}
                            className={cn(
                              'h-7 px-2 text-[10px] uppercase tracking-[0.16em]',
                              onList
                                ? 'border-gold/30 text-ink/70 hover:bg-blood/10 hover:text-blood hover:border-blood/40'
                                : 'bg-gold/15 text-gold border border-gold/30 hover:bg-gold/25',
                            )}
                          >
                            {isPending ? '…' : onList ? 'Remove' : <><Plus className="w-3 h-3 mr-0.5" />Add</>}
                          </Button>
                        </div>
                      </div>
                    );
                  }}
                />
              </>
            )}
          </CardContent>
        </Card>

        {/* Detail card — fixed height so its content area scrolls
            internally regardless of which spell is selected. */}
        <Card
          className="border-gold/20 bg-card/50 overflow-hidden hidden xl:block"
          style={{ height: `${paneHeight}px` }}
        >
          <CardContent
            className="p-0 overflow-y-auto custom-scrollbar h-full"
            style={{ maxHeight: `${paneHeight}px` }}
          >
            <SpellDetailPanel
              spellId={previewSpellId}
              emptyMessage="Click a spell to preview its details here."
            />
          </CardContent>
        </Card>
      </div>

      {/* Pre-rebuild preview — show toAdd / toRemove counts before mutating. */}
      <Dialog
        open={rebuildPreview !== null}
        onOpenChange={(open) => { if (!open) setRebuildPreview(null); }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rebuild from {linkedRules.length} linked rule{linkedRules.length === 1 ? '' : 's'}?</DialogTitle>
            <DialogDescription>
              Manual entries on the class are untouched. Only rule-driven rows change.
            </DialogDescription>
          </DialogHeader>
          {rebuildPreview ? (
            <div className="space-y-2 py-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-emerald-500/80 font-bold uppercase tracking-widest text-[10px]">Will add</span>
                <span className="text-ink"><span className="text-emerald-400 font-bold">{rebuildPreview.toAdd.length}</span> spell{rebuildPreview.toAdd.length === 1 ? '' : 's'}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-blood/80 font-bold uppercase tracking-widest text-[10px]">Will remove</span>
                <span className="text-ink"><span className="text-blood font-bold">{rebuildPreview.toRemove.length}</span> spell{rebuildPreview.toRemove.length === 1 ? '' : 's'}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-ink/40 font-bold uppercase tracking-widest text-[10px]">Will stay</span>
                <span className="text-ink/60">{rebuildPreview.staying.length} spell{rebuildPreview.staying.length === 1 ? '' : 's'}</span>
              </div>
              {rebuildPreview.toAdd.length === 0 && rebuildPreview.toRemove.length === 0 ? (
                <p className="text-[10px] text-ink/40 italic pt-1">No changes. Rebuild is a no-op (the timestamp will still update).</p>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRebuildPreview(null)}
              className="border-gold/20 text-ink/70 hover:bg-gold/5"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleConfirmRebuild}
              disabled={rebuildPending}
              className="bg-gold/15 text-gold border border-gold/30 hover:bg-gold/25"
            >
              Confirm Rebuild
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Link Rule picker — pick from the global rule catalogue to attach to this class. */}
      <Dialog open={linkRuleDialogOpen} onOpenChange={setLinkRuleDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Link a rule to this class</DialogTitle>
            <DialogDescription>
              Pick a rule from the catalogue. Linking it adds it to the rebuild — matching spells will be
              added to {selectedClass?.name || 'this class'}'s list on the next Rebuild.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-72 overflow-y-auto custom-scrollbar divide-y divide-gold/10 -mx-4">
            {allRules.length === 0 ? (
              <p className="px-4 py-3 text-sm text-ink/45 italic">
                No rules in the catalogue yet. Visit <Link to="/compendium/spell-rules" className="text-gold hover:underline">Spell Rules</Link> to create one.
              </p>
            ) : (
              allRules.map(rule => {
                const alreadyLinked = linkedRules.some(r => r.id === rule.id);
                return (
                  <button
                    key={rule.id}
                    type="button"
                    disabled={alreadyLinked}
                    onClick={async () => {
                      await handleLinkRule(rule);
                      setLinkRuleDialogOpen(false);
                    }}
                    className={cn(
                      'w-full text-left px-4 py-2 text-sm flex items-center justify-between gap-2',
                      alreadyLinked ? 'text-ink/30 cursor-not-allowed' : 'text-ink hover:bg-gold/10',
                    )}
                  >
                    <div className="min-w-0">
                      <div className="font-bold truncate">{rule.name}</div>
                      <div className="text-[10px] text-ink/50 truncate">{summarizeRuleManualAndQuery(rule)}</div>
                    </div>
                    {alreadyLinked ? <span className="text-[10px] uppercase text-gold/50 shrink-0">linked</span> : null}
                  </button>
                );
              })
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setLinkRuleDialogOpen(false)}
              className="border-gold/20 text-ink/70 hover:bg-gold/5"
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SelectionBox({
  state,
  onToggle,
  ariaLabel,
}: {
  state: 'checked' | 'unchecked' | 'mixed';
  onToggle: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={ariaLabel}
      aria-checked={state === 'checked' ? true : state === 'mixed' ? 'mixed' : false}
      role="checkbox"
      className={cn(
        'w-4 h-4 rounded-[3px] border flex items-center justify-center transition-colors',
        state === 'unchecked'
          ? 'border-gold/30 hover:border-gold/60 bg-transparent'
          : 'border-gold bg-gold'
      )}
    >
      {state === 'checked' ? <Check className="w-3 h-3 text-black" /> : null}
      {state === 'mixed' ? <span className="w-2 h-0.5 bg-black rounded" /> : null}
    </button>
  );
}

/** Compact relative-time formatter — "just now" / "4m ago" / "2h ago" / "3d ago" / fallback to date. */
function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffSec = Math.floor((Date.now() - then) / 1000);
  if (diffSec < 30) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString();
}

function summarizeRuleManualAndQuery(rule: SpellRule): string {
  const q = rule.query;
  const parts: string[] = [];
  if (rule.manualSpells.length) parts.push(`${rule.manualSpells.length} manual`);
  if (q.sourceFilterIds?.length) parts.push(`${q.sourceFilterIds.length} source${q.sourceFilterIds.length === 1 ? '' : 's'}`);
  if (q.levelFilters?.length) parts.push(`${q.levelFilters.length} level${q.levelFilters.length === 1 ? '' : 's'}`);
  if (q.schoolFilters?.length) parts.push(`${q.schoolFilters.length} school${q.schoolFilters.length === 1 ? '' : 's'}`);
  if (q.tagFilterIds?.length) parts.push(`${q.tagFilterIds.length} tag${q.tagFilterIds.length === 1 ? '' : 's'}`);
  if (q.activationFilters?.length) parts.push(`${q.activationFilters.length} casting`);
  if (q.rangeFilters?.length) parts.push(`${q.rangeFilters.length} range`);
  if (q.durationFilters?.length) parts.push(`${q.durationFilters.length} duration`);
  if (q.propertyFilters?.length) parts.push(q.propertyFilters.join(' + '));
  return parts.join(' · ') || '(empty)';
}

function LinkedRulesPanel({
  linkedRules,
  rebuildPending,
  ruleMatchCounts,
  totalLinkedRuleMatches,
  expanded,
  onToggleExpanded,
  onUnlink,
  onOpenLinkPicker,
  onRebuild,
  lastRebuildAt,
  staleRuleIds,
}: {
  linkedRules: SpellRule[];
  rebuildPending: boolean;
  ruleMatchCounts: Record<string, { matches: number; onList: number }>;
  totalLinkedRuleMatches: number;
  expanded: boolean;
  onToggleExpanded: () => void;
  onUnlink: (rule: SpellRule) => void;
  onOpenLinkPicker: () => void;
  onRebuild: () => void;
  lastRebuildAt: string | null;
  staleRuleIds: Set<string>;
}) {
  const ChevronIcon = expanded ? ChevronDown : ChevronRight;
  const lastRebuildLabel = lastRebuildAt ? formatRelativeTime(lastRebuildAt) : null;
  // Aggregate stale-state summary. Drives the amber Rebuild-CTA
  // banner that appears when at least one linked rule is stale.
  const staleCount = staleRuleIds.size;
  const isStale = staleCount > 0;

  // Collapsed: one-line summary
  if (!expanded) {
    return (
      <div className="bg-background border border-gold/20 rounded-md px-4 py-2.5 flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={onToggleExpanded}
          className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-gold hover:text-gold/80"
        >
          <ChevronIcon className="w-4 h-4" /> Linked Rules
        </button>
        <span className="text-[11px] text-ink/50">
          {linkedRules.length === 0 ? (
            <span className="italic">no rules linked</span>
          ) : (
            <>
              <span className="text-ink/80 font-bold">{linkedRules.length}</span> rule{linkedRules.length === 1 ? '' : 's'}
              <span className="mx-2 text-ink/20">·</span>
              <span className="text-ink/80 font-bold">{totalLinkedRuleMatches}</span> spell{totalLinkedRuleMatches === 1 ? '' : 's'} matched
              {lastRebuildLabel ? (
                <>
                  <span className="mx-2 text-ink/20">·</span>
                  <span className="text-ink/60">last rebuilt {lastRebuildLabel}</span>
                </>
              ) : null}
              {isStale ? (
                <>
                  <span className="mx-2 text-amber-400/40">·</span>
                  <span
                    className="text-amber-400 font-bold uppercase tracking-widest text-[10px]"
                    title={`${staleCount} of ${linkedRules.length} rule${linkedRules.length === 1 ? '' : 's'} edited since last rebuild — click Rebuild to refresh.`}
                  >
                    Stale ({staleCount})
                  </span>
                </>
              ) : null}
            </>
          )}
        </span>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onOpenLinkPicker}
            className="h-7 px-3 text-[10px] uppercase tracking-[0.18em] border-gold/30 text-gold hover:bg-gold/10"
          >
            <Plus className="w-3 h-3 mr-1" /> Link Rule
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onRebuild}
            disabled={linkedRules.length === 0 || rebuildPending}
            className="h-7 px-3 text-[10px] uppercase tracking-[0.18em] bg-gold/15 text-gold border border-gold/30 hover:bg-gold/25"
          >
            {rebuildPending ? 'Rebuilding…' : 'Rebuild'}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-background border border-gold/20 rounded-md p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onToggleExpanded}
            className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-gold hover:text-gold/80"
          >
            <ChevronIcon className="w-4 h-4" />
            Linked Rules
            <span className="text-[10px] text-ink/40 font-normal normal-case tracking-normal">
              {linkedRules.length === 0 ? '— none linked' : `(${linkedRules.length})`}
            </span>
          </button>
          <Link
            to="/compendium/spell-rules"
            className="text-[10px] uppercase tracking-widest text-ink/45 hover:text-gold"
            title="Author / edit rules on the Spell Rules page"
          >
            Manage Rules →
          </Link>
        </div>
        <div className="flex items-center gap-3">
          {lastRebuildLabel ? (
            <span className="text-[10px] uppercase tracking-widest text-ink/40">last rebuilt {lastRebuildLabel}</span>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onOpenLinkPicker}
            className="h-7 px-3 text-[10px] uppercase tracking-[0.18em] border-gold/30 text-gold hover:bg-gold/10"
          >
            <Plus className="w-3 h-3 mr-1" /> Link Rule
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onRebuild}
            disabled={linkedRules.length === 0 || rebuildPending}
            className="h-7 px-3 text-[10px] uppercase tracking-[0.18em] bg-gold/15 text-gold border border-gold/30 hover:bg-gold/25"
            title={linkedRules.length === 0 ? 'Link at least one rule first' : 'Re-run linked rules and replace rule-driven entries'}
          >
            {rebuildPending ? 'Rebuilding…' : 'Rebuild from Rules'}
          </Button>
        </div>
      </div>

      {linkedRules.length === 0 ? (
        <p className="text-xs text-ink/45 italic">
          No rules linked to this class. Click <strong>Link Rule</strong> to attach a rule from the catalogue,
          or visit the <Link to="/compendium/spell-rules" className="text-gold hover:underline">Spell Rules</Link> page to author one first.
        </p>
      ) : (
        <>
          {/* Stale banner — appears when at least one linked rule
              has been edited since the class was last rebuilt
              (or the class has never been rebuilt). The Rebuild
              button up in the header is the CTA; this just
              surfaces the state so admins notice. */}
          {isStale ? (
            <div className="flex items-center gap-3 rounded-md border border-amber-400/40 bg-amber-400/[0.06] px-3 py-2">
              <span className="text-[10px] uppercase tracking-widest text-amber-400 font-bold">
                {lastRebuildAt ? 'Stale' : 'Never rebuilt'}
              </span>
              <span className="text-xs text-ink/70">
                {lastRebuildAt
                  ? `${staleCount} of ${linkedRules.length} rule${linkedRules.length === 1 ? '' : 's'} edited since last rebuild.`
                  : `This class has ${linkedRules.length} rule${linkedRules.length === 1 ? '' : 's'} linked but no rebuild has been run yet — class spell list is empty.`}
              </span>
              <div className="flex-1" />
              <Button
                type="button"
                size="sm"
                onClick={onRebuild}
                disabled={rebuildPending}
                className="h-7 px-3 text-[10px] uppercase tracking-[0.18em] bg-amber-400/15 text-amber-400 border border-amber-400/40 hover:bg-amber-400/25"
              >
                {rebuildPending ? 'Rebuilding…' : 'Rebuild now'}
              </Button>
            </div>
          ) : null}
          <div className="space-y-1">
            {linkedRules.map(rule => {
              const counts = ruleMatchCounts[rule.id] || { matches: 0, onList: 0 };
              const ruleStale = staleRuleIds.has(rule.id);
              return (
                <div
                  key={rule.id}
                  className="flex items-center gap-3 px-3 py-2 rounded border border-gold/15 hover:border-gold/30 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 flex-wrap">
                      <Link
                        to={`/compendium/spell-rules?rule=${rule.id}`}
                        className="text-sm text-ink font-bold truncate max-w-[18rem] hover:text-gold"
                      >
                        {rule.name}
                      </Link>
                      {ruleStale ? (
                        <span
                          className="inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] uppercase tracking-widest text-amber-400 font-bold"
                          title={lastRebuildAt
                            ? `This rule was edited after the last rebuild (${lastRebuildAt}). Rebuild to apply the latest matches.`
                            : 'This class has never been rebuilt with rules.'}
                        >
                          Stale
                        </span>
                      ) : null}
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest',
                          counts.matches === 0
                            ? 'border-blood/30 bg-blood/5 text-blood/60'
                            : 'border-gold/25 bg-gold/5 text-gold/80',
                        )}
                        title={counts.matches === 0 ? 'No spells match this rule yet' : `${counts.matches} matches · ${counts.onList} on this class's list`}
                      >
                        {counts.matches === 0 ? '0 matches' : <>Matches <span className="text-gold font-bold mx-1">{counts.matches}</span> · <span className="text-ink/60 mx-1">{counts.onList}</span> on list</>}
                      </span>
                    </div>
                    <div className="text-[10px] text-ink/50 truncate mt-0.5">{summarizeRuleManualAndQuery(rule)}</div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => onUnlink(rule)}
                      className="h-7 px-2 text-[10px] uppercase tracking-[0.18em] border-gold/20 text-ink/40 hover:bg-blood/10 hover:text-blood hover:border-blood/40"
                    >
                      Unlink
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const idx = lower.indexOf(q);
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <span className="text-gold font-bold">{text.slice(idx, idx + q.length)}</span>
      {text.slice(idx + q.length)}
    </>
  );
}

function safeTagIds(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}


function FilterSection({
  title,
  values,
  selected,
  onToggle,
  onIncludeAll,
  onClear,
}: {
  title: string;
  values: { value: string; label: string }[];
  selected: string[];
  onToggle: (value: string) => void;
  onIncludeAll: () => void;
  onClear: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="h3-title uppercase text-ink">{title}</span>
        <div className="flex items-center gap-3">
          <button type="button" onClick={onIncludeAll} className="label-text hover:underline">Include All</button>
          <span className="text-gold/20">|</span>
          <button type="button" onClick={onClear} className="label-text hover:underline">Clear</button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {values.map(({ value, label }) => {
          const active = selected.includes(value);
          return (
            <button
              key={value}
              type="button"
              onClick={() => onToggle(value)}
              className={cn(
                'rounded border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide transition-colors',
                active
                  ? 'border-gold/60 bg-gold/15 text-gold'
                  : 'border-gold/15 text-ink/55 hover:border-gold/30 hover:text-gold/80'
              )}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function FilterChip({ label, onRemove }: { label: React.ReactNode; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-gold/30 bg-gold/10 pl-2 pr-1 py-0.5 text-[10px] uppercase tracking-widest text-gold">
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove filter"
        className="rounded-full hover:bg-gold/20 p-0.5"
      >
        <X className="w-3 h-3" />
      </button>
    </span>
  );
}

function ActiveFilterChips({
  search,
  onClearSearch,
  showOnlyInList,
  onClearShowOnlyInList,
  showOrphansOnly,
  onClearShowOrphansOnly,
  sourceFilterIds,
  onRemoveSource,
  sourceById,
  levelFilters,
  onRemoveLevel,
  schoolFilters,
  onRemoveSchool,
  tagFilterIds,
  onRemoveTag,
  tagsById,
  activationFilters,
  onRemoveActivation,
  rangeFilters,
  onRemoveRange,
  durationFilters,
  onRemoveDuration,
  propertyFilters,
  onRemoveProperty,
  onResetAll,
}: {
  search: string;
  onClearSearch: () => void;
  showOnlyInList: boolean;
  onClearShowOnlyInList: () => void;
  showOrphansOnly: boolean;
  onClearShowOrphansOnly: () => void;
  sourceFilterIds: string[];
  onRemoveSource: (id: string) => void;
  sourceById: Record<string, SourceRow>;
  levelFilters: string[];
  onRemoveLevel: (lvl: string) => void;
  schoolFilters: string[];
  onRemoveSchool: (k: string) => void;
  tagFilterIds: string[];
  onRemoveTag: (id: string) => void;
  tagsById: Record<string, TagRow>;
  activationFilters: ActivationBucket[];
  onRemoveActivation: (b: ActivationBucket) => void;
  rangeFilters: RangeBucket[];
  onRemoveRange: (b: RangeBucket) => void;
  durationFilters: DurationBucket[];
  onRemoveDuration: (b: DurationBucket) => void;
  propertyFilters: PropertyFilter[];
  onRemoveProperty: (p: PropertyFilter) => void;
  onResetAll: () => void;
}) {
  const trimmed = search.trim();
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {trimmed ? (
        <FilterChip label={<span>Search: "{trimmed}"</span>} onRemove={onClearSearch} />
      ) : null}
      {showOnlyInList ? (
        <FilterChip label="On list only" onRemove={onClearShowOnlyInList} />
      ) : null}
      {showOrphansOnly ? (
        <FilterChip label="Orphans only" onRemove={onClearShowOrphansOnly} />
      ) : null}
      {sourceFilterIds.map(id => {
        const s = sourceById[id];
        const label = s?.abbreviation || s?.shortName || s?.name || id;
        return <FilterChip key={`src-${id}`} label={`Source: ${label}`} onRemove={() => onRemoveSource(id)} />;
      })}
      {levelFilters.slice().sort((a, b) => Number(a) - Number(b)).map(lvl => (
        <FilterChip key={`lvl-${lvl}`} label={lvl === '0' ? 'Cantrip' : `Level ${lvl}`} onRemove={() => onRemoveLevel(lvl)} />
      ))}
      {schoolFilters.map(k => (
        <FilterChip key={`sch-${k}`} label={SCHOOL_LABELS[k] || k} onRemove={() => onRemoveSchool(k)} />
      ))}
      {tagFilterIds.map(id => {
        const t = tagsById[id];
        return <FilterChip key={`tag-${id}`} label={`Tag: ${t?.name || id}`} onRemove={() => onRemoveTag(id)} />;
      })}
      {activationFilters.map(b => (
        <FilterChip key={`act-${b}`} label={`Cast: ${ACTIVATION_LABELS[b]}`} onRemove={() => onRemoveActivation(b)} />
      ))}
      {rangeFilters.map(b => (
        <FilterChip key={`rng-${b}`} label={`Range: ${RANGE_LABELS[b]}`} onRemove={() => onRemoveRange(b)} />
      ))}
      {durationFilters.map(b => (
        <FilterChip key={`dur-${b}`} label={`Dur: ${DURATION_LABELS[b]}`} onRemove={() => onRemoveDuration(b)} />
      ))}
      {propertyFilters.map(p => (
        <FilterChip key={`prop-${p}`} label={PROPERTY_LABELS[p]} onRemove={() => onRemoveProperty(p)} />
      ))}
      <button
        type="button"
        onClick={onResetAll}
        className="ml-1 text-[10px] uppercase tracking-widest text-ink/45 hover:text-gold"
      >
        Reset all
      </button>
    </div>
  );
}
