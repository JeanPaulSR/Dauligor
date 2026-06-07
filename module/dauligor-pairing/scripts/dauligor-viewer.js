// Dauligor Library — the in-Foundry page viewer (page-system Phase 2).
//
// Reads the app's lore articles (authenticated, via content-service) and renders
// them NATIVELY using the module's block engine (layout-blocks.renderBlocks),
// inside an ApplicationV2 window themed like the importer. Owner decision
// 2026-06-06: keep the native renderer (the app's React LayoutBlocks is a spec,
// not a runtime dependency — see the page-system design doc).
//
// Surface:
//   • Library browser (Phase 3): a text search + a section-filter panel
//     (Category / Folder / Status tag-axes, the same tri-state UI the importer
//     uses) over every article the logged-in user can see.
//   • Article view: rendered blocks + a Contents rail (definition anchors) +
//     back / library / refresh nav.
//   • Cross-refs: @article[...] loads in-viewer; other entity/rule refs open the
//     live app in a browser tab (data-route from layout-blocks).
//   • Logged-out / expired / network states with a login or retry CTA.
//
// Phase 4 (next) adds campaign home + system-page (&) refs. The list payload has
// no real tags, so the filter axes are synthesized from category/folder/status.

import { DAULIGOR_VIEWER_TEMPLATE, MODULE_ID } from "./constants.js";
import { isLoggedIn } from "./auth-service.js";
import { getArticle, listArticles } from "./content-service.js";
import { renderBlocks, renderRichText, collectAnchors } from "./layout-blocks.js";
import { log } from "./utils.js";
import {
  renderSectionFilterPanel,
  bindSectionFilterPanelEvents,
  matchesTagGroupsTriState,
  nextStateForward,
  nextStateReverse,
  nextCombineMode,
  nextCombineModeReverse,
  SECTION_FILTER_STATE,
} from "./section-filter-panel.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

// Synthetic filter axes (the list payload has no real tags). Each article gets
// `${PREFIX}<value>` tag ids; the section-filter panel groups them into axes.
const CAT_GROUP = "cat", FOLDER_GROUP = "folder", STATUS_GROUP = "status";
const CAT_PREFIX = "cat:", FOLDER_PREFIX = "folder:", STATUS_PREFIX = "status:";

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function titleCase(s) {
  const v = String(s ?? "");
  return v ? v.charAt(0).toUpperCase() + v.slice(1) : v;
}

// Fresh ephemeral UI state for the section-filter panel (mirrors the importer /
// creator). Re-created on close so reopening starts expanded with no chip search.
function freshFilterUi() {
  return {
    hiddenAxes: new Set(),
    expandedParents: new Map(),
    allSubtagAxes: new Set(),
    altLabelAxes: new Set(),
    chipSearch: "",
  };
}

// Window size: roomy but viewport-clamped. Stamped on the frame before first
// paint (the importer/launcher pattern — AppV2 yields to paint before its own
// setPosition, so an un-stamped frame flashes top-left first).
function viewerSize() {
  const vw = (typeof window !== "undefined" && window.innerWidth) || 1280;
  const vh = (typeof window !== "undefined" && window.innerHeight) || 860;
  return {
    width: Math.min(940, Math.max(640, vw - 80)),
    height: Math.min(800, Math.max(480, vh - 80)),
  };
}

function applyCenteredPositionToFrame(frame, { width, height }) {
  if (!frame || !Number.isFinite(width) || !Number.isFinite(height)) return;
  const vw = document.documentElement.clientWidth || window.innerWidth || 0;
  const vh = document.documentElement.clientHeight || window.innerHeight || 0;
  frame.style.width = `${width}px`;
  frame.style.height = `${height}px`;
  frame.style.left = `${Math.max(0, Math.round((vw - width) / 2))}px`;
  frame.style.top = `${Math.max(0, Math.round((vh - height) / 2))}px`;
}

