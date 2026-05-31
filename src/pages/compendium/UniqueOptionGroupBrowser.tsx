// =============================================================================
// UniqueOptionGroupBrowser — 3-pane browse surface for modular option groups.
// =============================================================================
//
// Replaces the old card-grid list (UniqueOptionGroupList) AND the single-group
// read view (UniqueOptionGroupView). Mirrors the visual idioms of
// CompendiumBrowserShell / SpellList (fullscreen body lock, paneHeight tracking,
// gold/parchment Cards, selected/hover rows, <lg single-pane drilldown) but
// with a groups→options→detail interaction instead of favorites|list|detail:
//
//   ┌─ Groups ──┐┌─ Options ───┐┌─ Detail ─────────┐
//   │ Invocations││ Agonizing   ││ <option name>    │
//   │ Maneuvers ▸││ Eldritch  ▸ ││ requirements,    │
//   │ + New      ││             ││ uses, BBCode desc│
//   └────────────┘└─────────────┘└──────────────────┘
//
// Selecting a GROUP (left) loads + lists its OPTIONS (middle); selecting an
// OPTION shows its DETAIL (right). Editing is out of scope here — the group
// header links out to the comprehensive UniqueOptionGroupEditor. Reads an
// optional `:id` param to deep-link/preselect a group (so the old
// /compendium/unique-options/:id view URLs still resolve).
//
// Browse-only: all reads via the d1 helpers, no proposal flow. The proposal
// authoring surface (/proposals/edit/option-groups) is a separate concern and
// keeps using the wrapped UniqueOptionGroupList.
// =============================================================================

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Card, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import BBCodeRenderer from '../../components/BBCodeRenderer';
import {
  Plus, Repeat, BookOpen, Edit, ChevronRight, CornerLeftUp, Layers,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { fetchCollection, fetchDocument } from '../../lib/d1';
import { denormalizeCompendiumData } from '../../lib/compendium';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useAxisFilters, type AxisState } from '../../hooks/useAxisFilters';
import { matchesSingleAxisFilter, matchesMultiAxisFilter } from '../../lib/spellFilters';
import { FilterBar } from '../../components/compendium/FilterBar';
import { SectionFilterPanel, type FilterSection } from '../../components/compendium/SectionFilterPanel';
import {
  parseRequirementTree,
  resolveDetailPrereq,
  type Requirement,
  type RequirementFormatLookup,
} from '../../lib/requirements';
import { slugifyReferenceSegment } from '../../lib/referenceSyntax';

type GroupRow = {
  id: string;
  name: string;
  description?: string;
  source_id?: string;
  sourceId?: string;
  class_ids?: string[];
  classIds?: string[];
  __draft?: boolean;
};
type ItemRow = {
  id: string;
  name: string;
  description?: string;
  iconUrl?: string | null;
  icon_url?: string | null;
  usesMax?: string | number | null;
  usesRecovery?: string | null;
  level_prereq?: number | null;
  levelPrereq?: number | null;
  level_prereq_is_total?: boolean | null;
  levelPrereqIsTotal?: boolean | null;
  // Free-text prerequisite override (the `string_prerequisite` column).
  // Mirrors feats: when present it wins over the structured tree.
  stringPrerequisite?: string | null;
  string_prerequisite?: string | null;
  requirementsTree?: Requirement | null;
};
// Reuse the canonical lookup type so the keys always match what the
// requirement formatter reads (same contract feats use).
type ReqLookup = RequirementFormatLookup;

// Which pane is visible in the <lg single-pane drilldown.
type NarrowView = 'groups' | 'options' | 'detail';

