import React from 'react';
import SpeciesBackgroundEditor from './SpeciesBackgroundEditor';

/**
 * RaceEditor
 * ──────────
 * Mount point for the Species editor at `/compendium/races/manage`.
 *
 * Species (the 2024 rename of "Race") graduated out of the shared
 * `feats` table into its own `species` table (migration 20260601-1200).
 * This wrapper — once a thin `<FeatsEditor scopeFeatType="race" />` —
 * now renders the dedicated `SpeciesBackgroundEditor` against that
 * table. The route + sidebar entry stay on `/compendium/races` so
 * existing links keep working; only the UI labels say "Species".
 */
export default function RaceEditor({ userProfile }: { userProfile: any }) {
  return <SpeciesBackgroundEditor userProfile={userProfile} kind="species" />;
}
