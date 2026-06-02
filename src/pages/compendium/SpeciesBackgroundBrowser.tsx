import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ImageOff, Star } from 'lucide-react';
import { getIdentity, onAuthChange } from '../../lib/auth';
import { fetchCollection } from '../../lib/d1';
import { bbcodeToHtml } from '../../lib/bbcode';
import { cn } from '../../lib/utils';
import { useSpeciesBackgroundFavorites } from '../../lib/speciesBackgroundFavorites';
import { Button } from '../../components/ui/button';
import {
  CompendiumBrowserShell,
  type CompendiumColumn,
} from '../../components/compendium/CompendiumBrowserShell';
import { type FilterSection } from '../../components/compendium/SectionFilterPanel';
import { useAxisFilters } from '../../hooks/useAxisFilters';
import { matchesSingleAxisFilter } from '../../lib/spellFilters';

/**
 * Public browser for the `species` + `backgrounds` tables — the view
 * surface that replaces the old "coming soon" stubs at /compendium/races
 * and /compendium/backgrounds. One component drives both via the `kind`
 * prop (mirrors SpeciesBackgroundEditor / the importer). Built on
 * CompendiumBrowserShell with `hideFavorites` (no favorites backing store
 * yet). A thumbnail in the name column surfaces imported art at a glance;
 * the detail pane renders the full entry (image, traits, advancements,
 * description).
 */

export type SpeciesBackgroundBrowserKind = 'species' | 'background';

const KIND_CFG = {
  species: {
    collection: 'species',
    singular: 'Species',
    plural: 'Species',
    managePath: '/compendium/races/manage',
    columnsKey: 'dauligor.speciesListColumns',
    searchPlaceholder: 'Search species name, identifier, or source',
  },
  background: {
    collection: 'backgrounds',
    singular: 'Background',
    plural: 'Backgrounds',
    managePath: '/compendium/backgrounds/manage',
    columnsKey: 'dauligor.backgroundListColumns',
    searchPlaceholder: 'Search background name, identifier, or source',
  },
} as const;

const CREATURE_TYPE_LABELS: Record<string, string> = {
  aberration: 'Aberration', beast: 'Beast', celestial: 'Celestial', construct: 'Construct',
  dragon: 'Dragon', elemental: 'Elemental', fey: 'Fey', fiend: 'Fiend', giant: 'Giant',
  humanoid: 'Humanoid', monstrosity: 'Monstrosity', ooze: 'Ooze', plant: 'Plant', undead: 'Undead',
};

// Stable module-level axis-key arrays so useAxisFilters doesn't re-key
// on every render (a conditional inline array would change identity).
const SPECIES_AXIS_KEYS = ['source', 'creatureType'] as const;
const BACKGROUND_AXIS_KEYS = ['source'] as const;

type Row = {
  id: string;
  name?: string;
  identifier?: string;
  sourceId?: string;
  page?: string;
  description?: string;
  imageUrl?: string;
  advancements?: any[];
  tags?: string[];
  movement?: any;
  senses?: any;
  creatureType?: any;
  wealth?: string;
  startingEquipment?: any[];
  [k: string]: any;
};

const MOVEMENT_SPEEDS: Array<[string, string]> = [
  ['walk', 'Walk'], ['fly', 'Fly'], ['swim', 'Swim'], ['climb', 'Climb'], ['burrow', 'Burrow'],
];
const SENSE_RANGES: Array<[string, string]> = [
  ['darkvision', 'Darkvision'], ['blindsight', 'Blindsight'], ['tremorsense', 'Tremorsense'], ['truesight', 'Truesight'],
];

