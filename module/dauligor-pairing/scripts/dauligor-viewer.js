// Dauligor Library — the in-Foundry page viewer (page-system Phase 2).
//
// Reads the app's lore articles (authenticated, via content-service) and renders
// them NATIVELY using the module's block engine (layout-blocks.renderBlocks),
// inside an ApplicationV2 window themed like the importer. Owner decision
// 2026-06-06: keep the native renderer (the app's React LayoutBlocks is a spec,
// not a runtime dependency — see the page-system design doc).
//
// v1 surface:
//   • Library list (every published article the logged-in user can see).
//   • Article view: rendered blocks + a Contents rail (definition anchors) +
//     back / library / refresh nav.
//   • Cross-refs: @article[...] loads in-viewer; other entity/rule refs open the
//     live app in a browser tab (data-route from layout-blocks).
//   • Logged-out / expired / network states with a login or retry CTA.
//
// Phase 3 will upgrade the simple list into the section-filter browser; Phase 4
// adds campaign home + system-page (&) refs. The list here is a deliberate v1
// placeholder, not the final browser.

import { DAULIGOR_VIEWER_TEMPLATE, MODULE_ID } from "./constants.js";
import { isLoggedIn } from "./auth-service.js";
import { getArticle, listArticles } from "./content-service.js";
import { renderBlocks, renderRichText, collectAnchors } from "./layout-blocks.js";
import { log } from "./utils.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
    if (!articles.length) {
      this._setBody(this._statusHtml("empty", "No articles are available to your account yet."));
      return;
    }
    const rows = articles.map((a) => {
      const id = String(a.id ?? a.slug ?? "");
      const title = esc(a.title || "Untitled");
      const cat = a.category ? `<span class="dauligor-viewer__row-cat">${esc(a.category)}</span>` : "";
      // Non-staff never receive non-published rows (server-filtered), so this
      // badge only ever appears for staff previewing unpublished work. Show the
      // actual status (Draft / Archived / …), not a hardcoded label.
      const st = a.status ? String(a.status) : "";
      const draft = (st && st !== "published")
        ? `<span class="dauligor-viewer__row-badge">${esc(st.charAt(0).toUpperCase() + st.slice(1))}</span>` : "";
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
    }).join("");
    this._setBody(`<div class="dauligor-viewer__list">${rows}</div>`);
    this._bodyRegion.querySelectorAll(`[data-article-id]`).forEach((el) => {
      const go = () => this._navigate({ mode: "article", id: el.dataset.articleId });
      el.addEventListener("click", go);
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); }
      });
    });
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
