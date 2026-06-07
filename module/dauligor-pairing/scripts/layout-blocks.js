// Renders Dauligor layout-block JSON (lore articles, campaign home, system pages)
// to HTML for the in-Foundry viewer. Mirrors the app's parseLayoutBlock: JSON-parse
// each row's `config`, switch on `block_type`, recurse container `config.children`.
// Body text (BBCode) → HTML via the importer's normalizeHtmlBlock, then a cross-ref
// pass turns raw @kind[id]{display} / &kind[id]{display} into clickable links the
// viewer handles. Unknown block types are dropped (as the app does).
//
// Reuse, not reinvention: normalizeHtmlBlock (class-import-service) is the single
// BBCode/markdown/HTML transform (incl. embedded-in-HTML tables); formatFoundryLabel
// (importer-base-features) names a ref when {display} is absent.

import { normalizeHtmlBlock } from "./class-import-service.js";
import { formatFoundryLabel } from "./importer-base-features.js";

const APP_HOST = "https://www.dauligor.com";

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// App route for a reference (mirrors src/lib/bbcode.ts resolveRefRoute), absolute
// to the live site. Entity (@) kinds that have no page return null → a
// non-clickable badge. Rule (&) refs always resolve to a /system/<kind> page.
function refRoute(kind, id, anchor, rule) {
  const k = String(kind || "");
  const i = String(id || "");
  const frag = anchor ? `#${anchor}` : "";
  if (rule) return `${APP_HOST}/system/${k}${anchor ? `#${anchor}` : (i ? `#${i}` : "")}`;
  switch (k) {
    case "spell": return `${APP_HOST}/compendium/spells?focus=${i}${frag}`;
    case "class": return `${APP_HOST}/compendium/classes/view/${i}${frag}`;
    case "feat": return `${APP_HOST}/compendium/feats?focus=${i}${frag}`;
    case "item": return `${APP_HOST}/compendium/items?focus=${i}${frag}`;
    case "article": return `${APP_HOST}/wiki/article/${i}${frag}`;
    default: return null; // subclass / option-group / unknown → badge
  }
}

function refLabel(kind, id, display) {
  if (display != null && display !== "") return esc(display);
  const base = String(id || kind || "").replace(new RegExp(`^${String(kind)}-`, "i"), "");
  return esc(formatFoundryLabel(base || kind));
}

// A single clickable (or dangling) ref anchor. The viewer's click handler reads
// the data-ref-* / data-route attrs to open the in-Foundry viewer (articles /
// system pages) or link out to the app (compendium entities).
function refAnchor({ kind, id, anchor, rule, label }) {
  const route = refRoute(kind, id, anchor, rule);
  const data = `data-ref-sigil="${rule ? "&" : "@"}" data-ref-kind="${esc(kind)}" data-ref-id="${esc(id)}"${anchor ? ` data-ref-anchor="${esc(anchor)}"` : ""}`;
  if (!route) return `<span class="dauligor-ref dauligor-ref--dangling" ${data}>${label}</span>`;
  return `<a class="dauligor-ref dauligor-ref--${esc(kind)}" ${data} data-route="${esc(route)}">${label}</a>`;
}

// Cross-ref enricher — runs on already-HTML (post normalizeHtmlBlock, so `&` is
// `&amp;`). Matches @kind[id]#anchor{display} and &amp;kind[id]#anchor{display}.
function enrichRefs(html) {
  return String(html).replace(
    /(@|&amp;)([a-z][a-z0-9-]*)\[([^\]\s]*)\](?:#([\w-]+))?(?:\{([^}]*)\})?/gi,
    (_m, sigil, kind, id, anchor, display) => refAnchor({
      kind, id, anchor, rule: sigil !== "@", label: refLabel(kind, id, display),
    }),
  );
}

/** BBCode body → sanitized HTML with clickable cross-references. */
export function renderRichText(bbcode) {
  if (!bbcode) return "";
  return enrichRefs(normalizeHtmlBlock(bbcode));
}

// ── block parsing + rendering ───────────────────────────────────────────────

function parseBlock(row) {
  if (!row || typeof row !== "object") return null;
  const type = String(row.block_type ?? row.blockType ?? "");
  if (!type) return null;
  let config = row.config;
  if (typeof config === "string") {
    try { config = JSON.parse(config); } catch { config = {}; }
  }
  if (!config || typeof config !== "object") config = {};
  return { type, config };
}

function renderChildren(config) {
  const kids = Array.isArray(config.children) ? config.children : [];
  return kids.map(renderBlock).join("");
}

function entityRefLink(ref) {
  if (!ref || typeof ref !== "object") return "";
  const kind = String(ref.kind || "");
  const id = String(ref.id || "");
  if (kind === "placeholder" || (!id && !ref.name && !ref.title)) {
    return `<span class="dauligor-ref dauligor-ref--dangling">${esc(ref.name || "—")}</span>`;
  }
  const label = refLabel(kind, id, ref.name || ref.title);
  return refAnchor({ kind, id, anchor: "", rule: false, label });
}

function renderEntityRef(ref, variant) {
  if (!ref) return "";
  const body = ref.description ? `<div class="dauligor-richtext">${renderRichText(ref.description)}</div>` : "";
  return `<div class="dauligor-block dauligor-block--${esc(variant)}">${entityRefLink(ref)}${body}</div>`;
}

