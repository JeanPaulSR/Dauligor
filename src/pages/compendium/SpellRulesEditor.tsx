import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams, useLocation } from 'react-router-dom';
import { ChevronLeft, Wand2, Plus, X, Search, ChevronDown, ChevronRight, Trash2, Save, Info } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../../components/ui/dialog';
import { SectionFilterPanel, type FilterSection } from '../../components/compendium/SectionFilterPanel';
import { fetchCollection } from '../../lib/d1';
import { fetchSpellSummaries } from '../../lib/spellSummary';
import { normalizeTagRow, orderTagsAsTree, tagPickerLabel, buildTagIndex } from '../../lib/tagHierarchy';
import { cn } from '../../lib/utils';
import { SCHOOL_LABELS } from '../../lib/spellImport';
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
  getClauses,
  getRootExcludeTagIds,
  type ActivationBucket,
  type DurationBucket,
  type PropertyFilter,
  type RangeBucket,
  type RuleClauseRoot,
  type RuleQuery,
  type ShapeBucket,
  type SpellMatchInput,
} from '../../lib/spellFilters';
import {
  fetchAllRules,
  fetchAppliedRulesFor,
  fetchApplicationCounts,
  fetchRuleApplications,
  saveRule,
  deleteRule,
  applyRule,
  unapplyRule,
  spellMatchesRule,
  CONSUMER_TYPES,
  type ConsumerType,
  type SpellRule,
  type SpellRuleApplication,
} from '../../lib/spellRules';
import { actionLabel } from '../../lib/proposalAware';
import { useProposalAccumulator, useProposalContextOptional } from '../../lib/proposalAccumulator';
import { useBlock } from '../../lib/proposalBlock';
import { useProposalReview, resolveReviewPayload } from '../../lib/proposalReview';

const LEVEL_VALUES = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
const CONSUMER_LABELS: Record<ConsumerType, string> = {
  class: 'Class',
  subclass: 'Subclass',
  feat: 'Feat',
  feature: 'Feature',
  background: 'Background',
  item: 'Item',
  unique_option_item: 'Option Item',
};

type SpellSummaryRow = SpellMatchInput & {
  id: string;
  name: string;
  source_id: string | null;
};

type ClassRow = { id: string; name: string };
type SourceRow = { id: string; name?: string; abbreviation?: string; shortName?: string };
type TagRow = { id: string; name: string; groupId: string | null; parentTagId: string | null };
type TagGroupRow = { id: string; name: string };

/**
 * Standalone admin page for authoring Spell Rules — the bulk-grant primitive
 * applied to classes (and eventually subclasses, feats, features, backgrounds,
 * items, option items). See docs/features/spellbook-manager.md for the layered
 * model. Class-side consumption lives in `/compendium/spell-lists`.
 */
