// Campaign homepage layout — the ordered content blocks a GM arranges to
// build a campaign-specific Home page. When a campaign has at least one block,
// the blocks replace the default Home body for its members; otherwise the
// global default layout shows.
//
// Storage: one row per block in `campaign_home_blocks` (migration 20260529-1700),
// with a JSON `config` whose shape depends on `block_type`. Read/write go through
// the per-route campaigns API (`/api/campaigns/:id/home-blocks`) — reads admit
// any campaign member, writes are staff-only — so no generic-proxy table grant
// is needed.

import { auth } from './firebase';

export type HomeBlockType = 'hero' | 'text' | 'article-row' | 'image' | 'recommended';

interface BlockBase {
  /** Stable id (uuid). Generated client-side when a block is added. */
  id: string;
}

export interface HeroBlock extends BlockBase {
  blockType: 'hero';
  title: string;
  subtitle: string;
}
export interface TextBlock extends BlockBase {
  blockType: 'text';
  /** BBCode body, rendered via BBCodeRenderer. */
  body: string;
}
export interface ArticleRowBlock extends BlockBase {
  blockType: 'article-row';
  title: string;
  columns: 2 | 3;
  /** Ordered lore-article ids; resolved to cards at render time. */
  articleIds: string[];
}
export interface ImageBlock extends BlockBase {
  blockType: 'image';
  url: string;
  caption: string;
}
export interface RecommendedBlock extends BlockBase {
  blockType: 'recommended';
  /** Optional heading override; defaults to "Recommended for <campaign>". */
  title: string;
}

export type HomeBlock =
  | HeroBlock
  | TextBlock
  | ArticleRowBlock
  | ImageBlock
  | RecommendedBlock;

/** Display metadata for the block-type picker in the editor. `icon` is a
 *  lucide icon NAME — the editor maps it to a component (keeps this lib
 *  dependency-free / server-safe to import the type from). */
export const BLOCK_TYPE_META: Record<
  HomeBlockType,
  { label: string; icon: string; description: string }
> = {
  hero: { label: 'Hero', icon: 'Sparkles', description: 'A large title + subtitle banner.' },
  text: { label: 'Text', icon: 'Type', description: 'Free BBCode prose.' },
  'article-row': { label: 'Article Row', icon: 'LayoutGrid', description: 'A row of linked article cards.' },
  image: { label: 'Image', icon: 'ImageIcon', description: 'A full-width image with an optional caption.' },
  recommended: { label: 'Recommended', icon: 'Star', description: "Highlights the campaign's recommended article." },
};

export const HOME_BLOCK_TYPES = Object.keys(BLOCK_TYPE_META) as HomeBlockType[];

/** A fresh block of the given type with sensible empty defaults. */
export function makeBlock(type: HomeBlockType, id: string): HomeBlock {
  switch (type) {
    case 'hero':
      return { id, blockType: 'hero', title: '', subtitle: '' };
    case 'text':
      return { id, blockType: 'text', body: '' };
    case 'article-row':
      return { id, blockType: 'article-row', title: '', columns: 3, articleIds: [] };
    case 'image':
      return { id, blockType: 'image', url: '', caption: '' };
    case 'recommended':
      return { id, blockType: 'recommended', title: '' };
  }
}

/** Parse one `{ id, block_type, order, config }` D1 row into a typed block.
 *  Tolerant of a string or already-parsed `config`. Unknown types are dropped
 *  by the caller (returns null). */
export function parseHomeBlockRow(row: any): HomeBlock | null {
  const type = String(row?.block_type ?? '') as HomeBlockType;
  if (!HOME_BLOCK_TYPES.includes(type)) return null;
  let config: any = row?.config ?? {};
  if (typeof config === 'string') {
    try { config = JSON.parse(config); } catch { config = {}; }
  }
  const id = String(row?.id ?? '');
  switch (type) {
    case 'hero':
      return { id, blockType: 'hero', title: String(config.title ?? ''), subtitle: String(config.subtitle ?? '') };
    case 'text':
      return { id, blockType: 'text', body: String(config.body ?? '') };
    case 'article-row':
      return {
        id, blockType: 'article-row',
        title: String(config.title ?? ''),
        columns: config.columns === 2 ? 2 : 3,
        articleIds: Array.isArray(config.articleIds) ? config.articleIds.map(String) : [],
      };
    case 'image':
      return { id, blockType: 'image', url: String(config.url ?? ''), caption: String(config.caption ?? '') };
    case 'recommended':
      return { id, blockType: 'recommended', title: String(config.title ?? '') };
  }
}

/** Split a typed block into the wire shape the PUT endpoint expects
 *  (`{ id, block_type, config }`; server assigns `order` from array index). */
export function serializeHomeBlock(block: HomeBlock): { id: string; block_type: HomeBlockType; config: Record<string, any> } {
  const { id, blockType, ...rest } = block as any;
  return { id, block_type: blockType, config: rest };
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await auth.currentUser?.getIdToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Load a campaign's homepage blocks (ordered). Any member may read. */
export async function fetchCampaignHomeBlocks(campaignId: string): Promise<HomeBlock[]> {
  const res = await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/home-blocks`, {
    headers: await authHeaders(),
  });
  if (!res.ok) return [];
  const body = await res.json().catch(() => ({}));
  const rows: any[] = Array.isArray(body?.blocks) ? body.blocks : [];
  return rows.map(parseHomeBlockRow).filter((b): b is HomeBlock => b !== null);
}

/** Replace a campaign's entire homepage layout. Staff-only (server-enforced).
 *  Order is taken from array position. */
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
