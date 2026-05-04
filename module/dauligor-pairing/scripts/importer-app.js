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
import { log, notifyWarn } from "./utils.js";

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

function clampLevel(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.min(20, Math.max(1, Math.round(numeric)));
}

function normalizeSelectionIds(ids) {
  return Array.isArray(ids)
    ? [...new Set(ids.filter(Boolean))]
    : [];
}

function normalizeSourceTypeIds(ids, fallbackId = undefined) {
  const raw = Array.isArray(ids)
    ? ids
    : (ids ? [ids] : (fallbackId ? [fallbackId] : []));
  return [...new Set(raw.map((id) => String(id ?? "").trim()).filter(Boolean))];
}

function normalizeCatalogUrls(urls, fallbackUrl = undefined) {
  const raw = Array.isArray(urls)
    ? urls
    : (urls ? [urls] : (fallbackUrl ? [fallbackUrl] : []));
  return [...new Set(raw.map((url) => String(url ?? "").trim()).filter(Boolean))];
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
      this._instance._state.sourceCatalogUrl = `${host}/api/module/sources`;

      this._instance._sourcesLoaded = false;
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
      position: {
        width: Math.min(window.innerWidth - 120, 1120),
        height: Math.min(window.innerHeight - 120, 640)
      }
    });

    this._template = IMPORTER_TEMPLATE;
    this._actor = actor ?? null;
    this._state = {
      importTypeId,
      sourceTypeId: normalizedSourceTypeIds[0] ?? getDefaultSourceTypeId(importTypeId),
      selectedSourceIds: normalizedSourceTypeIds,
      sourceSearch: "",
      sourceCatalogUrl: (function() {
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
    if (this._sourcesLoaded && !force) return;

    const sourceUrl = this._state.sourceCatalogUrl;
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
      position: {
        width: Math.min(window.innerWidth - 100, 860),
        height: Math.min(window.innerHeight - 100, 760)
      }
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

    const rowsHtml = visibleClasses.map((classModel) => {
      const isSelected = classModel.classSourceId === this._state.selectedClassSourceId;
      const selectedSubclassId = isSelected ? this._state.selectedSubclassSourceId : null;
      const classSource = classModel.sourceLabel || classModel.subclasses.find((subclass) => subclass.sourceLabel)?.sourceLabel || "";
      const subclassesHtml = classModel.subclasses.length
        ? `
          ${classModel.subclasses.map((subclass) => `
            <button
              type="button"
              class="dauligor-class-browser__row dauligor-class-browser__row--subclass ${selectedSubclassId === subclass.sourceId ? "dauligor-class-browser__row--selected" : ""}"
              data-action="select-subclass"
              data-class-source-id="${foundry.utils.escapeHTML(classModel.classSourceId)}"
              data-subclass-source-id="${foundry.utils.escapeHTML(subclass.sourceId)}"
            >
              <span class="dauligor-class-browser__row-select">
                <span class="dauligor-class-browser__radio ${selectedSubclassId === subclass.sourceId ? "dauligor-class-browser__radio--selected" : ""}"></span>
              </span>
              <span class="dauligor-class-browser__row-name dauligor-class-browser__row-name--subclass">&mdash; ${foundry.utils.escapeHTML(subclass.name)}</span>
              <span class="dauligor-class-browser__row-source">${foundry.utils.escapeHTML(subclass.sourceLabel || classSource)}</span>
            </button>
          `).join("")}
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

    const entryPayloads = await Promise.all(catalogEntries.map(async (entry) => ({
      entry,
      payload: await fetchJson(entry.payloadUrl)
    })));

    this._classModels = buildClassModels(entryPayloads);
    this._availableTags = [...new Set(this._classModels.flatMap((classModel) => classModel.tags))].sort();
    this._applyPreferredSelection();
    this._state.isLoading = false;
    this._state.status = `Loaded ${this._classModels.length} class option${this._classModels.length === 1 ? "" : "s"} from ${catalogEntries.length} source payload${catalogEntries.length === 1 ? "" : "s"} across ${catalogs.length} catalog${catalogs.length === 1 ? "" : "s"}.`;
    this._state.statusLevel = this._classModels.length ? "success" : "danger";
    this._isLoaded = true;
    this._renderBrowser();
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
    this._state.selectedSubclassSourceId = subclassSourceId ?? null;
    this._renderList();
    this._renderFooter();
  }

  async _importSelectedClass() {
    const selectedClass = this._getSelectedClass();
    if (!selectedClass) {
      notifyWarn("Select a class before importing.");
      return;
    }
    const selectedVariant = this._getSelectedVariant(selectedClass);
    if (!selectedVariant?.payload) {
      notifyWarn(`The selected ${selectedClass.name} payload is no longer available.`);
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

    this._state.status = this._actor
      ? `Importing ${selectedClass.name} onto ${this._actor.name} at class level ${this._state.targetLevel}...`
      : `Importing ${selectedClass.name} into the world library...`;
    this._state.statusLevel = "";
    this._renderFooter();

    const result = await importClassPayloadToWorld(selectedVariant.payload, {
      entry: selectedVariant.entry,
      folderPath: this._state.folderPath,
      actor: this._actor,
      targetLevel: this._state.targetLevel
    });

    this._state.status = result
      ? this._actor
        ? `Imported ${selectedClass.name} onto ${this._actor.name}.`
        : `Imported ${selectedClass.name} into the world library.`
      : `Import failed for ${selectedClass.name}.`;
    this._state.statusLevel = result ? "success" : "danger";
    this._renderFooter();
    if (result) await this.close();
  }

  async _openImportOptions(selectedClass, selectedVariant = null) {
    const variant = selectedVariant ?? this._getSelectedVariant(selectedClass);
    if (!variant?.payload) {
      notifyWarn(`The selected ${selectedClass?.name ?? "class"} payload is no longer available.`);
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
      position: {
        width: 460,
        height: 420
      }
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

class DauligorSequencePromptApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(config = {}) {
    super({
      id: `${MODULE_ID}-sequence-prompt-${foundry.utils.randomID()}`,
      classes: ["dauligor-importer-app", "dauligor-importer-app--sequence-prompt"],
      window: {
        title: config.title ?? "Dauligor Prompt",
        resizable: true,
        contentClasses: ["dauligor-importer-window", "dauligor-sequence-window"]
      },
      position: {
        width: config.width ?? 720,
        height: config.height ?? 540
      }
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

    this._toolbarRegion.innerHTML = `
      <div class="dauligor-sequence__toolbar">
        <div>
          <h2 class="dauligor-class-browser__title">${foundry.utils.escapeHTML(this._config.title ?? "Dauligor Prompt")}</h2>
          ${this._config.subtitle ? `<p class="dauligor-class-browser__subtitle">${foundry.utils.escapeHTML(this._config.subtitle)}</p>` : ""}
        </div>
      </div>
    `;
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

class DauligorClassOptionsApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static _instance = null;

  static async open({
    actor = null,
    folderPath = "Classes",
    classModel = null,
    entry = null,
    payload = null,
    workflow = null
  } = {}) {
    if (this._instance) {
      this._instance.setContext({ actor, folderPath, classModel, entry, payload, workflow });
      this._instance.render({ force: true });
      this._instance.maximize?.();
      return this._instance;
    }

    const instance = new this({ actor, folderPath, classModel, entry, payload, workflow });
    this._instance = instance;
    instance.render({ force: true });
    return instance;
  }

  constructor({
    actor = null,
    folderPath = "Classes",
    classModel = null,
    entry = null,
    payload = null,
    workflow = null
  } = {}) {
    super({
      id: `${MODULE_ID}-class-options`,
      classes: ["dauligor-importer-app", "dauligor-importer-app--options"],
      window: {
        title: actor ? `Dauligor Class Options: ${actor.name}` : "Dauligor Class Options",
        resizable: true,
        contentClasses: ["dauligor-importer-window"]
      },
      position: {
        width: Math.min(window.innerWidth - 120, 980),
        height: Math.min(window.innerHeight - 120, 860)
      }
    });

    this._template = CLASS_OPTIONS_TEMPLATE;
    this.setContext({ actor, folderPath, classModel, entry, payload, workflow, isInitial: true });
  }

  _configureRenderParts() {
    return {
      main: {
        template: this._template
      }
    };
  }

  async close(options) {
    if (DauligorClassOptionsApp._instance === this) DauligorClassOptionsApp._instance = null;
    return super.close(options);
  }

  setContext({
    actor = null,
    folderPath = "Classes",
    classModel = null,
    entry = null,
    payload = null,
    workflow = null,
    isInitial = false
  } = {}) {
    this._actor = actor ?? null;
    this._folderPath = folderPath || "Classes";
    this._classModel = classModel ?? this._classModel ?? null;
    this._entry = entry ?? this._entry ?? null;
    this._payload = payload ?? this._payload ?? null;
    const baseWorkflow = workflow ?? this._workflow ?? null;

    this.options.window.title = this._actor
      ? `Dauligor Class Options: ${this._actor.name}`
      : "Dauligor Class Options";

    if (isInitial || !this._state) {
      this._state = {
        targetLevel: baseWorkflow?.targetLevel ?? 1,
        includeSubclass: baseWorkflow?.selection?.includeSubclass ?? Boolean(baseWorkflow?.selection?.subclassSourceId),
        subclassSourceId: baseWorkflow?.selection?.subclassSourceId ?? null,
        hpMode: baseWorkflow?.selection?.hpMode ?? "average",
        spellMode: baseWorkflow?.selection?.spellMode ?? (baseWorkflow?.hasSpellcasting ? "placeholder" : null),
        optionSelections: foundry.utils.deepClone(baseWorkflow?.selection?.optionSelections ?? {}),
        skillSelections: foundry.utils.deepClone(baseWorkflow?.selection?.skillSelections ?? []),
        status: "",
        statusLevel: ""
      };
    } else if (baseWorkflow) {
      this._state.targetLevel = baseWorkflow.targetLevel ?? 1;
      this._state.includeSubclass = baseWorkflow.selection?.includeSubclass ?? Boolean(baseWorkflow.selection?.subclassSourceId);
      this._state.subclassSourceId = baseWorkflow.selection?.subclassSourceId ?? null;
      this._state.hpMode = baseWorkflow.selection?.hpMode ?? "average";
      this._state.spellMode = baseWorkflow.selection?.spellMode ?? (baseWorkflow.hasSpellcasting ? "placeholder" : null);
      this._state.optionSelections = foundry.utils.deepClone(baseWorkflow.selection?.optionSelections ?? {});
      this._state.skillSelections = foundry.utils.deepClone(baseWorkflow.selection?.skillSelections ?? []);
      this._state.status = "";
      this._state.statusLevel = "";
    }

    this._workflow = this._buildWorkflow();
  }

  async _onRender() {
    super._onRender?.(...arguments);

    const root = this._getRootElement();
    if (!root) return;

    const content = root.querySelector(".window-content") ?? root;
    this._toolbarRegion = content.querySelector(`[data-region="toolbar"]`);
    this._bodyRegion = content.querySelector(`[data-region="body"]`);
    this._footerRegion = content.querySelector(`[data-region="footer"]`);

    this._renderOptions();
  }

  _getRootElement() {
    if (this.element instanceof HTMLElement) return this.element;
    if (this.element?.jquery && this.element[0] instanceof HTMLElement) return this.element[0];
    if (this.element?.[0] instanceof HTMLElement) return this.element[0];
    return document.getElementById(this.id) ?? null;
  }

  _buildWorkflow() {
    return buildClassImportWorkflow(this._payload, {
      entry: this._entry,
      actor: this._actor,
      targetLevel: this._state?.targetLevel ?? 1,
      preferredSubclassSourceId: this._state?.subclassSourceId ?? null,
      importSelection: {
        includeSubclass: this._state?.includeSubclass ?? false,
        subclassSourceId: this._state?.subclassSourceId ?? null,
        optionSelections: this._state?.optionSelections ?? {},
        hpMode: this._state?.hpMode ?? null,
        spellMode: this._state?.spellMode ?? null,
        skillSelections: this._state?.skillSelections ?? [],
        toolSelections: this._state?.toolSelections ?? [],
        savingThrowSelections: this._state?.savingThrowSelections ?? [],
        languageSelections: this._state?.languageSelections ?? [],
        traitSelections: this._state?.traitSelections ?? {}
      }
    });
  }

  _renderOptions() {
    this._workflow = this._buildWorkflow();
    this._renderToolbar();
    this._renderBody();
    this._renderFooter();
  }

  _renderToolbar() {
    if (!this._toolbarRegion) return;

    const workflow = this._workflow;
    this._toolbarRegion.innerHTML = `
      <div class="dauligor-class-options__toolbar">
        <div>
          <span class="dauligor-class-browser__step">Configure Class Import</span>
          <h2 class="dauligor-class-browser__title">${foundry.utils.escapeHTML(workflow?.classItem?.name ?? this._classModel?.name ?? "Class")}</h2>
          <p class="dauligor-class-browser__subtitle">Choose subclass, unique options, and class-level import behavior before the Dauligor actor import runs.</p>
        </div>
        <div class="dauligor-class-options__toolbar-meta">
          <div><span class="dauligor-class-browser__summary-label">Variant</span><span class="dauligor-class-browser__summary-value">${foundry.utils.escapeHTML(this._entry?.payloadKind ?? "payload")}</span></div>
          <div><span class="dauligor-class-browser__summary-label">Destination</span><span class="dauligor-class-browser__summary-value">${this._actor ? foundry.utils.escapeHTML(this._actor.name) : "World / Sidebar"}</span></div>
        </div>
      </div>
    `;
  }

  _renderBody() {
    if (!this._bodyRegion) return;

    const workflow = this._workflow;
    if (!workflow) {
      this._bodyRegion.innerHTML = `<div class="dauligor-class-browser__empty">The class import options could not be prepared.</div>`;
      return;
    }

    const importModeHtml = workflow.hasSubclassSupport
      ? `
        <section class="dauligor-class-options__section">
          <header class="dauligor-class-options__section-head">
            <h3>Import Mode</h3>
            <p>Import the base class by itself, or import the base class together with a subclass.</p>
          </header>
          <div class="dauligor-class-options__choice-list">
            <label class="dauligor-class-options__radio">
              <input type="radio" name="include-subclass" value="false" ${workflow.selection.includeSubclass ? "" : "checked"}>
              <span>Base class only</span>
            </label>
            <label class="dauligor-class-options__radio">
              <input type="radio" name="include-subclass" value="true" ${workflow.selection.includeSubclass ? "checked" : ""}>
              <span>Base class + subclass</span>
            </label>
          </div>
        </section>
      `
      : "";

    const subclassHtml = workflow.subclassItems.length
      ? `
        <section class="dauligor-class-options__section">
          <header class="dauligor-class-options__section-head">
            <h3>Subclass</h3>
            <p>${workflow.selection.includeSubclass ? "Choose which subclass to import alongside the base class." : "Subclass import is currently disabled. Switch the import mode if you want to include one."}</p>
          </header>
          <div class="dauligor-class-options__choice-list">
            ${workflow.subclassItems.map((item) => {
        const sourceId = item.flags?.[MODULE_ID]?.sourceId ?? "";
        const isChecked = workflow.selection.subclassSourceId === sourceId;
        return `
                <label class="dauligor-class-options__radio ${workflow.selection.includeSubclass ? "" : "dauligor-class-options__radio--disabled"}">
                  <input type="radio" name="subclass-source-id" value="${foundry.utils.escapeHTML(sourceId)}" ${isChecked ? "checked" : ""} ${workflow.selection.includeSubclass ? "" : "disabled"}>
                  <span>${foundry.utils.escapeHTML(item.name)}</span>
                </label>
              `;
      }).join("")}
          </div>
        </section>
      `
      : "";

    const levelPlanHtml = this._actor
      ? `
        <section class="dauligor-class-options__section">
          <header class="dauligor-class-options__section-head">
            <h3>Class Levels</h3>
            <p>Select the highest class level you want to import. The rows below show the feature summary for each level.</p>
          </header>
          <div class="dauligor-class-options__levels">
            <div class="dauligor-class-options__levels-header">
              <span class="dauligor-class-options__levels-cell dauligor-class-options__levels-cell--check"></span>
              <span class="dauligor-class-options__levels-cell dauligor-class-options__levels-cell--level">Level</span>
              <span class="dauligor-class-options__levels-cell">Features</span>
            </div>
            ${workflow.levelRows.map((row) => `
              <label class="dauligor-class-options__levels-row ${row.current ? "is-current" : ""}">
                <span class="dauligor-class-options__levels-cell dauligor-class-options__levels-cell--check">
                  <input type="checkbox" data-action="level-row" data-level="${row.level}" ${row.selected ? "checked" : ""}>
                </span>
                <span class="dauligor-class-options__levels-cell dauligor-class-options__levels-cell--level">${row.level}</span>
                <span class="dauligor-class-options__levels-cell">${foundry.utils.escapeHTML(row.featureSummary)}</span>
              </label>
            `).join("")}
          </div>
        </section>
      `
      : "";

    const hpHtml = this._actor
      ? `
        <section class="dauligor-class-options__section">
          <header class="dauligor-class-options__section-head">
            <h3>Hit Points</h3>
            <p>${workflow.targetLevel <= 1 ? "This mainly stores your preferred HP handling for future Dauligor level-ups. First-level special cases can still be refined later." : "This saves the preferred HP increase mode on the imported class for later Dauligor-managed level-ups."}</p>
          </header>
          <div class="dauligor-class-options__choice-list">
            <label class="dauligor-class-options__radio">
              <input type="radio" name="hp-mode" value="average" ${workflow.selection.hpMode === "average" ? "checked" : ""}>
              <span>Take Average</span>
            </label>
            <label class="dauligor-class-options__radio">
              <input type="radio" name="hp-mode" value="minimum" ${workflow.selection.hpMode === "minimum" ? "checked" : ""}>
              <span>Minimum Value</span>
            </label>
            <label class="dauligor-class-options__radio">
              <input type="radio" name="hp-mode" value="maximum" ${workflow.selection.hpMode === "maximum" || workflow.selection.hpMode === "max" ? "checked" : ""}>
              <span>Maximum Value</span>
            </label>
            <label class="dauligor-class-options__radio">
              <input type="radio" name="hp-mode" value="roll" ${workflow.selection.hpMode === "roll" || workflow.selection.hpMode === "manual" ? "checked" : ""}>
              <span>Roll</span>
            </label>
            <label class="dauligor-class-options__radio">
              <input type="radio" name="hp-mode" value="custom" ${workflow.selection.hpMode === "custom" ? "checked" : ""}>
              <span>Roll (Custom Formula)</span>
            </label>
            <label class="dauligor-class-options__radio">
              <input type="radio" name="hp-mode" value="none" ${workflow.selection.hpMode === "none" ? "checked" : ""}>
              <span>Do Not Increase HP</span>
            </label>
          </div>
        </section>
      `
      : "";

    const skillsHtml = this._actor && workflow.skillChoices.allOptions.length
      ? `
        <section class="dauligor-class-options__section">
          <header class="dauligor-class-options__section-head">
            <h3>Skill Proficiencies</h3>
            <p>Choose ${workflow.skillChoices.choiceCount || 0} class skill proficiency option(s). Fixed proficiencies are always applied.</p>
          </header>
          <div class="dauligor-class-options__choice-list">
            ${workflow.skillChoices.allOptions.map((slug) => {
        const skill = CONFIG.DND5E.skills?.[slug] ?? {};
        const isFixed = workflow.skillChoices.fixed.includes(slug);
        const isChecked = workflow.selection.skillSelections.includes(slug);
        const currentChosen = workflow.selection.skillSelections.filter((selected) => !workflow.skillChoices.fixed.includes(selected));
        const optionLimitReached = !isFixed
          && !isChecked
          && workflow.skillChoices.choiceCount > 0
          && currentChosen.length >= workflow.skillChoices.choiceCount;
        return `
                <label class="dauligor-class-options__checkbox ${(isFixed || optionLimitReached) ? "dauligor-class-options__checkbox--disabled" : ""}">
                  <input
                    type="checkbox"
                    data-action="toggle-skill"
                    data-skill-slug="${foundry.utils.escapeHTML(slug)}"
                    ${isChecked ? "checked" : ""}
                    ${(isFixed || optionLimitReached) ? "disabled" : ""}
                  >
                  <span class="dauligor-class-options__checkbox-copy">
                    <span class="dauligor-class-options__checkbox-title">${foundry.utils.escapeHTML(skill.label ?? slug)}</span>
                    <span class="dauligor-class-options__checkbox-meta">${foundry.utils.escapeHTML((skill.ability ?? "").toUpperCase())}${isFixed ? " • Fixed" : ""}</span>
                  </span>
                </label>
              `;
      }).join("")}
          </div>
        </section>
      `
      : "";

    const optionGroupsHtml = workflow.optionGroups.length
      ? workflow.optionGroups.map((group) => {
        const canChoose = group.maxSelections > 0;
        const selectedIds = new Set(group.selectedSourceIds ?? []);
        const countLabel = canChoose
          ? `${group.selectedSourceIds.length}/${group.maxSelections} selected`
          : "No selections unlocked at this level";
        const optionsHtml = group.options.length
          ? group.options.map((item) => {
            const sourceId = item.flags?.[MODULE_ID]?.sourceId ?? "";
            const isChecked = selectedIds.has(sourceId);
            const isDisabled = !isChecked && selectedIds.size >= group.maxSelections && canChoose;
            const prerequisite = Number(item.flags?.[MODULE_ID]?.levelPrerequisite ?? 0);
            return `
              <label class="dauligor-class-options__checkbox ${isDisabled ? "dauligor-class-options__checkbox--disabled" : ""}">
                <input
                  type="checkbox"
                  data-action="toggle-option"
                  data-group-source-id="${foundry.utils.escapeHTML(group.sourceId)}"
                  data-option-source-id="${foundry.utils.escapeHTML(sourceId)}"
                  ${isChecked ? "checked" : ""}
                  ${!canChoose || isDisabled ? "disabled" : ""}
                >
                <span class="dauligor-class-options__checkbox-copy">
                  <span class="dauligor-class-options__checkbox-title">${foundry.utils.escapeHTML(item.name)}</span>
                  <span class="dauligor-class-options__checkbox-meta">${prerequisite > 0 ? `Level ${prerequisite}+` : "Available now"}</span>
                </span>
              </label>
            `;
          }).join("")
          : `<div class="dauligor-class-browser__empty">No options are currently available from this group at class level ${workflow.targetLevel}.</div>`;

        return `
          <section class="dauligor-class-options__section">
            <header class="dauligor-class-options__section-head">
              <h3>${foundry.utils.escapeHTML(group.name || group.featureName || "Class Options")}</h3>
              <p>${group.featureName ? `${foundry.utils.escapeHTML(group.featureName)} grants this pool.` : "Select the currently available options from this group."}</p>
            </header>
            <div class="dauligor-class-options__group-meta">${foundry.utils.escapeHTML(countLabel)}</div>
            <div class="dauligor-class-options__choice-list">${optionsHtml}</div>
          </section>
        `;
      }).join("")
      : `
        <section class="dauligor-class-options__section">
          <header class="dauligor-class-options__section-head">
            <h3>Unique Options</h3>
            <p>This class payload does not currently expose any selectable option pools.</p>
          </header>
        </section>
      `;

    const spellsHtml = workflow.hasSpellcasting
      ? `
        <section class="dauligor-class-options__section">
          <header class="dauligor-class-options__section-head">
            <h3>Spells</h3>
            <p>Spell choice import is still a placeholder, but the progression summary is available now so the Dauligor flow can match the eventual class importer.</p>
          </header>
          ${workflow.spellcastingRows.length ? `
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
          ` : ""}
          <div class="dauligor-class-options__choice-list">
            <label class="dauligor-class-options__radio">
              <input type="radio" name="spell-mode" value="placeholder" ${workflow.selection.spellMode === "placeholder" ? "checked" : ""}>
              <span>Placeholder only for now</span>
            </label>
          </div>
        </section>
      `
      : "";

    const equipmentHtml = workflow.startingEquipment
      ? `
        <section class="dauligor-class-options__section">
          <header class="dauligor-class-options__section-head">
            <h3>Starting Equipment</h3>
            <p>Starting equipment is not implemented yet. This is the source text we already have available from Dauligor.</p>
          </header>
          <div class="dauligor-class-options__equipment-note">${foundry.utils.escapeHTML(workflow.startingEquipment).replace(/\n/g, "<br>")}</div>
        </section>
      `
      : "";

    this._bodyRegion.innerHTML = `
      <div class="dauligor-class-options__body">
        <section class="dauligor-class-options__section">
          <header class="dauligor-class-options__section-head">
            <h3>Import Summary</h3>
            <p>The full Dauligor class bundle is the primary source here. Activities and starting equipment can continue to arrive later without changing this workflow.</p>
          </header>
          <div class="dauligor-class-browser__summary-grid">
            <div class="dauligor-class-browser__summary-label">Class</div>
            <div class="dauligor-class-browser__summary-value">${foundry.utils.escapeHTML(workflow.classItem.name)}</div>
            <div class="dauligor-class-browser__summary-label">Target Level</div>
            <div class="dauligor-class-browser__summary-value">${workflow.targetLevel}</div>
            <div class="dauligor-class-browser__summary-label">Import Mode</div>
            <div class="dauligor-class-browser__summary-value">${workflow.selection.includeSubclass ? "Class + Subclass" : "Base Class Only"}</div>
            <div class="dauligor-class-browser__summary-label">Required Subclass Level</div>
            <div class="dauligor-class-browser__summary-value">${Number.isFinite(workflow.minSubclassLevel) ? workflow.minSubclassLevel : "N/A"}</div>
            <div class="dauligor-class-browser__summary-label">Selected Subclass</div>
            <div class="dauligor-class-browser__summary-value">${workflow.selection.includeSubclass && workflow.selection.subclassSourceId ? foundry.utils.escapeHTML(workflow.selectedSubclassItem?.name ?? workflow.selection.subclassSourceId) : "None"}</div>
          </div>
        </section>
        ${levelPlanHtml}
        ${importModeHtml}
        ${subclassHtml}
        ${skillsHtml}
        ${hpHtml}
        ${optionGroupsHtml}
        ${spellsHtml}
        ${equipmentHtml}
      </div>
    `;

    this._bodyRegion.querySelectorAll(`input[name="include-subclass"]`).forEach((input) => {
      input.addEventListener("change", () => {
        this._state.includeSubclass = input.value === "true";
        this._renderOptions();
      });
    });
    this._bodyRegion.querySelectorAll(`input[name="subclass-source-id"]`).forEach((input) => {
      input.addEventListener("change", () => {
        this._state.subclassSourceId = input.value || null;
        this._renderOptions();
      });
    });
    this._bodyRegion.querySelectorAll(`input[name="hp-mode"]`).forEach((input) => {
      input.addEventListener("change", () => {
        this._state.hpMode = input.value || "average";
      });
    });
    this._bodyRegion.querySelectorAll(`input[name="spell-mode"]`).forEach((input) => {
      input.addEventListener("change", () => {
        this._state.spellMode = input.value || "placeholder";
      });
    });
    this._bodyRegion.querySelectorAll(`[data-action="toggle-option"]`).forEach((input) => {
      input.addEventListener("change", () => {
        const groupSourceId = input.dataset.groupSourceId;
        const optionSourceId = input.dataset.optionSourceId;
        if (!groupSourceId || !optionSourceId) return;

        const group = this._workflow.optionGroups.find((it) => it.sourceId === groupSourceId);
        const current = new Set(this._state.optionSelections[groupSourceId] ?? []);
        if (input.checked) {
          current.add(optionSourceId);
        } else {
          current.delete(optionSourceId);
        }

        const limited = [...current].filter((sourceId) =>
          group?.options.some((item) => item.flags?.[MODULE_ID]?.sourceId === sourceId));
        this._state.optionSelections[groupSourceId] = group?.maxSelections > 0
          ? limited.slice(0, group.maxSelections)
          : [];
        this._renderOptions();
      });
    });
    this._bodyRegion.querySelectorAll(`[data-action="toggle-skill"]`).forEach((input) => {
      input.addEventListener("change", () => {
        const skillSlug = input.dataset.skillSlug;
        if (!skillSlug) return;
        const selected = new Set(this._state.skillSelections ?? []);
        if (input.checked) selected.add(skillSlug);
        else selected.delete(skillSlug);
        this._state.skillSelections = [...selected];
        this._renderOptions();
      });
    });
    this._bodyRegion.querySelectorAll(`[data-action="level-row"]`).forEach((input) => {
      input.addEventListener("change", () => {
        this._state.targetLevel = clampLevel(input.dataset.level ?? input.value ?? 1);
        this._renderOptions();
      });
    });
  }

  _renderFooter() {
    if (!this._footerRegion) return;

    const workflow = this._workflow;
    const requiredSkillChoices = Math.max(0, workflow?.skillChoices?.choiceCount ?? 0);
    const chosenSkillChoices = Math.max(0, (workflow?.selection?.skillSelections ?? []).filter((slug) => !(workflow?.skillChoices?.fixed ?? []).includes(slug)).length);
    const hasRequiredSubclass = !workflow?.selection?.includeSubclass || Boolean(workflow?.selection?.subclassSourceId);
    const hasRequiredSkills = !requiredSkillChoices || chosenSkillChoices <= requiredSkillChoices;
    const canImport = Boolean(workflow) && hasRequiredSubclass && hasRequiredSkills;

    this._footerRegion.innerHTML = `
      <div class="dauligor-class-options__footer">
        <div class="dauligor-class-options__footer-fields">
          ${this._actor ? "" : `
            <label class="dauligor-class-browser__field">
              <span class="dauligor-class-browser__field-label">Import Folder Path</span>
              <input class="dauligor-class-browser__input" type="text" data-action="folder-path" value="${foundry.utils.escapeHTML(this._folderPath)}">
            </label>
          `}
        </div>
        <div class="dauligor-class-options__footer-actions">
          <div class="dauligor-class-browser__status ${this._state.statusLevel ? `dauligor-class-browser__status--${this._state.statusLevel}` : ""}">
            ${this._state.status ? foundry.utils.escapeHTML(this._state.status) : ""}
          </div>
          <div class="dauligor-class-browser__actions">
            <button type="button" class="dauligor-class-browser__button" data-action="cancel">Cancel</button>
            <button type="button" class="dauligor-class-browser__button dauligor-class-browser__button--primary" data-action="confirm-import" ${canImport ? "" : "disabled"}>${workflow?.selection?.includeSubclass ? "Import Class + Subclass" : "Import Base Class"}</button>
          </div>
        </div>
      </div>
    `;

    this._footerRegion.querySelector(`[data-action="folder-path"]`)?.addEventListener("change", async (event) => {
      this._folderPath = (event.currentTarget.value ?? "").trim() || "Classes";
      await game.settings.set(MODULE_ID, SETTINGS.defaultClassFolderPath, this._folderPath);
    });
    this._footerRegion.querySelector(`[data-action="cancel"]`)?.addEventListener("click", async () => {
      await this.close();
    });
    this._footerRegion.querySelector(`[data-action="confirm-import"]`)?.addEventListener("click", async () => {
      await this._confirmImport();
    });
  }

  async _confirmImport() {
    const workflow = this._workflow;
    if (!workflow) {
      notifyWarn("The class import options are no longer available.");
      return;
    }

    this._state.status = this._actor
      ? `Importing ${workflow.classItem.name} onto ${this._actor.name}...`
      : `Importing ${workflow.classItem.name} into the world library...`;
    this._state.statusLevel = "";
    this._renderFooter();

    const result = await importClassPayloadToWorld(this._payload, {
      entry: this._entry,
      folderPath: this._folderPath,
      actor: this._actor,
      targetLevel: this._state.targetLevel,
      importSelection: {
        includeSubclass: this._state.includeSubclass ?? false,
        subclassSourceId: this._state.subclassSourceId ?? null,
        optionSelections: this._state.optionSelections,
        hpMode: this._state.hpMode,
        spellMode: this._state.spellMode,
        skillSelections: this._state.skillSelections,
        toolSelections: this._state.toolSelections,
        savingThrowSelections: this._state.savingThrowSelections,
        languageSelections: this._state.languageSelections,
        traitSelections: this._state.traitSelections
      }
    });

    this._state.status = result
      ? `Imported ${workflow.classItem.name}.`
      : `Import failed for ${workflow.classItem.name}.`;
    this._state.statusLevel = result ? "success" : "danger";
    this._renderFooter();

    if (result) await this.close();
  }
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
      const selectedLevel = await runLevelSelectionStep({ workflow, sequence, progress });
      if (selectedLevel === "cancelled") throw new DauligorImportSequenceCancelledError();
      state.targetLevel = selectedLevel;
    }

    workflow = buildWorkflowFromSequenceState(payload, { entry, actor, state });
    progress.setSteps(buildImportSequenceSteps(workflow, { actor }));
    throwIfSequenceCancelled(sequence);

    if (actor) {
      const hpMode = await runHpModeStep({ workflow, sequence, progress });
      if (hpMode === "cancelled") throw new DauligorImportSequenceCancelledError();
      if (hpMode !== undefined) {
        state.hpMode = hpMode.hpMode ?? state.hpMode;
        state.hpCustomFormula = hpMode.hpCustomFormula ?? state.hpCustomFormula;
      }
    }

    workflow = buildWorkflowFromSequenceState(payload, { entry, actor, state });
    progress.setSteps(buildImportSequenceSteps(workflow, { actor }));
    throwIfSequenceCancelled(sequence);

    if (actor && workflow.skillChoices?.choiceCount > 0 && workflow.skillChoices?.allOptions?.length) {
      const skillSelections = await runSkillSelectionStep({ workflow, sequence, progress });
      if (skillSelections === "cancelled") throw new DauligorImportSequenceCancelledError();
      if (skillSelections) state.skillSelections = skillSelections;
    } else {
      progress.markStep("skills", "skipped", "No class skill choices are available.");
    }

    workflow = buildWorkflowFromSequenceState(payload, { entry, actor, state });
    progress.setSteps(buildImportSequenceSteps(workflow, { actor }));
    throwIfSequenceCancelled(sequence);

    console.log("Dauligor tool choices check:", {
      actorPresent: !!actor,
      toolChoicesPresent: !!workflow.toolChoices,
      choiceCount: workflow.toolChoices?.choiceCount,
      allOptionsLength: workflow.toolChoices?.allOptions?.length
    });

    if (actor && workflow.toolChoices?.choiceCount > 0 && workflow.toolChoices?.allOptions?.length) {
      const toolSelections = await runToolSelectionStep({ workflow, sequence, progress });
      if (toolSelections === "cancelled") throw new DauligorImportSequenceCancelledError();
      if (toolSelections) state.toolSelections = toolSelections;
    } else {
      progress.markStep("tools", "skipped", "No class tool choices are available.");
    }

    workflow = buildWorkflowFromSequenceState(payload, { entry, actor, state });
    progress.setSteps(buildImportSequenceSteps(workflow, { actor }));
    throwIfSequenceCancelled(sequence);

    for (const group of workflow.optionGroups.filter((candidate) => candidate.options.length && candidate.maxSelections > 0)) {
      const selectedSourceIds = await runOptionGroupStep({ workflow, group, sequence, progress });
      if (selectedSourceIds === "cancelled") throw new DauligorImportSequenceCancelledError();
      if (selectedSourceIds) {
        if (selectedSourceIds.length) state.optionSelections[group.sourceId] = selectedSourceIds;
        else delete state.optionSelections[group.sourceId];
      }

      workflow = buildWorkflowFromSequenceState(payload, { entry, actor, state });
      progress.setSteps(buildImportSequenceSteps(workflow, { actor }));
      throwIfSequenceCancelled(sequence);
    }

    if (actor && workflow.hasSpellcasting) {
      const spellResult = await runSpellPlaceholderStep({ workflow, sequence, progress });
      if (spellResult === "cancelled") throw new DauligorImportSequenceCancelledError();
    } else {
      progress.markStep("spells", "skipped", "Spell choices are not required here.");
    }

    if (actor && workflow.startingEquipment) {
      const equipmentResult = await runEquipmentPlaceholderStep({ workflow, sequence, progress });
      if (equipmentResult === "cancelled") throw new DauligorImportSequenceCancelledError();
    } else {
      progress.markStep("equipment", "skipped", "Starting equipment is not part of this import.");
    }

    throwIfSequenceCancelled(sequence);
    progress.markStep("import", "active", `Importing ${workflow.classItem.name}...`);
    progress.setStatus(`Importing ${workflow.classItem.name}...`);

    const result = await importClassPayloadToWorld(payload, {
      entry,
      folderPath,
      actor,
      targetLevel: state.targetLevel,
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

    if (result) {
      progress.markStep("import", "complete", `Imported ${workflow.classItem.name}.`);
      progress.setStatus(`Imported ${workflow.classItem.name}.`, "success");
      progress.setFinished(true);
      await pause(350);
      await progress.close();
      if (actor?.documentName === "Actor") {
        await maybeOfferSpellPointsSupport({
          actor,
          importedClassItem: result
        });
      }
      return result;
    }

    progress.markStep("import", "error", `Import failed for ${workflow.classItem.name}.`);
    progress.setStatus(`Import failed for ${workflow.classItem.name}.`, "danger");
    progress.setFinished(true);
    return null;
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
  }

  for (const group of ensureArray(workflow?.optionGroups).filter((candidate) => candidate.options.length && candidate.maxSelections > 0)) {
    steps.push({
      id: `option:${group.sourceId}`,
      label: group.name || group.featureName || "Choose class options"
    });
  }

  if (actor && workflow?.hasSpellcasting) {
    steps.push({ id: "spells", label: "Review spell choices" });
  }

  if (actor && workflow?.startingEquipment) {
    steps.push({ id: "equipment", label: "Review starting equipment" });
  }

  steps.push({ id: "import", label: "Import class" });
  return steps;
}

function throwIfSequenceCancelled(sequence) {
  if (sequence?.cancelled) {
    throw new DauligorImportSequenceCancelledError();
  }
}

async function runImportModeStep({ workflow, sequence, progress }) {
  const stepId = "import-mode";
  progress.markStep(stepId, "active", "Choose whether to import only the base class or also include a subclass.");
  progress.setStatus("Waiting for import mode selection...");

  const result = await DauligorSequencePromptApp.prompt({
    title: "Choose Import Mode",
    subtitle: "Import the base class by itself, or import the base class together with a subclass.",
    width: 520,
    height: 260,
    state: {
      includeSubclass: workflow.selection.includeSubclass
    },
    renderBody: (app) => `
      <div class="dauligor-class-options__choice-list">
        <label class="dauligor-class-options__radio">
          <input type="radio" name="include-subclass" value="false" ${app._state.includeSubclass ? "" : "checked"}>
          <span>Base class only</span>
        </label>
        <label class="dauligor-class-options__radio">
          <input type="radio" name="include-subclass" value="true" ${app._state.includeSubclass ? "checked" : ""}>
          <span>Base class + subclass</span>
        </label>
      </div>
    `,
    onRenderBody: (app, root) => {
      root.querySelectorAll(`input[name="include-subclass"]`).forEach((input) => {
        input.addEventListener("change", () => {
          app.updateState({ includeSubclass: input.value === "true" });
        });
      });
    },
    actions: [
      { id: "confirm", label: "OK", primary: true },
      { id: "cancel", label: "Cancel" }
    ],
    onAction: async (app, actionId) => {
      if (actionId === "cancel") return { status: "cancelled" };
      return { status: "confirmed", value: Boolean(app._state.includeSubclass) };
    }
  }, sequence);

  if (result.status === "cancelled") return "cancelled";
  progress.markStep(stepId, "complete", result.value ? "Class + subclass selected." : "Base class only selected.");
  return Boolean(result.value);
}

async function runSubclassStep({ workflow, sequence, progress }) {
  const stepId = "subclass";
  progress.markStep(stepId, "active", "Choose the subclass to import alongside the base class.");
  progress.setStatus("Waiting for subclass selection...");

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
      const sourceLabel = deriveSourceLabel(item.system?.source?.book ?? item.flags?.plutonium?.source);
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

async function runLevelSelectionStep({ workflow, sequence, progress }) {
  const stepId = "levels";
  const minimumLevel = Math.max(1, Number(workflow.existingClassLevel ?? workflow.existingClassItem?.system?.levels ?? 0) || 1);
  const hasExistingLevels = minimumLevel > 1;
  const levelWindowTitle = workflow.selection.includeSubclass ? "Select Class and Subclass Levels" : "Select Class Levels";
  progress.markStep(stepId, "active", hasExistingLevels
    ? `Continue leveling from class level ${minimumLevel}.`
    : "Choose the highest class level to import.");
  progress.setStatus("Waiting for class level selection...");

  const result = await DauligorSequencePromptApp.prompt({
    title: levelWindowTitle,
    subtitle: hasExistingLevels
      ? `Current class level: ${minimumLevel}. Select the ending level for this import.`
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

async function runSkillSelectionStep({ workflow, sequence, progress }) {
  const stepId = "skills";
  progress.markStep(stepId, "active", "Choose the class skill proficiency options.");
  progress.setStatus("Waiting for skill proficiency choices...");
  const fixedSkills = new Set(workflow.skillChoices.fixed);

  const result = await DauligorSequencePromptApp.prompt({
    title: "Skill Proficiencies",
    subtitle: `Choose ${numberToWord(workflow.skillChoices.choiceCount)} skill proficienc${workflow.skillChoices.choiceCount === 1 ? "y" : "ies"}.`,
    width: 660,
    height: 520,
    state: {
      selectedSkills: [...workflow.selection.skillSelections]
    },
    renderBody: (app) => `
      <div class="dauligor-class-options__choice-list">
        ${workflow.skillChoices.allOptions.map((slug) => {
      const skill = CONFIG.DND5E.skills?.[slug] ?? {};
      const isFixed = fixedSkills.has(slug);
      const isChecked = app._state.selectedSkills.includes(slug);
      const skillLabel = getConfigLabel(skill.label, slug);
      const abilityLabel = formatAbilityAbbreviation(skill.ability);
      return `
            <label class="dauligor-class-options__checkbox ${isFixed ? "dauligor-class-options__checkbox--disabled" : ""}">
              <input
                type="checkbox"
                data-action="toggle-skill"
                data-skill-slug="${foundry.utils.escapeHTML(slug)}"
                ${isChecked ? "checked" : ""}
                ${isFixed ? "disabled" : ""}
              >
              <span class="dauligor-class-options__checkbox-copy">
                <span class="dauligor-class-options__checkbox-title">${foundry.utils.escapeHTML(skillLabel)}</span>
              <span class="dauligor-class-options__checkbox-meta">${foundry.utils.escapeHTML(abilityLabel)}${isFixed ? " - Fixed" : ""}</span>
              </span>
            </label>
          `;
    }).join("")}
      </div>
    `,
    onRenderBody: (app, root) => {
      root.querySelectorAll(`[data-action="toggle-skill"]`).forEach((input) => {
        input.addEventListener("change", () => {
          const slug = input.dataset.skillSlug;
          if (!slug) return;

          const fixed = new Set(workflow.skillChoices.fixed);
          const current = new Set(app._state.selectedSkills ?? []);
          if (input.checked) current.add(slug);
          else current.delete(slug);

          const chosen = [...current].filter((selected) => !fixed.has(selected));
          if (chosen.length > workflow.skillChoices.choiceCount) {
            notifyWarn(`Choose only ${workflow.skillChoices.choiceCount} skill proficiency option(s).`);
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
      if (chosen.length !== workflow.skillChoices.choiceCount) {
        notifyWarn(`Choose exactly ${workflow.skillChoices.choiceCount} skill proficiency option(s).`);
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

async function runToolSelectionStep({ workflow, sequence, progress }) {
  const stepId = "tools";
  progress.markStep(stepId, "active", "Choose the class tool proficiency options.");
  progress.setStatus("Waiting for tool proficiency choices...");
  const fixedTools = new Set(workflow.toolChoices.fixed);
  console.log("runToolSelectionStep trace:", {
    fixedTools: [...fixedTools],
    allOptions: workflow.toolChoices.allOptions,
    selectedTools: [...workflow.selection.toolSelections],
    choiceCount: workflow.toolChoices.choiceCount
  });

  const result = await DauligorSequencePromptApp.prompt({
    title: "Tool Proficiencies",
    subtitle: `Choose ${numberToWord(workflow.toolChoices.choiceCount)} tool proficienc${workflow.toolChoices.choiceCount === 1 ? "y" : "ies"}.`,
    width: 660,
    height: 520,
    state: {
      selectedTools: [...workflow.selection.toolSelections]
    },
    renderBody: (app) => `
      <div class="dauligor-class-options__choice-list">
        ${workflow.toolChoices.allOptions.map((slug) => {
      const tool = CONFIG.DND5E.tools?.[slug] ?? {};
      const isFixed = fixedTools.has(slug);
      const isChecked = app._state.selectedTools.includes(slug);
      const toolLabel = getConfigLabel(tool.label, slug);
      const abilityLabel = formatAbilityAbbreviation(tool.ability);
      return `
            <label class="dauligor-class-options__checkbox ${isFixed ? "dauligor-class-options__checkbox--disabled" : ""}">
              <input
                type="checkbox"
                data-action="toggle-tool"
                data-tool-slug="${foundry.utils.escapeHTML(slug)}"
                ${isChecked ? "checked" : ""}
                ${isFixed ? "disabled" : ""}
              >
              <span class="dauligor-class-options__checkbox-copy">
                <span class="dauligor-class-options__checkbox-title">${foundry.utils.escapeHTML(toolLabel)}</span>
                <span class="dauligor-class-options__checkbox-meta">${foundry.utils.escapeHTML(abilityLabel)}${isFixed ? " - Fixed" : ""}</span>
              </span>
            </label>
          `;
    }).join("")}
      </div>
    `,
    onRenderBody: (app, root) => {
      root.querySelectorAll(`[data-action="toggle-tool"]`).forEach((input) => {
        input.addEventListener("change", () => {
          const slug = input.dataset.toolSlug;
          if (!slug) return;

          const fixed = new Set(workflow.toolChoices.fixed);
          const current = new Set(app._state.selectedTools ?? []);
          if (input.checked) current.add(slug);
          else current.delete(slug);

          const chosen = [...current].filter((selected) => !fixed.has(selected));
          console.log("toggle-tool trace:", {
            slug,
            inputChecked: input.checked,
            fixed: [...fixed],
            current: [...current],
            chosen,
            maxCount: workflow.toolChoices.choiceCount
          });
          if (chosen.length > workflow.toolChoices.choiceCount) {
            notifyWarn(`Choose only ${workflow.toolChoices.choiceCount} tool proficiency option(s).`);
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
      if (chosen.length !== workflow.toolChoices.choiceCount) {
        notifyWarn(`Choose exactly ${workflow.toolChoices.choiceCount} tool proficiency option(s).`);
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

async function runOptionGroupStep({ workflow, group, sequence, progress }) {
  const stepId = `option:${group.sourceId}`;
  progress.markStep(stepId, "active", `Choose ${group.maxSelections} option(s) from ${group.name || group.featureName || "this pool"}.`);
  progress.setStatus(`Waiting for ${group.name || group.featureName || "class option"} choices...`);

  const result = await DauligorSequencePromptApp.prompt({
    title: `Choose ${group.maxSelections} Option${group.maxSelections === 1 ? "" : "s"}: ${group.name || group.featureName || "Class Options"} (Level ${workflow.targetLevel})`,
    width: 700,
    height: 620,
    state: {
      selectedSourceIds: [...(group.selectedSourceIds ?? [])]
    },
    renderBody: (app) => `
      <div class="dauligor-sequence__option-list">
        ${group.options.map((item) => {
      const sourceId = item.flags?.[MODULE_ID]?.sourceId ?? "";
      const sourceLabel = deriveSourceLabel(item.system?.source?.book ?? item.flags?.plutonium?.source);
      return `
            <label class="dauligor-sequence__option-row">
              <span class="dauligor-sequence__option-check">
                <input
                  type="checkbox"
                  data-action="toggle-option"
                  data-option-source-id="${foundry.utils.escapeHTML(sourceId)}"
                  ${app._state.selectedSourceIds.includes(sourceId) ? "checked" : ""}
                >
              </span>
              <span class="dauligor-sequence__option-name">${foundry.utils.escapeHTML(item.name)}</span>
              <span class="dauligor-sequence__option-source">${foundry.utils.escapeHTML(sourceLabel)}</span>
            </label>
          `;
    }).join("")}
      </div>
    `,
    onRenderBody: (app, root) => {
      root.querySelectorAll(`[data-action="toggle-option"]`).forEach((input) => {
        input.addEventListener("change", () => {
          const sourceId = input.dataset.optionSourceId;
          if (!sourceId) return;
          const selected = new Set(app._state.selectedSourceIds ?? []);
          if (input.checked) selected.add(sourceId);
          else selected.delete(sourceId);
          if (selected.size > group.maxSelections) {
            notifyWarn(`Choose only ${group.maxSelections} option(s) from this group.`);
            input.checked = false;
            return;
          }
          app.updateState({ selectedSourceIds: [...selected] });
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

function normalizeImportTypeId(importTypeId, modeId = undefined) {
  const normalized = importTypeId ?? modeId ?? "classes-subclasses";
  if (normalized === "classes") return "classes-subclasses";
  return normalized;
}

function getSourceTypes(importTypeId) {
  return SOURCE_TYPES[importTypeId] ?? SOURCE_TYPES["classes-subclasses"];
}

function getDefaultSourceTypeId(importTypeId) {
  return getSourceTypes(importTypeId)[0]?.id ?? "srd";
}

function buildClassModels(entryPayloads) {
  const grouped = new Map();

  for (const { entry, payload } of entryPayloads) {
    if (!entry || !payload) continue;

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

function summarizeHtml(value) {
  const plain = stripHtml(value);
  if (!plain) return "";
  return plain.length > 220 ? `${plain.slice(0, 217)}...` : plain;
}

function stripHtml(value) {
  return String(value ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function slugify(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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

async function openDauligorClassOptions(options = {}) {
  const app = await DauligorClassOptionsApp.open(options);
  log("Opened Dauligor class options workflow", options);
  return app;
}

export async function openDauligorImporter(options = {}) {
  const app = await DauligorImporterApp.open(options);
  log("Opened Dauligor import wizard", options);
  return app;
}
