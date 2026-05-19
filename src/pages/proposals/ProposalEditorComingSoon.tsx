// =============================================================================
// Placeholder page for /proposals/edit/* routes that haven't been
// wired through their proposal-editor wrapper yet.
// =============================================================================
//
// Phase 4.4 introduces the route prefix without filling in all the
// per-entity editors — those land one at a time in Phase 4.5
// (TagsExplorer → SpellRulesEditor → SpellListManager → SpellsEditor →
// UniqueOptionGroupEditor → ClassEditor). Until a given route is
// wired, this placeholder is what a user sees if they navigate
// somewhere off the supported list.
// =============================================================================

import { Link, useLocation } from 'react-router-dom';
import { Construction, ArrowLeft } from 'lucide-react';

export default function ProposalEditorComingSoon() {
  const location = useLocation();
  const path = location.pathname.replace(/^\/proposals\/edit\/?/, '');
  return (
    <div className="max-w-md mx-auto text-center py-20 space-y-4">
      <Construction className="w-10 h-10 mx-auto text-gold/60" />
      <h1 className="text-xl font-bold uppercase tracking-widest text-ink">
        Editor in progress
      </h1>
      <p className="text-sm text-ink/60 leading-relaxed">
        The proposal editor for{' '}
        <code className="text-xs bg-foreground/5 px-1.5 py-0.5 rounded">{path || '(this entity)'}</code>{' '}
        isn't wired through the new flow yet. Phase 4.5 lands each
        editor in turn — your queued workflows pause here until then.
      </p>
      <Link
        to="/my-proposals"
        className="inline-flex items-center gap-1.5 text-sm text-gold underline"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back to My Proposals
      </Link>
    </div>
  );
}