export default function UniqueOptionGroupBrowser({ userProfile }: { userProfile: any }) {
  const { id: routeGroupId } = useParams();
  const navigate = useNavigate();

  const isAdmin = userProfile?.role === 'admin' || userProfile?.role === 'co-dm';
  const isContentCreator = !!userProfile?.permissions &&
    Object.prototype.hasOwnProperty.call(userProfile.permissions, 'content-creator');
  const canManage = isAdmin || isContentCreator;

  // ─── Data ───────────────────────────────────────────────────────
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [search, setSearch] = useState('');
  // Class id → name, for the Groups class-restriction filter axis.
  const [classNameById, setClassNameById] = useState<Record<string, string>>({});

  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(routeGroupId ?? null);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [itemSearch, setItemSearch] = useState('');

  // Independent filter state per pane (shared useAxisFilters semantics).
  // Groups: Source (single) + Class restriction (multi — a group can list
  // several classes). Options: Level bucket (single) + boolean Traits
  // (multi — repeatable / has-activities / has-effects).
  const groupFilters = useAxisFilters(['source', 'class'] as const);
  const optionFilters = useAxisFilters(['level', 'traits'] as const);

  // Foundation lookups (sources + name maps for requirement formatting).
  const [sourceNameById, setSourceNameById] = useState<Record<string, string>>({});
  const [reqLookup, setReqLookup] = useState<ReqLookup>({
    classNameById: {}, subclassNameById: {}, spellRuleNameById: {}, optionItemNameById: {},
  });

  // ─── Responsive drilldown ───────────────────────────────────────
  const isLg = useMediaQuery('(min-width: 1024px)');
  const [narrowView, setNarrowView] = useState<NarrowView>('groups');

  // ─── Viewport lock + pane height (mirrors CompendiumBrowserShell) ─
  useEffect(() => {
    document.body.classList.add('spell-list-fullscreen');
    return () => document.body.classList.remove('spell-list-fullscreen');
  }, []);
  const [paneHeight, setPaneHeight] = useState<number>(() =>
    typeof window === 'undefined' ? 720 : Math.max(420, window.innerHeight - 140),
  );
  useEffect(() => {
    const onResize = () => setPaneHeight(Math.max(420, window.innerHeight - 140));
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // ─── Load groups + foundation once ──────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setGroupsLoading(true);
      try {
        // Foundation lookups for requirement-tree formatting. Superset of
        // what the old View loaded (class/subclass/spellRule/optionItem,
        // keyed by id) PLUS the proficiency collections the feat detail
        // surface resolves (skill/tool/weapon/armor/language, keyed by
        // `identifier`) and feature/spell name maps — so option prereqs
        // render with the SAME functionality as feats' requirements.
        const [
          groupRows, sourceRows, classRows, subclassRows, ruleRows, allItems,
          featureRows, spellRows, skillRows, toolRows, weaponRows, armorRows, languageRows,
        ] = await Promise.all([
          fetchCollection<GroupRow>('uniqueOptionGroups', { orderBy: 'name ASC' }),
          fetchCollection<{ id: string; name: string }>('sources', { orderBy: 'name ASC' }),
          fetchCollection<{ id: string; name: string }>('classes', { orderBy: 'name ASC' }),
          fetchCollection<{ id: string; name: string }>('subclasses', { orderBy: 'name ASC' }),
          fetchCollection<{ id: string; name: string }>('spellRules', { orderBy: 'name ASC' }),
          fetchCollection<{ id: string; name: string }>('uniqueOptionItems', { orderBy: 'name ASC' }),
          fetchCollection<{ id: string; name: string }>('features', { orderBy: 'name ASC' }),
          fetchCollection<{ id: string; name: string }>('spells', { orderBy: 'name ASC' }),
          fetchCollection<any>('skills', { orderBy: 'name ASC' }),
          fetchCollection<any>('tools', { orderBy: 'name ASC' }),
          fetchCollection<any>('weapons', { orderBy: 'name ASC' }),
          fetchCollection<any>('armor', { orderBy: 'name ASC' }),
          fetchCollection<any>('languages', { orderBy: 'name ASC' }),
        ]);
        if (cancelled) return;
        const byId = (rows: { id: string; name: string }[]) =>
          Object.fromEntries(rows.map((r) => [r.id, r.name]));
        // Proficiency leaves key on `identifier` (e.g. "ath" → "Athletics"),
        // matching FeatDetailPanel's slug-resolution lookup.
        const byIdent = (rows: any[]) =>
          Object.fromEntries(
            (rows || [])
              .filter((r) => r?.identifier)
              .map((r) => [String(r.identifier), String(r.name || r.identifier)]),
          ) as Record<string, string>;
        setGroups(groupRows);
        setSourceNameById(Object.fromEntries(sourceRows.map((s) => [s.id, s.name])));
        setClassNameById(byId(classRows));
        setReqLookup({
          classNameById: byId(classRows),
          subclassNameById: byId(subclassRows),
          spellRuleNameById: byId(ruleRows),
          optionItemNameById: byId(allItems),
          featureNameById: byId(featureRows),
          spellNameById: byId(spellRows),
          skillNameById: byIdent(skillRows),
          toolNameById: byIdent(toolRows),
          weaponNameById: byIdent(weaponRows),
          armorNameById: byIdent(armorRows),
          languageNameById: byIdent(languageRows),
        });
      } catch (err) {
        console.error('[UniqueOptionGroupBrowser] failed to load groups:', err);
      } finally {
        if (!cancelled) setGroupsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ─── Load the selected group's items ────────────────────────────
  useEffect(() => {
    if (!selectedGroupId) {
      setItems([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setItemsLoading(true);
      try {
        const itemRows = await fetchCollection('uniqueOptionItems', {
          where: 'group_id = ?',
          params: [selectedGroupId],
          orderBy: 'name ASC',
        });
        if (cancelled) return;
        setItems((itemRows as any[]).map((row) => {
          const denorm = denormalizeCompendiumData(row);
          return {
            ...denorm,
            requirementsTree: parseRequirementTree(
              denorm.requirementsTree ?? denorm.requirements_tree,
            ),
            levelPrereqIsTotal: Boolean(
              denorm.levelPrereqIsTotal ?? denorm.level_prereq_is_total,
            ),
          };
        }));
      } catch (err) {
        console.error('[UniqueOptionGroupBrowser] failed to load options:', err);
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setItemsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedGroupId]);

  // Preselect from the route id once groups are loaded (deep-link support).
  useEffect(() => {
    if (routeGroupId && groups.some((g) => g.id === routeGroupId)) {
      setSelectedGroupId(routeGroupId);
    }
  }, [routeGroupId, groups]);

  // ─── Hash deep-link (`#group-slug` or `#group-slug:item-slug`) ──
  // Mirrors the spell browser's #identifier_source convention, adapted
  // to the modular-options model: groups/items have no stable identifier
  // (they key by slugify(name), same as the `@option-group[group:item]`
  // cross-reference), so the hash uses those slugs. Inbound runs once per
  // mount after groups load; the item half resolves after that group's
  // items fetch (tracked via pendingItemSlug). Outbound rewrites the hash
  // via replaceState on selection so the back stack stays clean.
  const hashAppliedRef = useRef(false);
  const [pendingItemSlug, setPendingItemSlug] = useState<string | null>(null);
  useEffect(() => {
    if (hashAppliedRef.current) return;
    if (!groups.length) return;
    hashAppliedRef.current = true;
    const raw = decodeURIComponent(window.location.hash.replace(/^#/, '')).trim();
    if (!raw) return;
    const [groupSlug, itemSlug] = raw.split(':');
    const group = groups.find((g) => slugifyReferenceSegment(g.name) === groupSlug);
    if (!group) return;
    setSelectedGroupId(group.id);
    if (itemSlug) {
      setPendingItemSlug(itemSlug);
      if (!isLg) setNarrowView('detail');
    } else if (!isLg) {
      setNarrowView('options');
    }
    // slugifyReferenceSegment is module-stable; isLg read once at apply time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups]);

  // Resolve the pending item slug once the target group's items arrive.
  useEffect(() => {
    if (!pendingItemSlug || !items.length) return;
    const match = items.find((it) => slugifyReferenceSegment(it.name) === pendingItemSlug);
    if (match) setSelectedItemId(match.id);
    setPendingItemSlug(null);
  }, [pendingItemSlug, items]);

  // Outbound — rewrite the hash on selection (replaceState, no history spam).
  useEffect(() => {
    if (!selectedGroupId) return;
    const group = groups.find((g) => g.id === selectedGroupId);
    if (!group) return;
    const groupSlug = slugifyReferenceSegment(group.name);
    if (!groupSlug) return;
    const item = selectedItemId ? items.find((it) => it.id === selectedItemId) : null;
    const nextHash = item
      ? `#${groupSlug}:${slugifyReferenceSegment(item.name)}`
      : `#${groupSlug}`;
    if (window.location.hash === nextHash) return;
    window.history.replaceState(
      null, '', `${window.location.pathname}${window.location.search}${nextHash}`,
    );
  }, [selectedGroupId, selectedItemId, groups, items]);

  // ─── Groups pane filter axes (Source + Class restriction) ────────
  const groupAxes: PaneAxis[] = useMemo(() => {
    // Only surface sources / classes that actually appear on a group, so
    // the chip set stays relevant to the current catalog (12 groups).
    const sourceIds = new Set<string>();
    const classIds = new Set<string>();
    for (const g of groups) {
      const sid = g.source_id ?? g.sourceId;
      if (sid) sourceIds.add(sid);
      for (const cid of (g.class_ids ?? g.classIds ?? [])) classIds.add(cid);
    }
    const axes: PaneAxis[] = [];
    if (sourceIds.size) {
      axes.push({
        key: 'source', label: 'Source',
        values: [...sourceIds]
          .map((id) => ({ value: id, label: sourceNameById[id] ?? id }))
          .sort((a, b) => a.label.localeCompare(b.label)),
      });
    }
    if (classIds.size) {
      axes.push({
        key: 'class', label: 'Class Restriction', multi: true,
        values: [...classIds]
          .map((id) => ({ value: id, label: classNameById[id] ?? id }))
          .sort((a, b) => a.label.localeCompare(b.label)),
      });
    }
    return axes;
  }, [groups, sourceNameById, classNameById]);

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return groups.filter((g) => {
      if (q && !(g.name || '').toLowerCase().includes(q)) return false;
      const sid = g.source_id ?? g.sourceId ?? null;
      if (!matchesSingleAxisFilter(sid, groupFilters.axisFilters.source)) return false;
      const gClassIds = new Set<string>(g.class_ids ?? g.classIds ?? []);
      if (!matchesMultiAxisFilter(gClassIds, groupFilters.axisFilters.class)) return false;
      return true;
    });
  }, [groups, search, groupFilters.axisFilters]);

  const selectedGroup = useMemo(
    () => groups.find((g) => g.id === selectedGroupId) ?? null,
    [groups, selectedGroupId],
  );

  // ─── Options pane filter axes (Level bucket + boolean Traits) ────
  const levelBucket = (lvl: number | null | undefined): string => {
    const n = Number(lvl) || 0;
    if (n <= 0) return 'none';
    if (n <= 4) return '1-4';
    if (n <= 9) return '5-9';
    if (n <= 13) return '10-13';
    return '14+';
  };
  const optionAxes: PaneAxis[] = useMemo(() => {
    if (!items.length) return [];
    const buckets = new Set<string>();
    let anyRepeatable = false, anyActivities = false, anyEffects = false;
    for (const it of items) {
      buckets.add(levelBucket(it.levelPrereq ?? it.level_prereq));
      if ((it as any).isRepeatable ?? (it as any).is_repeatable) anyRepeatable = true;
      const acts = (it as any).activities;
      if (Array.isArray(acts) ? acts.length : acts) anyActivities = true;
      const fx = (it as any).effects;
      if (Array.isArray(fx) ? fx.length : fx) anyEffects = true;
    }
    const LEVEL_ORDER = ['none', '1-4', '5-9', '10-13', '14+'];
    const LEVEL_LABEL: Record<string, string> = {
      none: 'No level', '1-4': 'Lv 1–4', '5-9': 'Lv 5–9', '10-13': 'Lv 10–13', '14+': 'Lv 14+',
    };
    const axes: PaneAxis[] = [];
    // Always surface the Level axis when there are options (it always
    // yields ≥1 bucket), so the Filters button is consistently present
    // on the Options pane — same as the Groups pane. Only the buckets
    // that actually appear among this group's options are shown.
    axes.push({
      key: 'level', label: 'Level Prerequisite',
      values: LEVEL_ORDER.filter((b) => buckets.has(b)).map((b) => ({ value: b, label: LEVEL_LABEL[b] })),
    });
    const traitVals: { value: string; label: string }[] = [];
    if (anyRepeatable) traitVals.push({ value: 'repeatable', label: 'Repeatable' });
    if (anyActivities) traitVals.push({ value: 'activities', label: 'Has Activities' });
    if (anyEffects) traitVals.push({ value: 'effects', label: 'Has Effects' });
    if (traitVals.length) axes.push({ key: 'traits', label: 'Traits', multi: true, values: traitVals });
    return axes;
  }, [items]);

  const filteredItems = useMemo(() => {
    const q = itemSearch.trim().toLowerCase();
    return items.filter((it) => {
      if (q && !(it.name || '').toLowerCase().includes(q)) return false;
      if (!matchesSingleAxisFilter(levelBucket(it.levelPrereq ?? it.level_prereq), optionFilters.axisFilters.level)) return false;
      const traits = new Set<string>();
      if ((it as any).isRepeatable ?? (it as any).is_repeatable) traits.add('repeatable');
      const acts = (it as any).activities;
      if (Array.isArray(acts) ? acts.length : acts) traits.add('activities');
      const fx = (it as any).effects;
      if (Array.isArray(fx) ? fx.length : fx) traits.add('effects');
      if (!matchesMultiAxisFilter(traits, optionFilters.axisFilters.traits)) return false;
      return true;
    });
  }, [items, itemSearch, optionFilters.axisFilters]);

  const selectedItem = useMemo(
    () => items.find((it) => it.id === selectedItemId) ?? null,
    [items, selectedItemId],
  );

  const handleSelectGroup = (gid: string) => {
    setSelectedGroupId(gid);
    setSelectedItemId(null);
    if (!isLg) setNarrowView('options');
  };
  const handleSelectItem = (iid: string) => {
    setSelectedItemId(iid);
    if (!isLg) setNarrowView('detail');
  };

  // Group-level metadata for the detail/options header.
  const selectedGroupSource = useMemo(() => {
    const sid = selectedGroup?.source_id ?? selectedGroup?.sourceId;
    return sid ? sourceNameById[sid] ?? null : null;
  }, [selectedGroup, sourceNameById]);

  return (
    // max-width cap + center so the 3-pane row doesn't sprawl across an
    // ultrawide monitor (the detail pane is the only one that wants to grow,
    // and even it reads better with a bounded measure).
    <div className="flex flex-col mx-auto w-full max-w-[1400px]" style={{ height: `${paneHeight + 56}px` }}>
      {/* ── Toolbar ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 px-1 pb-3 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <Repeat className="w-5 h-5 text-gold shrink-0" />
          <h1 className="text-lg font-serif font-bold text-ink uppercase tracking-tight truncate">
            Modular Options
          </h1>
        </div>
        {canManage && (
          <div className="flex items-center gap-2 shrink-0">
            {/* Edit the selected group — disabled until one is picked, so
                the action always has a target. Sits beside New Group per
                the toolbar redesign (was a buried link in the Options
                pane header). */}
            {selectedGroup ? (
              <Link to={`/compendium/unique-options/edit/${selectedGroup.id}`}>
                <Button size="sm" variant="outline" className="gap-2 border-gold/30 text-gold hover:bg-gold/10">
                  <Edit className="w-4 h-4" /> Edit Group
                </Button>
              </Link>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled
                className="gap-2 border-gold/20 text-ink/30 cursor-not-allowed"
                title="Select a group to edit"
              >
                <Edit className="w-4 h-4" /> Edit Group
              </Button>
            )}
            <Link to="/compendium/unique-options/new">
              <Button size="sm" className="btn-gold-solid gap-2">
                <Plus className="w-4 h-4" /> New Group
              </Button>
            </Link>
          </div>
        )}
      </div>

      {/* ── 3-pane row ──────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-3">

        {/* Pane 1 — Groups */}
        <Card
          className={cn(
            'border-gold/10 bg-card/50 overflow-hidden flex-col lg:flex-none lg:basis-1/4 lg:min-w-0',
            narrowView === 'groups' ? 'flex flex-1' : 'hidden lg:flex',
          )}
          style={{ height: `${paneHeight}px` }}
        >
          <div className="border-b border-gold/10 bg-background/35 px-2 py-2 shrink-0">
            <PaneFilter
              search={search}
              setSearch={setSearch}
              placeholder="Search groups…"
              filterTitle="Filter Groups"
              axes={groupAxes}
              axisFilters={groupFilters.axisFilters}
              cyclers={groupFilters.cyclers}
              activeFilterCount={groupFilters.activeFilterCount}
              resetAll={groupFilters.resetAll}
            />
          </div>
          <CardContent className="p-0 flex-1 min-h-0 overflow-y-auto custom-scrollbar">
            {groupsLoading ? (
              <div className="px-4 py-12 text-center text-ink/45 text-sm">Loading…</div>
            ) : filteredGroups.length === 0 ? (
              <div className="px-4 py-12 text-center text-ink/40 italic text-sm">No groups found.</div>
            ) : (
              <div className="divide-y divide-gold/5">
                {filteredGroups.map((group) => {
                  const selected = group.id === selectedGroupId;
                  return (
                    <button
                      key={group.id}
                      type="button"
                      onClick={() => handleSelectGroup(group.id)}
                      className={cn(
                        'w-full text-left px-3 py-2.5 transition-colors flex items-center justify-between gap-2 group',
                        selected ? 'bg-gold/10' : 'hover:bg-gold/5',
                      )}
                    >
                      <span className="min-w-0">
                        <span className={cn(
                          'block truncate font-serif text-sm',
                          selected ? 'text-gold font-semibold' : 'text-ink',
                        )}>
                          {group.name || 'Unnamed Group'}
                        </span>
                        {group.__draft && (
                          <span className="inline-block mt-0.5 text-[8px] font-bold uppercase tracking-widest text-gold/80 bg-gold/10 border border-gold/30 px-1 py-0.5 rounded">
                            in this block
                          </span>
                        )}
                      </span>
                      <ChevronRight className={cn(
                        'w-4 h-4 shrink-0 transition-colors',
                        selected ? 'text-gold' : 'text-gold/20 group-hover:text-gold/50',
                      )} />
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pane 2 — Options in the selected group */}
        <Card
          className={cn(
            'border-gold/10 bg-card/50 overflow-hidden flex-col lg:flex-none lg:basis-1/4 lg:min-w-0',
            narrowView === 'options' ? 'flex flex-1' : 'hidden lg:flex',
          )}
          style={{ height: `${paneHeight}px` }}
        >
          {/* narrow back-nav */}
          <div className="lg:hidden flex items-center border-b border-gold/15 bg-background/35 px-2 py-1.5 shrink-0">
            <Button type="button" onClick={() => setNarrowView('groups')} variant="ghost" size="sm"
              className="text-gold gap-2 hover:bg-gold/5 px-2 h-7 text-xs">
              <CornerLeftUp className="w-3.5 h-3.5 rotate-90" /> Groups
            </Button>
          </div>
          {selectedGroup && items.length > 0 && (
            <div className="border-b border-gold/10 bg-background/35 px-2 py-2 shrink-0">
              <PaneFilter
                search={itemSearch}
                setSearch={setItemSearch}
                placeholder="Search options…"
                filterTitle="Filter Options"
                axes={optionAxes}
                axisFilters={optionFilters.axisFilters}
                cyclers={optionFilters.cyclers}
                activeFilterCount={optionFilters.activeFilterCount}
                resetAll={optionFilters.resetAll}
              />
            </div>
          )}
          <CardContent className="p-0 flex-1 min-h-0 overflow-y-auto custom-scrollbar">
            {!selectedGroup ? (
              <div className="px-4 py-12 text-center text-ink/40 italic text-sm">
                Select a group to see its options.
              </div>
            ) : itemsLoading ? (
              <div className="px-4 py-12 text-center text-ink/45 text-sm">Loading…</div>
            ) : items.length === 0 ? (
              <div className="px-4 py-12 text-center text-ink/40 italic text-sm">
                No options in this group yet.
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="px-4 py-12 text-center text-ink/40 italic text-sm">
                No options match the filter.
              </div>
            ) : (
              <div className="divide-y divide-gold/5">
                {filteredItems.map((item) => {
                  const selected = item.id === selectedItemId;
                  const level = item.levelPrereq ?? item.level_prereq ?? null;
                  const icon = item.iconUrl ?? item.icon_url ?? null;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleSelectItem(item.id)}
                      className={cn(
                        'w-full text-left px-3 py-2 transition-colors flex items-center gap-2.5',
                        selected ? 'bg-gold/10' : 'hover:bg-gold/5',
                      )}
                    >
                      <OptionIcon icon={icon} selected={selected} />
                      <span className="min-w-0">
                        <span className={cn(
                          'block truncate text-sm',
                          selected ? 'text-gold font-semibold' : 'text-ink',
                        )}>
                          {item.name || 'Unnamed option'}
                        </span>
                        {level !== null && level !== undefined && (
                          <span className="text-[10px] text-ink/45">
                            {(item.levelPrereqIsTotal ?? item.level_prereq_is_total)
                              ? `Character Lv ${level}` : `Class Lv ${level}`}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pane 3 — Detail */}
        <Card
          className={cn(
            'border-gold/10 bg-card/50 overflow-hidden flex-col flex-1 lg:flex lg:basis-1/2 lg:min-w-0',
            narrowView === 'detail' ? 'flex' : 'hidden lg:flex',
          )}
          style={{ height: `${paneHeight}px` }}
        >
          <div className="lg:hidden flex items-center border-b border-gold/15 bg-background/35 px-2 py-1.5 shrink-0">
            <Button type="button" onClick={() => setNarrowView('options')} variant="ghost" size="sm"
              className="text-gold gap-2 hover:bg-gold/5 px-2 h-7 text-xs">
              <CornerLeftUp className="w-3.5 h-3.5 rotate-90" /> Options
            </Button>
          </div>
          <CardContent className="p-0 flex-1 min-h-0 overflow-y-auto custom-scrollbar">
            <OptionDetail
              group={selectedGroup}
              groupSourceName={selectedGroupSource}
              item={selectedItem}
              reqLookup={reqLookup}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── Pane filter ──────────────────────────────────────────────────
// Per-pane search + filter, using the SAME components as Spells / Feats:
// a compact <FilterBar> toolbar (search input + Filters button + Reset)
// whose Filters button opens the real centered modal containing
// <SectionFilterPanel embedded>. So pressing Filters here gives the exact
// experience the rest of the compendium does — collapsible sections,
// 3-state chips, per-section AND/OR/XOR combinators, chip-label search,
// Show All / Hide All — just scoped to this pane's axes. Groups and
// Options each mount their own instance with independent axis sets +
// independent useAxisFilters state.
type PaneAxis = {
  key: string;
  label: string;
  multi?: boolean; // multi-valued (an entity can satisfy several) vs single
  values: { value: string; label: string }[];
};
function PaneFilter({
  search, setSearch, placeholder, filterTitle,
  axes, axisFilters, cyclers, activeFilterCount, resetAll,
}: {
  search: string;
  setSearch: (v: string) => void;
  placeholder: string;
  filterTitle: string;
  axes: PaneAxis[];
  axisFilters: Record<string, AxisState>;
  cyclers: ReturnType<typeof useAxisFilters>['cyclers'];
  activeFilterCount: number;
  resetAll: () => void;
}) {
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  // Map our PaneAxis list → the FilterSection shape SectionFilterPanel
  // reads. All axes are 'axis' kind (no tag-group hierarchy here).
  const sections: FilterSection[] = useMemo(
    () => axes.map((a) => ({
      key: a.key,
      name: a.label,
      kind: 'axis' as const,
      axisKey: a.key,
      values: a.values.map((v) => ({ value: v.value, label: v.label })),
    })),
    [axes],
  );

  return (
    <FilterBar
      hideFilters={sections.length === 0}
      hideInlineReset
      search={search}
      setSearch={setSearch}
      isFilterOpen={isFilterOpen}
      setIsFilterOpen={setIsFilterOpen}
      activeFilterCount={activeFilterCount}
      resetFilters={resetAll}
      searchPlaceholder={placeholder}
      filterTitle={filterTitle}
      renderFilters={
        <SectionFilterPanel
          embedded
          axes={sections}
          axisFilters={axisFilters}
          tagStates={EMPTY_TAG_STATES}
          setTagStates={NOOP_SET_TAG_STATES}
          cycleAxisState={cyclers.cycleAxisState}
          cycleAxisStateReverse={cyclers.cycleAxisStateReverse}
          cycleTagState={NOOP_CYCLE_TAG}
          cycleTagStateReverse={NOOP_CYCLE_TAG}
          cycleAxisCombineMode={cyclers.cycleAxisCombineMode}
          cycleAxisCombineModeReverse={cyclers.cycleAxisCombineModeReverse}
          cycleAxisExclusionMode={cyclers.cycleAxisExclusionMode}
          cycleAxisExclusionModeReverse={cyclers.cycleAxisExclusionModeReverse}
          axisIncludeAll={cyclers.axisIncludeAll}
          axisExcludeAll={cyclers.axisExcludeAll}
          axisClear={cyclers.axisClear}
          search={search}
          setSearch={setSearch}
          searchPlaceholder={placeholder}
          activeFilterCount={activeFilterCount}
          resetAll={resetAll}
        />
      }
    />
  );
}

// No tag-kind axes in this browser — SectionFilterPanel still requires
// the tag prop pair, so supply inert handlers (matches FeatList).
const NOOP_CYCLE_TAG = () => { /* no tag axes */ };
const NOOP_SET_TAG_STATES: React.Dispatch<React.SetStateAction<Record<string, number>>> = () => { /* no tag axes */ };
const EMPTY_TAG_STATES: Record<string, number> = {};

// ─── Option list-row icon ─────────────────────────────────────────
// Shows the option's icon_url when present; otherwise a small neutral
// placeholder so rows stay visually aligned (per the "type glyph, not
// clutter" preference — a single muted square, no decorative noise).
function OptionIcon({ icon, selected }: { icon: string | null; selected: boolean }) {
  if (icon) {
    return (
      <img
        src={icon}
        alt=""
        className="w-7 h-7 rounded object-cover border border-gold/15 shrink-0"
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <span
      className={cn(
        'w-7 h-7 rounded shrink-0 border flex items-center justify-center',
        selected ? 'border-gold/30 bg-gold/5' : 'border-gold/10 bg-background/40',
      )}
      aria-hidden
    >
      <Repeat className="w-3.5 h-3.5 text-gold/25" />
    </span>
  );
}

// ─── Detail pane content ──────────────────────────────────────────
// When no option is selected but a group is, shows the group blurb
// (the old View's group header). When an option is selected, shows the
// full option detail (requirements, uses, BBCode description).
function OptionDetail({
  group, groupSourceName, item, reqLookup,
}: {
  group: GroupRow | null;
  groupSourceName: string | null;
  item: ItemRow | null;
  reqLookup: ReqLookup;
}) {
  // Prerequisite display — same chain feats use (resolveDetailPrereq):
  // free-text `string_prerequisite` override wins; otherwise the
  // structured tree via formatRequirementShort. Keeps modular options in
  // lockstep with the feat detail surface.
  const reqText = useMemo(() => {
    if (!item) return null;
    const freeText = item.stringPrerequisite ?? item.string_prerequisite ?? null;
    try {
      const resolved = resolveDetailPrereq(
        { freeText, tree: item.requirementsTree ?? null },
        reqLookup,
      );
      return resolved || null;
    } catch {
      return null;
    }
  }, [item, reqLookup]);

  if (!group) {
    return (
      <div className="h-full flex items-center justify-center px-6 py-12 text-center">
        <div className="space-y-2 max-w-xs">
          <Layers className="w-7 h-7 text-gold/20 mx-auto" />
          <p className="text-sm text-ink/50 font-serif italic">
            Select a group, then an option to view its details.
          </p>
        </div>
      </div>
    );
  }

  // Group selected, no option — show the group blurb.
  if (!item) {
    return (
      <div className="px-6 py-6 space-y-4">
        <div className="flex items-center gap-3">
          <Repeat className="w-5 h-5 text-gold shrink-0" />
          <h2 className="text-2xl font-serif font-bold text-ink uppercase tracking-tight">
            {group.name}
          </h2>
        </div>
        {groupSourceName && (
          <Badge variant="outline" className="border-gold/30 text-gold/80">
            <BookOpen className="w-3 h-3 mr-1" /> {groupSourceName}
          </Badge>
        )}
        {group.description ? (
          <div className="prose prose-sm max-w-none text-ink/80">
            <BBCodeRenderer content={group.description} />
          </div>
        ) : (
          <p className="text-ink/40 italic">No description provided.</p>
        )}
        <p className="text-xs text-ink/40 italic pt-2 border-t border-gold/10">
          Select an option from the middle pane to view its full details.
        </p>
      </div>
    );
  }

  // Option selected — full detail.
  const level = item.levelPrereq ?? item.level_prereq ?? null;
  const isTotalLevel = item.levelPrereqIsTotal ?? item.level_prereq_is_total ?? false;
  const usesMax = item.usesMax ?? null;
  const usesRecovery = item.usesRecovery ?? null;

  const icon = item.iconUrl ?? item.icon_url ?? null;

  return (
    <div className="px-6 py-6 space-y-4">
      <div className="flex items-start gap-3">
        {icon && (
          <img
            src={icon}
            alt=""
            className="w-12 h-12 rounded-lg object-cover border border-gold/20 shrink-0 mt-0.5"
            referrerPolicy="no-referrer"
          />
        )}
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.2em] text-gold/60 mb-1">{group.name}</p>
          <h2 className="text-2xl font-serif font-bold text-ink">
            {item.name || 'Unnamed option'}
          </h2>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {level !== null && level !== undefined && (
          <Badge variant="outline" className="text-[10px] border-gold/30 text-gold/80">
            {isTotalLevel ? `Character Lv ${level}` : `Class Lv ${level}`}
          </Badge>
        )}
        {usesMax !== null && usesMax !== '' && (
          <Badge variant="outline" className="text-[10px] border-ink/20 text-ink/60">
            {String(usesMax)} use{String(usesMax) === '1' ? '' : 's'}{usesRecovery ? ` / ${usesRecovery}` : ''}
          </Badge>
        )}
      </div>

      {reqText && (
        <p className="text-[11px] text-ink/50 italic border-l-2 border-gold/20 pl-3">
          Requires: {reqText}
        </p>
      )}

      {item.description ? (
        <div className="prose prose-sm max-w-none text-ink/80">
          <BBCodeRenderer content={item.description} />
        </div>
      ) : (
        <p className="text-ink/40 italic text-sm">No description.</p>
      )}
    </div>
  );
}
