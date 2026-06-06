// Foundry-side Feat Browser. Opens from the Dauligor Importer wizard
// after the user picks "Feats" + one or more sources.
//
// Mirrors `DauligorSpellPreparationApp`'s 3-column layout and rhythm
// (in `spell-preparation-app.js`) but stays lean — feats don't have the
// prep-mode / spellbook / per-class-pool machinery that spells need. We
// reuse the `spell-preparation-shell.hbs` template (regions: rail,
// favorites, meta, toolbar, pool, detail, footer, filter-modal) so the
// shared dauligor-spell-manager CSS (3-col grid, sidebar split, panel
// chrome, row styling) applies with no new stylesheet additions.
//
// Layout
// ------
//   ┌────────────┬──────────────────┬───────────────────────┐
//   │ Sources    │ Search + Filters │ Detail (description,  │
//   │ ──────     │ + Reload         │  requirements, uses,  │
//   │            │                  │  source, flags)       │
//   │ Favourites │ ── Pool rows ─── │                       │
//   │  search    │                  │                       │
//   │  filter    │                  │                       │
//   │  rows      │                  │                       │
//   └────────────┴──────────────────┴───────────────────────┘
//
// Data flow
//   1. Open: for each selected source, fetch in parallel the per-source feat
//      list (`/api/module/<slug>/feats.json`, now feats-only) plus the
//      background + species LIST catalogs (`/<slug>/backgrounds.json` ·
//      `/<slug>/species.json`); catalog rows are synthesized into feat-shaped
//      pool entries (featType "background"/"race"). Merge to one pool, sort by
//      featType + name.
//   2. Row select: stash the dbId in state, kick off a background fetch of the
//      type's detail endpoint (feats/<id>, backgrounds/<id>, or races/<id>).
//   3. Import: ensure the full item is loaded, then
//      `actor.createEmbeddedDocuments("Item", [full])` (or update an
//      existing match via `flags.dauligor-pairing.sourceId`).
//
// Favourites: stored on the actor flag `featFavorites` (string[] of
// dbIds). Parallel to the spell side's `spellFavorites`. Star toggle on
// each row; pinned panel in the sidebar's lower half.
//
// Filters: tri-state pill modal via the shared section-filter-panel
// primitive. Two axis sets matching the in-app `/compendium/feats`
// browser:
//   - Feat Type        (general / class feature / subclass feature / etc.)
//   - Properties       (repeatable / has-uses / has-activities /
//                       has-effects / has-advancements / has-prereqs)
//
// See `module/dauligor-pairing/docs/feat-import-contract.md` for the
// payload contract and `_featExport.ts` for the Foundry-ready shape
// served at embed time.

import { MODULE_ID, SETTINGS, SPELL_PREPARATION_TEMPLATE } from "./constants.js";
import { log, notifyInfo, notifyWarn } from "./utils.js";
import {
  renderSectionFilterPanel,
  bindSectionFilterPanelEvents,
  nextStateForward,
  nextStateReverse,
  nextCombineMode,
  nextCombineModeReverse,
  matchesSingleAxis,
  matchesMultiAxis,
} from "./section-filter-panel.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

// Reuse the spell-preparation shell — same region anchors, same CSS
// hooks (3-col grid + panel chrome). The `--picker` modifier class on
// the outer wrapper is what activates the 3-col grid; we add our own
// `dauligor-feat-browser` modifier alongside for targeted overrides.
const FEAT_BROWSER_TEMPLATE = SPELL_PREPARATION_TEMPLATE;

// ---------------------------------------------------------------------------
// Filter-axis constants — mirror src/lib/featFilters.ts so the modal's
// chip vocabulary matches /compendium/feats. The in-app browser exposes
// Source + Feat Type + Properties; the Foundry pool already comes pre-
// scoped to the wizard's selected sources, so we drop the Source axis
// here and keep Feat Type + Properties.
// ---------------------------------------------------------------------------

const FEAT_TYPE_LABELS = {
  feat: "Feat",
  class: "Class Feature",
  subclass: "Subclass Feature",
  // `race` / `background` rows ARE the race / background entities (they export
  // as Foundry `type:"race"` / `"background"`), not features of them — label
  // them accordingly. They come from the per-source species/background catalogs.
  race: "Race",
  background: "Background",
  monster: "Monster Feature",
};
const FEAT_TYPE_ORDER = ["feat", "class", "subclass", "race", "background", "monster"];

// Property axis values map to summary flag keys. The summary's flat
// boolean fields (`repeatable`, `hasUses`, ...) are projected to a
// Set<string> per row in `_propertyFlagsForRow` and matched against the
// axis's tri-state include/exclude pills.
const FEAT_PROPERTY_LABELS = {
  repeatable: "Repeatable",
  hasUses: "Limited Uses",
  hasActivities: "Activities",
  hasEffects: "Effects",
  hasAdvancements: "Advancements",
  hasPrereqs: "Prerequisites",
};
const FEAT_PROPERTY_ORDER = [
  "repeatable",
  "hasUses",
  "hasActivities",
  "hasEffects",
  "hasAdvancements",
  "hasPrereqs",
];

// ---------------------------------------------------------------------------
// Tiny helpers
// ---------------------------------------------------------------------------

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

function featFlags(feat) {
  return feat?.flags?.[MODULE_ID] ?? {};
}

function featDbId(feat) {
  return String(featFlags(feat).dbId ?? "");
}

function featTypeLabel(featType) {
  return FEAT_TYPE_LABELS[String(featType ?? "")] || String(featType ?? "feat");
}

// Backgrounds and species are pulled into this browser's pool from their own
// per-source LIST catalogs (synthesized as feat-shaped entries tagged by
// `featType`), and they export as their own Foundry item type from dedicated
// detail endpoints. Map the row's featType to the detail endpoint segment, the bundle
// `kind` to expect, and the key the full item lives under in that bundle.
// Anything not listed (feat / class / subclass / monster features) uses the
// feat endpoint. See docs/feat-import-contract.md + the bg/race import contract.
const DETAIL_ENDPOINT_BY_FEAT_TYPE = {
  background: { segment: "backgrounds", kind: "dauligor.background-item.v1", key: "background" },
  race: { segment: "races", kind: "dauligor.race-item.v1", key: "race" },
};

function detailEndpointFor(featType) {
  return (
    DETAIL_ENDPOINT_BY_FEAT_TYPE[String(featType ?? "")] ??
    { segment: "feats", kind: "dauligor.feat-item.v1", key: "feat" }
  );
}

/**
 * Pull a numeric character-level requirement out of a free-text
 * `requirements` string. Handles the two formats Dauligor ships:
 *   - "Level 4+, …"     (DMG / Tasha's-style prereqs)
 *   - "4th level …"     (PHB-style prereqs, "1st", "2nd", "3rd", …)
 *
 * Returns null when no level prereq is found — the row chip is then
 * suppressed entirely so feats without a level requirement get no
 * visual clutter.
 *
 * Kept lenient on purpose. The "+" suffix is optional, capitalisation
 * is ignored, and trailing punctuation / additional prereqs after the
 * level are tolerated. This is cosmetic — a missed match just hides
 * the chip; it doesn't break the import.
 */
