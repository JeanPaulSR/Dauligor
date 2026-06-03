import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCompendiumHashLink } from '../../lib/useCompendiumHashLink';
import { Button } from '../../components/ui/button';
import { fetchCollection } from '../../lib/d1';
import { cn } from '../../lib/utils';
import { type FilterSection } from '../../components/compendium/SectionFilterPanel';
import {
  CompendiumBrowserShell,
  type CompendiumColumn,
} from '../../components/compendium/CompendiumBrowserShell';
import { matchesSingleAxisFilter } from '../../lib/spellFilters';
import { useAxisFilters } from '../../hooks/useAxisFilters';

/**
 * Public facilities (Bastions) browser — thin wrapper around
 * `CompendiumBrowserShell`. Mirrors FeatList's structure but with the
 * facility-specific data load + filter axes.
 *
 * Detail panel is inline (no FacilityDetailPanel component yet; the
 * catalog is small enough that the inline render below is fine).
 * If facility content scales past ~50 rows, extract the panel into
 * src/components/compendium/FacilityDetailPanel.tsx alongside Feat/
 * Spell panels.
 */

type SourceRecord = {
  id: string;
  name?: string;
  abbreviation?: string;
  shortName?: string;
  [key: string]: any;
};

type FacilityRow = {
  id: string;
  name?: string;
  identifier?: string;
  facility_type?: string;
  facility_subtype?: string;
  size?: string;
  level?: number;
  built?: number;
  free?: number;
  disabled?: number;
  facility_order?: string;
  source_id?: string;
  description?: string;
  page?: string;
  [key: string]: any;
};

const FACILITY_TYPE_LABEL: Record<string, string> = {
  basic: 'Basic',
  special: 'Special',
};

const SIZE_LABEL: Record<string, string> = {
  cramped: 'Cramped',
  roomy: 'Roomy',
  vast: 'Vast',
};

const ORDER_LABEL: Record<string, string> = {
  build: 'Build',
  change: 'Change',
  craft: 'Craft',
  empower: 'Empower',
  enlarge: 'Enlarge',
  harvest: 'Harvest',
  maintain: 'Maintain',
  recruit: 'Recruit',
  repair: 'Repair',
  research: 'Research',
  trade: 'Trade',
};

const AXIS_KEYS = ['source', 'type', 'size'] as const;

// Stable empties for the favorites-pane no-op wiring (the shell
// requires the props even when the consumer isn't using them).
// Top-level constants so React doesn't see a new Set / new fn on
// every render — that would re-key the shell's favorites memoisation.
const EMPTY_FAVORITES = new Set<string>();
const noop = () => {};

