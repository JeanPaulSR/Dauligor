// =============================================================================
// Dauligor Feature Manager — Queue Model
// =============================================================================
//
// One front door on the character sheet for every choice-based element a
// player might want to retune between sessions. The manager does NOT apply
// changes immediately: changes are *queued* and only commit when the right
// trigger fires:
//
//   - dnd5e.restCompleted (long rest) → applies LONG_REST scope entries.
//   - level-up wizard commit          → applies LEVEL_UP scope entries.
//
// This lets a player browse the manager mid-session (during another
// player's RP turn, in between combat rounds, etc.) and "set" their next
// choice without disturbing live game state. The change isn't real until
// the appropriate moment.
//
// Tabs are categorical and each carries a fixed scope:
//
//   ┌──────────── LONG REST ────────────┐  ┌──── LEVEL UP ────┐
//   │ Features │ Spells │ Crafting       │  │ Feats │ Advancement
//   └────────────────────────────────────┘  └──────────────────┘
//
//   - Features    — class & subclass feature option-group picks
//                   (Invocations, Metamagic, Maneuvers, Pact, etc.)
//   - Spells      — prepared/known spell ownership (placeholder; will
//                   eventually subsume the Prepare Spells manager)
//   - Crafting    — downtime project tracking (placeholder)
//   - Feats       — ASI-slot feat picks (placeholder)
//   - Advancement — class entry, subclass entry, base proficiencies
//                   (placeholder; routes into the Level Up wizard)
//
// Queue storage lives on the actor:
//   flags.dauligor-pairing.featureManagerQueue = {
//     longRest: { entries: [QueueEntry, ...] },
//     levelUp:  { entries: [QueueEntry, ...] }
//   }
//
// QueueEntry shape (extensible — kind-specific fields layered on):
//   { id, kind, queuedAt, scope, ...kindSpecificPayload }
//
// Phase 1 (this file) ships:
//   - the 5-tab restructure and per-tab scope visible on each tab
//   - queue read/write helpers + queued-state rendering on Features
//   - a "Queue Change" stub that drops a placeholder entry into the
//     queue so the wire-up is real but the change picker UI is TODO
//   - footer queue counters per scope, with a "Discard queue" action
//
// Deferred to later commits:
//   - the actual change-picker UI (depends on ItemChoice replaces work)
//   - rest-trigger and level-up-trigger commit handlers
//   - Crafting / Spells / Feats / Advancement tab content
// =============================================================================

import { FEATURE_MANAGER_TEMPLATE, MODULE_ID } from "./constants.js";
import { log, notifyInfo, notifyWarn } from "./utils.js";
import { DauligorSpellPreparationApp } from "./spell-preparation-app.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

// ─── scope + tab constants ──────────────────────────────────────────────

const SCOPE_LONG_REST = "long-rest";
const SCOPE_LEVEL_UP = "level-up";

const TAB_OVERVIEW = "overview";
const TAB_FEATURES = "features";
const TAB_SPELLS = "spells";
const TAB_CRAFTING = "crafting";
const TAB_FEATS = "feats";
const TAB_ADVANCEMENT = "advancement";

const TAB_DEFS = [
  // Overview is the master landing tab — lists every queued change
  // across both scopes (long-rest + level-up). The long-rest hook
  // opens the FM to this tab so the user sees the queue summary
  // first; the dedicated per-category tabs (Features/Spells/etc.)
  // are still reachable via the tab strip.
  { id: TAB_OVERVIEW,    label: "Overview",    icon: "fas fa-list-check",    scope: null,            placeholder: false },
  { id: TAB_FEATURES,    label: "Features",    icon: "fas fa-star",          scope: SCOPE_LONG_REST, placeholder: false },
  { id: TAB_SPELLS,      label: "Spells",      icon: "fas fa-wand-sparkles", scope: SCOPE_LONG_REST, placeholder: false },
  { id: TAB_CRAFTING,    label: "Crafting",    icon: "fas fa-hammer",        scope: SCOPE_LONG_REST, placeholder: true  },
  { id: TAB_FEATS,       label: "Feats",       icon: "fas fa-medal",         scope: SCOPE_LEVEL_UP,  placeholder: true  },
  { id: TAB_ADVANCEMENT, label: "Advancement", icon: "fas fa-circle-up",     scope: SCOPE_LEVEL_UP,  placeholder: true  }
];

const TAB_IDS = TAB_DEFS.map((t) => t.id);

