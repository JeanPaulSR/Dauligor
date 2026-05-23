/**
 * EntityEditModal — shared Dialog wrapper for entity edit/create flows.
 *
 * Provides:
 *   • The Dialog primitive (mount/portal/Escape/focus-trap/ARIA) from
 *     @base-ui/react via our `Dialog` shim.
 *   • Viewport-relative locked sizing so the modal doesn't reflow as
 *     content (or active sub-tabs) change. Default split is 10vh top
 *     space / 80vh modal / 10vh bottom space; consumers can override
 *     via `topPercent` and `heightPercent`.
 *   • A default minimal title bar (label + close button). If a richer
 *     header is needed (icon tile + name chip + source chip, as in
 *     ProficiencyEntityShell), pass it via `headerSlot` to replace
 *     the default entirely.
 *   • A scrollable body region (`custom-scrollbar`) wrapping the
 *     consumer's form sections.
 *   • A standard footer with optional Delete + Cancel + Save buttons.
 *
 * The component also owns the surrounding `<form>` so consumers don't
 * have to wire onSubmit through a child — pass `onSubmit` directly.
 *
 * Also re-exports `FormSectionHeading`, the gold-uppercase divider
 * used five times inside every form section, so consumers don't
 * duplicate it.
 */

import { type FormEvent, type ReactNode } from 'react';
import { X, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogClose,
  DialogTitle,
  DialogDescription,
} from '../ui/dialog';
import { Button } from '../ui/button';

/**
 * Re-export of the underlying Dialog primitives — consumers using
 * `headerSlot` to render a custom title bar still need DialogTitle /
 * DialogDescription (for accessibility) and may want DialogClose
 * (for the close affordance). Re-exporting here keeps callers'
 * imports tidy: one entry point for everything modal-related.
 */
export { DialogTitle, DialogDescription, DialogClose };

/**
 * Section heading inside an edit modal — gold uppercase tracking
 * with the standard divider rule. Used several times per modal
 * (Identity / Metadata / Description / etc.), so centralised here
 * to keep the visual cadence identical across editors.
 */
export function FormSectionHeading({ children }: { children: ReactNode }) {
  return (
    <div className="section-label text-gold/70 border-b border-gold/10 pb-1">
      {children}
    </div>
  );
}

export interface EntityEditModalProps {
  open: boolean;
  /**
   * Standard controlled-Dialog onOpenChange. The primitive may sync
   * `open=true` internally during focus/animation bookkeeping, so
   * always propagate the requested value — only responding to
   * `false` wedges the popup in a half-closed state.
   */
  onOpenChange: (next: boolean) => void;

  // ── Form ────────────────────────────────────────────────────────────
  onSubmit: (e: FormEvent) => void;

  // ── Header ──────────────────────────────────────────────────────────
  /**
   * Default header label, e.g. `"Editing Condition"` or `"New Skill"`.
   * Ignored when `headerSlot` is provided.
   */
  headerLabel?: string;
  /** For DialogTitle (sr-only). Always required for accessibility. */
  srTitle: string;
  /** For DialogDescription (sr-only). Always required for accessibility. */
  srDescription: string;
  /**
   * Optional richer header. When provided, replaces the default
   * minimal title bar entirely. Consumers should still render their
   * own DialogTitle/DialogDescription (sr-only) inside; the modal
   * does NOT inject them when `headerSlot` is used.
   */
  headerSlot?: ReactNode;

  // ── Body ────────────────────────────────────────────────────────────
  children: ReactNode;

  // ── Footer ──────────────────────────────────────────────────────────
  /** When provided, shows a left-aligned Delete button. Typically wired to a ConfirmDialog. */
  onDelete?: () => void;
  /** Label for the primary submit. Defaults to "Save Changes" if `isEditing`, else "Create". */
  saveLabel?: string;
  /** Disables the Save button (e.g. when the form is in flight or required fields missing). */
  saveDisabled?: boolean;
  /** When true, the save button shows a "Saving…" label and is disabled. */
  saving?: boolean;
  /**
   * When true, the default save label is "Save Changes". When false, "Create".
   * Has no effect if `saveLabel` is provided explicitly.
   */
  isEditing?: boolean;

