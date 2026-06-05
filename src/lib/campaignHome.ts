// Campaign-homepage adapter over the generic block-layout engine
// (`layoutBlocks.ts`). The block model, parse/serialize, and transport now live
// in layoutBlocks; this file holds only what's campaign-specific:
//   - the seeded default homepage layout (`defaultHomeBlocks`)
//   - the campaign home-blocks endpoints, wired through the generic fetch/save.
//
// Storage: one row per ROOT block in `campaign_home_blocks` (migration
// 20260529-1700). Reads/writes go through the per-route campaigns API
// (`/api/campaigns/:id/home-blocks`) — reads admit any campaign member, writes
// are staff-only.

import {
  fetchLayoutBlocks, saveLayoutBlocks, makeBlock,
  type LayoutBlock, type HeroBlock, type EntityRowBlock, type CalloutBlock,
} from './layoutBlocks';

/** The starting layout the editor seeds when a campaign has no saved blocks yet —
 *  the structural skeleton of the default site home. Lets a GM customize the
 *  basic style instead of an empty page. */
export function defaultHomeBlocks(): LayoutBlock[] {
  // Faithful to the legacy Home layout (src/pages/core/Home.tsx): the four
  // sections a fresh campaign starts from. The World row is seeded with the same
  // five entries by ARTICLE SLUG; any that don't exist in this world render as a
  // graceful placeholder card (just like the old "(Article not found)" tile), so
  // the GM never has to create fake content to start customizing.
  const hero = makeBlock('hero', crypto.randomUUID()) as HeroBlock;
  hero.title = 'Stories in Dauligor';
  hero.subtitle = '[i]Your GM has made this website to give you easy access to the lore of the setting of Dauligor, and to the homebrew options they allow.[/i]';

  // "The World of Dauligor" — five articles in the asymmetric grid (World Primer
  // spans 2 cols via its per-card span, then the rest fill an even 3-col grid),
  // exactly like the legacy home. Span is round-tripped through save/load (unlike
  // the removed row-level featureFirst flag, which parse never read back).
  const row = makeBlock('entity-row', crypto.randomUUID()) as EntityRowBlock;
  row.title = 'The World of Dauligor';
  row.columns = 3;
  row.refs = [
    { kind: 'article', id: 'world-primer', name: 'World Primer', span: 2 },
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

  const reco = makeBlock('recommended', crypto.randomUUID());

  return [hero, row, charCallout, reco];
}

const homeBlocksUrl = (campaignId: string) =>
  `/api/campaigns/${encodeURIComponent(campaignId)}/home-blocks`;

/** Load a campaign's homepage blocks (ordered, with nesting). Any member may read. */
export function fetchCampaignHomeBlocks(campaignId: string): Promise<LayoutBlock[]> {
  return fetchLayoutBlocks(homeBlocksUrl(campaignId));
}

/** Replace a campaign's entire homepage layout. Staff-only (server-enforced). */
export function saveCampaignHomeBlocks(campaignId: string, blocks: LayoutBlock[]): Promise<void> {
  return saveLayoutBlocks(homeBlocksUrl(campaignId), blocks);
}
