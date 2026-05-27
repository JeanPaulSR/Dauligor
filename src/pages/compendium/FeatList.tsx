import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Star, X } from 'lucide-react';
import { auth } from '../../lib/firebase';
import { fetchCollection } from '../../lib/d1';
import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { type FilterSection } from '../../components/compendium/SectionFilterPanel';
import {
  CompendiumBrowserShell,
  type CompendiumColumn,
} from '../../components/compendium/CompendiumBrowserShell';
import { matchesSingleAxisFilter, matchesMultiAxisFilter } from '../../lib/spellFilters';
import { useAxisFilters } from '../../hooks/useAxisFilters';
import { useFeatFavorites } from '../../lib/featFavorites';
import FeatDetailPanel from '../../components/compendium/FeatDetailPanel';
import {
  FEAT_PROPERTY_LABELS,
  FEAT_PROPERTY_ORDER,
  FEAT_TYPE_LABELS,
  FEAT_TYPE_ORDER,
  deriveFeatPropertyFlags,
  type FeatTypeValue,
} from '../../lib/featFilters';

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
  repeatable?: boolean;
  requirements?: string;
  repeatableFlag?: boolean;
  hasUses?: boolean;
  hasActivities?: boolean;
  hasEffects?: boolean;
  hasPrereqs?: boolean;
  [key: string]: any;
};

// Declared axis keys — drives the activeFilterCount tally inside
// useAxisFilters so stale keys (e.g. removed axes) don't inflate
// the badge.
const AXIS_KEYS = ['source', 'type', 'property'] as const;

export default function FeatList({ userProfile }: { userProfile: any }) {
  const [feats, setFeats] = useState<FeatRow[]>([]);
  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [loadingFeats, setLoadingFeats] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedFeatId, setSelectedFeatId] = useState('');

  const { axisFilters, cyclers, activeFilterCount, resetAll: resetFilters } =
    useAxisFilters(AXIS_KEYS);

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
          return {
            ...row,
            sourceId: row.source_id,
            featType: row.feat_type,
            featSubtype: row.feat_subtype || '',
            repeatable: !!row.repeatable,
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
        const sourcesData = await fetchCollection<any>('sources', { orderBy: 'name ASC' });
        setSources(sourcesData);
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

  // Filter pipeline. Search + axis filters + class scope all AND
  // together. Lives here (not in the shell) because the entity
  // determines what "matching" means.
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

      const propsHave = new Set<string>();
      for (const p of FEAT_PROPERTY_ORDER) {
        const flagKey = p === 'repeatable' ? 'repeatableFlag' : p;
        if ((feat as any)[flagKey]) propsHave.add(p);
      }
      return (
        matchesSearch
        && matchesSingleAxisFilter(String(feat.sourceId ?? ''), axisFilters.source)
        && matchesSingleAxisFilter(String(feat.featType ?? ''), axisFilters.type)
        && matchesMultiAxisFilter(propsHave, axisFilters.property)
      );
    });
  }, [feats, sourceById, search, axisFilters, classScopeIdentifier]);

  const filterAxes = useMemo<FilterSection[]>(() => ([
    {
      key: 'source', name: 'Sources', kind: 'axis',
      values: sources.map((s) => ({
        value: s.id,
        label: String(s.abbreviation || s.shortName || s.name || s.id),
        labelAlt: String(s.name || s.shortName || s.abbreviation || s.id),
      })),
    },
    {
      key: 'type', name: 'Feat Type', kind: 'axis',
      values: FEAT_TYPE_ORDER.map((value) => ({ value, label: FEAT_TYPE_LABELS[value] })),
    },
    {
      key: 'property', name: 'Properties', kind: 'axis',
      values: FEAT_PROPERTY_ORDER.map((value) => ({ value, label: FEAT_PROPERTY_LABELS[value] })),
    },
  ]), [sources]);

  // ─── Column descriptors ──────────────────────────────────────
  const renderSourceAbbreviation = (feat: FeatRow) => {
    const sourceRecord = sourceById[String(feat.sourceId ?? '')];
    return sourceRecord?.abbreviation || sourceRecord?.shortName || '—';
  };

  const columns = useMemo<CompendiumColumn<FeatRow>[]>(() => ([
    {
      key: 'name',
      label: 'Name',
      width: 'minmax(0,1fr)',
      alwaysVisible: true,
      align: 'start',
      render: (feat) => {
        const starred = isFavorite(feat.id);
        // Only the favorite star renders alongside the name now. The
        // prerequisite lock and repeatable arrow are gone — when the
        // Prerequisite column lands they'll live there, and the
        // repeatable signal will surface in the detail view rather
        // than as a row chip.
        return (
          <div className="min-w-0 flex items-center gap-1.5">
            <span className="truncate font-serif text-sm text-ink">{feat.name}</span>
            {starred && (
              <Star className="w-3 h-3 text-gold/70 fill-gold/40 shrink-0" aria-label="Favorite" />
            )}
          </div>
        );
      },
    },
    {
      key: 'type',
      label: 'Type',
      width: '120px',
      render: (feat) => {
        const label = FEAT_TYPE_LABELS[feat.featType as FeatTypeValue] || feat.featType || 'Feat';
        return <span className="text-xs text-ink/75 truncate justify-self-center">{label}</span>;
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
  ]), [isFavorite, sourceById]);

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
      filterAxes={filterAxes}
      axisFilters={axisFilters}
      cyclers={cyclers}
      activeFilterCount={activeFilterCount}
      onResetFilters={resetFilters}
      columns={columns}
      columnsLocalStorageKey="dauligor.featListColumns"
      favorites={favorites}
      onToggleFavorite={toggleFavorite}
      favoritesRowRender={favoritesRowRender}
      favoritesEmptyMessage="Star a feat to pin it here."
      detailPanel={<FeatDetailPanel featId={selectedFeatId || null} />}
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
