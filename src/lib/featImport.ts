/**
 * Feat import library — Foundry → Dauligor.
 *
 * Parallel to `spellImport.ts`. Accepts the JSON payload produced by
 * the module's "Export Feat Folder" feature (`kind:
 * dauligor.foundry-feat-folder-export.v1`) and builds candidate rows
 * the FeatImportWorkbench renders + commits to the `feats` D1 table.
 *
 * Helpers are copied (not re-exported) from spellImport.ts on purpose:
 *   - their names contain `Spell` for grep continuity but the bodies
 *     are functionally generic;
 *   - we want featImport.ts to be self-contained so a future schema
 *     drift on one side can't silently break the other.
 *
 * Schema mapping (Foundry `system.*` → `feats` D1 column):
 *
 *   system.type.value    → feat_type     ('feat' / 'class' / 'subclass' / 'race' / 'background' / 'monster')
 *   system.type.subtype  → feat_subtype  (free text, e.g. 'fighting-style')
 *   system.identifier    → identifier    (slug, derived from name when missing)
 *   system.requirements  → requirements  (human-readable prereq text)
 *   system.properties    → tags / repeatable (split: `repeatable` boolean + property tags)
 *   system.uses.{max,spent,recovery} → uses_max / uses_spent / uses_recovery
 *   system.activities    → activities    (JSON array)
 *   system.advancement   → advancements  (JSON array — flattened from
 *                          Foundry's `{ "<uuid>": Advancement }` object map.
 *                          The `_id` UUIDs are stable and preserved as-is
 *                          so a re-export round-trips cleanly. See
 *                          migration 20260525-1900 for the column.)
 *   sourceDocument.img   → image_url
 *   sourceDocument.effects → effects     (JSON array)
 *   system.description.value → description (HTML → BBCode)
 *   source.{book,page,rules} → matched source_id + page
 *
 * Things deliberately NOT carried over (per current feats schema):
 *   - foundry_data blob — feats table has no `foundry_data` column.
 *     We capture the bookkeeping fields (`_dauligorImport`) elsewhere
 *     if needed by adding the column in a future migration. For now
 *     the full system block is dropped after we extract what we need.
 *   - requirements_tree — Foundry's structured prerequisites are
 *     hetero­geneous; we leave the column at its default `null` and
 *     let admins populate it via the manual editor.
 */

import { slugify } from './utils';
import { htmlToBbcode } from './bbcode';
import { cleanFoundryHtml } from './foundryHtmlCleanup';

const IMAGE_CDN_BASE = 'https://images.dauligor.com';

type SourceRecord = {
  id: string;
  name?: string;
  abbreviation?: string;
  shortName?: string;
  slug?: string;
  rules?: string;
  [key: string]: any;
};

type ExistingFeatRecord = {
  id: string;
  name?: string;
  identifier?: string;
  sourceId?: string;
  [key: string]: any;
};

export type FoundryFeatExportEntry = {
  id: string;
  uuid?: string;
  name: string;
  type: string;
  folderId?: string | null;
  folderPath?: string;
  relativeFolderPath?: string;
  source?: {
    book?: string;
    page?: string | number | null;
    rules?: string;
  };
  featSummary?: Record<string, any>;
  sourceDocument: any;
};

export type FoundryFeatFolderExport = {
  kind: string;
  schemaVersion?: number;
  exportedAt?: string;
  moduleId?: string;
  game?: Record<string, any>;
  folder?: Record<string, any>;
  summary?: Record<string, any>;
  feats?: FoundryFeatExportEntry[];
};

export type FeatImportCandidate = {
  candidateId: string;
  batchId: string;
  batchLabel: string;
  name: string;
  identifier: string;
  featType: string;
  featTypeLabel: string;
  featSubtype: string;
  featSubtypeLabel: string;
  sourceBook: string;
  sourcePage: string;
  rules: string;
  imageUrl: string;
  descriptionHtml: string;
  properties: string[];
  repeatable: boolean;
  hasUses: boolean;
  hasActivities: boolean;
  hasEffects: boolean;
  hasPrereqs: boolean;
  requirements: string;
  activationLabel: string;
  usesLabel: string;
  sourceDocument: any;
  matchedSourceId: string;
  matchedSourceLabel: string;
  sourceResolved: boolean;
  existingEntryId: string;
  existingEntryName: string;
  importWarnings: string[];
  activities: any[];
  effects: any[];
  savePayload: Record<string, any>;
};

// Mirrors the FEAT_TYPE_VALUES constant inside FeatsEditor. Kept local
// (not imported) because FeatsEditor is a heavy module and importing
// it would bloat the import workbench's transitive deps for no win.
export const FEAT_TYPE_LABELS: Record<string, string> = {
  feat: 'Feat',
  class: 'Class Feature',
  subclass: 'Subclass Feature',
  race: 'Racial Feature',
  background: 'Background Feature',
  monster: 'Monster Feature',
};

