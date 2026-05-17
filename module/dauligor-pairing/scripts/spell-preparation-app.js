import { MODULE_ID, SPELL_PREPARATION_TEMPLATE } from "./constants.js";
import { notifyInfo, notifyWarn } from "./utils.js";
import { fetchFullSpellItem } from "./class-import-service.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const UNKNOWN_CLASS_IDENTIFIER = "__other__";

// Visible label for each preparation mode the dnd5e 5.x class system
// exposes. Used in the meta strip's prep-type chip. Anything not in
// this map falls back to the raw mode string.
const PREPARATION_TYPE_LABELS = {
  always: "Always Prepared",
  innate: "Innate",
  pact: "Pact Magic",
  prepared: "Prepared Caster",
  spell: "Spellbook",
  ritual: "Ritual Only",
  leveled: "Leveled Caster",
};

const SPELL_LEVELS_ALL = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

const PROPERTY_FILTERS = [
  { v: "ritual", l: "Ritual" },
  { v: "concentration", l: "Concentration" },
  { v: "known", l: "Known" },
  { v: "prepared", l: "Prepared" },
];

// ---------------------------------------------------------------------------
// Module-local helpers
// ---------------------------------------------------------------------------

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

// ----- Actor-spell introspection ------------------------------------------

function getSpellMethod(spell) {
  return String(spell?.system?.method ?? "").trim();
}

function getPreparedState(spell) {
  // Legacy numeric prepared state kept for compatibility with older
  // dnd5e data. The v5 system uses a boolean `system.prepared` plus
  // a string `system.method`, but we still tolerate the numeric path.
  const prepared = Number(spell?.system?.prepared ?? 0);
  return Number.isFinite(prepared) ? prepared : 0;
}

function isAlwaysPrepared(spell) {
  if (!spell) return false;
  if (getSpellMethod(spell) === "always") return true;
  // Fallback: pre-v5 numeric-prepared state of 2 also meant "always".
  return getPreparedState(spell) >= 2;
}

function isCurrentlyPrepared(spell) {
  if (!spell) return false;
  const sys = spell.system ?? {};
  if (sys.prepared === true) return true;
  if (getPreparedState(spell) >= 1) return true;
  return false;
}

function isAdvancementGranted(spell) {
  if (!spell) return false;
  const grantedFlag = spell.getFlag?.(MODULE_ID, "grantedByAdvancementId");
  return Boolean(grantedFlag);
}

function resolveSpellClassIdentifier(spell) {
  // Primary: module flag we stamp at add-time. Reading our own flag
  // sidesteps dnd5e's deprecated `system.sourceClass` accessor (the
  // legacy getter logs a deprecation warning on every read in 5.3+).
  const flag = spell?.getFlag?.(MODULE_ID, "classIdentifier");
  if (flag) return String(flag).trim();
  // v5.3+ derived getter: resolves `system.sourceItem` (a string like
  // "class:bard") to the linked class item and returns its identifier.
  const derived = spell?.system?.classIdentifier;
  if (derived) return String(derived).trim();
  return "";
}

function getSpellEntityId(spell) {
  return String(spell?.getFlag?.(MODULE_ID, "entityId") ?? "").trim();
}

// ----- Lightweight pool-summary readers -----------------------------------

function poolFlags(item) {
  return item?.flags?.["dauligor-pairing"] ?? {};
}

function poolDbId(item) {
  return String(poolFlags(item).dbId ?? "");
}

function poolSourceId(item) {
  return String(poolFlags(item).sourceId ?? "");
}

function poolLevel(item) {
  return Number(poolFlags(item).level ?? 0) || 0;
}

function poolSchool(item) {
  return String(poolFlags(item).school ?? "");
}

function poolSpellSourceId(item) {
  return String(poolFlags(item).spellSourceId ?? "");
}

function poolName(item) {
  return String(item?.name ?? "");
}

// ----- Foundry/DND5E label resolvers --------------------------------------

function describeSpellLevel(level) {
  const label = localizeConfigValue(CONFIG.DND5E.spellLevels?.[level]);
  return level === 0 ? (label || "Cantrips") : (label || `Level ${level}`);
}

function describeSpellSchool(school) {
  const entry = CONFIG.DND5E.spellSchools?.[school];
  // dnd5e 5.x: entry is `{ label, icon, fullKey }`. Older versions
  // shipped a bare string. Unwrap `.label` (a localization key like
  // "DND5E.SchoolEvo") and let `localizeConfigValue` translate it.
  // Without this, the object printed as "[object Object]" inside the
  // detail-pane meta row.
  const label = (entry && typeof entry === "object") ? entry.label : entry;
  return localizeConfigValue(label ?? school ?? "");
}

function describeSpellSchoolAbbr(school) {
  return String(school || "").slice(0, 4).toUpperCase();
}

function describeAbility(ability) {
  return localizeConfigValue(
    CONFIG.DND5E.abilities?.[ability]?.label
    ?? CONFIG.DND5E.abilities?.[ability]
    ?? ability
    ?? ""
  );
}

function describeSpellcastingProgression(progression) {
  return localizeConfigValue(CONFIG.DND5E.spellcastingProgression?.[progression] ?? progression ?? "");
}

// ---------------------------------------------------------------------------
// Public open() helper
// ---------------------------------------------------------------------------

/**
 * Open (or re-open) the Dauligor spell preparation manager for the
 * given actor.
 *
 * @param {Actor|object} actorLike - Actor document, sheet, or token-like
 * @param {object}  [options]
 * @param {string}  [options.preselectClassIdentifier] - Class identifier
 *   to focus when the manager opens. Used by per-class "Prepare" buttons
 *   on the sheet so clicking Bard's button opens the manager with the
 *   Bard pool already showing.
 */
export async function openSpellPreparationManager(actorLike, { preselectClassIdentifier = null } = {}) {
  const actor = resolveActorDocument(actorLike);
  if (!actor || (actor.type !== "character")) {
    notifyWarn("Open Prepare Spells from a character actor.");
    return null;
  }

  return DauligorSpellPreparationApp.open({ actor, preselectClassIdentifier });
}

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

