/**
 * Foundry HTML → readable text/BBCode cleanup.
 *
 * Foundry's WYSIWYG ships descriptions decorated with the dnd5e
 * enricher dialect — inline rolls, damage, condition / spell / feat
 * tokens, and Document UUIDs. None of these survive a round-trip into
 * Dauligor: we have no enricher renderer on the website, so the raw
 * tokens get rendered as literal text ("@feat[Initiate of High
 * Sorcery|dsotdq|initiate of high sorcery (lunitari)]"). This module
 * is the single source of truth for converting those tokens into
 * plain readable text BEFORE the HTML hits `htmlToBbcode` (storage
 * path) or `dangerouslySetInnerHTML` (display path).
 *
 * Previously every import module (`spellImport.ts`, `featImport.ts`,
 * `itemImport.ts`) carried its own ~12-line cleanup function with
 * the SAME bug: the `@TYPE[...]` regex required DOUBLE pipes
 * (`@TYPE[name||display]`) to extract a display label, but the
 * dnd5e dialect actually uses SINGLE pipes
 * (`@TYPE[name|sourceId|displayLabel]`). The pattern silently failed
 * and the raw tokens leaked through. Centralising the pipeline here
 * fixes all three callers in one place AND lets us extend the
 * enricher coverage (UUID braces, additional bracketed forms) without
 * three-file edits.
 *
 * Coverage:
 *   - `[[/r 2d6+3]]`              → `2d6+3`
 *   - `[[/damage 2d6 type=fire]]` → `2d6 fire`
 *   - `[[/damage 2d6]]`           → `2d6`
 *   - `[[/check ...]]`            → first arg
 *   - `[[/save ...]]`             → first arg
 *   - `@TYPE[name]`               → `name`
 *   - `@TYPE[name|src]`           → `name` (src is a slug, not display)
 *   - `@TYPE[name|src|display]`   → `display`
 *   - `@UUID[uuid]{display}`      → `display`
 *   - `@UUID[uuid]`               → `uuid`
 *   - Sanitise data-* and class= attrs except ref-* cross-references
 *   - Drop empty `<p>` wrappers
 *
 * Optional surgery:
 *   - `stripLeadingPrereqsLine`   — strip a hand-authored
 *     "Prerequisites: …" marker line from the top of feat
 *     descriptions. Feats surface their prereqs separately in the
 *     detail pane, so the inline marker is redundant. Spells / items
 *     don't have this convention, hence the opt-in flag.
 */

export interface FoundryCleanupOptions {
  /**
   * Strip a hand-authored "Prerequisites: …" line from the top of
   * the description. Recognises the angle-bracketed form some
   * authors use (`<Prerequisites: Level 4+, @feat[…]>`) AND the
   * plain "Prerequisites: …" paragraph form. Default: false.
   */
  stripLeadingPrereqsLine?: boolean;
}

/**
 * Main entry — runs every enricher / sanitiser / prereqs-stripper
 * step in one pass. Idempotent: re-running on already-cleaned text
 * is a no-op for the tokens this module knows about.
 */
