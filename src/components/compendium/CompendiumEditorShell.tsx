import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, Edit3, Pencil, Plus, Save, Trash2, Lock } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { FilterBar } from './FilterBar';
import VirtualizedList from '../ui/VirtualizedList';

/**
 * Shared shell for the compendium editor pages
 * (`/compendium/spells/manage`, `/compendium/feats/manage`, and the
 * upcoming Items/Weapons/Armor/Tools editors). Editor-side analogue of
 * `CompendiumBrowserShell` — owns the chrome that's identical across
 * every entity-editor page:
 *
 *   - Outer top toolbar: Back link + Foundry-Import / Manual-Editor mode
 *     switcher + admin actions slot. Mode-tab routing flows through
 *     a Radix `<Tabs>` wrapper so workbench pages can mount as their
 *     own mode without page-level reload.
 *   - Body class `spell-list-fullscreen` toggled on mount — strips the
 *     global container padding and footer so the editor uses the full
 *     viewport. (Class name is historical; the CSS rules apply to all
 *     fullscreen pages.)
 *   - Viewport-derived `paneHeight` — recomputed on resize. The chrome
 *     budget is 200px by default; consumers in proposal mode pass
 *     `proposalMode={true}` to bump it to 320 (wrapper banner + footer).
 *   - FilterBar row with consumer-supplied search/filter wiring + result
 *     count + "+ New X" button.
 *   - Three-pane viewport-locked layout with tiered collapse:
 *       • xl+   — list (280) | editor (flex) | preview (420)
 *       • lg–xl — list (280) | editor (flex), preview hidden
 *       • < lg  — single visible pane based on internal `listView`
 *                 state; back-nav row at the top of the editor card.
 *     Top toolbar and FilterBar both hide at < lg when `listView` is
 *     'editor' so the user has full vertical room while drilled in.
 *   - Editor card chrome: optional cascade banner, optional readonly
 *     banner, compact identity row (name + abbreviated source chip +
 *     subtitle + Save/Reset/Delete OR Edit Base), super-tab strip
 *     (Editor / Tags) below the identity row.
 *   - Single `<form id={formId}>` wraps the entire outer Tabs so the
 *     Save submit button fires regardless of which super-tab is active
 *     — Radix unmounts inactive TabsContent, but the form's onSubmit
 *     reads from consumer `formData` state (every field controlled)
 *     so the unmounting is harmless.
 *   - Per-super-tab `<fieldset disabled={isReadOnly}>` body so Browse-
 *     base lockdown is enforced uniformly without the consumer wiring
 *     `disabled` onto every field.
 *   - Editor super-tab inner Tabs with consumer-supplied sub-tabs.
 *     Each sub-tab declares `layout: 'scroll' | 'fill'` — 'fill' lets
 *     one child grow into the remaining height (Basics needs this so
 *     its MarkdownEditor's `fillContainer` mode resolves), 'scroll'
 *     gives the legacy "scroll the whole tab" behavior.
 *   - Tags super-tab inner Tabs — same shape as Editor sub-tabs but
 *     no `layout` mode (Tags content is invariably scrollable).
 *   - Preview pane (xl+ only): `renderPreview(selectedId)` slot. The
 *     preview lives outside the form on purpose; it's read-only and
 *     shouldn't participate in submit.
 *
 * Proposal-aware behavior (cascade banners, readonly mode, edit-base
 * unlock, drafted-id badges, dirty-baseline auto-stage) stays in the
 * consumer. The shell receives the resolved values as props:
 *   - `cascadeBanner` / `readonlyBanner` — pre-rendered ReactNodes
 *     produced from `useCascadeDependent` + `useEditBaseUnlocks`.
 *   - `isReadOnly` + `onUnlockBase` — drive the Edit-Base swap on the
 *     action row.
 *   - `proposalMode` — bumps the chrome offset for the wrapper's
 *     banner/footer chrome.
 *   - `onDelete` — omit (or pass undefined) to hide the Delete button
 *     (consumer pattern: proposal mode hides it because deletes route
 *     through the row-level X button + tombstone UX).
 *
 * The shell stays generic over the row type via the TRow type parameter.
 */