// ─── queue storage helpers ──────────────────────────────────────────────

const QUEUE_FLAG_KEY = "featureManagerQueue";

function emptyQueue() {
  return { longRest: { entries: [] }, levelUp: { entries: [] } };
}

function normalizeQueue(raw) {
  const base = emptyQueue();
  if (!raw || typeof raw !== "object") return base;
  base.longRest.entries = Array.isArray(raw?.longRest?.entries) ? [...raw.longRest.entries] : [];
  base.levelUp.entries = Array.isArray(raw?.levelUp?.entries) ? [...raw.levelUp.entries] : [];
  return base;
}

function getQueue(actor) {
  return normalizeQueue(actor?.getFlag?.(MODULE_ID, QUEUE_FLAG_KEY));
}

async function setQueue(actor, queue) {
  if (!actor?.setFlag) return null;
  return actor.setFlag(MODULE_ID, QUEUE_FLAG_KEY, queue);
}

function scopeBucket(queue, scope) {
  return scope === SCOPE_LEVEL_UP ? queue.levelUp : queue.longRest;
}

async function addQueueEntry(actor, scope, entry) {
  const queue = getQueue(actor);
  const bucket = scopeBucket(queue, scope);
  bucket.entries.push({
    id: foundry.utils.randomID(),
    queuedAt: Date.now(),
    scope,
    ...entry
  });
  return setQueue(actor, queue);
}

async function removeQueueEntry(actor, scope, entryId) {
  const queue = getQueue(actor);
  const bucket = scopeBucket(queue, scope);
  bucket.entries = bucket.entries.filter((e) => e.id !== entryId);
  return setQueue(actor, queue);
}

async function clearScope(actor, scope) {
  const queue = getQueue(actor);
  scopeBucket(queue, scope).entries = [];
  return setQueue(actor, queue);
}

// ─── tiny utilities ─────────────────────────────────────────────────────

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

