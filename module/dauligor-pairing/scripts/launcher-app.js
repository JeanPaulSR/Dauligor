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

// Mirror the importer / feat-browser framing: AppV2 here uses explicit
// NUMERIC width/height (height:"auto" is not honoured — applyCentered…
// bails on non-finite height), stamped on the frame before first paint.
function applyCenteredPositionToFrame(frame, { width, height }) {
  if (!frame || !Number.isFinite(width) || !Number.isFinite(height)) return;
  const vw = document.documentElement.clientWidth || window.innerWidth || 0;
  const vh = document.documentElement.clientHeight || window.innerHeight || 0;
  frame.style.width = `${width}px`;
  frame.style.height = `${height}px`;
  frame.style.left = `${Math.max(0, Math.round((vw - width) / 2))}px`;
  frame.style.top = `${Math.max(0, Math.round((vh - height) / 2))}px`;
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
    // Rough initial numeric height (2-col grid); _fitHeight() measures the
    // real content after render and sets an exact height. Numeric — NOT
    // "auto", which this AppV2 setup ignores.
    const count = Array.isArray(config.actions) ? config.actions.length : 1;
    const rows = Math.max(1, Math.ceil(count / 2));
    const initialHeight = Math.min(150 + rows * 104, (window.innerHeight || 900) - 80);
    super({
      id: `${MODULE_ID}-launcher`,
      // NOTE: deliberately NOT `dauligor-importer-app` / `dauligor-importer-window`.
      // Those classes force the window-content to flex-column + overflow:hidden +
      // padding:0 for the big full-height wizards; on this small hub that collapses
      // + clips the content (everything overlaps). The launcher owns its own layout
      // via `.dauligor-launcher__shell`. `.dauligor-launcher` is a registered token
      // root (tokens.css), so the palette still resolves.
      classes: ["dauligor-launcher"],
      window: {
        title: config.title || "Dauligor",
        resizable: false,
        contentClasses: ["dauligor-launcher-window"],
      },
      position: { width: 460, height: initialHeight },
    });
    this._config = config;
    this._gridRegion = null;
    this._introRegion = null;
  }

  _configureRenderParts() {
    return { main: { template: LAUNCHER_TEMPLATE } };
  }

  async _renderFrame(options) {
    const frame = await super._renderFrame(options);
    applyCenteredPositionToFrame(frame, this.position);
    return frame;
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
    this._fitHeight();
  }

  // Measure the rendered content and set an exact NUMERIC window height so
  // the frame grows to fit the tile grid (height:"auto" is ignored by this
  // AppV2 setup). Re-runs on every render, so it also covers the reused-
  // instance path where the action list (and row count) changed.
  _fitHeight() {
    const root = this.element instanceof HTMLElement ? this.element : null;
    if (!root) return;
    const shell = root.querySelector(".dauligor-launcher__shell");
    if (!shell) return;
    const headerH = root.querySelector(".window-header")?.offsetHeight ?? 32;
    const vw = document.documentElement.clientWidth || window.innerWidth || 0;
    const vh = document.documentElement.clientHeight || window.innerHeight || 900;
    const width = Number(this.position?.width) || 460;
    const height = Math.min(Math.ceil(shell.scrollHeight) + headerH + 6, vh - 60);
    if (!Number.isFinite(height) || height <= 0) return;
    this.setPosition({
      width,
      height,
      left: Math.max(0, Math.round((vw - width) / 2)),
      top: Math.max(0, Math.round((vh - height) / 2)),
    });
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
