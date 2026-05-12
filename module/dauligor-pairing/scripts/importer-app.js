import {
  CLASS_BROWSER_TEMPLATE,
  CLASS_CATALOG_FILE,
  CLASS_OPTIONS_TEMPLATE,
  IMPORTER_TEMPLATE,
  MODULE_ID,
  SETTINGS,
  SOURCE_LIBRARY_FILE
} from "./constants.js";
import { buildClassImportWorkflow, fetchClassCatalog, fetchJson, fetchSourceCatalog, importClassPayloadToWorld } from "./class-import-service.js";
import { maybeOfferSpellPointsSupport } from "./spell-points-service.js";
import { log, notifyInfo, notifyWarn } from "./utils.js";
import { baseClassHandler, extractStrings, formatFoundryLabel } from "./importer-base-features.js";
import { CharacterUpdater, isAlreadyMarked } from "./update-character.js";
import {
  evaluateRequirementsTree,
  formatRequirementsTree,
  formatMissingLeaves,
  treeFromFlatRequiresOptionIds
} from "./requirements-walker.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const IMPORT_TYPES = [
  {
    id: "classes-subclasses",
    label: "Classes & Subclasses",
    status: "ready",
    description: "Browse class payloads grouped by class, with nested subclasses pulled from the selected source."
  },
  {
    id: "items",
    label: "Items",
    status: "soon",
    description: "Weapon, armor, consumable, and item-family importing will plug into this same wizard."
  },
  {
    id: "spells",
    label: "Spells",
    status: "soon",
    description: "Spell browsing and import filtering will be added after the class browser stabilizes."
  },
  {
    id: "feats",
    label: "Feats",
    status: "soon",
    description: "General feat importing will follow the same source and browser model."
  }
];

const SOURCE_TYPES = {
  "classes-subclasses": [],
  items: [
    {
      id: "srd",
      label: "SRD",
      status: "soon",
      description: "Reserved source slot for item-family payloads once the endpoint is ready."
    }
  ],
  spells: [
    {
      id: "srd",
      label: "SRD",
      status: "soon",
      description: "Reserved source slot for spell payloads once the endpoint is ready."
    }
  ],
  feats: [
    {
      id: "srd",
      label: "SRD",
      status: "soon",
      description: "Reserved source slot for feat payloads once the endpoint is ready."
    }
  ]
};

const CLASS_VARIANT_PRIORITY = {
  "dauligor.semantic.class-export": 0,
  "dauligor.class-bundle.v1": 1,
  "foundry.item.class": 2
};

import {
  clampLevel,
  normalizeSelectionIds,
  normalizeSourceTypeIds,
  normalizeCatalogUrls,
  normalizeImportTypeId,
  getDefaultSourceTypeId,
  ensureArray,
  slugify,
  stripHtml,
  summarizeHtml
} from "./importer-utils.js";

/**
 * Compute a centered `position` object for an ApplicationV2 window.
 *
 * Foundry's ApplicationV2 mounts new windows at the document's
 * default (top-left, `top: 0; left: 0`) before its centering math
 * runs — visible as a brief flash where the window appears in the
 * corner then jumps to the middle of the screen. Setting `top` and
 * `left` explicitly in the constructor's `position` skips the flash
 * because the window's first paint is already at its final spot.
 *
 * Caps `top` and `left` at 0 so the window never starts off-screen
 * for narrow viewports.
 */
function centeredAppPosition(width, height) {
  const viewportW = window.innerWidth || 0;
  const viewportH = window.innerHeight || 0;
  return {
    width,
    height,
    left: Math.max(0, Math.round((viewportW - width) / 2)),
    top: Math.max(0, Math.round((viewportH - height) / 2))
  };
}

export class DauligorImporterApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static _instance = null;

  static async open({
    actor = null,
    importTypeId = "classes-subclasses",
    modeId = undefined,
    sourceTypeId = undefined,
    sourceTypeIds = undefined,
    selectedEntryIds = undefined,
    targetLevel = undefined,
    status = undefined,
    statusLevel = undefined
  } = {}) {
    importTypeId = normalizeImportTypeId(importTypeId, modeId);

    if (this._instance) {
      this._instance.setTargetActor(actor ?? null);
      this._instance.setImportType(importTypeId);
      this._instance.setSourceTypes(sourceTypeIds ?? normalizeSourceTypeIds(sourceTypeId));
      this._instance.setSelectedEntryIds(selectedEntryIds);
      if (targetLevel !== undefined) this._instance.setTargetLevel(targetLevel);
      if (status !== undefined) this._instance.setStatus(status, statusLevel);

      const mode = game.settings.get(MODULE_ID, SETTINGS.apiEndpointMode) || "local";
      const host = mode === "production" ? "https://www.dauligor.com" : "http://localhost:3000";
      const newUrl = `${host}/api/module/sources`;
      // Only invalidate the cached source catalog when the URL actually
      // changes (e.g. user toggled between local/production in module
      // settings). The previous unconditional invalidation forced a
      // network round-trip on every importer open, which was the main
      // contributor to "the importer takes a while to load" — the
      // catalog rarely changes between reopens within a session.
      // `_sourcesLoadedUrl` tracks the URL the cached catalog was
      // fetched from; see `_loadWizardSources` for the read side.
      if (this._instance._state.sourceCatalogUrl !== newUrl) {
        this._instance._sourcesLoaded = false;
        this._instance._sourcesLoadedUrl = null;
      }
      this._instance._state.sourceCatalogUrl = newUrl;
      this._instance._sourcesLoading = false;

      this._instance.render({ force: true });
      this._instance.maximize?.();
      return this._instance;
    }

    const instance = new this({
      actor,
      importTypeId,
      sourceTypeId,
      sourceTypeIds,
      selectedEntryIds,
      targetLevel,
      status,
      statusLevel
    });
    this._instance = instance;
    instance.render({ force: true });
    return instance;
  }

  constructor({
    actor = null,
    importTypeId = "classes-subclasses",
    modeId = undefined,
    sourceTypeId = undefined,
    sourceTypeIds = undefined,
    selectedEntryIds = undefined,
    targetLevel = undefined,
    status = undefined,
    statusLevel = undefined
  } = {}) {
    importTypeId = normalizeImportTypeId(importTypeId, modeId);
    const normalizedSourceTypeIds = normalizeSourceTypeIds(sourceTypeIds, sourceTypeId ?? getDefaultSourceTypeId(importTypeId));

    super({
      id: `${MODULE_ID}-wizard`,
      classes: ["dauligor-importer-app", "dauligor-importer-app--wizard"],
      window: {
        title: actor ? `Dauligor Import Wizard: ${actor.name}` : "Dauligor Import Wizard",
        resizable: true,
        contentClasses: ["dauligor-importer-window"]
      },
      position: centeredAppPosition(
        Math.min(window.innerWidth - 120, 1120),
        Math.min(window.innerHeight - 120, 640)
      )
    });

    this._template = IMPORTER_TEMPLATE;
    this._actor = actor ?? null;
    this._state = {
      importTypeId,
      sourceTypeId: normalizedSourceTypeIds[0] ?? getDefaultSourceTypeId(importTypeId),
      selectedSourceIds: normalizedSourceTypeIds,
      sourceSearch: "",
      sourceCatalogUrl: (function () {
        const mode = game.settings.get(MODULE_ID, SETTINGS.apiEndpointMode) || "local";
        const host = mode === "production" ? "https://www.dauligor.com" : "http://localhost:3000";
        return `${host}/api/module/sources`;
      })(),
      catalogUrl: game.settings.get(MODULE_ID, SETTINGS.defaultClassCatalogUrl) || CLASS_CATALOG_FILE,
      folderPath: game.settings.get(MODULE_ID, SETTINGS.defaultClassFolderPath) || "Classes",
      targetLevel: clampLevel(targetLevel ?? 1),
      selectedEntryIds: normalizeSelectionIds(selectedEntryIds),
      status: status ?? "",
      statusLevel: statusLevel ?? ""
    };
    this._sourceCatalog = null;
    this._sourceEntries = [];
    this._sourcesLoaded = false;
    this._sourcesLoading = false;
    // URL the cached catalog was loaded from. Compared against the
    // current `_state.sourceCatalogUrl` to decide whether to refetch
    // on a re-open — avoids the per-open network round-trip that used
    // to be unconditional. See the static `open()` method's URL diff.
    this._sourcesLoadedUrl = null;
  }

  _configureRenderParts() {
    return {
      main: {
        template: this._template
      }
    };
  }

  async close(options) {
    if (DauligorImporterApp._instance === this) DauligorImporterApp._instance = null;
    return super.close(options);
  }

  setTargetActor(actor) {
    this._actor = actor ?? null;
    this.options.window.title = this._actor ? `Dauligor Import Wizard: ${this._actor.name}` : "Dauligor Import Wizard";
  }

  setImportType(importTypeId) {
    if (!importTypeId) return;
    this._state.importTypeId = importTypeId;
    this._state.sourceTypeId = getDefaultSourceTypeId(importTypeId);
    this._state.selectedSourceIds = importTypeId === "classes-subclasses"
      ? []
      : normalizeSourceTypeIds(getDefaultSourceTypeId(importTypeId));
    this._state.sourceSearch = "";
    if (importTypeId === "classes-subclasses") this._sourcesLoaded = false;
  }

  setSourceType(sourceTypeId) {
    if (!sourceTypeId) return;
    this._state.sourceTypeId = sourceTypeId;
    this._state.selectedSourceIds = normalizeSourceTypeIds(sourceTypeId);
  }

  setSourceTypes(sourceTypeIds) {
    const normalized = normalizeSourceTypeIds(sourceTypeIds);
    if (!normalized.length) return;
    this._state.selectedSourceIds = normalized;
    this._state.sourceTypeId = normalized[0] ?? null;
  }

  setSelectedEntryIds(entryIds) {
    this._state.selectedEntryIds = normalizeSelectionIds(entryIds);
  }

  setTargetLevel(level) {
    this._state.targetLevel = clampLevel(level);
  }

  setStatus(message = "", level = undefined) {
    this._state.status = message ?? "";
    if (level !== undefined) this._state.statusLevel = level ?? "";
  }

  async _onRender() {
    super._onRender?.(...arguments);

    const root = this._getRootElement();
    if (!root) return;

    const content = root.querySelector(".window-content") ?? root;
    this._panelTypes = content.querySelector(`[data-panel="modes"]`);
    this._panelSources = content.querySelector(`[data-panel="sources"]`);
    this._panelOptions = content.querySelector(`[data-panel="config"]`);
    this._footerPanel = content.querySelector(`[data-panel="footer"]`);

    this._renderPanels();
    await this._ensureWizardSourcesLoaded();
  }

  _getRootElement() {
    if (this.element instanceof HTMLElement) return this.element;
    if (this.element?.jquery && this.element[0] instanceof HTMLElement) return this.element[0];
    if (this.element?.[0] instanceof HTMLElement) return this.element[0];
    return document.getElementById(this.id) ?? null;
  }

  _renderPanels() {
    this._renderImportTypesPanel();
    this._renderSourceTypesPanel();
    this._renderImportOptionsPanel();
    this._renderFooterPanel();
  }

  async _ensureWizardSourcesLoaded({ force = false } = {}) {
    if (this._state.importTypeId !== "classes-subclasses") return;
    if ((this._sourcesLoaded || this._sourcesLoading) && !force) return;
    await this._loadWizardSources({ force });
  }

  async _loadWizardSources({ force = false } = {}) {
    if (this._sourcesLoading) return;
    const sourceUrl = this._state.sourceCatalogUrl;
    // Skip the fetch when we already have a fresh catalog for THIS
    // URL. `force=true` (manual "Reload" affordance) still pulls a
    // new copy. `_sourcesLoadedUrl` is set in lockstep with
    // `_sourcesLoaded = true` below.
    if (this._sourcesLoaded && this._sourcesLoadedUrl === sourceUrl && !force) return;

    if (!sourceUrl || !/^https?:\/\//i.test(sourceUrl)) {
      this._sourcesLoading = false;
      this._sourcesLoaded = false;
      this._state.status = "No source library URL configured. Set one in Module Settings → Dauligor Pairing → Source library URL.";
      this._state.statusLevel = "warn";
      this._renderSourceTypesPanel();
      this._renderFooterPanel();
      return;
    }

    this._sourcesLoading = true;
    this._state.status = force ? "Reloading source library..." : "Loading source library...";
    this._state.statusLevel = "";
    this._renderSourceTypesPanel();
    this._renderFooterPanel();

    const catalog = await fetchSourceCatalog(sourceUrl);
    this._sourceCatalog = catalog;
    this._sourceEntries = ensureArray(catalog?.entries)
      .filter((entry) => ensureArray(entry.supportedImportTypes).includes("classes-subclasses") || entry.classCatalogUrl)
      .map((entry) => ({
        id: entry.sourceId,
        label: entry.name,
        status: entry.status ?? "ready",
        description: entry.description ?? "",
        shortName: entry.shortName ?? "",
        detailUrl: entry.detailUrl ?? null,
        classCatalogUrl: entry.classCatalogUrl ?? null,
        count: Number(entry.counts?.classes ?? 0) || 0,
        tags: ensureArray(entry.tags),
        rules: entry.rules ?? "",
        slug: entry.slug ?? ""
      }));

    const readySourceIds = this._sourceEntries.filter((entry) => entry.status === "ready").map((entry) => entry.id);
    const validSelectedSourceIds = normalizeSourceTypeIds(this._state.selectedSourceIds)
      .filter((id) => this._sourceEntries.some((entry) => entry.id === id));
    this._state.selectedSourceIds = validSelectedSourceIds.length
      ? validSelectedSourceIds
      : (readySourceIds.length ? readySourceIds : this._sourceEntries.map((entry) => entry.id));
    this._state.sourceTypeId = this._state.selectedSourceIds[0] ?? this._sourceEntries[0]?.id ?? null;

    this._state.status = this._sourceEntries.length
      ? `Loaded ${this._sourceEntries.length} source${this._sourceEntries.length === 1 ? "" : "s"} for classes.`
      : "No class-capable sources were found in the local source library.";
    this._state.statusLevel = this._sourceEntries.length ? "success" : "danger";
    this._sourcesLoaded = true;
    // Pair with `_sourcesLoaded = true` so a same-URL reopen can
    // short-circuit the fetch. The URL is what we just fetched
    // from, not whatever the state holds at read-time later
    // (defensive in case the state mutates between fetch and now).
    this._sourcesLoadedUrl = sourceUrl;
    this._sourcesLoading = false;
    this._renderSourceTypesPanel();
    this._renderFooterPanel();
  }

  _renderImportTypesPanel() {
    if (!this._panelTypes) return;

    const rowsHtml = IMPORT_TYPES.map((type) => `
      <button
        type="button"
        class="dauligor-wizard__choice ${type.id === this._state.importTypeId ? "dauligor-wizard__choice--active" : ""} ${type.status !== "ready" ? "dauligor-wizard__choice--disabled" : ""}"
        data-action="select-import-type"
        data-import-type-id="${type.id}"
        ${type.status !== "ready" ? "disabled" : ""}
      >
        <div class="dauligor-wizard__choice-header">
          <span class="dauligor-wizard__choice-label">${foundry.utils.escapeHTML(type.label)}</span>
          <span class="dauligor-wizard__choice-meta">
            <span class="dauligor-wizard__badge dauligor-wizard__badge--${type.status}">${foundry.utils.escapeHTML(type.status)}</span>
            <span class="dauligor-wizard__choice-arrow" aria-hidden="true">&#187;</span>
          </span>
        </div>
      </button>
    `).join("");

    this._panelTypes.innerHTML = `
      <section class="dauligor-wizard__section">
        <header class="dauligor-wizard__section-head">
          <h2 class="dauligor-wizard__heading"><span class="dauligor-wizard__step">1:</span> <span class="dauligor-wizard__title">Choose Importer</span></h2>
        </header>
        <div class="dauligor-wizard__section-body dauligor-wizard__section-body--scroll">
          <div class="dauligor-wizard__choice-list dauligor-wizard__choice-list--compact">${rowsHtml}</div>
        </div>
      </section>
    `;

    this._panelTypes.querySelectorAll(`[data-action="select-import-type"]`).forEach((button) => {
      button.addEventListener("click", async () => {
        const importTypeId = button.dataset.importTypeId;
        if (!importTypeId) return;
        this._state.importTypeId = importTypeId;
        this._state.sourceTypeId = getDefaultSourceTypeId(importTypeId);
        this._state.selectedSourceIds = importTypeId === "classes-subclasses"
          ? []
          : normalizeSourceTypeIds(this._state.sourceTypeId);
        this._state.sourceSearch = "";
        this._renderPanels();
        await this._ensureWizardSourcesLoaded();
      });
    });
  }

  _renderSourceTypesPanel() {
    if (!this._panelSources) return;

    const sources = this._state.importTypeId === "classes-subclasses"
      ? this._sourceEntries
      : getSourceTypes(this._state.importTypeId);
    const selectedSourceIds = new Set(normalizeSourceTypeIds(this._state.selectedSourceIds, this._state.sourceTypeId));
    const search = this._state.sourceSearch.trim().toLowerCase();
    const visibleSources = sources.filter((source) => {
      if (!search) return true;
      return source.label.toLowerCase().includes(search)
        || source.id.toLowerCase().includes(search)
        || String(source.shortName ?? "").toLowerCase().includes(search)
        || String(source.rules ?? "").toLowerCase().includes(search)
        || ensureArray(source.tags).some((tag) => String(tag).toLowerCase().includes(search));
    });
    const readyVisibleSources = visibleSources.filter((source) => source.status === "ready");
    const allVisibleSelected = readyVisibleSources.length > 0 && readyVisibleSources.every((source) => selectedSourceIds.has(source.id));

    const rowsHtml = this._state.importTypeId === "classes-subclasses" && this._sourcesLoading
      ? `<div class="dauligor-wizard__empty">Loading available sources...</div>`
      : this._state.importTypeId === "classes-subclasses" && visibleSources.length
        ? `
        <div class="dauligor-wizard__source-table">
          <div class="dauligor-wizard__source-header">
            <span class="dauligor-wizard__source-cell dauligor-wizard__source-cell--select">
              <input
                type="checkbox"
                class="dauligor-wizard__source-checkbox"
                data-action="toggle-all-sources"
                ${allVisibleSelected ? "checked" : ""}
                ${readyVisibleSources.length ? "" : "disabled"}
              >
            </span>
            <span class="dauligor-wizard__source-cell dauligor-wizard__source-cell--name">Name</span>
            <span class="dauligor-wizard__source-cell dauligor-wizard__source-cell--short">Short</span>
            <span class="dauligor-wizard__source-cell dauligor-wizard__source-cell--rules">Rules</span>
            <span class="dauligor-wizard__source-cell dauligor-wizard__source-cell--count">Classes</span>
          </div>
          <div class="dauligor-wizard__source-body">
            ${visibleSources.map((source) => {
          const isSelected = selectedSourceIds.has(source.id);
          const isReady = source.status === "ready";
          return `
                <label class="dauligor-wizard__source-row ${isSelected ? "dauligor-wizard__source-row--selected" : ""} ${!isReady ? "dauligor-wizard__source-row--disabled" : ""}">
                  <span class="dauligor-wizard__source-cell dauligor-wizard__source-cell--select">
                    <input
                      type="checkbox"
                      class="dauligor-wizard__source-checkbox"
                      data-action="toggle-source-type"
                      data-source-type-id="${foundry.utils.escapeHTML(source.id)}"
                      ${isSelected ? "checked" : ""}
                      ${isReady ? "" : "disabled"}
                    >
                  </span>
                  <span class="dauligor-wizard__source-cell dauligor-wizard__source-cell--name">
                    <span class="dauligor-wizard__source-name">${foundry.utils.escapeHTML(source.label)}</span>
                    <span class="dauligor-wizard__badge dauligor-wizard__badge--${source.status}">${foundry.utils.escapeHTML(source.status)}</span>
                  </span>
                  <span class="dauligor-wizard__source-cell dauligor-wizard__source-cell--short">${source.shortName ? foundry.utils.escapeHTML(source.shortName) : "&mdash;"}</span>
                  <span class="dauligor-wizard__source-cell dauligor-wizard__source-cell--rules">${source.rules ? foundry.utils.escapeHTML(String(source.rules)) : "&mdash;"}</span>
                  <span class="dauligor-wizard__source-cell dauligor-wizard__source-cell--count">${foundry.utils.escapeHTML(String(source.count ?? 0))}</span>
                </label>
              `;
        }).join("")}
          </div>
        </div>
      `
        : visibleSources.length
          ? visibleSources.map((source) => `
        <button
          type="button"
        class="dauligor-wizard__choice ${source.id === this._state.sourceTypeId ? "dauligor-wizard__choice--active" : ""} ${source.status !== "ready" ? "dauligor-wizard__choice--disabled" : ""}"
        data-action="select-source-type"
        data-source-type-id="${source.id}"
        ${source.status !== "ready" ? "disabled" : ""}
        >
          <div class="dauligor-wizard__choice-header">
            <span class="dauligor-wizard__choice-label">${foundry.utils.escapeHTML(source.label)}${source.shortName ? ` <span class="dauligor-wizard__choice-label-secondary">${foundry.utils.escapeHTML(source.shortName)}</span>` : ""}</span>
            <span class="dauligor-wizard__choice-meta">
              <span class="dauligor-wizard__badge dauligor-wizard__badge--${source.status}">${foundry.utils.escapeHTML(source.status)}</span>
            </span>
          </div>
          ${this._state.importTypeId === "classes-subclasses" ? `
            <div class="dauligor-wizard__choice-submeta">
              <span>${source.count} class${source.count === 1 ? "" : "es"}</span>
              ${source.rules ? `<span>${foundry.utils.escapeHTML(String(source.rules))}</span>` : ""}
            </div>
          ` : ""}
        </button>
      `).join("")
          : `<div class="dauligor-wizard__empty">${this._state.importTypeId === "classes-subclasses" ? "No sources matched the current search." : "No source types match the current search."}</div>`;

    this._panelSources.innerHTML = `
      <section class="dauligor-wizard__section">
        <header class="dauligor-wizard__section-head">
          <h2 class="dauligor-wizard__heading"><span class="dauligor-wizard__step">2:</span> <span class="dauligor-wizard__title">Choose Data Source</span></h2>
        </header>
        <div class="dauligor-wizard__section-body">
            <div class="dauligor-wizard__toolbar">
              <button type="button" class="dauligor-wizard__toolbar-button" data-action="source-filter">Filter</button>
              <input
                type="search"
              class="dauligor-wizard__toolbar-search"
              data-action="source-search"
              value="${foundry.utils.escapeHTML(this._state.sourceSearch)}"
              placeholder="Find source..."
                autocomplete="off"
                spellcheck="false"
              >
              ${this._state.importTypeId === "classes-subclasses"
        ? `<button type="button" class="dauligor-wizard__toolbar-button" data-action="source-reload">Reload</button>`
        : ""}
              <button type="button" class="dauligor-wizard__toolbar-button" data-action="reset-source-search">Reset</button>
            </div>
            <div class="dauligor-wizard__choice-list dauligor-wizard__choice-list--compact dauligor-wizard__choice-list--scroll">${rowsHtml}</div>
        </div>
      </section>
    `;

    this._panelSources.querySelector(`[data-action="source-filter"]`)?.addEventListener("click", () => {
      notifyWarn("Source filters are not wired up yet.");
    });
    this._panelSources.querySelector(`[data-action="source-search"]`)?.addEventListener("input", (event) => {
      const value = event.currentTarget.value ?? "";
      this._state.sourceSearch = value;
      this._renderSourceTypesPanel();
      const searchInput = this._panelSources?.querySelector(`[data-action="source-search"]`);
      if (searchInput) {
        searchInput.focus();
        searchInput.setSelectionRange?.(value.length, value.length);
      }
    });
    this._panelSources.querySelector(`[data-action="reset-source-search"]`)?.addEventListener("click", () => {
      this._state.sourceSearch = "";
      this._renderSourceTypesPanel();
    });
    this._panelSources.querySelector(`[data-action="source-reload"]`)?.addEventListener("click", async () => {
      await this._ensureWizardSourcesLoaded({ force: true });
    });

    this._panelSources.querySelector(`[data-action="toggle-all-sources"]`)?.addEventListener("change", (event) => {
      const nextSelection = new Set(normalizeSourceTypeIds(this._state.selectedSourceIds, this._state.sourceTypeId));
      for (const source of readyVisibleSources) {
        if (event.currentTarget.checked) nextSelection.add(source.id);
        else nextSelection.delete(source.id);
      }
      this._state.selectedSourceIds = [...nextSelection];
      this._state.sourceTypeId = this._state.selectedSourceIds[0] ?? null;
      this._renderPanels();
    });
    this._panelSources.querySelectorAll(`[data-action="toggle-source-type"]`).forEach((input) => {
      input.addEventListener("change", () => {
        const sourceTypeId = input.dataset.sourceTypeId;
        if (!sourceTypeId) return;
        const nextSelection = new Set(normalizeSourceTypeIds(this._state.selectedSourceIds, this._state.sourceTypeId));
        if (input.checked) nextSelection.add(sourceTypeId);
        else nextSelection.delete(sourceTypeId);
        this._state.selectedSourceIds = [...nextSelection];
        this._state.sourceTypeId = this._state.selectedSourceIds[0] ?? null;
        this._renderPanels();
      });
    });
    this._panelSources.querySelectorAll(`[data-action="select-source-type"]`).forEach((button) => {
      button.addEventListener("click", () => {
        const sourceTypeId = button.dataset.sourceTypeId;
        if (!sourceTypeId) return;
        this._state.sourceTypeId = sourceTypeId;
        this._state.selectedSourceIds = normalizeSourceTypeIds(sourceTypeId);
        this._renderPanels();
      });
    });
  }

  _renderImportOptionsPanel() {
    if (!this._panelOptions) return;

    this._panelOptions.innerHTML = `
      <section class="dauligor-wizard__section">
        <header class="dauligor-wizard__section-head">
          <h2 class="dauligor-wizard__heading"><span class="dauligor-wizard__step">3:</span> <span class="dauligor-wizard__title">Import Options</span></h2>
          <p class="dauligor-wizard__subtitle">This column is reserved for importer-specific setup. It stays empty until that workflow is wired in.</p>
        </header>
        <div class="dauligor-wizard__section-body dauligor-wizard__section-body--empty"></div>
      </section>
    `;
  }

  _renderFooterPanel() {
    if (!this._footerPanel) return;

    const importType = getImportType(this._state.importTypeId);
    const sources = this._state.importTypeId === "classes-subclasses" ? this._sourceEntries : getSourceTypes(this._state.importTypeId);
    const selectedSources = sources.filter((source) => normalizeSourceTypeIds(this._state.selectedSourceIds, this._state.sourceTypeId).includes(source.id));
    const sourceType = selectedSources[0] ?? sources.find((source) => source.id === this._state.sourceTypeId) ?? null;
    const importReady = importType?.status === "ready"
      && selectedSources.length > 0
      && selectedSources.every((candidate) => candidate.status === "ready");

    this._footerPanel.innerHTML = `
      <div class="dauligor-importer__footer-status dauligor-wizard__status ${this._state.statusLevel ? `dauligor-wizard__status--${this._state.statusLevel}` : ""}">
        ${this._state.status ? foundry.utils.escapeHTML(this._state.status) : ""}
      </div>
      <div class="dauligor-importer__footer-actions">
        <button type="button" class="dauligor-wizard__button" data-action="cancel">Cancel</button>
        <button type="button" class="dauligor-wizard__button dauligor-wizard__button--primary" data-action="open-importer" ${importReady ? "" : "disabled"}>Open Importer</button>
      </div>
    `;

    this._footerPanel.querySelector(`[data-action="cancel"]`)?.addEventListener("click", async () => {
      await this.close();
    });
    this._footerPanel.querySelector(`[data-action="open-importer"]`)?.addEventListener("click", async () => {
      await this._openImporter();
    });
  }

  async _openImporter() {
    const importType = getImportType(this._state.importTypeId);
    const sources = this._state.importTypeId === "classes-subclasses" ? this._sourceEntries : getSourceTypes(this._state.importTypeId);
    const selectedSources = sources.filter((source) => normalizeSourceTypeIds(this._state.selectedSourceIds, this._state.sourceTypeId).includes(source.id));
    const sourceType = selectedSources[0] ?? sources.find((source) => source.id === this._state.sourceTypeId) ?? null;

    if (importType?.status !== "ready" || !selectedSources.length || selectedSources.some((candidate) => candidate.status !== "ready")) {
      notifyWarn(`${importType?.label ?? "This importer"} is not wired up yet.`);
      return;
    }

    if (this._state.importTypeId === "classes-subclasses") {
      const mode = game.settings.get(MODULE_ID, SETTINGS.apiEndpointMode) || "local";
      const host = mode === "production" ? "https://www.dauligor.com" : "http://localhost:3000";
      const catalogUrls = [...new Set(selectedSources.map((source) => source.classCatalogUrl).filter(Boolean))].map((url) => {
        if (!/^https?:\/\//i.test(url)) {
          return `${host}/api/module/${url}`;
        }
        return url;
      });
      await openDauligorClassBrowser({
        actor: this._actor,
        catalogUrl: catalogUrls[0] ?? `${host}/api/module/uah/classes/catalog.json`,
        catalogUrls,
        folderPath: this._state.folderPath,
        targetLevel: this._state.targetLevel,
        sourceTypeId: this._state.sourceTypeId,
        sourceTypeIds: selectedSources.map((source) => source.id),
        preferredSelectionIds: this._state.selectedEntryIds
      });
      await this.close();
      return;
    }

    notifyWarn(`${importType?.label ?? "This importer"} browser is planned, but classes are the only active flow right now.`);
  }
}

class DauligorClassBrowserApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static _instance = null;

  static async open({
    actor = null,
    catalogUrl = CLASS_CATALOG_FILE,
    catalogUrls = undefined,
    folderPath = "Classes",
    targetLevel = 1,
    sourceTypeId = "srd",
    sourceTypeIds = undefined,
    preferredSelectionIds = undefined
  } = {}) {
    if (this._instance) {
      this._instance.setTargetActor(actor ?? null);
      this._instance.setCatalogUrls(catalogUrls ?? normalizeCatalogUrls(catalogUrl));
      this._instance.setFolderPath(folderPath);
      this._instance.setTargetLevel(targetLevel);
      this._instance.setSourceTypes(sourceTypeIds ?? normalizeSourceTypeIds(sourceTypeId));
      this._instance.setPreferredSelectionIds(preferredSelectionIds);
      this._instance.render({ force: true });
      this._instance.maximize?.();
      return this._instance;
    }

    const instance = new this({
      actor,
      catalogUrl,
      catalogUrls,
      folderPath,
      targetLevel,
      sourceTypeId,
      sourceTypeIds,
      preferredSelectionIds
    });
    this._instance = instance;
    instance.render({ force: true });
    return instance;
  }

  constructor({
    actor = null,
    catalogUrl = CLASS_CATALOG_FILE,
    catalogUrls = undefined,
    folderPath = "Classes",
    targetLevel = 1,
    sourceTypeId = "srd",
    sourceTypeIds = undefined,
    preferredSelectionIds = undefined
  } = {}) {
    const normalizedCatalogUrls = normalizeCatalogUrls(catalogUrls, catalogUrl);
    const normalizedSourceTypeIds = normalizeSourceTypeIds(sourceTypeIds, sourceTypeId);

    super({
      id: `${MODULE_ID}-class-browser`,
      classes: ["dauligor-importer-app", "dauligor-importer-app--browser"],
      window: {
        title: actor ? `Import Classes & Subclasses: ${actor.name}` : "Import Classes & Subclasses",
        resizable: true,
        contentClasses: ["dauligor-importer-window"]
      },
      position: centeredAppPosition(
        Math.min(window.innerWidth - 100, 860),
        Math.min(window.innerHeight - 100, 760)
      )
    });

    this._template = CLASS_BROWSER_TEMPLATE;
    this._actor = actor ?? null;
    this._state = {
      catalogUrl: normalizedCatalogUrls[0] ?? catalogUrl,
      catalogUrls: normalizedCatalogUrls.length ? normalizedCatalogUrls : [catalogUrl],
      folderPath: folderPath || "Classes",
      targetLevel: clampLevel(targetLevel ?? 1),
      sourceTypeId: normalizedSourceTypeIds[0] ?? sourceTypeId,
      selectedSourceIds: normalizedSourceTypeIds,
      search: "",
      tagFilter: "__all__",
      selectedClassSourceId: null,
      selectedSubclassSourceId: null,
      preferredSelectionIds: normalizeSelectionIds(preferredSelectionIds),
      status: "",
      statusLevel: "",
      isLoading: false
    };
    this._catalog = null;
    this._classModels = [];
    this._availableTags = [];
    this._isLoaded = false;
    // Lazy per-class payload cache. Populated when the user clicks Import,
    // not when the browser opens — Phase C avoids eagerly fetching N×120KB
    // bundles just to render a class card grid that already has every
    // field it needs from the catalog metadata.
    this._payloadCache = new Map();
  }

  _configureRenderParts() {
    return {
      main: {
        template: this._template
      }
    };
  }

  async close(options) {
    if (DauligorClassBrowserApp._instance === this) DauligorClassBrowserApp._instance = null;
    return super.close(options);
  }

  setTargetActor(actor) {
    this._actor = actor ?? null;
    this.options.window.title = this._actor ? `Import Classes & Subclasses: ${this._actor.name}` : "Import Classes & Subclasses";
  }

  setCatalogUrl(catalogUrl) {
    if (!catalogUrl || catalogUrl === this._state.catalogUrl) return;
    this._state.catalogUrl = catalogUrl;
    this._state.catalogUrls = [catalogUrl];
    this._isLoaded = false;
  }

  setCatalogUrls(catalogUrls) {
    const normalized = normalizeCatalogUrls(catalogUrls, this._state.catalogUrl);
    if (!normalized.length) return;
    this._state.catalogUrls = normalized;
    this._state.catalogUrl = normalized[0] ?? this._state.catalogUrl;
    this._isLoaded = false;
  }

  setFolderPath(folderPath) {
    this._state.folderPath = folderPath || "Classes";
  }

  setTargetLevel(level) {
    this._state.targetLevel = clampLevel(level ?? 1);
  }

  setSourceType(sourceTypeId) {
    this._state.sourceTypeId = sourceTypeId ?? "srd";
    this._state.selectedSourceIds = normalizeSourceTypeIds(this._state.sourceTypeId);
  }

  setSourceTypes(sourceTypeIds) {
    const normalized = normalizeSourceTypeIds(sourceTypeIds, this._state.sourceTypeId);
    this._state.selectedSourceIds = normalized;
    this._state.sourceTypeId = normalized[0] ?? this._state.sourceTypeId;
  }

  setPreferredSelectionIds(ids) {
    const normalized = normalizeSelectionIds(ids);
    if (!normalized.length) return;
    this._state.preferredSelectionIds = normalized;
    this._applyPreferredSelection();
  }

  async _onRender() {
    super._onRender?.(...arguments);

    const root = this._getRootElement();
    if (!root) return;

    const content = root.querySelector(".window-content") ?? root;
    this._toolbarRegion = content.querySelector(`[data-region="toolbar"]`);
    this._listRegion = content.querySelector(`[data-region="list"]`);
    this._footerRegion = content.querySelector(`[data-region="footer"]`);

    this._renderBrowser();

    if (!this._isLoaded && !this._state.isLoading) {
      await this._loadBrowserData();
    }
  }

  _getRootElement() {
    if (this.element instanceof HTMLElement) return this.element;
    if (this.element?.jquery && this.element[0] instanceof HTMLElement) return this.element[0];
    if (this.element?.[0] instanceof HTMLElement) return this.element[0];
    return document.getElementById(this.id) ?? null;
  }

  _renderBrowser() {
    this._renderToolbar();
    this._renderList();
    this._renderFooter();
  }

  _renderToolbar() {
    if (!this._toolbarRegion) return;

    this._toolbarRegion.innerHTML = `
      <div class="dauligor-class-browser__toolbar">
        <div class="dauligor-class-browser__toolbar-controls">
          <button type="button" class="dauligor-class-browser__button" data-action="filter">Filter</button>
          <button type="button" class="dauligor-class-browser__button dauligor-class-browser__button--icon" data-action="reload" aria-label="Reload class list">
            <i class="fa-solid fa-rotate-right"></i>
          </button>
          <input
            type="search"
            class="dauligor-class-browser__input"
            data-action="search"
            placeholder="Search classes or subclasses..."
            value="${foundry.utils.escapeHTML(this._state.search)}"
          >
          <button type="button" class="dauligor-class-browser__button" data-action="reset">Reset</button>
        </div>
      </div>
    `;

    this._toolbarRegion.querySelector(`[data-action="filter"]`)?.addEventListener("click", () => {
      notifyWarn("Class browser filters are not wired up yet.");
    });
    this._toolbarRegion.querySelector(`[data-action="search"]`)?.addEventListener("input", (event) => {
      this._state.search = event.currentTarget.value ?? "";
      this._renderList();
      this._renderFooter();
    });
    this._toolbarRegion.querySelector(`[data-action="reload"]`)?.addEventListener("click", async () => {
      await this._loadBrowserData({ force: true });
    });
    this._toolbarRegion.querySelector(`[data-action="reset"]`)?.addEventListener("click", () => {
      this._state.search = "";
      this._state.tagFilter = "__all__";
      this._renderToolbar();
      this._renderList();
      this._renderFooter();
    });
  }

  _renderList() {
    if (!this._listRegion) return;

    if (this._state.isLoading) {
      this._listRegion.innerHTML = `<div class="dauligor-class-browser__empty">Loading available class payloads...</div>`;
      return;
    }

    const visibleClasses = this._getVisibleClasses();
    if (!visibleClasses.length) {
      this._listRegion.innerHTML = `<div class="dauligor-class-browser__empty">No classes matched the current search and filter.</div>`;
      return;
    }

    const actorClassMap = this._getActorClassMap();

    const rowsHtml = visibleClasses.map((classModel) => {
      const isSelected = classModel.classSourceId === this._state.selectedClassSourceId;
      const selectedSubclassId = isSelected ? this._state.selectedSubclassSourceId : null;
      const classSource = classModel.sourceLabel || classModel.subclasses.find((subclass) => subclass.sourceLabel)?.sourceLabel || "";

      // When the actor already has this class + a subclass, lock the
      // subclass picker — only the existing subclass is selectable. Other
      // rows render disabled with a "Locked" tag so the user can see why.
      const actorExisting = actorClassMap.get(classModel.classSourceId) ?? null;
      const lockedSubclassId = actorExisting?.existingSubclassSourceId ?? null;

      const subclassesHtml = classModel.subclasses.length
        ? `
          ${classModel.subclasses.map((subclass) => {
            const isLockedToOther = Boolean(lockedSubclassId) && subclass.sourceId !== lockedSubclassId;
            const isExistingPick = Boolean(lockedSubclassId) && subclass.sourceId === lockedSubclassId;
            const isRowSelected = isExistingPick || selectedSubclassId === subclass.sourceId;
            const meta = isExistingPick ? "Already chosen" : (isLockedToOther ? "Locked" : "");
            return `
              <button
                type="button"
                class="dauligor-class-browser__row dauligor-class-browser__row--subclass ${isRowSelected ? "dauligor-class-browser__row--selected" : ""} ${isLockedToOther ? "dauligor-class-browser__row--disabled" : ""}"
                data-action="select-subclass"
                data-class-source-id="${foundry.utils.escapeHTML(classModel.classSourceId)}"
                data-subclass-source-id="${foundry.utils.escapeHTML(subclass.sourceId)}"
                ${isLockedToOther ? "disabled" : ""}
              >
                <span class="dauligor-class-browser__row-select">
                  <span class="dauligor-class-browser__radio ${isRowSelected ? "dauligor-class-browser__radio--selected" : ""}"></span>
                </span>
                <span class="dauligor-class-browser__row-name dauligor-class-browser__row-name--subclass">&mdash; ${foundry.utils.escapeHTML(subclass.name)}${meta ? ` <span style="font-size:9px;letter-spacing:.08em;text-transform:uppercase;opacity:.6;">· ${foundry.utils.escapeHTML(meta)}</span>` : ""}</span>
                <span class="dauligor-class-browser__row-source">${foundry.utils.escapeHTML(subclass.sourceLabel || classSource)}</span>
              </button>
            `;
          }).join("")}
        `
        : "";

      return `
        <div class="dauligor-class-browser__group" data-class-card="${foundry.utils.escapeHTML(classModel.classSourceId)}">
          <label class="dauligor-class-browser__row dauligor-class-browser__row--class ${isSelected ? "dauligor-class-browser__row--selected" : ""}">
            <span class="dauligor-class-browser__row-select">
              <input
                class="dauligor-class-browser__row-input"
                type="radio"
                name="selected-class"
                data-action="select-class"
                value="${foundry.utils.escapeHTML(classModel.classSourceId)}"
                ${isSelected ? "checked" : ""}
              >
              <span class="dauligor-class-browser__radio ${isSelected ? "dauligor-class-browser__radio--selected" : ""}"></span>
            </span>
            <span class="dauligor-class-browser__row-name">
              <span class="dauligor-class-browser__row-name-text">${foundry.utils.escapeHTML(classModel.name)}</span>
            </span>
            <span class="dauligor-class-browser__row-source">${foundry.utils.escapeHTML(classSource)}</span>
          </label>
          ${subclassesHtml}
        </div>
      `;
    }).join("");

    this._listRegion.innerHTML = `
      <div class="dauligor-class-browser__table">
        <div class="dauligor-class-browser__header">
          <span class="dauligor-class-browser__header-cell dauligor-class-browser__header-cell--select"></span>
          <span class="dauligor-class-browser__header-cell dauligor-class-browser__header-cell--name">Name <span class="dauligor-class-browser__sort-indicator">&#9650;</span></span>
          <span class="dauligor-class-browser__header-cell dauligor-class-browser__header-cell--source">Source</span>
        </div>
        <div class="dauligor-class-browser__list">${rowsHtml}</div>
      </div>
    `;

    this._listRegion.querySelectorAll(`[data-action="select-class"]`).forEach((input) => {
      input.addEventListener("change", () => {
        this._selectClass(input.value, null);
      });
    });
    this._listRegion.querySelectorAll(`[data-action="select-subclass"]`).forEach((button) => {
      button.addEventListener("click", () => {
        this._selectClass(button.dataset.classSourceId, button.dataset.subclassSourceId);
      });
    });
  }

  _renderFooter() {
    if (!this._footerRegion) return;

    const selectedClass = this._getSelectedClass();
    const selectedSubclass = selectedClass?.subclasses.find((subclass) => subclass.sourceId === this._state.selectedSubclassSourceId) ?? null;
    const primaryActionLabel = this._actor ? "Configure & Import" : "Import Selected";
    const destinationHtml = this._actor
      ? ""
      : `
        <div class="dauligor-class-browser__field dauligor-class-browser__field--compact">
          <label class="dauligor-class-browser__field-label" for="${MODULE_ID}-browser-folder">Folder</label>
          <input
            id="${MODULE_ID}-browser-folder"
            class="dauligor-class-browser__input"
            type="text"
            data-action="folder-path"
            value="${foundry.utils.escapeHTML(this._state.folderPath)}"
          >
        </div>
      `;

    this._footerRegion.innerHTML = `
      <div class="dauligor-class-browser__footer-bar">
        <div class="dauligor-class-browser__status ${this._state.statusLevel ? `dauligor-class-browser__status--${this._state.statusLevel}` : ""}">
          ${this._state.status ? foundry.utils.escapeHTML(this._state.status) : (selectedClass
        ? `Selected ${foundry.utils.escapeHTML(selectedClass.name)}${selectedSubclass ? ` / ${foundry.utils.escapeHTML(selectedSubclass.name)}` : ""}.`
        : "Select a class to continue.")}
        </div>
        <div class="dauligor-class-browser__controls">
          ${destinationHtml}
          <button type="button" class="dauligor-class-browser__button" data-action="cancel">Cancel</button>
          <button type="button" class="dauligor-class-browser__button dauligor-class-browser__button--primary" data-action="import-selected" ${selectedClass ? "" : "disabled"}>${primaryActionLabel}</button>
        </div>
      </div>
    `;

    this._footerRegion.querySelector(`[data-action="folder-path"]`)?.addEventListener("change", async (event) => {
      this._state.folderPath = (event.currentTarget.value ?? "").trim() || "Classes";
      await game.settings.set(MODULE_ID, SETTINGS.defaultClassFolderPath, this._state.folderPath);
    });
    this._footerRegion.querySelector(`[data-action="cancel"]`)?.addEventListener("click", async () => {
      await this.close();
    });
    this._footerRegion.querySelector(`[data-action="import-selected"]`)?.addEventListener("click", async () => {
      await this._importSelectedClass();
    });
  }

  async _loadBrowserData({ force = false } = {}) {
    if (this._isLoaded && !force) return;

    this._state.isLoading = true;
    this._state.status = force ? "Reloading class source data..." : "Loading class source data...";
    this._state.statusLevel = "";
    this._renderBrowser();

    const catalogs = (await Promise.all(normalizeCatalogUrls(this._state.catalogUrls, this._state.catalogUrl)
      .map((url) => fetchClassCatalog(url))))
      .filter(Boolean);
    this._catalog = catalogs;

    if (!catalogs.length) {
      this._classModels = [];
      this._availableTags = [];
      this._state.status = "The class catalog could not be loaded.";
      this._state.statusLevel = "danger";
      this._state.isLoading = false;
      this._isLoaded = false;
      this._renderBrowser();
      return;
    }

    const seenEntries = new Set();
    const catalogEntries = catalogs
      .flatMap((catalog) => ensureArray(catalog.entries))
      .filter((entry) => {
        const key = `${entry?.sourceId ?? ""}::${entry?.payloadUrl ?? ""}`;
        if (!entry?.payloadUrl || seenEntries.has(key)) return false;
        seenEntries.add(key);
        return true;
      });

    // Phase C: build models from catalog metadata only — no per-class
    // bundle fetches at browser-open time. The catalog endpoint ships
    // `tags` and `subclasses[]` per entry, which is everything the class
    // card grid + tag filter + subclass nesting need. Per-class payloads
    // are lazy-loaded by `_ensureVariantPayload` when the user actually
    // clicks Import, with results cached in `this._payloadCache` keyed
    // by payloadUrl. A force-reload of the browser also resets the cache.
    if (force) this._payloadCache.clear();
    const entryPayloads = catalogEntries.map((entry) => ({ entry, payload: null }));

    this._classModels = buildClassModels(entryPayloads);
    this._availableTags = [...new Set(this._classModels.flatMap((classModel) => classModel.tags))].sort();
    this._applyPreferredSelection();
    this._state.isLoading = false;
    this._state.status = `Loaded ${this._classModels.length} class option${this._classModels.length === 1 ? "" : "s"} from ${catalogEntries.length} catalog entr${catalogEntries.length === 1 ? "y" : "ies"} across ${catalogs.length} catalog${catalogs.length === 1 ? "" : "s"}.`;
    this._state.statusLevel = this._classModels.length ? "success" : "danger";
    this._isLoaded = true;
    this._renderBrowser();
  }

  /**
   * Scan the target actor for existing Dauligor-imported classes and
   * return a Map<classSourceId, { existingLevel, existingSubclassSourceId }>.
   * The class browser uses this to (1) lock the subclass picker to the
   * already-chosen subclass for a given class, and (2) default the
   * import level to (existingLevel + 1) when the user picks that class
   * for level-up.
   */
  _getActorClassMap() {
    const result = new Map();
    if (!this._actor?.items) return result;
    for (const item of this._actor.items) {
      if (item.type !== "class") continue;
      const sourceId = item.getFlag?.(MODULE_ID, "sourceId");
      if (!sourceId) continue;
      const existingLevel = clampLevel(item.system?.levels ?? 0);
      const subclassItem = this._actor.items.find((subItem) =>
        subItem.type === "subclass"
        && subItem.getFlag?.(MODULE_ID, "classSourceId") === sourceId);
      const existingSubclassSourceId = subclassItem?.getFlag?.(MODULE_ID, "sourceId") ?? null;
      result.set(sourceId, { existingLevel, existingSubclassSourceId });
    }
    return result;
  }

  _applyPreferredSelection() {
    if (!this._classModels.length) {
      this._state.selectedClassSourceId = null;
      this._state.selectedSubclassSourceId = null;
      return;
    }

    const preferredIds = new Set(this._state.preferredSelectionIds);
    const preferredClass = this._classModels.find((classModel) =>
      preferredIds.has(classModel.classSourceId)
      || classModel.variants.some((variant) => preferredIds.has(variant.entry.sourceId))
      || classModel.subclasses.some((subclass) => preferredIds.has(subclass.sourceId))
    );

    if (preferredClass) {
      this._state.selectedClassSourceId = preferredClass.classSourceId;
      const preferredSubclass = preferredClass.subclasses.find((subclass) => preferredIds.has(subclass.sourceId));
      this._state.selectedSubclassSourceId = preferredSubclass?.sourceId ?? null;
      return;
    }

    const existingSelection = this._classModels.find((classModel) => classModel.classSourceId === this._state.selectedClassSourceId);
    if (existingSelection) return;

    this._state.selectedClassSourceId = this._classModels[0]?.classSourceId ?? null;
    this._state.selectedSubclassSourceId = null;
  }

  _getVisibleClasses() {
    const search = this._state.search.trim().toLowerCase();
    const tagFilter = this._state.tagFilter;

    return this._classModels.filter((classModel) => {
      if (tagFilter !== "__all__" && !classModel.tags.includes(tagFilter)) return false;
      if (!search) return true;

      const haystack = [
        classModel.name,
        classModel.description,
        ...classModel.tags,
        ...classModel.subclasses.map((subclass) => subclass.name),
        ...classModel.variants.map((variant) => variant.entry.name)
      ].filter(Boolean).join(" ").toLowerCase();

      return haystack.includes(search);
    });
  }

  _getSelectedClass() {
    return this._classModels.find((classModel) => classModel.classSourceId === this._state.selectedClassSourceId) ?? null;
  }

  _getSelectedVariant(classModel) {
    if (!classModel) return null;

    const preferredIds = new Set(this._state.preferredSelectionIds ?? []);
    const selectedSubclassId = this._state.selectedSubclassSourceId ?? null;
    const variants = ensureArray(classModel.variants);

    const matchingSubclassVariants = selectedSubclassId
      ? variants.filter((variant) =>
        ensureArray(variant?.metadata?.subclasses).some((subclass) => subclass?.sourceId === selectedSubclassId))
      : [];

    const preferredVariant = (matchingSubclassVariants.length ? matchingSubclassVariants : variants).find((variant) =>
      preferredIds.has(variant?.entry?.sourceId));
    if (preferredVariant) return preferredVariant;

    if (matchingSubclassVariants.length) {
      return [...matchingSubclassVariants].sort((left, right) =>
        variantPriority(left?.entry?.payloadKind) - variantPriority(right?.entry?.payloadKind))[0] ?? null;
    }

    return classModel.preferredVariant ?? variants[0] ?? null;
  }

  _selectClass(classSourceId, subclassSourceId = null) {
    this._state.selectedClassSourceId = classSourceId ?? null;

    // When the actor already has this class:
    //   - default the subclass to whatever they previously chose (no
    //     point asking again, and the subclass picker locks it anyway)
    //   - bump the target level to existing+1 unless the user has
    //     manually picked something higher
    let resolvedSubclassId = subclassSourceId ?? null;
    if (classSourceId) {
      const actorClassMap = this._getActorClassMap();
      const existing = actorClassMap.get(classSourceId);
      if (existing) {
        if (existing.existingSubclassSourceId && !resolvedSubclassId) {
          resolvedSubclassId = existing.existingSubclassSourceId;
        }
        if (existing.existingLevel > 0) {
          const nextLevel = clampLevel(existing.existingLevel + 1);
          if (this._state.targetLevel <= existing.existingLevel) {
            this._state.targetLevel = nextLevel;
          }
        }
      }
    }
    this._state.selectedSubclassSourceId = resolvedSubclassId;

    this._renderList();
    this._renderFooter();
  }

  async _ensureVariantPayload(variant) {
    if (variant?.payload) return true;
    const url = variant?.entry?.payloadUrl;
    if (!url) return false;

    const cached = this._payloadCache.get(url);
    if (cached) {
      variant.payload = cached;
      return true;
    }

    try {
      const payload = await fetchJson(url);
      if (!payload) return false;
      this._payloadCache.set(url, payload);
      variant.payload = payload;
      return true;
    } catch (error) {
      log("Failed to lazy-load class payload", { url, error });
      return false;
    }
  }

  async _importSelectedClass() {
    const selectedClass = this._getSelectedClass();
    if (!selectedClass) {
      notifyWarn("Select a class before importing.");
      return;
    }
    const selectedVariant = this._getSelectedVariant(selectedClass);
    if (!selectedVariant) {
      notifyWarn(`The selected ${selectedClass.name} payload is no longer available.`);
      return;
    }

    // Phase C: payload is fetched lazily on Import. Show a loading hint
    // since this fetch can take several hundred ms on a cold R2 read.
    this._state.status = `Loading ${selectedClass.name} payload…`;
    this._state.statusLevel = "";
    this._renderFooter();

    const ok = await this._ensureVariantPayload(selectedVariant);
    if (!ok) {
      this._state.status = `Could not load ${selectedClass.name} payload.`;
      this._state.statusLevel = "danger";
      this._renderFooter();
      return;
    }

    log("Selected class variant for import", {
      classSourceId: selectedClass.classSourceId,
      className: selectedClass.name,
      selectedSubclassSourceId: this._state.selectedSubclassSourceId ?? null,
      preferredSelectionIds: [...(this._state.preferredSelectionIds ?? [])],
      variantEntrySourceId: selectedVariant.entry?.sourceId ?? null,
      variantPayloadKind: selectedVariant.entry?.payloadKind ?? null,
      variantMetadata: {
        sourceLabel: selectedVariant.metadata?.sourceLabel ?? null,
        subclasses: ensureArray(selectedVariant.metadata?.subclasses).map((subclass) => ({
          sourceId: subclass?.sourceId ?? null,
          name: subclass?.name ?? null,
          sourceLabel: subclass?.sourceLabel ?? null
        }))
      },
      payloadSkillSource: {
        topLevelSkills: foundry.utils.deepClone(selectedVariant.payload?.class?.skills ?? null),
        proficiencySkills: foundry.utils.deepClone(selectedVariant.payload?.class?.proficiencies?.skills ?? null)
      }
    });

    if (this._actor) {
      await this._openImportOptions(selectedClass, selectedVariant);
      return;
    }

    this._state.status = `Importing ${selectedClass.name} into the world library...`;
    this._state.statusLevel = "";
    this._renderFooter();

    const result = await importClassPayloadToWorld(selectedVariant.payload, {
      entry: selectedVariant.entry,
      folderPath: this._state.folderPath,
      actor: this._actor,
      targetLevel: this._state.targetLevel
    });

    this._state.status = result
      ? `Imported ${selectedClass.name} into the world library.`
      : `Import failed for ${selectedClass.name}.`;
    this._state.statusLevel = result ? "success" : "danger";
    this._renderFooter();
    if (result) await this.close();
  }

  async _openImportOptions(selectedClass, selectedVariant = null) {
    const variant = selectedVariant ?? this._getSelectedVariant(selectedClass);
    if (!variant) {
      notifyWarn(`The selected ${selectedClass?.name ?? "class"} payload is no longer available.`);
      return;
    }

    const ok = await this._ensureVariantPayload(variant);
    if (!ok) {
      notifyWarn(`Could not load ${selectedClass?.name ?? "class"} payload.`);
      return;
    }

    const result = await runDauligorClassImportSequence({
      actor: this._actor,
      folderPath: this._state.folderPath,
      classModel: selectedClass,
      entry: variant.entry,
      payload: variant.payload,
      initialTargetLevel: this._state.targetLevel,
      preferredSubclassSourceId: this._state.selectedSubclassSourceId
    });

    if (!result) return;
    await this.close();
  }
}

class DauligorImportProgressApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor({ title = "Dauligor Import Progress", subtitle = "", onCancel = null } = {}) {
    super({
      id: `${MODULE_ID}-import-progress-${foundry.utils.randomID()}`,
      classes: ["dauligor-importer-app", "dauligor-importer-app--progress"],
      window: {
        title,
        resizable: true,
        contentClasses: ["dauligor-importer-window", "dauligor-sequence-window"]
      },
      position: centeredAppPosition(460, 420)
    });

    this._template = CLASS_OPTIONS_TEMPLATE;
    this._subtitle = subtitle;
    this._steps = [];
    this._status = "";
    this._statusLevel = "";
    this._currentPrompt = "";
    this._isFinished = false;
    this._onCancel = onCancel;
  }

  static open(options = {}) {
    const app = new this(options);
    app.render({ force: true });
    return app;
  }

  async close(options) {
    if (!this._isFinished) {
      await this.requestCancel();
      return;
    }
    return super.close(options);
  }

  _configureRenderParts() {
    return {
      main: {
        template: this._template
      }
    };
  }

  async _onRender() {
    super._onRender?.(...arguments);

    const root = this._getRootElement();
    if (!root) return;

    const content = root.querySelector(".window-content") ?? root;
    this._toolbarRegion = content.querySelector(`[data-region="toolbar"]`);
    this._bodyRegion = content.querySelector(`[data-region="body"]`);
    this._footerRegion = content.querySelector(`[data-region="footer"]`);

    this._renderProgress();
  }

  _getRootElement() {
    if (this.element instanceof HTMLElement) return this.element;
    if (this.element?.jquery && this.element[0] instanceof HTMLElement) return this.element[0];
    if (this.element?.[0] instanceof HTMLElement) return this.element[0];
    return document.getElementById(this.id) ?? null;
  }

  setSteps(steps = []) {
    const existing = new Map(this._steps.map((step) => [step.id, step]));
    this._steps = ensureArray(steps).map((step) => {
      const previous = existing.get(step.id);
      return {
        id: step.id,
        label: step.label,
        detail: previous?.detail ?? step.detail ?? "",
        status: previous?.status ?? step.status ?? "pending"
      };
    });
    this._renderProgress();
  }

  markStep(stepId, status = "pending", detail = "") {
    const step = this._steps.find((candidate) => candidate.id === stepId);
    if (!step) return;
    step.status = status;
    step.detail = detail ?? "";
    this._renderProgress();
  }

  setStatus(message = "", level = "") {
    this._status = message ?? "";
    this._statusLevel = level ?? "";
    this._renderFooter();
  }

  setCurrentPrompt(label = "") {
    this._currentPrompt = label ?? "";
    this._renderBody();
  }

  setFinished(finished = true) {
    this._isFinished = Boolean(finished);
    this._renderFooter();
  }

  async requestCancel() {
    if (this._isFinished) {
      await this.close();
      return;
    }
    await this._onCancel?.();
  }

  _renderProgress() {
    this._renderToolbar();
    this._renderBody();
    this._renderFooter();
  }

  _renderToolbar() {
    if (!this._toolbarRegion) return;

    this._toolbarRegion.innerHTML = `
      <div class="dauligor-sequence__toolbar">
        <div>
          <span class="dauligor-class-browser__step">Import Progress</span>
          <h2 class="dauligor-class-browser__title">${foundry.utils.escapeHTML(this.options.window.title ?? "Dauligor Import Progress")}</h2>
          ${this._subtitle ? `<p class="dauligor-class-browser__subtitle">${foundry.utils.escapeHTML(this._subtitle)}</p>` : ""}
        </div>
      </div>
    `;
  }

  _renderBody() {
    if (!this._bodyRegion) return;

    const stepsHtml = this._steps.length
      ? this._steps.map((step) => `
        <div class="dauligor-sequence__progress-step dauligor-sequence__progress-step--${foundry.utils.escapeHTML(step.status)}">
          <span class="dauligor-sequence__progress-marker"></span>
          <div class="dauligor-sequence__progress-copy">
            <div class="dauligor-sequence__progress-label">${foundry.utils.escapeHTML(step.label)}</div>
            ${step.detail ? `<div class="dauligor-sequence__progress-detail">${foundry.utils.escapeHTML(step.detail)}</div>` : ""}
          </div>
        </div>
      `).join("")
      : `<div class="dauligor-class-browser__empty">Preparing import workflow...</div>`;

    this._bodyRegion.innerHTML = `
      <div class="dauligor-sequence__progress-body">
        <div class="dauligor-sequence__progress-list">${stepsHtml}</div>
        ${this._currentPrompt ? `<div class="dauligor-sequence__progress-current">Current Prompt: ${foundry.utils.escapeHTML(this._currentPrompt)}</div>` : ""}
      </div>
    `;
  }

  _renderFooter() {
    if (!this._footerRegion) return;

    this._footerRegion.innerHTML = `
      <div class="dauligor-sequence__footer">
        <div class="dauligor-class-browser__status ${this._statusLevel ? `dauligor-class-browser__status--${this._statusLevel}` : ""}">
          ${this._status ? foundry.utils.escapeHTML(this._status) : "Follow the prompt windows as they appear. You can cancel the import at any time."}
        </div>
        <div class="dauligor-class-browser__actions">
          <button type="button" class="dauligor-class-browser__button" data-action="cancel-progress">${this._isFinished ? "Close" : "Cancel Import"}</button>
        </div>
      </div>
    `;

    this._footerRegion.querySelector(`[data-action="cancel-progress"]`)?.addEventListener("click", async () => {
      await this.requestCancel();
    });
  }
}

export class DauligorSequencePromptApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(config = {}) {
    super({
      id: `${MODULE_ID}-sequence-prompt-${foundry.utils.randomID()}`,
      classes: ["dauligor-importer-app", "dauligor-importer-app--sequence-prompt"],
      window: {
        title: config.title ?? "Dauligor Prompt",
        resizable: true,
        contentClasses: ["dauligor-importer-window", "dauligor-sequence-window"]
      },
      position: centeredAppPosition(
        config.width ?? 720,
        config.height ?? 540
      )
    });

    this._template = CLASS_OPTIONS_TEMPLATE;
    this._config = config;
    this._state = foundry.utils.deepClone(config.state ?? {});
    this._resolved = false;
    this._waitPromise = new Promise((resolve) => {
      this._resolve = resolve;
    });
  }

  static async prompt(config = {}, sequence = null) {
    const app = new this(config);
    sequence?.setActivePrompt(app);
    app.render({ force: true });
    const result = await app.wait();
    sequence?.setActivePrompt(null);
    return result;
  }

  wait() {
    return this._waitPromise;
  }

  _configureRenderParts() {
    return {
      main: {
        template: this._template
      }
    };
  }

  async close(options) {
    const shouldResolve = !this._resolved;
    const result = await super.close(options);
    if (shouldResolve) {
      this._resolved = true;
      this._resolve({ status: "cancelled" });
    }
    return result;
  }

  cancelFromSequence() {
    this._resolveAndClose({ status: "cancelled" });
  }

  updateState(patch = {}) {
    Object.assign(this._state, patch);
  }

  rerenderPrompt() {
    this.render({ force: true });
  }

  _resolveAndClose(result) {
    if (this._resolved) return;
    this._resolved = true;
    this._resolve(result);
    this.close();
  }

  async _onRender() {
    super._onRender?.(...arguments);

    const root = this._getRootElement();
    if (!root) return;

    const content = root.querySelector(".window-content") ?? root;
    this._toolbarRegion = content.querySelector(`[data-region="toolbar"]`);
    this._bodyRegion = content.querySelector(`[data-region="body"]`);
    this._footerRegion = content.querySelector(`[data-region="footer"]`);

    this._renderPrompt();
  }

  _getRootElement() {
    if (this.element instanceof HTMLElement) return this.element;
    if (this.element?.jquery && this.element[0] instanceof HTMLElement) return this.element[0];
    if (this.element?.[0] instanceof HTMLElement) return this.element[0];
    return document.getElementById(this.id) ?? null;
  }

  _renderPrompt() {
    this._renderToolbar();
    this._renderBody();
    this._renderFooter();
  }

  _renderToolbar() {
    if (!this._toolbarRegion) return;

    if (this._config.hideToolbar) {
      this._toolbarRegion.innerHTML = "";
      this._toolbarRegion.style.display = "none";
      return;
    }
    this._toolbarRegion.style.removeProperty("display");

    // The Foundry application chrome already renders the prompt title
    // in the window's draggable header bar. Repeating it as a body-
    // local <h2> doubled the title visually for no informational gain
    // — every prompt that uses this app gets the title via the window
    // header. We still surface the optional `subtitle` (which carries
    // the actual instruction copy on prompts like "Choose two skill
    // proficiencies") since the window header doesn't show it.
    if (this._config.subtitle) {
      this._toolbarRegion.style.removeProperty("display");
      this._toolbarRegion.innerHTML = `
        <div class="dauligor-sequence__toolbar">
          <p class="dauligor-class-browser__subtitle">${foundry.utils.escapeHTML(this._config.subtitle)}</p>
        </div>
      `;
    } else {
      // No subtitle → hide the toolbar region entirely so the empty
      // wrapper doesn't leave whitespace at the top of the prompt
      // body. The body's flex sizing fills the recovered space.
      this._toolbarRegion.innerHTML = "";
      this._toolbarRegion.style.display = "none";
    }
  }

  _renderBody() {
    if (!this._bodyRegion) return;
    this._bodyRegion.innerHTML = `
      <div class="dauligor-sequence__body">
        ${this._config.renderBody?.(this) ?? ""}
      </div>
    `;
    this._config.onRenderBody?.(this, this._bodyRegion);
  }

  _renderFooter() {
    if (!this._footerRegion) return;

    const actions = ensureArray(this._config.actions).length
      ? ensureArray(this._config.actions)
      : [
        { id: "confirm", label: "OK", primary: true },
        { id: "cancel", label: "Cancel" }
      ];

    this._footerRegion.innerHTML = `
      <div class="dauligor-sequence__footer">
        <div class="dauligor-class-browser__status ${this._config.statusLevel ? `dauligor-class-browser__status--${this._config.statusLevel}` : ""}">
          ${this._config.footerNote ? foundry.utils.escapeHTML(this._config.footerNote) : ""}
        </div>
        <div class="dauligor-class-browser__actions">
          ${actions.map((action) => `
            <button
              type="button"
              class="dauligor-class-browser__button ${action.primary ? "dauligor-class-browser__button--primary" : ""}"
              data-action="${foundry.utils.escapeHTML(action.id)}"
            >${foundry.utils.escapeHTML(action.label)}</button>
          `).join("")}
        </div>
      </div>
    `;

    actions.forEach((action) => {
      this._footerRegion.querySelector(`[data-action="${action.id}"]`)?.addEventListener("click", async () => {
        const result = await this._config.onAction?.(this, action.id);
        if (result === false) return;
        if (result !== undefined) {
          this._resolveAndClose(result);
          return;
        }
        if (action.id === "cancel") {
          this._resolveAndClose({ status: "cancelled" });
          return;
        }
        if (action.id === "skip") {
          this._resolveAndClose({ status: "skipped", value: foundry.utils.deepClone(this._state) });
          return;
        }
        this._resolveAndClose({ status: action.id, value: foundry.utils.deepClone(this._state) });
      });
    });
  }
}

