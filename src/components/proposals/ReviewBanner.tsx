// =============================================================================
// ReviewBanner — sticky top-of-editor banner shown when the editor is
// mounted in review mode (URL carries `?review=<proposal_id>`).
// =============================================================================
//
// Renders nothing when there's no active review (the hook returns
// null), so it's safe to drop into every wired editor unconditionally.
//
// The banner surfaces:
//   - The proposal's status (pending / approved / rejected / withdrawn)
//   - When it was submitted (+ reviewed, if applicable)
//   - The rejection reason (when status === 'rejected')
//   - A "Close review" affordance that strips `?review=` from the URL
//     to drop back into normal editing
//
// Rejected proposals get a distinct callout: "edit + resubmit" is the
// expected next step, so the banner nudges the user toward that flow.
// =============================================================================

import { useNavigate, useLocation } from 'react-router-dom';
import { X, Eye, AlertTriangle } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { formatSqliteLocal } from '../../lib/sqliteTimestamps';
import {
  useProposalReview,
  type ProposalReviewStatus,
} from '../../lib/proposalReview';
import { cn } from '../../lib/utils';

const STATUS_COLOR: Record<ProposalReviewStatus, string> = {
  pending: 'border-gold/35 text-gold bg-gold/5',
  approved: 'border-emerald-700/30 text-emerald-700 bg-emerald-700/5',
  rejected: 'border-blood/30 text-blood bg-blood/5',
  withdrawn: 'border-ink/25 text-ink/55 bg-ink/5',
};

export function ReviewBanner() {
  const review = useProposalReview();
  const navigate = useNavigate();
  const location = useLocation();

  if (!review) return null;

  const exitReview = () => {
    const params = new URLSearchParams(location.search);
    params.delete('review');
    const newSearch = params.toString();
    navigate(location.pathname + (newSearch ? `?${newSearch}` : ''), {
      replace: true,
    });
  };

  const isRejected = review.status === 'rejected';

  return (
    <div
      className={cn(
        'rounded border px-4 py-3 space-y-2',
        STATUS_COLOR[review.status],
      )}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          {isRejected ? (
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          ) : (
            <Eye className="w-4 h-4 mt-0.5 flex-shrink-0" />
          )}
          <div className="space-y-1 min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge
                variant="outline"
                className="text-[9px] font-bold uppercase tracking-widest"
              >
                Review mode
              </Badge>
              <Badge
                variant="outline"
                className="text-[9px] font-bold uppercase tracking-widest"
              >
                {review.status}
              </Badge>
              <Badge
                variant="outline"
                className="text-[9px] font-bold uppercase tracking-widest border-ink/25 text-ink/65"
              >
                {review.operation}
              </Badge>
            </div>
            <p className="text-xs leading-relaxed">
              Viewing your submission from{' '}
              <span className="font-semibold">
                {formatSqliteLocal(review.proposedAt)}
              </span>
              {review.reviewedAt && (
                <>
                  {' — '}
                  reviewed {formatSqliteLocal(review.reviewedAt)}
                </>
              )}
              .
              {' '}
              {isRejected
                ? 'You can edit any field and resubmit.'
                : 'The form is read-only; changed fields are highlighted.'}
            </p>
            {review.rejectionReason && (
              <p className="text-xs italic border-l-2 border-blood/40 pl-2 mt-2">
                <span className="font-bold uppercase tracking-widest text-[10px] mr-1">
                  Reason:
                </span>
                {review.rejectionReason}
              </p>
            )}
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={exitReview}
          className="gap-1.5 flex-shrink-0"
        >
          <X className="w-3.5 h-3.5" />
          Close review
        </Button>
      </div>
    </div>
  );
}
