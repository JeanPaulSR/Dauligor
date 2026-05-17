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
      // Window size matches the standalone Prepare Spells window
      // (1480×820) so the embedded Spells tab body has room for the
      // 3-col grid + footer without scrunching. The other tabs
      // (Overview, Features, …) are happy with less but render
      // comfortably at this size too.
      position: centeredAppPosition(
        Math.min(window.innerWidth - 80, 1480),
        Math.min(window.innerHeight - 80, 820)
      )
    });

    this._template = FEATURE_MANAGER_TEMPLATE;
    this._actor = actor;
    this._state = {
      activeTab: TAB_IDS.includes(tab) ? tab : TAB_OVERVIEW
    };

    // Re-render the FM (tabs + footer queue summary) whenever the
    // actor's queue flag changes. This keeps the Overview tab count
    // badge + the footer's "queued for next long rest" line fresh
    // as the embedded Prepare Spells mount writes queue entries.
    // The hook is detached on `close()`.
    this._actorUpdateHook = Hooks.on("updateActor", (doc, changes) => {
      if (doc?.id !== this._actor?.id) return;
      // Only re-render when the queue flag actually changed. The
      // path is `flags.dauligor-pairing.featureManagerQueue` — a
      // shallow check on the flag object is enough.
      const touched = !!changes?.flags?.[MODULE_ID]?.featureManagerQueue;
      if (!touched) return;
      // Skip when we're rendering an embedded Spells mount — the
      // body re-render would unmount it mid-interaction. The tab
      // strip + footer auto-refresh next time the user switches
      // tabs. Acceptable staleness for v1.
      if (this._state.activeTab === TAB_SPELLS) {
        // Only refresh the tab strip + footer regions (not the body).
        this._renderTabs();
        this._renderFooter();
        return;
      }
      this.render({ force: false });
    });
  }

  _configureRenderParts() {
    return { main: { template: this._template } };
  }

  async close(options) {
    // Detach the actor-update hook so it doesn't leak across FM
    // open/close cycles. Hook ids are returned by Hooks.on and
    // released via Hooks.off.
    if (this._actorUpdateHook) {
      try { Hooks.off("updateActor", this._actorUpdateHook); } catch { /* noop */ }
      this._actorUpdateHook = null;
    }
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
   * Always renders a "Take Long Rest" call-to-action at the top:
   *   - With queued entries: applies them (via `actor.longRest`)
   *     and triggers a long rest in one click.
   *   - Without queued entries: still available; rest applies with
   *     no queue commit.
   *
   * The FM is also the configured intercept target for dnd5e's
   * built-in Long Rest button (see `registerLongRestIntercept` in
   * main.js), so this Overview tab is what the player sees whenever
   * a long rest is initiated.
   */
  _renderOverviewTab() {
    const queue = getQueue(this._actor);
    const longRestEntries = queue.longRest.entries;
    const levelUpEntries = queue.levelUp.entries;
    const total = longRestEntries.length + levelUpEntries.length;

    // Rest config — read the actor's sticky preference flag, with
    // defaults pulled from dnd5e's CONFIG.DND5E.restTypes.long (all
    // three checkboxes default on, matching the native dialog).
    const restConfig = this._readRestConfigFlag();

    // Long-rest action card — always rendered. The button applies
    // queued changes + calls `actor.longRest({ dialog: false, ...cfg })`
    // with the cfg pulled from these checkboxes. The three options
    // mirror dnd5e's native LongRestDialog 1-for-1:
    //   - newDay        ("New Day")
    //   - recoverTemp   ("Remove Temp HP" in dnd5e's dialog label)
    //   - recoverTempMax ("Recover Max HP")
    //
    // dnd5e source ref: module/applications/actor/rest/base-rest-dialog.mjs
    // for the dialog wiring; CONFIG.DND5E.restTypes.long for defaults.
    const checkbox = (key, label, hint, checked) => `
      <label class="dauligor-feature-manager__rest-option" title="${escapeHtml(hint)}">
        <input type="checkbox"
               data-action="rest-config"
               data-config-key="${escapeHtml(key)}"
               ${checked ? "checked" : ""}>
        <span class="dauligor-feature-manager__rest-option-label">${escapeHtml(label)}</span>
      </label>
    `;
    const restCardHtml = `
      <section class="dauligor-feature-manager__rest-card">
        <div class="dauligor-feature-manager__rest-card-body">
          <i class="fas fa-bed dauligor-feature-manager__rest-card-icon"></i>
          <div class="dauligor-feature-manager__rest-card-text">
            <h3>Take Long Rest</h3>
            <p>${total > 0
              ? `Apply your ${total} queued change${total === 1 ? "" : "s"} and complete a long rest. HP, spell slots, and rest features recover.`
              : "Complete a long rest. HP, spell slots, and rest features recover."}</p>
            <div class="dauligor-feature-manager__rest-options">
              ${checkbox("newDay", "New Day",
                "Recover limited-use abilities that recharge at dawn or on a new day.",
                restConfig.newDay)}
              ${checkbox("recoverTemp", "Remove Temp HP",
                "Clear any temporary HP at the start of the rest.",
                restConfig.recoverTemp)}
              ${checkbox("recoverTempMax", "Recover Max HP",
                "Remove any adjustments to your maximum HP (e.g. from drain effects).",
                restConfig.recoverTempMax)}
            </div>
          </div>
        </div>
        <button type="button"
                class="dauligor-feature-manager__rest-card-button"
                data-action="take-long-rest"
                title="Apply queued changes + run the dnd5e long rest workflow with the options selected.">
          Take Long Rest
        </button>
      </section>
    `;

    if (total === 0) {
      this._bodyRegion.innerHTML = `
        ${restCardHtml}
        <div class="dauligor-feature-manager__overview-empty">
          <i class="fas fa-circle-check"></i>
          <h3>No queued advancements</h3>
          <p>Queue changes from the other tabs (Spells, Features, …) and they'll appear here for review before your next rest.</p>
        </div>
      `;
      this._bindRestCardButton();
      return;
    }

    // Build the preview rows. Spell-change entries get smart
    // grouping: for known casters, paired Remove + Add entries on
    // the same class render as a single "Replacing X with Y" row.
    // Everything else renders as "Preparing X" / "Unpreparing X" /
    // generic "Changed X".
    const renderRow = (rowHtml, entryIds, scope = SCOPE_LONG_REST) => `
      <li class="dauligor-feature-manager__overview-row">
        <div class="dauligor-feature-manager__overview-row-body">${rowHtml}</div>
        <button type="button"
                class="dauligor-feature-manager__queued-remove"
                data-action="remove-overview-entry-bundle"
                data-entry-ids="${escapeHtml(entryIds.join(","))}"
                data-entry-scope="${escapeHtml(scope)}"
                title="${entryIds.length > 1 ? "Remove this swap pair" : "Remove this queued change"}">
          <i class="fas fa-xmark"></i>
        </button>
      </li>
    `;

    /** "Preparing X" / "Unpreparing X" / "Added to Spellbook X" / "Removed: X" — verb-aware. */
    const describeSpellEntry = (entry) => {
      const before = entry.before;
      const after = entry.after;
      const SPELL_PREPARED = "prepared";
      const SPELL_SPELLBOOK = "spellbook";
      // Promote to prepared (or add as known — same after-mode).
      if (after === SPELL_PREPARED) {
        if (before === null) return `<strong>Adding:</strong> ${escapeHtml(entry.spellName ?? "")}`;
        if (before === SPELL_PREPARED) return `<strong>Re-prepared:</strong> ${escapeHtml(entry.spellName ?? "")}`;
        return `<strong>Preparing:</strong> ${escapeHtml(entry.spellName ?? "")}`;
      }
      // Demote from prepared
      if (before === SPELL_PREPARED) {
        if (after === null) return `<strong>Removing:</strong> ${escapeHtml(entry.spellName ?? "")}`;
        if (after === SPELL_SPELLBOOK) return `<strong>Unpreparing:</strong> ${escapeHtml(entry.spellName ?? "")} <em>(stays in spellbook)</em>`;
        return `<strong>Unpreparing:</strong> ${escapeHtml(entry.spellName ?? "")}`;
      }
      // Spellbook moves
      if (after === SPELL_SPELLBOOK) return `<strong>To spellbook:</strong> ${escapeHtml(entry.spellName ?? "")}`;
      if (before === SPELL_SPELLBOOK) return `<strong>From spellbook:</strong> ${escapeHtml(entry.spellName ?? "")}`;
      // Plain add / remove (free mode)
      if (before === null) return `<strong>Adding to sheet:</strong> ${escapeHtml(entry.spellName ?? "")}`;
      if (after === null) return `<strong>Removing from sheet:</strong> ${escapeHtml(entry.spellName ?? "")}`;
      return `<strong>Changed:</strong> ${escapeHtml(entry.spellName ?? "")}`;
    };

    /**
     * Group entries by class so the Overview renders one block per
     * class. Each block is its own sub-section with the class name
     * as a header — makes multi-class characters legible at a
     * glance ("which spell affects which class?").
     *
     * Grouping key resolution:
     *   - spellChange entries → `classIdentifier` (resolved to the
     *     actor's class item .name for the header label)
     *   - optionItem entries  → `className` (already a display name)
     *   - everything else     → "(Other)" bucket pinned last
     *
     * Returns an ordered array of `{ classKey, className, entries }`.
     * First-occurrence order preserved so the user sees classes in
     * the order they queued changes.
     */
    const groupEntriesByClass = (entries) => {
      const groups = new Map(); // groupKey → { className, entries }
      for (const entry of entries) {
        let groupKey = "__other__";
        let className = "Other";
        if (entry?.kind === "spellChange") {
          const cls = entry.classIdentifier;
          if (cls) {
            groupKey = String(cls);
            const classItem = this._actor.classes?.[cls];
            className = classItem?.name ?? cls;
          }
        } else if (entry?.kind === "optionItem") {
          const name = String(entry.className ?? "").trim();
          if (name) {
            groupKey = `__byName__:${name.toLowerCase()}`;
            className = name;
          }
        }
        if (!groups.has(groupKey)) groups.set(groupKey, { groupKey, className, entries: [] });
        groups.get(groupKey).entries.push(entry);
      }
      // Pin the "Other" bucket last for readability.
      const list = [...groups.values()];
      list.sort((a, b) => {
        if (a.groupKey === "__other__") return 1;
        if (b.groupKey === "__other__") return -1;
        return 0; // preserve insertion order otherwise
      });
      return list;
    };

    /**
     * Build the rendered rows for a single class group. Applies
     * the known-caster swap-pair detection inside the group;
     * unmatched entries fall through to per-entry rendering. Pair
     * detection only considers entries WITHIN the group, so a
     * Bard Remove never gets paired with a Sorcerer Add even
     * though both are "known" caster types.
     */
    const buildPreviewRowsForGroup = (group) => {
      const rows = [];
      const consumed = new Set();
      // Detect the group's prep type from a spellChange entry. All
      // entries in the group share the same class (by construction
      // of `groupEntriesByClass`), so any spellChange entry gives
      // us the classIdentifier we need.
      const sampleSpellEntry = group.entries.find((e) => e?.kind === "spellChange");
      const cls = sampleSpellEntry?.classIdentifier ?? null;
      const classItem = cls ? this._actor.classes?.[cls] : null;
      const prepType = classItem?.getFlag?.(MODULE_ID, "spellcasting")?.type
        ?? classItem?.flags?.[MODULE_ID]?.spellcasting?.type
        ?? null;

      if (prepType === "known") {
        // Pair removes ↔ adds inside this group → "Replacing X with Y"
        const adds = [];
        const removes = [];
        for (const e of group.entries) {
          if (e?.kind !== "spellChange") continue;
          const isAdd = e.before !== "prepared" && e.after === "prepared";
          const isRemove = e.before === "prepared" && e.after !== "prepared";
          if (isAdd) adds.push(e);
          else if (isRemove) removes.push(e);
        }
        while (removes.length && adds.length) {
          const rem = removes.shift();
          const add = adds.shift();
          consumed.add(rem.id);
          consumed.add(add.id);
          const html = `<strong>Replacing</strong> <em>${escapeHtml(rem.spellName ?? "")}</em> <strong>with</strong> <em>${escapeHtml(add.spellName ?? "")}</em>`;
          rows.push({ html, ids: [rem.id, add.id], scope: SCOPE_LONG_REST });
        }
      }

      // Remaining entries: render individually with verb-aware
      // descriptions (spell changes) or kind-appropriate formatting
      // (optionItem, etc.).
      for (const e of group.entries) {
        if (consumed.has(e.id)) continue;
        let descHtml = "";
        if (e.kind === "spellChange") {
          descHtml = describeSpellEntry(e);
        } else if (e.kind === "optionItem") {
          descHtml = `<strong>${escapeHtml(e.groupLabel ?? "Class Option")}:</strong> ${escapeHtml(e.fromName ?? "?")} <i class="fas fa-arrow-right"></i> ${escapeHtml(e.toName ?? "(picker TBD)")}`;
        } else {
          descHtml = `<strong>${escapeHtml(e.kind ?? "Queued change")}</strong>`;
        }
        rows.push({ html: descHtml, ids: [e.id], scope: e.scope ?? SCOPE_LONG_REST });
      }
      return rows;
    };

    /** Render one scope-section (Next long rest / Next level up) — class-grouped. */
    const renderScopeSection = ({ title, icon, entries, scope }) => {
      const groups = groupEntriesByClass(entries);
      const groupHtml = groups.map((group) => {
        const groupRows = buildPreviewRowsForGroup(group);
        if (!groupRows.length) return "";
        return `
          <div class="dauligor-feature-manager__overview-class-group">
            <h4 class="dauligor-feature-manager__overview-class-header">
              ${escapeHtml(group.className)}
            </h4>
            <ul class="dauligor-feature-manager__overview-list">
              ${groupRows.map((r) => renderRow(r.html, r.ids, r.scope ?? scope)).join("")}
            </ul>
          </div>
        `;
      }).join("");
      return `
        <section class="dauligor-feature-manager__overview-section">
          <h3 class="dauligor-feature-manager__overview-section-title">
            <i class="${escapeHtml(icon)}"></i>
            ${escapeHtml(title)}
            <span class="dauligor-feature-manager__overview-section-count">${entries.length}</span>
          </h3>
          ${groupHtml}
        </section>
      `;
    };

    const sections = [];
    if (longRestEntries.length) {
      sections.push(renderScopeSection({
        title: "Next long rest",
        icon: "fas fa-bed",
        entries: longRestEntries,
        scope: SCOPE_LONG_REST
      }));
    }
    if (levelUpEntries.length) {
      sections.push(renderScopeSection({
        title: "Next level up",
        icon: "fas fa-circle-up",
        entries: levelUpEntries,
        scope: SCOPE_LEVEL_UP
      }));
    }

    this._bodyRegion.innerHTML = `
      ${restCardHtml}
      <div class="dauligor-feature-manager__overview">
        ${sections.join("")}
      </div>
    `;

    // Wire per-row Remove buttons. Each bundle (single entry OR a
    // paired Replacing-X-with-Y swap) carries comma-separated ids;
    // we walk them and remove each from the appropriate scope. The
    // bundle scope is the SAME for all ids in the bundle (swap
    // pairs only happen within the long-rest scope).
    for (const button of this._bodyRegion.querySelectorAll(`[data-action="remove-overview-entry-bundle"]`)) {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        const idsRaw = event.currentTarget?.dataset?.entryIds ?? "";
        const scope = event.currentTarget?.dataset?.entryScope ?? SCOPE_LONG_REST;
        const ids = idsRaw.split(",").map((s) => s.trim()).filter(Boolean);
        for (const id of ids) {
          await removeQueueEntry(this._actor, scope, id);
        }
        this.render({ force: false });
      });
    }
    this._bindRestCardButton();
  }

  /**
   * Wire the "Take Long Rest" call-to-action on the Overview tab.
   * Click handler calls `actor.longRest({ dialog: false })` — the
   * `dialog: false` skips dnd5e's HD-spending dialog (which we'd
   * otherwise re-enter via the libWrapper intercept and create a
   * loop). Rest completes → `dnd5e.restCompleted` fires →
   * main.js's hook applies our long-rest queue.
   *
   * For HD spending in v1, the user can still use dnd5e's native
   * Long Rest button if they want to spend HD before resting; the
   * intercept routes that case through this same FM Overview tab,
   * so the player sees the queued changes before hitting "Take
   * Long Rest" anyway.
   */
  /**
   * Read the actor's sticky rest-config flag. Falls back to dnd5e's
   * `CONFIG.DND5E.restTypes.long` defaults when the flag isn't set,
   * which match what the user sees as the default-checked options
   * in dnd5e's native LongRestDialog.
   */
  _readRestConfigFlag() {
    const raw = this._actor?.getFlag?.(MODULE_ID, "longRestConfig") ?? null;
    const defaults = CONFIG?.DND5E?.restTypes?.long ?? {};
    return {
      newDay: typeof raw?.newDay === "boolean" ? raw.newDay : (defaults.newDay ?? true),
      recoverTemp: typeof raw?.recoverTemp === "boolean" ? raw.recoverTemp : (defaults.recoverTemp ?? true),
      recoverTempMax: typeof raw?.recoverTempMax === "boolean" ? raw.recoverTempMax : (defaults.recoverTempMax ?? true)
    };
  }

  async _writeRestConfigFlag(partial) {
    if (!this._actor?.setFlag) return;
    const current = this._readRestConfigFlag();
    await this._actor.setFlag(MODULE_ID, "longRestConfig", { ...current, ...partial });
  }

  _bindRestCardButton() {
    // Checkbox change handlers — persist each toggle to the actor's
    // sticky preference flag. The hook doesn't re-render (avoids a
    // visual flicker mid-click); the Take Long Rest button reads
    // the live flag at click time.
    for (const cb of this._bodyRegion?.querySelectorAll(`[data-action="rest-config"]`) ?? []) {
      cb.addEventListener("change", async (event) => {
        const key = event.currentTarget?.dataset?.configKey;
        if (!key) return;
        await this._writeRestConfigFlag({ [key]: !!event.currentTarget.checked });
      });
    }

    const btn = this._bodyRegion?.querySelector(`[data-action="take-long-rest"]`);
    if (!btn) return;
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        // 1. Apply queued long-rest changes BEFORE triggering the
        //    rest. This way:
        //      - Spell items reflect the player's pending picks
        //        before HP/slots recover (matters for known casters
        //        who swapped a known spell; the new known spell is
        //        on the sheet during the rest's slot computation).
        //      - dnd5e's `restCompleted` hook sees an empty queue
        //        when our handler in main.js fires, so it doesn't
        //        re-prompt the commit dialog.
        const applied = await applyLongRestQueue(this._actor);
        if (applied > 0) {
          notifyInfo(`Applied ${applied} queued change${applied === 1 ? "" : "s"}.`);
        }
        // 2. Trigger the actual rest with the sticky checkbox
        //    options. `dialog: false` skips dnd5e's native dialog
        //    (and bypasses our `preLongRest` intercept). dnd5e then
        //    runs the standard rest mechanics: HP recovery, spell
        //    slot reset, rest features.
        const restConfig = this._readRestConfigFlag();
        await this._actor.longRest({
          dialog: false,
          advanceTime: true,
          newDay: restConfig.newDay,
          recoverTemp: restConfig.recoverTemp,
          recoverTempMax: restConfig.recoverTempMax
        });
        // 3. Re-render the Overview so the (now-empty) queue
        //    summary + rest-card subtitle refresh. The actor flag
        //    write triggers our updateActor hook too — this is a
        //    safety belt.
        this.render({ force: false });
      } catch (err) {
        console.warn(`${MODULE_ID} | long rest from FM failed`, err);
        notifyWarn("Long rest failed — see console.");
      }
    });
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
   * Spell mutations made inside the embedded mount QUEUE up for the
   * next long rest — they don't apply to the actor immediately. The
   * Prepare Spells UI shows queued state via a "pending" indicator
   * on each affected row so the player sees their click registered.
   * Apply happens via `applyLongRestQueue` either on the long-rest
   * dialog's Save action or via the FM footer's "Save now" button.
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

