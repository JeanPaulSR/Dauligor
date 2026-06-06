// Generic block-layout engine — an ordered, nestable list of content blocks that
// a builder arranges into a page body. Originally extracted from the campaign
// homepage builder (`campaignHome.ts`) so the same model/serialize/parse can back
// multiple surfaces: campaign homepages today, lore articles (and later system
// articles) next.
//
// Storage convention (mirrored by every consumer table, e.g.
// `campaign_home_blocks`): one row per ROOT block — `{ id, block_type, "order",
// config }` with a JSON `config`. Container blocks (group/columns/column) carry
// their children INSIDE `config.children` — nesting is config-local; only the
// root list uses the `order` column. Reads/writes go through a per-surface API
// endpoint; `fetchLayoutBlocks(url)` / `saveLayoutBlocks(url, blocks)` are the
// generic transport (the surface supplies its own URL + auth-gated handler).
//
// The `recommended` block is campaign-specific (it resolves a campaign's
// recommended-lore pick). It stays in the shared model so parse/serialize round-
// trip it, but other surfaces simply omit it from their add-block picker
// (`allowedTypes`) and never author one.

import { getSessionToken } from "./auth";

export type LayoutBlockType =
  | 'hero'
  | 'text'
  | 'note'             // staff-only "Storyteller Note" (rendered only when viewContext.isStaff)
  | 'secret'           // reveal-per-campaign secret (rendered to staff, or players whose campaign is revealed)
  | 'image'
  | 'divider'
  | 'recommended'
  | 'callout'          // a styled call-to-action box (heading + text + optional button)
  | 'reference'        // embed ONE referenced entity inline / as a card / as a link
  | 'entity-row'       // a row/grid of entity cards (articles, classes, items, …)
  | 'entity-feature'   // one large highlighted entity
  | 'group'            // container: a titled card holding children
  | 'columns'          // container: a 2–4 column grid; each child is a `column`
  | 'column';          // a single column cell inside a `columns` block

interface BlockBase {
  /** Stable id (uuid). Generated client-side when a block is added. */
  id: string;
}

export interface HeroBlock extends BlockBase {
  blockType: 'hero';
  title: string;
  /** BBCode, rendered via BBCodeRenderer. The seeded default wraps its text in
   *  [i]…[/i] for the classic italic look, but a GM can use any BBCode now. */
  subtitle: string;
  align: 'center' | 'left' | 'right';
  size: 'normal' | 'large';
}
export interface TextBlock extends BlockBase {
  blockType: 'text';
  /** BBCode body, rendered via BBCodeRenderer. */
  body: string;
  width: 'narrow' | 'normal' | 'wide';
}
/** A staff-only annotation. Rendered ONLY when the viewer is staff
 *  (viewContext.isStaff). The lore API strips note blocks from the payload for
 *  non-staff readers so the body never reaches players (client hiding alone is
 *  not enough), and the content mirror excludes them. */
export interface NoteBlock extends BlockBase {
  blockType: 'note';
  /** BBCode body, rendered via BBCodeRenderer. */
  body: string;
}
/** A reveal-per-campaign secret. Rendered to staff always, and to a player only
 *  when their active campaign is in `revealedCampaignIds`. The lore API strips
 *  the block from the payload for viewers who shouldn't see it (real boundary,
 *  not just client hiding), and the content mirror excludes it. `eraIds` scopes
 *  which campaigns are eligible to be revealed-to in the editor UI. */
