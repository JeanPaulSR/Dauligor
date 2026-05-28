// BBCode → HTML converter for server-side rendering of spell
// descriptions before they ship to the Foundry module.
//
// Mirrored from `src/lib/bbcode.ts` (the website's converter). The
// `api/` tree can't import from `src/lib/` (Vercel bundling
// constraint — see `project_vercel_module_endpoint.md` in memory),
// so this is a drift-aware copy.
//
// Trimmed from the original:
//   - `BbcodeViewContext` + era/campaign block handling — not
//     relevant for module export (Foundry has no era/campaign
//     conditional content).
//   - `htmlToBbcode` (reverse direction) — server-side never needs it.
//   - `RefKind` route resolution links to app-side URLs that don't
//     exist in Foundry. Kept the conversion (the anchor tag is
//     harmless in Foundry; clicking just no-ops) but downstream
//     consumers shouldn't depend on the routes working.
//
// Drift contract: if `src/lib/bbcode.ts` adds a new BBCode tag (e.g.
// `[h5]`), mirror it here. The escapeAttr + XSS-escape semantics
// MUST match — the Foundry-shipped spell description survives a
// round-trip when a player re-imports the spell into the app.

/**
 * BBCode → HTML. Matches the website's converter byte-for-byte on
 * non-era/campaign content; era and campaign conditional blocks are
 * stripped entirely (their content is hidden) since module export
 * has no concept of "current era" / "current campaign".
 */