async function runBaseClassAdvancementsStep({ workflow, sequence, progress }) {
  const baseFeatures = baseClassHandler(workflow);
  const stepId = "base-advancements";
  progress.markStep(stepId, "active", "Reviewing base class advancements and granted features.");
  progress.setStatus("Waiting for confirmation of base class advancements...");

  const visibleAdvancements = baseFeatures.advancements.filter((adv) => {
    if (adv.id === "base-hp") return true;
    return (adv.fixed?.length ?? 0) > 0
      || (adv.options?.length ?? 0) > 0
      || (adv.choiceCount ?? 0) > 0;
  });
  const grantedItems = collectOverviewFeatureItems(workflow);
  const selectionState = { selectedKey: grantedItems[0]?.key ?? null };

  const advancementColumnHtml = `
    <div class="dauligor-overview__panel">
      <div class="dauligor-overview__panel-head">Base Advancement Information</div>
      <div class="dauligor-overview__panel-body">
        ${visibleAdvancements.map((adv) => renderOverviewAdvancementCard(adv)).join("")}
      </div>
    </div>
  `;

  const featureColumnHtml = `
    <div class="dauligor-overview__panel">
      <div class="dauligor-overview__panel-head">Class Features List</div>
      <div class="dauligor-overview__panel-body" data-region="overview-features">
        ${renderOverviewFeatureList(grantedItems, selectionState.selectedKey)}
      </div>
    </div>
  `;

  const detailColumnHtml = `
    <div class="dauligor-overview__panel">
      <div class="dauligor-overview__panel-head">Selected Class Feature Information</div>
      <div class="dauligor-overview__panel-body" data-region="overview-detail">
        ${renderOverviewFeatureDetail(grantedItems.find((item) => item.key === selectionState.selectedKey) ?? null)}
      </div>
    </div>
  `;

  const html = `
    <div class="dauligor-overview">
      ${advancementColumnHtml}
      ${featureColumnHtml}
      ${detailColumnHtml}
    </div>
  `;

  const promptResult = await DauligorSequencePromptApp.prompt({
    title: "Class Import Overview",
    hideToolbar: true,
    width: 1080,
    height: 620,
    state: {},
    renderBody: () => html,
    onRenderBody: (app, root) => {
      // Let the overview grid fill the body region and cap scrolling to each column.
      root.style.overflow = "hidden";
      root.style.padding = "0";
      const seqBody = root.querySelector(".dauligor-sequence__body");
      if (seqBody) {
        seqBody.style.height = "100%";
        seqBody.style.minHeight = "0";
        seqBody.style.gap = "0";
      }

      const featuresRegion = root.querySelector(`[data-region="overview-features"]`);
      const detailRegion = root.querySelector(`[data-region="overview-detail"]`);
      if (!featuresRegion || !detailRegion) return;

      const resetDetailScroll = () => {
        detailRegion.scrollTop = 0;
        detailRegion.querySelector(".dauligor-overview__detail-body")?.scrollTo?.({ top: 0 });
      };

      const bindFeatureRows = (region) => {
        region.querySelectorAll(`[data-feature-key]`).forEach((row) => {
          row.addEventListener("click", () => {
            selectionState.selectedKey = row.dataset.featureKey ?? null;
            featuresRegion.innerHTML = renderOverviewFeatureList(grantedItems, selectionState.selectedKey);
            detailRegion.innerHTML = renderOverviewFeatureDetail(
              grantedItems.find((item) => item.key === selectionState.selectedKey) ?? null
            );
            bindFeatureRows(featuresRegion);
            resetDetailScroll();
          });
        });
      };

      bindFeatureRows(featuresRegion);
      resetDetailScroll();
    },
    actions: [
      { id: "cancel", label: "Cancel" },
      { id: "confirm", label: "Accept", primary: true }
    ],
    onAction: (app, actionId) => {
      if (actionId === "cancel") return { status: "cancelled" };
      return { status: "confirmed" };
    }
  });

  return promptResult.status === "cancelled" ? "cancelled" : "confirmed";
}

