import { MODULE_ID, SPELL_PREPARATION_TEMPLATE } from "./constants.js";
import { notifyInfo, notifyWarn } from "./utils.js";
import { fetchFullSpellItem } from "./class-import-service.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const UNKNOWN_CLASS_IDENTIFIER = "__other__";

// ---------------------------------------------------------------------------
// Filter-bucket constants — mirror src/lib/spellFilters.ts so the manager's
// filter modal offers the SAME chip vocabulary as /compendium/spells. Keep
// values in lockstep with the app's authoritative source-of-truth file.
// ---------------------------------------------------------------------------

const SPELL_LEVELS_ALL = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

const SCHOOL_LABELS = {
  abj: "Abjuration",
  con: "Conjuration",
  div: "Divination",
  enc: "Enchantment",
  evo: "Evocation",
  ill: "Illusion",
  nec: "Necromancy",
  trs: "Transmutation"
};
const SCHOOL_ORDER = ["abj", "con", "div", "enc", "evo", "ill", "nec", "trs"];

const ACTIVATION_LABELS = {
  action: "Action",
  bonus: "Bonus Action",
  reaction: "Reaction",
  minute: "Minute",
  hour: "Hour",
  special: "Special"
};
const ACTIVATION_ORDER = ["action", "bonus", "reaction", "minute", "hour", "special"];

const RANGE_LABELS = {
  self: "Self",
  touch: "Touch",
  "5ft": "Close (≤5 ft)",
  "30ft": "Short (6–30 ft)",
  "60ft": "Medium (31–60 ft)",
  "120ft": "Long (61–120 ft)",
  long: "Far (>120 ft / sight)",
  other: "Special"
};
const RANGE_ORDER = ["self", "touch", "5ft", "30ft", "60ft", "120ft", "long", "other"];

const DURATION_LABELS = {
  inst: "Instantaneous",
  round: "Round",
  minute: "Minute",
  hour: "Hour",
  day: "Day",
  perm: "Permanent",
  special: "Special"
};
const DURATION_ORDER = ["inst", "round", "minute", "hour", "day", "perm", "special"];

const SHAPE_LABELS = {
  cone: "Cone",
  cube: "Cube",
  cylinder: "Cylinder",
  line: "Line",
  radius: "Radius",
  sphere: "Sphere",
  square: "Square",
  wall: "Wall",
  none: "None"
};
const SHAPE_ORDER = ["cone", "cube", "cylinder", "line", "radius", "sphere", "square", "wall", "none"];

const PROPERTY_LABELS = {
  concentration: "Concentration",
  ritual: "Ritual",
  vocal: "Verbal (V)",
  somatic: "Somatic (S)",
  material: "Material (M)"
};
const PROPERTY_ORDER = ["concentration", "ritual", "vocal", "somatic", "material"];

// Preparation-mode labels — used on the meta strip's "type" chip.
const PREP_TYPE_LABELS = {
  prepared: "Prepared Caster",
  known: "Known Caster",
  spellbook: "Spellbook Caster"
};

const PROGRESSION_LABELS = {
  full: "Full Caster",
  half: "Half Caster",
  third: "Third Caster",
  pact: "Pact Magic",
  artificer: "Artificer",
  none: ""
};

// ---------------------------------------------------------------------------
// sheetMode — three on-sheet states managed by this manager. Persisted as
// `flags.dauligor-pairing.sheetMode` on each spell item. Source of truth
// for counter accounting in the meta strip + indicator/highlight logic in
// the pool rows.
//
//   "prepared"  → counts vs prep cap (prepared casters) / known cap (known
//                 casters) / prepared cap (spellbook casters).
//                 dnd5e: system.prepared = true, system.method = "spell".
//                 Indicator: filled circle; row highlighted.
//   "spellbook" → in spellbook only (Wizard). Counts vs spellbook cap but
//                 NOT vs prepared cap.
//                 dnd5e: system.prepared = false, system.method = "spell".
//                 Indicator: book icon; row NOT highlighted.
//   "free"      → on the sheet, doesn't count vs any cap. Granted by
//                 racial / feat / item, or just user choice.
//                 dnd5e: system.prepared = true, system.method = "spell".
//                 (Previously used method="always" — that surfaced
//                 the spell as "Always Prepared" in dnd5e's editor,
//                 which doesn't match the user's intent for "on sheet
//                 but doesn't count vs caps." The Dauligor flag is
//                 the cap-accounting source of truth; method stays at
//                 "spell" so dnd5e's per-spell editor reads as a
//                 normal class spell.)
//                 Indicator: filled circle; row NOT highlighted.
// ---------------------------------------------------------------------------

const SHEET_MODE_PREPARED  = "prepared";
const SHEET_MODE_SPELLBOOK = "spellbook";
const SHEET_MODE_FREE      = "free";
const DEFAULT_SHEET_MODE   = SHEET_MODE_PREPARED;

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

function isAlwaysPrepared(spell) {
  if (!spell) return false;
  const method = String(spell?.system?.method ?? "").trim();
  if (method === "always") return true;
  // Back-compat with pre-v5 numeric prepared state.
  const prepared = Number(spell?.system?.prepared ?? 0);
  return Number.isFinite(prepared) && prepared >= 2;
}

function isCurrentlyPrepared(spell) {
  if (!spell) return false;
  const sys = spell.system ?? {};
  if (sys.prepared === true) return true;
  const prepared = Number(sys.prepared ?? 0);
  return Number.isFinite(prepared) && prepared >= 1;
}

function isAdvancementGranted(spell) {
  if (!spell) return false;
  return Boolean(spell.getFlag?.(MODULE_ID, "grantedByAdvancementId"));
}

function resolveSpellClassIdentifier(spell) {
  const flag = spell?.getFlag?.(MODULE_ID, "classIdentifier");
  if (flag) return String(flag).trim();
  const derived = spell?.system?.classIdentifier;
  if (derived) return String(derived).trim();
  return "";
}

function getSpellEntityId(spell) {
  return String(spell?.getFlag?.(MODULE_ID, "entityId") ?? "").trim();
}

/**
 * Resolve the sheetMode on an owned spell item. Reads the explicit
 * module flag first; falls back to a deriveable state from dnd5e's
 * `prepared` field for spells that predate this flag. (We used to
 * also derive sheetMode="free" from `system.method === "always"`,
 * but we no longer stamp that — see the sheetMode comment block.)
 */
function getSheetMode(spell) {
  if (!spell) return DEFAULT_SHEET_MODE;
  const flag = spell.getFlag?.(MODULE_ID, "sheetMode");
  if (flag === SHEET_MODE_PREPARED
      || flag === SHEET_MODE_SPELLBOOK
      || flag === SHEET_MODE_FREE) {
    return flag;
  }
  const sys = spell.system ?? {};
  if (sys.prepared === false) return SHEET_MODE_SPELLBOOK;
  return SHEET_MODE_PREPARED;
}

/**
 * Compose the dnd5e + module-flag patch for putting a spell into a
 * given sheetMode. Used by `_setSheetMode` and the add-spell flow.
 * All three modes stamp `system.method = "spell"` — the cap-accounting
 * distinction is OUR Dauligor flag, not dnd5e's method.
 */
function buildSheetModePatch(mode) {
  if (mode === SHEET_MODE_SPELLBOOK) {
    return {
      "system.prepared": false,
      "system.method": "spell",
      [`flags.${MODULE_ID}.sheetMode`]: SHEET_MODE_SPELLBOOK
    };
  }
  if (mode === SHEET_MODE_FREE) {
    return {
      "system.prepared": true,
      "system.method": "spell",
      [`flags.${MODULE_ID}.sheetMode`]: SHEET_MODE_FREE
    };
  }
  return {
    "system.prepared": true,
    "system.method": "spell",
    [`flags.${MODULE_ID}.sheetMode`]: SHEET_MODE_PREPARED
  };
}

// ----- Pool-summary readers (item is summary JSON, not Foundry doc) --------

function poolFlags(item) {
  return item?.flags?.["dauligor-pairing"] ?? {};
}
function poolDbId(item)         { return String(poolFlags(item).dbId ?? ""); }
function poolLevel(item)        { return Number(poolFlags(item).level ?? 0) || 0; }
function poolSchool(item)       { return String(poolFlags(item).school ?? ""); }
function poolSpellSourceId(item){ return String(poolFlags(item).spellSourceId ?? ""); }
function poolName(item)         { return String(item?.name ?? ""); }
function poolActivation(item)   { return String(poolFlags(item).activationBucket ?? ""); }
function poolRange(item)        { return String(poolFlags(item).rangeBucket ?? ""); }
function poolDuration(item)     { return String(poolFlags(item).durationBucket ?? ""); }
function poolShape(item)        { return String(poolFlags(item).shapeBucket ?? ""); }

function describeSpellLevel(level) {
  const label = localizeConfigValue(CONFIG.DND5E.spellLevels?.[level]);
  return level === 0 ? (label || "Cantrips") : (label || `Level ${level}`);
}

function describeSpellSchool(school) {
  const entry = CONFIG.DND5E.spellSchools?.[school];
  const label = (entry && typeof entry === "object") ? entry.label : entry;
  return localizeConfigValue(label ?? SCHOOL_LABELS[school] ?? school ?? "");
}

function describeAbility(ability) {
  return localizeConfigValue(
    CONFIG.DND5E.abilities?.[ability]?.label
    ?? CONFIG.DND5E.abilities?.[ability]
    ?? ability
    ?? ""
  );
}

function describeAbilityAbbr(ability) {
  return String(ability || "").toUpperCase().slice(0, 3);
}

/**
 * Resolve a class's preparation type ("prepared" / "known" / "spellbook").
 *
 * Priority order:
 *   1. Live class bundle cache (`_classBundleCache`) — fetched on
 *      manager open from `/api/module/<source>/classes/<class>.json`.
 *      The bundle ships `class.spellcasting.type` directly (the
 *      authoritative D1 value, see `docs/spell-picker-by-type.md`).
 *   2. Module flag stamped at import time
 *      (`flags.dauligor-pairing.spellcasting.type`) — present on
 *      imports done after May 2026.
 *   3. Heuristic fallback used only when neither is available.
 *
 * Pure module-level helper kept for callers that just need a quick
 * read off the class item itself (no async). The Application's
 * `_classifyPrepType` method is the bundle-aware version that walks
 * `_classBundleCache` first.
 */
function classifyPrepTypeFromFlag(classModel) {
  const item = classModel?.item;
  if (!item) return "prepared";
  const flag = item.getFlag?.(MODULE_ID, "spellcasting") ?? {};
  const explicit = String(flag.type ?? "").toLowerCase();
  if (explicit === "spellbook" || explicit === "known" || explicit === "prepared") return explicit;
  const id = String(classModel.identifier ?? "").toLowerCase();
  if (id === "wizard" || id === "artificer") return "spellbook";
  // dnd5e's preparation.mode is "always" for known casters (set by
  // normalizeSpellPreparationMode at import time) and "prepared" for
  // both prepared and spellbook types. So mode === "always" is a
  // reliable "known" tell; anything else falls through to prepared.
  const mode = String(item?.system?.spellcasting?.preparation?.mode ?? "").toLowerCase();
  if (mode === "always") return "known";
  return "prepared";
}

/**
 * Resolve a human-readable progression label from a stored
 * progression slug (e.g. "full" → "Full Caster"). dnd5e config
 * usually has a localized label so fall back to that when present.
 */
function describeProgression(progression) {
  if (!progression) return "";
  const localized = localizeConfigValue(CONFIG.DND5E.spellcastingProgression?.[progression]);
  if (localized) return localized;
  return PROGRESSION_LABELS[progression] ?? "";
}

// ---------------------------------------------------------------------------
// Activation / range / duration / components — labels from the summary
// flags. Mirror src/lib/spellImport.ts's format* helpers but consume the
// pre-computed bucket strings (we don't have the raw Foundry shape on
// the summary).
// ---------------------------------------------------------------------------

function formatActivationLabel(item) {
  return ACTIVATION_LABELS[poolActivation(item)] ?? "—";
}
function formatRangeLabel(item) {
  return RANGE_LABELS[poolRange(item)] ?? "—";
}
function formatDurationLabel(item) {
  return DURATION_LABELS[poolDuration(item)] ?? "—";
}
function formatComponentsLabel(item) {
  const flags = poolFlags(item);
  const bits = [];
  if (flags.componentsVocal)    bits.push("V");
  if (flags.componentsSomatic)  bits.push("S");
  if (flags.componentsMaterial) bits.push("M");
  return bits.length ? bits.join(", ") : "—";
}

