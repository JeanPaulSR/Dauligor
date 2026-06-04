// Foundry-side Character Creator walkthrough.
//
// A six-step guided flow that assembles a level-1 character:
//   1. Ability Scores   — Point Buy (32 / 8–16) or the shared roll pool
//   2. Background       — picked from /api/module/<source>/feats.json (featType "background")
//   3. Race             — picked from the same feed (featType "race")
//   4. Class            — picked from the per-source class catalog; applied
//                          by delegating to the existing class importer
//   5. Starting Items   — stubbed (no item-list endpoint yet)
//   6. Review & Finish  — per-step summary with Edit jumps, then apply
//
// Reuse, not reinvention:
//   • The class step hands off to `openDauligorImporter({ actor, sourceTypeIds,
//     selectedEntryIds, targetLevel: 1 })` so advancement / option / skill
//     choices run through the one tested path.
//   • Background + race embed exactly like the feat browser
//     (`createEmbeddedDocuments("Item", [full])` after a detail fetch).
//   • Ability scores + the shared roll pool live in ability-roll-pool.js.
//
// Output (per owner direction):
//   • Opened from an actor sheet  → applies onto that actor (assumed empty;
//                                    a Respec pass comes later).
//   • Opened from the Actor tab   → creates a fresh empty `character` actor.
//
// Like the rest of the module this is logic-/syntax-checked but needs a
// live-world eyeball — especially the cross-client roll pool (two
// connected clients exercise the GM relay).

import { CHARACTER_CREATOR_TEMPLATE, MODULE_ID, SETTINGS } from "./constants.js";
import { log, notifyInfo, notifyWarn } from "./utils.js";
import { openDauligorImporter } from "./importer-app.js";
import { getClassFeatureLabelsByLevel, fetchClassSpellList } from "./class-import-service.js";
import { baseClassHandler, formatFoundryLabel } from "./importer-base-features.js";
import {
  POINT_BUY,
  pointBuyCost,
  pointBuyRemaining,
  pointBuySpent,
  getRollPool,
  onRollPoolChanged,
  rollAbilitySet,
  submitRolledSet,
  addManualSet,
  removeSet,
  clearPool,
} from "./ability-roll-pool.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

// The two top-level tabs: the radial "Create" hub and the "Character" review.
const TABS = [
  { id: "create", label: "Create", icon: "fa-compass-drafting" },
  { id: "character", label: "Character", icon: "fa-clipboard-check" },
];

// Wheel wedges, clockwise from the top. The center button is Ability Scores
// (handled separately). "species" is the 2024 label over the existing race
// data/endpoints (featType "race"). feat + image are stubbed this pass.
const SECTIONS = [
  { id: "class", label: "Class", icon: "fa-shield-halved" },
  { id: "species", label: "Species", icon: "fa-dragon" },
  { id: "background", label: "Background", icon: "fa-scroll" },
  { id: "feat", label: "Starting Feat", icon: "fa-medal" },
  { id: "image", label: "Image", icon: "fa-image" },
];

const ABILITIES = [
  { key: "str", label: "Strength", abbr: "STR" },
  { key: "dex", label: "Dexterity", abbr: "DEX" },
  { key: "con", label: "Constitution", abbr: "CON" },
  { key: "int", label: "Intelligence", abbr: "INT" },
  { key: "wis", label: "Wisdom", abbr: "WIS" },
  { key: "cha", label: "Charisma", abbr: "CHA" },
];

// 5e proficiency bonus by character level (+2 at 1–4, +3 at 5–8, …).
const PB_BY_LEVEL = (lvl) => 2 + Math.floor((Math.max(1, Math.min(20, Number(lvl) || 1)) - 1) / 4);

function prettifySlug(s) {
  return String(s ?? "").replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

// Render BBCode/markdown-ish description text to safe paragraph HTML: strip
// [tags] and <tags>, collapse whitespace, split on blank lines into <p>s.
function bbToParagraphs(s) {
  const plain = String(s ?? "")
    .replace(/\[\/?[^\]]+\]/g, "")       // BBCode [b]…[/b]
    .replace(/<[^>]*>/g, "")              // stray HTML
    .replace(/\r/g, "");
  const blocks = plain.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  if (!blocks.length) return "";
  return blocks.map((b) => `<p>${escapeHtml(b).replace(/\n/g, "<br>")}</p>`).join("");
}

function ordinal(n) {
  const v = n % 100;
  const suffix = (v >= 11 && v <= 13) ? "th" : (["th", "st", "nd", "rd"][n % 10] || "th");
  return `${n}${suffix}`;
}

// Dependency-free port of src/lib/spellcasting.ts. `progressionFormula` is
// author-controlled DB content (e.g. "1 * level", "level / 2"), not user
// input — we still whitelist the charset + identifiers before evaluating, so
// this can't run arbitrary code.
function effectiveCastingLevel(level, formula) {
  if (!formula) return 0;
  const expr = String(formula).toLowerCase().replace(/ciel/g, "ceil").replace(/\blevel\b/g, String(Number(level) || 0));
  if (!/^[0-9+\-*/().,\s a-z]*$/.test(expr)) return 0;
  const idents = expr.match(/[a-z]+/g) || [];
  const ALLOWED = new Set(["floor", "ceil", "round", "min", "max", "abs"]);
  if (idents.some((id) => !ALLOWED.has(id))) return 0;
  try {
    const mathExpr = expr.replace(/\b(floor|ceil|round|min|max|abs)\b/g, "Math.$1");
    const v = Function(`"use strict"; return (${mathExpr});`)();
    return Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
  } catch {
    return 0;
  }
}

// Slot array (9 entries) for an effective caster level, from the master chart.
function slotsForEffectiveLevel(effLevel, masterTable) {
  if (!Array.isArray(masterTable) || effLevel <= 0) return [];
  const target = Math.min(20, Math.max(1, effLevel));
  const row = masterTable.find((r) => Number(r.level) === target);
  return row && Array.isArray(row.slots) ? row.slots : [];
}

// ── tiny helpers (mirrors feat-browser-app) ─────────────────────────────

