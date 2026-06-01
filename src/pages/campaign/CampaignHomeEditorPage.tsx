import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

import CampaignHomeEditor from '@/components/campaign/CampaignHomeEditor';
import { getSessionToken } from "../../lib/auth";

/**
 * Fullscreen route host for the campaign homepage layout editor
 * (`/campaign/edit/:id/homepage`). Reads the campaign id from the route, fetches
 * just the campaign name for the header, and renders the editor in `fullscreen`
 * mode with a Back button that returns to the campaign editor. Staff-gated
 * (same rule as CampaignEditor).
 */
export default function CampaignHomeEditorPage({ userProfile }: { userProfile: any }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [campaignName, setCampaignName] = useState('');

  const isStaff = userProfile?.role === 'admin' || userProfile?.role === 'co-dm' || userProfile?.role === 'lore-writer';

  useEffect(() => {
    if (!id || !isStaff) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getSessionToken();
        const res = await fetch(`/api/campaigns/${encodeURIComponent(id)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok || cancelled) return;
        const body = await res.json();
        if (!cancelled) setCampaignName(body?.campaign?.name ?? '');
      } catch {
        /* header name is cosmetic — ignore */
      }
    })();
    return () => { cancelled = true; };
  }, [id, isStaff]);

  if (!isStaff) {
    return <div className="text-center py-20 font-serif italic text-ink/60">Access Denied</div>;
  }
  if (!id) {
    return <div className="text-center py-20 font-serif italic text-ink/60">No campaign selected.</div>;
  }

  return (
    <CampaignHomeEditor
      campaignId={id}
      campaignName={campaignName}
      fullscreen
      onBack={() => navigate(`/campaign/edit/${id}`)}
    />
  );
}
