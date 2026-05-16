import { MODULE_ID, SPELL_PREPARATION_TEMPLATE } from "./constants.js";
import { notifyInfo, notifyWarn, promptForText, slugifyFilename } from "./utils.js";

const { ApplicationV2, DialogV2, HandlebarsApplicationMixin } = foundry.applications.api;

const UNKNOWN_CLASS_IDENTIFIER = "__other__";

function resolveActorDocument(actorLike) {
  if (!actorLike) return null;
  if (actorLike.documentName === "Actor") return actorLike;
  if (actorLike.document?.documentName === "Actor") return actorLike.document;
  if (actorLike.actor?.documentName === "Actor") return actorLike.actor;
  return null;
}

function escapeHtml(value) {
  return foundry.utils.escapeHTML(String(value ?? ""));
}

function localizeConfigValue(value) {
  if (!value || (typeof value !== "string")) return value ?? "";
  return value.startsWith("DND5E.") ? game.i18n.localize(value) : value;
}

function getPreparedState(spell) {
  const prepared = Number(spell?.system?.prepared ?? 0);
  return Number.isFinite(prepared) ? prepared : 0;
}

function getSpellMethod(spell) {
  return String(spell?.system?.method ?? "").trim();
}

function canPrepareSpell(spell) {
  const method = getSpellMethod(spell);
  return Boolean(CONFIG.DND5E.spellcasting?.[method]?.prepares);
}

function resolveSpellClassIdentifier(spell) {
  return String(
    spell?.system?.classIdentifier
    || spell?.getFlag?.(MODULE_ID, "classIdentifier")
    || ""
  ).trim();
}

function resolveSpellListType(spell) {
  const existing = String(spell?.getFlag?.(MODULE_ID, "listType") ?? "").trim();
  if (existing) return existing;

  const prepared = getPreparedState(spell);
  if (prepared >= 2) return "always-prepared";
  if (canPrepareSpell(spell)) return "prepared";
  return "known";
}

function getSpellFlags(spell) {
  return foundry.utils.deepClone(spell?.flags?.[MODULE_ID] ?? {});
}

function buildManagedSpellFlags(spell, updates = {}) {
  const existing = getSpellFlags(spell);
  const folderLabel = Object.hasOwn(updates, "folderLabel") ? (updates.folderLabel ?? "") : (existing.folderLabel ?? "");
  const sourceId = existing.sourceId
    || spell?.identifier
    || spell?.system?.identifier
    || slugifyFilename(spell?.name ?? "spell");
  const classIdentifier = updates.classIdentifier
    ?? existing.classIdentifier
    ?? resolveSpellClassIdentifier(spell)
    ?? "";
  const next = {
    schemaVersion: 1,
    entityKind: "spell",
    sourceId,
    classIdentifier,
    listType: updates.listType ?? existing.listType ?? resolveSpellListType(spell),
    favorite: updates.favorite ?? existing.favorite ?? false,
    tags: Array.isArray(updates.tags) ? [...updates.tags] : (Array.isArray(existing.tags) ? [...existing.tags] : [])
  };

  if (folderLabel) {
    next.folderLabel = folderLabel;
    next.folderId = updates.folderId ?? existing.folderId ?? slugifyFilename(folderLabel);
  } else if ((updates.folderLabel === "") || (updates.folderId === "")) {
    next.folderLabel = "";
    next.folderId = "";
  } else if (existing.folderLabel || existing.folderId) {
    next.folderLabel = existing.folderLabel ?? "";
    next.folderId = existing.folderId ?? (existing.folderLabel ? slugifyFilename(existing.folderLabel) : "");
  }

  const passthroughKeys = [
    "entityId",
    "identifier",
    "sourceBookId",
    "classSourceId",
    "subclassIdentifier",
    "subclassSourceId",
    "listSourceId",
    "tagsSource",
    "importSource"
  ];
  for (const key of passthroughKeys) {
    const value = updates[key] ?? existing[key];
    if (value !== undefined) next[key] = value;
  }

  return next;
}

