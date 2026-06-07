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
    case "background": return `${APP_HOST}/compendium/backgrounds?focus=${i}${frag}`;
    case "species":
    case "race": return `${APP_HOST}/compendium/races?focus=${i}${frag}`;
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

/**
 * Public ref-anchor builder — the single source of `.dauligor-ref` markup, shared
 * by this module's enrichRefs AND the Foundry-wide TextEditor enricher (Phase 5),
 * so a ref looks + behaves identically inside the viewer and in journals/sheets.
 */
export function refMarkup({ kind, id, anchor = "", rule = false, display } = {}) {
  return refAnchor({ kind, id, anchor, rule, label: refLabel(kind, id, display) });
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

function renderChildren(config, opts) {
  const kids = Array.isArray(config.children) ? config.children : [];
  return kids.map((k) => renderBlock(k, opts)).join("");
}

// ── entity-reference cards ───────────────────────────────────────────────────
// The four entity-reference blocks (reference / entity-feature / entity-row /
// recommended) resolve their EntityRefs to rich cards. The resolved data map
// (`opts.resolved`, keyed `kind:id`) is produced by content-service
// resolveReferences BEFORE render; an absent entry means the target doesn't
// exist yet → render a clearly-marked "reference not yet made" card so an author
// can see WHAT is missing and WHERE. A `placeholder`-kind ref is the OTHER case:
// a deliberate "coming soon" slot, kept visually distinct from a missing one.

/** Plain-text excerpt — strip HTML tags, enriched refs (@Kind[…]{…} / &Reference[…],
 *  any case), leftover [..]/{display} brackets, and HTML entities, then clamp. */
function plainExcerpt(text, max = 140) {
  const t = String(text ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/(?:@|&amp;|&)\w+\[[^\]]*\](?:#[\w-]+)?(?:\{[^}]*\})?/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\{[^}]*\}/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
}

function resolvedFor(opts, ref) {
  if (!opts || !opts.resolved || !ref) return null;
  return opts.resolved.get(`${ref.kind}:${ref.id}`) || null;
}

// A small image block for a card (empty string when there's no image).
function cardMedia(image, alt, extraClass = "") {
  if (!image) return "";
  const cls = `dauligor-card__media ${extraClass}`.trim();
  return `<div class="${cls}"><img src="${esc(image)}" alt="${esc(alt)}" referrerpolicy="no-referrer" /></div>`;
}

// Wrap card inner HTML as a clickable card when the ref has a route, else a plain
// div. Reuses the ref data-attrs so the viewer's delegated handler opens it
// (in-viewer for @article / & system pages, an app tab otherwise). Only used for
// cards whose summary is PLAIN text — never wrap a rich summary (its own ref
// links would nest inside this anchor).
function cardLink(ref, rule, inner, extraClass = "") {
  const route = refRoute(ref.kind, ref.id, "", rule);
  const data = `data-ref-sigil="${rule ? "&" : "@"}" data-ref-kind="${esc(ref.kind)}" data-ref-id="${esc(ref.id)}"`;
  const cls = `dauligor-card ${extraClass}`.trim();
  if (!route) return `<div class="${cls}" ${data}>${inner}</div>`;
  return `<a class="${cls} dauligor-card--link" ${data} data-route="${esc(route)}">${inner}</a>`;
}

// "Reference not yet made" — a real ref whose target doesn't exist yet. Shows the
// intended title plus kind:id so an author knows exactly what to create.
function unresolvedCard(ref, variant) {
  const title = esc(ref.title || ref.name || ref.id || "Untitled reference");
  const meta = `${esc(formatFoundryLabel(ref.kind || "ref"))}<span class="dauligor-card__missing-id">${esc(ref.id || "")}</span>`;
  return `<div class="dauligor-card dauligor-card--missing dauligor-card--${esc(variant)}">`
    + `<div class="dauligor-card__missing-flag"><i class="fas fa-link-slash" inert></i> Reference not yet made</div>`
    + `<div class="dauligor-card__title">${title}</div>`
    + `<div class="dauligor-card__missing-meta">${meta}</div></div>`;
}

// Intentional placeholder (kind === 'placeholder') — a deliberate "coming soon"
// slot, distinct from an unresolved real ref.
function placeholderCard(ref, variant) {
  const title = esc(ref.title || ref.name || "Placeholder");
  const sub = esc(ref.description || "Coming Soon");
  return `<div class="dauligor-card dauligor-card--placeholder dauligor-card--${esc(variant)}">`
    + `<div class="dauligor-card__title">${title}</div>`
    + `<div class="dauligor-card__placeholder-sub">${sub}</div></div>`;
}

// One card slot for the single-ref blocks (feature / recommended): placeholder →
// unresolved → resolved (built by `build`). Shared so they handle the missing
// states identically.
function refCardSlot(ref, opts, variant, build) {
  if (!ref || typeof ref !== "object") return "";
  if (ref.kind === "placeholder") return placeholderCard(ref, variant);
  const r = resolvedFor(opts, ref);
  if (!r) return unresolvedCard(ref, variant);
  return build(ref, r);
}

// reference block — inline (rich summary in flow), card (image + rich summary),
// or link. The title is its OWN link so a rich summary's own refs don't nest
// inside a card anchor.
function renderReferenceBlock(c, opts) {
  const ref = c.ref;
  const display = c.display === "card" ? "card" : c.display === "link" ? "link" : "inline";
  if (!ref || typeof ref !== "object") return "";
  if (ref.kind === "placeholder") {
    return `<div class="dauligor-block dauligor-block--reference">${placeholderCard(ref, "reference")}</div>`;
  }
  const r = resolvedFor(opts, ref);
  if (!r) {
    const body = display === "link"
      ? `<p class="dauligor-card__missing-inline"><i class="fas fa-link-slash" inert></i> Reference not yet made: <strong>${esc(ref.name || ref.id)}</strong> <span class="dauligor-card__missing-id">${esc(ref.kind)}:${esc(ref.id)}</span></p>`
      : unresolvedCard(ref, "reference");
    return `<div class="dauligor-block dauligor-block--reference">${body}</div>`;
  }
  const title = ref.title || r.name || ref.name || ref.id;
  const titleLink = refAnchor({ kind: ref.kind, id: ref.id, anchor: "", rule: !!r.rule, label: esc(title) });
  if (display === "link") {
    return `<div class="dauligor-block dauligor-block--reference"><p class="dauligor-card__inline-link">${titleLink}</p></div>`;
  }
  const summaryRaw = ref.description || r.summary || "";
  const summary = summaryRaw ? `<div class="dauligor-card__summary dauligor-richtext">${renderRichText(summaryRaw)}</div>` : "";
  const src = r.sourceLabel ? `<span class="dauligor-card__source">${esc(r.sourceLabel)}</span>` : "";
  if (display === "card") {
    const media = cardMedia(r.image, title);
    const inner = `${media}<div class="dauligor-card__body">${src}<h3 class="dauligor-card__title">${titleLink}</h3>${summary}</div>`;
    return `<div class="dauligor-block dauligor-block--reference"><div class="dauligor-card dauligor-card--ref-card">${inner}</div></div>`;
  }
  const inner = `<div class="dauligor-card__body">${src}<h3 class="dauligor-card__title">${titleLink}</h3>${summary}</div>`;
  return `<div class="dauligor-block dauligor-block--reference"><div class="dauligor-card dauligor-card--ref-inline">${inner}</div></div>`;
}

function renderEntityFeature(c, opts) {
  const heading = c.title ? `<h2 class="dauligor-block__row-title">${esc(c.title)}</h2>` : "";
  const side = c.imageSide === "right" ? "right" : "left";
  const excerpt = c.excerpt !== false;
  const card = refCardSlot(c.ref, opts, "feature", (ref, r) => {
    const title = ref.title || r.name || ref.name || ref.id;
    const media = cardMedia(r.image, title, "dauligor-card__media--feature");
    const src = r.sourceLabel ? `<span class="dauligor-card__source">${esc(r.sourceLabel)}</span>` : "";
    const summaryText = excerpt ? (ref.description || plainExcerpt(r.summary, 240)) : "";
    const summary = summaryText ? `<p class="dauligor-card__summary">${esc(summaryText)}</p>` : "";
    const view = refRoute(ref.kind, ref.id, "", !!r.rule) ? `<span class="dauligor-card__view">View <i class="fas fa-chevron-right" inert></i></span>` : "";
    const inner = `<div class="dauligor-card__feature dauligor-card__feature--${side}">${media}<div class="dauligor-card__body">${src}<h3 class="dauligor-card__title">${esc(title)}</h3>${summary}${view}</div></div>`;
    return cardLink(ref, !!r.rule, inner, "dauligor-card--feature");
  });
  return `<section class="dauligor-block dauligor-block--entity-feature">${heading}${card}</section>`;
}

function recommendedCard(ref, r) {
  const title = (ref && (ref.title || ref.name)) || r.name || (ref && ref.id) || "Article";
  const media = cardMedia(r.image, title, "dauligor-card__media--feature");
  const summaryText = r.summary ? plainExcerpt(r.summary, 220) : "";
  const summary = summaryText ? `<p class="dauligor-card__summary">${esc(summaryText)}</p>` : "";
  const badge = `<span class="dauligor-card__badge">Essential Reading</span>`;
  const view = (ref && refRoute(ref.kind, ref.id, "", !!r.rule)) ? `<span class="dauligor-card__view">Read article <i class="fas fa-chevron-right" inert></i></span>` : "";
  const inner = `<div class="dauligor-card__feature dauligor-card__feature--left">${media}<div class="dauligor-card__body">${badge}<h3 class="dauligor-card__title">${esc(title)}</h3>${summary}${view}</div></div>`;
  return ref ? cardLink(ref, !!r.rule, inner, "dauligor-card--feature dauligor-card--reco") : `<div class="dauligor-card dauligor-card--feature dauligor-card--reco">${inner}</div>`;
}

function renderRecommended(c, opts) {
  const heading = `<h2 class="dauligor-block__row-title">${esc(c.title || "Recommended")}</h2>`;
  let card;
  if (c.source === "specific" && c.ref) {
    card = refCardSlot(c.ref, opts, "recommended", (ref, r) => recommendedCard(ref, r));
  } else {
    // auto → the viewer resolves the campaign's recommended_lore_id into opts.recommended.
    const auto = opts && opts.recommended;
    card = (auto && auto.data)
      ? recommendedCard(auto.ref, auto.data)
      : `<div class="dauligor-card dauligor-card--placeholder dauligor-card--recommended"><div class="dauligor-card__placeholder-sub">No recommended article set for this campaign yet.</div></div>`;
  }
  return `<section class="dauligor-block dauligor-block--recommended">${heading}${card}</section>`;
}

function entityRowCard(ref, opts, cardMode, excerpt) {
  if (!ref || typeof ref !== "object") return "";
  if (ref.kind === "placeholder") return placeholderCard(ref, "row");
  const r = resolvedFor(opts, ref);
  if (!r) return unresolvedCard(ref, "row");
  const title = ref.title || r.name || ref.name || ref.id;
  const media = cardMode === "image" ? cardMedia(r.image, title) : "";
  const src = r.sourceLabel ? `<span class="dauligor-card__source">${esc(r.sourceLabel)}</span>` : "";
  const summaryText = excerpt ? (ref.description || plainExcerpt(r.summary, 140)) : "";
  const summary = summaryText ? `<p class="dauligor-card__summary">${esc(summaryText)}</p>` : "";
  const inner = `${media}<div class="dauligor-card__body">${src}<h3 class="dauligor-card__title">${esc(title)}</h3>${summary}</div>`;
  return cardLink(ref, !!r.rule, inner, `dauligor-card--row dauligor-card--${esc(cardMode)}`);
}

function entityRowListItem(ref, opts) {
  if (!ref || typeof ref !== "object") return "";
  if (ref.kind === "placeholder") {
    return `<li class="dauligor-block__entity-list-item"><span class="dauligor-card__title">${esc(ref.name || "Placeholder")}</span></li>`;
  }
  const r = resolvedFor(opts, ref);
  if (!r) {
    return `<li class="dauligor-block__entity-list-item dauligor-block__entity-list-item--missing">`
      + `<span class="dauligor-card__missing-flag"><i class="fas fa-link-slash" inert></i> not yet made</span> `
      + `<span class="dauligor-card__title">${esc(ref.name || ref.id)}</span> `
      + `<span class="dauligor-card__missing-id">${esc(ref.kind)}:${esc(ref.id)}</span></li>`;
  }
  const title = ref.title || r.name || ref.name || ref.id;
  const src = r.sourceLabel ? `<span class="dauligor-card__source">${esc(r.sourceLabel)}</span>` : "";
  const inner = `<i class="fas fa-chevron-right dauligor-list__chev" inert></i><span class="dauligor-card__title">${esc(title)}</span>${src}`;
  const route = refRoute(ref.kind, ref.id, "", !!r.rule);
  const data = `data-ref-sigil="${r.rule ? "&" : "@"}" data-ref-kind="${esc(ref.kind)}" data-ref-id="${esc(ref.id)}"`;
  const body = route
    ? `<a class="dauligor-list__link" ${data} data-route="${esc(route)}">${inner}</a>`
    : `<div class="dauligor-list__link">${inner}</div>`;
  return `<li class="dauligor-block__entity-list-item">${body}</li>`;
}

function renderEntityRow(c, opts) {
  const refs = Array.isArray(c.refs) ? c.refs : [];
  const cols = Math.max(1, Math.min(4, Number(c.columns) || 3));
  const cardMode = ["image", "compact", "list"].includes(c.card) ? c.card : "image";
  const excerpt = c.excerpt !== false;
  const heading = (c.showHeading && c.title) ? `<h2 class="dauligor-block__row-title">${esc(c.title)}</h2>` : "";
  if (c.source === "auto" && !refs.length) {
    // Auto-by-category fetch isn't available in Foundry yet (matches the app).
    return `<section class="dauligor-block dauligor-block--entity-row">${heading}`
      + `<div class="dauligor-card dauligor-card--placeholder"><div class="dauligor-card__placeholder-sub">Automatic category rows aren’t available in Foundry yet.</div></div></section>`;
  }
  if (cardMode === "list") {
    const items = refs.map((ref) => entityRowListItem(ref, opts)).join("");
    return `<section class="dauligor-block dauligor-block--entity-row">${heading}<ul class="dauligor-block__entity-list">${items}</ul></section>`;
  }
  const items = refs.map((ref) => {
    const span = Math.min(Math.max(1, Math.min(4, Number(ref?.span) || 1)), cols);
    const spanCls = span >= 2 ? ` dauligor-block__entity-cell--span-${span}` : "";
    return `<li class="dauligor-block__entity-cell${spanCls}">${entityRowCard(ref, opts, cardMode, excerpt)}</li>`;
  }).join("");
  return `<section class="dauligor-block dauligor-block--entity-row">${heading}<ul class="dauligor-block__entity-grid dauligor-block--cols-${esc(String(cols))}">${items}</ul></section>`;
}

function renderBlock(row, opts) {
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
        + `${c.url ? `<img src="${esc(c.url)}" alt="${esc(c.caption || "")}" referrerpolicy="no-referrer" />` : ""}`
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
      return renderReferenceBlock(c, opts);
    case "entity-feature":
      return renderEntityFeature(c, opts);
    case "entity-row":
      return renderEntityRow(c, opts);
    case "recommended":
      return renderRecommended(c, opts);
    case "group":
      return `<section class="dauligor-block dauligor-block--group dauligor-block--${esc(c.style || "plain")}">`
        + `${(c.showTitle && c.title) ? `<h2 class="dauligor-block__group-title">${esc(c.title)}</h2>` : ""}${renderChildren(c, opts)}</section>`;
    case "columns":
      return `<div class="dauligor-block dauligor-block--columns dauligor-block--cols-${esc(String(c.columns || 2))} dauligor-block--gap-${esc(c.gap || "medium")}">${renderChildren(c, opts)}</div>`;
    case "column":
      return `<div class="dauligor-block dauligor-block--column">${renderChildren(c, opts)}</div>`;
    default:
      return ""; // unknown type — dropped, as the app's parseLayoutBlock does
  }
}

/**
 * Render a list of root block rows to a single HTML string. `opts.resolved` is a
 * Map (`kind:id` → display data) from content-service resolveReferences; entity-
 * reference blocks read it to draw cards (and mark unresolved refs). `opts.recommended`
 * (`{ ref, data }`) feeds an auto-mode recommended block. Both are optional — with
 * no opts, entity-reference blocks fall back to "reference not yet made" cards.
 */
export function renderBlocks(blocks, opts = {}) {
  if (!Array.isArray(blocks)) return "";
  return blocks.map((b) => renderBlock(b, opts)).join("");
}

/** Every resolvable EntityRef in a block tree (skips placeholder + id-less +
 *  auto-source rows), depth-first incl. container children. Feeds resolveReferences. */
export function collectEntityRefs(blocks) {
  const out = [];
  const push = (ref) => {
    if (!ref || typeof ref !== "object") return;
    if (ref.kind === "placeholder" || !ref.kind || !ref.id) return;
    out.push(ref);
  };
  const walk = (rows) => {
    for (const row of (Array.isArray(rows) ? rows : [])) {
      const b = parseBlock(row);
      if (!b) continue;
      const c = b.config;
      if (b.type === "reference") push(c.ref);
      else if (b.type === "entity-feature") push(c.ref);
      else if (b.type === "entity-row") { if (c.source !== "auto") (Array.isArray(c.refs) ? c.refs : []).forEach(push); }
      else if (b.type === "recommended") { if (c.source === "specific") push(c.ref); }
      if (Array.isArray(c.children)) walk(c.children);
    }
  };
  walk(blocks);
  return out;
}

/** True when the tree has a `recommended` block in auto mode — lets the viewer
 *  skip the extra recommended_lore_id fetch on pages that don't need it. */
export function hasAutoRecommendedBlock(blocks) {
  let found = false;
  const walk = (rows) => {
    for (const row of (Array.isArray(rows) ? rows : [])) {
      const b = parseBlock(row);
      if (!b) continue;
      if (b.type === "recommended" && b.config.source !== "specific") found = true;
      if (Array.isArray(b.config.children)) walk(b.config.children);
    }
  };
  walk(Array.isArray(blocks) ? blocks : []);
  return found;
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