export function bbcodeToHtml(text: string): string {
  if (!text) return "";

  let html = text;

  // Conditional era / campaign blocks: not applicable to module
  // export. Strip the wrapper tag pairs and keep nothing — the
  // content was authored as alternate timeline / per-campaign,
  // neither of which the Foundry side has to reason about. (Matches
  // the website's "non-matching era" branch.)
  html = html.replace(/\[era\s+id=["'][^"']+["']\]([\s\S]*?)\[\/era\]/gi, "");
  html = html.replace(/\[campaign\s+id=["'][^"']+["']\]([\s\S]*?)\[\/campaign\]/gi, "");

  // XSS escape pass. Important: this runs BEFORE the BBCode markers
  // are expanded so the tag syntax (`[b]`, `[/i]`, etc.) is the only
  // thing the subsequent regexes match — any `<` or `>` in the
  // authored content already became `&lt;` / `&gt;` so they can't
  // pose as HTML.
  //
  // Foundry-side renderers (dnd5e's enrichHTML) tolerate the
  // resulting `&amp;Reference[...]` and `[[/r ...]]` patterns —
  // they're plain text from the escape's perspective and survive
  // intact. No restoration step needed.
  html = html
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

  // Cross-references — INTENTIONALLY not rendered here. The web app's
  // bbcode.ts renders @kind[id]{display} / &kind[id] into reader anchors,
  // but on the Foundry side those references are resolved by the module's
  // custom enrichers (the deferred live-content bridge), and dnd5e's own
  // &Reference[...] already covers SRD conditions/rules. So we leave the
  // raw reference text in place for Foundry's enrich pipeline to pick up.
  // (The retired [ref|...] tag is gone; there is no [ref|...] content to
  // migrate. See src/lib/bbcode.ts for the app-reader rendering.)

  // Basic formatting
  html = html.replace(/\[b\]([\s\S]*?)\[\/b\]/gi, "<strong>$1</strong>");
  html = html.replace(/\[i\]([\s\S]*?)\[\/i\]/gi, "<em>$1</em>");
  html = html.replace(/\[u\]([\s\S]*?)\[\/u\]/gi, "<u>$1</u>");
  html = html.replace(/\[s\]([\s\S]*?)\[\/s\]/gi, "<del>$1</del>");

  // Headings
  html = html.replace(/\[h1\]([\s\S]*?)\[\/h1\]/gi, "<h1>$1</h1>");
  html = html.replace(/\[h2\]([\s\S]*?)\[\/h2\]/gi, "<h2>$1</h2>");
  html = html.replace(/\[h3\]([\s\S]*?)\[\/h3\]/gi, "<h3>$1</h3>");
  html = html.replace(/\[h4\]([\s\S]*?)\[\/h4\]/gi, "<h4>$1</h4>");

  // Alignment
  html = html.replace(/\[left\]([\s\S]*?)\[\/left\]/gi, '<p style="text-align: left">$1</p>');
  html = html.replace(/\[center\]([\s\S]*?)\[\/center\]/gi, '<p style="text-align: center">$1</p>');
  html = html.replace(/\[right\]([\s\S]*?)\[\/right\]/gi, '<p style="text-align: right">$1</p>');
  html = html.replace(/\[justify\]([\s\S]*?)\[\/justify\]/gi, '<p style="text-align: justify">$1</p>');
  html = html.replace(/\[indent\]([\s\S]*?)\[\/indent\]/gi, '<div style="padding-left: 2rem">$1</div>');

  // Lists (multi-pass for nesting)
  for (let i = 0; i < 6; i++) {
    html = html.replace(/\[li\]((?:(?!\[li\]|\[\/li\])[\s\S])*)\[\/li\]/gi, "<li>$1</li>");
    html = html.replace(/\[ul\]((?:(?!\[ul\]|\[\/ul\])[\s\S])*)\[\/ul\]/gi, "<ul>$1</ul>");
    html = html.replace(/\[ol\]((?:(?!\[ol\]|\[\/ol\])[\s\S])*)\[\/ol\]/gi, "<ol>$1</ol>");
  }

  // Special
  // Quote — trim + convert internal newlines to <br> so a trailing blank
  // line (or multi-paragraph quote) doesn't leave a `\n\n` inside the
  // <blockquote> that the paragraph splitter below would break on,
  // producing malformed `<blockquote>…<p></blockquote></p>`.
  // (Mirror of src/lib/bbcode.ts.)
  html = html.replace(/\[quote\]([\s\S]*?)\[\/quote\]/gi, (_m, inner) =>
    `<blockquote>${String(inner).trim().replace(/\n{2,}/g, "<br/><br/>").replace(/\n/g, "<br/>")}</blockquote>`);
  html = html.replace(/\[indent\]([\s\S]*?)\[\/indent\]/gi, '<div class="indent-block" style="padding-left: 2rem">$1</div>');
  html = html.replace(/\[code\]([\s\S]*?)\[\/code\]/gi, "<code>$1</code>");
  html = html.replace(/\[br\]/gi, "<br/>");
  html = html.replace(/\[hr\]/gi, "<hr/>");
  html = html.replace(/\[small\]([\s\S]*?)\[\/small\]/gi, "<small>$1</small>");
  html = html.replace(/\[sub\]([\s\S]*?)\[\/sub\]/gi, "<sub>$1</sub>");
  html = html.replace(/\[sup\]([\s\S]*?)\[\/sup\]/gi, "<sup>$1</sup>");

  // Links
  html = html.replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi, '<a href="$1" target="_blank" rel="noopener noreferrer">$2</a>');
  html = html.replace(/\[url\]([\s\S]*?)\[\/url\]/gi, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');

  // Custom World Anvil-like tags
  html = html.replace(/\[spoiler\]([\s\S]*?)\[\/spoiler\]/gi, '<span class="spoiler" title="Click to reveal">$1</span>');
  html = html.replace(/\[comment\]([\s\S]*?)\[\/comment\]/gi, "<!-- $1 -->");

  // Paragraph wrapping — convert double newlines to paragraph
  // boundaries; single newlines inside a paragraph become <br/>.
  // Matches the website's logic so a round-trip through the editor
  // produces the same shape.
  let processedHtml = html.replace(/<(h[1-4]|p|div|blockquote|ul|ol|li|hr|table|tr|th|td)([^>]*)>([\s\S]*?)<\/\1>/gi,
    (match) => `\n\n${match.trim()}\n\n`);
  // Don't recapture the self-closing slash — the old `<hr([^>]*)\/?>`
  // captured the existing `/` into $1 and re-appended `/>`, producing
  // `<hr//>`. (Mirror of src/lib/bbcode.ts.)
  processedHtml = processedHtml.replace(/<hr\s*\/?>/gi, "\n\n<hr/>\n\n");

  const blocks = processedHtml.split(/\n\n+/);
  html = blocks
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return "";
      if (trimmed.match(/^<(h[1-4]|div|blockquote|ul|ol|li|p|hr|table|tr|th|td)/i)) {
        return trimmed.replace(/>\s+\n/g, ">").replace(/\n\s+</g, "<");
      }
      return `<p>${trimmed.replace(/\n/g, "<br/>")}</p>`;
    })
    .join("");

  return html;
}
