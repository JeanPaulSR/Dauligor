import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fetchCollection } from './d1';

/**
 * Resolves the class row's primary key from whatever the current route
 * gave us — either a `:slug` (admin-facing `/compendium/classes/...`)
 * or an `:id` (proposal-facing `/proposals/edit/classes/edit/:id`).
 *
 * The admin route slug shape is `<identifier>_<sourceAbbrev>` (e.g.
 * `sorcerer_phb`), matching the 5etools-style `#identifier_abbrev`
 * convention already shipped by `useCompendiumHashLink` for the
 * single-pane browsers. Orphan classes with no source fall back to
 * the bare `<identifier>` form so they stay editable — once a source
 * is assigned, the slug picks up the abbrev automatically.
 *
 * The proposal route stays on `:id` because CREATE drafts use a
 * synthetic id in `proposed_payload.id` rather than a live `classes`
 * row, and there's no class row to slug-resolve against until the
 * draft lands.
 */
export interface ClassRouteLookup {
  /** Primary key of the matched class, or `undefined` if not yet resolved / not found / CREATE mode. */
  id: string | undefined;
  /** The raw URL slug, when the route is the admin variant. `undefined` on proposal routes. */
  slug: string | undefined;
  /** True while the slug → primary key lookup is in flight. */
  isLoading: boolean;
  /** True when the slug parsed cleanly but no class row matched. */
  notFound: boolean;
}

export function useClassRouteId(): ClassRouteLookup {
  const { slug, id: rawId } = useParams();

  // React Router occasionally hands us literal `"null"` / `"undefined"`
  // strings (e.g. proposal CREATE drafts before the editor populates
  // entity_id). Match the existing guard in ClassEditor.
  const passThroughId = rawId && rawId !== 'null' && rawId !== 'undefined' ? rawId : undefined;

  const [resolved, setResolved] = useState<{
    id: string | undefined;
    isLoading: boolean;
    notFound: boolean;
  }>({
    id: passThroughId,
    isLoading: !!slug,
    notFound: false,
  });

  useEffect(() => {
    // Proposal route: `:id` is the primary key (or a synthetic draft id).
    // Either way, pass it through unchanged — no slug parsing needed.
    if (passThroughId) {
      setResolved({ id: passThroughId, isLoading: false, notFound: false });
      return;
    }
    // No slug and no id (CREATE flow on `/compendium/classes/new` or
    // `/proposals/edit/classes/new`): nothing to resolve.
    if (!slug) {
      setResolved({ id: undefined, isLoading: false, notFound: false });
      return;
    }

    let active = true;
    setResolved({ id: undefined, isLoading: true, notFound: false });

    (async () => {
      const [classes, sources] = await Promise.all([
        fetchCollection<any>('classes'),
        fetchCollection<any>('sources'),
      ]);
      if (!active) return;

      const sourceById = new Map<string, any>(
        sources.map((s: any) => [String(s.id), s])
      );

      const raw = decodeURIComponent(slug);
      const lastUnderscore = raw.lastIndexOf('_');
      let identifierPart: string;
      let abbrevPart: string | null;
      if (lastUnderscore === -1) {
        // Bare identifier — orphan class fallback. Match the first
        // class whose identifier matches, regardless of source.
        identifierPart = raw.toLowerCase().trim();
        abbrevPart = null;
      } else {
        identifierPart = raw.slice(0, lastUnderscore).toLowerCase().trim();
        abbrevPart = raw.slice(lastUnderscore + 1).toLowerCase().trim();
      }

      const match = classes.find((cls: any) => {
        const identifier = String(cls.identifier ?? '').toLowerCase();
        if (identifier !== identifierPart) return false;
        if (abbrevPart === null) return true;
        const src = sourceById.get(String(cls.source_id ?? ''));
        const abbrev = String(src?.abbreviation || src?.shortName || '').toLowerCase();
        return abbrev === abbrevPart;
      });

      if (!active) return;
      setResolved(
        match
          ? { id: match.id, isLoading: false, notFound: false }
          : { id: undefined, isLoading: false, notFound: true }
      );
    })();

    return () => { active = false; };
  }, [slug, passThroughId]);

  return { ...resolved, slug };
}

/**
 * Compose a class URL slug from a class row + the source's abbreviation.
 * Returns `null` when the row lacks an identifier (nothing to link by).
 * When the source abbreviation is missing/blank, falls back to the bare
 * identifier so orphan classes stay reachable — once a source is
 * assigned, the slug picks up the abbrev automatically.
 *
 * The slug separator is `_` (matches 5etools' convention and the
 * existing `useCompendiumHashLink` hash format).
 */
export function buildClassSlug(
  cls: { identifier?: string | null },
  sourceAbbrev?: string | null,
): string | null {
  const identifier = String(cls?.identifier ?? '').toLowerCase().trim();
  if (!identifier) return null;
  const abbrev = String(sourceAbbrev ?? '').toLowerCase().trim();
  return abbrev ? `${identifier}_${abbrev}` : identifier;
}
