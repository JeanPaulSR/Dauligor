// Foundry-side Monster Browser. Opens from the Dauligor Importer wizard after a
// GM picks "Monsters" + one or more sources.
//
// Unlike the spell/feat/background/species browsers (which embed an item onto a
// target ACTOR), monsters import as WORLD `npc` actors via
// monster-import-service.importMonsterActor — GM-ONLY, never onto a player's
// character sheet (owner rule: players import Items, not monsters).
//
// Flow:
//   1. Open (GM only): fetch each source's per-source list catalog
//      /api/module/<slug>/monsters.json (dauligor.monster-catalog.v1) -> merge.
//   2. Searchable + filterable list (search by name; CR band / Type / Size
//      dropdowns built from the pool). Plutonium-style bestiary picker.
//   3. Import (checked rows): follow each entry's source-relative `detailUrl`
//      to the v1 NPC-actor bundle -> importMonsterActor -> Actor.create(npc)
//      into a "Dauligor Monsters" Actors folder.
//
// Reuses the generic CLASS_OPTIONS_TEMPLATE shell (toolbar/body/footer regions)
// + the importer-app render rhythm (region innerHTML injection so the search box
// keeps focus across keystrokes — no full re-render on input).

import { MODULE_ID, CLASS_OPTIONS_TEMPLATE } from "./constants.js";
import { log, notifyInfo, notifyWarn } from "./utils.js";
import { resolveApiHost } from "./auth-service.js";
import { importMonsterActor } from "./monster-import-service.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const MONSTER_CATALOG_KIND = "dauligor.monster-catalog.v1";
const IMPORT_FOLDER_NAME = "Dauligor Monsters";

const SIZE_LABELS = { tiny: "Tiny", sm: "Small", med: "Medium", lg: "Large", huge: "Huge", grg: "Gargantuan" };
const SIZE_ORDER = ["tiny", "sm", "med", "lg", "huge", "grg"];

function crLabel(cr) {
  if (cr == null) return "—";
  const fractions = { 0.125: "1/8", 0.25: "1/4", 0.5: "1/2" };
  return fractions[cr] ?? String(cr);
}

// Fixed CR bands for the filter dropdown. Returns the band key an entry falls in.
const CR_BANDS = [
  { key: "0", label: "CR < 1", test: (c) => c != null && c < 1 },
  { key: "1-4", label: "CR 1–4", test: (c) => c >= 1 && c <= 4 },
  { key: "5-10", label: "CR 5–10", test: (c) => c >= 5 && c <= 10 },
  { key: "11-16", label: "CR 11–16", test: (c) => c >= 11 && c <= 16 },
  { key: "17+", label: "CR 17+", test: (c) => c >= 17 },
];
function crBandKey(cr) {
  const band = CR_BANDS.find((b) => b.test(Number(cr)));
  return band ? band.key : "";
}

function escapeHtml(s) {
  return foundry.utils.escapeHTML(String(s ?? ""));
}