function resolveApiHost() {
  try {
    const mode = game.settings.get(MODULE_ID, SETTINGS.apiEndpointMode) || "local";
    return mode === "production" ? "https://www.dauligor.com" : "http://localhost:3000";
  } catch {
    return "https://www.dauligor.com";
  }
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stripHtml(s) {
  return String(s ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function truncate(s, n = 220) {
  const t = stripHtml(s);
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
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

function freshChoices() {
  return {
    abilities: {
      method: "pointbuy", // "pointbuy" | "pool"
      pointBuy: ABILITIES.reduce((acc, a) => { acc[a.key] = POINT_BUY.min; return acc; }, {}),
      pool: { selectedSetId: null, assignment: ABILITIES.reduce((acc, a) => { acc[a.key] = null; return acc; }, {}) },
    },
    background: null, // { dbId, name, img }
    race: null,       // { dbId, name, img } — shown as "Species"
    class: null,      // { sourceSlug, entryId, name, img }
    feat: null,       // stubbed this pass
    image: null,      // stubbed this pass
  };
}

// ── Application ─────────────────────────────────────────────────────────

export class DauligorCharacterCreatorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static _instance = null;

  static async open({ actor = null } = {}) {
    if (this._instance) {
      this._instance._actor = actor ?? this._instance._actor;
      await this._instance.render({ force: true });
      this._instance.maximize?.();
      return this._instance;
    }
    const instance = new this({ actor });
    this._instance = instance;
    await instance.render({ force: true });
    return instance;
  }

  constructor({ actor = null } = {}) {
    // Standard Dauligor window model (see docs/styles-guide.md "Window model"):
    // numeric width/height + the dauligor-importer-app/-window content classes
    // (flex-column, overflow:hidden content box); the shell fills it via
    // height:100% + the min-height:0 chain and scrolls its body/picker
    // internally. `_renderFrame` stamps the centered numeric coords.
    const width = Math.min(window.innerWidth - 120, 1100);
    const height = Math.min(window.innerHeight - 120, 760);
    super({
      id: `${MODULE_ID}-character-creator`,
      classes: ["dauligor-importer-app", "dauligor-character-creator"],
      window: {
        title: actor ? `Create Character: ${actor.name}` : "Create Character",
        resizable: true,
        contentClasses: ["dauligor-importer-window"],
      },
      position: { width, height },
    });

    // Output mode: applying onto an existing actor vs. creating a new one.
    this._actor = actor ?? null;
    this._createNew = !actor;

    this._tab = "create";   // "create" (the wheel hub) | "character" (review)
    this._view = "hub";      // within Create: "hub" | a SECTIONS id | "abilities"
    this._choices = freshChoices();

    // Lazy-loaded data caches.
    // featFamily: { status, backgrounds[], races[], errors[] }
    this._featFamily = { status: "idle", backgrounds: [], races: [] };
    // classes: { status, entries[], errors[] }
    this._classes = { status: "idle", entries: [] };
    // Detail fetch caches keyed by dbId.
    this._bgDetailCache = new Map();
    this._raceDetailCache = new Map();
    // Full class-bundle cache for the rich class preview, keyed by bundle URL.
    this._classBundleCache = new Map();
    this._classBundleInFlight = new Set();
    // Master multiclass spell-slot chart (fetched once from the app), used to
    // derive the class preview's slot columns. Null = not loaded / unavailable
    // → the preview simply omits the slot columns.
    this._spellChart = null;
    this._spellChartFetched = false;
    // ClassView-style preview UI state (reset on each class pick).
    this._cvTab = "features";        // features | subclass | spells | info | flavor
    this._cvSubclassId = null;        // selected subclass sourceId
    this._cvExpanded = new Set();     // expanded feature keys
    this._cvSpells = new Map();       // bundleUrl → { status, spells } (class spell list)

    // Ephemeral per-step UI state.
    this._ui = {
      bgSearch: "",
      raceSearch: "",
      classSearch: "",
      manualRolls: "", // DM manual-entry textbox
      status: "",
      statusLevel: "",
      busy: false,
    };

    // Region handles.
    this._tabsRegion = null;
    this._bodyRegion = null;
    this._footerRegion = null;

    // Live-sync the roll pool across clients.
    this._unsubPool = null;
  }

  _configureRenderParts() {
    return { main: { template: CHARACTER_CREATOR_TEMPLATE } };
  }

  async _renderFrame(options) {
    const frame = await super._renderFrame(options);
    applyCenteredPositionToFrame(frame, this.position);
    return frame;
  }

  async close(options) {
    if (this._unsubPool) { this._unsubPool(); this._unsubPool = null; }
    if (DauligorCharacterCreatorApp._instance === this) DauligorCharacterCreatorApp._instance = null;
    return super.close(options);
  }

  async _onRender() {
    super._onRender?.(...arguments);

    const root = this.element instanceof HTMLElement
      ? this.element
      : (this.element?.[0] instanceof HTMLElement ? this.element[0] : document.getElementById(this.id));
    if (!root) return;

    const content = root.querySelector(".window-content") ?? root;
    this._tabsRegion = content.querySelector(`[data-region="tabs"]`);
    this._bodyRegion = content.querySelector(`[data-region="body"]`);
    this._footerRegion = content.querySelector(`[data-region="footer"]`);

    if (!this._unsubPool) {
      this._unsubPool = onRollPoolChanged(() => {
        // Only the Ability Scores section shows the pool; cheap to re-render it.
        if (this._tab === "create" && this._view === "abilities") this._renderBody();
      });
    }

    this._renderAll();
  }

  // ── tab / view plumbing ───────────────────────────────────────────────

  _setTab(tab) {
    if (tab === this._tab) return;
    this._tab = tab;
    this._ui.status = "";
    this._ui.statusLevel = "";
    this._renderAll();
  }

  // Open a wheel section (or the center "abilities") as a full panel.
  _openSection(id) {
    this._tab = "create";
    this._view = id;
    this._ui.status = "";
    this._ui.statusLevel = "";
    this._ensureSectionData(id);
    this._renderAll();
  }

  _backToHub() {
    this._view = "hub";
    this._renderAll();
  }

  _ensureSectionData(id) {
    // "species" rides the same feat-family feed as backgrounds (featType "race").
    if ((id === "background" || id === "species") && this._featFamily.status === "idle") {
      this._loadFeatFamily();
    }
    if (id === "class" && this._classes.status === "idle") {
      this._loadClasses();
    }
  }

  _renderAll() {
    this._renderTabs();
    this._renderBody();
    this._renderFooter();
  }

  // ── data loading ────────────────────────────────────────────────────

  // Returns [{ slug, sourceId }] — `slug` is the URL component
  // (e.g. "phb"); `sourceId` is the source's catalog id (e.g.
  // "source-phb-2014"), which is what the class importer keys on.
  async _loadSources() {
    if (Array.isArray(this._sourcesCache)) return this._sourcesCache;
    const host = resolveApiHost();
    try {
      const res = await fetch(`${host}/api/module/sources/catalog.json`, { cache: "no-store" });
      if (!res.ok) return [];
      const payload = await res.json();
      if (payload?.kind !== "dauligor.source-catalog.v1") return [];
      const sources = (Array.isArray(payload.entries) ? payload.entries : [])
        .map((e) => ({
          slug: String(e?.slug ?? "").toLowerCase(),
          sourceId: String(e?.sourceId ?? ""),
        }))
        .filter((s) => s.slug);
      this._sourcesCache = sources;
      return sources;
    } catch (err) {
      log("character-creator: source catalog fetch failed", err);
      return [];
    }
  }

  async _loadFeatFamily() {
    this._featFamily = { status: "loading", backgrounds: [], races: [] };
    if (this._tab === "create" && (this._view === "background" || this._view === "species")) this._renderBody();

    const sources = await this._loadSources();
    if (!sources.length) {
      this._featFamily = { status: "error", backgrounds: [], races: [], errors: ["No sources available."] };
      if (this._tab === "create" && (this._view === "background" || this._view === "species")) this._renderBody();
      return;
    }

    const host = resolveApiHost();
    const backgrounds = [];
    const races = [];
    const errors = [];

    await Promise.all(sources.map(async ({ slug }) => {
      const url = `${host}/api/module/${encodeURIComponent(slug)}/feats.json`;
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) { errors.push(`${slug}: HTTP ${res.status}`); return; }
        const payload = await res.json();
        if (payload?.kind !== "dauligor.source-feat-list.v1") return;
        for (const feat of (Array.isArray(payload.feats) ? payload.feats : [])) {
          const flags = feat?.flags?.[MODULE_ID] ?? {};
          const featType = String(flags.featType ?? "");
          const row = {
            dbId: String(flags.dbId ?? ""),
            name: String(feat?.name ?? ""),
            img: feat?.img ?? null,
            summary: String(flags.summary ?? flags.requirements ?? ""),
            sourceSlug: slug,
          };
          if (!row.dbId || !row.name) continue;
          if (featType === "background") backgrounds.push(row);
          else if (featType === "race") races.push(row);
        }
      } catch (err) {
        errors.push(`${slug}: ${err?.message ?? "fetch failed"}`);
      }
    }));

    const byName = (a, b) => a.name.localeCompare(b.name);
    backgrounds.sort(byName);
    races.sort(byName);
    this._featFamily = { status: "ready", backgrounds, races, errors };
    if (this._tab === "create" && (this._view === "background" || this._view === "species")) this._renderBody();
  }

  async _loadClasses() {
    this._classes = { status: "loading", entries: [] };
    if (this._tab === "create" && this._view === "class") this._renderBody();

    const sources = await this._loadSources();
    const host = resolveApiHost();
    const entries = [];
    const errors = [];

    await Promise.all(sources.map(async ({ slug, sourceId }) => {
      const url = `${host}/api/module/${encodeURIComponent(slug)}/classes/catalog.json`;
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) { errors.push(`${slug}: HTTP ${res.status}`); return; }
        const payload = await res.json();
        if (payload?.kind !== "dauligor.class-catalog.v1") return;
        for (const entry of (Array.isArray(payload.entries) ? payload.entries : [])) {
          // Class-catalog entries identify by `sourceId` (e.g.
          // "class-wizard"); that's also what the importer's class
          // selection matches against (preferredSelectionIds).
          if (entry?.type !== "class" || !entry?.sourceId) continue;
          let bundleUrl = null;
          try { if (entry.payloadUrl) bundleUrl = new URL(entry.payloadUrl, url).href; } catch { /* leave null */ }
          entries.push({
            entryId: String(entry.sourceId),
            name: String(entry.name ?? entry.sourceId),
            img: entry.img || null,
            summary: String(entry.description ?? entry.summary ?? ""),
            sourceSlug: slug,
            sourceId, // the SOURCE's id, for the importer's sourceTypeIds
            bundleUrl, // full semantic class-export bundle, for the rich preview
          });
        }
      } catch (err) {
        errors.push(`${slug}: ${err?.message ?? "fetch failed"}`);
      }
    }));

    entries.sort((a, b) => a.name.localeCompare(b.name));
    this._classes = { status: "ready", entries, errors };
    if (this._tab === "create" && this._view === "class") this._renderBody();
  }

  // Fetch a full background/race item for embed (and richer detail), cached.
  async _fetchDetail(kind, dbId) {
    if (!dbId) return null;
    const cache = kind === "background" ? this._bgDetailCache : this._raceDetailCache;
    if (cache.has(dbId)) return cache.get(dbId);
    const segment = kind === "background" ? "backgrounds" : "races";
    const expectKind = kind === "background" ? "dauligor.background-item.v1" : "dauligor.race-item.v1";
    const key = kind === "background" ? "background" : "race";
    const host = resolveApiHost();
    try {
      const res = await fetch(`${host}/api/module/${segment}/${encodeURIComponent(dbId)}.json`, { cache: "no-store" });
      if (!res.ok) return null;
      const payload = await res.json();
      if (payload?.kind !== expectKind) return null;
      const full = payload[key] ?? null;
      if (full) cache.set(dbId, full);
      return full;
    } catch (err) {
      log("character-creator: detail fetch failed", { kind, dbId, err });
      return null;
    }
  }

  // Fetch the full semantic class-export bundle for the rich preview, cached
  // by URL. The bundle has no `kind` wrapper — it's the object with top-level
  // `class`, `subclasses`, `features`, `scalingColumns`, `source`, etc.
  async _fetchClassBundle(url) {
    if (!url) return null;
    if (this._classBundleCache.has(url)) return this._classBundleCache.get(url);
    if (this._classBundleInFlight.has(url)) return null;
    this._classBundleInFlight.add(url);
    try {
      const res = await fetch(url, { cache: "no-store" });
      this._classBundleInFlight.delete(url);
      if (!res.ok) return null;
      const payload = await res.json();
      if (!payload?.class) return null;
      this._classBundleCache.set(url, payload);
      return payload;
    } catch (err) {
      this._classBundleInFlight.delete(url);
      log("character-creator: class bundle fetch failed", { url, err });
      return null;
    }
  }

  // Fetch the master multiclass spell-slot chart once (app endpoint). Stores
  // the `levels` array on the instance; null on any failure so the preview
  // degrades to no slot columns rather than erroring.
  async _ensureSpellChart() {
    if (this._spellChartFetched) return this._spellChart;
    this._spellChartFetched = true;
    try {
      const res = await fetch(`${resolveApiHost()}/api/module/spellcasting/multiclass-chart.json`, { cache: "no-store" });
      if (!res.ok) return null;
      const payload = await res.json();
      if (payload?.kind !== "dauligor.spellcasting-chart.v1") return null;
      this._spellChart = Array.isArray(payload.levels) ? payload.levels : null;
      return this._spellChart;
    } catch (err) {
      log("character-creator: spell chart fetch failed", err);
      return null;
    }
  }

  // ── ability-score resolution ──────────────────────────────────────────

  _resolveAbilityScores() {
    const a = this._choices.abilities;
    if (a.method === "pointbuy") {
      const scores = a.pointBuy;
      if (pointBuyRemaining(scores) < 0) return null;
      for (const { key } of ABILITIES) {
        if (pointBuyCost(scores[key]) == null) return null;
      }
      return { ...scores };
    }
    // pool
    const set = getRollPool().find((e) => e.id === a.pool.selectedSetId);
    if (!set) return null;
    const out = {};
    const used = new Set();
    for (const { key } of ABILITIES) {
      const idx = a.pool.assignment[key];
      if (idx == null || used.has(idx)) return null;
      used.add(idx);
      out[key] = Number(set.rolls[idx]);
    }
    return used.size === 6 ? out : null;
  }

  // ── rendering: tab bar ──────────────────────────────────────────────

  _renderTabs() {
    if (!this._tabsRegion) return;
    const items = TABS.map((t) => `
      <button type="button" class="dauligor-character-creator__tab ${t.id === this._tab ? "dauligor-character-creator__tab--active" : ""}" data-action="tab" data-tab="${t.id}">
        <i class="fas ${t.icon}"></i> ${escapeHtml(t.label)}
      </button>`).join("");
    this._tabsRegion.innerHTML = `<nav class="dauligor-character-creator__tabs">${items}</nav>`;
    this._tabsRegion.querySelectorAll(`[data-action="tab"]`).forEach((el) => {
      el.addEventListener("click", () => this._setTab(el.dataset.tab));
    });
  }

  _isSectionComplete(id) {
    switch (id) {
      case "abilities": return this._resolveAbilityScores() != null;
      case "class": return !!this._choices.class;
      case "species": return !!this._choices.race;
      case "background": return !!this._choices.background;
      case "feat": return !!this._choices.feat;
      case "image": return !!this._choices.image;
      default: return false;
    }
  }

  // Short label of the current choice for a section, shown inside its wedge.
  _sectionChoiceName(id) {
    switch (id) {
      case "class": return this._choices.class?.name ?? "";
      case "species": return this._choices.race?.name ?? "";
      case "background": return this._choices.background?.name ?? "";
      default: return "";
    }
  }

  // ── rendering: the radial hub (Create tab) ──────────────────────────
  //
  // An SVG donut: one annular-sector wedge per SECTIONS entry (clockwise
  // from the top), with a center button for Ability Scores. Wedges and the
  // center carry data-action="open-section"; clicking opens that section as
  // a full panel (replacing the wheel) with a Back-to-hub control.
  _renderHub() {
    const cx = 190, cy = 190, R = 180, r = 66;
    const n = SECTIONS.length;
    const sweep = 360 / n;
    const pt = (deg, rad) => {
      const t = (deg - 90) * Math.PI / 180;
      return [cx + rad * Math.cos(t), cy + rad * Math.sin(t)];
    };
    const wedges = SECTIONS.map((s, i) => {
      const a0 = i * sweep - sweep / 2;
      const a1 = a0 + sweep;
      const [x0o, y0o] = pt(a0, R), [x1o, y1o] = pt(a1, R), [x1i, y1i] = pt(a1, r), [x0i, y0i] = pt(a0, r);
      const large = sweep > 180 ? 1 : 0;
      const d = `M${x0o.toFixed(1)},${y0o.toFixed(1)} A${R},${R} 0 ${large} 1 ${x1o.toFixed(1)},${y1o.toFixed(1)} L${x1i.toFixed(1)},${y1i.toFixed(1)} A${r},${r} 0 ${large} 0 ${x0i.toFixed(1)},${y0i.toFixed(1)} Z`;
      const done = this._isSectionComplete(s.id);
      const [lx, ly] = pt((a0 + a1) / 2, (R + r) / 2);
      const choice = this._sectionChoiceName(s.id);
      return `
        <path class="dauligor-character-creator__wedge ${done ? "dauligor-character-creator__wedge--done" : ""}" d="${d}" data-action="open-section" data-section="${s.id}"></path>
        <text class="dauligor-character-creator__wedge-label" x="${lx.toFixed(1)}" y="${(ly - (choice ? 7 : 0)).toFixed(1)}" text-anchor="middle" dominant-baseline="middle">${escapeHtml(s.label)}</text>
        ${choice ? `<text class="dauligor-character-creator__wedge-choice" x="${lx.toFixed(1)}" y="${(ly + 9).toFixed(1)}" text-anchor="middle" dominant-baseline="middle">${escapeHtml(choice.length > 16 ? choice.slice(0, 15) + "…" : choice)}</text>` : ""}`;
    }).join("");
    const abilDone = this._resolveAbilityScores() != null;
    return `
      <div class="dauligor-character-creator__hub">
        <div class="dauligor-character-creator__wheel">
          <svg class="dauligor-character-creator__wheel-svg" viewBox="0 0 380 380" role="presentation">${wedges}</svg>
          <div role="button" tabindex="0" class="dauligor-character-creator__wheel-center ${abilDone ? "is-done" : ""}" data-action="open-section" data-section="abilities">
            <span class="dauligor-character-creator__wheel-center-title">Ability Scores</span>
            <span class="dauligor-character-creator__wheel-center-sub">${abilDone ? "✓ set" : "choose"}</span>
          </div>
        </div>
      </div>`;
  }

  // ── rendering: body ─────────────────────────────────────────────────

  _renderBody() {
    if (!this._bodyRegion) return;
    let html = "";
    if (this._tab === "character") {
      html = this._bodyReview();
    } else if (this._view === "hub") {
      html = this._renderHub();
    } else {
      html = this._renderSection(this._view);
    }
    this._bodyRegion.innerHTML = html;
    this._bindBody();
  }

  // A chosen wheel section, rendered as a full panel with a Back-to-hub bar.
  _renderSection(id) {
    const meta = {
      abilities: { title: "Ability Scores", body: () => this._bodyAbilities() },
      class: { title: "Class", body: () => this._bodyClass() },
      species: { title: "Species", body: () => this._bodyFeatFamily("race", "species") },
      background: { title: "Background", body: () => this._bodyFeatFamily("background", "background") },
      feat: { title: "Starting Feat", body: () => this._bodySectionStub("Starting Feat", "fa-medal", "Pick an origin / starting feat here. This section is being built next — we're settling the wheel layout first.") },
      image: { title: "Image", body: () => this._bodySectionStub("Image", "fa-image", "Set your character's portrait / token image here. This section is being built next.") },
    }[id] ?? { title: "", body: () => "" };
    return `
      <div class="dauligor-character-creator__section">
        <div class="dauligor-character-creator__section-head">
          <button type="button" class="dauligor-character-creator__button dauligor-character-creator__button--ghost" data-action="back-to-hub"><i class="fas fa-arrow-left"></i> Hub</button>
          <h3 class="dauligor-character-creator__section-title">${escapeHtml(meta.title)}</h3>
        </div>
        <div class="dauligor-character-creator__section-body">${meta.body()}</div>
      </div>`;
  }

  _bodySectionStub(title, icon, msg) {
    return `
      <div class="dauligor-character-creator__stub">
        <i class="fas ${escapeHtml(icon)}"></i>
        <h3>${escapeHtml(title)} — coming soon</h3>
        <p>${escapeHtml(msg)}</p>
      </div>`;
  }

  // ---- Step 1: abilities ----

  _bodyAbilities() {
    const a = this._choices.abilities;
    const tabs = `
      <div class="dauligor-character-creator__mode-tabs">
        <button type="button" class="dauligor-character-creator__mode-tab ${a.method === "pointbuy" ? "dauligor-character-creator__mode-tab--active" : ""}" data-action="ability-mode" data-mode="pointbuy">
          <i class="fas fa-calculator"></i> Point Buy
        </button>
        <button type="button" class="dauligor-character-creator__mode-tab ${a.method === "pool" ? "dauligor-character-creator__mode-tab--active" : ""}" data-action="ability-mode" data-mode="pool">
          <i class="fas fa-dice"></i> Roll Pool
        </button>
      </div>`;
    const panel = a.method === "pointbuy" ? this._renderPointBuy() : this._renderRollPool();
    return `<div class="dauligor-character-creator__abilities">${tabs}${panel}</div>`;
  }

  _renderPointBuy() {
    const scores = this._choices.abilities.pointBuy;
    const remaining = pointBuyRemaining(scores);
    const spent = pointBuySpent(scores);
    const over = remaining < 0;
    const rows = ABILITIES.map((ab) => {
      const v = scores[ab.key];
      const cost = pointBuyCost(v);
      return `
        <div class="dauligor-character-creator__ability-row">
          <span class="dauligor-character-creator__ability-label">${ab.abbr} <small>${escapeHtml(ab.label)}</small></span>
          <div class="dauligor-character-creator__spin-group">
            <button type="button" class="dauligor-character-creator__spin" data-action="pb-dec" data-key="${ab.key}" ${v <= POINT_BUY.min ? "disabled" : ""}>&minus;</button>
            <span class="dauligor-character-creator__ability-value">${v}</span>
            <button type="button" class="dauligor-character-creator__spin" data-action="pb-inc" data-key="${ab.key}" ${v >= POINT_BUY.max ? "disabled" : ""}>+</button>
          </div>
          <span class="dauligor-character-creator__ability-cost">${cost == null ? "—" : `${cost} pt`}</span>
        </div>`;
    }).join("");
    return `
      <div class="dauligor-character-creator__pointbuy">
        <div class="dauligor-character-creator__budget ${over ? "dauligor-character-creator__budget--over" : ""}">
          <span class="dauligor-character-creator__budget-num">${spent} / ${POINT_BUY.budget}</span>
          <span class="dauligor-character-creator__budget-label">points spent &middot; ${over ? `over by ${-remaining}` : `${remaining} left`}</span>
        </div>
        <div class="dauligor-character-creator__ability-grid">${rows}</div>
        <p class="dauligor-character-creator__hint">Each score is 8–16 before racial bonuses. Budget ${POINT_BUY.budget}; costs ramp +2 per step past 13 (14=7, 15=9, 16=11).</p>
      </div>`;
  }

  _renderRollPool() {
    const pool = getRollPool();
    const a = this._choices.abilities;
    const isGm = game.user?.isGM === true;
    const myRolled = pool.find((e) => e.source === "rolled" && e.userId === game.user?.id);

    const setCards = pool.length
      ? pool.map((set) => {
          const selected = a.pool.selectedSetId === set.id;
          const dice = set.rolls.map((n) => `<span class="dauligor-character-creator__die">${n}</span>`).join("");
          const canRemove = isGm || set.userId === game.user?.id;
          return `
            <div class="dauligor-character-creator__rollset ${selected ? "dauligor-character-creator__rollset--selected" : ""}" data-action="pick-set" data-set="${set.id}">
              <div class="dauligor-character-creator__rollset-head">
                <span class="dauligor-character-creator__rollset-owner">${escapeHtml(set.userName)}${set.source === "manual" ? " · manual" : ""}</span>
                <span class="dauligor-character-creator__rollset-total">${set.total}</span>
              </div>
              <div class="dauligor-character-creator__rollset-dice">${dice}</div>
              ${canRemove ? `<button type="button" class="dauligor-character-creator__rollset-remove" data-action="remove-set" data-set="${set.id}" title="Remove this set"><i class="fas fa-xmark"></i></button>` : ""}
            </div>`;
        }).join("")
      : `<p class="dauligor-character-creator__empty">The pool is empty. Roll a set below — everyone at the table can then pick from it.</p>`;

    const rollButton = `
      <button type="button" class="dauligor-character-creator__button dauligor-character-creator__button--primary" data-action="roll-set">
        <i class="fas fa-dice-d6"></i> ${myRolled ? "Re-roll my set" : "Roll my set (4d6 drop lowest)"}
      </button>`;

    const manual = isGm ? `
      <div class="dauligor-character-creator__manual">
        <label>DM: add a set manually <small>(six numbers, e.g. <code>15 14 13 12 10 8</code>)</small></label>
        <div class="dauligor-character-creator__manual-row">
          <input type="text" data-action="manual-input" value="${escapeHtml(this._ui.manualRolls)}" placeholder="15 14 13 12 10 8" />
          <button type="button" class="dauligor-character-creator__button" data-action="add-manual"><i class="fas fa-plus"></i> Add</button>
          ${pool.length ? `<button type="button" class="dauligor-character-creator__button dauligor-character-creator__button--ghost" data-action="clear-pool"><i class="fas fa-trash"></i> Clear pool</button>` : ""}
        </div>
      </div>` : "";

    const assign = a.pool.selectedSetId ? this._renderAssignment() : `<p class="dauligor-character-creator__hint">Pick a set above to assign its six values to your abilities.</p>`;

    return `
      <div class="dauligor-character-creator__rollpool">
        <div class="dauligor-character-creator__rollpool-controls">${rollButton}${manual}</div>
        <div class="dauligor-character-creator__rollpool-sets">${setCards}</div>
        <div class="dauligor-character-creator__rollpool-assign">${assign}</div>
      </div>`;
  }

  _renderAssignment() {
    const a = this._choices.abilities;
    const set = getRollPool().find((e) => e.id === a.pool.selectedSetId);
    if (!set) return "";
    const usedIdx = new Set(ABILITIES.map((ab) => a.pool.assignment[ab.key]).filter((v) => v != null));
    const rows = ABILITIES.map((ab) => {
      const chosen = a.pool.assignment[ab.key];
      const opts = [`<option value="">—</option>`].concat(set.rolls.map((val, idx) => {
        const disabled = usedIdx.has(idx) && chosen !== idx;
        const sel = chosen === idx ? "selected" : "";
        return `<option value="${idx}" ${disabled ? "disabled" : ""} ${sel}>${val}</option>`;
      })).join("");
      return `
        <div class="dauligor-character-creator__ability-row">
          <span class="dauligor-character-creator__ability-label">${ab.abbr} <small>${escapeHtml(ab.label)}</small></span>
          <select class="dauligor-character-creator__assign-select" data-action="assign" data-key="${ab.key}">${opts}</select>
        </div>`;
    }).join("");
    return `<div class="dauligor-character-creator__assign-grid"><h4>Assign rolls</h4>${rows}</div>`;
  }

  // ---- Steps 2 & 3: background / race ----

  _bodyFeatFamily(kind, displayNoun) {
    const data = this._featFamily;
    const list = kind === "background" ? data.backgrounds : data.races;
    const searchKey = kind === "background" ? "bgSearch" : "raceSearch";
    const chosen = kind === "background" ? this._choices.background : this._choices.race;
    // `kind` is the data/endpoint family ("background" | "race"); `displayNoun`
    // is the UI word ("species" for race, per 2024 terminology).
    const noun = displayNoun || (kind === "background" ? "background" : "species");

    if (data.status === "loading" || data.status === "idle") {
      return `<div class="dauligor-character-creator__loading"><i class="fas fa-spinner fa-spin"></i> Loading ${noun}s…</div>`;
    }
    if (data.status === "error" || !list.length) {
      return `<div class="dauligor-character-creator__empty">No ${noun}s available from the current sources.${chosen ? ` Currently chosen: <strong>${escapeHtml(chosen.name)}</strong>.` : ""}</div>`;
    }

    const q = (this._ui[searchKey] || "").toLowerCase();
    const filtered = q ? list.filter((r) => r.name.toLowerCase().includes(q)) : list;
    const rows = filtered.map((r) => {
      const sel = chosen?.dbId === r.dbId ? "dauligor-character-creator__row--selected" : "";
      const img = r.img
        ? `<img class="dauligor-character-creator__row-img" src="${escapeHtml(r.img)}" alt="" />`
        : `<span class="dauligor-character-creator__row-noimg"><i class="fas fa-circle"></i></span>`;
      return `
        <button type="button" class="dauligor-character-creator__row ${sel}" data-action="pick-feat" data-kind="${kind}" data-db="${escapeHtml(r.dbId)}">
          ${img}
          <span class="dauligor-character-creator__row-name">${escapeHtml(r.name)}</span>
        </button>`;
    }).join("");

    const detail = chosen
      ? this._renderFeatDetail(kind, chosen)
      : `<div class="dauligor-detail"><div class="dauligor-detail__pane dauligor-detail__empty">Select a ${noun} to preview it.</div></div>`;

    return `
      <div class="dauligor-character-creator__picker">
        <div class="dauligor-character-creator__picker-list-col">
          <input type="search" class="dauligor-character-creator__search" data-action="feat-search" data-kind="${kind}" placeholder="Search ${noun}s…" value="${escapeHtml(this._ui[searchKey])}" />
          <div class="dauligor-character-creator__picker-list">${rows || `<p class="dauligor-character-creator__empty">No matches.</p>`}</div>
        </div>
        <div class="dauligor-character-creator__picker-detail">${detail}</div>
      </div>`;
  }

  _renderFeatDetail(kind, chosen) {
    const cache = kind === "background" ? this._bgDetailCache : this._raceDetailCache;
    const full = cache.get(chosen.dbId);
    const hasImg = !!chosen.img;
    const desc = full
      ? truncate(full?.system?.description?.value ?? "", 900)
      : (chosen.summary ? truncate(chosen.summary, 900) : "Loading details…");
    const header = hasImg
      ? `<header class="dauligor-detail__header dauligor-detail__header--with-image">
           <img class="dauligor-detail__img" src="${escapeHtml(chosen.img)}" alt="" />
           <div>
             <h3 class="dauligor-detail__name">${escapeHtml(chosen.name)}</h3>
             <div class="dauligor-detail__meta">${kind === "background" ? "Background" : "Species"}</div>
           </div>
         </header>`
      : `<header class="dauligor-detail__header">
           <h3 class="dauligor-detail__name">${escapeHtml(chosen.name)}</h3>
           <div class="dauligor-detail__meta">${kind === "background" ? "Background" : "Species"}</div>
         </header>`;
    return `
      <div class="dauligor-detail">
        <div class="dauligor-detail__pane">
          ${header}
          <div class="dauligor-detail__body"><p>${escapeHtml(desc)}</p></div>
        </div>
      </div>`;
  }

  // ---- Step 4: class ----

  _bodyClass() {
    const data = this._classes;
    if (data.status === "loading" || data.status === "idle") {
      return `<div class="dauligor-character-creator__loading"><i class="fas fa-spinner fa-spin"></i> Loading classes…</div>`;
    }
    if (data.status === "error" || !data.entries.length) {
      return `<div class="dauligor-character-creator__empty">No classes available from the current sources.</div>`;
    }
    const chosen = this._choices.class;
    const q = (this._ui.classSearch || "").toLowerCase();
    const filtered = q ? data.entries.filter((e) => e.name.toLowerCase().includes(q)) : data.entries;
    const rows = filtered.map((e) => {
      const sel = chosen?.entryId === e.entryId && chosen?.sourceSlug === e.sourceSlug ? "dauligor-character-creator__row--selected" : "";
      const img = e.img
        ? `<img class="dauligor-character-creator__row-img" src="${escapeHtml(e.img)}" alt="" />`
        : `<span class="dauligor-character-creator__row-noimg"><i class="fas fa-shield-halved"></i></span>`;
      return `
        <button type="button" class="dauligor-character-creator__row ${sel}" data-action="pick-class" data-entry="${escapeHtml(e.entryId)}" data-source="${escapeHtml(e.sourceSlug)}">
          ${img}
          <span class="dauligor-character-creator__row-name">${escapeHtml(e.name)}</span>
          <span class="dauligor-character-creator__row-tag">${escapeHtml(e.sourceSlug.toUpperCase())}</span>
        </button>`;
    }).join("");

    const detail = chosen
      ? this._renderClassPreview(chosen, this._classBundleCache.get(chosen.bundleUrl) || null)
      : `<div class="dauligor-detail"><div class="dauligor-detail__pane dauligor-detail__empty">Select a class to preview it. Creation builds it at level 1.</div></div>`;

    return `
      <div class="dauligor-character-creator__picker">
        <div class="dauligor-character-creator__picker-list-col">
          <input type="search" class="dauligor-character-creator__search" data-action="class-search" placeholder="Search classes…" value="${escapeHtml(this._ui.classSearch)}" />
          <div class="dauligor-character-creator__picker-list">${rows || `<p class="dauligor-character-creator__empty">No matches.</p>`}</div>
        </div>
        <div class="dauligor-character-creator__picker-detail">${detail}</div>
      </div>`;
  }

  // Caster columns for the level table, in app-preview order: cantrips /
  // spells-known (from the bundle's spellsKnownScalings), pact slots (from
  // alternativeSpellcastingScalings), then the main spell-slot table for
  // full/half casters (master chart + the class's progressionFormula). Each
  // returned col is { header, value(level) }.
  _buildCasterColumns(bundle, sc = (bundle.class || {}).spellcasting || {}) {
    const cols = [];

    const sk = sc.spellsKnownSourceId ? bundle.spellsKnownScalings?.[sc.spellsKnownSourceId] : null;
    if (sk?.levels) {
      const lv = sk.levels;
      const anyCantrips = Object.values(lv).some((l) => Number(l?.cantrips ?? l?.cantripsKnown) > 0);
      const anySpells = Object.values(lv).some((l) => Number(l?.spellsKnown ?? l?.spells) > 0);
      if (anyCantrips) cols.push({ header: "Cantrips", value: (lvl) => lv[String(lvl)]?.cantrips ?? lv[String(lvl)]?.cantripsKnown ?? "—" });
      if (anySpells) cols.push({ header: "Spells Known", value: (lvl) => lv[String(lvl)]?.spellsKnown ?? lv[String(lvl)]?.spells ?? "—" });
    }

    const alt = sc.altProgressionSourceId ? bundle.alternativeSpellcastingScalings?.[sc.altProgressionSourceId] : null;
    if (alt?.levels) {
      const al = alt.levels;
      cols.push({ header: "Pact Slots", value: (lvl) => al[String(lvl)]?.slotCount ?? "—" });
      cols.push({ header: "Slot Lvl", value: (lvl) => { const sl = al[String(lvl)]?.slotLevel; return sl ? ordinal(Number(sl)) : "—"; } });
    }

    const progression = String(sc.progression || "").toLowerCase();
    const chart = this._spellChart;
    if ((sc.hasSpellcasting || sc.ability) && progression !== "pact" && sc.progressionFormula && Array.isArray(chart) && chart.length) {
      const slotsByLevel = {};
      let maxSpellLevel = 0;
      for (let lvl = 1; lvl <= 20; lvl += 1) {
        const slots = slotsForEffectiveLevel(effectiveCastingLevel(lvl, sc.progressionFormula), chart);
        slotsByLevel[lvl] = slots;
        for (let i = slots.length - 1; i >= 0; i -= 1) {
          if (Number(slots[i]) > 0) { if (i + 1 > maxSpellLevel) maxSpellLevel = i + 1; break; }
        }
      }
      for (let sl = 1; sl <= maxSpellLevel; sl += 1) {
        cols.push({ header: ordinal(sl), value: (lvl) => { const v = Number(slotsByLevel[lvl]?.[sl - 1]) || 0; return v > 0 ? v : "—"; } });
      }
    }
    return cols;
  }

  // The effective spellcasting for the table: the class's if it casts, else
  // the selected subclass's (e.g. Eldritch Knight / Arcane Trickster).
  _effectiveSpellcasting(c, selSub) {
    const cs = c.spellcasting || {};
    if (cs.hasSpellcasting || cs.ability) return cs;
    const ss = selSub?.spellcasting || {};
    if (ss.hasSpellcasting || ss.ability) return ss;
    return null;
  }

  // Features per level for the table: class features (from advancements, via
  // the importer service) + the selected subclass's features by level.
  _cvFeaturesByLevelMerged(bundle, selSub) {
    const byLevel = {};
    const base = getClassFeatureLabelsByLevel(bundle.class || {});
    for (const [lvl, names] of Object.entries(base)) byLevel[lvl] = [...names];
    if (selSub) {
      for (const f of (bundle.features || []).filter((x) => x.parentSourceId === selSub.sourceId)) {
        const lvl = String(Number(f.level) || 1);
        (byLevel[lvl] ||= []).push(f.name);
      }
    }
    for (const lvl of Object.keys(byLevel)) byLevel[lvl] = [...new Set(byLevel[lvl])];
    return byLevel;
  }

  // The class progression table (Level / PB / Features / scaling + caster
  // columns), with the selected subclass's features/scaling/spellcasting
  // merged in when one is chosen.
  _cvTable(bundle, selSub) {
    const c = bundle.class || {};
    const classSourceId = c.classSourceId ?? c.sourceId ?? null;
    const featsByLevel = this._cvFeaturesByLevelMerged(bundle, selSub);
    let scalings = (Array.isArray(bundle.scalingColumns) ? bundle.scalingColumns : [])
      .filter((col) => col.parentSourceId === classSourceId);
    if (selSub) {
      scalings = scalings.concat((bundle.scalingColumns || []).filter((col) => col.parentSourceId === selSub.sourceId));
    }
    const eff = this._effectiveSpellcasting(c, selSub);
    const casterCols = eff ? this._buildCasterColumns(bundle, eff) : [];
    const allCols = [
      ...scalings.map((col) => ({ header: col.name || prettifySlug(col.identifier), scaling: col })),
      ...casterCols,
    ];
    const headCols = allCols.map((col) => `<th>${escapeHtml(col.header)}</th>`).join("");
    const rows = Array.from({ length: 20 }, (_, i) => i + 1).map((lvl) => {
      const feats = featsByLevel[lvl] || [];
      const featCell = feats.length ? feats.map(escapeHtml).join(", ") : `<span class="dauligor-character-creator__cp-dash">—</span>`;
      const cells = allCols.map((col) => {
        let v;
        if (col.scaling) {
          v = "—";
          for (let l = lvl; l >= 1; l--) { const val = col.scaling.values?.[String(l)]; if (val != null && val !== "") { v = val; break; } }
        } else {
          v = col.value(lvl);
        }
        return `<td class="dauligor-character-creator__cp-num">${escapeHtml(String(v))}</td>`;
      }).join("");
      return `<tr><td class="dauligor-character-creator__cp-num">${lvl}</td><td class="dauligor-character-creator__cp-num">+${PB_BY_LEVEL(lvl)}</td><td class="dauligor-character-creator__cp-feats">${featCell}</td>${cells}</tr>`;
    }).join("");
    return `<div class="dauligor-character-creator__cp-table-wrap"><table class="dauligor-character-creator__cp-table"><thead><tr><th>Lvl</th><th>PB</th><th>Features</th>${headCols}</tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  // Core Traits sidebar — hit points + proficiencies (proficiencies reuse the
  // importer's baseClassHandler + formatFoundryLabel; no parallel parse).
  _cvCoreTraits(c) {
    const baseRows = baseClassHandler({ payload: { class: c } })?.advancements || [];
    const byId = Object.fromEntries(baseRows.map((r) => [r.id, r]));
    const profValue = (row) => {
      if (!row) return "";
      const cats = (row.categoryIds || []).map(formatFoundryLabel);
      if (row.choiceCount > 0) {
        const pool = cats.length ? cats : (row.options || []).map(formatFoundryLabel);
        return pool.length ? `Choose ${row.choiceCount}: ${pool.join(", ")}` : `Choose ${row.choiceCount}`;
      }
      const guaranteed = cats.length ? cats : (row.fixed || []).map(formatFoundryLabel);
      return guaranteed.join(", ");
    };
    const primary = (c.primaryAbility || []).map((a) => formatFoundryLabel(String(a)));
    const hd = Number(c.hitDie) || 8;
    const line = (label, value) => value
      ? `<div class="dauligor-character-creator__cp-prof"><span class="dauligor-character-creator__cp-prof-key">${escapeHtml(label)}</span><span>${escapeHtml(value)}</span></div>`
      : "";
    return `
      <div class="dauligor-character-creator__cp-side">
        <h4 class="dauligor-character-creator__cp-side-title">Core Traits</h4>
        ${line("Hit Die", `d${hd} per level`)}
        ${line("HP at 1st", `${hd} + CON`)}
        ${line("HP / Level", `${Math.floor(hd / 2) + 1} (avg) + CON`)}
        ${line("Saves", profValue(byId["base-saves"]))}
        ${line("Armor", profValue(byId["base-armor"]) || "None")}
        ${line("Weapons", profValue(byId["base-weapons"]) || "None")}
        ${line("Tools", profValue(byId["base-tools"]))}
        ${line("Skills", profValue(byId["base-skills"]))}
        ${primary.length ? line("Multiclass", `${primary.join(" or ")} 13+`) : ""}
      </div>`;
  }

  // One collapsible feature card (name + level + description on expand).
  _cvFeatureCard(f, isSub) {
    const key = String(f.sourceId || `${f.name}-${f.level}`);
    const expanded = this._cvExpanded.has(key);
    const body = expanded
      ? `<div class="dauligor-character-creator__cv-feature-body">${bbToParagraphs(f.description) || "<p><em>No description.</em></p>"}</div>`
      : "";
    return `
      <div class="dauligor-character-creator__cv-feature ${isSub ? "dauligor-character-creator__cv-feature--sub" : ""}">
        <button type="button" class="dauligor-character-creator__cv-feature-head" data-action="cv-feature-toggle" data-key="${escapeHtml(key)}">
          <span class="dauligor-character-creator__cv-feature-name">${isSub ? `<span class="dauligor-character-creator__cv-feature-badge">Subclass</span> ` : ""}${escapeHtml(f.name || "")}</span>
          <span class="dauligor-character-creator__cv-feature-lvl">Lvl ${Number(f.level) || 1} <i class="fas fa-chevron-${expanded ? "up" : "down"}"></i></span>
        </button>
        ${body}
      </div>`;
  }

  // Feature list for the Features / Subclass tabs.
  _cvFeatureList(bundle, selSub, onlySub = false) {
    const classFeats = onlySub ? [] : (bundle.features || []).filter((f) => f.featureKind === "classFeature");
    const subFeats = selSub ? (bundle.features || []).filter((f) => f.parentSourceId === selSub.sourceId) : [];
    const all = [
      ...classFeats.map((f) => ({ f, sub: false })),
      ...subFeats.map((f) => ({ f, sub: true })),
    ].sort((a, b) => (Number(a.f.level) || 0) - (Number(b.f.level) || 0));
    if (!all.length) {
      return onlySub
        ? `<div class="dauligor-character-creator__empty">No features authored for this subclass yet.</div>`
        : `<div class="dauligor-character-creator__empty">Feature details aren't authored for this class yet — the level table above lists the features by level.</div>`;
    }
    return `<div class="dauligor-character-creator__cv-features">${all.map(({ f, sub }) => this._cvFeatureCard(f, sub)).join("")}</div>`;
  }

  // Spell List tab — fetched lazily from the class spell-list endpoint.
  _cvFetchSpells(chosen) {
    if (!chosen?.bundleUrl || this._cvSpells.has(chosen.bundleUrl)) return;
    this._cvSpells.set(chosen.bundleUrl, { status: "loading", spells: [] });
    fetchClassSpellList(chosen.bundleUrl)
      .then((spells) => {
        this._cvSpells.set(chosen.bundleUrl, { status: "ready", spells: Array.isArray(spells) ? spells : [] });
        if (this._tab === "create" && this._view === "class" && this._cvTab === "spells" && this._choices.class?.bundleUrl === chosen.bundleUrl) {
          this._renderBody();
        }
      })
      .catch((err) => {
        log("character-creator: class spell list fetch failed", err);
        this._cvSpells.set(chosen.bundleUrl, { status: "error", spells: [] });
      });
  }

  _cvSpellsTab(chosen) {
    const entry = this._cvSpells.get(chosen.bundleUrl);
    if (!entry || entry.status === "loading") {
      this._cvFetchSpells(chosen);
      return `<div class="dauligor-character-creator__loading"><i class="fas fa-spinner fa-spin"></i> Loading spell list…</div>`;
    }
    if (entry.status === "error") return `<div class="dauligor-character-creator__empty">Could not load the spell list.</div>`;
    const spells = entry.spells || [];
    if (!spells.length) return `<div class="dauligor-character-creator__empty">No curated spell list for this class.</div>`;
    const byLevel = {};
    for (const sp of spells) {
      const f = sp.flags?.[MODULE_ID] ?? {};
      const lvl = Number(f.level ?? sp.system?.level ?? 0) || 0;
      (byLevel[lvl] ||= []).push(sp);
    }
    const levels = Object.keys(byLevel).map(Number).sort((a, b) => a - b);
    return `<div class="dauligor-character-creator__cv-spells">${levels.map((lvl) => {
      const list = byLevel[lvl].slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
      const heading = lvl === 0 ? "Cantrips" : `Level ${lvl}`;
      return `<div class="dauligor-character-creator__cv-spell-group">
        <div class="dauligor-character-creator__cv-spell-heading">${heading} <span>(${list.length})</span></div>
        <div class="dauligor-character-creator__cv-spell-rows">${list.map((sp) => `<span class="dauligor-character-creator__cv-spell">${escapeHtml(String(sp.name || ""))}</span>`).join("")}</div>
      </div>`;
    }).join("")}</div>`;
  }

  _cvHeader(chosen, c) {
    const sourceTag = escapeHtml((chosen.sourceSlug || "").toUpperCase());
    const img = c.previewImageUrl || c.imageUrl || c.cardImageUrl || chosen.img || "";
    const hitDie = c.hitDie ? `d${c.hitDie}` : "—";
    const isCaster = !!(c.spellcasting && (c.spellcasting.hasSpellcasting || c.spellcasting.ability));
    const ability = c.spellcasting?.ability ? formatFoundryLabel(String(c.spellcasting.ability)) : "";
    const tags = (c.tagIds || []).map(prettifySlug).filter(Boolean);
    const headerStyle = img
      ? ` style="background-image: linear-gradient(to top, var(--dauligor-panel) 35%, rgba(0,0,0,0.25)), url('${escapeHtml(img)}')"`
      : "";
    return `
      <header class="dauligor-character-creator__cp-header"${headerStyle}>
        <div class="dauligor-character-creator__cp-heading">
          <h3 class="dauligor-character-creator__cp-name">${escapeHtml(chosen.name)}</h3>
          <span class="dauligor-character-creator__cp-source">${sourceTag}</span>
        </div>
        <div class="dauligor-character-creator__cp-badges">
          <span class="dauligor-character-creator__cp-badge">Hit Die ${hitDie}</span>
          ${isCaster ? `<span class="dauligor-character-creator__cp-badge">Caster${ability ? ` · ${ability}` : ""}</span>` : ""}
        </div>
        ${tags.length ? `<div class="dauligor-character-creator__cp-tags">${tags.map((t) => `<span class="dauligor-character-creator__cp-tag">${escapeHtml(t)}</span>`).join("")}</div>` : ""}
      </header>`;
  }

  // Rich class view — a module-themed port of the web app's class VIEW page
  // (src/pages/compendium/ClassView.tsx): header + progression table + a
  // tabbed bottom (Features / Subclass / Spell List / Info / Flavor) with a
  // Core Traits sidebar and a subclass picker. Feature descriptions come from
  // the bundle's `features[]` where authored (degrades to the table otherwise).
  _renderClassPreview(chosen, bundle) {
    if (!bundle) {
      const sourceTag = escapeHtml((chosen.sourceSlug || "").toUpperCase());
      return `
        <div class="dauligor-detail">
          <div class="dauligor-detail__pane">
            <header class="dauligor-detail__header">
              <h3 class="dauligor-detail__name">${escapeHtml(chosen.name)}</h3>
              <div class="dauligor-detail__meta">Class · ${sourceTag}</div>
            </header>
            <div class="dauligor-detail__body"><p class="dauligor-character-creator__loading"><i class="fas fa-spinner fa-spin"></i> Loading class details…</p></div>
          </div>
        </div>`;
    }

    const c = bundle.class || {};
    const subclasses = Array.isArray(bundle.subclasses) ? bundle.subclasses : [];
    const selSub = subclasses.find((s) => s.sourceId === this._cvSubclassId) || null;
    const tab = this._cvTab || "features";

    const tabDefs = [
      { id: "features", label: "Features" },
      ...(selSub ? [{ id: "subclass", label: "Subclass" }] : []),
      { id: "spells", label: "Spell List" },
      { id: "info", label: "Info" },
      { id: "flavor", label: "Flavor" },
    ];
    const tabBtns = tabDefs.map((t) =>
      `<button type="button" class="dauligor-character-creator__cv-tab ${t.id === tab ? "dauligor-character-creator__cv-tab--active" : ""}" data-action="cv-tab" data-tab="${t.id}">${escapeHtml(t.label)}</button>`
    ).join("");

    const subPicker = subclasses.length
      ? `<select class="dauligor-character-creator__cv-subpicker" data-action="cv-subclass">
           <option value="">${escapeHtml(c.subclassTitle || "Subclass")}…</option>
           ${subclasses.map((s) => `<option value="${escapeHtml(s.sourceId)}" ${s.sourceId === this._cvSubclassId ? "selected" : ""}>${escapeHtml(s.name || "")}</option>`).join("")}
         </select>`
      : "";

    let content = "";
    if (tab === "features") {
      content = this._cvFeatureList(bundle, selSub);
    } else if (tab === "subclass") {
      content = selSub
        ? `${selSub.description ? `<div class="dauligor-character-creator__cv-prose">${bbToParagraphs(selSub.description)}</div>` : ""}${this._cvFeatureList(bundle, selSub, true)}`
        : `<div class="dauligor-character-creator__empty">Pick a subclass above to view its features.</div>`;
    } else if (tab === "spells") {
      content = this._cvSpellsTab(chosen);
    } else if (tab === "info") {
      const desc = c.description ? `<h4 class="dauligor-character-creator__cp-side-title">Class Description</h4><div class="dauligor-character-creator__cv-prose">${bbToParagraphs(c.description)}</div>` : "";
      const lore = c.lore ? `<h4 class="dauligor-character-creator__cp-side-title">Class Lore</h4><div class="dauligor-character-creator__cv-prose">${bbToParagraphs(c.lore)}</div>` : "";
      content = (desc || lore) ? `${desc}${lore}` : `<div class="dauligor-character-creator__empty">No description or lore written yet.</div>`;
    } else if (tab === "flavor") {
      content = `<div class="dauligor-character-creator__empty">Flavor &amp; roleplaying guidance — coming soon.</div>`;
    }

    const showSidebar = tab !== "spells";
    return `
      <div class="dauligor-character-creator__cv">
        ${this._cvHeader(chosen, c)}
        ${this._cvTable(bundle, selSub)}
        <div class="dauligor-character-creator__cv-tabsrow">
          <div class="dauligor-character-creator__cv-tabs">${tabBtns}</div>
          ${subPicker}
        </div>
        <div class="dauligor-character-creator__cv-bottom ${showSidebar ? "" : "dauligor-character-creator__cv-bottom--full"}">
          <div class="dauligor-character-creator__cv-content">${content}</div>
          ${showSidebar ? `<aside class="dauligor-character-creator__cv-sidecol">${this._cvCoreTraits(c)}</aside>` : ""}
        </div>
        <p class="dauligor-character-creator__hint">On <strong>Build Character</strong>, the class builder opens pre-set to <strong>${escapeHtml(chosen.name)}</strong> at level 1 for skill / option / feature choices.</p>
      </div>`;
  }

  // ---- Character tab: review ----

  _bodyReview() {
    const scores = this._resolveAbilityScores();
    const abilityLine = scores
      ? ABILITIES.map((ab) => `<span class="dauligor-character-creator__scorepill">${ab.abbr} ${scores[ab.key]}</span>`).join("")
      : `<em class="dauligor-character-creator__warn">Not finished — open Ability Scores.</em>`;

    // `section` is a wheel section id (or "abilities") so Edit jumps straight
    // to it on the Create tab.
    const card = (section, title, value, ok) => `
      <div class="dauligor-character-creator__review-card ${ok ? "dauligor-character-creator__review-card--ok" : "dauligor-character-creator__review-card--missing"}">
        <div class="dauligor-character-creator__review-head">
          <span>${escapeHtml(title)}</span>
          <button type="button" class="dauligor-character-creator__editlink" data-action="edit-section" data-section="${section}"><i class="fas fa-pen"></i> Edit</button>
        </div>
        <div class="dauligor-character-creator__review-body">${value}</div>
      </div>`;

    const target = this._actor
      ? `Applies onto existing actor <strong>${escapeHtml(this._actor.name)}</strong>.`
      : `Creates a new empty character actor.`;

    return `
      <div class="dauligor-character-creator__review">
        <p class="dauligor-character-creator__review-target"><i class="fas fa-user-plus"></i> ${target}</p>
        ${card("abilities", "Ability Scores", `<div class="dauligor-character-creator__scorepills">${abilityLine}</div>`, !!scores)}
        ${card("class", "Class", this._choices.class ? `<strong>${escapeHtml(this._choices.class.name)}</strong> <small>(${escapeHtml(this._choices.class.sourceSlug.toUpperCase())}, level 1)</small>` : `<em class="dauligor-character-creator__warn">None chosen</em>`, !!this._choices.class)}
        ${card("species", "Species", this._choices.race ? `<strong>${escapeHtml(this._choices.race.name)}</strong>` : `<em>None chosen (optional)</em>`, !!this._choices.race)}
        ${card("background", "Background", this._choices.background ? `<strong>${escapeHtml(this._choices.background.name)}</strong>` : `<em>None chosen (optional)</em>`, !!this._choices.background)}
        ${card("feat", "Starting Feat", `<em>Coming soon.</em>`, false)}
        ${card("image", "Image", `<em>Coming soon.</em>`, false)}
        <p class="dauligor-character-creator__hint"><strong>Build Character</strong> writes ability scores, embeds the species &amp; background, then opens the class builder at level 1 to complete the class.</p>
      </div>`;
  }

  // ── body event binding ──────────────────────────────────────────────

  _bindBody() {
    const root = this._bodyRegion;
    if (!root) return;

    const on = (sel, evt, fn) => root.querySelectorAll(sel).forEach((el) => el.addEventListener(evt, fn));

    // wheel: open a section (wedge or center button); review: edit-jump; back.
    on(`[data-action="open-section"]`, "click", (e) => this._openSection(e.currentTarget.dataset.section));
    on(`[data-action="open-section"]`, "keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this._openSection(e.currentTarget.dataset.section); }
    });
    on(`[data-action="back-to-hub"]`, "click", () => this._backToHub());
    on(`[data-action="edit-section"]`, "click", (e) => this._openSection(e.currentTarget.dataset.section));

    // abilities — mode toggle
    on(`[data-action="ability-mode"]`, "click", (e) => {
      this._choices.abilities.method = e.currentTarget.dataset.mode === "pool" ? "pool" : "pointbuy";
      this._renderAll();
    });
    // point buy +/-
    on(`[data-action="pb-inc"]`, "click", (e) => this._adjustPointBuy(e.currentTarget.dataset.key, +1));
    on(`[data-action="pb-dec"]`, "click", (e) => this._adjustPointBuy(e.currentTarget.dataset.key, -1));
    // roll pool
    on(`[data-action="roll-set"]`, "click", () => this._handleRoll());
    on(`[data-action="pick-set"]`, "click", (e) => {
      // ignore clicks on the remove button inside the card
      if (e.target.closest(`[data-action="remove-set"]`)) return;
      this._choices.abilities.pool.selectedSetId = e.currentTarget.dataset.set;
      // reset assignment when switching sets
      for (const ab of ABILITIES) this._choices.abilities.pool.assignment[ab.key] = null;
      this._renderBody();
      this._renderFooter();
    });
    on(`[data-action="remove-set"]`, "click", async (e) => {
      e.stopPropagation();
      await removeSet(e.currentTarget.dataset.set);
    });
    on(`[data-action="assign"]`, "change", (e) => {
      const key = e.currentTarget.dataset.key;
      const raw = e.currentTarget.value;
      this._choices.abilities.pool.assignment[key] = raw === "" ? null : Number(raw);
      this._renderBody();
      this._renderFooter();
    });
    on(`[data-action="manual-input"]`, "input", (e) => { this._ui.manualRolls = e.currentTarget.value; });
    on(`[data-action="add-manual"]`, "click", () => this._handleManualAdd());
    on(`[data-action="clear-pool"]`, "click", async () => { await clearPool(); });

    // background / race
    on(`[data-action="feat-search"]`, "input", (e) => {
      const k = e.currentTarget.dataset.kind === "background" ? "bgSearch" : "raceSearch";
      this._ui[k] = e.currentTarget.value;
      this._renderBody();
    });
    on(`[data-action="pick-feat"]`, "click", (e) => this._pickFeat(e.currentTarget.dataset.kind, e.currentTarget.dataset.db));

    // class
    on(`[data-action="class-search"]`, "input", (e) => { this._ui.classSearch = e.currentTarget.value; this._renderBody(); });
    on(`[data-action="pick-class"]`, "click", (e) => this._pickClass(e.currentTarget.dataset.entry, e.currentTarget.dataset.source));

    // class view: tabs, subclass picker, collapsible feature cards
    on(`[data-action="cv-tab"]`, "click", (e) => { this._cvTab = e.currentTarget.dataset.tab; this._renderBody(); });
    on(`[data-action="cv-subclass"]`, "change", (e) => {
      this._cvSubclassId = e.currentTarget.value || null;
      // If we left the Subclass tab's context, fall back to Features.
      if (!this._cvSubclassId && this._cvTab === "subclass") this._cvTab = "features";
      this._renderBody();
    });
    on(`[data-action="cv-feature-toggle"]`, "click", (e) => {
      const key = e.currentTarget.dataset.key;
      if (this._cvExpanded.has(key)) this._cvExpanded.delete(key); else this._cvExpanded.add(key);
      this._renderBody();
    });
  }

  _adjustPointBuy(key, delta) {
    const scores = this._choices.abilities.pointBuy;
    const next = (scores[key] ?? POINT_BUY.min) + delta;
    if (next < POINT_BUY.min || next > POINT_BUY.max) return;
    // Block increments that would push us over budget.
    if (delta > 0) {
      const trial = { ...scores, [key]: next };
      if (pointBuyRemaining(trial) < 0) {
        notifyWarn("Not enough points remaining.");
        return;
      }
    }
    scores[key] = next;
    this._renderBody();
    this._renderFooter();
  }

  async _handleRoll() {
    if (this._ui.busy) return;
    this._ui.busy = true;
    try {
      const rolls = await rollAbilitySet();
      await submitRolledSet(rolls);
      notifyInfo(`Rolled ${rolls.join(", ")} (total ${rolls.reduce((a, b) => a + b, 0)}).`);
    } catch (err) {
      log("character-creator: roll failed", err);
      notifyWarn("The roll failed — see console.");
    } finally {
      this._ui.busy = false;
    }
    // Re-render comes via the pool-changed hook, but refresh defensively.
    if (this._tab === "create" && this._view === "abilities") this._renderBody();
  }

  async _handleManualAdd() {
    const parts = String(this._ui.manualRolls).trim().split(/[\s,]+/).map((n) => Number(n)).filter((n) => Number.isFinite(n));
    if (parts.length !== 6) {
      notifyWarn("Enter exactly six numbers (e.g. 15 14 13 12 10 8).");
      return;
    }
    await addManualSet(parts);
    this._ui.manualRolls = "";
    if (this._tab === "create" && this._view === "abilities") this._renderBody();
  }

  async _pickFeat(kind, dbId) {
    const data = this._featFamily;
    const list = kind === "background" ? data.backgrounds : data.races;
    const row = list.find((r) => r.dbId === dbId);
    if (!row) return;
    const choice = { dbId: row.dbId, name: row.name, img: row.img };
    if (kind === "background") this._choices.background = choice;
    else this._choices.race = choice;
    this._renderBody();
    this._renderFooter();
    // Lazy-fetch detail for the preview pane (and to warm the embed cache).
    const full = await this._fetchDetail(kind, dbId);
    if (full && this._tab === "create" && (this._view === "background" || this._view === "species")) this._renderBody();
  }

  _pickClass(entryId, sourceSlug) {
    const entry = this._classes.entries.find((e) => e.entryId === entryId && e.sourceSlug === sourceSlug);
    if (!entry) return;
    this._choices.class = {
      entryId: entry.entryId, sourceSlug: entry.sourceSlug, sourceId: entry.sourceId,
      name: entry.name, img: entry.img, summary: entry.summary, bundleUrl: entry.bundleUrl,
    };
    // Reset the ClassView-style preview state for the new class.
    this._cvTab = "features";
    this._cvSubclassId = null;
    this._cvExpanded = new Set();
    this._renderBody();
    this._renderFooter();
    // Lazy-load the full bundle + the spell chart for the rich preview;
    // re-render when each lands.
    const reRenderIfCurrent = () => {
      if (this._tab === "create" && this._view === "class" && this._choices.class?.bundleUrl === entry.bundleUrl) {
        this._renderBody();
      }
    };
    if (entry.bundleUrl) this._fetchClassBundle(entry.bundleUrl).then((b) => { if (b) reRenderIfCurrent(); });
    this._ensureSpellChart().then((chart) => { if (chart) reRenderIfCurrent(); });
  }

  // ── rendering: footer ────────────────────────────────────────────────

  _renderFooter() {
    if (!this._footerRegion) return;
    const status = this._ui.status
      ? `<span class="dauligor-character-creator__status dauligor-character-creator__status--${this._ui.statusLevel || "info"}">${escapeHtml(this._ui.status)}</span>`
      : `<span class="dauligor-character-creator__status"></span>`;

    // One terminal action, available from either tab. Required bits
    // (abilities + class) are validated in _finish, which jumps to the
    // offending section if something's missing.
    const build = `<button type="button" class="dauligor-character-creator__button dauligor-character-creator__button--primary" data-action="build" ${this._ui.busy ? "disabled" : ""}><i class="fas fa-wand-magic-sparkles"></i> Build Character</button>`;

    this._footerRegion.innerHTML = `${status}<div class="dauligor-character-creator__footer-actions">${build}</div>`;
    this._footerRegion.querySelector(`[data-action="build"]`)?.addEventListener("click", () => this._finish());
  }

  _setStatus(msg, level = "info") {
    this._ui.status = msg;
    this._ui.statusLevel = level;
    this._renderFooter();
  }

  // ── finish / apply ──────────────────────────────────────────────────

  async _finish() {
    if (this._ui.busy) return;

    const scores = this._resolveAbilityScores();
    if (!scores) {
      this._setStatus("Ability scores aren't finished — open Ability Scores.", "danger");
      this._openSection("abilities");
      return;
    }
    if (!this._choices.class) {
      this._setStatus("Pick a class before building.", "danger");
      this._openSection("class");
      return;
    }

    // Confirm if recommended sections are skipped.
    const missing = [];
    if (!this._choices.background) missing.push("background");
    if (!this._choices.race) missing.push("species");
    if (missing.length) {
      const proceed = await foundry.applications.api.DialogV2.confirm({
        window: { title: "Finish without all steps?" },
        content: `<p>No ${missing.join(" or ")} chosen. You can add ${missing.length > 1 ? "them" : "it"} later. Build the character anyway?</p>`,
        rejectClose: false,
        modal: true,
      });
      if (!proceed) return;
    }

    this._ui.busy = true;
    this._setStatus("Building character…", "info");

    try {
      // 1. Resolve / create the target actor.
      const actor = await this._resolveActor();
      if (!actor) {
        this._ui.busy = false;
        this._setStatus("Could not create or find a target actor.", "danger");
        return;
      }

      // 2. Ability scores.
      const update = {};
      for (const { key } of ABILITIES) update[`system.abilities.${key}.value`] = scores[key];
      await actor.update(update);

      // 3. Background + race items.
      if (this._choices.background) await this._embedFamilyItem(actor, "background", this._choices.background.dbId);
      if (this._choices.race) await this._embedFamilyItem(actor, "race", this._choices.race.dbId);

      // 4. Class — delegate to the existing importer, scoped + level 1.
      this._setStatus("Opening the class builder…", "success");
      const cls = this._choices.class;
      await openDauligorImporter({
        actor,
        importTypeId: "classes-subclasses",
        sourceTypeIds: [cls.sourceId], // the SOURCE's catalog id, what the importer keys on
        selectedEntryIds: [cls.entryId], // the class entry's sourceId
        targetLevel: 1,
      });

      // Open the sheet so the player lands on their new character, then
      // close the creator. The class importer is now the foreground.
      actor.sheet?.render(true);
      notifyInfo(`Character "${actor.name}" created — finish your class choices in the builder.`);
      await this.close();
    } catch (err) {
      log("character-creator: finish failed", err);
      this._ui.busy = false;
      this._setStatus(`Build failed: ${err?.message ?? "unknown error"}`, "danger");
    }
  }

  async _resolveActor() {
    if (this._actor) return this._actor;
    const allowed = game.user?.isGM
      || (typeof game.user?.hasPermission === "function" ? game.user.hasPermission("ACTOR_CREATE") : true);
    if (!allowed) {
      notifyWarn("You don't have permission to create actors. Ask your GM, or open the creator from an existing character.");
      return null;
    }
    const actor = await Actor.create({ name: "New Character", type: "character" });
    this._actor = actor;
    return actor;
  }

  async _embedFamilyItem(actor, kind, dbId) {
    const full = await this._fetchDetail(kind, dbId);
    if (!full) {
      notifyWarn(`Could not fetch the ${kind} item; skipping it.`);
      return;
    }
    const itemData = foundry.utils.deepClone(full);
    delete itemData._id;
    delete itemData._stats;
    // Replace any prior item of the same Foundry type + Dauligor sourceId.
    const sourceId = itemData?.flags?.[MODULE_ID]?.sourceId ?? null;
    const existing = Array.from(actor.items ?? []).find((it) => {
      if (sourceId && it.getFlag(MODULE_ID, "sourceId") === sourceId) return true;
      return it.name === itemData.name && it.type === itemData.type;
    });
    if (existing) await actor.updateEmbeddedDocuments("Item", [{ _id: existing.id, ...itemData }]);
    else await actor.createEmbeddedDocuments("Item", [itemData]);
  }
}

export async function openDauligorCharacterCreator(options = {}) {
  const app = await DauligorCharacterCreatorApp.open(options);
  log("Opened Dauligor character creator", options);
  return app;
}