// Width of the editor's left list column. Matches CompendiumBrowserShell's
// 280 list column so the two pages have consistent rhythm.
const LIST_COL_WIDTH_PX = 280;
// Width of the right preview pane at xl+. Mirrors the editor's existing
// 420px preview rail.
const PREVIEW_COL_WIDTH_PX = 420;
// Height of the list column header strip — subtract from paneHeight when
// computing the VirtualizedList's inner pixel height. Slight under-
// estimate is fine.
const LIST_HEADER_PX = 40;

export type EditorMode = {
  /** Stable key — used as the Tabs `value`. */
  key: string;
  /** Label rendered in the top toolbar's mode switcher. */
  label: string;
  /** Content to render when this mode is active. The shell mounts this
   *  in a TabsContent with `flex-1 min-h-0` so the workbench / editor
   *  body can claim the remaining viewport. */
  render: React.ReactNode;
  /** When true, the trigger only renders for admin users. */
  adminOnly?: boolean;
};

export type EditorSubTab = {
  /** Stable key — used as the inner Tabs `value`. */
  key: string;
  /** Trigger label. ReactNode allows count badges (e.g. "Tags (3)"). */
  label: string | React.ReactNode;
  /** Sub-tab body layout. `'fill'` makes the body a flex column so one
   *  child can grow into the remaining height (used by Basics so its
   *  MarkdownEditor's `fillContainer` works). `'scroll'` gives the
   *  legacy "scroll the entire sub-tab" behavior. Defaults to 'scroll'. */
  layout?: 'scroll' | 'fill';
  render: () => React.ReactNode;
};

export type TagsSubTab = {
  key: string;
  label: string | React.ReactNode;
  render: () => React.ReactNode;
};

export type EditorListColumn<TRow> = {
  key: string;
  label: string;
  /** CSS grid track width (e.g. `'minmax(0,1fr)'`, `'40px'`). */
  width: string;
  align?: 'start' | 'center' | 'end';
  render: (row: TRow) => React.ReactNode;
};