export interface SecretBlock extends BlockBase {
  blockType: 'secret';
  /** BBCode body, rendered via BBCodeRenderer. */
  body: string;
  /** Eras this secret belongs to (UI: gates which campaigns can be revealed-to). */
  eraIds: string[];
  /** Campaigns this secret is revealed to (the actual visibility gate). */
  revealedCampaignIds: string[];
}
export interface ImageBlock extends BlockBase {
  blockType: 'image';
  url: string;
  caption: string;
  height: 'small' | 'medium' | 'large';
  /** Optional in-app link the image navigates to on click. */
  link: string;
}
export interface DividerBlock extends BlockBase {
  blockType: 'divider';
  style: 'line' | 'dots' | 'space';
}
export interface RecommendedBlock extends BlockBase {
  blockType: 'recommended';
  /** Optional heading override; defaults to "Recommended for <campaign>". */
  title: string;
  /** 'auto' = the campaign's recommended_lore_id; 'specific' = a chosen article. */
  source: 'auto' | 'specific';
  /** When source==='specific': the chosen entity ref (kind+id). */
  ref: EntityRef | null;
  layout: 'side' | 'stacked';
}

/** A reference to one compendium / lore / system entity, resolved to a card via
 *  `resolveReference(kind, id)` at render time. `kind` is a STRING (not the
 *  narrow `RefKind`) because system pages are addressed by their page identifier
 *  (`condition`, `skill`, `magic`, …) which isn't in the static `RefKind` union;
 *  `resolveReference` accepts any string and routes via the system-page kind map.
 *  `id` is the semantic identifier/slug (article uses its slug; a system PAGE
 *  ref uses an empty id, a system ENTRY ref uses the entry identifier). */
export interface EntityRef {
  kind: string;
  id: string;
  /** Cached display name — lets the editor render chips without a round-trip.
   *  Display still re-resolves live so renames are reflected. For a PLACEHOLDER
   *  ref (`kind === PLACEHOLDER_KIND`) this is the only meaningful field — it's
   *  the card title to show. */
  name?: string;
  /** Per-card heading override ("what it says"). When non-empty it wins over the
   *  resolved entity name / `name`. Empty → resolved name, then `name`, then the
   *  PLACEHOLDER_TITLE default. */
  title?: string;
  /** Per-card description override ("what its description says"). When non-empty
   *  it wins over the resolved entity summary. Empty → resolved summary, then the
   *  PLACEHOLDER_DESCRIPTION default. */
  description?: string;
  /** How many grid columns this card spans (1–4, default 1). Lets a GM size any
   *  card individually (set in the entity picker). Clamped to the row's column
   *  count at render time. */
  span?: number;
}

/** Defaults shown when a card has neither an override nor resolved entity data —
 *  e.g. a fresh placeholder, or a real ref whose target doesn't exist yet. */
export const PLACEHOLDER_TITLE = 'Placeholder';
export const PLACEHOLDER_DESCRIPTION = 'Coming Soon';
/** A card's column span, clamped 1–4 (default 1). */
export const clampSpan = (v: any): number => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(1, Math.min(4, n)) : 1;
};

/** A placeholder ref names a card slot without pointing at a real entity — the
 *  GM gets a styled "coming soon" card without having to create a fake article.
 *  Mirrors the legacy Home behaviour where a missing article still rendered a
 *  card. Renderer + picker special-case this kind. */
export const PLACEHOLDER_KIND = 'placeholder';
export const isPlaceholderRef = (r: EntityRef): boolean => r.kind === PLACEHOLDER_KIND;
export const makePlaceholderRef = (name: string): EntityRef => ({ kind: PLACEHOLDER_KIND, id: '', name });

export interface EntityRowBlock extends BlockBase {
  blockType: 'entity-row';
  title: string;
  showHeading: boolean;
  /** 'manual' = the hand-picked `refs`; 'auto' = latest N articles of a category. */
  source: 'manual' | 'auto';
  refs: EntityRef[];
  /** auto-mode: which lore category to pull from. */
  category: string;
  /** auto-mode: how many to show (1–12). */
  count: number;
  columns: 1 | 2 | 3 | 4;
  card: 'image' | 'compact' | 'list';
  excerpt: boolean;
}

/** A styled call-to-action box — the "Character Creation · Work in Progress"
 *  dashed panel on the default home. Heading + body + an optional button. */