function extractLevelPrereq(requirements) {
  if (!requirements) return null;
  const str = String(requirements).trim();
  if (!str) return null;
  let m = str.match(/\blevel\s+(\d+)\b/i);
  if (m) return parseInt(m[1], 10);
  m = str.match(/\b(\d+)(?:st|nd|rd|th)\s+level\b/i);
  if (m) return parseInt(m[1], 10);
  return null;
}

/** Project a feat's summary flags to a Set<string> of property keys. */
function _propertyFlagsForRow(feat) {
  const f = featFlags(feat);
  const out = new Set();
  if (f.repeatable) out.add("repeatable");
  if (f.hasUses) out.add("hasUses");
  if (f.hasActivities) out.add("hasActivities");
  if (f.hasEffects) out.add("hasEffects");
  if (f.hasAdvancements) out.add("hasAdvancements");
  if (f.hasPrereqs) out.add("hasPrereqs");
  return out;
}

/**
 * Find an existing match for an item on the actor — same precedence the
 * class importer + previous feat browser used:
 *   1. flags.dauligor-pairing.sourceId
 *   2. name + type
 */
function findExistingMatch(actor, item) {
  const sourceId = item?.flags?.[MODULE_ID]?.sourceId ?? null;
  return Array.from(actor.items ?? []).find((embedded) => {
    if (sourceId) {
      const embeddedSourceId = embedded.getFlag(MODULE_ID, "sourceId");
      if (embeddedSourceId && embeddedSourceId === sourceId) return true;
    }
    return embedded.name === item.name && embedded.type === item.type;
  });
}

/**
 * Center an ApplicationV2 frame BEFORE the first paint. Copy of the
 * helper used by `importer-app.js` / spell-preparation-app, kept local
 * so this module doesn't drag in the heavier neighbours just for
 * window framing.
 */
function applyCenteredPositionToFrame(frame, { width, height }) {
  if (!frame || !Number.isFinite(width) || !Number.isFinite(height)) return;
  const vw = document.documentElement.clientWidth || window.innerWidth || 0;
  const vh = document.documentElement.clientHeight || window.innerHeight || 0;
  const left = Math.max(0, Math.round((vw - width) / 2));
  const top = Math.max(0, Math.round((vh - height) / 2));
  frame.style.width = `${width}px`;
  frame.style.height = `${height}px`;
  frame.style.left = `${left}px`;
  frame.style.top = `${top}px`;
}

/**
 * Fresh ephemeral filter-modal UI state. Each filter target (pool /
 * favorites) keeps its own copy so a Hide-All in one doesn't collapse
 * the other. Mirrors `createFreshFilterUiState()` in
 * spell-preparation-app.js.
 */
function createFreshFilterUiState() {
  return {
    hiddenAxes: new Set(),
    expandedParents: new Map(),
    allSubtagAxes: new Set(),
    altLabelAxes: new Set(),
    chipSearch: "",
  };
}

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

