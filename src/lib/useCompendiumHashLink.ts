import { useEffect, useRef } from 'react';

/**
 * Shared `#identifier_abbrev` URL-hash deep-link for any compendium
 * browser. Mirrors 5etools' convention (e.g. `#bloodlust_abh`) so
 * a row can be linked-to from anywhere on the web with just a URL.
 *
 * Behavior
 * --------
 * - **Inbound (one-shot)**: once `rows` and `sources` are both
 *   populated, parse `window.location.hash`, split at the LAST `_`
 *   (so identifiers with underscores still resolve correctly),
 *   find the matching row by (sourceAbbrev, identifier or name),
 *   and call `setSelectedId(row.id)`. Runs once per mount via the
 *   `hashAppliedRef` guard so user-initiated selection changes
 *   later don't get clobbered.
 *
 * - **Outbound**: whenever `selectedId` changes (from a row click
 *   OR from the inbound effect above), rewrite the hash via
 *   `history.replaceState`. Using `replaceState` (not pushState)
 *   keeps the back stack clean — row-by-row browsing shouldn't
 *   bury the page in 20 hash-history entries.
 *
 * Lookup
 * ------
 * Matches `<idPart>_<abbrevPart>` in this order:
 *   1. row.identifier === idPart (preferred — stable slug)
 *   2. row.name === idPart       (fallback — handy when a user
 *                                  manually crafts a URL from a name)
 * Both sides lowercased and trimmed. Source abbreviation can be
 * either `abbreviation` or `shortName` on the source row, lowercased
 * for the comparison.
 *
 * Rows whose source is missing or whose abbreviation is empty
 * intentionally don't emit a hash on selection — without an
 * abbreviation half the URL is incomplete and can't be re-parsed.
 *
 * Usage
 * -----
 *   useCompendiumHashLink({
 *     rows: feats,
 *     sources,
 *     sourceById,
 *     selectedId: selectedFeatId,
 *     setSelectedId: setSelectedFeatId,
 *   });
 *
 * The hook is a side-effect; it returns nothing. The browser
 * (FeatList, SpellList, ItemList, FacilitiesList, etc.) just keeps
 * its own selection state — the hook reads + writes the URL hash
 * alongside it.
 */

export interface CompendiumHashLinkRow {
  id: string;
  name?: string;
  identifier?: string;
  /**
   * Source FK. Older list pages haven't been migrated to camelCase
   * row shapes yet (FacilitiesList still reads `row.source_id`
   * directly), so the hook accepts either form and falls back to
   * snake_case when `sourceId` is missing.
   */
  sourceId?: string;
  source_id?: string;
}

export interface CompendiumHashLinkSource {
  id: string;
  abbreviation?: string;
  shortName?: string;
}

export interface UseCompendiumHashLinkOptions<R extends CompendiumHashLinkRow> {
  /** The full row list (post-fetch). Used for matching the inbound hash. */
  rows: R[];
  /**
   * The source list (post-fetch). The hook reads `.length > 0` to
   * know when data is ready for the one-shot inbound parse;
   * `sourceById` is the actual lookup table.
   */
  sources: { id: string }[];
  /** Map of source.id -> source row. Built once by the caller via useMemo. */
  sourceById: Record<string, CompendiumHashLinkSource>;
  /** Currently-selected row id (`''` or `null` when nothing is selected). */
  selectedId: string | null;
  /** Setter the hook calls when an inbound hash matches a row. */
  setSelectedId: (id: string) => void;
}

export function useCompendiumHashLink<R extends CompendiumHashLinkRow>(
  opts: UseCompendiumHashLinkOptions<R>,
): void {
  const { rows, sources, sourceById, selectedId, setSelectedId } = opts;

  // Inbound — runs once per mount, after both row + source data
  // are populated. The ref prevents this from clobbering later
  // user-initiated selection changes (e.g. if the user clicks row
  // B after we landed them on row A from a hash, we don't want a
  // later re-render to "reset" the selection back to A).
  const hashAppliedRef = useRef(false);
  useEffect(() => {
    if (hashAppliedRef.current) return;
    if (!rows.length || !sources.length) return;
    const raw = decodeURIComponent(window.location.hash.replace(/^#/, ''));
    if (!raw) {
      hashAppliedRef.current = true;
      return;
    }
    const lastUnderscore = raw.lastIndexOf('_');
    if (lastUnderscore === -1) {
      hashAppliedRef.current = true;
      return;
    }
    const namePart = raw.slice(0, lastUnderscore).trim().toLowerCase();
    const abbrevPart = raw.slice(lastUnderscore + 1).trim().toLowerCase();
    const match = rows.find((row) => {
      const rec = sourceById[String(row.sourceId ?? row.source_id ?? '')];
      const abbrev = String(rec?.abbreviation || rec?.shortName || '').toLowerCase();
      if (abbrev !== abbrevPart) return false;
      const ident = String(row.identifier ?? '').toLowerCase();
      const name = String(row.name ?? '').toLowerCase();
      return ident === namePart || name === namePart;
    });
    if (match) setSelectedId(match.id);
    hashAppliedRef.current = true;
    // setSelectedId is deliberately omitted from deps: it's a stable
    // setter from the parent's useState. Including it would force the
    // one-shot effect to re-run on every render if the parent
    // recreates the setter ref, defeating the `hashAppliedRef` guard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sources, sourceById]);

  // Outbound — every selection change rewrites the hash. Uses
  // `replaceState` so back-nav stays usable (otherwise every row
  // click would push a new history entry).
  useEffect(() => {
    if (!selectedId) return;
    const row = rows.find((r) => r.id === selectedId);
    if (!row) return;
    const rec = sourceById[String(row.sourceId ?? row.source_id ?? '')];
    const abbrev = String(rec?.abbreviation || rec?.shortName || '').toLowerCase().trim();
    const key = String(row.identifier ?? '').toLowerCase().trim();
    if (!key || !abbrev) return;
    const nextHash = `#${encodeURIComponent(key)}_${abbrev}`;
    if (window.location.hash === nextHash) return;
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${window.location.search}${nextHash}`,
    );
  }, [selectedId, rows, sourceById]);
}
