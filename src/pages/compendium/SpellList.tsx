import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronDown, Star, X } from 'lucide-react';
import { useSpellFavorites } from '../../lib/spellFavorites';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';
import { expandTagsWithAncestors, normalizeTagRow } from '../../lib/tagHierarchy';
import { fetchCollection, fetchDocument } from '../../lib/d1';
import { auth } from '../../lib/firebase';
import { fetchClassSpellIds } from '../../lib/classSpellLists';
import { SCHOOL_LABELS, formatActivationLabel, formatRangeLabel } from '../../lib/spellImport';
import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { matchesTagFilters } from '../../components/compendium/FilterBar';
import { SectionFilterPanel, type FilterSection } from '../../components/compendium/SectionFilterPanel';
import {
  CompendiumBrowserShell,
  type CompendiumColumn,
} from '../../components/compendium/CompendiumBrowserShell';
import { useAxisFilters } from '../../hooks/useAxisFilters';
import SpellDetailPanel from '../../components/compendium/SpellDetailPanel';
import BackButton from '../../components/ui/BackButton';
import { fetchSpellSummaries, type SpellSummaryRecord } from '../../lib/spellSummary';
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
} from '../../lib/spellFilters';

/**
 * Public spell browser. Thin wrapper around `CompendiumBrowserShell`,
 * mirroring FeatList / ItemList. Spell-specific bits live here:
 *
 *   - **Per-character favorites scope**: passed to the shell as a
 *     custom `favoritesScopePicker` slot. The dropdown lets the user
 *     pin spells under their account ("Universal Favorite") OR under
 *     a specific character — the scope drives both reads + writes via
 *     useSpellFavorites.
 *   - **`?class=<id>` URL scope**: loads the class's master spell list
 *     on mount and filters rows by it. Surfaces a removable chip in
 *     trailingActions + a Back button to the class view in
 *     leadingActions.
 *   - **`?focus=<id>` deep-link**: BBCode `[ref|spell|<id>]` references
 *     resolve here and seed the selection on mount.
 *   - **Tag-aware filters**: SpellList is the only browser today that
 *     uses tag-group axes (per-classification tag chips). The shell's
 *     `renderFilters` slot takes the custom SectionFilterPanel wired
 *     with tag-state plumbing — base axes + tag groups in one panel.
 *   - **Sortable columns**: Name / Lv / Time / School / C. / Range /
 *     Src — every column header toggles asc/desc on click. Shell
 *     provides the chevron UI; the per-column comparator lives here.
 */

type SourceRecord = {
  id: string;
  name?: string;
  abbreviation?: string;
  shortName?: string;
  [key: string]: any;
};

type TagGroupRecord = {
  id: string;
  name?: string;
  classifications?: string[];
  [key: string]: any;
};

type TagRecord = {
  id: string;
  name?: string;
  groupId?: string;
  [key: string]: any;
};

type SpellRecord = SpellSummaryRecord & {
  sourceId?: string;
  identifier?: string;
  imageUrl?: string;
  tagIds?: string[];
  foundryShell?: any;
  [key: string]: any;
};

// ─── Constants ────────────────────────────────────────────────

const LEVEL_OPTIONS = [
  { value: '0', label: 'Cantrip' },
  ...Array.from({ length: 9 }, (_, i) => ({ value: String(i + 1), label: `Lvl ${i + 1}` })),
];

const SCHOOL_OPTIONS = [
  { value: 'abj', label: 'Abjuration' },
  { value: 'con', label: 'Conjuration' },
  { value: 'div', label: 'Divination' },
  { value: 'enc', label: 'Enchantment' },
  { value: 'evo', label: 'Evocation' },
  { value: 'ill', label: 'Illusion' },
  { value: 'nec', label: 'Necromancy' },
  { value: 'trs', label: 'Transmutation' },
];

type SpellColumnKey = 'name' | 'level' | 'time' | 'school' | 'concentration' | 'range' | 'source';
type SortDir = 'asc' | 'desc';

// Axis keys declared so `useAxisFilters` knows what to tally for the
// `activeFilterCount` badge. Tag-state plumbing stays inline (the
// hook is axis-only) and adds to the count below.
const AXIS_KEYS = ['source', 'level', 'school', 'activation', 'range', 'duration', 'shape', 'property'] as const;