export interface CalloutBlock extends BlockBase {
  blockType: 'callout';
  title: string;
  body: string;
  /** Optional button label; button only renders when both label + link are set. */
  buttonLabel: string;
  buttonLink: string;
  /** 'soft' = dashed gold panel (default-home look); 'plain' = bordered card. */
  style: 'soft' | 'plain';
}
export interface EntityFeatureBlock extends BlockBase {
  blockType: 'entity-feature';
  title: string;
  ref: EntityRef | null;
  imageSide: 'left' | 'right';
  excerpt: boolean;
}
/** Embed ONE referenced entity (article, condition, spell, system entry, …),
 *  resolved live via `resolveReference`. `inline` renders its summary/body text
 *  in-flow (the new capability — e.g. show a rule's text inside an article);
 *  `card` is the image+name+summary tile; `link` is an inline link/chip. This is
 *  the generic primitive that system-page entity-backed entries will reuse. */
export interface ReferenceBlock extends BlockBase {
  blockType: 'reference';
  ref: EntityRef | null;
  display: 'inline' | 'card' | 'link';
}
export interface GroupBlock extends BlockBase {
  blockType: 'group';
  title: string;
  showTitle: boolean;
  style: 'card' | 'bordered' | 'plain';
  children: LayoutBlock[];
}
export interface ColumnsBlock extends BlockBase {
  blockType: 'columns';
  columns: 2 | 3 | 4;
  gap: 'small' | 'medium' | 'large';
  /** Exactly `columns` child blocks, each a `column`. The editor keeps the count
   *  in sync; the renderer lays them out as a grid (one grid cell per column). */
  children: LayoutBlock[];
}
/** A single column cell inside a `columns` block. Purely structural — no own
 *  config, just its own vertically-stacked children. Only ever nested directly
 *  under a `columns` block (the editor manages columns, you never add one
 *  directly), so it has no add-block-picker entry. */
export interface ColumnBlock extends BlockBase {
  blockType: 'column';
  children: LayoutBlock[];
}

export type LayoutBlock =
  | HeroBlock
  | TextBlock
  | NoteBlock
  | SecretBlock
  | ImageBlock
  | DividerBlock
  | RecommendedBlock
  | CalloutBlock
  | ReferenceBlock
  | EntityRowBlock
  | EntityFeatureBlock
  | GroupBlock
  | ColumnsBlock
  | ColumnBlock;

export type ContainerBlock = GroupBlock | ColumnsBlock | ColumnBlock;
export function isContainer(b: LayoutBlock): b is ContainerBlock {
  return b.blockType === 'group' || b.blockType === 'columns' || b.blockType === 'column';
}

/** Display metadata for the block-type picker. `icon` is a lucide icon NAME —
 *  the editor maps it to a component (the structure tree shows these glyphs for
 *  at-a-glance scanning; they're kept minimal everywhere else). `group` buckets
 *  the add-block menu into Content vs Containers. */
export const BLOCK_TYPE_META: Record<
  LayoutBlockType,
  { label: string; icon: string; description: string; group: 'content' | 'container' | 'cell' }
> = {
  hero:             { label: 'Header',           icon: 'Sparkles',   description: 'A large title + subtitle banner.',          group: 'content' },
  'entity-row':     { label: 'Entity Row',       icon: 'LayoutGrid', description: 'A row/grid of cards — articles, classes, items, system pages…', group: 'content' },
  'entity-feature': { label: 'Featured',         icon: 'Star',       description: 'One large highlighted entity.',             group: 'content' },
  recommended:      { label: 'Recommended',      icon: 'BookMarked', description: "The campaign's recommended article.",       group: 'content' },
  callout:          { label: 'Callout',          icon: 'Megaphone',  description: 'A highlighted box with text + an optional button.', group: 'content' },
  reference:        { label: 'Reference',         icon: 'Link2',      description: 'Embed another entity (article, condition, spell, system entry…) inline, as a card, or as a link.', group: 'content' },
  text:             { label: 'Text',             icon: 'Type',       description: 'Free BBCode prose.',                        group: 'content' },
  note:             { label: 'Storyteller Note', icon: 'Lock',       description: 'A staff-only note — shown only to staff, never to players.', group: 'content' },
  secret:           { label: 'Secret',           icon: 'EyeOff',     description: 'Hidden content revealed only to chosen campaigns (staff always see it).', group: 'content' },
  image:            { label: 'Image',            icon: 'ImageIcon',  description: 'A banner image + optional caption.',        group: 'content' },
  divider:          { label: 'Divider',          icon: 'Minus',      description: 'A line, dots, or spacer.',                  group: 'content' },
  group:            { label: 'Group',            icon: 'Square',     description: 'A titled card that holds other blocks.',    group: 'container' },
  columns:          { label: 'Columns',          icon: 'Columns3',   description: 'Side-by-side columns; fill each one separately.', group: 'container' },
  // `column` is managed by its parent Columns block, never added on its own —
  // group: 'cell' keeps it out of the add-block picker (which shows content +
  // container only).
  column:           { label: 'Column',           icon: 'Square',     description: 'A single column inside a Columns block.',   group: 'cell' },
};

