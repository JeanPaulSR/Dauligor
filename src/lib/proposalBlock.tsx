// =============================================================================
// Submission Block (draft bundle) context
// =============================================================================
//
// Content-creators often want to bundle many edits into one proposal —
// e.g. a tag taxonomy overhaul that creates 5 tags, renames 3, and
// deletes 2. Sending each one individually clutters the admin queue
// and admins can't approve the set atomically.
//
// The Block UX:
//   1. User clicks "Start Block" → a fresh `bundle_id` is generated
//      client-side and stashed here + localStorage.
//   2. Every mutation in any wired editor (useEntityWriter) detects
//      the active block and posts to `/api/proposals` with
//      `is_draft: true` + the active `bundle_id`. The row lands as
//      `status='draft'` in `pending_revisions` and is INVISIBLE to
//      admins.
//   3. User clicks "Submit Block" → `POST /api/proposals/bundle/<id>
//      /submit` atomically flips every draft row in the bundle to
//      `pending`. Admin queue starts seeing them at this point.
//   4. User clicks "Discard Block" → `DELETE /api/proposals/bundle/
//      <id>` deletes every draft row in the bundle. Pending /
//      approved / rejected rows in the bundle (impossible while
//      drafting; possible if the block was previously submitted in
//      another session) are left untouched.
//
// Active bundle id is persisted to localStorage so the block survives
// page reloads on the same browser. The server is the source of
// truth for what's IN the block — context fetches draft rows for
// the active bundle on mount and caches them locally so the navbar
// indicator + Drafts tab can render without a refetch per render.
// =============================================================================

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { auth } from './firebase';

const LS_KEY = 'dauligor:active-block-id';

export type DraftRevision = {
  id: string;
  bundle_id: string | null;
  entity_type: string;
  entity_id: string | null;
  operation: 'create' | 'update' | 'delete';
  proposed_payload: Record<string, any> | null;
  notes_from_proposer: string | null;
  proposed_at: string;
};

export type BlockContextValue = {
  /** Active block's bundle id, or null when no block is open. */
  activeBundleId: string | null;
  /** Current draft revisions in the active block (cached locally). */
  drafts: DraftRevision[];
  /** True while the network round-trip for `refresh` is in flight. */
  loading: boolean;
  /** Start a new block. Idempotent if one's already open. */
  startBlock: () => string;
  /** Submit the active block (drafts → pending). Clears local state on success. */
  submitBlock: () => Promise<{ submitted: number }>;
  /** Discard the active block (delete drafts). Clears local state on success. */
  discardBlock: () => Promise<{ discarded: number }>;
  /** Re-fetch the active block's drafts from the server. */
  refresh: () => Promise<void>;
};

const BlockContext = createContext<BlockContextValue | null>(null);

export function useBlock(): BlockContextValue {
  const ctx = useContext(BlockContext);
  if (!ctx) {
    throw new Error('useBlock must be used inside <BlockProvider>.');
  }
  return ctx;
}

async function authedFetch(input: string, init?: RequestInit): Promise<Response> {
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new Error('Not signed in.');
  return fetch(input, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
  });
}

export function BlockProvider({ children }: { children: ReactNode }) {
  const [activeBundleId, setActiveBundleId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      return window.localStorage.getItem(LS_KEY);
    } catch {
      return null;
    }
  });
  const [drafts, setDrafts] = useState<DraftRevision[]>([]);
  const [loading, setLoading] = useState(false);

  // Track the bundle id we last fetched against so race-y refreshes
  // (e.g. user starts a new block before the previous fetch returns)
  // can't clobber state with stale data.
  const lastFetchedIdRef = useRef<string | null>(null);

  const persist = useCallback((id: string | null) => {
    setActiveBundleId(id);
    try {
      if (id) window.localStorage.setItem(LS_KEY, id);
      else window.localStorage.removeItem(LS_KEY);
    } catch {
      // localStorage failure is non-fatal — block still works in
      // memory; just won't survive reloads.
    }
  }, []);

  const startBlock = useCallback(() => {
    if (activeBundleId) return activeBundleId;
    const id = `bundle-${crypto.randomUUID()}`;
    persist(id);
    setDrafts([]);
    return id;
  }, [activeBundleId, persist]);

  const refresh = useCallback(async () => {
    if (!activeBundleId) {
      setDrafts([]);
      return;
    }
    setLoading(true);
    const requestedId = activeBundleId;
    lastFetchedIdRef.current = requestedId;
    try {
      const url = new URL('/api/proposals', window.location.origin);
      url.searchParams.set('status', 'draft');
      const res = await authedFetch(url.pathname + url.search);
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          // User logged out or lost permission — clear local block
          // state silently so the UI doesn't get stuck in a "Block
          // active" indicator they can't act on.
          persist(null);
          setDrafts([]);
          return;
        }
        throw new Error(`Failed to load drafts (HTTP ${res.status})`);
      }
      const body = await res.json();
      const all: any[] = Array.isArray(body?.proposals) ? body.proposals : [];
      // Only keep rows belonging to the active bundle. The endpoint
      // returns every draft the user owns; other bundles are ignored
      // (we treat them as orphans — see comment above the context).
      if (lastFetchedIdRef.current !== requestedId) return;
      setDrafts(
        all.filter((d) => d.bundle_id === requestedId).map((d) => ({
          id: String(d.id),
          bundle_id: d.bundle_id,
          entity_type: String(d.entity_type),
          entity_id: d.entity_id,
          operation: d.operation,
          proposed_payload: d.proposed_payload ?? null,
          notes_from_proposer: d.notes_from_proposer ?? null,
          proposed_at: d.proposed_at,
        })),
      );
    } catch (err) {
      console.error('[BlockProvider] refresh failed:', err);
    } finally {
      if (lastFetchedIdRef.current === requestedId) setLoading(false);
    }
  }, [activeBundleId, persist]);

  // Pull drafts on mount + whenever the active block changes. The
  // editor's writer also calls refresh() after a successful draft
  // submit so the count updates without the page having to re-render
  // for any other reason.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const submitBlock = useCallback(async () => {
    if (!activeBundleId) return { submitted: 0 };
    const res = await authedFetch(
      `/api/proposals/bundle/${encodeURIComponent(activeBundleId)}/submit`,
      { method: 'POST' },
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Failed to submit block (HTTP ${res.status})`);
    }
    const body = await res.json();
    persist(null);
    setDrafts([]);
    return { submitted: Number(body.submitted_count) || 0 };
  }, [activeBundleId, persist]);

  const discardBlock = useCallback(async () => {
    if (!activeBundleId) return { discarded: 0 };
    const res = await authedFetch(
      `/api/proposals/bundle/${encodeURIComponent(activeBundleId)}`,
      { method: 'DELETE' },
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Failed to discard block (HTTP ${res.status})`);
    }
    const body = await res.json();
    persist(null);
    setDrafts([]);
    return { discarded: Number(body.discarded_count) || 0 };
  }, [activeBundleId, persist]);

  const value: BlockContextValue = useMemo(
    () => ({
      activeBundleId,
      drafts,
      loading,
      startBlock,
      submitBlock,
      discardBlock,
      refresh,
    }),
    [activeBundleId, drafts, loading, startBlock, submitBlock, discardBlock, refresh],
  );

  return <BlockContext.Provider value={value}>{children}</BlockContext.Provider>;
}