async function promptForSpellFilters({ favoritesOnly = false, preparedOnly = false } = {}) {
  try {
    return await DialogV2.prompt({
      window: { title: "Spell Filters" },
      content: `
        <div class="form-group">
          <label>
            <input type="checkbox" name="favoritesOnly" ${favoritesOnly ? "checked" : ""}>
            Favorites only
          </label>
        </div>
        <div class="form-group">
          <label>
            <input type="checkbox" name="preparedOnly" ${preparedOnly ? "checked" : ""}>
            Prepared only
          </label>
        </div>
      `,
      ok: {
        label: "Apply",
        callback: (_event, button) => ({
          favoritesOnly: Boolean(button.form.elements.favoritesOnly.checked),
          preparedOnly: Boolean(button.form.elements.preparedOnly.checked)
        })
      },
      rejectClose: false,
      modal: true
    });
  } catch {
    return null;
  }
}

function describeSpellLevel(level) {
  const label = localizeConfigValue(CONFIG.DND5E.spellLevels?.[level]);
  return level === 0 ? (label || "Cantrips") : (label || `${level}`);
}

function describeSpellSchool(school) {
  return localizeConfigValue(CONFIG.DND5E.spellSchools?.[school] ?? school ?? "");
}

function describeAbility(ability) {
  return localizeConfigValue(CONFIG.DND5E.abilities?.[ability]?.label ?? CONFIG.DND5E.abilities?.[ability] ?? ability ?? "");
}

function describeSpellcastingProgression(progression) {
  return localizeConfigValue(CONFIG.DND5E.spellcastingProgression?.[progression] ?? progression ?? "");
}

function sortSpells(left, right) {
  const levelDiff = Number(left?.system?.level ?? 0) - Number(right?.system?.level ?? 0);
  if (levelDiff !== 0) return levelDiff;
  return String(left?.name ?? "").localeCompare(String(right?.name ?? ""), undefined, { sensitivity: "base" });
}

function summarizeSpellBadges(spell) {
  const badges = [];
  if (spell.getFlag?.(MODULE_ID, "favorite")) badges.push("Favorite");
  const prepared = getPreparedState(spell);
  if (prepared >= 2) badges.push("Always");
  else if (prepared >= 1) badges.push("Prepared");
  const folderLabel = String(spell.getFlag?.(MODULE_ID, "folderLabel") ?? "").trim();
  if (folderLabel) badges.push(folderLabel);
  return badges;
}

export async function openSpellPreparationManager(actorLike) {
  const actor = resolveActorDocument(actorLike);
  if (!actor || (actor.type !== "character")) {
    notifyWarn("Open Prepare Spells from a character actor.");
    return null;
  }

  return DauligorSpellPreparationApp.open({ actor });
}

