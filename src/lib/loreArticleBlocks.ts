// Lore-article adapter over the generic block-layout engine (`layoutBlocks.ts`).
// Wires the article block endpoints through the generic transport; the block
// model, parse/serialize, editor, and renderer are all shared with the campaign
// homepage. Article block set = the shared set MINUS `recommended` (enforced
// server-side by ALLOWED_ARTICLE_BLOCK_TYPES and client-side by the designer's
// `allowedTypes`).
//
// Storage: one row per ROOT block in `lore_article_blocks` (migration
// 20260604-1300). Reads go through `/api/lore/articles/:id/blocks` (published
// articles readable by anyone; drafts staff-only); writes are wiki-staff only.
// The blocks PUT also refreshes `lore_articles.content` as a BBCode mirror so
// search / excerpts / recommended-card fallbacks keep working.

import { fetchLayoutBlocks, saveLayoutBlocks, type LayoutBlock } from './layoutBlocks';

const blocksUrl = (articleId: string) =>
  `/api/lore/articles/${encodeURIComponent(articleId)}/blocks`;

/** Load an article's body blocks (ordered, with nesting). */
export function fetchLoreArticleBlocks(articleId: string): Promise<LayoutBlock[]> {
  return fetchLayoutBlocks(blocksUrl(articleId));
}

/** Replace an article's entire body layout. Wiki-staff only (server-enforced). */
export function saveLoreArticleBlocks(articleId: string, blocks: LayoutBlock[]): Promise<void> {
  return saveLayoutBlocks(blocksUrl(articleId), blocks);
}
