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

function resolveRefRoute(kind: string, id: string): string | null {
  const safeId = encodeURIComponent(id);
  switch (kind) {
    case "spell":     return `/compendium/spells?focus=${safeId}`;
    case "class":     return `/compendium/classes/view/${safeId}`;
    case "condition": return `/admin/statuses?focus=${safeId}`;
    case "creature":  return null;
    default:          return null;
  }
}

function escapeAttr(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

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

  // Cross-references — [ref|kind|id]Display[/ref]. Routes only work
  // in the web app; Foundry users clicking will get a no-op. Kept
  // anyway so the markup survives a round-trip (if/when a player
  // re-imports a Foundry-exported spell, the anchor's data-ref-*
  // attrs let the converter rebuild the BBCode marker).
  html = html.replace(
    /\[ref\|([a-z]+)\|([^\]|]+)\]([\s\S]*?)\[\/ref\]/gi,
    (_match, rawKind, rawId, display) => {
      const kind = String(rawKind || "").toLowerCase();
      const id = String(rawId || "").trim();
      const text = String(display || "").trim() || id;
      const route = resolveRefRoute(kind, id);
      const safeKind = escapeAttr(kind);
      const safeId = escapeAttr(id);
      if (route) {
        return `<a class="ref-link ref-${safeKind}" data-ref-kind="${safeKind}" data-ref-id="${safeId}" href="${escapeAttr(route)}">${text}</a>`;
      }
      return `<span class="ref-link ref-${safeKind} ref-dangling" data-ref-kind="${safeKind}" data-ref-id="${safeId}">${text}</span>`;
    }
  );

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
  html = html.replace(/\[quote\]([\s\S]*?)\[\/quote\]/gi, "<blockquote>$1</blockquote>");
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
  processedHtml = processedHtml.replace(/<hr([^>]*)\/?>/gi, "\n\n<hr$1/>\n\n");

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
