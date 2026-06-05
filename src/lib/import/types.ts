// Manual-upload / import system — shared types.
//
// The import core is deliberately split into a PURE half (resolve → preview)
// and a SIDE-EFFECTING half (commit → the editor's real write call). The window
// renders `fields`, calls `resolveEntity()` for a look-before-commit preview,
// then `commitEntity()` to persist. A descriptor's `commit()` MUST delegate to
// the same write function the matching hand-editor uses (e.g. `upsertSpell`) so
// imports and manual edits produce byte-identical rows. See
// docs/_drafts/manual-uploads-import-system-2026-06-04.html.

/** Input control the Mark & Build window renders for a field. */
export type ImportFieldKind =
  | 'text'
  | 'textarea'
  | 'number'
  | 'boolean'
  | 'select'
  | 'source'; // a `<select>` populated from the `sources` table

export interface ImportFieldOption {
  value: string;
  label: string;
}

/** One editable field on an import descriptor. `key` matches the editor's
 * camelCase form-state key so the payload builder stays a faithful mirror. */
export interface ImportFieldDef {
  key: string;
  label: string;
  kind: ImportFieldKind;
  required?: boolean;
  default?: unknown;
  options?: ImportFieldOption[]; // for kind === 'select'
  placeholder?: string;
  help?: string;
  group?: string; // optional UI grouping ("Identity" | "Mechanics" | …)
}

export interface ImportContext {
  /** When set, the resolved entity reuses this id (edit-in-place); otherwise a
   * fresh UUID is minted — the same `existingId ?? crypto.randomUUID()` idiom
   * every editor uses. */
  existingId?: string;
  /** ISO timestamp for created/updated — pass once so preview and commit agree. */
  now?: string;
}

/** Result of resolving raw field values into a writable entity. This IS the
 * preview: `payload` is exactly what `commit()` will hand the write function. */
export interface ResolvedEntity {
  type: string;
  id: string;
  isNew: boolean;
  displayName: string;
  identifier: string;
  payload: Record<string, any>;
  errors: string[];
  warnings: string[];
}

export interface ImportDescriptor {
  /** Canonical type key, e.g. `'spell'`. */
  type: string;
  /** Human label, e.g. `'Spell'`. */
  label: string;
  /** D1 collection/table the entity lands in (informational). */
  collection: string;
  /** Form-state key holding the entity's display name. */
  nameField: string;
  /** Form-state key holding the entity's description, if any. */
  descriptionField?: string;
  /** Editable fields the window renders. */
  fields: ImportFieldDef[];
  /** PURE: raw form values → the editor-shape payload passed to the write fn.
   * No I/O, safe to call repeatedly (drives the live preview). */
  buildPayload: (fields: Record<string, any>, ctx: ImportContext) => Record<string, any>;
  /** SIDE-EFFECTING: persist via the editor's REAL write call (e.g. upsertSpell).
   * Never reimplements the D1 write layer. */
  commit: (id: string, payload: Record<string, any>) => Promise<void>;
}