function collectOverviewFeatureItems(workflow) {
  if (!workflow) return [];

  const classFeatures = ensureArray(workflow.importClassFeatureItems).map((item, index) => ({
    key: `class:${item?.flags?.[MODULE_ID]?.sourceId ?? index}`,
    kind: "class",
    name: item?.name ?? "Class Feature",
    level: getOverviewFeatureLevel(item),
    description: getOverviewFeatureDescription(item),
    subtype: getOverviewFeatureSubtypeLabel(item)
  }));

  const subclassFeatures = ensureArray(workflow.importSubclassFeatureItems).map((item, index) => ({
    key: `subclass:${item?.flags?.[MODULE_ID]?.sourceId ?? index}`,
    kind: "subclass",
    name: item?.name ?? "Subclass Feature",
    level: getOverviewFeatureLevel(item),
    description: getOverviewFeatureDescription(item),
    subtype: getOverviewFeatureSubtypeLabel(item)
  }));

  const all = [...classFeatures, ...subclassFeatures];
  all.sort((left, right) => {
    if (left.level !== right.level) return left.level - right.level;
    if (left.kind !== right.kind) return left.kind === "class" ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
  return all;
}

function getOverviewFeatureLevel(item) {
  return Number(
    item?.flags?.[MODULE_ID]?.level
    ?? item?.flags?.[MODULE_ID]?.levelPrerequisite
    ?? item?.system?.level
    ?? 1
  ) || 1;
}

function getOverviewFeatureSubtypeLabel(item) {
  const flag = item?.flags?.[MODULE_ID]?.featureTypeLabel;
  if (typeof flag === "string" && flag.trim()) return flag.trim();
  return "";
}

function getOverviewFeatureDescription(item) {
  const candidates = [
    item?.system?.description?.value,
    item?.system?.description?.chat,
    typeof item?.system?.description === "string" ? item.system.description : null
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  return "";
}

function renderOverviewAdvancementCard(adv) {
  const isHp = adv.id === "base-hp";
  const fixedText = isHp
    ? `1d${adv.adv?.configuration?.hitDie || 8} + Con modifier`
    : (adv.fixed?.length ? adv.fixed.map((val) => formatFoundryLabel(val)).join(", ") : "");
  const choiceText = isHp
    ? "Average / Maximum / Manual roll"
    : (adv.options?.length ? adv.options.map((val) => formatFoundryLabel(val)).join(", ") : "");
  const choiceLabel = adv.choiceCount > 0 ? `Choice (${adv.choiceCount})` : "Choice";

  const rows = [];
  if (fixedText) {
    rows.push(`
      <p class="dauligor-overview__adv-row">
        <span class="dauligor-overview__adv-label">Guaranteed</span>
        <span class="dauligor-overview__adv-value">${foundry.utils.escapeHTML(fixedText)}</span>
      </p>
    `);
  }
  if (choiceText) {
    rows.push(`
      <p class="dauligor-overview__adv-row">
        <span class="dauligor-overview__adv-label">${foundry.utils.escapeHTML(choiceLabel)}</span>
        <span class="dauligor-overview__adv-value">${foundry.utils.escapeHTML(choiceText)}</span>
      </p>
    `);
  }

  return `
    <div class="dauligor-overview__adv">
      <h3 class="dauligor-overview__adv-title">${foundry.utils.escapeHTML(adv.title)}</h3>
      ${rows.join("")}
    </div>
  `;
}

function renderOverviewFeatureList(items, selectedKey) {
  if (!items.length) {
    return `<div class="dauligor-overview__placeholder">No new features will be granted.</div>`;
  }

  const groupsByLevel = new Map();
  for (const item of items) {
    const level = item.level || 1;
    if (!groupsByLevel.has(level)) groupsByLevel.set(level, []);
    groupsByLevel.get(level).push(item);
  }

  const levels = [...groupsByLevel.keys()].sort((a, b) => a - b);

  return levels.map((level) => {
    const rows = groupsByLevel.get(level).map((item) => {
      const classes = [
        "dauligor-overview__feature",
        item.kind === "subclass" ? "dauligor-overview__feature--subclass" : "",
        item.key === selectedKey ? "is-selected" : ""
      ].filter(Boolean).join(" ");
      return `
        <button type="button" class="${classes}" data-feature-key="${foundry.utils.escapeHTML(item.key)}">
          <span class="dauligor-overview__feature-name">${foundry.utils.escapeHTML(item.name)}</span>
          ${item.kind === "subclass" ? `<span class="dauligor-overview__feature-tag">Subclass</span>` : ""}
        </button>
      `;
    }).join("");

    return `
      <div class="dauligor-overview__level-group">
        <div class="dauligor-overview__level-heading">Level ${level}</div>
        ${rows}
      </div>
    `;
  }).join("");
}

function renderOverviewFeatureDetail(item) {
  if (!item) {
    return `<div class="dauligor-overview__placeholder">Select a class feature to view its details.</div>`;
  }

  const meta = [`Level ${item.level}`, item.kind === "subclass" ? "Subclass Feature" : "Class Feature"];
  if (item.subtype) meta.push(item.subtype);

  const body = item.description?.trim()
    ? item.description
    : `<p style="font-style: italic; color: var(--dauligor-text-muted);">No description provided.</p>`;

  return `
    <div class="dauligor-overview__detail">
      <h3 class="dauligor-overview__detail-title">${foundry.utils.escapeHTML(item.name)}</h3>
      <div class="dauligor-overview__detail-meta">
        ${meta.map((part) => `<span>${foundry.utils.escapeHTML(part)}</span>`).join("")}
      </div>
      <div class="dauligor-overview__detail-body">${body}</div>
    </div>
  `;
}

class DauligorImportSequenceCancelledError extends Error {
  constructor(message = "The Dauligor import was cancelled.") {
    super(message);
    this.name = "DauligorImportSequenceCancelledError";
  }
}

async function runDauligorClassImportSequence({
  actor = null,
  folderPath = "Classes",
  classModel = null,
  entry = null,
  payload = null,
  initialTargetLevel = 1,
  preferredSubclassSourceId = null
} = {}) {
  const initialImportSelection = actor
    ? {
      includeSubclass: Boolean(preferredSubclassSourceId),
      subclassSourceId: preferredSubclassSourceId ?? null
    }
    : null;
  const baseWorkflow = buildClassImportWorkflow(payload, {
    entry,
    actor,
    targetLevel: initialTargetLevel,
    preferredSubclassSourceId,
    importSelection: initialImportSelection
  });

  if (!baseWorkflow) {
    notifyWarn(`The selected ${classModel?.name ?? "class"} payload could not be prepared for import.`);
    return null;
  }

  const state = createImportSequenceState(baseWorkflow, initialTargetLevel, preferredSubclassSourceId);
  const progress = DauligorImportProgressApp.open({
    title: `Importing ${baseWorkflow.classItem?.name ?? classModel?.name ?? "Class"}`,
    subtitle: actor ? `Actor "${actor.name}"` : "World / Sidebar"
  });

  const sequence = {
    cancelled: false,
    activePrompt: null,
    setActivePrompt(prompt) {
      this.activePrompt = prompt ?? null;
      progress.setCurrentPrompt(prompt?.options?.window?.title ?? "");
    },
    async requestCancel(message = "Import cancelled.") {
      if (this.cancelled) return;
      this.cancelled = true;
      progress.setStatus(message, "danger");
      progress.setFinished(true);
      progress.setCurrentPrompt("");
      this.activePrompt?.cancelFromSequence?.();
    }
  };

  progress._onCancel = async () => {
    await sequence.requestCancel();
  };

  let workflow = buildWorkflowFromSequenceState(payload, { entry, actor, state });
  progress.setSteps(buildImportSequenceSteps(workflow, { actor }));
  progress.markStep("prepare", "complete", "Workflow ready.");
  progress.setStatus(`Preparing ${workflow.classItem?.name ?? "class"} import...`);

  try {
    throwIfSequenceCancelled(sequence);

    if (actor) {
      const characterUpdater = new CharacterUpdater(actor);
      sequence.characterUpdater = characterUpdater;
      const characterJson = characterUpdater.getCharacterJson();
      if (characterJson) {
        console.log(`${MODULE_ID} | CharacterUpdater: Successfully read character JSON.`);
        console.log(`${MODULE_ID} | Character JSON BEFORE advancements:`, JSON.parse(JSON.stringify(characterJson)));
      } else {
        console.warn(`${MODULE_ID} | CharacterUpdater: Failed to read character JSON.`);
      }

      const selectedLevel = await runLevelSelectionStep({ workflow, sequence, progress });
      if (selectedLevel === "cancelled") throw new DauligorImportSequenceCancelledError();
      state.targetLevel = selectedLevel;
    }

    workflow = buildWorkflowFromSequenceState(payload, { entry, actor, state });
    progress.setSteps(buildImportSequenceSteps(workflow, { actor }));
    throwIfSequenceCancelled(sequence);

    const previewResult = await runBaseClassAdvancementsStep({ workflow, sequence, progress });
    if (previewResult === "cancelled") throw new DauligorImportSequenceCancelledError();

    // --- PHASE 2: SEQUENTIAL BASE CLASS ADVANCEMENTS ---
    // We iterate through all core advancements (HP, Skills, Tools, Saves, Armor, Weapons, Languages)
    // and show specialized selection windows for each.
    const baseFeatures = baseClassHandler(workflow);

    const existingClassLevelForSkip = Number(workflow.existingClassLevel ?? 0) || 0;
    for (const adv of baseFeatures.advancements) {
      throwIfSequenceCancelled(sequence);

      // Skip non-HP base advancements already granted at a previous class
      // level — proficiencies (skills, tools, saves, armor, weapons,
      // languages, etc.) are starting-level slots that must not be
      // re-prompted on level-up. HP keeps running because its handler
      // does the per-level diff calculation (previousLevels + 1 → target).
      const advLevel = Number(adv?.adv?.level ?? 1) || 1;
      if (adv.id !== 'base-hp' && advLevel <= existingClassLevelForSkip) {
        const skipStepId = adv.id === 'base-skills' ? 'skills'
          : adv.id === 'base-tools' ? 'tools'
          : `advancement:${adv.id.replace('base-', '')}`;
        progress.markStep(skipStepId, "skipped", `Already applied at level ${advLevel}.`);
        continue;
      }

      // 1. Hit Points Advancement
      if (adv.id === 'base-hp') {
        if (actor) {
          const hpModeResult = await runHpModeStep({ workflow, sequence, progress });
          if (hpModeResult === "cancelled") throw new DauligorImportSequenceCancelledError();
          if (hpModeResult !== undefined) {
            state.hpMode = hpModeResult.hpMode ?? state.hpMode;
            state.hpCustomFormula = hpModeResult.hpCustomFormula ?? state.hpCustomFormula;

            // Compute total HP increase across the level diff. Per the
            // 5e rules, level 1 always gets the maximum hit die value;
            // levels 2+ use the chosen mode (average / maximum / minimum).
            // Without this loop, fresh imports at level 1 would only get
            // the per-level mode value (e.g. average = 5 for d8) instead
            // of the max, which is why level 1 was reading as 0/low HP.
            const die = adv.adv?.configuration?.hitDie || 8;
            const previousLevels = Number(workflow.existingClassLevel ?? 0) || 0;
            let totalIncrease = 0;
            for (let lvl = previousLevels + 1; lvl <= state.targetLevel; lvl++) {
              if (lvl === 1) {
                totalIncrease += die;
              } else if (state.hpMode === "average") {
                totalIncrease += Math.floor(die / 2) + 1;
              } else if (state.hpMode === "maximum") {
                totalIncrease += die;
              } else if (state.hpMode === "minimum") {
                totalIncrease += 1;
              }
            }

            if (totalIncrease > 0) {
              sequence.characterUpdater.updateHp(totalIncrease);
            }
          }
        }
      } 
      
      // 2. Skill Proficiencies Advancement
      else if (adv.id === 'base-skills') {
        let selectedSkills = [];
        // Only prompt when there are real choices to make
        if (actor && adv.choiceCount > 0 && (adv.options?.length ?? 0) > 0) {
          const skillSelections = await runSkillSelectionStep({ workflow, sequence, progress, advancement: adv });
          if (skillSelections === "cancelled") throw new DauligorImportSequenceCancelledError();
          if (skillSelections) {
            state.skillSelections = skillSelections;
            selectedSkills = skillSelections;
          }
        } else {
          progress.markStep("skills", "skipped", "No skill choices to make.");
        }

        if (actor) {
          const allSkills = [...(adv.fixed || []), ...selectedSkills];
          sequence.characterUpdater.updateSkills(allSkills);
        }
      }

      // 3. Tool Proficiencies Advancement
      else if (adv.id === 'base-tools') {
        let selectedTools = [];
        // Only prompt when there are real choices to make
        if (actor && adv.choiceCount > 0 && (adv.options?.length ?? 0) > 0) {
          const toolSelections = await runToolSelectionStep({ workflow, sequence, progress, advancement: adv });
          if (toolSelections === "cancelled") throw new DauligorImportSequenceCancelledError();
          if (toolSelections) {
            state.toolSelections = toolSelections;
            selectedTools = toolSelections;
          }
        } else {
          progress.markStep("tools", "skipped", "No tool choices to make.");
        }

        if (actor) {
          const allTools = [...(adv.fixed || []), ...selectedTools];
          sequence.characterUpdater.updateTraitProficiencies("toolProf", allTools);
        }
      }

      // 4. Other Trait Advancements (Saves, Armor, Weapons, Languages, Resistances)
      else {
        let selections = [];
        // Only prompt when there are real choices to make
        if (actor && adv.choiceCount > 0 && (adv.options?.length ?? 0) > 0) {
          const res = await runTraitSelectionStep({
            title: adv.title,
            fieldName: adv.id,
            advancement: adv,
            workflow,
            sequence,
            progress
          });
          if (res === "cancelled") throw new DauligorImportSequenceCancelledError();
          if (res && res !== "skipped") {
            state.traitSelections = state.traitSelections || {};
            state.traitSelections[adv.id] = res;
            selections = res;
          }
        } else {
          progress.markStep(`advancement:${adv.id.replace('base-', '')}`, "skipped", "No choices to make.");
        }

        if (actor) {
          const allItems = [...(adv.fixed || []), ...selections];
          if (adv.id === "base-saves") {
            sequence.characterUpdater.updateSaves(allItems);
          } else if (adv.id === "base-armor") {
            sequence.characterUpdater.updateTraitProficiencies("armorProf", allItems);
          } else if (adv.id === "base-weapons") {
            sequence.characterUpdater.updateTraitProficiencies("weaponProf", allItems);
          } else if (adv.id === "base-languages") {
            sequence.characterUpdater.updateTraitProficiencies("languages", allItems);
          } else if (adv.id === "base-resistances") {
            sequence.characterUpdater.updateDamageTraits("dr", allItems);
          } else if (adv.id === "base-immunities") {
            sequence.characterUpdater.updateDamageTraits("di", allItems);
          } else if (adv.id === "base-vulnerabilities") {
            sequence.characterUpdater.updateDamageTraits("dv", allItems);
          } else if (adv.id === "base-condition-immunities") {
            sequence.characterUpdater.updateDamageTraits("ci", allItems);
          }
        }
      }



      // Refresh workflow state after each step for progress tracking
      workflow = buildWorkflowFromSequenceState(payload, { entry, actor, state });
      progress.setSteps(buildImportSequenceSteps(workflow, { actor }));
    }



    if (actor) {
      // ─── Level-by-level prompt loop ─────────────────────────────────
      // The character-JSON extractor (CharacterUpdater) was built around
      // level-by-level progression — each level's class features can be
      // taught their advancement choices BEFORE the next level's
      // features even appear. So instead of the old "all option-groups,
      // then all ItemChoice, then all Trait" batches, we now iterate
      // class levels from `existingClassLevel + 1` up to `targetLevel`
      // and at each level:
      //
      //   1. If we just reached the subclass-grant level and no
      //      subclass is selected yet → prompt for subclass first.
      //   2. For each class feature granted at this level (in `sort`
      //      order), prompt the user for the choices tied to that
      //      feature (its feature-attached ItemChoice + Trait + any
      //      option group whose `featureSourceId` matches it).
      //   3. Same for subclass features granted at this level.
      //   4. Then class-root / subclass-root option groups that fire
      //      at THIS level (Fighter's Fighting Style at level 1, etc.) —
      //      these aren't owned by a specific feature so they sit
      //      after the feature batch.
      //
      // The embed phase that runs after this loop is still a single
      // chunk; only the *prompt ordering* changes here. This keeps the
      // user's mental model aligned with the actor's level-up timeline:
      // pick Pact Boon → pick Pact of the Blade → see next level's
      // features → make their picks.
      let subclassSourceId = state.subclassSourceId ?? null;
      let includeSubclass = Boolean(subclassSourceId);

      state.optionSelections = state.optionSelections ?? {};

      // Subclass selection helper — fires whenever we cross the
      // subclass-grant level and a subclass isn't already picked.
      // Class-import-service.js exposes `workflow.minSubclassLevel` for
      // the gate (e.g. Sorcerer 1, Cleric 1, Artificer 3, Warlock 3,
      // Battle Master at Fighter 3).
      const promptSubclassIfNeeded = async (currentLevel) => {
        if (subclassSourceId) return;
        if (!workflow.hasSubclassSupport) return;
        if (currentLevel < Number(workflow.minSubclassLevel || Infinity)) return;
        if ((workflow.subclassItems?.length ?? 0) === 0) return;

        const subclassResult = await runSubclassStep({ workflow, sequence, progress, entry });
        if (subclassResult === "cancelled") throw new DauligorImportSequenceCancelledError();
        if (subclassResult) {
          subclassSourceId = subclassResult;
          includeSubclass = true;
          state.subclassSourceId = subclassSourceId;
          state.includeSubclass = true;
          workflow = buildWorkflowFromSequenceState(payload, { entry, actor, state });
          progress.setSteps(buildImportSequenceSteps(workflow, { actor }));
        }
      };

      // Refresh the granted-feature set after the workflow changes
      // (subclass selection, option picks). Used to gate option-group
      // and ItemChoice prompts on "is this feature actually being
      // granted right now".
      const grantedFeatureSourceIds = () => new Set([
        ...ensureArray(workflow.desiredClassFeatureItems),
        ...ensureArray(workflow.desiredSubclassFeatureItems)
      ].map((f) => f?.flags?.[MODULE_ID]?.sourceId).filter(Boolean));

      // Per-feature prompt runner. Walks every authored choice that
      // ties back to the given feature's sourceId:
      //   - option groups whose featureSourceId matches
      //   - feature-attached ItemChoice advancements (option-group-backed)
      //   - feature-attached Trait advancements (skill / language picks)
      // Runs them in that order so the user sees the "what items does
      // this feature grant" pick before the "what skills does this
      // feature train" pick, which is the rhythm dnd5e's own
      // advancement prompts use.
      const promptForFeature = async (featureSourceId, featureName) => {
        if (!featureSourceId) return;

        // (a) Option-group prompts owned by this feature (featureSourceId
        // attribution set by buildOptionGroupAdvancementMetadataMap on the
        // class-export side, OR by the feature's own ItemChoice ref).
        for (const group of ensureArray(workflow.optionGroups)) {
          if (group?.featureSourceId !== featureSourceId) continue;
          if (!group?.options?.length || !group?.maxSelections) continue;
          if (group.subclassSourceId && group.subclassSourceId !== state.subclassSourceId) continue;
          if ((state.optionSelections[group.sourceId] ?? []).length === group.maxSelections) continue;

          const groupResult = await runOptionGroupStep({ workflow, actor, group, sequence, progress });
          if (groupResult === "cancelled") throw new DauligorImportSequenceCancelledError();
          if (Array.isArray(groupResult)) {
            state.optionSelections[group.sourceId] = groupResult;
            workflow = buildWorkflowFromSequenceState(payload, { entry, actor, state });
          }
        }

        // (b) Feature-attached ItemChoice advancements that reference
        // an option-group via configuration.optionGroupId. The
        // owner-tagger in class-import-service.js stamps each
        // advancement with `_ownerSourceId` so we can identify which
        // feature it belongs to.
        for (const adv of ensureArray(workflow.choiceAdvancements)) {
          if (adv?.type !== "ItemChoice") continue;
          if (adv._ownerSourceId !== featureSourceId) continue;
          const optionGroupSourceId = String(adv?.configuration?.optionGroupId ?? "").trim();
          if (!optionGroupSourceId) continue;

          const choicesRaw = adv.configuration?.choices ?? {};
          const choicesEntries = Array.isArray(choicesRaw)
            ? choicesRaw
            : Object.values(choicesRaw);
          const pickCount = choicesEntries.reduce(
            (max, c) => Math.max(max, Number(c?.count || 0) || 0),
            0
          );
          if (pickCount <= 0) continue;

          const group = ensureArray(workflow.optionGroups).find(
            (g) => g?.sourceId === optionGroupSourceId
          );
          if (!group?.options?.length) {
            log("Skipping feature-attached ItemChoice — option group not in workflow catalog", {
              optionGroupSourceId,
              featureSourceId,
              featureName
            });
            continue;
          }
          if ((state.optionSelections[group.sourceId] ?? []).length === pickCount) continue;

          const featureAttachedGroup = {
            ...group,
            maxSelections: pickCount,
            featureSourceId,
            selectedSourceIds: state.optionSelections[group.sourceId] ?? []
          };

          const groupResult = await runOptionGroupStep({
            workflow,
            actor,
            group: featureAttachedGroup,
            sequence,
            progress
          });
          if (groupResult === "cancelled") throw new DauligorImportSequenceCancelledError();
          if (Array.isArray(groupResult)) {
            state.optionSelections[group.sourceId] = groupResult;
            workflow = buildWorkflowFromSequenceState(payload, { entry, actor, state });
          }
        }

        // (c) Feature-attached Trait advancements (skill / tool /
        // language picks living on the feature's own
        // system.advancement). Same `_ownerSourceId` attribution path.
        const baseAdvancementIds = new Set(
          baseFeatures.advancements.map((entry) => entry?.adv?._id).filter(Boolean)
        );
        for (const adv of ensureArray(workflow.choiceAdvancements)) {
          if (adv?.type !== "Trait") continue;
          if (adv._ownerSourceId !== featureSourceId) continue;
          if (!adv?._id || baseAdvancementIds.has(adv._id)) continue;

          const traitChoice = extractFeatureTraitChoice(adv);
          if (!traitChoice) continue;

          if (traitChoice.poolSource === "proficient") {
            const derivedPool = deriveProficientPool(actor, traitChoice.traitType);
            if (traitChoice.choiceCount === 0) {
              if (derivedPool.length > 0) {
                sequence.characterUpdater?.applyTraitSelections(derivedPool, {
                  mode: traitChoice.mode,
                  traitType: traitChoice.traitType
                });
                progress.markStep(`advancement:feature-trait:${adv._id}`, "complete",
                  `Auto-applied to ${derivedPool.length} matching proficienc${derivedPool.length === 1 ? "y" : "ies"}.`);
              } else {
                progress.markStep(`advancement:feature-trait:${adv._id}`, "skipped",
                  "No matching proficiencies on the actor.");
              }
              continue;
            }
            if (derivedPool.length === 0) {
              progress.markStep(`advancement:feature-trait:${adv._id}`, "skipped",
                "No matching proficiencies on the actor.");
              continue;
            }
            traitChoice.options = derivedPool;
          }

          const result = await runTraitSelectionStep({
            title: traitChoice.title,
            fieldName: `feature-trait:${adv._id}`,
            advancement: traitChoice,
            workflow,
            sequence,
            progress
          });
          if (result === "cancelled") throw new DauligorImportSequenceCancelledError();
          if (Array.isArray(result) && result.length) {
            sequence.characterUpdater?.applyTraitSelections(result, {
              mode: traitChoice.mode,
              traitType: traitChoice.traitType
            });
          }
        }
      };

      // For each level from existingClassLevel+1 up to targetLevel,
      // walk the features granted at that level and run their prompts.
      // existingClassLevel = 0 for a fresh import → loop starts at 1.
      const startLevel = existingClassLevelForSkip + 1;
      const endLevel = Number(state.targetLevel || 1) || 1;
      for (let currentLevel = startLevel; currentLevel <= endLevel; currentLevel++) {
        throwIfSequenceCancelled(sequence);

        // 1. Subclass selection — fires when we cross the gate.
        await promptSubclassIfNeeded(currentLevel);

        // 2. Class features granted AT this level, sorted by their
        // editor-side sort key (falls back to 0). For features
        // authored without an explicit sort, this preserves the
        // editor's input order.
        const featureLevelOf = (item) => Number(item?.flags?.[MODULE_ID]?.level ?? 0) || 0;
        const featureSortOf = (item) => Number(item?.flags?.[MODULE_ID]?.sort ?? item?.sort ?? 0) || 0;
        const classFeaturesAtLevel = ensureArray(workflow.desiredClassFeatureItems)
          .filter((f) => featureLevelOf(f) === currentLevel)
          .sort((a, b) => featureSortOf(a) - featureSortOf(b));

        for (const feature of classFeaturesAtLevel) {
          throwIfSequenceCancelled(sequence);
          await promptForFeature(
            feature?.flags?.[MODULE_ID]?.sourceId,
            feature?.name
          );
        }

        // 3. Subclass features granted AT this level, same sorting.
        const subclassFeaturesAtLevel = ensureArray(workflow.desiredSubclassFeatureItems)
          .filter((f) => featureLevelOf(f) === currentLevel)
          .sort((a, b) => featureSortOf(a) - featureSortOf(b));

        for (const feature of subclassFeaturesAtLevel) {
          throwIfSequenceCancelled(sequence);
          await promptForFeature(
            feature?.flags?.[MODULE_ID]?.sourceId,
            feature?.name
          );
        }

        // 4. Class-root / subclass-root option groups that fire at
        // this level. These have no `featureSourceId` (the metadata
        // builder only sets it for feature-owned references), so they
        // weren't picked up by the per-feature loops above. Use
        // `selectionCountsByLevel` to decide whether this level adds
        // any new picks for the group.
        const granted = grantedFeatureSourceIds();
        for (const group of ensureArray(workflow.optionGroups)) {
          if (!group?.options?.length) continue;
          // Skip feature-attached groups — handled by promptForFeature.
          if (group.featureSourceId && granted.has(group.featureSourceId)) continue;
          // Skip groups whose owning feature isn't being granted at all
          // (different subclass, etc.).
          if (group.featureSourceId && !granted.has(group.featureSourceId)) continue;
          if (group.subclassSourceId && group.subclassSourceId !== state.subclassSourceId) continue;

          // Does this group accumulate any picks by this level?
          const countAtTarget = group.maxSelections ?? 0;
          if (countAtTarget <= 0) continue;
          // Only fire at the FIRST level where the group's selection
          // count reaches its current cap — keeps Fighter's Fighting
          // Style from re-prompting after level 1.
          const countBefore = (() => {
            const counts = group.selectionCountsByLevel ?? {};
            let cumulative = 0;
            for (const [lvl, ct] of Object.entries(counts)) {
              if (Number(lvl) < currentLevel) cumulative = Math.max(cumulative, Number(ct) || 0);
            }
            return cumulative;
          })();
          const countAt = (() => {
            const counts = group.selectionCountsByLevel ?? {};
            let cumulative = 0;
            for (const [lvl, ct] of Object.entries(counts)) {
              if (Number(lvl) <= currentLevel) cumulative = Math.max(cumulative, Number(ct) || 0);
            }
            return cumulative;
          })();
          if (countAt <= countBefore) continue; // No new picks at this level
          if ((state.optionSelections[group.sourceId] ?? []).length >= countAt) continue;

          // Prompt for the picks added at this level. We pass the
          // accumulated cap (countAt) as maxSelections so the picker
          // knows how many total picks the user should have by now.
          const levelGatedGroup = {
            ...group,
            maxSelections: countAt,
            selectedSourceIds: state.optionSelections[group.sourceId] ?? []
          };

          const groupResult = await runOptionGroupStep({
            workflow,
            actor,
            group: levelGatedGroup,
            sequence,
            progress
          });
          if (groupResult === "cancelled") throw new DauligorImportSequenceCancelledError();
          if (Array.isArray(groupResult)) {
            state.optionSelections[group.sourceId] = groupResult;
            workflow = buildWorkflowFromSequenceState(payload, { entry, actor, state });
          }
        }
      }

      // ─── End level-by-level loop. The legacy class-root Trait /
      //     ItemChoice loops that used to run after this point are now
      //     interleaved INSIDE the loop via `promptForFeature`. Anything
      //     class-root that isn't attached to a feature is handled by
      //     the per-level option-group step above. ────────────────────

      // Hand off to the legacy import pipeline for the document-level
      // work:
      //   - rekey semantic advancement ids to 16-char Foundry ids
      //   - embed the class item (and chosen subclass) on the actor
      //   - upsert feature items granted by the class's advancement
      //     tree at the target level (ItemGrant)
      //   - upsert option items the user picked through the option-group
      //     prompts (ItemChoice via UniqueOptionGroup machinery)
      //   - prune higher-level features when re-importing at a lower level
      //
      // We deliberately pass *empty* proficiency-selection arrays. The
      // legacy apply* helpers had two issues for this flow: skill slugs
      // arrived prefixed (`skills:acr`) and were silently written to
      // garbage paths, and HP at level 1 didn't apply. CharacterUpdater
      // — fed by the per-advancement loop above — is the source of truth
      // for the actor-root surface (skills / saves / tools / languages /
      // damage traits / HP). Calling its `commit()` after the bridge
      // applies those writes via flat dotted-key updates with proper
      // prefix stripping.
      //
      // optionSelections is still passed through because the legacy path
      // uses it to decide which option items to embed (not to apply
      // proficiencies — those flow through CharacterUpdater).
      const importSelection = {
        includeSubclass,
        subclassSourceId,
        optionSelections: state.optionSelections ?? {},
        hpMode: null,
        hpCustomFormula: null,
        skillSelections: [],
        toolSelections: [],
        savingThrowSelections: [],
        languageSelections: [],
        traitSelections: {}
      };

      log("Bridging to importClassPayloadToWorld", {
        actor: actor.name,
        targetLevel: state.targetLevel,
        importSelection,
        characterUpdaterDelta: sequence.characterUpdater?.tempData ?? null
      });

      try {
        const result = await importClassPayloadToWorld(payload, {
          entry,
          actor,
          targetLevel: state.targetLevel,
          importSelection,
          folderPath
        });
        if (!result) {
          progress.setStatus("Import did not complete — see console for details.", "danger");
          progress.setFinished(true);
          return null;
        }

        // Apply actor-root proficiencies and the HP increase via the
        // manual delta CharacterUpdater accumulated during the loop.
        if (sequence.characterUpdater) {
          try {
            await sequence.characterUpdater.commit();
          } catch (error) {
            console.warn(`${MODULE_ID} | CharacterUpdater commit failed (bridge already succeeded)`, error);
            notifyWarn(`Class imported, but applying proficiencies failed: ${error?.message ?? error}`);
          }
        }

        progress.setStatus(`Imported ${result.name ?? "class"} ${state.targetLevel} onto ${actor.name}.`, "success");
      } catch (error) {
        console.error(`${MODULE_ID} | Import failed`, error);
        progress.setStatus(`Import failed: ${error?.message ?? error}`, "danger");
        notifyWarn(`Import failed: ${error?.message ?? error}`);
        progress.setFinished(true);
        return null;
      }
    } else {
      progress.setStatus("All advancements selected. Workflow complete.", "success");
    }

    progress.setFinished(true);
    await pause(500);
    await progress.close();
    return actor ?? true;

  } catch (error) {
    if (error instanceof DauligorImportSequenceCancelledError || sequence.cancelled) {
      progress.setStatus("Import cancelled.", "danger");
      progress.setFinished(true);
      await pause(150);
      await progress.close();
      return null;
    }

    console.error(`${MODULE_ID} | Class import sequence failed`, error);
    progress.setStatus(error?.message ?? "Import failed.", "danger");
    progress.markStep("import", "error", error?.message ?? "Import failed.");
    progress.setFinished(true);
    return null;
  }
}

function createImportSequenceState(workflow, initialTargetLevel = 1, preferredSubclassSourceId = null) {
  const existingLevel = Number(workflow?.existingClassLevel ?? workflow?.existingClassItem?.system?.levels ?? 0) || 0;
  const selectedTargetLevel = workflow?.targetLevel ?? clampLevel(initialTargetLevel ?? 1);
  return {
    targetLevel: clampLevel(Math.max(selectedTargetLevel || 1, existingLevel || 1)),
    includeSubclass: Boolean(preferredSubclassSourceId),
    subclassSourceId: preferredSubclassSourceId ?? null,
    hpMode: workflow?.selection?.hpMode ?? "average",
    hpCustomFormula: resolveHpCustomFormulaForWorkflow(workflow?.selection?.hpCustomFormula, workflow),
    spellMode: workflow?.selection?.spellMode ?? (workflow?.hasSpellcasting ? "placeholder" : null),
    optionSelections: foundry.utils.deepClone(workflow?.selection?.optionSelections ?? {}),
    skillSelections: foundry.utils.deepClone(workflow?.selection?.skillSelections ?? []),
    toolSelections: foundry.utils.deepClone(workflow?.selection?.toolSelections ?? []),
    savingThrowSelections: foundry.utils.deepClone(workflow?.selection?.savingThrowSelections ?? []),
    languageSelections: foundry.utils.deepClone(workflow?.selection?.languageSelections ?? []),
    traitSelections: foundry.utils.deepClone(workflow?.selection?.traitSelections ?? {})
  };
}

function getDefaultHpCustomFormula(workflow) {
  const number = Math.max(1, Number(workflow?.classItem?.system?.hd?.number ?? 1) || 1);
  const faces = getWorkflowHitDieFaces(workflow);
  const average = Math.ceil((faces + 1) / 2);
  return `${number}d${faces}min${average}`;
}

function resolveHpCustomFormulaForWorkflow(currentFormula, workflow) {
  const normalized = String(currentFormula ?? "").trim();
  const fallback = getDefaultHpCustomFormula(workflow);
  if (!normalized) return fallback;
  if (normalized === "1d8min5" && fallback !== normalized) return fallback;
  return normalized;
}

function getWorkflowHitDieFaces(workflow) {
  const semanticValue = Number(workflow?.semanticClassData?.hitDie ?? 0);
  if (Number.isFinite(semanticValue) && semanticValue > 0) return semanticValue;

  const flaggedValue = Number(workflow?.classItem?.flags?.[MODULE_ID]?.hitDieValue ?? 0);
  if (Number.isFinite(flaggedValue) && flaggedValue > 0) return flaggedValue;

  return parseHitDieFaces(workflow?.classItem?.system?.hd?.denomination ?? workflow?.classItem?.system?.hd?.faces ?? null);
}

function parseHitDieFaces(value) {
  const text = String(value ?? "").trim().toLowerCase();
  const match = /^d(\d+)$/.exec(text);
  if (match) return Math.max(1, Number(match[1]) || 6);

  const numeric = Number(value ?? 0);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;

  return 6;
}

function buildWorkflowFromSequenceState(payload, { entry = null, actor = null, state = {} } = {}) {
  return buildClassImportWorkflow(payload, {
    entry,
    actor,
    targetLevel: state.targetLevel,
    preferredSubclassSourceId: state.subclassSourceId ?? null,
    importSelection: {
      includeSubclass: state.includeSubclass,
      subclassSourceId: state.subclassSourceId,
      optionSelections: state.optionSelections,
      hpMode: state.hpMode,
      hpCustomFormula: state.hpCustomFormula,
      spellMode: state.spellMode,
      skillSelections: state.skillSelections,
      toolSelections: state.toolSelections,
      savingThrowSelections: state.savingThrowSelections,
      languageSelections: state.languageSelections,
      traitSelections: state.traitSelections
    }
  });
}

/**
 * Coerce a feature-level Trait advancement into the
 * `{ title, choiceCount, fixed, options }` shape `runTraitSelectionStep`
 * expects. Handles both authoring formats: the new
 * `configuration.choices = [{ count, pool }]` shape and the legacy
 * `configuration: { type, choiceCount, options }` shape. Returns null
 * when the advancement has no actionable user choice.
 */
function extractFeatureTraitChoice(adv) {
  if (!adv) return null;
  const cfg = adv.configuration ?? {};

  // Pull "fixed" grants from configuration.grants (if present) — these
  // are auto-applied alongside choices. The renderer just shows them;
  // CharacterUpdater writes them via the same applyMixedTraitSelections
  // path when it's the active commit point. (Currently the bridge owns
  // root-level fixed grants on first import, so we surface them as
  // labels only and let the user see what's auto-granted.)
  const grantsArray = Array.isArray(cfg.grants) ? cfg.grants : [];
  const fixed = grantsArray.filter((entry) => typeof entry === "string");

  const mode = String(cfg.mode || "default") || "default";
  const poolSource = String(cfg.poolSource || "static") || "static";
  const traitType = String(cfg.type || "") || "";

  // poolSource = "proficient" means the pool is derived at runtime from
  // the actor's proficient traits — the authored options[] is empty by
  // design. count=0 means "auto-apply to every match" (e.g. "All tools
  // you are proficient in gain expertise"); count>0 means "pick N from
  // your current proficiencies".
  if (poolSource === "proficient") {
    return {
      title: adv.title || "Trait Selection",
      choiceCount: Number(cfg.choiceCount ?? cfg.choices?.[0]?.count ?? 0) || 0,
      fixed,
      options: [], // derived at runtime by deriveProficientPool
      mode,
      poolSource,
      traitType
    };
  }

  // New format — choice block carries pool + count
  for (const c of (cfg.choices || [])) {
    if (c?.count > 0 && Array.isArray(c.pool) && c.pool.length > 0) {
      return {
        title: adv.title || "Trait Selection",
        choiceCount: Number(c.count) || 0,
        fixed,
        options: c.pool.filter((slug) => typeof slug === "string"),
        mode,
        poolSource,
        traitType
      };
    }
  }

  // Legacy format
  if (cfg.type && Number(cfg.choiceCount) > 0 && Array.isArray(cfg.options) && cfg.options.length > 0) {
    return {
      title: adv.title || "Trait Selection",
      choiceCount: Number(cfg.choiceCount),
      fixed,
      options: cfg.options.filter((slug) => typeof slug === "string"),
      mode,
      poolSource,
      traitType
    };
  }

  return null;
}

/**
 * Build the candidate pool from the actor's current proficient traits
 * for a given trait type. Used by Trait advancements with
 * `poolSource === "proficient"` (e.g. "Choose one skill you are
 * proficient in to gain expertise"). Slugs are returned in the
 * `<traitType>:<id>` form so they flow through the same writers as the
 * authored pool.
 */
function deriveProficientPool(actor, traitType) {
  if (!actor || !traitType) return [];
  const out = [];
  const seen = new Set();
  const add = (prefix, id) => {
    if (!id) return;
    const slug = `${prefix}:${id}`;
    if (seen.has(slug)) return;
    seen.add(slug);
    out.push(slug);
  };

  switch (traitType) {
    case "skills": {
      const skills = actor.system?.skills ?? {};
      for (const [id, entry] of Object.entries(skills)) {
        if (Number(entry?.value ?? 0) >= 1) add("skills", id);
      }
      break;
    }
    case "tools": {
      const tools = actor.system?.tools ?? {};
      for (const [id, entry] of Object.entries(tools)) {
        if (Number(entry?.value ?? 0) >= 1) add("tools", id);
      }
      const traitArr = ensureArray(actor.system?.traits?.toolProf?.value);
      for (const id of traitArr) add("tools", id);
      break;
    }
    case "saves": {
      const abilities = actor.system?.abilities ?? {};
      for (const [id, entry] of Object.entries(abilities)) {
        if (Number(entry?.proficient ?? 0) >= 1) add("saves", id);
      }
      break;
    }
    default:
      break;
  }
  return out;
}

function buildImportSequenceSteps(workflow, { actor = null } = {}) {
  const steps = [
    { id: "prepare", label: "Prepare import" }
  ];

  if (actor) {
    steps.push({ id: "levels", label: "Choose class levels" });
    steps.push({ id: "hp", label: "Choose hit point mode" });
    if (workflow?.skillChoices?.choiceCount > 0 && workflow?.skillChoices?.allOptions?.length) {
      steps.push({ id: "skills", label: "Choose skill proficiencies" });
    }
    if (workflow?.toolChoices?.choiceCount > 0 && workflow?.toolChoices?.allOptions?.length) {
      steps.push({ id: "tools", label: "Choose tool proficiencies" });
    }
    if (workflow?.hasSubclassSupport
      && (workflow?.subclassItems?.length ?? 0) > 0
      && Number(workflow?.targetLevel ?? 1) >= Number(workflow?.minSubclassLevel ?? Infinity)) {
      steps.push({ id: "subclass", label: "Choose subclass" });
    }
    for (const group of ensureArray(workflow?.optionGroups).filter((candidate) => candidate.options.length && candidate.maxSelections > 0)) {
      steps.push({
        id: `option:${group.sourceId}`,
        label: group.name || group.featureName || "Choose class options"
      });
    }
  }

  // Spells / starting-equipment placeholder steps stay disabled until the
  // corresponding flows are wired. `runSpellPlaceholderStep` and
  // `runEquipmentPlaceholderStep` exist as stubs but aren't called from
  // the sequence loop yet.

  steps.push({ id: "import", label: "Import class" });
  return steps;
}

function throwIfSequenceCancelled(sequence) {
  if (sequence?.cancelled) {
    throw new DauligorImportSequenceCancelledError();
  }
}

async function runSubclassStep({ workflow, sequence, progress, entry = null }) {
  const stepId = "subclass";
  progress.markStep(stepId, "active", "Choose the subclass to import alongside the base class.");
  progress.setStatus("Waiting for subclass selection...");

  // The catalog ships an explicit `shortName` per subclass entry — that's the
  // canonical book label (e.g. "TCoE", "XGE"). The Foundry-shaped subclass
  // item the bundle gives us instead carries `system.source.book` derived
  // from the *parent class's* source record (the bundle only exposes one
  // top-level source), so deriveSourceLabel(item.system.source.book) ends
  // up showing "PHB" for every subclass even when the subclass was
  // published in a different book. Build a sourceId → shortName map from
  // the catalog entry once and prefer it.
  const catalogShortNameBySubclassSourceId = new Map();
  for (const sub of ensureArray(entry?.subclasses)) {
    if (sub?.sourceId && sub?.shortName) {
      catalogShortNameBySubclassSourceId.set(sub.sourceId, sub.shortName);
    }
  }

  const result = await DauligorSequencePromptApp.prompt({
    title: "Choose Subclass",
    subtitle: "Select the subclass to import with the base class.",
    width: 620,
    height: 420,
    state: {
      subclassSourceId: workflow.selection.subclassSourceId ?? workflow.subclassItems[0]?.flags?.[MODULE_ID]?.sourceId ?? null
    },
    renderBody: (app) => `
      <div class="dauligor-class-options__choice-list">
        ${workflow.subclassItems.map((item) => {
      const sourceId = item.flags?.[MODULE_ID]?.sourceId ?? "";
      const sourceLabel = catalogShortNameBySubclassSourceId.get(sourceId)
        || deriveSourceLabel(item.system?.source?.book ?? item.flags?.plutonium?.source);
      return `
            <label class="dauligor-class-options__radio">
              <input type="radio" name="subclass-source-id" value="${foundry.utils.escapeHTML(sourceId)}" ${app._state.subclassSourceId === sourceId ? "checked" : ""}>
              <span class="dauligor-sequence__choice-copy">
                <span>${foundry.utils.escapeHTML(item.name)}</span>
                ${sourceLabel ? `<span class="dauligor-sequence__choice-meta">${foundry.utils.escapeHTML(sourceLabel)}</span>` : ""}
              </span>
            </label>
          `;
    }).join("")}
      </div>
    `,
    onRenderBody: (app, root) => {
      root.querySelectorAll(`input[name="subclass-source-id"]`).forEach((input) => {
        input.addEventListener("change", () => {
          app.updateState({ subclassSourceId: input.value || null });
        });
      });
    },
    actions: [
      { id: "confirm", label: "OK", primary: true },
      { id: "cancel", label: "Cancel" }
    ],
    onAction: async (app, actionId) => {
      if (actionId === "cancel") return { status: "cancelled" };
      if (!app._state.subclassSourceId) {
        notifyWarn("Choose a subclass before continuing.");
        return false;
      }
      return { status: "confirmed", value: app._state.subclassSourceId };
    }
  }, sequence);

  if (result.status === "cancelled") return "cancelled";

  const selectedName = workflow.subclassItems.find((item) => (item.flags?.[MODULE_ID]?.sourceId ?? null) === result.value)?.name ?? "Subclass";
  progress.markStep(stepId, "complete", `${selectedName} selected.`);
  return result.value;
}


async function runTraitSelectionStep({ title, fieldName, advancement, workflow, sequence, progress }) {
  const stepId = `advancement:${fieldName}`;
  progress.markStep(stepId, "active", `Advancement step for ${title}.`);
  progress.setStatus(`Waiting for ${title} choices...`);

  const fixed = advancement.fixed || [];
  const options = advancement.options || [];
  const choiceCount = advancement.choiceCount || 0;
  const targetActor = workflow?.targetActor ?? null;
  // When the pool source is "proficient", every option is by definition
  // already on the actor — being proficient is the *qualifier* for
  // appearing in the pool, not a disqualifier. Suppress the greying so
  // those rows stay clickable. Mode = "expertise" prompts read
  // "Choose one to gain expertise" which is meaningful only when the
  // actor already has the proficiency.
  const poolSource = advancement.poolSource || "static";
  const mode = advancement.mode || "default";
  const skipAlreadyMarkedGate = poolSource === "proficient";
  const subtitleSuffix = mode === "expertise" || mode === "forcedExpertise"
    ? " Selected traits gain expertise."
    : mode === "upgrade"
      ? " Selected traits are upgraded one tier."
      : "";
  const subtitleFixed = poolSource === "proficient"
    ? ""
    : ` Fixed: ${fixed.map(val => formatFoundryLabel(val)).join(', ') || 'None'}.`;

  const result = await DauligorSequencePromptApp.prompt({
    title: title,
    subtitle: `Choose ${numberToWord(choiceCount)} option(s).${subtitleFixed}${subtitleSuffix}`,
    width: 650,
    height: 450,
    state: {
      selections: []
    },
    renderBody: (app) => `
      <div class="dauligor-class-options__choice-list">
        ${options.map((slug) => {
          const isChecked = app._state.selections.includes(slug);
          const alreadyHas = !skipAlreadyMarkedGate
            && isAlreadyMarked(targetActor, sequence?.characterUpdater, fieldName, slug);
          const label = formatFoundryLabel(slug);
          const abilityMatch = slug.match(/^(saves):([a-z]{3})$/i);
          const metaLabel = abilityMatch ? formatAbilityAbbreviation(abilityMatch[2]) : "";

          return `
            <label class="dauligor-class-options__checkbox ${alreadyHas ? "dauligor-class-options__checkbox--disabled" : ""}">
              <input type="checkbox" data-action="toggle-item" data-slug="${foundry.utils.escapeHTML(slug)}" ${isChecked ? "checked" : ""} ${alreadyHas ? "disabled" : ""}>
              <span class="dauligor-class-options__checkbox-copy">
                <span class="dauligor-class-options__checkbox-title">${foundry.utils.escapeHTML(label)}${alreadyHas ? " <span style='color:var(--dauligor-text-muted);font-size:10px;letter-spacing:.08em;text-transform:uppercase;'>· already proficient</span>" : ""}</span>
                ${metaLabel ? `<span class="dauligor-class-options__checkbox-meta">${foundry.utils.escapeHTML(metaLabel)}</span>` : ""}
              </span>
            </label>
          `;
        }).join("")}
      </div>
    `,
    onRenderBody: (app, root) => {
      root.querySelectorAll(`[data-action="toggle-item"]`).forEach((input) => {
        input.addEventListener("change", () => {
          if (input.disabled) return;
          const slug = input.dataset.slug;
          const current = new Set(app._state.selections || []);
          if (input.checked) current.add(slug);
          else current.delete(slug);

          if (current.size > choiceCount) {
            notifyWarn(`You can only choose ${choiceCount} option(s).`);
            input.checked = false;
            return;
          }
          app.updateState({ selections: [...current] });
        });
      });
    },
    actions: [
      { id: "confirm", label: "OK", primary: true },
      { id: "cancel", label: "Cancel" },
      { id: "skip", label: "Skip" }
    ],
    onAction: async (app, actionId) => {
      if (actionId === "cancel") return { status: "cancelled" };
      if (actionId === "skip") return { status: "skipped" };

      if (choiceCount > 0 && (app._state.selections?.length ?? 0) !== choiceCount) {
        notifyWarn(`Choose exactly ${choiceCount} option(s).`);
        return false;
      }

      return { status: "confirmed", value: app._state.selections };
    }
  }, sequence);

  if (result.status === "cancelled") return "cancelled";
  if (result.status === "skipped") {
    progress.markStep(stepId, "skipped", `Skipped ${title} selection.`);
    return [];
  }
  progress.markStep(stepId, "complete", `Selected ${result.value.length} ${title} option(s).`);
  return result.value;
}

async function runLevelSelectionStep({ workflow, sequence, progress }) {
  const stepId = "levels";
  // The actor's actual current class level (used for status text — "Current
  // class level: 3"). 0 on a fresh import.
  const existingLevel = Number(workflow.existingClassLevel ?? workflow.existingClassItem?.system?.levels ?? 0) || 0;
  // The lowest level the user can pick: existing+1 on level-up (since 1..existing
  // are locked rows), or 1 on a fresh import. Used by the click-handler clamp.
  const minimumLevel = existingLevel > 0 ? Math.min(20, existingLevel + 1) : 1;
  const hasExistingLevels = existingLevel > 0;
  const levelWindowTitle = workflow.selection.includeSubclass ? "Select Class and Subclass Levels" : "Select Class Levels";
  progress.markStep(stepId, "active", hasExistingLevels
    ? `Continue leveling from class level ${existingLevel}.`
    : "Choose the highest class level to import.");
  progress.setStatus("Waiting for class level selection...");

  const result = await DauligorSequencePromptApp.prompt({
    title: levelWindowTitle,
    subtitle: hasExistingLevels
      ? `Current class level: ${existingLevel}. Select the ending level for this import.`
      : "Select the ending class level for this import.",
    width: 600,
    height: 540,
    state: {
      minimumLevel,
      targetLevel: Math.max(workflow.targetLevel ?? 1, minimumLevel)
    },
    renderBody: (app) => {
      const rows = workflow.levelRows.map((row) => `
        <label
          class="dauligor-class-options__levels-row ${row.level === app._state.targetLevel ? "is-current" : ""} ${row.level <= app._state.targetLevel ? "is-selected" : ""} ${row.locked ? "is-locked" : ""}"
          data-level-row="${row.level}"
        >
          <span class="dauligor-class-options__levels-cell dauligor-class-options__levels-cell--check">
            <input
              type="${row.locked ? "checkbox" : "radio"}"
              name="class-target-level"
              data-action="level-row"
              data-level="${row.level}"
              ${row.locked ? "checked" : row.level === app._state.targetLevel ? "checked" : ""}
              ${row.locked ? "disabled" : ""}
            >
          </span>
          <span class="dauligor-class-options__levels-cell dauligor-class-options__levels-cell--level">${row.level}</span>
          <span class="dauligor-class-options__levels-cell">${foundry.utils.escapeHTML(row.featureSummary)}</span>
        </label>
      `).join("");

      return `
        <div class="dauligor-class-options__levels dauligor-class-options__levels--compact">
          <div class="dauligor-class-options__levels-header dauligor-class-options__levels-header--compact">
            <span class="dauligor-class-options__levels-cell dauligor-class-options__levels-cell--check">
              <input type="checkbox" disabled ${hasExistingLevels ? "checked" : ""}>
            </span>
            <span class="dauligor-class-options__levels-cell dauligor-class-options__levels-cell--level">Level</span>
            <span class="dauligor-class-options__levels-cell">Features</span>
          </div>
          ${rows}
        </div>
      `;
    },
    onRenderBody: (app, root) => {
      root.querySelectorAll(`[data-action="level-row"]`).forEach((input) => {
        input.addEventListener("change", () => {
          const level = clampLevel(input.dataset.level ?? input.value ?? 1);
          if (level < app._state.minimumLevel) {
            input.checked = true;
            return;
          }
          app.updateState({ targetLevel: level });
          app.rerenderPrompt();
        });
      });
      root.querySelectorAll(`[data-level-row]`).forEach((row) => {
        row.addEventListener("click", (event) => {
          if (event.target instanceof HTMLInputElement) return;
          const level = clampLevel(row.dataset.levelRow ?? 1);
          if (level < app._state.minimumLevel) return;
          app.updateState({ targetLevel: level });
          app.rerenderPrompt();
        });
      });
    },
    actions: [
      { id: "confirm", label: "OK", primary: true },
      { id: "cancel", label: "Cancel" }
    ],
    onAction: async (app, actionId) => {
      if (actionId === "cancel") return { status: "cancelled" };
      return { status: "confirmed", value: Math.max(clampLevel(app._state.targetLevel ?? 1), app._state.minimumLevel ?? 1) };
    }
  }, sequence);

  if (result.status === "cancelled") return "cancelled";
  progress.markStep(stepId, "complete", hasExistingLevels
    ? `Continuing from level ${minimumLevel} to level ${result.value}.`
    : `Level ${result.value} selected.`);
  return clampLevel(result.value ?? 1);
}

async function runHpModeStep({ workflow, sequence, progress }) {
  const stepId = "hp";
  progress.markStep(stepId, "active", "Choose how hit points should be handled for this import.");
  progress.setStatus("Waiting for hit point mode...");

  const hpOptions = [
    { value: "average", label: "Take Average" },
    { value: "minimum", label: "Minimum Value" },
    { value: "maximum", label: "Maximum Value" },
    { value: "roll", label: "Roll" },
    { value: "custom", label: "Roll (Custom Formula)" },
    { value: "none", label: "Do Not Increase HP" }
  ];

  const result = await DauligorSequencePromptApp.prompt({
    title: "Select Hit Points Increase Mode",
    width: 520,
    height: 280,
    state: {
      hpMode: workflow.selection.hpMode ?? "average",
      hpCustomFormula: resolveHpCustomFormulaForWorkflow(workflow.selection.hpCustomFormula, workflow)
    },
    renderBody: (app) => `
      <div class="dauligor-sequence__hp-mode">
        <label class="dauligor-sequence__select-field">
          <select class="dauligor-sequence__select" data-action="hp-mode-select">
            ${hpOptions.map((option) => `
              <option value="${option.value}" ${app._state.hpMode === option.value ? "selected" : ""}>${foundry.utils.escapeHTML(option.label)}</option>
            `).join("")}
          </select>
        </label>
        ${app._state.hpMode === "custom" ? `
          <label class="dauligor-sequence__text-field">
            <span class="dauligor-sequence__field-label">Custom Formula</span>
            <input
              type="text"
              class="dauligor-class-browser__input dauligor-sequence__code-input"
              data-action="hp-custom-formula"
              value="${foundry.utils.escapeHTML(app._state.hpCustomFormula ?? "")}"
              placeholder="${foundry.utils.escapeHTML(getDefaultHpCustomFormula(workflow))}"
            >
          </label>
        ` : ""}
      </div>
    `,
    onRenderBody: (app, root) => {
      root.querySelector(`[data-action="hp-mode-select"]`)?.addEventListener("change", (event) => {
        const nextMode = event.currentTarget.value || "average";
        const nextFormula = nextMode === "custom" && !String(app._state.hpCustomFormula ?? "").trim()
          ? resolveHpCustomFormulaForWorkflow(null, workflow)
          : app._state.hpCustomFormula;
        app.updateState({
          hpMode: nextMode,
          hpCustomFormula: nextFormula
        });
        app.rerenderPrompt();
      });
      root.querySelector(`[data-action="hp-custom-formula"]`)?.addEventListener("input", (event) => {
        app.updateState({ hpCustomFormula: event.currentTarget.value || "" });
      });
    },
    actions: [
      { id: "confirm", label: "OK", primary: true },
      { id: "cancel", label: "Cancel" },
      { id: "skip", label: "Skip" }
    ],
    onAction: async (app, actionId) => {
      if (actionId === "cancel") return { status: "cancelled" };
      if (actionId === "skip") return { status: "skipped" };
      if (app._state.hpMode === "custom" && !String(app._state.hpCustomFormula ?? "").trim()) {
        notifyWarn("Enter a custom HP formula before continuing.");
        return false;
      }
      return {
        status: "confirmed",
        value: {
          hpMode: app._state.hpMode ?? "average",
          hpCustomFormula: String(app._state.hpCustomFormula ?? "").trim() || null
        }
      };
    }
  }, sequence);

  if (result.status === "cancelled") return "cancelled";
  if (result.status === "skipped") {
    progress.markStep(stepId, "skipped", "Kept the existing hit point preference.");
    return undefined;
  }
  progress.markStep(stepId, "complete", `HP mode: ${hpOptions.find((option) => option.value === result.value?.hpMode)?.label ?? result.value?.hpMode}.`);
  return result.value;
}

async function runSkillSelectionStep({ workflow, sequence, progress, advancement = null }) {
  const stepId = "skills";
  progress.markStep(stepId, "active", "Choose the class skill proficiency options.");
  progress.setStatus("Waiting for skill proficiency choices...");

  const choices = advancement ? {
    fixed: advancement.fixed || [],
    allOptions: [...new Set([...(advancement.fixed || []), ...(advancement.options || [])])],
    choiceCount: advancement.choiceCount || 0
  } : workflow.skillChoices;


  const fixedSkills = new Set(choices.fixed);
  const targetActor = workflow?.targetActor ?? null;

  const result = await DauligorSequencePromptApp.prompt({
    title: "Skill Proficiencies",
    subtitle: `Choose ${numberToWord(choices.choiceCount)} skill proficienc${choices.choiceCount === 1 ? "y" : "ies"}.`,
    width: 660,
    height: 520,
    state: {
      selectedSkills: [...(advancement ? [] : workflow.selection.skillSelections)]
    },
    renderBody: (app) => `
      <div class="dauligor-class-options__choice-list">
        ${choices.allOptions.map((slug) => {
      const isFixed = fixedSkills.has(slug);
      const alreadyHas = !isFixed && isAlreadyMarked(targetActor, sequence?.characterUpdater, "skills", slug);
      const isChecked = app._state.selectedSkills.includes(slug) || isFixed;
      const disabled = isFixed || alreadyHas;

      const skillLabel = formatFoundryLabel(slug);

      // Attempt to get ability meta info from CONFIG if possible
      let abilityLabel = "";
      if (typeof CONFIG !== 'undefined' && CONFIG.DND5E?.skills) {
        const skillConfig = CONFIG.DND5E.skills[slug.replace(/^skills:/, "")] ?? {};
        if (skillConfig.ability) abilityLabel = formatAbilityAbbreviation(skillConfig.ability);
      }

      const tag = isFixed ? "Fixed" : (alreadyHas ? "Already Proficient" : "");

      return `

            <label class="dauligor-class-options__checkbox ${disabled ? "dauligor-class-options__checkbox--disabled" : ""}">
              <input
                type="checkbox"
                data-action="toggle-skill"
                data-skill-slug="${foundry.utils.escapeHTML(slug)}"
                ${isChecked ? "checked" : ""}
                ${disabled ? "disabled" : ""}
              >
              <span class="dauligor-class-options__checkbox-copy">
                <span class="dauligor-class-options__checkbox-title">${foundry.utils.escapeHTML(skillLabel)}</span>
              <span class="dauligor-class-options__checkbox-meta">${foundry.utils.escapeHTML(abilityLabel)}${tag ? ` · ${tag}` : ""}</span>
              </span>
            </label>
          `;
    }).join("")}
      </div>
    `,
    onRenderBody: (app, root) => {
      root.querySelectorAll(`[data-action="toggle-skill"]`).forEach((input) => {
        input.addEventListener("change", () => {
          if (input.disabled) return;
          const slug = input.dataset.skillSlug;
          if (!slug) return;

          const fixed = new Set(workflow.skillChoices.fixed);
          const current = new Set(app._state.selectedSkills ?? []);
          if (input.checked) current.add(slug);
          else current.delete(slug);

          const chosen = [...current].filter((selected) => !fixed.has(selected));
          if (chosen.length > choices.choiceCount) {
            notifyWarn(`Choose only ${choices.choiceCount} skill proficiency option(s).`);
            input.checked = false;
            return;
          }

          app.updateState({ selectedSkills: [...current] });
        });
      });
    },
    actions: [
      { id: "confirm", label: "OK", primary: true },
      { id: "cancel", label: "Cancel" },
      { id: "skip", label: "Skip" }
    ],
    onAction: async (app, actionId) => {
      if (actionId === "cancel") return { status: "cancelled" };
      if (actionId === "skip") return { status: "skipped" };

      const chosen = [...new Set(app._state.selectedSkills ?? [])].filter((selected) => !fixedSkills.has(selected));
      if (chosen.length !== choices.choiceCount) {
        notifyWarn(`Choose exactly ${choices.choiceCount} skill proficiency option(s).`);
        return false;
      }

      return { status: "confirmed", value: [...new Set(app._state.selectedSkills ?? [])] };
    }
  }, sequence);

  if (result.status === "cancelled") return "cancelled";
  if (result.status === "skipped") {
    progress.markStep(stepId, "skipped", "Kept the current skill selections.");
    return undefined;
  }
  progress.markStep(stepId, "complete", `Selected ${result.value.length} skill proficiency option(s).`);
  return result.value;
}

async function runToolSelectionStep({ workflow, sequence, progress, advancement = null }) {
  const stepId = "tools";
  progress.markStep(stepId, "active", "Choose the class tool proficiency options.");
  progress.setStatus("Waiting for tool proficiency choices...");

  const choices = advancement ? {
    fixed: advancement.fixed || [],
    allOptions: [...new Set([...(advancement.fixed || []), ...(advancement.options || [])])],
    choiceCount: advancement.choiceCount || 0
  } : workflow.toolChoices;


  const fixedTools = new Set(choices.fixed);
  const targetActor = workflow?.targetActor ?? null;

  const result = await DauligorSequencePromptApp.prompt({
    title: "Tool Proficiencies",
    subtitle: `Choose ${numberToWord(choices.choiceCount)} tool proficienc${choices.choiceCount === 1 ? "y" : "ies"}.`,
    width: 660,
    height: 520,
    state: {
      selectedTools: [...(advancement ? [] : workflow.selection.toolSelections)]
    },
    renderBody: (app) => `
      <div class="dauligor-class-options__choice-list">
        ${choices.allOptions.map((slug) => {
      const isFixed = fixedTools.has(slug);
      const alreadyHas = !isFixed && isAlreadyMarked(targetActor, sequence?.characterUpdater, "tools", slug);
      const isChecked = app._state.selectedTools.includes(slug) || isFixed;
      const disabled = isFixed || alreadyHas;

      const toolLabel = formatFoundryLabel(slug);

      let abilityLabel = "";
      if (typeof CONFIG !== 'undefined' && CONFIG.DND5E?.tools) {
        const toolConfig = CONFIG.DND5E.tools[slug.replace(/^tools:/, "")] ?? {};
        if (toolConfig.ability) abilityLabel = formatAbilityAbbreviation(toolConfig.ability);
      }

      const tag = isFixed ? "Fixed" : (alreadyHas ? "Already Proficient" : "");

      return `

            <label class="dauligor-class-options__checkbox ${disabled ? "dauligor-class-options__checkbox--disabled" : ""}">
              <input
                type="checkbox"
                data-action="toggle-tool"
                data-tool-slug="${foundry.utils.escapeHTML(slug)}"
                ${isChecked ? "checked" : ""}
                ${disabled ? "disabled" : ""}
              >
              <span class="dauligor-class-options__checkbox-copy">
                <span class="dauligor-class-options__checkbox-title">${foundry.utils.escapeHTML(toolLabel)}</span>
                <span class="dauligor-class-options__checkbox-meta">${foundry.utils.escapeHTML(abilityLabel)}${tag ? ` · ${tag}` : ""}</span>
              </span>
            </label>
          `;
    }).join("")}
      </div>
    `,
    onRenderBody: (app, root) => {
      root.querySelectorAll(`[data-action="toggle-tool"]`).forEach((input) => {
        input.addEventListener("change", () => {
          if (input.disabled) return;
          const slug = input.dataset.toolSlug;
          if (!slug) return;

          const fixed = new Set(workflow.toolChoices.fixed);
          const current = new Set(app._state.selectedTools ?? []);
          if (input.checked) current.add(slug);
          else current.delete(slug);

          const chosen = [...current].filter((selected) => !fixed.has(selected));
          if (chosen.length > choices.choiceCount) {
            notifyWarn(`Choose only ${choices.choiceCount} tool proficiency option(s).`);
            input.checked = false;
            return;
          }

          app.updateState({ selectedTools: [...current] });
        });
      });
    },
    actions: [
      { id: "confirm", label: "OK", primary: true },
      { id: "cancel", label: "Cancel" },
      { id: "skip", label: "Skip" }
    ],
    onAction: async (app, actionId) => {
      if (actionId === "cancel") return { status: "cancelled" };
      if (actionId === "skip") return { status: "skipped" };

      const chosen = [...new Set(app._state.selectedTools ?? [])].filter((selected) => !fixedTools.has(selected));
      if (chosen.length !== choices.choiceCount) {
        notifyWarn(`Choose exactly ${choices.choiceCount} tool proficiency option(s).`);
        return false;
      }

      return { status: "confirmed", value: [...new Set(app._state.selectedTools ?? [])] };
    }
  }, sequence);

  if (result.status === "cancelled") return "cancelled";
  if (result.status === "skipped") {
    progress.markStep(stepId, "skipped", "Kept the current tool selections.");
    return undefined;
  }
  progress.markStep(stepId, "complete", `Selected ${result.value.length} tool proficiency option(s).`);
  return result.value;
}

async function runOptionGroupStep({ workflow, actor, group, sequence, progress }) {
  const stepId = `option:${group.sourceId}`;
  progress.markStep(stepId, "active", `Choose ${group.maxSelections} option(s) from ${group.name || group.featureName || "this pool"}.`);
  progress.setStatus(`Waiting for ${group.name || group.featureName || "class option"} choices...`);

  // ─── Setup: lookups + context ──────────────────────────────────────────
  // The original picker was a flat checkbox list. Players need more
  // signal:
  //   - what does this option *do*  (description)
  //   - what does it require        (prereqs)
  //   - is it gated and by what     (level / ability / another option)
  //   - is it already mine          (greyed-out selected state)
  // The redesign below lays the dialog out as list + detail panel,
  // groups options by their level prerequisite under headers, and adds
  // status icons + clickable "jump to prereq" navigation.

  // Source-ids the user has already picked in earlier option-group prompts
  // this import. Combined with the in-flight selections inside this prompt
  // they form the "satisfied" set the requirements walker checks
  // `optionItem` leaves against.
  const priorSelections = new Set();
  for (const arr of Object.values(workflow?.selection?.optionSelections ?? {})) {
    for (const sid of ensureArray(arr)) priorSelections.add(sid);
  }

  // Source-ids of options ALREADY on the actor from a prior import — used
  // to grey-out (and prevent re-picking) selections the actor already has
  // on the books. The user-facing rule is "already selected = greyed",
  // which on a re-import surfaces as the old picks being locked in.
  const previouslyOwnedSourceIds = new Set();
  for (const item of ensureArray(actor?.items)) {
    const sid = item?.flags?.[MODULE_ID]?.sourceId;
    if (sid) previouslyOwnedSourceIds.add(sid);
  }

  // Global sourceId → option-record lookup across every option group in
  // the workflow. Used by the detail panel when a prereq points at an
  // option that lives in a different group (e.g. a Warlock invocation
  // referencing Pact of the Blade — pacts are in their own group).
  const allOptionsBySourceId = {};
  for (const grp of ensureArray(workflow?.optionGroups)) {
    for (const opt of ensureArray(grp?.options)) {
      const sid = opt.flags?.[MODULE_ID]?.sourceId;
      if (sid) allOptionsBySourceId[sid] = { item: opt, group: grp };
    }
  }
  const optionItemNameBySourceId = Object.fromEntries(
    Object.entries(allOptionsBySourceId).map(([sid, entry]) => [sid, entry.item.name])
  );

  // Build the format-lookup the walker uses for human-readable
  // requirement text. classNameById is best-effort — only the class
  // being imported has a confident name; subclass/spell/feature
  // identifiers aren't remapped at export time yet.
  const formatLookups = {
    optionItemNameBySourceId,
    classNameById: workflow?.classItem
      ? {
        [workflow.classItem.flags?.[MODULE_ID]?.sourceId ?? ""]: workflow.classItem.name
      }
      : {}
  };

  // Snapshot the actor's ability-score values so the walker doesn't have
  // to reach into the Foundry actor each render.
  const abilityScores = {};
  for (const ability of ["str", "dex", "con", "int", "wis", "cha"]) {
    const value = Number(actor?.system?.abilities?.[ability]?.value);
    if (Number.isFinite(value)) abilityScores[ability] = value;
  }
  const totalLevel = Number(actor?.system?.details?.level) || Number(workflow?.targetLevel) || 0;
  const classLevel = Number(workflow?.targetLevel) || 0;

  // ─── Enrich each option with display data ──────────────────────────────
  // Pre-compute everything we need per option so each render pass is
  // a pure data → HTML transformation. The expensive parts (tree
  // resolution, HTML enrichment) only happen here.
  const inGroupSourceIds = new Set(
    ensureArray(group.options).map((o) => o?.flags?.[MODULE_ID]?.sourceId).filter(Boolean)
  );

  const enrichedEntries = ensureArray(group.options).map((item, idx) => {
    const flags = item.flags?.[MODULE_ID] ?? {};
    const tree = flags.requirementsTree
      ?? treeFromFlatRequiresOptionIds(ensureArray(flags.requiresOptionIds));
    const sourceId = flags.sourceId ?? "";
    const levelGate = Number(flags.levelPrerequisite ?? 0) || 0;
    const description = String(item.system?.description?.value ?? "").trim();
    const img = String(item.img ?? "icons/svg/aura.svg");
    return {
      idx,
      item,
      tree,
      sourceId,
      levelGate,
      description,
      img,
      sourceLabel: deriveSourceLabel(item.system?.source?.book ?? item.flags?.plutonium?.source)
    };
  });

  // Group entries by levelGate ascending. Within a group, preserve
  // editor authoring order (the source array's index).
  const entriesByLevel = new Map();
  for (const e of enrichedEntries) {
    if (!entriesByLevel.has(e.levelGate)) entriesByLevel.set(e.levelGate, []);
    entriesByLevel.get(e.levelGate).push(e);
  }
  const sortedLevels = [...entriesByLevel.keys()].sort((a, b) => a - b);

  // Default focused option = first non-disabled in the list. Falls back
  // to the very first option if everything's locked (still want SOMETHING
  // displayed in the detail panel).
  const initialFocus = enrichedEntries[0]?.sourceId ?? null;

  // ─── Render helpers ────────────────────────────────────────────────────

  const escapeHTML = (s) => foundry.utils.escapeHTML(String(s ?? ""));

  // Compute per-option status given the current selection / ctx state.
  // Returns:
  //   - state: "selected" | "owned" | "blocked-prereq" | "blocked-level"
  //            | "blocked-ability" | "available"
  //   - blockReasonText: short hint for the row badge
  //   - blockedByOptionSourceId: when the blocker is an in-group option,
  //     its sourceId so the row can jump there
  const computeOptionStatus = (entry, selectedSet, ctx) => {
    if (previouslyOwnedSourceIds.has(entry.sourceId)) return { state: "owned" };
    if (selectedSet.has(entry.sourceId)) return { state: "selected" };

    // Flat levelGate check — the option's `levelPrerequisite` flag
    // gates it against the import's class level. Treated as a level
    // block even when the tree walker says "available" (the flat
    // column lives outside the tree). This is what locks "Available
    // from Level 5" options when the player is importing at level 3.
    if (entry.levelGate > 0 && ctx.classLevel < entry.levelGate) {
      return {
        state: "blocked-level",
        blockReasonText: `Level ${entry.levelGate}+`
      };
    }

    const verdict = evaluateRequirementsTree(entry.tree, ctx);
    if (!verdict.blocked) return { state: "available", verdict };

    // Identify the dominant blocker so the row badge is specific.
    // Order: missing in-group option > level (from tree) > ability >
    // generic.
    const optionLeaf = verdict.missingLeaves.find(
      (l) => l.type === "optionItem" && inGroupSourceIds.has(l.itemId)
    );
    if (optionLeaf) {
      return {
        state: "blocked-prereq",
        verdict,
        blockedByOptionSourceId: optionLeaf.itemId,
        blockReasonText: optionItemNameBySourceId[optionLeaf.itemId] ?? "another option"
      };
    }
    const levelLeaf = verdict.missingLeaves.find((l) => l.type === "level" || l.type === "levelInClass");
    if (levelLeaf) {
      return {
        state: "blocked-level",
        verdict,
        blockReasonText: levelLeaf.type === "levelInClass"
          ? `${formatLookups.classNameById?.[levelLeaf.classId] ?? "class"} ${levelLeaf.minLevel}+`
          : `Level ${levelLeaf.minLevel}+`
      };
    }
    const abilityLeaf = verdict.missingLeaves.find((l) => l.type === "abilityScore");
    if (abilityLeaf) {
      return {
        state: "blocked-ability",
        verdict,
        blockReasonText: `${abilityLeaf.ability.toUpperCase()} ${abilityLeaf.min}+`
      };
    }
    return { state: "blocked-prereq", verdict, blockReasonText: "Locked" };
  };

  // Compact formatter used for the in-row badge. The walker's
  // `formatRequirementsTree` produces full sentences ("Strength 13 or
  // higher or Dexterity 13 or higher") which read poorly inside a
  // narrow row — players want a quick scan, so we shorten each leaf
  // to a token like "STR 13+" and preserve the And/Or/Xor structure
  // by joining with " and " / " or " / " (one of) ". An `any` group
  // of two ability leaves renders "STR 13+ or DEX 13+", which is the
  // user-facing example the redesign was driven by — previously the
  // badge picked only the first missing leaf and dropped the OR
  // structure entirely.
  const formatLeafShort = (leaf) => {
    switch (leaf?.type) {
      case "level":
        return leaf.isTotal
          ? `Level ${leaf.minLevel}+ (total)`
          : `Level ${leaf.minLevel}+`;
      case "levelInClass": {
        const name = formatLookups.classNameById?.[leaf.classId] ?? "Class";
        return `${name} ${leaf.minLevel}+`;
      }
      case "abilityScore":
        return `${String(leaf.ability ?? "").toUpperCase()} ${leaf.min}+`;
      case "optionItem":
        return optionItemNameBySourceId[leaf.itemId] ?? "(option)";
      case "class":
        return formatLookups.classNameById?.[leaf.classId] ?? "(class)";
      case "subclass":
        return formatLookups.subclassNameById?.[leaf.subclassId] ?? "(subclass)";
      case "feature":
        return formatLookups.featureNameById?.[leaf.featureId] ?? "(feature)";
      case "spell":
        return formatLookups.spellNameById?.[leaf.spellId] ?? "(spell)";
      case "spellRule":
        return formatLookups.spellRuleNameById?.[leaf.spellRuleId] ?? "(spell rule)";
      case "proficiency":
        return leaf.identifier || "(proficiency)";
      case "string":
        return leaf.value || "(see description)";
      default:
        return "(unknown)";
    }
  };

  const formatRequirementsTreeShort = (tree) => {
    if (!tree) return "";
    if (tree.kind === "leaf") return formatLeafShort(tree);
    const children = (tree.children ?? []).filter(Boolean);
    if (children.length === 0) return "";
    if (children.length === 1) return formatRequirementsTreeShort(children[0]);
    const joiner = tree.kind === "any"
      ? " or "
      : tree.kind === "one"
        ? " (one of) "
        : " and ";
    return children.map((c) => formatRequirementsTreeShort(c)).join(joiner);
  };

  // Combine the option's flat `levelGate` (the `levelPrerequisite`
  // flag column) with the structured tree's text in a single
  // human-readable badge. The flat-level pill renders before the
  // tree text so "Level 5+" sits ahead of "Pact of the Blade" in a
  // compound requirement.
  const buildBlockedBadge = (entry) => {
    const parts = [];
    if (entry.levelGate > 0) parts.push(`Level ${entry.levelGate}+`);
    const treeText = formatRequirementsTreeShort(entry.tree);
    if (treeText) parts.push(treeText);
    return parts.length ? `Requires: ${parts.join(" and ")}` : "";
  };

  const renderRow = (entry, app, ctx) => {
    const selectedSet = new Set([
      ...priorSelections,
      ...(app._state.selectedSourceIds ?? [])
    ]);
    const status = computeOptionStatus(entry, selectedSet, ctx);

    // "owned" and "blocked-*" disable the checkbox. "selected" is checked
    // but stays interactive (so the user can uncheck mid-prompt).
    const isOwned = status.state === "owned";
    const isChecked = status.state === "selected" || isOwned;
    const isCheckboxDisabled = isOwned || status.state.startsWith("blocked");

    // Visual class: greyed-out for owned (already on actor) AND
    // available-but-already-in-this-prompt (matches the user's "greyed
    // out = something already selected" rule). Blocked uses a separate
    // muted-but-not-greyed style so it stands out as "fixable".
    const rowClass = [
      "dauligor-option-picker__row",
      isOwned && "dauligor-option-picker__row--owned",
      status.state === "selected" && "dauligor-option-picker__row--selected",
      status.state.startsWith("blocked") && "dauligor-option-picker__row--blocked",
      entry.sourceId === app._state.focusedSourceId && "dauligor-option-picker__row--focused",
      app._state.highlightSourceId === entry.sourceId && "dauligor-option-picker__row--highlighted"
    ].filter(Boolean).join(" ");

    // Row badge text — uses the compact tree formatter for blocked
    // rows so an `any` group of two ability scores renders both
    // ("Requires: STR 13+ or DEX 13+") instead of just the first
    // missing leaf. `status.blockReasonText` was only the dominant
    // blocker; the compact-tree path captures the full picture.
    const badgeText = isOwned
      ? "Owned"
      : status.state === "selected"
        ? "Selected"
        : status.state.startsWith("blocked")
          ? buildBlockedBadge(entry)
          : "";

    return `
      <div
        class="${rowClass}"
        data-option-source-id="${escapeHTML(entry.sourceId)}"
        data-action="focus-option"
      >
        <input
          type="checkbox"
          class="dauligor-option-picker__row-check"
          data-action="toggle-option"
          data-option-source-id="${escapeHTML(entry.sourceId)}"
          ${isChecked ? "checked" : ""}
          ${isCheckboxDisabled ? "disabled" : ""}
        >
        <img class="dauligor-option-picker__row-img" src="${escapeHTML(entry.img)}" alt="" />
        <div class="dauligor-option-picker__row-text">
          <div class="dauligor-option-picker__row-name">${escapeHTML(entry.item.name)}</div>
          ${badgeText ? `<div class="dauligor-option-picker__row-badge">${escapeHTML(badgeText)}</div>` : ""}
        </div>
      </div>
    `;
  };

  const renderLevelHeader = (level, count) => {
    const label = level <= 0
      ? "Available Immediately"
      : `Available from Level ${level}`;
    return `
      <div class="dauligor-option-picker__level-header">
        <span>${escapeHTML(label)}</span>
        <span class="dauligor-option-picker__level-count">${count}</span>
      </div>
    `;
  };

  // Render the detail panel for the focused option. Shows the
  // description, the requirements summary (with clickable "jump"
  // badges for in-group prereqs and "view" badges for out-of-group
  // prereqs), and the source label.
  const renderDetailPanel = (entry, app, ctx) => {
    if (!entry) {
      return `<div class="dauligor-option-picker__detail-empty">No option focused. Click a row to see its details.</div>`;
    }
    const selectedSet = new Set([
      ...priorSelections,
      ...(app._state.selectedSourceIds ?? [])
    ]);
    const status = computeOptionStatus(entry, selectedSet, ctx);

    // Build the prereq pill list — one pill per authored leaf plus
    // a synthetic pill for the flat `levelPrerequisite` flag when set.
    // The pills are colored met/unmet/manual but carry no checkmark
    // glyph (color alone communicates state, the icon was redundant).
    const pills = [];

    // Flat levelGate (option's `levelPrerequisite` flag) — gets its
    // own pill when authored, sitting before tree-derived pills so
    // it reads as the primary level gate. Skipped when 0 (no gate).
    if (entry.levelGate > 0) {
      const met = ctx.classLevel >= entry.levelGate;
      pills.push(`
        <span class="dauligor-option-picker__pill ${met ? "dauligor-option-picker__pill--met" : "dauligor-option-picker__pill--unmet"}">
          Level ${escapeHTML(entry.levelGate)}+
        </span>
      `);
    }

    const allLeaves = collectLeaves(entry.tree);
    for (const leaf of allLeaves) {
      if (leaf.type === "optionItem") {
        const refSid = leaf.itemId;
        const isOwned = previouslyOwnedSourceIds.has(refSid);
        const isPicked = selectedSet.has(refSid);
        const isInGroup = inGroupSourceIds.has(refSid);
        const refName = optionItemNameBySourceId[refSid] ?? "(unknown option)";
        const action = isInGroup ? "jump-to-option" : "show-out-of-group";
        const pillClass = isOwned || isPicked
          ? "dauligor-option-picker__pill dauligor-option-picker__pill--met"
          : "dauligor-option-picker__pill dauligor-option-picker__pill--unmet";
        pills.push(`
          <button
            type="button"
            class="${pillClass}"
            data-action="${action}"
            data-target-source-id="${escapeHTML(refSid)}"
            data-leaf-type="optionItem"
          >${escapeHTML(refName)}</button>
        `);
      } else if (leaf.type === "level") {
        const met = ctx.classLevel >= leaf.minLevel;
        pills.push(`
          <span class="dauligor-option-picker__pill ${met ? "dauligor-option-picker__pill--met" : "dauligor-option-picker__pill--unmet"}">
            Level ${escapeHTML(leaf.minLevel)}+
          </span>
        `);
      } else if (leaf.type === "abilityScore") {
        const score = ctx.abilityScores?.[leaf.ability] ?? 0;
        const met = score >= leaf.min;
        pills.push(`
          <span class="dauligor-option-picker__pill ${met ? "dauligor-option-picker__pill--met" : "dauligor-option-picker__pill--unmet"}">
            ${escapeHTML(leaf.ability.toUpperCase())} ${escapeHTML(leaf.min)}+
          </span>
        `);
      } else if (leaf.type === "feature" || leaf.type === "spell" || leaf.type === "spellRule") {
        const refName = (
          leaf.type === "feature" ? "a class feature"
            : leaf.type === "spell" ? "a known spell"
              : "a spell matching a rule"
        );
        pills.push(`
          <button
            type="button"
            class="dauligor-option-picker__pill dauligor-option-picker__pill--manual"
            data-action="show-out-of-group"
            data-leaf-type="${escapeHTML(leaf.type)}"
            data-leaf-payload="${escapeHTML(JSON.stringify(leaf))}"
          >Requires: ${escapeHTML(refName)}</button>
        `);
      } else if (leaf.type === "string") {
        pills.push(`
          <span class="dauligor-option-picker__pill dauligor-option-picker__pill--manual">${escapeHTML(leaf.value || "(see description)")}</span>
        `);
      }
    }

    // Status banner only fires for the three non-blocked states. For
    // a blocked option, the Prerequisites pill row below tells the
    // player exactly what's missing — repeating that as a banner just
    // doubles the same information.
    const statusBanner = (() => {
      if (status.state === "owned") return `<div class="dauligor-option-picker__banner dauligor-option-picker__banner--muted">Already on this actor.</div>`;
      if (status.state === "selected") return `<div class="dauligor-option-picker__banner dauligor-option-picker__banner--ok">Selected for this import.</div>`;
      if (status.state === "available") return `<div class="dauligor-option-picker__banner dauligor-option-picker__banner--ok">Available — click the checkbox to pick this option.</div>`;
      return "";
    })();

    // Back button is wired to the breadcrumb — clicking a prereq pill
    // pushes the previous focusedSourceId onto the stack, and this
    // button pops it.
    const hasBack = (app._state.focusBreadcrumb ?? []).length > 0;
    const backButton = hasBack
      ? `<button type="button" class="dauligor-option-picker__back" data-action="back-to-previous">← Back</button>`
      : "";

    return `
      <div class="dauligor-option-picker__detail">
        ${backButton}
        <div class="dauligor-option-picker__detail-header">
          <img class="dauligor-option-picker__detail-img" src="${escapeHTML(entry.img)}" alt="" />
          <div>
            <h3 class="dauligor-option-picker__detail-name">${escapeHTML(entry.item.name)}</h3>
            ${entry.sourceLabel ? `<div class="dauligor-option-picker__detail-meta">${escapeHTML(entry.sourceLabel)}</div>` : ""}
          </div>
        </div>
        ${statusBanner}
        ${pills.length ? `
          <div class="dauligor-option-picker__detail-section">
            <div class="dauligor-option-picker__detail-section-title">Prerequisites</div>
            <div class="dauligor-option-picker__pill-row">${pills.join("")}</div>
          </div>
        ` : ""}
        <div class="dauligor-option-picker__detail-section">
          <div class="dauligor-option-picker__detail-section-title">Description</div>
          <div class="dauligor-option-picker__detail-body">
            ${entry.description || "<p><em>No description authored.</em></p>"}
          </div>
        </div>
      </div>
    `;
  };

  // Out-of-group prereq overlay panel. Triggered when the user clicks a
  // pill referencing something not in this group (a feature, spell,
  // option-item from a different group). Renders inline rather than
  // launching a second dialog — keeps the user inside the picker.
  const renderOutOfGroupOverlay = (overlayData) => {
    if (!overlayData) return "";
    let title = "Requirement";
    let body = "";
    if (overlayData.type === "optionItem") {
      const entry = allOptionsBySourceId[overlayData.sourceId];
      if (entry) {
        title = entry.item.name;
        body = `
          <div class="dauligor-option-picker__overlay-meta">
            From group: ${escapeHTML(entry.group?.name ?? "(unknown group)")}
          </div>
          <div class="dauligor-option-picker__overlay-body">
            ${String(entry.item.system?.description?.value ?? "<p><em>No description authored.</em></p>")}
          </div>
        `;
      } else {
        title = optionItemNameBySourceId[overlayData.sourceId] ?? "Unknown option";
        body = `<p><em>This option isn't in any of the imported option groups. It may be a previously-removed option or one from another class.</em></p>`;
      }
    } else if (overlayData.type === "feature") {
      title = "Class Feature Requirement";
      body = `<p>This option requires the character to already have a specific class feature granted. The webapp's export pipeline does not yet remap feature references to source-ids, so the specific feature isn't named here.</p>`;
    } else if (overlayData.type === "spell") {
      title = "Spell Requirement";
      body = `<p>This option requires the character to know a specific spell.</p>`;
    } else if (overlayData.type === "spellRule") {
      title = "Spell Rule Requirement";
      body = `<p>This option requires the character to know a spell matching a rule.</p>`;
    }
    return `
      <div class="dauligor-option-picker__overlay" data-action="dismiss-overlay">
        <div class="dauligor-option-picker__overlay-card" data-action="overlay-stop">
          <button type="button" class="dauligor-option-picker__overlay-close" data-action="dismiss-overlay">×</button>
          <h3 class="dauligor-option-picker__overlay-title">${escapeHTML(title)}</h3>
          ${body}
        </div>
      </div>
    `;
  };

  // ─── The prompt ─────────────────────────────────────────────────────────

  const result = await DauligorSequencePromptApp.prompt({
    title: `Choose ${group.maxSelections} Option${group.maxSelections === 1 ? "" : "s"}: ${group.name || group.featureName || "Class Options"} (Level ${workflow.targetLevel})`,
    width: 1040,
    height: 740,
    state: {
      selectedSourceIds: [...(group.selectedSourceIds ?? [])],
      focusedSourceId: initialFocus,
      // Stack of previously-focused sourceIds. Each "jump to option"
      // pill click pushes the current focus and switches to the new
      // one; the Back button pops.
      focusBreadcrumb: [],
      // When set, the in-group row matching this sourceId pulses
      // briefly after a jump so the user can find it on the list side.
      highlightSourceId: null,
      // Overlay data for out-of-group prereq view — `null` = hidden.
      outOfGroupOverlay: null
    },
    renderBody: (app) => {
      const satisfied = new Set([...priorSelections, ...(app._state.selectedSourceIds ?? [])]);
      const ctx = { satisfied, classLevel, totalLevel, abilityScores };
      const focused = enrichedEntries.find((e) => e.sourceId === app._state.focusedSourceId)
        ?? enrichedEntries[0]
        ?? null;
      return `
        <div class="dauligor-option-picker">
          <div class="dauligor-option-picker__list">
            ${sortedLevels.map((lvl) => {
              const entries = entriesByLevel.get(lvl);
              return `
                ${renderLevelHeader(lvl, entries.length)}
                ${entries.map((e) => renderRow(e, app, ctx)).join("")}
              `;
            }).join("")}
          </div>
          <div class="dauligor-option-picker__detail-pane">
            ${renderDetailPanel(focused, app, ctx)}
          </div>
          ${renderOutOfGroupOverlay(app._state.outOfGroupOverlay)}
        </div>
      `;
    },
    onRenderBody: (app, root) => {
      // Helper — `app.rerenderPrompt()` rebuilds the entire body, which
      // resets every internal scroll container including our list
      // column. When a row-focus or checkbox-toggle re-renders, we want
      // the player to keep their place in the list (they're often
      // browsing rows one by one). Capture the list's scrollTop before
      // the re-render and restore it after. The pill-jump handlers
      // below do NOT call this — those intentionally scrollIntoView to
      // the jumped-to row.
      const rerenderPreservingListScroll = () => {
        const list = root.querySelector(".dauligor-option-picker__list");
        const scrollTop = list?.scrollTop ?? 0;
        app.rerenderPrompt();
        requestAnimationFrame(() => {
          const next = root.querySelector(".dauligor-option-picker__list");
          if (next) next.scrollTop = scrollTop;
        });
      };

      // Row focus on click (anywhere on the row except the checkbox).
      root.querySelectorAll(`[data-action="focus-option"]`).forEach((el) => {
        el.addEventListener("click", (evt) => {
          // Ignore clicks that originated inside the checkbox — let
          // the toggle handler below own those.
          if (evt.target.closest('[data-action="toggle-option"]')) return;
          const sid = el.dataset.optionSourceId;
          if (!sid || sid === app._state.focusedSourceId) return;
          app.updateState({
            focusedSourceId: sid,
            // Direct row clicks reset the breadcrumb — they're a
            // user-initiated navigation, not a follow-the-reference.
            focusBreadcrumb: [],
            highlightSourceId: null
          });
          rerenderPreservingListScroll();
        });
      });

      // Checkbox toggle.
      root.querySelectorAll(`[data-action="toggle-option"]`).forEach((input) => {
        input.addEventListener("change", () => {
          if (input.disabled) return;
          const sourceId = input.dataset.optionSourceId;
          if (!sourceId) return;
          const selected = new Set(app._state.selectedSourceIds ?? []);
          if (input.checked) selected.add(sourceId);
          else {
            selected.delete(sourceId);
            // Cascade-uncheck dependents whose tree no longer evaluates
            // cleanly. Loops until the set is stable so A→B→C chains
            // unravel in one pass.
            let changed = true;
            while (changed) {
              changed = false;
              const stillSatisfied = new Set([...priorSelections, ...selected]);
              const innerCtx = { satisfied: stillSatisfied, classLevel, totalLevel, abilityScores };
              for (const entry of enrichedEntries) {
                if (!selected.has(entry.sourceId)) continue;
                const verdict = evaluateRequirementsTree(entry.tree, innerCtx);
                if (verdict.blocked) {
                  selected.delete(entry.sourceId);
                  changed = true;
                }
              }
            }
          }
          if (selected.size > group.maxSelections) {
            notifyWarn(`Choose only ${group.maxSelections} option(s) from this group.`);
            input.checked = false;
            return;
          }
          app.updateState({ selectedSourceIds: [...selected] });
          rerenderPreservingListScroll();
        });
      });

      // Jump to a prereq option that's in this same group. Pushes the
      // current focus onto the breadcrumb so the Back button can return.
      root.querySelectorAll(`[data-action="jump-to-option"]`).forEach((btn) => {
        btn.addEventListener("click", (evt) => {
          evt.stopPropagation();
          const targetSid = btn.dataset.targetSourceId;
          if (!targetSid) return;
          const breadcrumb = [...(app._state.focusBreadcrumb ?? [])];
          if (app._state.focusedSourceId) breadcrumb.push(app._state.focusedSourceId);
          app.updateState({
            focusedSourceId: targetSid,
            focusBreadcrumb: breadcrumb,
            highlightSourceId: targetSid
          });
          app.rerenderPrompt();
          // Scroll the highlighted row into view in the list column.
          requestAnimationFrame(() => {
            const target = root.querySelector(
              `.dauligor-option-picker__row[data-option-source-id="${CSS.escape(targetSid)}"]`
            );
            if (target?.scrollIntoView) target.scrollIntoView({ block: "center", behavior: "smooth" });
          });
        });
      });

      // Back button — pop the breadcrumb.
      root.querySelectorAll(`[data-action="back-to-previous"]`).forEach((btn) => {
        btn.addEventListener("click", (evt) => {
          evt.stopPropagation();
          const breadcrumb = [...(app._state.focusBreadcrumb ?? [])];
          const previous = breadcrumb.pop();
          if (!previous) return;
          app.updateState({
            focusedSourceId: previous,
            focusBreadcrumb: breadcrumb,
            highlightSourceId: previous
          });
          app.rerenderPrompt();
          requestAnimationFrame(() => {
            const target = root.querySelector(
              `.dauligor-option-picker__row[data-option-source-id="${CSS.escape(previous)}"]`
            );
            if (target?.scrollIntoView) target.scrollIntoView({ block: "center", behavior: "smooth" });
          });
        });
      });

      // Show out-of-group prereq overlay.
      root.querySelectorAll(`[data-action="show-out-of-group"]`).forEach((btn) => {
        btn.addEventListener("click", (evt) => {
          evt.stopPropagation();
          const leafType = btn.dataset.leafType ?? "";
          let overlay;
          if (leafType === "optionItem") {
            overlay = { type: "optionItem", sourceId: btn.dataset.targetSourceId ?? "" };
          } else if (btn.dataset.leafPayload) {
            try {
              const leaf = JSON.parse(btn.dataset.leafPayload);
              overlay = { type: leaf.type, leaf };
            } catch (err) {
              overlay = { type: "unknown" };
            }
          }
          app.updateState({ outOfGroupOverlay: overlay });
          app.rerenderPrompt();
        });
      });

      // Dismiss overlay (click backdrop or close button).
      root.querySelectorAll(`[data-action="dismiss-overlay"]`).forEach((el) => {
        el.addEventListener("click", (evt) => {
          // If the click bubbled up from inside the card, ignore.
          if (evt.target.closest('[data-action="overlay-stop"]') && evt.target !== el) return;
          app.updateState({ outOfGroupOverlay: null });
          app.rerenderPrompt();
        });
      });

      // Prevent clicks inside the overlay card from dismissing it.
      root.querySelectorAll(`[data-action="overlay-stop"]`).forEach((el) => {
        el.addEventListener("click", (evt) => {
          // Allow the close button (delegated above) to still work.
          if (evt.target.closest('[data-action="dismiss-overlay"]')) return;
          evt.stopPropagation();
        });
      });
    },
    actions: [
      { id: "confirm", label: "OK", primary: true },
      { id: "cancel", label: "Cancel" },
      { id: "skip", label: "Skip" }
    ],
    onAction: async (app, actionId) => {
      if (actionId === "cancel") return { status: "cancelled" };
      if (actionId === "skip") return { status: "skipped" };
      const selected = [...new Set(app._state.selectedSourceIds ?? [])];
      if (selected.length !== group.maxSelections) {
        notifyWarn(`Choose exactly ${group.maxSelections} option(s) from ${group.name || group.featureName || "this group"}.`);
        return false;
      }
      return { status: "confirmed", value: selected };
    }
  }, sequence);

  if (result.status === "cancelled") return "cancelled";
  if (result.status === "skipped") {
    progress.markStep(stepId, "skipped", "Kept the current option selections.");
    return undefined;
  }

  progress.markStep(stepId, "complete", `${result.value.length}/${group.maxSelections} option(s) selected.`);
  return result.value;
}

/**
 * Walk a requirements tree and collect every leaf in document order.
 * Used by the option-picker's detail panel to render one pill per
 * authored leaf, regardless of whether the leaf is currently met.
 */
function collectLeaves(tree) {
  if (!tree) return [];
  if (tree.kind === "leaf") return [tree];
  if (tree.kind === "all" || tree.kind === "any" || tree.kind === "one") {
    const out = [];
    for (const child of tree.children ?? []) {
      for (const leaf of collectLeaves(child)) out.push(leaf);
    }
    return out;
  }
  return [];
}

async function runSpellPlaceholderStep({ workflow, sequence, progress }) {
  const stepId = "spells";
  progress.markStep(stepId, "active", "Spell selection is still placeholder-only, but the progression summary is available.");
  progress.setStatus("Showing spell progression placeholder...");

  const result = await DauligorSequencePromptApp.prompt({
    title: "Select Cantrips",
    subtitle: `${workflow.classItem.name}${workflow.selectedSubclassItem ? ` (${workflow.selectedSubclassItem.name})` : ""}`,
    width: 1120,
    height: 780,
    renderBody: () => `
      <div class="dauligor-sequence__spells-placeholder">
        <div class="dauligor-sequence__spells-column">
          <div class="dauligor-class-browser__empty">Spell selection is not wired up yet. This window is a placeholder for the eventual cantrip and spell chooser.</div>
        </div>
        <div class="dauligor-sequence__spells-column dauligor-sequence__spells-column--table">
          <h3 class="dauligor-sequence__panel-title">${foundry.utils.escapeHTML(workflow.classItem.name)}${workflow.selectedSubclassItem ? ` (${foundry.utils.escapeHTML(workflow.selectedSubclassItem.name)})` : ""}</h3>
          <div class="dauligor-class-options__spells-table">
            <div class="dauligor-class-options__spells-header">
              <span>Level</span>
              <span>Cantrips</span>
              <span>Spells Known</span>
              <span>Slots</span>
            </div>
            ${workflow.spellcastingRows.map((row) => `
              <div class="dauligor-class-options__spells-row ${row.level === workflow.targetLevel ? "is-current" : ""}">
                <span>${row.level}</span>
                <span>${row.cantrips}</span>
                <span>${row.spells}</span>
                <span>${foundry.utils.escapeHTML(String(row.slots))}</span>
              </div>
            `).join("")}
          </div>
        </div>
      </div>
    `,
    actions: [
      { id: "confirm", label: "OK", primary: true },
      { id: "cancel", label: "Cancel" },
      { id: "skip", label: "Skip" }
    ],
    onAction: async (_app, actionId) => {
      if (actionId === "cancel") return { status: "cancelled" };
      if (actionId === "skip") return { status: "skipped" };
      return { status: "confirmed" };
    }
  }, sequence);

  if (result.status === "cancelled") return "cancelled";
  progress.markStep(stepId, result.status === "skipped" ? "skipped" : "complete", result.status === "skipped" ? "Skipped spell placeholder." : "Reviewed spell progression.");
  return result.status;
}

async function runEquipmentPlaceholderStep({ workflow, sequence, progress }) {
  const stepId = "equipment";
  progress.markStep(stepId, "active", "Starting equipment is not implemented yet.");
  progress.setStatus("Showing starting equipment placeholder...");

  const result = await DauligorSequencePromptApp.prompt({
    title: `Starting Equipment - ${workflow.classItem.name}${workflow.targetActor ? ` (${workflow.targetActor.name})` : ""}`,
    width: 1100,
    height: 760,
    renderBody: () => `
      <div class="dauligor-sequence__equipment-placeholder">
        <div class="dauligor-sequence__equipment-note">Starting equipment is not implemented yet. This is the source text currently available from Dauligor.</div>
        <div class="dauligor-class-options__equipment-note">${foundry.utils.escapeHTML(workflow.startingEquipment).replace(/\n/g, "<br>")}</div>
      </div>
    `,
    actions: [
      { id: "confirm", label: "Confirm", primary: true },
      { id: "cancel", label: "Cancel" },
      { id: "skip", label: "Skip" }
    ],
    onAction: async (_app, actionId) => {
      if (actionId === "cancel") return { status: "cancelled" };
      if (actionId === "skip") return { status: "skipped" };
      return { status: "confirmed" };
    }
  }, sequence);

  if (result.status === "cancelled") return "cancelled";
  progress.markStep(stepId, result.status === "skipped" ? "skipped" : "complete", result.status === "skipped" ? "Skipped starting equipment." : "Reviewed starting equipment.");
  return result.status;
}

function numberToWord(value) {
  const words = {
    0: "zero",
    1: "one",
    2: "two",
    3: "three",
    4: "four",
    5: "five"
  };
  return words[value] ?? String(value);
}

function getConfigLabel(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  if (!normalized) return fallback;
  const localized = game.i18n?.localize?.(normalized) ?? normalized;
  return localized && localized !== normalized ? localized : normalized;
}

function formatAbilityAbbreviation(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  if (normalized.length <= 3) {
    return normalized.charAt(0).toUpperCase() + normalized.slice(1).toLowerCase();
  }
  return normalized;
}

function pause(duration = 0) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, duration);
  });
}

