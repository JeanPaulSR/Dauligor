/**
 * Scaling-columns importer — Foundry → Dauligor reverse direction.
 *
 * When the feat importer (and, in the future, an item / race / background
 * importer) lands a row with `ScaleValue` advancements in its
 * `system.advancement` map, we want the per-level scale data persisted
 * as proper `scaling_columns` rows so:
 *
 *   1. The Dauligor editor's ScalingColumnsPanel can show the column +
 *      breakpoints next to the feat / race / etc.
 *   2. Re-export through `normalizeScaleValueAdvancement` (api/_lib/_classExport.ts)
 *      rebuilds the same Foundry-shape `configuration.scale` map from the
 *      column row — without this, a re-export would emit an empty scale
 *      because the editor-side advancement wouldn't know which column to
 *      look up.
 *   3. Authors can edit per-level values in one canonical place.
 *
 * The helper:
 *
 *   - Walks an advancement array. For every `ScaleValue` entry it pulls
 *     `configuration.scale` apart and converts it back to the Dauligor
 *     flat-string shape (`{ "1": "1d6", "5": "2d6", ... }`).
 *   - Reconciles against existing `scaling_columns` rows owned by the
 *     same parent. Matches by `identifier` so a re-import of an already-
 *     populated row updates in place rather than minting a duplicate.
 *   - Patches each ScaleValue's `configuration.scalingColumnId` to point
 *     at the row's PK so the editor + export pipelines hold the same
 *     linkage classes have always had.
 *
 * Mirror of the forward path `normalizeScaleValueAdvancement` in
 * `api/_lib/_classExport.ts`. Both touch the same conversion (dice /
 * value / distance.units) — keep them in sync if either side learns
 * a new entry shape.
 */

import { fetchCollection, upsertDocument } from './d1';
import type { ScalingOwnerType } from '../components/compendium/ScalingColumnsPanel';

const trimString = (v: any) => String(v ?? '').trim();

/**
 * Reverse the per-level entry shape from Foundry's dnd5e to the flat
 * string Dauligor stores. Foundry's shapes:
 *   - number / string / cr / distance: `{ value: <something> }`
 *   - dice:                            `{ number: N, faces: F, modifiers: [..] }`
 * We collapse all of these to a plain string like `"1d6"` / `"+2"` /
 * `"15"`. Dice modifiers concat with `+` (the existing forward path
 * uses the same idiom; see `parseDiceScaleEntry` in `_classExport.ts`).
 */
function foundryScaleEntryToFlat(raw: any): string {
  if (raw == null) return '';
  if (typeof raw === 'string' || typeof raw === 'number') return String(raw).trim();
  if (typeof raw !== 'object') return '';
  if ('value' in raw && raw.value != null) return String(raw.value).trim();
  if ('number' in raw || 'faces' in raw) {
    const number = raw.number != null ? String(raw.number) : '';
    const faces = raw.faces != null ? String(raw.faces) : '';
    if (!number || !faces) return '';
    const base = `${number}d${faces}`;
    const mods: string[] = Array.isArray(raw.modifiers)
      ? raw.modifiers.map((m: any) => trimString(m)).filter(Boolean)
      : [];
    return mods.length ? `${base}+${mods.join('+')}` : base;
  }
  return '';
}

function flattenFoundryScale(scale: any): Record<string, string> {
  if (!scale || typeof scale !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [level, raw] of Object.entries(scale)) {
    const flat = foundryScaleEntryToFlat(raw);
    if (flat) out[level] = flat;
  }
  return out;
}

export interface ExtractScalingResult {
  /**
   * The advancements array with every `ScaleValue` entry's
   * `configuration.scalingColumnId` patched to point at the persisted
   * row. Other entries pass through untouched. Callers should use this
   * in place of their original advancements array when writing the row.
   */
  scaledAdvancements: any[];
  /** identifier → scaling_columns.id, for diagnostics. */
  columnIdByIdentifier: Record<string, string>;
}

/**
 * Persist ScaleValue advancements as `scaling_columns` rows owned by
 * `(parentId, parentType)` and return a patched advancement list with
 * `configuration.scalingColumnId` set on each ScaleValue.
 *
 * - Existing rows (matched on `parent_id + parent_type + identifier`)
 *   are upserted in-place. Their original `id` and `name` are
 *   preserved; only `type`, `values`, and `distance_units` get
 *   refreshed from the advancement.
 * - New rows are minted with `crypto.randomUUID()` and the
 *   advancement's title (or identifier) as the display name.
 * - ScaleValue advancements without an `identifier` are left alone
 *   (no column written, no scalingColumnId patched). The editor can
 *   still display them as raw advancements; the author can author a
 *   matching column later if they want the round-trip linkage.
 *
 * Designed to run BEFORE the parent row is upserted — the helper
 * needs the parent's final id, so callers must mint that first
 * (`crypto.randomUUID()` for creates, the existing id for updates)
 * and pass it in.
 */