export const LAYOUT_BLOCK_TYPES = Object.keys(BLOCK_TYPE_META) as LayoutBlockType[];

/** The entity kinds offered in the picker, in menu order.
 *  - `mode: 'ref'` → searched via `searchReferences(value, query)`.
 *  - `mode: 'system'` → searched via the system-page search (pages + entries);
 *    results carry the page identifier as their kind.
 *  Backgrounds are intentionally absent — they live in the feats table
 *  (`feat_type='background'`) and aren't a top-level reference kind yet
 *  (see the cleanup TODO in references.ts). A picked Feat can stand in meanwhile. */
export const ENTITY_PICKER_KINDS: { value: string; label: string; mode: 'ref' | 'system' }[] = [
  { value: 'article', label: 'Articles', mode: 'ref' },
  { value: 'class', label: 'Classes', mode: 'ref' },
  { value: 'subclass', label: 'Subclasses', mode: 'ref' },
  { value: 'spell', label: 'Spells', mode: 'ref' },
  { value: 'item', label: 'Items', mode: 'ref' },
  { value: 'feat', label: 'Feats', mode: 'ref' },
  { value: 'condition', label: 'Conditions', mode: 'ref' },
  { value: 'system', label: 'System Pages', mode: 'system' },
];

/** A fresh block of the given type with sensible empty defaults. */
export function makeBlock(type: LayoutBlockType, id: string): LayoutBlock {
  switch (type) {
    case 'hero':
      return { id, blockType: 'hero', title: '', subtitle: '', align: 'center', size: 'normal' };
    case 'text':
      return { id, blockType: 'text', body: '', width: 'normal' };
    case 'note':
      return { id, blockType: 'note', body: '' };
    case 'secret':
      return { id, blockType: 'secret', body: '', eraIds: [], revealedCampaignIds: [] };
    case 'image':
      return { id, blockType: 'image', url: '', caption: '', height: 'medium', link: '' };
    case 'divider':
      return { id, blockType: 'divider', style: 'line' };
    case 'recommended':
      return { id, blockType: 'recommended', title: '', source: 'auto', ref: null, layout: 'side' };
    case 'callout':
      return { id, blockType: 'callout', title: '', body: '', buttonLabel: '', buttonLink: '', style: 'soft' };
    case 'reference':
      return { id, blockType: 'reference', ref: null, display: 'inline' };
    case 'entity-row':
      return { id, blockType: 'entity-row', title: '', showHeading: true, source: 'manual', refs: [], category: '', count: 3, columns: 3, card: 'image', excerpt: true };
    case 'entity-feature':
      return { id, blockType: 'entity-feature', title: '', ref: null, imageSide: 'left', excerpt: true };
    case 'group':
      return { id, blockType: 'group', title: '', showTitle: true, style: 'card', children: [] };
    case 'columns':
      return { id, blockType: 'columns', columns: 2, gap: 'medium',
        children: [makeBlock('column', crypto.randomUUID()), makeBlock('column', crypto.randomUUID())] };
    case 'column':
      return { id, blockType: 'column', children: [] };
  }
}