export class DauligorSpellPreparationApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static _instance = null;

  static open({ actor } = {}) {
    if (!actor) return null;

    if (this._instance) {
      this._instance.setActor(actor);
      this._instance.render({ force: true });
      this._instance.maximize?.();
      return this._instance;
    }

    const instance = new this({ actor });
    this._instance = instance;
    instance.render({ force: true });
    return instance;
  }

  constructor({ actor } = {}) {
    super({
      id: `${MODULE_ID}-spell-preparation`,
      classes: ["dauligor-importer-app", "dauligor-importer-app--spells"],
      window: {
        title: actor ? `Prepare Spells: ${actor.name}` : "Prepare Spells",
        resizable: true,
        contentClasses: ["dauligor-importer-window"]
      },
      position: {
        width: Math.min(window.innerWidth - 80, 1320),
        height: Math.min(window.innerHeight - 80, 780)
      }
    });

    this._template = SPELL_PREPARATION_TEMPLATE;
    this._actor = actor ?? null;
    this._state = {
      search: "",
      favoritesOnly: false,
      preparedOnly: false,
      selectedClassIdentifier: null,
      selectedSpellId: null,
      status: "Review current actor spells by class. This first pass does not pull available class lists from Dauligor yet.",
      statusLevel: ""
    };
  }

  _configureRenderParts() {
    return {
      main: {
        template: this._template
      }
    };
  }

  async close(options) {
    if (DauligorSpellPreparationApp._instance === this) DauligorSpellPreparationApp._instance = null;
    return super.close(options);
  }

  setActor(actor) {
    this._actor = actor ?? null;
    this.options.window.title = this._actor ? `Prepare Spells: ${this._actor.name}` : "Prepare Spells";
    this._ensureValidSelection();
  }

  _getRootElement() {
    if (this.element instanceof HTMLElement) return this.element;
    if (this.element?.jquery && this.element[0] instanceof HTMLElement) return this.element[0];
    if (this.element?.[0] instanceof HTMLElement) return this.element[0];
    return document.getElementById(this.id) ?? null;
  }

  async _onRender() {
    super._onRender?.(...arguments);

    const root = this._getRootElement();
    if (!root) return;

    const content = root.querySelector(".window-content") ?? root;
    this._classesRegion = content.querySelector(`[data-region="classes"]`);
    this._actionsRegion = content.querySelector(`[data-region="actions"]`);
    this._toolbarRegion = content.querySelector(`[data-region="toolbar"]`);
    this._listRegion = content.querySelector(`[data-region="list"]`);
    this._detailRegion = content.querySelector(`[data-region="detail"]`);
    this._summaryRegion = content.querySelector(`[data-region="summary"]`);

    await this._renderManager();
  }

  _getActorClasses() {
    return this._actor?.classes ?? {};
  }

  _getSpellItems() {
    return this._actor?.itemTypes?.spell
      ? [...this._actor.itemTypes.spell].sort(sortSpells)
      : [];
  }

  _buildClassModels() {
    const actor = this._actor;
    if (!actor) return [];

    const actorClasses = this._getActorClasses();
    const spellcastingClasses = actor.spellcastingClasses ?? {};
    const models = new Map();
    const ensureModel = (identifier, classItem = null) => {
      if (models.has(identifier)) return models.get(identifier);
      const source = classItem ?? actorClasses[identifier] ?? null;
      const model = {
        identifier,
        label: source?.name ?? (identifier === UNKNOWN_CLASS_IDENTIFIER ? "Other Spells" : identifier),
        item: source,
        spells: []
      };
      models.set(identifier, model);
      return model;
    };

    for (const [identifier, classItem] of Object.entries(spellcastingClasses)) {
      ensureModel(identifier, classItem);
    }

    for (const spell of this._getSpellItems()) {
      const identifier = resolveSpellClassIdentifier(spell) || UNKNOWN_CLASS_IDENTIFIER;
      ensureModel(identifier).spells.push(spell);
    }

    return [...models.values()]
      .map((model) => {
        const progression = model.item?.system?.spellcasting?.progression ?? "none";
        const ability = model.item?.system?.spellcasting?.ability ?? "";
        const preparation = model.item?.system?.spellcasting?.preparation ?? {};
        const favoriteCount = model.spells.filter((spell) => Boolean(spell.getFlag?.(MODULE_ID, "favorite"))).length;
        const preparedCount = model.spells.filter((spell) => getPreparedState(spell) > 0).length;
        return {
          ...model,
          progression,
          progressionLabel: describeSpellcastingProgression(progression),
          ability,
          abilityLabel: describeAbility(ability),
          levels: Number(model.item?.system?.levels ?? 0) || 0,
          preparation,
          favoriteCount,
          preparedCount,
          totalCount: model.spells.length
        };
      })
      .sort((left, right) => {
        if (left.identifier === UNKNOWN_CLASS_IDENTIFIER) return 1;
        if (right.identifier === UNKNOWN_CLASS_IDENTIFIER) return -1;
        return left.label.localeCompare(right.label, undefined, { sensitivity: "base" });
      });
  }

  _getSelectedClassModel() {
    const classes = this._buildClassModels();
    this._ensureValidSelection(classes);
    return classes.find((entry) => entry.identifier === this._state.selectedClassIdentifier) ?? null;
  }

  _getVisibleSpells(selectedClass = null) {
    const classModel = selectedClass ?? this._getSelectedClassModel();
    if (!classModel) return [];

    const search = this._state.search.trim().toLowerCase();
    return classModel.spells.filter((spell) => {
      if (this._state.favoritesOnly && !spell.getFlag?.(MODULE_ID, "favorite")) return false;
      if (this._state.preparedOnly && (getPreparedState(spell) <= 0)) return false;
      if (!search) return true;

      const folderLabel = String(spell.getFlag?.(MODULE_ID, "folderLabel") ?? "");
      const tags = Array.isArray(spell.getFlag?.(MODULE_ID, "tags")) ? spell.getFlag(MODULE_ID, "tags") : [];
      const haystack = [
        spell.name,
        describeSpellSchool(spell.system.school),
        folderLabel,
        ...tags
      ].join(" ").toLowerCase();
      return haystack.includes(search);
    });
  }

  _groupVisibleSpells(selectedClass = null) {
    const grouped = new Map();
    for (const spell of this._getVisibleSpells(selectedClass)) {
      const level = Number(spell?.system?.level ?? 0) || 0;
      if (!grouped.has(level)) grouped.set(level, []);
      grouped.get(level).push(spell);
    }

    return [...grouped.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([level, spells]) => ({
        level,
        label: describeSpellLevel(level),
        spells: spells.sort(sortSpells)
      }));
  }

  _getSelectedSpell(selectedClass = null) {
    const visibleSpells = this._getVisibleSpells(selectedClass);
    this._ensureValidSelection(undefined, visibleSpells);
    return visibleSpells.find((spell) => spell.id === this._state.selectedSpellId) ?? null;
  }

  _ensureValidSelection(classModels = undefined, visibleSpells = undefined) {
    const classes = classModels ?? this._buildClassModels();
    const currentClass = classes.find((entry) => entry.identifier === this._state.selectedClassIdentifier);
    if (!currentClass) {
      this._state.selectedClassIdentifier = classes[0]?.identifier ?? null;
    }

    // Empty-pool guard. With zero class models there's nothing to
    // validate, and the default branch below would call
    // `_getVisibleSpells(null)`, which falls back to
    // `_getSelectedClassModel()` — that re-enters this method through
    // `_ensureValidSelection(classes)` and loops until the stack
    // overflows. Short-circuit here so an actor with no spellcasting
    // classes (or none yet detected) just renders an empty manager.
    if (classes.length === 0) {
      this._state.selectedSpellId = null;
      return;
    }

    // Resolve the selected class model from the current identifier
    // (which `currentClass` may have just promoted from null to
    // `classes[0].identifier`). Pass it explicitly to
    // `_getVisibleSpells` so it has no reason to call back into
    // `_getSelectedClassModel` and re-trigger the recursion.
    const selectedClassModel = classes.find((entry) => entry.identifier === this._state.selectedClassIdentifier) ?? null;
    const spells = visibleSpells ?? this._getVisibleSpells(selectedClassModel);
    const currentSpell = spells.find((spell) => spell.id === this._state.selectedSpellId);
    if (!currentSpell) {
      this._state.selectedSpellId = spells[0]?.id ?? null;
    }
  }

  async _renderManager() {
    const classModels = this._buildClassModels();
    this._ensureValidSelection(classModels);
    const selectedClass = classModels.find((entry) => entry.identifier === this._state.selectedClassIdentifier) ?? null;
    const visibleSpells = this._getVisibleSpells(selectedClass);
    this._ensureValidSelection(classModels, visibleSpells);
    const selectedSpell = visibleSpells.find((spell) => spell.id === this._state.selectedSpellId) ?? null;

    this._renderClasses(classModels, selectedClass);
    this._renderToolbar(selectedClass);
    this._renderList(selectedClass, selectedSpell);
    this._renderActions(selectedSpell);
    this._renderSummary(selectedClass, visibleSpells);
    this._renderDetail(selectedSpell, selectedClass);
  }

  _renderClasses(classModels, selectedClass) {
    if (!this._classesRegion) return;

    if (!classModels.length) {
      this._classesRegion.innerHTML = `
        <div class="dauligor-spell-manager__section-title">Classes</div>
        <div class="dauligor-spell-manager__empty">This actor has no spellcasting classes or actor-owned spells yet.</div>
      `;
      return;
    }

    const buttons = classModels.map((entry) => `
      <button
        type="button"
        class="dauligor-spell-manager__class-button ${selectedClass?.identifier === entry.identifier ? "dauligor-spell-manager__class-button--active" : ""}"
        data-action="select-class"
        data-class-identifier="${escapeHtml(entry.identifier)}"
      >
        <span class="dauligor-spell-manager__class-label">${escapeHtml(entry.label)}</span>
        <span class="dauligor-spell-manager__class-meta">${entry.totalCount}</span>
      </button>
    `).join("");

    this._classesRegion.innerHTML = `
      <div class="dauligor-spell-manager__section-title">Classes</div>
      <div class="dauligor-spell-manager__class-list">${buttons}</div>
    `;

    this._classesRegion.querySelectorAll(`[data-action="select-class"]`).forEach((button) => {
      button.addEventListener("click", () => {
        this._state.selectedClassIdentifier = button.dataset.classIdentifier ?? null;
        this._state.selectedSpellId = null;
        this._renderManager();
      });
    });
  }

  _renderToolbar(selectedClass) {
    if (!this._toolbarRegion) return;

    this._toolbarRegion.innerHTML = `
      <div class="dauligor-spell-manager__toolbar">
        <div class="dauligor-spell-manager__toolbar-leading">
          <span class="dauligor-spell-manager__toolbar-label">${escapeHtml(selectedClass?.label ?? "Spells")}</span>
        </div>
        <input
          type="search"
          class="dauligor-spell-manager__input"
          data-action="search"
          placeholder="Search current actor spells..."
          value="${escapeHtml(this._state.search)}"
        >
        <button type="button" class="dauligor-spell-manager__button" data-action="filter">Filter</button>
        <button type="button" class="dauligor-spell-manager__button" data-action="reset">Reset</button>
      </div>
    `;

    this._toolbarRegion.querySelector(`[data-action="search"]`)?.addEventListener("input", (event) => {
      this._state.search = event.currentTarget.value ?? "";
      this._state.selectedSpellId = null;
      this._renderManager();
    });
    this._toolbarRegion.querySelector(`[data-action="filter"]`)?.addEventListener("click", async () => {
      const nextFilters = await promptForSpellFilters(this._state);
      if (!nextFilters) return;
      this._state.favoritesOnly = Boolean(nextFilters.favoritesOnly);
      this._state.preparedOnly = Boolean(nextFilters.preparedOnly);
      this._state.selectedSpellId = null;
      await this._renderManager();
    });
    this._toolbarRegion.querySelector(`[data-action="reset"]`)?.addEventListener("click", async () => {
      this._state.search = "";
      this._state.favoritesOnly = false;
      this._state.preparedOnly = false;
      this._state.selectedSpellId = null;
      await this._renderManager();
    });
  }

  _renderList(selectedClass, selectedSpell) {
    if (!this._listRegion) return;

    const grouped = this._groupVisibleSpells(selectedClass);
    if (!selectedClass) {
      this._listRegion.innerHTML = `<div class="dauligor-spell-manager__empty">Select a class to review spells.</div>`;
      return;
    }
    if (!grouped.length) {
      this._listRegion.innerHTML = `<div class="dauligor-spell-manager__empty">No current actor spells matched the active class and filters.</div>`;
      return;
    }

    const groupsHtml = grouped.map((group) => `
      <section class="dauligor-spell-manager__spell-group">
        <div class="dauligor-spell-manager__spell-group-title">${escapeHtml(group.label)}</div>
        <div class="dauligor-spell-manager__spell-group-list">
          ${group.spells.map((spell) => {
            const isSelected = selectedSpell?.id === spell.id;
            const badges = summarizeSpellBadges(spell);
            return `
              <button
                type="button"
                class="dauligor-spell-manager__spell-row ${isSelected ? "dauligor-spell-manager__spell-row--active" : ""}"
                data-action="select-spell"
                data-spell-id="${escapeHtml(spell.id)}"
              >
                <span class="dauligor-spell-manager__spell-name">${escapeHtml(spell.name)}</span>
                <span class="dauligor-spell-manager__spell-badges">
                  ${badges.map((badge) => `<span class="dauligor-spell-manager__badge">${escapeHtml(badge)}</span>`).join("")}
                </span>
              </button>
            `;
          }).join("")}
        </div>
      </section>
    `).join("");

    this._listRegion.innerHTML = `
      <div class="dauligor-spell-manager__list-shell">
        ${groupsHtml}
      </div>
    `;

    this._listRegion.querySelectorAll(`[data-action="select-spell"]`).forEach((button) => {
      button.addEventListener("click", async () => {
        this._state.selectedSpellId = button.dataset.spellId ?? null;
        await this._renderManager();
      });
    });
  }

  _renderDetail(selectedSpell, selectedClass) {
    if (!this._detailRegion) return;

    if (!selectedSpell) {
      this._detailRegion.innerHTML = `
        <div class="dauligor-spell-manager__section-title">Spell Information</div>
        <div class="dauligor-spell-manager__empty">Select a spell to inspect its current actor state.</div>
      `;
      return;
    }

    const description = String(selectedSpell?.system?.description?.value ?? "").trim();
    const folderLabel = String(selectedSpell.getFlag?.(MODULE_ID, "folderLabel") ?? "").trim();
    const tags = Array.isArray(selectedSpell.getFlag?.(MODULE_ID, "tags")) ? selectedSpell.getFlag(MODULE_ID, "tags") : [];
    const preparedState = getPreparedState(selectedSpell);
    const preparedLabel = preparedState >= 2 ? "Always Prepared" : (preparedState >= 1 ? "Prepared" : "Unprepared");
    const methodLabel = localizeConfigValue(CONFIG.DND5E.spellcasting?.[getSpellMethod(selectedSpell)]?.label ?? getSpellMethod(selectedSpell));
    const schoolLabel = describeSpellSchool(selectedSpell.system.school);
    const levelLabel = describeSpellLevel(Number(selectedSpell.system.level ?? 0) || 0);

    this._detailRegion.innerHTML = `
      <div class="dauligor-spell-manager__section-title">Spell Information</div>
      <div class="dauligor-spell-manager__detail-card">
        <div class="dauligor-spell-manager__detail-heading">${escapeHtml(selectedSpell.name)}</div>
        <div class="dauligor-spell-manager__detail-meta">
          <span>${escapeHtml(levelLabel)}</span>
          <span>${escapeHtml(schoolLabel)}</span>
          <span>${escapeHtml(methodLabel || "Spell")}</span>
        </div>
        <dl class="dauligor-spell-manager__detail-grid">
          <dt>Class</dt>
          <dd>${escapeHtml(selectedClass?.label ?? "Unknown")}</dd>
          <dt>Status</dt>
          <dd>${escapeHtml(preparedLabel)}</dd>
          <dt>Folder</dt>
          <dd>${escapeHtml(folderLabel || "None")}</dd>
          <dt>Tags</dt>
          <dd>${escapeHtml(tags.length ? tags.join(", ") : "None")}</dd>
        </dl>
        <div class="dauligor-spell-manager__detail-body">
          ${description || `<p class="dauligor-spell-manager__empty">No description is currently stored on this spell item.</p>`}
        </div>
      </div>
    `;
  }

  _renderSummary(selectedClass, visibleSpells) {
    if (!this._summaryRegion) return;

    if (!selectedClass) {
      this._summaryRegion.innerHTML = `
        <div class="dauligor-spell-manager__section-title">Spell List Information</div>
        <div class="dauligor-spell-manager__empty">Choose a class to review its actor-owned spells.</div>
      `;
      return;
    }

    const preparedVisible = visibleSpells.filter((spell) => getPreparedState(spell) > 0).length;
    const favoriteVisible = visibleSpells.filter((spell) => Boolean(spell.getFlag?.(MODULE_ID, "favorite"))).length;
    const folderCount = new Set(visibleSpells
      .map((spell) => String(spell.getFlag?.(MODULE_ID, "folderLabel") ?? "").trim())
      .filter(Boolean)).size;

    this._summaryRegion.innerHTML = `
      <div class="dauligor-spell-manager__section-title">Spell List Information</div>
      <div class="dauligor-spell-manager__summary-block">
        <div class="dauligor-spell-manager__summary-heading">${escapeHtml(selectedClass.label)}</div>
        <dl class="dauligor-spell-manager__summary-grid">
          <dt>Class Level</dt>
          <dd>${selectedClass.levels || 0}</dd>
          <dt>Progression</dt>
          <dd>${escapeHtml(selectedClass.progressionLabel || selectedClass.progression || "None")}</dd>
          <dt>Spellcasting Ability</dt>
          <dd>${escapeHtml(selectedClass.abilityLabel || "None")}</dd>
          <dt>Visible Spells</dt>
          <dd>${visibleSpells.length}</dd>
          <dt>Prepared</dt>
          <dd>${preparedVisible}</dd>
          <dt>Favorites</dt>
          <dd>${favoriteVisible}</dd>
          <dt>Folders</dt>
          <dd>${folderCount}</dd>
          <dt>Total Imported</dt>
          <dd>${selectedClass.totalCount}</dd>
        </dl>
        <p class="dauligor-spell-manager__summary-note">
          First pass: this window is reading the actor's current spell items only. Available-but-not-imported Dauligor class lists will be added later.
        </p>
      </div>
    `;
  }

  _renderActions(selectedSpell) {
    if (!this._actionsRegion) return;

    const favoriteLabel = selectedSpell?.getFlag?.(MODULE_ID, "favorite") ? "Unfavorite" : "Favorite";
    const preparedState = selectedSpell ? getPreparedState(selectedSpell) : 0;
    const prepareLabel = preparedState >= 1 ? "Unprepare" : "Prepare Spell";
    const folderLabel = String(selectedSpell?.getFlag?.(MODULE_ID, "folderLabel") ?? "").trim();
    const canPrepare = selectedSpell ? canPrepareSpell(selectedSpell) : false;
    const isAlwaysPrepared = preparedState >= 2;

    this._actionsRegion.innerHTML = `
      <div class="dauligor-spell-manager__section-title">Actions</div>
      <div class="dauligor-spell-manager__action-list">
        <button type="button" class="dauligor-spell-manager__button dauligor-spell-manager__button--wide" data-action="toggle-favorite" ${selectedSpell ? "" : "disabled"}>${favoriteLabel}</button>
        <button type="button" class="dauligor-spell-manager__button dauligor-spell-manager__button--wide" data-action="toggle-prepared" ${selectedSpell ? "" : "disabled"}>${prepareLabel}</button>
        <button type="button" class="dauligor-spell-manager__button dauligor-spell-manager__button--wide" data-action="assign-folder" ${selectedSpell ? "" : "disabled"}>${folderLabel ? "Change Folder" : "Assign Folder"}</button>
        <button type="button" class="dauligor-spell-manager__button dauligor-spell-manager__button--wide" data-action="clear-folder" ${(selectedSpell && folderLabel) ? "" : "disabled"}>Clear Folder</button>
        <button type="button" class="dauligor-spell-manager__button dauligor-spell-manager__button--wide" data-action="import-placeholder">Import From Lists</button>
        <button type="button" class="dauligor-spell-manager__button dauligor-spell-manager__button--wide" data-action="close-window">Close</button>
      </div>
      <div class="dauligor-spell-manager__action-hint">
        ${selectedSpell
          ? `${escapeHtml(selectedSpell.name)}${isAlwaysPrepared ? " is always prepared and cannot be toggled." : (canPrepare ? " can be prepared natively from this manager." : " is not a preparable spell under its current casting method.")}`
          : "Select a spell to favorite it, update its folder, or toggle its native prepared state."}
      </div>
    `;

    this._actionsRegion.querySelector(`[data-action="toggle-favorite"]`)?.addEventListener("click", async () => {
      await this._toggleFavorite(selectedSpell);
    });
    this._actionsRegion.querySelector(`[data-action="toggle-prepared"]`)?.addEventListener("click", async () => {
      await this._togglePrepared(selectedSpell);
    });
    this._actionsRegion.querySelector(`[data-action="assign-folder"]`)?.addEventListener("click", async () => {
      await this._assignFolder(selectedSpell);
    });
    this._actionsRegion.querySelector(`[data-action="clear-folder"]`)?.addEventListener("click", async () => {
      await this._clearFolder(selectedSpell);
    });
    this._actionsRegion.querySelector(`[data-action="import-placeholder"]`)?.addEventListener("click", () => {
      notifyWarn("Dauligor spell-list imports are not wired yet. This first pass only manages current actor spell items.");
    });
    this._actionsRegion.querySelector(`[data-action="close-window"]`)?.addEventListener("click", async () => {
      await this.close();
    });
  }

  async _toggleFavorite(spell) {
    if (!spell) return;
    const nextFavorite = !Boolean(spell.getFlag?.(MODULE_ID, "favorite"));
    const nextFlags = buildManagedSpellFlags(spell, { favorite: nextFavorite });
    await spell.update({ [`flags.${MODULE_ID}`]: nextFlags });
    notifyInfo(`${spell.name} ${nextFavorite ? "favorited" : "unfavorited"}.`);
    await this._renderManager();
  }

  async _togglePrepared(spell) {
    if (!spell) return;
    if (getPreparedState(spell) >= 2) {
      notifyWarn(`${spell.name} is always prepared and cannot be toggled.`);
      return;
    }
    if (!canPrepareSpell(spell)) {
      notifyWarn(`${spell.name} does not use a preparation method that can be toggled.`);
      return;
    }

    const nextPrepared = getPreparedState(spell) >= 1 ? 0 : 1;
    await spell.update({ "system.prepared": nextPrepared });
    notifyInfo(`${spell.name} ${nextPrepared ? "prepared" : "set to unprepared"}.`);
    await this._renderManager();
  }

  async _assignFolder(spell) {
    if (!spell) return;
    const currentLabel = String(spell.getFlag?.(MODULE_ID, "folderLabel") ?? "").trim();
    const folderLabel = await promptForText({
      title: `Spell Folder: ${spell.name}`,
      label: "Folder label",
      value: currentLabel,
      hint: "This is a Dauligor virtual folder label stored in spell flags."
    });
    if (folderLabel === null) return;

    const trimmed = folderLabel.trim();
    const nextFlags = buildManagedSpellFlags(spell, {
      folderLabel: trimmed,
      folderId: trimmed ? slugifyFilename(trimmed) : ""
    });
    await spell.update({ [`flags.${MODULE_ID}`]: nextFlags });
    notifyInfo(trimmed ? `${spell.name} assigned to ${trimmed}.` : `${spell.name} folder cleared.`);
    await this._renderManager();
  }

  async _clearFolder(spell) {
    if (!spell) return;
    const nextFlags = buildManagedSpellFlags(spell, { folderLabel: "", folderId: "" });
    await spell.update({ [`flags.${MODULE_ID}`]: nextFlags });
    notifyInfo(`${spell.name} folder cleared.`);
    await this._renderManager();
  }
}