export default function SpellRulesEditor({ userProfile }: { userProfile: any }) {
  // Admins write rules + apply them to classes directly; content-
  // creators route through the proposal queue. Phase 4.6 dropped
  // the auto-rebuild / stale-class apparatus — the resolver reads
  // applied-rule state at request time, so no class-side refresh
  // step exists.
  const isAdmin = userProfile?.role === 'admin';
  const isContentCreator = !!userProfile?.permissions &&
    Object.prototype.hasOwnProperty.call(userProfile.permissions, 'content-creator');
  const canManageRules = isAdmin || isContentCreator;
  // Inside <ProposalEditorWrapper> these queue locally and flush on
  // Submit Changes; outside the wrapper they pass through to
  // useEntityWriter unchanged (admin direct write on /compendium/...).
  const ruleWriter = useProposalAccumulator('spell_rule', userProfile);
  const ruleAppWriter = useProposalAccumulator('spell_rule_application', userProfile);
  // Back-link target depends on which route this editor is mounted
  // under. On the admin route we walk up to /compendium/classes; on
  // the proposal route we walk up to /my-proposals (the dashboard
  // that surfaced the editor in the first place).
  const editorLocation = useLocation();
  const backPath = editorLocation.pathname.startsWith('/proposals/edit/')
    ? '/my-proposals'
    : '/compendium/classes';
  // `block` mode also routes through the writer (which posts drafts
  // with the active bundle_id) — without including it here, block-
  // mode mutations would fall through to direct queryD1 calls and
  // 403 at the proxy. See SpellListManager for the same fix.
  const isProposalMode = ruleWriter.mode === 'proposal' || ruleWriter.mode === 'block';

  // Spell-rule ids the user has staged in the active block. Same
  // pattern as SpellsEditor's row-highlight — empty Set outside a
  // <ProposalEditorWrapper>.
  const proposalContext = useProposalContextOptional();
  const { drafts: allDrafts, activeBundleId } = useBlock();
  const draftedRuleIds = useMemo(() => {
    const ids = new Set<string>();
    // Outside <ProposalEditorWrapper> (admin-direct route) there is no
    // proposal/block UI — return an empty set even if an admin has an
    // open block elsewhere in the app.
    if (!proposalContext) return ids;
    for (const q of proposalContext.queue) {
      if (q.entity_type === 'spell_rule' && q.entity_id) ids.add(q.entity_id);
    }
    if (activeBundleId) {
      for (const d of allDrafts) {
        if (
          d.entity_type === 'spell_rule' &&
          d.entity_id &&
          d.bundle_id === activeBundleId
        ) {
          ids.add(d.entity_id);
        }
      }
    }
    return ids;
  }, [proposalContext, allDrafts, activeBundleId]);
  const [searchParams, setSearchParams] = useSearchParams();
  const initialRuleId = searchParams.get('rule') || '';

  // Review mode — when URL has `?review=<proposal_id>` AND the
  // proposal targets a spell_rule, force the editor's selection to
  // the proposal's entity_id and feed the draft from the proposal's
  // payload (or snapshot for delete reviews).
  const reviewMode = useProposalReview();
  const reviewPayload = resolveReviewPayload(reviewMode, 'spell_rule', null);
  const isReviewingRule = !!reviewMode && !!reviewPayload &&
    reviewMode.entityType === 'spell_rule';

  // Foundation
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [tags, setTags] = useState<TagRow[]>([]);
  const [tagGroups, setTagGroups] = useState<TagGroupRow[]>([]);
  const [spells, setSpells] = useState<SpellSummaryRow[]>([]);

  // Rules state
  const [rules, setRules] = useState<SpellRule[]>([]);
  const [appCounts, setAppCounts] = useState<Record<string, number>>({});
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(initialRuleId || null);
  const [draft, setDraft] = useState<SpellRule | null>(null);
  const [draftDirty, setDraftDirty] = useState(false);
  const [draftApplications, setDraftApplications] = useState<SpellRuleApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // UI state
  const [howOpen, setHowOpen] = useState(false);
  const [manualSpellsSearch, setManualSpellsSearch] = useState('');
  const [applyDialogOpen, setApplyDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Fullscreen-page opt-in — mirrors /compendium/spells,
  // /compendium/spells/manage, /compendium/spell-lists. Hides the
  // global footer and strips <main>'s container padding so the
  // working area uses the full viewport.
  useEffect(() => {
    if (!canManageRules) return;
    document.body.classList.add('spell-list-fullscreen');
    return () => document.body.classList.remove('spell-list-fullscreen');
  }, [canManageRules]);

  // Viewport-derived pane height. Chrome above the working grid:
  // navbar (~56) + toolbar (~50) + maybe "How rules work" strip
  // (collapsed by default; ~36 when collapsed, ~140 when expanded)
  // + small gaps ≈ 180. Conservative — a small underestimate just
  // leaves a few pixels at the bottom.
  //
  // Proposal-mode adds the wrapper's header (block name, queue
  // count, submit button, focus toggle) above the editor — about
  // another 120px including the wrapper's space-y-4 gap. Without
  // this bump the bottom of the rules grid would extend past the
  // viewport.
  const inProposalMode = !!proposalContext;
  const chromeOffset = inProposalMode ? 300 : 180;
  const [paneHeight, setPaneHeight] = useState<number>(() =>
    typeof window === 'undefined' ? 720 : Math.max(420, window.innerHeight - chromeOffset),
  );
  useEffect(() => {
    const onResize = () => setPaneHeight(Math.max(420, window.innerHeight - chromeOffset));
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [chromeOffset]);

  // Initial load
  useEffect(() => {
    if (!canManageRules) return;
    let active = true;
    (async () => {
      try {
        const [classData, sourceData, tagData, tagGroupData, spellData, ruleData, counts] = await Promise.all([
          fetchCollection<any>('classes', { orderBy: 'name ASC' }),
          fetchCollection<any>('sources', { orderBy: 'name ASC' }),
          fetchCollection<any>('tags', { orderBy: 'name ASC' }),
          fetchCollection<any>('tagGroups', { where: "classifications LIKE '%spell%'" }),
          fetchSpellSummaries('level ASC, name ASC'),
          fetchAllRules(),
          fetchApplicationCounts(),
        ]);
        if (!active) return;
        setClasses(classData.map((c: any) => ({ id: c.id, name: c.name })));
        setSources(sourceData);
        setTags(tagData.map(normalizeTagRow));
        setTagGroups(tagGroupData.map((g: any) => ({ id: g.id, name: g.name || 'Tags' })));
        setSpells(spellData.map((s: any) => ({
          id: s.id,
          name: s.name,
          level: Number(s.level || 0),
          school: s.school || '',
          source_id: s.source_id,
          tags: typeof s.tags === 'string' ? safeParseArr(s.tags) : (Array.isArray(s.tags) ? s.tags : []),
          ...deriveSpellFilterFacets(s),
        })));
        setRules(ruleData);
        setAppCounts(counts);
      } catch (err) {
        console.error('[SpellRulesEditor] Failed to load:', err);
        toast.error('Failed to load rules.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [canManageRules]);

  // Keep ?rule=<id> in the URL in sync with selection so the page is link-shareable.
  useEffect(() => {
    const current = searchParams.get('rule') || '';
    const want = selectedRuleId || '';
    if (current === want) return;
    const next = new URLSearchParams(searchParams);
    if (want) next.set('rule', want);
    else next.delete('rule');
    setSearchParams(next, { replace: true });
  }, [selectedRuleId, searchParams, setSearchParams]);

  // Auto-select the proposal's rule on entry to review mode so the
  // form populates immediately instead of waiting for the user to
  // click it in the rules list (which wouldn't include create drafts
  // at all, since they don't have a live row yet).
  useEffect(() => {
    if (isReviewingRule && reviewMode?.entityId && selectedRuleId !== reviewMode.entityId) {
      setSelectedRuleId(reviewMode.entityId);
    }
  }, [isReviewingRule, reviewMode?.entityId, selectedRuleId]);

  // Selection — load draft + applications for selected rule
  useEffect(() => {
    if (!selectedRuleId) {
      setDraft(null);
      setDraftDirty(false);
      setDraftApplications([]);
      setActiveClauseIndex(0);
      return;
    }
    // In review mode, build the draft from the proposal payload
    // rather than looking up the live row (which won't exist for
    // create proposals).
    const rule: SpellRule | null = isReviewingRule && reviewPayload
      ? {
          id: selectedRuleId,
          name: String((reviewPayload as any).name ?? ''),
          description: String((reviewPayload as any).description ?? ''),
          query: typeof (reviewPayload as any).query === 'string'
            ? (() => { try { return JSON.parse((reviewPayload as any).query); } catch { return {}; } })()
            : ((reviewPayload as any).query ?? {}),
          manualSpells: typeof (reviewPayload as any).manual_spells === 'string'
            ? (() => { try { return JSON.parse((reviewPayload as any).manual_spells); } catch { return []; } })()
            : ((reviewPayload as any).manual_spells ?? (reviewPayload as any).manualSpells ?? []),
          // manual_exclusions joined the SpellRule type in migration
          // 20260523-1500. Review payloads from older proposals won't
          // carry the field — fall back to empty so the editor can
          // render legacy proposals without crashing.
          manualExclusions: typeof (reviewPayload as any).manual_exclusions === 'string'
            ? (() => { try { return JSON.parse((reviewPayload as any).manual_exclusions); } catch { return []; } })()
            : ((reviewPayload as any).manual_exclusions ?? (reviewPayload as any).manualExclusions ?? []),
        }
      : rules.find(r => r.id === selectedRuleId) || null;
    if (rule) {
      // Auto-migrate legacy include-only arrays to the rich AxisFilter
      // shape at load time. The editor only ever writes the rich shape
      // (see the per-axis cycle handlers below), so legacy fields are
      // cleared as part of the migration. Authors don't see a behavior
      // change — every legacy entry becomes an `include` chip with the
      // default OR combinator.
      //
      // Multi-clause aware: the migration runs PER CLAUSE so a rule
      // with `{ clauses: [...] }` gets each clause cleaned up
      // individually. Single-clause flat rules go through the same
      // code path via `getClauses` returning a singleton.
      const arrToStates = (arr?: string[]): Record<string, number> | undefined => {
        if (!arr || arr.length === 0) return undefined;
        const out: Record<string, number> = {};
        for (const v of arr) out[v] = 1;
        return out;
      };
      const migrateClause = (q: RuleQuery): RuleQuery => {
        const migrated: Partial<RuleQuery> = {};
        if ((!q.tagStates || Object.keys(q.tagStates).length === 0) && q.tagFilterIds?.length) {
          migrated.tagStates = arrToStates(q.tagFilterIds);
          migrated.tagFilterIds = undefined;
        }
        const promoteAxis = (
          legacyKey: 'sourceFilterIds' | 'levelFilters' | 'schoolFilters' | 'activationFilters' | 'rangeFilters' | 'durationFilters' | 'shapeFilters' | 'propertyFilters',
          axisKey: 'source' | 'level' | 'school' | 'activation' | 'range' | 'duration' | 'shape' | 'property',
        ) => {
          const legacy = q[legacyKey] as string[] | undefined;
          const rich = q[axisKey] as any;
          const hasRich = rich && rich.states && Object.keys(rich.states).length > 0;
          if (!hasRich && legacy && legacy.length > 0) {
            (migrated as any)[axisKey] = { states: arrToStates(legacy) };
            (migrated as any)[legacyKey] = undefined;
          }
        };
        promoteAxis('sourceFilterIds', 'source');
        promoteAxis('levelFilters', 'level');
        promoteAxis('schoolFilters', 'school');
        promoteAxis('activationFilters', 'activation');
        promoteAxis('rangeFilters', 'range');
        promoteAxis('durationFilters', 'duration');
        promoteAxis('shapeFilters', 'shape');
        promoteAxis('propertyFilters', 'property');
        return Object.keys(migrated).length > 0 ? { ...q, ...migrated } : q;
      };

      const loadedClauses = getClauses(rule.query).map(migrateClause);
      const nextQuery: RuleClauseRoot =
        loadedClauses.length === 0
          ? {}
          : loadedClauses.length === 1
            ? loadedClauses[0]
            : { clauses: loadedClauses };
      setDraft({ ...rule, query: nextQuery });
      setActiveClauseIndex(0);
    }
    setDraftDirty(false);

    let active = true;
    fetchRuleApplications(selectedRuleId)
      .then(apps => { if (active) setDraftApplications(apps); })
      .catch(err => console.error('[SpellRulesEditor] Failed to load applications:', err));
    return () => { active = false; };
  }, [selectedRuleId, rules]);

  const tagsById = useMemo(
    () => Object.fromEntries(tags.map(t => [t.id, t])) as Record<string, TagRow>,
    [tags],
  );
  const tagsByGroup = useMemo(() => {
    // Subtags are ordered immediately after their parent within each
    // group so the chip row reads "Parent, ↳ Sub1, ↳ Sub2, NextParent,
    // …" — the visual prefix is applied per-tag in the picker via
    // tagPickerLabel().
    const map: Record<string, TagRow[]> = {};
    for (const tag of tags) {
      if (!tag.groupId) continue;
      (map[tag.groupId] = map[tag.groupId] || []).push(tag);
    }
    for (const groupId in map) {
      map[groupId] = orderTagsAsTree(map[groupId]);
    }
    return map;
  }, [tags]);
  const sourceById = useMemo(
    () => Object.fromEntries(sources.map(s => [s.id, s])) as Record<string, SourceRow>,
    [sources],
  );
  const classById = useMemo(
    () => Object.fromEntries(classes.map(c => [c.id, c])) as Record<string, ClassRow>,
    [classes],
  );
  const spellById = useMemo(
    () => Object.fromEntries(spells.map(s => [s.id, s])) as Record<string, SpellSummaryRow>,
    [spells],
  );

  // Tag-hierarchy index required by the rule matcher so rich-tag
  // rules (tagStates with per-group AND/OR/XOR combinators) actually
  // bucket their chips by group. Without this, the matcher's
  // defensive fallback in matchSpellAgainstRule returns true for
  // every spell — the live "matches" count would lie. The
  // server-side rebuild path builds its own index; this is for the
  // UI preview only.
  const tagIndex = useMemo(() => buildTagIndex(tags as any), [tags]);

  // Live match preview for the draft
  const draftMatchCount = useMemo(() => {
    if (!draft) return 0;
    let n = 0;
    for (const s of spells) if (spellMatchesRule(s, draft, tagIndex)) n++;
    return n;
  }, [draft, spells, tagIndex]);

  // Filtered spell suggestions for the manual-spells search
  const manualSpellSuggestions = useMemo(() => {
    const q = manualSpellsSearch.trim().toLowerCase();
    if (!q) return [];
    return spells
      .filter(s => !draft?.manualSpells.includes(s.id))
      .filter(s => s.name.toLowerCase().includes(q))
      .slice(0, 12);
  }, [manualSpellsSearch, spells, draft?.manualSpells]);

  if (!canManageRules) {
    return <div className="text-center py-20 text-ink/70">Access Denied.</div>;
  }

  // ------- Handlers -------

  const handleNewRule = () => {
    const fresh: SpellRule = {
      id: '',
      name: 'New Rule',
      description: '',
      query: {},
      manualSpells: [],
      manualExclusions: [],
    };
    setSelectedRuleId(null);
    setDraft(fresh);
    setDraftDirty(true);
    setDraftApplications([]);
    setActiveClauseIndex(0);
  };

  const updateDraft = (patch: Partial<SpellRule>) => {
    if (!draft) return;
    setDraft({ ...draft, ...patch });
    setDraftDirty(true);
  };

  // ── Multi-clause editing model ────────────────────────────────
  // A rule can carry either a single `RuleQuery` (legacy flat
  // shape) or a multi-clause root `{ clauses: RuleQuery[] }` (OR of
  // clauses). The editor always shows ONE clause's filter chips at
  // a time and lets the user switch via the tab strip above the
  // filter panel.
  //
  // `clauses` is the canonical array regardless of which shape
  // `draft.query` is currently in — `getClauses` flattens. The
  // active clause is `clauses[activeClauseIndex]`. Writes go
  // through `updateActiveClause`, which rebuilds the clauses array
  // immutably and re-serializes `draft.query` (flat when
  // `clauses.length === 1`, multi-clause object otherwise).
  const [activeClauseIndex, setActiveClauseIndex] = useState(0);
  const clauses: RuleQuery[] = useMemo(
    () => (draft ? getClauses(draft.query) : []),
    [draft],
  );
  const safeActiveIndex = Math.min(activeClauseIndex, Math.max(0, clauses.length - 1));
  const activeClause: RuleQuery = clauses[safeActiveIndex] || {};

  /** Current root-level hard-exclude tag list (separate axis from the
   *  per-clause tagStates tri-state). Lives at the wrapper for multi-
   *  clause shapes and on the flat root otherwise. */
  const rootExcludeTagIds = useMemo(
    () => (draft ? getRootExcludeTagIds(draft.query) : []),
    [draft],
  );

  /**
   * Serialize an updated clauses array back into a RuleClauseRoot.
   * Single-clause arrays round-trip to the legacy flat shape so
   * the stored JSON stays minimal; multi-clause arrays go to
   * `{ clauses: [...] }`. The root-level `excludeTagIds` list is
   * always preserved across shape transitions — flat-shape stores
   * it on the single clause's root, multi-clause stores it on the
   * wrapper.
   */
  const clausesToRoot = (next: RuleQuery[], excludeIds: string[] = rootExcludeTagIds): RuleClauseRoot => {
    const hasExcludes = excludeIds.length > 0;
    if (next.length === 0) {
      return hasExcludes ? { excludeTagIds: [...excludeIds] } : {};
    }
    if (next.length === 1) {
      const single = next[0];
      return hasExcludes ? { ...single, excludeTagIds: [...excludeIds] } : single;
    }
    return hasExcludes
      ? { clauses: next, excludeTagIds: [...excludeIds] }
      : { clauses: next };
  };

  const updateActiveClause = (patch: Partial<RuleQuery>) => {
    if (!draft) return;
    const next = clauses.map((c, i) =>
      i === safeActiveIndex ? { ...c, ...patch } : c,
    );
    setDraft({ ...draft, query: clausesToRoot(next) });
    setDraftDirty(true);
  };

  /** Reset the active clause to an empty `RuleQuery` (clears every
   *  chip in this clause). Other clauses are untouched. Root-level
   *  excludeTagIds is preserved. */
  const clearActiveClause = () => {
    if (!draft) return;
    const next = clauses.map((c, i) => (i === safeActiveIndex ? {} : c));
    setDraft({ ...draft, query: clausesToRoot(next) });
    setDraftDirty(true);
  };

  /** Append a fresh empty clause and switch focus to it. */
  const addClause = () => {
    if (!draft) return;
    const next = [...clauses, {}];
    setDraft({ ...draft, query: clausesToRoot(next) });
    setActiveClauseIndex(next.length - 1);
    setDraftDirty(true);
  };

  /**
   * Drop a clause by index. Refuses to delete the last remaining
   * clause — every rule must carry at least one clause (an empty
   * RuleQuery, if needed). Shifts `activeClauseIndex` so the user
   * stays anchored to a valid clause after the removal.
   */
  const removeClause = (idx: number) => {
    if (!draft) return;
    if (clauses.length <= 1) return;
    const next = clauses.filter((_, i) => i !== idx);
    let nextActive = safeActiveIndex;
    if (idx < safeActiveIndex) nextActive -= 1;
    if (nextActive >= next.length) nextActive = next.length - 1;
    setDraft({ ...draft, query: clausesToRoot(next) });
    setActiveClauseIndex(Math.max(0, nextActive));
    setDraftDirty(true);
  };

  /**
   * Toggle a tag in / out of the root-level hard-exclude list.
   * Independent of the per-clause tri-state chips — these tags are
   * applied as a post-match reject inside `matchAnyClause`. Stored
   * at the rule's root (wrapper for multi-clause, flat root for
   * single-clause).
   */
  const toggleExcludeTag = (tagId: string) => {
    if (!draft) return;
    const has = rootExcludeTagIds.includes(tagId);
    const nextIds = has
      ? rootExcludeTagIds.filter((id) => id !== tagId)
      : [...rootExcludeTagIds, tagId];
    setDraft({ ...draft, query: clausesToRoot(clauses, nextIds) });
    setDraftDirty(true);
  };

  const clearExcludeTags = () => {
    if (!draft) return;
    setDraft({ ...draft, query: clausesToRoot(clauses, []) });
    setDraftDirty(true);
  };

  // Kept for the small number of legacy call sites that still want
  // to write to a Partial<RuleQuery> on the active clause. All new
  // callers should use `updateActiveClause` directly.
  const updateQuery = updateActiveClause;

  // Per-axis helpers. `axisKey` is the canonical RuleQuery field
  // (source / level / school / activation / range / duration / shape /
  // property); `legacyKey` is the corresponding include-only array kept
  // for back-compat (sourceFilterIds / levelFilters / …). Every write
  // through the editor produces the rich shape and nulls the legacy
  // field so saves persist the new format only.
  type AxisFieldName = 'source' | 'level' | 'school' | 'activation' | 'range' | 'duration' | 'shape' | 'property';
  type LegacyFieldName = 'sourceFilterIds' | 'levelFilters' | 'schoolFilters' | 'activationFilters' | 'rangeFilters' | 'durationFilters' | 'shapeFilters' | 'propertyFilters';
  const cycleAxisState = (axisKey: AxisFieldName, legacyKey: LegacyFieldName, value: string) => {
    if (!draft) return;
    const axis = (activeClause[axisKey] as any) || {};
    const states = { ...(axis.states || {}) } as Record<string, number>;
    const cur = states[value] || 0;
    const nextState = cur === 0 ? 1 : cur === 1 ? 2 : 0;
    if (nextState === 0) delete states[value];
    else states[value] = nextState;
    updateQuery({ [axisKey]: { ...axis, states }, [legacyKey]: undefined } as Partial<RuleQuery>);
  };
  const cycleAxisCombineMode = (axisKey: AxisFieldName, legacyKey: LegacyFieldName) => {
    if (!draft) return;
    const axis = (activeClause[axisKey] as any) || {};
    const cur = (axis.combineMode || 'OR') as 'OR' | 'AND' | 'XOR';
    const next = cur === 'OR' ? 'AND' : cur === 'AND' ? 'XOR' : 'OR';
    updateQuery({ [axisKey]: { ...axis, combineMode: next }, [legacyKey]: undefined } as Partial<RuleQuery>);
  };
  const cycleAxisExclusionMode = (axisKey: AxisFieldName, legacyKey: LegacyFieldName) => {
    if (!draft) return;
    const axis = (activeClause[axisKey] as any) || {};
    const cur = (axis.exclusionMode || 'OR') as 'OR' | 'AND' | 'XOR';
    const next = cur === 'OR' ? 'AND' : cur === 'AND' ? 'XOR' : 'OR';
    updateQuery({ [axisKey]: { ...axis, exclusionMode: next }, [legacyKey]: undefined } as Partial<RuleQuery>);
  };
  const axisIncludeAll = (axisKey: AxisFieldName, legacyKey: LegacyFieldName, values: readonly string[]) => {
    if (!draft) return;
    const axis = (activeClause[axisKey] as any) || {};
    const states: Record<string, number> = { ...(axis.states || {}) };
    for (const v of values) states[v] = 1;
    updateQuery({ [axisKey]: { ...axis, states }, [legacyKey]: undefined } as Partial<RuleQuery>);
  };
  const axisExcludeAll = (axisKey: AxisFieldName, legacyKey: LegacyFieldName, values: readonly string[]) => {
    if (!draft) return;
    const axis = (activeClause[axisKey] as any) || {};
    const states: Record<string, number> = { ...(axis.states || {}) };
    for (const v of values) states[v] = 2;
    updateQuery({ [axisKey]: { ...axis, states }, [legacyKey]: undefined } as Partial<RuleQuery>);
  };
  const axisClear = (axisKey: AxisFieldName, legacyKey: LegacyFieldName) => {
    if (!draft) return;
    const axis = (activeClause[axisKey] as any) || {};
    updateQuery({ [axisKey]: { ...axis, states: {} }, [legacyKey]: undefined } as Partial<RuleQuery>);
  };

  // Reverse-direction cyclers for the right-click affordance in
  // SectionFilterPanel (mirror the forward cycle).
  const cycleAxisStateReverse = (axisKey: AxisFieldName, legacyKey: LegacyFieldName, value: string) => {
    if (!draft) return;
    const axis = (activeClause[axisKey] as any) || {};
    const states = { ...(axis.states || {}) } as Record<string, number>;
    const cur = states[value] || 0;
    const nextState = cur === 0 ? 2 : cur === 2 ? 1 : 0;
    if (nextState === 0) delete states[value];
    else states[value] = nextState;
    updateQuery({ [axisKey]: { ...axis, states }, [legacyKey]: undefined } as Partial<RuleQuery>);
  };
  const cycleAxisCombineModeReverse = (axisKey: AxisFieldName, legacyKey: LegacyFieldName) => {
    if (!draft) return;
    const axis = (activeClause[axisKey] as any) || {};
    const cur = (axis.combineMode || 'OR') as 'OR' | 'AND' | 'XOR';
    const next = cur === 'OR' ? 'XOR' : cur === 'XOR' ? 'AND' : 'OR';
    updateQuery({ [axisKey]: { ...axis, combineMode: next }, [legacyKey]: undefined } as Partial<RuleQuery>);
  };
  const cycleAxisExclusionModeReverse = (axisKey: AxisFieldName, legacyKey: LegacyFieldName) => {
    if (!draft) return;
    const axis = (activeClause[axisKey] as any) || {};
    const cur = (axis.exclusionMode || 'OR') as 'OR' | 'AND' | 'XOR';
    const next = cur === 'OR' ? 'XOR' : cur === 'XOR' ? 'AND' : 'OR';
    updateQuery({ [axisKey]: { ...axis, exclusionMode: next }, [legacyKey]: undefined } as Partial<RuleQuery>);
  };

  // Axis-key → legacy-field map. SectionFilterPanel passes only
  // axisKey through its callbacks, but our writers need the legacy
  // field name to clear out the back-compat array on every write
  // (rule writes always migrate to the rich shape). Look up here.
  const LEGACY_KEYS: Record<AxisFieldName, LegacyFieldName> = {
    source: 'sourceFilterIds',
    level: 'levelFilters',
    school: 'schoolFilters',
    activation: 'activationFilters',
    range: 'rangeFilters',
    duration: 'durationFilters',
    shape: 'shapeFilters',
    property: 'propertyFilters',
  };
  // SectionFilterPanel-compatible adapters — narrower signatures
  // that match the panel's prop contract; internally they look up
  // the legacy field name and dispatch to the full helpers above.
  const panelCycleAxisState = (axisKey: string, value: string) =>
    cycleAxisState(axisKey as AxisFieldName, LEGACY_KEYS[axisKey as AxisFieldName], value);
  const panelCycleAxisStateReverse = (axisKey: string, value: string) =>
    cycleAxisStateReverse(axisKey as AxisFieldName, LEGACY_KEYS[axisKey as AxisFieldName], value);
  const panelCycleAxisCombineMode = (axisKey: string) =>
    cycleAxisCombineMode(axisKey as AxisFieldName, LEGACY_KEYS[axisKey as AxisFieldName]);
  const panelCycleAxisCombineModeReverse = (axisKey: string) =>
    cycleAxisCombineModeReverse(axisKey as AxisFieldName, LEGACY_KEYS[axisKey as AxisFieldName]);
  const panelCycleAxisExclusionMode = (axisKey: string) =>
    cycleAxisExclusionMode(axisKey as AxisFieldName, LEGACY_KEYS[axisKey as AxisFieldName]);
  const panelCycleAxisExclusionModeReverse = (axisKey: string) =>
    cycleAxisExclusionModeReverse(axisKey as AxisFieldName, LEGACY_KEYS[axisKey as AxisFieldName]);
  const panelAxisIncludeAll = (axisKey: string, values: readonly string[]) =>
    axisIncludeAll(axisKey as AxisFieldName, LEGACY_KEYS[axisKey as AxisFieldName], values);
  const panelAxisExcludeAll = (axisKey: string, values: readonly string[]) =>
    axisExcludeAll(axisKey as AxisFieldName, LEGACY_KEYS[axisKey as AxisFieldName], values);
  const panelAxisClear = (axisKey: string) =>
    axisClear(axisKey as AxisFieldName, LEGACY_KEYS[axisKey as AxisFieldName]);

  // Tag cyclers that operate on activeClause.tagStates via
  // updateQuery (state lives in the editable rule entity, not in
  // ephemeral component state). Mirror the pattern from
  // useSpellFilters.cycleTagState etc.
  const panelCycleTagState = (tagId: string) => {
    const cur = (activeClause.tagStates || {})[tagId] || 0;
    const nextState = cur === 0 ? 1 : cur === 1 ? 2 : 0;
    const nextStates = { ...(activeClause.tagStates || {}) };
    if (nextState === 0) delete nextStates[tagId];
    else nextStates[tagId] = nextState;
    updateQuery({ tagStates: nextStates, tagFilterIds: undefined });
  };
  const panelCycleTagStateReverse = (tagId: string) => {
    const cur = (activeClause.tagStates || {})[tagId] || 0;
    const nextState = cur === 0 ? 2 : cur === 2 ? 1 : 0;
    const nextStates = { ...(activeClause.tagStates || {}) };
    if (nextState === 0) delete nextStates[tagId];
    else nextStates[tagId] = nextState;
    updateQuery({ tagStates: nextStates, tagFilterIds: undefined });
  };
  const panelCycleGroupMode = (groupId: string) => {
    const cur = (activeClause.groupCombineModes || {})[groupId] || 'OR';
    const next = cur === 'OR' ? 'AND' : cur === 'AND' ? 'XOR' : 'OR';
    updateQuery({ groupCombineModes: { ...(activeClause.groupCombineModes || {}), [groupId]: next } });
  };
  const panelCycleGroupModeReverse = (groupId: string) => {
    const cur = (activeClause.groupCombineModes || {})[groupId] || 'OR';
    const next = cur === 'OR' ? 'XOR' : cur === 'XOR' ? 'AND' : 'OR';
    updateQuery({ groupCombineModes: { ...(activeClause.groupCombineModes || {}), [groupId]: next } });
  };
  const panelCycleExclusionMode = (groupId: string) => {
    const cur = (activeClause.groupExclusionModes || {})[groupId] || 'OR';
    const next = cur === 'OR' ? 'AND' : cur === 'AND' ? 'XOR' : 'OR';
    updateQuery({ groupExclusionModes: { ...(activeClause.groupExclusionModes || {}), [groupId]: next } });
  };
  const panelCycleExclusionModeReverse = (groupId: string) => {
    const cur = (activeClause.groupExclusionModes || {})[groupId] || 'OR';
    const next = cur === 'OR' ? 'XOR' : cur === 'XOR' ? 'AND' : 'OR';
    updateQuery({ groupExclusionModes: { ...(activeClause.groupExclusionModes || {}), [groupId]: next } });
  };
  // setTagStates wrapper — writes through updateQuery so the rule
  // entity stays the source of truth.
  const panelSetTagStates: React.Dispatch<React.SetStateAction<Record<string, number>>> = (next) => {
    const newStates = typeof next === 'function' ? next(activeClause.tagStates || {}) : next;
    updateQuery({ tagStates: newStates, tagFilterIds: undefined });
  };

  // Derived axisFilters record for the panel. Each axis state lives
  // as its own field on activeClause (`source`, `level`, …) but the
  // panel expects a flat Record<axisKey, AxisState>. Build that
  // mapping here.
  const panelAxisFilters = useMemo<Record<string, { states: Record<string, number>; combineMode?: 'AND' | 'OR' | 'XOR'; exclusionMode?: 'AND' | 'OR' | 'XOR' }>>(() => ({
    source: (activeClause.source as any) ?? { states: {} },
    level: (activeClause.level as any) ?? { states: {} },
    school: (activeClause.school as any) ?? { states: {} },
    activation: (activeClause.activation as any) ?? { states: {} },
    range: (activeClause.range as any) ?? { states: {} },
    duration: (activeClause.duration as any) ?? { states: {} },
    shape: (activeClause.shape as any) ?? { states: {} },
    property: (activeClause.property as any) ?? { states: {} },
  }), [activeClause]);

  // Two separate axis lists — one for the "Normal Options"
  // disclosure (base axes), one for "Advanced Options — Tags"
  // (per-tag-group rows). Mirrors the original two-disclosure UX.
  const miniPillBaseAxes = useMemo<FilterSection[]>(() => ([
    {
      key: 'source', name: 'Sources', kind: 'axis',
      values: sources.map(s => ({
        value: s.id,
        label: String(s.abbreviation || s.shortName || s.name || s.id),
        labelAlt: String(s.name || s.shortName || s.abbreviation || s.id),
      })),
    },
    {
      key: 'level', name: 'Spell Level', kind: 'axis',
      values: Array.from({ length: 10 }, (_, i) => ({ value: String(i), label: i === 0 ? 'Cantrip' : `Level ${i}` })),
    },
    {
      key: 'school', name: 'School', kind: 'axis',
      values: Object.entries(SCHOOL_LABELS).map(([k, label]) => ({ value: k, label })),
    },
    {
      key: 'activation', name: 'Casting Time', kind: 'axis',
      values: ACTIVATION_ORDER.map(b => ({ value: b, label: ACTIVATION_LABELS[b] })),
    },
    {
      key: 'range', name: 'Range', kind: 'axis',
      values: RANGE_ORDER.map(b => ({ value: b, label: RANGE_LABELS[b] })),
    },
    {
      key: 'duration', name: 'Duration', kind: 'axis',
      values: DURATION_ORDER.map(b => ({ value: b, label: DURATION_LABELS[b] })),
    },
    {
      key: 'shape', name: 'Shape', kind: 'axis',
      values: SHAPE_ORDER.map(b => ({ value: b, label: SHAPE_LABELS[b] })),
    },
    {
      key: 'property', name: 'Properties', kind: 'axis',
      values: PROPERTY_ORDER.map(p => ({ value: p, label: PROPERTY_LABELS[p] })),
    },
  ]), [sources]);

  const miniPillTagAxes = useMemo<FilterSection[]>(() => {
    const axes: FilterSection[] = [];
    for (const group of tagGroups) {
      const groupTags = (tagsByGroup[group.id] || []) as Array<{ id: string; name?: string; parentTagId?: string | null; parent_tag_id?: string | null }>;
      if (groupTags.length === 0) continue;
      const idSet = new Set(groupTags.map(t => t.id));
      axes.push({
        key: `tag-group:${group.id}`,
        name: String((group as any).name ?? 'Tags'),
        kind: 'tag',
        groupId: group.id,
        values: groupTags.map(t => {
          const parent = t.parentTagId ?? t.parent_tag_id ?? null;
          return {
            value: t.id,
            label: String(t.name ?? t.id),
            parentValue: parent && idSet.has(parent) ? parent : undefined,
          };
        }),
      });
    }
    return axes;
  }, [tagGroups, tagsByGroup]);

  // Active-filter counts per panel — drives the panel's emblems strip.
  const baseActiveCount = useMemo(() => {
    let n = 0;
    for (const key of Object.keys(panelAxisFilters)) {
      n += Object.keys(panelAxisFilters[key]?.states ?? {}).length;
    }
    return n;
  }, [panelAxisFilters]);
  const tagActiveCount = useMemo(() => Object.keys(activeClause.tagStates ?? {}).length, [activeClause.tagStates]);

  // Per-panel local pill-search state (the rule editor isn't wrapped
  // in FilterBar, so we render non-embedded; each panel owns its
  // own search input via these states).
  const [baseAxesSearch, setBaseAxesSearch] = useState('');
  const [tagAxesSearch, setTagAxesSearch] = useState('');

  // Reset just this clause's base / tag state via updateQuery.
  const resetBaseAxes = () => {
    updateQuery({
      source: undefined, level: undefined, school: undefined,
      activation: undefined, range: undefined, duration: undefined,
      shape: undefined, property: undefined,
      sourceFilterIds: undefined, levelFilters: undefined, schoolFilters: undefined,
      activationFilters: undefined, rangeFilters: undefined, durationFilters: undefined,
      shapeFilters: undefined, propertyFilters: undefined,
    } as Partial<RuleQuery>);
  };
  const resetTagAxes = () => {
    updateQuery({
      tagStates: undefined, tagFilterIds: undefined,
      groupCombineModes: undefined, groupExclusionModes: undefined,
    } as Partial<RuleQuery>);
  };

  // ── Hard-exclude tags as a SectionFilterPanel ───────────────────
  // The hard-exclude tag list is rule-wide (not per-clause) and
  // single-state (a tag is either in `rootExcludeTagIds` or not).
  // We map that one-dimensional state onto SectionFilterPanel's
  // tri-state by:
  //   - showing every excluded tag as state=2 (panel's "exclude"
  //     style: blood border + strikethrough)
  //   - making BOTH cycle directions toggle the tag's membership
  //   - hiding the include controls entirely (omit axisIncludeAll,
  //     cycleGroupMode, cycleExclusionMode — the panel hides the
  //     buttons whose handlers are missing)
  const excludeTagAxes = useMemo<FilterSection[]>(() => {
    const axes: FilterSection[] = [];
    for (const group of tagGroups) {
      const groupTags = (tagsByGroup[group.id] || []) as TagRow[];
      if (groupTags.length === 0) continue;
      const idSet = new Set(groupTags.map(t => t.id));
      axes.push({
        key: `hard-exclude:${group.id}`,
        name: String((group as any).name ?? 'Tags'),
        kind: 'tag',
        groupId: group.id,
        values: groupTags.map(t => {
          const parent = (t as any).parentTagId ?? (t as any).parent_tag_id ?? null;
          return {
            value: t.id,
            label: tagPickerLabel(t as any),
            parentValue: parent && idSet.has(parent) ? parent : undefined,
          };
        }),
      });
    }
    return axes;
  }, [tagGroups, tagsByGroup]);
  // Derived tagStates: every excluded tag at state 2. Include
  // state (1) is never used here — those pills render as neutral.
  const excludeTagStates = useMemo<Record<string, number>>(
    () => Object.fromEntries(rootExcludeTagIds.map(id => [id, 2])),
    [rootExcludeTagIds],
  );
  // Both directions toggle membership — there's no include semantic
  // in hard-exclude so cycling has only two states: in or out.
  const excludeToggle = (tagId: string) => toggleExcludeTag(tagId);
  // Bulk handlers: exclude-all adds every value in the group;
  // clear removes them. No include-all (no include semantic).
  const excludeAxisExcludeAll = (axisKey: string, values: readonly string[]) => {
    if (!draft) return;
    const merged = Array.from(new Set([...rootExcludeTagIds, ...values]));
    clausesToRootAndPersist(merged);
  };
  const excludeAxisClear = (axisKey: string) => {
    if (!draft) return;
    const groupValueSet = new Set<string>();
    // Find the values for this axis to know what to drop.
    const axis = excludeTagAxes.find(a => a.key === axisKey);
    if (!axis) return;
    for (const v of axis.values) groupValueSet.add(v.value);
    const next = rootExcludeTagIds.filter(id => !groupValueSet.has(id));
    clausesToRootAndPersist(next);
  };
  // Helper that mirrors `toggleExcludeTag`'s persist path with an
  // explicit id list — used by the bulk all/clear handlers above.
  function clausesToRootAndPersist(excludeIds: string[]) {
    if (!draft) return;
    setDraft({ ...draft, query: clausesToRoot(clauses, excludeIds) });
    setDraftDirty(true);
  }
  const [excludeTagSearch, setExcludeTagSearch] = useState('');

  const handleSave = async () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      toast.error('Rule name is required.');
      return;
    }
    setSaving(true);
    try {
      const wasEdit = !!draft.id;

      // Content-creators don't write to spell_rules directly — the
      // rule goes into the proposal queue and an admin re-applies it
      // on approve. We skip the auto-rebuild + stale-class detection
      // path entirely; the row isn't in D1 yet, so nothing to rebuild
      // against. The editor re-renders with the same data afterwards.
      if (isProposalMode) {
        const payload = {
          name: draft.name.trim(),
          description: draft.description ?? '',
          // useEntityWriter's sanitizePayload stringifies these on
          // the way out (spell_rules.query + .manual_spells +
          // .manual_exclusions are declared json columns in
          // api/_lib/proposals.ts).
          query: draft.query,
          manual_spells: draft.manualSpells,
          manual_exclusions: draft.manualExclusions,
        };
        if (wasEdit && draft.id) {
          await ruleWriter.update(draft.id, payload);
        } else {
          await ruleWriter.create(payload);
        }
        setDraftDirty(false);
        toast.success(actionLabel(ruleWriter.mode, wasEdit ? 'updated' : 'created'));
        return;
      }

      const id = await saveRule({
        id: draft.id || null,
        name: draft.name.trim(),
        description: draft.description,
        query: draft.query,
        manualSpells: draft.manualSpells,
      });
      const refreshed = await fetchAllRules();
      const counts = await fetchApplicationCounts();
      setRules(refreshed);
      setAppCounts(counts);
      setSelectedRuleId(id);
      setDraftDirty(false);
      // Phase 4.4: no more save-time auto-rebuild / stale-banner
      // dance. The resolver reads applied-rule state live, so any
      // class that has this rule applied immediately reflects the
      // edit on its next spell-list read — no rebuild step,
      // no staleness window. Single success toast covers all
      // cases.
      toast(wasEdit ? `Saved rule "${draft.name}".` : `Created rule "${draft.name}".`);
    } catch (err) {
      console.error('[SpellRulesEditor] Save failed:', err);
      toast.error('Failed to save rule.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!draft || !draft.id) return;
    setDeleteDialogOpen(false);
    try {
      if (isProposalMode) {
        await ruleWriter.remove(draft.id);
        toast.success(actionLabel(ruleWriter.mode, 'deleted'));
        return;
      }
      await deleteRule(draft.id);
      const refreshed = await fetchAllRules();
      const counts = await fetchApplicationCounts();
      setRules(refreshed);
      setAppCounts(counts);
      setSelectedRuleId(null);
      setDraft(null);
      toast(`Deleted rule "${draft.name}".`);
    } catch (err) {
      console.error('[SpellRulesEditor] Delete failed:', err);
      toast.error('Failed to delete rule.');
    }
  };

  const handleApplyToConsumer = async (type: ConsumerType, id: string) => {
    if (!draft?.id) return;
    try {
      if (isProposalMode) {
        // Proposers can only apply rules that already exist in D1.
        // The `draft?.id` guard above covers brand-new-but-unsaved
        // rules; here the rule has an id, so the application
        // proposal can target it. The proposed row carries the
        // composite uniqueness fields the spell_rule_applications
        // table needs (rule_id + applies_to_type + applies_to_id).
        await ruleAppWriter.create({
          rule_id: draft.id,
          applies_to_type: type,
          applies_to_id: id,
        });
        toast.success(actionLabel(ruleAppWriter.mode, 'applied'));
        return;
      }
      await applyRule(draft.id, type, id);
      const apps = await fetchRuleApplications(draft.id);
      setDraftApplications(apps);
      setAppCounts(await fetchApplicationCounts());
      const label = type === 'class' ? classById[id]?.name || id : id;
      toast(`Applied "${draft.name}" to ${CONSUMER_LABELS[type]}: ${label}.`);
    } catch (err) {
      console.error('[SpellRulesEditor] Apply failed:', err);
      toast.error('Failed to apply rule.');
    }
  };

  const handleUnapply = async (app: SpellRuleApplication) => {
    if (!draft?.id) return;
    try {
      if (isProposalMode) {
        // Delete by application-row id (writer requires entity_id).
        // The live `unapplyRule` deletes by composite key; the
        // proposal endpoint deletes by primary key on approve. Same
        // end state.
        await ruleAppWriter.remove(app.id);
        toast.success(actionLabel(ruleAppWriter.mode, 'removed'));
        return;
      }
      await unapplyRule(draft.id, app.appliesToType, app.appliesToId);
      setDraftApplications(prev => prev.filter(a => a.id !== app.id));
      setAppCounts(await fetchApplicationCounts());
    } catch (err) {
      console.error('[SpellRulesEditor] Unapply failed:', err);
      toast.error('Failed to remove application.');
    }
  };

  // Narrow K to only the array-typed fields. RuleQuery now has Record
  // fields too (tagStates / groupCombineModes / groupExclusionModes)
  // which can't be indexed via `[number]`, so the original signature
  // broke. Extract just the array-typed keys at the type level.
  type ArrayQueryKey = {
    [K in keyof RuleQuery]: RuleQuery[K] extends (infer _T)[] | undefined ? K : never;
  }[keyof RuleQuery];

  const toggleFromQueryArray = <K extends ArrayQueryKey>(
    field: K,
    value: NonNullable<RuleQuery[K]>[number],
  ) => {
    if (!draft) return;
    const current = (activeClause[field] as any[] | undefined) || [];
    const next = current.includes(value) ? current.filter(v => v !== value) : [...current, value];
    updateActiveClause({ [field]: next } as Partial<RuleQuery>);
  };

  const queryActiveCount = useMemo(() => {
    if (!draft) return 0;
    // Counts the chips on the ACTIVE clause only — so the FilterBar
    // badge reflects "this clause" rather than the sum across all
    // clauses. Switching clauses re-evaluates this memo.
    const q = activeClause;
    const axisCount = (a: { states?: Record<string, number> } | undefined) => Object.keys(a?.states ?? {}).length;
    return (q.sourceFilterIds?.length ?? 0)
      + (q.levelFilters?.length ?? 0)
      + (q.schoolFilters?.length ?? 0)
      + (q.tagFilterIds?.length ?? 0)
      + Object.keys(q.tagStates ?? {}).length
      + (q.activationFilters?.length ?? 0)
      + (q.rangeFilters?.length ?? 0)
      + (q.durationFilters?.length ?? 0)
      + (q.shapeFilters?.length ?? 0)
      + (q.propertyFilters?.length ?? 0)
      + axisCount(q.source)
      + axisCount(q.level)
      + axisCount(q.school)
      + axisCount(q.activation)
      + axisCount(q.range)
      + axisCount(q.duration)
      + axisCount(q.shape)
      + axisCount(q.property);
  }, [draft, activeClauseIndex]);

  return (
    // Fullscreen layout — toolbar shrinks to its natural height,
    // working grid (rules list | editor) fills the remaining
    // viewport. Mirrors /compendium/spells / /compendium/spells/
    // manage / /compendium/spell-lists.
    <div className="h-full flex flex-col gap-2 p-2">
      {/* Consolidated top toolbar: Back link + title chip +
          "How rules work" disclosure trigger + dirty banner. */}
      <div className="shrink-0 flex items-center gap-3 bg-card p-2 rounded-lg border border-gold/10 shadow-sm flex-wrap">
        <Link to={backPath}>
          <Button variant="ghost" size="sm" className="h-8 text-gold gap-2 hover:bg-gold/5">
            <ChevronLeft className="w-4 h-4" />
            Back
          </Button>
        </Link>
        <span className="text-xs font-bold uppercase tracking-[0.18em] text-gold/70 shrink-0">Spell Rules</span>
        <span className="text-[11px] text-ink/45 tabular-nums">{rules.length} rules</span>
        <button
          type="button"
          onClick={() => setHowOpen(v => !v)}
          className="h-8 inline-flex items-center gap-1.5 px-2 rounded-md border border-gold/15 text-[10px] uppercase tracking-[0.18em] text-ink/65 hover:bg-gold/5 hover:text-gold transition-colors"
          aria-expanded={howOpen}
        >
          {howOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          <Info className="w-3 h-3" />
          How rules work
        </button>
        <div className="flex-1" />
        {draftDirty ? (
          <span className="text-[10px] uppercase tracking-[0.2em] text-amber-400 font-bold">Unsaved changes</span>
        ) : null}
      </div>

      {/* Expanded "How rules work" — only when explicitly opened.
          Keeps the toolbar slim by default; opens to a fixed-height
          strip with the full explainer. */}
      {howOpen ? (
        <div className="shrink-0 px-4 py-3 bg-background/30 border border-gold/10 rounded-md text-xs text-ink/75 space-y-1.5">
          <p>
            <span className="text-gold font-bold">A rule</span> is a saved spell-curation pattern — a
            <span className="text-gold"> tag query</span> (e.g. "all spells tagged <em>Divine</em> at level 1+")
            plus a <span className="text-gold">manual list</span> of spell IDs that always match.
          </p>
          <p>
            <span className="text-gold font-bold">Applying a rule</span> links it to a consumer (class, subclass, feat, item, etc.).
            The same rule can power many consumers — that's the point.
            For classes, application contributes the rule's matches to
            the resolver-driven spell list on the next read. Manual
            additions / exclusions live on the rule itself
            (<code className="text-gold/80">manual_spells</code> /
            <code className="text-gold/80">manual_exclusions</code>),
            not on a separate per-class table.
          </p>
        </div>
      ) : null}

      {/* Working area — rules list (320px) | editor (1fr). Both
          cards fixed at paneHeight so they scroll internally and
          the viewport stays anchored. */}
      <div className="flex-1 min-h-0 grid gap-2 lg:grid-cols-[320px_minmax(0,1fr)]">
        {/* Rule list — flex column so the header strip pins to the
            top while the rule rows scroll within the remaining
            height. */}
        <Card
          className="border-gold/20 bg-card/50 overflow-hidden"
          style={{ height: `${paneHeight}px` }}
        >
          <CardContent className="p-0 h-full flex flex-col">
            <div className="border-b border-gold/10 px-4 py-3 flex items-center justify-between shrink-0">
              <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-gold">All Rules ({rules.length})</h3>
              <Button
                type="button"
                size="sm"
                onClick={handleNewRule}
                className="h-7 px-2 text-[10px] uppercase tracking-[0.18em] bg-gold/15 text-gold border border-gold/30 hover:bg-gold/25"
              >
                <Plus className="w-3 h-3 mr-1" /> New
              </Button>
            </div>
            {loading ? (
              <div className="px-6 py-12 text-center text-ink/45">Loading…</div>
            ) : rules.length === 0 ? (
              <div className="px-6 py-12 text-center text-ink/45 text-sm italic">
                No rules yet. Click <strong>New</strong> to create one.
              </div>
            ) : (
              <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar divide-y divide-gold/5">
                {rules.map(rule => {
                  const isSelected = rule.id === selectedRuleId;
                  const apps = appCounts[rule.id] || 0;
                  // Rule has staged work in the active block — same
                  // archive-blue accent as the other wrapped editors.
                  const drafted = draftedRuleIds.has(rule.id);
                  return (
                    <button
                      key={rule.id}
                      type="button"
                      onClick={() => setSelectedRuleId(rule.id)}
                      title={drafted ? `${rule.name} — staged in this block` : undefined}
                      className={cn(
                        'w-full text-left px-4 py-2.5 transition-colors border-l-2',
                        isSelected
                          ? 'bg-gold/15 border-l-gold'
                          : drafted
                            ? 'bg-archive-blue/5 hover:bg-archive-blue/10 border-l-archive-blue/60'
                            : 'hover:bg-gold/5 border-l-transparent',
                      )}
                    >
                      <div className={cn(
                        "text-sm font-bold truncate",
                        drafted && !isSelected ? 'text-archive-blue' : 'text-ink',
                      )}>
                        {rule.name}
                      </div>
                      <div className="text-[10px] text-ink/50">
                        {apps === 0 ? <span className="italic">unapplied</span> : `applied to ${apps}`}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Editor — same paneHeight cap; CardContent scrolls
            internally so all the editor sections (name, query
            filters, manual spells, applied-to) stay reachable
            without a page-level scroll. */}
        <Card
          className="border-gold/20 bg-card/50 overflow-hidden"
          style={{ height: `${paneHeight}px` }}
        >
          <CardContent className="p-0 h-full overflow-y-auto custom-scrollbar">
            {!draft ? (
              <div className="px-8 py-20 text-center text-ink/45">
                Pick a rule from the list, or click <strong>New</strong> to create one.
              </div>
            ) : (
              <div className="divide-y divide-gold/10">
                {/* Header / actions */}
                <div className="px-6 py-4 flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <Input
                      value={draft.name}
                      onChange={e => updateDraft({ name: e.target.value })}
                      placeholder="Rule name (e.g. Divine — Major)"
                      className="h-9 text-base font-bold bg-background/40 border-gold/20"
                    />
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {draft.id ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setDeleteDialogOpen(true)}
                        className="h-8 px-3 text-[10px] uppercase tracking-[0.18em] border-gold/20 text-ink/45 hover:bg-blood/10 hover:text-blood hover:border-blood/40"
                      >
                        <Trash2 className="w-3 h-3 mr-1" /> Delete
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleSave}
                      disabled={saving || !draft.name.trim()}
                      className="h-8 px-3 text-[10px] uppercase tracking-[0.18em] bg-gold/15 text-gold border border-gold/30 hover:bg-gold/25"
                    >
                      <Save className="w-3 h-3 mr-1" /> {saving ? 'Saving…' : draft.id ? 'Save Changes' : 'Save Rule'}
                    </Button>
                  </div>
                </div>

                <div className="px-6 py-4 space-y-1">
                  <Label className="text-[10px] font-bold uppercase tracking-widest text-ink/60">Description</Label>
                  <Input
                    value={draft.description}
                    onChange={e => updateDraft({ description: e.target.value })}
                    placeholder="Short note about what this rule covers"
                    className="bg-background/40 border-gold/20"
                  />
                </div>

                {/* Filter editor */}
                <div className="px-6 py-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-gold">Tag Query</h3>
                    <span className="text-[10px] text-ink/50">
                      <span className="text-gold font-bold">{draftMatchCount}</span> spell{draftMatchCount === 1 ? '' : 's'} match (query + manual)
                    </span>
                  </div>

                  {/* Clause tab strip. Each clause is an independent
                      RuleQuery (axis filters + tag chips); a spell
                      matches the rule if any clause matches (OR). Lets
                      a single rule express "(all Arcane except Heal)
                      OR (Heal only when Revival/Necromancy)" — two
                      filter sets that can't be merged into one AND of
                      chips. The active tab determines which clause the
                      filter UI below edits; the +/− buttons add or
                      remove clauses. Single-clause rules read this
                      strip as a one-pill "Clause 1" label with the
                      add-clause "+" affordance to its right. */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {clauses.map((_, idx) => {
                      const isActive = idx === safeActiveIndex;
                      return (
                        <div
                          key={idx}
                          className={cn(
                            'inline-flex items-center rounded border transition-colors',
                            isActive
                              ? 'border-gold bg-gold/15 text-gold'
                              : 'border-gold/20 bg-card/50 text-ink/65 hover:border-gold/45',
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => setActiveClauseIndex(idx)}
                            className={cn(
                              'px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] transition-colors',
                              isActive ? '' : 'hover:text-gold',
                            )}
                          >
                            Clause {idx + 1}
                          </button>
                          {clauses.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeClause(idx)}
                              title={`Remove Clause ${idx + 1}`}
                              className={cn(
                                'px-1.5 py-1 text-[10px] font-bold border-l transition-colors',
                                isActive
                                  ? 'border-gold/40 text-gold/70 hover:bg-blood/15 hover:text-blood'
                                  : 'border-gold/20 text-ink/30 hover:bg-blood/10 hover:text-blood',
                              )}
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      );
                    })}
                    <button
                      type="button"
                      onClick={addClause}
                      title="Add a new clause (OR with existing clauses)"
                      className="inline-flex items-center gap-1 rounded border border-dashed border-gold/35 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-gold/70 hover:bg-gold/10 hover:border-gold transition-colors"
                    >
                      <Plus className="w-3 h-3" />
                      Add Clause
                    </button>
                    {clauses.length > 1 ? (
                      <span className="ml-1 text-[10px] italic text-ink/45">
                        OR-combined ({clauses.length} clauses)
                      </span>
                    ) : null}
                  </div>

                  {/* Filter chips are always inline on this page — the
                      FilterBar wrapper (search + popup-toggle pattern
                      used by /compendium/spells and the SpellListManager)
                      doesn't fit here because the search box did nothing
                      (the rule editor doesn't search spells; it AUTHORS
                      filter chips) and the popup hid the chips behind an
                      extra click. Inline lets the user see + edit every
                      chip without context-switching. The chip-count
                      badge + "Clear clause" affordance ride in a small
                      header row above the chip sections. */}
                  <div className="flex items-center gap-3 px-1">
                    <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-ink/55">
                      Filters
                    </span>
                    <span
                      className={cn(
                        'inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-sm text-[10px] font-black tabular-nums',
                        queryActiveCount > 0
                          ? 'bg-gold/20 text-gold border border-gold/40'
                          : 'bg-card border border-gold/15 text-ink/40',
                      )}
                      title={`${queryActiveCount} chip${queryActiveCount === 1 ? '' : 's'} on this clause`}
                    >
                      {queryActiveCount}
                    </span>
                    <div className="flex-1" />
                    {queryActiveCount > 0 ? (
                      <button
                        type="button"
                        onClick={clearActiveClause}
                        className="inline-flex items-center gap-1 h-7 px-2 rounded border border-blood/30 bg-blood/5 text-[10px] font-bold uppercase tracking-[0.18em] text-blood/80 hover:bg-blood/10 hover:text-blood transition-colors"
                        title="Reset every chip on this clause to off"
                      >
                        <X className="w-3 h-3" />
                        Clear clause
                      </button>
                    ) : null}
                  </div>
                  <div className="space-y-4">
                        {/* "Normal Options" — the eight axis sections
                            (Source / Level / School / Casting / Range
                            / Shape / Duration / Properties) wrapped
                            in a single closed-by-default `<details>`
                            so the editor opens slim and the user
                            expands the group they actually need. The
                            chip-count badge in the summary row tells
                            them at a glance whether the current
                            clause has any axis chips set. Mirrors the
                            sibling "Advanced Options — Tags"
                            disclosure below. Each inner section also
                            keeps its own chevron for granular
                            collapse once the parent is opened. */}
                        <details className="group">
                          <summary className="cursor-pointer list-none flex items-center justify-between border border-gold/15 rounded-md px-4 py-2 hover:border-gold/30 transition-colors">
                            <span className="text-xs font-bold uppercase tracking-[0.2em] text-gold/80">
                              Normal Options
                              {queryActiveCount > 0 && (
                                <span className="ml-2 text-gold/60">({queryActiveCount} chip{queryActiveCount === 1 ? '' : 's'})</span>
                              )}
                            </span>
                            <span className="text-[10px] text-ink/40 group-open:rotate-90 transition-transform">▶</span>
                          </summary>
                          <div className="mt-3 pl-1">
                            <SectionFilterPanel
                              axes={miniPillBaseAxes}
                              axisFilters={panelAxisFilters}
                              tagStates={{}}
                              cycleAxisState={panelCycleAxisState}
                              cycleAxisStateReverse={panelCycleAxisStateReverse}
                              cycleTagState={() => {}}
                              cycleTagStateReverse={() => {}}
                              cycleAxisCombineMode={panelCycleAxisCombineMode}
                              cycleAxisCombineModeReverse={panelCycleAxisCombineModeReverse}
                              cycleAxisExclusionMode={panelCycleAxisExclusionMode}
                              cycleAxisExclusionModeReverse={panelCycleAxisExclusionModeReverse}
                              axisIncludeAll={panelAxisIncludeAll}
                              axisExcludeAll={panelAxisExcludeAll}
                              axisClear={panelAxisClear}
                              search={baseAxesSearch}
                              setSearch={setBaseAxesSearch}
                              searchPlaceholder="Filter axes…"
                              activeFilterCount={baseActiveCount}
                              resetAll={resetBaseAxes}
                            />
                          </div>
                        </details>

                        {/* Tags + per-group AND/OR/XOR live in an
                            Advanced Options disclosure. Most rules use
                            level/school/source/buckets only; tags are
                            opt-in for the longer-tail queries. */}
                        <details className="group">
                          <summary className="cursor-pointer list-none flex items-center justify-between border border-gold/15 rounded-md px-4 py-2 hover:border-gold/30 transition-colors">
                            <span className="text-xs font-bold uppercase tracking-[0.2em] text-gold/80">
                              Advanced Options — Tags
                              {Object.keys(activeClause.tagStates ?? {}).length > 0 && (
                                <span className="ml-2 text-gold/60">({Object.keys(activeClause.tagStates ?? {}).length} selected)</span>
                              )}
                            </span>
                            <span className="text-[10px] text-ink/40 group-open:rotate-90 transition-transform">▶</span>
                          </summary>
                          <div className="mt-4 pl-1">
                            <SectionFilterPanel
                              axes={miniPillTagAxes}
                              axisFilters={{}}
                              tagStates={activeClause.tagStates || {}}
                              cycleAxisState={() => {}}
                              cycleAxisStateReverse={() => {}}
                              cycleTagState={panelCycleTagState}
                              cycleTagStateReverse={panelCycleTagStateReverse}
                              cycleGroupMode={panelCycleGroupMode}
                              cycleGroupModeReverse={panelCycleGroupModeReverse}
                              cycleExclusionMode={panelCycleExclusionMode}
                              cycleExclusionModeReverse={panelCycleExclusionModeReverse}
                              groupCombineModes={activeClause.groupCombineModes || {}}
                              groupExclusionModes={activeClause.groupExclusionModes || {}}
                              setTagStates={panelSetTagStates}
                              search={tagAxesSearch}
                              setSearch={setTagAxesSearch}
                              searchPlaceholder="Filter tags…"
                              activeFilterCount={tagActiveCount}
                              resetAll={resetTagAxes}
                            />
                          </div>
                        </details>
                        {/* Root-level hard exclude. Independent of the per-
                            clause tri-state chips above. Any spell carrying
                            ANY of these tags is rejected from this rule's
                            result, AFTER all clauses match — see
                            `matchAnyClause` in lib/spellFilters.ts. One list
                            per rule, even when the rule has multiple
                            clauses. */}
                        <details className="group">
                          <summary className="cursor-pointer list-none flex items-center justify-between border border-blood/20 rounded-md px-4 py-2 hover:border-blood/40 transition-colors">
                            <span className="text-xs font-bold uppercase tracking-[0.2em] text-blood/80">
                              Hard Exclude Tags
                              {rootExcludeTagIds.length > 0 && (
                                <span className="ml-2 text-blood/60">
                                  ({rootExcludeTagIds.length} excluded)
                                </span>
                              )}
                            </span>
                            <span className="text-[10px] text-ink/40 group-open:rotate-90 transition-transform">▶</span>
                          </summary>
                          <div className="mt-4 space-y-3 pl-1">
                            <p className="text-[10px] text-ink/40 leading-relaxed">
                              Any spell carrying one of these tags is dropped from this rule's result
                              <em> after </em> the clauses above run — regardless of which clause matched it
                              or what include/exclude chips a tag has inside a clause. Use this for
                              one-off blacklists that would be awkward to express through per-clause
                              tri-state (e.g. "match all level-1 evocation, but never the
                              <code>spell:cantrip</code> tagged spells").
                            </p>
                            {/* SectionFilterPanel adapted to the hard-exclude
                                model — single-state pills (in/out of the
                                blacklist). Both click directions map to
                                toggleExcludeTag; include controls are
                                omitted (no axisIncludeAll / cycleGroupMode
                                / cycleExclusionMode passed) so the panel
                                hides those buttons. The bulk "none" button
                                excludes-all in the group; "clear" drops
                                them. */}
                            <SectionFilterPanel
                              axes={excludeTagAxes}
                              axisFilters={{}}
                              tagStates={excludeTagStates}
                              cycleAxisState={() => {}}
                              cycleAxisStateReverse={() => {}}
                              cycleTagState={excludeToggle}
                              cycleTagStateReverse={excludeToggle}
                              axisExcludeAll={excludeAxisExcludeAll}
                              axisClear={excludeAxisClear}
                              search={excludeTagSearch}
                              setSearch={setExcludeTagSearch}
                              searchPlaceholder="Filter tags…"
                              activeFilterCount={rootExcludeTagIds.length}
                              resetAll={clearExcludeTags}
                            />
                          </div>
                        </details>
                  </div>
                  <p className="text-[10px] text-ink/40">
                    The query selects spells by their attributes. Combine sections with AND (a spell must match every section that has any chips picked).
                  </p>
                </div>

                {/* Manual spells */}
                <div className="px-6 py-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-gold">
                      Manual Additions ({draft.manualSpells.length})
                    </h3>
                  </div>
                  <p className="text-[10px] text-ink/40">
                    Specific spells that always match this rule, even if the tag query doesn't pick them up.
                  </p>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink/40 pointer-events-none" />
                    <Input
                      value={manualSpellsSearch}
                      onChange={e => setManualSpellsSearch(e.target.value)}
                      placeholder="Search spells to add…"
                      className="pl-9 bg-background/40 border-gold/20"
                      // Suppress the browser's "history" autofill dropdown
                      // on this filter input — the suggestions list is
                      // driven by `manualSpellSuggestions` (spell names
                      // from the catalogue), and Chrome's heuristic
                      // dropdown showing previously-typed values floats
                      // ON TOP of ours, hiding the real picks.
                      // `data-form-type="other"` is the Chrome-specific
                      // hint that helps when the field isn't inside a
                      // <form> (Chrome ignores `autoComplete="off"`
                      // alone in some cases).
                      autoComplete="off"
                      data-form-type="other"
                      name="spell-rule-manual-spell-search"
                    />
                    {manualSpellSuggestions.length > 0 ? (
                      <div className="absolute left-0 right-0 top-full mt-1 z-10 max-h-64 overflow-y-auto bg-card border border-gold/30 rounded-md shadow-lg divide-y divide-gold/10">
                        {manualSpellSuggestions.map(s => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => {
                              updateDraft({ manualSpells: [...draft.manualSpells, s.id] });
                              setManualSpellsSearch('');
                            }}
                            className="w-full text-left px-3 py-2 text-sm text-ink hover:bg-gold/10 flex items-center justify-between"
                          >
                            <span className="truncate">{s.name}</span>
                            <span className="text-[10px] text-ink/50 shrink-0 ml-2">
                              {s.level === 0 ? 'C' : `L${s.level}`} · {SCHOOL_LABELS[s.school] || s.school}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  {draft.manualSpells.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {draft.manualSpells.map(id => {
                        const s = spellById[id];
                        return (
                          <span
                            key={id}
                            className="inline-flex items-center gap-1 rounded-full border border-gold/30 bg-gold/10 pl-2 pr-1 py-0.5 text-[11px] text-gold"
                          >
                            {s?.name || id}
                            <button
                              type="button"
                              onClick={() => updateDraft({ manualSpells: draft.manualSpells.filter(x => x !== id) })}
                              aria-label="Remove spell"
                              className="rounded-full hover:bg-gold/20 p-0.5"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-ink/40 italic">No manual additions.</p>
                  )}
                </div>

                {/* Applied to */}
                <div className="px-6 py-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-gold">
                      Applied To ({draftApplications.length})
                    </h3>
                    <div className="flex items-center gap-2">
                      {/* No Rebuild All button — phase 4.4 removed
                          class_spell_lists. Every applied consumer
                          reads via the resolver, so a rule edit is
                          visible immediately on the next read. */}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setApplyDialogOpen(true)}
                        disabled={!draft.id}
                        className="h-7 px-2 text-[10px] uppercase tracking-[0.18em] border-gold/30 text-gold hover:bg-gold/10"
                        title={!draft.id ? 'Save the rule before linking it to consumers' : 'Apply this rule to a consumer'}
                      >
                        <Plus className="w-3 h-3 mr-1" /> Apply To…
                      </Button>
                    </div>
                  </div>
                  {!draft.id ? (
                    <p className="text-xs text-ink/40 italic">Save the rule first to link it to classes / feats / etc.</p>
                  ) : draftApplications.length === 0 ? (
                    <p className="text-xs text-ink/40 italic">Not applied to anything yet.</p>
                  ) : (
                    <div className="space-y-1">
                      {draftApplications.map(app => {
                        const label = app.appliesToType === 'class'
                          ? (classById[app.appliesToId]?.name || app.appliesToId)
                          : app.appliesToId;
                        return (
                          <div
                            key={app.id}
                            className="flex items-center gap-3 px-3 py-1.5 rounded border border-gold/15 hover:border-gold/30"
                          >
                            <span className="text-[10px] uppercase tracking-widest text-gold/60 shrink-0">
                              {CONSUMER_LABELS[app.appliesToType]}
                            </span>
                            <span className="text-sm text-ink truncate flex-1">{label}</span>
                            <button
                              type="button"
                              onClick={() => handleUnapply(app)}
                              className="text-[10px] uppercase tracking-widest text-ink/40 hover:text-blood"
                            >
                              Remove
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {draftDirty ? (
                  <div className="px-6 py-3 bg-gold/[0.06] text-[10px] uppercase tracking-widest text-gold/80">
                    Unsaved changes
                  </div>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Apply-to dialog */}
      <Dialog open={applyDialogOpen} onOpenChange={setApplyDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Apply rule to…</DialogTitle>
            <DialogDescription>
              Pick a class to link this rule to. Other consumer types (subclasses, feats, items, etc.)
              are supported by the data model and will become pickable here as Layer 2 lands.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-72 overflow-y-auto custom-scrollbar divide-y divide-gold/10 -mx-4">
            {classes.length === 0 ? (
              <p className="px-4 py-3 text-sm text-ink/45 italic">No classes loaded.</p>
            ) : (
              classes.map(c => {
                const alreadyApplied = draftApplications.some(
                  a => a.appliesToType === 'class' && a.appliesToId === c.id,
                );
                return (
                  <button
                    key={c.id}
                    type="button"
                    disabled={alreadyApplied}
                    onClick={async () => {
                      await handleApplyToConsumer('class', c.id);
                      setApplyDialogOpen(false);
                    }}
                    className={cn(
                      'w-full text-left px-4 py-2 text-sm flex items-center justify-between',
                      alreadyApplied ? 'text-ink/30 cursor-not-allowed' : 'text-ink hover:bg-gold/10',
                    )}
                  >
                    <span>{c.name}</span>
                    {alreadyApplied ? <span className="text-[10px] uppercase text-gold/50">already applied</span> : null}
                  </button>
                );
              })
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setApplyDialogOpen(false)}
              className="border-gold/20 text-ink/70 hover:bg-gold/5"
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete-confirm dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete rule?</DialogTitle>
            <DialogDescription>
              {draft ? (
                <>
                  Permanently remove <span className="text-ink font-bold">{draft.name}</span>. All applications
                  to consumers are removed too. Spells already added to class lists by this rule stay there
                  until the next Rebuild for each affected class.
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              className="border-gold/20 text-ink/70 hover:bg-gold/5"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleDelete}
              className="bg-blood/15 text-blood border border-blood/40 hover:bg-blood/25"
            >
              Delete Rule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function safeParseArr(raw: string): any[] {
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch { return []; }
}

function RuleFilterSection({
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
                  : 'border-gold/15 text-ink/55 hover:border-gold/30 hover:text-gold/80',
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
