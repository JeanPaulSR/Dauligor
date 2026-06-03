// =============================================================================
// ProposalAwareEditorHeader
// =============================================================================
//
// The slim section-header used by single-work proposal editors
// (ClassEditor, SubclassEditor, UniqueOptionGroupEditor, plus
// DevelopmentCompendiumManager's section header). Renders one of two
// shapes based on `isProposalMode`:
//
//   - **Proposal mode** — slim header with `Back` link + small inline
//     title. Sits flush under the wrapper's "PROPOSAL EDITOR | <entity>"
//     strip so the form starts tight without a duplicate h1 banner.
//   - **Admin mode** — full h1/h2 title block (rendered via the
//     `adminContent` slot, because the admin variants diverge across
//     editors: ClassEditor uses an h1.h1-title, SubclassEditor uses an
//     h2.h2-title with a parent-class subtitle, UOG uses a custom h1).
//
// This component primarily exists to (a) lock the proposal-mode
// container className string in ONE place — every editor needs the
// exact same `flex items-center justify-between gap-2 pb-2 border-b
// border-gold/15` and drift between them was a real source of bugs —
// and (b) template the Back-button render so the icon + size + variant
// don't get spelled inconsistently.
//
// Right-side action buttons (Save / Create / Delete / etc) vary too
// much to abstract; just pass them as `children`.
//
// See docs/architecture/proposal-editor-pattern.md "Visual chrome that
// diverges in proposal mode" for the bigger picture.
// =============================================================================

import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { Button } from '../ui/button';

export interface ProposalAwareEditorHeaderProps {
  /** Whether the editor is mounted inside a <ProposalEditorWrapper>.
   *  Drives which header variant renders. */
  isProposalMode: boolean;
  /** Destination for the Back link. Compute at the callsite (the right
   *  destination depends on the route — proposal route lands on
   *  /my-proposals or the parent editor; admin route lands on the
   *  catalog page or the parent view). */
  backHref: string;
  /** Text after the chevron icon. Default 'Back'; editors with a
   *  parent context override (e.g. SubclassEditor: 'Back to Wizard'). */
  backLabel?: string;
  /** Plain-text slim title for proposal mode (e.g. "Untitled Class").
   *  Ignored if `proposalTitleNode` is provided. */
  proposalTitle?: string;
  /** Override for the slim title slot — use for editors that need
   *  inline secondary content (e.g. SubclassEditor's "for Wizard" pill). */
  proposalTitleNode?: ReactNode;
  /** Admin-mode title block. Render the h1/h2 + any subtitle here.
   *  Required because the variations are too heterogeneous to slot-prop. */
  adminContent: ReactNode;
  /** Right-side action buttons (Save / Create / Delete / BakeNow /
   *  ReferenceSheetDialog / etc). Render the wrapping flex container
   *  too — this component just slots them after the left side. */
  children?: ReactNode;
  /** Optional override for the outer container className in admin
   *  mode. Default `'section-header'`; SubclassEditor uses a custom
   *  flex container instead. */
  adminContainerClassName?: string;
}

export function ProposalAwareEditorHeader({
  isProposalMode,
  backHref,
  backLabel = 'Back',
  proposalTitle,
  proposalTitleNode,
  adminContent,
  children,
  adminContainerClassName = 'section-header',
}: ProposalAwareEditorHeaderProps) {
  return (
    <div
      className={
        isProposalMode
          ? 'flex items-center justify-between gap-2 pb-2 border-b border-gold/15'
          : adminContainerClassName
      }
    >
      <div className="flex items-center gap-3 min-w-0">
        <Link to={backHref}>
          <Button variant="ghost" size="sm" className="text-gold gap-2 hover:bg-gold/5">
            <ChevronLeft className="w-4 h-4" /> {backLabel}
          </Button>
        </Link>
        {isProposalMode
          ? (proposalTitleNode ?? (
              <span className="text-sm font-bold text-ink truncate">
                {proposalTitle}
              </span>
            ))
          : adminContent}
      </div>
      {children}
    </div>
  );
}