function scopeLabel(scope) {
  return scope === SCOPE_LEVEL_UP ? "Level Up" : "Long Rest";
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

  static open({ actor = null, tab = TAB_OVERVIEW, scope = null } = {}) {
    const actorDoc = resolveActorDocument(actor);
    if (!actorDoc) {
      notifyWarn("Open the Feature Manager from a character actor sheet.");
      return null;
    }
    if (actorDoc.type !== "character") {
      notifyWarn("The Feature Manager is only available on character actors.");
      return null;
    }

    // Back-compat: callers may pass `scope: "long-rest" | "level-up"`,
    // which used to route to the first concrete tab in that scope.
    // After the May 2026 revision, both scopes land on the Overview
    // master tab — the scope argument is ignored (kept in the API
    // signature so older call sites don't break).
    let resolvedTab = TAB_IDS.includes(tab) ? tab : TAB_OVERVIEW;
    void scope; // suppress "unused var" lint while keeping the API stable

    if (this._instance) {
      this._instance.setActor(actorDoc);
      this._instance._state.activeTab = resolvedTab;
      this._instance.render({ force: true });
      this._instance.maximize?.();
      return this._instance;
    }

    const instance = new this({ actor: actorDoc, tab: resolvedTab });
    this._instance = instance;
    instance.render({ force: true });
    return instance;
  }

  constructor({ actor = null, tab = TAB_OVERVIEW } = {}) {
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
      activeTab: TAB_IDS.includes(tab) ? tab : TAB_OVERVIEW
    };
  }

  _configureRenderParts() {
    return { main: { template: this._template } };
  }

  async close(options) {
    // Tear down the embedded Spells manager (if any) so its region
    // refs don't leak into the next open. The standalone Prepare
    // Spells window is unaffected (different instance).
    if (this._embeddedSpellManager) {
      try { this._embeddedSpellManager.destroyEmbedded(); } catch { /* noop */ }
      this._embeddedSpellManager = null;
    }
    if (DauligorFeatureManagerApp._instance === this) DauligorFeatureManagerApp._instance = null;
    return super.close(options);
  }

  setActor(actor) {
    const actorDoc = resolveActorDocument(actor);
    if (!actorDoc) return;
    this._actor = actorDoc;
    this.options.window.title = `Feature Manager: ${actorDoc.name}`;
  }

  get activeTab() {
    return TAB_DEFS.find((t) => t.id === this._state.activeTab) ?? TAB_DEFS[0];
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
    this._headerRegion.innerHTML = `
      <div class="dauligor-feature-manager__title">
        <h2>${escapeHtml(actorName)}</h2>
        <p class="dauligor-feature-manager__subtitle">Spell changes apply immediately and post to chat as an audit trail. Advancement picks queue up here and commit at the next long rest or level up.</p>
      </div>
    `;
  }

  _renderTabs() {
    if (!this._tabsRegion) return;
    const inventory = buildOptionGroupInventory(this._actor);
    const queue = getQueue(this._actor);

    const totalQueued = queue.longRest.entries.length + queue.levelUp.entries.length;

    const tabs = TAB_DEFS.map((def) => {
      let count = 0;
      if (def.id === TAB_FEATURES) count = inventory.length;
      // Overview tab badge shows total queue size across both scopes
      // so the user has an at-a-glance signal that pending work
      // exists. Counts of 0 are hidden by the template below.
      if (def.id === TAB_OVERVIEW) count = totalQueued;
      return { ...def, count };
    });

    this._tabsRegion.innerHTML = tabs.map((tab) => {
      // Scope chip: Overview tab is scope-agnostic (master view) so
      // we render a neutral chip label "All" instead of one of the
      // scope colours. Other tabs keep their existing scope classes.
      const isMaster = tab.id === TAB_OVERVIEW;
      const scopeClass = isMaster
        ? "dauligor-feature-manager__tab-scope--master"
        : (tab.scope === SCOPE_LEVEL_UP
          ? "dauligor-feature-manager__tab-scope--level-up"
          : "dauligor-feature-manager__tab-scope--long-rest");
      const scopeText = isMaster ? "All" : scopeLabel(tab.scope);
      return `
        <button type="button"
                class="dauligor-feature-manager__tab${tab.id === this._state.activeTab ? " is-active" : ""}${tab.placeholder ? " is-coming-soon" : ""}"
                data-target-tab="${escapeHtml(tab.id)}"
                ${tab.placeholder ? `title="Tab content not built yet — scope and structure are in place"` : ""}>
          <div class="dauligor-feature-manager__tab-main">
            <i class="${escapeHtml(tab.icon)}"></i>
            <span class="dauligor-feature-manager__tab-label">${escapeHtml(tab.label)}</span>
            ${tab.count ? `<span class="dauligor-feature-manager__tab-count">${tab.count}</span>` : ""}
          </div>
          <span class="dauligor-feature-manager__tab-scope ${scopeClass}">${escapeHtml(scopeText)}</span>
        </button>
      `;
    }).join("");

    for (const button of this._tabsRegion.querySelectorAll(".dauligor-feature-manager__tab")) {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        const next = event.currentTarget?.dataset?.targetTab;
        if (!next || !TAB_IDS.includes(next)) return;
        this._state.activeTab = next;
        this.render({ force: false });
      });
    }
  }

  _renderBody() {
    if (!this._bodyRegion) return;
    // Always tear down any previously embedded Spells manager before
    // switching tabs / re-rendering — otherwise stale region
    // references from a prior mount would point at detached DOM.
    if (this._embeddedSpellManager) {
      try { this._embeddedSpellManager.destroyEmbedded(); } catch { /* noop */ }
      this._embeddedSpellManager = null;
    }
    switch (this._state.activeTab) {
      case TAB_OVERVIEW:    return this._renderOverviewTab();
      case TAB_FEATURES:    return this._renderFeaturesTab();
      case TAB_SPELLS:      return this._renderSpellsTab();
      case TAB_CRAFTING:    return this._renderPlaceholderTab({
        title: "Crafting Projects",
        message: "Track downtime crafting projects — current progress, materials, days remaining. Queue progress increments between sessions so a downtime week resolves in one commit.",
        hint: "Storage hook will piggyback on the same long-rest commit path."
      });
      case TAB_FEATS:       return this._renderPlaceholderTab({
        title: "Feat Picks",
        message: "Surfaces every Ability Score Improvement slot that resolved to a feat. Queue a retrain here and the swap will commit during the next level-up wizard run.",
        hint: "Requires the ItemChoice `replaces` semantics work that's already on the backlog."
      });
      case TAB_ADVANCEMENT: return this._renderPlaceholderTab({
        title: "Class Advancement",
        message: "Queue class entry, subclass entry, and base-proficiency choices ahead of a level up. The Dauligor Level Up wizard will see the queue and pre-fill the relevant prompts.",
        hint: "Integrates with the existing importer level-up flow."
      });
      default:
        this._bodyRegion.innerHTML = "";
    }
  }

  _renderFeaturesTab() {
    const inventory = buildOptionGroupInventory(this._actor);
    const queue = getQueue(this._actor);
    const longRestEntries = queue.longRest.entries.filter((e) => e.kind === "optionItem");

    if (!inventory.length && !longRestEntries.length) {
      this._bodyRegion.innerHTML = `
        <div class="dauligor-feature-manager__empty">
          <i class="fas fa-circle-info"></i>
          <p>No class option selections found on this actor.</p>
          <p class="dauligor-feature-manager__empty-hint">Import a class with option groups (e.g. Warlock invocations, Sorcerer metamagic, Fighter maneuvers), then return here to manage the picks.</p>
        </div>
      `;
      return;
    }

    // Build a quick lookup: groupSourceId → array of queued entries
    const queuedByGroup = new Map();
    for (const entry of longRestEntries) {
      const key = entry.groupSourceId ?? "__ungrouped__";
      if (!queuedByGroup.has(key)) queuedByGroup.set(key, []);
      queuedByGroup.get(key).push(entry);
    }

    const groupHtml = inventory
      .map((group) => this._renderGroupSection(group, queuedByGroup.get(group.groupSourceId) ?? []))
      .join("");

    this._bodyRegion.innerHTML = `
      <div class="dauligor-feature-manager__groups">
        ${groupHtml}
      </div>
    `;

    // Wire Queue Change buttons.
    for (const button of this._bodyRegion.querySelectorAll(`[data-action="queue-change"]`)) {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        const groupSourceId = event.currentTarget?.dataset?.groupSourceId;
        const groupLabel = event.currentTarget?.dataset?.groupLabel ?? "Class Option";
        await this._handleQueueOptionItemChange(groupSourceId, groupLabel);
      });
    }

    // Wire per-entry "Remove from queue" buttons.
    for (const button of this._bodyRegion.querySelectorAll(`[data-action="remove-queue-entry"]`)) {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        const entryId = event.currentTarget?.dataset?.entryId;
        if (!entryId) return;
        await removeQueueEntry(this._actor, SCOPE_LONG_REST, entryId);
        this.render({ force: false });
      });
    }
  }

  _renderGroupSection(group, queuedEntries) {
    const classBadge = group.className
      ? `<span class="dauligor-feature-manager__badge">${escapeHtml(group.className)}</span>`
      : "";

    const itemsHtml = group.items.map((item) => `
      <li class="dauligor-feature-manager__row">
        <img src="${escapeHtml(item.img)}" alt="" class="dauligor-feature-manager__row-icon" />
        <span class="dauligor-feature-manager__row-name">${escapeHtml(item.name)}</span>
      </li>
    `).join("");

    const queuedHtml = queuedEntries.length
      ? `
        <div class="dauligor-feature-manager__queued">
          <div class="dauligor-feature-manager__queued-label">
            <i class="fas fa-clock"></i>
            Queued for next long rest
          </div>
          <ul class="dauligor-feature-manager__queued-rows">
            ${queuedEntries.map((entry) => `
              <li class="dauligor-feature-manager__queued-row">
                <span class="dauligor-feature-manager__queued-change">
                  <span class="dauligor-feature-manager__queued-from">${escapeHtml(entry.fromName ?? "?")}</span>
                  <i class="fas fa-arrow-right"></i>
                  <span class="dauligor-feature-manager__queued-to">${escapeHtml(entry.toName ?? "(picker TBD)")}</span>
                </span>
                <button type="button"
                        class="dauligor-feature-manager__queued-remove"
                        data-action="remove-queue-entry"
                        data-entry-id="${escapeHtml(entry.id)}"
                        title="Remove this queued change">
                  <i class="fas fa-xmark"></i>
                </button>
              </li>
            `).join("")}
          </ul>
        </div>
      `
      : "";

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
                  data-action="queue-change"
                  data-group-source-id="${escapeHtml(group.groupSourceId)}"
                  data-group-label="${escapeHtml(group.groupLabel)}"
                  title="Queue a swap for this group — commits at the next long rest.">
            <i class="fas fa-plus"></i>
            Queue Change
          </button>
        </header>
        <ul class="dauligor-feature-manager__rows">
          ${itemsHtml}
        </ul>
        ${queuedHtml}
      </section>
    `;
  }

  _renderPlaceholderTab({ title, message, hint }) {
    this._bodyRegion.innerHTML = `
      <div class="dauligor-feature-manager__coming-soon">
        <i class="fas fa-hammer"></i>
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(message)}</p>
        <p class="dauligor-feature-manager__coming-soon-hint">${escapeHtml(hint)}</p>
      </div>
    `;
  }

  /**
   * Overview tab — the master landing view. Shows every queued
   * advancement across both scopes (long-rest + level-up) grouped
   * by scope. The long-rest hook in main.js opens the FM to this
   * tab so the user sees the queue first.
   *
   * As of May 2026, spell-prep changes do NOT queue — the FM-embedded
   * Prepare Spells mount applies changes immediately. So the queue
   * here is exclusively for advancement-style picks (Phase 1 ships
   * placeholder Features entries; Phase 2 will add real picker UI
   * for ASI / feat / class / subclass / proficiency choices).
   */
  _renderOverviewTab() {
    const queue = getQueue(this._actor);
    const longRestEntries = queue.longRest.entries;
    const levelUpEntries = queue.levelUp.entries;
    const total = longRestEntries.length + levelUpEntries.length;

    if (total === 0) {
      this._bodyRegion.innerHTML = `
        <div class="dauligor-feature-manager__overview-empty">
          <i class="fas fa-circle-check"></i>
          <h3>No queued advancements</h3>
          <p>Queued changes from the other tabs will show up here. Spell prep changes apply immediately and don't queue — they post to chat as an audit trail.</p>
        </div>
      `;
      return;
    }

    const renderEntry = (entry) => {
      // Spell entries (legacy — pre-May-2026 queue logging) get
      // verb-aware descriptions; option-item entries get a from/to
      // arrow; everything else falls back to a generic kind label.
      // Spell entries should be empty going forward but the renderer
      // still handles them so old actor flags from before the
      // revision degrade gracefully.
      let descHtml = "";
      if (entry.kind === "spellChange") {
        const verbs = {
          "added-to-sheet":         "Added to sheet:",
          "removed-from-sheet":     "Removed from sheet:",
          "added-to-spellbook":     "Added to spellbook:",
          "removed-from-spellbook": "Removed from spellbook:",
          "prepared":               "Prepared:",
          "unprepared":             "Unprepared:",
          "added-as-known":         "Added as Known:",
          "removed-as-known":       "Removed as Known:",
        };
        const verb = verbs[entry.transition] ?? "Changed:";
        descHtml = `<strong>${escapeHtml(verb)}</strong> ${escapeHtml(entry.spellName ?? "")}`;
      } else if (entry.kind === "optionItem") {
        descHtml = `<strong>${escapeHtml(entry.groupLabel ?? "Class Option")}:</strong> ${escapeHtml(entry.fromName ?? "?")} <i class="fas fa-arrow-right"></i> ${escapeHtml(entry.toName ?? "(picker TBD)")}`;
      } else {
        descHtml = `<strong>${escapeHtml(entry.kind ?? "Queued change")}</strong>`;
      }

      return `
        <li class="dauligor-feature-manager__overview-row">
          <div class="dauligor-feature-manager__overview-row-body">${descHtml}</div>
          <button type="button"
                  class="dauligor-feature-manager__queued-remove"
                  data-action="remove-overview-entry"
                  data-entry-id="${escapeHtml(entry.id)}"
                  data-entry-scope="${escapeHtml(entry.scope ?? SCOPE_LONG_REST)}"
                  title="Remove this queued change">
            <i class="fas fa-xmark"></i>
          </button>
        </li>
      `;
    };

    const sections = [];
    if (longRestEntries.length) {
      sections.push(`
        <section class="dauligor-feature-manager__overview-section">
          <h3 class="dauligor-feature-manager__overview-section-title">
            <i class="fas fa-bed"></i>
            Next long rest
            <span class="dauligor-feature-manager__overview-section-count">${longRestEntries.length}</span>
          </h3>
          <ul class="dauligor-feature-manager__overview-list">
            ${longRestEntries.map(renderEntry).join("")}
          </ul>
        </section>
      `);
    }
    if (levelUpEntries.length) {
      sections.push(`
        <section class="dauligor-feature-manager__overview-section">
          <h3 class="dauligor-feature-manager__overview-section-title">
            <i class="fas fa-circle-up"></i>
            Next level up
            <span class="dauligor-feature-manager__overview-section-count">${levelUpEntries.length}</span>
          </h3>
          <ul class="dauligor-feature-manager__overview-list">
            ${levelUpEntries.map(renderEntry).join("")}
          </ul>
        </section>
      `);
    }

    this._bodyRegion.innerHTML = `
      <div class="dauligor-feature-manager__overview">
        ${sections.join("")}
      </div>
    `;

    // Wire per-row Remove buttons. Routes through the scoped queue
    // helpers so the right bucket is mutated.
    for (const button of this._bodyRegion.querySelectorAll(`[data-action="remove-overview-entry"]`)) {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        const entryId = event.currentTarget?.dataset?.entryId;
        const scope = event.currentTarget?.dataset?.entryScope ?? SCOPE_LONG_REST;
        if (!entryId) return;
        await removeQueueEntry(this._actor, scope, entryId);
        this.render({ force: false });
      });
    }
  }

  /**
   * Spells tab — embeds the Prepare Spells manager inline inside the
   * Feature Manager body. Re-uses the same component, mounted into
   * the body region via `DauligorSpellPreparationApp.renderInto`.
   *
   * The embedded instance is destroyed on the next `_renderBody`
   * (tab switch / re-render) so the regions don't leak into stale
   * DOM. The standalone Prepare Spells window can still coexist —
   * the embedded mount is NOT registered as the prep app's singleton.
   *
   * Long-rest queueing of prepared-spell swaps is a separate concern
   * (see this file's header comment for the queue model) — that
   * layer hooks into the prep app's mutations in a follow-up pass.
   * For now, mutations apply immediately like the standalone window.
   */
  _renderSpellsTab() {
    // Host element for the embedded manager. A dedicated wrapper
    // keeps the manager's CSS scope (.dauligor-spell-manager) inside
    // the FM body without bleeding selectors into the rest of the
    // Feature Manager.
    this._bodyRegion.innerHTML = `
      <div class="dauligor-feature-manager__spells-host" data-region="spells-manager"></div>
    `;
    const host = this._bodyRegion.querySelector(`[data-region="spells-manager"]`);
    if (!host) return;
    // Mount async — the prep manager's template fetch + catalog
    // pre-warming take a tick. The host shows a brief "Loading…"
    // until the first render lands.
    host.innerHTML = `<div class="dauligor-spell-manager__empty">Loading spell manager…</div>`;
    (async () => {
      try {
        const instance = await DauligorSpellPreparationApp.renderInto(host, { actor: this._actor });
        this._embeddedSpellManager = instance;
      } catch (err) {
        console.warn(`${MODULE_ID} | embed spell manager failed`, err);
        host.innerHTML = `<div class="dauligor-spell-manager__empty">Failed to load spell manager — see console.</div>`;
      }
    })();
  }

  _renderFooter() {
    if (!this._footerRegion) return;
    const queue = getQueue(this._actor);
    const longRestCount = queue.longRest.entries.length;
    const levelUpCount = queue.levelUp.entries.length;

    const longRestSummary = longRestCount
      ? `<strong>${longRestCount}</strong> queued for next long rest`
      : `No long-rest changes queued`;
    const levelUpSummary = levelUpCount
      ? `<strong>${levelUpCount}</strong> queued for next level up`
      : `No level-up changes queued`;

    this._footerRegion.innerHTML = `
      <div class="dauligor-feature-manager__queue-summary">
        <div class="dauligor-feature-manager__queue-stat">
          <i class="fas fa-bed"></i>
          <span>${longRestSummary}</span>
          ${longRestCount ? `<button type="button" class="dauligor-feature-manager__queue-clear" data-action="clear-queue" data-scope="${SCOPE_LONG_REST}">Discard</button>` : ""}
        </div>
        <div class="dauligor-feature-manager__queue-stat">
          <i class="fas fa-circle-up"></i>
          <span>${levelUpSummary}</span>
          ${levelUpCount ? `<button type="button" class="dauligor-feature-manager__queue-clear" data-action="clear-queue" data-scope="${SCOPE_LEVEL_UP}">Discard</button>` : ""}
        </div>
      </div>
    `;

    for (const button of this._footerRegion.querySelectorAll(`[data-action="clear-queue"]`)) {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        const scope = event.currentTarget?.dataset?.scope;
        if (scope !== SCOPE_LONG_REST && scope !== SCOPE_LEVEL_UP) return;
        const confirmed = await DialogV2.confirm({
          window: { title: `Discard ${scopeLabel(scope)} queue?` },
          content: `<p>This removes every change queued for the next ${escapeHtml(scopeLabel(scope).toLowerCase())}.</p>`,
          modal: true,
          rejectClose: false
        });
        if (!confirmed) return;
        await clearScope(this._actor, scope);
        this.render({ force: false });
      });
    }
  }

  // ─── change-queue actions ──────────────────────────────────────────────

  /**
   * Phase 1 stub. Adds a placeholder queue entry so the wire-up is real
   * and the user can see queued state render. The actual change-picker
   * UI (which presents the eligible pool of replacements, filters by
   * level/prereq, and stores the chosen `toSourceId`) lands once the
   * ItemChoice `replaces` semantics work is done on the importer side —
   * that work pins down the "what's eligible" question.
   */
  async _handleQueueOptionItemChange(groupSourceId, groupLabel) {
    if (!groupSourceId) {
      notifyWarn("Missing group identifier — cannot queue change.");
      return;
    }
    const inventory = buildOptionGroupInventory(this._actor);
    const group = inventory.find((g) => g.groupSourceId === groupSourceId);
    const fromItem = group?.items?.[0];

    await addQueueEntry(this._actor, SCOPE_LONG_REST, {
      kind: "optionItem",
      groupSourceId,
      groupLabel,
      classSourceId: group?.classSourceId ?? null,
      className: group?.className ?? "",
      fromItemId: fromItem?.itemId ?? null,
      fromName: fromItem?.name ?? "(no current pick)",
      toSourceId: null,
      toName: null
    });
    notifyInfo(`Queued a placeholder change for ${groupLabel}. Picker UI is the next milestone.`);
    log("Queued option-item change", { groupSourceId, groupLabel });
    this.render({ force: false });
  }
}

export function openFeatureManager(actorLike, options = {}) {
  return DauligorFeatureManagerApp.open({ actor: actorLike, ...options });
}

// ─── Long-rest commit prompt ────────────────────────────────────────────
//
// Fired by main.js's `dnd5e.restCompleted` hook after a long rest. The
// flow:
//
//   1. Read the actor's queued long-rest entries.
//   2. If empty → no-op (nothing to commit).
//   3. If non-empty → open the Feature Manager (auto-switch to Spells
//      tab when any spell entries are queued, otherwise stay on
//      Features) and show a DialogV2 with three actions:
//        - Save changes → clears the queue. (Phase 1 limitation:
//          spell-change entries are already applied — the queue is
//          an audit log right now, not a deferred transaction. The
//          confirmation gives the player + GM a chance to review.)
//        - Discard changes → clears the queue with a warning chat
//          summary so the GM sees a "discarded" audit trail.
//        - Review → closes the dialog, leaves the FM open so the
//          player can make further changes; the queue is preserved.
//
// Phase 2 will defer mutations until commit. Until then, the dialog's
// "Save" / "Discard" both clear the queue; the difference is whether
// the chat summary frames them as accepted or discarded.

/**
 * Format the queued long-rest entries as a short HTML list for the
 * confirm dialog content. Spell entries get verb-aware descriptions;
 * other entry kinds fall through to a generic "X queued change".
 */
function formatQueueEntryDescriptionHtml(entry) {
  const escape = (v) => escapeHtml(String(v ?? ""));
  if (entry.kind === "spellChange") {
    const verbs = {
      "added-to-sheet":       "Added to sheet:",
      "removed-from-sheet":   "Removed from sheet:",
      "added-to-spellbook":   "Added to spellbook:",
      "removed-from-spellbook": "Removed from spellbook:",
      "prepared":             "Prepared:",
      "unprepared":           "Unprepared:",
      "added-as-known":       "Added as Known:",
      "removed-as-known":     "Removed as Known:",
    };
    const verb = verbs[entry.transition] ?? "Changed:";
    return `<li><strong>${verb}</strong> ${escape(entry.spellName)}</li>`;
  }
  if (entry.kind === "optionItem") {
    return `<li><strong>${escape(entry.groupLabel)}:</strong> ${escape(entry.fromName ?? "?")} → ${escape(entry.toName ?? "(picker TBD)")}</li>`;
  }
  return `<li>${escape(entry.kind ?? "Queued change")}</li>`;
}

/**
 * Open the long-rest commit dialog for an actor. Called from
 * `main.js` after `dnd5e.restCompleted` fires for a long rest.
 * No-op when the queue is empty across both scopes.
 *
 * Behaviour (May 2026 revision):
 *   - Always opens the FM to the Overview tab (no auto-switch to
 *     Spells / Features based on entry kind).
 *   - Shows entries from BOTH scopes — long rest is the natural
 *     review point for any pending advancement.
 *   - Save / Discard both clear the relevant queue scopes. Phase 1
 *     limitation: changes that were applied immediately (every
 *     spell-prep change, which no longer queues at all) aren't
 *     affected.
 */
export async function promptLongRestCommit(actorLike) {
  const actor = resolveActorDocument(actorLike);
  if (!actor || actor.type !== "character") return;
  const queue = getQueue(actor);
  const longRestEntries = queue.longRest.entries;
  const levelUpEntries = queue.levelUp.entries;
  const total = longRestEntries.length + levelUpEntries.length;
  if (total === 0) return;

  // Always open the FM to the Overview tab — the master view that
  // surfaces every queued advancement across scopes. No more
  // entry-kind-based auto-switching to Spells/Features.
  const fmInstance = DauligorFeatureManagerApp.open({ actor, tab: TAB_OVERVIEW });

  const longRestListHtml = longRestEntries.map(formatQueueEntryDescriptionHtml).join("");
  const levelUpListHtml = levelUpEntries.map(formatQueueEntryDescriptionHtml).join("");

  const sectionHtml = [
    longRestEntries.length ? `
      <div class="dauligor-feature-manager__rest-prompt-section">
        <strong><i class="fas fa-bed"></i> Next long rest:</strong>
        <ul style="margin: 4px 0 0 18px; padding: 0; list-style: disc;">${longRestListHtml}</ul>
      </div>
    ` : "",
    levelUpEntries.length ? `
      <div class="dauligor-feature-manager__rest-prompt-section">
        <strong><i class="fas fa-circle-up"></i> Next level up:</strong>
        <ul style="margin: 4px 0 0 18px; padding: 0; list-style: disc;">${levelUpListHtml}</ul>
      </div>
    ` : ""
  ].filter(Boolean).join("");

  let decision = null;
  try {
    decision = await DialogV2.wait({
      window: { title: `Long Rest — Queued Advancements for ${actor.name}` },
      content: `
        <div class="dauligor-feature-manager__rest-prompt">
          <p>You finished a long rest with <strong>${total}</strong> queued advancement${total === 1 ? "" : "s"}:</p>
          ${sectionHtml}
        </div>
      `,
      buttons: [
        {
          action: "save",
          label: "Save changes",
          icon: "fas fa-check",
          default: true,
          callback: () => "save"
        },
        {
          action: "discard",
          label: "Discard",
          icon: "fas fa-trash",
          callback: () => "discard"
        },
        {
          action: "review",
          label: "Make more changes",
          icon: "fas fa-pen",
          callback: () => "review"
        }
      ],
      modal: false,
      rejectClose: false
    });
  } catch (err) {
    console.warn(`${MODULE_ID} | rest dialog failed`, err);
    return;
  }

  if (decision === "review") {
    // Keep the FM open + leave the queue intact. The user can
    // continue editing via the FM's tabs.
    return;
  }

  if (decision === "save") {
    // Clear BOTH scopes — long rest is the natural commit point
    // for either kind of queued advancement, and Phase 1 doesn't
    // distinguish between them at commit time (the picker UI that
    // creates real entries hasn't shipped yet).
    if (longRestEntries.length) await clearScope(actor, SCOPE_LONG_REST);
    if (levelUpEntries.length) await clearScope(actor, SCOPE_LEVEL_UP);
    fmInstance?.render?.({ force: false });
    notifyInfo(`Queued advancements saved for ${actor.name}.`);
    return;
  }

  if (decision === "discard") {
    if (longRestEntries.length) await clearScope(actor, SCOPE_LONG_REST);
    if (levelUpEntries.length) await clearScope(actor, SCOPE_LEVEL_UP);
    fmInstance?.render?.({ force: false });
    notifyInfo(`Queued advancements discarded for ${actor.name}.`);
    return;
  }

  // Dialog closed without a decision (e.g. window close button).
  // Treat as "review" — keep queue intact, FM stays open.
}

// Exported for the upcoming rest-trigger / level-up-trigger commit
// handlers — they read the queue at trigger time and apply each entry
// according to its `kind`. Keeping these public so they're trivially
// reusable from main.js (Hooks.on dnd5e.restCompleted) and from the
// importer's level-up wizard.
export const featureManagerQueue = {
  read: getQueue,
  add: addQueueEntry,
  remove: removeQueueEntry,
  clear: clearScope,
  SCOPE_LONG_REST,
  SCOPE_LEVEL_UP
};
