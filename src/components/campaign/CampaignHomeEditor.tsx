import { useCallback } from 'react';
import LayoutEditor from '../layout/LayoutEditor';
import LayoutBlocks from '../layout/LayoutBlocks';
import {
  fetchCampaignHomeBlocks, saveCampaignHomeBlocks, defaultHomeBlocks,
} from '../../lib/campaignHome';
import { LAYOUT_BLOCK_TYPES, type LayoutBlock } from '../../lib/layoutBlocks';

// Campaign homepages get every block type except the article-only staff blocks
// (`note` = staff annotation, `secret` = reveal-per-campaign) which have no
// meaning on a player-facing homepage.
const CAMPAIGN_BLOCK_TYPES = LAYOUT_BLOCK_TYPES.filter((t) => t !== 'note' && t !== 'secret');

// A stand-in recommended-article card for the editor's live preview, so the
// `recommended` block shows something representative without resolving the
// campaign's real pick mid-edit.
const PREVIEW_RECO = { id: 'preview', title: 'Recommended article', excerpt: 'Shown here from the campaign’s recommended lore setting.' };

interface Props {
  campaignId: string;
  campaignName?: string;
  /** Fullscreen route mode (see LayoutEditor). */
  fullscreen?: boolean;
  /** Called by the Back button in fullscreen mode. */
  onBack?: () => void;
}

/**
 * Campaign-homepage adapter over the generic {@link LayoutEditor}. Wires the
 * campaign home-blocks endpoints, the seeded default layout, the player-facing
 * preview (LayoutBlocks with the campaign's recommended card + name), and the
 * campaign-specific wording. The editor engine itself is surface-agnostic.
 */
export default function CampaignHomeEditor({ campaignId, campaignName = '', fullscreen = false, onBack }: Props) {
  const load = useCallback(() => fetchCampaignHomeBlocks(campaignId), [campaignId]);
  const save = useCallback((blocks: LayoutBlock[]) => saveCampaignHomeBlocks(campaignId, blocks), [campaignId]);

  return (
    <LayoutEditor
      load={load}
      save={save}
      allowedTypes={CAMPAIGN_BLOCK_TYPES}
      seedDefault={defaultHomeBlocks}
      imageStoragePath="images/campaigns/home"
      paneStorageKey="dauligor:campaignHomeEditor:panes:v1"
      fullscreen={fullscreen}
      onBack={onBack}
      renderPreview={(blocks) => (
        <LayoutBlocks blocks={blocks} recommendedLore={PREVIEW_RECO} campaignName={campaignName || 'this campaign'} />
      )}
      labels={{
        title: 'Homepage Layout',
        titleSuffix: campaignName || undefined,
        description: "Build what players see on this campaign's home page — drag to reorder & nest, fill each block, then save. Delete every block and save to fall back to the default site home.",
        previewLabel: 'Live preview · what players see',
        emptyPreviewTitle: 'No blocks — players see the default home page.',
        emptyPreviewHint: 'Add a block, or save to keep the default',
        saveLabel: 'Save Layout',
        restoreLabel: 'Restore Default',
        backLabel: 'Back to Campaign Editor',
        noun: 'homepage layout',
        seedBanner: (
          <div className="px-3 py-2.5 border border-gold/25 bg-gold/5 shrink-0">
            <p className="text-[12px] text-ink/75 leading-snug">
              This is the <strong className="text-ink">default layout</strong>. Customize the blocks below, then <strong className="text-ink">Save</strong> to make it this campaign's homepage.
            </p>
          </div>
        ),
      }}
    />
  );
}