// ─── Queue commit (apply queued changes to the actor) ──────────────────
//
// The FM-embedded Prepare Spells mount queues spell mutations without
// mutating the actor. On long-rest commit (or the FM footer's "Save"
// button), this helper walks every queued `spellChange` entry and
// applies it:
//
//   - before=null,  after!=null → CREATE the spell item from
//                                  entry.spellItemData
//   - before!=null, after=null  → DELETE the spell item by spellId
//   - both non-null              → UPDATE the spell item's sheetMode
//
// The queue is cleared on success. Returns the number of entries
// applied (informational; the dialog notification uses this).

async function applyLongRestQueue(actor) {
  if (!actor) return 0;
  const queue = getQueue(actor);
  const entries = queue.longRest.entries;
  if (!entries.length) return 0;

  let applied = 0;
  for (const entry of entries) {
    try {
      if (entry?.kind !== "spellChange") continue;
      const before = entry.before ?? null;
      const after = entry.after ?? null;

      // CREATE: queued add of a spell that wasn't on the actor yet.
      if (before === null && after !== null && entry.spellItemData) {
        // Re-stamp the sheetMode + dnd5e fields in case the user
        // toggled between modes while the entry was queued (the
        // upsert logic preserves the spellItemData but the after
        // mode might differ from when it was first captured).
        const itemData = foundry.utils.deepClone(entry.spellItemData);
        if (!itemData.flags) itemData.flags = {};
        if (!itemData.flags[MODULE_ID]) itemData.flags[MODULE_ID] = {};
        itemData.flags[MODULE_ID].sheetMode = after;
        foundry.utils.setProperty(itemData, "system.prepared", after !== "spellbook");
        foundry.utils.setProperty(itemData, "system.method", "spell");
        await actor.createEmbeddedDocuments("Item", [itemData]);
        applied++;
        continue;
      }

      // DELETE: queued removal of an owned spell.
      if (before !== null && after === null && entry.spellId) {
        try {
          await actor.deleteEmbeddedDocuments("Item", [entry.spellId]);
          applied++;
        } catch (err) {
          // Item may have been deleted by some other path (sheet
          // edit, etc.) — log and skip. Don't fail the whole commit.
          console.warn(`${MODULE_ID} | queued delete failed`, { entry, err });
        }
        continue;
      }

      // UPDATE: existing owned spell, sheetMode change.
      if (before !== null && after !== null && entry.spellId) {
        const item = actor.items?.get?.(entry.spellId);
        if (!item) {
          console.warn(`${MODULE_ID} | queued update target missing`, entry);
          continue;
        }
        const patch = {
          "system.prepared": after !== "spellbook",
          "system.method": "spell"
        };
        patch[`flags.${MODULE_ID}.sheetMode`] = after;
        await item.update(patch);
        applied++;
        continue;
      }
    } catch (err) {
      console.warn(`${MODULE_ID} | queue entry apply failed`, { entry, err });
    }
  }

  // Clear the long-rest scope after applying — even if some entries
  // failed, the rest are now applied, so we don't want to double-
  // apply on the next commit attempt. Failed entries log to console.
  await clearScope(actor, SCOPE_LONG_REST);
  return applied;
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
 * (legacy) commit dialog content. The dialog is a fallback path —
 * the Overview tab's preview (built inline in `_renderOverviewTab`)
 * uses richer swap-pair detection. This function stays simple +
 * per-entry for fallback usage.
 */
function formatQueueEntryDescriptionHtml(entry) {
  const escape = (v) => escapeHtml(String(v ?? ""));
  if (entry.kind === "spellChange") {
    const before = entry.before;
    const after = entry.after;
    const name = escape(entry.spellName);
    if (after === "prepared") {
      if (before === null) return `<li><strong>Adding:</strong> ${name}</li>`;
      return `<li><strong>Preparing:</strong> ${name}</li>`;
    }
    if (before === "prepared") {
      if (after === null) return `<li><strong>Removing:</strong> ${name}</li>`;
      return `<li><strong>Unpreparing:</strong> ${name}</li>`;
    }
    if (after === null) return `<li><strong>Removing from sheet:</strong> ${name}</li>`;
    if (before === null) return `<li><strong>Adding to sheet:</strong> ${name}</li>`;
    return `<li><strong>Changed:</strong> ${name}</li>`;
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
    // Apply long-rest queue: walks every queued spellChange and
    // applies the create / update / delete to the actor. Clears
    // the long-rest scope after applying.
    const applied = await applyLongRestQueue(actor);
    // Level-up scope entries aren't committed by a long rest —
    // they're held for the next level-up wizard run. Discard them
    // here only if they're stale placeholders (Phase 1 stub from
    // the Features tab). Leave real picks intact when Phase 2 lands.
    // For now we keep them — the user explicitly chose Save, but
    // level-up isn't the trigger for those entries.
    fmInstance?.render?.({ force: false });
    notifyInfo(`Applied ${applied} change${applied === 1 ? "" : "s"} for ${actor.name}.`);
    return;
  }

  if (decision === "discard") {
    // Clear BOTH scopes without applying. The actor's spell items
    // remain in their pre-queue state (since FM-embedded changes
    // never applied to the actor in the first place).
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
