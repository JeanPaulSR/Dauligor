import React, { useEffect, useMemo, useState } from 'react';
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
import { useFeatFavorites } from '../../lib/featFavorites';
import FeatDetailPanel from '../../components/compendium/FeatDetailPanel';
import { deriveFeatPropertyFlags } from '../../lib/featFilters';
import {
  parseRequirementTree,
  formatRequirementShort,
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

type FeatRow = {
  id: string;
  name?: string;
  identifier?: string;
  sourceId?: string;
  featType?: string;
  featSubtype?: string;
  featCategoryId?: string;
  repeatable?: boolean;
  requirements?: string;
  // Pre-parsed requirements_tree + derived fields for the Ability /
  // Prerequisite columns. Computing these once at load keeps the
  // render cheap and prevents every row re-parsing JSON on filter
  // recompute.
  requirementsTree?: Requirement | null;
  abilityScoreLeaves?: Array<{ ability: string; min: number }>;
  repeatableFlag?: boolean;
  hasUses?: boolean;
  hasActivities?: boolean;
  hasEffects?: boolean;
  hasPrereqs?: boolean;
  [key: string]: any;
};

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
  const [loadingFeats, setLoadingFeats] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedFeatId, setSelectedFeatId] = useState('');

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
            requirementsTree: tree,
            abilityScoreLeaves,
            repeatableFlag: flags.repeatable,
            hasUses: flags.hasUses,
            hasActivities: flags.hasActivities,
            hasEffects: flags.hasEffects,
            hasPrereqs: flags.hasPrereqs,
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
        // "Athletics" in the Prerequisite column.
        const [sourcesData, categoryData, skillsData, toolsData, weaponsData, armorData, languagesData] = await Promise.all([
          fetchCollection<any>('sources', { orderBy: 'name ASC' }),
          fetchCollection<any>('featCategories', { orderBy: '"order", name ASC' }),
          fetchCollection<any>('skills', { orderBy: 'name ASC' }),
          fetchCollection<any>('tools', { orderBy: 'name ASC' }),
          fetchCollection<any>('weapons', { orderBy: 'name ASC' }),
          fetchCollection<any>('armor', { orderBy: 'name ASC' }),
          fetchCollection<any>('languages', { orderBy: 'name ASC' }),
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

  // Filter pipeline. Just search + the optional `?class=` scope —
  // the multi-axis filter modal got dropped per the new UX
  // direction (the row's category / ability / source columns are
  // expressive enough that the per-axis pill wall added clutter
  // without earning its space).
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
      return matchesSearch;
    });
  }, [feats, sourceById, search, classScopeIdentifier]);

  // ─── Column descriptors ──────────────────────────────────────
  const renderSourceAbbreviation = (feat: FeatRow) => {
    const sourceRecord = sourceById[String(feat.sourceId ?? '')];
    return sourceRecord?.abbreviation || sourceRecord?.shortName || '—';
  };

  const columns = useMemo<CompendiumColumn<FeatRow>[]>(() => ([
    {
      key: 'name',
      label: 'Name',
      // `minmax(160px, 1fr)` ensures the name stays at least 160px
      // wide even when the other columns + the favorites pane eat
      // most of the table area. The previous `minmax(0, 1fr)`
      // allowed the column to collapse to 0px, which combined with
      // the inner `truncate` made the name disappear entirely.
      width: 'minmax(160px,1fr)',
      alwaysVisible: true,
      align: 'start',
      render: (feat) => {
        const starred = isFavorite(feat.id);
        return (
          <div className="min-w-0 flex items-center gap-1.5">
            <span className="truncate font-semibold text-sm text-ink">{feat.name}</span>
            {starred && (
              <Star className="w-3 h-3 text-gold/70 fill-gold/40 shrink-0" aria-label="Favorite" />
            )}
          </div>
        );
      },
    },
    {
      key: 'category',
      label: 'Category',
      width: '140px',
      render: (feat) => {
        // Look up the admin-authored category name. Falls back to a
        // dim em-dash when the feat has no category assigned (the
        // common cold-start case before admins curate the taxonomy).
        const label = categoryNameById[String(feat.featCategoryId ?? '')] || '';
        return label ? (
          <span className="text-xs text-ink/80 truncate">{label}</span>
        ) : (
          <span className="text-xs text-ink/30">—</span>
        );
      },
    },
    {
      key: 'ability',
      label: 'Ability',
      width: '100px',
      render: (feat) => {
        // Roll the abilityScore leaves from the requirements tree
        // up into a tight glance. Multiple leaves with the same min
        // collapse: "STR/DEX 13"; differing mins render each one:
        // "STR 13 · WIS 11". The attributes-table abbreviation is
        // always SCREAMING_CASE (per /admin/proficiencies), so the
        // raw slug.toUpperCase() matches the canonical label without
        // a join.
        const leaves = (feat.abilityScoreLeaves || []) as Array<{ ability: string; min: number }>;
        if (!leaves.length) return <span className="text-xs text-ink/30">—</span>;
        // Group by min so "STR/DEX/CON 13" collapses cleanly.
        const byMin = new Map<number, string[]>();
        for (const l of leaves) {
          const k = Number(l.min) || 0;
          if (!byMin.has(k)) byMin.set(k, []);
          byMin.get(k)!.push(String(l.ability).toUpperCase());
        }
        const parts = [...byMin.entries()]
          .sort((a, b) => b[0] - a[0])
          .map(([min, abilities]) => `${abilities.join('/')} ${min}`);
        return <span className="text-xs text-ink/80 truncate">{parts.join(' · ')}</span>;
      },
    },
    {
      key: 'prerequisite',
      label: 'Prerequisite',
      width: 'minmax(180px,1.4fr)',
      render: (feat) => {
        // formatRequirementShort: drops the verbose "(character
        // level)" qualifier and the "Skill proficiency:" prefix in
        // favor of a clean "Proficiency: <name>" reading. The
        // per-kind lookup maps resolve identifier slugs like "ath"
        // to their display name ("Athletics") — falls back to the
        // slug when the lookup isn't populated yet.
        const text = formatRequirementShort(feat.requirementsTree ?? null, prereqLookup);
        const fallback = String(feat.requirements ?? '').trim();
        const display = text || fallback;
        return display ? (
          <span className="text-xs text-ink truncate" title={display}>{display}</span>
        ) : (
          <span className="text-xs text-ink/40">—</span>
        );
      },
    },
    {
      key: 'source',
      label: 'Source',
      width: '60px',
      render: (feat) => (
        <span className="text-xs font-bold text-gold/80 justify-self-center">
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
      // Filter UI is gone — the type-aware columns (Category /
      // Ability / Prerequisite / Source) already let authors narrow
      // visually, and the modal added clutter without a clear
      // payoff. Required-prop shells get empty axes + a no-op
      // reset.
      hideFilters
      filterAxes={[]}
      axisFilters={{}}
      cyclers={{
        cycleAxisState: () => {},
        cycleAxisStateReverse: () => {},
        cycleAxisCombineMode: () => {},
        cycleAxisCombineModeReverse: () => {},
        cycleAxisExclusionMode: () => {},
        cycleAxisExclusionModeReverse: () => {},
        axisIncludeAll: () => {},
        axisExcludeAll: () => {},
        axisClear: () => {},
      }}
      activeFilterCount={0}
      onResetFilters={() => setSearch('')}
      columns={columns}
      columnsLocalStorageKey="dauligor.featListColumns"
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
