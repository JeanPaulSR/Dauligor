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

const STEPS = [
  { id: "abilities", label: "Ability Scores", icon: "fa-dice-d20" },
  { id: "background", label: "Background", icon: "fa-scroll" },
  { id: "race", label: "Race", icon: "fa-dragon" },
  { id: "class", label: "Class", icon: "fa-shield-halved" },
  { id: "items", label: "Starting Items", icon: "fa-sack-dollar" },
  { id: "review", label: "Review", icon: "fa-clipboard-check" },
];

const ABILITIES = [
  { key: "str", label: "Strength", abbr: "STR" },
  { key: "dex", label: "Dexterity", abbr: "DEX" },
  { key: "con", label: "Constitution", abbr: "CON" },
  { key: "int", label: "Intelligence", abbr: "INT" },
  { key: "wis", label: "Wisdom", abbr: "WIS" },
  { key: "cha", label: "Charisma", abbr: "CHA" },
];

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
    race: null,       // { dbId, name, img }
    class: null,      // { sourceSlug, entryId, name, img }
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
    const width = Math.min(window.innerWidth - 120, 1100);
    const height = Math.min(window.innerHeight - 120, 760);
    super({
      id: `${MODULE_ID}-character-creator`,
      classes: ["dauligor-importer-app", "dauligor-character-creator"],
      window: {
        title: actor ? `Create Character: ${actor.name}` : "Create Character",
        resizable: true,
        contentClasses: ["dauligor-importer-window", "dauligor-character-creator-host"],
      },
      position: { width, height },
    });

    // Output mode: applying onto an existing actor vs. creating a new one.
    this._actor = actor ?? null;
    this._createNew = !actor;

    this._step = 0;
    this._choices = freshChoices();

    // Lazy-loaded data caches.
    // featFamily: { status, backgrounds[], races[], errors[] }
    this._featFamily = { status: "idle", backgrounds: [], races: [] };
    // classes: { status, entries[], errors[] }
    this._classes = { status: "idle", entries: [] };
    // Detail fetch caches keyed by dbId.
    this._bgDetailCache = new Map();
    this._raceDetailCache = new Map();

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
    this._stepperRegion = null;
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
    this._stepperRegion = content.querySelector(`[data-region="stepper"]`);
    this._bodyRegion = content.querySelector(`[data-region="body"]`);
    this._footerRegion = content.querySelector(`[data-region="footer"]`);

    if (!this._unsubPool) {
      this._unsubPool = onRollPoolChanged(() => {
        // Only the ability step shows the pool; cheap to re-render just it.
        if (this._stepId() === "abilities") this._renderBody();
      });
    }

    this._renderAll();
  }

  // ── step plumbing ─────────────────────────────────────────────────────

  _stepId() {
    return STEPS[this._step]?.id ?? "abilities";
  }

  _goToStep(index) {
    const next = Math.max(0, Math.min(STEPS.length - 1, index));
    if (next === this._step) return;
    this._step = next;
    this._ui.status = "";
    this._ui.statusLevel = "";
    // Kick off lazy loads for the step being entered.
    this._ensureStepData();
    this._renderAll();
  }

  _ensureStepData() {
    const id = this._stepId();
    if ((id === "background" || id === "race" || id === "review") && this._featFamily.status === "idle") {
      this._loadFeatFamily();
    }
    if ((id === "class" || id === "review") && this._classes.status === "idle") {
      this._loadClasses();
    }
  }

  _renderAll() {
    this._renderStepper();
    this._renderBody();
    this._renderFooter();
  }

  // ── data loading ────────────────────────────────────────────────────

  async _loadSourceSlugs() {
    if (Array.isArray(this._sourceSlugsCache)) return this._sourceSlugsCache;
    const host = resolveApiHost();
    try {
      const res = await fetch(`${host}/api/module/sources/catalog.json`, { cache: "no-store" });
      if (!res.ok) return [];
      const payload = await res.json();
      if (payload?.kind !== "dauligor.source-catalog.v1") return [];
      const slugs = (Array.isArray(payload.entries) ? payload.entries : [])
        .map((e) => String(e?.sourceId ?? "").toLowerCase())
        .filter(Boolean);
      this._sourceSlugsCache = slugs;
      return slugs;
    } catch (err) {
      log("character-creator: source catalog fetch failed", err);
      return [];
    }
  }

  async _loadFeatFamily() {
    this._featFamily = { status: "loading", backgrounds: [], races: [] };
    if (this._stepId() === "background" || this._stepId() === "race") this._renderBody();

    const slugs = await this._loadSourceSlugs();
    if (!slugs.length) {
      this._featFamily = { status: "error", backgrounds: [], races: [], errors: ["No sources available."] };
      if (this._stepId() === "background" || this._stepId() === "race") this._renderBody();
      return;
    }

    const host = resolveApiHost();
    const backgrounds = [];
    const races = [];
    const errors = [];

    await Promise.all(slugs.map(async (slug) => {
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
    if (["background", "race", "review"].includes(this._stepId())) this._renderAll();
  }

  async _loadClasses() {
    this._classes = { status: "loading", entries: [] };
    if (this._stepId() === "class") this._renderBody();

    const slugs = await this._loadSourceSlugs();
    const host = resolveApiHost();
    const entries = [];
    const errors = [];

    await Promise.all(slugs.map(async (slug) => {
      const url = `${host}/api/module/${encodeURIComponent(slug)}/classes/catalog.json`;
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) { errors.push(`${slug}: HTTP ${res.status}`); return; }
        const payload = await res.json();
        if (payload?.kind !== "dauligor.class-catalog.v1") return;
        for (const entry of (Array.isArray(payload.entries) ? payload.entries : [])) {
          if (entry?.type !== "class" || !entry?.id) continue;
          entries.push({
            entryId: String(entry.id),
            name: String(entry.name ?? entry.id),
            img: entry.img ?? null,
            summary: String(entry.description ?? entry.summary ?? ""),
            sourceSlug: slug,
          });
        }
      } catch (err) {
        errors.push(`${slug}: ${err?.message ?? "fetch failed"}`);
      }
    }));

    entries.sort((a, b) => a.name.localeCompare(b.name));
    this._classes = { status: "ready", entries, errors };
    if (["class", "review"].includes(this._stepId())) this._renderAll();
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

  // ── rendering: stepper ──────────────────────────────────────────────

  _renderStepper() {
    if (!this._stepperRegion) return;
    const items = STEPS.map((s, i) => {
      const current = i === this._step ? "dauligor-character-creator__step--current" : "";
      const done = this._isStepComplete(s.id);
      return `
        <button type="button" class="dauligor-character-creator__step ${current} ${done ? "is-complete" : ""}"
                data-action="goto-step" data-step="${i}">
          <span class="dauligor-character-creator__step-num">${done ? '<i class="fas fa-check"></i>' : (i + 1)}</span>
          <span class="dauligor-character-creator__step-label"><i class="fas ${s.icon}"></i> ${escapeHtml(s.label)}</span>
        </button>`;
    }).join("");
    this._stepperRegion.innerHTML = `<nav class="dauligor-character-creator__steps">${items}</nav>`;
    this._stepperRegion.querySelectorAll(`[data-action="goto-step"]`).forEach((el) => {
      el.addEventListener("click", () => this._goToStep(Number(el.dataset.step)));
    });
  }

  _isStepComplete(id) {
    switch (id) {
      case "abilities": return this._resolveAbilityScores() != null;
      case "background": return !!this._choices.background;
      case "race": return !!this._choices.race;
      case "class": return !!this._choices.class;
      case "items": return false; // stubbed
      case "review": return false;
      default: return false;
    }
  }

  // ── rendering: body (per step) ──────────────────────────────────────

  _renderBody() {
    if (!this._bodyRegion) return;
    let html = "";
    switch (this._stepId()) {
      case "abilities": html = this._bodyAbilities(); break;
      case "background": html = this._bodyFeatFamily("background"); break;
      case "race": html = this._bodyFeatFamily("race"); break;
      case "class": html = this._bodyClass(); break;
      case "items": html = this._bodyItems(); break;
      case "review": html = this._bodyReview(); break;
    }
    this._bodyRegion.innerHTML = html;
    this._bindBody();
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

  _bodyFeatFamily(kind) {
    const data = this._featFamily;
    const list = kind === "background" ? data.backgrounds : data.races;
    const searchKey = kind === "background" ? "bgSearch" : "raceSearch";
    const chosen = kind === "background" ? this._choices.background : this._choices.race;
    const noun = kind === "background" ? "background" : "race";

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
             <div class="dauligor-detail__meta">${kind === "background" ? "Background" : "Race"}</div>
           </div>
         </header>`
      : `<header class="dauligor-detail__header">
           <h3 class="dauligor-detail__name">${escapeHtml(chosen.name)}</h3>
           <div class="dauligor-detail__meta">${kind === "background" ? "Background" : "Race"}</div>
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
      ? `<div class="dauligor-detail">
           <div class="dauligor-detail__pane">
             <header class="dauligor-detail__header">
               <h3 class="dauligor-detail__name">${escapeHtml(chosen.name)}</h3>
               <div class="dauligor-detail__meta">Class · ${escapeHtml(chosen.sourceSlug.toUpperCase())}</div>
             </header>
             <div class="dauligor-detail__body">
               ${chosen.summary ? `<p>${escapeHtml(truncate(chosen.summary, 700))}</p>` : ""}
               <p class="dauligor-character-creator__hint">At <strong>Finish</strong>, the class builder opens pre-set to <strong>${escapeHtml(chosen.name)}</strong> at level 1 so you can make any skill / option / feature choices in the full importer.</p>
             </div>
           </div>
         </div>`
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

  // ---- Step 5: items (stub) ----

  _bodyItems() {
    return `
      <div class="dauligor-character-creator__stub">
        <i class="fas fa-sack-dollar"></i>
        <h3>Starting Items — coming soon</h3>
        <p>The starting-equipment picker needs an item-list endpoint and populated
        class/background equipment data, which aren't available yet. This step is a
        placeholder for now; you can skip it and equip your character afterward with
        the Dauligor item importer.</p>
        <p class="dauligor-character-creator__hint">When the item catalog lands, this slot becomes the equipment chooser with no change to the rest of the flow.</p>
      </div>`;
  }

  // ---- Step 6: review ----

  _bodyReview() {
    const scores = this._resolveAbilityScores();
    const abilityLine = scores
      ? ABILITIES.map((ab) => `<span class="dauligor-character-creator__scorepill">${ab.abbr} ${scores[ab.key]}</span>`).join("")
      : `<em class="dauligor-character-creator__warn">Not finished — open the Ability Scores step.</em>`;

    const card = (idx, title, value, ok) => `
      <div class="dauligor-character-creator__review-card ${ok ? "dauligor-character-creator__review-card--ok" : "dauligor-character-creator__review-card--missing"}">
        <div class="dauligor-character-creator__review-head">
          <span>${escapeHtml(title)}</span>
          <button type="button" class="dauligor-character-creator__editlink" data-action="goto-step" data-step="${idx}"><i class="fas fa-pen"></i> Edit</button>
        </div>
        <div class="dauligor-character-creator__review-body">${value}</div>
      </div>`;

    const target = this._actor
      ? `Applies onto existing actor <strong>${escapeHtml(this._actor.name)}</strong>.`
      : `Creates a new empty character actor.`;

    return `
      <div class="dauligor-character-creator__review">
        <p class="dauligor-character-creator__review-target"><i class="fas fa-user-plus"></i> ${target}</p>
        ${card(0, "Ability Scores", `<div class="dauligor-character-creator__scorepills">${abilityLine}</div>`, !!scores)}
        ${card(1, "Background", this._choices.background ? `<strong>${escapeHtml(this._choices.background.name)}</strong>` : `<em>None chosen (optional)</em>`, !!this._choices.background)}
        ${card(2, "Race", this._choices.race ? `<strong>${escapeHtml(this._choices.race.name)}</strong>` : `<em>None chosen (optional)</em>`, !!this._choices.race)}
        ${card(3, "Class", this._choices.class ? `<strong>${escapeHtml(this._choices.class.name)}</strong> <small>(${escapeHtml(this._choices.class.sourceSlug.toUpperCase())}, level 1)</small>` : `<em class="dauligor-character-creator__warn">None chosen</em>`, !!this._choices.class)}
        ${card(4, "Starting Items", `<em>Stubbed for now — equip later.</em>`, true)}
        <p class="dauligor-character-creator__hint">Finish writes ability scores, embeds the background &amp; race, then opens the class builder at level 1 to complete the class.</p>
      </div>`;
  }

  // ── body event binding ──────────────────────────────────────────────

  _bindBody() {
    const root = this._bodyRegion;
    if (!root) return;

    const on = (sel, evt, fn) => root.querySelectorAll(sel).forEach((el) => el.addEventListener(evt, fn));

    // shared: edit-jump links in review
    on(`[data-action="goto-step"]`, "click", (e) => this._goToStep(Number(e.currentTarget.dataset.step)));

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
      this._renderStepper();
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
      this._renderStepper();
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
    this._renderStepper();
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
    if (this._stepId() === "abilities") this._renderBody();
  }

  async _handleManualAdd() {
    const parts = String(this._ui.manualRolls).trim().split(/[\s,]+/).map((n) => Number(n)).filter((n) => Number.isFinite(n));
    if (parts.length !== 6) {
      notifyWarn("Enter exactly six numbers (e.g. 15 14 13 12 10 8).");
      return;
    }
    await addManualSet(parts);
    this._ui.manualRolls = "";
    if (this._stepId() === "abilities") this._renderBody();
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
    this._renderStepper();
    this._renderFooter();
    // Lazy-fetch detail for the preview pane (and to warm the embed cache).
    const full = await this._fetchDetail(kind, dbId);
    if (full && this._stepId() === kind) this._renderBody();
  }

  _pickClass(entryId, sourceSlug) {
    const entry = this._classes.entries.find((e) => e.entryId === entryId && e.sourceSlug === sourceSlug);
    if (!entry) return;
    this._choices.class = { entryId: entry.entryId, sourceSlug: entry.sourceSlug, name: entry.name, img: entry.img, summary: entry.summary };
    this._renderBody();
    this._renderStepper();
    this._renderFooter();
  }

  // ── rendering: footer ────────────────────────────────────────────────

  _renderFooter() {
    if (!this._footerRegion) return;
    const isFirst = this._step === 0;
    const isReview = this._stepId() === "review";
    const status = this._ui.status
      ? `<span class="dauligor-character-creator__status dauligor-character-creator__status--${this._ui.statusLevel || "info"}">${escapeHtml(this._ui.status)}</span>`
      : `<span class="dauligor-character-creator__status"></span>`;

    const back = `<button type="button" class="dauligor-character-creator__button dauligor-character-creator__button--ghost" data-action="back" ${isFirst ? "disabled" : ""}><i class="fas fa-arrow-left"></i> Back</button>`;
    const next = isReview
      ? `<button type="button" class="dauligor-character-creator__button dauligor-character-creator__button--primary" data-action="finish" ${this._ui.busy ? "disabled" : ""}><i class="fas fa-wand-magic-sparkles"></i> Finish &amp; Build</button>`
      : `<button type="button" class="dauligor-character-creator__button dauligor-character-creator__button--primary" data-action="next">Next <i class="fas fa-arrow-right"></i></button>`;

    this._footerRegion.innerHTML = `${status}<div class="dauligor-character-creator__footer-actions">${back}${next}</div>`;
    this._footerRegion.querySelector(`[data-action="back"]`)?.addEventListener("click", () => this._goToStep(this._step - 1));
    this._footerRegion.querySelector(`[data-action="next"]`)?.addEventListener("click", () => this._goToStep(this._step + 1));
    this._footerRegion.querySelector(`[data-action="finish"]`)?.addEventListener("click", () => this._finish());
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
      this._setStatus("Ability scores aren't finished — open the Ability Scores step.", "danger");
      this._goToStep(0);
      return;
    }
    if (!this._choices.class) {
      this._setStatus("Pick a class before finishing.", "danger");
      this._goToStep(3);
      return;
    }

    // Confirm if recommended steps are skipped.
    const missing = [];
    if (!this._choices.background) missing.push("background");
    if (!this._choices.race) missing.push("race");
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
        sourceTypeIds: [cls.sourceSlug],
        selectedEntryIds: [cls.entryId],
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