export async function extractAndPersistScalingColumns(opts: {
  parentId: string;
  parentType: ScalingOwnerType;
  advancements: any[];
}): Promise<ExtractScalingResult> {
  const { parentId, parentType, advancements } = opts;

  // Defensive: don't run for owner types we don't support today.
  // Class features (`feat_type='class'/'subclass'`) inherit columns
  // from the parent class — the caller should never invoke us for
  // those, but guard anyway so a future caller doesn't accidentally
  // write rows under the wrong owner.
  if (!parentId || !parentType) {
    return { scaledAdvancements: advancements, columnIdByIdentifier: {} };
  }

  const advList = Array.isArray(advancements) ? advancements : [];
  const scaleValueEntries = advList
    .map((adv, idx) => ({ adv, idx }))
    .filter((entry) => trimString(entry.adv?.type) === 'ScaleValue');

  if (scaleValueEntries.length === 0) {
    return { scaledAdvancements: advList, columnIdByIdentifier: {} };
  }

  // Load existing columns once. Reconciling against them by
  // identifier keeps re-imports idempotent — a feat re-imported from
  // Foundry won't duplicate its scaling rows.
  let existingRows: any[] = [];
  try {
    existingRows = await fetchCollection<any>('scaling_columns', {
      where: 'parent_id = ? AND parent_type = ?',
      params: [parentId, parentType],
      orderBy: 'name ASC',
    });
  } catch (err) {
    console.error('[scalingImport] failed to load existing columns:', err);
    existingRows = [];
  }
  const existingByIdentifier = new Map<string, any>();
  for (const row of existingRows) {
    const ident = trimString(row?.identifier);
    if (ident) existingByIdentifier.set(ident, row);
  }

  const columnIdByIdentifier: Record<string, string> = {};
  const advCopy = advList.map((adv) => (adv && typeof adv === 'object' ? { ...adv } : adv));

  for (const { adv, idx } of scaleValueEntries) {
    const config = (adv?.configuration ?? {}) as Record<string, any>;
    const identifier = trimString(config.identifier);
    if (!identifier) continue; // can't anchor a column without one

    const existing = existingByIdentifier.get(identifier);
    const columnId = existing?.id || crypto.randomUUID();
    const name = trimString(existing?.name)
      || trimString(adv?.title)
      || identifier;

    // Convert Foundry's per-level shape back to our flat-string map.
    const flatValues = flattenFoundryScale(config.scale);

    const type = trimString(config.type) || 'number';
    const distanceUnits = type === 'distance'
      ? (trimString(config?.distance?.units) || 'ft')
      : null;

    const payload: Record<string, any> = {
      name,
      identifier,
      type,
      parent_id: parentId,
      parent_type: parentType,
      values: flatValues,
      distance_units: distanceUnits,
      updated_at: new Date().toISOString(),
    };
    if (!existing) {
      payload.created_at = new Date().toISOString();
    }

    try {
      await upsertDocument('scaling_columns', columnId, payload);
      columnIdByIdentifier[identifier] = columnId;
      // Patch the advancement copy so the caller's payload writes
      // the linkage. The original advancements array is left
      // untouched — `advCopy` is what the caller should use.
      const target = advCopy[idx];
      if (target && typeof target === 'object') {
        target.configuration = {
          ...(target.configuration || {}),
          scalingColumnId: columnId,
        };
      }
    } catch (err) {
      console.error(`[scalingImport] failed to upsert column "${identifier}":`, err);
    }
  }

  return { scaledAdvancements: advCopy, columnIdByIdentifier };
}

/**
 * Convert a feat's `feat_type` to the matching `parent_type` value for
 * scaling columns. Class features intentionally return `null` — they
 * inherit columns from the parent class and shouldn't own their own.
 *
 * Centralized here so the importer + the editor + the exporter share
 * the same mapping. If a new feat_type lands later (e.g. 'monster'
 * gains its own scaling slot), update this function and every consumer
 * picks it up.
 */
export function scalingOwnerTypeForFeatType(featType: string | null | undefined): ScalingOwnerType | null {
  const ft = trimString(featType).toLowerCase();
  if (ft === 'class' || ft === 'subclass') return null;
  if (ft === 'race' || ft === 'background') return ft;
  // 'feat', 'monster', or unspecified — all share the generic feat slot.
  return 'feat';
}
