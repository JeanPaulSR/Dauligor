import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, ChevronDown, ChevronUp, Star, Tag } from 'lucide-react';
import { bbcodeToHtml } from '../../lib/bbcode';
import { cn } from '../../lib/utils';
import { fetchCollection, fetchDocument } from '../../lib/d1';
import {
  parseRequirementTree,
  resolveDetailPrereq,
  type Requirement,
  type RequirementFormatLookup,
} from '../../lib/requirements';
import { StatusEmblem } from '../ui/StatusEmblem';

/**
 * Read-only detail panel mirroring `SpellDetailPanel`'s shape: a
 * self-contained right-side preview that fetches its own data when
 * the `featId` prop changes. Used by the public FeatList page; safe
 * to drop into any other surface that needs a feat preview.
 *
 * Loading is per-feat (cached in component state) so repeated row
 * selection in the list doesn't re-fetch. Empty `featId` shows the
 * empty-state copy.
 */

type SourceRecord = {
  id: string;
  name?: string;
  abbreviation?: string;
  shortName?: string;
  page?: string;
  [key: string]: any;
};

type FeatRecord = {
  id: string;
  name?: string;
  identifier?: string;
  description?: string;
  imageUrl?: string;
  sourceId?: string;
  featType?: string;
  featSubtype?: string;
  sourceType?: string;
  requirements?: string;
  requirementsTree?: Requirement | null;
  repeatable?: boolean;
  tagIds?: string[];
  page?: string;
  [key: string]: any;
};

type TagRecord = {
  id: string;
  name?: string;
  groupId?: string | null;
  [key: string]: any;
};

type Props = {
  featId: string | null;
  emptyMessage?: string;
  // Optional favorite affordance. When both are provided, a star
  // button renders under the source abbreviation in the header.
  // Omit them on read-only surfaces (e.g. the editor's review pane).
  isFavorite?: boolean;
  onToggleFavorite?: (featId: string) => void;
  // Cache-bust signal — increment / change this whenever the feat row
  // has been updated externally (e.g. FeatsEditor's save handler) so
  // the panel re-fetches instead of serving the stale cached entry.
  // Stays optional + nullable so read-only surfaces (FeatList) don't
  // have to wire it.
  cacheBustKey?: number | string;
  /** Pre-loaded raw feat row (snake_case, as stored in D1, or a proposal
   *  draft's proposed_payload — same shape). When provided the panel renders
   *  from it instead of fetching by id — used by the proposal feat editor to
   *  preview an in-block draft, which has no persisted live row. */
  featData?: Record<string, any> | null;
};

// Map a raw feat row (snake_case / draft payload) into the FeatRecord the panel
// renders. Shared by the fetch path and the caller-supplied `featData` path so
// the preview is identical either way.
function mapRawFeatRow(featId: string, data: any): FeatRecord {
  return {
    ...data,
    id: featId,
    sourceId: data?.source_id ?? data?.sourceId,
    imageUrl: data?.image_url ?? data?.imageUrl,
    featType: data?.feat_type ?? data?.featType,
    featSubtype: data?.feat_subtype ?? data?.featSubtype ?? '',
    sourceType: data?.source_type ?? data?.sourceType,
    repeatable: !!(data?.repeatable ?? data?.is_repeatable ?? data?.isRepeatable),
    tagIds: Array.isArray(data?.tags) ? data.tags : (Array.isArray(data?.tagIds) ? data.tagIds : []),
    featCategoryId: data?.feat_category_id ?? data?.featCategoryId ?? '',
    requirementsTree: parseRequirementTree(data?.requirements_tree ?? data?.requirementsTree),
  };
}