// fetch() with a few retries on transient 5xx / cold-start (mirrors the
// importer's helper — the live site can briefly 503 and the browser reports it
// as a misleading CORS error; one or two retries clears it).
async function fetchJsonWithRetry(url, { retries = 2, backoffMs = 350 } = {}) {
  let lastErr = null;
  let lastRes = null;
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

export class DauligorMonsterBrowserApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static _instance = null;

  static async open({ sourceSlugs = [], folderPath = "" } = {}) {
    if (!game.user?.isGM) {
      notifyWarn("Only a GM can import monsters — they create world NPC actors.");
      return null;
    }
    if (this._instance) {
      this._instance._sourceSlugs = (Array.isArray(sourceSlugs) ? sourceSlugs : []).map(String);
      await this._instance.render({ force: true });
      this._instance._loadPool();
      this._instance.maximize?.();
      return this._instance;
    }
    const instance = new this({ sourceSlugs, folderPath });
    this._instance = instance;
    await instance.render({ force: true });
    instance._loadPool();
    return instance;
  }

  constructor({ sourceSlugs = [], folderPath = "" } = {}) {
    const width = Math.min(window.innerWidth - 120, 1080);
    const height = Math.min(window.innerHeight - 120, 800);
    super({
      id: `${MODULE_ID}-monster-browser`,
      classes: ["dauligor-importer-app", "dauligor-class-options", "dauligor-monster-browser"],
      window: {
        title: "Import Monsters",
        resizable: true,
        contentClasses: ["dauligor-importer-window"],
      },
      position: { width, height },
    });

    this._template = CLASS_OPTIONS_TEMPLATE;
    this._sourceSlugs = (Array.isArray(sourceSlugs) ? sourceSlugs : []).map(String);
    this._folderName = String(folderPath || "").trim() || IMPORT_FOLDER_NAME;

    // Pool: { status: "idle"|"loading"|"ready"|"error", entries:[], errors:[] }
    this._pool = { status: "idle", entries: [], errors: [] };
    this._search = "";
    this._filters = { cr: "", type: "", size: "" };
    this._selected = new Set(); // identifiers
    this._importing = false;
    this._status = "";
    this._statusLevel = "";

    this._toolbarRegion = null;
    this._bodyRegion = null;
    this._footerRegion = null;
  }

  _configureRenderParts() {
    return { main: { template: this._template } };
  }

  async close(options) {
    if (DauligorMonsterBrowserApp._instance === this) DauligorMonsterBrowserApp._instance = null;
    return super.close(options);
  }

  async _onRender() {
    super._onRender?.(...arguments);
    const root = this.element;
    if (!root) return;
    const content = root.querySelector(".window-content") ?? root;
    this._toolbarRegion = content.querySelector(`[data-region="toolbar"]`);
    this._bodyRegion = content.querySelector(`[data-region="body"]`);
    this._footerRegion = content.querySelector(`[data-region="footer"]`);
    this._renderToolbar();
    this._renderBody();
    this._renderFooter();
  }

  // ── data ──────────────────────────────────────────────────────────────────

  async _loadPool() {
    if (this._pool.status === "loading") return;
    this._pool = { status: "loading", entries: [], errors: [] };
    this._status = "Loading monsters…";
    this._statusLevel = "";
    this._renderBody();
    this._renderFooter();

    const host = resolveApiHost();
    const slugs = this._sourceSlugs.length ? this._sourceSlugs : [];
    const results = await Promise.all(slugs.map(async (slug) => {
      const url = `${host}/api/module/${encodeURIComponent(slug)}/monsters.json`;
      try {
        const res = await fetchJsonWithRetry(url);
        if (!res.ok) return { slug, error: `HTTP ${res.status}` };
        const data = await res.json();
        if (data?.kind !== MONSTER_CATALOG_KIND) return { slug, error: "unexpected payload kind" };
        return { slug, entries: Array.isArray(data.entries) ? data.entries : [] };
      } catch (err) {
        return { slug, error: String(err?.message || err) };
      }
    }));

    const entries = [];
    const errors = [];
    const seen = new Set();
    for (const r of results) {
      if (r.error) { errors.push(`${r.slug}: ${r.error}`); continue; }
      for (const e of r.entries) {
        const id = String(e.identifier ?? e.id ?? "");
        if (!id || seen.has(id)) continue;
        seen.add(id);
        entries.push({
          identifier: id,
          dbId: e.id != null ? String(e.id) : null,
          name: String(e.name ?? id),
          cr: e.cr == null ? null : Number(e.cr),
          type: String(e.type ?? ""),
          size: String(e.size ?? ""),
          source: String(e.source ?? r.slug),
          detailUrl: String(e.detailUrl ?? ""),
        });
      }
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));

    this._pool = { status: "ready", entries, errors };
    this._status = entries.length
      ? `${entries.length} monster${entries.length === 1 ? "" : "s"} across ${slugs.length} source${slugs.length === 1 ? "" : "s"}.`
      : "No monsters found for the selected source(s).";
    this._statusLevel = entries.length ? "success" : "warn";
    if (errors.length) log("warn", "monster catalog: some sources failed", errors);
    this._renderToolbar();
    this._renderBody();
    this._renderFooter();
  }

  _filteredEntries() {
    const q = this._search.trim().toLowerCase();
    const { cr, type, size } = this._filters;
    return this._pool.entries.filter((e) => {
      if (q && !e.name.toLowerCase().includes(q)) return false;
      if (cr && crBandKey(e.cr) !== cr) return false;
      if (type && e.type !== type) return false;
      if (size && e.size !== size) return false;
      return true;
    });
  }

  _distinct(key) {
    return [...new Set(this._pool.entries.map((e) => e[key]).filter(Boolean))];
  }

  // ── render ──────────────────────────────────────────────────────────────────

  _renderToolbar() {
    if (!this._toolbarRegion) return;
    const types = this._distinct("type").sort();
    const sizes = SIZE_ORDER.filter((s) => this._distinct("size").includes(s));
    const opt = (value, label, sel) => `<option value="${escapeHtml(value)}"${sel === value ? " selected" : ""}>${escapeHtml(label)}</option>`;

    this._toolbarRegion.innerHTML = `
      <div class="dauligor-monster-browser__toolbar">
        <input type="search" class="dauligor-monster-browser__search" data-action="mb-search"
          placeholder="Search monsters…" value="${escapeHtml(this._search)}" />
        <select class="dauligor-monster-browser__filter" data-action="mb-filter" data-axis="cr">
          ${opt("", "All CR", this._filters.cr)}${CR_BANDS.map((b) => opt(b.key, b.label, this._filters.cr)).join("")}
        </select>
        <select class="dauligor-monster-browser__filter" data-action="mb-filter" data-axis="type">
          ${opt("", "All Types", this._filters.type)}${types.map((t) => opt(t, t.charAt(0).toUpperCase() + t.slice(1), this._filters.type)).join("")}
        </select>
        <select class="dauligor-monster-browser__filter" data-action="mb-filter" data-axis="size">
          ${opt("", "All Sizes", this._filters.size)}${sizes.map((s) => opt(s, SIZE_LABELS[s] ?? s, this._filters.size)).join("")}
        </select>
        <button type="button" class="dauligor-monster-browser__reload" data-action="mb-reload" title="Reload">↻</button>
      </div>
    `;

    this._toolbarRegion.querySelector(`[data-action="mb-search"]`)?.addEventListener("input", (ev) => {
      this._search = ev.target.value ?? "";
      this._renderBody();
      this._renderFooter();
    });
    this._toolbarRegion.querySelectorAll(`[data-action="mb-filter"]`).forEach((sel) => {
      sel.addEventListener("change", (ev) => {
        this._filters[ev.target.dataset.axis] = ev.target.value ?? "";
        this._renderBody();
        this._renderFooter();
      });
    });
    this._toolbarRegion.querySelector(`[data-action="mb-reload"]`)?.addEventListener("click", () => this._loadPool());
  }

  _renderBody() {
    if (!this._bodyRegion) return;
    if (this._pool.status === "loading") {
      this._bodyRegion.innerHTML = `<div class="dauligor-monster-browser__empty">Loading monsters…</div>`;
      return;
    }
    const rows = this._filteredEntries();
    if (!rows.length) {
      this._bodyRegion.innerHTML = `<div class="dauligor-monster-browser__empty">${
        this._pool.entries.length ? "No monsters match the current filters." : (this._status || "No monsters.")
      }</div>`;
      return;
    }
    const allChecked = rows.length > 0 && rows.every((r) => this._selected.has(r.identifier));
    this._bodyRegion.innerHTML = `
      <div class="dauligor-monster-browser__table">
        <div class="dauligor-monster-browser__head">
          <span class="dauligor-monster-browser__cell dauligor-monster-browser__cell--check">
            <input type="checkbox" data-action="mb-toggle-all" ${allChecked ? "checked" : ""} />
          </span>
          <span class="dauligor-monster-browser__cell dauligor-monster-browser__cell--name">Name</span>
          <span class="dauligor-monster-browser__cell dauligor-monster-browser__cell--cr">CR</span>
          <span class="dauligor-monster-browser__cell dauligor-monster-browser__cell--type">Type</span>
          <span class="dauligor-monster-browser__cell dauligor-monster-browser__cell--size">Size</span>
          <span class="dauligor-monster-browser__cell dauligor-monster-browser__cell--source">Source</span>
        </div>
        <div class="dauligor-monster-browser__rows">
          ${rows.map((e) => `
            <label class="dauligor-monster-browser__row ${this._selected.has(e.identifier) ? "is-selected" : ""}">
              <span class="dauligor-monster-browser__cell dauligor-monster-browser__cell--check">
                <input type="checkbox" data-action="mb-toggle" data-id="${escapeHtml(e.identifier)}" ${this._selected.has(e.identifier) ? "checked" : ""} />
              </span>
              <span class="dauligor-monster-browser__cell dauligor-monster-browser__cell--name">${escapeHtml(e.name)}</span>
              <span class="dauligor-monster-browser__cell dauligor-monster-browser__cell--cr">${escapeHtml(crLabel(e.cr))}</span>
              <span class="dauligor-monster-browser__cell dauligor-monster-browser__cell--type">${escapeHtml(e.type ? e.type.charAt(0).toUpperCase() + e.type.slice(1) : "—")}</span>
              <span class="dauligor-monster-browser__cell dauligor-monster-browser__cell--size">${escapeHtml(SIZE_LABELS[e.size] ?? e.size ?? "—")}</span>
              <span class="dauligor-monster-browser__cell dauligor-monster-browser__cell--source">${escapeHtml(e.source)}</span>
            </label>
          `).join("")}
        </div>
      </div>
    `;

    this._bodyRegion.querySelector(`[data-action="mb-toggle-all"]`)?.addEventListener("change", (ev) => {
      const checked = ev.target.checked;
      for (const r of rows) {
        if (checked) this._selected.add(r.identifier);
        else this._selected.delete(r.identifier);
      }
      this._renderBody();
      this._renderFooter();
    });
    this._bodyRegion.querySelectorAll(`[data-action="mb-toggle"]`).forEach((box) => {
      box.addEventListener("change", (ev) => {
        const id = ev.target.dataset.id;
        if (!id) return;
        if (ev.target.checked) this._selected.add(id);
        else this._selected.delete(id);
        ev.target.closest(".dauligor-monster-browser__row")?.classList.toggle("is-selected", ev.target.checked);
        this._renderFooter();
      });
    });
  }

  _renderFooter() {
    if (!this._footerRegion) return;
    const count = this._selected.size;
    this._footerRegion.innerHTML = `
      <div class="dauligor-monster-browser__footer">
        <span class="dauligor-monster-browser__status ${this._statusLevel ? `is-${this._statusLevel}` : ""}">${escapeHtml(this._status)}</span>
        <button type="button" class="dauligor-monster-browser__import" data-action="mb-import"
          ${count && !this._importing ? "" : "disabled"}>
          ${this._importing ? "Importing…" : `Import ${count || ""} Monster${count === 1 ? "" : "s"}`.trim()}
        </button>
      </div>
    `;
    this._footerRegion.querySelector(`[data-action="mb-import"]`)?.addEventListener("click", () => this._importSelected());
  }

  // ── import ──────────────────────────────────────────────────────────────────

  async _ensureFolder() {
    const existing = game.folders?.find((f) => f.type === "Actor" && f.name === this._folderName);
    if (existing) return existing.id;
    try {
      const created = await Folder.create({ name: this._folderName, type: "Actor" });
      return created?.id ?? null;
    } catch (err) {
      log("warn", "monster import: could not create folder", err);
      return null;
    }
  }

  _detailUrl(entry) {
    const raw = String(entry.detailUrl || "");
    if (!raw) return null;
    if (/^https?:\/\//i.test(raw)) return raw;
    const host = resolveApiHost();
    // Catalog emits source-relative URLs (e.g. "mm/monsters/aarakocra.json").
    return `${host}/api/module/${raw.replace(/^\/+/, "")}`;
  }

  async _importSelected() {
    if (this._importing) return;
    if (!game.user?.isGM) { notifyWarn("Only a GM can import monsters."); return; }
    const chosen = this._pool.entries.filter((e) => this._selected.has(e.identifier));
    if (!chosen.length) return;

    this._importing = true;
    this._status = `Importing ${chosen.length} monster${chosen.length === 1 ? "" : "s"}…`;
    this._statusLevel = "";
    this._renderFooter();

    const folder = await this._ensureFolder();
    let ok = 0;
    const failed = [];
    for (const entry of chosen) {
      const url = this._detailUrl(entry);
      if (!url) { failed.push(entry.name); continue; }
      try {
        const res = await fetchJsonWithRetry(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const bundle = await res.json();
        const actor = await importMonsterActor(bundle, { folder, render: false });
        if (actor) { ok += 1; this._selected.delete(entry.identifier); } else failed.push(entry.name);
      } catch (err) {
        log("warn", `monster import failed: ${entry.name}`, err);
        failed.push(entry.name);
      }
    }

    this._importing = false;
    if (ok) notifyInfo(`Imported ${ok} monster${ok === 1 ? "" : "s"} into "${this._folderName}".`);
    if (failed.length) notifyWarn(`Couldn't import ${failed.length}: ${failed.slice(0, 5).join(", ")}${failed.length > 5 ? "…" : ""}`);
    this._status = `Imported ${ok}/${chosen.length}.${failed.length ? ` ${failed.length} failed.` : ""}`;
    this._statusLevel = failed.length ? "warn" : "success";
    this._renderBody();
    this._renderFooter();
  }
}

export async function openMonsterBrowser({ sourceSlugs = [], folderPath = "" } = {}) {
  return DauligorMonsterBrowserApp.open({ sourceSlugs, folderPath });
}
