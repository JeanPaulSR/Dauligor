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
//   1. User clicks "Start Block" → a name+description dialog → POST
//      /api/proposals/bundle creates a row in `proposal_bundles`,
//      returns a server-issued id. The id is stashed here +
//      localStorage; the metadata row is the source of truth.
//   2. Every mutation in any wired editor (useEntityWriter) detects
//      the active block and posts to `/api/proposals` with
//      `is_draft: true` + the active `bundle_id`. The row lands as
//      `status='draft'` in `pending_revisions` and is INVISIBLE to
//      admins.
//   3. User clicks "Submit Block" → `POST /api/proposals/bundle/<id>
//      /submit` atomically flips every draft row in the bundle to
//      `pending`. The metadata row's status flips to `submitted`.
//      Admin queue starts seeing the drafts at this point.
//   4. User clicks "Discard Block" → `DELETE /api/proposals/bundle/
//      <id>` deletes every draft row + the metadata row. Pending /
//      approved / rejected rows in the bundle (impossible while
//      drafting; possible if the block was previously submitted in
//      another session) are left untouched.
//
// Phase 4.1 added the `proposal_bundles` metadata table — blocks
// now have a `name` + `description` editable through `patchActive-
// Block`, and the user's open blocks are listed via `openBlocks`
// for the "pick or create" picker. The active id is still
// persisted to localStorage so the block survives reloads on the
// same browser; the metadata fetches lazily on mount.
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
import { onAuthStateChanged } from 'firebase/auth';

const LS_KEY = 'dauligor:active-block-id';
// The active-block id is persisted PER USER. A global key let one account's
// active block bleed into another account signed in on the same browser
// (they'd see a block they can't open — the server 404s on a non-owned
// bundle). Keying by uid means each account only ever reads/writes its own.
const keyFor = (uid: string | null) => `${LS_KEY}:${uid}`;
function storedBlockId(uid: string | null): string | null {
  if (!uid || typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(keyFor(uid));
  } catch {
    return null;
  }
}

export type DraftRevision = {
  id: string;
  bundle_id: string | null;
  entity_type: string;
  entity_id: string | null;
  operation: 'create' | 'update' | 'delete';
  proposed_payload: Record<string, any> | null;
  notes_from_proposer: string | null;
  proposed_at: string;
  /**
   * Set when this draft was auto-enrolled by the cascade engine
   * (parent-side DELETE triggered this dependent UPDATE/DELETE).
   * Points at the parent revision's id. Surfaces in the block view
   * as "this dependent comes from the parent's delete" + drives the
   * "Handle this dependent" UI.
   */
  cascade_parent_revision_id: string | null;
};

export type ProposalBundle = {
  id: string;
  name: string;
  description: string | null;
  status: 'open' | 'submitted' | 'discarded';
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
};

