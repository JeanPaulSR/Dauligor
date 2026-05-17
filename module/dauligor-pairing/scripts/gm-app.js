// =============================================================================
// Dauligor GM Console
// =============================================================================
//
// GM-only utility window. Phase 1 ships an empty shell so we can iterate
// on its tabs in later passes — common targets:
//
//   - Party Overview: HP / prepared spells / queued FM changes across
//     every PC in one glance.
//   - Mass-Apply Patches: "every actor with X class gets the new
//     spellsKnownLevels stamp" type batch operations.
//   - World Diagnostics: stale flags, broken sourceItem refs, etc.
//   - Audit Log Browser: read the per-actor FM queue + chat audit
//     trail in one place.
//
// Phase 1 just registers the application class + opener; the body is
// a placeholder card explaining the upcoming features so the user has
// visual confirmation the GM-only path is working.
//
// Access control: registration in main.js's `getSceneControlButtons`
// hook guards the toolbar button with `game.user.isGM`. This file's
// `open()` static guards the actual instantiation as a double-defense
// (so macros / console calls can't open it as a player).

import { MODULE_ID } from "./constants.js";
import { log, notifyWarn } from "./utils.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Single-instance GM-only console window. ApplicationV2 with no
 * Handlebars template — the body is rendered directly into the
 * window-content element on each render. Phase 1 keeps the structure
 * minimal; later passes will add tabs + content panels via the
 * standard `_renderHTML` / `_replaceHTML` flow.
 */
export class DauligorGmConsoleApp extends ApplicationV2 {
  static _instance = null;

  static open() {
    // Hard-gate at the open path too. The toolbar button visibility
    // is already gated by `game.user.isGM` in the scene-controls
    // hook; this is the defence-in-depth check for macro / console
    // openers that bypass the toolbar.
    if (!game.user?.isGM) {
      notifyWarn("Dauligor GM Console is GM-only.");
      return null;
    }
    if (this._instance) {
      this._instance.render({ force: true });
      this._instance.maximize?.();
      return this._instance;
    }
    const instance = new this();
    this._instance = instance;
    instance.render({ force: true });
    return instance;
  }

  constructor() {
    const viewportW = window.innerWidth || 0;
    const viewportH = window.innerHeight || 0;
    super({
      id: `${MODULE_ID}-gm-console`,
      classes: ["dauligor-importer-app", "dauligor-gm-console-app"],
      window: {
        title: "Dauligor GM Console",
        resizable: true,
        contentClasses: ["dauligor-importer-window"]
      },
      position: {
        width: Math.min(viewportW - 120, 720),
        height: Math.min(viewportH - 120, 540),
        left: Math.max(0, Math.round((viewportW - 720) / 2)),
        top: Math.max(0, Math.round((viewportH - 540) / 2))
      }
    });
  }

  async close(options) {
    if (DauligorGmConsoleApp._instance === this) {
      DauligorGmConsoleApp._instance = null;
    }
    return super.close(options);
  }

  /**
   * ApplicationV2 requires `_renderHTML` to produce the body content
   * and `_replaceHTML` to mount it. We skip the Handlebars mixin —
   * the placeholder body is so small that templating overhead would
   * add maintenance cost for no benefit.
   */
  async _renderHTML(_context, _options) {
    return `
      <section class="dauligor-gm-console">
        <header class="dauligor-gm-console__header">
          <h2 class="dauligor-gm-console__title">
            <i class="fas fa-shield-halved"></i>
            Dauligor GM Console
          </h2>
          <p class="dauligor-gm-console__subtitle">GM-only utility shelf.</p>
        </header>
        <div class="dauligor-gm-console__body">
          <div class="dauligor-gm-console__placeholder">
            <i class="fas fa-hammer dauligor-gm-console__placeholder-icon"></i>
            <h3>Coming soon</h3>
            <p>This window is reserved for GM-only utilities — party overview, mass-apply patches, world diagnostics, audit-log browser. Phase 1 ships the shell so we can layer features in over the next few passes without revisiting the access-control surface.</p>
            <p class="dauligor-gm-console__placeholder-hint">Find this window via the scene controls toolbar (the shield icon, GM-only).</p>
          </div>
        </div>
      </section>
    `;
  }

  _replaceHTML(html, content, _options) {
    if (typeof html === "string") {
      content.innerHTML = html;
    } else if (html instanceof HTMLElement) {
      content.replaceChildren(html);
    }
  }
}

/**
 * Public opener. Mirrors the pattern used by `openFeatureManager` /
 * `openSpellPreparationManager` so main.js can wire it the same way.
 */
export function openDauligorGmConsole() {
  return DauligorGmConsoleApp.open();
}
