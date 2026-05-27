import { useEffect, useReducer, useRef } from 'react';

/**
 * Stable session key for editor-body components that should NOT
 * remount when a "save" promotes the row's id from `null` to a
 * freshly-minted uuid.
 *
 * Why it exists
 * -------------
 * FeatsEditor / SpellsEditor (and any future entity editors that
 * follow the same shell pattern) keyed their MarkdownEditor on
 * `editingId || 'new-X'`. That works for switching between two
 * existing entities — the key changes, TipTap remounts, the new
 * value loads cleanly. But when the user creates a fresh entry and
 * saves it, `editingId` transitions `null → newId`. The key
 * changes, TipTap remounts, scroll position resets to the top and
 * undo history is wiped — which feels like data loss even though
 * the save succeeded. That's the "editor jumps back to the top
 * when saving" bug.
 *
 * Behavior
 * --------
 * Returns a string key that:
 *   - Stays the same across a save-promotion (`null → savedId`)
 *     IF the consumer calls `markSaving()` immediately before
 *     the `setEditingId(savedId)` that promotes it. Anything
 *     keyed off `sessionKey` keeps its mounted state.
 *   - Bumps when the consumer's `editingId` changes in any other
 *     way — explicit `setEditingId(null)` from a Reset/+New
 *     button, or `setEditingId(otherId)` from a row switch. In
 *     those cases TipTap should remount so the editor body
 *     reflects the new entry from a clean slate (no leaked undo
 *     history from the previous one).
 *
 * Usage
 * -----
 *   const { sessionKey, markSaving } = useEditorFormSession(editingId);
 *   <MarkdownEditor key={sessionKey} value={...} ... />
 *
 *   // inside handleSave, right before the post-save setEditingId:
 *   markSaving();
 *   if (wasCreate) setEditingId(entryId);
 *
 * The consumer doesn't need to call anything on reset or switch —
 * the useEffect detects those automatically by watching editingId.
 */
export function useEditorFormSession(editingId: string | null | undefined) {
  const [version, bump] = useReducer((n: number) => n + 1, 0);
  const prevIdRef = useRef<string | null>(editingId ?? null);
  const savePromotionRef = useRef(false);

  useEffect(() => {
    const prev = prevIdRef.current;
    const next = editingId ?? null;
    prevIdRef.current = next;

    if (savePromotionRef.current) {
      // The current id change is a save-promotion. Consumed the
      // flag; don't bump the session, so anything keyed on
      // sessionKey stays mounted (scroll + undo + TipTap state
      // all preserved).
      savePromotionRef.current = false;
      return;
    }

    if (prev !== next) {
      bump();
    }
  }, [editingId]);

  return {
    sessionKey: `editor-session-${version}`,
    /** Call immediately before promoting `editingId` post-save. */
    markSaving: () => {
      savePromotionRef.current = true;
    },
  };
}