export class DauligorFeatBrowserApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static _instance = null;

  static async open({ actor, sourceSlugs = [] } = {}) {
    if (!actor) {
      notifyWarn("Open the Feat Browser from a character actor.");
      return null;
    }
    if (this._instance) {
      this._instance.setActor(actor);
      this._instance.setSourceSlugs(sourceSlugs);
      await this._instance.render({ force: true });
      this._instance.maximize?.();
      return this._instance;
    }
    const instance = new this({ actor, sourceSlugs });
    this._instance = instance;
    await instance.render({ force: true });
    return instance;
  }

  constructor({ actor, sourceSlugs = [] } = {}) {
    // Match the spell-prep window dimensions so the two browsers feel
    // identical when toggling between Spells and Feats imports.
    const width = Math.min(window.innerWidth - 120, 1280);
    const height = Math.min(window.innerHeight - 120, 820);
    super({
      id: `${MODULE_ID}-feat-browser`,
      classes: ["dauligor-importer-app", "dauligor-feat-browser"],
      window: {
        title: actor ? `Import Feats: ${actor.name}` : "Import Feats",
        resizable: true,
        contentClasses: ["dauligor-importer-window", "dauligor-spell-manager-host"],
      },
      position: { width, height },
    });

    this._actor = actor;
    this._sourceSlugs = Array.isArray(sourceSlugs) ? sourceSlugs.map(String) : [];

    // Pool state: { status: "idle"|"loading"|"ready"|"error", feats?, errors?, reason? }
    this._pool = { status: "idle", feats: [] };
    // Full-feat fetch cache, keyed by dbId.
    this._fullFeatCache = new Map();
    this._fullFeatInFlight = new Set();

    // UI state.
    this._state = {
      poolSearch: "",
      favSearch: "",
      selectedDbId: null,
      poolFilters: { axes: {} },
      favFilters: { axes: {} },
      poolFilterUi: createFreshFilterUiState(),
      favFilterUi: createFreshFilterUiState(),
      filterModalOpen: null, // "pool" | "favorites" | null
      filterSnapshot: null,
      status: "",
      statusLevel: "",
    };

    // Region handles populated by `_onRender`.
    this._railRegion = null;
    this._favoritesRegion = null;
    this._metaRegion = null;
    this._toolbarRegion = null;
    this._poolRegion = null;
    this._detailRegion = null;
    this._footerRegion = null;
    this._filterModalRegion = null;

    // Cached map of sourceSlug → human label (PHB, etc.). Populated when
    // the source catalog is fetched; falls back to the slug verbatim if
    // the catalog endpoint is unreachable.
    this._sourceLabels = new Map();
  }

  _configureRenderParts() {
    return { main: { template: FEAT_BROWSER_TEMPLATE } };
  }

  async _renderFrame(options) {
    const frame = await super._renderFrame(options);
    applyCenteredPositionToFrame(frame, this.position);
    return frame;
  }

  async close(options) {
    if (DauligorFeatBrowserApp._instance === this) DauligorFeatBrowserApp._instance = null;
    return super.close(options);
  }

  setActor(actor) {
    this._actor = actor;
    if (actor) this.options.window.title = `Import Feats: ${actor.name}`;
  }

  setSourceSlugs(slugs) {
    const next = Array.isArray(slugs) ? slugs.map(String) : [];
    const changed = next.join(",") !== this._sourceSlugs.join(",");
    this._sourceSlugs = next;
    if (changed) {
      this._pool = { status: "idle", feats: [] };
      this._state.selectedDbId = null;
    }
  }

  async _onRender() {
    super._onRender?.(...arguments);

    const root = this.element instanceof HTMLElement
      ? this.element
      : (this.element?.[0] instanceof HTMLElement
        ? this.element[0]
        : document.getElementById(this.id));
    if (!root) return;

    // Mark the shell as picker-mode so the shared
    // `.dauligor-spell-manager--picker` CSS kicks in (3-col grid, panel
    // chrome). The template already emits the outer section with that
    // class; the find/assign below is defensive in case the markup
    // shifts.
    const shell = root.querySelector(".dauligor-spell-manager");
    if (shell) {
      shell.classList.add("dauligor-spell-manager--picker");
      shell.classList.add("dauligor-feat-browser__shell");
    }

    const content = root.querySelector(".window-content") ?? root;
    this._railRegion = content.querySelector(`[data-region="rail"]`);
    this._favoritesRegion = content.querySelector(`[data-region="favorites"]`);
    this._metaRegion = content.querySelector(`[data-region="meta"]`);
    this._toolbarRegion = content.querySelector(`[data-region="toolbar"]`);
    this._poolRegion = content.querySelector(`[data-region="pool"]`);
    this._detailRegion = content.querySelector(`[data-region="detail"]`);
    this._footerRegion = content.querySelector(`[data-region="footer"]`);
    this._filterModalRegion = content.querySelector(`[data-region="filter-modal"]`);

    if (this._pool.status === "idle") {
      await this._loadPool();
    }
    this._renderAll();
  }

  // -----------------------------------------------------------------------
  // Pool fetch
  // -----------------------------------------------------------------------

  async _loadPool() {
    if (!this._sourceSlugs.length) {
      this._pool = { status: "error", reason: "No source selected." };
      return;
    }

    this._pool = { status: "loading" };
    this._renderAll();

    const host = resolveApiHost();
    const collected = [];
    const errors = [];

    // The per-source feat list — now feats-only, since backgrounds & species
    // were promoted out of the `feats` table into their own tables. Each feat is
    // already a Foundry-shaped item with flags.dauligor-pairing.{dbId,featType,…}.
    const fetchFeats = async (slug) => {
      const url = `${host}/api/module/${encodeURIComponent(slug)}/feats.json`;
      try {
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) {
          errors.push(`${slug} feats: HTTP ${response.status}`);
          return;
        }
        const payload = await response.json();
        if (payload?.kind !== "dauligor.source-feat-list.v1") {
          errors.push(`${slug} feats: unexpected payload kind ${payload?.kind ?? "(missing)"}`);
          return;
        }
        const sourceSemanticId = String(payload.sourceSemanticId ?? payload.sourceSlug ?? slug);
        // Stamp `__sourceSlug`/`__sourceSemanticId` for nicer display in detail
        // header / rail. Stored OUTSIDE flags.dauligor-pairing so it doesn't
        // pollute the payload's contract — purely a local-render concern.
        const feats = Array.isArray(payload.feats) ? payload.feats : [];
        for (const feat of feats) {
          feat.__sourceSlug = slug;
          feat.__sourceSemanticId = sourceSemanticId;
          collected.push(feat);
        }
        this._sourceLabels.set(slug, String(payload.sourceSlug || slug).toUpperCase());
      } catch (err) {
        log(`feat-browser fetch failed for ${slug}`, err);
        errors.push(`${slug} feats: ${err?.message ?? "network error"}`);
      }
    };

    // Backgrounds & species now come from their own per-source LIST catalogs
    // (lightweight {dbId,name,img,summary,tags}). Synthesize a minimal feat-
    // shaped pool entry per row — with flags.dauligor-pairing.featType set to
    // "background"/"race" — so they flow through the same sort/group/filter
    // pipeline, and `_ensureFullFeat` routes their detail/import to the
    // dedicated /backgrounds/<id> · /races/<id> endpoints (see detailEndpointFor).
    const fetchCatalog = async (slug, file, expectKind, featType) => {
      const url = `${host}/api/module/${encodeURIComponent(slug)}/${file}`;
      try {
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) {
          errors.push(`${slug} ${file}: HTTP ${response.status}`);
          return;
        }
        const payload = await response.json();
        if (payload?.kind !== expectKind) {
          errors.push(`${slug} ${file}: unexpected payload kind ${payload?.kind ?? "(missing)"}`);
          return;
        }
        const sourceSemanticId = String(payload?.source?.sourceId ?? slug);
        for (const entry of (Array.isArray(payload.entries) ? payload.entries : [])) {
          const dbId = String(entry?.dbId ?? "");
          const name = String(entry?.name ?? "");
          if (!dbId || !name) continue;
          collected.push({
            name,
            img: entry?.img || "",
            type: featType === "race" ? "race" : "background",
            flags: { [MODULE_ID]: { dbId, featType, summary: String(entry?.summary ?? "") } },
            __sourceSlug: slug,
            __sourceSemanticId: sourceSemanticId,
          });
        }
        if (!this._sourceLabels.has(slug)) this._sourceLabels.set(slug, slug.toUpperCase());
      } catch (err) {
        log(`feat-browser catalog fetch failed for ${slug}/${file}`, err);
        errors.push(`${slug} ${file}: ${err?.message ?? "network error"}`);
      }
    };

    await Promise.all(this._sourceSlugs.flatMap((slug) => [
      fetchFeats(slug),
      fetchCatalog(slug, "backgrounds.json", "dauligor.background-catalog.v1", "background"),
      fetchCatalog(slug, "species.json", "dauligor.species-catalog.v1", "race"),
    ]));

    // Stable sort: featType asc, then name asc.
    collected.sort((a, b) => {
      const ta = String(featFlags(a).featType || "");
      const tb = String(featFlags(b).featType || "");
      if (ta !== tb) return ta.localeCompare(tb);
      return String(a?.name || "").localeCompare(String(b?.name || ""));
    });

    this._pool = collected.length || !errors.length
      ? { status: "ready", feats: collected, errors }
      : { status: "error", reason: errors.join("; ") };
  }

  // -----------------------------------------------------------------------
  // Full-feat fetch + cache
  // -----------------------------------------------------------------------

  /**
   * Find the featType for a pool entry by dbId, so the detail fetch can route
   * backgrounds/species to their own endpoints. Scans the current merged pool
   * (feats + synthesized background/species rows) and returns the first match's
   * featType. Defaults to "feat" when the entry isn't in the current pool
   * (e.g. a cross-source favorite).
   */
  _featTypeForDbId(dbId) {
    const feats = Array.isArray(this._pool?.feats) ? this._pool.feats : [];
    const match = feats.find((f) => featDbId(f) === String(dbId));
    return String(featFlags(match).featType || "feat");
  }

  async _ensureFullFeat(dbId) {
    if (!dbId) return null;
    if (this._fullFeatCache.has(dbId)) return this._fullFeatCache.get(dbId);
    if (this._fullFeatInFlight.has(dbId)) return null;

    // Route by featType: backgrounds/races export from their own endpoints as
    // their own Foundry item type; everything else uses the feat endpoint.
    const endpoint = detailEndpointFor(this._featTypeForDbId(dbId));
    const host = resolveApiHost();
    const url = `${host}/api/module/${endpoint.segment}/${encodeURIComponent(dbId)}.json`;
    this._fullFeatInFlight.add(dbId);
    try {
      const response = await fetch(url, { cache: "no-store" });
      this._fullFeatInFlight.delete(dbId);
      if (!response.ok) {
        log(`feat-browser full-item fetch returned ${response.status}`, { url });
        return null;
      }
      const payload = await response.json();
      if (payload?.kind !== endpoint.kind) {
        log("feat-browser unexpected full-item payload kind", { url, expected: endpoint.kind, kind: payload?.kind });
        return null;
      }
      const full = payload[endpoint.key] ?? null;
      if (full) {
        this._fullFeatCache.set(dbId, full);
        if (this._state.selectedDbId === dbId) {
          this._renderDetail();
          this._renderFooter();
        }
      }
      return full;
    } catch (err) {
      this._fullFeatInFlight.delete(dbId);
      log("feat-browser full-feat fetch failed", { url, err });
      return null;
    }
  }

  // -----------------------------------------------------------------------
  // Favorites (actor flag `featFavorites`)
  // -----------------------------------------------------------------------

  _getFavoriteDbIds() {
    const raw = this._actor?.getFlag?.(MODULE_ID, "featFavorites") ?? [];
    return new Set(Array.isArray(raw) ? raw.map((v) => String(v)) : []);
  }

  async _toggleFavorite(dbId) {
    if (!this._actor || !dbId) return;
    const current = this._getFavoriteDbIds();
    if (current.has(dbId)) current.delete(dbId);
    else current.add(dbId);
    try {
      await this._actor.setFlag(MODULE_ID, "featFavorites", [...current]);
    } catch (err) {
      log("favorite toggle failed", err);
      notifyWarn("Could not update favorites — see console.");
      return;
    }
    this._renderAll();
  }

  /**
   * Build a pool covering favourited feats. Unlike the spell side we
   * don't need to walk multiple class pools — every feat lives in a
   * single per-source list. Walks the loaded pool first; for any
   * favourited dbId missing from the pool (e.g. user picked a different
   * source set this open), synthesizes a minimal summary from the
   * full-feat cache when available.
   */
  _buildFavoritesPool() {
    const favIds = this._getFavoriteDbIds();
    if (favIds.size === 0) return [];

    const seen = new Set();
    const out = [];

    const poolFeats = Array.isArray(this._pool?.feats) ? this._pool.feats : [];
    for (const feat of poolFeats) {
      const id = featDbId(feat);
      if (!favIds.has(id) || seen.has(id)) continue;
      seen.add(id);
      out.push(feat);
    }

    // Synthesize for any favourite not in the current pool but in cache.
    for (const id of favIds) {
      if (seen.has(id)) continue;
      const full = this._fullFeatCache.get(id);
      if (!full) continue;
      out.push({
        name: full.name ?? "",
        type: String(full?.type ?? "feat"),
        img: full.img,
        flags: {
          [MODULE_ID]: {
            dbId: id,
            // Prefer the full item's own Dauligor flags (set server-side and
            // correct for backgrounds/races); fall back to the Foundry item
            // type, then "feat". Do NOT read `system.type.value` — for a race
            // that's the creature type ("humanoid"), not the featType.
            featType: String(full?.flags?.[MODULE_ID]?.featType ?? full?.type ?? "feat"),
            featSubtype: String(full?.flags?.[MODULE_ID]?.featSubtype ?? ""),
            repeatable: !!full?.system?.prerequisites?.repeatable,
            hasUses: !!String(full?.system?.uses?.max ?? "").trim(),
            hasActivities:
              full?.system?.activities && typeof full.system.activities === "object"
                ? Object.keys(full.system.activities).length > 0
                : false,
            hasEffects: Array.isArray(full?.effects) && full.effects.length > 0,
            hasAdvancements:
              full?.system?.advancement && typeof full.system.advancement === "object"
                ? Object.keys(full.system.advancement).length > 0
                : false,
            hasPrereqs: !!String(full?.system?.requirements ?? "").trim(),
            // Sync with the summary contract — `requirements` is the
            // short prereq string used for both the row level chip
            // and the detail-pane "Prerequisites: …" line.
            requirements: String(full?.system?.requirements ?? ""),
            tagIds: [],
          },
        },
      });
      seen.add(id);
    }

    return out;
  }

  // -----------------------------------------------------------------------
  // Filter axis state + matching
  // -----------------------------------------------------------------------

  _filterStateFor(target) {
    return target === "favorites" ? this._state.favFilters : this._state.poolFilters;
  }
  _searchFor(target) {
    return target === "favorites" ? this._state.favSearch : this._state.poolSearch;
  }
  _setSearchFor(target, value) {
    if (target === "favorites") this._state.favSearch = value;
    else this._state.poolSearch = value;
  }
  _uiStateFor(target) {
    return target === "favorites" ? this._state.favFilterUi : this._state.poolFilterUi;
  }

  /**
   * Apply search + axis filters to a list of feats. Mirrors the in-app
   * FeatList filter pipeline (match by name/identifier/subtype + axes).
   */
  _filterList(list, target) {
    const search = String(this._searchFor(target) || "").trim().toLowerCase();
    const filterState = this._filterStateFor(target);
    const axes = filterState?.axes ?? {};

    const typeAxis = axes.type;
    const propAxis = axes.property;

    return list.filter((feat) => {
      const f = featFlags(feat);
      const name = String(feat?.name || "").toLowerCase();
      const subtype = String(f.featSubtype || "").toLowerCase();
      const featType = String(f.featType || "");

      if (search) {
        const hay = name + " " + subtype + " " + featType.toLowerCase();
        if (!hay.includes(search)) return false;
      }

      // Feat-type axis: single-value include/exclude per type. The
      // shared `matchesSingleAxis` helper applies the same OR/AND/XOR
      // semantics the in-app filter chain uses.
      if (typeAxis && !matchesSingleAxis(featType, typeAxis)) return false;

      // Property axis: multi-value match against the row's prop set.
      if (propAxis) {
        const have = _propertyFlagsForRow(feat);
        if (!matchesMultiAxis(have, propAxis)) return false;
      }

      return true;
    });
  }

  _activeFilterCount(target) {
    const state = this._filterStateFor(target);
    const axes = state?.axes ?? {};
    let count = 0;
    for (const axis of Object.values(axes)) {
      for (const v of Object.values(axis?.states ?? {})) {
        if (v === 1 || v === 2) count++;
      }
    }
    return count;
  }

  // -----------------------------------------------------------------------
  // Render dispatch
  // -----------------------------------------------------------------------

  _renderAll() {
    this._renderRail();
    this._renderFavorites();
    this._renderMeta();
    this._renderToolbar();
    this._renderPool();
    this._renderDetail();
    this._renderFooter();
    this._renderFilterModal();
  }

  // -----------------------------------------------------------------------
  // Sidebar: source rail (TOP HALF) — INTENTIONALLY HIDDEN
  // -----------------------------------------------------------------------
  //
  // The feat browser merges every selected source into a single pool
  // (the wizard already collected the source list). A rail with just
  // source counts adds clutter without giving the user a way to act
  // on the data — the user can't browse one source at a time and the
  // counts aren't actionable. Match the spell-preparation-app in
  // importer mode (it also hides its rail) so the favourites region
  // fills the entire sidebar via `flex: 1`.

  _renderRail() {
    if (!this._railRegion) return;
    this._railRegion.style.display = "none";
    this._railRegion.innerHTML = "";
  }

  // -----------------------------------------------------------------------
  // Sidebar: favorites (bottom half)
  // -----------------------------------------------------------------------

  _renderFavorites() {
    if (!this._favoritesRegion) return;

    const allFavorites = this._buildFavoritesPool();
    const filtered = this._filterList(allFavorites, "favorites");

    const toolbarHtml = this._buildToolbarHtml({
      target: "favorites",
      placeholder: "Search favourites…",
      filteredCount: filtered.length,
      totalCount: allFavorites.length,
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
          <div class="dauligor-spell-manager__favorites-empty-hint">Star feats in the middle column to pin them here.</div>
        </div>
      `;
      this._bindSidebarToolbar(this._favoritesRegion, "favorites");
      return;
    }

    if (filtered.length === 0) {
      this._favoritesRegion.innerHTML = `${header}
        <div class="dauligor-spell-manager__favorites-empty">
          <div class="dauligor-spell-manager__favorites-empty-hint">No favourites match the current filters.</div>
        </div>
      `;
      this._bindSidebarToolbar(this._favoritesRegion, "favorites");
      return;
    }

    const rows = filtered.map((feat) => this._buildRowHtml(feat, { isFav: true })).join("");
    this._favoritesRegion.innerHTML = `${header}
      <div class="dauligor-spell-manager__favorites-list">${rows}</div>
    `;
    this._bindSidebarToolbar(this._favoritesRegion, "favorites");
    this._bindRowEvents(this._favoritesRegion);
  }

  _bindSidebarToolbar(region, target) {
    if (!region) return;
    region.querySelectorAll(`[data-region-toolbar="${target}"][data-action="search"]`).forEach((el) => {
      el.addEventListener("input", (event) => {
        const cursor = event.currentTarget.selectionStart;
        this._setSearchFor(target, event.currentTarget.value ?? "");
        // Re-render the changed pane + its toolbar (the toolbar redraws
        // because the count overlay + clear ✕ depend on the search
        // value). Restore focus + caret afterwards so each keystroke
        // doesn't kick the user out of the input.
        if (target === "favorites") this._renderFavorites();
        else {
          this._renderToolbar();
          this._renderPool();
        }
        const next = region.querySelector(`[data-region-toolbar="${target}"][data-action="search"]`);
        if (next instanceof HTMLInputElement) {
          next.focus();
          try { next.setSelectionRange(cursor, cursor); } catch { /* noop */ }
        }
      });
    });
    region.querySelectorAll(`[data-region-toolbar="${target}"][data-action="clear-search"]`).forEach((el) => {
      el.addEventListener("click", () => {
        this._setSearchFor(target, "");
        if (target === "favorites") this._renderFavorites();
        else { this._renderToolbar(); this._renderPool(); }
      });
    });
    region.querySelectorAll(`[data-region-toolbar="${target}"][data-action="filter"]`).forEach((el) => {
      el.addEventListener("click", () => this._openFilterModal(target));
    });
  }

  // -----------------------------------------------------------------------
  // Middle: meta + toolbar + pool
  // -----------------------------------------------------------------------

  _renderMeta() {
    if (!this._metaRegion) return;
    // Meta strip is INTENTIONALLY HIDDEN. The source list lives in the
    // window title ("Import Feats: <Actor>"); a "Sources: SCC + …"
    // bar above the toolbar duplicates that context and steals
    // vertical space the pool list could use. Match the
    // spell-preparation-app's importer-mode behaviour: empty + display
    // none so the parent's padding doesn't leave a thin gap.
    this._metaRegion.innerHTML = "";
    this._metaRegion.style.display = "none";
  }

  /**
   * Build toolbar HTML using the exact same conventions as
   * `DauligorSpellPreparationApp._buildToolbarHtml`: an inline-search
   * wrap (input + clear ✕ + count overlay), then a Filters button
   * with an active-count badge. Shared between the pool toolbar and
   * the favourites toolbar.
   */
  _buildToolbarHtml({ target, placeholder, filteredCount, totalCount }) {
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
          data-region-toolbar="${escapeHtml(target)}"
          data-action="search"
          placeholder="${escapeHtml(placeholder)}"
          value="${escapeHtml(searchValue)}"
          autocomplete="off"
          spellcheck="false"
        >
        ${searchValue ? `<button type="button" class="dauligor-spell-manager__inline-search-clear" data-region-toolbar="${escapeHtml(target)}" data-action="clear-search" title="Clear search" aria-label="Clear search">×</button>` : ""}
        ${countLabel ? `<span class="dauligor-spell-manager__inline-search-count" aria-live="polite">${countLabel}</span>` : ""}
      </div>
      <button type="button"
        class="dauligor-spell-manager__filter-button ${filtersActive > 0 ? "dauligor-spell-manager__filter-button--active" : ""}"
        data-region-toolbar="${escapeHtml(target)}"
        data-action="filter"
        title="Open filter options"
      >
        <span class="dauligor-spell-manager__filter-button-label">Filters</span>
        ${filtersActive > 0 ? `<span class="dauligor-spell-manager__filter-count-badge">${filtersActive}</span>` : ""}
      </button>
    `;
  }

  _renderToolbar() {
    if (!this._toolbarRegion) return;
    const allFeats = Array.isArray(this._pool?.feats) ? this._pool.feats : [];
    const filtered = this._filterList(allFeats, "pool");
    this._toolbarRegion.innerHTML = this._buildToolbarHtml({
      target: "pool",
      placeholder: "Search feat name…",
      filteredCount: filtered.length,
      totalCount: allFeats.length,
    });
    this._bindSidebarToolbar(this._toolbarRegion, "pool");
  }

  _renderPool() {
    if (!this._poolRegion) return;

    if (this._pool.status === "loading") {
      this._poolRegion.innerHTML = `<div class="dauligor-spell-manager__detail-empty">
        <div class="dauligor-spell-manager__detail-empty-hint">Loading feats…</div>
      </div>`;
      return;
    }
    if (this._pool.status === "error") {
      this._poolRegion.innerHTML = `<div class="dauligor-spell-manager__detail-empty">
        <div class="dauligor-spell-manager__detail-empty-title">Failed to load feats</div>
        <div class="dauligor-spell-manager__detail-empty-hint">${escapeHtml(this._pool.reason || "")}</div>
      </div>`;
      return;
    }

    const allFeats = Array.isArray(this._pool?.feats) ? this._pool.feats : [];
    const feats = this._filterList(allFeats, "pool");

    if (feats.length === 0) {
      this._poolRegion.innerHTML = `<div class="dauligor-spell-manager__detail-empty">
        <div class="dauligor-spell-manager__detail-empty-hint">No feats match the current search/filters.</div>
      </div>`;
      return;
    }

    // Group rows by featType so the pool reads like a sectioned list —
    // mirrors the in-app FeatList's default group-by-type ordering.
    const byType = new Map();
    for (const feat of feats) {
      const t = String(featFlags(feat).featType || "feat");
      if (!byType.has(t)) byType.set(t, []);
      byType.get(t).push(feat);
    }
    // Stable group ordering using FEAT_TYPE_ORDER, then alpha for unknowns.
    const groups = [...byType.keys()].sort((a, b) => {
      const ai = FEAT_TYPE_ORDER.indexOf(a);
      const bi = FEAT_TYPE_ORDER.indexOf(b);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.localeCompare(b);
    });

    const sectionsHtml = groups.map((t) => {
      const rowsHtml = byType.get(t).map((feat) => this._buildRowHtml(feat, { isFav: false })).join("");
      return `
        <section class="dauligor-spell-manager__pool-band">
          <header class="dauligor-spell-manager__pool-band-header">
            <span class="dauligor-spell-manager__pool-band-name">${escapeHtml(featTypeLabel(t))}</span>
            <span class="dauligor-spell-manager__pool-band-count">${byType.get(t).length}</span>
          </header>
          <div class="dauligor-spell-manager__pool-band-list">${rowsHtml}</div>
        </section>
      `;
    }).join("");

    this._poolRegion.innerHTML = sectionsHtml;
    this._bindRowEvents(this._poolRegion);
  }

  _buildRowHtml(feat /* , { isFav = false } = {} */) {
    const f = featFlags(feat);
    const dbId = featDbId(feat);
    const isSelected = dbId === this._state.selectedDbId;
    const favIds = this._getFavoriteDbIds();
    const isFavorited = favIds.has(dbId);

    // Per the cleanup pass: a row only needs the feat's NAME and (if
    // present) its level prerequisite. Activities / Uses / Effects /
    // Advancements are all part of the feat description; surfacing
    // them as monospace glyph chips on every row just creates noise.
    // The grid columns (indicator, badges, school, source, star) from
    // the shared `pool-row` CSS still apply; we leave the unused cells
    // as empty placeholders so alignment is preserved across the
    // pool + favourites lists.
    const level = extractLevelPrereq(String(f.requirements ?? ""));
    const levelChip = (level != null)
      ? `<span class="dauligor-feat-browser__level-chip" title="Level ${level}+ required">Lv ${level}</span>`
      : "";

    return `
      <div class="dauligor-spell-manager__pool-row ${isSelected ? "dauligor-spell-manager__pool-row--selected" : ""}"
           data-action="select-feat"
           data-db-id="${escapeHtml(dbId)}">
        <span class="dauligor-spell-manager__row-indicator" aria-hidden="true"></span>
        <span class="dauligor-spell-manager__row-name">${escapeHtml(String(feat?.name || "Unnamed feat"))}</span>
        <span class="dauligor-spell-manager__row-badges">${levelChip}</span>
        <span class="dauligor-spell-manager__row-school" aria-hidden="true"></span>
        <span class="dauligor-spell-manager__row-source" aria-hidden="true"></span>
        <button type="button"
          class="dauligor-spell-manager__row-star ${isFavorited ? "dauligor-spell-manager__row-star--active" : ""}"
          data-action="toggle-fav"
          data-db-id="${escapeHtml(dbId)}"
          title="${isFavorited ? "Remove from favourites" : "Add to favourites"}"
          aria-label="${isFavorited ? "Remove from favourites" : "Add to favourites"}"
        >★</button>
      </div>
    `;
  }

  _bindRowEvents(region) {
    if (!region) return;
    region.querySelectorAll(`[data-action="select-feat"]`).forEach((row) => {
      row.addEventListener("click", (event) => {
        // Ignore clicks that bubbled up from the star toggle.
        if (event.target.closest(`[data-action="toggle-fav"]`)) return;
        const dbId = row.dataset.dbId;
        if (!dbId) return;
        this._state.selectedDbId = dbId;
        this._ensureFullFeat(dbId).catch((err) => log("full-feat fetch failed", err));
        // Re-render rows in both panes (selected highlight) + detail + footer.
        this._renderPool();
        this._renderFavorites();
        this._renderDetail();
        this._renderFooter();
      });
    });
    region.querySelectorAll(`[data-action="toggle-fav"]`).forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        const dbId = btn.dataset.dbId;
        if (!dbId) return;
        this._toggleFavorite(dbId).catch((err) => log("toggle-fav failed", err));
      });
    });
  }

  // -----------------------------------------------------------------------
  // Right column: detail pane
  // -----------------------------------------------------------------------

  /**
   * Detail pane — mirrors `DauligorSpellPreparationApp._renderDetail`.
   *
   * Spec from the cleanup pass:
   *   - Only NAME + PREREQUISITES are surfaced separately. Activities,
   *     uses, effects, advancements, etc. are all part of the feat's
   *     description, so listing them as chips/sections under the title
   *     duplicates information the user can see in the body.
   *   - The icon rides INLINE in the title row (no info-grid hero).
   *     Feats don't have a Casting Time / Range / Components grid for
   *     the image to sit beside, so a 96x96 hero image would float in
   *     empty space. A 32x32 thumb next to the title is enough to give
   *     the pane visual identity without bloating the header.
   *   - Source chip + star toggle still ride on the title row, same
   *     placement the spell detail pane uses.
   */
  _renderDetail() {
    if (!this._detailRegion) return;
    const dbId = this._state.selectedDbId;
    if (!dbId) {
      this._detailRegion.innerHTML = `
        <div class="dauligor-spell-manager__detail-empty">
          <div class="dauligor-spell-manager__detail-empty-title">No feat selected</div>
          <div class="dauligor-spell-manager__detail-empty-hint">Pick a feat from the middle column to preview it here.</div>
        </div>
      `;
      return;
    }

    // Summary row (from the loaded pool) drives the header even before
    // the full fetch resolves — same trick the spell-prep app uses.
    const fromPool = Array.isArray(this._pool?.feats)
      ? this._pool.feats.find((f) => featDbId(f) === dbId)
      : null;
    const fromFav = !fromPool ? this._buildFavoritesPool().find((f) => featDbId(f) === dbId) : null;
    const summary = fromPool || fromFav;
    const full = this._fullFeatCache.get(dbId) || null;

    const name = String((full?.name) || (summary?.name) || "");
    const img = full?.img || summary?.img || "";
    const sourceSlug = String(summary?.__sourceSlug || "");
    const sourceLabel = this._sourceLabels.get(sourceSlug) || sourceSlug.toUpperCase();
    const flags = featFlags(summary || {}) || {};

    // Prefer the summary's `requirements` (always present after the
    // pool fetch) so the prereq line appears before the full-feat
    // fetch resolves. Fall back to the full payload's system field for
    // favourites synthesised before the catalog extension shipped.
    // The server renders this from `requirements_tree` with entity-
    // name resolution — same pipeline `/compendium/feats` uses — so
    // the picker reads identically to the authoring surface.
    const requirements = String(flags.requirements ?? full?.system?.requirements ?? "").trim();
    const descriptionHtml = full?.system?.description?.value || "";

    const favIds = this._getFavoriteDbIds();
    const isFavorited = favIds.has(dbId);

    const imageHtml = img
      ? `<div class="dauligor-feat-browser__detail-thumb"><img src="${escapeHtml(img)}" alt="${escapeHtml(name)}" onerror="this.onerror=null;this.src='icons/svg/book.svg';"></div>`
      : `<div class="dauligor-feat-browser__detail-thumb dauligor-spell-manager__detail-image--placeholder" aria-hidden="true"></div>`;

    const descriptionBlock = full
      ? (descriptionHtml
        ? `<div class="dauligor-spell-manager__detail-description">${descriptionHtml}</div>`
        : `<div class="dauligor-spell-manager__detail-description dauligor-spell-manager__empty">No description stored on this feat.</div>`)
      : `<div class="dauligor-spell-manager__detail-description dauligor-spell-manager__empty">Loading description…</div>`;

    this._detailRegion.innerHTML = `
      <div class="dauligor-spell-manager__detail-scroll">
        <header class="dauligor-spell-manager__detail-header">
          <div class="dauligor-spell-manager__detail-title-row">
            ${imageHtml}
            <h2 class="dauligor-spell-manager__detail-title">${escapeHtml(name || "(loading…)")}</h2>
            ${sourceLabel ? `<span class="dauligor-spell-manager__detail-source-chip" title="${escapeHtml(sourceLabel)}">${escapeHtml(sourceLabel)}</span>` : ""}
            <button type="button"
              class="dauligor-spell-manager__detail-star ${isFavorited ? "dauligor-spell-manager__detail-star--active" : ""}"
              data-action="detail-toggle-fav"
              title="${isFavorited ? "Remove from favourites" : "Add to favourites"}"
            >★</button>
          </div>
          ${requirements ? `
          <p class="dauligor-feat-browser__detail-prereqs">
            <span class="dauligor-feat-browser__detail-prereqs-label">Prerequisites:</span>${escapeHtml(requirements)}
          </p>
          ` : ""}
        </header>

        <section class="dauligor-spell-manager__detail-body">
          ${descriptionBlock}
        </section>
      </div>
    `;

    this._detailRegion.querySelector(`[data-action="detail-toggle-fav"]`)?.addEventListener("click", async () => {
      await this._toggleFavorite(dbId);
    });
  }

  // -----------------------------------------------------------------------
  // Footer (status + action buttons)
  // -----------------------------------------------------------------------

  _renderFooter() {
    if (!this._footerRegion) return;
    const selected = this._state.selectedDbId;
    const canImport = Boolean(selected) && this._pool.status === "ready" && !!this._actor;

    this._footerRegion.innerHTML = `
      <div class="dauligor-importer__footer-status dauligor-wizard__status ${this._state.statusLevel ? `dauligor-wizard__status--${this._state.statusLevel}` : ""}">
        ${this._state.status ? escapeHtml(this._state.status) : ""}
      </div>
      <div class="dauligor-importer__footer-actions">
        <button type="button" class="dauligor-wizard__button" data-action="close">Close</button>
        <button type="button" class="dauligor-wizard__button dauligor-wizard__button--primary" data-action="import" ${canImport ? "" : "disabled"}>Import Selected</button>
      </div>
    `;

    this._footerRegion.querySelector(`[data-action="close"]`)?.addEventListener("click", async () => {
      await this.close();
    });
    this._footerRegion.querySelector(`[data-action="import"]`)?.addEventListener("click", async () => {
      await this._importSelected();
    });
  }

  async _importSelected() {
    if (!this._actor) {
      notifyWarn("No actor available.");
      return;
    }
    const dbId = this._state.selectedDbId;
    if (!dbId) return;

    this._state.status = "Fetching full feat…";
    this._state.statusLevel = "";
    this._renderFooter();

    const full = await this._ensureFullFeat(dbId);
    if (!full) {
      this._state.status = "Could not fetch the full feat. See console.";
      this._state.statusLevel = "danger";
      this._renderFooter();
      return;
    }

    const itemData = foundry.utils.deepClone(full);
    delete itemData._id;
    delete itemData._stats;

    const existing = findExistingMatch(this._actor, itemData);
    try {
      if (existing) {
        await this._actor.updateEmbeddedDocuments("Item", [{ _id: existing.id, ...itemData }]);
        notifyInfo(`Updated "${itemData.name}" on ${this._actor.name}.`);
      } else {
        await this._actor.createEmbeddedDocuments("Item", [itemData]);
        notifyInfo(`Imported "${itemData.name}" onto ${this._actor.name}.`);
      }
      this._state.status = `Imported "${itemData.name}".`;
      this._state.statusLevel = "success";
    } catch (err) {
      log("feat-browser import failed", err);
      this._state.status = `Import failed: ${err?.message ?? "unknown error"}`;
      this._state.statusLevel = "danger";
    }
    this._renderFooter();
  }

  // -----------------------------------------------------------------------
  // Filter modal (tri-state pill panel) — mirrors spell-preparation-app's
  // approach, just with feat-specific axes.
  // -----------------------------------------------------------------------

  _openFilterModal(target) {
    this._state.filterModalOpen = target;
    // Snapshot for Cancel — same shape the spell-prep app uses (deep clone
    // of the target's filter state).
    this._state.filterSnapshot = JSON.parse(JSON.stringify(this._filterStateFor(target) || { axes: {} }));
    this._renderFilterModal();
  }

  _closeFilterModal({ save = true } = {}) {
    const target = this._state.filterModalOpen;
    if (!save && this._state.filterSnapshot) {
      if (target === "favorites") this._state.favFilters = this._state.filterSnapshot;
      else this._state.poolFilters = this._state.filterSnapshot;
    }
    // Reset the closing target's ephemeral UI state so reopening starts
    // with every section expanded + empty chip-search (matches the React
    // panel's intentional non-persisted UX).
    if (target === "favorites") this._state.favFilterUi = createFreshFilterUiState();
    else if (target === "pool") this._state.poolFilterUi = createFreshFilterUiState();
    this._state.filterSnapshot = null;
    this._state.filterModalOpen = null;
    this._renderAll();
  }

  _buildFilterAxes(target) {
    // Restrict the type axis to types actually present in the relevant pool
    // so the chip wall doesn't show irrelevant rows (matches spell-prep's
    // `sourcesInPool` pattern).
    const source = target === "favorites" ? this._buildFavoritesPool()
                                          : (Array.isArray(this._pool?.feats) ? this._pool.feats : []);
    const typesInPool = new Set();
    for (const feat of source) typesInPool.add(String(featFlags(feat).featType || "feat"));

    const typeValues = FEAT_TYPE_ORDER
      .filter((v) => typesInPool.has(v))
      .map((v) => ({ value: v, label: FEAT_TYPE_LABELS[v] || v }));
    // Append any unknown types from the pool so they're still selectable.
    for (const t of [...typesInPool].sort()) {
      if (!FEAT_TYPE_ORDER.includes(t)) typeValues.push({ value: t, label: t });
    }

    return [
      { key: "type", axisKey: "type", name: "Feat Type", kind: "axis", values: typeValues },
      {
        key: "property",
        axisKey: "property",
        name: "Properties",
        kind: "axis",
        values: FEAT_PROPERTY_ORDER.map((v) => ({ value: v, label: FEAT_PROPERTY_LABELS[v] || v })),
      },
    ];
  }

  _renderFilterModal() {
    if (!this._filterModalRegion) return;
    const target = this._state.filterModalOpen;
    if (!target) {
      this._filterModalRegion.hidden = true;
      this._filterModalRegion.innerHTML = "";
      return;
    }
    this._filterModalRegion.hidden = false;

    const savedScrollTop = this._filterModalRegion
      .querySelector(".dauligor-section-filter__body")?.scrollTop ?? 0;

    const axes = this._buildFilterAxes(target);
    const filterState = this._filterStateFor(target);
    const uiState = this._uiStateFor(target);
    const title = target === "favorites" ? "Filter Favourites" : "Filter Feats";

    const panelHtml = renderSectionFilterPanel({
      axes,
      axisFilters: filterState?.axes ?? {},
      tagStates: {},
      groupCombineModes: {},
      groupExclusionModes: {},
      uiState,
      title,
      searchPlaceholder: "Filter pills…",
      resetLabel: "Reset Filters",
      showCloseButton: true,
    });

    this._filterModalRegion.innerHTML = `
      <div class="dauligor-spell-manager__modal-backdrop" data-action="close-modal"></div>
      <div class="dauligor-spell-manager__modal-card dauligor-spell-manager__modal-card--section-filter" role="dialog" aria-modal="true">
        ${panelHtml}
      </div>
    `;

    if (savedScrollTop > 0) {
      const newBody = this._filterModalRegion.querySelector(".dauligor-section-filter__body");
      if (newBody) newBody.scrollTop = savedScrollTop;
    }

    // Backdrop click → treat as save (matches spell-prep convention).
    this._filterModalRegion.querySelectorAll(`[data-action="close-modal"]`).forEach((el) => {
      el.addEventListener("click", () => this._closeFilterModal({ save: true }));
    });

    const root = this._filterModalRegion.querySelector(".dauligor-section-filter");
    if (!root) return;

    const setAxisState = (axisKey, value, nextState) => {
      const state = this._filterStateFor(target);
      const axes = state.axes ?? (state.axes = {});
      const axis = axes[axisKey] ?? (axes[axisKey] = { states: {} });
      axis.states = axis.states ?? {};
      if (nextState === 0) delete axis.states[value];
      else axis.states[value] = nextState;
    };

    const cycleCombine = (axisKey, reverse) => {
      const state = this._filterStateFor(target);
      const axes = state.axes ?? (state.axes = {});
      const axis = axes[axisKey] ?? (axes[axisKey] = { states: {} });
      const cur = axis.combineMode || "OR";
      axis.combineMode = reverse ? nextCombineModeReverse(cur) : nextCombineMode(cur);
    };

    const cycleExclude = (axisKey, reverse) => {
      const state = this._filterStateFor(target);
      const axes = state.axes ?? (state.axes = {});
      const axis = axes[axisKey] ?? (axes[axisKey] = { states: {} });
      const cur = axis.exclusionMode || "OR";
      axis.exclusionMode = reverse ? nextCombineModeReverse(cur) : nextCombineMode(cur);
    };

    const rerender = () => this._renderAll();

    bindSectionFilterPanelEvents(root, {
      cycleAxisState: (axisKey, value) => {
        const state = this._filterStateFor(target);
        const cur = state.axes?.[axisKey]?.states?.[value] || 0;
        setAxisState(axisKey, value, nextStateForward(cur));
        rerender();
      },
      cycleAxisStateReverse: (axisKey, value) => {
        const state = this._filterStateFor(target);
        const cur = state.axes?.[axisKey]?.states?.[value] || 0;
        setAxisState(axisKey, value, nextStateReverse(cur));
        rerender();
      },
      // Tag axes aren't used here, but the panel still wires the events;
      // accept them as no-ops to keep the binder happy.
      cycleTagState: () => {},
      cycleTagStateReverse: () => {},
      cycleAxisCombineMode: (axisKey) => { cycleCombine(axisKey, false); rerender(); },
      cycleAxisCombineModeReverse: (axisKey) => { cycleCombine(axisKey, true); rerender(); },
      cycleAxisExclusionMode: (axisKey) => { cycleExclude(axisKey, false); rerender(); },
      cycleAxisExclusionModeReverse: (axisKey) => { cycleExclude(axisKey, true); rerender(); },
      // Handler names below match `bindSectionFilterPanelEvents`'s
      // dispatch table (see section-filter-panel.js). Renamed during
      // the May 2026 port to match the React component; keep in lockstep
      // with that file's switch statement.
      axisIncludeAll: (axisKey) => {
        const axes = this._buildFilterAxes(target);
        const axis = axes.find((a) => (a.axisKey || a.key) === axisKey);
        if (!axis) return;
        for (const v of axis.values) setAxisState(axisKey, v.value, 1);
        rerender();
      },
      axisClear: (axisKey) => {
        const state = this._filterStateFor(target);
        if (state.axes?.[axisKey]) state.axes[axisKey].states = {};
        rerender();
      },
      axisExcludeAll: (axisKey) => {
        const axes = this._buildFilterAxes(target);
        const axis = axes.find((a) => (a.axisKey || a.key) === axisKey);
        if (!axis) return;
        for (const v of axis.values) setAxisState(axisKey, v.value, 2);
        rerender();
      },
      axisRestoreDefault: () => { /* no defaults for feats */ },
      toggleAxisHidden: (axisKey) => {
        const ui = this._uiStateFor(target);
        if (!(ui.hiddenAxes instanceof Set)) ui.hiddenAxes = new Set();
        if (ui.hiddenAxes.has(axisKey)) ui.hiddenAxes.delete(axisKey);
        else ui.hiddenAxes.add(axisKey);
        this._renderFilterModal();
      },
      toggleAllSubtags: (axisKey) => {
        const ui = this._uiStateFor(target);
        if (!(ui.allSubtagAxes instanceof Set)) ui.allSubtagAxes = new Set();
        if (ui.allSubtagAxes.has(axisKey)) ui.allSubtagAxes.delete(axisKey);
        else ui.allSubtagAxes.add(axisKey);
        this._renderFilterModal();
      },
      toggleAltLabel: (axisKey) => {
        const ui = this._uiStateFor(target);
        if (!(ui.altLabelAxes instanceof Set)) ui.altLabelAxes = new Set();
        if (ui.altLabelAxes.has(axisKey)) ui.altLabelAxes.delete(axisKey);
        else ui.altLabelAxes.add(axisKey);
        this._renderFilterModal();
      },
      setChipSearch: (query) => {
        const ui = this._uiStateFor(target);
        ui.chipSearch = String(query ?? "");
        this._renderFilterModal();
      },
      showAllSections: () => {
        const ui = this._uiStateFor(target);
        ui.hiddenAxes = new Set();
        this._renderFilterModal();
      },
      hideAllSections: () => {
        const ui = this._uiStateFor(target);
        const axes = this._buildFilterAxes(target);
        ui.hiddenAxes = new Set(axes.map((a) => a.axisKey || a.key));
        this._renderFilterModal();
      },
      resetAll: () => {
        if (target === "favorites") this._state.favFilters = { axes: {} };
        else this._state.poolFilters = { axes: {} };
        rerender();
      },
      cancel: () => this._closeFilterModal({ save: false }),
      save: () => this._closeFilterModal({ save: true }),
      close: () => this._closeFilterModal({ save: true }),
    });
  }
}

/**
 * Public opener. Mirrors `openSpellBrowser` so the importer wizard's
 * `_openImporter` can dispatch uniformly between Spells and Feats.
 */
export async function openFeatBrowser(actorLike, { sourceSlugs = [] } = {}) {
  const actor = (() => {
    if (!actorLike) return null;
    if (actorLike.documentName === "Actor") return actorLike;
    if (actorLike.document?.documentName === "Actor") return actorLike.document;
    if (actorLike.actor?.documentName === "Actor") return actorLike.actor;
    return null;
  })();
  if (!actor || actor.type !== "character") {
    notifyWarn("Open Import Feats from a character actor.");
    return null;
  }
  return DauligorFeatBrowserApp.open({ actor, sourceSlugs });
}
