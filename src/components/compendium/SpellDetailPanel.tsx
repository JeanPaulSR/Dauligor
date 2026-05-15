import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Star, ChevronDown, ChevronUp, Tag } from 'lucide-react';
import { bbcodeToHtml } from '../../lib/bbcode';
import { fetchCollection, fetchDocument } from '../../lib/d1';
import {
  formatActivationLabel,
  formatComponentsLabel,
  formatDurationLabel,
  formatFoundrySpellDescriptionForDisplay,
  formatRangeLabel,
  SCHOOL_LABELS,
} from '../../lib/spellImport';
import SpellArtPreview from './SpellArtPreview';
import { fetchClassesForSpell, type ClassMembership } from '../../lib/classSpellLists';
import { normalizeTagRow } from '../../lib/tagHierarchy';
import { cn } from '../../lib/utils';

/**
 * Self-contained right-side spell preview pane. Used by both the public SpellList browser
 * and the admin SpellListManager so they render spell details identically. Loads its own
 * data when `spellId` changes; null/empty `spellId` shows the empty state.
 *
 * Internal fetch caches keep repeated selections cheap.
 */
type SourceRecord = {
  id: string;
  name?: string;
  abbreviation?: string;
  shortName?: string;
  [key: string]: any;
};

type SpellRecord = {
  id: string;
  name?: string;
  level?: number;
  school?: string;
  sourceId?: string;
  description?: string;
  imageUrl?: string;
  foundryImport?: Record<string, any>;
  foundryShell?: Record<string, any>;
  foundryDocument?: Record<string, any>;
  requiredTags?: string[];
  prerequisiteText?: string;
  [key: string]: any;
};

type TagRecord = { id: string; name: string };

type Props = {
  spellId: string | null;
  emptyMessage?: string;
  /** Optional: render a star/favorite toggle in the header. Caller
   *  owns the favorited-set state (typically via `useSpellFavorites`)
   *  so the same toggle reflects + drives the favorites pane on the
   *  parent page. Both props together turn the affordance on. */
  isFavorite?: boolean;
  onToggleFavorite?: (spellId: string) => void;
  /** Tightens the header typography for surfaces that share width
   *  with other content (CharacterBuilder spell manager, AddSpellsModal
   *  detail column). The compendium browser uses the default 'normal'
   *  spacing where the panel owns the full reading surface. The
   *  difference is purely the title + subtitle font scale; body / tags
   *  / source rows are unaffected. */
  size?: 'normal' | 'compact';
};

