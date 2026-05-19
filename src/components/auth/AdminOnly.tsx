// =============================================================================
// AdminOnly — page-level guard for admin-only routes.
// =============================================================================
//
// Wraps the editor / admin-tool routes in App.tsx so non-admin users
// see a consistent "Access Denied" page rather than a half-rendered
// editor. Mirrors the in-component pattern used by AdminProficiencies
// / AdminUsers / AdminProposals — extracted because Phase 4 needs the
// guard on the wired-Phase-2c editors (TagsExplorer / SpellRulesEditor
// / SpellListManager) which previously rendered for content-creators
// too. With Phase 4, content-creators reach those editors via
// `/proposals/edit/*` instead, so the admin route is locked.
//
// Preview mode is respected via `effectiveProfile`: an admin who has
// flipped preview-as-user on will be treated as a `user` and blocked
// — that's intentional, since the whole point of preview mode is to
// see what a non-admin sees.
// =============================================================================

import type { ReactNode } from 'react';
import { ShieldOff } from 'lucide-react';

export function AdminOnly({
  userProfile,
  children,
}: {
  userProfile: { role?: string | null } | null | undefined;
  children: ReactNode;
}) {
  if (userProfile?.role !== 'admin') {
    return (
      <div className="max-w-md mx-auto text-center py-20 space-y-3">
        <ShieldOff className="w-10 h-10 mx-auto text-blood/60" />
        <h1 className="text-xl font-bold uppercase tracking-widest text-ink">
          Access Denied
        </h1>
        <p className="text-sm text-ink/60 leading-relaxed">
          This editor is admin-only. If you hold the{' '}
          <code className="text-xs bg-foreground/5 px-1.5 py-0.5 rounded">content-creator</code>{' '}
          permission, you can propose edits through{' '}
          <a href="/my-proposals" className="text-gold underline">My Proposals</a>.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