// ---------------------------------------------------------------------------
// Public open() helper
// ---------------------------------------------------------------------------

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
 * Sheet-side spell preparation manager. Three-column body (sidebar
 * with classes + favorites, middle pool, right detail) plus a footer
 * with explicit add buttons (Prepare / Add to Sheet / Add to Spellbook
 * / Close).
 *
 * Data flow:
 *   - Per-class pool: live `/api/module/<source>/classes/<class>/spells.json`
 *     via the `spellListUrl` flag on the class item.
 *   - Detail pane: full Foundry-ready item lazy-fetched from
 *     `/api/module/spells/<dbId>.json` and cached per dbId for the
 *     lifetime of the open manager.
 *   - Sources catalog: fetched on open from
 *     `/api/module/sources/catalog.json` so the detail header + row
 *     source chips can render shortName (PHB, XGE, …) instead of the
 *     opaque D1 source id.
 *   - Favorites: `actor.flags.dauligor-pairing.spellFavorites` as
 *     `dbId[]`. Survives reload, spans classes.
 *   - sheetMode: `flags.dauligor-pairing.sheetMode` on each spell item.
 *     Source of truth for counter accounting + indicator state.
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

  /**
   * Mount the Prepare Spells manager INSIDE an external DOM element
   * instead of its own ApplicationV2 window. Used by the Feature
   * Manager's Spells tab to embed the manager UI inline.
   *
   * The instance is NOT registered as the singleton — the standalone
   * window and the embedded mount can coexist on a given actor.
   * Caller is responsible for cleanup: when the embedding container
   * is replaced (e.g. tab switch), call `destroyEmbedded()` on the
   * returned instance.
   */
  static async renderInto(container, { actor, preselectClassIdentifier = null } = {}) {
    if (!actor || !(container instanceof HTMLElement)) return null;
    const instance = new this({ actor, preselectClassIdentifier });
    instance._embeddedRoot = container;
    instance._isEmbedded = true;
    // Resolve the shell template path via Foundry's template loader so
    // the same compiled template the standalone window uses fires here.
    // `renderTemplate` is the v13 global; the AppV2 namespace exposes
    // it as well as a fallback.
    const renderTpl = foundry.applications?.handlebars?.renderTemplate
      ?? globalThis.renderTemplate
      ?? null;
    if (!renderTpl) {
      console.warn(`${MODULE_ID} | renderTemplate not available — cannot embed Prepare Spells manager.`);
      return null;
    }
    const html = await renderTpl(SPELL_PREPARATION_TEMPLATE, {});
    container.innerHTML = html;
    // Drive the same lifecycle the window flow uses — `_onRender`
    // queries the region elements + kicks the catalog loads.
    await instance._onRender();
    return instance;
  }

  /**
   * Tear down an embedded mount. Clears the host container's HTML
   * and drops region references so a subsequent `renderInto` call
   * starts clean. Safe to call when not embedded — no-op.
   */
  destroyEmbedded() {
    if (!this._isEmbedded) return;
    if (this._embeddedRoot instanceof HTMLElement) {
      this._embeddedRoot.innerHTML = "";
    }
    this._railRegion = null;
    this._favoritesRegion = null;
    this._metaRegion = null;
    this._toolbarRegion = null;
    this._poolRegion = null;
    this._detailRegion = null;
    this._footerRegion = null;
    this._filterModalRegion = null;
    this._embeddedRoot = null;
    this._isEmbedded = false;
  }

  constructor({
    actor,
    preselectClassIdentifier = null,
    // mode === "sheet" (default) is the actor-side Prepare Spells
    // manager. mode === "importer" is the standalone Spell Browser
    // launched from the Dauligor Importer wizard — it browses every
    // spell published in the selected source(s) and imports them with
    // NO class attachment, so they land in the alt sheet's
    // `__other__` "Other Spells" orphan bucket. The two modes share
    // the bulk of the rendering pipeline; mode-specific branches live
    // in `_buildClassModels`, `_ensureClassPool`, `_renderRail`,
    // `_renderMeta`, `_renderFooter`, and `_applySheetMode`.
    mode = "sheet",
    sourceSlugs = null,
    appId = null,
    windowTitle = null
  } = {}) {
    const isImporter = mode === "importer";
    super({
      id: appId ?? `${MODULE_ID}-spell-preparation`,
      classes: [
        "dauligor-importer-app",
        "dauligor-importer-app--spells",
        isImporter ? "dauligor-importer-app--spells-browser" : "dauligor-importer-app--spells-sheet"
      ],
      window: {
        title: windowTitle ?? (actor ? `Prepare Spells: ${actor.name}` : "Prepare Spells"),
        resizable: true,
        contentClasses: ["dauligor-importer-window"]
      },
      position: {
        width: Math.min(window.innerWidth - 80, 1480),
        height: Math.min(window.innerHeight - 80, 820)
      }
    });

    // ── Mode-state ───────────────────────────────────────────────────
    // `_mode` is the cap-accounting + UX shape. "sheet" is the
    // class-scoped manager used from the actor sheet; "importer" is
    // the standalone Spell Browser launched from the Dauligor
    // Importer wizard.
    this._mode = isImporter ? "importer" : "sheet";
    // Importer-mode source slugs (e.g. ["phb", "xge"]). Each becomes a
    // pseudo-class-model with `isSource: true` so the rail can show
    // the source list instead of an actor class list, and
    // `_ensureClassPool` swaps to the per-source endpoint.
    this._sourceSlugs = Array.isArray(sourceSlugs) ? sourceSlugs.map(String) : [];
    // Source-slug → label override (e.g. "phb" → "PHB"). Populated as
    // the sources catalog resolves. Falls back to the slug itself.
    this._sourceLabels = new Map();

    this._template = SPELL_PREPARATION_TEMPLATE;
    this._actor = actor ?? null;
    this._state = {
      // Pool list state (per-class)
      poolSearch: "",
      poolFilters: { axes: {} },
      onSheetFilter: false,

      // Favorites list state (independent search + filter)
      favSearch: "",
      favFilters: { axes: {} },

      // Filter modal — null when closed, "pool" or "favorites" when open.
      filterModalOpen: null,

      // Selection
      selectedClassIdentifier: preselectClassIdentifier ?? null,
      selectedSpellDbId: null,

      // Detail-pane disclosures
      showTags: false
    };

    // Live per-class pool cache.
    this._classPools = new Map();
    // Lazy full-spell cache (dbId → Foundry-ready item).
    this._fullSpellCache = new Map();
    this._fullSpellInFlight = new Set();
    this._enrichedDescriptionCache = new Map();

    // Per-class bundle cache. Keyed by class identifier. The bundle
    // ships `class.spellcasting.type` (the authoritative D1 type:
    // "prepared" / "known" / "spellbook") plus the formula + cantrip
    // scaling refs the manager uses for counter accounting. We hit
    // this endpoint at manager-open time so the meta strip can pick
    // the right counter set (prepared vs known vs spellbook) even
    // for classes imported before our module flag was added.
    // Shape: Map<identifier, { status: "loading"|"ready"|"missing", spellcasting?: object }>
    this._classBundles = new Map();

    // Foundation catalogs (lazy, loaded once per manager open).
    //
    // Sources catalog — keyed by the public semantic id
    // ("source-phb-2014"). Both endpoints (sources catalog AND the
    // class spell-list summary) publish source ids in this format:
    // the catalog publishes its synthesized `s.semanticId`, and the
    // spell-summary endpoint resolves `spells.source_id` through
    // the same `getSemanticSourceId` helper before shipping (see
    // `api/_lib/_classSpellList.ts`). The raw D1 PK is never exposed.
    this._sourcesById = null;       // Map<semanticId, { shortName, name }>
    this._sourcesInFlight = false;

    // Tags catalog — mirrors what /compendium/spells loads via
    // `fetchCollection('tags' / 'tagGroups')`. Filtered server-side
    // to spell-classified tag groups. Used to:
    //   - Resolve `tagIds` on spell summaries to readable names.
    //   - Render a Tag-group filter section in the modal.
    // Shape:
    //   { tagsById: Map<id, { id, name, groupId, parentTagId }>,
    //     tagGroups: [{ id, name, classifications }],
    //     tagsByGroup: Map<groupId, tag[]> }
    this._tagCatalog = null;
    this._tagCatalogInFlight = false;

    // Detail-pane scroll preservation state. Tracks the last dbId we
    // rendered; if the next render is the SAME dbId (e.g. user
    // toggled Show Tags or clicked Prepare on the currently-selected
    // spell), we restore the scroll position. Different dbId means
    // the user selected a new spell — reset to top.
    this._lastDetailDbId = null;
  }

  _configureRenderParts() {
    return { main: { template: this._template } };
  }

  async close(options) {
    // Embedded mode: there's no window to close — just tear down the
    // embed. The host (e.g. the Feature Manager's Spells tab) calls
    // `destroyEmbedded()` separately when the tab switches; closing
    // here mirrors the footer "Close" button behaviour.
    if (this._isEmbedded) {
      this.destroyEmbedded();
      return;
    }
    // Use `this.constructor._instance` so subclasses (e.g.
    // `DauligorSpellBrowserApp`) clear their OWN singleton, not the
    // base class's. The base class previously hard-coded
    // `DauligorSpellPreparationApp._instance`, which leaked the
    // browser instance after close.
    if (this.constructor._instance === this) this.constructor._instance = null;
    return super.close(options);
  }

  setActor(actor, preselectClassIdentifier = null) {
    const changedActor = this._actor?.id !== actor?.id;
    this._actor = actor ?? null;
    this.options.window.title = this._actor ? `Prepare Spells: ${this._actor.name}` : "Prepare Spells";
    if (changedActor) {
      this._classPools.clear();
      this._classBundles.clear();
      this._fullSpellCache.clear();
      this._fullSpellInFlight.clear();
      this._enrichedDescriptionCache.clear();
      this._state.selectedSpellDbId = null;
      this._lastDetailDbId = null;
    }
    if (preselectClassIdentifier) {
      this._state.selectedClassIdentifier = preselectClassIdentifier;
      this._state.selectedSpellDbId = null;
    }
  }

  _getRootElement() {
    // Embedded mode (e.g. the Feature Manager's Spells tab body):
    // the manager renders into an external container instead of its
    // own window. `_embeddedRoot` is set by `renderInto()` before
    // the first render pass.
    if (this._embeddedRoot instanceof HTMLElement) return this._embeddedRoot;
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
    this._railRegion        = content.querySelector(`[data-region="rail"]`);
    this._favoritesRegion   = content.querySelector(`[data-region="favorites"]`);
    this._metaRegion        = content.querySelector(`[data-region="meta"]`);
    this._toolbarRegion     = content.querySelector(`[data-region="toolbar"]`);
    this._poolRegion        = content.querySelector(`[data-region="pool"]`);
    this._detailRegion      = content.querySelector(`[data-region="detail"]`);
    this._footerRegion      = content.querySelector(`[data-region="footer"]`);
    this._filterModalRegion = content.querySelector(`[data-region="filter-modal"]`);

    // Kick the foundation catalog loads (idempotent — only fire once
    // per manager session). Sources catalog feeds the source labels
    // on chips + detail; tag catalog resolves tag ids to names + drives
    // the Tag-group filter section.
    this._ensureSourcesCatalog();
    this._ensureTagCatalog();

    await this._renderManager();
  }

  // -----------------------------------------------------------------------
  // Foundation: sources catalog (PHB / XGE / …)
  // -----------------------------------------------------------------------

  _ensureSourcesCatalog() {
    if (this._sourcesById || this._sourcesInFlight) return;
    this._sourcesInFlight = true;
    (async () => {
      try {
        const response = await fetch("https://www.dauligor.com/api/module/sources/catalog.json", { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        const map = new Map();
        for (const entry of (payload?.entries ?? [])) {
          const semanticId = String(entry?.sourceId ?? "");
          if (!semanticId) continue;
          map.set(semanticId, {
            shortName: String(entry.shortName ?? entry.slug ?? entry.name ?? ""),
            name: String(entry.name ?? entry.shortName ?? "")
          });
        }
        this._sourcesById = map;
        // Re-render so source chips pick up the new labels.
        this._renderManager?.();
      } catch (err) {
        console.warn(`${MODULE_ID} | sources catalog fetch failed`, err);
        this._sourcesById = new Map();   // mark as "tried; empty"
      } finally {
        this._sourcesInFlight = false;
      }
    })();
  }

  // -----------------------------------------------------------------------
  // Foundation: tag catalog (spell-classified tags + tag groups)
  // -----------------------------------------------------------------------

  _ensureTagCatalog() {
    if (this._tagCatalog || this._tagCatalogInFlight) return;
    this._tagCatalogInFlight = true;
    (async () => {
      try {
        const response = await fetch("https://www.dauligor.com/api/module/tags/catalog.json", { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        if (payload?.kind !== "dauligor.tag-catalog.v1") {
          throw new Error(`Unexpected tag-catalog kind: ${payload?.kind ?? "(missing)"}`);
        }
        const tagsById = new Map();
        const tagsByGroup = new Map();
        for (const tag of (payload.tags ?? [])) {
          if (!tag?.id) continue;
          tagsById.set(String(tag.id), {
            id: String(tag.id),
            name: String(tag.name ?? ""),
            groupId: String(tag.groupId ?? ""),
            parentTagId: tag.parentTagId ? String(tag.parentTagId) : null
          });
          const gid = String(tag.groupId ?? "");
          if (!gid) continue;
          if (!tagsByGroup.has(gid)) tagsByGroup.set(gid, []);
          tagsByGroup.get(gid).push(tagsById.get(String(tag.id)));
        }
        const tagGroups = (payload.tagGroups ?? []).map((g) => ({
          id: String(g.id),
          name: String(g.name ?? ""),
          classifications: Array.isArray(g.classifications) ? g.classifications.map(String) : []
        }));
        this._tagCatalog = { tagsById, tagGroups, tagsByGroup };
        this._renderManager?.();
      } catch (err) {
        console.warn(`${MODULE_ID} | tag catalog fetch failed`, err);
        this._tagCatalog = { tagsById: new Map(), tagGroups: [], tagsByGroup: new Map() };
      } finally {
        this._tagCatalogInFlight = false;
      }
    })();
  }

  /** Resolve a tag id to its human-readable name (empty string when not loaded). */
  _tagName(tagId) {
    return this._tagCatalog?.tagsById?.get(String(tagId ?? ""))?.name ?? "";
  }

  /**
   * Resolve a source id (semantic OR legacy) to its short
   * abbreviation. The sources catalog is keyed on both kinds of id,
   * so a single lookup handles both `source-phb-2014` and the legacy
   * Firestore-style ids `6lJGQvtAIbUSSJ1tG6cg` that the spell summary
   * currently ships.
   */
  _sourceShortName(sourceId) {
    const entry = this._sourcesById?.get(String(sourceId ?? ""));
    if (!entry) return "";
    return entry.shortName || entry.name || "";
  }

  /**
   * Full (long-form) source name — used as the tooltip on the
   * short-name chip so hovering "PHB" reveals "Player's Handbook".
   * Falls back to the shortName when the catalog has no separate
   * full name on the entry.
   */
  _sourceFullName(sourceId) {
    const entry = this._sourcesById?.get(String(sourceId ?? ""));
    if (!entry) return "";
    return entry.name || entry.shortName || "";
  }

  // -----------------------------------------------------------------------
  // Class bundle fetch — authoritative source for `class.spellcasting.type`
  // -----------------------------------------------------------------------

  /**
   * Derive the class bundle URL from a class item's `spellListUrl`
   * flag. The decoupling refactor split the bundle into two endpoints
   * (`<class>.json` for the bundle, `<class>/spells.json` for the
   * live list) — so the bundle URL is the spell-list URL minus the
   * `/spells.json` suffix.
   */
  _resolveClassBundleUrl(classModel) {
    // Importer-mode source-models have no class bundle (they're not
    // tied to a class item). Skip the lookup — the meta strip's
    // bundle-aware prep-type resolver short-circuits to "no class".
    if (classModel?.isSource) return null;
    const spellListUrl = classModel?.item?.getFlag?.(MODULE_ID, "spellListUrl") ?? null;
    if (!spellListUrl) return null;
    return String(spellListUrl).replace(/\/spells\.json(\?.*)?$/i, ".json");
  }

  /**
   * Kick (idempotently) a class-bundle fetch and cache the result.
   * The bundle ships `class.spellcasting` — including `type` —
   * authoritatively from the D1 row. Used by `_classifyPrepType` so
   * the meta strip's prep-type label + footer button visibility
   * reflect the true class definition rather than guessing from
   * dnd5e's preparation.mode (which collapses prepared+spellbook).
   *
   * Stamps a cache entry as soon as the fetch finishes (success or
   * failure), then triggers `_renderManager` so the UI picks up the
   * authoritative value on the next tick.
   */
  _ensureClassBundle(classModel) {
    if (!classModel?.identifier) return null;
    const key = classModel.identifier;
    const cached = this._classBundles.get(key);
    if (cached) return cached;

    const bundleUrl = this._resolveClassBundleUrl(classModel);
    if (!bundleUrl) {
      const entry = { status: "missing", reason: "No spellListUrl flag on class item" };
      this._classBundles.set(key, entry);
      return entry;
    }

    const loadingEntry = { status: "loading" };
    this._classBundles.set(key, loadingEntry);

    (async () => {
      try {
        const response = await fetch(bundleUrl, { cache: "no-store" });
        if (!response.ok) {
          this._classBundles.set(key, { status: "error", reason: `HTTP ${response.status}` });
        } else {
          const payload = await response.json();
          // Semantic class export: `payload.class.spellcasting`.
          // Older bundles may put spellcasting on `payload.spellcasting`
          // directly — accept both.
          const spellcasting = payload?.class?.spellcasting ?? payload?.spellcasting ?? null;
          this._classBundles.set(key, {
            status: "ready",
            spellcasting,
            // Cache the whole payload too so future readers (cantrip
            // scaling, formula) can use it without a refetch.
            payload
          });
        }
      } catch (err) {
        console.warn(`${MODULE_ID} | class bundle fetch failed`, { bundleUrl, err });
        this._classBundles.set(key, { status: "error", reason: err?.message ?? "Network error" });
      }
      // Re-render so the meta strip can show the authoritative
      // prep-type label once the bundle lands.
      this._renderManager?.();
    })();

    return loadingEntry;
  }

  /**
   * Bundle-aware prep-type resolver. Reads the cached bundle first
   * (authoritative D1 type), falls back to flag/dnd5e/heuristic via
   * `classifyPrepTypeFromFlag`.
   */
  _classifyPrepType(classModel) {
    const cached = this._classBundles.get(classModel?.identifier);
    if (cached?.status === "ready") {
      const type = String(cached.spellcasting?.type ?? "").toLowerCase();
      if (type === "prepared" || type === "known" || type === "spellbook") return type;
    }
    return classifyPrepTypeFromFlag(classModel);
  }

  // -----------------------------------------------------------------------
  // Class models + actor introspection
  // -----------------------------------------------------------------------

  _getActorClasses()  { return this._actor?.classes ?? {}; }
  _getSpellItems()    { return this._actor?.itemTypes?.spell ? [...this._actor.itemTypes.spell] : []; }

  /**
   * Actor-wide dbId → spell map. Class-agnostic — used in places that
   * legitimately need to see all owned spells (e.g. the favourites
   * synthesis fallback when a favourited dbId isn't in any current
   * class pool). Callers that care about "is this spell on the sheet
   * AS A <class> SPELL" must use `_getOwnedDbIdMapForClass` instead.
   *
   * Spells with no classIdentifier attribution land under
   * `__other__`. When multiple instances of the same dbId exist (e.g.
   * the player has Blade Ward as both a Bard and a Wizard spell on
   * the actor), the actor-wide map keeps the first one we hit —
   * that's fine for the synthesis-fallback use case.
   */
  _getOwnedDbIdMap() {
    const map = new Map();
    for (const spell of this._getSpellItems()) {
      const dbId = getSpellEntityId(spell);
      if (dbId && !map.has(dbId)) map.set(dbId, spell);
    }
    return map;
  }

  /**
   * Per-class dbId → spell map. The pool / favourites indicator
   * (filled circle / 📖) lights up only when this class owns the
   * spell, so adding Blade Ward to Bard doesn't make it look "on
   * sheet" in Wizard's pool. Mutations (add / remove / toggle prepared)
   * scope here too so the two copies stay independent.
   */
  _getOwnedDbIdMapForClass(classIdentifier) {
    const map = new Map();
    if (!classIdentifier) return map;
    for (const spell of this._getSpellItems()) {
      const id = resolveSpellClassIdentifier(spell) || UNKNOWN_CLASS_IDENTIFIER;
      if (id !== classIdentifier) continue;
      const dbId = getSpellEntityId(spell);
      if (dbId && !map.has(dbId)) map.set(dbId, spell);
    }
    return map;
  }

  /** Actor-wide lookup. Use sparingly — most callers want per-class. */
  _findOwnedSpellByDbId(dbId) {
    return this._getOwnedDbIdMap().get(String(dbId)) ?? null;
  }

  /** Per-class lookup. Returns the spell only when this class owns it. */
  _findOwnedSpellByDbIdForClass(dbId, classIdentifier) {
    return this._getOwnedDbIdMapForClass(classIdentifier).get(String(dbId)) ?? null;
  }

  _buildClassModels() {
    const actor = this._actor;
    if (!actor) return [];

    // Importer mode: return pseudo-class-models built from the source
    // slugs the user picked in the wizard. Each acts like a class for
    // the rail / pool / detail render but carries `isSource: true` so
    // mode-specific branches (pool URL, footer, mutations) can detect
    // it. No actor classes are walked — the browser is class-agnostic.
    if (this._mode === "importer") {
      return this._sourceSlugs.map((slug) => {
        const label = this._sourceLabels.get(slug) || this._sourceShortName(`source-${slug}-2014`) || String(slug).toUpperCase();
        return {
          identifier: `__source__:${slug}`,
          label,
          item: null,
          ownedSpells: [],
          isSource: true,
          sourceSlug: slug,
          progression: "none",
          progressionLabel: "",
          ability: "",
          abilityLabel: "",
          abilityAbbr: "",
          levels: 0,
          preparation: {},
          prepType: null,
          prepTypeLabel: "",
          dc: null,
          atk: "",
          cantripsCap: null,
          spellsCap: null,
          ownedCount: 0
        };
      });
    }

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
        const classLevel = Number(model.item?.system?.levels ?? 0) || 0;
        const prepType = this._classifyPrepType(model);

        // Spell + cantrip caps. Source of truth depends on prep type:
        //   - "known": per-level scaling stamped at import time as
        //     `flags.dauligor-pairing.spellcasting.spellsKnownLevels`
        //     (the same data shown in the Class Editor's Spells Known
        //     column). Falls back to the bundle cache when the flag
        //     hasn't been stamped yet (older imports). Cap = the
        //     level's `spellsKnown`; cantripsCap = `cantrips`.
        //   - "prepared" / "spellbook": dnd5e's preparation.max for
        //     the prepared cap (set by the import's formula). Cantrip
        //     cap from `spellcasting.cantrips.max`.
        const moduleFlagSpellcasting = model.item?.getFlag?.(MODULE_ID, "spellcasting")
          ?? model.item?.flags?.[MODULE_ID]?.spellcasting
          ?? {};
        const bundleEntry = this._classBundles?.get(model.identifier);
        const bundleSpellcasting = bundleEntry?.status === "ready" ? bundleEntry.spellcasting : null;
        const bundleSourceId = bundleSpellcasting?.spellsKnownSourceId
          ?? moduleFlagSpellcasting?.spellsKnownSourceId
          ?? null;
        const bundleScalings = bundleEntry?.payload?.spellsKnownScalings ?? null;
        const bundleLevels = bundleSourceId && bundleScalings
          ? (bundleScalings[bundleSourceId]?.levels ?? null)
          : null;
        const flagLevels = moduleFlagSpellcasting.spellsKnownLevels ?? null;
        const scalingForLevel = (() => {
          for (const source of [flagLevels, bundleLevels]) {
            if (!source) continue;
            const entry = source[classLevel] ?? source[String(classLevel)];
            if (entry) return entry;
          }
          return null;
        })();

        let cantripsCapRaw = spellcasting.cantrips?.max ?? spellcasting.cantrips?.value;
        let spellsCapRaw = preparation.max ?? spellcasting.spells?.max ?? spellcasting.spells?.value;

        if (prepType === "known") {
          // Known casters: scaling is the authoritative cap. Override
          // whatever dnd5e left in `preparation.max` (which is empty
          // for `preparation.mode === "always"`).
          const scaledSpells = Number(scalingForLevel?.spellsKnown);
          if (Number.isFinite(scaledSpells) && scaledSpells > 0) {
            spellsCapRaw = scaledSpells;
          }
        }
        // For ANY class with scaling data, prefer scaling cantrip cap
        // over an unset dnd5e value. Cantrips are author-set per-level
        // in the same scaling row so this is the same source the
        // editor's "Cantrips Known" column shows.
        const scaledCantrips = Number(scalingForLevel?.cantrips);
        if ((cantripsCapRaw == null || cantripsCapRaw === "") && Number.isFinite(scaledCantrips) && scaledCantrips > 0) {
          cantripsCapRaw = scaledCantrips;
        }

        return {
          ...model,
          progression,
          progressionLabel: describeProgression(progression),
          ability,
          abilityLabel: describeAbility(ability),
          abilityAbbr: describeAbilityAbbr(ability),
          levels: classLevel,
          preparation,
          prepType,
          prepTypeLabel: PREP_TYPE_LABELS[prepType] ?? "Caster",
          dc: dc || null,
          atk,
          cantripsCap: (cantripsCapRaw == null || cantripsCapRaw === "") ? null : Number(cantripsCapRaw),
          spellsCap: (spellsCapRaw == null || spellsCapRaw === "") ? null : Number(spellsCapRaw),
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
  // Per-class spell list (live pool)
  // -----------------------------------------------------------------------

  async _ensureClassPool(classModel) {
    if (!classModel?.identifier) return null;
    const key = classModel.identifier;
    const cached = this._classPools.get(key);
    if (cached) return cached;

    // Importer-mode pseudo-class-model: fetch the source spell-list
    // endpoint instead of a class-specific spell list. Both endpoints
    // ship the same lightweight summary shape (kind discriminator
    // differs — "dauligor.source-spell-list.v1" vs
    // "dauligor.class-spell-list.v1") so the picker reads the result
    // the same way.
    if (classModel.isSource) {
      const slug = classModel.sourceSlug;
      const host = this._resolveApiHost();
      const url = `${host}/api/module/${encodeURIComponent(slug)}/spells.json`;
      const loadingEntry = { status: "loading" };
      this._classPools.set(key, loadingEntry);
      (async () => {
        try {
          const response = await fetch(url, { cache: "no-store" });
          if (!response.ok) {
            this._classPools.set(key, { status: "error", reason: `Source spell list endpoint returned ${response.status}` });
          } else {
            const payload = await response.json();
            if (payload?.kind !== "dauligor.source-spell-list.v1") {
              this._classPools.set(key, { status: "error", reason: `Unexpected payload kind: ${payload?.kind ?? "(missing)"}` });
            } else {
              this._classPools.set(key, {
                status: "ready",
                spells: Array.isArray(payload.spells) ? payload.spells : [],
                fetchedAt: Date.now(),
                sourceSemanticId: payload.sourceSemanticId ?? null
              });
            }
          }
        } catch (err) {
          console.warn(`${MODULE_ID} | source spell-list fetch failed`, { url, err });
          this._classPools.set(key, { status: "error", reason: err?.message ?? "Network error" });
        }
        this._renderManager?.();
      })();
      return loadingEntry;
    }

    const classItem = classModel.item;
    const spellListUrl = classItem?.getFlag?.(MODULE_ID, "spellListUrl") ?? null;
    if (!spellListUrl) {
      const entry = {
        status: "missing",
        reason: "This class was imported before the live spell-list URL was tracked. Re-import it to populate the available-spells list."
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
          this._classPools.set(key, { status: "error", reason: `Spell list endpoint returned ${response.status}` });
        } else {
          const payload = await response.json();
          if (payload?.kind !== "dauligor.class-spell-list.v1") {
            this._classPools.set(key, { status: "error", reason: `Unexpected payload kind: ${payload?.kind ?? "(missing)"}` });
          } else {
            this._classPools.set(key, {
              status: "ready",
              spells: Array.isArray(payload.spells) ? payload.spells : [],
              fetchedAt: Date.now()
            });
          }
        }
      } catch (err) {
        console.warn(`${MODULE_ID} | spell-list fetch failed`, { spellListUrl, err });
        this._classPools.set(key, { status: "error", reason: err?.message ?? "Network error" });
      }
      this._renderManager?.();
    })();

    return loadingEntry;
  }

  /**
   * Resolve the API host based on the module setting. Used by the
   * importer-mode pool fetch + the per-spell fetch fallback.
   * Mirrors the importer's host resolution so all module endpoints
   * agree on the same root.
   */
  _resolveApiHost() {
    try {
      const mode = game.settings.get(MODULE_ID, "api-endpoint-mode") || "local";
      return mode === "production" ? "https://www.dauligor.com" : "http://localhost:3000";
    } catch {
      return "https://www.dauligor.com";
    }
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

  /**
   * Build a union pool that covers favorites — pulls from EVERY known
   * class's live pool so favourites can survive a class swap, plus
   * any owned spell that's been favourited but isn't in any current
   * pool (e.g. removed from class list after being favourited).
   */
  _buildFavoritesPool(allClassModels) {
    const favIds = this._getFavoriteDbIds();
    if (favIds.size === 0) return [];

    const seen = new Set();
    const out = [];

    for (const model of allClassModels) {
      const pool = this._getActivePool(model);
      for (const item of pool) {
        const id = poolDbId(item);
        if (!favIds.has(id) || seen.has(id)) continue;
        seen.add(id);
        out.push(item);
      }
    }

    // Owned-but-not-in-any-current-pool favourites — synthesize a
    // light summary from the owned spell item so they still display.
    if (seen.size < favIds.size) {
      const owned = this._getOwnedDbIdMap();
      for (const id of favIds) {
        if (seen.has(id)) continue;
        const spell = owned.get(id);
        if (!spell) continue;
        const sys = spell.system ?? {};
        const components = sys.properties ?? {};
        out.push({
          name: spell.name ?? "",
          type: "spell",
          flags: {
            "dauligor-pairing": {
              dbId: id,
              level: Number(sys.level ?? 0) || 0,
              school: String(sys.school ?? ""),
              spellSourceId: "",
              componentsVocal: components instanceof Set ? components.has("vocal") : !!sys.components?.vocal,
              componentsSomatic: components instanceof Set ? components.has("somatic") : !!sys.components?.somatic,
              componentsMaterial: components instanceof Set ? components.has("material") : !!sys.components?.material,
              ritual: components instanceof Set ? components.has("ritual") : !!sys.components?.ritual,
              concentration: components instanceof Set ? components.has("concentration") : !!sys.components?.concentration,
              activationBucket: "",
              rangeBucket: "",
              durationBucket: "",
              shapeBucket: ""
            }
          }
        });
        seen.add(id);
      }
    }

    return out;
  }

  // -----------------------------------------------------------------------
  // Full-spell fetch + cache
  // -----------------------------------------------------------------------

  async _ensureFullSpell(dbId, classModelLike) {
    if (!dbId) return null;
    if (this._fullSpellCache.has(dbId)) return this._fullSpellCache.get(dbId);
    if (this._fullSpellInFlight.has(dbId)) return null;

    // We accept any classModel for the URL; if the current selection
    // doesn't have one (e.g. a favourite from a removed class), we
    // walk other classes for any spell-list URL we can borrow. In
    // importer mode the class model is a source pseudo-model with
    // no spellListUrl, so the URL walk yields nothing — fall through
    // to `_ensureFullSpellAnyway` which synthesizes from the module
    // host setting.
    let spellListUrl = classModelLike?.item?.getFlag?.(MODULE_ID, "spellListUrl") ?? null;
    if (!spellListUrl) {
      for (const model of this._buildClassModels()) {
        const url = model.item?.getFlag?.(MODULE_ID, "spellListUrl");
        if (url) { spellListUrl = url; break; }
      }
    }
    if (!spellListUrl) {
      // No actor classes (or none with a URL) → use the synthesized
      // per-spell endpoint via the module host setting. Same payload,
      // same cache, just a different URL derivation.
      return this._ensureFullSpellAnyway(dbId, classModelLike);
    }

    this._fullSpellInFlight.add(dbId);
    try {
      const full = await fetchFullSpellItem(spellListUrl, dbId);
      this._fullSpellInFlight.delete(dbId);
      if (full) {
        this._fullSpellCache.set(dbId, full);
        if (this._state.selectedSpellDbId === dbId) this._renderDetail();
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

  async _enrichSpellDescription(dbId, fullSpell) {
    const raw = String(fullSpell?.system?.description?.value ?? "").trim();
    if (!raw) return;
    if (this._enrichedDescriptionCache.has(dbId)) return;
    const TextEditor = foundry.applications?.ux?.TextEditor?.implementation;
    if (!TextEditor?.enrichHTML) return;
    const enriched = await TextEditor.enrichHTML(raw, { async: true, secrets: false });
    this._enrichedDescriptionCache.set(dbId, enriched);
    if (this._state.selectedSpellDbId === dbId) this._renderDetail();
  }

  // -----------------------------------------------------------------------
  // Filtering — shared axis chip semantics
  // -----------------------------------------------------------------------

  _filterStateFor(target) {
    return target === "favorites" ? this._state.favFilters : this._state.poolFilters;
  }
  _setFilterStateFor(target, value) {
    if (target === "favorites") this._state.favFilters = value;
    else this._state.poolFilters = value;
  }
  _searchFor(target) {
    return target === "favorites" ? this._state.favSearch : this._state.poolSearch;
  }
  _setSearchFor(target, value) {
    if (target === "favorites") this._state.favSearch = value;
    else this._state.poolSearch = value;
  }

  _activeFilterCount(target) {
    const f = this._filterStateFor(target);
    let n = 0;
    for (const axis of Object.values(f.axes ?? {})) {
      n += Object.keys(axis.states ?? {}).filter((k) => axis.states[k]).length;
    }
    return n;
  }

  _resetFilters(target) {
    this._setFilterStateFor(target, { axes: {} });
    this._setSearchFor(target, "");
    if (target === "pool") this._state.onSheetFilter = false;
  }

  /** Toggle a chip on the given axis between selected / unselected. */
  _toggleChip(target, axis, value) {
    const state = this._filterStateFor(target);
    const axes = { ...(state.axes ?? {}) };
    const current = axes[axis] ?? { states: {} };
    const states = { ...(current.states ?? {}) };
    if (states[String(value)]) delete states[String(value)];
    else states[String(value)] = 1;
    axes[axis] = { ...current, states };
    this._setFilterStateFor(target, { ...state, axes });
  }

  /**
   * Match an item against a single axis filter. Returns true when the
   * axis has no chips selected ("match anything") or when the item's
   * value is among the selected chip set.
   */
  _matchesAxis(item, target, axis, valueGetter) {
    const state = this._filterStateFor(target);
    const axisState = state.axes?.[axis];
    const selected = axisState?.states ?? {};
    const keys = Object.keys(selected).filter((k) => selected[k]);
    if (keys.length === 0) return true;
    const v = String(valueGetter(item));
    return keys.includes(v);
  }

  _matchesProperties(item, target) {
    const state = this._filterStateFor(target);
    const axisState = state.axes?.property;
    const selected = axisState?.states ?? {};
    const keys = Object.keys(selected).filter((k) => selected[k]);
    if (keys.length === 0) return true;
    const flags = poolFlags(item);
    for (const key of keys) {
      if (key === "concentration" && !flags.concentration) return false;
      if (key === "ritual"        && !flags.ritual)        return false;
      if (key === "vocal"         && !flags.componentsVocal)    return false;
      if (key === "somatic"       && !flags.componentsSomatic)  return false;
      if (key === "material"      && !flags.componentsMaterial) return false;
    }
    return true;
  }

  /**
   * Tag-group filter matching. Each tag group is its own filter axis
   * with axis key `tag:<groupId>`. A spell matches when, for every
   * group with at least one chip selected, ANY of the spell's tagIds
   * (with ancestor-expansion via `parentTagId`, mirroring the app's
   * `expandTagsWithAncestors`) is among the selected chips.
   *
   * Matches the public /compendium/spells include-OR semantics (the
   * app's UI also supports AND / XOR per group via combineMode, but
   * the manager keeps the simpler OR-within-axis model from the rest
   * of its filters for consistency).
   */
  _matchesTagGroups(item, target) {
    if (!this._tagCatalog) return true;
    const state = this._filterStateFor(target);
    const itemTagIds = Array.isArray(poolFlags(item).tagIds) ? poolFlags(item).tagIds : [];
    if (itemTagIds.length === 0) {
      // Spell has no tags — fails any group that has chips selected.
      for (const group of this._tagCatalog.tagGroups) {
        const axisKey = `tag:${group.id}`;
        const axisState = state.axes?.[axisKey];
        const selected = axisState?.states ?? {};
        if (Object.keys(selected).some((k) => selected[k])) return false;
      }
      return true;
    }

    // Ancestor-expand the spell's tagIds so a parent-tag chip matches
    // a spell carrying any subtag of it.
    const expanded = new Set(itemTagIds.map(String));
    const tagsById = this._tagCatalog.tagsById;
    for (const id of itemTagIds) {
      let cursor = tagsById.get(String(id));
      while (cursor?.parentTagId) {
        if (expanded.has(cursor.parentTagId)) break;
        expanded.add(cursor.parentTagId);
        cursor = tagsById.get(cursor.parentTagId);
      }
    }

    for (const group of this._tagCatalog.tagGroups) {
      const axisKey = `tag:${group.id}`;
      const axisState = state.axes?.[axisKey];
      const selected = axisState?.states ?? {};
      const selectedKeys = Object.keys(selected).filter((k) => selected[k]);
      if (selectedKeys.length === 0) continue;
      if (!selectedKeys.some((tid) => expanded.has(String(tid)))) return false;
    }
    return true;
  }

  /**
   * Apply search + axis filters. Optionally narrow to an explicit set
   * of dbIds (used by the "On Sheet" toggle to restrict the pool to
   * spells already attributed to the active class).
   */
  _filterList(items, target, { restrictSet = null } = {}) {
    const search = this._searchFor(target).trim().toLowerCase();
    return items.filter((item) => {
      if (search && !poolName(item).toLowerCase().includes(search)) return false;
      if (restrictSet && !restrictSet.has(poolDbId(item))) return false;
      if (!this._matchesAxis(item, target, "level",      poolLevel))            return false;
      if (!this._matchesAxis(item, target, "school",     poolSchool))           return false;
      if (!this._matchesAxis(item, target, "source",     poolSpellSourceId))    return false;
      if (!this._matchesAxis(item, target, "activation", poolActivation))       return false;
      if (!this._matchesAxis(item, target, "range",      poolRange))            return false;
      if (!this._matchesAxis(item, target, "duration",   poolDuration))         return false;
      if (!this._matchesAxis(item, target, "shape",      poolShape))            return false;
      if (!this._matchesProperties(item, target)) return false;
      if (!this._matchesTagGroups(item, target)) return false;
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

  // -----------------------------------------------------------------------
  // Add / Remove / sheetMode mutations
  // -----------------------------------------------------------------------

  /**
   * Apply a sheetMode to a spell — either by mutating the spell that's
   * already on the sheet AS THIS CLASS, or by embedding a fresh copy
   * from the live class pool. Per-class scoping means adding Blade
   * Ward as a Wizard spell when Bard already has it doesn't update
   * Bard's copy — it creates a second item attributed to Wizard.
   */
  async _applySheetMode(dbId, mode, classModel) {
    if (!this._actor || !dbId || !mode) return;

    const isImporter = this._mode === "importer";

    // Per-class scope in sheet mode; actor-wide in importer mode.
    // Importer mode never modifies a class-attributed copy — it only
    // creates orphan spells (no `classIdentifier` flag). If the spell
    // already exists on the actor (regardless of which section it's
    // in), we don't add a duplicate; the user can manage it from the
    // Prepare Spells manager or the sheet itself.
    const owned = isImporter
      ? this._findOwnedSpellByDbId(dbId)
      : (classModel?.identifier
        ? this._findOwnedSpellByDbIdForClass(dbId, classModel.identifier)
        : this._findOwnedSpellByDbId(dbId));

    if (owned) {
      if (isAdvancementGranted(owned)) {
        notifyWarn(`${owned.name} is granted by an advancement and can only be modified via the source class.`);
        return;
      }
      if (isImporter) {
        // Already on sheet via some other path. Don't try to mutate
        // — just signal the user. The "Remove from Sheet" branch in
        // the footer toggle handles deletion.
        notifyInfo(`${owned.name} is already on the sheet.`);
        await this._renderManager();
        return;
      }
      try {
        await owned.update(buildSheetModePatch(mode));
        await this._renderManager();
      } catch (err) {
        console.warn(`${MODULE_ID} | update sheetMode failed`, err);
        notifyWarn("Failed to update spell — see console.");
      }
      return;
    }

    // Resolve the per-spell fetch URL. In sheet mode, the class item
    // carries `spellListUrl` and `_ensureFullSpell` derives the spell
    // endpoint from it. In importer mode there's no class — borrow
    // any existing actor class's spellListUrl, or fall back to a
    // synthesized URL via the source slug + module-host setting.
    if (isImporter) {
      let full = this._fullSpellCache.get(dbId);
      if (!full) full = await this._ensureFullSpellAnyway(dbId, classModel);
      if (!full) {
        notifyWarn("Could not fetch the spell from Dauligor — see console.");
        return;
      }
      const itemData = foundry.utils.deepClone(full);
      // No class attribution. Don't stamp classIdentifier; don't set
      // system.sourceItem to "class:X". The alt sheet's
      // resolveSpellSectionId falls through to `__other__` for these.
      if (!itemData.flags) itemData.flags = {};
      if (!itemData.flags[MODULE_ID]) itemData.flags[MODULE_ID] = {};
      itemData.flags[MODULE_ID].entityId = dbId;
      itemData.flags[MODULE_ID].sheetMode = SHEET_MODE_FREE;
      foundry.utils.setProperty(itemData, "system.prepared", true);
      foundry.utils.setProperty(itemData, "system.method", "spell");
      try {
        await this._actor.createEmbeddedDocuments("Item", [itemData]);
        notifyInfo(`${itemData.name} added to sheet.`);
        await this._renderManager();
      } catch (err) {
        console.warn(`${MODULE_ID} | importer add spell failed`, err);
        notifyWarn("Failed to add spell — see console.");
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

    const itemData = foundry.utils.deepClone(full);
    foundry.utils.setProperty(itemData, "system.sourceItem", `class:${classModel.identifier}`);
    if (!itemData.flags) itemData.flags = {};
    if (!itemData.flags[MODULE_ID]) itemData.flags[MODULE_ID] = {};
    itemData.flags[MODULE_ID].classIdentifier = classModel.identifier;
    itemData.flags[MODULE_ID].entityId = dbId;
    itemData.flags[MODULE_ID].sheetMode = mode;
    foundry.utils.setProperty(itemData, "system.prepared", mode !== SHEET_MODE_SPELLBOOK);
    // All three sheetModes stamp `system.method = "spell"` — see the
    // top-of-file sheetMode comment for why "free" no longer maps to
    // dnd5e's "always" method. The Dauligor flag handles cap accounting.
    foundry.utils.setProperty(itemData, "system.method", "spell");

    try {
      await this._actor.createEmbeddedDocuments("Item", [itemData]);
      notifyInfo(`${itemData.name} added to sheet.`);
      await this._renderManager();
    } catch (err) {
      console.warn(`${MODULE_ID} | add spell failed`, err);
      notifyWarn("Failed to add spell — see console.");
    }
  }

  /**
   * Importer-mode full-spell fetch. Borrows any class's spell-list URL
   * to derive the per-spell endpoint URL, or constructs one from the
   * configured module host. Falls back to the public production host
   * as a last resort so the importer works even when no class is
   * imported yet.
   */
  async _ensureFullSpellAnyway(dbId, classModel) {
    if (!dbId) return null;
    if (this._fullSpellCache.has(dbId)) return this._fullSpellCache.get(dbId);
    if (this._fullSpellInFlight.has(dbId)) return null;

    // Try the class model first (if we have one with a URL), then
    // walk other classes on the actor, then synthesize from the
    // module host setting.
    let endpointUrl = null;
    if (classModel?.item?.getFlag?.(MODULE_ID, "spellListUrl")) {
      const baseUrl = classModel.item.getFlag(MODULE_ID, "spellListUrl");
      const match = String(baseUrl).match(/^(.*\/api\/module\/)/i);
      if (match) endpointUrl = `${match[1]}spells/${encodeURIComponent(dbId)}.json`;
    }
    if (!endpointUrl) {
      const host = this._resolveApiHost();
      endpointUrl = `${host}/api/module/spells/${encodeURIComponent(dbId)}.json`;
    }

    this._fullSpellInFlight.add(dbId);
    try {
      const response = await fetch(endpointUrl, { cache: "no-store" });
      if (!response.ok) {
        this._fullSpellInFlight.delete(dbId);
        console.warn(`${MODULE_ID} | importer full-spell fetch returned ${response.status}`, { endpointUrl });
        return null;
      }
      const payload = await response.json();
      this._fullSpellInFlight.delete(dbId);
      if (payload?.kind !== "dauligor.spell-item.v1") {
        console.warn(`${MODULE_ID} | unexpected spell payload kind`, { endpointUrl, kind: payload?.kind });
        return null;
      }
      const full = payload.spell ?? null;
      if (full) {
        this._fullSpellCache.set(dbId, full);
        if (this._state.selectedSpellDbId === dbId) this._renderDetail();
        this._enrichSpellDescription(dbId, full).catch((err) => {
          console.warn(`${MODULE_ID} | description enrich failed`, err);
        });
      }
      return full;
    } catch (err) {
      this._fullSpellInFlight.delete(dbId);
      console.warn(`${MODULE_ID} | importer full-spell fetch failed`, { endpointUrl, err });
      return null;
    }
  }

  /**
   * Delete a spell from the actor entirely. Scoped per-class — if Bard
   * and Wizard each have their own Blade Ward, removing from Wizard's
   * footer only deletes the Wizard copy.
   */
  async _removeSpell(dbId, classModel = null) {
    if (!this._actor || !dbId) return;
    const owned = classModel?.identifier
      ? this._findOwnedSpellByDbIdForClass(dbId, classModel.identifier)
      : this._findOwnedSpellByDbId(dbId);
    if (!owned) return;
    if (isAdvancementGranted(owned)) {
      notifyWarn(`${owned.name} is granted by an advancement and can only be removed via the source class.`);
      return;
    }
    if (isAlwaysPrepared(owned) && getSheetMode(owned) === SHEET_MODE_PREPARED) {
      // dnd5e-native "always prepared" (not our "free" mode) is treated
      // as managed by the class — we don't touch it from this manager.
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
  }

  // -----------------------------------------------------------------------
  // Render pipeline
  // -----------------------------------------------------------------------

  async _renderManager() {
    const classModels = this._buildClassModels();
    this._ensureValidSelection(classModels);
    const selectedClass = classModels.find((entry) => entry.identifier === this._state.selectedClassIdentifier) ?? null;

    if (selectedClass) await this._ensureClassPool(selectedClass);
    // Pre-warm pools for ALL classes so favorites can hit any of them.
    for (const m of classModels) if (m !== selectedClass) this._ensureClassPool(m);
    // Pre-warm the class bundle for EVERY class so the meta strip's
    // prep-type label is authoritative (read from `class.spellcasting.type`
    // in D1, not heuristics). Idempotent — re-firing is a no-op when
    // the cache entry already exists.
    for (const m of classModels) this._ensureClassBundle(m);

    const fullPool = this._getActivePool(selectedClass);
    // "On Sheet" toggle: restrict to spells owned and attributed to
    // THIS class. The set is empty when the toggle is off so the
    // filter pipeline passes everything through.
    const restrictSet = (this._state.onSheetFilter && selectedClass)
      ? new Set(selectedClass.ownedSpells.map(getSpellEntityId).filter(Boolean))
      : null;
    const filteredPool = this._filterList(fullPool, "pool", { restrictSet });

    if (filteredPool.length > 0) {
      const stillVisible = this._state.selectedSpellDbId
        && filteredPool.some((s) => poolDbId(s) === this._state.selectedSpellDbId);
      if (!stillVisible) {
        this._state.selectedSpellDbId = poolDbId(filteredPool[0]) || null;
      }
    } else {
      this._state.selectedSpellDbId = null;
    }

    const summary = this._state.selectedSpellDbId
      ? fullPool.find((it) => poolDbId(it) === this._state.selectedSpellDbId) ?? null
      : null;
    if (summary) this._ensureFullSpell(this._state.selectedSpellDbId, selectedClass);

    this._renderRail(classModels, selectedClass);
    this._renderFavorites(classModels);
    this._renderMeta(selectedClass, fullPool);
    this._renderToolbar(selectedClass, filteredPool, fullPool);
    this._renderPool(fullPool, filteredPool, selectedClass);
    this._renderDetail(summary, selectedClass);
    this._renderFooter(selectedClass, summary);
    this._renderFilterModal(fullPool, classModels);
  }

  // ---- Rail (classes) ---------------------------------------------------

  _renderRail(classModels, selectedClass) {
    if (!this._railRegion) return;

    const isImporter = this._mode === "importer";
    const railTitle = isImporter ? "Sources" : "Classes";
    const emptyMsg = isImporter
      ? "No sources selected. Re-open the importer and pick a source."
      : "This actor has no spellcasting classes.";

    if (!classModels.length) {
      this._railRegion.innerHTML = `
        <div class="dauligor-spell-manager__sidebar-title">${escapeHtml(railTitle)}</div>
        <div class="dauligor-spell-manager__empty">${escapeHtml(emptyMsg)}</div>
      `;
      return;
    }

    const rows = classModels.map((entry) => {
      // Importer mode: count is the source's total spell count (from
      // the loaded pool). Sheet mode: count is owned-by-this-class.
      const count = isImporter
        ? (this._classPools.get(entry.identifier)?.spells?.length ?? "—")
        : entry.ownedCount;
      return `
        <button
          type="button"
          class="dauligor-spell-manager__class-row ${selectedClass?.identifier === entry.identifier ? "dauligor-spell-manager__class-row--active" : ""}"
          data-action="select-class"
          data-class-identifier="${escapeHtml(entry.identifier)}"
        >
          <span class="dauligor-spell-manager__class-row-name">${escapeHtml(entry.label)}</span>
          <span class="dauligor-spell-manager__class-row-count">${escapeHtml(String(count))}</span>
        </button>
      `;
    }).join("");

    this._railRegion.innerHTML = `
      <div class="dauligor-spell-manager__sidebar-title">${escapeHtml(railTitle)}</div>
      <div class="dauligor-spell-manager__class-list">${rows}</div>
    `;

    this._railRegion.querySelectorAll(`[data-action="select-class"]`).forEach((button) => {
      button.addEventListener("click", () => {
        this._state.selectedClassIdentifier = button.dataset.classIdentifier ?? null;
        this._state.selectedSpellDbId = null;
        this._renderManager();
      });
    });
  }

  // ---- Favorites (sidebar's bottom half, fills remaining height) -------

  _renderFavorites(classModels) {
    if (!this._favoritesRegion) return;

    const favIds = this._getFavoriteDbIds();
    // Per-class owned scope. A favourite shows the on-sheet indicator
    // ONLY when the currently-selected class also owns that spell —
    // matching the pool's per-class indicator semantics. Bard owning
    // Blade Ward doesn't make it light up in Wizard's view.
    const selectedClassForOwned = classModels.find((m) => m.identifier === this._state.selectedClassIdentifier) ?? null;
    // Importer mode: actor-wide owned map (no per-class scope), so
    // favourites indicators light up for spells owned via any class
    // / no class. Sheet mode keeps the per-class scope.
    const ownedMap = this._mode === "importer"
      ? this._getOwnedDbIdMap()
      : (selectedClassForOwned
        ? this._getOwnedDbIdMapForClass(selectedClassForOwned.identifier)
        : this._getOwnedDbIdMap());
    const allFavorites = this._buildFavoritesPool(classModels);
    const filtered = this._filterList(allFavorites, "favorites");

    const toolbarHtml = this._buildToolbarHtml({
      target: "favorites",
      placeholder: "Search favourites…",
      filteredCount: filtered.length,
      totalCount: allFavorites.length,
      showOnSheet: false
    });

    const header = `
      <div class="dauligor-spell-manager__favorites-header">
        <span class="dauligor-spell-manager__favorites-icon">★</span>
        <span class="dauligor-spell-manager__favorites-title">Favourites</span>
      </div>
      <div class="dauligor-spell-manager__favorites-toolbar">${toolbarHtml}</div>
    `;

    if (allFavorites.length === 0) {
      this._favoritesRegion.innerHTML = `${header}
        <div class="dauligor-spell-manager__favorites-empty">
          <div class="dauligor-spell-manager__favorites-empty-icon">★</div>
          <div class="dauligor-spell-manager__favorites-empty-hint">Star spells in the middle column to pin them here.</div>
        </div>
      `;
      this._bindFavoritesToolbar();
      return;
    }

    if (filtered.length === 0) {
      this._favoritesRegion.innerHTML = `${header}
        <div class="dauligor-spell-manager__favorites-empty">
          <div class="dauligor-spell-manager__favorites-empty-hint">No favourites match the current filters.</div>
        </div>
      `;
      this._bindFavoritesToolbar();
      return;
    }

    // Selected class needed for indicator semantics — fall back to the
    // first class if no selection (so empty-sidebar still renders icons).
    const selectedClass = classModels.find((m) => m.identifier === this._state.selectedClassIdentifier) ?? classModels[0] ?? null;
    const rows = filtered.map((item) => this._buildFavoriteRowHtml(item, ownedMap, selectedClass)).join("");
    this._favoritesRegion.innerHTML = `${header}
      <div class="dauligor-spell-manager__favorites-list">${rows}</div>
    `;
    this._bindFavoritesToolbar();
    this._bindPoolRows(this._favoritesRegion);
  }

  _bindFavoritesToolbar() {
    this._bindToolbar(this._favoritesRegion, "favorites");
  }

  _buildFavoriteRowHtml(item, ownedMap, selectedClass) {
    const dbId = poolDbId(item);
    const ownedItem = ownedMap.get(dbId);
    const isSelected = this._state.selectedSpellDbId === dbId;
    return this._buildSpellRowHtml(item, {
      ownedItem,
      selectedClass,
      isSelected,
      isFav: true,
      showFavStar: false,   // already in favorites — no toggle here
      compact: true
    });
  }

  // ---- Meta strip (pool header) -----------------------------------------

  _renderMeta(selectedClass, fullPool) {
    if (!this._metaRegion) return;

    // Importer mode: simpler header (no caster counters — there's no
    // class context). Shows the active source + pool size + actor
    // target so the user has a clear "what's about to be imported and
    // where to" readout above the pool.
    if (this._mode === "importer") {
      const sourceLabel = selectedClass?.label || "Source";
      const totalCount = fullPool?.length ?? 0;
      const actorName = this._actor?.name ?? "Actor";
      this._metaRegion.innerHTML = `
        <div class="dauligor-spell-manager__meta-importer">
          <div class="dauligor-spell-manager__meta-importer-left">
            <div class="dauligor-spell-manager__meta-importer-title">${escapeHtml(sourceLabel)}</div>
            <div class="dauligor-spell-manager__meta-importer-subtitle">${totalCount} spell${totalCount === 1 ? "" : "s"} in source</div>
          </div>
          <div class="dauligor-spell-manager__meta-importer-right">
            <div class="dauligor-spell-manager__meta-importer-label">Importing to</div>
            <div class="dauligor-spell-manager__meta-importer-target">${escapeHtml(actorName)}</div>
            <div class="dauligor-spell-manager__meta-importer-hint">Other Spells (unsorted)</div>
          </div>
        </div>
      `;
      return;
    }

    if (!selectedClass) {
      this._metaRegion.innerHTML = `<div class="dauligor-spell-manager__meta-empty">Select a class to view its pool.</div>`;
      return;
    }

    const owned = selectedClass.ownedSpells;
    const totalOnSheet = owned.length;
    const cantripsOnSheet = owned.filter((s) => Number(s.system?.level ?? 0) === 0).length;
    const preparedCount = owned
      .filter((s) => Number(s.system?.level ?? 0) > 0)
      .filter((s) => getSheetMode(s) === SHEET_MODE_PREPARED)
      .length;
    const inSpellbookCount = owned
      .filter((s) => Number(s.system?.level ?? 0) > 0)
      .filter((s) => {
        const m = getSheetMode(s);
        return m === SHEET_MODE_PREPARED || m === SHEET_MODE_SPELLBOOK;
      })
      .length;

    const cap = selectedClass.spellsCap;
    const cantripCap = selectedClass.cantripsCap;
    const prep = selectedClass.prepType;

    // Counter shape — each counter ends up in one of two row slots:
    //   Row 1 LEFT:   On Sheet         Row 1 RIGHT:  Prepared / Known
    //   Row 2 LEFT:   Cantrips         Row 2 RIGHT:  In Spellbook
    // Labels are short ("On Sheet", "Prepared", "Cantrips",
    // "In Spellbook") so the strip stays compact and the two rows
    // stack neatly under the meta strip's left-side title.
    const renderCounter = (label, value, cap, modifier = "") => `
      <div class="dauligor-spell-manager__meta-counter ${modifier}">
        <div class="dauligor-spell-manager__meta-counter-label">${escapeHtml(label)}</div>
        <div class="dauligor-spell-manager__meta-counter-value">${value}${cap != null ? `<span class="dauligor-spell-manager__meta-counter-cap"> / ${cap}</span>` : ""}</div>
      </div>
    `;
    // Empty placeholder slot — preserves column alignment when only
    // one of (Cantrips, In Spellbook) is applicable. Without this, a
    // single counter in row 2 would float to whichever side flex
    // decides; the placeholder forces it under the column it pairs
    // with (Cantrips under On Sheet, In Spellbook under Prepared).
    const emptySlot = `<div class="dauligor-spell-manager__meta-counter dauligor-spell-manager__meta-counter--placeholder" aria-hidden="true"></div>`;

    const onSheetCounter  = renderCounter("On Sheet", totalOnSheet, null, "dauligor-spell-manager__meta-counter--muted");
    const prepLabel       = prep === "known" ? "Known" : "Prepared";
    const prepCounter     = renderCounter(prepLabel, preparedCount, cap ?? "∞");
    const cantripCounter  = (cantripCap == null) ? null : renderCounter("Cantrips", cantripsOnSheet, cantripCap);
    const spellbookCounter = (prep === "spellbook") ? renderCounter("In Spellbook", inSpellbookCount, null) : null;

    const progressionPart = selectedClass.progressionLabel
      ? `${escapeHtml(selectedClass.progressionLabel)}${selectedClass.abilityAbbr ? " – " + escapeHtml(selectedClass.abilityAbbr) : ""}`
      : (selectedClass.abilityAbbr ? escapeHtml(selectedClass.abilityAbbr) : "");

    // Bottom row renders only when at least one of its slots is
    // applicable. Slot positioning:
    //   - Both apply (Wizard):     [Cantrips] [In Spellbook]
    //   - Only Cantrips (Cleric):  [‹hidden›] [Cantrips]
    //   - Only Spellbook (rare):   [‹hidden›] [In Spellbook]
    // i.e. when only ONE row-2 counter applies, it always sits in the
    // RIGHT column — that keeps everything visually flush with the
    // right edge of the meta-right strip instead of leaving a gap on
    // the right while the lonely counter floats in the left column.
    const hasBottomRow = cantripCounter !== null || spellbookCounter !== null;
    const bothBottom   = cantripCounter !== null && spellbookCounter !== null;
    const bottomLeft   = bothBottom ? cantripCounter : emptySlot;
    const bottomRight  = bothBottom ? spellbookCounter : (cantripCounter ?? spellbookCounter ?? emptySlot);

    this._metaRegion.innerHTML = `
      <div class="dauligor-spell-manager__meta-left">
        <div class="dauligor-spell-manager__meta-title">
          <span class="dauligor-spell-manager__meta-class">${escapeHtml(selectedClass.label)}</span>
          <span class="dauligor-spell-manager__meta-chip">${escapeHtml(selectedClass.prepTypeLabel)}</span>
        </div>
        ${progressionPart ? `<div class="dauligor-spell-manager__meta-progression">${progressionPart}</div>` : ""}
      </div>
      <div class="dauligor-spell-manager__meta-right">
        <div class="dauligor-spell-manager__meta-counter-row">
          ${onSheetCounter}
          ${prepCounter}
        </div>
        ${hasBottomRow ? `
        <div class="dauligor-spell-manager__meta-counter-row">
          ${bottomLeft}
          ${bottomRight}
        </div>
        ` : ""}
      </div>
    `;
  }

  // ---- Toolbar (shared between pool + favourites) -----------------------

  /**
   * Build the toolbar HTML — used by BOTH the pool toolbar and the
   * favourites toolbar. The two surfaces share one component to keep
   * the visual + behaviour consistent.
   *
   * Search input + count + clear ✕ are wrapped in a single visual
   * "search field" (an input + overlays inside one bordered div).
   * The clear ✕ shows only when the input has a value. The count
   * (filteredCount / totalCount) sits flush against the right edge
   * inside the wrap.
   *
   * The On Sheet toggle is opt-in via `showOnSheet` — pool gets it,
   * favourites doesn't.
   *
   * data-action wiring:
   *   - `search` → live input handler
   *   - `clear-search` → clears state[searchKey] back to ""
   *   - `open-filter` (with data-target) → opens the filter modal
   *   - `toggle-on-sheet` → toggles state.onSheetFilter (pool only)
   *
   * No more inline "Reset" button — the search field's clear ✕ and
   * the filter modal's own Reset button cover the same surface.
   */
  _buildToolbarHtml({ target, placeholder, filteredCount, totalCount, showOnSheet }) {
    const searchValue = this._searchFor(target);
    const filtersActive = this._activeFilterCount(target);
    const countLabel = totalCount === 0
      ? ""
      : (filteredCount !== totalCount
        ? `${filteredCount} <span class="dauligor-spell-manager__inline-search-count-total">/ ${totalCount}</span>`
        : `${totalCount}`);

    return `
      <div class="dauligor-spell-manager__inline-search-wrap">
        <input
          type="search"
          class="dauligor-spell-manager__inline-search"
          data-action="search"
          placeholder="${escapeHtml(placeholder)}"
          value="${escapeHtml(searchValue)}"
          autocomplete="off"
        >
        ${searchValue ? `<button type="button" class="dauligor-spell-manager__inline-search-clear" data-action="clear-search" title="Clear search" aria-label="Clear search">×</button>` : ""}
        ${countLabel ? `<span class="dauligor-spell-manager__inline-search-count" aria-live="polite">${countLabel}</span>` : ""}
      </div>
      ${showOnSheet ? `
      <button type="button"
        class="dauligor-spell-manager__on-sheet-button ${this._state.onSheetFilter ? "dauligor-spell-manager__on-sheet-button--active" : ""}"
        data-action="toggle-on-sheet"
        title="Show only spells that are already on this class's sheet"
      >On Sheet</button>
      ` : ""}
      <button type="button"
        class="dauligor-spell-manager__filter-button ${filtersActive > 0 ? "dauligor-spell-manager__filter-button--active" : ""}"
        data-action="open-filter"
        data-target="${escapeHtml(target)}"
        title="Open filter options"
      >
        <span class="dauligor-spell-manager__filter-button-label">Filters</span>
        ${filtersActive > 0 ? `<span class="dauligor-spell-manager__filter-count-badge">${filtersActive}</span>` : ""}
      </button>
    `;
  }

  /**
   * Wire up the toolbar's event handlers within a given region.
   * Shared by pool + favourites. The `target` ("pool" / "favorites")
   * routes search state + filter-modal opens.
   */
  _bindToolbar(region, target) {
    if (!region) return;

    const search = region.querySelector(`[data-action="search"]`);
    search?.addEventListener("input", async (event) => {
      const cursor = event.currentTarget.selectionStart;
      this._setSearchFor(target, event.currentTarget.value ?? "");
      await this._renderManager();
      const next = region.querySelector(`[data-action="search"]`);
      if (next instanceof HTMLInputElement) {
        next.focus();
        try { next.setSelectionRange(cursor, cursor); } catch { /* noop */ }
      }
    });

    region.querySelector(`[data-action="clear-search"]`)?.addEventListener("click", async () => {
      this._setSearchFor(target, "");
      await this._renderManager();
    });

    region.querySelector(`[data-action="open-filter"]`)?.addEventListener("click", async () => {
      this._state.filterModalOpen = target;
      await this._renderManager();
    });

    region.querySelector(`[data-action="toggle-on-sheet"]`)?.addEventListener("click", async () => {
      this._state.onSheetFilter = !this._state.onSheetFilter;
      await this._renderManager();
    });
  }

  _renderToolbar(selectedClass, filteredPool, fullPool) {
    if (!this._toolbarRegion) return;
    this._toolbarRegion.innerHTML = this._buildToolbarHtml({
      target: "pool",
      placeholder: "Search spell name…",
      filteredCount: filteredPool.length,
      totalCount: fullPool.length,
      // Hide the "On Sheet" toggle in importer mode — it filters by
      // per-class ownership, which doesn't apply to source-wide
      // browsing. The pool indicator on each row still shows the
      // actor-wide owned state, so the user can scan for "already
      // added" spells without the toggle.
      showOnSheet: this._mode !== "importer"
    });
    this._bindToolbar(this._toolbarRegion, "pool");
  }

  // ---- Pool list --------------------------------------------------------

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

    // Per-class indicator: only show "on sheet" for spells THIS class
    // owns. If Bard has Blade Ward attributed to Bard, Wizard's pool
    // still shows Blade Ward as empty-circle (not owned by Wizard).
    //
    // Importer mode has no class scope — light the indicator for any
    // copy on the actor, regardless of class attribution. Otherwise
    // every row in the importer pool would show as "not on sheet"
    // (the pseudo-source-identifier never matches a real class).
    const ownedMap = this._mode === "importer"
      ? this._getOwnedDbIdMap()
      : (selectedClass
        ? this._getOwnedDbIdMapForClass(selectedClass.identifier)
        : this._getOwnedDbIdMap());
    const favIds = this._getFavoriteDbIds();
    const grouped = this._groupByLevel(filteredPool);

    const bandsHtml = grouped.map(([level, items]) => `
      <section class="dauligor-spell-manager__pool-band">
        <div class="dauligor-spell-manager__pool-band-header">
          <span class="dauligor-spell-manager__pool-band-name">${escapeHtml(describeSpellLevel(level))}</span>
          <span class="dauligor-spell-manager__pool-band-count">${items.length}</span>
        </div>
        <div class="dauligor-spell-manager__pool-band-list">
          ${items.map((item) => this._buildSpellRowHtml(item, {
            ownedItem: ownedMap.get(poolDbId(item)),
            selectedClass,
            isSelected: this._state.selectedSpellDbId === poolDbId(item),
            isFav: favIds.has(poolDbId(item)),
            showFavStar: true,
            compact: false
          })).join("")}
        </div>
      </section>
    `).join("");

    this._poolRegion.innerHTML = bandsHtml;
    this._bindPoolRows(this._poolRegion);
  }

  /**
   * Single spell row HTML. Indicator state:
   *   - Cantrip:
   *       not on sheet → empty circle
   *       on sheet     → filled circle (cantrips are always known)
   *   - Level spell:
   *       not on sheet → empty circle
   *       on sheet (any non-spellbook prep type, any sheetMode) → filled circle
   *       on sheet (spellbook prep) and sheetMode = "spellbook" or "prepared" → book icon
   *       on sheet (spellbook prep) and sheetMode = "free" → filled circle
   * Row highlight:
   *   - sheetMode === "prepared" → highlighted
   */
  _buildSpellRowHtml(item, { ownedItem = null, selectedClass = null, isSelected = false, isFav = false, showFavStar = true, compact = false } = {}) {
    const dbId = poolDbId(item);
    const level = poolLevel(item);
    const isCantrip = level === 0;
    const isOwned = !!ownedItem;
    const sheetMode = isOwned ? getSheetMode(ownedItem) : null;
    const prep = selectedClass ? selectedClass.prepType : "prepared";
    const isPrepared = sheetMode === SHEET_MODE_PREPARED;
    const isLocked = ownedItem ? (isAdvancementGranted(ownedItem) || (isAlwaysPrepared(ownedItem) && sheetMode !== SHEET_MODE_FREE)) : false;

    // Indicator selection.
    let indicatorClass = "dauligor-spell-manager__row-indicator dauligor-spell-manager__row-indicator--empty";
    let indicatorTitle = "Not on sheet";
    let indicatorGlyph = "○";
    if (isOwned) {
      if (!isCantrip && prep === "spellbook" && (sheetMode === SHEET_MODE_SPELLBOOK || sheetMode === SHEET_MODE_PREPARED)) {
        indicatorClass = "dauligor-spell-manager__row-indicator dauligor-spell-manager__row-indicator--book";
        indicatorGlyph = "📖";
        indicatorTitle = sheetMode === SHEET_MODE_PREPARED ? "In spellbook · Prepared" : "In spellbook";
      } else {
        indicatorClass = "dauligor-spell-manager__row-indicator dauligor-spell-manager__row-indicator--filled";
        indicatorGlyph = "●";
        if (isCantrip) indicatorTitle = "Cantrip on sheet";
        else if (sheetMode === SHEET_MODE_PREPARED) indicatorTitle = prep === "known" ? "Known" : "Prepared";
        else if (sheetMode === SHEET_MODE_FREE) indicatorTitle = "On sheet (does not count)";
        else indicatorTitle = "On sheet";
      }
    }

    const rowClasses = [
      "dauligor-spell-manager__pool-row",
      compact && "dauligor-spell-manager__pool-row--compact",
      isSelected && "dauligor-spell-manager__pool-row--selected",
      isOwned && "dauligor-spell-manager__pool-row--owned",
      isPrepared && "dauligor-spell-manager__pool-row--prepared",
      isLocked && "dauligor-spell-manager__pool-row--locked"
    ].filter(Boolean).join(" ");

    const flags = poolFlags(item);
    const badges = [];
    if (flags.ritual)        badges.push(`<span class="dauligor-spell-manager__row-badge" title="Ritual">R</span>`);
    if (flags.concentration) badges.push(`<span class="dauligor-spell-manager__row-badge" title="Concentration">C</span>`);

    const school = poolSchool(item);
    const schoolLabel = describeSpellSchool(school);

    return `
      <div class="${rowClasses}" data-action="row" data-db-id="${escapeHtml(dbId)}" title="Click to view details">
        <span class="${indicatorClass}" title="${escapeHtml(indicatorTitle)}">${indicatorGlyph}</span>
        <span class="dauligor-spell-manager__row-name">${escapeHtml(poolName(item))}</span>
        <span class="dauligor-spell-manager__row-badges">${badges.join("")}</span>
        <span class="dauligor-spell-manager__row-school" title="${escapeHtml(schoolLabel)}">${escapeHtml(school.toUpperCase().slice(0, 3))}</span>
        ${showFavStar ? `
          <button type="button"
            class="dauligor-spell-manager__row-star ${isFav ? "dauligor-spell-manager__row-star--active" : ""}"
            data-action="star" data-db-id="${escapeHtml(dbId)}"
            title="${isFav ? "Unfavourite" : "Favourite"}">★</button>
        ` : ""}
      </div>
    `;
  }

  _bindPoolRows(container) {
    container.querySelectorAll(`[data-action="row"]`).forEach((row) => {
      row.addEventListener("click", (event) => {
        if ((event.target instanceof HTMLElement) && event.target.closest(`[data-action="star"]`)) return;
        const dbId = row.dataset.dbId;
        if (!dbId) return;
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

  // ---- Detail pane (SpellDetailPanel-style layout) ---------------------

  _renderDetail(summaryArg = undefined, classArg = undefined) {
    if (!this._detailRegion) return;

    let summary = summaryArg;
    let classModel = classArg;
    if (summary === undefined || classModel === undefined) {
      const classModels = this._buildClassModels();
      classModel = classModels.find((entry) => entry.identifier === this._state.selectedClassIdentifier) ?? null;
      const fullPool = this._getActivePool(classModel);
      summary = this._state.selectedSpellDbId
        ? fullPool.find((it) => poolDbId(it) === this._state.selectedSpellDbId) ?? null
        : null;
      if (!summary && this._fullSpellCache.has(this._state.selectedSpellDbId)) {
        // Favorite from a different class — synthesize a placeholder
        // summary so the detail pane still renders.
        const full = this._fullSpellCache.get(this._state.selectedSpellDbId);
        if (full) summary = this._synthesizeSummaryFromFull(full);
      }
    }

    if (!summary) {
      this._detailRegion.innerHTML = `
        <div class="dauligor-spell-manager__detail-empty">
          <div class="dauligor-spell-manager__detail-empty-title">No spell selected</div>
          <div class="dauligor-spell-manager__detail-empty-hint">Click a row in the middle column to inspect its details.</div>
        </div>
      `;
      return;
    }

    const dbId = poolDbId(summary);
    const full = this._fullSpellCache.get(dbId) ?? null;
    // Per-class scope for the detail pane's status line + footer button
    // state. Adding Bard's Blade Ward to Wizard should let the Wizard
    // detail view say "Not on sheet" (for Wizard) — even though Bard
    // has its own copy.
    const ownedItem = classModel?.identifier
      ? this._findOwnedSpellByDbIdForClass(dbId, classModel.identifier)
      : this._findOwnedSpellByDbId(dbId);
    const flags = poolFlags(summary);

    const enrichedHtml = this._enrichedDescriptionCache.get(dbId);
    const description = enrichedHtml
      ?? String(full?.system?.description?.value ?? "").trim();

    const schoolLabel = describeSpellSchool(poolSchool(summary));
    const levelLabel = describeSpellLevel(poolLevel(summary));
    // Source rendering. Priority order:
    //   1. `full.system.source.book` — the spell's own Foundry-shape
    //      source field (e.g. "XGE", "PHB"). Reliable once the full
    //      payload loads, and works regardless of whether the spell's
    //      legacy spellSourceId column matches the sources catalog.
    //   2. Sources catalog lookup keyed on `spellSourceId` — works for
    //      newly-migrated rows whose source_id matches `sources.id`.
    //   3. "—" placeholder while loading / when neither resolves.
    const sourceBookFromFull = String(full?.system?.source?.book ?? "").trim();
    const sourceShort = sourceBookFromFull
      || this._sourceShortName(poolSpellSourceId(summary))
      || "—";
    const sourcePage = String(full?.system?.source?.page ?? "").trim();

    const ritual = Boolean(flags.ritual);
    const concentration = Boolean(flags.concentration);
    const fav = this._getFavoriteDbIds().has(dbId);

    const imageHtml = full?.img
      ? `<div class="dauligor-spell-manager__detail-image"><img src="${escapeHtml(full.img)}" alt="${escapeHtml(summary.name)}"></div>`
      : `<div class="dauligor-spell-manager__detail-image dauligor-spell-manager__detail-image--placeholder" aria-hidden="true"></div>`;

    // 2-col info grid: Casting Time / Range / Components / Duration
    const infoRow = (label, value) => `
      <div class="dauligor-spell-manager__detail-info-row">
        <div class="dauligor-spell-manager__detail-info-label">${escapeHtml(label)}</div>
        <div class="dauligor-spell-manager__detail-info-value">${escapeHtml(value ?? "—")}</div>
      </div>
    `;

    const descriptionHtml = full
      ? (description
        ? `<div class="dauligor-spell-manager__detail-description">${description}</div>`
        : `<div class="dauligor-spell-manager__detail-description dauligor-spell-manager__empty">No description stored on this spell.</div>`)
      : `<div class="dauligor-spell-manager__detail-description dauligor-spell-manager__empty">Loading description…</div>`;

    // (The previous "On sheet · …" status line was removed — the
    // footer action buttons already convey on-sheet state, and a
    // duplicate text line just added clutter to the detail pane.)

    // Tag rendering. The tag catalog is fetched on manager open from
    // `/api/module/tags/catalog.json` and resolves each id to its
    // group + readable name. Tags grouped by their tag-group, in the
    // same layout the app's <SpellDetailPanel> uses (group name as a
    // section header, chip-row of tag names below).
    //
    // Only resolved tags are rendered — if the catalog hasn't loaded
    // yet we keep the disclosure visible but show the count of raw
    // ids so the toggle still works without lighting up a wall of
    // UUIDs. After the catalog lands the next render swaps them for
    // proper names.
    const tagIds = Array.isArray(flags.tagIds) ? flags.tagIds : [];
    const tagsByGroupForSpell = (() => {
      if (!this._tagCatalog) return null;
      const grouped = new Map();
      for (const tagId of tagIds) {
        const tag = this._tagCatalog.tagsById.get(String(tagId));
        if (!tag) continue;
        const gid = tag.groupId || "__other__";
        if (!grouped.has(gid)) grouped.set(gid, []);
        grouped.get(gid).push(tag);
      }
      return grouped;
    })();
    const resolvedTagCount = tagsByGroupForSpell
      ? [...tagsByGroupForSpell.values()].reduce((sum, arr) => sum + arr.length, 0)
      : 0;
    const hasResolvableTags = resolvedTagCount > 0;

    // Source chip — suppress when no resolvable book (a dangling "—"
    // next to the title reads as a mistake). Hover tooltip on the
    // chip shows the FULL source name plus page number ("Player's
    // Handbook · p. 218"), so the visible chip stays compact while
    // the long form is one hover away.
    const hasSource = sourceShort && sourceShort !== "—";
    const sourceFull = this._sourceFullName(poolSpellSourceId(summary)) || sourceShort;
    const sourceTooltip = hasSource
      ? `${sourceFull}${sourcePage ? ` · p. ${sourcePage}` : ""}`
      : "";

    // Preserve scroll position across re-renders — without this, the
    // detail-scroll container resets to top whenever the user toggles
    // Show Tags or clicks any footer button (Prepare / Add to Sheet
    // / etc.), because we replace the whole innerHTML. We only
    // preserve when the SAME spell is being re-rendered; clicking a
    // different spell in the pool resets to top (which is what the
    // user expects — they want to read the new spell from the start).
    const prevScrollTop = (this._lastDetailDbId === dbId)
      ? (this._detailRegion.querySelector(".dauligor-spell-manager__detail-scroll")?.scrollTop ?? 0)
      : 0;

    this._detailRegion.innerHTML = `
      <div class="dauligor-spell-manager__detail-scroll">
        <header class="dauligor-spell-manager__detail-header">
          <div class="dauligor-spell-manager__detail-title-row">
            <h2 class="dauligor-spell-manager__detail-title">${escapeHtml(summary.name)}</h2>
            ${hasSource ? `<span class="dauligor-spell-manager__detail-source-chip" title="${escapeHtml(sourceTooltip)}">${escapeHtml(sourceShort)}${sourcePage ? ` <span class="dauligor-spell-manager__detail-source-chip-page">p${escapeHtml(sourcePage)}</span>` : ""}</span>` : ""}
            <button type="button"
              class="dauligor-spell-manager__detail-star ${fav ? "dauligor-spell-manager__detail-star--active" : ""}"
              data-action="detail-toggle-fav"
              title="${fav ? "Remove from favourites" : "Add to favourites"}"
            >★</button>
          </div>
          <p class="dauligor-spell-manager__detail-subtitle">
            ${escapeHtml(levelLabel)} <span class="dauligor-spell-manager__detail-subtitle-sep">·</span> ${escapeHtml(schoolLabel)}
            ${ritual ? `<span class="dauligor-spell-manager__detail-subtitle-sep">·</span> <span title="Ritual">Ritual</span>` : ""}
            ${concentration ? `<span class="dauligor-spell-manager__detail-subtitle-sep">·</span> <span title="Concentration">Concentration</span>` : ""}
          </p>
        </header>

        <section class="dauligor-spell-manager__detail-hero">
          ${imageHtml}
          <div class="dauligor-spell-manager__detail-info-grid">
            ${infoRow("Casting Time", formatActivationLabel(summary))}
            ${infoRow("Range",        formatRangeLabel(summary))}
            ${infoRow("Components",   formatComponentsLabel(summary))}
            ${infoRow("Duration",     formatDurationLabel(summary))}
          </div>
        </section>

        <section class="dauligor-spell-manager__detail-body">
          ${descriptionHtml}
        </section>

        ${hasResolvableTags ? `
        <footer class="dauligor-spell-manager__detail-footer">
          <button type="button"
            class="dauligor-spell-manager__detail-tags-toggle"
            data-action="toggle-tags"
            aria-expanded="${this._state.showTags ? "true" : "false"}"
          >
            ${this._state.showTags ? "Hide tags" : "Show tags"}
            <span class="dauligor-spell-manager__detail-tags-count">(${resolvedTagCount})</span>
          </button>
          ${this._state.showTags ? `
          <div class="dauligor-spell-manager__detail-tags">
            ${(() => {
              // Render in the order the catalog ships tag groups (the
              // server orders them alphabetically). Groups with no
              // resolved tags for this spell are skipped. Tags inside a
              // group are sorted by name for stability across renders.
              const sections = [];
              for (const group of (this._tagCatalog?.tagGroups ?? [])) {
                const list = tagsByGroupForSpell?.get(group.id) ?? [];
                if (list.length === 0) continue;
                const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name));
                sections.push(`
                  <div class="dauligor-spell-manager__detail-tags-section">
                    <div class="dauligor-spell-manager__detail-tags-group-name">${escapeHtml(group.name)}</div>
                    <div class="dauligor-spell-manager__detail-tags-list">
                      ${sorted.map((t) => `<span class="dauligor-spell-manager__detail-tag">${escapeHtml(t.name)}</span>`).join("")}
                    </div>
                  </div>
                `);
              }
              return sections.join("") || `<div class="dauligor-spell-manager__detail-tags-empty">No tags resolved.</div>`;
            })()}
          </div>
          ` : ""}
        </footer>
        ` : ""}
      </div>
    `;

    // Restore scroll position immediately after replacing innerHTML.
    // (See the prevScrollTop comment above.)
    const scrollEl = this._detailRegion.querySelector(".dauligor-spell-manager__detail-scroll");
    if (scrollEl && prevScrollTop > 0) scrollEl.scrollTop = prevScrollTop;
    this._lastDetailDbId = dbId;

    this._detailRegion.querySelector(`[data-action="detail-toggle-fav"]`)?.addEventListener("click", async () => {
      await this._toggleFavorite(dbId);
    });
    this._detailRegion.querySelector(`[data-action="toggle-tags"]`)?.addEventListener("click", () => {
      this._state.showTags = !this._state.showTags;
      this._renderDetail();
    });
  }

  /** Build a summary-shaped object from a Foundry-ready full spell item. */
  _synthesizeSummaryFromFull(full) {
    const sys = full?.system ?? {};
    const props = sys.properties ?? {};
    const has = (k) => props instanceof Set ? props.has(k) : !!props?.[k];
    return {
      name: full?.name ?? "",
      type: "spell",
      flags: {
        "dauligor-pairing": {
          dbId: String(full?.flags?.["dauligor-pairing"]?.dbId ?? ""),
          level: Number(sys.level ?? 0) || 0,
          school: String(sys.school ?? ""),
          spellSourceId: String(full?.flags?.["dauligor-pairing"]?.spellSourceId ?? ""),
          componentsVocal: has("vocal"),
          componentsSomatic: has("somatic"),
          componentsMaterial: has("material"),
          ritual: has("ritual"),
          concentration: has("concentration"),
          activationBucket: "",
          rangeBucket: "",
          durationBucket: "",
          shapeBucket: ""
        }
      }
    };
  }

  // ---- Footer (action buttons) ------------------------------------------

  /**
   * Footer buttons are HIERARCHICAL toggles, not mutually-exclusive
   * modes. The data model:
   *
   *     on-sheet ⊇ in-spellbook ⊇ prepared
   *
   * - Every spell on the sheet has a sheetMode of either `free`,
   *   `spellbook`, or `prepared`.
   * - "On Sheet" toggle goes between not-owned and `free`.
   * - "In Spellbook" toggle (Wizard) flips between `free` and
   *   `spellbook` (and demotes `prepared` → `spellbook` when toggling
   *   prepared off — see below).
   * - "Prepared" toggle flips between `prepared` and a lower tier.
   *   Wizard: demotes to `spellbook`. Others: demotes to `free`.
   *
   * Removing a spell from the sheet (the "On Sheet" active-state
   * click) deletes the spell item entirely — that also un-preps and
   * removes it from the spellbook in one step.
   *
   * Per-class scope (see `_applySheetMode` / `_removeSpell`): adding
   * Blade Ward as a Wizard spell when Bard already has Blade Ward
   * doesn't touch Bard's copy. Each class owns its own item.
   */
  _renderFooter(selectedClass, summary) {
    if (!this._footerRegion) return;

    const dbId = summary ? poolDbId(summary) : null;

    // Importer mode: single "Add to Sheet" toggle (creates without a
    // class attribution → lands in the alt sheet's __other__ orphan
    // bucket). Owned lookup is actor-wide here (no per-class scope in
    // importer mode), so if ANY copy of the spell is already on the
    // sheet we toggle into "Remove from Sheet". Re-using
    // `_applySheetMode` + `_removeSpell` keeps the mutation semantics
    // consistent with the sheet flow.
    if (this._mode === "importer") {
      const ownedAny = dbId ? this._findOwnedSpellByDbId(dbId) : null;
      const onSheet = !!ownedAny;
      const noSelection = !summary;
      const btnHtml = noSelection
        ? `<div class="dauligor-spell-manager__footer-hint">Select a spell to enable the import button.</div>`
        : `<button type="button"
            class="dauligor-spell-manager__footer-button ${onSheet ? "dauligor-spell-manager__footer-button--active" : ""}"
            data-action="footer-importer-toggle"
            title="${escapeHtml(onSheet
              ? "Remove this spell from the actor (deletes the spell item)."
              : "Add this spell to the actor. It lands in the Other Spells (unsorted) section and can be moved to a class section if eligible.")}"
          >${escapeHtml(onSheet ? "Remove from Sheet" : "Add to Sheet (Unsorted)")}</button>`;

      this._footerRegion.innerHTML = `
        <div class="dauligor-spell-manager__footer-left">${btnHtml}</div>
        <div class="dauligor-spell-manager__footer-right">
          <button type="button" class="dauligor-spell-manager__footer-button dauligor-spell-manager__footer-button--ghost" data-action="footer-close">Close</button>
        </div>
      `;

      this._footerRegion.querySelector(`[data-action="footer-importer-toggle"]`)?.addEventListener("click", async () => {
        if (!dbId) return;
        if (onSheet) {
          await this._removeSpell(dbId, null);
        } else {
          await this._applySheetMode(dbId, SHEET_MODE_FREE, selectedClass);
        }
      });
      this._footerRegion.querySelector(`[data-action="footer-close"]`)?.addEventListener("click", async () => {
        await this.close();
      });
      return;
    }

    const owned = dbId && selectedClass?.identifier
      ? this._findOwnedSpellByDbIdForClass(dbId, selectedClass.identifier)
      : null;
    const ownedMode = owned ? getSheetMode(owned) : null;
    const onSheet      = ownedMode !== null;
    const inSpellbook  = ownedMode === SHEET_MODE_SPELLBOOK || ownedMode === SHEET_MODE_PREPARED;
    const isPrepared   = ownedMode === SHEET_MODE_PREPARED;

    const prep = selectedClass?.prepType ?? null;
    const isSpellbookCaster = prep === "spellbook";
    const isKnownCaster     = prep === "known";

    const isAlways = owned ? isAlwaysPrepared(owned) : false;
    const isGranted = owned ? isAdvancementGranted(owned) : false;
    const locked = isAlways || isGranted;

    // The "Add to Sheet" / "Remove from Sheet" button.
    // - active = on sheet → "Remove from Sheet" deletes
    // - inactive = not on sheet → "Add to Sheet" creates with sheetMode=free
    const sheetBtn = {
      label: onSheet ? "Remove from Sheet" : "Add to Sheet",
      action: onSheet ? "footer-remove-sheet" : "footer-add-free",
      active: onSheet,
      tooltip: onSheet
        ? "Remove this spell from the sheet entirely. Unprepares it and removes it from your spellbook (if applicable)."
        : `Add to sheet as a ${selectedClass?.label ?? "Class"} spell. Does not count against your spells known or prepared.`,
      visible: true
    };

    // The "Prepare" / "Unprepare" (or "Add as Known" / "Remove as
    // Known") button. Promotes to PREPARED; demotes to SPELLBOOK for
    // Wizard, FREE otherwise.
    const prepBtn = {
      label: isPrepared
        ? (isKnownCaster ? "Remove as Known" : "Unprepare")
        : (isKnownCaster ? "Add as Known" : "Prepare"),
      action: isPrepared ? "footer-demote-prep" : "footer-promote-prep",
      active: isPrepared,
      tooltip: isPrepared
        ? (isKnownCaster
            ? "Remove the Known status. The spell stays on the sheet."
            : (isSpellbookCaster
                ? "Unprepare. The spell stays in your spellbook."
                : "Unprepare. The spell stays on the sheet."))
        : (isKnownCaster
            ? "Add as a Known spell. Counts against your Known cap."
            : (isSpellbookCaster
                ? "Prepare. The spell will also be added to your spellbook if not already."
                : "Prepare. Counts against your Prepared cap.")),
      visible: true
    };

    // The "Add to Spellbook" / "Remove from Spellbook" button — Wizards
    // only. Promotes to SPELLBOOK; demotes to FREE (which also un-preps
    // a PREPARED spell since PREPARED implies in-spellbook).
    const bookBtn = {
      label: inSpellbook ? "Remove from Spellbook" : "Add to Spellbook",
      action: inSpellbook ? "footer-demote-book" : "footer-promote-book",
      active: inSpellbook,
      tooltip: inSpellbook
        ? "Remove from your spellbook. The spell stays on the sheet but you can no longer prepare it."
        : "Add to your spellbook. A spellbook caster can only prepare spells in their spellbook.",
      visible: isSpellbookCaster
    };

    const renderBtn = (btn) => {
      if (!btn.visible) return "";
      const cssActive = btn.active ? "dauligor-spell-manager__footer-button--active" : "";
      const cssLocked = locked ? "dauligor-spell-manager__footer-button--locked" : "";
      return `<button type="button"
        class="dauligor-spell-manager__footer-button ${cssActive} ${cssLocked}"
        data-action="${btn.action}"
        title="${escapeHtml(btn.tooltip)}"
        ${locked ? "disabled" : ""}
      >${escapeHtml(btn.label)}</button>`;
    };

    const noSelection = !selectedClass || !summary;
    const buttons = noSelection
      ? `<div class="dauligor-spell-manager__footer-hint">Select a spell to enable add buttons.</div>`
      : `
        ${renderBtn(sheetBtn)}
        ${renderBtn(bookBtn)}
        ${renderBtn(prepBtn)}
      `;

    this._footerRegion.innerHTML = `
      <div class="dauligor-spell-manager__footer-left">${buttons}</div>
      <div class="dauligor-spell-manager__footer-right">
        <button type="button" class="dauligor-spell-manager__footer-button dauligor-spell-manager__footer-button--ghost" data-action="footer-close">Close</button>
      </div>
    `;

    // Hierarchical transitions. Each handler maps to a target sheetMode
    // (or "remove from sheet") and delegates to `_applySheetMode` /
    // `_removeSpell` which both scope to `selectedClass`.
    const wire = (selector, handler) => {
      this._footerRegion.querySelector(selector)?.addEventListener("click", handler);
    };
    wire(`[data-action="footer-add-free"]`,    async () => { await this._applySheetMode(dbId, SHEET_MODE_FREE, selectedClass); });
    wire(`[data-action="footer-remove-sheet"]`, async () => { await this._removeSpell(dbId, selectedClass); });
    wire(`[data-action="footer-promote-book"]`, async () => { await this._applySheetMode(dbId, SHEET_MODE_SPELLBOOK, selectedClass); });
    wire(`[data-action="footer-demote-book"]`,  async () => { await this._applySheetMode(dbId, SHEET_MODE_FREE,     selectedClass); });
    wire(`[data-action="footer-promote-prep"]`, async () => { await this._applySheetMode(dbId, SHEET_MODE_PREPARED, selectedClass); });
    wire(`[data-action="footer-demote-prep"]`,  async () => {
      // Unprepare: demote to spellbook for Wizards (keeps book
      // membership), free for everyone else.
      const targetMode = isSpellbookCaster ? SHEET_MODE_SPELLBOOK : SHEET_MODE_FREE;
      await this._applySheetMode(dbId, targetMode, selectedClass);
    });
    wire(`[data-action="footer-close"]`, async () => { await this.close(); });
  }

  // ---- Filter modal (shared, opens for pool or favorites) --------------

  _renderFilterModal(fullPool, classModels) {
    if (!this._filterModalRegion) return;
    const target = this._state.filterModalOpen;
    if (!target) {
      this._filterModalRegion.hidden = true;
      this._filterModalRegion.innerHTML = "";
      return;
    }
    this._filterModalRegion.hidden = false;

    // Aggregate source/school ids visible in the relevant pool so the
    // chip set isn't cluttered by sources that produce no matches.
    const visibleItems = target === "favorites"
      ? this._buildFavoritesPool(classModels)
      : fullPool;
    const sourcesInPool = [...new Set(visibleItems.map(poolSpellSourceId).filter(Boolean))].sort();
    const schoolsInPool = [...new Set(visibleItems.map(poolSchool).filter(Boolean))].sort();

    // (Source labels resolve directly via the catalog now that the
    // server-side endpoint ships both semantic + legacy ids. No
    // background pre-warm needed.)

    const ax = (axis) => this._filterStateFor(target).axes?.[axis]?.states ?? {};
    const chipsFor = (axis, options) => options.map((opt) => {
      const sel = !!ax(axis)[String(opt.v)];
      return `<button type="button"
        class="dauligor-spell-manager__modal-chip ${sel ? "dauligor-spell-manager__modal-chip--selected" : ""}"
        data-action="modal-chip"
        data-axis="${escapeHtml(axis)}"
        data-value="${escapeHtml(String(opt.v))}"
      >${escapeHtml(opt.l)}</button>`;
    }).join("");

    const section = (title, axis, options) => `
      <div class="dauligor-spell-manager__modal-section">
        <div class="dauligor-spell-manager__modal-section-header">
          <span class="dauligor-spell-manager__modal-section-title">${escapeHtml(title)}</span>
          <span class="dauligor-spell-manager__modal-section-actions">
            <button type="button" class="dauligor-spell-manager__modal-shortcut" data-action="modal-all" data-axis="${escapeHtml(axis)}">All</button>
            <button type="button" class="dauligor-spell-manager__modal-shortcut" data-action="modal-clear" data-axis="${escapeHtml(axis)}">Clear</button>
          </span>
        </div>
        <div class="dauligor-spell-manager__modal-chips">${chipsFor(axis, options)}</div>
      </div>
    `;

    const levelOptions = SPELL_LEVELS_ALL.map((n) => ({ v: String(n), l: n === 0 ? "Cantrip" : `Level ${n}` }));
    const schoolOptions = SCHOOL_ORDER
      .filter((k) => schoolsInPool.includes(k) || schoolsInPool.length === 0)
      .map((k) => ({ v: k, l: SCHOOL_LABELS[k] || k }));
    const activationOptions = ACTIVATION_ORDER.map((b) => ({ v: b, l: ACTIVATION_LABELS[b] }));
    const rangeOptions      = RANGE_ORDER.map((b) => ({ v: b, l: RANGE_LABELS[b] }));
    const durationOptions   = DURATION_ORDER.map((b) => ({ v: b, l: DURATION_LABELS[b] }));
    const shapeOptions      = SHAPE_ORDER.map((b) => ({ v: b, l: SHAPE_LABELS[b] }));
    const propertyOptions   = PROPERTY_ORDER.map((b) => ({ v: b, l: PROPERTY_LABELS[b] }));

    // Source chips: render one per distinct sourceId in the pool.
    // Label = catalog shortName when available, else the spell-book
    // abbreviation from any cached full-spell payload that shares the
    // sourceId, else a short fallback (first 5 chars of the id). The
    // chip is still filterable in all three cases — only the label
    // visibility changes.
    const sourceOptions = sourcesInPool.map((sid) => {
      const resolved = this._sourceShortName(sid);
      const label = resolved || String(sid).slice(0, 5);
      return { v: sid, l: label };
    });

    // Tag-group filter sections. Each spell-classified tag group
    // becomes its own axis (`tag:<groupId>`) with chips for the tags
    // actually present in the visible pool. Chips OUT of the visible
    // pool are skipped so the modal doesn't list "Forbidden Tag" for
    // a Wizard's pool that contains zero such spells. The Tag groups
    // are only rendered once the tag catalog has loaded — until then
    // the section is omitted (the catalog usually lands within a few
    // hundred ms of manager open).
    const tagGroupSections = (() => {
      if (!this._tagCatalog || this._tagCatalog.tagGroups.length === 0) return "";
      const usedTagIds = new Set();
      for (const item of visibleItems) {
        const ids = poolFlags(item).tagIds;
        if (Array.isArray(ids)) for (const id of ids) usedTagIds.add(String(id));
      }
      const sections = [];
      for (const group of this._tagCatalog.tagGroups) {
        const tagsInGroup = (this._tagCatalog.tagsByGroup.get(group.id) ?? [])
          .filter((t) => usedTagIds.has(t.id));
        if (tagsInGroup.length === 0) continue;
        // Roots first, then subtags sorted by their parent's name —
        // mirrors the app's tagHierarchy ordering. Within each tier
        // we sort by name for stability.
        const roots = tagsInGroup.filter((t) => !t.parentTagId).sort((a, b) => a.name.localeCompare(b.name));
        const subs = tagsInGroup.filter((t) => t.parentTagId).sort((a, b) => a.name.localeCompare(b.name));
        const ordered = [...roots, ...subs];
        const opts = ordered.map((t) => ({ v: t.id, l: t.parentTagId ? `↳ ${t.name}` : t.name }));
        sections.push(section(group.name, `tag:${group.id}`, opts));
      }
      return sections.join("");
    })();

    const title = target === "favorites" ? "Filter Favourites" : "Filter Spells";

    this._filterModalRegion.innerHTML = `
      <div class="dauligor-spell-manager__modal-backdrop" data-action="close-modal"></div>
      <div class="dauligor-spell-manager__modal-card" role="dialog" aria-modal="true">
        <header class="dauligor-spell-manager__modal-header">
          <h2 class="dauligor-spell-manager__modal-title">${escapeHtml(title)}</h2>
          <button type="button" class="dauligor-spell-manager__modal-close" data-action="close-modal" title="Close">×</button>
        </header>
        <div class="dauligor-spell-manager__modal-body">
          ${section("Level", "level", levelOptions)}
          ${section("School", "school", schoolOptions)}
          ${sourceOptions.length ? section("Source", "source", sourceOptions) : ""}
          ${section("Casting Time", "activation", activationOptions)}
          ${section("Range", "range", rangeOptions)}
          ${section("Duration", "duration", durationOptions)}
          ${section("Shape", "shape", shapeOptions)}
          ${section("Properties", "property", propertyOptions)}
          ${tagGroupSections}
        </div>
        <footer class="dauligor-spell-manager__modal-footer">
          <button type="button" class="dauligor-spell-manager__modal-button dauligor-spell-manager__modal-button--ghost" data-action="modal-reset">Reset</button>
          <button type="button" class="dauligor-spell-manager__modal-button" data-action="close-modal">Apply &amp; Close</button>
        </footer>
      </div>
    `;

    const close = async () => {
      this._state.filterModalOpen = null;
      await this._renderManager();
    };

    this._filterModalRegion.querySelectorAll(`[data-action="close-modal"]`).forEach((el) => {
      el.addEventListener("click", close);
    });
    this._filterModalRegion.querySelectorAll(`[data-action="modal-chip"]`).forEach((chip) => {
      chip.addEventListener("click", async () => {
        const axis = chip.dataset.axis;
        const value = chip.dataset.value;
        if (!axis || value == null) return;
        this._toggleChip(target, axis, value);
        await this._renderManager();
      });
    });
    this._filterModalRegion.querySelectorAll(`[data-action="modal-all"]`).forEach((btn) => {
      btn.addEventListener("click", async () => {
        const axis = btn.dataset.axis;
        if (!axis) return;
        const state = this._filterStateFor(target);
        const axes = { ...(state.axes ?? {}) };
        const states = {};
        const allValues = (() => {
          if (axis === "level")      return SPELL_LEVELS_ALL.map(String);
          if (axis === "school")     return SCHOOL_ORDER;
          if (axis === "activation") return ACTIVATION_ORDER;
          if (axis === "range")      return RANGE_ORDER;
          if (axis === "duration")   return DURATION_ORDER;
          if (axis === "shape")      return SHAPE_ORDER;
          if (axis === "property")   return PROPERTY_ORDER;
          if (axis === "source")     return sourcesInPool;
          // Tag-group axis (`tag:<groupId>`): "All" selects every tag
          // that's actually present in the visible pool for that
          // group — same set the chip rendering used.
          if (axis.startsWith("tag:")) {
            const gid = axis.slice("tag:".length);
            const usedTagIds = new Set();
            for (const item of visibleItems) {
              const ids = poolFlags(item).tagIds;
              if (Array.isArray(ids)) for (const id of ids) usedTagIds.add(String(id));
            }
            return (this._tagCatalog?.tagsByGroup?.get(gid) ?? [])
              .filter((t) => usedTagIds.has(t.id))
              .map((t) => t.id);
          }
          return [];
        })();
        for (const v of allValues) states[String(v)] = 1;
        axes[axis] = { ...(axes[axis] ?? {}), states };
        this._setFilterStateFor(target, { ...state, axes });
        await this._renderManager();
      });
    });
    this._filterModalRegion.querySelectorAll(`[data-action="modal-clear"]`).forEach((btn) => {
      btn.addEventListener("click", async () => {
        const axis = btn.dataset.axis;
        if (!axis) return;
        const state = this._filterStateFor(target);
        const axes = { ...(state.axes ?? {}) };
        delete axes[axis];
        this._setFilterStateFor(target, { ...state, axes });
        await this._renderManager();
      });
    });
    this._filterModalRegion.querySelector(`[data-action="modal-reset"]`)?.addEventListener("click", async () => {
      this._resetFilters(target);
      await this._renderManager();
    });
  }
}

// ---------------------------------------------------------------------------
// DauligorSpellBrowserApp — standalone spell browser
// ---------------------------------------------------------------------------

/**
 * Spell browser launched from the Dauligor Importer wizard's Spells
 * page. Identical 3-column layout to the Prepare Spells manager, but:
 *
 *   - The left rail shows SOURCES (PHB, XGE, ...) instead of classes.
 *   - The pool draws from `/api/module/<slug>/spells.json` (all spells
 *     in a source) instead of the per-class spell list.
 *   - The footer has a single "Add to Sheet (Unsorted)" toggle. Added
 *     spells get NO class attribution — they land in the alt sheet's
 *     "Other Spells" / __other__ orphan bucket, which the user can
 *     then move into a class section (gated by class spell-list
 *     membership) or a custom section.
 *
 * Implemented as a thin subclass of `DauligorSpellPreparationApp` with
 * its own static singleton + opener. The base class handles
 * mode-specific branching via `this._mode === "importer"` in render
 * methods, pool fetching, and mutation flows.
 */
export class DauligorSpellBrowserApp extends DauligorSpellPreparationApp {
  static _instance = null;

  static open({ actor, sourceSlugs = [] } = {}) {
    if (!actor) return null;
    if (this._instance) {
      this._instance.setActor(actor);
      this._instance.setSourceSlugs(sourceSlugs);
      this._instance.render({ force: true });
      this._instance.maximize?.();
      return this._instance;
    }
    const instance = new this({ actor, sourceSlugs });
    this._instance = instance;
    instance.render({ force: true });
    return instance;
  }

  constructor({ actor, sourceSlugs = [] } = {}) {
    super({
      actor,
      mode: "importer",
      sourceSlugs,
      appId: `${MODULE_ID}-spell-browser`,
      windowTitle: actor ? `Import Spells: ${actor.name}` : "Import Spells"
    });
    // Preselect the first source so the pool fills in on first paint.
    if (sourceSlugs?.length) {
      this._state.selectedClassIdentifier = `__source__:${String(sourceSlugs[0])}`;
    }
  }

  setSourceSlugs(slugs) {
    const next = Array.isArray(slugs) ? slugs.map(String) : [];
    const changed = next.join(",") !== this._sourceSlugs.join(",");
    this._sourceSlugs = next;
    if (changed) {
      // Pool cache keyed by `__source__:<slug>` — drop stale entries
      // so the pool refetches for the new selection.
      for (const key of [...this._classPools.keys()]) {
        if (key.startsWith("__source__:")) this._classPools.delete(key);
      }
      this._state.selectedClassIdentifier = next.length
        ? `__source__:${next[0]}`
        : null;
      this._state.selectedSpellDbId = null;
    }
  }

  setActor(actor, preselectClassIdentifier = null) {
    // Importer mode never preselects a class — sources, not classes.
    super.setActor(actor, null);
    if (actor) {
      this.options.window.title = `Import Spells: ${actor.name}`;
    }
  }
}

/**
 * Public opener for the spell browser. Mirrors
 * `openSpellPreparationManager` so callers get a uniform entry point.
 */
export async function openSpellBrowser(actorLike, { sourceSlugs = [] } = {}) {
  const actor = (() => {
    if (!actorLike) return null;
    if (actorLike.documentName === "Actor") return actorLike;
    if (actorLike.document?.documentName === "Actor") return actorLike.document;
    if (actorLike.actor?.documentName === "Actor") return actorLike.actor;
    return null;
  })();
  if (!actor || actor.type !== "character") {
    notifyWarn("Open Import Spells from a character actor.");
    return null;
  }
  return DauligorSpellBrowserApp.open({ actor, sourceSlugs });
}