export function cleanFoundryHtml(html: string, opts: FoundryCleanupOptions = {}): string {
  let out = String(html ?? '');

  // Strip the literal angle-bracketed prereqs marker some feats
  // open their description with. Run BEFORE entity-decoding (the
  // angle brackets arrive as `&lt;...&gt;` in HTML) and BEFORE the
  // enricher pass so the @feat[…] reference inside the marker is
  // removed wholesale rather than partially-collapsed.
  if (opts.stripLeadingPrereqsLine) {
    out = stripLeadingPrereqsLine(out);
  }

  // Inline rolls / damage / checks. These use double-bracket syntax
  // `[[/verb arg1 arg2 …]]` and always survive the WYSIWYG editor.
  // The "first non-flag argument is the readable bit" heuristic
  // covers every dnd5e v5 case we've seen in the wild.
  out = out.replace(/\[\[\/r\s+([^\]]+?)\]\]/giu, '$1');
  out = out.replace(/\[\[\/damage\s+([^\]\s]+)\s+type=([a-z-]+)(?:[^\]]*)\]\]/giu, '$1 $2');
  out = out.replace(/\[\[\/damage\s+([^\]]+?)\]\]/giu, '$1');
  out = out.replace(/\[\[\/check\s+([^\]\s|]+)(?:[^\]]*)\]\]/giu, '$1');
  out = out.replace(/\[\[\/save\s+([^\]\s|]+)(?:[^\]]*)\]\]/giu, '$1');

  // `@UUID[…]{display}` — display label lives in trailing braces.
  // Resolve to the brace text; fall through to the generic `@TYPE`
  // pass when no braces are present.
  out = out.replace(/@UUID\[[^\]]+\]\{([^}]+)\}/giu, (_match, display) => String(display ?? ''));

  // Generic `@TYPE[arg1|arg2|arg3]` enricher. dnd5e convention:
  //   - 1 arg   → name only        → use name
  //   - 2 args  → name|sourceSlug  → use name
  //   - 3+ args → name|slug|label  → use label
  // Use the LAST arg when there are 3+, the FIRST otherwise. This
  // matches Foundry's own rendering (the display label is whatever
  // the third arg says; absent that, the first arg is the name).
  out = out.replace(/@[a-zA-Z][a-zA-Z0-9]*\[([^\]]+)\]/giu, (_match, content) => {
    const parts = String(content)
      .split('|')
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    if (parts.length === 0) return '';
    if (parts.length >= 3) return parts[parts.length - 1];
    return parts[0];
  });

  // Strip Foundry's noise attributes but preserve Dauligor's own
  // cross-reference markers (data-ref-* and class names containing
  // ref-). bbcodeToHtml emits those when rendering [ref|kind|id]…
  // tags; without this allowlist they get stripped and the SPA
  // click intercept loses the kind+id signal it needs to route.
  out = out.replace(/\sdata-(?!ref-)[a-z0-9-]+="[^"]*"/giu, '');
  out = out.replace(/\sclass="(?![^"]*\bref-)[^"]*"/giu, '');
  out = out.replace(/<p>\s*<\/p>/giu, '');

  return out.trim();
}

/**
 * Strip a leading "Prerequisites: …" marker line.
 *
 * Recognised forms (case-insensitive, run before entity-decode so
 * we match the HTML-escaped angle brackets):
 *
 *   <p>&lt;Prerequisites: Level 4+, @feat[…]&gt;</p>
 *   <p>Prerequisites: Level 4+, @feat[…]</p>
 *   <p><em>Prerequisites:</em> Level 4+, @feat[…]</p>
 *   <p><strong>Prerequisites:</strong> Level 4+, @feat[…]</p>
 *
 * Only the FIRST occurrence is removed and only when it's near the
 * top of the description (within the first 6 elements / 600 chars).
 * That keeps us from accidentally eating a "Prerequisites:" header
 * inside a sub-section of a larger description.
 */
function stripLeadingPrereqsLine(html: string): string {
  // Cheap guard: bail when there's no "Prerequisites" string at all,
  // case-insensitively. Lets the common case (no prereqs marker) skip
  // the more expensive regex work.
  if (!/prerequisites/i.test(html)) return html;

  // Look only at the leading slice; anything past ~600 chars almost
  // certainly belongs to the body proper.
  const HEAD_LIMIT = 600;
  const head = html.slice(0, HEAD_LIMIT);
  const tail = html.slice(HEAD_LIMIT);

  // Match a `<p>…</p>` whose content (after stripping inline tags
  // like <em>/<strong>) begins with the prereqs marker — optionally
  // wrapped in HTML-escaped angle brackets. The non-greedy body
  // bounds us to the first `</p>` so we never swallow more than one
  // paragraph. We do the head-slicing trick above as a belt-and-
  // braces guard against a stray "Prerequisites:" header buried
  // deeper in a long description.
  const cleanedHead = head.replace(
    /<p[^>]*>\s*(?:&lt;\s*)?(?:<[a-z][a-z0-9]*[^>]*>\s*)*prerequisites\s*:[\s\S]*?<\/p>\s*/i,
    '',
  );

  return cleanedHead + tail;
}
