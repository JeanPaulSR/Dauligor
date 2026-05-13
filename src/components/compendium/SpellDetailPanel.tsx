import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { bbcodeToHtml } from '../../lib/bbcode';
import { fetchCollection, fetchDocument } from '../../lib/d1';
import {
  formatActivationLabel,
  formatComponentsLabel,
  formatDurationLabel,
  formatFoundrySpellDescriptionForDisplay,
  formatRangeLabel,
  formatTargetLabel,
  SCHOOL_LABELS,
} from '../../lib/spellImport';
import SpellArtPreview from './SpellArtPreview';
import { fetchClassesForSpell, type ClassMembership } from '../../lib/classSpellLists';

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
};

export default function SpellDetailPanel({ spellId, emptyMessage = 'Select a spell from the list to view its details.' }: Props) {
  const navigate = useNavigate();
  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [tags, setTags] = useState<TagRecord[]>([]);
  const [spellsById, setSpellsById] = useState<Record<string, SpellRecord>>({});
  const [membershipsBySpellId, setMembershipsBySpellId] = useState<Record<string, ClassMembership[]>>({});
  const [loading, setLoading] = useState(false);

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

  // Sources + tags load once. Both are small static foundation data; the d1 cache
  // makes repeated mounts essentially free.
  useEffect(() => {
    let active = true;
    Promise.all([
      fetchCollection<any>('sources', { orderBy: 'name ASC' }),
      fetchCollection<any>('tags', { orderBy: 'name ASC' }),
    ])
      .then(([sourceData, tagData]) => {
        if (!active) return;
        setSources(sourceData);
        setTags(tagData.map((t: any) => ({ id: t.id, name: t.name || '' })));
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
          const mapped: SpellRecord = {
            ...spellData,
            sourceId: spellData.source_id,
            imageUrl: spellData.image_url,
            tagIds: typeof spellData.tags === 'string' ? safeJsonArray(spellData.tags) : (spellData.tags ?? []),
            foundryDocument: typeof spellData.foundry_data === 'string'
              ? { system: JSON.parse(spellData.foundry_data) }
              : { system: null },
            foundryShell: typeof spellData.foundry_data === 'string'
              ? JSON.parse(spellData.foundry_data)
              : (spellData.foundry_data ?? null),
            foundryImport: spellData.foundry_import,
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
      || s.foundryImport?.sourceBook
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

  return (
    <div className="space-y-0">
      <div className="border-b border-gold/10 px-6 py-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="font-serif text-3xl xl:text-4xl font-bold uppercase tracking-tight text-gold">
                {spell.name}
              </h2>
              <span className="text-sm font-bold text-gold/70">{renderSourceAbbreviation(spell)}</span>
              {spell.foundryImport?.sourcePage ? (
                <span className="text-sm text-ink/35">p{spell.foundryImport.sourcePage}</span>
              ) : null}
            </div>
            <p className="font-serif italic text-ink/70">
              {Number(spell.level ?? 0) === 0 ? 'Cantrip' : `Level ${spell.level}`}{' '}
              {SCHOOL_LABELS[String(spell.school ?? '')] || String(spell.school ?? '').toUpperCase()}
            </p>
          </div>
        </div>
      </div>

      <div className="border-b border-gold/10 px-6 py-5">
        <div className="grid gap-6 lg:grid-cols-[126px_minmax(0,1fr)]">
          <SpellArtPreview src={spell.imageUrl} alt={spell.name} size={126} />
          <div className="grid gap-y-3 text-sm text-ink md:grid-cols-2 md:gap-x-8">
            <SpellInfoRow label="Casting Time" value={formatActivationLabel(shell.activation)} />
            <SpellInfoRow label="Range" value={formatRangeLabel(shell.range)} />
            <SpellInfoRow label="Components" value={formatComponentsLabel(Array.from(shell.properties ?? []), shell.materials)} />
            <SpellInfoRow label="Duration" value={formatDurationLabel(shell.duration)} />
            <SpellInfoRow label="Target" value={formatTargetLabel(shell.target)} />
          </div>
        </div>
      </div>

      <div className="space-y-6 px-6 py-5">
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

        <div className="border-t border-gold/10 pt-4 text-sm text-ink/70 space-y-2">
          <div>
            <span className="font-bold text-ink">Source:</span>{' '}
            {renderSourceAbbreviation(spell)}
            {spell.foundryImport?.sourcePage ? `, page ${spell.foundryImport.sourcePage}` : ''}
            {spell.foundryImport?.rules ? ` (${spell.foundryImport.rules})` : ''}
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
