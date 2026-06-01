import React from 'react';
import SpeciesBackgroundBrowser from './SpeciesBackgroundBrowser';

/**
 * Public Background browser at /compendium/backgrounds.
 *
 * Backgrounds live in their own `backgrounds` table (migration
 * 20260601-1200). This page — once a "coming soon" stub — now renders
 * the shared SpeciesBackgroundBrowser (search + Source filter + detail
 * pane showing wealth / starting equipment / advancements).
 */
export default function BackgroundsList({ userProfile }: { userProfile: any }) {
  return <SpeciesBackgroundBrowser userProfile={userProfile} kind="background" />;
}