export type CompendiumEditorShellProps<TRow> = {
  // ─── Branding ─────────────────────────────────────────────────
  /** Singular / plural display names — drives default labels and
   *  empty-state copy ("New Spell", "Back to Spells", etc.). */
  entityName: { singular: string; plural: string };
  /** Back-link href (e.g. `/compendium/spells`). */
  backPath: string;
  /** Override the back-link label. Defaults to `Back To {plural}`. */
  backLabel?: string;

  // ─── Mode tabs ────────────────────────────────────────────────
  /** Mode entries — typically Foundry-Import (admin-only) + Manual-
   *  Editor. The shell renders the Manual-Editor mode as the editor
   *  3-pane layout; any other mode renders its `render` ReactNode in
   *  a full-bleed TabsContent. */
  modes: EditorMode[];
  /** Initial mode key. Defaults to the first non-admin mode (or first
   *  mode if all are admin). */
  defaultModeKey?: string;
  /** Key of the mode that represents the manual editor — that mode's
   *  TabsContent gets the 3-pane layout instead of `render`. Defaults
   *  to `'manual-editor'`. */
  manualEditorModeKey?: string;
  isAdmin: boolean;
  /** Optional trailing slot in the top toolbar (Backfill / Purge etc.). */
  adminActions?: React.ReactNode;

  // ─── List data + selection ────────────────────────────────────
  listRows: TRow[];
  listColumns: EditorListColumn<TRow>[];
  /** Pixel height of one list row. Defaults to 36. */
  listRowHeight?: number;
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  getRowId: (row: TRow) => string;
  /** Override the list empty-state body. Receives a string or full
   *  ReactNode (proposal-mode editors pass a multi-line teaching
   *  block). Defaults to `No {plural} match the current search.`. */
  emptyListMessage?: string | React.ReactNode;

  // ─── Filter row ───────────────────────────────────────────────
  search: string;
  onSearchChange: (v: string) => void;
  searchPlaceholder: string;
  activeFilterCount: number;
  isFilterOpen: boolean;
  setIsFilterOpen: (v: boolean) => void;
  resetFilters: () => void;
  /** Body of the filter modal — usually a `<SectionFilterPanel>`. */
  renderFilters?: React.ReactNode;
  /** Override the filter modal title. */
  filterTitle?: string;

  // ─── Identity row ─────────────────────────────────────────────
  /** Display name in the editor header (e.g. `formData.name`). When
   *  empty + no `selectedId` the shell shows `New {singular}`. */
  identityName: string;
  /** Short source abbreviation chip (e.g. "PHB"). When empty no chip
   *  renders. */
  identitySourceAbbrev?: string;
  /** Tooltip for the source chip (full source name). */
  identitySourceFullName?: string;
  /** Italic subtitle after the source chip — e.g. "Lvl 1 Abjuration"
   *  or "Feat · General · Repeatable". */
  identitySubtitle?: React.ReactNode;

  // ─── Save lifecycle ───────────────────────────────────────────
  onSave: (e?: React.FormEvent) => void | Promise<void>;
  /** Optional — omit to hide the Delete button (proposal mode hides
   *  it because deletes flow through the row-level X button + tombstone
   *  UX). */
  onDelete?: () => void;
  onReset: () => void;
  /** Disables the Save button + flips its label to "Saving...". */
  saving?: boolean;
  /** Form id used by the submit button's `form` attribute. Use a stable
   *  per-entity value (e.g. "spell-manual-editor-form"). */
  formId: string;

  // ─── Proposal-aware ───────────────────────────────────────────
  isReadOnly?: boolean;
  /** When `isReadOnly` AND this is set, the Save/Reset/Delete row is
   *  replaced by an "Edit Base {name}" button that calls this. */
  onUnlockBase?: () => void;
  /** Optional banner (pre-rendered ReactNode) above the identity row. */
  cascadeBanner?: React.ReactNode;
  /** Optional banner (pre-rendered ReactNode) above the identity row.
   *  When omitted but `isReadOnly` is true the shell renders a default
   *  read-only banner. */
  readonlyBanner?: React.ReactNode;
  /** Bumps chromeOffset 200 → 320 to account for the proposal-wrapper's
   *  banner + footer chrome. */
  proposalMode?: boolean;

  // ─── Super-tab content ────────────────────────────────────────
  /** Editor super-tab inner sub-tabs (typically Basics / Mechanics /
   *  Activities / Effects). The first sub-tab's `key` is the default
   *  selection; resetting to default fires on `onNew`. */
  editorSubTabs: EditorSubTab[];
  /** Tags super-tab inner sub-tabs. Spells use 3 (Tags / Prereqs /
   *  Rules), feats use 2 (Prereqs / Tags). */
  tagsSubTabs: TagsSubTab[];
  /** Optional count badge on the Tags super-tab trigger
   *  (e.g. tags.length + requiredTags.length). When 0 or undefined
   *  the badge is omitted. */
  tagsSuperTabCount?: number;

  // ─── Preview ──────────────────────────────────────────────────
  /** Renders the right-most preview pane (xl+ only). Receives the
   *  current `selectedId`. */
  renderPreview: (selectedId: string | null) => React.ReactNode;
};

type ListView = 'list' | 'editor';

