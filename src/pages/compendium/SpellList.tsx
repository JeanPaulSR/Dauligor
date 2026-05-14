import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Lock, Star, ChevronUp, ChevronDown, Settings } from 'lucide-react';
import { useSpellFavorites } from '../../lib/spellFavorites';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';
import { expandTagsWithAncestors, normalizeTagRow } from '../../lib/tagHierarchy';
import { fetchCollection, queryD1 } from '../../lib/d1';
import { SCHOOL_LABELS, formatActivationLabel, formatRangeLabel } from '../../lib/spellImport';
import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { FilterBar, TagGroupFilter, AxisFilterSection, matchesTagFilters } from '../../components/compendium/FilterBar';
import SpellDetailPanel from '../../components/compendium/SpellDetailPanel';
import VirtualizedList from '../../components/ui/VirtualizedList';
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
  type ActivationBucket,
  type DurationBucket,
  type PropertyFilter,
  type RangeBucket,
  type ShapeBucket,
} from '../../lib/spellFilters';

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

type SpellRecord = {
  id: string;
  name?: string;
  level?: number;
  school?: string;
  sourceId?: string;
  description?: string;
  imageUrl?: string;
  tagIds?: string[];
  foundryImport?: Record<string, any>;
  foundryShell?: Record<string, any>;
  foundryDocument?: Record<string, any>;
  [key: string]: any;
};

// Rough height of the sort-button header strip above the virtualized
// list. Used to compute the inner virtualized-list height so the
// entire list card stays within the viewport-derived `paneHeight`
// (see the component below). Slight overestimate is fine — it just
// leaves a thin gap above the bottom of the card.
const LIST_HEADER_PX = 40;
// SPELL_ROW_HEIGHT was 78 when each row showed Name/Level/School/Source
// as a tall flex-y card. The denser 7-column layout (Name/Lv/Time/School/
// C./Range/Src) uses 48px per row — see VirtualizedList itemHeight in the
// list render below.

const LEVEL_OPTIONS = [
  { value: 'all', label: 'All Levels' },
  { value: '0', label: 'Cantrips' },
  ...Array.from({ length: 9 }, (_, index) => ({ value: String(index + 1), label: `Level ${index + 1}` }))
];

const SCHOOL_OPTIONS = [
  { value: 'all', label: 'All Schools' },
  ...Object.entries(SCHOOL_LABELS).map(([value, label]) => ({ value, label }))
];

// ---------------------------------------------------------------------------
// Spell list columns — sortable + user-hideable. Name is always visible (it's
// the row identifier); every other column can be toggled off via the
// Columns popover. Widths are CSS values (e.g. "minmax(0,1fr)", "64px").
// Each column knows how to extract its sort value from a spell row.
//
// Persisted to localStorage so a user's column preferences survive across
// sessions on the same browser (no D1 sync needed — it's a UI preference).
// ---------------------------------------------------------------------------
type SpellColumnKey = 'name' | 'level' | 'time' | 'school' | 'concentration' | 'range' | 'source';
type SortDir = 'asc' | 'desc';

const COL_WIDTHS: Record<SpellColumnKey, string> = {
  name: 'minmax(0,1fr)',
  level: '36px',
  time: '80px',
  school: '60px',
  concentration: '24px',
  range: '80px',
  source: '60px',
};

// Outer-grid sizing policy. After several iterations the settled
// behavior is:
//   - List pane: FIXED width at 520px. Doesn't grow when the viewport
//     widens, doesn't shrink when columns are hidden. This keeps the
//     description as the primary "stretch target" — wider screens
//     give more room to the description, never to the list.
//   - When the user hides a column, the freed width inside the list
//     pane goes to the NAME column (which is `minmax(0,1fr)` in the
//     internal grid). So column-hiding is the mechanism for "show
//     longer spell names" — the description is unaffected.
//   - Description: 1fr with a 360px floor so body text stays legible
//     (under ~320px it wraps every 4-5 words and feels cramped).
// The 520px width reproduces the "original good size" the user
// validated — see the screenshot in commit 0e5a2a8.
// Values are inlined as literals in the xl:grid-cols-[...] class
// below (Tailwind can't read variables at build time).
//
// Pane heights are no longer a fixed compile-time constant — they're
// derived from window.innerHeight on mount + resize, so the grid
// fills the viewport exactly (see `paneHeight` in the component).

const COL_LABELS: Record<SpellColumnKey, string> = {
  name: 'Name',
  level: 'Lv',
  time: 'Time',
  school: 'School',
  concentration: 'C.',
  range: 'Range',
  source: 'Src',
};

const ALL_COLUMNS: SpellColumnKey[] = ['name', 'level', 'time', 'school', 'concentration', 'range', 'source'];
const ALWAYS_VISIBLE: ReadonlySet<SpellColumnKey> = new Set<SpellColumnKey>(['name']);

