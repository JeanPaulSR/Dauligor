// =============================================================================
// Dauligor Feature Manager
// =============================================================================
//
// Sheet-launched manager window for reviewing and updating choice-based
// elements an actor accumulated through the importer. Designed as a
// single front door so the player can:
//
//   - On long rest, swap pact-of-the-blade weapon, prepared metamagic
//     options, or any other group flagged "swappable while resting".
//   - On level up, perform the deeper swaps the importer's level-up
//     wizard already handles (ItemChoice replaces semantics, retraining
//     skill picks, etc.) — this manager is the entry button and will
//     route into the existing importer flow.
//
// Phase 1 (this file) scaffolds the window with three tabs:
//   1. Features  — fully wired to read the actor's classOption items
//                  and group them by source option-group.
//   2. Spells    — coming-soon placeholder. Eventually a higher-level
//                  spell preparation companion that ties prepared/known
//                  spell counts to class advancements.
//   3. Feats     — coming-soon placeholder. Eventually surfaces
//                  ability-score-improvement feat picks for retraining
//                  during level-up.
//
// The "scope" prop ("long-rest" | "level-up") controls which actions
// are exposed on each row. Phase 1 disables Change buttons everywhere
// and just shows the current state — wiring the swap flow is a
// follow-up that depends on ItemChoice `replaces` support in the
// importer (tracked separately in TODO.md).
// =============================================================================

import { FEATURE_MANAGER_TEMPLATE, MODULE_ID } from "./constants.js";
import { log, notifyWarn } from "./utils.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const SCOPE_LONG_REST = "long-rest";
const SCOPE_LEVEL_UP = "level-up";

const TAB_FEATURES = "features";
const TAB_SPELLS = "spells";
const TAB_FEATS = "feats";

const TAB_ORDER = [TAB_FEATURES, TAB_SPELLS, TAB_FEATS];

// ─── helpers ────────────────────────────────────────────────────────────

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

function escapeHtml(value) {
  return foundry.utils.escapeHTML(String(value ?? ""));
}

function resolveActorDocument(actorLike) {
  if (!actorLike) return null;
  if (actorLike.documentName === "Actor") return actorLike;
  if (actorLike.document?.documentName === "Actor") return actorLike.document;
  if (actorLike.actor?.documentName === "Actor") return actorLike.actor;
  return null;
}

function classLabelForActor(actor, classSourceId) {
  if (!classSourceId) return "";
  const classItem = actor.items.find((it) => it.type === "class"
    && it.getFlag?.(MODULE_ID, "sourceId") === classSourceId);
  return classItem?.name ?? "";
}

function resolveOptionGroupLabel(flags, fallback) {
  // `featureTypeLabel` is stamped onto every classOption by
  // createSemanticOptionItem in class-import-service.js — that's the
  // human-readable group name (e.g. "Eldritch Invocation").
  if (flags.featureTypeLabel) return String(flags.featureTypeLabel);
  if (flags.featureTypeSubtype) return String(flags.featureTypeSubtype);
  return fallback;
}

/**
 * Walks an actor's items and groups every classOption pick by its
 * source option-group. Returns an array of groups sorted by class →
 * group-label so the same screen for a multiclass character renders
 * predictably.
 *
 * Each group entry is shaped:
 *   {
 *     groupSourceId,   // canonical group identifier from the bundle
 *     groupLabel,      // friendly name (uses featureTypeLabel flag)
 *     classSourceId,   // owning class sourceId
 *     className,       // owning class display name
 *     items: [{ itemId, name, img, sourceId, description, featureSourceId }]
 *   }
 */
