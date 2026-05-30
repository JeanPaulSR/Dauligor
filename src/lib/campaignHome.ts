// Campaign homepage layout — the ordered, nestable content blocks a GM arranges
// to build a campaign-specific Home page. When a campaign has at least one block,
// the blocks replace the default Home body for its members; otherwise the global
// default layout shows.
//
// Storage: one row per ROOT block in `campaign_home_blocks` (migration
// 20260529-1700), with a JSON `config`. Container blocks (group/columns) carry
// their children INSIDE `config.children` — nesting is config-local, only the
// root list uses the `order` column. Read/write go through the per-route
// campaigns API (`/api/campaigns/:id/home-blocks`) — reads admit any campaign
// member, writes are staff-only — so no generic-proxy table grant is needed.

import { auth } from './firebase';

export type HomeBlockType =
  | 'hero'
  | 'text'
  | 'image'
  | 'divider'
  | 'recommended'
  | 'callout'          // a styled call-to-action box (heading + text + optional button)
  | 'entity-row'       // a row/grid of entity cards (articles, classes, items, …)
  | 'entity-feature'   // one large highlighted entity
  | 'group'            // container: a titled card holding children
  | 'columns';         // container: a 2–4 column grid of children

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
   *  card — supersedes the row-level `featureFirst` shortcut, which only widens
   *  the first card. Clamped to the row's column count at render time. */
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
  /** When true (and columns ≥ 2, card ≠ list), the FIRST card spans 2 columns —
   *  the asymmetric "feature + grid" look of the default home (World Primer wide,
   *  then the rest in an even grid). */
  featureFirst?: boolean;
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
export interface GroupBlock extends BlockBase {
  blockType: 'group';
  title: string;
  showTitle: boolean;
  style: 'card' | 'bordered' | 'plain';
  children: HomeBlock[];
}
export interface ColumnsBlock extends BlockBase {
  blockType: 'columns';
  columns: 2 | 3 | 4;
  gap: 'small' | 'medium' | 'large';
  children: HomeBlock[];
}

export type HomeBlock =
  | HeroBlock
  | TextBlock
  | ImageBlock
  | DividerBlock
  | RecommendedBlock
  | CalloutBlock
  | EntityRowBlock
  | EntityFeatureBlock
  | GroupBlock
  | ColumnsBlock;

export type ContainerBlock = GroupBlock | ColumnsBlock;
export function isContainer(b: HomeBlock): b is ContainerBlock {
  return b.blockType === 'group' || b.blockType === 'columns';
}

/** Display metadata for the block-type picker. `icon` is a lucide icon NAME —
 *  the editor maps it to a component (the structure tree shows these glyphs for
 *  at-a-glance scanning; they're kept minimal everywhere else). `group` buckets
 *  the add-block menu into Content vs Containers. */
export const BLOCK_TYPE_META: Record<
  HomeBlockType,
  { label: string; icon: string; description: string; group: 'content' | 'container' }
> = {
  hero:             { label: 'Header',           icon: 'Sparkles',   description: 'A large title + subtitle banner.',          group: 'content' },
  'entity-row':     { label: 'Entity Row',       icon: 'LayoutGrid', description: 'A row/grid of cards — articles, classes, items, system pages…', group: 'content' },
  'entity-feature': { label: 'Featured',         icon: 'Star',       description: 'One large highlighted entity.',             group: 'content' },
  recommended:      { label: 'Recommended',      icon: 'BookMarked', description: "The campaign's recommended article.",       group: 'content' },
  callout:          { label: 'Callout',          icon: 'Megaphone',  description: 'A highlighted box with text + an optional button.', group: 'content' },
  text:             { label: 'Text',             icon: 'Type',       description: 'Free BBCode prose.',                        group: 'content' },
  image:            { label: 'Image',            icon: 'ImageIcon',  description: 'A banner image + optional caption.',        group: 'content' },
  divider:          { label: 'Divider',          icon: 'Minus',      description: 'A line, dots, or spacer.',                  group: 'content' },
  group:            { label: 'Group',            icon: 'Square',     description: 'A titled card that holds other blocks.',    group: 'container' },
  columns:          { label: 'Columns',          icon: 'Columns3',   description: 'A 2–4 column grid; each child is a cell.',   group: 'container' },
};

export const HOME_BLOCK_TYPES = Object.keys(BLOCK_TYPE_META) as HomeBlockType[];

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
export function makeBlock(type: HomeBlockType, id: string): HomeBlock {
  switch (type) {
    case 'hero':
      return { id, blockType: 'hero', title: '', subtitle: '', align: 'center', size: 'normal' };
    case 'text':
      return { id, blockType: 'text', body: '', width: 'normal' };
    case 'image':
      return { id, blockType: 'image', url: '', caption: '', height: 'medium', link: '' };
    case 'divider':
      return { id, blockType: 'divider', style: 'line' };
    case 'recommended':
      return { id, blockType: 'recommended', title: '', source: 'auto', ref: null, layout: 'side' };
    case 'callout':
      return { id, blockType: 'callout', title: '', body: '', buttonLabel: '', buttonLink: '', style: 'soft' };
    case 'entity-row':
      return { id, blockType: 'entity-row', title: '', showHeading: true, source: 'manual', refs: [], category: '', count: 3, columns: 3, card: 'image', excerpt: true, featureFirst: false };
    case 'entity-feature':
      return { id, blockType: 'entity-feature', title: '', ref: null, imageSide: 'left', excerpt: true };
    case 'group':
      return { id, blockType: 'group', title: '', showTitle: true, style: 'card', children: [] };
    case 'columns':
      return { id, blockType: 'columns', columns: 2, gap: 'medium', children: [] };
  }
}

