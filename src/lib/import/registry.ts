// Import registry — one descriptor per compendium type, plus the pure
// `resolveEntity` (preview) and side-effecting `commitEntity` (real write).
//
// New types are added by writing a descriptor (like `spell.ts`) and registering
// it here. The window discovers types via `listImportDescriptors()`.

import type { ImportDescriptor, ResolvedEntity, ImportContext, ParseResult, ImportAssignTarget } from './types';
import { spellDescriptor } from './spell';
import { clazzDescriptor } from './clazz';
import { subclazzDescriptor } from './subclazz';

const DESCRIPTORS: Record<string, ImportDescriptor> = {
  [spellDescriptor.type]: spellDescriptor,
  [clazzDescriptor.type]: clazzDescriptor,
  [subclazzDescriptor.type]: subclazzDescriptor,
  // feat, item, feature, … land here as their descriptors ship.
};

export function listImportDescriptors(): ImportDescriptor[] {
  return Object.values(DESCRIPTORS);
}

export function getImportDescriptor(type: string): ImportDescriptor | undefined {
  return DESCRIPTORS[type];
}

/** True when the type can interpret pasted text (has a `parseText`). The window
 * shows its Interpret panel only for these. */
export function canParseText(type: string): boolean {
  return typeof getImportDescriptor(type)?.parseText === 'function';
}

/**
 * PURE — interpret a blob of pasted text into best-effort field values for the
 * given type. Returns `null` if the type has no parser (manual-entry only). The
 * window applies `fields` to form state and flags everything below `high`
 * confidence for a quick human check.
 */
export function parseEntityText(type: string, text: string): ParseResult | null {
  const descriptor = getImportDescriptor(type);
  if (!descriptor?.parseText) return null;
  return descriptor.parseText(text);
}

/** Logical targets a selected span can be re-assigned to, for this type's mark-up
 * panel. Empty when the type has no parser/assignment support. */
export function getAssignTargets(type: string): ImportAssignTarget[] {
  return getImportDescriptor(type)?.assignTargets ?? [];
}

/**
 * PURE — ingest a raw text selection into a target, returning the form-key →
 * value map to apply (re-running the type's own classifier). Empty when the type
 * can't assign.
 */
export function assignFieldText(type: string, targetKey: string, text: string): Record<string, unknown> {
  const descriptor = getImportDescriptor(type);
  return descriptor?.assignField ? descriptor.assignField(targetKey, text) : {};
}

/** PURE — for an `append`-mode target, parse a selection into ONE list item to
 * push onto the target's array field. Null when unsupported / empty. */
export function assignAppendItem(type: string, targetKey: string, text: string): Record<string, unknown> | null {
  const descriptor = getImportDescriptor(type);
  return descriptor?.assignAppend ? descriptor.assignAppend(targetKey, text) : null;
}

/** Catalog-aware — for a `resolve`-mode target, resolve a selection (using the
 * loaded catalogs + current values) into the field patch to apply. Empty when
 * unsupported. */
export function assignResolveFields(type: string, targetKey: string, text: string, catalogs: any, values: Record<string, any>): Record<string, unknown> {
  const descriptor = getImportDescriptor(type);
  return descriptor?.assignResolve ? descriptor.assignResolve(targetKey, text, { catalogs, values }) : {};
}

/** PURE — split a bulk selection into MANY append items (e.g. a whole features
 * blob → one draft per heading). Empty when unsupported. */
export function assignAppendManyItems(type: string, targetKey: string, text: string): Record<string, unknown>[] {
  const descriptor = getImportDescriptor(type);
  return descriptor?.assignAppendMany ? descriptor.assignAppendMany(targetKey, text) : [];
}

/** PURE — split a multi-entity paste into per-entity block-start offsets. Empty
 * (or the type has no splitter) ⇒ treat the whole paste as one entity. */
export function splitEntityBlocks(type: string, text: string): number[] {
  const descriptor = getImportDescriptor(type);
  return descriptor?.splitBlocks ? descriptor.splitBlocks(text) : [];
}

/**
 * PURE — resolve raw field values into a writable entity. Returns the exact
 * payload `commit` will write plus a validation report (missing required
 * fields). No I/O; this drives the look-before-commit preview.
 */
export function resolveEntity(
  type: string,
  fields: Record<string, any>,
  ctx: ImportContext = {},
): ResolvedEntity {
  const descriptor = getImportDescriptor(type);
  if (!descriptor) throw new Error(`Unknown import type: ${type}`);

  const errors: string[] = [];
  const warnings: string[] = [];

  // A required field is satisfied unless it's blank. "Blank" is shape-aware so
  // structured fields validate too: an empty string, an empty array, or an
  // object whose values are all falsy (e.g. the parent-class ref before a class
  // is chosen — { id:'', identifier:'', name:'' }).
  const isBlankRequired = (v: unknown): boolean => {
    if (v === undefined || v === null) return true;
    if (typeof v === 'string') return v.trim() === '';
    if (Array.isArray(v)) return v.length === 0;
    if (typeof v === 'object') return !Object.values(v as Record<string, unknown>).some((x) => x !== '' && x != null && x !== false);
    return false;
  };
  for (const field of descriptor.fields) {
    if (!field.required) continue;
    if (isBlankRequired(fields[field.key])) errors.push(`${field.label} is required.`);
  }

  // Empty-source warning — source-less entries are filtered out of the public
  // browsers (the spell/feat/item browsers gate on source). Non-blocking: you
  // can still create one deliberately, but it won't appear until a source is set.
  const sourceField = descriptor.fields.find((f) => f.kind === 'source');
  if (sourceField) {
    const sv = fields[sourceField.key];
    if (sv === undefined || sv === null || String(sv).trim() === '') {
      warnings.push(
        'No source set — source-less entries are hidden from the public browser until you assign one.',
      );
    }
  }

  const now = ctx.now ?? new Date().toISOString();
  const payload = descriptor.buildPayload(fields, { ...ctx, now });
  const id = ctx.existingId ?? crypto.randomUUID();
  const displayName = String(payload[descriptor.nameField] ?? '').trim() || '(unnamed)';
  const identifier = String(payload.identifier ?? '');

  return {
    type,
    id,
    isNew: !ctx.existingId,
    displayName,
    identifier,
    payload,
    errors,
    warnings,
  };
}

/**
 * SIDE-EFFECTING — persist a resolved entity through the descriptor's real
 * write call. Refuses to write if the preview flagged required-field errors.
 */
export async function commitEntity(resolved: ResolvedEntity): Promise<void> {
  const descriptor = getImportDescriptor(resolved.type);
  if (!descriptor) throw new Error(`Unknown import type: ${resolved.type}`);
  if (resolved.errors.length) {
    throw new Error(`Cannot create ${descriptor.label}: ${resolved.errors.join(' ')}`);
  }
  await descriptor.commit(resolved.id, resolved.payload);
}