function buildOptionGroupInventory(actor) {
  const groupsBySourceId = new Map();

  for (const item of actor.items) {
    if (item.type !== "feat") continue;
    const flags = item.flags?.[MODULE_ID] ?? {};
    if (flags.sourceType !== "classOption") continue;

    const groupSourceId = String(flags.groupSourceId ?? "").trim() || "__ungrouped__";
    let bucket = groupsBySourceId.get(groupSourceId);
    if (!bucket) {
      bucket = {
        groupSourceId,
        groupLabel: resolveOptionGroupLabel(flags, "Class Option"),
        classSourceId: flags.classSourceId ?? null,
        className: classLabelForActor(actor, flags.classSourceId),
        items: []
      };
      groupsBySourceId.set(groupSourceId, bucket);
    }

    bucket.items.push({
      itemId: item.id,
      name: item.name ?? "Option",
      img: item.img ?? "icons/svg/upgrade.svg",
      sourceId: flags.sourceId ?? null,
      featureSourceId: flags.featureSourceId ?? null,
      description: item.system?.description?.value ?? ""
    });
  }

  const groups = [...groupsBySourceId.values()];
  groups.sort((a, b) => {
    const classCmp = String(a.className ?? "").localeCompare(String(b.className ?? ""));
    if (classCmp !== 0) return classCmp;
    return String(a.groupLabel).localeCompare(String(b.groupLabel));
  });
  for (const group of groups) {
    group.items.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }
  return groups;
}

// ─── main app ──────────────────────────────────────────────────────────