export default function SpeciesBackgroundBrowser({
  userProfile,
  kind,
}: {
  userProfile: any;
  kind: SpeciesBackgroundBrowserKind;
}) {
  const cfg = KIND_CFG[kind];
  const isAdmin = userProfile?.role === 'admin';

  const [rows, setRows] = useState<Row[]>([]);
  const [sources, setSources] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');

  // Auth-aware favorites — userId-bound Set, merged local ↔ cloud on
  // sign-in (mirrors FeatList). Stars persist across devices when signed in.
  const [authUserId, setAuthUserId] = useState<string | null>(() => getIdentity()?.uid ?? null);
  useEffect(() => onAuthChange((id) => setAuthUserId(id?.uid ?? null)), []);
  const { favorites, isFavorite, toggleFavorite } = useSpeciesBackgroundFavorites(kind, authUserId);

  const { axisFilters, cyclers, activeFilterCount, resetAll } =
    useAxisFilters(kind === 'species' ? SPECIES_AXIS_KEYS : BACKGROUND_AXIS_KEYS);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [entryRows, sourceRows] = await Promise.all([
          fetchCollection<any>(cfg.collection, { orderBy: 'name ASC' }),
          fetchCollection<any>('sources', { orderBy: 'name ASC' }),
        ]);
        if (cancelled) return;
        setRows(entryRows);
        setSources(sourceRows);
      } catch (err) {
        console.error(`[${cfg.singular}Browser] load failed:`, err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [cfg.collection, cfg.singular]);

  const sourceById = useMemo(
    () => Object.fromEntries(sources.map((s) => [s.id, s])) as Record<string, any>,
    [sources],
  );
  const abbrevOf = (r: Row) => {
    const s = sourceById[String(r.sourceId ?? '')];
    return s ? String(s.abbreviation || s.shortName || s.name || '') : '';
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (q) {
        const hit = String(r.name ?? '').toLowerCase().includes(q)
          || String(r.identifier ?? '').toLowerCase().includes(q)
          || abbrevOf(r).toLowerCase().includes(q);
        if (!hit) return false;
      }
      if (!matchesSingleAxisFilter(String(r.sourceId ?? ''), axisFilters.source)) return false;
      if (kind === 'species' && !matchesSingleAxisFilter(String(r.creatureType?.value ?? ''), axisFilters.creatureType)) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, search, axisFilters, sourceById, kind]);

  const filterAxes = useMemo<FilterSection[]>(() => {
    const axes: FilterSection[] = [{
      key: 'source', name: 'Sources', kind: 'axis',
      values: sources.map((s) => ({
        value: s.id,
        label: String(s.abbreviation || s.shortName || s.name || s.id),
        labelAlt: String(s.name || s.shortName || s.abbreviation || s.id),
      })),
    }];
    if (kind === 'species') {
      const seen = new Set<string>();
      for (const r of rows) { const v = String(r.creatureType?.value ?? ''); if (v) seen.add(v); }
      axes.push({
        key: 'creatureType', name: 'Creature Type', kind: 'axis',
        values: Array.from(seen).sort().map((v) => ({ value: v, label: CREATURE_TYPE_LABELS[v] || v })),
      });
    }
    return axes;
  }, [sources, rows, kind]);

  const columns = useMemo<CompendiumColumn<Row>[]>(() => {
    const cols: CompendiumColumn<Row>[] = [{
      key: 'name', label: 'Name', width: 'minmax(160px,3fr)', alwaysVisible: true, align: 'start',
      render: (r) => (
        <div className="min-w-0 flex items-center gap-2">
          <Thumb src={r.imageUrl} />
          <span className="truncate font-semibold text-[12px] text-ink">{r.name || <em className="text-ink/40">Untitled</em>}</span>
          {isFavorite(r.id) && <Star className="w-2.5 h-2.5 text-gold/70 fill-gold/40 shrink-0" aria-label="Favorite" />}
        </div>
      ),
    }];
    if (kind === 'species') {
      cols.push({
        key: 'type', label: 'Type', width: 'minmax(70px,1.4fr)',
        render: (r) => {
          const v = String(r.creatureType?.value ?? '');
          const sub = String(r.creatureType?.subtype ?? '');
          const label = CREATURE_TYPE_LABELS[v] || v || '—';
          return <span className="text-[11px] text-ink truncate" title={sub ? `${label} (${sub})` : label}>{label}</span>;
        },
      });
      cols.push({
        key: 'speed', label: 'Speed', width: 'minmax(56px,1fr)', align: 'center',
        render: (r) => {
          const w = r.movement?.walk;
          return <span className="text-[11px] text-ink/80 justify-self-center">{w != null ? `${w} ${r.movement?.units || 'ft'}` : '—'}</span>;
        },
      });
    } else {
      cols.push({
        key: 'wealth', label: 'Wealth', width: 'minmax(60px,1.4fr)', align: 'center',
        render: (r) => (r.wealth
          ? <span className="text-[11px] text-ink justify-self-center">{r.wealth} gp</span>
          : <span className="text-[11px] text-ink/40 justify-self-center">—</span>),
      });
    }
    cols.push({
      key: 'source', label: 'Source', width: 'minmax(50px,1.2fr)', align: 'center',
      render: (r) => <span className="text-[11px] font-bold text-gold/80 justify-self-center">{abbrevOf(r) || '—'}</span>,
    });
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, sourceById, isFavorite]);

  const selectedRow = useMemo(
    () => filtered.find((r) => r.id === selectedId) || rows.find((r) => r.id === selectedId) || null,
    [filtered, rows, selectedId],
  );

  const favoritesRowRender = ({ row, selected, toggleStar, onSelect }: { row: Row; selected: boolean; toggleStar: () => void; onSelect: () => void }) => (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-2 px-3 py-2 text-left transition-colors',
        selected ? 'bg-gold/10' : 'hover:bg-gold/5',
      )}
    >
      <Thumb src={row.imageUrl} />
      <span className="truncate text-sm text-ink">{row.name || 'Untitled'}</span>
      <span className="text-[10px] font-bold text-gold/70">{abbrevOf(row)}</span>
      <span
        role="button"
        tabIndex={0}
        onClick={(e) => { e.stopPropagation(); toggleStar(); }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); toggleStar(); } }}
        className="text-gold/80 hover:text-blood shrink-0 cursor-pointer"
        title="Remove from favorites"
        aria-label="Remove from favorites"
      >
        <Star className="w-3.5 h-3.5 fill-current" />
      </span>
    </button>
  );

  return (
    <CompendiumBrowserShell<Row>
      rows={filtered}
      allRows={rows}
      loading={loading}
      getRowId={(r) => String(r.id)}
      selectedId={selectedId}
      onSelect={setSelectedId}
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder={cfg.searchPlaceholder}
      filterAxes={filterAxes}
      axisFilters={axisFilters}
      cyclers={cyclers}
      activeFilterCount={activeFilterCount}
      onResetFilters={() => { setSearch(''); resetAll(); }}
      filterTitle={`Filter ${cfg.plural}`}
      columns={columns}
      columnsLocalStorageKey={cfg.columnsKey}
      rowHeight={40}
      favorites={favorites}
      onToggleFavorite={toggleFavorite}
      favoritesRowRender={favoritesRowRender}
      favoritesEmptyMessage={`Star a ${cfg.singular.toLowerCase()} to pin it here.`}
      detailPanel={(
        <SBDetail
          row={selectedRow}
          kind={kind}
          sourceById={sourceById}
          isFavorite={selectedRow ? isFavorite(selectedRow.id) : false}
          onToggleFavorite={toggleFavorite}
        />
      )}
      emptyMessage={`No ${cfg.plural.toLowerCase()} yet${isAdmin ? ` — import some from the ${cfg.singular} Manager.` : '.'}`}
      trailingActions={isAdmin ? (
        <>
          <Link to={kind === 'species' ? '/compendium/species-features/manage' : '/compendium/background-features/manage'}>
            <Button type="button" variant="outline" size="sm" className="h-8 border-gold/20 text-gold hover:bg-gold/5">
              Features
            </Button>
          </Link>
          <Link to={cfg.managePath}>
            <Button type="button" variant="outline" size="sm" className="h-8 border-gold/20 text-gold hover:bg-gold/5">
              {cfg.singular} Manager
            </Button>
          </Link>
        </>
      ) : null}
    />
  );
}

