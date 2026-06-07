// Foundry-side Character Creator walkthrough.
//
// A six-step guided flow that assembles a level-1 character:
//   1. Ability Scores   — Point Buy (32 / 8–16) or the shared roll pool
//   2. Background       — picked from /api/module/<source>/backgrounds.json
//                          (dauligor.background-catalog.v1)
//   3. Race / Species   — picked from /api/module/<source>/species.json
//                          (dauligor.species-catalog.v1)
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
import { getClassFeatureLabelsByLevel, fetchClassSpellList, normalizeHtmlBlock } from "./class-import-service.js";
import { renderClassView, fetchClassSpells } from "./class-detail-view.js";
import { baseClassHandler, formatFoundryLabel } from "./importer-base-features.js";
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

// Top-level tabs. "Create" is the radial wheel hub (center = Ability Scores;
// it carries the Build Character action). Each wheel option then gets its own
// tab so it's reachable directly, and "Character" is the review.
const TABS = [
  { id: "create", label: "Create", icon: "fa-compass-drafting" },
  { id: "class", label: "Class", icon: "fa-shield-halved" },
  { id: "species", label: "Species", icon: "fa-dragon" },
  { id: "background", label: "Background", icon: "fa-scroll" },
  { id: "feat", label: "Starting Feat", icon: "fa-medal" },
  { id: "image", label: "Image", icon: "fa-image" },
  { id: "character", label: "Character", icon: "fa-clipboard-check" },
];

// Wheel wedges, clockwise from the top. The center button is Ability Scores
// (handled separately). "species" is the 2024 label over the existing race
// data (its own species.json catalog + /races/<id> detail). Image is stubbed.
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

// Render a stored description (HTML, BBCode, or markdown) to display HTML for
// the preview. Reuses the class importer's `normalizeHtmlBlock` for the format
// transform — we don't re-implement BBCode/markdown — then resolves cross-
// reference tokens to their REAL names via `formatFoundryLabel` (the importer's
// label resolver, not slug title-casing), with an explicit {display} taking
// precedence. Finally drops anything executable + a leading <hr> / duplicated
// "Prerequisite: …" line (feat cruft; the prerequisite is surfaced separately).
function renderDescription(src) {
  let s = normalizeHtmlBlock(src);
  if (!s) return "";
  // Defensive: strip anything executable that slipped into stored HTML.
  s = s
    .replace(/<(script|style|iframe|object|embed)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<(script|style|iframe|object|embed)\b[^>]*\/?>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*("javascript:[^"]*"|'javascript:[^']*')/gi, '$1="#"');
  // Cross-references → real display names. The '&' arrives escaped as '&amp;'.
  // dnd5e `&Reference[type=key]` first, then the generic `@kind[id]{display}` /
  // `&kind[id]` form; an explicit {display} wins, else resolve the key/id.
  s = s
    .replace(/&amp;Reference\[([a-z][a-z0-9_-]*)(?:=([a-z0-9_-]+))?[^\]]*\](?:\{([^}]*)\})?/gi,
      (_m, type, key, label) => `<span class="dauligor-character-creator__rt-ref">${label || formatFoundryLabel(key || type)}</span>`)
    .replace(/(?:@|&amp;)([a-z][a-z0-9-]*)\[([^\]\s]*)\](?:#[\w-]+)?(?:\{([^}]*)\})?/gi,
      (_m, kind, id, disp) => `<span class="dauligor-character-creator__rt-ref">${(disp != null && disp !== "") ? disp : formatFoundryLabel(String(id).replace(new RegExp(`^${kind}-`, "i"), "") || kind)}</span>`);
  s = s.replace(/^\s*<hr\s*\/?>\s*/i, "");
  s = s.replace(/^\s*<p>(?:(?!<\/p>)[\s\S]){0,80}?prerequisite[\s\S]*?<\/p>\s*/i, "");
  return s.trim();
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

// fetch() with a few retries on transient failures (5xx / 429 / network error).
// The creator talks to the LIVE site, so a cold-started Cloudflare Pages
// Function can briefly 503 — and its 503 error page drops the CORS headers, so
// the browser then reports a misleading "blocked by CORS policy" error when the
// real cause is the 503. One or two retries clears it. Returns a Response in all
// non-throwing cases (success, a non-retryable 4xx, or the last response after
// exhausting retries); throws only on a network error that never resolved.
// Always no-store, like every fetch in this file.
async function fetchWithRetry(url, { retries = 2, backoffMs = 350 } = {}) {
  let lastRes = null;
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok || (res.status < 500 && res.status !== 429)) return res;
      lastRes = res;
      lastErr = null;
    } catch (err) {
      lastErr = err;
      lastRes = null;
    }
    if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, backoffMs * (attempt + 1)));
  }
  if (lastRes) return lastRes;
  throw lastErr ?? new Error("fetch failed");
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

// Fresh ephemeral UI state for the class tag-filter (the shared section-filter
// panel ported from the import wizard).
function freshFilterUi() {
  return {
    hiddenAxes: new Set(),
    expandedParents: new Map(),
    allSubtagAxes: new Set(),
    altLabelAxes: new Set(),
    chipSearch: "",
  };
}

// One tag-filter state per picker scope (class / background / species / feat).
function freshFilterState() {
  return {
    open: false,
    tagStates: {},
    groupCombineModes: {},
    groupExclusionModes: {},
    ui: freshFilterUi(),
    snapshot: null,
  };
}