/** The starting layout an editor seeds when a campaign has no saved blocks yet —
 *  the structural skeleton of the default site home. Lets a GM customize the
 *  basic style instead of an empty page. */
export function defaultHomeBlocks(): HomeBlock[] {
  // Faithful to the legacy Home layout (src/pages/core/Home.tsx): the four
  // sections a fresh campaign starts from. The World row is seeded with the same
  // five entries by ARTICLE SLUG; any that don't exist in this world render as a
  // graceful placeholder card (just like the old "(Article not found)" tile), so
  // the GM never has to create fake content to start customizing.
  const hero = makeBlock('hero', crypto.randomUUID()) as HeroBlock;
  hero.title = 'Stories in Dauligor';
  hero.subtitle = '[i]Your GM has made this website to give you easy access to the lore of the setting of Dauligor, and to the homebrew options they allow.[/i]';

  // "The World of Dauligor" — five articles in the asymmetric feature-first grid
  // (World Primer spans 2 cols, then the rest fill an even 3-col grid), exactly
  // like the legacy home.
  const row = makeBlock('entity-row', crypto.randomUUID()) as EntityRowBlock;
  row.title = 'The World of Dauligor';
  row.columns = 3;
  row.featureFirst = true;
  row.refs = [
    { kind: 'article', id: 'world-primer', name: 'World Primer' },
    { kind: 'article', id: 'world-history', name: 'World History' },
    { kind: 'article', id: 'rules', name: 'Rules' },
    { kind: 'article', id: 'divinity', name: 'Divinity' },
    { kind: 'article', id: 'magic', name: 'Magic' },
  ];

  // Character Creation — the styled "work in progress" callout, the same CTA the
  // legacy home shows until creation tools are built.
  const charCallout = makeBlock('callout', crypto.randomUUID()) as CalloutBlock;
  charCallout.title = 'Character Creation';
  charCallout.body = 'Work in progress — character creation tools are still being built. In the meantime, you can browse the available sources.';
  charCallout.buttonLabel = 'Browse Sources';
  charCallout.buttonLink = '/sources';

  const reco = makeBlock('recommended', crypto.randomUUID()) as RecommendedBlock;

  return [hero, row, charCallout, reco];
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
export function parseHomeBlock(row: any): HomeBlock | null {
  const type = String(row?.block_type ?? row?.blockType ?? '') as HomeBlockType;
  if (!HOME_BLOCK_TYPES.includes(type)) return null;
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
    case 'image':
      return { id, blockType: 'image', url: s(config.url), caption: s(config.caption),
        height: config.height === 'small' ? 'small' : config.height === 'large' ? 'large' : 'medium', link: s(config.link) };
    case 'divider':
      return { id, blockType: 'divider', style: config.style === 'dots' ? 'dots' : config.style === 'space' ? 'space' : 'line' };
    case 'recommended':
      return { id, blockType: 'recommended', title: s(config.title),
        source: config.source === 'specific' ? 'specific' : 'auto', ref: asRef(config.ref),
        layout: config.layout === 'stacked' ? 'stacked' : 'side' };
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
        children: Array.isArray(config.children) ? config.children.map(parseHomeBlock).filter(Boolean) as HomeBlock[] : [] };
    case 'columns':
      return { id, blockType: 'columns', columns: clampColumnsContainer(config.columns),
        gap: config.gap === 'small' ? 'small' : config.gap === 'large' ? 'large' : 'medium',
        children: Array.isArray(config.children) ? config.children.map(parseHomeBlock).filter(Boolean) as HomeBlock[] : [] };
  }
}

/** Split a typed block into the wire shape the PUT endpoint expects
 *  (`{ id, block_type, config }`). Container children are serialized recursively
 *  into `config.children`. The server assigns root `order` from array index. */
export function serializeHomeBlock(block: HomeBlock): { id: string; block_type: HomeBlockType; config: Record<string, any> } {
  const { id, blockType, ...rest } = block as any;
  const config: Record<string, any> = { ...rest };
  if (Array.isArray(config.children)) {
    config.children = (config.children as HomeBlock[]).map(serializeHomeBlock);
  }
  return { id, block_type: blockType, config };
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await auth.currentUser?.getIdToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Load a campaign's homepage blocks (ordered, with nesting). Any member may read. */
export async function fetchCampaignHomeBlocks(campaignId: string): Promise<HomeBlock[]> {
  const res = await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/home-blocks`, {
    headers: await authHeaders(),
  });
  if (!res.ok) return [];
  const body = await res.json().catch(() => ({}));
  const rows: any[] = Array.isArray(body?.blocks) ? body.blocks : [];
  return rows.map(parseHomeBlock).filter((b): b is HomeBlock => b !== null);
}

/** Replace a campaign's entire homepage layout. Staff-only (server-enforced).
 *  Root order is taken from array position; nesting travels in config.children. */
export async function saveCampaignHomeBlocks(campaignId: string, blocks: HomeBlock[]): Promise<void> {
  const res = await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/home-blocks`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({ blocks: blocks.map(serializeHomeBlock) }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any)?.error || `Failed to save homepage layout (HTTP ${res.status})`);
  }
}