const HIDDEN_COLS_LS_KEY = 'dauligor.spellList.hiddenColumns';
function readHiddenColumns(): Set<SpellColumnKey> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(HIDDEN_COLS_LS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is SpellColumnKey => typeof v === 'string' && ALL_COLUMNS.includes(v as SpellColumnKey)));
  } catch {
    return new Set();
  }
}
function writeHiddenColumns(hidden: Set<SpellColumnKey>) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(HIDDEN_COLS_LS_KEY, JSON.stringify(Array.from(hidden)));
  } catch {
    /* quota full or disabled */
  }
}

export default function SpellList({ userProfile }: { userProfile: any }) {
  // Spell favorites — local-first with optional cloud sync. Two
  // scopes:
  //   - Universal Favorite (default): one set per logged-in user,
  //     synced to D1 via /api/spell-favorites so it follows the
  //     player across devices.
  //   - Per-character: when the favorites-pane scope dropdown picks
  //     a character, favorites live under a character-specific key
  //     in localStorage (no cloud sync yet).
  // The scope state drives which set the toggle writes to AND which
  // set the star indicators in the spell list rows read from.
  const [favoriteScope, setFavoriteScope] = useState<{ characterId: string; characterName: string } | null>(null);
  // Controlled state for the favorites-scope dropdown so option
  // clicks dismiss it (Base UI's Popover doesn't close on inner
  // clicks by default — only on outside click or Escape).
  const [scopeOpen, setScopeOpen] = useState(false);
  const { favorites, isFavorite, toggleFavorite } = useSpellFavorites(
    userProfile?.id || null,
    favoriteScope ? { characterId: favoriteScope.characterId } : null,
  );

  // User's characters — populates the favorites-scope dropdown.
  // Loaded once when the user id resolves; staff don't get a special
  // case here (they pick from their OWN characters like everyone
  // else). Falls back to an empty list on any load error so the
  // dropdown still renders with just the "Universal Favorite"
  // option.
  const [myCharacters, setMyCharacters] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => {
    if (!userProfile?.id) {
      setMyCharacters([]);
      return;
    }
    (async () => {
      try {
        const rows = await queryD1<any>(
          'SELECT id, name FROM characters WHERE user_id = ? ORDER BY updated_at DESC',
          [userProfile.id],
        );
        setMyCharacters(rows.map((r: any) => ({ id: String(r.id), name: String(r.name || 'Unnamed') })));
      } catch (err) {
        console.warn('[SpellList] Failed to load characters for favorites scope:', err);
        setMyCharacters([]);
      }
    })();
  }, [userProfile?.id]);

  // Fullscreen-page opt-in. Adds a body class on mount (and removes on
  // unmount) that triggers the CSS overrides in src/index.css —
  // hiding the global footer, stripping <main>'s container padding,
  // and locking body scroll to the viewport. The page-level scroll
  // wheel goes away; each pane inside the spell-list grid handles its
  // own overflow.
  useEffect(() => {
    document.body.classList.add('spell-list-fullscreen');
    return () => document.body.classList.remove('spell-list-fullscreen');
  }, []);

  // Viewport-derived height for the three panes (favorites, list,
  // detail). Tracks window.innerHeight so the spell grid always fills
  // exactly "viewport minus the bits above it" (navbar at the top of
  // the right-hand column, FilterBar row, and a tiny vertical gap).
  // Magic constants are conservative — slight underestimate is fine
  // (leaves a few px of margin), overestimate would cause a page
  // scroll wheel (the thing we explicitly removed).
  const [paneHeight, setPaneHeight] = useState<number>(() =>
    typeof window === 'undefined' ? 720 : Math.max(420, window.innerHeight - 140),
  );
  useEffect(() => {
    const onResize = () => {
      // Layout chrome above the grid: navbar (~56px) + filter row
      // (~56px) + the page's own vertical spacing (~28px) ≈ 140px.
      setPaneHeight(Math.max(420, window.innerHeight - 140));
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  // Inner VirtualizedList height — leave room for the sort-button
  // header strip above the rows.
  const listInnerHeight = Math.max(200, paneHeight - LIST_HEADER_PX);

  // Sortable / hideable column state. Default sort is alphabetical by
  // name, ascending. Hidden columns persist to localStorage.
  const [sortBy, setSortBy] = useState<SpellColumnKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [hiddenColumns, setHiddenColumns] = useState<Set<SpellColumnKey>>(() => readHiddenColumns());
  const visibleColumns = useMemo(
    () => ALL_COLUMNS.filter(c => !hiddenColumns.has(c)),
    [hiddenColumns],
  );
  const gridTemplate = useMemo(
    () => visibleColumns.map(c => COL_WIDTHS[c]).join(' '),
    [visibleColumns],
  );
  const toggleColumn = (col: SpellColumnKey) => {
    if (ALWAYS_VISIBLE.has(col)) return;
    setHiddenColumns(prev => {
      const next = new Set(prev);
      if (next.has(col)) next.delete(col);
      else next.add(col);
      writeHiddenColumns(next);
      return next;
    });
  };
  const handleSort = (col: SpellColumnKey) => {
    if (sortBy === col) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(col);
      setSortDir('asc');
    }
  };

  const [spells, setSpells] = useState<SpellSummaryRecord[]>([]);
  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [tagGroups, setTagGroups] = useState<TagGroupRecord[]>([]);
  const [allTags, setAllTags] = useState<TagRecord[]>([]);
  const [loadingSpells, setLoadingSpells] = useState(true);
  const [search, setSearch] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  // `?focus=<id>` deep-links to a specific spell — used by [ref|spell|<id>]
  // BBCode cross-references rendered elsewhere in the app. We read the
  // param once on mount and seed selection from it. Identifier-based
  // (slug) matching takes priority over raw ID; falls back to ID for
  // legacy/migration cases where the param is the row UUID.
  const [searchParams] = useSearchParams();
  const focusParam = searchParams.get('focus') || '';
  const [selectedSpellId, setSelectedSpellId] = useState('');
  // Live filter state — rich AxisFilter shape per axis (3-state chips
  // + per-axis include AND/OR/XOR + Exclusion Logic), uniform with the
  // SpellRulesEditor RuleQuery shape. One state object keyed by axis
  // name keeps the 8 useState calls cohesive and the updaters a one-
  // liner each.
  type AxisState = { states: Record<string, number>; combineMode?: 'AND' | 'OR' | 'XOR'; exclusionMode?: 'AND' | 'OR' | 'XOR' };
  const [axisFilters, setAxisFilters] = useState<Record<string, AxisState>>({});
  // Rich tag filter state. tagStates: 0=neutral, 1=include, 2=exclude.
  // `groupCombineModes` controls how multiple include chips within one
  // group combine (AND/OR/XOR). Same for `groupExclusionModes`.
  const [tagStates, setTagStates] = useState<Record<string, number>>({});
  const [groupCombineModes, setGroupCombineModes] = useState<Record<string, 'AND' | 'OR' | 'XOR'>>({});
  const [groupExclusionModes, setGroupExclusionModes] = useState<Record<string, 'AND' | 'OR' | 'XOR'>>({});
  // `isFoundationUsingD1` used to drive a "Foundation Linked" badge in
  // the page header. The header is gone in the fullscreen layout, so
  // the state is unused — but the load path below still sets it as a
  // load-success signal that the foundation tables are reachable, so
  // we keep the no-op setters to preserve that diagnostic write path.
  // Suppress the "unused" warning by destructuring the setter only.
  const [, setIsFoundationUsingD1] = useState(false);

  useEffect(() => {
    const loadSpells = async () => {
      setLoadingSpells(true);
      try {
        const records = await fetchSpellSummaries('name ASC');

        const mapped = records.map(row => ({
          ...row,
          sourceId: row.source_id,
          imageUrl: row.image_url,
          tagIds: typeof row.tags === 'string' ? JSON.parse(row.tags) : (row.tags ?? []),
          // Reconstruct `foundryShell` from the per-field scalar
          // columns the summary projection now carries instead of
          // the heavy `foundry_data` blob. Keeps the rest of the
          // SpellList unchanged — every place that read
          // `spell.foundryShell.activation` etc. continues to work.
          // See worker/migrations/20260514-2300_spells_display_scalars.sql
          // for the columns.
          foundryShell: {
            activation: {
              type:      row.activation_type ?? '',
              value:     row.activation_value ?? '',
              condition: row.activation_condition ?? '',
            },
            range: {
              units:   row.range_units ?? '',
              value:   row.range_value ?? '',
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
        console.error("Error loading spells:", err);
        setLoadingSpells(false);
      }
    };

    loadSpells();

    const loadFoundation = async () => {
      try {
        const [sourcesData, tagGroupsData, tagsData] = await Promise.all([
          fetchCollection<any>('sources', { orderBy: 'name ASC' }),
          fetchCollection<any>('tagGroups', { where: "classifications LIKE '%spell%'" }),
          fetchCollection<any>('tags', { orderBy: 'name ASC' })
        ]);

        setSources(sourcesData);
        setTagGroups(tagGroupsData);
        // Normalize tag rows (snake_case D1 columns -> camelCase the
        // TagGroupFilter / hierarchical layout expects). Same coercion
        // as ClassList. Without this, tagsByGroup's `tag.groupId`
        // lookup is undefined for every row and no tag filter chips
        // render at all.
        setAllTags(tagsData.map((t: any) => ({ ...t, ...normalizeTagRow(t) })));

        if (sourcesData.length > 0) setIsFoundationUsingD1(true);
      } catch (err) {
        console.error("[SpellList] Error loading foundation data:", err);
        setIsFoundationUsingD1(false);
      }
    };

    loadFoundation();

    return () => {
    };
  }, []);

  const sourceById = useMemo(() => Object.fromEntries(sources.map((source) => [source.id, source])), [sources]);
  const tagsByGroup = useMemo(() => {
    const map: Record<string, TagRecord[]> = {};
    for (const tag of allTags) {
      if (!tag.groupId) continue;
      if (!map[tag.groupId]) map[tag.groupId] = [];
      map[tag.groupId].push(tag);
    }
    return map;
  }, [allTags]);
  // Subtag-aware tag filter: a spell tagged `Conjure.Manifest` is
  // treated as also carrying its ancestor `Conjure`, so a filter
  // selection on `Conjure` matches the subtag-tagged spell. See
  // src/lib/tagHierarchy.ts.
  const parentByTagId = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const tag of allTags) {
      map.set(tag.id, ((tag as any).parent_tag_id ?? (tag as any).parentTagId ?? null) as string | null);
    }
    return map;
  }, [allTags]);

  const filteredSpells = useMemo(() => {
    return spells.filter((spell: any) => {
      const sourceRecord = sourceById[String(spell.sourceId ?? '')];
      // Source abbreviation falls back to the Foundry-native publication
      // metadata in the system block (`system.source.book`) when no
      // Dauligor source row matches. `foundryShell` is the parsed
      // foundry_data column (see mapped row above).
      const sourceAbbrev = String(
        sourceRecord?.abbreviation
        || sourceRecord?.shortName
        || spell.foundryShell?.source?.book
        || ''
      ).trim();
      const spellTagIds = Array.isArray(spell.tagIds) ? spell.tagIds : [];
      const matchesSearch = !search.trim()
        || String(spell.name ?? '').toLowerCase().includes(search.trim().toLowerCase())
        || sourceAbbrev.toLowerCase().includes(search.trim().toLowerCase())
        || String(spell.identifier ?? '').toLowerCase().includes(search.trim().toLowerCase());

      // Subtag-aware effective tag set: expand the spell's tags with
      // their ancestors so a filter on `Conjure` matches spells tagged
      // `Conjure.Manifest`. Then route through the shared
      // include/exclude + AND/OR/XOR matcher used by every list page.
      const effectiveTagIds = Array.from(expandTagsWithAncestors(spellTagIds, parentByTagId));
      const tagFilterMatches = matchesTagFilters(
        effectiveTagIds,
        tagGroups,
        tagsByGroup,
        tagStates,
        groupCombineModes,
        groupExclusionModes,
      );

      // Properties live on the spell row as booleans (concentration,
      // ritual, vocal, somatic, material). Collect into a Set for the
      // multi-valued axis matcher.
      const propsHave = new Set<string>();
      if (spell.concentration) propsHave.add('concentration');
      if (spell.ritual) propsHave.add('ritual');
      if (spell.vocal) propsHave.add('vocal');
      if (spell.somatic) propsHave.add('somatic');
      if (spell.material) propsHave.add('material');

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
  }, [spells, sourceById, search, axisFilters, tagStates, tagGroups, tagsByGroup, groupCombineModes, groupExclusionModes, parentByTagId]);

  // Sortable list — derives from filteredSpells. Numeric sort keys
  // (level, range distance) bypass localeCompare; everything else
  // falls back to string compare. `name` is the stable secondary key
  // so equal primary keys produce a deterministic order.
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
          // fall back to label string. self / touch / special go to
          // negative sentinel values so they group at one end under
          // numeric sort.
          const r = spell?.foundryShell?.range;
          const units = String(r?.units ?? '').toLowerCase();
          const value = Number(r?.value ?? NaN);
          if (units === 'self') return { primary: -3, secondary };
          if (units === 'touch') return { primary: -2, secondary };
          if (Number.isFinite(value)) {
            // Crudely normalize to feet (mi -> feet) so the sort is
            // monotonic in real distance. m / km go after imperial,
            // sorted by their numeric value alone — rare for spells.
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

  useEffect(() => {
    if (!selectedSpellId) return;
    if (!filteredSpells.some((spell) => spell.id === selectedSpellId)) {
      setSelectedSpellId('');
    }
  }, [filteredSpells, selectedSpellId]);

  // Resolve `?focus=<id-or-identifier>` once spells have loaded.
  // BBCode `[ref|spell|<id>]` cross-references land here — `<id>` is
  // typically the slug-style `identifier` column (e.g. "fire-bolt") so
  // we try that first, then fall back to row UUID for completeness.
  // Runs once per focusParam change; `selectedSpellId` is intentionally
  // not in the deps so we don't fight user clicks after the deep-link
  // takes effect.
  useEffect(() => {
    if (!focusParam || loadingSpells) return;
    const target = spells.find(
      (s) => s.identifier === focusParam || s.id === focusParam
    );
    if (target) setSelectedSpellId(target.id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusParam, loadingSpells, spells]);

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

  // Per-axis updaters. Each is a one-liner that updates the AxisState
  // for `axisKey` in the unified axisFilters record. Replaces the
  // previous 8 single-array toggleSelection / setActivationFilters /
  // … calls with one uniform API.
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

  // 3-state cycle: 0 (neutral, not in record) -> 1 (include) -> 2 (exclude) -> 0
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

  const renderSourceAbbreviation = (spell: SpellRecord) => {
    const sourceRecord = sourceById[String(spell.sourceId ?? '')];
    return sourceRecord?.abbreviation
      || sourceRecord?.shortName
      || (spell as any).foundryShell?.source?.book
      || '—';
  };

  const resetFilters = () => {
    setAxisFilters({});
    setTagStates({});
    setGroupCombineModes({});
    setGroupExclusionModes({});
  };

  // Settings popover — page-level UI preferences (currently just the
  // column-visibility toggles, but designed to host future per-user
  // settings too). Shown to all viewers; lives in the FilterBar's
  // trailingActions slot now that the page header is gone.
  const settingsPopover = (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 border-gold/20 text-gold hover:bg-gold/5 gap-2"
          title="List settings"
        >
          <Settings className="w-3.5 h-3.5" />
          Settings
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-2">
        <div className="text-[10px] uppercase tracking-widest text-ink/45 px-1 pb-1.5 mb-1 border-b border-gold/10">
          Visible columns
        </div>
        <div className="space-y-0.5">
          {ALL_COLUMNS.filter(c => !ALWAYS_VISIBLE.has(c)).map((col) => {
            const visible = !hiddenColumns.has(col);
            return (
              <button
                key={col}
                type="button"
                onClick={() => toggleColumn(col)}
                className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded text-xs hover:bg-gold/5"
              >
                <span>{COL_LABELS[col]}</span>
                <span className={cn(
                  'inline-flex items-center justify-center w-4 h-4 rounded border text-[10px]',
                  visible
                    ? 'border-gold/40 bg-gold/15 text-gold'
                    : 'border-gold/10 text-transparent'
                )}>
                  {visible ? '✓' : ''}
                </span>
              </button>
            );
          })}
        </div>
        <div className="text-[10px] text-ink/40 px-1 pt-1.5 mt-1 border-t border-gold/10 italic">
          Hiding columns widens the description pane.
        </div>
      </PopoverContent>
    </Popover>
  );

  // Filtered/total result count — matches the 5etools "1384/1936"
  // pattern. `filteredSpells.length` reflects search + filters + all
  // axis chip states; `spells.length` is the loaded corpus total.
  // While the corpus is still loading we render a placeholder so the
  // slot doesn't shift width when data arrives.
  const resultCount = (
    <div
      className="text-[11px] font-mono tabular-nums text-ink/55 whitespace-nowrap px-1"
      title={`${filteredSpells.length} spells match the current filters out of ${spells.length} total`}
    >
      {loadingSpells ? '— / —' : `${filteredSpells.length} / ${spells.length}`}
    </div>
  );

  return (
    // h-full so the page fills the viewport-derived space that the
    // CSS overrides (body.spell-list-fullscreen) freed up by hiding
    // the footer and zeroing <main>'s padding. flex-col so the
    // FilterBar sits above the spell grid and the grid takes the
    // remaining vertical space.
    <div className="h-full flex flex-col gap-2 p-2">
      <div className="shrink-0">
        <FilterBar
          search={search}
          setSearch={setSearch}
          isFilterOpen={filterOpen}
          setIsFilterOpen={setFilterOpen}
          activeFilterCount={activeFilterCount}
          resetFilters={resetFilters}
          searchPlaceholder="Search spell name, source, or identifier"
          filterTitle="Advanced Filters"
          resetLabel="Reset Filters"
          trailingActions={
            <>
              {resultCount}
              {settingsPopover}
              {userProfile?.role === 'admin' ? (
                <Link to="/compendium/spells/manage">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 border-gold/20 text-gold hover:bg-gold/5"
                  >
                    Spell Manager
                  </Button>
                </Link>
              ) : null}
            </>
          }
          renderFilters={
            <>
              {/* Base filter sections — each gets 3-state include/exclude
                  chips plus per-section AND/OR/XOR (include combinator)
                  and Exclusion Logic (exclude combinator). Single-valued
                  axes (level/school/source/buckets) treat AND/XOR like
                  OR; multi-valued Properties uses the combinators
                  faithfully. Tags live in the Advanced Options
                  disclosure below the base filters. */}
              <AxisFilterSection
                title="Sources"
                values={sources.map((source) => ({ value: source.id, label: String(source.abbreviation || source.shortName || source.name || source.id) }))}
                states={axisFilters.source?.states || {}}
                cycleState={(v) => cycleAxisState('source', v)}
                combineMode={axisFilters.source?.combineMode}
                cycleCombineMode={() => cycleAxisCombineMode('source')}
                exclusionMode={axisFilters.source?.exclusionMode}
                cycleExclusionMode={() => cycleAxisExclusionMode('source')}
                includeAll={() => axisIncludeAll('source', sources.map((source) => source.id))}
                excludeAll={() => axisExcludeAll('source', sources.map((source) => source.id))}
                clearAll={() => axisClear('source')}
              />
              <AxisFilterSection
                title="Spell Level"
                values={LEVEL_OPTIONS.filter((entry) => entry.value !== 'all')}
                states={axisFilters.level?.states || {}}
                cycleState={(v) => cycleAxisState('level', v)}
                combineMode={axisFilters.level?.combineMode}
                cycleCombineMode={() => cycleAxisCombineMode('level')}
                exclusionMode={axisFilters.level?.exclusionMode}
                cycleExclusionMode={() => cycleAxisExclusionMode('level')}
                includeAll={() => axisIncludeAll('level', LEVEL_OPTIONS.filter((entry) => entry.value !== 'all').map((entry) => entry.value))}
                excludeAll={() => axisExcludeAll('level', LEVEL_OPTIONS.filter((entry) => entry.value !== 'all').map((entry) => entry.value))}
                clearAll={() => axisClear('level')}
              />
              <AxisFilterSection
                title="Spell School"
                values={SCHOOL_OPTIONS.filter((entry) => entry.value !== 'all')}
                states={axisFilters.school?.states || {}}
                cycleState={(v) => cycleAxisState('school', v)}
                combineMode={axisFilters.school?.combineMode}
                cycleCombineMode={() => cycleAxisCombineMode('school')}
                exclusionMode={axisFilters.school?.exclusionMode}
                cycleExclusionMode={() => cycleAxisExclusionMode('school')}
                includeAll={() => axisIncludeAll('school', SCHOOL_OPTIONS.filter((entry) => entry.value !== 'all').map((entry) => entry.value))}
                excludeAll={() => axisExcludeAll('school', SCHOOL_OPTIONS.filter((entry) => entry.value !== 'all').map((entry) => entry.value))}
                clearAll={() => axisClear('school')}
              />
              <AxisFilterSection
                title="Casting Time"
                values={ACTIVATION_ORDER.map((b) => ({ value: b, label: ACTIVATION_LABELS[b] }))}
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
                values={RANGE_ORDER.map((b) => ({ value: b, label: RANGE_LABELS[b] }))}
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
                values={SHAPE_ORDER.map((b) => ({ value: b, label: SHAPE_LABELS[b] }))}
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
                values={DURATION_ORDER.map((b) => ({ value: b, label: DURATION_LABELS[b] }))}
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
                values={PROPERTY_ORDER.map((p) => ({ value: p, label: PROPERTY_LABELS[p] }))}
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

              {/* Tags + per-group combinators in a collapsible
                  Advanced Options block. Subtag-aware: each chip
                  toggle expands the spell's tag set with ancestors
                  before matching, so a `Conjure` include catches
                  spells tagged `Conjure.Manifest`. Hierarchical
                  parent-then-indented-subtag layout inside. */}
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
                  {tagGroups.map((group) => (
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
        />
      </div>

      {/* Three-column layout: favorites pane (left) | main spell list
          (middle) | detail panel (right).
          Sizing policy (see the doc-block at the top of the file for
          rationale and history):
            - List pane is FIXED at 520px. It doesn't grow when the
              viewport widens — wider viewports give all the extra
              width to the description instead. It doesn't shrink
              when columns are hidden either; the freed width inside
              the list goes to the Name column (which is the only
              `minmax(0,1fr)` cell in the internal grid).
            - Description floors at 360px so body text stays
              legible (anything narrower wraps every 4-5 words).
            - Below xl the grid drops to two columns and the detail
              card wraps to a second row.
          Pane heights use the viewport-derived `paneHeight` so the
          whole row fills the available vertical space between the
          FilterBar and the bottom of the viewport. `flex-1 min-h-0`
          on the wrapper lets the grid claim the leftover height
          inside the parent flex column without forcing the page to
          scroll. */}
      <div className="flex-1 min-h-0 grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[260px_520px_minmax(360px,1fr)]">
          {/* Favorites pane — only renders favorited spells. Pulled
              from the same filteredSpells source so the favorites pane
              respects active filters too, but it's "the same UI for a
              smaller list" rather than a parallel data path. */}
          <Card
            className="border-gold/10 bg-card/50 overflow-hidden"
            style={{ maxHeight: `${paneHeight}px` }}
          >
            <CardContent className="p-0 flex flex-col" style={{ maxHeight: `${paneHeight}px` }}>
              <div className="flex flex-col gap-2 border-b border-gold/10 bg-background/35 px-3 py-2.5 shrink-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Star className="w-3.5 h-3.5 text-gold/80 fill-gold/40" />
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gold/70">Favorites</span>
                  </div>
                  <span className="text-[10px] text-ink/45">{favorites.size}</span>
                </div>
                {/* Favorites-scope dropdown. Default is the "Universal
                    Favorite" set (user-level, cloud-synced). When the
                    user has saved characters they can select one and
                    subsequent toggles save to that character's
                    per-character favorites list instead. If they
                    have no characters, the popover content says so
                    explicitly — the dropdown still opens so the user
                    knows it's there.
                    Controlled open state so selecting an option auto-
                    dismisses the popover (Base UI's Popover doesn't
                    close on inner-button click by default, unlike a
                    native <select>). */}
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
              {favorites.size === 0 ? (
                <div className="px-4 py-8 text-center text-xs text-ink/40 italic">
                  Star a spell to pin it here.
                </div>
              ) : (
                <div className="divide-y divide-gold/5 flex-1 overflow-y-auto custom-scrollbar">
                  {spells
                    .filter((s) => favorites.has(s.id))
                    .map((spell) => {
                      const selected = selectedSpellId === spell.id;
                      const sourceLabel = renderSourceAbbreviation(spell);
                      return (
                        <button
                          key={spell.id}
                          type="button"
                          onClick={() => setSelectedSpellId(spell.id)}
                          className={cn(
                            'flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors',
                            selected ? 'bg-gold/10' : 'hover:bg-gold/5'
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
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); toggleFavorite(spell.id); }}
                              className="text-gold/70 hover:text-blood transition-colors"
                              title="Remove from favorites"
                              aria-label="Remove from favorites"
                            >
                              <Star className="w-3 h-3 fill-current" />
                            </button>
                          </div>
                        </button>
                      );
                    })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Main spell list. Columns: Name | Lv | Time | School | C. |
              Range | Src. Each header is a sort toggle (click to sort by
              that column; click again to flip direction). Columns past
              Name can be hidden via Settings in the page header bar —
              user preference persists to localStorage. The card is
              capped at the viewport-derived paneHeight; VirtualizedList already
              handles its own scrolling internally (height = PANE max
              minus the header strip). */}
          <Card
            className="border-gold/10 bg-card/50 overflow-hidden"
            style={{ maxHeight: `${paneHeight}px` }}
          >
            <CardContent className="p-0">
              {/* Header row + columns popover. The grid template here is
                  derived from `visibleColumns` so hiding a column also
                  removes its header cell. */}
              <div className="border-b border-gold/10 bg-background/35">
                <div
                  className="grid gap-2 px-3 py-2.5 text-[10px] font-bold uppercase tracking-[0.18em] text-gold/70 items-center"
                  style={{ gridTemplateColumns: gridTemplate }}
                >
                  {visibleColumns.map((col) => {
                    const isActive = sortBy === col;
                    const isName = col === 'name';
                    return (
                      <button
                        key={col}
                        type="button"
                        onClick={() => handleSort(col)}
                        className={cn(
                          'flex items-center gap-1 transition-colors',
                          isName ? 'justify-start' : 'justify-center',
                          isActive ? 'text-gold' : 'hover:text-gold/90',
                        )}
                        title={`Sort by ${COL_LABELS[col]}${isActive ? ` (${sortDir})` : ''}`}
                      >
                        <span>{COL_LABELS[col]}</span>
                        {isActive && (
                          sortDir === 'asc'
                            ? <ChevronUp className="w-3 h-3" />
                            : <ChevronDown className="w-3 h-3" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
              {loadingSpells ? (
                <div className="px-6 py-12 text-center text-ink/45">
                  Loading spells...
                </div>
              ) : sortedSpells.length === 0 ? (
                <div className="px-6 py-12 text-center text-ink/45">
                  No spells match the current search and filters.
                </div>
              ) : (
                <VirtualizedList
                  items={sortedSpells}
                  height={listInnerHeight}
                  itemHeight={48}
                  className="custom-scrollbar overflow-y-auto"
                  innerClassName="divide-y divide-gold/5"
                  renderItem={(spell) => {
                    const sourceLabel = renderSourceAbbreviation(spell);
                    const selected = selectedSpellId === spell.id;
                    const facets = spell as any; // derived facets attached at load time
                    // Range shows the real value (e.g. "60 ft", "Self") —
                    // the bucket is just the filter axis. formatRangeLabel
                    // falls back to "Special" when units/value are missing.
                    const activationLabel = formatActivationLabel(facets.foundryShell?.activation);
                    const rangeLabel = formatRangeLabel(facets.foundryShell?.range);
                    const schoolAbbrev = (() => {
                      const full = SCHOOL_LABELS[String(spell.school ?? '')];
                      if (!full) return String(spell.school ?? '').slice(0, 4).toUpperCase() || '—';
                      return full.length > 6 ? full.slice(0, 4) + '.' : full;
                    })();
                    // Renderers keyed by column key — same set we
                    // iterate through for the header. Cells render only
                    // when their column is in `visibleColumns`.
                    const cellRenderers: Record<SpellColumnKey, () => React.ReactNode> = {
                      name: () => (
                        <div className="min-w-0 flex items-center gap-1.5">
                          <span className="truncate font-serif text-sm text-ink">{spell.name}</span>
                          {isFavorite(spell.id) && (
                            <Star className="w-3 h-3 text-gold/70 fill-gold/40 shrink-0" aria-label="Favorite" />
                          )}
                          {(() => {
                            const reqTagIds = Array.isArray((spell as any).required_tags)
                              ? (spell as any).required_tags
                              : [];
                            const hasFreeText = !!(spell as any).prerequisite_text;
                            if (reqTagIds.length === 0 && !hasFreeText) return null;
                            const tagLabel = reqTagIds
                              .map((tid: string) => allTags.find((t: any) => t.id === tid)?.name || tid)
                              .join(', ');
                            const title = [
                              tagLabel ? `Requires: ${tagLabel}` : null,
                              hasFreeText ? `Note: ${(spell as any).prerequisite_text}` : null,
                            ].filter(Boolean).join(' · ');
                            return (
                              <span title={title} className="shrink-0 inline-flex">
                                <Lock className="w-3 h-3 text-blood/70" aria-label="Has prerequisites" />
                              </span>
                            );
                          })()}
                        </div>
                      ),
                      level: () => (
                        <div className="text-xs text-ink/75 text-center">
                          {Number(spell.level ?? 0) === 0 ? 'C' : spell.level}
                        </div>
                      ),
                      time: () => (
                        <div className="text-xs text-ink/75 text-center truncate" title={activationLabel}>
                          {activationLabel}
                        </div>
                      ),
                      school: () => (
                        <div
                          className="text-xs text-ink/75 text-center truncate"
                          title={SCHOOL_LABELS[String(spell.school ?? '')] || ''}
                        >
                          {schoolAbbrev}
                        </div>
                      ),
                      concentration: () => (
                        <div className="text-xs text-blood/70 text-center" title="Concentration">
                          {facets.concentration ? '◆' : ''}
                        </div>
                      ),
                      range: () => (
                        <div className="text-xs text-ink/75 text-center truncate" title={rangeLabel}>
                          {rangeLabel}
                        </div>
                      ),
                      source: () => (
                        <div className="text-xs font-bold text-gold/80 text-center truncate">{sourceLabel}</div>
                      ),
                    };
                    return (
                      <button
                        key={spell.id}
                        type="button"
                        onClick={() => setSelectedSpellId(spell.id)}
                        className={cn(
                          'grid h-[48px] w-full gap-2 items-center px-3 text-left transition-colors',
                          selected ? 'bg-gold/10' : 'hover:bg-gold/5'
                        )}
                        style={{ gridTemplateColumns: gridTemplate }}
                      >
                        {visibleColumns.map((col) => (
                          <React.Fragment key={col}>{cellRenderers[col]()}</React.Fragment>
                        ))}
                      </button>
                    );
                  }}
                />
              )}
            </CardContent>
          </Card>

          {/* Detail pane — image+info inline (horizontal), tags grouped by
              category, favorite star in the header. The card has a
              FIXED height (not just max) so the inner panel can flex
              the source/tag block to the bottom of the available
              space. Without an explicit height, the card would shrink
              to its content and mt-auto inside SpellDetailPanel
              would have nothing to push against. Long descriptions
              still scroll internally via CardContent's overflow-y. */}
          <Card
            className="border-gold/10 bg-card/50 overflow-hidden"
            style={{ height: `${paneHeight}px` }}
          >
            <CardContent
              className="p-0 overflow-y-auto custom-scrollbar h-full"
              style={{ maxHeight: `${paneHeight}px` }}
            >
              <SpellDetailPanel
                spellId={selectedSpellId || null}
                isFavorite={selectedSpellId ? isFavorite(selectedSpellId) : false}
                onToggleFavorite={toggleFavorite}
              />
            </CardContent>
          </Card>
        </div>
    </div>
  );
}

// FilterSection (include-only chip row) was removed when every section
// migrated to the rich <AxisFilterSection> from FilterBar.tsx. Kept the
// removal record so future grep-blame doesn't go looking for "where did
// the simple component go" — the answer is "every section now has
// include/exclude + AND/OR/XOR via the shared component".