// Synthetic filter "tags" injected into entries so the shared tri-state tag
// matcher can also drive non-tag axes: a Source axis (every entry carries its
// `__src__:<slug>`) and a feat Properties axis. They flow through the exact same
// pipeline as real tags — no parallel matcher needed.
const SOURCE_TAG_PREFIX = "__src__:";
const PROP_TAG_PREFIX = "__prop__:";
// Feat Properties axis — mirrors src/lib/featFilters.ts. `flag` is the feat flag
// (flags.dauligor-pairing.<flag>); `id` is the synthetic tag id added on load.
const FEAT_PROPERTY_AXIS = [
  { id: `${PROP_TAG_PREFIX}repeatable`, label: "Repeatable", flag: "repeatable" },
  { id: `${PROP_TAG_PREFIX}hasUses`, label: "Limited Uses", flag: "hasUses" },
  { id: `${PROP_TAG_PREFIX}hasActivities`, label: "Activities", flag: "hasActivities" },
  { id: `${PROP_TAG_PREFIX}hasEffects`, label: "Effects", flag: "hasEffects" },
  { id: `${PROP_TAG_PREFIX}hasAdvancements`, label: "Advancements", flag: "hasAdvancements" },
  { id: `${PROP_TAG_PREFIX}hasPrereqs`, label: "Prerequisites", flag: "hasPrereqs" },
];

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

    // Lazy-loaded data caches. Each family loads independently (only the opened
    // tab's family is fetched), so { backgrounds|races|feats: { status, items[] } }.
    this._featFamily = {
      backgrounds: { status: "idle", items: [] },
      races: { status: "idle", items: [] },
      feats: { status: "idle", items: [] },
      tagIndex: {},
    };
    // classes: { status, entries[], errors[] }
    this._classes = { status: "idle", entries: [] };
    // Detail fetch caches keyed by dbId.
    this._bgDetailCache = new Map();
    this._raceDetailCache = new Map();
    this._featDetailCache = new Map();
    // dbIds whose detail fetch failed (after retries) — drives a recoverable
    // "couldn't load, click again" message instead of a stuck "Loading…".
    this._detailErrors = new Set();
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
    // The class being previewed in the Class tab while browsing, before it's
    // committed via "Select Class". Same shape as _choices.class (or null).
    this._classPreview = null;
    // Browsing previews for the option-list pickers (background / species /
    // feat), committed via their Select button. Keyed by kind; same shape as the
    // matching _choices entry, or null.
    this._featPreview = { background: null, race: null, feat: null };
    // Structural key of the last body render — scopes scroll-position
    // preservation to same-view re-renders (so clicks don't jump to top).
    this._lastBodyKey = null;

    // Tag filters — the shared section-filter panel from the import wizard,
    // applied to the class / background / species / feat pickers. One filter
    // state per scope; the `_classFilter` getter returns the active tab's so the
    // whole filter machinery below stays generic. `tagStates` is the flat
    // tagId→state record (1 include / 2 exclude); group combine/exclude mirror it.
    this._tagIndex = {};            // tagId → display name, merged from class catalogs
    this._tagCatalog = null;        // { tagsById, tagGroups, tagsByGroup } | null
    this._tagCatalogInFlight = false;
    this._filters = {
      class: freshFilterState(),
      background: freshFilterState(),
      species: freshFilterState(),
      feat: freshFilterState(),
    };

    // Ephemeral per-step UI state.
    this._ui = {
      bgSearch: "",
      raceSearch: "",
      featSearch: "",
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
    const entering = tab !== this._tab;
    this._tab = tab;
    if (tab === "create" && entering) this._view = "hub";
    this._ui.status = "";
    this._ui.statusLevel = "";
    // Entering the Class tab: seed the preview from the committed choice on
    // first entry (and reset the ClassView sub-state); otherwise keep whatever
    // the user was browsing so a tab switch doesn't lose it. Either way, warm
    // the previewed class's bundle + chart (cached, so usually instant).
    if (tab === "class" && entering) {
      if (!this._classPreview) {
        this._classPreview = this._choices.class ? { ...this._choices.class } : null;
        this._cvTab = "features";
        this._cvSubclassId = null;
        this._cvExpanded = new Set();
      }
      if (this._classPreview?.bundleUrl) {
        this._fetchClassBundle(this._classPreview.bundleUrl).then((b) => { if (b && this._tab === "class") this._renderBody(); });
        this._ensureSpellChart().then((chart) => { if (chart && this._tab === "class") this._renderBody(); });
      }
    }
    // Entering an option-list tab (background / species / feat): seed its preview
    // from the committed choice on first entry, and warm that detail so the
    // preview pane + Select button are ready. Mirrors the Class tab.
    const fam = { background: "background", species: "race", feat: "feat" }[tab];
    if (fam && entering) {
      if (!this._featPreview[fam]) this._featPreview[fam] = this._choices[fam] ? { ...this._choices[fam] } : null;
      const pv = this._featPreview[fam];
      if (pv?.dbId) this._fetchDetail(fam, pv.dbId).then(() => { if (this._tab === tab) this._renderBody(); });
    }
    this._ensureSectionData(tab);
    this._renderAll();
  }

  // Wheel center → Ability Scores (a sub-view of the Create tab); wheel wedges
  // and review Edit-jumps → that option's own top tab.
  _openSection(id) {
    if (id === "abilities") {
      this._tab = "create";
      this._view = "abilities";
      this._ui.status = "";
      this._ui.statusLevel = "";
      this._renderAll();
      return;
    }
    this._setTab(id);
  }

  _backToHub() {
    this._tab = "create";
    this._view = "hub";
    this._renderAll();
  }

  _ensureSectionData(id) {
    // background / species / feat each load their OWN family pool on demand —
    // only the opened tab's family is fetched (see _loadFamily), so opening
    // Background doesn't also pull species + feats (~3x fewer first-open fetches).
    const family = { background: "backgrounds", species: "races", feat: "feats" }[id];
    if (family && this._featFamily[family].status === "idle") {
      this._loadFamily(family);
    }
    if (family) this._ensureTagCatalog(); // grouped tag axes for the family's filter
    if (id === "class") {
      if (this._classes.status === "idle") this._loadClasses();
      this._ensureTagCatalog();
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
      const res = await fetchWithRetry(`${host}/api/module/sources/catalog.json`);
      if (!res.ok) return [];
      const payload = await res.json();
      if (payload?.kind !== "dauligor.source-catalog.v1") return [];
      const all = (Array.isArray(payload.entries) ? payload.entries : [])
        .map((e) => ({
          slug: String(e?.slug ?? "").toLowerCase(),
          sourceId: String(e?.sourceId ?? ""),
        }))
        .filter((s) => s.slug);
      // Scope to the campaign's enabled sources (GM-configured via the Campaign
      // Sources picker — Dauligor Tools in module settings). Empty setting = all
      // sources. This mirrors how the import wizard's spell/feat browsers load
      // only the selected sources — far fewer list fetches + lighter detail load
      // than blasting all ~48. Scopes families AND classes (both use this).
      const enabled = (() => {
        try { return new Set((game.settings.get(MODULE_ID, SETTINGS.enabledSources) || []).map(String)); }
        catch { return new Set(); }
      })();
      const sources = enabled.size ? all.filter((s) => enabled.has(s.slug)) : all;
      this._sourcesCache = sources;
      return sources;
    } catch (err) {
      log("character-creator: source catalog fetch failed", err);
      return [];
    }
  }

  // Loads ONE list-picker family (backgrounds | races | feats) across all
  // sources, lazily — only the family whose tab the user opened, so opening
  // Background doesn't also pull species + feats. Backgrounds and species come
  // from their own per-source LIST catalogs (`/<source>/backgrounds.json` →
  // dauligor.background-catalog.v1, `/<source>/species.json` →
  // dauligor.species-catalog.v1) whose entries already match our row shape
  // ({dbId,name,img,summary,tags}); feats come from the per-source feat list
  // (`/<source>/feats.json`, now feats-only), filtered to featType:"feat".
  // (bg/species used to ride feats.json by featType; that ended when they were
  // promoted to their own tables — see the bg/species list-endpoints handoff.)
  async _loadFamily(family) {
    const SPEC = {
      backgrounds: { file: "backgrounds.json", expectKind: "dauligor.background-catalog.v1", mode: "catalog" },
      races: { file: "species.json", expectKind: "dauligor.species-catalog.v1", mode: "catalog" },
      feats: { file: "feats.json", expectKind: "dauligor.source-feat-list.v1", mode: "feats" },
    }[family];
    if (!SPEC) return;
    const fam = this._featFamily[family];
    fam.status = "loading";
    if (this._isFamilyTab()) this._renderBody();

    const sources = await this._loadSources();
    if (!sources.length) {
      fam.status = "error";
      fam.items = [];
      fam.errors = ["No sources available."];
      if (this._isFamilyTab()) this._renderBody();
      return;
    }

    const host = resolveApiHost();
    const items = [];
    const errors = [];
    const mergeTagIndex = (idx) => {
      if (idx && typeof idx === "object") {
        for (const [id, name] of Object.entries(idx)) if (name) this._featFamily.tagIndex[id] = String(name);
      }
    };

    await Promise.all(sources.map(async ({ slug }) => {
      const url = `${host}/api/module/${encodeURIComponent(slug)}/${SPEC.file}`;
      try {
        const res = await fetchWithRetry(url);
        if (!res.ok) { errors.push(`${slug}/${SPEC.file}: HTTP ${res.status}`); return; }
        const payload = await res.json();
        if (payload?.kind !== SPEC.expectKind) return;
        if (SPEC.mode === "catalog") {
          // Lightweight catalog entries — already {dbId,name,img,summary,tags};
          // the full item is fetched on select.
          for (const e of (Array.isArray(payload.entries) ? payload.entries : [])) {
            const dbId = String(e?.dbId ?? "");
            const name = String(e?.name ?? "");
            if (!dbId || !name) continue;
            const tags = Array.isArray(e?.tags) ? e.tags.map(String) : [];
            tags.push(`${SOURCE_TAG_PREFIX}${slug}`); // synthetic Source axis
            items.push({
              dbId,
              name,
              img: e?.img || null,
              summary: String(e?.summary ?? ""),
              tags,
              sourceSlug: slug,
            });
          }
          mergeTagIndex(payload.tagIndex);
        } else {
          // feats.json is now feats-only — keep just featType:"feat".
          for (const feat of (Array.isArray(payload.feats) ? payload.feats : [])) {
            const flags = feat?.flags?.[MODULE_ID] ?? {};
            if (String(flags.featType ?? "") !== "feat") continue;
            const dbId = String(flags.dbId ?? "");
            const name = String(feat?.name ?? "");
            if (!dbId || !name) continue;
            const tags = Array.isArray(flags.tagIds) ? flags.tagIds.map(String) : [];
            tags.push(`${SOURCE_TAG_PREFIX}${slug}`); // synthetic Source axis
            for (const p of FEAT_PROPERTY_AXIS) if (flags[p.flag]) tags.push(p.id); // Properties axis
            items.push({
              dbId,
              name,
              img: feat?.img ?? null,
              summary: String(flags.summary ?? flags.requirements ?? ""),
              tags,
              sourceSlug: slug,
            });
          }
        }
      } catch (err) {
        errors.push(`${slug}/${SPEC.file}: ${err?.message ?? "fetch failed"}`);
      }
    }));

    items.sort((a, b) => a.name.localeCompare(b.name));
    fam.status = "ready";
    fam.items = items;
    fam.errors = errors;
    if (this._isFamilyTab()) this._renderBody();
  }

  _isFamilyTab() {
    return this._tab === "background" || this._tab === "species" || this._tab === "feat";
  }

  // The family pool object ({ status, items[] }) backing a picker kind.
  _familyFor(kind) {
    return kind === "background" ? this._featFamily.backgrounds
      : kind === "race" ? this._featFamily.races
      : this._featFamily.feats;
  }

  async _loadClasses() {
    this._classes = { status: "loading", entries: [] };
    this._tagIndex = {};
    if (this._tab === "class") this._renderBody();

    const sources = await this._loadSources();
    const host = resolveApiHost();
    const entries = [];
    const errors = [];

    await Promise.all(sources.map(async ({ slug, sourceId }) => {
      const url = `${host}/api/module/${encodeURIComponent(slug)}/classes/catalog.json`;
      try {
        const res = await fetchWithRetry(url);
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
            // Core / Alternate / New grouping (mirrors the website's class
            // list). Empty until the catalog ships `category`; the picker then
            // falls back to a flat list.
            category: entry.category ? String(entry.category).toLowerCase() : "",
            // Tag ids (+ synthetic Source tag) — drive the section-filter pills.
            tags: [...(Array.isArray(entry.tags) ? entry.tags.map(String) : []), `${SOURCE_TAG_PREFIX}${slug}`],
          });
        }
        // Merge this catalog's resolved tag id→name map (for the filter pills).
        if (payload.tagIndex && typeof payload.tagIndex === "object") {
          for (const [id, name] of Object.entries(payload.tagIndex)) {
            if (name) this._tagIndex[id] = String(name);
          }
        }
      } catch (err) {
        errors.push(`${slug}: ${err?.message ?? "fetch failed"}`);
      }
    }));

    entries.sort((a, b) => a.name.localeCompare(b.name));
    this._classes = { status: "ready", entries, errors };
    if (this._tab === "class") this._renderBody();
  }

  // Fetch a full background/race item for embed (and richer detail), cached.
  async _fetchDetail(kind, dbId) {
    if (!dbId) return null;
    const META = {
      background: { cache: this._bgDetailCache, segment: "backgrounds", expectKind: "dauligor.background-item.v1", key: "background" },
      race: { cache: this._raceDetailCache, segment: "races", expectKind: "dauligor.race-item.v1", key: "race" },
      feat: { cache: this._featDetailCache, segment: "feats", expectKind: "dauligor.feat-item.v1", key: "feat" },
    }[kind];
    if (!META) return null;
    const { cache, segment, expectKind, key } = META;
    if (cache.has(dbId)) return cache.get(dbId);
    const host = resolveApiHost();
    try {
      const res = await fetchWithRetry(`${host}/api/module/${segment}/${encodeURIComponent(dbId)}.json`);
      if (!res.ok) { this._detailErrors.add(dbId); return null; }
      const payload = await res.json();
      if (payload?.kind !== expectKind) { this._detailErrors.add(dbId); return null; }
      const full = payload[key] ?? null;
      if (full) { cache.set(dbId, full); this._detailErrors.delete(dbId); }
      return full;
    } catch (err) {
      log("character-creator: detail fetch failed", { kind, dbId, err });
      this._detailErrors.add(dbId);
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
    // NB: the action is "cc-tab", NOT "tab". "tab" is a RESERVED ApplicationV2
    // action — its built-in dispatcher calls changeTab(tab, group) and throws
    // ("You must pass both the tab and tab group identifier") because our tabs
    // aren't a Foundry tab group. We drive switching ourselves via _setTab.
    const items = TABS.map((t) => `
      <button type="button" class="dauligor-character-creator__tab ${t.id === this._tab ? "dauligor-character-creator__tab--active" : ""}" data-action="cc-tab" data-tab="${t.id}">
        <i class="fas ${t.icon}"></i> ${escapeHtml(t.label)}
      </button>`).join("");
    this._tabsRegion.innerHTML = `<nav class="dauligor-character-creator__tabs">${items}</nav>`;
    this._tabsRegion.querySelectorAll(`[data-action="cc-tab"]`).forEach((el) => {
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
      case "feat": return this._choices.feat?.name ?? "";
      default: return "";
    }
  }

  // Image of the current choice for a section, if any — used to paint the
  // selected wedge's background with the chosen class/species/background art.
  _sectionChoiceImg(id) {
    switch (id) {
      case "class": return this._choices.class?.img || "";
      case "species": return this._choices.race?.img || "";
      case "background": return this._choices.background?.img || "";
      default: return "";
    }
  }

  // The class view's stored image framing ({x,y,scale} = object-position % +
  // zoom) for the selected class, read from its cached bundle so the wedge art
  // is framed exactly like the class view page. Null → default centering.
  _sectionChoiceImgDisplay(id) {
    if (id !== "class") return null;
    const url = this._choices.class?.bundleUrl;
    const disp = url ? this._classBundleCache.get(url)?.class?.imageDisplay : null;
    return (disp && Number.isFinite(disp.x) && Number.isFinite(disp.y)) ? disp : null;
  }

  // ── rendering: the radial hub (Create tab) ──────────────────────────
  //
  // An SVG donut: one annular-sector wedge per SECTIONS entry (clockwise
  // from the top), with a center button for Ability Scores. Wedges and the
  // center carry data-action="open-section"; clicking opens that section as
  // a full panel (replacing the wheel) with a Back-to-hub control. A wedge
  // whose choice has an image (e.g. a selected class) paints that art as its
  // background via a per-wedge SVG pattern + a dark veil for label legibility.
  _renderHub() {
    const cx = 190, cy = 190, R = 180, r = 66;
    const n = SECTIONS.length;
    const sweep = 360 / n;
    const pt = (deg, rad) => {
      const t = (deg - 90) * Math.PI / 180;
      return [cx + rad * Math.cos(t), cy + rad * Math.sin(t)];
    };
    // Bounding box of a wedge, sampled along both arcs, so the image pattern
    // can cover (slice) the wedge region rather than the whole wheel.
    const wedgeBox = (a0, a1) => {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let k = 0; k <= 12; k += 1) {
        const a = a0 + (a1 - a0) * (k / 12);
        for (const rad of [r, R]) {
          const [x, y] = pt(a, rad);
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    };

    const defs = [];
    let usesVeil = false;
    const wedges = SECTIONS.map((s, i) => {
      const a0 = i * sweep - sweep / 2;
      const a1 = a0 + sweep;
      const [x0o, y0o] = pt(a0, R), [x1o, y1o] = pt(a1, R), [x1i, y1i] = pt(a1, r), [x0i, y0i] = pt(a0, r);
      const large = sweep > 180 ? 1 : 0;
      const d = `M${x0o.toFixed(1)},${y0o.toFixed(1)} A${R},${R} 0 ${large} 1 ${x1o.toFixed(1)},${y1o.toFixed(1)} L${x1i.toFixed(1)},${y1i.toFixed(1)} A${r},${r} 0 ${large} 0 ${x0i.toFixed(1)},${y0i.toFixed(1)} Z`;
      const done = this._isSectionComplete(s.id);
      const [lx, ly] = pt((a0 + a1) / 2, (R + r) / 2);
      const choice = this._sectionChoiceName(s.id);
      const img = this._sectionChoiceImg(s.id);

      let shape;
      if (img) {
        const bb = wedgeBox(a0, a1);
        const cid = `ccw-clip-${s.id}`;
        // Frame the art exactly like the class view page: an HTML <img> with
        // object-fit:cover + object-position + zoom (its stored display),
        // embedded via <foreignObject> and clipped to the wedge. The clip + the
        // veil fill use inline `style` so Foundry's stylesheet can't override
        // them (a plain `fill`/attribute loses to a `path {…}` rule).
        const disp = this._sectionChoiceImgDisplay(s.id) || { x: 50, y: 50, scale: 1 };
        const op = `${disp.x}% ${disp.y}%`;
        const scale = Number(disp.scale) || 1;
        const imgStyle = `object-position: ${op};${scale !== 1 ? ` transform: scale(${scale}); transform-origin: ${op};` : ""}`;
        defs.push(`<clipPath id="${cid}"><path d="${d}"></path></clipPath>`);
        usesVeil = true;
        shape = `
        <foreignObject x="${bb.x.toFixed(1)}" y="${bb.y.toFixed(1)}" width="${bb.w.toFixed(1)}" height="${bb.h.toFixed(1)}" style="clip-path: url(#${cid})">
          <div xmlns="http://www.w3.org/1999/xhtml" class="dauligor-character-creator__wedge-imgbox"><img src="${escapeHtml(img)}" alt="" class="dauligor-character-creator__wedge-img" style="${imgStyle}" /></div>
        </foreignObject>
        <path class="dauligor-character-creator__wedge-veil" d="${d}" style="fill: url(#ccw-veil)" data-action="open-section" data-section="${s.id}"></path>`;
      } else {
        shape = `<path class="dauligor-character-creator__wedge ${done ? "dauligor-character-creator__wedge--done" : ""}" d="${d}" data-action="open-section" data-section="${s.id}"></path>`;
      }
      const onImg = img ? " dauligor-character-creator__wedge-text--on-img" : "";
      return `
        ${shape}
        <text class="dauligor-character-creator__wedge-label${onImg}" x="${lx.toFixed(1)}" y="${(ly - (choice ? 7 : 0)).toFixed(1)}" text-anchor="middle" dominant-baseline="middle">${escapeHtml(s.label)}</text>
        ${choice ? `<text class="dauligor-character-creator__wedge-choice${onImg}" x="${lx.toFixed(1)}" y="${(ly + 9).toFixed(1)}" text-anchor="middle" dominant-baseline="middle">${escapeHtml(choice.length > 16 ? choice.slice(0, 15) + "…" : choice)}</text>` : ""}`;
    }).join("");
    // Shared radial veil: art bright at the rim, fading dark toward the center
    // (mirrors the preview header's gradient) — keeps the wedge label legible.
    if (usesVeil) {
      defs.unshift('<radialGradient id="ccw-veil" gradientUnits="userSpaceOnUse" cx="190" cy="190" r="180"><stop offset="0.34" stop-color="#000" stop-opacity="0.72"></stop><stop offset="1" stop-color="#000" stop-opacity="0.12"></stop></radialGradient>');
    }
    const abilDone = this._resolveAbilityScores() != null;
    return `
      <div class="dauligor-character-creator__hub">
        <div class="dauligor-character-creator__wheel">
          <svg class="dauligor-character-creator__wheel-svg" viewBox="0 0 380 380" role="presentation">${defs.length ? `<defs>${defs.join("")}</defs>` : ""}${wedges}</svg>
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
    const key = this._bodyKey();
    const sameView = key === this._lastBodyKey;
    const snap = sameView ? this._captureScroll() : null;

    let html = "";
    if (this._tab === "character") {
      html = this._bodyReview();
    } else if (this._tab === "create") {
      html = this._view === "abilities" ? this._renderAbilitiesPanel() : this._renderHub();
    } else {
      html = this._renderSection(this._tab);
    }
    this._bodyRegion.innerHTML = html;
    this._bindBody();

    if (snap) this._restoreScroll(snap);
    this._lastBodyKey = key;
  }

  // Structural identity of the current body view. Scroll preservation only
  // runs when this is unchanged across a re-render, so switching tabs starts
  // fresh while in-place updates (cv-tab clicks, feature toggles, picking a
  // row) keep the scroll position.
  _bodyKey() {
    return this._tab === "create" ? `create:${this._view}` : this._tab;
  }

  // Snapshot the body region's scroll + every descendant marked with a
  // data-scroll-id (the picker list/detail, the class table, etc.).
  _captureScroll() {
    const snap = { top: this._bodyRegion.scrollTop, left: this._bodyRegion.scrollLeft, ids: {} };
    this._bodyRegion.querySelectorAll("[data-scroll-id]").forEach((el) => {
      snap.ids[el.getAttribute("data-scroll-id")] = { top: el.scrollTop, left: el.scrollLeft };
    });
    // The filter panel's scrollable body has no data-scroll-id (it's shared
    // component markup); preserve it by class so pill clicks don't jump it.
    const fb = this._bodyRegion.querySelector(".dauligor-section-filter__body");
    if (fb) snap.filterBody = fb.scrollTop;
    return snap;
  }

  // Re-apply a snapshot after innerHTML was replaced. Containers whose
  // data-scroll-id changed (e.g. the class detail keys on the previewed
  // class) won't match and so reset to the top — intentional for a new class.
  _restoreScroll(snap) {
    this._bodyRegion.scrollTop = snap.top;
    this._bodyRegion.scrollLeft = snap.left;
    this._bodyRegion.querySelectorAll("[data-scroll-id]").forEach((el) => {
      const pos = snap.ids[el.getAttribute("data-scroll-id")];
      if (pos) { el.scrollTop = pos.top; el.scrollLeft = pos.left; }
    });
    if (snap.filterBody != null) {
      const fb = this._bodyRegion.querySelector(".dauligor-section-filter__body");
      if (fb) fb.scrollTop = snap.filterBody;
    }
  }

  // A top-tab option's body. Each option is its own tab now, so the tab bar is
  // the navigation — these render their picker/stub directly (the picker fills
  // the height and scrolls its own columns).
  _renderSection(id) {
    switch (id) {
      case "class": return this._bodyClass();
      case "species": return this._bodyFeatFamily("race", "species");
      case "background": return this._bodyFeatFamily("background", "background");
      case "feat": return this._bodyFeatFamily("feat", "feat");
      case "image": return this._bodySectionStub("Image", "fa-image", "Set your character's portrait / token image here. This section is being built next.");
      default: return "";
    }
  }

  // Ability Scores is the wheel's center, so it stays a sub-view of the Create
  // tab — a panel with a back-to-wheel control rather than its own tab.
  _renderAbilitiesPanel() {
    return `
      <div class="dauligor-character-creator__section">
        <div class="dauligor-character-creator__section-head">
          <button type="button" class="dauligor-character-creator__button dauligor-character-creator__button--ghost" data-action="back-to-hub"><i class="fas fa-arrow-left"></i> Wheel</button>
          <h3 class="dauligor-character-creator__section-title">Ability Scores</h3>
        </div>
        <div class="dauligor-character-creator__section-body" data-scroll-id="abilities-body">${this._bodyAbilities()}</div>
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
    const fam = this._familyFor(kind);
    const list = fam.items;
    const searchKey = kind === "background" ? "bgSearch" : kind === "race" ? "raceSearch" : "featSearch";
    const chosen = this._featPreview[kind] || this._choices[kind];
    // `kind` is the data/endpoint family ("background" | "race" | "feat");
    // `displayNoun` is the UI word ("species" for race, per 2024 terminology).
    const noun = displayNoun || (kind === "background" ? "background" : kind === "race" ? "species" : "feat");

    if (fam.status === "loading" || fam.status === "idle") {
      return `<div class="dauligor-character-creator__loading"><i class="fas fa-spinner fa-spin"></i> Loading ${noun}s…</div>`;
    }
    if (fam.status === "error" || !list.length) {
      return `<div class="dauligor-character-creator__empty">No ${noun}s available from the current sources.${chosen ? ` Currently chosen: <strong>${escapeHtml(chosen.name)}</strong>.` : ""}</div>`;
    }

    const base = this._filterClassEntries(list);
    const q = (this._ui[searchKey] || "").toLowerCase();
    const filtered = q ? base.filter((r) => r.name.toLowerCase().includes(q)) : base;
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

    const activeFilters = Object.keys(this._classFilter?.tagStates || {}).length;
    // Only surface the Filter when there's actually an axis to show (Source needs
    // >1 source; Properties is feat-only; real tags may be absent). Avoids an
    // empty filter modal that reads as broken.
    const hasTags = this._buildClassFilterAxes().length > 0;
    const filterBtn = hasTags
      ? `<button type="button" class="dauligor-character-creator__filter-btn ${this._classFilter?.open ? "dauligor-character-creator__filter-btn--active" : ""}" data-action="class-filter"><i class="fas fa-filter"></i> Filter${activeFilters ? ` <span class="dauligor-character-creator__filter-count">${activeFilters}</span>` : ""}</button>`
      : "";
    return `
      <div class="dauligor-character-creator__picker">
        <div class="dauligor-character-creator__picker-list-col">
          <div class="dauligor-character-creator__list-toolbar">
            ${filterBtn}
            <input type="search" class="dauligor-character-creator__search" data-action="feat-search" data-kind="${kind}" placeholder="Search ${noun}s…" value="${escapeHtml(this._ui[searchKey])}" />
          </div>
          <div class="dauligor-character-creator__picker-list" data-scroll-id="picker-list">${rows || `<p class="dauligor-character-creator__empty">No matches.</p>`}</div>
        </div>
        <div class="dauligor-character-creator__picker-detail" data-scroll-id="ff-detail">${detail}</div>
        ${hasTags && this._classFilter?.open ? this._renderClassFilterModal() : ""}
      </div>`;
  }

  _renderFeatDetail(kind, chosen) {
    const cache = kind === "background" ? this._bgDetailCache : kind === "race" ? this._raceDetailCache : this._featDetailCache;
    const metaLabel = kind === "background" ? "Background" : kind === "race" ? "Species" : "Feat";
    const full = cache.get(chosen.dbId);
    const hasImg = !!chosen.img;

    // Prerequisite — feats only (the dnd5e `system.requirements` string; the
    // list row's `summary` carries it too, so it shows before the detail lands).
    // Backgrounds/species have no prerequisite and their `summary` is a
    // description snippet, so never surface it as one here.
    const prereq = kind === "feat" ? String(full?.system?.requirements ?? chosen.summary ?? "").trim() : "";
    const prereqHtml = prereq
      ? `<div class="dauligor-character-creator__feat-prereq"><strong>Prerequisite:</strong> ${escapeHtml(prereq)}</div>`
      : "";

    // Authored HTML description, formatting preserved (sanitized); a plain
    // placeholder until the detail fetch lands.
    const bodyHtml = full
      ? (renderDescription(full?.system?.description?.value ?? "") || "<p><em>No description.</em></p>")
      : this._detailErrors.has(chosen.dbId)
        ? `<p class="dauligor-character-creator__detail-error"><i class="fas fa-triangle-exclamation"></i> Couldn't load details — the live site returned a temporary error. Click <strong>${escapeHtml(chosen.name)}</strong> again to retry.</p>`
        : "<p><em>Loading details…</em></p>";

    const headInner = `
      <h3 class="dauligor-detail__name">${escapeHtml(chosen.name)}</h3>
      <div class="dauligor-detail__meta">${metaLabel}</div>`;
    const header = hasImg
      ? `<header class="dauligor-detail__header dauligor-detail__header--with-image">
           <img class="dauligor-detail__img" src="${escapeHtml(chosen.img)}" alt="" />
           <div>${headInner}</div>
         </header>`
      : `<header class="dauligor-detail__header">${headInner}</header>`;
    return `
      <div class="dauligor-detail">
        <div class="dauligor-detail__pane">
          ${header}
          ${prereqHtml}
          <div class="dauligor-detail__body dauligor-character-creator__desc">${bodyHtml}</div>
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
    const chosen = this._classPreview || this._choices.class;
    const q = (this._ui.classSearch || "").toLowerCase();
    const base = this._filterClassEntries(data.entries);
    const filtered = q ? base.filter((e) => e.name.toLowerCase().includes(q)) : base;
    const renderRow = (e) => {
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
    };

    // Divide into Core / Alternate / New like the website's class list — but
    // only once the catalog actually ships `category`; otherwise fall back to a
    // flat list. "Core" is the catch-all, so an unknown category never hides a
    // class from the picker.
    const GROUPS = [
      { label: "Core Classes", match: (c) => c !== "alternate" && c !== "new" },
      { label: "Alternate Classes", match: (c) => c === "alternate" },
      { label: "New Classes", match: (c) => c === "new" },
    ];
    const grouped = data.entries.some((e) => e.category);
    let listHtml;
    if (!filtered.length) {
      listHtml = `<p class="dauligor-character-creator__empty">No matches.</p>`;
    } else if (grouped) {
      listHtml = GROUPS.map((g) => {
        const items = filtered.filter((e) => g.match(e.category));
        if (!items.length) return "";
        return `<div class="dauligor-character-creator__row-group">
          <div class="dauligor-character-creator__row-group-header">${escapeHtml(g.label)} <span>${items.length}</span></div>
          ${items.map(renderRow).join("")}
        </div>`;
      }).join("");
    } else {
      listHtml = filtered.map(renderRow).join("");
    }

    const detail = chosen
      ? this._renderClassPreview(chosen, this._classBundleCache.get(chosen.bundleUrl) || null)
      : `<div class="dauligor-detail"><div class="dauligor-detail__pane dauligor-detail__empty">Select a class to preview it, then confirm with <strong>Select Class</strong>.</div></div>`;

    const activeFilters = Object.keys(this._classFilter.tagStates).length;
    return `
      <div class="dauligor-character-creator__picker">
        <div class="dauligor-character-creator__picker-list-col">
          <div class="dauligor-character-creator__list-toolbar">
            <button type="button" class="dauligor-character-creator__filter-btn ${this._classFilter.open ? "dauligor-character-creator__filter-btn--active" : ""}" data-action="class-filter"><i class="fas fa-filter"></i> Filter${activeFilters ? ` <span class="dauligor-character-creator__filter-count">${activeFilters}</span>` : ""}</button>
            <input type="search" class="dauligor-character-creator__search" data-action="class-search" placeholder="Search classes…" value="${escapeHtml(this._ui.classSearch)}" />
          </div>
          <div class="dauligor-character-creator__picker-list" data-scroll-id="picker-list">${listHtml}</div>
        </div>
        <div class="dauligor-character-creator__picker-detail" data-scroll-id="class-detail:${escapeHtml(chosen?.entryId || "none")}">${detail}</div>
        ${this._classFilter.open ? this._renderClassFilterModal() : ""}
      </div>`;
  }

  // ── class tag filter (the import wizard's section-filter panel) ──────

  // The active tab's filter state (class / background / species / feat), or null
  // on a non-filterable tab. The historical `_classFilter` name is kept so the
  // whole section-filter machinery below works generically across all four
  // pickers without per-scope duplication.
  get _classFilter() {
    return this._filters[this._tab] ?? null;
  }

  // Entries (each carrying `.tags`) backing the active filterable tab.
  _filterEntries() {
    if (this._tab === "class") return this._classes.entries || [];
    if (this._tab === "background") return this._featFamily.backgrounds.items;
    if (this._tab === "species") return this._featFamily.races.items;
    if (this._tab === "feat") return this._featFamily.feats.items;
    return [];
  }

  // tagId → display-name map for the active tab (class catalog vs. family pools).
  _filterTagIndex() {
    return this._tab === "class" ? (this._tagIndex || {}) : (this._featFamily.tagIndex || {});
  }

  // Fetch the tag catalog once (grouped tag axes). Falls back silently to the
  // flat `_tagIndex`-derived axis if it can't load. Mirrors the importer.
  _ensureTagCatalog() {
    if (this._tagCatalog || this._tagCatalogInFlight) return;
    this._tagCatalogInFlight = true;
    (async () => {
      try {
        const res = await fetch(`${resolveApiHost()}/api/module/tags/catalog.json`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload = await res.json();
        if (payload?.kind !== "dauligor.tag-catalog.v1") throw new Error(`bad kind ${payload?.kind}`);
        const tagsById = new Map();
        const tagsByGroup = new Map();
        for (const tag of (payload.tags ?? [])) {
          if (!tag?.id) continue;
          const rec = {
            id: String(tag.id),
            name: String(tag.name ?? ""),
            groupId: String(tag.groupId ?? ""),
            parentTagId: tag.parentTagId ? String(tag.parentTagId) : null,
          };
          tagsById.set(rec.id, rec);
          if (!rec.groupId) continue;
          if (!tagsByGroup.has(rec.groupId)) tagsByGroup.set(rec.groupId, []);
          tagsByGroup.get(rec.groupId).push(rec);
        }
        const tagGroups = (payload.tagGroups ?? []).map((g) => ({ id: String(g.id), name: String(g.name ?? "") }));
        this._tagCatalog = { tagsById, tagGroups, tagsByGroup };
        if (this._classFilter?.open) this._renderBody();
      } catch (err) {
        log("character-creator: tag catalog fetch failed", err);
        this._tagCatalog = { tagsById: new Map(), tagGroups: [], tagsByGroup: new Map() };
      } finally {
        this._tagCatalogInFlight = false;
      }
    })();
  }

  // Tag ids actually carried by some entry in the active picker's pool.
  _availableClassTags() {
    return [...new Set((this._filterEntries() || []).flatMap((e) => e.tags || []))].sort();
  }

  // FilterSection[] for the panel: one axis per tag group (with subtag
  // hierarchy + an "Other" orphan bucket) when the catalog loaded, else a
  // single flat "Tags" axis from `_tagIndex`.
  _buildClassFilterAxes() {
    const available = new Set(this._availableClassTags());
    if (available.size === 0) return [];
    const axes = [];
    const accounted = new Set();

    // Real tag-group axes from the catalog (subtag hierarchy preserved).
    if (this._tagCatalog && this._tagCatalog.tagGroups.length > 0) {
      for (const group of this._tagCatalog.tagGroups) {
        const groupTags = (this._tagCatalog.tagsByGroup.get(group.id) ?? []).filter((t) => available.has(String(t.id)));
        if (!groupTags.length) continue;
        const idSet = new Set(groupTags.map((t) => String(t.id)));
        axes.push({
          key: `tag:${group.id}`,
          name: group.name,
          kind: "tag",
          groupId: group.id,
          values: groupTags.map((t) => {
            const parent = t.parentTagId ? String(t.parentTagId) : null;
            return { value: String(t.id), label: t.name, parentValue: parent && idSet.has(parent) ? parent : undefined };
          }),
        });
        for (const t of groupTags) accounted.add(String(t.id));
      }
    }

    // Synthetic Source axis — every entry carries `__src__:<slug>`. Only worth
    // showing when the pool spans more than one source.
    const srcIds = [...available].filter((id) => id.startsWith(SOURCE_TAG_PREFIX));
    if (srcIds.length > 1) {
      axes.push({
        key: "tag:__src__",
        name: "Source",
        kind: "tag",
        groupId: "__src__",
        values: srcIds.map((id) => ({ value: id, label: id.slice(SOURCE_TAG_PREFIX.length).toUpperCase() })).sort((a, b) => a.label.localeCompare(b.label)),
      });
      for (const id of srcIds) accounted.add(id);
    }

    // Synthetic Properties axis — feat scope only (repeatable / uses / …).
    if (this._tab === "feat") {
      const props = FEAT_PROPERTY_AXIS.filter((p) => available.has(p.id));
      if (props.length) {
        axes.push({
          key: "tag:__prop__",
          name: "Properties",
          kind: "tag",
          groupId: "__prop__",
          values: props.map((p) => ({ value: p.id, label: p.label })),
        });
        for (const p of props) accounted.add(p.id);
      }
    }

    // Real tags present but not in any catalog group → "Other" (synthetic
    // source/prop are already accounted, so they never leak in here). "Tags"
    // when no catalog loaded — the old flat-axis label.
    const ti = this._filterTagIndex();
    const orphans = [...available].filter((id) => !accounted.has(id) && !id.startsWith(SOURCE_TAG_PREFIX) && !id.startsWith(PROP_TAG_PREFIX));
    if (orphans.length) {
      const hasCatalog = !!(this._tagCatalog && this._tagCatalog.tagGroups.length > 0);
      axes.push({
        key: "tag:__orphan__",
        name: hasCatalog ? "Other" : "Tags",
        kind: "tag",
        groupId: "__orphan__",
        values: orphans.map((id) => ({ value: id, label: ti[id] ?? id })).sort((a, b) => a.label.localeCompare(b.label)),
      });
    }
    return axes;
  }

  // The { tagGroups, tagsByGroup } shape the tri-state matcher needs — built
  // once per filter pass (mirrors the panel's axis structure).
  _classFilterGroups() {
    const tagGroups = [];
    const tagsByGroup = {};
    const accounted = new Set();
    if (this._tagCatalog && this._tagCatalog.tagGroups.length > 0) {
      for (const g of this._tagCatalog.tagGroups) {
        tagGroups.push({ id: g.id });
        tagsByGroup[g.id] = (this._tagCatalog.tagsByGroup.get(g.id) ?? []).map((t) => ({ id: String(t.id) }));
      }
      for (const ids of Object.values(tagsByGroup)) for (const t of ids) accounted.add(t.id);
    }
    // Synthetic Source group (all scopes).
    const srcIds = new Set();
    for (const e of this._filterEntries()) for (const id of (e.tags ?? [])) { const s = String(id); if (s.startsWith(SOURCE_TAG_PREFIX)) srcIds.add(s); }
    if (srcIds.size) { tagGroups.push({ id: "__src__" }); tagsByGroup["__src__"] = [...srcIds].map((id) => ({ id })); for (const id of srcIds) accounted.add(id); }
    // Synthetic Properties group (feat scope).
    if (this._tab === "feat") {
      const propIds = new Set();
      for (const e of this._filterEntries()) for (const id of (e.tags ?? [])) { const s = String(id); if (s.startsWith(PROP_TAG_PREFIX)) propIds.add(s); }
      if (propIds.size) { tagGroups.push({ id: "__prop__" }); tagsByGroup["__prop__"] = [...propIds].map((id) => ({ id })); for (const id of propIds) accounted.add(id); }
    }
    // Real orphan tags (present, not in any catalog group, not synthetic).
    const orphans = new Set();
    for (const e of this._filterEntries()) for (const id of (e.tags ?? [])) { const s = String(id); if (!accounted.has(s) && !s.startsWith(SOURCE_TAG_PREFIX) && !s.startsWith(PROP_TAG_PREFIX)) orphans.add(s); }
    if (orphans.size) { tagGroups.push({ id: "__orphan__" }); tagsByGroup["__orphan__"] = [...orphans].map((id) => ({ id })); }
    return { tagGroups, tagsByGroup };
  }

  // Apply the active tag filter to a class-entry list.
  _filterClassEntries(entries) {
    const tagStates = this._classFilter.tagStates;
    if (!tagStates || Object.keys(tagStates).length === 0) return entries;
    const { tagGroups, tagsByGroup } = this._classFilterGroups();
    return entries.filter((entry) => matchesTagGroupsTriState({
      itemTagIds: (entry.tags ?? []).map(String),
      tagGroups,
      tagsByGroup,
      tagStates,
      groupCombineModes: this._classFilter.groupCombineModes,
      groupExclusionModes: this._classFilter.groupExclusionModes,
    }));
  }

  // Tag ids governed by a given axis (for its All / None / Clear buttons).
  _classTagsForAxis(axisKey) {
    const available = new Set(this._availableClassTags());
    if (axisKey === "tag:__src__") return [...available].filter((id) => id.startsWith(SOURCE_TAG_PREFIX));
    if (axisKey === "tag:__prop__") return FEAT_PROPERTY_AXIS.map((p) => p.id).filter((id) => available.has(id));
    if (axisKey === "tag:__orphan__" || axisKey === "tag:__flat__") {
      const accounted = new Set();
      if (this._tagCatalog) for (const g of this._tagCatalog.tagGroups) for (const t of (this._tagCatalog.tagsByGroup.get(g.id) ?? [])) accounted.add(String(t.id));
      return [...available].filter((id) => !accounted.has(id) && !id.startsWith(SOURCE_TAG_PREFIX) && !id.startsWith(PROP_TAG_PREFIX));
    }
    if (axisKey.startsWith("tag:") && this._tagCatalog) {
      const gid = axisKey.slice(4);
      return (this._tagCatalog.tagsByGroup.get(gid) ?? []).map((t) => String(t.id)).filter((id) => available.has(id));
    }
    return [];
  }

  _renderClassFilterModal() {
    const scopeLabel = { class: "Class", background: "Background", species: "Species", feat: "Feat" }[this._tab] || "";
    const panel = renderSectionFilterPanel({
      axes: this._buildClassFilterAxes(),
      tagStates: this._classFilter.tagStates,
      groupCombineModes: this._classFilter.groupCombineModes,
      groupExclusionModes: this._classFilter.groupExclusionModes,
      uiState: this._classFilter.ui,
      title: `${scopeLabel} Filters`.trim(),
      searchPlaceholder: "Filter tags…",
      resetLabel: "Reset Filters",
      showCloseButton: true,
    });
    return `
      <div class="dauligor-character-creator__filter-overlay">
        <div class="dauligor-character-creator__filter-backdrop" data-action="class-filter-backdrop"></div>
        <div class="dauligor-character-creator__filter-card" role="dialog" aria-label="${escapeHtml(scopeLabel)} filters">${panel}</div>
      </div>`;
  }

  // ── filter state mutations (via the shared cycle helpers) ────────────

  _cycleClassTagState(tagId, reverse) {
    const cur = this._classFilter.tagStates[tagId] || 0;
    const next = reverse ? nextStateReverse(cur) : nextStateForward(cur);
    if (next === SECTION_FILTER_STATE.OFF) delete this._classFilter.tagStates[tagId];
    else this._classFilter.tagStates[tagId] = next;
  }
  _cycleClassGroupCombine(groupId, reverse) {
    const cur = this._classFilter.groupCombineModes[groupId] || "OR";
    this._classFilter.groupCombineModes[groupId] = reverse ? nextCombineModeReverse(cur) : nextCombineMode(cur);
  }
  _cycleClassGroupExclusion(groupId, reverse) {
    const cur = this._classFilter.groupExclusionModes[groupId] || "OR";
    this._classFilter.groupExclusionModes[groupId] = reverse ? nextCombineModeReverse(cur) : nextCombineMode(cur);
  }
  _setClassTagsBulk(tagIds, mode) {
    for (const id of tagIds) {
      if (mode === SECTION_FILTER_STATE.OFF) delete this._classFilter.tagStates[id];
      else this._classFilter.tagStates[id] = mode;
    }
  }
  _clearClassTags(tagIds) {
    for (const id of tagIds) delete this._classFilter.tagStates[id];
  }

  _snapshotClassFilter() {
    const clone = (typeof structuredClone === "function") ? structuredClone : (v) => JSON.parse(JSON.stringify(v));
    this._classFilter.snapshot = {
      tagStates: clone(this._classFilter.tagStates),
      groupCombineModes: clone(this._classFilter.groupCombineModes),
      groupExclusionModes: clone(this._classFilter.groupExclusionModes),
    };
  }
  _restoreClassFilter() {
    const s = this._classFilter.snapshot;
    if (!s) return;
    this._classFilter.tagStates = s.tagStates;
    this._classFilter.groupCombineModes = s.groupCombineModes;
    this._classFilter.groupExclusionModes = s.groupExclusionModes;
  }
  _clearClassFilterSnapshot() { this._classFilter.snapshot = null; }

  _closeClassFilter() {
    this._classFilter.open = false;
    this._classFilter.ui = freshFilterUi();
    this._clearClassFilterSnapshot();
    this._renderBody();
  }

  // Wire the Filter button + (when open) the panel + backdrop. Called from
  // _bindBody on the class tab.
  _bindClassFilter() {
    const root = this._bodyRegion;
    if (!root) return;
    root.querySelector(`[data-action="class-filter"]`)?.addEventListener("click", () => {
      const wasOpen = this._classFilter.open;
      this._classFilter.open = !wasOpen;
      if (!wasOpen) this._snapshotClassFilter();
      else this._clearClassFilterSnapshot();
      this._renderBody();
    });
    if (!this._classFilter.open) return;
    root.querySelector(`[data-action="class-filter-backdrop"]`)?.addEventListener("click", () => this._closeClassFilter());
    const panel = root.querySelector(".dauligor-section-filter");
    if (!panel) return;
    const rerender = () => this._renderBody();
    bindSectionFilterPanelEvents(panel, {
      cycleTagState: (id) => { this._cycleClassTagState(id, false); rerender(); },
      cycleTagStateReverse: (id) => { this._cycleClassTagState(id, true); rerender(); },
      cycleGroupCombineMode: (gid) => { this._cycleClassGroupCombine(gid, false); rerender(); },
      cycleGroupCombineModeReverse: (gid) => { this._cycleClassGroupCombine(gid, true); rerender(); },
      cycleGroupExclusionMode: (gid) => { this._cycleClassGroupExclusion(gid, false); rerender(); },
      cycleGroupExclusionModeReverse: (gid) => { this._cycleClassGroupExclusion(gid, true); rerender(); },
      groupIncludeAll: (axisKey) => { this._setClassTagsBulk(this._classTagsForAxis(axisKey), SECTION_FILTER_STATE.INCLUDE); rerender(); },
      groupExcludeAll: (axisKey) => { this._setClassTagsBulk(this._classTagsForAxis(axisKey), SECTION_FILTER_STATE.EXCLUDE); rerender(); },
      groupClear: (axisKey) => { this._clearClassTags(this._classTagsForAxis(axisKey)); rerender(); },
      toggleAxisHidden: (axisKey) => {
        const ui = this._classFilter.ui;
        if (ui.hiddenAxes.has(axisKey)) ui.hiddenAxes.delete(axisKey); else ui.hiddenAxes.add(axisKey);
        rerender();
      },
      toggleParentDrawer: (axisKey, parent) => {
        const ui = this._classFilter.ui;
        if (!ui.expandedParents.has(axisKey)) ui.expandedParents.set(axisKey, new Set());
        const set = ui.expandedParents.get(axisKey);
        if (set.has(parent)) set.delete(parent); else set.add(parent);
        rerender();
      },
      toggleAllSubtags: (axisKey) => {
        const ui = this._classFilter.ui;
        if (ui.allSubtagAxes.has(axisKey)) ui.allSubtagAxes.delete(axisKey); else ui.allSubtagAxes.add(axisKey);
        rerender();
      },
      toggleAltLabel: (axisKey) => {
        const ui = this._classFilter.ui;
        if (ui.altLabelAxes.has(axisKey)) ui.altLabelAxes.delete(axisKey); else ui.altLabelAxes.add(axisKey);
        rerender();
      },
      setChipSearch: (v) => {
        this._classFilter.ui.chipSearch = String(v ?? "");
        this._renderBody();
        // Re-render replaced the input — restore focus + caret so typing flows.
        const inp = this._bodyRegion?.querySelector(`[data-section-action="chip-search"]`);
        if (inp) { inp.focus(); const n = inp.value.length; try { inp.setSelectionRange(n, n); } catch { /* noop */ } }
      },
      showAllSections: () => { this._classFilter.ui.hiddenAxes.clear(); rerender(); },
      hideAllSections: () => { this._classFilter.ui.hiddenAxes = new Set(this._buildClassFilterAxes().map((a) => a.key)); rerender(); },
      resetAll: () => {
        this._classFilter.tagStates = {};
        this._classFilter.groupCombineModes = {};
        this._classFilter.groupExclusionModes = {};
        rerender();
      },
      close: () => this._closeClassFilter(),
      save: () => this._closeClassFilter(),
      cancel: () => { this._restoreClassFilter(); this._closeClassFilter(); },
    });
  }


  // Rich class view — delegates to the shared `class-detail-view` module so the
  // creator's Class tab, the standalone class-detail window, and the import /
  // subclass wizards all render the IDENTICAL ClassView (one implementation, no
  // drift). The cv-* display state stays on the creator and is passed in; the
  // module's render is pure. Lazy spell-list loading runs through the shared
  // `fetchClassSpells` via the `onFetchSpells` hook (re-rendering when it lands).
  _renderClassPreview(chosen, bundle) {
    return renderClassView({
      chosen,
      bundle,
      cvTab: this._cvTab,
      cvSubclassId: this._cvSubclassId,
      cvExpanded: this._cvExpanded,
      cvSpells: this._cvSpells,
      spellChart: this._spellChart,
      onFetchSpells: (c) => fetchClassSpells(c.bundleUrl, this._cvSpells, (url) => {
        if (this._tab === "class" && this._cvTab === "spells" && this._classPreview?.bundleUrl === url) this._renderBody();
      }),
    });
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
        ${card("feat", "Starting Feat", this._choices.feat ? `<strong>${escapeHtml(this._choices.feat.name)}</strong>` : `<em>None chosen (optional)</em>`, !!this._choices.feat)}
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
      const kind = e.currentTarget.dataset.kind;
      const k = kind === "background" ? "bgSearch" : kind === "race" ? "raceSearch" : "featSearch";
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

    // Class tag-filter button + modal (only present on the class tab).
    if (this._tab === "class" || this._isFamilyTab()) this._bindClassFilter();
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
    const row = this._familyFor(kind).items.find((r) => r.dbId === dbId);
    if (!row) return;
    this._detailErrors.delete(dbId); // a fresh (re)pick starts clean → shows "Loading…"
    // Browsing only sets the PREVIEW; the choice is committed by the Select
    // button (mirrors the class picker), so a stray click never commits.
    this._featPreview[kind] = { dbId: row.dbId, name: row.name, img: row.img };
    this._renderBody();
    this._renderFooter(); // enable Select
    // Lazy-fetch detail for the preview pane (and to warm the embed cache).
    // Re-render whether it succeeds OR fails (failure shows a retry message),
    // as long as we're still on a list-picker tab and this is still the preview.
    await this._fetchDetail(kind, dbId);
    const stillRelevant = this._tab === "background" || this._tab === "species" || this._tab === "feat";
    if (stillRelevant && this._featPreview[kind]?.dbId === dbId) this._renderBody();
  }

  // Commit the previewed option (background / species / feat) and return to the
  // wheel. Mirrors _selectClass.
  _selectFeat(kind) {
    const preview = this._featPreview[kind];
    if (!preview) {
      this._setStatus("Pick one first.", "danger");
      return;
    }
    this._choices[kind] = { ...preview };
    this._setStatus(`Selected ${preview.name}.`, "success");
    this._backToHub();
  }

  // Discard the browsing change and return to the wheel; the committed choice
  // (if any) is left untouched.
  _cancelFeat(kind) {
    this._featPreview[kind] = this._choices[kind] ? { ...this._choices[kind] } : null;
    this._backToHub();
  }

  _pickClass(entryId, sourceSlug) {
    const entry = this._classes.entries.find((e) => e.entryId === entryId && e.sourceSlug === sourceSlug);
    if (!entry) return;
    // Browsing only sets the PREVIEW; the choice is committed by Select Class.
    this._classPreview = {
      entryId: entry.entryId, sourceSlug: entry.sourceSlug, sourceId: entry.sourceId,
      name: entry.name, img: entry.img, summary: entry.summary, bundleUrl: entry.bundleUrl,
    };
    // Reset the ClassView-style preview state for the new class.
    this._cvTab = "features";
    this._cvSubclassId = null;
    this._cvExpanded = new Set();
    this._renderBody();
    this._renderFooter(); // enable Select Class
    // Lazy-load the full bundle + the spell chart for the rich preview;
    // re-render when each lands.
    const reRenderIfCurrent = () => {
      if (this._tab === "class" && this._classPreview?.bundleUrl === entry.bundleUrl) {
        this._renderBody();
      }
    };
    if (entry.bundleUrl) this._fetchClassBundle(entry.bundleUrl).then((b) => { if (b) reRenderIfCurrent(); });
    this._ensureSpellChart().then((chart) => { if (chart) reRenderIfCurrent(); });
  }

  // Commit the previewed class as the chosen class, then return to the wheel
  // (its Class wedge now shows the pick). The actual class build still runs
  // through the importer when the player hits Build Character on the wheel.
  _selectClass() {
    if (!this._classPreview) {
      this._setStatus("Pick a class first.", "danger");
      return;
    }
    this._choices.class = { ...this._classPreview };
    this._setStatus(`Selected ${this._choices.class.name}.`, "success");
    this._backToHub();
  }

  // Discard any browsing change and return to the wheel; the committed choice
  // (if any) is left untouched.
  _cancelClass() {
    this._classPreview = this._choices.class ? { ...this._choices.class } : null;
    this._backToHub();
  }

  // ── rendering: footer ────────────────────────────────────────────────

  _renderFooter() {
    if (!this._footerRegion) return;
    const status = this._ui.status
      ? `<span class="dauligor-character-creator__status dauligor-character-creator__status--${this._ui.statusLevel || "info"}">${escapeHtml(this._ui.status)}</span>`
      : `<span class="dauligor-character-creator__status"></span>`;

    // The action is contextual. The terminal Build Character belongs to the
    // whole-character overviews (the Create wheel + the Character review). The
    // Class tab confirms/cancels the browsed class instead; the other option
    // tabs select inline, so the tab bar is their navigation. Required bits
    // (abilities + class) are validated in _finish, which jumps to whatever's
    // missing.
    let actions = "";
    if (this._tab === "class") {
      actions = `
        <button type="button" class="dauligor-character-creator__button dauligor-character-creator__button--ghost" data-action="cancel-class"><i class="fas fa-xmark"></i> Cancel</button>
        <button type="button" class="dauligor-character-creator__button dauligor-character-creator__button--primary" data-action="select-class" ${this._classPreview ? "" : "disabled"}><i class="fas fa-check"></i> Select Class</button>`;
    } else if (this._tab === "background" || this._tab === "species" || this._tab === "feat") {
      const kind = { background: "background", species: "race", feat: "feat" }[this._tab];
      const noun = { background: "Background", species: "Species", feat: "Feat" }[this._tab];
      actions = `
        <button type="button" class="dauligor-character-creator__button dauligor-character-creator__button--ghost" data-action="cancel-feat"><i class="fas fa-xmark"></i> Cancel</button>
        <button type="button" class="dauligor-character-creator__button dauligor-character-creator__button--primary" data-action="select-feat" ${this._featPreview[kind] ? "" : "disabled"}><i class="fas fa-check"></i> Select ${noun}</button>`;
    } else if (this._tab === "create" || this._tab === "character") {
      actions = `<button type="button" class="dauligor-character-creator__button dauligor-character-creator__button--primary" data-action="build" ${this._ui.busy ? "disabled" : ""}><i class="fas fa-wand-magic-sparkles"></i> Build Character</button>`;
    }

    this._footerRegion.innerHTML = `${status}<div class="dauligor-character-creator__footer-actions">${actions}</div>`;
    this._footerRegion.querySelector(`[data-action="build"]`)?.addEventListener("click", () => this._finish());
    this._footerRegion.querySelector(`[data-action="select-class"]`)?.addEventListener("click", () => this._selectClass());
    this._footerRegion.querySelector(`[data-action="cancel-class"]`)?.addEventListener("click", () => this._cancelClass());
    const featKind = { background: "background", species: "race", feat: "feat" }[this._tab];
    this._footerRegion.querySelector(`[data-action="select-feat"]`)?.addEventListener("click", () => this._selectFeat(featKind));
    this._footerRegion.querySelector(`[data-action="cancel-feat"]`)?.addEventListener("click", () => this._cancelFeat(featKind));
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
      // Navigate first — _openSection clears the status — then set the message.
      this._openSection("abilities");
      this._setStatus("Ability scores aren't finished — open Ability Scores.", "danger");
      return;
    }
    if (!this._choices.class) {
      this._openSection("class");
      this._setStatus(this._classPreview ? "Confirm your class with Select Class." : "Pick a class before building.", "danger");
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
      if (this._choices.feat) await this._embedFamilyItem(actor, "feat", this._choices.feat.dbId);

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
