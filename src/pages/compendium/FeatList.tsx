import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useCompendiumHashLink } from '../../lib/useCompendiumHashLink';
import { Link, useSearchParams } from 'react-router-dom';
import { Star, X } from 'lucide-react';
import { auth } from '../../lib/firebase';
import { fetchCollection } from '../../lib/d1';
import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import {
  CompendiumBrowserShell,
  type CompendiumColumn,
} from '../../components/compendium/CompendiumBrowserShell';
import { useAxisFilters } from '../../hooks/useAxisFilters';
import { useFeatFavorites } from '../../lib/featFavorites';
import FeatDetailPanel from '../../components/compendium/FeatDetailPanel';
import { deriveFeatPropertyFlags } from '../../lib/featFilters';
import { expandTagsWithAncestors, normalizeTagRow } from '../../lib/tagHierarchy';
import { matchesTagFilters } from '../../components/compendium/FilterBar';
import { SectionFilterPanel, type FilterSection } from '../../components/compendium/SectionFilterPanel';
import {
  parseRequirementTree,
  resolveListPrereq,
  extractAbilityScoreLeaves,
  type Requirement,
  type RequirementFormatLookup,
} from '../../lib/requirements';

/**
 * Public feat browser — thin wrapper around `CompendiumBrowserShell`.
 *
 * Supplies the feat-specific bits (data load, filter axes, column
 * descriptors, FeatDetailPanel, useFeatFavorites hook); the shell
 * owns viewport-lock, 3-col layout, FilterBar wiring, column
 * visibility, favorites pane shell. Anything we change in the shell
 * (e.g. row height, default pane widths) automatically propagates to
 * ItemList (and SpellList once it migrates) — that's the win.
 *
 * Feat-specific affordances kept here:
 *   - `?class=<identifier>` URL scope: shows only class-feature feats
 *     for the named class. Banner chip in the shell's trailing slot.
 *   - Prereq lock + repeatable glyph + activity/uses flags on the
 *     name cell.
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

type FeatRow = {
  id: string;
  name?: string;
  identifier?: string;
  sourceId?: string;
  featType?: string;
  featSubtype?: string;
  featCategoryId?: string;
  repeatable?: boolean;
  // Three-layer prerequisite display, resolved via
  // `resolveListPrereq` (lib/requirements). Chain in the column:
  // requirementsShortText → requirements (free text) →
  // formatted requirementsTree (proficiencyOnly).
  requirements?: string;
  requirementsShortText?: string;
  requirementsTree?: Requirement | null;
  abilityScoreLeaves?: Array<{ ability: string; min: number }>;
  repeatableFlag?: boolean;
  hasUses?: boolean;
  hasActivities?: boolean;
  hasEffects?: boolean;
  hasPrereqs?: boolean;
  // Tag IDs the feat is tagged with. Populated from the `tags` JSON
  // column (auto-parsed by d1.ts). Drives the tag-axis filter chain.
  tagIds?: string[];
  [key: string]: any;
};

// Axis keys declared so `useAxisFilters` knows what to tally for the
// `activeFilterCount` badge. Tag-state plumbing stays inline (the
// hook is axis-only) and adds to the count below. FeatList currently
// declares no value axes — only tag-group filtering — but keep the
// hook wired so future axes (Property / Source / Category / Ability)
// can plug in without further plumbing.
const AXIS_KEYS = [] as const;

export default function FeatList({ userProfile }: { userProfile: any }) {
  const [feats, setFeats] = useState<FeatRow[]>([]);
  const [sources, setSources] = useState<SourceRecord[]>([]);
  // Admin-managed feat categories — drives the Category column.
  // Empty list is the cold-start case (admin hasn't authored any yet);
  // the column simply shows "—" for every feat in that scenario.
  const [featCategories, setFeatCategories] = useState<Array<{ id: string; name: string }>>([]);
  // Per-proficiency-kind name lookups for the prerequisite formatter.
  // Resolves slugs like "ath" → "Athletics" when rendering the
  // Prerequisite column + detail panel prereq line. Loading happens
  // in parallel with sources/categories in `loadFoundation`.
  const [prereqLookup, setPrereqLookup] = useState<RequirementFormatLookup>({});
  // Tag foundation — scoped to feat-classified groups so the panel
  // doesn't surface spell-only or world-only tag groups. Mirrors
  // SpellList's tagGroups / allTags state.
  const [tagGroups, setTagGroups] = useState<TagGroupRecord[]>([]);
  const [allTags, setAllTags] = useState<TagRecord[]>([]);
  const [loadingFeats, setLoadingFeats] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedFeatId, setSelectedFeatId] = useState('');

  // ─── Axis filter state ──────────────────────────────────────
  // Shared hook covers the per-axis cyclers + count + reset. FeatList
  // declares no value axes today (see AXIS_KEYS above), so the hook
  // is wired purely for shape parity with SpellList — the cyclers feed
  // SectionFilterPanel and tag-state plumbing stays inline below.
  const {
    axisFilters,
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

  // Auth-aware favorites — feeds the shell with a userId-bound
  // favorites Set. The onAuthStateChanged listener re-runs the hook
  // whenever sign-in / sign-out happens so cloud + local merge.
  const [authUserId, setAuthUserId] = useState<string | null>(() => auth.currentUser?.uid ?? null);
  useEffect(() => {
    const unsub = auth.onAuthStateChanged((u) => setAuthUserId(u?.uid ?? null));
    return unsub;
  }, []);
  const { favorites, isFavorite, toggleFavorite } = useFeatFavorites(authUserId);

  // ?class= URL param — feat-specific scope filter. Combines via AND
  // with the rest of the filter chain so a user can browse "Wizard
  // class features tagged X" by URL + chip.
  const [searchParams, setSearchParams] = useSearchParams();
  const classScopeIdentifier = searchParams.get('class') || '';
  const clearClassScope = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('class');
    setSearchParams(next, { replace: true });
  };

  useEffect(() => {
    const loadFeats = async () => {
      setLoadingFeats(true);
      try {
        const rows = await fetchCollection<any>('feats', { orderBy: 'name ASC' });
        const mapped: FeatRow[] = rows.map((row: any) => {
          const flags = deriveFeatPropertyFlags(row);
          // Parse the structured requirements tree once and derive
          // the ability-score leaves the Ability column reads.
          // requirements_tree lands as the parsed object (d1.ts auto-
          // parses known JSON columns) — defend against the rare
          // string passthrough case anyway.
          const treeRaw = row.requirements_tree ?? row.requirementsTree;
          const tree = parseRequirementTree(treeRaw);
          const abilityScoreLeaves = extractAbilityScoreLeaves(tree);
          return {
            ...row,
            sourceId: row.source_id,
            featType: row.feat_type,
            featSubtype: row.feat_subtype || '',
            featCategoryId: row.feat_category_id || '',
            repeatable: !!row.repeatable,
            requirements: String(row.requirements ?? ''),
            requirementsShortText: String(row.requirements_short_text ?? ''),
            requirementsTree: tree,
            abilityScoreLeaves,
            repeatableFlag: flags.repeatable,
            hasUses: flags.hasUses,
            hasActivities: flags.hasActivities,
            hasEffects: flags.hasEffects,
            hasPrereqs: flags.hasPrereqs,
            // `tags` column is in d1.ts's auto-parse list, so it lands
            // as an array. Defend against the rare string passthrough
            // and the legacy null case anyway.
            tagIds: Array.isArray(row.tags) ? row.tags : [],
          };
        });
        setFeats(mapped);
      } catch (err) {
        console.error('[FeatList] failed to load feats:', err);
      } finally {
        setLoadingFeats(false);
      }
    };
    const loadFoundation = async () => {
      try {
        // Sources + feat categories drive the Category / Source
        // columns. The proficiency name collections (skills, tools,
        // weapons, armor, languages) feed the prereq formatter's
        // slug-resolution lookup so a row like "ath" reads as
        // "Athletics" in the Prerequisite column. tagGroups +
        // tags drive the tag-axis filter — tag groups are scoped to
        // those flagged feat-relevant (mirrors FeatDetailPanel and
        // FeatImportWorkbench).
        const [sourcesData, categoryData, skillsData, toolsData, weaponsData, armorData, languagesData, tagGroupsData, tagsData] = await Promise.all([
          fetchCollection<any>('sources', { orderBy: 'name ASC' }),
          fetchCollection<any>('featCategories', { orderBy: '"order", name ASC' }),
          fetchCollection<any>('skills', { orderBy: 'name ASC' }),
          fetchCollection<any>('tools', { orderBy: 'name ASC' }),
          fetchCollection<any>('weapons', { orderBy: 'name ASC' }),
          fetchCollection<any>('armor', { orderBy: 'name ASC' }),
          fetchCollection<any>('languages', { orderBy: 'name ASC' }),
          fetchCollection<any>('tagGroups', { where: "classifications LIKE '%feat%'" }),
          fetchCollection<any>('tags', { orderBy: 'name ASC' }),
        ]);
        setSources(sourcesData);
        setFeatCategories(
          (categoryData || []).map((r: any) => ({ id: String(r.id), name: String(r.name || '') }))
        );
        // Build the prereq lookup. The proficiency requirement leaf
        // stores an `identifier` field that matches the row's
        // identifier column (e.g. "ath" → Athletics row whose
        // identifier is "ath"). We key by identifier first; the
        // editor authors prereqs against identifiers, not IDs.
        const byIdent = (rows: any[]) =>
          Object.fromEntries(
            (rows || [])
              .filter((r) => r?.identifier)
              .map((r) => [String(r.identifier), String(r.name || r.identifier)])
          ) as Record<string, string>;
        setPrereqLookup({
          skillNameById: byIdent(skillsData),
          toolNameById: byIdent(toolsData),
          weaponNameById: byIdent(weaponsData),
          armorNameById: byIdent(armorData),
          languageNameById: byIdent(languagesData),
        });
        setTagGroups(tagGroupsData);
        // normalizeTagRow populates `groupId` + `parentTagId` from
        // either snake_case (raw D1) or camelCase (already normalised).
        // Idempotent — safe to call on any shape.
        setAllTags(tagsData.map((t: any) => ({ ...t, ...normalizeTagRow(t) })));
      } catch (err) {
        console.error('[FeatList] failed to load foundation data:', err);
      }
    };
    loadFeats();
    loadFoundation();
  }, []);

  const sourceById = useMemo(
    () => Object.fromEntries(sources.map((s) => [s.id, s])) as Record<string, SourceRecord>,
    [sources],
  );

  const categoryNameById = useMemo(
    () => Object.fromEntries(featCategories.map((c) => [c.id, c.name])) as Record<string, string>,
    [featCategories],
  );

  // Hash deep-link (`#identifier_abbrev`). Mirrors 5etools (e.g.
  // `#bloodlust_abh`). Logic lives in `useCompendiumHashLink`
  // so SpellList / ItemList / FacilitiesList share the same
  // behavior — see `src/lib/useCompendiumHashLink.ts`.
  useCompendiumHashLink({
    rows: feats,
    sources,
    sourceById,
    selectedId: selectedFeatId,
    setSelectedId: setSelectedFeatId,
  });

  // Bucket tags by their owning group + build parent lookup. Mirrors
  // SpellList — drives the per-group axis values and ancestor
  // expansion in the filter chain.
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

  // Filter pipeline. Search + optional `?class=` scope + tag-axis
  // filter (re-introduced now that FeatsEditor authors tags on
  // feats — see `feat/feats-tagging`). The old multi-axis filter
  // modal (property / category / ability axes) stays dropped per the
  // earlier UX direction; those dimensions still have type-aware
  // columns. Only the tag axis comes back here.
  const filteredFeats = useMemo(() => {
    const lowered = search.trim().toLowerCase();
    const scopeIdLower = classScopeIdentifier.trim().toLowerCase();
    return feats.filter((feat) => {
      const sourceRecord = sourceById[String(feat.sourceId ?? '')];
      const sourceAbbrev = String(
        sourceRecord?.abbreviation || sourceRecord?.shortName || '',
      ).toLowerCase();
      const matchesSearch =
        !lowered
        || String(feat.name ?? '').toLowerCase().includes(lowered)
        || String(feat.identifier ?? '').toLowerCase().includes(lowered)
        || String(feat.featSubtype ?? '').toLowerCase().includes(lowered)
        || sourceAbbrev.includes(lowered);

      if (scopeIdLower) {
        if (String(feat.featType ?? '').toLowerCase() !== 'class') return false;
        if (String(feat.featSubtype ?? '').toLowerCase() !== scopeIdLower) return false;
      }

      const featTagIds = Array.isArray(feat.tagIds) ? feat.tagIds : [];
      const effectiveTagIds = Array.from(expandTagsWithAncestors(featTagIds, parentByTagId));
      const tagFilterMatches = matchesTagFilters(
        effectiveTagIds,
        tagGroups,
        tagsByGroup,
        tagStates,
        groupCombineModes,
        groupExclusionModes,
      );

      return matchesSearch && tagFilterMatches;
    });
  }, [feats, sourceById, search, classScopeIdentifier, tagStates, tagGroups, tagsByGroup, groupCombineModes, groupExclusionModes, parentByTagId]);

  // ─── Column descriptors ──────────────────────────────────────
  const renderSourceAbbreviation = (feat: FeatRow) => {
    const sourceRecord = sourceById[String(feat.sourceId ?? '')];
    return sourceRecord?.abbreviation || sourceRecord?.shortName || '—';
  };

  const columns = useMemo<CompendiumColumn<FeatRow>[]>(() => ([
    {
      key: 'name',
      label: 'Name',
      // Column proportions match 5etools' feat table (col-3-2 /
      // col-1-3 / col-2-5 / col-3 / col-1-7 against their 12-unit
      // grid). All values are fractional so the row scales with
      // the list pane width; sensible mins prevent collapse at
      // narrow widths but the proportions stay consistent on wider
      // viewports so a typical row (e.g. Athlete, Lvl 4 +
      // Athletics Proficiency) fits without truncation.
      width: 'minmax(140px,4fr)',
      alwaysVisible: true,
      align: 'start',
      render: (feat) => {
        const starred = isFavorite(feat.id);
        return (
          <div className="min-w-0 flex items-center gap-1">
            <span className="truncate font-semibold text-[12px] text-ink">{feat.name}</span>
            {starred && (
              <Star className="w-2.5 h-2.5 text-gold/70 fill-gold/40 shrink-0" aria-label="Favorite" />
            )}
          </div>
        );
      },
    },
    {
      key: 'category',
      label: 'Category',
      width: 'minmax(60px,1.3fr)',
      render: (feat) => {
        const label = categoryNameById[String(feat.featCategoryId ?? '')] || '';
        return label ? (
          <span className="text-[11px] text-ink truncate" title={label}>{label}</span>
        ) : (
          <span className="text-[11px] text-ink/40">—</span>
        );
      },
    },
    // Ability column removed. Ability-score requirements still
    // render inside the Prerequisite column (e.g. "WIS 13" for
    // Blood Hound), so dropping the standalone column doesn't lose
    // information — it just frees ~2.5fr of horizontal space for
    // the Name + Prerequisite columns that needed it more.
    {
      key: 'prerequisite',
      label: 'Prerequisite',
      width: 'minmax(160px,4fr)',
      render: (feat) => {
        // Three-layer resolution lives in `resolveListPrereq` so this
        // column and RequirementsEditor's live preview can't drift —
        // see lib/requirements.ts. Chain: shortText → freeText →
        // formatted tree (proficiencyOnly).
        const display = resolveListPrereq(
          {
            shortText: feat.requirementsShortText,
            freeText: feat.requirements,
            tree: feat.requirementsTree ?? null,
          },
          prereqLookup,
        );
        return display ? (
          <span className="text-[11px] text-ink truncate" title={display}>{display}</span>
        ) : (
          <span className="text-[11px] text-ink/40">—</span>
        );
      },
    },
    {
      key: 'source',
      label: 'Source',
      width: 'minmax(50px,1.7fr)',
      render: (feat) => (
        <span className="text-[11px] font-bold text-gold/80 justify-self-center">
          {renderSourceAbbreviation(feat)}
        </span>
      ),
    },
    // The legacy "Flags" column with Sparkles/RotateCcw indicators is
    // gone — it cluttered the row without telling the author anything
    // they couldn't see by clicking through. SpellList already follows
    // this pattern; FeatList now matches it. The favorite star + the
    // prerequisite lock chip in the name column are the only row
    // affordances retained.
  ]), [isFavorite, sourceById, categoryNameById]);

  // Total active filter count = axes + tag states (across all groups).
  // FeatList has no value axes today, so the count is just tagStates,
  // but keep the same shape SpellList uses for grep parity.
  const activeFilterCount = axisActiveCount + Object.keys(tagStates).length;

  const resetFilters = () => {
    setTagStates({});
    setGroupCombineModes({});
    setGroupExclusionModes({});
    setSearch('');
    resetAxesOnly();
  };

  // ─── Filter axes (tag groups only) ───────────────────────────
  // No base axes — feats lean on type-aware columns (Category /
  // Source / Prerequisite) for those dimensions. Each feat-classified
  // tag group becomes a `kind: 'tag'` axis with its tags as values,
  // ordered with subtag parent-value hints so the panel can draw the
  // chevron drawer the same way SpellList does.
  const miniPillAxes = useMemo<FilterSection[]>(() => {
    const axes: FilterSection[] = [];
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
  }, [tagGroups, tagsByGroup]);

  // ─── Custom filter panel (tag-aware) ─────────────────────────
  // FeatList joins SpellList as a browser with tag-group plumbing, so
  // it overrides the shell's default panel. No value axes — only the
  // tag cyclers + group modes.
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

  // ─── Favorites pane row render ──────────────────────────────
  const favoritesRowRender = ({ row: feat, selected, toggleStar, onSelect }: { row: FeatRow; selected: boolean; toggleStar: () => void; onSelect: () => void }) => {
    const sourceLabel = renderSourceAbbreviation(feat);
    return (
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          'w-full grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 px-3 py-2 text-left transition-colors',
          selected ? 'bg-gold/10' : 'hover:bg-gold/5',
        )}
      >
        <span className="truncate text-sm text-ink">{feat.name}</span>
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
          className="text-gold/80 hover:text-blood shrink-0 cursor-pointer"
          title="Remove from favorites"
          aria-label="Remove from favorites"
        >
          <Star className="w-3.5 h-3.5 fill-current" />
        </span>
      </button>
    );
  };

  return (
    <CompendiumBrowserShell<FeatRow>
      rows={filteredFeats}
      allRows={feats}
      loading={loadingFeats}
      getRowId={(feat) => feat.id}
      selectedId={selectedFeatId}
      onSelect={setSelectedFeatId}
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder="Search feat name, source, identifier, or subtype"
      // Tag-axis filter wired in via `renderFilters` — the value
      // axes (Category / Ability / Property / Source) stay column-
      // only by design; only tag-group filtering surfaces in the
      // filter modal. axisFilters + cyclers come from useAxisFilters
      // for shape parity with SpellList (and to keep the door open
      // for future value axes here).
      filterAxes={miniPillAxes}
      axisFilters={axisFilters}
      cyclers={cyclers}
      activeFilterCount={activeFilterCount}
      onResetFilters={resetFilters}
      renderFilters={renderFilters}
      columns={columns}
      columnsLocalStorageKey="dauligor.featListColumns"
      rowHeight={36}
      favorites={favorites}
      onToggleFavorite={toggleFavorite}
      favoritesRowRender={favoritesRowRender}
      favoritesEmptyMessage="Star a feat to pin it here."
      detailPanel={
        <FeatDetailPanel
          featId={selectedFeatId || null}
          isFavorite={selectedFeatId ? isFavorite(selectedFeatId) : false}
          onToggleFavorite={toggleFavorite}
        />
      }
      emptyMessage="No feats match the current search and filters."
      trailingActions={
        <>
          {classScopeIdentifier ? (
            <button
              type="button"
              onClick={clearClassScope}
              className="inline-flex items-center gap-1 h-8 px-2 rounded-md border border-gold/40 bg-gold/10 text-gold text-[11px] font-bold uppercase tracking-widest hover:bg-blood/10 hover:border-blood/40 hover:text-blood transition-colors"
              title={`Scoped to ${classScopeIdentifier} class features. Click to clear.`}
            >
              Class: {classScopeIdentifier}
              <X className="w-3 h-3" />
            </button>
          ) : null}
          {userProfile?.role === 'admin' ? (
            <Link to="/compendium/feats/manage">
              <Button type="button" variant="outline" size="sm" className="h-8 border-gold/20 text-gold hover:bg-gold/5">
                Feat Manager
              </Button>
            </Link>
          ) : null}
        </>
      }
    />
  );
}
