/**
 * Background "at-a-glance" parser.
 * ───────────────────────────────
 * 5etools-sourced backgrounds store their proficiency summary as a single
 * BBCode `[ul]` list near the top of the description — the classic D&D book
 * block:
 *
 *   [hr][ul]
 *     [li]Skill Proficiencies: History, Survival[/li]
 *     [li]Tool Proficiencies: Cartographer's tools or navigator's tools[/li]
 *     [li]Languages: One of your choice[/li]
 *     [li]Equipment: A wooden case containing … a pouch containing 25 gp[/li]
 *   [/ul]
 *
 * The detail/view surfaces want those as a tidy labelled section ABOVE the
 * prose, with the block removed from the prose body so it isn't shown twice.
 * `advancements`/`startingEquipment` are empty in the current data (the
 * structured auto-import is a later milestone), so this prose block is the
 * ONLY source for that summary today.
 *
 * The real data is messy, so the parser is defensive about STRUCTURE:
 *   • The first `[li]` is sometimes mangled by the 5etools→Foundry conversion
 *     as `<l[i]…</li>` (e.g. Azorius Functionary, Custom Background) — we
 *     normalise `<l[i]`/`<li>`/`</li>` back to `[li]`/`[/li]` before splitting.
 *   • 2024 backgrounds add `Ability Scores:` and `Feat:` lines; the PHB Custom
 *     Background uses a combined `Languages and Tool Proficiencies:` label.
 *
 * It does NOT try to cleanse the value text. Cross-references, `[url]` links,
 * `{@skill …}`-style enricher residue, etc. are left intact and rendered by the
 * canonical `cleanFoundryHtml(bbcodeToHtml(…))` display transform — the same
 * pipeline feats/spells use (see `BackgroundProficiencies`). The values come
 * back as raw BBCode.
 *
 * `[ul]` is a 100%-reliable anchor across the imported corpus (the proficiency
 * list is always the FIRST list, well before the `[h3]` feature blocks). If a
 * description has no recognisable block we return it untouched.
 */

export type BackgroundProfEntry = {
  /** Canonical bucket key (skills, tools, languages, equipment, …). */
  key: string;
  /** Display label, e.g. "Skill Proficiencies". */
  label: string;
  /** Cleaned value text, e.g. "History, Survival". */
  value: string;
};

export type ParsedBackgroundDetails = {
  /** Ordered proficiency entries lifted from the `[ul]` block. */
  entries: BackgroundProfEntry[];
  /** Description BBCode with the proficiency block (and its leading `[hr]`) removed. */
  body: string;
};

// Canonical label map. Keys are the lower-cased, punctuation-stripped authored
// label; values give the bucket key + the display label we render.
const LABEL_MAP: Record<string, { key: string; label: string }> = {
  'ability scores': { key: 'abilityScores', label: 'Ability Scores' },
  'ability score': { key: 'abilityScores', label: 'Ability Scores' },
  feat: { key: 'feat', label: 'Feat' },
  'skill proficiencies': { key: 'skills', label: 'Skill Proficiencies' },
  'skill proficiency': { key: 'skills', label: 'Skill Proficiencies' },
  skills: { key: 'skills', label: 'Skill Proficiencies' },
  'tool proficiencies': { key: 'tools', label: 'Tool Proficiencies' },
  'tool proficiency': { key: 'tools', label: 'Tool Proficiencies' },
  tools: { key: 'tools', label: 'Tool Proficiencies' },
  'languages and tool proficiencies': {
    key: 'languagesTools',
    label: 'Languages & Tool Proficiencies',
  },
  'language and tool proficiencies': {
    key: 'languagesTools',
    label: 'Languages & Tool Proficiencies',
  },
  languages: { key: 'languages', label: 'Languages' },
  language: { key: 'languages', label: 'Languages' },
  'saving throws': { key: 'savingThrows', label: 'Saving Throws' },
  equipment: { key: 'equipment', label: 'Equipment' },
};

// Canonical render order (D&D book order — 2024 ability/feat lines first, the
// four classic proficiency lines, then equipment last). Unknown keys keep
// their source order, appended after these.
const KEY_ORDER = [
  'abilityScores',
  'feat',
  'skills',
  'tools',
  'languages',
  'languagesTools',
  'savingThrows',
  'equipment',
];

const KNOWN_KEYS = new Set(Object.values(LABEL_MAP).map((v) => v.key));

function normalizeLabel(rawLabel: string): { key: string; label: string } {
  const cleaned = rawLabel
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const hit = LABEL_MAP[cleaned];
  if (hit) return hit;
  // Unknown label — keep it, title-cased, under a stable per-label key so it
  // still renders (sorted after the known ones).
  return {
    key: `x:${cleaned}`,
    label: rawLabel.trim().replace(/\s+/g, ' '),
  };
}

/**
 * Light, STRUCTURAL-only normalisation of a list item before we split it into
 * label + value: strip inline formatting tags (so the label still matches and a
 * stray `[/b]` can't leak) and collapse whitespace. Cross-references, links, and
 * enricher residue are deliberately left intact for the render-time transform.
 */
function normalizeItemText(input: string): string {
  return String(input || '')
    .replace(/\[\/?(?:b|i|u|s|sub|sup|small|em|strong)\]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse a background's description BBCode into a labelled proficiency summary
 * plus the remaining prose body.
 */
export function parseBackgroundDetails(description: string): ParsedBackgroundDetails {
  const raw = String(description ?? '');
  if (!raw.trim()) return { entries: [], body: raw };

  // First `[ul]…[/ul]` — the proficiency block is always the first list.
  const blockMatch = /\[ul\][\s\S]*?\[\/ul\]/i.exec(raw);
  if (!blockMatch) return { entries: [], body: raw };

  // Normalise the malformed first item (`<l[i]…</li>`) + any HTML list tags to
  // BBCode so item extraction is uniform.
  const blockNorm = blockMatch[0]
    .replace(/<l\[i\]/gi, '[li]')
    .replace(/<li>/gi, '[li]')
    .replace(/<\/li>/gi, '[/li]');

  const items: string[] = [];
  const liRegex = /\[li\]([\s\S]*?)\[\/li\]/gi;
  let m: RegExpExecArray | null;
  while ((m = liRegex.exec(blockNorm)) !== null) items.push(m[1]);

  const entries: BackgroundProfEntry[] = [];
  for (const item of items) {
    const text = normalizeItemText(item);
    if (!text) continue;
    const colon = text.indexOf(':');
    if (colon === -1) continue; // not a "Label: value" line
    const label = text.slice(0, colon).trim();
    const value = text.slice(colon + 1).trim();
    if (!label || !value) continue;
    const { key, label: displayLabel } = normalizeLabel(label);
    entries.push({ key, label: displayLabel, value });
  }

  // Only treat the block as a proficiency block if it produced at least one
  // recognised label — otherwise it's some other list and we leave it in the body.
  if (!entries.some((e) => KNOWN_KEYS.has(e.key))) {
    return { entries: [], body: raw };
  }

  // Stable sort into canonical order; unknown keys keep their relative order
  // after the known ones.
  const orderOf = (key: string) => {
    const idx = KEY_ORDER.indexOf(key);
    return idx === -1 ? KEY_ORDER.length : idx;
  };
  const ordered = entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => orderOf(a.e.key) - orderOf(b.e.key) || a.i - b.i)
    .map(({ e }) => e);

  // Remove the block + an immediately-preceding `[hr]` from the prose body.
  const body = raw
    .replace(/(?:\[hr\]\s*)?\[ul\][\s\S]*?\[\/ul\]/i, '\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { entries: ordered, body };
}
