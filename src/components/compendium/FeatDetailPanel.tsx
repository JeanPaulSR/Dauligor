import React, { useEffect, useMemo, useState } from 'react';
import { bbcodeToHtml } from '../../lib/bbcode';
import { fetchCollection, fetchDocument } from '../../lib/d1';
import {
  parseRequirementTree,
  formatRequirementText,
  type Requirement,
} from '../../lib/requirements';
import { FEAT_TYPE_LABELS, type FeatTypeValue } from '../../lib/featFilters';
import { RECOVERY_PERIOD_OPTIONS, RECOVERY_TYPE_OPTIONS } from './activity/constants';

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
  uses?: { max?: string; spent?: number; recovery?: any[] };
  usesMax?: string;
  usesSpent?: number;
  usesRecovery?: any[];
  activities?: any[];
  effects?: any[];
  page?: string;
  [key: string]: any;
};

type Props = {
  featId: string | null;
  emptyMessage?: string;
};

export default function FeatDetailPanel({
  featId,
  emptyMessage = 'Select a feat from the list to view its details.',
}: Props) {
  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [featsById, setFeatsById] = useState<Record<string, FeatRecord>>({});
  const [loading, setLoading] = useState(false);

  // Sources load once. Small static foundation data; the d1 cache makes
  // repeated mounts essentially free.
  useEffect(() => {
    let active = true;
    fetchCollection<any>('sources', { orderBy: 'name ASC' })
      .then((data) => {
        if (!active) return;
        setSources(data);
      })
      .catch((err) => console.error('[FeatDetailPanel] failed to load sources:', err));
    return () => {
      active = false;
    };
  }, []);

  // Fetch the full feat when the selected ID changes. Cache invalidates
  // on prop change (different featId → new fetch) but stays warm across
  // repeated selections of the same row.
  useEffect(() => {
    if (!featId) return;
    if (featsById[featId]) return;

    let active = true;
    setLoading(true);
    fetchDocument<any>('feats', featId)
      .then((data) => {
        if (!active || !data) return;
        const mapped: FeatRecord = {
          ...data,
          sourceId: data.source_id,
          imageUrl: data.image_url,
          featType: data.feat_type,
          featSubtype: data.feat_subtype || '',
          sourceType: data.source_type,
          repeatable: !!data.repeatable,
          // d1.ts auto-parses `uses_recovery` so it arrives as an
          // array — defend against an older cached payload that may
          // surface it as a string.
          usesRecovery: Array.isArray(data.uses_recovery)
            ? data.uses_recovery
            : typeof data.uses_recovery === 'string'
              ? safeJsonArray(data.uses_recovery)
              : [],
          usesMax: data.uses_max ?? data.usesMax ?? '',
          usesSpent: Number(data.uses_spent ?? data.usesSpent ?? 0) || 0,
          requirementsTree: parseRequirementTree(data.requirements_tree ?? data.requirementsTree),
        };
        setFeatsById((prev) => ({ ...prev, [featId]: mapped }));
      })
      .catch((err) => console.error('[FeatDetailPanel] failed to load feat:', err))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [featId, featsById]);

  const sourceById = useMemo(
    () => Object.fromEntries(sources.map((s) => [s.id, s])) as Record<string, SourceRecord>,
    [sources],
  );

  if (!featId) {
    return <div className="px-8 py-20 text-center text-ink/45">{emptyMessage}</div>;
  }

  const feat = featsById[featId] || null;

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

  const valueLabel = FEAT_TYPE_LABELS[feat.featType as FeatTypeValue] || feat.featType || 'Feat';
  const subtypeRaw = String(feat.featSubtype || '').trim();
  const typeLine = subtypeRaw ? `${valueLabel} · ${subtypeRaw}` : valueLabel;

  const descriptionHtml = (() => {
    const raw = String(feat.description || '').trim();
    if (!raw) return '<p class="italic text-ink/40">No description authored yet.</p>';
    // bbcode → HTML — feats author in the same BBCode dialect lore
    // articles and class features use. No Foundry HTML round-trip on
    // feats today since the feats import endpoint hasn't shipped, so
    // we don't have a foundry_data fallback path like spells do.
    return bbcodeToHtml(raw);
  })();

  const requirementsLine = formatRequirementText(feat.requirementsTree ?? null);
  const recovery = Array.isArray(feat.usesRecovery) ? feat.usesRecovery : [];

  return (
    <div className="space-y-0">
      <div className="border-b border-gold/10 px-6 py-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="font-serif text-3xl xl:text-4xl font-bold uppercase tracking-tight text-gold">
                {feat.name}
              </h2>
              <span className="text-sm font-bold text-gold/70">{sourceAbbrev}</span>
              {feat.page ? (
                <span className="text-sm text-ink/35">p{feat.page}</span>
              ) : null}
            </div>
            <p className="font-serif italic text-ink/70">
              {typeLine}
              {feat.repeatable ? ' · Repeatable' : ''}
            </p>
          </div>
        </div>
      </div>

      {/* Identity + image strip — same 126px compact icon position the
          spell detail uses, so the two browsers feel consistent. */}
      <div className="border-b border-gold/10 px-6 py-5">
        <div className="grid gap-6 lg:grid-cols-[126px_minmax(0,1fr)]">
          <FeatArtPreview src={feat.imageUrl} alt={feat.name || 'Feat'} size={126} />
          <div className="grid gap-y-3 text-sm text-ink md:grid-cols-2 md:gap-x-8">
            <FeatInfoRow label="Identifier" value={feat.identifier || '—'} mono />
            <FeatInfoRow label="Source Type" value={feat.sourceType || '—'} />
            {feat.usesMax ? (
              <FeatInfoRow label="Uses Max" value={String(feat.usesMax)} mono />
            ) : null}
            {recovery.length ? (
              <FeatInfoRow
                label="Recovery"
                value={recovery
                  .map((r: any) => formatRecoveryRule(r))
                  .filter(Boolean)
                  .join(' · ')}
              />
            ) : null}
          </div>
        </div>
      </div>

      <div className="space-y-6 px-6 py-5">
        <div
          className="prose max-w-none prose-p:text-ink/90 prose-strong:text-ink prose-em:text-ink/80 prose-li:text-ink/85 prose-headings:text-ink"
          dangerouslySetInnerHTML={{ __html: descriptionHtml }}
        />

        {(feat.requirements || requirementsLine) ? (
          <div className="border border-blood/30 bg-blood/[0.04] rounded-md px-4 py-3 space-y-2">
            <div className="flex items-baseline gap-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-blood/80">Prerequisites</span>
              <span className="text-[9px] uppercase tracking-widest text-ink/35">character-level gate</span>
            </div>
            {requirementsLine ? (
              <div className="text-sm text-ink/85">{requirementsLine}</div>
            ) : null}
            {feat.requirements ? (
              <div className="text-sm text-ink/85 italic">{feat.requirements}</div>
            ) : null}
          </div>
        ) : null}

        <div className="border-t border-gold/10 pt-4 text-sm text-ink/70 space-y-2">
          <div>
            <span className="font-bold text-ink">Source:</span>{' '}
            {sourceAbbrev}
            {feat.page ? `, page ${feat.page}` : ''}
          </div>
          <div className="text-xs text-ink/40 italic">
            {(feat.activities?.length || 0)} activities · {(feat.effects?.length || 0)} active effects
          </div>
        </div>
      </div>
    </div>
  );
}

function FeatInfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-gold/70">{label}</div>
      <div className={`mt-1 text-sm text-ink/90 ${mono ? 'font-mono' : ''}`}>{value || '—'}</div>
    </div>
  );
}

// Slim image-preview component — matches `SpellArtPreview`'s contract
// but local to the feats surface so we don't grow another shared
// primitive yet. If a third surface needs it, extract.
function FeatArtPreview({ src, alt, size }: { src?: string; alt: string; size: number }) {
  if (!src) {
    return (
      <div
        className="rounded-md border border-gold/15 bg-background/30 grid place-items-center text-ink/30 text-[10px] uppercase tracking-widest"
        style={{ width: size, height: size }}
      >
        No icon
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      className="rounded-md border border-gold/15 object-cover"
      style={{ width: size, height: size }}
    />
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

function formatRecoveryRule(r: any): string {
  const period = String(r?.period ?? '').trim();
  const type = String(r?.type ?? '').trim();
  const formula = String(r?.formula ?? '').trim();
  const periodLabel = RECOVERY_PERIOD_OPTIONS.find((o) => o.value === period)?.label || period;
  const typeLabel = RECOVERY_TYPE_OPTIONS.find((o) => o.value === type)?.label || type;
  if (!periodLabel && !typeLabel && !formula) return '';
  return [periodLabel, typeLabel, formula].filter(Boolean).join(' / ');
}
