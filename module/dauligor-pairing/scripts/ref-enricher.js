// Foundry-wide cross-reference enrichers (page-system Phase 5).
//
// Registers a CONFIG.TextEditor enricher so Dauligor refs written ANYWHERE Foundry
// runs enrichHTML — journal pages, item/actor descriptions, chat messages — render
// as clickable `.dauligor-ref` links, the same markup the in-viewer renderer emits
// (shared via layout-blocks.refMarkup). A single delegated click handler then
// routes those links: @article / & rule refs open the Dauligor viewer; other
// entity refs open the live app.
//
// We PUSH to CONFIG.TextEditor.enrichers (never override enrichHTML) so we compose
// with core + every other module's enrichers. The pattern is case-SENSITIVE and
// requires a lowercase kind, so it can't clobber Foundry's own PascalCase document
// enrichers (@UUID[…], @Actor[…], @Compendium[…], @Check[…]).

import { refMarkup } from "./layout-blocks.js";
import { openDauligorLibrary, DauligorViewerApp } from "./dauligor-viewer.js";
import { log } from "./utils.js";

// @kind[id]#anchor{display}  and  &kind[id]#anchor{display}  (kind lowercase only).
// `&amp;` is matched first so HTML-encoded ampersands resolve before a bare `&`.
// Exported for tests. CASE-SENSITIVE (no `i`): a lowercase-only kind ensures this
// never matches Foundry's PascalCase document enrichers (@UUID[…], @Actor[…], …).
export const REF_PATTERN = /(@|&amp;|&)([a-z][a-z0-9-]*)\[([^\]\s]*)\](?:#([\w-]+))?(?:\{([^}]*)\})?/g;

function htmlToElement(html) {
  const tpl = document.createElement("template");
  tpl.innerHTML = String(html ?? "").trim();
  return tpl.content.firstElementChild;
}

/** Register the ref enricher. Call once in `init`/`setup` (idempotent per load). */
export function registerRefEnrichers() {
  CONFIG.TextEditor = CONFIG.TextEditor || {};
  if (!Array.isArray(CONFIG.TextEditor.enrichers)) CONFIG.TextEditor.enrichers = [];
  CONFIG.TextEditor.enrichers.push({
    pattern: REF_PATTERN,
    enricher: async (match) => {
      const [, sigil, kind, id, anchor, display] = match;
      return htmlToElement(refMarkup({ kind, id, anchor, rule: sigil !== "@", display }));
    },
  });
  log("Registered Dauligor ref enricher (CONFIG.TextEditor.enrichers).");
}

/**
 * One delegated click handler for enriched refs ANYWHERE in Foundry. Refs INSIDE
 * the viewer are handled by the viewer itself (history-aware navigation), so we
 * skip those. Call once in `ready`.
 */
export function registerRefClickHandler() {
  document.addEventListener("click", (ev) => {
    const a = ev.target?.closest?.("a.dauligor-ref[data-route]");
    if (!a || a.closest(".dauligor-viewer")) return; // viewer binds its own refs
    ev.preventDefault();
    const kind = a.dataset.refKind;
    const refId = a.dataset.refId;
    if (a.dataset.refSigil === "&" && kind) {
      DauligorViewerApp.open({ systemKind: kind, systemAnchor: refId });
      return;
    }
    if (kind === "article" && refId) {
      openDauligorLibrary({ articleId: refId });
      return;
    }
    const route = a.getAttribute("data-route");
    if (route) window.open(route, "_blank", "noopener");
  });
  log("Registered Dauligor ref click handler.");
}
