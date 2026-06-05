// Import registry — one descriptor per compendium type, plus the pure
// `resolveEntity` (preview) and side-effecting `commitEntity` (real write).
//
// New types are added by writing a descriptor (like `spell.ts`) and registering
// it here. The window discovers types via `listImportDescriptors()`.

import type { ImportDescriptor, ResolvedEntity, ImportContext } from './types';
import { spellDescriptor } from './spell';

const DESCRIPTORS: Record<string, ImportDescriptor> = {
  [spellDescriptor.type]: spellDescriptor,
  // feat, item, feature, class, subclass, … land here as their descriptors ship.
};

export function listImportDescriptors(): ImportDescriptor[] {
  return Object.values(DESCRIPTORS);
}

export function getImportDescriptor(type: string): ImportDescriptor | undefined {
  return DESCRIPTORS[type];
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

  for (const field of descriptor.fields) {
    if (!field.required) continue;
    const value = fields[field.key];
    if (value === undefined || value === null || String(value).trim() === '') {
      errors.push(`${field.label} is required.`);
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