/**
 * Sheet-side spell preparation manager. Mirrors the layout of the
 * Character Builder's `AddSpellsModal` (3 columns: favorites · pool ·
 * detail) plus a class rail on the far left so multi-class actors can
 * switch the active class without reopening the manager.
 *
 * Data flow:
 *   - Per-class pool: fetched live from
 *     `/api/module/<source>/classes/<class>/spells.json` via the
 *     `spellListUrl` flag stamped on the class item during import.
 *     Summaries only — no description, no system block.
 *   - Detail pane: when a row is selected, the full Foundry-ready spell
 *     item is fetched from `/api/module/spells/<dbId>.json` and cached
 *     by dbId for the lifetime of the open manager. The description,
 *     activation/range/duration/components meta render from that.
 *   - Favorites: stored on `actor.flags.dauligor-pairing.spellFavorites`
 *     as a `dbId[]`. Survives reload; spans classes.
 *   - Add-to-sheet: row-click on a `+` row fetches the full spell,
 *     stamps `system.sourceClass` + `flags.dauligor-pairing.classIdentifier`
 *     + `flags.dauligor-pairing.entityId` (= dbId, for owned-lookup),
 *     and `createEmbeddedDocuments("Item", […])` onto the actor.
 *   - Remove-from-sheet: row-click on a `✓` row finds the matching
 *     spell item by dbId and `deleteEmbeddedDocuments("Item", […])`.
 *     Advancement-granted and always-prepared spells are locked from
 *     removal here (modify via the source advancement instead).
 */
