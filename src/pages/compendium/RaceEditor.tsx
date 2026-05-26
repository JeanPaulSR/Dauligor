import React from 'react';
import FeatsEditor from './FeatsEditor';

/**
 * RaceEditor
 * ──────────
 * Dedicated editor surface for race entries. Races today live in the
 * `feats` table with `feat_type='race'`; the storage shape is
 * identical to feats, so the editor surface is too. This wrapper just
 * threads `scopeFeatType='race'` through to FeatsEditor, which then
 * filters its list / locks the new-entry default / re-labels the
 * shell + back link / forwards `parentContext='race'` to
 * AdvancementManager.
 *
 * When a dedicated `races` table lands later, this wrapper becomes the
 * replacement point — swap FeatsEditor for a races-specific editor and
 * the route + sidebar entry stay untouched.
 */
export default function RaceEditor({ userProfile }: { userProfile: any }) {
  return <FeatsEditor userProfile={userProfile} scopeFeatType="race" />;
}