export function CompendiumEditorShell<TRow>(props: CompendiumEditorShellProps<TRow>) {
  const {
    entityName,
    backPath,
    backLabel,
    modes,
    defaultModeKey,
    manualEditorModeKey = 'manual-editor',
    isAdmin,
    adminActions,
    listRows,
    listColumns,
    listRowHeight = 36,
    loading,
    selectedId,
    onSelect,
    onNew,
    getRowId,
    emptyListMessage,
    search,
    onSearchChange,
    searchPlaceholder,
    activeFilterCount,
    isFilterOpen,
    setIsFilterOpen,
    resetFilters,
    renderFilters,
    filterTitle = 'Advanced Filters',
    identityName,
    identitySourceAbbrev,
    identitySourceFullName,
    identitySubtitle,
    onSave,
    onDelete,
    onReset,
    saving,
    formId,
    isReadOnly,
    onUnlockBase,
    cascadeBanner,
    readonlyBanner,
    proposalMode,
    editorSubTabs,
    tagsSubTabs,
    tagsSuperTabCount,
    renderPreview,
  } = props;

  // ─── Body class ───────────────────────────────────────────────
  // `body.spell-list-fullscreen` strips the global container padding
  // and hides the footer so the editor uses the full viewport. Name
  // is historical; the rules apply to all fullscreen pages.
  useEffect(() => {
    document.body.classList.add('spell-list-fullscreen');
    return () => document.body.classList.remove('spell-list-fullscreen');
  }, []);

  // ─── Pane height ──────────────────────────────────────────────
  // Subtract chrome (navbar + toolbar + FilterBar + padding) so the
  // 3-pane row always fills "viewport minus chrome". Proposal mode
  // adds the wrapper's banner + footer — bump the budget to cover it.
  const chromeOffset = proposalMode ? 320 : 200;
  const [paneHeight, setPaneHeight] = useState<number>(() =>
    typeof window === 'undefined' ? 720 : Math.max(420, window.innerHeight - chromeOffset),
  );
  useEffect(() => {
    const onResize = () => setPaneHeight(Math.max(420, window.innerHeight - chromeOffset));
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [chromeOffset]);
  const listInnerHeight = Math.max(200, paneHeight - LIST_HEADER_PX);

  // ─── Narrow-viewport master-detail ────────────────────────────
  // Drives the < lg single-pane drilldown. At lg+ both panes (list +
  // editor) are visible side-by-side via the responsive classes.
  // Selecting a row flips to 'editor'; the back-nav row inside the
  // editor card flips back to 'list'.
  const [listView, setListView] = useState<ListView>(() =>
    selectedId ? 'editor' : 'list',
  );
  useEffect(() => {
    if (selectedId) setListView('editor');
  }, [selectedId]);
  const hideToolbarsBelowLg = listView === 'editor';

  // ─── Editor view state ────────────────────────────────────────
  // Super-tab + inner sub-tab state. Persists across `selectedId`
  // changes — a proposer editing Prereqs on Fireball then clicking
  // Frostbite stays on Tags > Prereqs. The shell-owned `handleNew`
  // resets both before calling the consumer's `onNew` so "+ New X"
  // always lands on Editor > first-sub-tab.
  const firstEditorSubTabKey = editorSubTabs[0]?.key ?? 'basics';
  const firstTagsSubTabKey = tagsSubTabs[0]?.key ?? 'tags';
  const [editorView, setEditorView] = useState<'editor' | 'tags'>('editor');
  const [editorSubTab, setEditorSubTab] = useState<string>(firstEditorSubTabKey);
  const [tagsSubTab, setTagsSubTab] = useState<string>(firstTagsSubTabKey);

  // ─── Mode tabs default ────────────────────────────────────────
  // Prefer the consumer's `defaultModeKey`; fall back to the first
  // non-admin mode (or the first mode overall if no public modes
  // exist).
  const computedDefaultMode =
    defaultModeKey
    ?? modes.find((m) => !m.adminOnly)?.key
    ?? modes[0]?.key
    ?? manualEditorModeKey;

  // ─── Handlers ─────────────────────────────────────────────────
  const handleNew = () => {
    // Reset the editor view to the entity-shaped first sub-tab — "New
    // X" should default to the first form panel regardless of what
    // tab the user was on previously.
    setEditorView('editor');
    setEditorSubTab(firstEditorSubTabKey);
    onNew();
  };

  // ─── Pieces ───────────────────────────────────────────────────
  const computedBackLabel = backLabel ?? `Back To ${entityName.plural}`;

  // Top toolbar — Back link + mode switcher + admin actions slot.
  // Hidden at < lg when the user is in the editor view (drilled into
  // an entity) — the editor card's "Back to {plural}" row surfaces the
  // path back. Always visible at lg+.
  const topToolbar = (
    <div
      className={cn(
        'shrink-0 flex items-center gap-2 bg-card p-2 rounded-lg border border-gold/10 shadow-sm flex-wrap lg:flex',
        hideToolbarsBelowLg ? 'hidden lg:flex' : 'flex',
      )}
    >
      <Link to={backPath}>
        <Button variant="ghost" size="sm" className="h-8 text-gold gap-2 hover:bg-gold/5">
          <ChevronLeft className="w-4 h-4" />
          {computedBackLabel}
        </Button>
      </Link>
      <TabsList variant="line" className="gap-1 bg-transparent p-0">
        {modes
          .filter((mode) => !mode.adminOnly || isAdmin)
          .map((mode) => (
            <TabsTrigger
              key={mode.key}
              value={mode.key}
              className="h-8 rounded-md border border-gold/15 bg-background/30 px-3 py-1 text-xs uppercase tracking-[0.18em] text-ink/65 data-active:border-gold/40 data-active:bg-gold/10 data-active:text-gold"
            >
              {mode.label}
            </TabsTrigger>
          ))}
      </TabsList>
      {adminActions ? (
        <>
          <div className="flex-1" />
          {adminActions}
        </>
      ) : null}
    </div>
  );

  // FilterBar row — search + filter modal + result count + New {entity}
  // button. Hidden at < lg when listView === 'editor'.
  const filterRow = (
    <div className={cn('shrink-0', listView === 'editor' ? 'hidden lg:block' : 'block')}>
      <FilterBar
        search={search}
        setSearch={onSearchChange}
        isFilterOpen={isFilterOpen}
        setIsFilterOpen={setIsFilterOpen}
        activeFilterCount={activeFilterCount}
        resetFilters={resetFilters}
        searchPlaceholder={searchPlaceholder}
        filterTitle={filterTitle}
        resetLabel="Reset Filters"
        trailingActions={
          <>
            <div
              className="text-[11px] font-mono tabular-nums text-ink/55 whitespace-nowrap px-1"
              title={`${listRows.length} match the current filters`}
            >
              {loading ? '— / —' : `${listRows.length}`}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleNew}
              className="h-8 gap-2 border-gold/20 text-gold hover:bg-gold/5"
            >
              <Plus className="w-3 h-3" /> New {entityName.singular}
            </Button>
          </>
        }
        renderFilters={renderFilters}
      />
    </div>
  );

  // List column header strip — driven by `listColumns`.
  const gridTemplate = listColumns.map((c) => c.width).join(' ');
  const listHeader = (
    <div className="border-b border-gold/10 bg-background/35 px-3 py-2.5 shrink-0">
      <div
        className="grid gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-gold/70 items-center"
        style={{ gridTemplateColumns: gridTemplate }}
      >
        {listColumns.map((col) => {
          const align = col.align ?? (col.key === 'name' ? 'start' : 'center');
          const cls =
            align === 'start' ? '' : align === 'end' ? 'text-right' : 'text-center';
          return (
            <span key={col.key} className={cls}>
              {col.label}
            </span>
          );
        })}
      </div>
    </div>
  );

  const defaultEmpty = `No ${entityName.plural.toLowerCase()} match the current search.`;
  const emptyContent =
    typeof emptyListMessage === 'string' || !emptyListMessage ? (
      <div className="px-6 py-12 text-center text-ink/45">
        {typeof emptyListMessage === 'string' ? emptyListMessage : defaultEmpty}
      </div>
    ) : (
      emptyListMessage
    );

  // List card body — header strip + virtualized rows.
  const listCard = (
    <Card
      className={cn(
        'border-gold/10 bg-card/50 overflow-hidden flex-col lg:flex lg:flex-none lg:w-[280px]',
        listView === 'list' ? 'flex flex-1' : 'hidden lg:flex',
      )}
      style={{ height: `${paneHeight}px`, width: `${LIST_COL_WIDTH_PX}px` }}
    >
      <CardContent className="p-0 flex flex-col h-full">
        {listHeader}
        {loading ? (
          <div className="px-6 py-12 text-center text-ink/45">Loading…</div>
        ) : listRows.length === 0 ? (
          emptyContent
        ) : (
          <VirtualizedList
            items={listRows}
            height={listInnerHeight}
            itemHeight={listRowHeight}
            className="custom-scrollbar overflow-y-auto"
            renderItem={(row: TRow) => {
              const id = getRowId(row);
              const selected = id === selectedId;
              return (
                <div
                  key={id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelect(id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelect(id);
                    }
                  }}
                  className={cn(
                    'group relative grid w-full gap-2 items-center px-3 text-left transition-colors border-b border-gold/5 cursor-pointer focus:outline-none focus:bg-gold/5',
                    selected ? 'bg-gold/10' : 'hover:bg-gold/5',
                  )}
                  style={{
                    gridTemplateColumns: gridTemplate,
                    height: `${listRowHeight}px`,
                  }}
                >
                  {listColumns.map((col) => (
                    <React.Fragment key={col.key}>{col.render(row)}</React.Fragment>
                  ))}
                </div>
              );
            }}
          />
        )}
      </CardContent>
    </Card>
  );

  // ─── Editor card identity row ─────────────────────────────────
  const actionRow = isReadOnly && onUnlockBase ? (
    <Button
      type="button"
      size="sm"
      className="gap-1.5 bg-gold text-white h-8 text-xs"
      onClick={onUnlockBase}
    >
      <Pencil className="h-3.5 w-3.5" />
      Edit Base{identityName ? ` "${identityName}"` : ` ${entityName.singular}`}
    </Button>
  ) : (
    <>
      {selectedId && onDelete ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5 border-blood/30 text-blood hover:bg-blood/10 h-8 text-xs"
          onClick={onDelete}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </Button>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5 border-gold/20 bg-background/40 text-ink hover:bg-gold/5 h-8 text-xs"
        onClick={onReset}
      >
        <Edit3 className="h-3.5 w-3.5" />
        Reset
      </Button>
      <Button
        type="submit"
        size="sm"
        form={formId}
        className="gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground h-8 text-xs"
        disabled={saving}
      >
        <Save className="h-3.5 w-3.5" />
        {saving ? 'Saving...' : selectedId ? 'Update' : 'Save'}
      </Button>
    </>
  );

  // Default readonly banner used when consumer doesn't pass one.
  const defaultReadonlyBanner = (
    <div className="flex items-start gap-2 rounded-md border border-gold/30 bg-gold/5 px-3 py-2">
      <Lock className="h-4 w-4 text-gold/70 mt-0.5 flex-shrink-0" />
      <p className="text-xs text-ink/75 leading-relaxed">
        <span className="font-semibold">
          Base {entityName.singular.toLowerCase()} — viewing only.
        </span>{' '}
        Click <em>Edit Base</em> to propose changes. Your edits will queue as
        an update revision in the active block; the live catalog stays
        untouched until an admin approves.
      </p>
    </div>
  );

  // Editor card — middle column. The Tabs wrapper hosts both super-tabs;
  // the form wraps the Tabs so the submit button fires regardless of
  // which super-tab is mounted.
  const editorCard = (
    <Card
      className={cn(
        'border-gold/20 bg-card/50 overflow-hidden flex-col lg:flex lg:flex-1',
        listView === 'editor' ? 'flex flex-1' : 'hidden lg:flex',
      )}
      style={{ height: `${paneHeight}px` }}
    >
      <CardContent className="p-0 h-full flex flex-col">
        {/* Back-to-list nav — < lg only. */}
        <div className="lg:hidden flex items-center gap-2 border-b border-gold/15 bg-background/35 px-3 py-2 shrink-0">
          <Button
            type="button"
            onClick={() => setListView('list')}
            variant="ghost"
            size="sm"
            className="text-gold gap-2 hover:bg-gold/5 px-2 h-8 text-xs"
          >
            <ChevronLeft className="w-4 h-4" /> Back to {entityName.plural.toLowerCase()}
          </Button>
        </div>

        <form
          id={formId}
          onSubmit={(e) => { void onSave(e); }}
          className="flex-1 min-h-0 flex flex-col"
          autoComplete="off"
          spellCheck={false}
          data-1p-ignore="true"
          data-lpignore="true"
        >
          <Tabs
            value={editorView}
            onValueChange={(v) => setEditorView(v as 'editor' | 'tags')}
            className="flex-1 min-h-0 flex flex-col"
          >
            {/* Editor card header — banners stack, then identity row,
                then super-tab strip. */}
            <div className="border-b border-gold/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),transparent)] px-4 py-2 space-y-1.5">
              {cascadeBanner}
              {isReadOnly ? (readonlyBanner ?? defaultReadonlyBanner) : null}

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 justify-between">
                <div className="flex items-baseline gap-2 flex-wrap min-w-0">
                  <h3 className="font-serif text-lg xl:text-xl font-bold text-ink leading-tight break-words min-w-0">
                    {selectedId ? (identityName || `Untitled ${entityName.singular}`) : `New ${entityName.singular}`}
                  </h3>
                  {identitySourceAbbrev ? (
                    <span
                      className="rounded border border-gold/20 bg-gold/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-gold whitespace-nowrap"
                      title={identitySourceFullName || identitySourceAbbrev}
                    >
                      {identitySourceAbbrev}
                    </span>
                  ) : null}
                  {identitySubtitle ? (
                    <span className="font-serif italic text-ink/60 text-xs whitespace-nowrap">
                      {identitySubtitle}
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-1.5 shrink-0">{actionRow}</div>
              </div>

              <TabsList variant="line" className="gap-1 bg-transparent p-0">
                <TabsTrigger
                  value="editor"
                  className="rounded-md border border-gold/15 bg-background/30 px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-ink/65 data-active:border-gold/40 data-active:bg-gold/10 data-active:text-gold"
                >
                  Editor
                </TabsTrigger>
                <TabsTrigger
                  value="tags"
                  className="rounded-md border border-gold/15 bg-background/30 px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-ink/65 data-active:border-gold/40 data-active:bg-gold/10 data-active:text-gold"
                >
                  Tags
                  {typeof tagsSuperTabCount === 'number' && tagsSuperTabCount > 0 && (
                    <span className="ml-1 text-gold/70">({tagsSuperTabCount})</span>
                  )}
                </TabsTrigger>
              </TabsList>
            </div>

            {/* Editor super-tab — inner Tabs hosts the entity-shaped
                sub-tabs (Basics / Mechanics / Activities / Effects). */}
            <TabsContent
              value="editor"
              className="flex-1 min-h-0 flex flex-col mt-0 data-[state=inactive]:hidden"
            >
              <Tabs
                value={editorSubTab}
                onValueChange={setEditorSubTab}
                className="flex-1 min-h-0 flex flex-col"
              >
                <div className="border-b border-gold/10 bg-background/35 px-4 py-1.5 shrink-0">
                  <TabsList variant="line" className="gap-2 bg-transparent p-0">
                    {editorSubTabs.map((t) => (
                      <TabsTrigger
                        key={t.key}
                        value={t.key}
                        className="rounded-md border border-gold/15 bg-background/30 px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-ink/65 data-active:border-gold/40 data-active:bg-gold/10 data-active:text-gold"
                      >
                        {t.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </div>

                <fieldset
                  disabled={isReadOnly}
                  className="flex-1 min-h-0 flex flex-col p-0 m-0 border-0"
                >
                  {editorSubTabs.map((t) => {
                    const isFill = t.layout === 'fill';
                    return (
                      <TabsContent
                        key={t.key}
                        value={t.key}
                        className={cn(
                          'mt-0 px-4 py-3 data-[state=inactive]:hidden',
                          isFill
                            ? 'flex-1 min-h-0 flex flex-col gap-4'
                            : 'flex-1 min-h-0 overflow-y-auto custom-scrollbar space-y-4',
                        )}
                      >
                        {t.render()}
                      </TabsContent>
                    );
                  })}
                </fieldset>
              </Tabs>
            </TabsContent>

            {/* Tags super-tab — inner Tabs hosts the tagging-shaped
                sub-tabs (Tags / Prereqs / Rules for spells; Prereqs /
                Tags for feats). No `layout` mode here — Tags content
                is invariably scrollable. */}
            <TabsContent
              value="tags"
              className="flex-1 min-h-0 flex flex-col mt-0 data-[state=inactive]:hidden"
            >
              <Tabs
                value={tagsSubTab}
                onValueChange={setTagsSubTab}
                className="flex-1 min-h-0 flex flex-col"
              >
                <div className="border-b border-gold/10 bg-background/35 px-4 py-1.5 shrink-0">
                  <TabsList variant="line" className="gap-2 bg-transparent p-0">
                    {tagsSubTabs.map((t) => (
                      <TabsTrigger
                        key={t.key}
                        value={t.key}
                        className="rounded-md border border-gold/15 bg-background/30 px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-ink/65 data-active:border-gold/40 data-active:bg-gold/10 data-active:text-gold"
                      >
                        {t.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </div>

                <fieldset
                  disabled={isReadOnly}
                  className="flex-1 min-h-0 flex flex-col p-0 m-0 border-0"
                >
                  {tagsSubTabs.map((t) => (
                    <TabsContent
                      key={t.key}
                      value={t.key}
                      className="mt-0 flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4 data-[state=inactive]:hidden"
                    >
                      {t.render()}
                    </TabsContent>
                  ))}
                </fieldset>
              </Tabs>
            </TabsContent>
          </Tabs>
        </form>
      </CardContent>
    </Card>
  );

  // Preview card — right column, xl+ only.
  const previewCard = (
    <Card
      className="border-gold/10 bg-card/50 overflow-hidden hidden xl:flex xl:flex-col xl:flex-none"
      style={{ height: `${paneHeight}px`, width: `${PREVIEW_COL_WIDTH_PX}px` }}
    >
      <CardContent className="p-0 h-full overflow-y-auto custom-scrollbar">
        {renderPreview(selectedId)}
      </CardContent>
    </Card>
  );

  // ─── Render ───────────────────────────────────────────────────
  return (
    <Tabs
      defaultValue={computedDefaultMode}
      className="h-[calc(100vh-4rem)] flex flex-col gap-2 p-2"
    >
      {topToolbar}
      {modes
        .filter((mode) => !mode.adminOnly || isAdmin)
        .map((mode) => {
          if (mode.key === manualEditorModeKey) {
            return (
              <TabsContent key={mode.key} value={mode.key} className="flex-1 min-h-0">
                <div className="h-full flex flex-col gap-2">
                  {filterRow}
                  <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-2">
                    {listCard}
                    {editorCard}
                    {previewCard}
                  </div>
                </div>
              </TabsContent>
            );
          }
          return (
            <TabsContent key={mode.key} value={mode.key} className="flex-1 min-h-0">
              {mode.render}
            </TabsContent>
          );
        })}
    </Tabs>
  );
}
