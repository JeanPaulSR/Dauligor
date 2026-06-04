import React from 'react';
import SpeciesBackgroundBrowser from './SpeciesBackgroundBrowser';

/**
 * Public Species browser at /compendium/races.
 *
 * Species (the 2024 rename of "Race") live in their own `species` table
 * (migration 20260601-1200). This page — once a "coming soon" stub — now
 * renders the shared SpeciesBackgroundBrowser (search + Source/Creature-
 * Type filters + detail pane). The route URL stays `/compendium/races`.
 */
export default function RacesList({ userProfile }: { userProfile: any }) {
  return <SpeciesBackgroundBrowser userProfile={userProfile} kind="species" />;
}