function asRef(v: any): EntityRef | null {
  // id may legitimately be '' (a page-level system ref), so check kind only.
  if (!v || typeof v !== 'object' || !v.kind) return null;
  const ref: EntityRef = { kind: String(v.kind), id: String(v.id ?? '') };
  if (v.name) ref.name = String(v.name);
  if (v.title) ref.title = String(v.title);
  if (v.description) ref.description = String(v.description);
  if (v.span != null) ref.span = clampSpan(v.span);
  return ref;
}
function asRefArray(v: any): EntityRef[] {
  if (!Array.isArray(v)) return [];
  return v.map(asRef).filter((r): r is EntityRef => r !== null);
}
// All three clamps share one rule: a PRESENT numeric value is clamped to the
// nearest bound; only an absent/non-numeric value falls back to the default.
// (So a stored 99 → max, a stored 0 → min — neither silently resets to default.)
/** entity-row card grid columns: 1..4, default 3. */
const clampCols = (v: any): 1 | 2 | 3 | 4 => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 3;
  return Math.max(1, Math.min(4, n)) as 1 | 2 | 3 | 4;
};
/** Columns-container cells: 2..4, default 2. */
const clampColumnsContainer = (v: any): 2 | 3 | 4 => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 2;
  return Math.max(2, Math.min(4, n)) as 2 | 3 | 4;
};
/** entity-row auto-count: 1..12, default 3. */
const clampCount = (v: any): number => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(1, Math.min(12, n)) : 3;
};

/** Parse one `{ id, block_type, config }` D1 row (or a nested config child) into
 *  a typed block. Recurses into container children. Unknown types → null. */
export function parseLayoutBlock(row: any): LayoutBlock | null {
  const type = String(row?.block_type ?? row?.blockType ?? '') as LayoutBlockType;
  if (!LAYOUT_BLOCK_TYPES.includes(type)) return null;
  let config: any = row?.config ?? row ?? {};
  if (typeof config === 'string') {
    try { config = JSON.parse(config); } catch { config = {}; }
  }
  const id = String(row?.id ?? crypto.randomUUID());
  const s = (v: any, d = '') => (v == null ? d : String(v));
  switch (type) {
    case 'hero':
      return { id, blockType: 'hero', title: s(config.title), subtitle: s(config.subtitle),
        align: config.align === 'left' ? 'left' : config.align === 'right' ? 'right' : 'center',
        size: config.size === 'large' ? 'large' : 'normal' };
    case 'text':
      return { id, blockType: 'text', body: s(config.body),
        width: config.width === 'narrow' ? 'narrow' : config.width === 'wide' ? 'wide' : 'normal' };
    case 'note':
      return { id, blockType: 'note', body: s(config.body) };
    case 'secret': {
      const strArr = (v: any): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
      return { id, blockType: 'secret', body: s(config.body),
        eraIds: strArr(config.eraIds), revealedCampaignIds: strArr(config.revealedCampaignIds) };
    }
    case 'image':
      return { id, blockType: 'image', url: s(config.url), caption: s(config.caption),
        height: config.height === 'small' ? 'small' : config.height === 'large' ? 'large' : 'medium', link: s(config.link) };
    case 'divider':
      return { id, blockType: 'divider', style: config.style === 'dots' ? 'dots' : config.style === 'space' ? 'space' : 'line' };
    case 'recommended':
      return { id, blockType: 'recommended', title: s(config.title),
        source: config.source === 'specific' ? 'specific' : 'auto', ref: asRef(config.ref),
        layout: config.layout === 'stacked' ? 'stacked' : 'side' };
    case 'callout':
      return { id, blockType: 'callout', title: s(config.title), body: s(config.body),
        buttonLabel: s(config.buttonLabel), buttonLink: s(config.buttonLink),
        style: config.style === 'plain' ? 'plain' : 'soft' };
    case 'reference':
      return { id, blockType: 'reference', ref: asRef(config.ref),
        display: config.display === 'card' ? 'card' : config.display === 'link' ? 'link' : 'inline' };
    case 'entity-row':
      return { id, blockType: 'entity-row', title: s(config.title), showHeading: config.showHeading !== false,
        source: config.source === 'auto' ? 'auto' : 'manual', refs: asRefArray(config.refs),
        category: s(config.category), count: clampCount(config.count),
        columns: clampCols(config.columns), card: ['image', 'compact', 'list'].includes(config.card) ? config.card : 'image',
        excerpt: config.excerpt !== false };
    case 'entity-feature':
      return { id, blockType: 'entity-feature', title: s(config.title), ref: asRef(config.ref),
        imageSide: config.imageSide === 'right' ? 'right' : 'left', excerpt: config.excerpt !== false };
    case 'group':
      return { id, blockType: 'group', title: s(config.title), showTitle: config.showTitle !== false,
        style: ['card', 'bordered', 'plain'].includes(config.style) ? config.style : 'card',
        children: Array.isArray(config.children) ? config.children.map(parseLayoutBlock).filter(Boolean) as LayoutBlock[] : [] };
    case 'columns': {
      const parsed = Array.isArray(config.children) ? config.children.map(parseLayoutBlock).filter(Boolean) as LayoutBlock[] : [];
      // A columns block holds only `column` cells. Wrap any loose (legacy/flat)
      // child in its own column so older data still renders; ensure ≥2 columns.
      const cols: LayoutBlock[] = parsed.every((c) => c.blockType === 'column')
        ? parsed
        : parsed.map((c) => ({ id: crypto.randomUUID(), blockType: 'column', children: [c] }) as LayoutBlock);
      while (cols.length < 2) cols.push({ id: crypto.randomUUID(), blockType: 'column', children: [] } as LayoutBlock);
      return { id, blockType: 'columns', columns: clampColumnsContainer(cols.length),
        gap: config.gap === 'small' ? 'small' : config.gap === 'large' ? 'large' : 'medium',
        children: cols };
    }
    case 'column':
      return { id, blockType: 'column',
        children: Array.isArray(config.children) ? config.children.map(parseLayoutBlock).filter(Boolean) as LayoutBlock[] : [] };
  }
}