// Foundry stores its `feat` subtype dictionary as camelCase slugs
// (`fightingStyle`, `epicBoon`). Mirror those + a few class-/race-
// commonly-seen identifiers. Anything not in the map falls through to
// the slug verbatim in `featSubtypeLabel`.
export const FEAT_SUBTYPE_LABELS: Record<string, string> = {
  general: 'General',
  origin: 'Origin',
  fightingStyle: 'Fighting Style',
  epicBoon: 'Epic Boon',
};

// ─── Helpers (copied from spellImport.ts, see top-of-file comment) ──

function toCleanUpper(value: string) {
  return String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function normalizeRules(value: string) {
  const numeric = String(value ?? '').replace(/[^0-9]/g, '');
  if (numeric === '2014' || numeric === '14') return '2014';
  if (numeric === '2024' || numeric === '24') return '2024';
  return String(value ?? '').trim();
}

function resolveFoundryImageUrl(value: string) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (/^https?:\/\//iu.test(raw)) return raw;
  if (raw.startsWith('/')) return `${IMAGE_CDN_BASE}${raw}`;
  if (/^(icons|systems|modules)\//iu.test(raw)) return `${IMAGE_CDN_BASE}/${raw}`;
  return raw;
}

function toDisplayTokenLabel(value: string) {
  return String(value ?? '')
    .split(/[._-]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function matchSourceRecord(book: string, rules: string, sources: SourceRecord[]) {
  const normalizedBook = toCleanUpper(book);
  const normalizedRules = normalizeRules(rules);
  const variants = new Set<string>();
  if (normalizedBook) {
    // Original cleaned form, plus a stripped variant that drops a
    // trailing 14 / 24 / 2014 / 2024 suffix. This covers the common
    // "PHB'14" → "PHB" case where the source author rolls the
    // rules year into the book code.
    variants.add(normalizedBook);
    variants.add(normalizedBook.replace(/(2014|2024|14|24)$/u, ''));
  }

  // EXACT MATCH ONLY against the variants. The old prefix-match
  // (`candidate.startsWith(variant) || variant.startsWith(candidate)`)
  // routes too aggressively — a book like "GH:CG'14" (cleaned
  // "GHCG14", stripped "GHCG") would prefix-match a source whose
  // abbreviation is just "GH", silently routing every Grim Hollow
  // sub-book to the same source row. With the schema's new
  // composite UNIQUE(source_id, identifier), that turns every
  // shared identifier ("Blood Hound", "Witch Hunter", etc.) across
  // GH:CG and GH:PG into an instant batch failure.
  //
  // Exact-match-only is the right behavior:
  //   - "PHB'14" → "PHB14" → stripped "PHB" → matches source "PHB" ✓
  //   - "GH:CG'14" → "GHCG14" → "GHCG" → matches ONLY if a source
  //     with abbreviation "GH:CG" / "GHCG" exists. Otherwise the
  //     row stays unresolved and the workbench surfaces it for
  //     manual remap via the per-row source picker.
  const scored = sources
    .map((source) => {
      const candidates = [
        source.abbreviation,
        source.shortName,
        source.slug,
        source.name
      ]
        .map((value) => toCleanUpper(String(value ?? '')))
        .filter(Boolean);

      let score = 0;
      for (const variant of variants) {
        if (!variant) continue;
        if (candidates.includes(variant)) score = Math.max(score, 3);
      }

      const sourceRules = normalizeRules(String(source.rules ?? ''));
      if (score > 0 && normalizedRules && sourceRules && normalizedRules === sourceRules) score += 1;

      return { source, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.source ?? null;
}

export function formatActivationLabel(activation: any) {
  if (!activation) return '';
  const type = String(activation.type ?? '').trim();
  const value = String(activation.value ?? '').trim();
  const condition = String(activation.condition ?? '').trim();
  const parts = [];
  if (value && type) parts.push(`${value} ${type}`);
  else if (type) parts.push(type);
  else if (value) parts.push(value);
  if (condition) parts.push(condition);
  return parts.join(', ');
}

function formatUsesLabel(uses: any) {
  if (!uses) return '';
  const max = String(uses.max ?? '').trim();
  if (!max) return '';
  const spent = Number(uses.spent ?? 0);
  // The recovery array uses dnd5e v5's shape `[{ period: 'lr', type: 'recoverAll' }]`.
  // Surface the period codes as a compact "lr"/"sr"/"day" hint so the
  // workbench's row can show "3 / lr" without parsing the whole block.
  const recoveries = Array.isArray(uses.recovery)
    ? uses.recovery.map((r: any) => String(r?.period ?? '')).filter(Boolean)
    : [];
  const periodLabel = recoveries.length ? ` / ${recoveries.join(', ')}` : '';
  return `${spent > 0 ? `${spent} of ` : ''}${max}${periodLabel}`;
}

export function formatFoundryFeatDescriptionForDisplay(html: string) {
  // Foundry-side cleanup is shared with `spellImport` + `itemImport`
  // via `cleanFoundryHtml` so all three importers stay in lockstep.
  // Feats turn on `stripLeadingPrereqsLine` because some authors
  // open the description with a hand-written "Prerequisites: …"
  // marker (sometimes wrapped in literal angle brackets) that
  // duplicates the structured prereqs already shown in the detail
  // pane. Spells / items don't have that convention.
  return cleanFoundryHtml(html, { stripLeadingPrereqsLine: true });
}

function convertFoundryFeatHtmlToBbcode(html: string) {
  // Run the cleanup BEFORE `htmlToBbcode` so the enrichers
  // (`@feat[…]`, `[[/r …]]`, etc.) are reduced to plain text before
  // the converter sees them. Otherwise the raw tokens survive into
  // the BBCode column and surface as literal text in every consumer
  // (FeatDetailPanel, the Foundry feat browser, etc.).
  return htmlToBbcode(cleanFoundryHtml(html, { stripLeadingPrereqsLine: true }));
}

function buildImportWarnings(entry: FoundryFeatExportEntry, matchedSource: SourceRecord | null) {
  const warnings: string[] = [];
  const sourceDocument = entry.sourceDocument ?? {};
  if (!matchedSource) {
    warnings.push(`Source "${entry.source?.book || 'Unknown'}" could not be matched to a Dauligor source.`);
  }
  if (!sourceDocument?.system?.description?.value) {
    warnings.push('Feat description is empty.');
  }
  // Feats without activities OR effects are still legitimate (some
  // feats are purely passive ability-score bumps); don't warn on it
  // by default. Authors can spot empty rows in the preview.
  return warnings;
}

function buildSavePayload(entry: FoundryFeatFolderExport, feat: FoundryFeatExportEntry, matchedSource: SourceRecord | null) {
  const sourceDocument = feat.sourceDocument ?? {};
  const system = sourceDocument.system ?? {};
  const properties = Array.from(system.properties ?? []).map((value) => String(value));
  const featType = String(system.type?.value ?? 'feat').trim() || 'feat';
  const featSubtype = String(system.type?.subtype ?? '').trim();
  const identifier = slugify(String(system.identifier ?? '') || feat.name || sourceDocument.name || 'feat');
  const uses = system.uses ?? {};
  const recovery = Array.isArray(uses.recovery) ? uses.recovery : [];

  // Payload is written in **snake_case** to match the feats schema
  // exactly, mirroring what FeatsEditor's manual save produces (see
  // FeatsEditor.tsx:722-740). `normalizeCompendiumData` still runs on
  // the way in (via `upsertFeat` / `upsertFeatBatch`) — keys that map
  // 1:1 to columns pass through untouched, and `tagIds` → `tags`
  // happens in the upsert helper.
  return {
    name: feat.name || sourceDocument.name || 'Feat',
    identifier,
    source_id: matchedSource?.id || null,
    // `feat_type` is the canonical dnd5e `system.type.value`
    // (feat / class / subclass / race / background / monster).
    feat_type: featType,
    // `feat_subtype` cascades on feat_type. Empty string when un-subtyped.
    feat_subtype: featSubtype || null,
    // `source_type` is Dauligor-side bookkeeping for which Foundry
    // document shape the row mints when re-exported. Default to `feat`
    // for the broad category; class/subclass variants get rewritten
    // by the workbench's per-row picker (once wired).
    source_type: featType === 'class' ? 'classFeature' : featType === 'subclass' ? 'subclassFeature' : 'feat',
    // The feats schema stores the prerequisites as free-form text in
    // `requirements`. Foundry's `system.requirements` is the same kind
    // of human-readable text ("Strength 13 or Dexterity 13"), so
    // passthrough is faithful. We leave `requirements_tree` at its
    // schema default (null) — Foundry's structured prereq dictionary
    // doesn't have a stable shape and we don't currently attempt to
    // parse it.
    requirements: String(system.requirements ?? '') || null,
    description: convertFoundryFeatHtmlToBbcode(String(system.description?.value ?? '')),
    image_url: resolveFoundryImageUrl(sourceDocument.img || '') || null,
    // The dnd5e v5 `repeatable` property — stored as the boolean
    // column. The `properties` array isn't persisted today (no column
    // for it); the workbench surfaces it for preview only.
    repeatable: properties.includes('repeatable') ? 1 : 0,
    uses_max: String(uses.max ?? '') || null,
    uses_spent: Number(uses.spent ?? 0),
    uses_recovery: recovery,
    // dnd5e v5 stores activities as an object keyed by activity id;
    // serialise to a flat array (same as the spell importer does).
    activities: Object.values(system.activities ?? {}),
    effects: Array.isArray(sourceDocument.effects) ? sourceDocument.effects : [],
    // dnd5e stores `system.advancement` as a `{ "<uuid>": Advancement }`
    // object map keyed by each advancement's stable `_id`. Flatten to
    // the array shape Dauligor stores in `feats.advancements` (added
    // by migration 20260525-1900). The `_id` UUIDs are preserved
    // verbatim — don't regenerate, otherwise a downstream re-export
    // would mint new IDs and break any references that point at them.
    advancements: (() => {
      const raw = system.advancement;
      if (Array.isArray(raw)) return raw;
      if (raw && typeof raw === 'object') return Object.values(raw);
      return [];
    })(),
    // `page` is a top-level column on the feats row.
    page: String(feat.source?.page ?? system.source?.page ?? '') || null,
    // Tags are left empty — the import doesn't know the Dauligor tag
    // vocabulary; admins tag rows via the manual editor or via the
    // workbench's per-candidate tag picker (which writes `tagIds` —
    // the upsert helper translates that to the `tags` column).
    tagIds: [] as string[],
    // `_dauligorImport` bookkeeping is intentionally omitted from the
    // payload — the feats table has no `foundry_data` column equivalent
    // (asymmetry vs spells). If round-tripping support lands later,
    // add a feats.foundry_data migration and revisit. For now the
    // import is one-way: Foundry → Dauligor.
  };
}

export function buildFeatImportCandidates(
  entry: FoundryFeatFolderExport,
  batchLabel: string,
  sources: SourceRecord[],
  existingEntries: ExistingFeatRecord[]
): FeatImportCandidate[] {
  const feats = Array.isArray(entry.feats) ? entry.feats : [];

  return feats.map((feat, index) => {
    const sourceDocument = feat.sourceDocument ?? {};
    const system = sourceDocument.system ?? {};
    const properties = Array.from(system.properties ?? []).map((value) => String(value));
    const matchedSource = matchSourceRecord(
      String(feat.source?.book ?? system.source?.book ?? ''),
      String(feat.source?.rules ?? system.source?.rules ?? ''),
      sources
    );
    const identifier = slugify(String(system.identifier ?? '') || feat.name || sourceDocument.name || `feat-${index + 1}`);
    const existingEntry = existingEntries.find((candidate) =>
      String(candidate.identifier ?? '') === identifier
      && String(candidate.sourceId ?? '') === String(matchedSource?.id ?? '')
    );
    const activities = Object.values(system.activities ?? {});
    const effects = Array.isArray(sourceDocument.effects) ? sourceDocument.effects : [];
    const featType = String(system.type?.value ?? 'feat');
    const featSubtype = String(system.type?.subtype ?? '');
    const requirements = String(system.requirements ?? '');
    const hasPrereqs = requirements.trim().length > 0
      || (system.prerequisites && Object.keys(system.prerequisites).length > 0);
    const uses = system.uses ?? {};
    const hasUses = !!(String(uses.max ?? '').trim() || Number(uses.spent ?? 0) > 0);
    const savePayload = buildSavePayload(entry, feat, matchedSource);
    const sourceBook = String(feat.source?.book ?? system.source?.book ?? '').trim();
    const sourcePage = String(feat.source?.page ?? system.source?.page ?? '').trim();
    const rules = String(feat.source?.rules ?? system.source?.rules ?? '').trim();

    return {
      candidateId: `${batchLabel}::${feat.uuid || feat.id || identifier}`,
      batchId: batchLabel,
      batchLabel,
      name: feat.name || sourceDocument.name || 'Feat',
      identifier,
      featType,
      featTypeLabel: FEAT_TYPE_LABELS[featType] || featType,
      featSubtype,
      featSubtypeLabel: FEAT_SUBTYPE_LABELS[featSubtype] || toDisplayTokenLabel(featSubtype),
      sourceBook,
      sourcePage,
      rules,
      imageUrl: resolveFoundryImageUrl(sourceDocument.img || ''),
      descriptionHtml: String(system.description?.value ?? ''),
      properties,
      repeatable: properties.includes('repeatable'),
      hasUses,
      hasActivities: activities.length > 0,
      hasEffects: effects.length > 0,
      hasPrereqs,
      requirements,
      activationLabel: formatActivationLabel(system.activation),
      usesLabel: formatUsesLabel(uses),
      sourceDocument,
      matchedSourceId: matchedSource?.id || '',
      matchedSourceLabel: matchedSource?.name || matchedSource?.abbreviation || '',
      sourceResolved: Boolean(matchedSource),
      existingEntryId: existingEntry?.id || '',
      existingEntryName: existingEntry?.name || '',
      importWarnings: buildImportWarnings(feat, matchedSource),
      activities,
      effects,
      savePayload,
    };
  });
}
