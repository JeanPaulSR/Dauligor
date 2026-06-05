import React, { useState, useEffect, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { useParams, useNavigate, Link, useLocation } from 'react-router-dom';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import {
  Repeat,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Save,
  Plus,
  Edit,
} from 'lucide-react';
import { fetchCollection, fetchDocument, upsertDocument, deleteDocument } from '../../lib/d1';
import { cn } from '../../lib/utils';
import { denormalizeCompendiumData } from '../../lib/compendium';
import { useProposalAccumulator, useProposalContextOptional } from '../../lib/proposalAccumulator';
import { useProposalEntityDrafts } from '../../hooks/useProposalEntityDrafts';
import { useBlockDraftedList } from '../../hooks/useBlockDraftedList';
import { actionLabel, applyProposalWrite } from '../../lib/proposalAware';
import { useProposalReview, resolveReviewPayload } from '../../lib/proposalReview';
import { DeletedEntityBanner } from '../../components/proposals/TombstoneRow';
import { useTombstoneBanner } from '../../hooks/useTombstoneBanner';
import { useProposalSingleWorkId } from '../../hooks/useProposalSingleWorkId';
import { useProposalPreFlushSave } from '../../hooks/useProposalPreFlushSave';
import { ProposalAwareEditorHeader } from '../../components/proposals/ProposalAwareEditorHeader';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import MarkdownEditor from '@/components/MarkdownEditor';
import BBCodeRenderer from '@/components/BBCodeRenderer';
import { ImageUpload } from '../../components/ui/ImageUpload';
import EntityPicker from '../../components/ui/EntityPicker';
import ActivityEditor from '../../components/compendium/ActivityEditor';
import ActiveEffectEditor from '../../components/compendium/ActiveEffectEditor';
import AdvancementManager from '../../components/compendium/AdvancementManager';
import FeatureModalHero from '../../components/compendium/FeatureModalHero';
import RequirementsEditor, { RequirementsEditorLookups } from '../../components/compendium/RequirementsEditor';
import { useBlockDraftPickerOptions } from '../../hooks/useBlockDraftPickerOptions';
import {
  Requirement,
  parseRequirementTree,
  serializeRequirementTree,
  formatRequirementText,
  isLeaf,
  extractTopLevelLevelLeaf,
} from '../../lib/requirements';

/**
 * Lazy flat→tree migration. Existing items carry their level gate in the flat
 * `level_prerequisite` column; when one is opened for editing we inject a
 * matching top-level `level` leaf so the gate is visible + editable in the
 * RequirementsEditor. Save re-projects it to the flat column (via the shared
 * `extractTopLevelLevelLeaf`), keeping the exporter / importer in sync. No-op
 * when there's no flat level or the tree already exposes a level leaf.
 */
function migrateFlatLevelIntoTree(item: any): any {
  const flatLevel = parseInt(item?.levelPrerequisite ?? item?.level_prerequisite) || 0;
  if (flatLevel <= 0) return item;
  const tree: Requirement | null = (item?.requirementsTree as Requirement | null) ?? null;
  if (extractTopLevelLevelLeaf(tree)) return item;
  const isTotal = Boolean(item?.levelPrereqIsTotal ?? item?.level_prereq_is_total);
  const levelLeaf = { kind: 'leaf', type: 'level', minLevel: flatLevel, isTotal } as Requirement;
  // Land the leaf as a direct child of a root `all` group — the only shape
  // extractTopLevelLevelLeaf reads back on save, and a hard AND rather than
  // folding the gate into an existing any/one group.
  let nextTree: Requirement;
  if (!tree) {
    nextTree = { kind: 'all', children: [levelLeaf] };
  } else if (!isLeaf(tree) && tree.kind === 'all') {
    nextTree = { ...tree, children: [levelLeaf, ...tree.children] };
  } else {
    nextTree = { kind: 'all', children: [levelLeaf, tree] };
  }
  return { ...item, requirementsTree: nextTree };
}

export default function UniqueOptionGroupEditor({ userProfile }: { userProfile: any }) {
  // Defensive: handle stale `/edit/null` URLs the same way ClassEditor
  // does — treat the literal string as if no id were provided.
  const { id: rawId } = useParams();
  const id = rawId && rawId !== 'null' && rawId !== 'undefined' ? rawId : undefined;
  const navigate = useNavigate();
  const location = useLocation();
  // Route-aware: the proposal route (/proposals/edit/option-groups/*)
  // mounts this editor inside <ProposalEditorWrapper>, which renders a
  // sticky "PROPOSAL EDITOR" strip above the editor body; the admin-
  // direct route (/compendium/unique-options/*) has none. Declared up
  // here (ahead of the fullscreen layout math) because the pane-height
  // chrome budget below has to account for that strip.
  const isProposalRoute = location.pathname.startsWith('/proposals/edit/');

  // ─── Fullscreen fixed-height layout (mirrors the browser / Spells) ─
  // Lock the body so the page itself doesn't scroll; each pane gets a
  // fixed height and scrolls internally. On <lg the 3-pane grid stacks
  // and we drop the fixed height so the panes flow naturally (mobile).
  const isLg = useMediaQuery('(min-width: 1024px)');
  useEffect(() => {
    document.body.classList.add('spell-list-fullscreen');
    return () => document.body.classList.remove('spell-list-fullscreen');
  }, []);
  // Chrome budget subtracted from the viewport to size each pane. The
  // proposal route stacks the wrapper's sticky "PROPOSAL EDITOR" strip
  // (+ its space-y-4 gap) above us, so the 3-pane row has less vertical
  // room — bump the budget there so the bottom of the Option editor pane
  // (its Close / Update Option footer) stays inside the locked viewport
  // instead of being clipped below the fold. Mirrors
  // CompendiumEditorShell's `chromeOffset = proposalMode ? 320 : 200`.
  const chromeOffset = isProposalRoute ? 270 : 150;
  const [paneHeight, setPaneHeight] = useState<number>(() =>
    typeof window === 'undefined' ? 720 : Math.max(420, window.innerHeight - chromeOffset),
  );
  useEffect(() => {
    const onResize = () => setPaneHeight(Math.max(420, window.innerHeight - chromeOffset));
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [chromeOffset]);
  // Only impose the fixed pane height at lg+ (where panes sit side by
  // side); below that one pane shows at a time (drilldown) and fills the
  // locked viewport.
  const paneStyle = isLg ? { height: `${paneHeight}px` } : undefined;
  // <lg single-pane drilldown — mirrors the browse page convention
  // (Group → Options → Option editor). At lg+ all three panes show.
  type EditorPane = 'group' | 'options' | 'editor';
  const [narrowView, setNarrowView] = useState<EditorPane>('group');
  // Route-aware basePath — admin route writes through upsertDocument
  // directly; proposal route wraps with ProposalEditorWrapper and the
  // accumulators below queue into the active block. (isProposalRoute is
  // declared above, alongside the fullscreen layout math.)
  const basePath = isProposalRoute ? '/proposals/edit/option-groups' : '/compendium/unique-options';
  const groupWriter = useProposalAccumulator('unique_option_group', userProfile);
  const itemWriter = useProposalAccumulator('unique_option_item', userProfile);
  const proposalContext = useProposalContextOptional();
  const isProposalMode = groupWriter.mode === 'proposal' || groupWriter.mode === 'block';
  // Review-mode: load form from the proposal's payload instead of the
  // live row when the URL has `?review=<id>` for THIS group.
  const reviewMode = useProposalReview();
  const reviewPayload = resolveReviewPayload(reviewMode, 'unique_option_group', id ?? null);
  const isReviewingThis = !!reviewMode && !!reviewPayload;
  // Same queue/draft lookup pattern as ClassEditor — supports loading
  // a queued-but-not-yet-flushed group when the live row doesn't exist.
  const groupDrafts = useProposalEntityDrafts('unique_option_group');
  // Tombstone banner state (queued / drafted DELETE in active block).
  const { isPendingDelete: isGroupPendingDelete, undoDelete: undoGroupDelete } =
    useTombstoneBanner('unique_option_group', id);
  // See useProposalSingleWorkId for the pendingCreateId convention.
  const { effectiveId, pendingCreateId, recordCreate } = useProposalSingleWorkId(id);
  const [deleteGroupConfirmOpen, setDeleteGroupConfirmOpen] = useState(false);
  const [pendingItemDeleteId, setPendingItemDeleteId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sources, setSources] = useState<any[]>([]);

  // Group State
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [groupClassIds, setGroupClassIds] = useState<string[]>([]);

  // Items State. The option being edited lives in the inline 3rd pane
  // (Group | Options | Option editor) — `editingItem != null` IS the
  // "editor open" signal; there's no separate modal-open flag anymore.
  const [items, setItems] = useState<any[]>([]);
  const [editingItem, setEditingItem] = useState<any>(null);
  const [classes, setClasses] = useState<any[]>([]);
  // Lookups consumed by <RequirementsEditor>. Loaded once on mount alongside
  // the group's own data — keeps the option modal's leaf pickers populated
  // (subclasses, every other Modular Option Group's items, spell rules,
  // proficiency pools). Features and spells are deferred until the picker
  // grows a search UI; they're optional in the editor's API so the leaves
  // stay in the type dropdown but their pickers report "(no … available)"
  // until wired.
  const [subclasses, setSubclasses] = useState<any[]>([]);
  const [spellRules, setSpellRules] = useState<any[]>([]);
  /**
   * All Modular Option Groups with their items pre-attached, used by the
   * `optionItem` requirement leaf for its cascading group → item picker.
   * Includes the group currently being edited so an option can reference
   * a sibling (the previous `requires_option_ids` behaviour, now folded
   * into the tree).
   */
  const [allOptionGroups, setAllOptionGroups] = useState<Array<{
    id: string;
    name: string;
    items: Array<{ id: string; name: string }>;
  }>>([]);
  // Flat denormalized option items (carry `groupId`) + the feats catalog.
  // Feed AdvancementManager's ItemGrant / ItemChoice target pickers
  // (Concern 3) — it resolves a group's items via
  // `availableOptionItems.filter(i => i.groupId === groupId)`.
  const [allOptionItems, setAllOptionItems] = useState<any[]>([]);
  const [feats, setFeats] = useState<any[]>([]);
  // Global feature compendium (any feature with uses) — Item Uses consumption
  // targets for option-feature activities. See ActivityEditor `itemTargets`.
  const [allFeatures, setAllFeatures] = useState<any[]>([]);
  /**
   * Proficiency pools (weapons + categories, armor + categories, tools +
   * categories, skills, languages + categories) used by the `proficiency`
   * requirement leaf's SingleSelectSearch. Per-category list mixes
   * specific entries with their category rows; the latter get a
   * "Category" hint badge to disambiguate.
   */
  const [proficiencyPools, setProficiencyPools] = useState<RequirementsEditorLookups['proficiencies']>({});
  // Block-draft overlays (Part C L2) for the RequirementsEditor lookups, so an
  // option item's prerequisites can reference a same-block draft class /
  // subclass / spell-rule / option-group. Empty outside a <ProposalEditorWrapper>.
  const classDraftOptions = useBlockDraftPickerOptions('class');
  const subclassDraftOptions = useBlockDraftPickerOptions('subclass');
  const spellRuleDraftOptions = useBlockDraftPickerOptions('spell_rule');
  const optionGroupDraftOptions = useBlockDraftPickerOptions('unique_option_group');
  // Advancement-tab pickers (Concern 3): an option item's ItemGrant /
  // ItemChoice advancement can target other option items or feats,
  // including same-block drafts — same overlay pattern FeatsEditor uses.
  const optionItemDraftOptions = useBlockDraftPickerOptions('unique_option_item');
  const featDraftOptions = useBlockDraftPickerOptions('feat');
  // Tab state for the option-item modal — mirrors ClassEditor's feature
  // modal so authoring an option (Maneuver / Invocation / Infusion) feels
  // identical to authoring a class feature.
  const [optionTab, setOptionTab] = useState<'description' | 'details' | 'activities' | 'effects' | 'advancement'>('description');
  const groupDescRef = useRef<HTMLTextAreaElement>(null);
  const itemDescRef = useRef<HTMLTextAreaElement>(null);

  /**
   * Name-by-id lookup used by `formatRequirementText` when rendering
   * tree-based prereqs as plain text in the list-row summary. Built
   * from the entity collections fetched above; recomputed only when
   * one of those changes. The leaf types we don't populate here
   * (features, spells) format to "<unknown …>" placeholders, which
   * is the documented fallback — we'll wire them in once those
   * pickers grow real lookups.
   */
  const requirementsTextLookup = useMemo(() => {
    // Proficiency leaves store the Foundry identifier; resolve those to
    // display names so the preview + list-row summary read "Athletics"
    // not "ath" (matches the FeatsEditor lookup shape).
    const profMap = (cat: 'weapon' | 'armor' | 'tool' | 'skill' | 'language') =>
      Object.fromEntries((proficiencyPools[cat] ?? []).map((p) => [p.id, p.name]));
    return {
      classNameById: Object.fromEntries(classes.map((c: any) => [c.id, c.name])),
      subclassNameById: Object.fromEntries(subclasses.map((s: any) => [s.id, s.name])),
      spellRuleNameById: Object.fromEntries(spellRules.map((r: any) => [r.id, r.name])),
      optionItemNameById: Object.fromEntries(
        allOptionGroups.flatMap(g => g.items.map(it => [it.id, it.name] as const)),
      ),
      skillNameById: profMap('skill'),
      weaponNameById: profMap('weapon'),
      armorNameById: profMap('armor'),
      toolNameById: profMap('tool'),
      languageNameById: profMap('language'),
    };
  }, [classes, subclasses, spellRules, allOptionGroups, proficiencyPools]);

  // Overlay the active block's drafted options for THIS group onto the
  // live `items` so a proposed option persists in the Options column
  // across reopens — not just optimistically in-session. loadAll fetches
  // only LIVE rows, so without this a queued CREATE shows in the block
  // but vanishes from the column on reload. Keyed on `group_id`; the
  // sentinel parentId keeps it from sweeping in other groups' drafts
  // before this group has an id. Returns `items` untouched outside a
  // wrapper (admin route).
  const displayItems = useBlockDraftedList<any>('unique_option_item', items, {
    parentId: effectiveId || '__no_group__',
    parentKey: 'group_id',
  });
  // Normalize like loadAll does — appended draft rows arrive with a raw
  // (string) requirements_tree + snake-case flags; parse so the list-row
  // renderer and the level sort read the same typed shape as live rows.
  // parseRequirementTree is idempotent (loadAll already parses live rows).
  const optionRows = useMemo(
    () =>
      displayItems.map((it: any) => ({
        ...it,
        requirementsTree: parseRequirementTree(it.requirementsTree ?? it.requirements_tree),
        levelPrereqIsTotal: Boolean(it.levelPrereqIsTotal ?? it.level_prereq_is_total),
      })),
    [displayItems],
  );

  // Options list ordered by level prerequisite (ascending), then name.
  // The effective level is the flat `level_prerequisite` column OR, for
  // tree-authored / migrated items, the tree's top-level `level` leaf —
  // so the order matches what the row actually displays.
  const sortedItems = useMemo(() => {
    const effectiveLevel = (it: any): number => {
      const leaf = extractTopLevelLevelLeaf(it.requirementsTree ?? null);
      if (leaf) return Number(leaf.minLevel) || 0;
      return Number(it.level_prerequisite ?? it.levelPrerequisite) || 0;
    };
    return [...optionRows].sort((a, b) => {
      const la = effectiveLevel(a), lb = effectiveLevel(b);
      if (la !== lb) return la - lb;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
  }, [optionRows]);

  useEffect(() => {
    const loadAll = async () => {
      setLoading(true);
      try {
        // Lookup fetches run in parallel — the option modal won't open
        // until at least the group itself is loaded below, so the extra
        // round-trips here just need to finish before authoring starts.
        //
        // Resilience: wrap each lookup so a single flaky collection (the
        // worker intermittently 503s on one query) can't reject the WHOLE
        // batch and skip EVERY setState below — that's what left the Source
        // dropdown empty. A failed lookup logs and degrades to [] while the
        // rest populate normally; reopening the editor retries.
        const settleAll = (ps: Promise<any>[]): Promise<any[]> =>
          Promise.all(ps.map((p, i) => p.catch((err) => {
            console.error(`[UniqueOptionGroupEditor] lookup #${i} failed; using [] fallback`, err);
            return [];
          })));
        const [
          sourcesData, classesData, subclassesData, spellRulesData,
          allGroups, allOptionItems,
          weapons, weaponCategories, armor, armorCategories,
          tools, toolCategories, skills, languages, languageCategories,
          featsData, featuresData,
        ] = await settleAll([
          fetchCollection('sources', { orderBy: 'name ASC' }),
          fetchCollection('classes', { orderBy: 'name ASC' }),
          fetchCollection('subclasses', { orderBy: 'name ASC' }),
          fetchCollection('spellRules', { orderBy: 'name ASC' }),
          fetchCollection('uniqueOptionGroups', { orderBy: 'name ASC' }),
          // All option items across all groups, used to populate the
          // optionItem-leaf picker (so an item in group A can require an
          // item in group B — e.g. an Eldritch Invocation requiring a
          // Warlock Pact).
          fetchCollection('uniqueOptionItems', { orderBy: 'name ASC' }),
          // Proficiency pools for the `proficiency` requirement leaf.
          // Both specific entries (longsword, plate, thieves' tools…)
          // and their parent categories (Martial Weapons, Heavy Armor…)
          // are valid proficiency targets in 5e, so we fetch both and
          // merge per category below.
          fetchCollection('weapons', { orderBy: 'name ASC' }),
          fetchCollection('weaponCategories', { orderBy: '"order", name ASC' }),
          fetchCollection('armor', { orderBy: 'name ASC' }),
          fetchCollection('armorCategories', { orderBy: '"order", name ASC' }),
          fetchCollection('tools', { orderBy: 'name ASC' }),
          fetchCollection('toolCategories', { orderBy: '"order", name ASC' }),
          fetchCollection('skills', { orderBy: 'name ASC' }),
          fetchCollection('languages', { orderBy: 'name ASC' }),
          fetchCollection('languageCategories', { orderBy: '"order", name ASC' }),
          // Feats catalog — ItemGrant feat targets in the Advancement tab.
          fetchCollection('feats', { orderBy: 'name ASC' }),
          // Global feature compendium — Item Uses consumption targets for
          // option-feature activities (any feature carrying `uses`).
          fetchCollection('features', { orderBy: 'name ASC' }),
        ]);
        setSources(sourcesData);
        setClasses(classesData);
        setSubclasses(subclassesData);
        setSpellRules(spellRulesData);

        // Bucket items into their parent groups so the cascading picker
        // doesn't have to scan the flat list every render.
        const groupsWithItems = (allGroups as any[]).map((g: any) => ({
          id: g.id,
          name: g.name,
          items: (allOptionItems as any[])
            .filter((it: any) => (it.group_id || it.groupId) === g.id)
            .map((it: any) => ({ id: it.id, name: it.name })),
        }));
        setAllOptionGroups(groupsWithItems);
        // Flat denormalized list (carries `groupId`) for AdvancementManager's
        // group→items resolution; feats catalog for ItemGrant feat targets.
        setAllOptionItems((allOptionItems as any[]).map((it: any) => denormalizeCompendiumData(it)));
        setFeats(featsData as any[]);
        setAllFeatures(featuresData as any[]);

        // Merge per-kind proficiency pools. Each row's `identifier`
        // is what gets stored on the leaf and round-trips as the
        // Foundry key — that's why we use it as the SingleSelectSearch
        // option id, not the database PK. Category rows get a hint
        // badge so authors can distinguish "all Martial Weapons" from
        // a specific weapon at a glance.
        const mergeProf = (
          entries: any[],
          categories: any[],
        ): Array<{ id: string; name: string; hint?: string }> => [
          ...entries.map((e: any) => ({ id: e.identifier, name: e.name })),
          ...categories.map((c: any) => ({ id: c.identifier, name: c.name, hint: 'Category' })),
        ];
        setProficiencyPools({
          weapon: mergeProf(weapons as any[], weaponCategories as any[]),
          armor: mergeProf(armor as any[], armorCategories as any[]),
          tool: mergeProf(tools as any[], toolCategories as any[]),
          skill: (skills as any[]).map((s: any) => ({ id: s.identifier, name: s.name })),
          language: mergeProf(languages as any[], languageCategories as any[]),
        });

        if (id) {
          // 3. Group — in review mode pull the proposed payload (or
          //    snapshot, for delete reviews) so the form mirrors what
          //    the user submitted rather than the live row. Proposal
          //    mode also falls back to the queue/drafts when the live
          //    row doesn't exist (post-Create on /new with no flush).
          let groupData: any = null;
          if (isReviewingThis) {
            groupData = reviewPayload;
          } else if (isProposalMode && groupDrafts.byId.has(id)) {
            groupData = groupDrafts.byId.get(id) ?? null;
          } else {
            groupData = await fetchDocument<any>('uniqueOptionGroups', id);
            if (!groupData && isProposalMode && groupDrafts.byId.has(id)) {
              groupData = groupDrafts.byId.get(id) ?? null;
            }
          }

          if (groupData) {
            setName(groupData.name || '');
            setDescription(groupData.description || '');
            setSourceId(groupData.source_id || groupData.sourceId || '');
            setGroupClassIds(groupData.class_ids || groupData.classIds || []);
          }

          // 4. Items — denormalize so camelCase keys (iconUrl, imageUrl,
          // usesMax, usesRecovery, classIds, etc.) the editor binds to
          // actually populate from the snake_case row returned by D1.
          // Without this the icon never re-displays after save and the
          // hero header looks empty on reopen.
          //
          // `requirements_tree` is auto-parsed by d1.ts (added in
          // migration 20260510-2152) but we run it through
          // parseRequirementTree() once on load so callers can rely on a
          // typed shape downstream rather than `any`.
          const itemsData = await fetchCollection('uniqueOptionItems', {
            where: 'group_id = ?',
            params: [id],
            orderBy: 'name ASC',
          });
          setItems(itemsData.map((row: any) => {
            const denorm = denormalizeCompendiumData(row);
            return {
              ...denorm,
              requirementsTree: parseRequirementTree(
                denorm.requirementsTree ?? denorm.requirements_tree
              ),
              levelPrereqIsTotal: Boolean(
                denorm.levelPrereqIsTotal ?? denorm.level_prereq_is_total
              ),
            };
          }));
        }
      } catch (err) {
        console.error("Error loading unique options data:", err);
      } finally {
        setLoading(false);
      }
    };

    loadAll();
  }, [id]);

  const handleSaveGroup = async (e?: React.FormEvent, opts: { silent?: boolean } = {}) => {
    if (e) e.preventDefault();
    if (!opts.silent) setLoading(true);

    try {
      const d1Data = {
        name,
        description,
        source_id: sourceId,
        class_ids: groupClassIds,
        updated_at: new Date().toISOString(),
      };

      // effectiveId carries the locally-minted id from a prior
      // proposal-mode CREATE so follow-up saves UPDATE the same queue
      // entry instead of minting new groups every click.
      const targetId = effectiveId || crypto.randomUUID();
      if (isProposalMode) {
        const isCreate = !effectiveId;
        await applyProposalWrite(groupWriter, d1Data, {
          id: targetId,
          isCreate,
          silent: opts.silent,
          submitNow: proposalContext?.submitNow,
        });
        if (isCreate) recordCreate(targetId);
        // Proposal mode stays on /new after Create — navigating would
        // unmount the wrapper and lose the in-memory queue. The editor
        // uses pendingCreateId to track the minted id for future saves.
      } else {
        await upsertDocument('uniqueOptionGroups', targetId, d1Data);
        if (id) {
          if (!opts.silent) toast.success('Group saved successfully');
        } else {
          if (!opts.silent) toast.success('Group created successfully');
          if (!opts.silent) navigate(`${basePath}/edit/${targetId}`);
        }
      }
    } catch (error) {
      console.error("Error saving group:", error);
      if (!opts.silent) toast.error('Failed to save group');
      else throw error;
    } finally {
      if (!opts.silent) setLoading(false);
    }
  };

  // Pre-flush registration: when wrapped in proposal mode for an
  // Pre-flush: stage current form state at Submit Changes time. See
  // useProposalPreFlushSave for the contract.
  useProposalPreFlushSave({
    enabled: isProposalMode,
    proposalContext,
    handleSave: handleSaveGroup,
    shouldRun: () => !!effectiveId,
  });

  const handleDeleteGroup = () => {
    if (!id) return;
    setDeleteGroupConfirmOpen(true);
  };

  const performDeleteGroup = async () => {
    if (!id) return;
    setLoading(true);
    try {
      if (isProposalMode) {
        // Queue a DELETE revision for the group and one per item.
        // The accumulator's 50-revision cap protects against runaway
        // bundles; admin still has to approve each row, but at least
        // the intent is captured.
        for (const item of items) {
          await itemWriter.remove(item.id);
        }
        await groupWriter.remove(id);
        toast.success(actionLabel(groupWriter.mode, 'deleted'));
      } else {
        for (const item of items) {
          await deleteDocument('uniqueOptionItems', item.id);
        }
        await deleteDocument('uniqueOptionGroups', id);
        toast.success('Option group deleted');
      }
      navigate(basePath);
    } catch (error) {
      console.error("Error deleting group:", error);
      toast.error('Failed to delete option group');
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const handleSaveItem = async (e?: React.SyntheticEvent) => {
    e?.preventDefault();
    // effectiveId, not id: a group created in this block carries its minted id
    // here even before useParams.id is set, so options can be added to a
    // just-created group without a reload (Issue 2 / reload-gap fix).
    if (!effectiveId) return;

    try {
      // Pull JSON fields off either case, default to safe empty shapes.
      // Migration 20260509-1356 added the full feat-shape body
      // (activities/effects/advancements/properties/tags/uses_recovery/
      // image_url/quantity_column_id/scaling_column_id/feature_type/
      // subtype/requirements). The form may not surface all of these
      // yet (the tabs refactor is in flight), so the writes here are
      // pass-through — preserving whatever's on editingItem and
      // defaulting empty when the field hasn't been authored.
      const usesRecovery = Array.isArray(editingItem?.usesRecovery)
        ? editingItem.usesRecovery
        : (Array.isArray(editingItem?.uses_recovery) ? editingItem.uses_recovery : []);
      const properties = Array.isArray(editingItem?.properties) ? editingItem.properties : [];
      const activities = Array.isArray(editingItem?.activities) ? editingItem.activities : [];
      const effects = Array.isArray(editingItem?.effects) ? editingItem.effects : [];
      const advancements = Array.isArray(editingItem?.advancements) ? editingItem.advancements : [];
      const tags = Array.isArray(editingItem?.tags) ? editingItem.tags : [];

      // Flat prereq fields and the requirements tree are independent
      // surfaces — flat for the quick-access common case (Level X,
      // String Y), tree for compound rules. The list-row renderer
      // joins both into one readable summary via
      // `formatRequirementText`.
      const tree = (editingItem?.requirementsTree as Requirement | null) ?? null;
      // Flat level columns mirror the tree's top-level `level` leaf — the flat
      // input is gone, so project the leaf back to the columns the exporter /
      // importer still read. No leaf → no flat level gate.
      const levelLeaf = extractTopLevelLevelLeaf(tree);

      const d1Data = {
        name: editingItem?.name || 'New Option',
        description: editingItem?.description || '',
        group_id: effectiveId,
        source_id: editingItem?.source_id || editingItem?.sourceId || sourceId,
        level_prerequisite: levelLeaf ? (Number(levelLeaf.minLevel) || 0) : 0,
        level_prereq_is_total: levelLeaf && levelLeaf.isTotal ? 1 : 0,
        is_repeatable: Boolean(editingItem?.isRepeatable || editingItem?.is_repeatable) ? 1 : 0,
        string_prerequisite: editingItem?.stringPrerequisite || editingItem?.string_prerequisite || '',
        page: editingItem?.page || '',
        // Per-item class restriction removed (Concern 2): the requirements
        // tree's `class` / `levelInClass` leaves express class gating now.
        // The DB column stays; this payload simply no longer writes it, so
        // existing values are preserved on update and new rows default '[]'.
        // Compound requirements tree — independent of the flat
        // level/string fields. Serialized to a JSON string here so
        // D1 stores it verbatim; on read, parseRequirementTree()
        // normalizes it.
        requirements_tree: serializeRequirementTree(tree),
        // Feat-shape body — same columns the `features` table carries.
        // feature_type is derived from the parent group's name so dnd5e's
        // `system.type.subtype` always matches the user's group naming
        // (Battle Master Maneuvers → "Battle Master Maneuvers" subtype).
        // Authors don't need to remember to fill it in; it's locked to
        // the group identity.
        feature_type: name || editingItem?.featureType || editingItem?.feature_type || null,
        subtype: editingItem?.subtype || null,
        // `icon_url` is the field the hero-header ImageUpload binds to via
        // `editingItem.iconUrl`. Was being dropped on save until this fix
        // because only `image_url` was written.
        icon_url: editingItem?.iconUrl || editingItem?.icon_url || null,
        image_url: editingItem?.imageUrl || editingItem?.image_url || null,
        uses_max: editingItem?.usesMax || editingItem?.uses_max || null,
        uses_spent: Number(editingItem?.usesSpent ?? editingItem?.uses_spent ?? 0) || 0,
        uses_recovery: usesRecovery,
        properties,
        activities,
        effects,
        advancements,
        tags,
        quantity_column_id: editingItem?.quantityColumnId || editingItem?.quantity_column_id || null,
        scaling_column_id: editingItem?.scalingColumnId || editingItem?.scaling_column_id || null,
        updated_at: new Date().toISOString(),
      };

      const targetId = editingItem?.id || crypto.randomUUID();
      if (isProposalMode) {
        if (editingItem?.id) {
          await itemWriter.update(targetId, d1Data);
        } else {
          await itemWriter.create({ ...d1Data, id: targetId });
        }
      } else {
        await upsertDocument('uniqueOptionItems', targetId, d1Data);
      }

      // Spread `editingItem` first so its camelCase aliases (iconUrl,
      // imageUrl, classIds, requirementsTree, etc.) survive into the
      // refreshed list-row. Without this only the snake_case d1Data
      // keys land in state, the list-row renderer reads `item.iconUrl`
      // and finds undefined, and the just-uploaded image vanishes
      // until the page is reloaded (which goes through
      // denormalizeCompendiumData and re-populates camelCase).
      const stateItem = { ...editingItem, id: targetId, ...d1Data };
      if (editingItem?.id) {
        setItems(prev => prev.map(it => it.id === targetId ? stateItem : it));
      } else {
        setItems(prev => [...prev, stateItem].sort((a, b) => a.name.localeCompare(b.name)));
      }
      // Also mirror the save into `allOptionGroups` so the
      // requirements tree's optionItem picker (cascading group →
      // item) reflects newly-added / renamed options without a page
      // reload — otherwise a freshly authored sibling option doesn't
      // appear in the picker until the next mount. Only updates the
      // current group's entry; cross-group changes from other tabs
      // still need a reload.
      setAllOptionGroups(prev => prev.map(g => {
        if (g.id !== id) return g;
        const items = g.items ?? [];
        const newItem = { id: targetId, name: stateItem.name };
        const existingIdx = items.findIndex(it => it.id === targetId);
        const nextItems = existingIdx >= 0
          ? items.map((it, i) => i === existingIdx ? newItem : it)
          : [...items, newItem].sort((a, b) => a.name.localeCompare(b.name));
        return { ...g, items: nextItems };
      }));
      // Clear the inline editor pane back to its placeholder after a
      // successful save (the row is now in the Options list). On mobile,
      // drop back to the Options list rather than sitting on an empty
      // editor pane.
      setEditingItem(null);
      if (!isLg) setNarrowView('options');
      toast.success(
        isProposalMode
          ? actionLabel(itemWriter.mode, editingItem?.id ? 'updated' : 'created')
          : 'Option saved successfully',
      );
    } catch (error) {
      console.error("Error saving item:", error);
      toast.error('Failed to save option');
    }
  };

  const handleDeleteItem = (itemId: string) => {
    setPendingItemDeleteId(itemId);
  };

  const performDeleteItem = async () => {
    if (!pendingItemDeleteId) return;
    const itemId = pendingItemDeleteId;
    try {
      if (isProposalMode) {
        await itemWriter.remove(itemId);
      } else {
        await deleteDocument('uniqueOptionItems', itemId);
      }
      setItems(prev => prev.filter(it => it.id !== itemId));
      // Mirror the deletion into allOptionGroups so any requirement
      // tree referencing this item from elsewhere in the same
      // session immediately drops the stale entry from its picker.
      setAllOptionGroups(prev => prev.map(g => g.id !== id ? g : {
        ...g,
        items: (g.items ?? []).filter(it => it.id !== itemId),
      }));
      toast.success(
        isProposalMode ? actionLabel(itemWriter.mode, 'deleted') : 'Option deleted',
      );
    } catch (error) {
      console.error("Error deleting item:", error);
      toast.error('Failed to delete option');
      throw error;
    }
  };

  // Open a blank option in the inline editor pane (was a modal).
  const openAddItem = () => {
    setEditingItem({
      levelPrerequisite: 0,
      levelPrereqIsTotal: false,
      isRepeatable: false,
      requirementsTree: null,
    });
    setOptionTab('description');
    if (!isLg) setNarrowView('editor');
  };

  const openEditItem = (item: any) => {
    // Migrate the legacy flat level gate into a tree `level` leaf so it's
    // visible + editable in the RequirementsEditor (save re-syncs the flat
    // column). No-op for items already authored via the tree.
    setEditingItem(migrateFlatLevelIntoTree({ ...item }));
    setOptionTab('description');
    if (!isLg) setNarrowView('editor');
  };

  // In proposal mode the wrapper above already labels the page
  // ("PROPOSAL EDITOR | Unique Option Group") and provides Submit
  // Changes. Slim the section-header so we don't duplicate the
  // title chrome below the wrapper — just keep the Back link +
  // the inline group name. Save/Create + Delete buttons stay
  // because they're still relevant inside the form.
  return (
    <fieldset
      disabled={isGroupPendingDelete}
      className="max-w-[1600px] mx-auto w-full flex flex-col gap-3 border-0 m-0 disabled:opacity-95 lg:h-[calc(100vh-90px)] lg:overflow-hidden pb-6 lg:pb-0"
    >
      {isGroupPendingDelete && (
        <DeletedEntityBanner
          entityLabel="Modular Option Group"
          name={name || 'this group'}
          onUndo={undoGroupDelete}
        />
      )}
      <ProposalAwareEditorHeader
        isProposalMode={isProposalMode}
        backHref={isProposalRoute ? '/my-proposals' : '/compendium/unique-options'}
        proposalTitle={id ? (name || 'Untitled Group') : 'New Group'}
        adminContent={
          <h1 className="text-2xl font-serif font-bold text-ink uppercase tracking-tight">
            {id ? `Edit ${name || 'Group'}` : 'New Unique Option Group'}
          </h1>
        }
      >
        <div className="flex items-center gap-2">
          {/* Delete Group is admin-only — cascading deletes through
              option items + cross-references in requirement trees
              aren't part of the single-revision proposal shape. */}
          {id && !isProposalMode && (
            <Button onClick={handleDeleteGroup} disabled={loading} size="sm" variant="outline" className="border-blood/30 btn-danger gap-2">
              <Trash2 className="w-4 h-4" /> Delete Group
            </Button>
          )}
          {/* Save / Create button: hidden in proposal mode once the
              entity exists (either by route id OR by a locally-minted
              pendingCreateId after the first Create). The wrapper's
              Submit Changes covers subsequent edits via pre-flush. */}
          {(!isProposalMode || !effectiveId) && (
            <Button onClick={(e) => handleSaveGroup(e as any)} disabled={loading} size="sm" className="btn-gold-solid gap-2">
              <Save className="w-4 h-4" /> {effectiveId ? 'Save Changes' : 'Create Group'}
            </Button>
          )}
        </div>
      </ProposalAwareEditorHeader>

      {/* Inline 3-pane editor: Group Details | Options list | Option editor.
          Mirrors the browse surface so authoring an option no longer means
          a modal context-switch. On <lg the panes stack vertically and the
          page scrolls; at lg+ the row fills the locked viewport and each
          pane scrolls internally. */}
      <div className="flex-1 min-h-0 grid gap-4 lg:grid-cols-[minmax(300px,360px)_minmax(260px,320px)_1fr] items-stretch">
        {/* Pane 1 — Group Details. The bordered card IS the pane so its
            border reaches the bottom of the row (matching panes 2 & 3);
            the inner content scrolls. On <lg only the active drilldown
            pane shows (group → options → editor). */}
        <div
          className={cn(
            'border border-gold/25 bg-card/50 flex-col lg:overflow-hidden lg:flex',
            narrowView === 'group' ? 'flex' : 'hidden',
          )}
          style={paneStyle}
        >
          {/* Group Info */}
          <div className="p-4 space-y-4 flex-1 min-h-0 overflow-y-auto custom-scrollbar">
            <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-gold border-b border-gold/15 pb-2">Group Details</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-bold uppercase tracking-widest text-ink/45">Group Name</label>
                <Input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Eldritch Invocations"
                  className="h-8 text-sm bg-background/50 border-gold/15 focus:border-gold"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold uppercase tracking-widest text-ink/45">Source</label>
                <select
                  value={sourceId}
                  onChange={e => setSourceId(e.target.value)}
                  className="w-full h-8 px-2 rounded-md border border-gold/15 bg-background/50 focus:border-gold outline-none text-sm"
                >
                  <option value="">Select a Source</option>
                  {sources.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <MarkdownEditor
              textareaRef={groupDescRef}
              value={description}
              onChange={setDescription}
              placeholder="Describe what these options represent..."
              minHeight="60px"
              label="Description"
            />
            {/* Class Restrictions (group-level).
                EntityPicker handles chips + search + scrollable
                checkbox list. The widget here used to be a 60-line
                hand-rolled copy of that pattern from before the
                picker was extracted — replaced now that every other
                multi-select surface in the compendium goes through
                EntityPicker. Empty list = visible to all classes
                downstream in the advancement editor. */}
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-widest text-ink/45">Class Restrictions</label>
              <p className="text-[9px] text-ink/35 italic -mt-1">If none selected, this group is visible to all classes in the advancement editor.</p>
              <EntityPicker
                entities={[...classes.map((c: any) => ({ id: c.id, name: c.name })), ...classDraftOptions]}
                selectedIds={groupClassIds}
                onChange={setGroupClassIds}
                searchPlaceholder="Search classes…"
                noEntitiesText="No classes available — seed the Classes table first."
              />
            </div>
          </div>
          {/* Mobile-only forward nav to the Options pane (drilldown). */}
          {effectiveId && (
            <button
              type="button"
              onClick={() => setNarrowView('options')}
              className="lg:hidden shrink-0 flex items-center justify-between gap-2 border-t border-gold/15 bg-background/35 px-4 py-2.5 text-gold hover:bg-gold/5 transition-colors"
            >
              <span className="text-xs font-bold uppercase tracking-widest">Options · {optionRows.length}</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Pane 2 — Options list */}
        {effectiveId && (
          <div
            className={cn(
              'border border-gold/25 bg-card/50 flex-col lg:overflow-hidden lg:flex lg:max-h-none',
              narrowView === 'options' ? 'flex' : 'hidden',
            )}
            style={paneStyle}
          >
            {/* Mobile back-nav to Group Details. */}
            <button
              type="button"
              onClick={() => setNarrowView('group')}
              className="lg:hidden shrink-0 flex items-center gap-2 border-b border-gold/15 bg-background/35 px-3 py-2 text-gold hover:bg-gold/5 transition-colors text-xs"
            >
              <ChevronLeft className="w-4 h-4" /> Group Details
            </button>
            <div className="section-header p-4 pb-3 shrink-0 border-b border-gold/15">
              <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-gold">Options</h2>
              <Button
                size="sm"
                onClick={openAddItem}
                className="h-6 gap-1 btn-gold"
              >
                <Plus className="w-3 h-3" /> Add Option
              </Button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4 pt-2 divide-y divide-gold/15">
                {sortedItems.map((item) => {
                  // List-row summary. Renders the three prereq surfaces
                  // (flat level, flat string, tree) into one " · "-joined
                  // line. The tree gets fully formatted via
                  // `formatRequirementText` so authors see
                  // "Dexterity 13 or higher" or "Simple or Martial
                  // Weapons" instead of the previous "Compound
                  // requirements" placeholder.
                  // Suppress the flat-level chip when the tree already carries a
                  // `level` leaf (migrated / tree-authored items) so level isn't
                  // shown twice — once from the flat column, once from tree text.
                  const treeLevelLeaf = extractTopLevelLevelLeaf(item.requirementsTree ?? null);
                  const hasLevelReq = !treeLevelLeaf && (item.level_prerequisite || 0) > 0;
                  const levelIsTotal = Boolean(item.levelPrereqIsTotal ?? item.level_prereq_is_total);
                  const hasStringReq = !!item.string_prerequisite;
                  const treeText = item.requirementsTree
                    ? formatRequirementText(item.requirementsTree, requirementsTextLookup)
                    : '';
                  const isEditing = editingItem?.id === item.id;
                  return (
                  <div
                    key={item.id}
                    onClick={() => openEditItem(item)}
                    className={`py-2 px-2 -mx-2 flex items-center justify-between group cursor-pointer rounded transition-colors ${isEditing ? 'bg-gold/15' : 'hover:bg-gold/5'}`}
                  >
                    <div className="flex items-center gap-3">
                      {item.iconUrl && (
                        <img src={item.iconUrl} alt="" className="w-6 h-6 object-contain opacity-70 shrink-0" />
                      )}
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-ink">{item.name}</span>
                          {/* Boolean() guard: SQLite stores is_repeatable as INTEGER 0/1
                              and `0 && X` short-circuits to 0, which JSX renders as
                              the literal text "0" next to the name. */}
                          {Boolean(item.is_repeatable) && (
                            <Repeat className="w-3 h-3 text-gold/45" />
                          )}
                        </div>
                        {(hasLevelReq || treeText || hasStringReq) && (
                          <div className="text-[10px] text-ink/45">
                            <span className="font-bold uppercase tracking-wider">Prerequisites:</span>{' '}
                            {[
                              hasLevelReq
                                ? `Level ${item.level_prerequisite}+${levelIsTotal ? ' (character)' : ''}`
                                : null,
                              hasStringReq ? item.string_prerequisite : null,
                              treeText || null,
                            ].filter(Boolean).join(' · ')}
                          </div>
                        )}
                      </div>
                    </div>
                    {/* Whole row is click-to-edit; only Delete needs its own
                        handler (stopPropagation so it doesn't also open the
                        editor). */}
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); handleDeleteItem(item.id); }}
                        className="h-6 w-6 p-0 text-blood"
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                  );
                })}
                {sortedItems.length === 0 && (
                  <p className="py-4 text-center text-xs text-ink/35 italic">No options added yet.</p>
                )}
            </div>
          </div>
        )}

        {/* Pane 3 — Option editor (inline; was a modal). Shows a
            placeholder until an option is added/selected. The tab content
            below is the same editor body that used to live in the dialog. */}
        {effectiveId && (
          <div
            className={cn(
              'border border-gold/25 bg-card/50 flex-col h-[78vh] min-h-[480px] lg:h-auto overflow-hidden lg:flex',
              narrowView === 'editor' ? 'flex' : 'hidden',
            )}
            style={paneStyle}
          >
          {/* Mobile back-nav to the Options list. */}
          <button
            type="button"
            onClick={() => setNarrowView('options')}
            className="lg:hidden shrink-0 flex items-center gap-2 border-b border-gold/15 bg-background/35 px-3 py-2 text-gold hover:bg-gold/5 transition-colors text-xs"
          >
            <ChevronLeft className="w-4 h-4" /> Options
          </button>
          {!editingItem ? (
            <div className="flex-1 flex items-center justify-center px-6 py-16 text-center">
              <div className="space-y-2 max-w-xs">
                <Edit className="w-7 h-7 text-gold/25 mx-auto" />
                <p className="text-sm text-ink/55 font-serif italic">
                  Select an option to edit, or click <span className="text-gold not-italic font-semibold">Add Option</span> to create one.
                </p>
              </div>
            </div>
          ) : (
            <>
              <FeatureModalHero
                iconUrl={editingItem?.iconUrl || ''}
                onIconChange={(url) => setEditingItem((prev: any) => ({ ...(prev || { levelPrerequisite: 0, isRepeatable: false }), iconUrl: url }))}
                name={editingItem?.name || ''}
                onNameChange={(name) => setEditingItem((prev: any) => ({ ...(prev || { levelPrerequisite: 0, isRepeatable: false }), name }))}
                namePlaceholder="Option Name"
                required
                autoFocusName
                tabs={['description', 'details', 'activities', 'effects', 'advancement']}
                activeTab={optionTab}
                onTabChange={(v) => setOptionTab(v as any)}
              />


              <div className={`flex-1 min-h-0 p-6 bg-background/50 space-y-4 ${optionTab === 'description' ? 'overflow-hidden' : 'overflow-y-auto custom-scrollbar'}`}>
            {/* DESCRIPTION TAB — markdown body (icon + name live in the hero
                header above, visible across every tab). */}
            {optionTab === 'description' && (
              <div className="h-full min-h-0">
                <MarkdownEditor
                  textareaRef={itemDescRef}
                  value={editingItem?.description || ''}
                  onChange={(val) => setEditingItem((prev: any) => ({ ...(prev || { levelPrerequisite: 0, isRepeatable: false }), description: val }))}
                  placeholder="Enter the full text of the feature..."
                  minHeight="400px"
                  maxHeight="100%"
                  className="h-full min-h-0"
                  label="Description"
                />
              </div>
            )}

            {/* DETAILS TAB — feature classification, requirements,
                prerequisites, class restrictions. */}
            {optionTab === 'details' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold uppercase tracking-widest text-ink/45">Source</label>
                    <select
                      value={editingItem?.source_id || editingItem?.sourceId || ''}
                      onChange={e => setEditingItem((prev: any) => ({ ...(prev || { level_prerequisite: 0, is_repeatable: false }), source_id: e.target.value }))}
                      className="w-full h-8 px-2 rounded-md border border-gold/15 bg-background/50 focus:border-gold outline-none text-sm"
                    >
                      <option value="">Same as Group</option>
                      {sources.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold uppercase tracking-widest text-ink/45">Page Reference</label>
                    <Input
                      value={editingItem?.page || ''}
                      onChange={e => setEditingItem((prev: any) => ({ ...(prev || { levelPrerequisite: 0, isRepeatable: false }), page: e.target.value }))}
                      placeholder="e.g. 155"
                      className="h-8 text-sm bg-background/50 border-gold/15 focus:border-gold"
                    />
                  </div>
                  <div className="space-y-1">
                    {/* Feature Type is locked to the parent Modular Option
                        Group's name — drives dnd5e's `system.type.subtype`
                        on the embedded item. Read-only; renames on the
                        group level flow through here on save. */}
                    <label className="text-xs font-bold uppercase tracking-widest text-ink/45">Modular Option Group</label>
                    <div className="h-8 px-3 flex items-center text-sm text-ink/75 bg-background/30 border border-gold/15 rounded-md select-none">
                      {name || <span className="italic text-ink/35">Save the group first</span>}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold uppercase tracking-widest text-ink/45">Subtype</label>
                    <Input
                      value={editingItem?.subtype || ''}
                      onChange={e => setEditingItem((prev: any) => ({ ...(prev || {}), subtype: e.target.value }))}
                      placeholder="optional secondary tag"
                      className="h-8 text-sm bg-background/50 border-gold/15 focus:border-gold"
                    />
                  </div>
                </div>

                {/* Prerequisites — authored entirely in the RequirementsEditor
                    now (Concern 1 + 2). Level (incl. "total character level"
                    via the `level` leaf), class / subclass, and the free-text
                    gate all live in the one component. The flat
                    `level_prerequisite` column is kept in sync from the tree's
                    top-level `level` leaf on save (handleSaveItem) so the
                    exporter / importer flat-gate keeps working; existing items'
                    flat levels migrate into the tree when opened
                    (migrateFlatLevelIntoTree). */}
                <div className="space-y-3 pt-2 border-t border-gold/15">
                  <h4 className="text-[10px] text-gold uppercase tracking-widest font-black">Prerequisites</h4>

                  <RequirementsEditor
                    label="Compound Requirements"
                    value={(editingItem?.requirementsTree as Requirement | null) ?? null}
                    onChange={(next) => setEditingItem((prev: any) => ({
                      ...(prev || {}),
                      requirementsTree: next,
                    }))}
                    lookups={{
                      classes: [...classes.map((c: any) => ({ id: c.id, name: c.name })), ...classDraftOptions],
                      subclasses: [...subclasses.map((s: any) => ({ id: s.id, name: s.name })), ...subclassDraftOptions],
                      spellRules: [...spellRules.map((r: any) => ({ id: r.id, name: r.name })), ...spellRuleDraftOptions],
                      optionGroups: [...allOptionGroups, ...optionGroupDraftOptions.map((d) => ({ id: d.id, name: d.name, items: null }))],
                      proficiencies: proficiencyPools,
                    }}
                    // Free-text prerequisite lives inside the component now
                    // (Concern 1) — maps to the option's `string_prerequisite`
                    // column, the same way FeatsEditor's freeText maps to its
                    // `requirements` column. The standalone String Prerequisite
                    // input was removed in favor of this.
                    freeText={editingItem?.stringPrerequisite ?? editingItem?.string_prerequisite ?? ''}
                    onFreeTextChange={(next) => setEditingItem((prev: any) => ({ ...(prev || {}), string_prerequisite: next }))}
                    previewLookup={requirementsTextLookup}
                  />
                </div>

                {/* USAGE — Limited uses + recovery rules. Same UI shape as
                    ClassEditor / SubclassEditor's per-feature usage block,
                    so authors don't learn a second UI for the same concept.
                    Persists to `uses_max` and `uses_recovery` on the
                    uniqueOptionItems row (already wired in save). Empty
                    recovery list = uses persist until manually reset. */}
                {(() => {
                  const recovery: any[] = Array.isArray(editingItem?.usesRecovery)
                    ? editingItem.usesRecovery
                    : (Array.isArray(editingItem?.uses_recovery) ? editingItem.uses_recovery : []);
                  const setRecovery = (rows: any[]) =>
                    setEditingItem((prev: any) => ({ ...(prev || {}), usesRecovery: rows }));
                  const addRecovery = () =>
                    setRecovery([...recovery, { period: 'lr', type: 'recoverAll' }]);
                  const removeRecovery = (i: number) =>
                    setRecovery(recovery.filter((_: any, ri: number) => ri !== i));
                  const patchRecovery = (i: number, patch: any) =>
                    setRecovery(recovery.map((r: any, ri: number) => ri === i ? { ...r, ...patch } : r));
                  return (
                    <div className="space-y-0 pt-2 border-t border-gold/15 divide-y divide-gold/5">
                      <div className="flex items-center justify-between pb-2">
                        <p className="text-[9px] uppercase tracking-[0.2em] font-black text-gold/55 select-none">Usage</p>
                      </div>
                      <div className="flex items-center gap-4 py-2">
                        <label className="text-xs font-semibold text-ink/75 shrink-0 w-36">Limited Uses</label>
                        <div className="flex items-center gap-3 flex-1">
                          <div className="flex flex-col items-center gap-0.5">
                            <span className="text-[9px] uppercase text-ink/45 font-black tracking-wider">Spent</span>
                            <Input
                              type="number"
                              value={editingItem?.usesSpent ?? editingItem?.uses_spent ?? 0}
                              onChange={e => setEditingItem((prev: any) => ({ ...(prev || {}), usesSpent: parseInt(e.target.value) || 0 }))}
                              className="h-7 w-16 text-center text-xs bg-background/50 border-gold/15 focus:border-gold"
                            />
                          </div>
                          <div className="flex flex-col items-center gap-0.5">
                            <span className="text-[9px] uppercase text-ink/45 font-black tracking-wider">Max</span>
                            <Input
                              value={editingItem?.usesMax || editingItem?.uses_max || ''}
                              onChange={e => setEditingItem((prev: any) => ({ ...(prev || {}), usesMax: e.target.value }))}
                              placeholder="—"
                              className="h-7 w-28 text-center text-xs bg-background/50 border-gold/15 focus:border-gold"
                            />
                          </div>
                        </div>
                      </div>
                      <div className="py-3">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-[9px] uppercase tracking-[0.2em] font-black text-gold/55 select-none">Recovery</p>
                          <button type="button" onClick={addRecovery} className="text-[10px] font-black text-gold/65 hover:text-gold transition-colors px-1">+ ADD</button>
                        </div>
                        {recovery.length === 0 && (
                          <p className="text-xs text-ink/35 italic py-1">No recovery rules. Click + ADD to add one.</p>
                        )}
                        <div className="space-y-1.5">
                          {recovery.map((row: any, i: number) => (
                            <div key={i} className="flex items-center gap-2">
                              <div className="flex flex-col gap-0.5 flex-1">
                                {i === 0 && <span className="text-[9px] uppercase text-ink/45 font-black tracking-wider">Period</span>}
                                <select value={row.period || 'lr'} onChange={e => patchRecovery(i, { period: e.target.value, ...(e.target.value === 'recharge' ? { type: 'recoverAll', formula: '6' } : { formula: undefined }) })} className="h-7 px-2 rounded-md border border-gold/15 bg-background/50 focus:border-gold outline-none text-xs text-ink w-full">
                                  <option value="lr">Long Rest</option>
                                  <option value="sr">Short Rest</option>
                                  <option value="day">Daily</option>
                                  <option value="dawn">Dawn</option>
                                  <option value="dusk">Dusk</option>
                                  <option value="initiative">Initiative</option>
                                  <option value="turnStart">Turn Start</option>
                                  <option value="turnEnd">Turn End</option>
                                  <option value="turn">Each Turn</option>
                                  <option value="recharge">Recharge</option>
                                </select>
                              </div>
                              {row.period === 'recharge' ? (
                                <div className="flex flex-col gap-0.5 flex-1">
                                  {i === 0 && <span className="text-[9px] uppercase text-ink/45 font-black tracking-wider">Value</span>}
                                  <select value={row.formula || '6'} onChange={e => patchRecovery(i, { formula: e.target.value })} className="h-7 px-2 rounded-md border border-gold/15 bg-background/50 focus:border-gold outline-none text-xs text-ink w-full">
                                    <option value="6">Recharge 6</option>
                                    <option value="5">Recharge 5–6</option>
                                    <option value="4">Recharge 4–6</option>
                                    <option value="3">Recharge 3–6</option>
                                    <option value="2">Recharge 2–6</option>
                                  </select>
                                </div>
                              ) : (
                                <>
                                  <div className="flex flex-col gap-0.5 flex-1">
                                    {i === 0 && <span className="text-[9px] uppercase text-ink/45 font-black tracking-wider">Recovery</span>}
                                    <select value={row.type || 'recoverAll'} onChange={e => patchRecovery(i, { type: e.target.value, ...(e.target.value !== 'formula' ? { formula: undefined } : {}) })} className="h-7 px-2 rounded-md border border-gold/15 bg-background/50 focus:border-gold outline-none text-xs text-ink w-full">
                                      <option value="recoverAll">Recover All Uses</option>
                                      <option value="loseAll">Lose All Uses</option>
                                      <option value="formula">Custom Formula</option>
                                    </select>
                                  </div>
                                  {row.type === 'formula' && (
                                    <div className="flex flex-col gap-0.5 flex-1">
                                      {i === 0 && <span className="text-[9px] uppercase text-ink/45 font-black tracking-wider">Formula</span>}
                                      <Input value={row.formula || ''} onChange={e => patchRecovery(i, { formula: e.target.value })} placeholder="2 + @class.level" className="h-7 text-xs font-mono bg-background/50 border-gold/15 focus:border-gold" />
                                    </div>
                                  )}
                                </>
                              )}
                              <div className={i === 0 ? 'pt-3.5' : ''}>
                                <button type="button" onClick={() => removeRecovery(i)} className="h-7 w-7 flex items-center justify-center text-ink/35 hover:text-blood transition-colors rounded border border-transparent hover:border-blood/20">
                                  <span className="text-sm leading-none">−</span>
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })()}

                <div className="flex items-center gap-2 pt-2 border-t border-gold/15">
                  <input
                    type="checkbox"
                    id="isRepeatable"
                    checked={!!(editingItem?.is_repeatable || editingItem?.isRepeatable)}
                    onChange={e => setEditingItem((prev: any) => ({ ...(prev || { level_prerequisite: 0, is_repeatable: 0, class_ids: [] }), is_repeatable: e.target.checked ? 1 : 0 }))}
                    className="w-3 h-3 rounded border-gold/25 text-gold focus:ring-gold"
                  />
                  <label htmlFor="isRepeatable" className="text-xs text-ink/45 uppercase font-bold cursor-pointer">
                    Repeatable
                  </label>
                </div>
              </div>
            )}

            {/* ACTIVITIES TAB — same editor used by class features. */}
            {optionTab === 'activities' && (
              <div className="pt-2">
                <ActivityEditor
                  activities={editingItem?.activities || []}
                  onChange={(acts) => setEditingItem((prev: any) => ({ ...(prev || {}), activities: acts }))}
                  availableEffects={editingItem?.effects || []}
                  onAvailableEffectsChange={(fx) => setEditingItem((prev: any) => ({ ...(prev || {}), effects: fx }))}
                  defaultEffectImg={editingItem?.iconUrl || editingItem?.imageUrl || editingItem?.icon_url || editingItem?.image_url || null}
                  itemTargets={allFeatures
                    .filter((f: any) => f?.uses?.max)
                    .map((f: any) => ({ id: f.identifier || f.id, name: f.name || f.identifier || String(f.id) }))}
                />
              </div>
            )}

            {/* EFFECTS TAB — Active Effects (mostly used by Invocations and
                Infusions which apply passive modifiers). */}
            {optionTab === 'effects' && (
              <div className="pt-2">
                <ActiveEffectEditor
                  effects={editingItem?.effects || []}
                  onChange={(fx) => setEditingItem((prev: any) => ({ ...(prev || {}), effects: fx }))}
                  defaultImg={editingItem?.iconUrl || editingItem?.imageUrl || editingItem?.icon_url || editingItem?.image_url || null}
                />
              </div>
            )}

            {/* ADVANCEMENT TAB — option items can have their own
                advancements per dnd5e (rare, but used by Invocations that
                grant spells via ItemGrant). Full editor, not the
                feature-link variant — the option item is its own document. */}
            {optionTab === 'advancement' && (
              <div className="pt-2">
                <AdvancementManager
                  advancements={editingItem?.advancements || []}
                  onChange={(advs) => setEditingItem((prev: any) => ({ ...(prev || {}), advancements: advs }))}
                  // Option items are feat-shaped: default level 0 (always-on
                  // while owned), no sub-features, HitPoints / Size hidden —
                  // the same context FeatsEditor mounts.
                  parentContext="feat"
                  defaultLevel={0}
                  // ItemGrant / ItemChoice targets. No classId is passed, so
                  // the group picker isn't class-filtered — an option's
                  // advancement can reference any group (cross-class grants
                  // like Eldritch Adept → Warlock Invocations stay possible).
                  availableOptionGroups={[...allOptionGroups, ...optionGroupDraftOptions]}
                  availableOptionItems={[...allOptionItems, ...optionItemDraftOptions]}
                  availableFeats={[...feats, ...featDraftOptions]}
                  // availableScalingColumns / availableFeatures omitted:
                  // option items don't own scaling columns (0/223 use one)
                  // and have no sub-features (same as feats).
                />
              </div>
            )}

              </div>

              <div className="px-5 py-2 border-t border-gold/15 bg-gold/[0.03] flex justify-end shrink-0 gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setEditingItem(null)}
                  className="label-text opacity-70 hover:opacity-100 h-8"
                >
                  Close
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleSaveItem}
                  disabled={!editingItem?.name}
                  className="btn-gold-solid gap-2 px-8"
                >
                  {editingItem?.id ? 'Update Option' : 'Add Option'}
                </Button>
              </div>
            </>
          )}
          </div>
        )}
      </div>
      <ConfirmDialog
        open={deleteGroupConfirmOpen}
        onOpenChange={setDeleteGroupConfirmOpen}
        title={`Delete ${name ? `"${name}"` : 'this group'} and all its options?`}
        description={
          isProposalMode
            ? `Queues a DELETE proposal for the group and one for each of its ${items.length} option${items.length === 1 ? '' : 's'}. The live group stays in place until an admin approves.`
            : `Permanently deletes the group and ${items.length} option${items.length === 1 ? '' : 's'} from the live catalog.`
        }
        confirmLabel="Delete group"
        destructive
        onConfirm={performDeleteGroup}
      />
      <ConfirmDialog
        open={!!pendingItemDeleteId}
        onOpenChange={(open) => {
          if (!open) setPendingItemDeleteId(null);
        }}
        title="Delete this option?"
        description={
          isProposalMode
            ? 'Queues a DELETE proposal for this option. The live row stays in place until an admin approves.'
            : 'Permanently removes this option from the live catalog.'
        }
        confirmLabel="Delete option"
        destructive
        onConfirm={performDeleteItem}
      />
    </fieldset>
  );
}