/** Split a typed block into the wire shape the PUT endpoint expects
 *  (`{ id, block_type, config }`). Container children are serialized recursively
 *  into `config.children`. The server assigns root `order` from array index. */
export function serializeLayoutBlock(block: LayoutBlock): { id: string; block_type: LayoutBlockType; config: Record<string, any> } {
  const { id, blockType, ...rest } = block as any;
  const config: Record<string, any> = { ...rest };
  if (Array.isArray(config.children)) {
    config.children = (config.children as LayoutBlock[]).map(serializeLayoutBlock);
  }
  return { id, block_type: blockType, config };
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getSessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Load a surface's blocks (ordered, with nesting) from its GET endpoint. The
 *  endpoint returns `{ blocks: [...] }`; read access is enforced server-side. */
export async function fetchLayoutBlocks(url: string): Promise<LayoutBlock[]> {
  const res = await fetch(url, { headers: await authHeaders() });
  if (!res.ok) return [];
  const body = await res.json().catch(() => ({}));
  const rows: any[] = Array.isArray(body?.blocks) ? body.blocks : [];
  // `filter(Boolean)` (not `!== null`) so an unparseable block — which returns
  // `undefined` from the switch's implicit fall-through — is dropped rather than
  // surviving to crash the renderer. Matches how container children are filtered.
  return rows.map(parseLayoutBlock).filter((b): b is LayoutBlock => Boolean(b));
}

/** Replace a surface's entire layout via its PUT endpoint. Writes are staff-only
 *  (server-enforced). Root order is taken from array position; nesting travels in
 *  config.children. */
export async function saveLayoutBlocks(url: string, blocks: LayoutBlock[]): Promise<void> {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({ blocks: blocks.map(serializeLayoutBlock) }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any)?.error || `Failed to save layout (HTTP ${res.status})`);
  }
}