function getImportType(importTypeId) {
  return IMPORT_TYPES.find((type) => type.id === importTypeId) ?? IMPORT_TYPES[0];
}



function buildClassModels(entryPayloads) {
  const grouped = new Map();

  for (const { entry, payload } of entryPayloads) {
    // Phase C: payload may be null at browser-open time — the catalog
    // entry already carries the fields the model needs (name, tags,
    // subclasses[]). The full payload is fetched lazily on Import click
    // via `_ensureVariantPayload`. Skip only if the catalog entry itself
    // is missing or has no payloadUrl to fetch later.
    if (!entry || !entry.payloadUrl) continue;

    const metadata = extractClassEntryMetadata(entry, payload);
    if (!metadata) continue;

    const key = metadata.classSourceId || slugify(metadata.name) || entry.sourceId;
    if (!grouped.has(key)) {
      grouped.set(key, {
        classSourceId: metadata.classSourceId || key,
        name: metadata.name,
        description: metadata.description,
        sourceLabel: metadata.sourceLabel || "",
        tags: [],
        subclasses: [],
        variants: [],
        preferredVariant: null
      });
    }

    const group = grouped.get(key);
    group.name ||= metadata.name;
    if (!group.description || variantPriority(group.preferredVariant?.entry?.payloadKind) > variantPriority(entry.payloadKind)) {
      group.description = metadata.description || group.description;
    }
    if (!group.sourceLabel || variantPriority(group.preferredVariant?.entry?.payloadKind) > variantPriority(entry.payloadKind)) {
      group.sourceLabel = metadata.sourceLabel || group.sourceLabel;
    }

    group.tags = [...new Set([...group.tags, ...metadata.tags])].sort();
    for (const subclass of metadata.subclasses) {
      if (!group.subclasses.some((existing) => existing.sourceId === subclass.sourceId || existing.name === subclass.name)) {
        group.subclasses.push(subclass);
      }
    }

    const variant = { entry, payload, metadata };
    group.variants.push(variant);
    if (!group.preferredVariant || variantPriority(entry.payloadKind) < variantPriority(group.preferredVariant.entry.payloadKind)) {
      group.preferredVariant = variant;
    }
  }

  return [...grouped.values()]
    .map((group) => ({
      ...group,
      subclasses: [...group.subclasses].sort((left, right) => left.name.localeCompare(right.name)),
      variants: [...group.variants].sort((left, right) => variantPriority(left.entry.payloadKind) - variantPriority(right.entry.payloadKind))
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function extractClassEntryMetadata(entry, payload) {
  // Catalog-only path (Phase C). When the browser opens, we no longer
  // pre-fetch per-class payloads; the catalog entry already carries
  // `tags` and `subclasses[]`, which is enough to render the card grid
  // and tag filter. The full payload is fetched on Import click via
  // `_ensureVariantPayload` and the variant is re-decorated then.
  // Source label prefers `entry.shortName` (the source abbreviation —
  // PHB, XGE, etc.) over `deriveSourceLabel(rules)` which would render
  // the rules year ("2014").
  if (!payload) {
    const sourceLabel = entry?.shortName || deriveSourceLabel(entry?.rules ?? "");
    return {
      classSourceId: entry?.sourceId
        ?? (entry?.payloadUrl ? `class-${String(entry.payloadUrl).replace(/\.json$/i, "")}` : null),
      name: entry?.name ?? "Class",
      description: summarizeHtml(entry?.description ?? ""),
      sourceLabel,
      tags: normalizeTags(entry?.tags),
      subclasses: ensureArray(entry?.subclasses).map((sub) => ({
        sourceId: sub?.sourceId ?? slugify(sub?.name ?? ""),
        name: sub?.name ?? "Subclass",
        // Each subclass can come from a different book than its parent
        // class (e.g. PHB Sorcerer + TCE-released Aberrant Mind). Prefer
        // the subclass's own `shortName` from the catalog; only fall
        // back to the parent class's source label.
        sourceLabel: sub?.shortName || sourceLabel
      }))
    };
  }

  if (payload?.kind === "dauligor.class-bundle.v1") {
    const classItem = payload.classItem ?? {};
    return {
      classSourceId: classItem?.flags?.[MODULE_ID]?.sourceId ?? payload.source?.id ?? entry.sourceId,
      name: classItem?.name ?? entry.name,
      description: summarizeHtml(classItem?.system?.description?.value ?? entry.description),
      sourceLabel: deriveSourceLabel(classItem?.system?.source?.book ?? classItem?.flags?.plutonium?.source ?? entry?.rules),
      tags: normalizeTags(classItem?.flags?.[MODULE_ID]?.tagIds),
      subclasses: ensureArray(payload.subclassItems).map((subclassItem) => ({
        sourceId: subclassItem?.flags?.[MODULE_ID]?.sourceId ?? slugify(subclassItem?.name),
        name: subclassItem?.name ?? "Subclass",
        sourceLabel: deriveSourceLabel(subclassItem?.system?.source?.book ?? subclassItem?.flags?.plutonium?.source ?? entry?.rules)
      }))
    };
  }

  if (payload?.class && Array.isArray(payload?.features)) {
    const semanticClassSourceId = payload.class?.classSourceId
      ?? (payload.class?.identifier ? `class-${slugify(payload.class.identifier)}` : null)
      ?? entry.sourceId;
    return {
      classSourceId: semanticClassSourceId,
      name: payload.class?.name ?? entry.name,
      description: summarizeHtml(payload.class?.description ?? payload.class?.spellcasting?.description ?? entry.description),
      sourceLabel: deriveSourceLabel(payload.class?.source?.book ?? payload.class?.source?.name ?? payload.class?.sourceBookId ?? payload.class?.sourceId ?? entry?.rules),
      tags: normalizeTags(payload.class?.tagIds),
      subclasses: ensureArray(payload.subclasses).map((subclass) => ({
        sourceId: subclass?.sourceId ?? slugify(subclass?.name),
        name: subclass?.name ?? "Subclass",
        sourceLabel: deriveSourceLabel(subclass?.source?.book ?? subclass?.source?.name ?? subclass?.sourceBookId ?? entry?.rules)
      }))
    };
  }

  const rawItem = payload?.kind === "dauligor.item.v1" ? payload.item : payload;
  if (rawItem?.type === "class" && rawItem?.system) {
    return {
      classSourceId: rawItem?.flags?.[MODULE_ID]?.sourceId
        ?? rawItem?.sourceId
        ?? (rawItem?.system?.identifier ? `class-${slugify(rawItem.system.identifier)}` : entry.sourceId),
      name: rawItem?.name ?? entry.name,
      description: summarizeHtml(rawItem?.system?.description?.value ?? entry.description),
      sourceLabel: deriveSourceLabel(rawItem?.system?.source?.book ?? rawItem?.flags?.plutonium?.source ?? entry?.rules),
      tags: normalizeTags(rawItem?.flags?.[MODULE_ID]?.tagIds),
      subclasses: []
    };
  }

  return null;
}

function normalizeTags(tags) {
  return [...new Set(ensureArray(tags).map((tag) => String(tag ?? "").trim()).filter(Boolean))].sort();
}

function variantPriority(payloadKind) {
  return CLASS_VARIANT_PRIORITY[payloadKind] ?? 99;
}



function deriveSourceLabel(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";

  const upper = normalized.toUpperCase();
  if (upper === "2014" || upper === "2024") return upper;

  const compact = normalized.toLowerCase();
  if (compact.includes("source-phb")) return "PHB";
  if (compact.includes("source-xge")) return "XGE";
  if (compact.includes("source-tce")) return "TCE";
  if (compact.includes("source-dsotdq")) return "DSotDQ";
  if (compact.includes("player's handbook") || compact.includes("players handbook")) return "PHB";
  if (compact.includes("xanathar")) return "XGE";
  if (compact.includes("tasha")) return "TCE";
  if (compact.includes("sword coast")) return "SCAG";
  if (compact.includes("dungeon master's guide") || compact.includes("dungeon masters guide")) return "DMG";
  if (compact.includes("monsters of the multiverse")) return "MPMM";
  if (compact.includes("fizban")) return "FTD";
  if (compact.includes("bigby")) return "BGG";

  return normalized.length > 10 ? normalized.slice(0, 10) : normalized;
}

async function openDauligorClassBrowser(options = {}) {
  const app = await DauligorClassBrowserApp.open(options);
  log("Opened Dauligor class browser", options);
  return app;
}

export async function openDauligorImporter(options = {}) {
  const app = await DauligorImporterApp.open(options);
  log("Opened Dauligor import wizard", options);
  return app;
}