export default function FeatDetailPanel({
  featId,
  emptyMessage = 'Select a feat from the list to view its details.',
  isFavorite,
  onToggleFavorite,
  cacheBustKey,
  featData,
}: Props) {
  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [tags, setTags] = useState<TagRecord[]>([]);
  const [tagGroups, setTagGroups] = useState<Array<{ id: string; name: string }>>([]);
  const [featCategories, setFeatCategories] = useState<Array<{ id: string; name: string }>>([]);
  // Per-proficiency-kind slug → name lookups for the prerequisite
  // formatter so "ath" reads as "Athletics" in the panel.
  const [prereqLookup, setPrereqLookup] = useState<RequirementFormatLookup>({});
  const [showTags, setShowTags] = useState(false);
  // Cache entries carry the `cacheBustKey` they were fetched under so
  // a later prop-change can detect a stale entry without us having to
  // wipe the whole map. Editor-driven invalidation lives entirely in
  // the bust key (one prop change in, one refetch out).
  const [featsById, setFeatsById] = useState<
    Record<string, FeatRecord & { __bustKey?: number | string }>
  >({});
  const [loading, setLoading] = useState(false);

  // Sources + tag foundation load once. Small static foundation data;
  // the d1 cache makes repeated mounts essentially free. Tag groups
  // are filtered to those classified as feat-relevant so the Show
  // Tags disclosure doesn't bucket spell-only or world-only groups.
  useEffect(() => {
    let active = true;
    Promise.all([
      fetchCollection<any>('sources', { orderBy: 'name ASC' }),
      fetchCollection<any>('tags', { orderBy: 'name ASC' }),
      fetchCollection<any>('tagGroups', { where: "classifications LIKE '%feat%'" }),
      // Feat categories drive the italic category line under the
      // name. Empty list is the cold-start case — the line just
      // doesn't render.
      fetchCollection<any>('featCategories', { orderBy: '"order", name ASC' }),
      // Proficiency-name collections feed the prereq formatter's
      // slug-resolution lookup (e.g. "ath" → "Athletics" in the
      // italic prerequisite line under the name).
      fetchCollection<any>('skills', { orderBy: 'name ASC' }),
      fetchCollection<any>('tools', { orderBy: 'name ASC' }),
      fetchCollection<any>('weapons', { orderBy: 'name ASC' }),
      fetchCollection<any>('armor', { orderBy: 'name ASC' }),
      fetchCollection<any>('languages', { orderBy: 'name ASC' }),
    ])
      .then(([sourcesData, tagsData, groupsData, categoryData, skillsData, toolsData, weaponsData, armorData, languagesData]) => {
        if (!active) return;
        setSources(sourcesData);
        setTags(tagsData.map((t: any) => ({ ...t, groupId: t.group_id ?? t.groupId ?? null })));
        setTagGroups(groupsData.map((g: any) => ({ id: g.id, name: g.name })));
        setFeatCategories(
          (categoryData || []).map((r: any) => ({ id: String(r.id), name: String(r.name || '') }))
        );
        const byIdent = (rows: any[]) =>
          Object.fromEntries(
            (rows || [])
              .filter((r) => r?.identifier)
              .map((r) => [String(r.identifier), String(r.name || r.identifier)])
          ) as Record<string, string>;
        setPrereqLookup({
          skillNameById: byIdent(skillsData),
          toolNameById: byIdent(toolsData),
          weaponNameById: byIdent(weaponsData),
          armorNameById: byIdent(armorData),
          languageNameById: byIdent(languagesData),
        });
      })
      .catch((err) => console.error('[FeatDetailPanel] failed to load foundation data:', err));
    return () => {
      active = false;
    };
  }, []);

  // Fetch the full feat when the selected ID changes. Cache stays
  // warm across repeated selections of the same row; a `cacheBustKey`
  // change forces a refetch (used by FeatsEditor after save so the
  // preview reflects the just-persisted shape without a page reload).
  useEffect(() => {
    if (!featId) return;
    // Caller supplied the row (proposal draft — no persisted live row) — render
    // from it; skip the fetch.
    if (featData) return;
    const cached = featsById[featId];
    // Cache hit only counts if the entry was fetched under the
    // current bust key — otherwise it's stale and we refetch.
    if (cached && cached.__bustKey === cacheBustKey) return;

    let active = true;
    setLoading(true);
    fetchDocument<any>('feats', featId)
      .then((data) => {
        if (!active || !data) return;
        setFeatsById((prev) => ({
          ...prev,
          [featId]: { ...mapRawFeatRow(featId, data), __bustKey: cacheBustKey },
        }));
      })
      .catch((err) => console.error('[FeatDetailPanel] failed to load feat:', err))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [featId, featsById, cacheBustKey, featData]);

  const sourceById = useMemo(
    () => Object.fromEntries(sources.map((s) => [s.id, s])) as Record<string, SourceRecord>,
    [sources],
  );

  // When the caller supplies a raw row, map it the same way the fetch path does
  // so the preview renders identically without a server round-trip.
  const providedFeat = useMemo<FeatRecord | null>(
    () => (featId && featData ? mapRawFeatRow(featId, featData) : null),
    [featId, featData],
  );

  if (!featId) {
    return <div className="px-8 py-20 text-center text-ink/45">{emptyMessage}</div>;
  }

  const feat = providedFeat || featsById[featId] || null;

  if (loading && !feat) {
    return <div className="px-8 py-20 text-center text-ink/45">Loading feat details…</div>;
  }

  if (!feat) return null;

  const sourceRecord = sourceById[String(feat.sourceId ?? '')];
  const sourceAbbrev =
    sourceRecord?.abbreviation
    || sourceRecord?.shortName
    || sourceRecord?.name
    || '—';

  const descriptionHtml = (() => {
    const raw = String(feat.description || '').trim();
    if (!raw) return '<p class="italic text-ink/40">No description authored yet.</p>';
    // bbcode → HTML — feats author in the same BBCode dialect lore
    // articles and class features use. No Foundry HTML round-trip on
    // feats today since the feats import endpoint hasn't shipped, so
    // we don't have a foundry_data fallback path like spells do.
    return bbcodeToHtml(raw);
  })();

  // Prerequisites resolve through the shared `resolveDetailPrereq`
  // helper so this surface stays in lockstep with the editor's live
  // preview (see lib/requirements.ts). Chain: freeText →
  // formatRequirementShort(tree). The list-only `requirementsShortText`
  // override is intentionally NOT consulted here — the detail surface
  // has space for the full text and authors expect to see the
  // structured / verbose version. Italic, no box — matches the
  // "Feat is presented as a body of text, not a card" UX direction.
  const prereqDisplay = resolveDetailPrereq(
    {
      freeText: feat.requirements,
      tree: feat.requirementsTree ?? null,
    },
    prereqLookup,
  );

  // Feat Category surfaces a single italic line under the name. The
  // category is admin-managed (table populated via /admin/feat-
  // categories); empty when the feat hasn't been assigned a category
  // and the line just doesn't render.
  const categoryLabel = (() => {
    const id = String((feat as any).featCategoryId ?? '');
    if (!id) return '';
    return featCategories.find((c) => c.id === id)?.name || '';
  })();

  // Tag-grouping mirrors SpellDetailPanel exactly so the two
  // disclosures feel identical to the author. Tags assigned to the
  // feat that don't have a feat-classified group land under "Other".
  const tagsForThisFeat = (() => {
    const ids = feat.tagIds || (feat as any).tags || [];
    const idSet = new Set(Array.isArray(ids) ? ids.map(String) : []);
    return tags.filter((t) => idSet.has(t.id));
  })();
  const groupedTags: Array<{ group: { id: string; name: string }; tags: TagRecord[] }> = [];
  const groupBuckets = new Map<string, TagRecord[]>();
  for (const tag of tagsForThisFeat) {
    const gid = (tag.groupId as string) || '__other__';
    if (!groupBuckets.has(gid)) groupBuckets.set(gid, []);
    groupBuckets.get(gid)!.push(tag);
  }
  for (const group of tagGroups) {
    const bucket = groupBuckets.get(group.id);
    if (bucket && bucket.length > 0) {
      groupedTags.push({ group: { id: group.id, name: group.name }, tags: bucket });
      groupBuckets.delete(group.id);
    }
  }
  const otherTags: TagRecord[] = [];
  for (const bucket of groupBuckets.values()) otherTags.push(...bucket);
  if (otherTags.length > 0) {
    groupedTags.push({ group: { id: '__other__', name: 'Other' }, tags: otherTags });
  }

  return (
    // Flex column at full panel height so the Show Tags disclosure
    // can pin itself to the bottom (mt-auto). Mirrors
    // SpellDetailPanel's structure exactly.
    <div className="flex flex-col min-h-full">
      {/* Header: image left, name + italic category + italic
          prerequisites in the middle, source abbreviation + favorite
          stacked on the right. No bordered card, no info-row strip
          — the user-facing detail panel reads as a single body of
          text, not a stat-block. */}
      <div className="border-b border-gold/10 px-6 py-5">
        <div className="flex items-start gap-5">
          <FeatArtPreview src={feat.imageUrl} alt={feat.name || 'Feat'} size={96} />
          <div className="flex-1 min-w-0 space-y-1.5">
            <h2 className="font-serif text-3xl xl:text-4xl font-bold uppercase tracking-tight text-gold leading-tight">
              {feat.name}
            </h2>
            {categoryLabel ? (
              <p className="font-serif italic text-ink/70 text-sm">{categoryLabel}</p>
            ) : null}
            {prereqDisplay ? (
              // Italic prerequisites line. No box / no border / no
              // "character-level gate" subtitle — the italic styling
              // is enough to read this as a precondition.
              <p className="italic text-ink/75 text-sm">
                <span className="font-bold not-italic text-ink/55 mr-1">Prerequisite:</span>
                {prereqDisplay}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col items-end gap-2 shrink-0">
            {/* Source abbreviation top-right. Hover shows full source
                name; click navigates to the source's detail page. */}
            {feat.sourceId ? (
              <Link
                to={`/sources/view/${feat.sourceId}`}
                className="text-sm font-bold text-gold/70 hover:text-gold underline-offset-2 hover:underline transition-colors"
                title={String(sourceRecord?.name || sourceRecord?.shortName || sourceAbbrev)}
              >
                {sourceAbbrev}
                {feat.page ? <span className="text-ink/35 font-normal ml-1">p{feat.page}</span> : null}
              </Link>
            ) : (
              <span className="text-sm font-bold text-gold/70">
                {sourceAbbrev}
                {feat.page ? <span className="text-ink/35 font-normal ml-1">p{feat.page}</span> : null}
              </span>
            )}
            {onToggleFavorite ? (
              <button
                type="button"
                onClick={() => onToggleFavorite(feat.id)}
                className={cn(
                  'shrink-0 inline-flex items-center justify-center h-9 w-9 rounded-full border transition-colors',
                  isFavorite
                    ? 'border-gold/50 bg-gold/15 text-gold hover:bg-gold/25'
                    : 'border-gold/20 text-ink/40 hover:border-gold/40 hover:text-gold'
                )}
                title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                aria-pressed={!!isFavorite}
              >
                <Star className={cn('w-4 h-4', isFavorite ? 'fill-gold/80' : '')} />
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {/* Description fills the body. No bordered card, no
          activities/effects rollup, no bottom source strip — the
          feat description is the whole content. */}
      <div className="px-6 py-5">
        <div
          className="prose max-w-none prose-p:text-ink/90 prose-strong:text-ink prose-em:text-ink/80 prose-li:text-ink/85 prose-headings:text-ink"
          dangerouslySetInnerHTML={{ __html: descriptionHtml }}
        />
      </div>

      {/* Footer pinned to the bottom of the panel via mt-auto. Holds the
          Show Tags disclosure (matching SpellDetailPanel) and — at the very
          bottom — a full source citation, mirroring the species/background
          view pages. */}
      <div className="mt-auto">
        {groupedTags.length > 0 && (
          <div className="px-6 py-4 space-y-3">
            <button
              type="button"
              onClick={() => setShowTags((s) => !s)}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded border border-gold/10 bg-gold/[0.03] hover:bg-gold/[0.07] text-[10px] font-bold uppercase tracking-[0.18em] text-gold/70 transition-colors"
              aria-expanded={showTags}
            >
              <span className="flex items-center gap-2">
                <Tag className="w-3 h-3" />
                {showTags ? 'Hide tags' : 'Show tags'}
                <span className="text-ink/45 normal-case tracking-normal font-normal">
                  ({groupedTags.reduce((sum, g) => sum + g.tags.length, 0)})
                </span>
              </span>
              {showTags ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
            {showTags && (
              <div className="space-y-3">
                {groupedTags.map(({ group, tags: groupTagList }) => (
                  <div key={group.id} className="space-y-1.5">
                    <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-ink/45">
                      {group.name}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {groupTagList.map((t) => (
                        <StatusEmblem key={t.id} tone="neutral" size="md">
                          {t.name || t.id}
                        </StatusEmblem>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Source citation — the entry's book + page, at the very bottom. */}
        <div className="border-t border-gold/10 px-6 py-3 text-[11px] text-ink/55">
          <span className="font-bold uppercase tracking-widest text-[10px] text-gold/70 mr-2">Source</span>
          {feat.sourceId ? (
            <Link
              to={`/sources/view/${feat.sourceId}`}
              className="hover:text-gold underline-offset-2 hover:underline transition-colors"
            >
              {String(sourceRecord?.name || sourceRecord?.shortName || sourceAbbrev || 'Unknown')}
            </Link>
          ) : (
            <span className="italic text-ink/40">Homebrew / unset</span>
          )}
          {feat.page ? <span className="text-ink/45">, p. {feat.page}</span> : null}
        </div>
      </div>
    </div>
  );
}

// Slim image-preview component — mirrors `SpellArtPreview`'s pattern
// (in-JS `Image()` probe + onerror → Lucide glyph fallback). When the
// feat's CDN-stored icon URL 404s (common case: a Foundry-shipped
// Plutonium icon that wasn't uploaded to images.dauligor.com), the
// component swaps to a `BookOpen` glyph rather than rendering a
// broken image. `BookOpen` reads as "feat / training / knowledge" —
// the visual analog to spells' `Wand2`. If a third surface ever
// needs this, extract both this and `SpellArtPreview` to a shared
// `EntityArtPreview` parameterized by fallback icon.
function FeatArtPreview({ src, alt, size }: { src?: string; alt: string; size: number }) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>(() => src ? 'loading' : 'idle');

  useEffect(() => {
    const nextSrc = String(src ?? '').trim();
    if (!nextSrc) {
      setStatus('idle');
      return;
    }

    let cancelled = false;
    const image = new Image();
    setStatus('loading');
    image.onload = () => {
      if (!cancelled) setStatus('loaded');
    };
    image.onerror = () => {
      if (!cancelled) setStatus('error');
    };
    image.src = nextSrc;

    return () => {
      cancelled = true;
    };
  }, [src]);

  const dimensionStyle = { width: size, height: size };
  const showImage = status === 'loaded' && src;

  return (
    <div
      className="relative overflow-hidden rounded-md border border-gold/15 bg-background/30"
      style={dimensionStyle}
    >
      {showImage ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          className="block rounded object-cover"
          style={dimensionStyle}
        />
      ) : (
        <div
          className={cn(
            'flex items-center justify-center rounded bg-background/40 text-ink/30',
          )}
          style={dimensionStyle}
        >
          {status === 'loading' ? (
            <div className="flex flex-col items-center justify-center gap-2">
              <div className="h-8 w-8 rounded-full border-2 border-gold border-t-transparent animate-spin" />
              <span className="text-[9px] uppercase font-bold tracking-widest text-gold/60">Loading</span>
            </div>
          ) : (
            <BookOpen className="h-8 w-8" />
          )}
        </div>
      )}
    </div>
  );
}

