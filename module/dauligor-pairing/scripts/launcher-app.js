// Dauligor launcher / hub window.
//
// A small house-styled menu used for both the "Dauligor Options" launcher
// and the per-actor "Actor Tools" hub (one component, two callers). It
// replaces the plain Foundry DialogV2s those used to be — same family
// chrome as the importer / feat browser, the canonical button look from
// base.css, and the shared design tokens.
//
// Caller contract (see openDauligorLauncher):
//   {
//     title: string,
//     intro?: string,                       // small caption under the title
//     actions: [{
//       id: string,
//       label: string,
//       icon: string,                       // Font Awesome classes ("fas fa-book")
//       hint?: string,                      // one-line description
//       status?: "ready" | "soon",          // "soon" → muted + "Soon" badge
//       onSelect: () => any | Promise<any>,
//     }]
//   }
//
// Clicking a tile closes the launcher, then runs its onSelect — matching
// the old DialogV2 behaviour (a button click dismissed the dialog).

import { LAUNCHER_TEMPLATE, MODULE_ID } from "./constants.js";
import { log } from "./utils.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export class DauligorLauncherApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static _instance = null;

  static async open(config = {}) {
    if (this._instance) {
      this._instance._config = config;
      this._instance.options.window.title = config.title || "Dauligor";
      await this._instance.render({ force: true });
      this._instance.bringToFront?.();
      return this._instance;
    }
    const instance = new this(config);
    this._instance = instance;
    await instance.render({ force: true });
    return instance;
  }

  constructor(config = {}) {
    super({
      id: `${MODULE_ID}-launcher`,
      classes: ["dauligor-importer-app", "dauligor-launcher"],
      window: {
        title: config.title || "Dauligor",
        resizable: false,
        contentClasses: ["dauligor-importer-window"],
      },
      position: { width: 460, height: "auto" },
    });
    this._config = config;
    this._gridRegion = null;
    this._introRegion = null;
  }

  _configureRenderParts() {
    return { main: { template: LAUNCHER_TEMPLATE } };
  }

  async close(options) {
    if (DauligorLauncherApp._instance === this) DauligorLauncherApp._instance = null;
    return super.close(options);
  }

  async _onRender() {
    super._onRender?.(...arguments);
    const root = this.element instanceof HTMLElement
      ? this.element
      : (this.element?.[0] instanceof HTMLElement ? this.element[0] : document.getElementById(this.id));
    if (!root) return;
    const content = root.querySelector(".window-content") ?? root;
    this._introRegion = content.querySelector(`[data-region="intro"]`);
    this._gridRegion = content.querySelector(`[data-region="grid"]`);
    this._renderAll();
  }

  _renderAll() {
    const intro = this._config.intro;
    if (this._introRegion) {
      this._introRegion.innerHTML = intro ? `<p class="dauligor-launcher__intro">${escapeHtml(intro)}</p>` : "";
    }

    const actions = Array.isArray(this._config.actions) ? this._config.actions : [];
    if (this._gridRegion) {
      this._gridRegion.innerHTML = actions.map((a) => {
        const soon = a.status === "soon";
        const badge = soon ? `<span class="dauligor-launcher__tile-badge">Soon</span>` : "";
        const hint = a.hint ? `<span class="dauligor-launcher__tile-hint">${escapeHtml(a.hint)}</span>` : "";
        return `
          <button type="button" class="dauligor-launcher__tile ${soon ? "dauligor-launcher__tile--soon" : ""}" data-id="${escapeHtml(a.id)}">
            <i class="${escapeHtml(a.icon || "fas fa-circle")} dauligor-launcher__tile-icon"></i>
            <span class="dauligor-launcher__tile-label">${escapeHtml(a.label)}${badge}</span>
            ${hint}
          </button>`;
      }).join("");

      this._gridRegion.querySelectorAll(`[data-id]`).forEach((el) => {
        el.addEventListener("click", async () => {
          const action = actions.find((a) => a.id === el.dataset.id);
          if (!action?.onSelect) return;
          await this.close();
          try {
            await action.onSelect();
          } catch (err) {
            log("launcher action failed", err);
          }
        });
      });
    }
  }
}

export async function openDauligorLauncher(config = {}) {
  return DauligorLauncherApp.open(config);
}