export default function SpellDetailPanel({
  spellId,
  emptyMessage = 'Select a spell from the list to view its details.',
  isFavorite,
  onToggleFavorite,
  size = 'normal',
}: Props) {
  const navigate = useNavigate();
  const [sources, setSources] = useState<SourceRecord[]>([]);
  // Tags carry the group ID so the detail panel can render the spell's
  // tag set grouped by category (one row per tag group with a small
  // header). Loaded via normalizeTagRow so the snake_case `group_id`
  // becomes the camelCase `groupId` the layout reads.
  const [tags, setTags] = useState<Array<TagRecord & { groupId?: string | null }>>([]);
  const [tagGroups, setTagGroups] = useState<Array<{ id: string; name: string }>>([]);
  const [spellsById, setSpellsById] = useState<Record<string, SpellRecord>>({});
  const [membershipsBySpellId, setMembershipsBySpellId] = useState<Record<string, ClassMembership[]>>({});
  const [loading, setLoading] = useState(false);
  // Tags are hidden by default — most readers don't need them inline.
  // The toggle persists across spell selections inside the same
  // session: a user who opts in to tag visibility keeps it for the
  // rest of their browsing. Closing the page resets to hidden.
  const [showTags, setShowTags] = useState(false);

  // Intercept clicks on cross-reference anchors so they SPA-navigate
  // instead of full-page-reloading. Targets only `.ref-link` so external
  // links and `[url]` BBCode anchors keep their default behavior.
  const handleDescriptionClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as HTMLElement).closest?.('a.ref-link') as HTMLAnchorElement | null;
    if (!anchor) return;
    const href = anchor.getAttribute('href') || '';
    if (!href.startsWith('/')) return; // only intercept in-app routes
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return; // let new-tab/new-window through
    event.preventDefault();
    navigate(href);
  }, [navigate]);

  // Sources + tags + tag groups load once. Tag groups feed the
  // category-grouped chip rows in the detail body; tagsByGroup is
  // derived from `tag.groupId`. d1 cache keeps repeat mounts cheap.
  useEffect(() => {
    let active = true;
    Promise.all([
      fetchCollection<any>('sources', { orderBy: 'name ASC' }),
      fetchCollection<any>('tags', { orderBy: 'name ASC' }),
      fetchCollection<any>('tagGroups', { where: "classifications LIKE '%spell%'" }),
    ])
      .then(([sourceData, tagData, tagGroupData]) => {
        if (!active) return;
        setSources(sourceData);
        setTags(tagData.map((t: any) => ({ ...normalizeTagRow(t), name: t.name || '' })));
        setTagGroups(tagGroupData.map((g: any) => ({ id: String(g.id), name: String(g.name || '') })));
      })
      .catch(err => console.error('[SpellDetailPanel] failed to load foundation data:', err));
    return () => { active = false; };
  }, []);

  // Fetch the full spell + its class memberships when the selected ID changes.
  useEffect(() => {
    if (!spellId) return;
    if (spellsById[spellId] && membershipsBySpellId[spellId]) return;

    let active = true;
    setLoading(true);
    Promise.all([
      fetchDocument<any>('spells', spellId),
      fetchClassesForSpell(spellId),
    ])
      .then(([spellData, memberships]) => {
        if (!active) return;
        if (spellData) {
          // `foundry_data` is auto-parsed by d1.ts now (jsonFields list),
          // but tolerate the string case for cache coherence with older
          // sessions. Both `foundryShell` and `foundryDocument.system`
          // are aliases for the same parsed JSON — the system block.
          const parsedFoundryData = typeof spellData.foundry_data === 'string'
            ? (() => { try { return JSON.parse(spellData.foundry_data); } catch { return null; } })()
            : (spellData.foundry_data ?? null);
          const mapped: SpellRecord = {
            ...spellData,
            sourceId: spellData.source_id,
            imageUrl: spellData.image_url,
            tagIds: typeof spellData.tags === 'string' ? safeJsonArray(spellData.tags) : (spellData.tags ?? []),
            foundryDocument: { system: parsedFoundryData },
            foundryShell: parsedFoundryData,
            requiredTags: typeof spellData.required_tags === 'string'
              ? safeJsonArray(spellData.required_tags).map(String)
              : (Array.isArray(spellData.required_tags) ? spellData.required_tags.map(String) : []),
            prerequisiteText: spellData.prerequisite_text || '',
          };
          setSpellsById(prev => ({ ...prev, [spellId]: mapped }));
        }
        setMembershipsBySpellId(prev => ({ ...prev, [spellId]: memberships }));
      })
      .catch(err => console.error('[SpellDetailPanel] failed to load spell:', err))
      .finally(() => { if (active) setLoading(false); });

    return () => { active = false; };
  }, [spellId, spellsById, membershipsBySpellId]);

  const sourceById = useMemo(
    () => Object.fromEntries(sources.map(s => [s.id, s])) as Record<string, SourceRecord>,
    [sources]
  );

  const tagsById = useMemo(
    () => Object.fromEntries(tags.map(t => [t.id, t])) as Record<string, TagRecord>,
    [tags]
  );

  if (!spellId) {
    return <div className="px-8 py-20 text-center text-ink/45">{emptyMessage}</div>;
  }

  const spell = spellsById[spellId] || null;
  const memberships = membershipsBySpellId[spellId];

  if (loading && !spell) {
    return <div className="px-8 py-20 text-center text-ink/45">Loading spell details…</div>;
  }

  if (!spell) return null;

  const renderSourceAbbreviation = (s: SpellRecord) => {
    const sourceRecord = sourceById[String(s.sourceId ?? '')];
    return sourceRecord?.abbreviation
      || sourceRecord?.shortName
      || (s as any).foundryShell?.source?.book
      || '—';
  };

  const getDescriptionHtml = (s: SpellRecord) => {
    // Prefer the BBCode `description` — it's the authoritative source after import
    // (Foundry HTML → BBCode runs on every import) and reflects any in-app edits.
    // Foundry's raw HTML at `foundryDocument.system.description.value` is kept only
    // as a round-trip payload + legacy fallback for rows that predate the BBCode
    // conversion. See docs/features/compendium-spells.md.
    const bbcodeDescription = String(s.description || '').trim();
    if (bbcodeDescription) return formatFoundrySpellDescriptionForDisplay(bbcodeToHtml(bbcodeDescription));
    const rawFoundryHtml = String(s.foundryDocument?.system?.description?.value || '').trim();
    if (rawFoundryHtml) return formatFoundrySpellDescriptionForDisplay(rawFoundryHtml);
    return '';
  };

  const getShell = (s: SpellRecord) => s.foundryShell || s.foundryDocument?.system || {};
  const shell = getShell(spell);

  // Group the spell's tag IDs by their tag-group for the per-category
  // chip rows below. Tags with no group, or whose group isn't in the
  // visible tagGroups list, end up under an "Other" bucket.
  const tagsForThisSpell = (() => {
    const ids = spell.tagIds || (spell as any).tags || [];
    const idSet = new Set(Array.isArray(ids) ? ids.map(String) : []);
    return tags.filter(t => idSet.has(t.id));
  })();
  const groupedTags: Array<{ group: { id: string; name: string }; tags: Array<TagRecord & { groupId?: string | null }> }> = [];
  const groupBuckets = new Map<string, Array<TagRecord & { groupId?: string | null }>>();
  for (const tag of tagsForThisSpell) {
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
  // Anything left over (groups not in our spell-classified list, or
  // tags with no group at all) goes under "Other".
  const otherTags: Array<TagRecord & { groupId?: string | null }> = [];
  for (const bucket of groupBuckets.values()) otherTags.push(...bucket);
  if (otherTags.length > 0) {
    groupedTags.push({ group: { id: '__other__', name: 'Other' }, tags: otherTags });
  }

  return (
    // Flex column at full panel height so the source/tag block can
    // pin itself to the bottom via mt-auto. When the description is
    // short there's empty space between description and sources;
    // when long, the source block sits at the natural end of content
    // and CardContent's overflow-y handles the scroll.
    <div className="flex flex-col min-h-full">
      {/* Header: title + source + level/school + favorite star.
          Hero image now sits inline next to the info rows (see the
          horizontal-stacked block below) rather than under the title
          band, freeing vertical room. */}
      <div className={cn(
        "border-b border-gold/10",
        // Compact tightens the band padding so the smaller title +
        // info rows don't float in a chunky padded surface. Used by
        // the CharacterBuilder spell manager.
        size === "compact" ? "px-4 py-3" : "px-6 py-5",
      )}>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h2
                className={cn(
                  "font-serif font-bold uppercase tracking-tight text-gold",
                  // `compact` uses a noticeably smaller title (xl on
                  // small screens, 2xl on xl+) so the header doesn't
                  // dominate the narrow detail column in the
                  // CharacterBuilder spell manager. `normal` keeps the
                  // splashy compendium-page treatment.
                  size === "compact" ? "text-xl xl:text-2xl" : "text-3xl xl:text-4xl",
                )}
              >
                {spell.name}
              </h2>
              <span className={cn(
                "font-bold text-gold/70",
                size === "compact" ? "text-xs" : "text-sm",
              )}>{renderSourceAbbreviation(spell)}</span>
              {(spell.page || (spell as any).foundryShell?.source?.page) ? (
                <span className={cn(
                  "text-ink/35",
                  size === "compact" ? "text-xs" : "text-sm",
                )}>p{spell.page || (spell as any).foundryShell?.source?.page}</span>
              ) : null}
            </div>
            <p className={cn(
              "font-serif italic text-ink/70",
              size === "compact" && "text-sm",
            )}>
              {Number(spell.level ?? 0) === 0 ? 'Cantrip' : `Level ${spell.level}`}{' '}
              {SCHOOL_LABELS[String(spell.school ?? '')] || String(spell.school ?? '').toUpperCase()}
            </p>
          </div>
          {onToggleFavorite && (
            <button
              type="button"
              onClick={() => onToggleFavorite(spell.id)}
              className={cn(
                'shrink-0 inline-flex items-center justify-center h-9 w-9 rounded-full border transition-colors',
                isFavorite
                  ? 'border-gold/50 bg-gold/15 text-gold hover:bg-gold/25'
                  : 'border-gold/20 text-ink/40 hover:border-gold/40 hover:text-gold'
              )}
              title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
              aria-pressed={isFavorite}
            >
              <Star className={cn('w-4 h-4', isFavorite ? 'fill-gold/80' : '')} />
            </button>
          )}
        </div>
      </div>

      {/* Image + info inline, horizontally stacked. Casting Time, Range,
          Components, Duration sit to the right of the art instead of
          under it. Target intentionally omitted — its semantics are
          inconsistent across imported spells and the AoE info is already
          encoded in Range bucket / shape filter. */}
      <div className={cn(
        "border-b border-gold/10",
        // Compact tightens the band padding so the smaller title +
        // info rows don't float in a chunky padded surface. Used by
        // the CharacterBuilder spell manager.
        size === "compact" ? "px-4 py-3" : "px-6 py-5",
      )}>
        <div className="flex flex-wrap items-start gap-6">
          <SpellArtPreview src={spell.imageUrl} alt={spell.name} size={126} />
          <div className="flex-1 min-w-[260px] grid gap-y-2 gap-x-6 text-sm text-ink grid-cols-1 sm:grid-cols-2">
            <SpellInfoRow label="Casting Time" value={formatActivationLabel(shell.activation)} />
            <SpellInfoRow label="Range" value={formatRangeLabel(shell.range)} />
            <SpellInfoRow label="Components" value={formatComponentsLabel(Array.from(shell.properties ?? []), shell.materials)} />
            <SpellInfoRow label="Duration" value={formatDurationLabel(shell.duration)} />
          </div>
        </div>
      </div>

      {/* Body. flex-1 fills the remaining vertical space inside the
          detail card; inside we group "top content" (description +
          prerequisites) and "bottom content" (source meta + tags
          toggle + tags chip rows). The bottom group uses mt-auto to
          pin to the bottom of the available space — when description
          is short there's empty space between the two groups, when
          long the bottom group sits at the natural end and the
          CardContent scrollbar takes over. */}
      <div className={cn(
        "flex-1 flex flex-col",
        size === "compact" ? "px-4 py-3" : "px-6 py-5",
      )}>
        <div className={size === "compact" ? "space-y-4" : "space-y-6"}>
          <div
            className="prose max-w-none prose-p:text-ink/90 prose-strong:text-ink prose-em:text-ink/80 prose-li:text-ink/85 prose-headings:text-ink"
            onClick={handleDescriptionClick}
            dangerouslySetInnerHTML={{ __html: getDescriptionHtml(spell) || '<p>No description available.</p>' }}
          />

          {(spell.requiredTags?.length || spell.prerequisiteText) ? (
            <div className="border border-blood/30 bg-blood/[0.04] rounded-md px-4 py-3 space-y-2">
              <div className="flex items-baseline gap-2">
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-blood/80">Prerequisites</span>
                <span className="text-[9px] uppercase tracking-widest text-ink/35">character-level gate</span>
              </div>
              {spell.requiredTags?.length ? (
                <div className="text-sm text-ink/85">
                  <span className="text-ink/60">Requires tags:</span>{' '}
                  {spell.requiredTags.map(id => tagsById[id]?.name || id).join(', ')}
                </div>
              ) : null}
              {spell.prerequisiteText ? (
                <div className="text-sm text-ink/85 italic">{spell.prerequisiteText}</div>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Bottom group — pinned to the bottom via mt-auto. pt-6
            keeps a sensible minimum gap from the description when
            content is just long enough to crowd it. */}
        <div className="mt-auto pt-6 space-y-3">
        <div className="border-t border-gold/10 pt-4 text-sm text-ink/70 space-y-2">
          <div>
            <span className="font-bold text-ink">Source:</span>{' '}
            {renderSourceAbbreviation(spell)}
            {(spell.page || (spell as any).foundryShell?.source?.page)
              ? `, page ${spell.page || (spell as any).foundryShell?.source?.page}`
              : ''}
            {(spell as any).foundryShell?.source?.rules
              ? ` (${(spell as any).foundryShell.source.rules})`
              : ''}
          </div>
          {memberships ? (
            memberships.length === 0 ? (
              <div className="text-xs text-ink/40 italic">Not on any class spell list.</div>
            ) : (
              <div>
                <span className="font-bold text-ink">On the spell list for:</span>{' '}
                {memberships.map(m => m.name).join(', ')}
              </div>
            )
          ) : null}
        </div>

        {/* Tags — hidden by default, revealed by a toggle button right
            after the Source block. The button sits visually attached
            to the bottom of the source-meta section so the natural
            reading order is description → prerequisites → sources →
            (optional) tags. One header + chip-row per tag group the
            spell participates in. Read-only (no cycling); the public
            browser is for browsing, not editing. Tags inside the
            "Other" bucket are tags whose group isn't classified as
            a spell tag-group (rare; usually a stale rollover). */}
        {groupedTags.length > 0 && (
          <>
            {/* Tag-visibility toggle. Shows the total tag count so the
                user knows what they're getting before expanding. The
                whole thing is a single full-width button so the click
                target stays generous on touch. */}
            <button
              type="button"
              onClick={() => setShowTags(s => !s)}
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
                      {groupTagList.map(t => (
                        <span
                          key={t.id}
                          className="inline-flex items-center rounded border border-gold/20 bg-gold/5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gold/80"
                        >
                          {t.name}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        </div>
      </div>
    </div>
  );
}

function SpellInfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-gold/70">{label}</div>
      <div className="mt-1 text-sm text-ink/90">{value || '—'}</div>
    </div>
  );
}

function safeJsonArray(raw: string): any[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