export class DauligorViewerApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static _instance = null;

  /**
   * Open (or focus) the library. `articleId` (a UUID or slug) opens straight to
   * that article; otherwise it lands on the list.
   */
  static async open({ articleId } = {}) {
    const inst = this._instance ?? new this();
    this._instance = inst;
    inst._current = articleId ? { mode: "article", id: String(articleId) } : { mode: "list" };
    inst._history = [];
    inst._browse = inst._freshBrowse(); // fresh search/filter each launcher open
    if (inst._mounted) {
      await inst._renderCurrent();
      inst.bringToFront?.();
    } else {
      await inst.render({ force: true });
    }
    return inst;
  }

  constructor() {
    const size = viewerSize();
    super({
      id: `${MODULE_ID}-viewer`,
      classes: ["dauligor-importer-app", "dauligor-viewer"],
      window: {
        title: "Dauligor Library",
        icon: "fas fa-book-open",
        resizable: true,
        contentClasses: ["dauligor-importer-window"],
      },
      position: { width: size.width, height: size.height },
    });

    // Navigation state. `_current` is the active view ({mode:"list"} or
    // {mode:"article", id}); `_history` is the back-stack of prior views.
    this._current = { mode: "list" };
    this._history = [];
    this._mounted = false;
    this._articleTitle = "";
    // Monotonic guard so a slow fetch that the user navigated away from can't
    // paint over the newer view when it finally resolves.
    this._seq = 0;

    // Browser state: the fetched article pool (each tagged with synthetic
    // category/folder/status ids) + the search + section-filter state.
    this._articles = [];
    this._browse = this._freshBrowse();

    // Regions (grabbed in _onRender).
    this._root = null;
    this._toolbarRegion = null;
    this._railRegion = null;
    this._scrollRegion = null;
    this._bodyRegion = null;

    // Re-render the current view when the account session changes (login/logout
    // from the account dialog), so a logged-out CTA becomes content without a
    // manual refresh.
    this._authHookId = Hooks.on(`${MODULE_ID}.authChanged`, () => {
      if (this._bodyRegion?.isConnected) this._renderCurrent();
    });
  }

  _configureRenderParts() {
    return { main: { template: DAULIGOR_VIEWER_TEMPLATE } };
  }

  async _renderFrame(options) {
    const frame = await super._renderFrame(options);
    applyCenteredPositionToFrame(frame, this.position);
    return frame;
  }

  async close(options) {
    if (this._authHookId) Hooks.off(`${MODULE_ID}.authChanged`, this._authHookId);
    this._authHookId = null;
    this._mounted = false;
    if (DauligorViewerApp._instance === this) DauligorViewerApp._instance = null;
    return super.close(options);
  }

  async _onRender() {
    super._onRender?.(...arguments);
    const root = this.element instanceof HTMLElement
      ? this.element
      : (this.element?.[0] instanceof HTMLElement ? this.element[0] : document.getElementById(this.id));
    if (!root) return;
    const content = root.querySelector(".window-content") ?? root;
    this._root = content.querySelector(".dauligor-viewer__shell") ?? content;
    this._toolbarRegion = content.querySelector(`[data-region="toolbar"]`);
    this._railRegion = content.querySelector(`[data-region="rail"]`);
    this._scrollRegion = content.querySelector(`[data-region="scroll"]`);
    this._bodyRegion = content.querySelector(`[data-region="body"]`);
    this._mounted = true;
    await this._renderCurrent();
  }

  // ── navigation ─────────────────────────────────────────────────────────────

  _navigate(view, { push = true } = {}) {
    if (push && this._current) this._history.push(this._current);
    this._current = view;
    this._renderCurrent();
  }

  _back() {
    const prev = this._history.pop();
    if (!prev) return;
    this._current = prev;
    this._renderCurrent();
  }

  async _renderCurrent() {
    if (!this._bodyRegion) return;
    const seq = ++this._seq;
    this._renderToolbar();
    if (!isLoggedIn()) {
      this._renderLoggedOut();
      return;
    }
    if (this._current?.mode === "article") {
      await this._renderArticleView(this._current.id, seq);
    } else {
      await this._renderListView(seq);
    }
  }

  // ── views ──────────────────────────────────────────────────────────────────

  _freshBrowse() {
    return {
      search: "",
      open: false,
      tagStates: {},
      groupCombineModes: {},
      groupExclusionModes: {},
      ui: freshFilterUi(),
      snapshot: null,
    };
  }

  async _renderListView(seq) {
    this._articleTitle = "";
    this._setRail("");
    this._setBody(this._statusHtml("spinner", "Loading the library…"));
    let articles = [];
    try {
      articles = await listArticles({ orderBy: "title ASC" });
    } catch (err) {
      if (seq === this._seq) this._renderError(err);
      return;
    }
    if (seq !== this._seq) return; // navigated away mid-fetch
    // Tag each article with synthetic category/folder/status ids so the shared
    // section-filter panel can drive the axes (the list payload has no real
    // tags). Cache the pool; search + filtering are client-side from here.
    this._articles = articles.map((a) => ({ ...a, tags: this._buildArticleTags(a) }));
    if (!this._articles.length) {
      this._setBody(this._statusHtml("empty", "No articles are available to your account yet."));
      return;
    }
    this._renderBrowse();
  }

  // ── article browser (search + section-filter axes) ───────────────────────────

  _buildArticleTags(a) {
    const tags = [];
    if (a.category) tags.push(`${CAT_PREFIX}${String(a.category)}`);
    if (a.folder) tags.push(`${FOLDER_PREFIX}${String(a.folder)}`);
    if (a.status) tags.push(`${STATUS_PREFIX}${String(a.status)}`);
    return tags;
  }

  // FilterSection[] for the panel — a tag-axis for Category / Folder / Status,
  // each shown only when the pool has >1 distinct value (a 1-value axis can't
  // usefully filter; Status collapses away entirely for non-staff = all
  // published).
  _articleAxes() {
    const defs = [
      { key: `tag:${CAT_GROUP}`, name: "Category", prefix: CAT_PREFIX, groupId: CAT_GROUP, format: titleCase },
      { key: `tag:${FOLDER_GROUP}`, name: "Folder", prefix: FOLDER_PREFIX, groupId: FOLDER_GROUP, format: (v) => v },
      { key: `tag:${STATUS_GROUP}`, name: "Status", prefix: STATUS_PREFIX, groupId: STATUS_GROUP, format: titleCase },
    ];
    const axes = [];
    for (const def of defs) {
      const ids = [...new Set((this._articles || []).flatMap((a) => a.tags).filter((t) => t.startsWith(def.prefix)))];
      if (ids.length < 2) continue;
      axes.push({
        key: def.key,
        name: def.name,
        kind: "tag",
        groupId: def.groupId,
        values: ids
          .map((id) => ({ value: id, label: def.format(id.slice(def.prefix.length)) }))
          .sort((a, b) => a.label.localeCompare(b.label)),
      });
    }
    return axes;
  }

  // { tagGroups, tagsByGroup } the tri-state matcher needs — built from the same
  // axes so hidden single-value axes never participate in matching.
  _articleFilterGroups() {
    const tagGroups = [];
    const tagsByGroup = {};
    for (const axis of this._articleAxes()) {
      tagGroups.push({ id: axis.groupId });
      tagsByGroup[axis.groupId] = axis.values.map((v) => ({ id: v.value }));
    }
    return { tagGroups, tagsByGroup };
  }

  // Tag ids governed by an axis (for its All / None / Clear controls).
  _articleTagsForAxis(axisKey) {
    const axis = this._articleAxes().find((a) => a.key === axisKey);
    return axis ? axis.values.map((v) => v.value) : [];
  }

  // The pool after BOTH the text search (title + excerpt) and the tri-state tags.
  _filteredArticles() {
    const q = String(this._browse.search || "").trim().toLowerCase();
    const states = this._browse.tagStates;
    const hasTagFilter = states && Object.keys(states).length > 0;
    const { tagGroups, tagsByGroup } = hasTagFilter ? this._articleFilterGroups() : { tagGroups: [], tagsByGroup: {} };
    return (this._articles || []).filter((a) => {
      if (q && !`${a.title || ""} ${a.excerpt || ""}`.toLowerCase().includes(q)) return false;
      if (hasTagFilter && !matchesTagGroupsTriState({
        itemTagIds: a.tags,
        tagGroups,
        tagsByGroup,
        tagStates: states,
        groupCombineModes: this._browse.groupCombineModes,
        groupExclusionModes: this._browse.groupExclusionModes,
      })) return false;
      return true;
    });
  }

  _articleRowHtml(a) {
    const id = String(a.id ?? a.slug ?? "");
    const title = esc(a.title || "Untitled");
    const cat = a.category ? `<span class="dauligor-viewer__row-cat">${esc(a.category)}</span>` : "";
    // Non-staff never receive non-published rows (server-filtered), so this
    // badge only ever appears for staff previewing unpublished work.
    const st = a.status ? String(a.status) : "";
    const draft = (st && st !== "published")
      ? `<span class="dauligor-viewer__row-badge">${esc(titleCase(st))}</span>` : "";
    const excerpt = a.excerpt ? `<span class="dauligor-viewer__row-excerpt">${esc(a.excerpt)}</span>` : "";
    return `
      <div role="button" tabindex="0" class="dauligor-viewer__row" data-article-id="${esc(id)}">
        <span class="dauligor-viewer__row-head">
          <span class="dauligor-viewer__row-title">${title}</span>
          ${draft}
          ${cat}
        </span>
        ${excerpt}
      </div>`;
  }

  // Full browse render: search bar + filter button + results + (open) filter card.
  _renderBrowse() {
    if (!this._bodyRegion) return;
    const hasAxes = this._articleAxes().length > 0;
    const activeCount = Object.keys(this._browse.tagStates || {}).length;
    const filterBtn = hasAxes
      ? `<button type="button" class="dauligor-viewer__filter-btn ${this._browse.open ? "dauligor-viewer__filter-btn--active" : ""}" data-action="article-filter"><i class="fas fa-filter" inert></i> Filter${activeCount ? ` <span class="dauligor-viewer__filter-count">${activeCount}</span>` : ""}</button>`
      : "";
    this._setBody(`
      <div class="dauligor-viewer__browse">
        <div class="dauligor-viewer__browse-bar">
          <div class="dauligor-viewer__search-wrap">
            <i class="fas fa-magnifying-glass dauligor-viewer__search-icon" inert></i>
            <input type="text" class="dauligor-viewer__search" data-action="article-search" placeholder="Search articles…" value="${esc(this._browse.search || "")}" aria-label="Search articles" />
          </div>
          ${filterBtn}
        </div>
        <div class="dauligor-viewer__results" data-region="article-results">${this._articleResultsHtml()}</div>
        ${(hasAxes && this._browse.open) ? this._renderArticleFilterPanel() : ""}
      </div>`);
    this._bindBrowse();
  }

  _articleResultsHtml() {
    const filtered = this._filteredArticles();
    const total = (this._articles || []).length;
    if (!filtered.length) {
      return `<div class="dauligor-viewer__results-count">0 of ${total}</div>`
        + this._statusHtml("empty", "No articles match your search or filters.");
    }
    const count = filtered.length === total
      ? `${total} article${total === 1 ? "" : "s"}`
      : `${filtered.length} of ${total}`;
    return `<div class="dauligor-viewer__results-count">${count}</div>`
      + `<div class="dauligor-viewer__list">${filtered.map((a) => this._articleRowHtml(a)).join("")}</div>`;
  }

  // Re-render ONLY the results region — used on search keystrokes so the search
  // input keeps its focus + caret (a full _renderBrowse would replace it).
  _renderArticleList() {
    const region = this._bodyRegion?.querySelector(`[data-region="article-results"]`);
    if (!region) return;
    region.innerHTML = this._articleResultsHtml();
    this._bindArticleRows();
  }

  _renderArticleFilterPanel() {
    const panel = renderSectionFilterPanel({
      axes: this._articleAxes(),
      tagStates: this._browse.tagStates,
      groupCombineModes: this._browse.groupCombineModes,
      groupExclusionModes: this._browse.groupExclusionModes,
      uiState: this._browse.ui,
      title: "Article Filters",
      searchPlaceholder: "Filter tags…",
      resetLabel: "Reset Filters",
      showCloseButton: true,
    });
    return `
      <div class="dauligor-viewer__filter-overlay">
        <div class="dauligor-viewer__filter-backdrop" data-action="article-filter-backdrop"></div>
        <div class="dauligor-viewer__filter-card" role="dialog" aria-label="Article filters">${panel}</div>
      </div>`;
  }

  _bindArticleRows() {
    this._bodyRegion?.querySelectorAll(`[data-article-id]`).forEach((el) => {
      const go = () => this._navigate({ mode: "article", id: el.dataset.articleId });
      el.addEventListener("click", go);
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); }
      });
    });
  }

  _bindBrowse() {
    const root = this._bodyRegion;
    if (!root) return;
    this._bindArticleRows();

    const search = root.querySelector(`[data-action="article-search"]`);
    if (search) {
      search.addEventListener("input", (e) => {
        this._browse.search = e.target.value;
        this._renderArticleList(); // results-only so the input keeps focus
      });
    }

    root.querySelector(`[data-action="article-filter"]`)?.addEventListener("click", () => {
      const wasOpen = this._browse.open;
      this._browse.open = !wasOpen;
      if (!wasOpen) this._snapshotBrowseFilter(); else this._clearBrowseSnapshot();
      this._renderBrowse();
    });

    if (!this._browse.open) return;
    root.querySelector(`[data-action="article-filter-backdrop"]`)?.addEventListener("click", () => this._closeBrowseFilter());
    const panel = root.querySelector(".dauligor-section-filter");
    if (!panel) return;
    const rerender = () => this._renderBrowse();
    bindSectionFilterPanelEvents(panel, {
      cycleTagState: (id) => { this._cycleBrowseTag(id, false); rerender(); },
      cycleTagStateReverse: (id) => { this._cycleBrowseTag(id, true); rerender(); },
      cycleGroupCombineMode: (gid) => { this._cycleBrowseCombine(gid, false); rerender(); },
      cycleGroupCombineModeReverse: (gid) => { this._cycleBrowseCombine(gid, true); rerender(); },
      cycleGroupExclusionMode: (gid) => { this._cycleBrowseExclusion(gid, false); rerender(); },
      cycleGroupExclusionModeReverse: (gid) => { this._cycleBrowseExclusion(gid, true); rerender(); },
      groupIncludeAll: (axisKey) => { this._setBrowseTagsBulk(this._articleTagsForAxis(axisKey), SECTION_FILTER_STATE.INCLUDE); rerender(); },
      groupExcludeAll: (axisKey) => { this._setBrowseTagsBulk(this._articleTagsForAxis(axisKey), SECTION_FILTER_STATE.EXCLUDE); rerender(); },
      groupClear: (axisKey) => { this._clearBrowseTags(this._articleTagsForAxis(axisKey)); rerender(); },
      toggleAxisHidden: (axisKey) => { const ui = this._browse.ui; if (ui.hiddenAxes.has(axisKey)) ui.hiddenAxes.delete(axisKey); else ui.hiddenAxes.add(axisKey); rerender(); },
      toggleParentDrawer: (axisKey, parent) => {
        const ui = this._browse.ui;
        if (!ui.expandedParents.has(axisKey)) ui.expandedParents.set(axisKey, new Set());
        const set = ui.expandedParents.get(axisKey);
        if (set.has(parent)) set.delete(parent); else set.add(parent);
        rerender();
      },
      toggleAllSubtags: (axisKey) => { const ui = this._browse.ui; if (ui.allSubtagAxes.has(axisKey)) ui.allSubtagAxes.delete(axisKey); else ui.allSubtagAxes.add(axisKey); rerender(); },
      toggleAltLabel: (axisKey) => { const ui = this._browse.ui; if (ui.altLabelAxes.has(axisKey)) ui.altLabelAxes.delete(axisKey); else ui.altLabelAxes.add(axisKey); rerender(); },
      setChipSearch: (v) => {
        this._browse.ui.chipSearch = String(v ?? "");
        this._renderBrowse();
        // Re-render replaced the input — restore focus + caret so typing flows.
        const inp = this._bodyRegion?.querySelector(`[data-section-action="chip-search"]`);
        if (inp) { inp.focus(); const n = inp.value.length; try { inp.setSelectionRange(n, n); } catch { /* noop */ } }
      },
      showAllSections: () => { this._browse.ui.hiddenAxes.clear(); rerender(); },
      hideAllSections: () => { this._browse.ui.hiddenAxes = new Set(this._articleAxes().map((a) => a.key)); rerender(); },
      resetAll: () => { this._browse.tagStates = {}; this._browse.groupCombineModes = {}; this._browse.groupExclusionModes = {}; rerender(); },
      close: () => this._closeBrowseFilter(),
      save: () => this._closeBrowseFilter(),
      cancel: () => { this._restoreBrowseFilter(); this._closeBrowseFilter(); },
    });
  }

  // ── filter state mutations ───────────────────────────────────────────────────

  _cycleBrowseTag(id, reverse) {
    const cur = this._browse.tagStates[id] || 0;
    const next = reverse ? nextStateReverse(cur) : nextStateForward(cur);
    if (next === SECTION_FILTER_STATE.OFF) delete this._browse.tagStates[id];
    else this._browse.tagStates[id] = next;
  }
  _cycleBrowseCombine(gid, reverse) {
    const cur = this._browse.groupCombineModes[gid] || "OR";
    this._browse.groupCombineModes[gid] = reverse ? nextCombineModeReverse(cur) : nextCombineMode(cur);
  }
  _cycleBrowseExclusion(gid, reverse) {
    const cur = this._browse.groupExclusionModes[gid] || "OR";
    this._browse.groupExclusionModes[gid] = reverse ? nextCombineModeReverse(cur) : nextCombineMode(cur);
  }
  _setBrowseTagsBulk(ids, mode) {
    for (const id of ids) {
      if (mode === SECTION_FILTER_STATE.OFF) delete this._browse.tagStates[id];
      else this._browse.tagStates[id] = mode;
    }
  }
  _clearBrowseTags(ids) { for (const id of ids) delete this._browse.tagStates[id]; }

  _snapshotBrowseFilter() {
    const clone = (typeof structuredClone === "function") ? structuredClone : (v) => JSON.parse(JSON.stringify(v));
    this._browse.snapshot = {
      tagStates: clone(this._browse.tagStates),
      groupCombineModes: clone(this._browse.groupCombineModes),
      groupExclusionModes: clone(this._browse.groupExclusionModes),
    };
  }
  _restoreBrowseFilter() {
    const s = this._browse.snapshot;
    if (!s) return;
    this._browse.tagStates = s.tagStates;
    this._browse.groupCombineModes = s.groupCombineModes;
    this._browse.groupExclusionModes = s.groupExclusionModes;
  }
  _clearBrowseSnapshot() { this._browse.snapshot = null; }
  _closeBrowseFilter() {
    this._browse.open = false;
    this._browse.ui = freshFilterUi();
    this._clearBrowseSnapshot();
    this._renderBrowse();
  }

  async _renderArticleView(id, seq) {
    if (!id) { await this._renderListView(seq); return; }
    this._setRail("");
    this._setBody(this._statusHtml("spinner", "Loading…"));
    let result;
    try {
      result = await getArticle(id);
    } catch (err) {
      if (seq === this._seq) this._renderError(err);
      return;
    }
    if (seq !== this._seq) return; // superseded
    const article = result?.article;
    if (!article) {
      this._setBody(this._statusHtml("empty", "That article couldn't be found."));
      return;
    }

    this._articleTitle = article.title || "Article";
    this._renderToolbar(); // refresh the title now that it's known

    const blocks = Array.isArray(article.blocks) ? article.blocks : [];
    let inner;
    if (blocks.length) {
      inner = renderBlocks(blocks);
    } else if (article.content) {
      // Legacy article (BBCode body, not yet migrated to blocks) — render the
      // content mirror, same fallback the app's LoreArticle viewer uses.
      inner = `<div class="dauligor-block dauligor-block--text dauligor-richtext">${renderRichText(article.content)}</div>`;
    } else {
      inner = this._statusHtml("empty", "This article has no content yet.");
    }
    this._setBody(`<article class="dauligor-viewer__article">${inner}</article>`);

    this._renderRail(collectAnchors(blocks));
    this._bindRefs();
    if (this._scrollRegion) this._scrollRegion.scrollTop = 0;
  }

  // ── chrome regions ───────────────────────────────────────────────────────────

  _renderToolbar() {
    if (!this._toolbarRegion) return;
    const canBack = this._history.length > 0;
    const isArticle = this._current?.mode === "article";
    const title = isArticle ? (this._articleTitle || "Article") : "Library";
    this._toolbarRegion.innerHTML = `
      <div class="dauligor-viewer__toolbar-nav">
        <button type="button" class="dauligor-viewer__tbtn" data-act="back" ${canBack ? "" : "disabled"} data-tooltip="Back" aria-label="Back"><i class="fas fa-arrow-left" inert></i></button>
        <button type="button" class="dauligor-viewer__tbtn ${isArticle ? "" : "dauligor-viewer__tbtn--active"}" data-act="home" data-tooltip="Library" aria-label="Library"><i class="fas fa-book" inert></i></button>
      </div>
      <div class="dauligor-viewer__toolbar-title">${esc(title)}</div>
      <div class="dauligor-viewer__toolbar-actions">
        <button type="button" class="dauligor-viewer__tbtn" data-act="refresh" data-tooltip="Refresh" aria-label="Refresh"><i class="fas fa-rotate-right" inert></i></button>
      </div>`;
    this._toolbarRegion.querySelector(`[data-act="back"]`)?.addEventListener("click", () => this._back());
    this._toolbarRegion.querySelector(`[data-act="home"]`)?.addEventListener("click", () => this._navigate({ mode: "list" }));
    this._toolbarRegion.querySelector(`[data-act="refresh"]`)?.addEventListener("click", () => this._renderCurrent());
  }

  _renderRail(anchors) {
    if (!this._railRegion) return;
    const list = Array.isArray(anchors) ? anchors : [];
    if (!list.length) { this._setRail(""); return; }
    const items = list.map((a) =>
      `<a class="dauligor-viewer__rail-link" data-anchor="${esc(a.anchor)}">${esc(a.name)}</a>`).join("");
    this._railRegion.innerHTML = `<div class="dauligor-viewer__rail-title">On this page</div>${items}`;
    this._root?.classList.add("dauligor-viewer--has-rail");
    this._railRegion.querySelectorAll(`[data-anchor]`).forEach((el) => {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        const target = this._bodyRegion?.querySelector(`#${CSS.escape(el.dataset.anchor)}`);
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  // Wire cross-reference clicks emitted by layout-blocks: @article refs load
  // in-viewer; any other ref with a route opens the live app in a browser tab.
  _bindRefs() {
    if (!this._bodyRegion) return;
    this._bodyRegion.querySelectorAll(`a.dauligor-ref[data-route]`).forEach((a) => {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        const kind = a.dataset.refKind;
        const refId = a.dataset.refId;
        if (kind === "article" && refId) {
          this._navigate({ mode: "article", id: refId });
          return;
        }
        const route = a.getAttribute("data-route");
        if (route) window.open(route, "_blank", "noopener");
      });
    });
  }

  // ── states ───────────────────────────────────────────────────────────────────

  _renderLoggedOut() {
    this._articleTitle = "";
    this._setRail("");
    this._setBody(`
      <div class="dauligor-viewer__status dauligor-viewer__status--cta">
        <i class="fas fa-user-lock dauligor-viewer__status-icon"></i>
        <p>Log in to your Dauligor account to browse references, articles, and campaign content inside Foundry.</p>
        <button type="button" class="dauligor-viewer__cta-btn" data-act="login"><i class="fas fa-right-to-bracket" inert></i> Log in to Dauligor</button>
      </div>`);
    this._bodyRegion.querySelector(`[data-act="login"]`)?.addEventListener(
      "click", () => Hooks.callAll(`${MODULE_ID}.requestLogin`));
  }

  _renderError(err) {
    const msg = err?.message || "Something went wrong loading that content.";
    log("viewer: load failed", err);
    this._setRail("");
    this._setBody(`
      <div class="dauligor-viewer__status dauligor-viewer__status--error">
        <i class="fas fa-triangle-exclamation dauligor-viewer__status-icon"></i>
        <p>${esc(msg)}</p>
        <button type="button" class="dauligor-viewer__cta-btn" data-act="retry"><i class="fas fa-rotate-right" inert></i> Try again</button>
      </div>`);
    this._bodyRegion.querySelector(`[data-act="retry"]`)?.addEventListener(
      "click", () => this._renderCurrent());
  }

  _statusHtml(kind, message) {
    const icon = kind === "spinner"
      ? `<i class="fas fa-spinner fa-spin dauligor-viewer__status-icon"></i>`
      : kind === "empty"
        ? `<i class="fas fa-feather dauligor-viewer__status-icon"></i>`
        : "";
    return `<div class="dauligor-viewer__status">${icon}<p>${esc(message)}</p></div>`;
  }

  // ── region helpers ───────────────────────────────────────────────────────────

  _setBody(html) {
    if (this._bodyRegion) this._bodyRegion.innerHTML = html;
  }

  _setRail(html) {
    if (this._railRegion) this._railRegion.innerHTML = html;
    if (!html) this._root?.classList.remove("dauligor-viewer--has-rail");
  }
}

export async function openDauligorLibrary(opts = {}) {
  return DauligorViewerApp.open(opts);
}
