import React, { ReactNode, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ErrorBoundary from '../../components/ErrorBoundary';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { AlertTriangle, Trash2, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { deleteDocument } from '../../lib/d1';

/**
 * Character-specific error boundary.
 *
 * Wraps the CharacterBuilder render path so a crash from a stale-schema
 * character (legacy columns missing, mismatched progression shape, etc.)
 * lands on a soft fallback instead of taking down the whole page.
 *
 * The fallback shows:
 *   - Caught error message (best-effort)
 *   - Delete button — wipes the row via D1 cascade-delete + navigates
 *     to /characters. The parent `characters` row's FK cascades clean
 *     up character_progression / character_selections /
 *     character_inventory / character_spells / character_proficiencies /
 *     character_spell_loadouts / character_spell_list_extensions.
 *   - Back to list — return to /characters without deleting (lets the
 *     user pick a different character or get the DM involved).
 *
 * Boundaries can't use hooks, so the actual fallback UI is split into
 * `CharacterErrorFallback` (which CAN use hooks) and wired in via the
 * ErrorBoundary's render-prop `fallback` API.
 */
export default function CharacterErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      fallback={(error, reset) => (
        <CharacterErrorFallback error={error} reset={reset} />
      )}
    >
      {children}
    </ErrorBoundary>
  );
}

function CharacterErrorFallback({
  error,
  reset,
}: {
  error: Error | null;
  reset: () => void;
}) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [deleted, setDeleted] = useState(false);

  // Best-effort message extraction. The default ErrorBoundary tries to
  // parse the error as JSON (some D1 errors come through that way); we
  // do the same so the user sees a useful string rather than "[object
  // Object]".
  let errorMessage = 'An unexpected error occurred while loading this character.';
  if (error?.message) {
    try {
      const parsed = JSON.parse(error.message);
      errorMessage = parsed?.error || error.message;
    } catch {
      errorMessage = error.message;
    }
  }

  const handleDelete = async () => {
    if (!id) {
      // /characters/new path — nothing to delete, just bail.
      navigate('/characters');
      return;
    }
    if (!window.confirm('Permanently delete this character? This cannot be undone.')) return;
    setBusy(true);
    try {
      // D1 cascade-delete fires on the `characters` row's FK children
      // (progression / selections / inventory / spells / proficiencies /
      // loadouts / extensions). One DELETE = full cleanup.
      await deleteDocument('characters', id);
      toast.success('Character deleted.');
      setDeleted(true);
      // Small delay so the toast lands before the route flip.
      setTimeout(() => navigate('/characters'), 250);
    } catch (err: any) {
      console.error('[CharacterErrorBoundary] Failed to delete character:', err);
      toast.error(`Couldn't delete character: ${err?.message ?? 'unknown error'}`);
      setBusy(false);
    }
  };

  const handleBack = () => {
    // Clear the boundary state before navigating so the next mount of
    // CharacterBuilder (if the user picks a different character) starts
    // with a clean slate.
    reset();
    navigate('/characters');
  };

  return (
    <div className="min-h-[500px] flex items-center justify-center p-6">
      <Card className="max-w-lg w-full border-blood/20 bg-blood/5 backdrop-blur-sm">
        <CardHeader className="text-center">
          <div className="w-12 h-12 bg-blood/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-6 h-6 text-blood" />
          </div>
          <CardTitle className="text-blood font-serif text-2xl">
            Character failed to load
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3 text-center">
            <p className="text-ink/70 font-serif italic">
              This character was likely created on an older schema. The
              sheet renderer hit a value it didn't expect.
            </p>
            <p className="text-xs text-ink/45">
              You can delete the broken character below, or head back to
              your list and pick a different one.
            </p>
          </div>

          {errorMessage && (
            <div className="text-left bg-black/5 p-3 rounded text-[10px] font-mono text-ink/65 overflow-auto max-h-32 border border-blood/15">
              <div className="text-[8px] font-black uppercase tracking-widest text-blood/60 mb-1">
                Error
              </div>
              <pre className="whitespace-pre-wrap">{errorMessage}</pre>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-2 justify-center pt-2">
            <Button
              onClick={handleBack}
              variant="outline"
              disabled={busy}
              className="border-gold/30 text-gold hover:bg-gold/5 uppercase tracking-widest text-xs font-black gap-2"
            >
              <ArrowLeft className="w-4 h-4" /> Back to Character List
            </Button>
            {id && (
              <Button
                onClick={handleDelete}
                disabled={busy || deleted}
                className="bg-blood hover:bg-blood/90 text-white gap-2 uppercase tracking-widest text-xs font-black"
              >
                <Trash2 className="w-4 h-4" />
                {deleted ? 'Deleted…' : busy ? 'Deleting…' : 'Delete Character'}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