// ─── List thumbnail ─────────────────────────────────────────────────

function Thumb({ src }: { src?: string }) {
  if (!src) {
    return (
      <span className="h-7 w-7 shrink-0 rounded border border-gold/10 bg-background/40 flex items-center justify-center">
        <ImageOff className="h-3.5 w-3.5 text-ink/25" />
      </span>
    );
  }
  return <img src={src} alt="" loading="lazy" className="h-7 w-7 shrink-0 rounded border border-gold/20 object-cover" />;
}

// ─── Detail pane ────────────────────────────────────────────────────

function SBDetail({
  row,
  kind,
  sourceById,
  isFavorite,
  onToggleFavorite,
}: {
  row: Row | null;
  kind: SpeciesBackgroundBrowserKind;
  sourceById: Record<string, any>;
  isFavorite: boolean;
  onToggleFavorite: (id: string) => void;
}) {
  if (!row) {
    return (
      <div className="px-6 py-16 text-center text-ink/50">
        Select a {kind === 'species' ? 'species' : 'background'} to view it.
      </div>
    );
  }

  const src = sourceById[String(row.sourceId ?? '')];
  const sourceAbbrev = src ? String(src.abbreviation || src.shortName || '') : '';
  const sourceName = src ? String(src.name || '') : '';
  const descHtml = row.description ? bbcodeToHtml(row.description) : '';
  const advancements = Array.isArray(row.advancements) ? row.advancements : [];

  const facts: Array<[string, string]> = [];
  if (kind === 'species') {
    const v = String(row.creatureType?.value ?? '');
    const sub = String(row.creatureType?.subtype ?? '');
    const ct = (CREATURE_TYPE_LABELS[v] || v || '—');
    facts.push(['Type', sub ? `${ct} (${sub})` : ct]);
    const speeds = MOVEMENT_SPEEDS
      .filter(([k]) => row.movement?.[k] != null)
      .map(([k, l]) => `${l} ${row.movement[k]} ${row.movement?.units || 'ft'}`);
    if (row.movement?.hover) speeds.push('hover');
    if (speeds.length) facts.push(['Speed', speeds.join(', ')]);
    const senses = SENSE_RANGES
      .filter(([k]) => row.senses?.[k] != null)
      .map(([k, l]) => `${l} ${row.senses[k]} ${row.senses?.units || 'ft'}`);
    if (row.senses?.special) senses.push(String(row.senses.special));
    if (senses.length) facts.push(['Senses', senses.join(', ')]);
  } else {
    if (row.wealth) facts.push(['Starting wealth', `${row.wealth} gp`]);
    const eq = Array.isArray(row.startingEquipment) ? row.startingEquipment.length : 0;
    if (eq) facts.push(['Starting equipment', `${eq} ${eq === 1 ? 'entry' : 'entries'}`]);
  }

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-start gap-4">
        {row.imageUrl ? (
          <img src={row.imageUrl} alt="" className="h-20 w-20 shrink-0 rounded-lg border border-gold/20 object-cover" />
        ) : (
          <div className="h-20 w-20 shrink-0 rounded-lg border border-gold/10 bg-background/40 flex items-center justify-center">
            <ImageOff className="h-7 w-7 text-ink/20" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="font-serif text-2xl font-bold text-ink leading-tight break-words">{row.name || 'Untitled'}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-ink/55">
            {sourceAbbrev ? <span className="font-bold text-gold/80" title={sourceName}>{sourceAbbrev}</span> : null}
            {row.identifier ? <span className="font-mono">{row.identifier}</span> : null}
            {row.page ? <span>· p.{row.page}</span> : null}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onToggleFavorite(row.id)}
          className={cn(
            'shrink-0 inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest transition-colors',
            isFavorite ? 'border-gold/40 bg-gold/10 text-gold' : 'border-gold/15 text-ink/50 hover:border-gold/30 hover:text-gold',
          )}
          title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        >
          <Star className={cn('h-3.5 w-3.5', isFavorite && 'fill-gold/40')} />
          {isFavorite ? 'Favorited' : 'Favorite'}
        </button>
      </div>

      {facts.length > 0 && (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs">
          {facts.map(([label, value]) => (
            <React.Fragment key={label}>
              <dt className="font-bold uppercase tracking-widest text-[10px] text-gold/70 pt-0.5">{label}</dt>
              <dd className="text-ink/85">{value}</dd>
            </React.Fragment>
          ))}
        </dl>
      )}

      {advancements.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] font-bold uppercase tracking-widest text-gold/70">Traits &amp; Advancements</div>
          <div className="flex flex-wrap gap-1.5">
            {advancements.map((adv: any, i: number) => (
              <span key={adv?._id || i} className="rounded border border-gold/15 bg-gold/5 px-2 py-0.5 text-[11px] text-ink/80">
                {String(adv?.title || adv?.type || 'Advancement')}
              </span>
            ))}
          </div>
        </div>
      )}

      {descHtml ? (
        <div
          className="prose prose-sm max-w-none text-ink/85 border-t border-gold/10 pt-3"
          dangerouslySetInnerHTML={{ __html: descHtml }}
        />
      ) : (
        <p className="text-xs text-ink/40 italic border-t border-gold/10 pt-3">No description.</p>
      )}
    </div>
  );
}