  // ── Sizing ──────────────────────────────────────────────────────────
  /** Top gap as a viewport-height percentage. Default `10`. */
  topPercent?: number;
  /** Modal height as a viewport-height percentage. Default `80`. */
  heightPercent?: number;
}

export default function EntityEditModal({
  open,
  onOpenChange,
  onSubmit,
  headerLabel,
  srTitle,
  srDescription,
  headerSlot,
  children,
  onDelete,
  saveLabel,
  saveDisabled,
  saving,
  isEditing,
  topPercent = 10,
  heightPercent = 80,
}: EntityEditModalProps) {
  // Conditional render mirrors the same workaround the shell used
  // before extraction: @base-ui keeps the popup mounted across its
  // own close animation, which on this form layout (custom flex +
  // custom DialogClose) was leaving the popup visible after
  // onOpenChange(false) fired. Skipping the unmount animation isn't
  // visible at 100ms anyway.
  if (!open) return null;

  // Sizing math is split between `style` (for the runtime-dynamic
  // percentages — Tailwind's JIT only compiles `top-[…]`/`h-[…]`
  // arbitrary values when they appear as literal strings in source,
  // not interpolated at runtime) and `className` (for the Y-translate
  // override). The split matters: the underlying DialogContent
  // primitive applies `top-1/2 left-1/2 -translate-x-1/2
  // -translate-y-1/2` for centering. Inline `top` overrides
  // `top-1/2`, but the X- and Y-translates compose via shared
  // `--tw-translate-x` / `--tw-translate-y` CSS variables — so to
  // zero the Y-translate (without killing the horizontal centering)
  // we use the Tailwind `translate-y-0` utility, NOT inline
  // `transform: translateY(0)`. Inline `transform` writes a
  // different CSS property than the `translate:` shorthand
  // Tailwind v4 emits, leaving the primitive's
  // `-translate-x-1/2 -translate-y-1/2` intact and visually
  // pushing the modal off the top of the viewport.
  const resolvedSaveLabel =
    saveLabel ?? (isEditing ? 'Save Changes' : 'Create');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        style={{
          top: `max(${topPercent}vh, calc(var(--navbar-height) + 1rem))`,
          height: `${heightPercent}vh`,
        }}
        className="translate-y-0 w-full max-w-3xl sm:max-w-3xl max-h-[calc(100vh-var(--navbar-height)-2rem)] flex flex-col gap-0 p-0 overflow-hidden bg-card text-foreground border-gold/20"
      >
        <form onSubmit={onSubmit} className="flex flex-col min-h-0 flex-1">
          {/* Header — either the consumer's custom slot or the default
              minimal label-and-close bar. The consumer is responsible
              for DialogTitle / DialogDescription wiring when using
              headerSlot; the default path wires them automatically. */}
          {headerSlot ? (
            <header className="dialog-header shrink-0 relative">{headerSlot}</header>
          ) : (
            <header className="dialog-header shrink-0 relative flex items-center gap-3 pr-10">
              <div className="label-text text-gold/70 flex-1">
                {headerLabel}
              </div>
              <DialogTitle className="sr-only">{srTitle}</DialogTitle>
              <DialogDescription className="sr-only">
                {srDescription}
              </DialogDescription>
              <DialogClose
                className="absolute top-3 right-3 text-ink/40 hover:text-ink p-1 rounded hover:bg-ink/5 transition-colors"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </DialogClose>
            </header>
          )}

          {/* Body */}
          <div className="dialog-body custom-scrollbar flex-1 min-h-0 p-4 sm:p-6">
            {children}
          </div>

          {/* Footer — a <div>, not a <footer>, to avoid the
              `body.admin-page-fullscreen footer { display:
              none }` ambient rule (the rule is scoped to that one
              page today, but using <div> here guards future pages
              from quietly hiding the save row). */}
          <div className="dialog-footer shrink-0">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                {onDelete && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={onDelete}
                    className="btn-danger"
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Delete
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onOpenChange(false)}
                  className="muted-text"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="btn-gold-solid px-6"
                  disabled={saveDisabled || saving}
                >
                  {saving ? 'Saving…' : resolvedSaveLabel}
                </Button>
              </div>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