export default function SpellList({ userProfile }: { userProfile: any }) {
  // ─── Favorites + scope ──────────────────────────────────────
  // Per-character scope lets a player keep separate starred sets for
  // each character. The dropdown picker (rendered into the shell's
  // `favoritesScopePicker` slot below) controls which set the hook
  // reads + writes.
  const [favoriteScope, setFavoriteScope] = useState<{ characterId: string; characterName: string } | null>(null);
  const [scopeOpen, setScopeOpen] = useState(false);
  const { favorites, isFavorite, toggleFavorite } = useSpellFavorites(
    userProfile?.id || null,
    favoriteScope ? { characterId: favoriteScope.characterId } : null,
  );

  // Load characters once when the user id resolves — populates the
  // scope picker. Failure renders the dropdown with just the
  // "Universal Favorite" option, which is fine.
  const [myCharacters, setMyCharacters] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => {
    if (!userProfile?.id) { setMyCharacters([]); return; }
    (async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        const res = await fetch('/api/me/characters?fields=id,name', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        const rows: any[] = Array.isArray(body?.characters) ? body.characters : [];
        setMyCharacters(rows.map((r) => ({ id: String(r.id), name: String(r.name || 'Unnamed') })));
      } catch (err) {
        console.warn('[SpellList] Failed to load characters for favorites scope:', err);
        setMyCharacters([]);
      }
    })();
  }, [userProfile?.id]);

  // ─── Data load ───────────────────────────────────────────────
  const [spells, setSpells] = useState<SpellRecord[]>([]);
  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [tagGroups, setTagGroups] = useState<TagGroupRecord[]>([]);
  const [allTags, setAllTags] = useState<TagRecord[]>([]);
  const [loadingSpells, setLoadingSpells] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedSpellId, setSelectedSpellId] = useState('');

  // ?focus=<id-or-identifier> deep-link from BBCode cross-references.
  // ?class=<id> scopes the browser to a class's master spell list.
  const [searchParams, setSearchParams] = useSearchParams();
  const focusParam = searchParams.get('focus') || '';
  const classParam = searchParams.get('class') || '';
  const [classFilter, setClassFilter] = useState<{
    classId: string;
    className: string;
    spellIds: Set<string>;
  } | null>(null);

  useEffect(() => {
    if (!classParam) { setClassFilter(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const [classRow, spellIds] = await Promise.all([
          fetchDocument<any>('classes', classParam),
          fetchClassSpellIds(classParam),
        ]);
        if (cancelled) return;
        const className = String(classRow?.name || classRow?.identifier || 'Class');
        setClassFilter({ classId: classParam, className, spellIds });
      } catch (err) {
        console.warn('[SpellList] Failed to resolve ?class= filter:', err);
        if (!cancelled) setClassFilter(null);
      }
    })();
    return () => { cancelled = true; };
  }, [classParam]);

  const clearClassFilter = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('class');
    setSearchParams(next, { replace: true });
    setClassFilter(null);
  };

  // ─── Axis filter state ──────────────────────────────────────
  // Shared hook covers the 8 axis cyclers + count + reset. Tag-state
  // plumbing stays inline because the hook is axis-only — spells are
  // the only browser using tag-group filtering today.
  const {
    axisFilters,
    setAxisFilters,
    cyclers,
    activeFilterCount: axisActiveCount,
    resetAll: resetAxesOnly,
  } = useAxisFilters(AXIS_KEYS);

  const [tagStates, setTagStates] = useState<Record<string, number>>({});
  const [groupCombineModes, setGroupCombineModes] = useState<Record<string, 'AND' | 'OR' | 'XOR'>>({});
  const [groupExclusionModes, setGroupExclusionModes] = useState<Record<string, 'AND' | 'OR' | 'XOR'>>({});

  // Tag-state cyclers (right-click reverse mirrors the axis pattern).
  const cycleTagState = useCallback((tagId: string) => {
    setTagStates((prev) => {
      const next = { ...prev };
      const s = next[tagId] || 0;
      if (s === 0) next[tagId] = 1;
      else if (s === 1) next[tagId] = 2;
      else delete next[tagId];
      return next;
    });
  }, []);
  const cycleTagStateReverse = useCallback((tagId: string) => {
    setTagStates((prev) => {
      const next = { ...prev };
      const s = next[tagId] || 0;
      if (s === 0) next[tagId] = 2;
      else if (s === 2) next[tagId] = 1;
      else delete next[tagId];
      return next;
    });
  }, []);
  const cycleGroupMode = useCallback((groupId: string) => {
    setGroupCombineModes((prev) => {
      const cur = prev[groupId] || 'OR';
      const next = cur === 'OR' ? 'AND' : cur === 'AND' ? 'XOR' : 'OR';
      return { ...prev, [groupId]: next };
    });
  }, []);
  const cycleGroupModeReverse = useCallback((groupId: string) => {
    setGroupCombineModes((prev) => {
      const cur = prev[groupId] || 'OR';
      const next = cur === 'OR' ? 'XOR' : cur === 'XOR' ? 'AND' : 'OR';
      return { ...prev, [groupId]: next };
    });
  }, []);
  const cycleExclusionMode = useCallback((groupId: string) => {
    setGroupExclusionModes((prev) => {
      const cur = prev[groupId] || 'OR';
      const next = cur === 'OR' ? 'AND' : cur === 'AND' ? 'XOR' : 'OR';
      return { ...prev, [groupId]: next };
    });
  }, []);
  const cycleExclusionModeReverse = useCallback((groupId: string) => {
    setGroupExclusionModes((prev) => {
      const cur = prev[groupId] || 'OR';
      const next = cur === 'OR' ? 'XOR' : cur === 'XOR' ? 'AND' : 'OR';
      return { ...prev, [groupId]: next };
    });
  }, []);

  // Per-axis Default button: Sources defaults to "all included"; every
  // other axis falls back to a plain clear (no meaningful default).
  const axisRestoreDefault = (axisKey: string) => {
    if (axisKey === 'source') {
      setAxisFilters((prev) => {
        const states: Record<string, number> = {};
        for (const s of sources) states[String(s.id)] = 1;
        return { ...prev, source: { ...(prev.source ?? {}), states } };
      });
    } else {
      cyclers.axisClear(axisKey);
    }
  };

  // ─── Data loading ────────────────────────────────────────────
  useEffect(() => {
    const loadSpells = async () => {
      setLoadingSpells(true);
      try {
        const records = await fetchSpellSummaries('name ASC');
        const mapped = records.map((row) => ({
          ...row,
          sourceId: row.source_id,
          imageUrl: row.image_url,
          tagIds: typeof row.tags === 'string' ? JSON.parse(row.tags) : (row.tags ?? []),
          foundryShell: {
            activation: {
              type: row.activation_type ?? '',
              value: row.activation_value ?? '',
              condition: row.activation_condition ?? '',
            },
            range: {
              units: row.range_units ?? '',
              value: row.range_value ?? '',
              special: row.range_special ?? '',
            },
            duration: {
              units: row.duration_units ?? '',
              value: row.duration_value ?? '',
            },
          },
          ...deriveSpellFilterFacets(row),
        }));
        setSpells(mapped);
        setLoadingSpells(false);
      } catch (err) {
        console.error('Error loading spells:', err);
        setLoadingSpells(false);
      }
    };

    const loadFoundation = async () => {
      try {
        const [sourcesData, tagGroupsData, tagsData] = await Promise.all([
          fetchCollection<any>('sources', { orderBy: 'name ASC' }),
          fetchCollection<any>('tagGroups', { where: "classifications LIKE '%spell%'" }),
          fetchCollection<any>('tags', { orderBy: 'name ASC' }),
        ]);
        setSources(sourcesData);
        // Onboarding hint — pre-include every source on first mount
        // so the modal opens with the "include" treatment lit across
        // all sources. Skipped when the user has already touched
        // sources (e.g. via a URL with custom state).
        setAxisFilters((prev) => {
          if (prev.source && Object.keys(prev.source.states ?? {}).length > 0) return prev;
          const states: Record<string, number> = {};
          for (const s of sourcesData) states[String(s.id)] = 1;
          return { ...prev, source: { ...(prev.source ?? {}), states } };
        });
        setTagGroups(tagGroupsData);
        setAllTags(tagsData.map((t: any) => ({ ...t, ...normalizeTagRow(t) })));
      } catch (err) {
        console.error('[SpellList] Error loading foundation data:', err);
      }
    };

    loadSpells();
    loadFoundation();
  }, [setAxisFilters]);

  const sourceById = useMemo(
    () => Object.fromEntries(sources.map((s) => [s.id, s])) as Record<string, SourceRecord>,
    [sources],
  );
  const tagsByGroup = useMemo(() => {
    const map: Record<string, TagRecord[]> = {};
    for (const tag of allTags) {
      if (!tag.groupId) continue;
      if (!map[tag.groupId]) map[tag.groupId] = [];
      map[tag.groupId].push(tag);
    }
    return map;
  }, [allTags]);
  const parentByTagId = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const tag of allTags) {
      map.set(tag.id, ((tag as any).parent_tag_id ?? (tag as any).parentTagId ?? null) as string | null);
    }
    return map;
  }, [allTags]);

  // ─── Filter pipeline ─────────────────────────────────────────
  const filteredSpells = useMemo(() => {
    return spells.filter((spell: any) => {
      const sourceRecord = sourceById[String(spell.sourceId ?? '')];
      const sourceAbbrev = String(
        sourceRecord?.abbreviation
        || sourceRecord?.shortName
        || spell.foundryShell?.source?.book
        || '',
      ).trim();
      const spellTagIds = Array.isArray(spell.tagIds) ? spell.tagIds : [];
      const matchesSearch = !search.trim()
        || String(spell.name ?? '').toLowerCase().includes(search.trim().toLowerCase())
        || sourceAbbrev.toLowerCase().includes(search.trim().toLowerCase())
        || String(spell.identifier ?? '').toLowerCase().includes(search.trim().toLowerCase());

      const effectiveTagIds = Array.from(expandTagsWithAncestors(spellTagIds, parentByTagId));
      const tagFilterMatches = matchesTagFilters(
        effectiveTagIds,
        tagGroups,
        tagsByGroup,
        tagStates,
        groupCombineModes,
        groupExclusionModes,
      );

      const propsHave = new Set<string>();
      if (spell.concentration) propsHave.add('concentration');
      if (spell.ritual) propsHave.add('ritual');
      if (spell.vocal) propsHave.add('vocal');
      if (spell.somatic) propsHave.add('somatic');
      if (spell.material) propsHave.add('material');

      if (classFilter && !classFilter.spellIds.has(spell.id)) return false;

      return matchesSearch
        && matchesSingleAxisFilter(String(spell.sourceId ?? ''), axisFilters.source)
        && matchesSingleAxisFilter(String(Number(spell.level ?? 0)), axisFilters.level)
        && matchesSingleAxisFilter(String(spell.school ?? ''), axisFilters.school)
        && tagFilterMatches
        && matchesSingleAxisFilter(spell.activationBucket, axisFilters.activation)
        && matchesSingleAxisFilter(spell.rangeBucket, axisFilters.range)
        && matchesSingleAxisFilter(spell.durationBucket, axisFilters.duration)
        && matchesSingleAxisFilter(spell.shapeBucket, axisFilters.shape)
        && matchesMultiAxisFilter(propsHave, axisFilters.property);
    });
  }, [spells, sourceById, search, axisFilters, tagStates, tagGroups, tagsByGroup, groupCombineModes, groupExclusionModes, parentByTagId, classFilter]);

  // ─── Sort ────────────────────────────────────────────────────
  // Default sort: name ascending. Sortable column headers in the shell
  // call our onSortChange — same-column toggles direction, new column
  // resets to asc.
  const [sortBy, setSortBy] = useState<SpellColumnKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const handleSort = (key: string) => {
    const col = key as SpellColumnKey;
    if (sortBy === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(col);
      setSortDir('asc');
    }
  };

  const renderSourceAbbreviation = (spell: SpellRecord) => {
    const sourceRecord = sourceById[String(spell.sourceId ?? '')];
    return sourceRecord?.abbreviation
      || sourceRecord?.shortName
      || (spell as any).foundryShell?.source?.book
      || '—';
  };

  const sortedSpells = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    const getKey = (spell: any): { primary: number | string; secondary: string } => {
      const name = String(spell?.name ?? '');
      const secondary = name.toLowerCase();
      switch (sortBy) {
        case 'name': return { primary: secondary, secondary };
        case 'level': return { primary: Number(spell?.level ?? 0), secondary };
        case 'time': {
          const label = formatActivationLabel(spell?.foundryShell?.activation);
          return { primary: String(label).toLowerCase(), secondary };
        }
        case 'school': return { primary: String(SCHOOL_LABELS[spell?.school ?? ''] ?? spell?.school ?? '').toLowerCase(), secondary };
        case 'concentration': return { primary: spell?.concentration ? 1 : 0, secondary };
        case 'range': {
          // Numeric distance when available (so "30 ft" < "120 ft"),
          // self/touch grouped to sentinel values at one end.
          const r = spell?.foundryShell?.range;
          const units = String(r?.units ?? '').toLowerCase();
          const value = Number(r?.value ?? NaN);
          if (units === 'self') return { primary: -3, secondary };
          if (units === 'touch') return { primary: -2, secondary };
          if (Number.isFinite(value)) {
            const fac = units === 'mi' ? 5280 : units === 'km' ? 3280 : units === 'm' ? 3.28 : 1;
            return { primary: value * fac, secondary };
          }
          return { primary: Number.MAX_SAFE_INTEGER, secondary };
        }
        case 'source': return { primary: renderSourceAbbreviation(spell as any).toLowerCase(), secondary };
        default: return { primary: secondary, secondary };
      }
    };
    return [...filteredSpells].sort((a, b) => {
      const ka = getKey(a);
      const kb = getKey(b);
      if (typeof ka.primary === 'number' && typeof kb.primary === 'number') {
        const d = (ka.primary - kb.primary) * dir;
        if (d !== 0) return d;
      } else {
        const pa = String(ka.primary);
        const pb = String(kb.primary);
        const d = pa.localeCompare(pb) * dir;
        if (d !== 0) return d;
      }
      return ka.secondary.localeCompare(kb.secondary);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredSpells, sortBy, sortDir]);

  // Drop the selection if the active filters hide the selected spell.
  useEffect(() => {
    if (!selectedSpellId) return;
    if (!filteredSpells.some((spell) => spell.id === selectedSpellId)) {
      setSelectedSpellId('');
    }
  }, [filteredSpells, selectedSpellId]);

  // Resolve ?focus=<id-or-identifier> once spells have loaded.
  useEffect(() => {
    if (!focusParam || loadingSpells) return;
    const target = spells.find((s) => s.identifier === focusParam || s.id === focusParam);
    if (target) setSelectedSpellId(target.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusParam, loadingSpells, spells]);

  // Total active filter count = axes + tag states (across all groups).
  const activeFilterCount = axisActiveCount + Object.keys(tagStates).length;

  const resetFilters = () => {
    // Re-applies the "all sources included" onboarding hint so the
    // user lands in the same state they saw on first open.
    const sourceStates: Record<string, number> = {};
    for (const s of sources) sourceStates[String(s.id)] = 1;
    setAxisFilters({ source: { states: sourceStates } });
    setTagStates({});
    setGroupCombineModes({});
    setGroupExclusionModes({});
    setSearch('');
    // Reset axis modes too (combine/exclusion). useAxisFilters' resetAll
    // does that for us via the same setter — call it but immediately
    // re-seed the sources after.
    resetAxesOnly();
    setAxisFilters({ source: { states: sourceStates } });
  };

  // ─── Filter axes (base + tag groups) ─────────────────────────
  const miniPillAxes = useMemo<FilterSection[]>(() => {
    const axes: FilterSection[] = [
      {
        key: 'source', name: 'Sources', kind: 'axis',
        hasDefault: true,
        values: sources.map((s) => ({
          value: s.id,
          label: String(s.abbreviation || s.shortName || s.name || s.id),
          labelAlt: String(s.name || s.shortName || s.abbreviation || s.id),
        })),
      },
      {
        key: 'level', name: 'Spell Level', kind: 'axis',
        values: LEVEL_OPTIONS.map((e) => ({ value: e.value, label: e.label })),
      },
      {
        key: 'school', name: 'School', kind: 'axis',
        values: SCHOOL_OPTIONS.map((e) => ({ value: e.value, label: e.label })),
      },
      {
        key: 'activation', name: 'Casting Time', kind: 'axis',
        values: ACTIVATION_ORDER.map((b) => ({ value: b, label: ACTIVATION_LABELS[b] })),
      },
      {
        key: 'range', name: 'Range', kind: 'axis',
        values: RANGE_ORDER.map((b) => ({ value: b, label: RANGE_LABELS[b] })),
      },
      {
        key: 'duration', name: 'Duration', kind: 'axis',
        values: DURATION_ORDER.map((b) => ({ value: b, label: DURATION_LABELS[b] })),
      },
      {
        key: 'shape', name: 'Shape', kind: 'axis',
        values: SHAPE_ORDER.map((b) => ({ value: b, label: SHAPE_LABELS[b] })),
      },
      {
        key: 'property', name: 'Properties', kind: 'axis',
        values: PROPERTY_ORDER.map((p) => ({ value: p, label: PROPERTY_LABELS[p] })),
      },
    ];
    for (const group of tagGroups) {
      const tags = (tagsByGroup[group.id] || []) as Array<{
        id: string;
        name?: string;
        parent_tag_id?: string | null;
        parentTagId?: string | null;
      }>;
      if (tags.length === 0) continue;
      axes.push({
        key: `tag-group:${group.id}`,
        name: String((group as any).name ?? 'Tags'),
        kind: 'tag',
        groupId: group.id,
        values: tags.map((t) => {
          const parent = t.parent_tag_id ?? t.parentTagId ?? null;
          return {
            value: t.id,
            label: String(t.name ?? t.id),
            parentValue: parent && tags.some((s) => s.id === parent) ? parent : undefined,
          };
        }),
      });
    }
    return axes;
  }, [sources, tagGroups, tagsByGroup]);

  // ─── Column descriptors ─────────────────────────────────────
  const columns = useMemo<CompendiumColumn<SpellRecord>[]>(() => ([
    {
      key: 'name',
      label: 'Name',
      width: 'minmax(0,1fr)',
      alwaysVisible: true,
      align: 'start',
      sortable: true,
      render: (spell) => {
        // Mirror FeatList — only the favorite star renders here. The
        // prerequisite lock used to live alongside the name but it
        // was redundant with the detail-view prerequisite section
        // and overloaded the row. Keep the row visually quiet so
        // the table reads as a clean catalog.
        return (
          <div className="min-w-0 flex items-center gap-1.5">
            <span className="truncate font-serif text-sm text-ink">{spell.name}</span>
            {isFavorite(spell.id) && (
              <Star className="w-3 h-3 text-gold/70 fill-gold/40 shrink-0" aria-label="Favorite" />
            )}
          </div>
        );
      },
    },
    {
      key: 'level',
      label: 'Lv',
      width: '36px',
      sortable: true,
      render: (spell) => (
        <div className="text-xs text-ink/75 text-center">
          {Number(spell.level ?? 0) === 0 ? 'C' : spell.level}
        </div>
      ),
    },
    {
      key: 'time',
      label: 'Time',
      width: '80px',
      sortable: true,
      render: (spell) => {
        const label = formatActivationLabel((spell as any).foundryShell?.activation);
        return (
          <div className="text-xs text-ink/75 text-center truncate" title={label}>{label}</div>
        );
      },
    },
    {
      key: 'school',
      label: 'School',
      width: '60px',
      sortable: true,
      // Auto-hide below xl when favorites collapses and the list
      // shrinks to share the body slot with detail — name needs the
      // extra room so spell titles don't truncate to 3 letters.
      hideBelow: 'xl',
      render: (spell) => {
        const full = SCHOOL_LABELS[String(spell.school ?? '')];
        const abbrev = !full
          ? (String(spell.school ?? '').slice(0, 4).toUpperCase() || '—')
          : (full.length > 6 ? full.slice(0, 4) + '.' : full);
        return (
          <div className="text-xs text-ink/75 text-center truncate" title={full || ''}>
            {abbrev}
          </div>
        );
      },
    },
    {
      key: 'concentration',
      label: 'C.',
      width: '24px',
      sortable: true,
      render: (spell) => (
        <div className="text-xs text-blood/70 text-center" title="Concentration">
          {(spell as any).concentration ? '◆' : ''}
        </div>
      ),
    },
    {
      key: 'range',
      label: 'Range',
      width: '80px',
      sortable: true,
      render: (spell) => {
        const label = formatRangeLabel((spell as any).foundryShell?.range);
        return (
          <div className="text-xs text-ink/75 text-center truncate" title={label}>{label}</div>
        );
      },
    },
    {
      key: 'source',
      label: 'Src',
      width: '60px',
      sortable: true,
      // Auto-hide below xl — same reasoning as School: reclaim room
      // for the name column when the list pane narrows.
      hideBelow: 'xl',
      render: (spell) => (
        <div className="text-xs font-bold text-gold/80 text-center truncate">
          {renderSourceAbbreviation(spell)}
        </div>
      ),
    },
  ]), [isFavorite, allTags, sourceById]);

  // ─── Favorites pane row render ──────────────────────────────
  const favoritesRowRender = ({ row: spell, selected, toggleStar, onSelect }: { row: SpellRecord; selected: boolean; toggleStar: () => void; onSelect: () => void }) => {
    const sourceLabel = renderSourceAbbreviation(spell);
    return (
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          'flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors',
          selected ? 'bg-gold/10' : 'hover:bg-gold/5',
        )}
      >
        <div className="min-w-0">
          <div className="truncate font-serif text-sm text-ink">{spell.name}</div>
          <div className="text-[10px] text-ink/45 uppercase tracking-wider">
            {Number(spell.level ?? 0) === 0 ? 'Cantrip' : `Lv ${spell.level}`}
            {' · '}
            {SCHOOL_LABELS[String(spell.school ?? '')] || String(spell.school ?? '').toUpperCase()}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] font-bold text-gold/70">{sourceLabel}</span>
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); toggleStar(); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                toggleStar();
              }
            }}
            className="text-gold/70 hover:text-blood transition-colors cursor-pointer"
            title="Remove from favorites"
            aria-label="Remove from favorites"
          >
            <Star className="w-3 h-3 fill-current" />
          </span>
        </div>
      </button>
    );
  };

  // ─── Favorites scope picker ─────────────────────────────────
  // Drop-in replacement for the shell's default "Favorites · N" header.
  // Lets the user pick Universal vs per-character scope; the
  // useSpellFavorites hook re-reads whenever the scope changes.
  const favoritesScopePicker = (
    <div className="flex flex-col gap-2 border-b border-gold/10 bg-background/35 px-3 py-2.5 shrink-0">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Star className="w-3.5 h-3.5 text-gold/80 fill-gold/40" />
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gold/70">Favorites</span>
        </div>
        <span className="text-[10px] text-ink/45">{favorites.size}</span>
      </div>
      <Popover open={scopeOpen} onOpenChange={setScopeOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="w-full flex items-center justify-between gap-2 px-2 py-1 rounded border border-gold/15 bg-card/60 hover:border-gold/30 hover:bg-gold/[0.06] transition-colors text-[11px] text-ink/85"
            aria-label="Select favorites scope"
          >
            <span className="truncate">
              {favoriteScope ? favoriteScope.characterName : 'Universal Favorite'}
            </span>
            <ChevronDown className="w-3 h-3 text-ink/45 shrink-0" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-1">
          <button
            type="button"
            onClick={() => { setFavoriteScope(null); setScopeOpen(false); }}
            className={cn(
              'w-full text-left px-2 py-1.5 rounded text-xs hover:bg-gold/5 transition-colors',
              !favoriteScope ? 'bg-gold/10 text-gold font-bold' : 'text-ink/85',
            )}
          >
            Universal Favorite
          </button>
          {myCharacters.length === 0 ? (
            <div className="px-2 py-1.5 text-[11px] text-ink/45 italic border-t border-gold/10 mt-1">
              You have no saved characters.
            </div>
          ) : (
            <>
              <div className="text-[9px] font-bold uppercase tracking-widest text-ink/45 px-2 pt-2 pb-1 border-t border-gold/10 mt-1">
                Characters
              </div>
              {myCharacters.map((c) => {
                const active = favoriteScope?.characterId === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => { setFavoriteScope({ characterId: c.id, characterName: c.name }); setScopeOpen(false); }}
                    className={cn(
                      'w-full text-left px-2 py-1.5 rounded text-xs hover:bg-gold/5 transition-colors truncate',
                      active ? 'bg-gold/10 text-gold font-bold' : 'text-ink/85',
                    )}
                    title={c.name}
                  >
                    {c.name}
                  </button>
                );
              })}
            </>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );

  // ─── Custom filter panel (tag-aware) ─────────────────────────
  // SpellList is the only browser with tag-group plumbing today, so
  // it overrides the shell's default panel. Same axes + cyclers, plus
  // the tag cyclers + group modes.
  const renderFilters = (
    <SectionFilterPanel
      axes={miniPillAxes}
      axisFilters={axisFilters}
      tagStates={tagStates}
      cycleAxisState={cyclers.cycleAxisState}
      cycleAxisStateReverse={cyclers.cycleAxisStateReverse}
      cycleTagState={cycleTagState}
      cycleTagStateReverse={cycleTagStateReverse}
      cycleAxisCombineMode={cyclers.cycleAxisCombineMode}
      cycleAxisCombineModeReverse={cyclers.cycleAxisCombineModeReverse}
      cycleAxisExclusionMode={cyclers.cycleAxisExclusionMode}
      cycleAxisExclusionModeReverse={cyclers.cycleAxisExclusionModeReverse}
      axisIncludeAll={cyclers.axisIncludeAll}
      axisExcludeAll={cyclers.axisExcludeAll}
      axisClear={cyclers.axisClear}
      axisRestoreDefault={axisRestoreDefault}
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
      resetAll={resetFilters}
      embedded
    />
  );

  return (
    <CompendiumBrowserShell<SpellRecord>
      rows={sortedSpells}
      allRows={spells}
      loading={loadingSpells}
      getRowId={(spell) => spell.id}
      selectedId={selectedSpellId}
      onSelect={setSelectedSpellId}

      search={search}
      onSearchChange={setSearch}
      searchPlaceholder="Search spell name, source, or identifier"

      filterAxes={miniPillAxes}
      axisFilters={axisFilters}
      cyclers={cyclers}
      activeFilterCount={activeFilterCount}
      onResetFilters={resetFilters}
      renderFilters={renderFilters}

      columns={columns}
      columnsLocalStorageKey="dauligor.spellList.hiddenColumns"

      sortBy={sortBy}
      sortDir={sortDir}
      onSortChange={handleSort}

      favorites={favorites}
      onToggleFavorite={toggleFavorite}
      favoritesRowRender={favoritesRowRender}
      favoritesScopePicker={favoritesScopePicker}
      favoritesEmptyMessage="Star a spell to pin it here."

      detailPanel={
        <SpellDetailPanel
          spellId={selectedSpellId || null}
          isFavorite={selectedSpellId ? isFavorite(selectedSpellId) : false}
          onToggleFavorite={toggleFavorite}
        />
      }

      leadingActions={
        classFilter ? (
          <BackButton
            to={`/compendium/classes/view/${classFilter.classId}`}
            label={`Back to ${classFilter.className}`}
            title={`Return to the ${classFilter.className} class page`}
          />
        ) : null
      }

      trailingActions={
        <>
          {classFilter ? (
            <button
              type="button"
              onClick={clearClassFilter}
              className="inline-flex items-center gap-1 h-8 px-2 rounded-md border border-gold/40 bg-gold/10 text-gold text-[11px] font-bold uppercase tracking-widest hover:bg-blood/10 hover:border-blood/40 hover:text-blood transition-colors"
              title={`Scoped to ${classFilter.className}'s spell list (${classFilter.spellIds.size} spells). Click to clear.`}
            >
              Class: {classFilter.className}
              <X className="w-3 h-3" />
            </button>
          ) : null}
          {userProfile?.role === 'admin' ? (
            <Link to="/compendium/spells/manage">
              <Button type="button" variant="outline" size="sm" className="h-8 border-gold/20 text-gold hover:bg-gold/5">
                Spell Manager
              </Button>
            </Link>
          ) : null}
        </>
      }
    />
  );
}