function renderEntityRow(c) {
  const refs = Array.isArray(c.refs) ? c.refs : [];
  const cols = Number(c.columns) || 2;
  const heading = (c.showHeading && c.title) ? `<h2 class="dauligor-block__row-title">${esc(c.title)}</h2>` : "";
  const items = refs.map((r) => `<li class="dauligor-block__entity-card">${entityRefLink(r)}</li>`).join("");
  return `<section class="dauligor-block dauligor-block--entity-row">${heading}<ul class="dauligor-block__entity-grid dauligor-block--cols-${esc(String(cols))}">${items}</ul></section>`;
}

function renderBlock(row) {
  const b = parseBlock(row);
  if (!b) return "";
  const c = b.config;
  switch (b.type) {
    case "hero":
      return `<header class="dauligor-block dauligor-block--hero dauligor-block--align-${esc(c.align || "center")} dauligor-block--size-${esc(c.size || "normal")}">`
        + `${c.title ? `<h1 class="dauligor-block__hero-title">${esc(c.title)}</h1>` : ""}`
        + `${c.subtitle ? `<div class="dauligor-block__hero-sub dauligor-richtext">${renderRichText(c.subtitle)}</div>` : ""}</header>`;
    case "text":
      return `<div class="dauligor-block dauligor-block--text dauligor-block--width-${esc(c.width || "normal")} dauligor-richtext">${renderRichText(c.body)}</div>`;
    case "note":
      // Server strips note blocks for non-staff — so when one renders, the viewer
      // is staff. Label it as privileged so staff know players can't see it.
      return `<aside class="dauligor-block dauligor-block--note"><div class="dauligor-block__priv-label">Storyteller Note · staff only</div><div class="dauligor-richtext">${renderRichText(c.body)}</div></aside>`;
    case "secret":
      // Server gates secret blocks by role / revealed-campaign; a rendered one is
      // visible to this viewer, but mark it so its restricted nature is obvious.
      return `<aside class="dauligor-block dauligor-block--secret"><div class="dauligor-block__priv-label">Secret</div><div class="dauligor-richtext">${renderRichText(c.body)}</div></aside>`;
    case "callout":
      return `<div class="dauligor-block dauligor-block--callout dauligor-block--${esc(c.style || "soft")}">`
        + `${c.title ? `<div class="dauligor-block__callout-title">${esc(c.title)}</div>` : ""}`
        + `<div class="dauligor-richtext">${renderRichText(c.body)}</div>`
        + `${c.buttonLabel ? `<a class="dauligor-block__callout-btn" href="${esc(c.buttonLink || "#")}" target="_blank" rel="noopener noreferrer">${esc(c.buttonLabel)}</a>` : ""}</div>`;
    case "image":
      return `<figure class="dauligor-block dauligor-block--image dauligor-block--h-${esc(c.height || "medium")}">`
        + `${c.url ? `<img src="${esc(c.url)}" alt="${esc(c.caption || "")}" />` : ""}`
        + `${c.caption ? `<figcaption>${esc(c.caption)}</figcaption>` : ""}</figure>`;
    case "divider": {
      const style = esc(c.style || "line");
      const dots = style === "dots" ? `<span class="dauligor-block__dots">&bull; &bull; &bull;</span>` : "";
      return `<div class="dauligor-block dauligor-block--divider dauligor-block--${style}">${dots}${style === "line" ? "<hr/>" : ""}</div>`;
    }
    case "definition":
      return `<section class="dauligor-block dauligor-block--definition"${c.anchor ? ` id="${esc(c.anchor)}"` : ""}>`
        + `${c.name ? `<h3 class="dauligor-block__def-name">${esc(c.name)}</h3>` : ""}`
        + `<div class="dauligor-richtext">${renderRichText(c.body)}</div></section>`;
    case "reference":
      return renderEntityRef(c.ref, "reference");
    case "entity-feature":
      return renderEntityRef(c.ref, "entity-feature");
    case "entity-row":
      return renderEntityRow(c);
    case "recommended":
      return c.ref ? `<div class="dauligor-block dauligor-block--recommended">${entityRefLink(c.ref)}</div>` : "";
    case "group":
      return `<section class="dauligor-block dauligor-block--group dauligor-block--${esc(c.style || "plain")}">`
        + `${(c.showTitle && c.title) ? `<h2 class="dauligor-block__group-title">${esc(c.title)}</h2>` : ""}${renderChildren(c)}</section>`;
    case "columns":
      return `<div class="dauligor-block dauligor-block--columns dauligor-block--cols-${esc(String(c.columns || 2))} dauligor-block--gap-${esc(c.gap || "medium")}">${renderChildren(c)}</div>`;
    case "column":
      return `<div class="dauligor-block dauligor-block--column">${renderChildren(c)}</div>`;
    default:
      return ""; // unknown type — dropped, as the app's parseLayoutBlock does
  }
}

/** Render a list of root block rows to a single HTML string. */
export function renderBlocks(blocks) {
  if (!Array.isArray(blocks)) return "";
  return blocks.map(renderBlock).join("");
}

/** Anchored definition entries (for a Contents rail), mirroring collectAnchoredBlocks. */
export function collectAnchors(blocks) {
  const out = [];
  const walk = (rows) => {
    for (const row of (Array.isArray(rows) ? rows : [])) {
      const b = parseBlock(row);
      if (!b) continue;
      if (b.type === "definition" && b.config.anchor) {
        out.push({ anchor: String(b.config.anchor), name: String(b.config.name || b.config.anchor) });
      }
      if (Array.isArray(b.config.children)) walk(b.config.children);
    }
  };
  walk(blocks);
  return out;
}
