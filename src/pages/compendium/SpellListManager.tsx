import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams, useLocation } from 'react-router-dom';
import { ChevronLeft, Plus, Check, X, ChevronDown, ChevronRight, ChevronUp, Lock, Scale, Tag as TagIcon, AlertTriangle, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../../components/ui/dialog';
import VirtualizedList from '../../components/ui/VirtualizedList';
import SingleSelectSearch from '../../components/ui/SingleSelectSearch';
import { FilterBar, TagGroupFilter, AxisFilterSection, matchesTagFilters } from '../../components/compendium/FilterBar';
import SpellDetailPanel from '../../components/compendium/SpellDetailPanel';
import { fetchCollection } from '../../lib/d1';
import { fetchSpellSummaries } from '../../lib/spellSummary';
import { expandTagsWithAncestors, normalizeTagRow, orderTagsAsTree, buildTagIndex } from '../../lib/tagHierarchy';
import { cn } from '../../lib/utils';
import { SCHOOL_LABELS } from '../../lib/spellImport';
import {
  fetchClassSpellIds,
  fetchClassSpellMembershipIds,
  fetchClassesForSpells,
  type ClassMembership,
} from '../../lib/classSpellLists';
import {
  getConsumerExcludedSpells,
  invalidateCache,
  type ExcludedSpell,
} from '../../lib/spellListResolver';
import { useProposalAccumulator, useProposalContextOptional } from '../../lib/proposalAccumulator';
import { useProposalReview, resolveReviewPayload } from '../../lib/proposalReview';
import { useBlock } from '../../lib/proposalBlock';
import {
  fetchAppliedRulesFor,
  unapplyRule,
  applyRule,
  fetchAllRules,
  spellMatchesRule,
  explainSpellMatch,
  addSpellToRuleManual,
  removeSpellFromRuleManual,
  addRuleManualExclusion,
  removeRuleManualExclusion,
  type SpellRule,
  type RuleExplanation,
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
  getClauses,
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

/**
 * `classes.spellcasting` is a nullable JSON column. Non-casters
 * (Fighter, Barbarian, Rogue, …) store NULL; casters store a JSON
 * object whose `hasSpellcasting` flag is the authoritative bit (a
 * blob can sit there with `hasSpellcasting: false` if an editor
 * cleared it without nulling the column). Accept both the auto-
 * parsed-object shape (queryD1 has a json-column allowlist) and
 * the raw-string fallback.
 */
function isCastingClass(spellcasting: unknown): boolean {
  if (spellcasting === null || spellcasting === undefined) return false;
  if (typeof spellcasting === 'string') {
    const trimmed = spellcasting.trim();
    if (!trimmed) return false;
    try {
      const parsed = JSON.parse(trimmed);
      return !!parsed && typeof parsed === 'object' && parsed.hasSpellcasting === true;
    } catch {
      return false;
    }
  }
  if (typeof spellcasting === 'object') {
    return (spellcasting as { hasSpellcasting?: unknown }).hasSpellcasting === true;
  }
  return false;
}

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
  // Admins write through class_spell_lists directly; content-creators
  // route through the proposal queue. Bulk operations (Add all / Bulk
  // remove / Rebuild from rules) and rule linking stay admin-only —
  // they touch more rows than the single-revision proposal shape can
  // capture today.
  const isAdmin = userProfile?.role === 'admin';
  const isContentCreator = !!userProfile?.permissions &&
    Object.prototype.hasOwnProperty.call(userProfile.permissions, 'content-creator');
  const canManageLists = isAdmin || isContentCreator;
  // Inside <ProposalEditorWrapper> queues locally; outside the
  // wrapper passes through to useEntityWriter unchanged.
  const listWriter = useProposalAccumulator('class_spell_list', userProfile);
  // Cross-editor links (to Spell Rules) need to stay on the same
  // route prefix so content-creators on /proposals/edit/spell-lists
  // don't bounce into the AdminOnly-guarded /compendium/spell-rules.
  // The Back link walks one level up: /compendium/classes on the
  // admin route, /my-proposals on the proposal route.
  const location = useLocation();
  const isProposalRoute = location.pathname.startsWith('/proposals/edit/');
  const editorPrefix = isProposalRoute ? '/proposals/edit' : '/compendium';
  const backPath = isProposalRoute ? '/my-proposals' : '/compendium/classes';
  // Both `proposal` (single-revision submit) and `block` (staging
  // into a draft bundle) route mutations through the writer instead
  // of the direct-write d1 helpers — the writer's create/update/
  // remove handle the bundle_id + is_draft branching internally.
  // Without the `block` half of this OR, a content-creator in
  // block mode would fall through to `addSpellsToClassList`, hit
  // the proxy's admin gate, and 403 with "Admin access required."
  const isProposalMode = listWriter.mode === 'proposal' || listWriter.mode === 'block';
  const [searchParams, setSearchParams] = useSearchParams();

  // Fullscreen-page opt-in. Same body class /compendium/spells and
  // /compendium/spells/manage use — strips <main>'s container
  // padding, hides the footer, locks body scroll so each pane
  // handles its own overflow.
  useEffect(() => {
    if (!canManageLists) return;
    document.body.classList.add('spell-list-fullscreen');
    return () => document.body.classList.remove('spell-list-fullscreen');
  }, [canManageLists]);

  // Pane height — derived as
  //
  //   paneHeight = viewportHeight - grid.top - bottomBuffer
  //
  // where `grid.top` is `gridContainerRef.current.getBoundingClientRect().top`
  // (so it captures the cumulative height of EVERY rendered element
  // above the cards: the navbar, the page toolbar with the back/class
  // selector, the Linked Rules panel in whatever expand state it's
  // currently in, the filter bar, all of it).
  //
  // Earlier approaches:
  //   - `window.innerHeight - 260` (magic chrome estimate) ignored
  //     Linked Rules' expand state and pushed cards past the bottom.
  //   - ResizeObserver on the grid container only fires when the grid
  //     itself resizes, but in a flex parent whose own height isn't
  //     bound to viewport (the case here — `<main>` is auto-height
  //     under `body.spell-list-fullscreen`), the grid's flex-1 doesn't
  //     actually distribute viewport-minus-chrome — it gets whatever
  //     leftover space the auto-height parent grants, which is too
  //     small. Cards collapsed to ~280px tall with a sea of empty
  //     space underneath.
  //
  // Viewport-anchored math is robust to either layout shape: it asks
  // "how many pixels are between the top of the cards and the bottom
  // of the viewport" and gives them all to the cards.
  //
  // Re-measure triggers:
  //   - Window resize.
  //   - ResizeObserver on the PARENT of the grid (the page root). When
  //     anything inside the root changes height (Linked Rules toggle,
  //     filter bar expand, toolbar wraps to two lines on a narrow
  //     viewport), the root's own clientHeight changes and the
  //     observer fires. We don't care about the new size — we just
  //     use it as a signal to re-measure the grid's bounding rect.
  const gridContainerRef = useRef<HTMLDivElement | null>(null);
  const [paneHeight, setPaneHeight] = useState<number>(() =>
    typeof window === 'undefined' ? 720 : Math.max(420, window.innerHeight - 260),
  );
  useEffect(() => {
    const el = gridContainerRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      // 12px bottom buffer: 8 to absorb sub-pixel rounding cascading
      // through nested flex/grid (same reason as the earlier `-8`),
      // plus 4 to keep the bottom card edge clear of the viewport
      // line at standard zoom.
      const available = window.innerHeight - rect.top - 12;
      setPaneHeight((prev) => {
        const next = Math.max(240, available);
        return next === prev ? prev : next;
      });
    };
    measure();
    window.addEventListener('resize', measure);
    // Observe the page root — its content height changes when chrome
    // above the grid expands/collapses, even if the grid's own size
    // stays the same.
    const root = el.parentElement;
    const ro = root ? new ResizeObserver(measure) : null;
    if (root && ro) ro.observe(root);
    return () => {
      window.removeEventListener('resize', measure);
      ro?.disconnect();
    };
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
  // Proposal-mode delete proposals need the membership row id, not
  // just the spell id (the writer requires entity_id). Loaded lazily
  // alongside `classListIds` when the user holds content-creator but
  // not admin. Empty in admin mode — the direct-write helper deletes
  // by composite key and doesn't need the lookup.
  const [classMembershipIds, setClassMembershipIds] = useState<Map<string, string>>(new Map());
  const [classListLoading, setClassListLoading] = useState(false);

  // Spell ids the user has staged in the active block for the
  // currently-selected class. Drives the row-highlight in the spell
  // list. Three sources of "staged":
  //   1. Queue entries with op='create' + payload.class_id matching
  //      the selected class → spell_id is staged for ADD.
  //   2. Queue entries with op='delete' + entity_id matching a row in
  //      classMembershipIds → reverse-lookup gives spell_id (a stage
  //      for REMOVAL of an existing pin).
  //   3. Same as (1) + (2) for server-side draft revisions in the
  //      active bundle.
  // Empty set outside a <ProposalEditorWrapper>.
  const proposalContext = useProposalContextOptional();
  const { drafts: allDrafts, activeBundleId } = useBlock();
  const stagedSpellIds = useMemo(() => {
    const ids = new Set<string>();
    if (!selectedClassId) return ids;
    // Build reverse map: membership row id → spell id (so we can
    // resolve delete drafts whose entity_id is the row id).
    const rowIdToSpellId = new Map<string, string>();
    for (const [spellId, rowId] of classMembershipIds.entries()) {
      rowIdToSpellId.set(rowId, spellId);
    }
    const consider = (
      entityType: string,
      operation: string,
      entityId: string | null,
      payload: any,
    ) => {
      if (entityType !== 'class_spell_list') return;
      if (operation === 'create') {
        if (!payload || payload.class_id !== selectedClassId) return;
        if (typeof payload.spell_id === 'string') ids.add(payload.spell_id);
      } else if (operation === 'delete') {
        if (!entityId) return;
        const spellId = rowIdToSpellId.get(entityId);
        if (spellId) ids.add(spellId);
      }
    };
    if (proposalContext) {
      for (const q of proposalContext.queue) {
        consider(q.entity_type, q.operation, q.entity_id, q.proposed_payload);
      }
    }
    if (activeBundleId) {
      for (const d of allDrafts) {
        if (d.bundle_id !== activeBundleId) continue;
        consider(d.entity_type, d.operation, d.entity_id, d.proposed_payload);
      }
    }
    return ids;
  }, [
    proposalContext,
    allDrafts,
    activeBundleId,
    selectedClassId,
    classMembershipIds,
  ]);

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
  const [linkedRulesExpanded, setLinkedRulesExpanded] = useState(true);
  const [linkRuleDialogOpen, setLinkRuleDialogOpen] = useState(false);
  const [pendingSpellIds, setPendingSpellIds] = useState<Set<string>>(new Set());
  const [selectedSpellIds, setSelectedSpellIds] = useState<Set<string>>(new Set());
  const [bulkPending, setBulkPending] = useState(false);
  const [previewSpellId, setPreviewSpellId] = useState<string | null>(null);
  // Right-pane "Show Rule Match" disclosure — collapsed by default,
  // mirrors the "Show Tags" disclosure pattern in SpellDetailPanel.
  // When closed the rule-match block is a single toggle row so the
  // description gets the full reading surface; when opened the trace
  // expands below it.
  const [showRuleMatch, setShowRuleMatch] = useState(false);
  // Exceptions surface — spells some applied rule would have included
  // (via query OR manualSpells) but are sitting in manualExclusions.
  // Drives the prominent "Exceptions" panel and the per-row
  // exclusion badges.
  const [exclusions, setExclusions] = useState<ExcludedSpell[]>([]);
  const [exclusionsLoading, setExclusionsLoading] = useState(false);
  const [exceptionsExpanded, setExceptionsExpanded] = useState(true);
  const [tagUsageExpanded, setTagUsageExpanded] = useState(true);
  // Subclasses of the selected class that have their OWN
  // spell_rule_applications row (i.e. the subclass deviates from
  // pure parent inheritance). Pure-inheritance subclasses don't
  // surface here — they're served by the parent class's resolver
  // output and would be visual noise on this page.
  //
  // Read-only informational rows in P4.3. Editing a subclass's
  // rules still happens via /compendium/spell-rules — each entry
  // links there. Forward-looking: a P4.3+ pass can expand each
  // row into a full inline editor.
  const [subclassesWithOwnRules, setSubclassesWithOwnRules] = useState<Array<{
    id: string;
    name: string;
    linkedRules: SpellRule[];
  }>>([]);
  const [subclassesExpanded, setSubclassesExpanded] = useState(true);
  // Rule-picker dialog state — opens when an Add or Remove action is
  // ambiguous (multiple applied rules could host the spell, or
  // multiple rules contain the spell as manual/excluded). The handler
  // resolves the picker's choice then fires the appropriate
  // add/removeSpellToRuleManual / add/removeRuleManualExclusion call.
  const [rulePicker, setRulePicker] = useState<{
    spellId: string;
    spellName: string;
    action: 'add' | 'remove';
    /** Rules the user can choose from for this action. */
    candidates: Array<{ rule: SpellRule; mechanism: 'query' | 'manual' | 'add-manual' }>;
  } | null>(null);

  // Load classes + spells + sources + tags once, then bulk-fetch class memberships.
  useEffect(() => {
    if (!canManageLists) return;
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
        // Only classes flagged as spellcasters belong in this manager
        // — picking, say, Fighter or Barbarian would surface an empty
        // catalogue and confuse the admin. `classes.spellcasting` is
        // a JSON column (nullable for non-casters); when present,
        // `hasSpellcasting === true` confirms the class actually
        // casts. `queryD1` may auto-parse the JSON column to an
        // object or return it as a string depending on table-map
        // registration; handle both shapes.
        const castersOnly = classData.filter((c: any) => isCastingClass(c.spellcasting));
        setClasses(castersOnly.map((c: any) => ({ id: c.id, name: c.name, identifier: c.identifier })));
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
        // No more stale audit — Proposal D's runtime resolver has no
        // "stale" concept. Caches invalidate via fingerprint compare
        // on every read; admins never see a manual-rebuild affordance.
      } catch (err) {
        console.error('[SpellListManager] Failed to load foundation data:', err);
        toast.error('Failed to load spells or classes.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [canManageLists]);

  // Reload the selected class's list (membership + linked rules +
  // exclusions) when the class changes. No more last-rebuild
  // timestamp — Proposal D resolves live.
  useEffect(() => {
    if (!selectedClassId) {
      setClassListIds(new Set());
      setClassMembershipIds(new Map());
      setLinkedRules([]);
      setExclusions([]);
      setSubclassesWithOwnRules([]);
      return;
    }
    let active = true;
    setClassListLoading(true);
    setExclusionsLoading(true);
    fetchClassSpellIds(selectedClassId)
      .then(ids => { if (active) setClassListIds(ids); })
      .catch(err => {
        console.error('[SpellListManager] Failed to load class spell list:', err);
        if (active) toast.error("Failed to load this class's spell list.");
      })
      .finally(() => { if (active) setClassListLoading(false); });
    // Content-creators need the row-id map to submit delete proposals.
    // Admins skip this round-trip (their delete path uses composite
    // keys directly).
    if (isProposalMode) {
      fetchClassSpellMembershipIds(selectedClassId)
        .then(m => { if (active) setClassMembershipIds(m); })
        .catch(err => console.error('[SpellListManager] Failed to load membership ids:', err));
    }
    fetchAppliedRulesFor('class', selectedClassId)
      .then(rs => { if (active) setLinkedRules(rs); })
      .catch(err => console.error('[SpellListManager] Failed to load linked rules:', err));
    getConsumerExcludedSpells('class', selectedClassId)
      .then(ex => { if (active) setExclusions(ex); })
      .catch(err => console.error('[SpellListManager] Failed to load exclusions:', err))
      .finally(() => { if (active) setExclusionsLoading(false); });
    // Conditional subclass surfacing — fetch this class's subclasses,
    // then for each probe spell_rule_applications. Surface only those
    // with at least one own rule (pure-inheritance subclasses don't
    // need a row here).
    (async () => {
      try {
        const subRows = await fetchCollection<any>('subclasses', {
          where: 'class_id = ?',
          params: [selectedClassId],
          orderBy: 'name ASC',
        });
        // Parallel probe — small N (typical class has 3-5 subclasses),
        // each fetch is cheap with the d1 cache.
        const probes = await Promise.all(
          subRows.map(async sub => {
            try {
              const rules = await fetchAppliedRulesFor('subclass', sub.id);
              return { id: String(sub.id), name: String(sub.name), linkedRules: rules };
            } catch (err) {
              console.error('[SpellListManager] subclass rule probe failed:', sub.id, err);
              return { id: String(sub.id), name: String(sub.name), linkedRules: [] };
            }
          }),
        );
        if (!active) return;
        setSubclassesWithOwnRules(probes.filter(p => p.linkedRules.length > 0));
      } catch (err) {
        console.error('[SpellListManager] Failed to load subclasses:', err);
      }
    })();
    return () => { active = false; };
  }, [selectedClassId]);

  // Helper used by Add/Remove handlers + Restore action to refresh
  // the page after a rule mutation. Invalidates the resolver cache
  // (the fingerprint check would catch this anyway via the rule's
  // updated_at bump, but explicit invalidation is cheap insurance)
  // and re-runs the three per-class loads in parallel.
  const refreshAfterRuleEdit = async () => {
    if (!selectedClassId) return;
    try {
      await invalidateCache('class', selectedClassId);
    } catch (err) {
      // Cache invalidation failures aren't fatal — the fingerprint
      // check will catch the change on next read. Log + continue.
      console.warn('[SpellListManager] cache invalidate failed:', err);
    }
    const [ids, rules, ex] = await Promise.all([
      fetchClassSpellIds(selectedClassId),
      fetchAppliedRulesFor('class', selectedClassId),
      getConsumerExcludedSpells('class', selectedClassId),
    ]);
    setClassListIds(ids);
    setLinkedRules(rules);
    setExclusions(ex);
  };

  // Load the full rule catalogue once for the "Link Rule" picker. Cheap (rules table
  // is small, and the d1 cache backs it after the first hit).
  useEffect(() => {
    if (!canManageLists) return;
    let active = true;
    fetchAllRules()
      .then(rs => { if (active) setAllRules(rs); })
      .catch(err => console.error('[SpellListManager] Failed to load rules catalogue:', err));
    return () => { active = false; };
  }, [canManageLists]);

  // Keep ?class= URL param in sync so the page is link-shareable.
  useEffect(() => {
    const current = searchParams.get('class') || '';
    if (current === selectedClassId) return;
    const next = new URLSearchParams(searchParams);
    if (selectedClassId) next.set('class', selectedClassId);
    else next.delete('class');
    setSearchParams(next, { replace: true });
  }, [selectedClassId, searchParams, setSearchParams]);

  // Review-mode wiring. A class_spell_list proposal targets a single
  // membership row — its payload carries `class_id` (and `spell_id`
  // for create ops, while delete ops have the spell id encoded via
  // the membership row's entity_id). Auto-select the proposal's class
  // so the manager shows the right list. The submission-history banner
  // mounted by the wrapper communicates the operation; field-level
  // spell highlighting is deferred to Phase 3.
  const reviewMode = useProposalReview();
  const reviewListPayload = resolveReviewPayload(reviewMode, 'class_spell_list', null);
  useEffect(() => {
    if (!reviewMode || reviewMode.entityType !== 'class_spell_list') return;
    const payload = reviewListPayload ?? reviewMode.snapshotAtProposal;
    const targetClassId = payload?.class_id;
    if (!targetClassId) return;
    if (selectedClassId !== targetClassId) {
      setSelectedClassId(targetClassId);
    }
  }, [reviewMode, reviewListPayload, selectedClassId]);

  const sourceById = useMemo(
    () => Object.fromEntries(sources.map(s => [s.id, s])) as Record<string, SourceRow>,
    [sources]
  );

  const tagsById = useMemo(
    () => Object.fromEntries(tags.map(t => [t.id, t])) as Record<string, TagRow>,
    [tags]
  );

  const spellsById = useMemo(
    () => Object.fromEntries(spells.map(s => [s.id, s])) as Record<string, SpellRow>,
    [spells]
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

  // NOTE: spellMembershipsBySpellId is loaded once at mount time via
  // fetchClassesForSpells, which (since P4.3.G) walks applied rules
  // and matches against them — same semantics as the resolver. So
  // initial load is correct. The map is NOT mutated in-flight when
  // we Add / Remove via rule edits, so the "Also on" hover badge
  // can lag intra-session. A future pass should refresh the touched
  // spell's membership entry on every applyRuleEdits — for now the
  // user sees fresh data on page reload.

  // ---- Add/Remove routing through rule.manual_spells / manual_exclusions ----
  //
  // Proposal D doesn't use class_spell_lists as the source of truth; the
  // resolver reads from spell_rules at request time. To curate a class's
  // list, the admin manipulates the applied rules' manualSpells +
  // manualExclusions arrays:
  //
  //   - Spell currently OFF the list → push to rule.manualSpells
  //     (which rule? see resolveAddDecision below)
  //   - Spell currently ON via manualSpells of rule R → pop from R.manualSpells
  //   - Spell currently ON via query of rule R → push to R.manualExclusions
  //
  // When multiple applied rules could host or contain the spell, we open
  // the `rulePicker` dialog rather than guessing.
  //
  // Each high-level action compiles down to a sequence of `RuleEdit`s
  // that `applyRuleEdits` dispatches sequentially. Carrying the edits as
  // an explicit record (rather than re-deriving on the fly) means Undo
  // can replay the inverse edits without recomputing decisions against
  // potentially-changed state.

  type RuleEdit = {
    ruleId: string;
    spellId: string;
    op: 'manual-add' | 'manual-remove' | 'exclude-add' | 'exclude-remove';
  };

  const invertRuleEdit = (edit: RuleEdit): RuleEdit => ({
    ...edit,
    op:
      edit.op === 'manual-add' ? 'manual-remove'
      : edit.op === 'manual-remove' ? 'manual-add'
      : edit.op === 'exclude-add' ? 'exclude-remove'
      : 'exclude-add',
  });

  const applyRuleEdits = async (
    edits: RuleEdit[],
    opts: { silent?: boolean; verb?: string } = {},
  ) => {
    if (edits.length === 0) return;
    const spellIdSet = new Set(edits.map(e => e.spellId));
    setPendingSpellIds(prev => {
      const next = new Set(prev);
      for (const id of spellIdSet) next.add(id);
      return next;
    });
    try {
      for (const edit of edits) {
        switch (edit.op) {
          case 'manual-add':
            await addSpellToRuleManual(edit.spellId, edit.ruleId);
            break;
          case 'manual-remove':
            await removeSpellFromRuleManual(edit.spellId, edit.ruleId);
            break;
          case 'exclude-add':
            await addRuleManualExclusion(edit.spellId, edit.ruleId);
            break;
          case 'exclude-remove':
            await removeRuleManualExclusion(edit.spellId, edit.ruleId);
            break;
        }
      }
      await refreshAfterRuleEdit();
      if (!opts.silent) {
        const noun =
          spellIdSet.size === 1
            ? (spells.find(s => s.id === [...spellIdSet][0])?.name || '1 spell')
            : `${spellIdSet.size} spells`;
        const inverse = edits.map(invertRuleEdit);
        toast(`${opts.verb ?? 'Updated'} ${noun}.`, {
          duration: 10_000,
          action: {
            label: 'Undo',
            onClick: () => {
              void applyRuleEdits(inverse, { silent: true, verb: 'Reverted' });
            },
          },
        });
      }
    } catch (err) {
      console.error('[SpellListManager] applyRuleEdits failed:', err);
      toast.error('Edit failed — see console.');
      // No optimistic local mutation — refresh just to make sure
      // state is consistent.
      await refreshAfterRuleEdit().catch(() => {});
    } finally {
      setPendingSpellIds(prev => {
        const next = new Set(prev);
        for (const id of spellIdSet) next.delete(id);
        return next;
      });
    }
  };

  // Tag index used by:
  //   - the resolver-equivalent local computation below
  //     (`computeRemoveCandidates` / picker disambiguation),
  //   - per-rule live match counts in the LinkedRulesPanel,
  //   - the rule-match explainer in the right detail pane.
  // Declared once here so the matcher and the UI share one index;
  // without it the rich tagStates code path short-circuits to "match"
  // for any rule that uses tagStates (the defensive fallback in
  // `lib/spellFilters.ts :: matchSpellAgainstRule`), so live match
  // counts would say "everything matches" and mislead the user.
  const tagIndex = useMemo(() => buildTagIndex(tags as any), [tags]);

  /**
   * Per-spell removal candidates: every rule that currently includes
   * this spell, with the mechanism that's putting it on the list. Used
   * by the remove path to decide whether a single-shot edit is enough
   * or the disambiguation picker needs to open.
   */
  const computeRemoveCandidates = (spellId: string) => {
    const spell = spells.find(s => s.id === spellId);
    if (!spell) return [];
    const out: Array<{ rule: SpellRule; mechanism: 'manual' | 'query' }> = [];
    for (const rule of linkedRules) {
      if (rule.manualExclusions.includes(spellId)) continue; // already excluded
      if (rule.manualSpells.includes(spellId)) {
        out.push({ rule, mechanism: 'manual' });
      } else if (spellMatchesRule(spell as any, rule, tagIndex)) {
        out.push({ rule, mechanism: 'query' });
      }
    }
    return out;
  };

  /**
   * Single source of truth for any add/remove action — single toggle,
   * bulk add, bulk remove, and Undo all go through here.
   *
   * Proposal mode keeps its existing pathway (writes to class_spell_lists
   * via the proposal queue) — those revisions are harmless orphans
   * against the new resolver, and migrating proposal-mode to rule-level
   * edits is P4.6 work.
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

    // Proposal mode: keep existing class_spell_lists proposal queue
    // path. TODO(P4.6): migrate to spell_rule entity-type edits so
    // approved proposals actually feed the resolver.
    if (isProposalMode) {
      setPendingSpellIds(prev => {
        const next = new Set(prev);
        for (const id of spellIds) next.add(id);
        return next;
      });
      try {
        if (mode === 'add') {
          for (const spellId of spellIds) {
            await listWriter.create({
              class_id: classId,
              spell_id: spellId,
              source: 'manual',
            });
          }
        } else {
          for (const spellId of spellIds) {
            const rowId = classMembershipIds.get(spellId);
            if (!rowId) {
              console.warn('[SpellListManager] no membership row id for spell', spellId);
              continue;
            }
            await listWriter.remove(rowId);
          }
        }
        if (!opts.silent) {
          const verb = mode === 'add' ? 'addition' : 'removal';
          const plural = spellIds.length === 1 ? '' : 's';
          toast.success(
            `${spellIds.length} spell ${verb}${plural} submitted for review.`,
          );
        }
      } catch (err) {
        console.error('[SpellListManager] proposal submit failed:', err);
        toast.error(`Failed to submit ${mode === 'add' ? 'add' : 'remove'} proposals.`);
      } finally {
        setPendingSpellIds(prev => {
          const next = new Set(prev);
          for (const id of spellIds) next.delete(id);
          return next;
        });
      }
      return;
    }

    // Admin direct-write path — translate to rule edits.
    if (linkedRules.length === 0) {
      toast.error(
        `${cls.name} has no rules linked. Link a rule first using "Link Rule" above.`,
      );
      return;
    }

    const edits: RuleEdit[] = [];
    const ambiguous: string[] = [];

    if (mode === 'add') {
      // Add → push to manualSpells of an applied rule. If only one
      // applied rule, that's the target. If multiple, defer to picker
      // (single-spell case) or pick the first as a sensible default
      // (bulk case, with a warning toast).
      if (linkedRules.length === 1) {
        const target = linkedRules[0];
        for (const spellId of spellIds) {
          edits.push({ spellId, ruleId: target.id, op: 'manual-add' });
        }
      } else {
        // Multiple rules. For a single spell, open the picker; for a
        // bulk add, default to the first rule with a heads-up toast.
        if (spellIds.length === 1) {
          const spellId = spellIds[0];
          const spell = spells.find(s => s.id === spellId);
          setRulePicker({
            spellId,
            spellName: spell?.name || spellId,
            action: 'add',
            candidates: linkedRules.map(r => ({ rule: r, mechanism: 'add-manual' })),
          });
          return; // wait for picker resolution
        }
        const target = linkedRules[0];
        if (!opts.silent) {
          toast(`Adding to "${target.name}" — class has ${linkedRules.length} rules. Use single-add to pick a different rule.`);
        }
        for (const spellId of spellIds) {
          edits.push({ spellId, ruleId: target.id, op: 'manual-add' });
        }
      }
    } else {
      // Remove → invert per-spell. The decision can vary by spell
      // (one may be manual on rule A, another query-matched by rule B).
      for (const spellId of spellIds) {
        const candidates = computeRemoveCandidates(spellId);
        if (candidates.length === 0) {
          // Spell isn't actually on the list per the local model.
          // Defensive: skip rather than fabricate an edit.
          continue;
        }
        if (candidates.length === 1) {
          const c = candidates[0];
          edits.push({
            spellId,
            ruleId: c.rule.id,
            op: c.mechanism === 'manual' ? 'manual-remove' : 'exclude-add',
          });
        } else {
          ambiguous.push(spellId);
        }
      }
      if (ambiguous.length === 1 && edits.length === 0) {
        // Single ambiguous spell → open picker.
        const spellId = ambiguous[0];
        const spell = spells.find(s => s.id === spellId);
        setRulePicker({
          spellId,
          spellName: spell?.name || spellId,
          action: 'remove',
          candidates: computeRemoveCandidates(spellId).map(c => ({
            rule: c.rule,
            mechanism: c.mechanism,
          })),
        });
        return;
      }
      if (ambiguous.length > 0 && !opts.silent) {
        toast(
          `${ambiguous.length} spell${ambiguous.length === 1 ? '' : 's'} skipped — multiple rules contribute. Use single-row remove to pick.`,
          { duration: 8_000 },
        );
      }
    }

    if (edits.length === 0) return;
    await applyRuleEdits(edits, {
      silent: opts.silent,
      verb: mode === 'add'
        ? (spellIds.length === 1 ? 'Added' : `Added ${spellIds.length} spells`)
        : (spellIds.length === 1 ? 'Removed' : `Removed ${spellIds.length} spells`),
    });
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

  /** Restore an excluded spell — pop from rule.manualExclusions. */
  const handleRestoreExclusion = (entry: ExcludedSpell) => {
    void applyRuleEdits(
      [{ spellId: entry.spellId, ruleId: entry.ruleId, op: 'exclude-remove' }],
      { verb: 'Restored' },
    );
  };

  /** Rule-picker resolution — fires the chosen edit then closes the dialog. */
  const handleRulePickerSelect = (ruleId: string) => {
    if (!rulePicker) return;
    const { spellId, action, candidates } = rulePicker;
    setRulePicker(null);
    const candidate = candidates.find(c => c.rule.id === ruleId);
    if (!candidate) return;
    if (action === 'add') {
      void applyRuleEdits(
        [{ spellId, ruleId, op: 'manual-add' }],
        { verb: 'Added' },
      );
    } else {
      // remove — manual-remove or exclude-add depending on mechanism
      void applyRuleEdits(
        [{
          spellId,
          ruleId,
          op: candidate.mechanism === 'manual' ? 'manual-remove' : 'exclude-add',
        }],
        { verb: 'Removed' },
      );
    }
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

  // ----- Linked Rules (resolver-era) -----

  // Tag id → human name. Used by the per-spell rule-match explainer
  // below to humanize tag-axis failure reasons ("missing Confuse"
  // instead of "missing 7c780920-..."). Cheap to build; small map.
  const tagNamesById = useMemo(
    () => new Map(tags.map((t) => [t.id, t.name] as const)),
    [tags],
  );

  // Per-spell rule-match explainer trace. Runs the explainer (in
  // `lib/spellRules.ts`) for the previewed spell against every rule
  // linked to the currently-selected class. Each entry carries the
  // rule + its axes-with-pass-flags trace so the right-pane "Why?"
  // section can render "✓ Source · ✓ Level · ✗ Tags (missing
  // Confuse)" per rule. Returns an empty array when nothing is
  // previewed or the spell-catalog hasn't loaded — avoids a render
  // pass that immediately gets blown away.
  const previewSpellRuleExplanations = useMemo<
    Array<{ rule: SpellRule; explanation: RuleExplanation }>
  >(() => {
    if (!previewSpellId || linkedRules.length === 0) return [];
    const previewSpell = spells.find((s) => s.id === previewSpellId);
    if (!previewSpell) return [];
    return linkedRules.map((rule) => ({
      rule,
      explanation: explainSpellMatch(
        previewSpell as any,
        rule,
        tagIndex,
        tagNamesById,
      ),
    }));
  }, [previewSpellId, linkedRules, spells, tagIndex, tagNamesById]);

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

  // No stale-rule detection in the resolver era — the resolver reads
  // live; a rule edit's effect is visible on the very next read.

  const handleLinkRule = async (rule: SpellRule) => {
    if (!selectedClassId) return;
    try {
      await applyRule(rule.id, 'class', selectedClassId);
      await refreshAfterRuleEdit();
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
      await refreshAfterRuleEdit();
      toast(`Unlinked "${rule.name}".`);
    } catch (err) {
      console.error('[SpellListManager] Unlink failed:', err);
      toast.error('Failed to unlink rule.');
    }
  };

  if (!canManageLists) {
    return <div className="text-center py-20 text-ink/70">Access Denied.</div>;
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
        <Link to={backPath}>
          <Button variant="ghost" size="sm" className="h-8 text-gold gap-2 hover:bg-gold/5">
            <ChevronLeft className="w-4 h-4" />
            Back
          </Button>
        </Link>
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-gold/70 shrink-0">Class</span>
        {/* Entity-search class picker — same SingleSelectSearch
            pattern used by RequirementsEditor, ActivityEditor,
            ConsumptionTabEditor for picking among 40+ items.
            Replaces the native <select> because at the planned
            class catalogue scale (Wizard, Sorcerer, Warlock,
            Cleric, Druid, Paladin, Ranger, plus subclasses /
            partial casters / homebrew = easily 40+), the bare
            <select> is slow to scan and miserable to type into. */}
        <SingleSelectSearch
          value={selectedClassId}
          onChange={(val) => setSelectedClassId(val)}
          options={classes.map(c => ({ id: c.id, name: c.name }))}
          placeholder="— Select a class —"
          noEntitiesText={loading ? 'Loading classes…' : 'No classes found.'}
          disabled={loading}
          triggerClassName="w-[220px]"
        />
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
        {/* No Rebuild Stale button — Proposal D resolves live; there
            is no stale concept to surface. */}
        <div className="flex-1" />
      </div>

      {/* Linked-rules strip — only when a class is selected. */}
      {selectedClassId ? (
        <div className="shrink-0">
          <LinkedRulesPanel
            linkedRules={linkedRules}
            ruleMatchCounts={ruleMatchCounts}
            totalLinkedRuleMatches={totalLinkedRuleMatches}
            expanded={linkedRulesExpanded}
            onToggleExpanded={() => setLinkedRulesExpanded(v => !v)}
            onUnlink={handleUnlinkRule}
            onOpenLinkPicker={() => setLinkRuleDialogOpen(true)}
          />
        </div>
      ) : null}

      {/* Tag Usage + Exceptions surfaces — only when a class is selected. */}
      {selectedClassId ? (
        <>
          <TagUsagePanel
            linkedRules={linkedRules}
            tags={tags}
            tagGroups={tagGroups}
            expanded={tagUsageExpanded}
            onToggleExpanded={() => setTagUsageExpanded(v => !v)}
          />
          <ExceptionsPanel
            exclusions={exclusions}
            loading={exclusionsLoading}
            spellsById={spellsById}
            expanded={exceptionsExpanded}
            onToggleExpanded={() => setExceptionsExpanded(v => !v)}
            onRestore={handleRestoreExclusion}
            pendingSpellIds={pendingSpellIds}
          />
          {subclassesWithOwnRules.length > 0 ? (
            <SubclassesPanel
              subclasses={subclassesWithOwnRules}
              expanded={subclassesExpanded}
              onToggleExpanded={() => setSubclassesExpanded(v => !v)}
            />
          ) : null}
        </>
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
      {/* Outer-grid sizing policy mirrors `/compendium/spells`:
           - Spell list pane: FIXED at 520px. Doesn't grow when the
             viewport widens, doesn't shrink when columns are hidden.
             This keeps the detail pane as the primary "stretch
             target" — wider screens give more room to reading the
             spell description, never to widening the already-narrow
             list columns.
           - Detail pane: `minmax(360px, 1fr)` — claims everything
             left of the list, with a 360px floor so body text stays
             legible (under ~320px it wraps every 4-5 words and feels
             cramped).
           Previously this was the inverse split (list 1fr, detail
           fixed 420px), which left the list with ~1100px of empty
           horizontal space and the detail panel choked at 420 — the
           one place a curator actually reads continuous prose. */}
      <div ref={gridContainerRef} className="flex-1 min-h-0 grid gap-2 lg:grid-cols-[minmax(0,1fr)] xl:grid-cols-[520px_minmax(360px,1fr)]">
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
                    // Spell has staged add/remove against this class
                    // list in the active block. Highlights ADDs (queued
                    // creates for a new pin) AND REMOVEs (queued deletes
                    // of an existing pin). Either way it's "something
                    // staged for this spell on this class list".
                    const stagedForClass = stagedSpellIds.has(spell.id);
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
                        title={
                          stagedForClass
                            ? `${spell.name} — staged in this block · ${rowTitle}`
                            : rowTitle
                        }
                        className={cn(
                          'grid w-full grid-cols-[32px_28px_minmax(0,1fr)_40px_64px_56px_88px] gap-2 items-center px-3 transition-colors cursor-pointer border-b border-gold/5 border-l-2',
                          onList ? 'bg-gold/[0.04]' : '',
                          isSelected ? 'ring-1 ring-inset ring-gold/30' : '',
                          isPreviewing
                            ? 'bg-gold/15'
                            : stagedForClass
                              ? 'bg-archive-blue/5 hover:bg-archive-blue/10'
                              : 'hover:bg-gold/[0.06]',
                          stagedForClass ? 'border-l-archive-blue/60' : 'border-l-transparent',
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
              // Rule-match explainer rides in via SpellDetailPanel's
              // `bottomSlot`: it lands inside the same bottom-pinned
              // container that holds the Source / "On the spell list
              // for" / Show Tags rows, so the Show Rule Match button
              // sits as a sibling of Show Tags rather than as a
              // separate section beneath the panel.
              bottomSlot={
                previewSpellId && previewSpellRuleExplanations.length > 0 ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setShowRuleMatch((s) => !s)}
                      aria-expanded={showRuleMatch}
                      className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded border border-gold/10 bg-gold/[0.03] hover:bg-gold/[0.07] text-[10px] font-bold uppercase tracking-[0.18em] text-gold/70 transition-colors"
                    >
                      <span className="flex items-center gap-2">
                        <Scale className="w-3 h-3" />
                        {showRuleMatch ? 'Hide rule match' : 'Show rule match'}
                        <span className="text-ink/45 normal-case tracking-normal font-normal">
                          ({previewSpellRuleExplanations.filter((e) => e.explanation.matched).length}
                          {' / '}
                          {previewSpellRuleExplanations.length} match)
                        </span>
                      </span>
                      {showRuleMatch ? (
                        <ChevronUp className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" />
                      )}
                    </button>
                    {showRuleMatch && (
                      <div className="space-y-1.5">
                        {previewSpellRuleExplanations.map(({ rule, explanation }) => {
                          const isPinned =
                            explanation.matched
                            && explanation.axes.length === 1
                            && explanation.axes[0].reason.startsWith('Manually pinned');
                          return (
                            <div
                              key={rule.id}
                              className={cn(
                                'rounded border px-2.5 py-1.5 text-xs',
                                explanation.matched
                                  ? 'border-emerald-500/30 bg-emerald-500/[0.04]'
                                  : 'border-blood/30 bg-blood/[0.04]',
                              )}
                            >
                              <div className="flex items-center gap-2 flex-wrap">
                                <span
                                  className={cn(
                                    'inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-black shrink-0',
                                    explanation.matched
                                      ? 'bg-emerald-500/20 text-emerald-500'
                                      : 'bg-blood/20 text-blood',
                                  )}
                                >
                                  {explanation.matched ? '✓' : '✗'}
                                </span>
                                <span className="font-bold text-ink truncate">{rule.name}</span>
                                {isPinned && (
                                  <span className="text-[9px] font-black uppercase tracking-widest text-emerald-500 bg-emerald-500/10 border border-emerald-500/30 rounded-sm px-1.5 py-px">
                                    Pinned
                                  </span>
                                )}
                              </div>
                              {/* Axes breakdown — only render when there's
                                  something to say. Passing rules with axes
                                  list them as a comma-separated summary so
                                  you can sanity-check what the rule actually
                                  constrains. Failing rules surface the
                                  specific failing axis + its reason. */}
                              {explanation.axes.length > 0 && (
                                <div className="mt-1 flex flex-wrap gap-1 pl-6">
                                  {explanation.matched ? (
                                    <span className="text-[10px] text-ink/50">
                                      Passes all {explanation.axes.length} axis check
                                      {explanation.axes.length === 1 ? '' : 's'}:{' '}
                                      {explanation.axes.map((a) => a.axis).join(', ')}
                                    </span>
                                  ) : (
                                    explanation.axes
                                      .filter((a) => !a.pass)
                                      .map((a, idx) => (
                                        <span
                                          key={`${rule.id}-${a.axis}-${idx}`}
                                          className="text-[10px] text-blood/80 leading-snug"
                                          title={a.reason}
                                        >
                                          <span className="font-bold uppercase tracking-widest mr-1">
                                            {a.axis}:
                                          </span>
                                          {a.reason}
                                        </span>
                                      ))
                                  )}
                                </div>
                              )}
                              {/* Empty-rule edge case: matcher returns true
                                  with no axes to walk. The UI says so
                                  explicitly so the user doesn't think the
                                  rule mysteriously matched. */}
                              {explanation.matched && explanation.axes.length === 0 && !isPinned && (
                                <div className="mt-1 pl-6 text-[10px] italic text-ink/45">
                                  Rule has no filter clauses — matches every spell.
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                ) : null
              }
            />
          </CardContent>
        </Card>
      </div>

      {/* Rule-disambiguation picker — opens when the spell could be
          added to / removed from multiple applied rules. Renders the
          candidate rules with the mechanism each one currently
          contributes via, so the user knows whether picking a rule
          means "pin manually here" / "unpin from here" / "exclude
          from this rule's query". */}
      <Dialog
        open={rulePicker !== null}
        onOpenChange={(open) => { if (!open) setRulePicker(null); }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {rulePicker?.action === 'add'
                ? `Add "${rulePicker?.spellName ?? ''}" to which rule?`
                : `Remove "${rulePicker?.spellName ?? ''}" from which rule?`}
            </DialogTitle>
            <DialogDescription>
              {rulePicker?.action === 'add'
                ? `This class has ${linkedRules.length} applied rules. Pick which rule should host the manual addition.`
                : `This spell is contributed to the list by more than one rule. Pick the rule to clear it from.`}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-72 overflow-y-auto custom-scrollbar divide-y divide-gold/10 -mx-4">
            {(rulePicker?.candidates ?? []).map(c => {
              const label =
                c.mechanism === 'manual'
                  ? 'Currently pinned manually'
                  : c.mechanism === 'query'
                    ? 'Currently matched by this rule’s query'
                    : 'Will be pinned manually';
              return (
                <button
                  key={c.rule.id}
                  type="button"
                  onClick={() => handleRulePickerSelect(c.rule.id)}
                  className="w-full text-left px-4 py-2 text-sm text-ink hover:bg-gold/10 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="font-bold truncate">{c.rule.name}</div>
                    <div className="text-[10px] text-ink/50 truncate">{label}</div>
                  </div>
                </button>
              );
            })}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRulePicker(null)}
              className="border-gold/20 text-ink/70 hover:bg-gold/5"
            >
              Cancel
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
              Pick a rule from the catalogue. The class's spell list becomes
              the union of every applied rule's matches plus its manual
              additions, minus its exclusions. Changes are live — no rebuild
              step required.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-72 overflow-y-auto custom-scrollbar divide-y divide-gold/10 -mx-4">
            {allRules.length === 0 ? (
              <p className="px-4 py-3 text-sm text-ink/45 italic">
                No rules in the catalogue yet. Visit <Link to={`${editorPrefix}/spell-rules`} className="text-gold hover:underline">Spell Rules</Link> to create one.
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
  const parts: string[] = [];
  if (rule.manualSpells.length) parts.push(`${rule.manualSpells.length} manual`);

  // Multi-clause aware: sum filter counts across every clause. For
  // single-clause rules (legacy flat shape), `getClauses` returns
  // one element and the summary reads identically to the previous
  // implementation. For multi-clause rules, the summary prepends
  // "N clauses · …" so the user sees at a glance that the rule has
  // multiple OR'd filter sets.
  const clauses = getClauses(rule.query);
  if (clauses.length > 1) {
    parts.push(`${clauses.length} clauses`);
  }

  let sources = 0;
  let levels = 0;
  let schools = 0;
  let tags = 0;
  let casting = 0;
  let ranges = 0;
  let durations = 0;
  const properties = new Set<string>();
  for (const q of clauses) {
    if (q.sourceFilterIds?.length) sources += q.sourceFilterIds.length;
    if (q.levelFilters?.length) levels += q.levelFilters.length;
    if (q.schoolFilters?.length) schools += q.schoolFilters.length;
    if (q.tagFilterIds?.length) tags += q.tagFilterIds.length;
    // Rich tagStates: count include/exclude entries.
    if (q.tagStates) tags += Object.keys(q.tagStates).length;
    if (q.activationFilters?.length) casting += q.activationFilters.length;
    if (q.rangeFilters?.length) ranges += q.rangeFilters.length;
    if (q.durationFilters?.length) durations += q.durationFilters.length;
    if (q.propertyFilters?.length) q.propertyFilters.forEach((p) => properties.add(p));
  }

  if (sources) parts.push(`${sources} source${sources === 1 ? '' : 's'}`);
  if (levels) parts.push(`${levels} level${levels === 1 ? '' : 's'}`);
  if (schools) parts.push(`${schools} school${schools === 1 ? '' : 's'}`);
  if (tags) parts.push(`${tags} tag${tags === 1 ? '' : 's'}`);
  if (casting) parts.push(`${casting} casting`);
  if (ranges) parts.push(`${ranges} range`);
  if (durations) parts.push(`${durations} duration`);
  if (properties.size) parts.push(Array.from(properties).join(' + '));
  return parts.join(' · ') || '(empty)';
}

function LinkedRulesPanel({
  linkedRules,
  ruleMatchCounts,
  totalLinkedRuleMatches,
  expanded,
  onToggleExpanded,
  onUnlink,
  onOpenLinkPicker,
}: {
  linkedRules: SpellRule[];
  ruleMatchCounts: Record<string, { matches: number; onList: number }>;
  totalLinkedRuleMatches: number;
  expanded: boolean;
  onToggleExpanded: () => void;
  onUnlink: (rule: SpellRule) => void;
  onOpenLinkPicker: () => void;
}) {
  const ChevronIcon = expanded ? ChevronDown : ChevronRight;
  // Cross-editor link prefix — keep users on the route they came in
  // on (admin direct vs proposal-wrapped).
  const panelLocation = useLocation();
  const editorPrefix = panelLocation.pathname.startsWith('/proposals/edit/')
    ? '/proposals/edit'
    : '/compendium';

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
            to={`${editorPrefix}/spell-rules`}
            className="text-[10px] uppercase tracking-widest text-ink/45 hover:text-gold"
            title="Author / edit rules on the Spell Rules page"
          >
            Manage Rules →
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onOpenLinkPicker}
            className="h-7 px-3 text-[10px] uppercase tracking-[0.18em] border-gold/30 text-gold hover:bg-gold/10"
          >
            <Plus className="w-3 h-3 mr-1" /> Link Rule
          </Button>
        </div>
      </div>

      {linkedRules.length === 0 ? (
        <p className="text-xs text-ink/45 italic">
          No rules linked to this class. Click <strong>Link Rule</strong> to attach a rule from the catalogue,
          or visit the <Link to={`${editorPrefix}/spell-rules`} className="text-gold hover:underline">Spell Rules</Link> page to author one first.
        </p>
      ) : (
        <>
          {/* Cap the expanded rules list at ~40% of viewport height and
              scroll internally. */}
          <div className="space-y-1 max-h-[40vh] overflow-y-auto custom-scrollbar pr-1">
            {linkedRules.map(rule => {
              const counts = ruleMatchCounts[rule.id] || { matches: 0, onList: 0 };
              return (
                <div
                  key={rule.id}
                  className="flex items-center gap-3 px-3 py-2 rounded border border-gold/15 hover:border-gold/30 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 flex-wrap">
                      <Link
                        to={`${editorPrefix}/spell-rules?rule=${rule.id}`}
                        className="text-sm text-ink font-bold truncate max-w-[18rem] hover:text-gold"
                      >
                        {rule.name}
                      </Link>
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

// ---------------------------------------------------------------------------
// Tag Usage panel — collapse every applied rule's tag references into one
// per-class summary chip strip.
// ---------------------------------------------------------------------------
//
// For each linked rule we walk its clause(s) and pull out:
//   - tag ids in the legacy `tagFilterIds` array (flat include-only),
//   - tag ids with state 1 in the rich `tagStates` map (include),
//     ignoring state 2 (exclude) since those don't materially shape
//     the "what does this class's list contain" mental model the
//     curator is building.
//
// The chip strip is grouped by the tag's group (e.g. Domain, School,
// Element) so it scans the same way the rest of the app's tag UIs
// do — a curator looking at Wizard sees "Domain · Arcana, Knowledge"
// not a flat alphabetical jumble of every tag name.
function TagUsagePanel({
  linkedRules,
  tags,
  tagGroups,
  expanded,
  onToggleExpanded,
}: {
  linkedRules: SpellRule[];
  tags: TagRow[];
  tagGroups: TagGroupRow[];
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  // Aggregate: tagId → Array<{ ruleId, ruleName }>
  // so a chip's tooltip can show "Referenced by: Rule A, Rule B".
  const usageByTagId = useMemo(() => {
    const out = new Map<string, Array<{ ruleId: string; ruleName: string }>>();
    for (const rule of linkedRules) {
      // Multi-clause aware: pull from every clause.
      const clauses = getClauses(rule.query);
      const seen = new Set<string>();
      for (const clause of clauses) {
        for (const tagId of clause.tagFilterIds ?? []) {
          if (seen.has(tagId)) continue;
          seen.add(tagId);
          const list = out.get(tagId) ?? [];
          list.push({ ruleId: rule.id, ruleName: rule.name });
          out.set(tagId, list);
        }
        if (clause.tagStates) {
          for (const [tagId, state] of Object.entries(clause.tagStates)) {
            // State 1 = include. State 2 = exclude — we skip those
            // because they shrink the contribution rather than
            // shaping it; surfacing them here would mislead.
            if (state !== 1) continue;
            if (seen.has(tagId)) continue;
            seen.add(tagId);
            const list = out.get(tagId) ?? [];
            list.push({ ruleId: rule.id, ruleName: rule.name });
            out.set(tagId, list);
          }
        }
      }
    }
    return out;
  }, [linkedRules]);

  const tagsById = useMemo(
    () => new Map(tags.map(t => [t.id, t] as const)),
    [tags],
  );
  const groupNameById = useMemo(
    () => new Map(tagGroups.map(g => [g.id, g.name || 'Tags'] as const)),
    [tagGroups],
  );

  // Bucket by group for the render — same grouping rhythm the rest
  // of the tag UIs use.
  const grouped = useMemo(() => {
    const buckets: Array<{
      groupId: string;
      groupName: string;
      tags: Array<{ tag: TagRow; usedBy: Array<{ ruleId: string; ruleName: string }> }>;
    }> = [];
    const indexByGroup = new Map<string, number>();
    for (const [tagId, usedBy] of usageByTagId.entries()) {
      const tag = tagsById.get(tagId);
      if (!tag) continue;
      const groupId = tag.groupId ?? '__ungrouped__';
      let idx = indexByGroup.get(groupId);
      if (idx === undefined) {
        idx = buckets.length;
        buckets.push({
          groupId,
          groupName: groupNameById.get(groupId) ?? 'Tags',
          tags: [],
        });
        indexByGroup.set(groupId, idx);
      }
      buckets[idx].tags.push({ tag, usedBy });
    }
    for (const b of buckets) {
      b.tags.sort((a, b) => a.tag.name.localeCompare(b.tag.name));
    }
    buckets.sort((a, b) => a.groupName.localeCompare(b.groupName));
    return buckets;
  }, [usageByTagId, tagsById, groupNameById]);

  const ChevronIcon = expanded ? ChevronDown : ChevronRight;
  const totalTags = usageByTagId.size;

  return (
    <div className="bg-background border border-gold/20 rounded-md">
      <button
        type="button"
        onClick={onToggleExpanded}
        className="w-full flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-[0.2em] text-gold hover:text-gold/80"
      >
        <ChevronIcon className="w-4 h-4" />
        <TagIcon className="w-3.5 h-3.5" />
        Tag Usage
        <span className="text-[10px] text-ink/40 font-normal normal-case tracking-normal">
          {totalTags === 0
            ? '— no tag references'
            : `(${totalTags} tag${totalTags === 1 ? '' : 's'} across ${linkedRules.length} rule${linkedRules.length === 1 ? '' : 's'})`}
        </span>
      </button>
      {expanded ? (
        <div className="px-4 pb-3 space-y-2">
          {linkedRules.length === 0 ? (
            <p className="text-xs text-ink/45 italic">
              No rules linked to this class — link a rule above to see its tag references here.
            </p>
          ) : grouped.length === 0 ? (
            <p className="text-xs text-ink/45 italic">
              Applied rules don't reference any tags. Their queries
              constrain spells by source / level / school / etc. only.
            </p>
          ) : (
            grouped.map(bucket => (
              <div key={bucket.groupId} className="flex flex-wrap gap-1.5 items-baseline">
                <span className="text-[10px] uppercase tracking-widest text-ink/45 font-bold pr-1 shrink-0">
                  {bucket.groupName}
                </span>
                {bucket.tags.map(({ tag, usedBy }) => (
                  <span
                    key={tag.id}
                    className="inline-flex items-center gap-1 rounded-full border border-gold/25 bg-gold/5 px-2 py-0.5 text-[11px] text-gold/90"
                    title={`Referenced by: ${usedBy.map(u => u.ruleName).join(', ')}`}
                  >
                    {tag.name}
                    {usedBy.length > 1 ? (
                      <span className="text-[9px] text-ink/40 font-bold">×{usedBy.length}</span>
                    ) : null}
                  </span>
                ))}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exceptions panel — surfaces every spell some applied rule excludes.
// ---------------------------------------------------------------------------
//
// Driven by `getConsumerExcludedSpells('class', selectedClassId)`. Each
// entry is a (spell, rule) pair with the mechanism that WOULD have
// included the spell if it weren't excluded. Restoring an exception
// pops the spell id out of `rule.manual_exclusions`.
function ExceptionsPanel({
  exclusions,
  loading,
  spellsById,
  expanded,
  onToggleExpanded,
  onRestore,
  pendingSpellIds,
}: {
  exclusions: ExcludedSpell[];
  loading: boolean;
  spellsById: Record<string, SpellRow>;
  expanded: boolean;
  onToggleExpanded: () => void;
  onRestore: (entry: ExcludedSpell) => void;
  pendingSpellIds: Set<string>;
}) {
  const ChevronIcon = expanded ? ChevronDown : ChevronRight;
  // Sort: spell name ASC. Multiple-rule entries get listed once per
  // rule (the resolver already returns one entry per (spell, rule)
  // pair) so the user can see exactly which exclusions exist.
  const sorted = useMemo(() => {
    return [...exclusions].sort((a, b) => {
      const an = spellsById[a.spellId]?.name ?? a.spellId;
      const bn = spellsById[b.spellId]?.name ?? b.spellId;
      const byName = an.localeCompare(bn);
      if (byName !== 0) return byName;
      return a.ruleName.localeCompare(b.ruleName);
    });
  }, [exclusions, spellsById]);

  return (
    <div
      className={cn(
        'border rounded-md',
        sorted.length > 0
          ? 'bg-amber-400/[0.04] border-amber-400/30'
          : 'bg-background border-gold/20',
      )}
    >
      <button
        type="button"
        onClick={onToggleExpanded}
        className={cn(
          'w-full flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-[0.2em]',
          sorted.length > 0 ? 'text-amber-400 hover:text-amber-300' : 'text-gold hover:text-gold/80',
        )}
      >
        <ChevronIcon className="w-4 h-4" />
        <AlertTriangle className="w-3.5 h-3.5" />
        Exceptions
        <span className={cn(
          'text-[10px] font-normal normal-case tracking-normal',
          sorted.length > 0 ? 'text-amber-400/70' : 'text-ink/40',
        )}>
          {loading
            ? '— loading…'
            : sorted.length === 0
              ? '— no exclusions'
              : `(${sorted.length})`}
        </span>
      </button>
      {expanded && !loading && sorted.length > 0 ? (
        <div className="px-4 pb-3 space-y-1 max-h-[28vh] overflow-y-auto custom-scrollbar">
          {sorted.map(entry => {
            const spell = spellsById[entry.spellId];
            const spellName = spell?.name ?? entry.spellId;
            const isPending = pendingSpellIds.has(entry.spellId);
            return (
              <div
                key={`${entry.ruleId}|${entry.spellId}`}
                className="flex items-center gap-3 px-3 py-1.5 rounded border border-amber-400/20 bg-background/30 hover:border-amber-400/40 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-ink font-bold truncate">{spellName}</span>
                    {spell ? (
                      <span className="text-[9px] text-ink/40 shrink-0">
                        {spell.level === 0 ? 'Cantrip' : `Level ${spell.level}`}
                      </span>
                    ) : null}
                  </div>
                  <div className="text-[10px] text-ink/50 truncate mt-0.5">
                    Excluded from <span className="text-ink/80 font-bold">{entry.ruleName}</span>
                    {' · '}
                    Would have matched via {entry.wouldHaveBeenMatchedBy === 'manual' ? 'manual pin' : 'query'}
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => onRestore(entry)}
                  disabled={isPending}
                  className="h-7 px-2 text-[10px] uppercase tracking-[0.18em] border-amber-400/40 text-amber-400 hover:bg-amber-400/15"
                  title="Pop this spell out of the rule's manual_exclusions so it comes back to the class list."
                >
                  <RotateCcw className="w-3 h-3 mr-1" />
                  {isPending ? '…' : 'Restore'}
                </Button>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subclasses panel — informational surface for subclasses that have their
// OWN rule applications (i.e. they deviate from pure parent inheritance).
// ---------------------------------------------------------------------------
//
// Common case: a class has 3-5 subclasses, all of which inherit the
// parent's spell list with no additions. Those subclasses don't surface
// — they'd be noise.
//
// Deviation case: a subclass has its own spell_rule_applications row
// (e.g. Divine Soul Sorcerer grants Cleric's rule on top of Sorcerer's).
// Those surface here so the curator sees them while editing the parent
// class. Each row links to the rule editor for direct manipulation —
// P4.3 keeps this read-only; a future pass can inline-edit the
// subclass's rules right here.
function SubclassesPanel({
  subclasses,
  expanded,
  onToggleExpanded,
}: {
  subclasses: Array<{ id: string; name: string; linkedRules: SpellRule[] }>;
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  const ChevronIcon = expanded ? ChevronDown : ChevronRight;
  const location = useLocation();
  const editorPrefix = location.pathname.startsWith('/proposals/edit/')
    ? '/proposals/edit'
    : '/compendium';
  return (
    <div className="bg-background border border-gold/20 rounded-md">
      <button
        type="button"
        onClick={onToggleExpanded}
        className="w-full flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-[0.2em] text-gold hover:text-gold/80"
      >
        <ChevronIcon className="w-4 h-4" />
        Subclasses with Own Rules
        <span className="text-[10px] text-ink/40 font-normal normal-case tracking-normal">
          ({subclasses.length} subclass{subclasses.length === 1 ? '' : 'es'} deviate
          {subclasses.length === 1 ? 's' : ''} from inheritance)
        </span>
      </button>
      {expanded ? (
        <div className="px-4 pb-3 space-y-1.5">
          {subclasses.map(sub => (
            <div
              key={sub.id}
              className="flex items-center gap-3 px-3 py-1.5 rounded border border-gold/15 bg-background/30"
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm text-ink font-bold truncate">{sub.name}</div>
                <div className="text-[10px] text-ink/50 truncate mt-0.5">
                  Own rules:{' '}
                  {sub.linkedRules.map((r, i) => (
                    <React.Fragment key={r.id}>
                      <Link
                        to={`${editorPrefix}/spell-rules?rule=${r.id}`}
                        className="text-gold/80 hover:text-gold hover:underline"
                      >
                        {r.name}
                      </Link>
                      {i < sub.linkedRules.length - 1 ? <span className="text-ink/30">, </span> : null}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </div>
          ))}
          <p className="text-[10px] text-ink/35 italic mt-1">
            Pure-inheritance subclasses don't appear here — they resolve
            against the parent class's rules only. Click a rule above to
            edit; in P4.3 subclass rules aren't editable inline yet.
          </p>
        </div>
      ) : null}
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
