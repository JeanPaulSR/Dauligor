/**
 * WikiPreviewContext
 * 
 * Provides staff users with the ability to preview the wiki as a specific campaign.
 * The selected campaign persists across all navigation within the wiki.
 */
import { createContext, useContext } from 'react';

export interface WikiPreviewCampaign {
  id: string;
  name: string;
  eraId: string | null;
}

export interface WikiViewContext {
  eraId: string | null;
  campaignId: string | null;
  isStaff: boolean;
}

interface WikiPreviewContextType {
  previewCampaign: WikiPreviewCampaign | null;
  setPreviewCampaign: (campaign: WikiPreviewCampaign | null) => void;
}

export const WikiPreviewContext = createContext<WikiPreviewContextType>({
  previewCampaign: null,
  setPreviewCampaign: () => {},
});

export function useWikiPreview() {
  return useContext(WikiPreviewContext);
}
