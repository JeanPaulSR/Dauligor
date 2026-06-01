import React from 'react';
import SpeciesBackgroundEditor from './SpeciesBackgroundEditor';

/**
 * BackgroundEditor
 * ────────────────
 * Mount point for the Background editor at
 * `/compendium/backgrounds/manage`.
 *
 * Backgrounds graduated out of the shared `feats` table into their own
 * `backgrounds` table (migration 20260601-1200). This wrapper — once a
 * thin `<FeatsEditor scopeFeatType="background" />` — now renders the
 * dedicated `SpeciesBackgroundEditor` against that table. The route +
 * sidebar entry stay untouched.
 */
export default function BackgroundEditor({ userProfile }: { userProfile: any }) {
  return <SpeciesBackgroundEditor userProfile={userProfile} kind="background" />;
}
