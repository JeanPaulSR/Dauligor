// Foundry-wide cross-reference enrichers (page-system Phase 5).
//
// Registers a CONFIG.TextEditor enricher so Dauligor refs written ANYWHERE Foundry
// runs enrichHTML — journal pages, item/actor descriptions, chat messages — render
// as clickable `.dauligor-ref` links, the same markup the in-viewer renderer emits
// (shared via layout-blocks.refMarkup). A single delegated click handler then
// routes those links: @article / & rule refs open the Dauligor viewer; other
// entity refs open the live app.
//
// We PUSH/UNSHIFT into CONFIG.TextEditor.enrichers (never override enrichHTML) so we
// compose with core + every other module's enrichers. Two enrichers register here:
//   • native @kind[id] / &kind[id] (lowercase kind) — PUSHED. Case-sensitive, so it
//     can't clobber Foundry's PascalCase document enrichers (@UUID[…], @Actor[…], …),
//     and dnd5e ignores lowercase `&kind` refs, so order doesn't matter.
//   • dnd5e's &Reference[type=key] — UNSHIFTED so it runs BEFORE dnd5e's own Reference
//     enricher and routes rule refs to the Dauligor Library instead of the SRD
//     tooltip (owner choice 2026-06-07: "Library wins for &Reference").

import { refMarkup } from "./layout-blocks.js";
import { openDauligorLibrary, DauligorViewerApp } from "./dauligor-viewer.js";
import { isImportableKind, openReferencedItem } from "./ref-import.js";
import { log } from "./utils.js";

// @kind[id]#anchor{display}  and  &kind[id]#anchor{display}  (kind lowercase only).
// `&amp;` is matched first so HTML-encoded ampersands resolve before a bare `&`.
// Exported for tests. CASE-SENSITIVE (no `i`): a lowercase-only kind ensures this
// never matches Foundry's PascalCase document enrichers (@UUID[…], @Actor[…], …).
export const REF_PATTERN = /(@|&amp;|&)([a-z][a-z0-9-]*)\[([^\]\s]*)\](?:#([\w-]+))?(?:\{([^}]*)\})?/g;

// dnd5e's `&Reference[type=key …flags]{Label}` syntax. We take it over and map it
// to a Dauligor system-page rule ref, mirroring the app's bbcode `&Reference`
// normalization: `type` → page kind, `key` → entry anchor; the page-level shorthand
// `&Reference[prone]` → kind `prone`, no entry; trailing dnd5e flags (e.g.
// ` apply=false`) are swallowed by `[^\]]*`. Case-insensitive, like dnd5e's.
export const REFERENCE_PATTERN = /(?:&amp;|&)Reference\[([a-z][a-z0-9_-]*)(?:=([a-z0-9_-]+))?[^\]]*\](?:\{([^}]*)\})?/gi;

function htmlToElement(html) {
  const tpl = document.createElement("template");
  tpl.innerHTML = String(html ?? "").trim();
  return tpl.content.firstElementChild;
}

/** Register the ref enrichers. Call once in `init`/`setup` (idempotent per load). */
export function registerRefEnrichers() {
  CONFIG.TextEditor = CONFIG.TextEditor || {};
  if (!Array.isArray(CONFIG.TextEditor.enrichers)) CONFIG.TextEditor.enrichers = [];

  // dnd5e's own &Reference enricher is already in the array (system inits before
  // modules). UNSHIFT ours to the front so it claims &Reference[...] first and
  // routes it to the Library instead of the SRD tooltip.
  CONFIG.TextEditor.enrichers.unshift({
    pattern: REFERENCE_PATTERN,
    enricher: async (match) => {
      const kind = String(match[1] ?? "").toLowerCase();
      const entry = match[2] ? String(match[2]).toLowerCase() : "";
      return htmlToElement(refMarkup({ kind, id: entry, rule: true, display: match[3] }));
    },
  });

  // Native @kind[id] / &kind[id] semantic refs (dnd5e ignores lowercase kinds).
  CONFIG.TextEditor.enrichers.push({
    pattern: REF_PATTERN,
    enricher: async (match) => {
      const [, sigil, kind, id, anchor, display] = match;
      return htmlToElement(refMarkup({ kind, id, anchor, rule: sigil !== "@", display }));
    },
  });
  log("Registered Dauligor ref enrichers (&Reference takeover + native @/& refs).");
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
    // Compendium-backed entity refs (@spell, …) → open the Foundry item in a
    // temporary preview sheet (not imported), like clicking a content-link. Falls
    // back to the app page if it can't be built (e.g. logged out / no match).
    if (isImportableKind(kind) && refId) {
      openReferencedItem(kind, refId).then((handled) => {
        if (handled) return;
        const route = a.getAttribute("data-route");
        if (route) window.open(route, "_blank", "noopener");
      });
      return;
    }
    const route = a.getAttribute("data-route");
    if (route) window.open(route, "_blank", "noopener");
  });
  log("Registered Dauligor ref click handler.");
}
