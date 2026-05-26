import React from 'react';
import FeatsEditor from './FeatsEditor';

/**
 * BackgroundEditor
 * ────────────────
 * Dedicated editor surface for background entries. Backgrounds today
 * live in the `feats` table with `feat_type='background'`; the
 * storage shape is identical to feats, so the editor surface is too.
 * This wrapper threads `scopeFeatType='background'` through to
 * FeatsEditor, which filters the list / locks the new-entry default /
 * re-labels the shell + back link / forwards
 * `parentContext='background'` to AdvancementManager.
 *
 * When a dedicated `backgrounds` table lands later, this wrapper is
 * the replacement point — swap FeatsEditor for a backgrounds-specific
 * editor and the route + sidebar entry stay untouched.
 */
export default function BackgroundEditor({ userProfile }: { userProfile: any }) {
  return <FeatsEditor userProfile={userProfile} scopeFeatType="background" />;
}