export class DauligorSpellPreparationApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static _instance = null;

  static open({ actor, preselectClassIdentifier = null } = {}) {
    if (!actor) return null;

    if (this._instance) {
      this._instance.setActor(actor, preselectClassIdentifier);
      this._instance.render({ force: true });
      this._instance.maximize?.();
      return this._instance;
    }

    const instance = new this({ actor, preselectClassIdentifier });
    this._instance = instance;
    instance.render({ force: true });
    return instance;
  }

  constructor({ actor, preselectClassIdentifier = null } = {}) {
    super({
      id: `${MODULE_ID}-spell-preparation`,
      classes: ["dauligor-importer-app", "dauligor-importer-app--spells"],
      window: {
        title: actor ? `Prepare Spells: ${actor.name}` : "Prepare Spells",
        resizable: true,
        contentClasses: ["dauligor-importer-window"]
      },
      position: {
        // Wider than the legacy app so the new 4-column body has room
        // for the favorites + ~400px detail column.
        width: Math.min(window.innerWidth - 80, 1480),
        height: Math.min(window.innerHeight - 80, 820)
      }
    });

    this._template = SPELL_PREPARATION_TEMPLATE;
    this._actor = actor ?? null;
    this._state = {
      search: "",
      filterOpen: false,
      lvlF: [],
      schoolF: [],
      sourceF: [],
      propF: [],
      selectedClassIdentifier: preselectClassIdentifier ?? null,
      // Selection is keyed by dbId so it survives across pool fetches
      // and works for unowned spells too. The legacy code used Foundry
      // item id, which only existed for owned spells.
      selectedSpellDbId: null,
    };

    // Live spell-pool cache keyed by classIdentifier. Each entry is
    // one of:
    //   { status: "loading" }
    //   { status: "ready",   spells: [...] }
    //   { status: "missing", reason: string }
    //   { status: "error",   reason: string }
    this._classPools = new Map();

    // Per-dbId cache of full Foundry-ready spell items (from
    // `/api/module/spells/<dbId>.json`). Populated lazily as rows are
    // selected. Used by both the detail pane render and the add-to-
    // sheet flow so a row select pre-warms the cache for a subsequent
    // add.
    this._fullSpellCache = new Map();
    this._fullSpellInFlight = new Set();
    // Cache of dnd5e-enriched description HTML keyed by dbId. The
    // raw `system.description.value` contains `&Reference[...]`,
    // `[[/roll ...]]`, etc. that need TextEditor.enrichHTML to render
    // as clickable widgets. Enrichment runs once per spell, lazily,
    // after `_ensureFullSpell` populates the underlying body.
    this._enrichedDescriptionCache = new Map();
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

  setActor(actor, preselectClassIdentifier = null) {
    const changedActor = this._actor?.id !== actor?.id;
    this._actor = actor ?? null;
    this.options.window.title = this._actor ? `Prepare Spells: ${this._actor.name}` : "Prepare Spells";
    if (changedActor) {
      // Pool + full-spell caches are actor-scoped — clear when the
      // active actor changes.
      this._classPools.clear();
      this._fullSpellCache.clear();
      this._fullSpellInFlight.clear();
      this._state.selectedSpellDbId = null;
    }
    if (preselectClassIdentifier) {
      this._state.selectedClassIdentifier = preselectClassIdentifier;
      this._state.selectedSpellDbId = null;
    }
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
    this._railRegion = content.querySelector(`[data-region="rail"]`);
    this._favoritesRegion = content.querySelector(`[data-region="favorites"]`);
    this._metaRegion = content.querySelector(`[data-region="meta"]`);
    this._toolbarRegion = content.querySelector(`[data-region="toolbar"]`);
    this._drawerRegion = content.querySelector(`[data-region="drawer"]`);
    this._poolRegion = content.querySelector(`[data-region="pool"]`);
    this._detailRegion = content.querySelector(`[data-region="detail"]`);

    await this._renderManager();
  }

  // -----------------------------------------------------------------------
  // Class models + actor introspection
  // -----------------------------------------------------------------------

  _getActorClasses() {
    return this._actor?.classes ?? {};
  }

  _getSpellItems() {
    return this._actor?.itemTypes?.spell ? [...this._actor.itemTypes.spell] : [];
  }

  /**
   * Lookup map from dbId → owned spell item. Built once per render so
   * the pool rows can mark themselves ✓ / + cheaply.
   *
   * The dbId is stored on every Dauligor-imported spell as
   * `flags.dauligor-pairing.entityId` (set by the importer pipeline
   * and re-stamped by this app when a row is added). Spells lacking
   * the flag don't appear in the map — they're considered "not in any
   * Dauligor class list" for this manager's purposes.
   */
  _getOwnedDbIdMap() {
    const map = new Map();
    for (const spell of this._getSpellItems()) {
      const dbId = getSpellEntityId(spell);
      if (dbId && !map.has(dbId)) map.set(dbId, spell);
    }
    return map;
  }

  _findOwnedSpellByDbId(dbId) {
    return this._getOwnedDbIdMap().get(String(dbId)) ?? null;
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
        ownedSpells: []
      };
      models.set(identifier, model);
      return model;
    };

    for (const [identifier, classItem] of Object.entries(spellcastingClasses)) {
      ensureModel(identifier, classItem);
    }

    // Group owned spells under the class they're attributed to so the
    // rail count reflects per-class membership. Spells without an
    // attribution land under "Other Spells".
    for (const spell of this._getSpellItems()) {
      const identifier = resolveSpellClassIdentifier(spell) || UNKNOWN_CLASS_IDENTIFIER;
      ensureModel(identifier).ownedSpells.push(spell);
    }

    return [...models.values()]
      .map((model) => {
        const sys = model.item?.system ?? {};
        const spellcasting = sys.spellcasting ?? {};
        const preparation = spellcasting.preparation ?? {};
        const progression = spellcasting.progression ?? "none";
        const ability = spellcasting.ability ?? "";
        const dc = Number(this._actor?.system?.attributes?.spelldc ?? 0)
          || Number(preparation.formula?.dc ?? 0)
          || 0;
        const atk = String(this._actor?.system?.attributes?.spellatk ?? spellcasting.attack?.formula ?? "");
        const cantripsCap = (spellcasting.cantrips?.max ?? spellcasting.cantrips?.value);
        const spellsCap = (spellcasting.spells?.max ?? spellcasting.spells?.value);
        return {
          ...model,
          progression,
          progressionLabel: describeSpellcastingProgression(progression),
          ability,
          abilityLabel: describeAbility(ability),
          levels: Number(model.item?.system?.levels ?? 0) || 0,
          preparation,
          preparationType: String(preparation.mode ?? "prepared"),
          dc: dc || null,
          atk,
          cantripsCap: (cantripsCap == null || cantripsCap === "") ? null : Number(cantripsCap),
          spellsCap: (spellsCap == null || spellsCap === "") ? null : Number(spellsCap),
          ownedCount: model.ownedSpells.length
        };
      })
      .sort((left, right) => {
        if (left.identifier === UNKNOWN_CLASS_IDENTIFIER) return 1;
        if (right.identifier === UNKNOWN_CLASS_IDENTIFIER) return -1;
        return left.label.localeCompare(right.label, undefined, { sensitivity: "base" });
      });
  }

  _ensureValidSelection(classModels = undefined) {
    const classes = classModels ?? this._buildClassModels();
    if (classes.length === 0) {
      this._state.selectedClassIdentifier = null;
      this._state.selectedSpellDbId = null;
      return;
    }
    const currentClass = classes.find((entry) => entry.identifier === this._state.selectedClassIdentifier);
    if (!currentClass) {
      this._state.selectedClassIdentifier = classes[0].identifier;
      this._state.selectedSpellDbId = null;
    }
  }

  // -----------------------------------------------------------------------
  // Live pool fetcher (unchanged contract from the legacy app)
  // -----------------------------------------------------------------------

  async _ensureClassPool(classModel) {
    if (!classModel?.identifier) return null;
    const key = classModel.identifier;
    const cached = this._classPools.get(key);
    if (cached) return cached;

    const classItem = classModel.item;
    const spellListUrl = classItem?.getFlag?.(MODULE_ID, "spellListUrl") ?? null;
    if (!spellListUrl) {
      const entry = {
        status: "missing",
        reason: "This class was imported before the live spell-list URL was tracked. Re-import it to populate the available-spells list.",
      };
      this._classPools.set(key, entry);
      return entry;
    }

    const loadingEntry = { status: "loading" };
    this._classPools.set(key, loadingEntry);

    (async () => {
      try {
        const response = await fetch(spellListUrl, { cache: "no-store" });
        if (!response.ok) {
          this._classPools.set(key, {
            status: "error",
            reason: `Spell list endpoint returned ${response.status}`,
          });
        } else {
          const payload = await response.json();
          if (payload?.kind !== "dauligor.class-spell-list.v1") {
            this._classPools.set(key, {
              status: "error",
              reason: `Unexpected payload kind: ${payload?.kind ?? "(missing)"}`,
            });
          } else {
            this._classPools.set(key, {
              status: "ready",
              spells: Array.isArray(payload.spells) ? payload.spells : [],
              fetchedAt: Date.now(),
            });
          }
        }
      } catch (err) {
        console.warn(`${MODULE_ID} | spell-list fetch failed`, { spellListUrl, err });
        this._classPools.set(key, {
          status: "error",
          reason: err?.message ?? "Network error",
        });
      }
      this._renderManager?.();
    })();

    return loadingEntry;
  }

  _getActivePool(classModel) {
    if (!classModel?.identifier) return [];
    const entry = this._classPools.get(classModel.identifier);
    if (!entry || entry.status !== "ready") return [];
    return entry.spells ?? [];
  }

  _getActivePoolStatus(classModel) {
    if (!classModel?.identifier) return null;
    return this._classPools.get(classModel.identifier) ?? null;
  }

  // -----------------------------------------------------------------------
  // Favorites store (actor flag)
  // -----------------------------------------------------------------------

  _getFavoriteDbIds() {
    const raw = this._actor?.getFlag?.(MODULE_ID, "spellFavorites") ?? [];
    return new Set(Array.isArray(raw) ? raw.map((v) => String(v)) : []);
  }

  async _toggleFavorite(dbId) {
    if (!this._actor || !dbId) return;
    const current = this._getFavoriteDbIds();
    if (current.has(dbId)) current.delete(dbId);
    else current.add(dbId);
    try {
      await this._actor.setFlag(MODULE_ID, "spellFavorites", [...current]);
    } catch (err) {
      console.warn(`${MODULE_ID} | favorite toggle failed`, err);
      notifyWarn("Could not update favorites — see console.");
      return;
    }
    await this._renderManager();
  }

  // -----------------------------------------------------------------------
  // Full-spell fetch + cache (for detail pane + add-to-sheet)
  // -----------------------------------------------------------------------

  async _ensureFullSpell(dbId, classModel) {
    if (!dbId) return null;
    if (this._fullSpellCache.has(dbId)) return this._fullSpellCache.get(dbId);
    if (this._fullSpellInFlight.has(dbId)) return null;

    const spellListUrl = classModel?.item?.getFlag?.(MODULE_ID, "spellListUrl") ?? null;
    if (!spellListUrl) return null;

    this._fullSpellInFlight.add(dbId);

    try {
      const full = await fetchFullSpellItem(spellListUrl, dbId);
      this._fullSpellInFlight.delete(dbId);
      if (full) {
        this._fullSpellCache.set(dbId, full);
        // Refresh the detail pane in-place if this fetch corresponded
        // to the currently selected row — typical case is the user
        // clicking through rows faster than the network responds.
        if (this._state.selectedSpellDbId === dbId) {
          this._renderDetail();
        }
        // Enrich the description asynchronously; once it lands, kick
        // a second `_renderDetail` so the panel swaps the raw HTML
        // for the enriched (link-resolved, BBCode-resolved) version.
        // Failures are non-fatal — the detail pane still renders the
        // raw body.
        this._enrichSpellDescription(dbId, full).catch((err) => {
          console.warn(`${MODULE_ID} | description enrich failed`, err);
        });
      }
      return full;
    } catch (err) {
      console.warn(`${MODULE_ID} | full spell fetch failed`, { dbId, err });
      this._fullSpellInFlight.delete(dbId);
      return null;
    }
  }

  /**
   * Run dnd5e's enrichHTML pass over a spell's description and stash
   * the result keyed by dbId. Cached so a re-select doesn't re-enrich.
   * If the currently-selected spell is the one we just enriched, kick
   * a render so the panel swaps in the resolved HTML.
   */
  async _enrichSpellDescription(dbId, fullSpell) {
    const raw = String(fullSpell?.system?.description?.value ?? "").trim();
    if (!raw) return;
    if (this._enrichedDescriptionCache.has(dbId)) return;
    const TextEditor = foundry.applications?.ux?.TextEditor?.implementation;
    if (!TextEditor?.enrichHTML) return;
    const enriched = await TextEditor.enrichHTML(raw, {
      // No rollData/relativeTo — these descriptions are read-only;
      // we want the inline references resolved but not roll-bound to
      // a specific actor.
      async: true,
      secrets: false
    });
    this._enrichedDescriptionCache.set(dbId, enriched);
    if (this._state.selectedSpellDbId === dbId) {
      this._renderDetail();
    }
  }

  // -----------------------------------------------------------------------
  // Filter helpers
  // -----------------------------------------------------------------------

  _activeFilterCount() {
    return this._state.lvlF.length
      + this._state.schoolF.length
      + this._state.sourceF.length
      + this._state.propF.length;
  }

  _resetFilters() {
    this._state.lvlF = [];
    this._state.schoolF = [];
    this._state.sourceF = [];
    this._state.propF = [];
    this._state.search = "";
  }

  _getFilteredPool(fullPool) {
    const search = this._state.search.trim().toLowerCase();
    const owned = this._getOwnedDbIdMap();
    return fullPool.filter((item) => {
      const flags = poolFlags(item);
      if (search && !poolName(item).toLowerCase().includes(search)) return false;
      if (this._state.lvlF.length && !this._state.lvlF.includes(poolLevel(item))) return false;
      if (this._state.schoolF.length && !this._state.schoolF.includes(poolSchool(item))) return false;
      if (this._state.sourceF.length && !this._state.sourceF.includes(poolSpellSourceId(item))) return false;
      if (this._state.propF.length) {
        const ownedItem = owned.get(poolDbId(item));
        for (const prop of this._state.propF) {
          if (prop === "ritual" && !flags.ritual) return false;
          if (prop === "concentration" && !flags.concentration) return false;
          if (prop === "known" && !ownedItem) return false;
          if (prop === "prepared") {
            if (!ownedItem) return false;
            if (!isCurrentlyPrepared(ownedItem) && !isAlwaysPrepared(ownedItem)) return false;
          }
        }
      }
      return true;
    });
  }

  _groupByLevel(items) {
    const m = new Map();
    for (const item of items) {
      const lv = poolLevel(item);
      if (!m.has(lv)) m.set(lv, []);
      m.get(lv).push(item);
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }

  _getSelectedSummary(fullPool) {
    if (!this._state.selectedSpellDbId) return null;
    return fullPool.find((item) => poolDbId(item) === this._state.selectedSpellDbId) ?? null;
  }

  // -----------------------------------------------------------------------
  // Add / Remove
  // -----------------------------------------------------------------------

  /**
   * Toggle a spell's membership on the actor's sheet. Adds when the
   * spell isn't owned, removes when it is. Locked rows (advancement-
   * granted or always-prepared) are skipped silently — the row click
   * still updates selection so the detail pane explains the lock.
   */
  async _toggleKnown(dbId, classModel) {
    if (!this._actor || !dbId) return;
    const owned = this._findOwnedSpellByDbId(dbId);

    if (owned) {
      if (isAdvancementGranted(owned)) {
        notifyWarn(`${owned.name} is granted by an advancement and can only be removed via the source class.`);
        return;
      }
      if (isAlwaysPrepared(owned)) {
        notifyWarn(`${owned.name} is always prepared and cannot be removed from this manager.`);
        return;
      }
      try {
        await this._actor.deleteEmbeddedDocuments("Item", [owned.id]);
        notifyInfo(`${owned.name} removed from sheet.`);
        await this._renderManager();
      } catch (err) {
        console.warn(`${MODULE_ID} | remove spell failed`, err);
        notifyWarn("Failed to remove spell — see console.");
      }
      return;
    }

    if (!classModel?.item) {
      notifyWarn("No active class to attribute this spell to.");
      return;
    }
    const spellListUrl = classModel.item.getFlag?.(MODULE_ID, "spellListUrl") ?? null;
    if (!spellListUrl) {
      notifyWarn("This class has no live spell-list URL. Re-import the class to enable picks.");
      return;
    }

    let full = this._fullSpellCache.get(dbId);
    if (!full) full = await this._ensureFullSpell(dbId, classModel);
    if (!full) {
      notifyWarn("Could not fetch the spell from Dauligor — see console.");
      return;
    }

    // Normalize the payload before embedding: stamp class attribution
    // via `system.sourceItem` (the v5.3+ replacement for the
    // deprecated `sourceClass`; format is "class:<identifier>") and
    // mirror onto `flags.dauligor-pairing.classIdentifier` for our
    // own owned-lookup paths. dnd5e's `system.classIdentifier` getter
    // derives from sourceItem at read time, so dnd5e's sheet groups
    // the spell under the right class section without us writing the
    // legacy field.
    const itemData = foundry.utils.deepClone(full);
    foundry.utils.setProperty(itemData, "system.sourceItem", `class:${classModel.identifier}`);
    if (!itemData.flags) itemData.flags = {};
    if (!itemData.flags[MODULE_ID]) itemData.flags[MODULE_ID] = {};
    itemData.flags[MODULE_ID].classIdentifier = classModel.identifier;
    itemData.flags[MODULE_ID].entityId = dbId;

    try {
      await this._actor.createEmbeddedDocuments("Item", [itemData]);
      notifyInfo(`${itemData.name} added to sheet.`);
      await this._renderManager();
    } catch (err) {
      console.warn(`${MODULE_ID} | add spell failed`, err);
      notifyWarn("Failed to add spell — see console.");
    }
  }

  // -----------------------------------------------------------------------
  // Render pipeline
  // -----------------------------------------------------------------------

  async _renderManager() {
    const classModels = this._buildClassModels();
    this._ensureValidSelection(classModels);
    const selectedClass = classModels.find((entry) => entry.identifier === this._state.selectedClassIdentifier) ?? null;

    // Kick off the live pool fetch if not yet cached. The async path
    // re-fires _renderManager when it lands.
    if (selectedClass) await this._ensureClassPool(selectedClass);

    const fullPool = this._getActivePool(selectedClass);
    const filteredPool = this._getFilteredPool(fullPool);

    // Auto-select first filtered row when nothing is selected or the
    // current selection falls outside the filter.
    if (filteredPool.length > 0) {
      const stillVisible = this._state.selectedSpellDbId
        && filteredPool.some((s) => poolDbId(s) === this._state.selectedSpellDbId);
      if (!stillVisible) {
        this._state.selectedSpellDbId = poolDbId(filteredPool[0]) || null;
      }
    } else {
      this._state.selectedSpellDbId = null;
    }

    const selectedSummary = this._getSelectedSummary(fullPool);
    if (selectedSummary) this._ensureFullSpell(this._state.selectedSpellDbId, selectedClass);

    this._renderRail(classModels, selectedClass);
    this._renderFavorites(fullPool, selectedClass);
    this._renderMeta(selectedClass, fullPool);
    this._renderToolbar(selectedClass, filteredPool, fullPool);
    this._renderDrawer(fullPool);
    this._renderPool(fullPool, filteredPool, selectedClass);
    this._renderDetail(selectedSummary, selectedClass);
  }

  // -----------------------------------------------------------------------
  // Sub-renders
  // -----------------------------------------------------------------------

  _renderRail(classModels, selectedClass) {
    if (!this._railRegion) return;

    if (!classModels.length) {
      this._railRegion.innerHTML = `
        <div class="dauligor-spell-manager__section-title">Classes</div>
        <div class="dauligor-spell-manager__empty">This actor has no spellcasting classes.</div>
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
        <span class="dauligor-spell-manager__class-meta">${entry.ownedCount}</span>
      </button>
    `).join("");

    this._railRegion.innerHTML = `
      <div class="dauligor-spell-manager__section-title">Classes</div>
      <div class="dauligor-spell-manager__class-list">${buttons}</div>
    `;

    this._railRegion.querySelectorAll(`[data-action="select-class"]`).forEach((button) => {
      button.addEventListener("click", () => {
        this._state.selectedClassIdentifier = button.dataset.classIdentifier ?? null;
        this._state.selectedSpellDbId = null;
        this._renderManager();
      });
    });
  }

  _renderFavorites(fullPool, selectedClass) {
    if (!this._favoritesRegion) return;

    const favIds = this._getFavoriteDbIds();
    const ownedMap = this._getOwnedDbIdMap();
    const favList = fullPool.filter((item) => favIds.has(poolDbId(item)));

    const header = `
      <div class="dauligor-spell-manager__favorites-header">
        <span class="dauligor-spell-manager__favorites-icon">★</span>
        <span class="dauligor-spell-manager__favorites-title">Favourites</span>
        <span class="dauligor-spell-manager__favorites-count">${favList.length}</span>
      </div>
    `;

    if (favList.length === 0) {
      this._favoritesRegion.innerHTML = `${header}
        <div class="dauligor-spell-manager__favorites-empty">
          <div class="dauligor-spell-manager__favorites-empty-icon">★</div>
          <div class="dauligor-spell-manager__favorites-empty-hint">Star spells in the middle column to pin them here.</div>
        </div>
      `;
      return;
    }

    const rows = favList.map((item) => this._buildPoolRowHtml(item, ownedMap, { showFav: false })).join("");
    this._favoritesRegion.innerHTML = `${header}
      <div class="dauligor-spell-manager__favorites-list">${rows}</div>
    `;
    this._bindPoolRows(this._favoritesRegion, selectedClass);
  }

  _renderMeta(selectedClass, fullPool) {
    if (!this._metaRegion) return;

    if (!selectedClass) {
      this._metaRegion.innerHTML = ``;
      return;
    }

    const ownedMap = this._getOwnedDbIdMap();
    const cantripsKnown = fullPool.filter((item) => poolLevel(item) === 0 && ownedMap.has(poolDbId(item))).length;
    const spellsKnown = fullPool.filter((item) => poolLevel(item) > 0 && ownedMap.has(poolDbId(item))).length;
    const prepLabel = PREPARATION_TYPE_LABELS[selectedClass.preparationType] || selectedClass.preparationType || "Spells";

    const cantripsBlock = (selectedClass.cantripsCap != null) ? `
      <div class="dauligor-spell-manager__meta-counter">
        <div class="dauligor-spell-manager__meta-counter-label">Cantrips</div>
        <div class="dauligor-spell-manager__meta-counter-value">${cantripsKnown}<span class="dauligor-spell-manager__meta-counter-cap"> / ${selectedClass.cantripsCap}</span></div>
      </div>
    ` : "";

    const spellsBlock = `
      <div class="dauligor-spell-manager__meta-counter">
        <div class="dauligor-spell-manager__meta-counter-label">Known</div>
        <div class="dauligor-spell-manager__meta-counter-value">${spellsKnown}${selectedClass.spellsCap != null ? `<span class="dauligor-spell-manager__meta-counter-cap"> / ${selectedClass.spellsCap}</span>` : ""}</div>
      </div>
    `;

    this._metaRegion.innerHTML = `
      <div class="dauligor-spell-manager__meta-left">
        <div class="dauligor-spell-manager__meta-title">
          <span class="dauligor-spell-manager__meta-class">${escapeHtml(selectedClass.label)}</span>
          <span class="dauligor-spell-manager__meta-chip">${escapeHtml(prepLabel)}</span>
        </div>
        <div class="dauligor-spell-manager__meta-stats">
          ${selectedClass.dc ? `<span class="dauligor-spell-manager__meta-stat">DC ${selectedClass.dc}</span>` : ""}
          ${selectedClass.atk ? `<span class="dauligor-spell-manager__meta-stat">Atk ${escapeHtml(selectedClass.atk)}</span>` : ""}
          ${selectedClass.progressionLabel ? `<span class="dauligor-spell-manager__meta-stat">${escapeHtml(selectedClass.progressionLabel)}</span>` : ""}
          ${selectedClass.abilityLabel ? `<span class="dauligor-spell-manager__meta-stat">${escapeHtml(selectedClass.abilityLabel)}</span>` : ""}
        </div>
      </div>
      <div class="dauligor-spell-manager__meta-right">${cantripsBlock}${spellsBlock}</div>
    `;
  }

  _renderToolbar(selectedClass, filteredPool, fullPool) {
    if (!this._toolbarRegion) return;

    const activeFilters = this._activeFilterCount();
    const filterOpen = this._state.filterOpen;
    const showReset = activeFilters > 0 || Boolean(this._state.search);

    const countHtml = fullPool.length === 0
      ? ""
      : `<span class="dauligor-spell-manager__pool-count">${filteredPool.length}${filteredPool.length !== fullPool.length ? ` <span class="dauligor-spell-manager__pool-count-total">/ ${fullPool.length}</span>` : ""}</span>`;

    this._toolbarRegion.innerHTML = `
      ${selectedClass ? "" : `<span class="dauligor-spell-manager__pool-toolbar-title">Spells</span>`}
      <input
        type="search"
        class="dauligor-spell-manager__pool-search"
        data-action="search"
        placeholder="Search spell name…"
        value="${escapeHtml(this._state.search)}"
        autocomplete="off"
      >
      <button type="button"
        class="dauligor-spell-manager__filter-button ${(filterOpen || activeFilters > 0) ? "dauligor-spell-manager__filter-button--active" : ""}"
        data-action="toggle-filters">
        Filters${activeFilters > 0 ? `<span class="dauligor-spell-manager__filter-count-badge">${activeFilters}</span>` : ""}
      </button>
      ${showReset ? `<button type="button" class="dauligor-spell-manager__reset-button" data-action="reset">✕ Reset</button>` : ""}
      ${countHtml}
    `;

    const searchInput = this._toolbarRegion.querySelector(`[data-action="search"]`);
    searchInput?.addEventListener("input", async (event) => {
      const cursorPos = event.currentTarget.selectionStart;
      this._state.search = event.currentTarget.value ?? "";
      await this._renderManager();
      // Restore focus after the re-render replaces the input element.
      const newInput = this._toolbarRegion?.querySelector(`[data-action="search"]`);
      if (newInput instanceof HTMLInputElement) {
        newInput.focus();
        try { newInput.setSelectionRange(cursorPos, cursorPos); } catch { /* noop */ }
      }
    });

    this._toolbarRegion.querySelector(`[data-action="toggle-filters"]`)?.addEventListener("click", async () => {
      this._state.filterOpen = !this._state.filterOpen;
      await this._renderManager();
    });

    this._toolbarRegion.querySelector(`[data-action="reset"]`)?.addEventListener("click", async () => {
      this._resetFilters();
      await this._renderManager();
    });
  }

  _renderDrawer(fullPool) {
    if (!this._drawerRegion) return;

    if (!this._state.filterOpen) {
      this._drawerRegion.innerHTML = ``;
      this._drawerRegion.classList.remove("dauligor-spell-manager__drawer--open");
      return;
    }
    this._drawerRegion.classList.add("dauligor-spell-manager__drawer--open");

    const schoolsInPool = [...new Set(fullPool.map(poolSchool).filter(Boolean))].sort();
    const sourcesInPool = [...new Set(fullPool.map(poolSpellSourceId).filter(Boolean))].sort();

    const levelSection = this._renderFilterChipSection({
      title: "Level",
      options: SPELL_LEVELS_ALL.map((l) => ({ v: String(l), l: l === 0 ? "Cantrip" : `Level ${l}` })),
      selected: this._state.lvlF.map((v) => String(v)),
      data: "level",
    });

    const schoolSection = schoolsInPool.length === 0 ? "" : this._renderFilterChipSection({
      title: "School",
      options: schoolsInPool.map((k) => ({ v: k, l: describeSpellSchoolAbbr(k) })),
      selected: this._state.schoolF,
      data: "school",
    });

    const sourceSection = sourcesInPool.length === 0 ? "" : this._renderFilterChipSection({
      title: "Source",
      options: sourcesInPool.map((sid) => ({ v: sid, l: String(sid).toUpperCase().slice(0, 5) })),
      selected: this._state.sourceF,
      data: "source",
    });

    const propSection = this._renderFilterChipSection({
      title: "Properties",
      options: PROPERTY_FILTERS,
      selected: this._state.propF,
      data: "prop",
    });

    this._drawerRegion.innerHTML = `
      ${levelSection}
      ${schoolSection}
      ${sourceSection}
      ${propSection}
    `;

    this._drawerRegion.querySelectorAll(`[data-action="chip-toggle"]`).forEach((chip) => {
      chip.addEventListener("click", async () => {
        const facet = chip.dataset.facet;
        const value = chip.dataset.value;
        if (!facet || value == null) return;
        const list = this._stateListForFacet(facet);
        if (!list) return;
        if (facet === "level") {
          const num = Number(value);
          if (list.includes(num)) this._state.lvlF = list.filter((v) => v !== num);
          else this._state.lvlF = [...list, num];
        } else {
          if (list.includes(value)) this._setStateListForFacet(facet, list.filter((v) => v !== value));
          else this._setStateListForFacet(facet, [...list, value]);
        }
        await this._renderManager();
      });
    });

    this._drawerRegion.querySelectorAll(`[data-action="chip-all"]`).forEach((btn) => {
      btn.addEventListener("click", async () => {
        const facet = btn.dataset.facet;
        if (facet === "level") this._state.lvlF = [...SPELL_LEVELS_ALL];
        else if (facet === "school") this._state.schoolF = [...new Set(fullPool.map(poolSchool).filter(Boolean))];
        else if (facet === "source") this._state.sourceF = [...new Set(fullPool.map(poolSpellSourceId).filter(Boolean))];
        else if (facet === "prop") this._state.propF = PROPERTY_FILTERS.map((p) => p.v);
        await this._renderManager();
      });
    });

    this._drawerRegion.querySelectorAll(`[data-action="chip-clear"]`).forEach((btn) => {
      btn.addEventListener("click", async () => {
        const facet = btn.dataset.facet;
        if (facet === "level") this._state.lvlF = [];
        else if (facet === "school") this._state.schoolF = [];
        else if (facet === "source") this._state.sourceF = [];
        else if (facet === "prop") this._state.propF = [];
        await this._renderManager();
      });
    });
  }

  _stateListForFacet(facet) {
    if (facet === "level") return this._state.lvlF;
    if (facet === "school") return this._state.schoolF;
    if (facet === "source") return this._state.sourceF;
    if (facet === "prop") return this._state.propF;
    return null;
  }

  _setStateListForFacet(facet, value) {
    if (facet === "level") this._state.lvlF = value;
    else if (facet === "school") this._state.schoolF = value;
    else if (facet === "source") this._state.sourceF = value;
    else if (facet === "prop") this._state.propF = value;
  }

  _renderFilterChipSection({ title, options, selected, data }) {
    const selectedSet = new Set(selected.map((v) => String(v)));
    const chips = options.map((opt) => {
      const isSel = selectedSet.has(String(opt.v));
      return `
        <button
          type="button"
          class="dauligor-spell-manager__filter-chip ${isSel ? "dauligor-spell-manager__filter-chip--selected" : ""}"
          data-action="chip-toggle"
          data-facet="${escapeHtml(data)}"
          data-value="${escapeHtml(String(opt.v))}"
        >${escapeHtml(opt.l)}</button>
      `;
    }).join("");

    return `
      <div class="dauligor-spell-manager__filter-section">
        <div class="dauligor-spell-manager__filter-section-header">
          <span class="dauligor-spell-manager__filter-section-title">${escapeHtml(title)}</span>
          <span class="dauligor-spell-manager__filter-shortcuts">
            <button type="button" class="dauligor-spell-manager__filter-shortcut" data-action="chip-all" data-facet="${escapeHtml(data)}">All</button>
            <button type="button" class="dauligor-spell-manager__filter-shortcut" data-action="chip-clear" data-facet="${escapeHtml(data)}">Clear</button>
          </span>
        </div>
        <div class="dauligor-spell-manager__filter-chips">${chips}</div>
      </div>
    `;
  }

  _renderPool(fullPool, filteredPool, selectedClass) {
    if (!this._poolRegion) return;

    if (!selectedClass) {
      this._poolRegion.innerHTML = `<div class="dauligor-spell-manager__empty">Select a class on the left to browse its spells.</div>`;
      return;
    }

    const poolStatus = this._getActivePoolStatus(selectedClass);
    if (!poolStatus || poolStatus.status === "loading") {
      this._poolRegion.innerHTML = `<div class="dauligor-spell-manager__empty">Loading class spell list…</div>`;
      return;
    }
    if (poolStatus.status === "missing") {
      this._poolRegion.innerHTML = `<div class="dauligor-spell-manager__empty">${escapeHtml(poolStatus.reason)}</div>`;
      return;
    }
    if (poolStatus.status === "error") {
      this._poolRegion.innerHTML = `<div class="dauligor-spell-manager__empty">Failed to load class spell list: ${escapeHtml(poolStatus.reason)}</div>`;
      return;
    }

    if (fullPool.length === 0) {
      this._poolRegion.innerHTML = `<div class="dauligor-spell-manager__empty">No spells curated for this class yet. Curate the list at <code>/compendium/spell-lists</code> in Dauligor.</div>`;
      return;
    }

    if (filteredPool.length === 0) {
      this._poolRegion.innerHTML = `<div class="dauligor-spell-manager__empty">No spells match the current filters.</div>`;
      return;
    }

    const ownedMap = this._getOwnedDbIdMap();
    const grouped = this._groupByLevel(filteredPool);

    const bandsHtml = grouped.map(([level, items]) => `
      <section class="dauligor-spell-manager__pool-band">
        <div class="dauligor-spell-manager__pool-band-header">
          <span class="dauligor-spell-manager__pool-band-name">${escapeHtml(describeSpellLevel(level))}</span>
          <span class="dauligor-spell-manager__pool-band-count">${items.length}</span>
        </div>
        <div class="dauligor-spell-manager__pool-band-list">
          ${items.map((item) => this._buildPoolRowHtml(item, ownedMap, { showFav: true })).join("")}
        </div>
      </section>
    `).join("");

    this._poolRegion.innerHTML = bandsHtml;
    this._bindPoolRows(this._poolRegion, selectedClass);
  }

  _buildPoolRowHtml(item, ownedMap, { showFav = true } = {}) {
    const dbId = poolDbId(item);
    const ownedItem = ownedMap.get(dbId);
    const isOwned = !!ownedItem;
    const isAlways = ownedItem ? isAlwaysPrepared(ownedItem) : false;
    const isGranted = ownedItem ? isAdvancementGranted(ownedItem) : false;
    const isLocked = isOwned && (isAlways || isGranted);
    const isSelected = this._state.selectedSpellDbId === dbId;
    const favIds = this._getFavoriteDbIds();
    const isFav = favIds.has(dbId);
    const flags = poolFlags(item);
    const school = poolSchool(item);
    const schoolAbbr = describeSpellSchoolAbbr(school);
    // Source code is hidden — the summary only ships the raw D1
    // source UUID prefix (e.g. "JOIOF"), which is not human-readable.
    // Proper resolution against `/api/module/sources/catalog.json` is
    // a server-side polish item; for now the source slot is empty so
    // we don't show gibberish.
    const sourceAbbr = "";
    const ritual = flags.ritual;
    const concentration = flags.concentration;

    // Indicator is purely informational now — actual add/remove
    // happens via explicit buttons in the detail pane. The row click
    // only updates selection.
    let indicator = "+";
    let indicatorTitle = "Not on sheet";
    if (isAlways) { indicator = "✦"; indicatorTitle = "Always prepared"; }
    else if (isGranted) { indicator = "✓"; indicatorTitle = "Granted by an advancement"; }
    else if (isOwned) { indicator = "✓"; indicatorTitle = "On sheet"; }

    const rowClasses = [
      "dauligor-spell-manager__pool-row",
      isSelected && "dauligor-spell-manager__pool-row--selected",
      isOwned && "dauligor-spell-manager__pool-row--owned",
      isLocked && "dauligor-spell-manager__pool-row--locked",
    ].filter(Boolean).join(" ");

    const badges = [];
    if (ritual) badges.push(`<span class="dauligor-spell-manager__row-badge" title="Ritual">R</span>`);
    if (concentration) badges.push(`<span class="dauligor-spell-manager__row-badge" title="Concentration">C</span>`);

    return `
      <div class="${rowClasses}" data-action="row" data-db-id="${escapeHtml(dbId)}" title="Click to view details">
        <span class="dauligor-spell-manager__row-indicator" title="${escapeHtml(indicatorTitle)}">${indicator}</span>
        <span class="dauligor-spell-manager__row-name">${escapeHtml(poolName(item))}</span>
        <span class="dauligor-spell-manager__row-badges">${badges.join("")}</span>
        <span class="dauligor-spell-manager__row-school" title="${escapeHtml(school)}">${escapeHtml(schoolAbbr)}</span>
        <span class="dauligor-spell-manager__row-source">${escapeHtml(sourceAbbr)}</span>
        ${showFav ? `
          <button type="button"
            class="dauligor-spell-manager__row-star ${isFav ? "dauligor-spell-manager__row-star--active" : ""}"
            data-action="star" data-db-id="${escapeHtml(dbId)}"
            title="${isFav ? "Unfavourite" : "Favourite"}">★</button>
        ` : ""}
      </div>
    `;
  }

  _bindPoolRows(container, _classModel) {
    container.querySelectorAll(`[data-action="row"]`).forEach((row) => {
      row.addEventListener("click", (event) => {
        // Don't process the row click when it bubbled up from the
        // favourite-star button (the star handles its own toggle).
        if ((event.target instanceof HTMLElement) && event.target.closest(`[data-action="star"]`)) return;
        const dbId = row.dataset.dbId;
        if (!dbId) return;
        // Selection only — no add/remove from row clicks. Add and
        // remove are explicit buttons in the detail pane.
        if (this._state.selectedSpellDbId === dbId) return;
        this._state.selectedSpellDbId = dbId;
        this._renderManager();
      });
    });

    container.querySelectorAll(`[data-action="star"]`).forEach((btn) => {
      btn.addEventListener("click", async (event) => {
        event.stopPropagation();
        const dbId = btn.dataset.dbId;
        if (!dbId) return;
        await this._toggleFavorite(dbId);
      });
    });
  }

  _renderDetail(summaryArg = undefined, classArg = undefined) {
    if (!this._detailRegion) return;

    // Allow the in-flight full-spell fetch to call us without args —
    // we'll re-resolve the selection from current state in that case.
    let summary = summaryArg;
    let classModel = classArg;
    if (summary === undefined || classModel === undefined) {
      const classModels = this._buildClassModels();
      classModel = classModels.find((entry) => entry.identifier === this._state.selectedClassIdentifier) ?? null;
      const fullPool = this._getActivePool(classModel);
      summary = this._getSelectedSummary(fullPool);
    }

    if (!summary) {
      this._detailRegion.innerHTML = `
        <div class="dauligor-spell-manager__detail-empty">
          <div class="dauligor-spell-manager__detail-empty-title">No spell selected</div>
          <div class="dauligor-spell-manager__detail-empty-hint">Click a row in the middle column to inspect its details and add it to the sheet.</div>
        </div>
      `;
      return;
    }

    const dbId = poolDbId(summary);
    const full = this._fullSpellCache.get(dbId) ?? null;
    const ownedItem = this._findOwnedSpellByDbId(dbId);
    const flags = poolFlags(summary);

    // Description / activity meta come from the full payload. While
    // we wait for the fetch the header + level/school strip render
    // from the summary alone so the panel doesn't visibly empty out.
    // Once enriched HTML lands in the cache, swap that in so
    // `&Reference[...]`, `[[/roll ...]]`, etc. become live widgets.
    const enrichedHtml = this._enrichedDescriptionCache.get(dbId);
    const description = enrichedHtml
      ?? String(full?.system?.description?.value ?? "").trim();
    const schoolLabel = describeSpellSchool(poolSchool(summary));
    const levelLabel = describeSpellLevel(poolLevel(summary));

    const ritual = Boolean(flags.ritual);
    const concentration = Boolean(flags.concentration);
    const activation = String(flags.activationBucket || "").replace(/-/g, " ");
    const range = String(flags.rangeBucket || "").replace(/-/g, " ");
    const duration = String(flags.durationBucket || "").replace(/-/g, " ");
    const shape = String(flags.shapeBucket || "").replace(/-/g, " ");
    const componentsBits = [];
    if (flags.componentsVocal) componentsBits.push("V");
    if (flags.componentsSomatic) componentsBits.push("S");
    if (flags.componentsMaterial) componentsBits.push("M");
    const components = componentsBits.join("·");

    const isOwned = Boolean(ownedItem);
    const isAlways = ownedItem ? isAlwaysPrepared(ownedItem) : false;
    const isGranted = ownedItem ? isAdvancementGranted(ownedItem) : false;
    const isLocked = isOwned && (isAlways || isGranted);

    const ownerLine = isOwned
      ? `On sheet${isAlways ? " · Always prepared" : isGranted ? " · Granted by advancement" : isCurrentlyPrepared(ownedItem) ? " · Prepared" : ""}`
      : "Not on sheet";

    // Tags are stored on the summary as opaque DB ids (e.g. "00001"),
    // which aren't useful to display directly. We'd need a tag catalog
    // resolver (or a `tagNames` field on the summary) to render them
    // as the human-readable chips the compendium page uses. Hidden
    // for now; tracked as a server-side polish item.
    const tagLine = "";

    const descriptionHtml = full
      ? (description
        ? `<div class="dauligor-spell-manager__detail-body">${description}</div>`
        : `<div class="dauligor-spell-manager__detail-body dauligor-spell-manager__empty">No description stored on this spell.</div>`)
      : `<div class="dauligor-spell-manager__detail-body dauligor-spell-manager__empty">Loading description…</div>`;

    // Action buttons: add OR remove OR disabled-locked-reason. The
    // row click never mutates owned-state — these are the only entry
    // points for adding / removing a spell from the sheet.
    const className = classModel?.label ?? "this class";
    let actionsHtml = "";
    if (!classModel) {
      actionsHtml = `<button type="button" class="dauligor-spell-manager__detail-action dauligor-spell-manager__detail-action--locked" disabled>Select a class</button>`;
    } else if (isAlways) {
      actionsHtml = `<button type="button" class="dauligor-spell-manager__detail-action dauligor-spell-manager__detail-action--locked" disabled>Always prepared — managed by class</button>`;
    } else if (isGranted) {
      actionsHtml = `<button type="button" class="dauligor-spell-manager__detail-action dauligor-spell-manager__detail-action--locked" disabled>Granted by an advancement</button>`;
    } else if (isOwned) {
      actionsHtml = `<button type="button" class="dauligor-spell-manager__detail-action dauligor-spell-manager__detail-action--remove" data-action="remove-spell">Remove from ${escapeHtml(className)}</button>`;
    } else {
      actionsHtml = `<button type="button" class="dauligor-spell-manager__detail-action dauligor-spell-manager__detail-action--add" data-action="add-spell">Add to ${escapeHtml(className)}</button>`;
    }

    this._detailRegion.innerHTML = `
      <div class="dauligor-spell-manager__detail-card">
        <div class="dauligor-spell-manager__detail-heading">${escapeHtml(summary.name)}</div>
        <div class="dauligor-spell-manager__detail-meta">
          <span>${escapeHtml(levelLabel)}</span>
          <span>${escapeHtml(schoolLabel)}</span>
          ${ritual ? `<span title="Ritual">Ritual</span>` : ""}
          ${concentration ? `<span title="Concentration">Concentration</span>` : ""}
        </div>
        <div class="dauligor-spell-manager__detail-actions">${actionsHtml}</div>
        <dl class="dauligor-spell-manager__detail-grid">
          ${activation ? `<dt>Activation</dt><dd>${escapeHtml(activation)}</dd>` : ""}
          ${range ? `<dt>Range</dt><dd>${escapeHtml(range)}</dd>` : ""}
          ${duration ? `<dt>Duration</dt><dd>${escapeHtml(duration)}</dd>` : ""}
          ${shape ? `<dt>Shape</dt><dd>${escapeHtml(shape)}</dd>` : ""}
          ${components ? `<dt>Components</dt><dd>${escapeHtml(components)}</dd>` : ""}
          <dt>Status</dt><dd>${escapeHtml(ownerLine)}</dd>
          ${classModel?.label ? `<dt>Active class</dt><dd>${escapeHtml(classModel.label)}</dd>` : ""}
          ${tagLine}
        </dl>
        ${descriptionHtml}
      </div>
    `;

    // Bind detail action buttons. Both call _toggleKnown which
    // dispatches by current owned-state — single source of truth for
    // the add/remove side-effects.
    const dbIdForAction = dbId;
    const classForAction = classModel;
    this._detailRegion.querySelector(`[data-action="add-spell"]`)?.addEventListener("click", async () => {
      await this._toggleKnown(dbIdForAction, classForAction);
    });
    this._detailRegion.querySelector(`[data-action="remove-spell"]`)?.addEventListener("click", async () => {
      await this._toggleKnown(dbIdForAction, classForAction);
    });
  }
}
