import { useState, useEffect, useMemo } from 'react';
import { auth } from '../../lib/firebase';
import {
  fetchCampaignHomeBlocks,
  defaultHomeBlocks,
  type HomeBlock,
} from '../../lib/campaignHome';
import CampaignHomeBlocks from '../../components/campaign/CampaignHomeBlocks';

/**
 * Home page. Renders entirely through the campaign-homepage block system so that
 * what a GM sees in the layout editor's preview is byte-for-byte what players
 * see here (and what saving produces). When the active campaign has saved blocks
 * they render; otherwise we render `defaultHomeBlocks()` — the exact same default
 * the editor seeds — so the no-blocks home, the editor's seeded default, and a
 * freshly-saved default are all ONE code path. The recommended block is dropped
 * when there's no active campaign (matching the legacy "recommended only for an
 * active campaign" behaviour).
 */
export default function Home({ userProfile }: { userProfile: any }) {
  const [activeCampaign, setActiveCampaign] = useState<any>(null);
  const [recommendedLore, setRecommendedLore] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  // Saved campaign-specific layout (empty = fall back to the default below).
  const [homeBlocks, setHomeBlocks] = useState<HomeBlock[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const idToken = await auth.currentUser?.getIdToken();

        // Active campaign + its recommended lore (per-route endpoints; the lore
        // read enforces draft visibility server-side). Only signed-in users with
        // an active campaign have either.
        if (userProfile?.active_campaign_id) {
          const campaignRes = await fetch(
            `/api/campaigns/${encodeURIComponent(userProfile.active_campaign_id)}`,
            { headers: idToken ? { Authorization: `Bearer ${idToken}` } : {} },
          );
          const campaignData = campaignRes.ok ? (await campaignRes.json())?.campaign : null;

          if (campaignData) {
            setActiveCampaign(campaignData);

            if (campaignData.recommended_lore_id) {
              const loreRes = await fetch(
                `/api/lore/articles/${encodeURIComponent(campaignData.recommended_lore_id)}`,
                { headers: idToken ? { Authorization: `Bearer ${idToken}` } : {} },
              );
              if (loreRes.ok) {
                const loreBody = await loreRes.json();
                // Server returns 404 for a draft the viewer can't see → skip.
                if (loreBody?.article) setRecommendedLore(loreBody.article);
              }
            }

            // Campaign-specific homepage layout. Empty → the default below.
            try {
              const blocks = await fetchCampaignHomeBlocks(campaignData.id);
              setHomeBlocks(blocks);
            } catch (blockErr) {
              console.error('Failed to load campaign home layout:', blockErr);
            }
          }
        }
      } catch (error) {
        console.error('Error fetching home data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [userProfile?.active_campaign_id, userProfile?.id]);

  // The blocks to render: saved layout if present, else the default. For the
  // default with no active campaign, drop the `recommended` block (it has no
  // article to show and the legacy home only showed it for an active campaign).
  // Memoised so the default's fresh uuids stay stable across re-renders.
  const blocksToRender = useMemo<HomeBlock[]>(() => {
    if (homeBlocks.length > 0) return homeBlocks;
    const def = defaultHomeBlocks();
    return activeCampaign ? def : def.filter((b) => b.blockType !== 'recommended');
  }, [homeBlocks, activeCampaign]);

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto py-20 text-center">
        <div className="animate-pulse space-y-8">
          <div className="h-20 bg-gold/5 rounded-xl w-3/4 mx-auto" />
          <div className="grid md:grid-cols-3 gap-8">
            <div className="h-64 bg-gold/5 rounded-xl md:col-span-2" />
            <div className="h-64 bg-gold/5 rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <CampaignHomeBlocks
      blocks={blocksToRender}
      recommendedLore={recommendedLore}
      campaignName={activeCampaign?.name ?? ''}
    />
  );
}
