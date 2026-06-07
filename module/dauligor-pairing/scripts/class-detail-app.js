// Standalone class-detail window — opened by a clicked `@class[…]` reference.
// Shows the SAME rich ClassView the character creator renders (shared via
// `class-detail-view.js`), in its own window — NOT the full creator wizard.
//
// Flow: resolve the class slug → its source slug (via content-service
// resolveReferences) → build the public class-bundle URL
// (`/api/module/<source>/classes/<identifier>.json`) → fetch the bundle + the
// multiclass slot chart → render `renderClassView` + wire its tabs. The window
// root carries `dauligor-character-creator`, so the ClassView styling matches.

import { CLASS_DETAIL_TEMPLATE, MODULE_ID } from "./constants.js";
import { renderClassView, bindClassView, fetchClassBundle, ensureSpellChart, fetchClassSpells } from "./class-detail-view.js";
import { resolveReferences } from "./content-service.js";
import { resolveApiHost } from "./auth-service.js";
import { log } from "./utils.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function titleize(slug) {
  return String(slug ?? "").replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim() || "Class";
}

function classDetailSize() {
  const vw = (typeof window !== "undefined" && window.innerWidth) || 1280;
  const vh = (typeof window !== "undefined" && window.innerHeight) || 860;
  return { width: Math.min(880, Math.max(560, vw - 120)), height: Math.min(780, Math.max(460, vh - 120)) };
}

export class DauligorClassDetailApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static _instances = new Map(); // classIdentifier → instance (reopen focuses)

  /** Open (or focus) the detail window for a class identifier (e.g. "wizard"). */
  static async open(classIdentifier) {
    const id = String(classIdentifier ?? "").trim();
    if (!id) return null;
    const existing = this._instances.get(id);
    if (existing?._mounted) { existing.bringToFront?.(); return existing; }
    const inst = new this(id);
    this._instances.set(id, inst);
    await inst.render({ force: true });
    return inst;
  }

  constructor(classIdentifier) {
    const size = classDetailSize();
    super({
      id: `${MODULE_ID}-class-detail-${classIdentifier}`,
      classes: ["dauligor-importer-app", "dauligor-character-creator"],
      window: { title: titleize(classIdentifier), icon: "fas fa-shield-halved", resizable: true, contentClasses: ["dauligor-importer-window"] },
      position: { width: size.width, height: size.height },
    });
    this._classIdentifier = classIdentifier;
    this._mounted = false;
    this._contentRegion = null;
    // Spell-chart fetch state + bundle cache (host-owned; the shared module's
    // fetch helpers operate on these).
    this._spellChartState = { spellChart: null, spellChartFetched: false };
    this._bundleCache = new Map();
    this._bundleInFlight = new Set();
    // The ClassView `view` (display state passed into the shared renderer).
    this._view = {
      chosen: null, bundle: null, cvTab: "features", cvSubclassId: null,
      cvExpanded: new Set(), cvSpells: new Map(), spellChart: null,
      onFetchSpells: (c) => fetchClassSpells(c.bundleUrl, this._view.cvSpells, (url) => {
        if (this._view.chosen?.bundleUrl === url && this._view.cvTab === "spells") this._paint();
      }),
    };
  }

  _configureRenderParts() {
    return { main: { template: CLASS_DETAIL_TEMPLATE } };
  }

  async _renderFrame(options) {
    const frame = await super._renderFrame(options);
    // Centre on first paint (the importer/viewer pattern).
    try {
      const { width, height } = this.position;
      const vw = document.documentElement.clientWidth || window.innerWidth || 0;
      const vh = document.documentElement.clientHeight || window.innerHeight || 0;
      if (frame && Number.isFinite(width) && Number.isFinite(height)) {
        frame.style.width = `${width}px`;
        frame.style.height = `${height}px`;
        frame.style.left = `${Math.max(0, Math.round((vw - width) / 2))}px`;
        frame.style.top = `${Math.max(0, Math.round((vh - height) / 2))}px`;
      }
    } catch { /* noop */ }
    return frame;
  }

  async _onRender() {
    super._onRender?.(...arguments);
    const root = this.element instanceof HTMLElement
      ? this.element
      : (this.element?.[0] instanceof HTMLElement ? this.element[0] : document.getElementById(this.id));
    if (!root) return;
    const content = root.querySelector(".window-content") ?? root;
    this._contentRegion = content.querySelector(`[data-region="content"]`) ?? content;
    this._mounted = true;
    await this._load();
  }

  async _load() {
    this._setContent(`<div class="dauligor-character-creator__loading"><i class="fas fa-spinner fa-spin"></i> Loading class…</div>`);
    let resolved = null;
    try {
      const map = await resolveReferences([{ kind: "class", id: this._classIdentifier }]);
      resolved = map.get(`class:${this._classIdentifier}`);
    } catch (err) {
      log("class-detail: resolve failed", err);
    }
    if (!resolved) {
      this._setContent(`<div class="dauligor-character-creator__empty">Couldn't load “${esc(titleize(this._classIdentifier))}”. Log in to your Dauligor account, or check the class identifier.</div>`);
      return;
    }
    if (!resolved.sourceSlug) {
      this._setContent(`<div class="dauligor-character-creator__empty">No source is associated with “${esc(resolved.name || this._classIdentifier)}”.</div>`);
      return;
    }
    const host = resolveApiHost();
    const bundleUrl = `${host}/api/module/${encodeURIComponent(resolved.sourceSlug)}/classes/${encodeURIComponent(this._classIdentifier)}.json`;
    this._view.chosen = { name: resolved.name || titleize(this._classIdentifier), sourceSlug: resolved.sourceSlug, img: resolved.image || "", bundleUrl };
    this._paint(); // loading shell (bundle still null)

    const [bundle] = await Promise.all([
      fetchClassBundle(bundleUrl, this._bundleCache, this._bundleInFlight),
      ensureSpellChart(this._spellChartState),
    ]);
    if (!this._mounted) return;
    this._view.bundle = bundle;
    this._view.spellChart = this._spellChartState.spellChart;
    if (!bundle) {
      this._setContent(`<div class="dauligor-character-creator__empty">Couldn't load the class details for “${esc(this._view.chosen.name)}”.</div>`);
      return;
    }
    this._paint();
  }

  _paint() {
    if (!this._contentRegion) return;
    this._contentRegion.innerHTML = renderClassView(this._view);
    bindClassView(this._contentRegion, this._view, () => this._paint());
  }

  _setContent(html) {
    if (this._contentRegion) this._contentRegion.innerHTML = html;
  }

  async close(options) {
    this._mounted = false;
    if (DauligorClassDetailApp._instances.get(this._classIdentifier) === this) {
      DauligorClassDetailApp._instances.delete(this._classIdentifier);
    }
    return super.close(options);
  }
}

export async function openDauligorClassDetail(classIdentifier) {
  return DauligorClassDetailApp.open(classIdentifier);
}