export default function FacilitiesList({ userProfile }: { userProfile: any }) {
  const [facilities, setFacilities] = useState<FacilityRow[]>([]);
  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');

  const { axisFilters, cyclers, activeFilterCount, resetAll: resetFilters } =
    useAxisFilters(AXIS_KEYS);

  useEffect(() => {
    const loadFacilities = async () => {
      setLoading(true);
      try {
        const rows = await fetchCollection<FacilityRow>('facilities', { orderBy: 'name ASC' });
        setFacilities(rows);
      } catch (err) {
        console.error('[FacilitiesList] failed to load facilities:', err);
      } finally {
        setLoading(false);
      }
    };
    const loadSources = async () => {
      try {
        const data = await fetchCollection<SourceRecord>('sources', { orderBy: 'name ASC' });
        setSources(data);
      } catch (err) {
        console.error('[FacilitiesList] failed to load sources:', err);
      }
    };
    loadFacilities();
    loadSources();
  }, []);

  const sourceById = useMemo(
    () => Object.fromEntries(sources.map((s) => [s.id, s])) as Record<string, SourceRecord>,
    [sources],
  );

  // Hash deep-link (`#identifier_abbrev`). Same hook FeatList /
  // SpellList / ItemList use — see `src/lib/useCompendiumHashLink.ts`.
  // Facilities rows keep snake_case `source_id`; the hook accepts
  // either form.
  useCompendiumHashLink({
    rows: facilities,
    sources,
    sourceById,
    selectedId,
    setSelectedId,
  });

  const filtered = useMemo(() => {
    const lowered = search.trim().toLowerCase();
    return facilities.filter((row) => {
      const sourceRecord = sourceById[String(row.source_id ?? '')];
      const sourceAbbrev = String(
        sourceRecord?.abbreviation || sourceRecord?.shortName || '',
      ).toLowerCase();
      const matchesSearch =
        !lowered
        || String(row.name ?? '').toLowerCase().includes(lowered)
        || String(row.identifier ?? '').toLowerCase().includes(lowered)
        || String(row.facility_subtype ?? '').toLowerCase().includes(lowered)
        || sourceAbbrev.includes(lowered);

      return (
        matchesSearch
        && matchesSingleAxisFilter(String(row.source_id ?? ''), axisFilters.source)
        && matchesSingleAxisFilter(String(row.facility_type ?? ''), axisFilters.type)
        && matchesSingleAxisFilter(String(row.size ?? ''), axisFilters.size)
      );
    });
  }, [facilities, sourceById, search, axisFilters]);

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
      key: 'type', name: 'Facility Type', kind: 'axis',
      values: [
        { value: 'basic', label: 'Basic' },
        { value: 'special', label: 'Special' },
      ],
    },
    {
      key: 'size', name: 'Size', kind: 'axis',
      values: [
        { value: 'cramped', label: 'Cramped' },
        { value: 'roomy', label: 'Roomy' },
        { value: 'vast', label: 'Vast' },
      ],
    },
  ]), [sources]);

  // ─── Column descriptors ──────────────────────────────────────
  const renderSourceAbbreviation = (row: FacilityRow) => {
    const sourceRecord = sourceById[String(row.source_id ?? '')];
    return sourceRecord?.abbreviation || sourceRecord?.shortName || '—';
  };

  const columns = useMemo<CompendiumColumn<FacilityRow>[]>(() => ([
    {
      key: 'name',
      label: 'Name',
      width: 'minmax(0,1fr)',
      alwaysVisible: true,
      align: 'start',
      render: (row) => (
        <div className="min-w-0 flex items-center gap-1.5">
          <span className="truncate font-serif text-sm text-ink">{row.name}</span>
          {row.disabled ? (
            <span title="Disabled (forces repair)" className="text-[9px] uppercase tracking-widest text-blood/70 font-bold shrink-0">⚠</span>
          ) : null}
          {row.facility_order ? (
            <span
              title={`Active order: ${ORDER_LABEL[row.facility_order] || row.facility_order}`}
              className="text-[9px] uppercase tracking-widest text-sky-400/70 font-bold shrink-0"
            >
              {row.facility_order.slice(0, 4)}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'type',
      label: 'Type',
      width: '90px',
      render: (row) => (
        <span className="text-xs text-ink/75 truncate justify-self-center">
          {FACILITY_TYPE_LABEL[String(row.facility_type || 'basic')]}
        </span>
      ),
    },
    {
      key: 'size',
      label: 'Size',
      width: '80px',
      render: (row) => (
        <span className="text-xs text-ink/75 truncate justify-self-center">
          {SIZE_LABEL[String(row.size || 'cramped')]}
        </span>
      ),
    },
    {
      key: 'level',
      label: 'Lvl',
      width: '48px',
      render: (row) => (
        <span className="text-xs text-ink/75 justify-self-center">
          {row.level ?? '—'}
        </span>
      ),
    },
    {
      key: 'source',
      label: 'Source',
      width: '60px',
      render: (row) => (
        <span className="text-xs font-bold text-gold/85 justify-self-center">
          {renderSourceAbbreviation(row)}
        </span>
      ),
    },
  ]), [sourceById]);

  const selectedFacility = facilities.find((f) => f.id === selectedId) || null;
  const selectedSource = selectedFacility ? sourceById[String(selectedFacility.source_id ?? '')] : undefined;

  return (
    <CompendiumBrowserShell<FacilityRow>
      rows={filtered}
      allRows={facilities}
      loading={loading}
      getRowId={(row) => row.id}
      selectedId={selectedId}
      onSelect={setSelectedId}
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder="Search facility name, source, subtype"
      filterAxes={filterAxes}
      axisFilters={axisFilters}
      cyclers={cyclers}
      activeFilterCount={activeFilterCount}
      onResetFilters={resetFilters}
      columns={columns}
      columnsLocalStorageKey="dauligor.facilityListColumns"
      // Favorites pane not wired for facilities yet — the catalog is
      // small enough that pinning hasn't been requested. Hook can be
      // added later (parallel to useFeatFavorites) without touching
      // the shell. Pass empties so the shell renders without errors;
      // the pane stays effectively hidden because there are no
      // entries to show.
      favorites={EMPTY_FAVORITES}
      onToggleFavorite={noop}
      favoritesRowRender={() => null}
      favoritesEmptyMessage="Facility favorites coming in a follow-up."
      detailPanel={<FacilityDetailPanel row={selectedFacility} source={selectedSource} />}
      emptyMessage="No facilities match the current search and filters."
      trailingActions={
        userProfile?.role === 'admin' ? (
          <Link to="/compendium/facilities/manage">
            <Button type="button" variant="outline" size="sm" className="h-8 border-gold/25 text-gold hover:bg-gold/5">
              Facility Manager
            </Button>
          </Link>
        ) : null
      }
    />
  );
}

// ─── Inline detail panel ──────────────────────────────────────────

function FacilityDetailPanel({
  row,
  source,
}: {
  row: FacilityRow | null;
  source: SourceRecord | undefined;
}) {
  if (!row) {
    return (
      <div className="px-6 py-12 text-center text-ink/55">
        Select a facility from the list to view its details.
      </div>
    );
  }

  const facilityType = String(row.facility_type || 'basic');
  const typeLabel = FACILITY_TYPE_LABEL[facilityType] || facilityType;
  const sizeLabel = SIZE_LABEL[String(row.size || 'cramped')] || row.size;
  const subtype = String(row.facility_subtype || '');
  const order = String(row.facility_order || '');

  return (
    <div className="space-y-0">
      <div className="border-b border-gold/15 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),transparent)] px-6 py-5 space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <h3 className="font-serif text-3xl font-bold text-ink">{row.name || '—'}</h3>
          {source ? (
            <span className="text-xs font-bold uppercase tracking-widest text-gold">
              {source.abbreviation || source.shortName || source.name}
            </span>
          ) : null}
        </div>
        <p className="font-serif italic text-ink/75 text-sm">
          {typeLabel} facility
          {sizeLabel ? ` · ${sizeLabel}` : ''}
          {row.level ? ` · level ${row.level}` : ''}
          {row.built ? ' · built' : ''}
          {row.disabled ? ' · disabled' : ''}
        </p>
        {subtype && (
          <p className="text-xs text-ink/65">
            Subtype: <span className="font-bold text-gold/85">{humanizeSlug(subtype)}</span>
          </p>
        )}
      </div>

      {order && (
        <div className="border-b border-gold/15 px-6 py-4 grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
          <DetailRow label="Active Order" value={ORDER_LABEL[order] || order} />
          {row.progress ? (
            <>
              <DetailRow
                label="Progress"
                value={`${row.progress.value ?? 0} / ${row.progress.max ?? 0} days`}
              />
              {row.progress.pct != null ? (
                <DetailRow label="Percent" value={`${row.progress.pct}%`} />
              ) : null}
            </>
          ) : null}
        </div>
      )}

      {order === 'craft' && row.craft && (
        <div className="border-b border-gold/15 px-6 py-4 grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
          <DetailRow label="Crafting" value={row.craft.item || '—'} mono />
          <DetailRow label="Quantity" value={row.craft.quantity != null ? String(row.craft.quantity) : '—'} />
        </div>
      )}

      {order === 'trade' && row.trade && (
        <div className="border-b border-gold/15 px-6 py-4 grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
          <DetailRow label="Daily Profit" value={`${row.trade.profit ?? 0} gp`} />
          <DetailRow
            label="Stock"
            value={`${row.trade.stock?.value ?? 0} / ${row.trade.stock?.max ?? 0} gp`}
          />
          <DetailRow label="Stocked" value={row.trade.stock?.stocked ? 'Yes' : 'No'} />
        </div>
      )}

      {(row.defenders?.value?.length || row.hirelings?.value?.length) ? (
        <div className="border-b border-gold/15 px-6 py-4 grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
          {row.defenders?.value?.length ? (
            <DetailRow
              label="Defenders"
              value={`${row.defenders.value.length} / ${row.defenders.max ?? 0}`}
            />
          ) : null}
          {row.hirelings?.value?.length ? (
            <DetailRow
              label="Hirelings"
              value={`${row.hirelings.value.length} / ${row.hirelings.max ?? 0}`}
            />
          ) : null}
        </div>
      ) : null}

      {row.description ? (
        <div className="px-6 py-5 prose prose-invert max-w-none prose-p:text-ink/95">
          {typeof row.description === 'string' ? (
            <p className="whitespace-pre-wrap">{row.description}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-gold/75">{label}</div>
      <div className={cn('mt-1 text-sm text-ink/95', mono && 'font-mono text-xs')}>{value || '—'}</div>
    </div>
  );
}

// Subtype slugs are camelCase (arcaneStudy / meditationChamber / etc.).
// Convert to "Arcane Study" / "Meditation Chamber" for display.
function humanizeSlug(slug: string): string {
  return slug
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}