export type BlockContextValue = {
  /** Active block's bundle id, or null when no block is open. */
  activeBundleId: string | null;
  /** Metadata (name, description, …) for the active block. Null while loading or if absent. */
  activeBundle: ProposalBundle | null;
  /** Current draft revisions in the active block (cached locally). */
  drafts: DraftRevision[];
  /** User's open blocks (status='open'), newest-updated first. For the picker. */
  openBlocks: ProposalBundle[];
  /** True while a network round-trip for drafts/metadata/openBlocks is in flight. */
  loading: boolean;
  /** Start a new block. Returns the server-issued bundle id. Throws if name missing. */
  startBlock: (name: string, description?: string | null) => Promise<string>;
  /** Switch the active block to an existing open one (caller's). Pass null to clear. */
  setActiveBlock: (id: string | null) => void;
  /** Rename / re-describe the active block. No-op if there's no active block. */
  patchActiveBlock: (patch: { name?: string; description?: string | null }) => Promise<void>;
  /** Submit the active block (drafts → pending). Clears local state on success. */
  submitBlock: () => Promise<{ submitted: number }>;
  /** Discard the active block (delete drafts + metadata). Clears local state on success. */
  discardBlock: () => Promise<{ discarded: number }>;
  /** Re-fetch the active block's drafts + metadata from the server. */
  // Returns the freshly-fetched drafts for the active block (not just void)
  // so a caller mid-flush can adopt server truth synchronously instead of
  // waiting on the async React `drafts` state to re-render (R4 fold race).
  refresh: () => Promise<DraftRevision[]>;
  /** Re-fetch the user's open blocks list. */
  refreshOpenBlocks: () => Promise<void>;
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

function hydrateBundle(raw: any): ProposalBundle {
  return {
    id: String(raw.id),
    name: String(raw.name ?? ''),
    description: raw.description ?? null,
    status: (raw.status as ProposalBundle['status']) ?? 'open',
    created_by_user_id: String(raw.created_by_user_id ?? ''),
    created_at: String(raw.created_at ?? ''),
    updated_at: String(raw.updated_at ?? ''),
  };
}

export function BlockProvider({ children }: { children: ReactNode }) {
  // Signed-in user id — drives per-account scoping of the active block.
  const [currentUid, setCurrentUid] = useState<string | null>(
    () => auth.currentUser?.uid ?? null,
  );
  const [activeBundleId, setActiveBundleId] = useState<string | null>(
    () => storedBlockId(auth.currentUser?.uid ?? null),
  );
  const [activeBundle, setActiveBundle] = useState<ProposalBundle | null>(null);
  const [drafts, setDrafts] = useState<DraftRevision[]>([]);
  // Mirror of `drafts` for synchronous reads — `refresh()` returns this on
  // superseded/transient-error paths so a mid-flush caller never adopts a
  // wrongly-cleared set.
  const draftsRef = useRef<DraftRevision[]>([]);
  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);
  const [openBlocks, setOpenBlocks] = useState<ProposalBundle[]>([]);
  const [loading, setLoading] = useState(false);

  // Track the bundle id we last fetched against so race-y refreshes
  // (e.g. user starts a new block before the previous fetch returns)
  // can't clobber state with stale data.
  const lastFetchedIdRef = useRef<string | null>(null);

  const persist = useCallback((id: string | null) => {
    setActiveBundleId(id);
    try {
      const uid = auth.currentUser?.uid ?? null;
      if (!uid) return; // no signed-in user → nothing to persist against
      if (id) window.localStorage.setItem(keyFor(uid), id);
      else window.localStorage.removeItem(keyFor(uid));
    } catch {
      // localStorage failure is non-fatal — block still works in
      // memory; just won't survive reloads.
    }
  }, []);

  // Track auth changes so block state is scoped per account.
  useEffect(() => onAuthStateChanged(auth, (u) => setCurrentUid(u?.uid ?? null)), []);

  // On account switch (incl. the async restore of the signed-in user after
  // mount), drop in-memory block state and load THIS user's persisted active
  // block — never inherit the previous account's. Closes the cross-account
  // block leak when accounts share a browser.
  const lastUidRef = useRef<string | null>(currentUid);
  useEffect(() => {
    if (lastUidRef.current === currentUid) return;
    lastUidRef.current = currentUid;
    setActiveBundleId(storedBlockId(currentUid));
    setActiveBundle(null);
    setDrafts([]);
    setOpenBlocks([]);
  }, [currentUid]);

  const refreshOpenBlocks = useCallback(async () => {
    try {
      const res = await authedFetch('/api/proposals/bundle?status=open');
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          setOpenBlocks([]);
          return;
        }
        throw new Error(`Failed to load open blocks (HTTP ${res.status})`);
      }
      const body = await res.json();
      const list: any[] = Array.isArray(body?.bundles) ? body.bundles : [];
      setOpenBlocks(list.map(hydrateBundle));
    } catch (err) {
      console.error('[BlockProvider] refreshOpenBlocks failed:', err);
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!activeBundleId) {
      setDrafts([]);
      setActiveBundle(null);
      return [];
    }
    setLoading(true);
    const requestedId = activeBundleId;
    lastFetchedIdRef.current = requestedId;
    try {
      // Drafts + metadata in parallel. Both 404-class responses
      // (signed-out, lost permission, block deleted server-side)
      // clear the local block state silently so the UI doesn't get
      // stuck in a "Block active" indicator the user can't act on.
      const [draftsRes, bundleRes] = await Promise.all([
        authedFetch(`/api/proposals?status=draft`),
        authedFetch(`/api/proposals/bundle/${encodeURIComponent(requestedId)}`),
      ]);

      // Bundle metadata: 404 → bundle was deleted server-side (or
      // we're carrying a legacy localStorage id from before Phase
      // 4.1). Clear and bail.
      if (bundleRes.status === 404) {
        persist(null);
        setDrafts([]);
        setActiveBundle(null);
        return [];
      }
      if (!bundleRes.ok) {
        if (bundleRes.status === 401 || bundleRes.status === 403) {
          persist(null);
          setDrafts([]);
          setActiveBundle(null);
          return;
        }
        throw new Error(`Failed to load block metadata (HTTP ${bundleRes.status})`);
      }
      const bundleBody = await bundleRes.json();
      if (lastFetchedIdRef.current !== requestedId) return draftsRef.current;
      setActiveBundle(bundleBody?.bundle ? hydrateBundle(bundleBody.bundle) : null);

      if (!draftsRes.ok) {
        if (draftsRes.status === 401 || draftsRes.status === 403) {
          persist(null);
          setDrafts([]);
          setActiveBundle(null);
          return;
        }
        throw new Error(`Failed to load drafts (HTTP ${draftsRes.status})`);
      }
      const draftsBody = await draftsRes.json();
      const all: any[] = Array.isArray(draftsBody?.proposals)
        ? draftsBody.proposals
        : [];
      // Only keep rows belonging to the active bundle. The endpoint
      // returns every draft the user owns; other bundles are ignored
      // (we treat them as orphans — see comment above the context).
      if (lastFetchedIdRef.current !== requestedId) return draftsRef.current;
      const mapped: DraftRevision[] = all
        .filter((d) => d.bundle_id === requestedId)
        .map((d) => ({
          id: String(d.id),
          bundle_id: d.bundle_id,
          entity_type: String(d.entity_type),
          entity_id: d.entity_id,
          operation: d.operation,
          proposed_payload: d.proposed_payload ?? null,
          notes_from_proposer: d.notes_from_proposer ?? null,
          proposed_at: d.proposed_at,
          cascade_parent_revision_id: d.cascade_parent_revision_id ?? null,
        }));
      setDrafts(mapped);
      return mapped;
    } catch (err) {
      console.error('[BlockProvider] refresh failed:', err);
      return draftsRef.current;
    } finally {
      if (lastFetchedIdRef.current === requestedId) setLoading(false);
    }
  }, [activeBundleId, persist]);

  const startBlock = useCallback(
    async (name: string, description?: string | null): Promise<string> => {
      // The model supports multiple open blocks (one is "active",
      // the rest live in `openBlocks` until the user switches or
      // submits them). So an existing active block is NOT a reason
      // to short-circuit — the user explicitly asked for a new
      // block. The new block becomes active; the previous one
      // stays open in the picker.
      //
      // Earlier this function refused to create when activeBundleId
      // was set, which made the "Start a new block" button on
      // /my-proposals fire its success toast but never actually
      // create anything — silent failure from the user's POV.
      const trimmed = (name ?? '').trim();
      if (!trimmed) {
        throw new Error('Block name is required.');
      }
      const res = await authedFetch('/api/proposals/bundle', {
        method: 'POST',
        body: JSON.stringify({
          name: trimmed,
          description: description ?? null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to create block (HTTP ${res.status})`);
      }
      const body = await res.json();
      const created = body?.bundle ? hydrateBundle(body.bundle) : null;
      if (!created) {
        throw new Error('Server did not return a bundle.');
      }
      persist(created.id);
      setActiveBundle(created);
      setDrafts([]);
      void refreshOpenBlocks();
      return created.id;
    },
    [persist, refreshOpenBlocks],
  );

  const setActiveBlock = useCallback(
    (id: string | null) => {
      persist(id);
      setActiveBundle(null);
      setDrafts([]);
      // refresh() will be invoked by the activeBundleId-dependent
      // useEffect below.
    },
    [persist],
  );

  const patchActiveBlock = useCallback(
    async (patch: { name?: string; description?: string | null }) => {
      if (!activeBundleId) return;
      const res = await authedFetch(
        `/api/proposals/bundle/${encodeURIComponent(activeBundleId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify(patch),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to update block (HTTP ${res.status})`);
      }
      // Refetch metadata so the UI shows the new name immediately.
      await refresh();
      void refreshOpenBlocks();
    },
    [activeBundleId, refresh, refreshOpenBlocks],
  );

  // Pull drafts + bundle metadata on mount + whenever the active
  // block changes. The editor's writer also calls refresh() after a
  // successful draft submit so the count updates without the page
  // having to re-render for any other reason.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Hydrate the open-blocks list once on mount (and after any
  // create/submit/discard via the explicit refreshOpenBlocks calls
  // inside those handlers).
  useEffect(() => {
    void refreshOpenBlocks();
  }, [refreshOpenBlocks]);

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
    setActiveBundle(null);
    void refreshOpenBlocks();
    return { submitted: Number(body.submitted_count) || 0 };
  }, [activeBundleId, persist, refreshOpenBlocks]);

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
    setActiveBundle(null);
    void refreshOpenBlocks();
    return { discarded: Number(body.discarded_count) || 0 };
  }, [activeBundleId, persist, refreshOpenBlocks]);

  const value: BlockContextValue = useMemo(
    () => ({
      activeBundleId,
      activeBundle,
      drafts,
      openBlocks,
      loading,
      startBlock,
      setActiveBlock,
      patchActiveBlock,
      submitBlock,
      discardBlock,
      refresh,
      refreshOpenBlocks,
    }),
    [
      activeBundleId,
      activeBundle,
      drafts,
      openBlocks,
      loading,
      startBlock,
      setActiveBlock,
      patchActiveBlock,
      submitBlock,
      discardBlock,
      refresh,
      refreshOpenBlocks,
    ],
  );

  return <BlockContext.Provider value={value}>{children}</BlockContext.Provider>;
}