export class DauligorFeatureManagerApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static _instance = null;

  static open({ actor = null, scope = SCOPE_LONG_REST } = {}) {
    const actorDoc = resolveActorDocument(actor);
    if (!actorDoc) {
      notifyWarn("Open the Feature Manager from a character actor sheet.");
      return null;
    }
    if (actorDoc.type !== "character") {
      notifyWarn("The Feature Manager is only available on character actors.");
      return null;
    }

    if (this._instance) {
      this._instance.setActor(actorDoc);
      this._instance.setScope(scope);
      this._instance.render({ force: true });
      this._instance.maximize?.();
      return this._instance;
    }

    const instance = new this({ actor: actorDoc, scope });
    this._instance = instance;
    instance.render({ force: true });
    return instance;
  }

  constructor({ actor = null, scope = SCOPE_LONG_REST } = {}) {
    const normalizedScope = scope === SCOPE_LEVEL_UP ? SCOPE_LEVEL_UP : SCOPE_LONG_REST;
    super({
      id: `${MODULE_ID}-feature-manager`,
      classes: ["dauligor-importer-app", "dauligor-feature-manager-app"],
      window: {
        title: actor ? `Feature Manager: ${actor.name}` : "Feature Manager",
        resizable: true,
        contentClasses: ["dauligor-importer-window"]
      },
      position: centeredAppPosition(
        Math.min(window.innerWidth - 120, 960),
        Math.min(window.innerHeight - 120, 720)
      )
    });

    this._template = FEATURE_MANAGER_TEMPLATE;
    this._actor = actor;
    this._state = {
      scope: normalizedScope,
      activeTab: TAB_FEATURES
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
    if (DauligorFeatureManagerApp._instance === this) DauligorFeatureManagerApp._instance = null;
    return super.close(options);
  }

  setActor(actor) {
    const actorDoc = resolveActorDocument(actor);
    if (!actorDoc) return;
    this._actor = actorDoc;
    this.options.window.title = `Feature Manager: ${actorDoc.name}`;
  }

  setScope(scope) {
    if (scope !== SCOPE_LONG_REST && scope !== SCOPE_LEVEL_UP) return;
    this._state.scope = scope;
  }

  async _onRender() {
    super._onRender?.(...arguments);

    const root = this._getRootElement();
    if (!root) return;

    const content = root.querySelector(".window-content") ?? root;
    this._headerRegion = content.querySelector(`[data-region="header"]`);
    this._tabsRegion = content.querySelector(`[data-region="tabs"]`);
    this._bodyRegion = content.querySelector(`[data-region="body"]`);
    this._footerRegion = content.querySelector(`[data-region="footer"]`);

    this._renderHeader();
    this._renderTabs();
    this._renderBody();
    this._renderFooter();
  }

  _getRootElement() {
    if (this.element instanceof HTMLElement) return this.element;
    if (this.element?.jquery && this.element[0] instanceof HTMLElement) return this.element[0];
    if (this.element?.[0] instanceof HTMLElement) return this.element[0];
    return document.getElementById(this.id) ?? null;
  }

  // ─── render passes ─────────────────────────────────────────────────────

  _renderHeader() {
    if (!this._headerRegion) return;
    const actorName = this._actor?.name ?? "Actor";
    const scopeLabel = this._state.scope === SCOPE_LEVEL_UP ? "Level Up" : "Long Rest";
    const otherScope = this._state.scope === SCOPE_LEVEL_UP ? SCOPE_LONG_REST : SCOPE_LEVEL_UP;
    const otherLabel = otherScope === SCOPE_LEVEL_UP ? "Level Up" : "Long Rest";

    this._headerRegion.innerHTML = `
      <div class="dauligor-feature-manager__title">
        <h2>${escapeHtml(actorName)}</h2>
        <p class="dauligor-feature-manager__subtitle">Manage choices granted by classes, features, and (soon) spells.</p>
      </div>
      <div class="dauligor-feature-manager__scope">
        <span class="dauligor-feature-manager__scope-label">Scope</span>
        <button type="button" class="dauligor-feature-manager__scope-toggle" data-target-scope="${escapeHtml(otherScope)}">
          <span class="dauligor-feature-manager__scope-current">${escapeHtml(scopeLabel)}</span>
          <i class="fas fa-arrows-rotate"></i>
          <span class="dauligor-feature-manager__scope-other">${escapeHtml(otherLabel)}</span>
        </button>
      </div>
    `;

    this._headerRegion.querySelector(".dauligor-feature-manager__scope-toggle")
      ?.addEventListener("click", (event) => {
        event.preventDefault();
        const next = event.currentTarget?.dataset?.targetScope;
        this.setScope(next);
        this.render({ force: false });
      });
  }

  _renderTabs() {
    if (!this._tabsRegion) return;
    const inventory = buildOptionGroupInventory(this._actor);
    const tabDefs = [
      { id: TAB_FEATURES, label: "Features", icon: "fas fa-star",          count: inventory.length, comingSoon: false },
      { id: TAB_SPELLS,   label: "Spells",   icon: "fas fa-wand-sparkles", count: 0,                comingSoon: true },
      { id: TAB_FEATS,    label: "Feats",    icon: "fas fa-medal",         count: 0,                comingSoon: true }
    ];

    this._tabsRegion.innerHTML = tabDefs.map((tab) => `
      <button type="button"
              class="dauligor-feature-manager__tab${tab.id === this._state.activeTab ? " is-active" : ""}${tab.comingSoon ? " is-coming-soon" : ""}"
              data-target-tab="${escapeHtml(tab.id)}"
              ${tab.comingSoon ? `title="Coming soon"` : ""}>
        <i class="${escapeHtml(tab.icon)}"></i>
        <span class="dauligor-feature-manager__tab-label">${escapeHtml(tab.label)}</span>
        ${tab.count ? `<span class="dauligor-feature-manager__tab-count">${tab.count}</span>` : ""}
        ${tab.comingSoon ? `<span class="dauligor-feature-manager__tab-soon">soon</span>` : ""}
      </button>
    `).join("");

    for (const button of this._tabsRegion.querySelectorAll(".dauligor-feature-manager__tab")) {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        const next = event.currentTarget?.dataset?.targetTab;
        if (!next || !TAB_ORDER.includes(next)) return;
        this._state.activeTab = next;
        this.render({ force: false });
      });
    }
  }

  _renderBody() {
    if (!this._bodyRegion) return;
    switch (this._state.activeTab) {
      case TAB_FEATURES: return this._renderFeaturesTab();
      case TAB_SPELLS:   return this._renderComingSoonTab({
        title: "Spell Manager",
        message: "Future home for spell ownership across classes — prepared/known toggles, ritual access, and class-specific spell-list overrides.",
        hint: "For now, use the existing Prepare Spells tool from the actor sheet's Spells tab."
      });
      case TAB_FEATS:    return this._renderComingSoonTab({
        title: "Feat Manager",
        message: "Future home for feat picks granted by Ability Score Improvement advancements — review which feat was taken at each ASI slot and retrain on level up.",
        hint: "Feats granted by the importer already live on the sheet under Features → Feat."
      });
      default:
        this._bodyRegion.innerHTML = "";
    }
  }

  _renderFeaturesTab() {
    const inventory = buildOptionGroupInventory(this._actor);

    if (!inventory.length) {
      this._bodyRegion.innerHTML = `
        <div class="dauligor-feature-manager__empty">
          <i class="fas fa-circle-info"></i>
          <p>No class option selections found on this actor.</p>
          <p class="dauligor-feature-manager__empty-hint">Import a class with option groups (e.g. Warlock invocations, Sorcerer metamagic, Fighter maneuvers), then return here to manage the picks.</p>
        </div>
      `;
      return;
    }

    const scope = this._state.scope;
    const groupHtml = inventory.map((group) => this._renderGroupSection(group, scope)).join("");
    this._bodyRegion.innerHTML = `
      <div class="dauligor-feature-manager__groups">
        ${groupHtml}
      </div>
    `;

    // Wire Change buttons. They're disabled in phase 1 — clicking
    // surfaces an informational toast instead of routing through the
    // importer, until ItemChoice replaces semantics ship.
    for (const button of this._bodyRegion.querySelectorAll(`[data-action="change-group"]`)) {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        const groupSourceId = event.currentTarget?.dataset?.groupSourceId;
        this._handleChangeRequest(groupSourceId);
      });
    }
  }

  _renderGroupSection(group, scope) {
    const classBadge = group.className
      ? `<span class="dauligor-feature-manager__badge">${escapeHtml(group.className)}</span>`
      : "";
    const itemsHtml = group.items.map((item) => `
      <li class="dauligor-feature-manager__row">
        <img src="${escapeHtml(item.img)}" alt="" class="dauligor-feature-manager__row-icon" />
        <span class="dauligor-feature-manager__row-name">${escapeHtml(item.name)}</span>
      </li>
    `).join("");

    const changeLabel = scope === SCOPE_LEVEL_UP ? "Change on Level Up" : "Swap on Long Rest";
    const changeTitle = scope === SCOPE_LEVEL_UP
      ? "Will route to the importer's level-up flow once ItemChoice replaces semantics are wired."
      : "Will let the player swap a selection without re-running the full importer.";

    return `
      <section class="dauligor-feature-manager__group">
        <header class="dauligor-feature-manager__group-header">
          <div class="dauligor-feature-manager__group-title">
            <h3>${escapeHtml(group.groupLabel)}</h3>
            ${classBadge}
            <span class="dauligor-feature-manager__group-count">${group.items.length}</span>
          </div>
          <button type="button"
                  class="dauligor-feature-manager__change"
                  data-action="change-group"
                  data-group-source-id="${escapeHtml(group.groupSourceId)}"
                  disabled
                  title="${escapeHtml(changeTitle)}">
            <i class="fas fa-arrow-right-arrow-left"></i>
            ${escapeHtml(changeLabel)}
          </button>
        </header>
        <ul class="dauligor-feature-manager__rows">
          ${itemsHtml}
        </ul>
      </section>
    `;
  }

  _renderComingSoonTab({ title, message, hint }) {
    this._bodyRegion.innerHTML = `
      <div class="dauligor-feature-manager__coming-soon">
        <i class="fas fa-hammer"></i>
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(message)}</p>
        <p class="dauligor-feature-manager__coming-soon-hint">${escapeHtml(hint)}</p>
      </div>
    `;
  }

  _renderFooter() {
    if (!this._footerRegion) return;
    const scopeText = this._state.scope === SCOPE_LEVEL_UP
      ? "Level-up scope previews choices the importer's level-up wizard can change."
      : "Long-rest scope is reserved for daily-swappable picks — feature wiring lands in a follow-up.";
    this._footerRegion.innerHTML = `
      <p class="dauligor-feature-manager__footnote">${escapeHtml(scopeText)}</p>
    `;
  }

  _handleChangeRequest(groupSourceId) {
    log("Change requested for group", { groupSourceId, scope: this._state.scope });
    notifyWarn(`Change flow for "${groupSourceId}" is not wired yet — coming once ItemChoice replaces lands.`);
  }
}

export function openFeatureManager(actorLike, options = {}) {
  return DauligorFeatureManagerApp.open({ actor: actorLike, ...options });
}
