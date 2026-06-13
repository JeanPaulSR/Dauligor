/**
 * Class / background starting-equipment trees.
 *
 * Models dnd5e's `system.startingEquipment` — the structured equipment a
 * character receives at creation, expressed as choice groups whose leaves are
 * either a specific item, a category ("any martial weapon"), a spellcasting
 * focus, or currency.
 *
 * Two shapes
 * ----------
 * 1. **Authoring shape (this app)** — a NESTED tree of `EquipmentNode`s
 *    (`group` with `children`, or `option` leaves). Easy to build and edit,
 *    mirrors `requirements.ts`'s tree. This is what the `StartingEquipmentEditor`
 *    component edits and what we store as JSON in the `starting_equipment_data`
 *    column.
 * 2. **Foundry shape (dnd5e)** — a FLAT `EquipmentEntryData[]` where the tree
 *    is reconstructed from each entry's `group` (parent `_id`) + `sort`. This
 *    is what `system.startingEquipment` wants. `flattenStartingEquipment`
 *    converts authoring → Foundry on export.
 *
 * The `linked` leaf's `key` holds our **item id (PK)** while authoring (stable
 * across renames) and is remapped to the item's **source identifier** on
 * export; the Foundry module resolves that identifier to the real item UUID at
 * import time (same pattern base-item slugs use).
 *
 * Foundry export
 * --------------
 * `flattenStartingEquipment(roots, { makeId, linkedKeyFor })` produces the
 * `EquipmentEntryData[]` emitted as `startingEquipmentData` in the baked class
 * bundle. DRIFT: the export-relevant half of this file is mirrored in
 * `api/_lib/_startingEquipment.ts` — keep the types, `parseEquipmentTree`,
 * `collectLinkedItemKeys`, and `flattenStartingEquipment` identical across the
 * pair (the editor-only helpers below the fold live only here).
 */

// ─── dnd5e vocab ─────────────────────────────────────────────────────────
//
// Leaf `key` values are verified against CONFIG.DND5E (dnd5e 5.x):
//   weapon → DND5E.weaponProficiencies  (sim / mar)
//   armor  → DND5E.armorTypes           (light / medium / heavy / shield)
//   tool   → DND5E.toolTypes            (art / game / music)
//   focus  → DND5E.focusTypes           (arcane / druidic / holy)
//   linked → item UUID (we author the item identifier; module resolves it)

/** Leaf entry types — "an option for the player" in dnd5e terms. */
export type EquipmentOptionType = 'linked' | 'weapon' | 'armor' | 'tool' | 'focus' | 'currency';
/** Grouping entry types — combine child entries. */
export type EquipmentGroupType = 'AND' | 'OR';

const OPTION_TYPES = new Set<EquipmentOptionType>(['linked', 'weapon', 'armor', 'tool', 'focus', 'currency']);

export interface EquipmentOption {
  kind: 'option';
  type: EquipmentOptionType;
  /**
   * `linked`  → item id (PK) while authoring; source identifier after export.
   * `weapon`  → `sim` | `mar`.
   * `armor`   → `light` | `medium` | `heavy` | `shield`.
   * `tool`    → `art` | `game` | `music`.
   * `focus`   → `arcane` | `druidic` | `holy`.
   * `currency`→ denomination (`pp`/`gp`/`ep`/`sp`/`cp`).
   */
  key: string;
  /** Quantity (e.g. 20 arrows, 10 gp). Omitted on export when undefined. */
  count?: number;
  /** "…that you are proficient with" — weapon/armor category leaves. */
  requiresProficiency?: boolean;
}

export interface EquipmentGroup {
  kind: 'group';
  type: EquipmentGroupType;
  children: EquipmentNode[];
}

export type EquipmentNode = EquipmentGroup | EquipmentOption;

/** A single dnd5e `system.startingEquipment` entry (flat parent-pointer tree). */
export interface EquipmentEntryData {
  _id: string;
  group: string | null;
  sort: number;
  type: EquipmentGroupType | EquipmentOptionType;
  count?: number;
  key?: string;
  requiresProficiency?: boolean;
}

// ─── Type guards ─────────────────────────────────────────────────────────

export function isEquipmentGroup(node: EquipmentNode): node is EquipmentGroup {
  return node.kind === 'group';
}
export function isEquipmentOption(node: EquipmentNode): node is EquipmentOption {
  return node.kind === 'option';
}

// ─── JSON round-trip ─────────────────────────────────────────────────────

/**
 * Parse the value stored in `starting_equipment_data`. Tolerant of both a
 * parsed array (D1 JSON-column auto-parse) and a raw JSON string. Returns an
 * empty array for missing / malformed input — the column is nullable and most
 * rows have no structured equipment yet.
 */
export function parseEquipmentTree(raw: unknown): EquipmentNode[] {
  if (raw == null || raw === '') return [];
  let value: any = raw;
  if (typeof raw === 'string') {
    try { value = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(value)) return [];
  return value.map(normalizeNode).filter(Boolean) as EquipmentNode[];
}

/** Defensive normalization — drops unknown types and malformed nodes. */
function normalizeNode(input: any): EquipmentNode | null {
  if (!input || typeof input !== 'object') return null;
  // Group: explicit kind, or a recognised grouping `type`.
  if (input.kind === 'group' || input.type === 'AND' || input.type === 'OR') {
    const type: EquipmentGroupType = input.type === 'AND' ? 'AND' : 'OR';
    const children = Array.isArray(input.children)
      ? (input.children.map(normalizeNode).filter(Boolean) as EquipmentNode[])
      : [];
    return { kind: 'group', type, children };
  }
  // Option: explicit kind, or a recognised option `type`.
  if (input.kind === 'option' || OPTION_TYPES.has(input.type)) {
    if (!OPTION_TYPES.has(input.type)) return null;
    const node: EquipmentOption = { kind: 'option', type: input.type, key: String(input.key ?? '') };
    if (input.count != null && Number.isFinite(Number(input.count))) node.count = Number(input.count);
    if (input.requiresProficiency) node.requiresProficiency = true;
    return node;
  }
  return null;
}

/** Serialize roots to JSON for D1. Returns null when empty (column nullable). */
export function serializeEquipmentTree(roots: EquipmentNode[] | null | undefined): string | null {
  if (!roots || roots.length === 0) return null;
  return JSON.stringify(roots);
}

// ─── Export: flatten authoring tree → dnd5e EquipmentEntryData[] ──────────

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** Foundry-valid 16-char document id (matches randomID / makeFoundryId). */
export function makeEntryId(): string {
  let s = '';
  for (let i = 0; i < 16; i++) s += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
  return s;
}

/** Every `linked` leaf's key, de-duplicated — the item PKs to resolve on export. */
export function collectLinkedItemKeys(roots: EquipmentNode[]): string[] {
  const out = new Set<string>();
  const walk = (nodes: EquipmentNode[]) => {
    for (const node of nodes) {
      if (isEquipmentGroup(node)) walk(node.children);
      else if (node.type === 'linked' && node.key) out.add(node.key);
    }
  };
  walk(roots);
  return [...out];
}

export interface FlattenStartingEquipmentOptions {
  /** Id generator for each entry's `_id`. Defaults to `makeEntryId`. */
  makeId?: () => string;
  /** Map a `linked` leaf's authoring key (item PK) → exported key (identifier). */
  linkedKeyFor?: (key: string) => string;
}

/**
 * Flatten the nested authoring tree into dnd5e's flat `EquipmentEntryData[]`,
 * assigning `_id`s, `group` parent-pointers, and `sort` order. `linked` keys
 * are run through `linkedKeyFor` so item PKs become source identifiers.
 */
export function flattenStartingEquipment(
  roots: EquipmentNode[],
  options: FlattenStartingEquipmentOptions = {},
): EquipmentEntryData[] {
  const makeId = options.makeId ?? makeEntryId;
  const linkedKeyFor = options.linkedKeyFor ?? ((k) => k);
  const out: EquipmentEntryData[] = [];
  const walk = (nodes: EquipmentNode[], parent: string | null) => {
    nodes.forEach((node, index) => {
      const _id = makeId();
      const sort = (index + 1) * 100;
      if (isEquipmentGroup(node)) {
        out.push({ _id, group: parent, sort, type: node.type });
        walk(node.children, _id);
      } else {
        const entry: EquipmentEntryData = { _id, group: parent, sort, type: node.type };
        const key = node.type === 'linked' ? linkedKeyFor(node.key) : node.key;
        if (key) entry.key = key;
        if (node.count != null) entry.count = node.count;
        if (node.requiresProficiency) entry.requiresProficiency = true;
        out.push(entry);
      }
    });
  };
  walk(roots, null);
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// Editor-only helpers below — NOT mirrored in api/_lib/_startingEquipment.ts.
// ═══════════════════════════════════════════════════════════════════════════

// ─── Fixed category option lists (for the editor pickers) ────────────────

export const EQUIPMENT_WEAPON_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'sim', label: 'Any Simple Weapon' },
  { value: 'mar', label: 'Any Martial Weapon' },
];
export const EQUIPMENT_ARMOR_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'light', label: 'Any Light Armor' },
  { value: 'medium', label: 'Any Medium Armor' },
  { value: 'heavy', label: 'Any Heavy Armor' },
  { value: 'shield', label: 'A Shield' },
];
export const EQUIPMENT_TOOL_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'art', label: "Any Artisan's Tools" },
  { value: 'game', label: 'Any Gaming Set' },
  { value: 'music', label: 'Any Musical Instrument' },
];
export const EQUIPMENT_FOCUS_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'arcane', label: 'Any Arcane Focus' },
  { value: 'druidic', label: 'A Druidic Focus' },
  { value: 'holy', label: 'A Holy Symbol' },
];
export const EQUIPMENT_CURRENCY_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'pp', label: 'Platinum (pp)' },
  { value: 'gp', label: 'Gold (gp)' },
  { value: 'ep', label: 'Electrum (ep)' },
  { value: 'sp', label: 'Silver (sp)' },
  { value: 'cp', label: 'Copper (cp)' },
];

/** Dropdown order + labels for the leaf-type selector. */
export const EQUIPMENT_OPTION_TYPE_OPTIONS: ReadonlyArray<{ value: EquipmentOptionType; label: string }> = [
  { value: 'linked', label: 'Specific Item' },
  { value: 'weapon', label: 'Weapon (category)' },
  { value: 'armor', label: 'Armor (category)' },
  { value: 'tool', label: 'Tool (category)' },
  { value: 'focus', label: 'Spellcasting Focus' },
  { value: 'currency', label: 'Currency' },
];

const CATEGORY_LABELS: Record<Exclude<EquipmentOptionType, 'linked'>, Record<string, string>> = {
  weapon: Object.fromEntries(EQUIPMENT_WEAPON_OPTIONS.map(o => [o.value, o.label])),
  armor: Object.fromEntries(EQUIPMENT_ARMOR_OPTIONS.map(o => [o.value, o.label])),
  tool: Object.fromEntries(EQUIPMENT_TOOL_OPTIONS.map(o => [o.value, o.label])),
  focus: Object.fromEntries(EQUIPMENT_FOCUS_OPTIONS.map(o => [o.value, o.label])),
  currency: Object.fromEntries(EQUIPMENT_CURRENCY_OPTIONS.map(o => [o.value, o.label])),
};

// ─── Factory helpers ─────────────────────────────────────────────────────

export function emptyEquipmentGroup(type: EquipmentGroupType = 'OR'): EquipmentGroup {
  return { kind: 'group', type, children: [] };
}
export function emptyEquipmentOption(type: EquipmentOptionType = 'linked'): EquipmentOption {
  return { kind: 'option', type, key: '', count: type === 'currency' ? 10 : 1, requiresProficiency: false };
}

// ─── Readable preview (editor + viewer) ──────────────────────────────────

export interface StartingEquipmentLookup {
  /** item PK → display name, for `linked` leaves. */
  itemNameById?: Record<string, string>;
}

function formatOption(opt: EquipmentOption, lookup: StartingEquipmentLookup): string {
  const qty = opt.count && opt.count > 1 ? opt.count : null;
  if (opt.type === 'linked') {
    const name = lookup.itemNameById?.[opt.key] ?? (opt.key || '(unset item)');
    return qty ? `${qty} ${name}` : name;
  }
  if (opt.type === 'currency') {
    return `${opt.count ?? 0} ${opt.key || 'gp'}`;
  }
  const label = CATEGORY_LABELS[opt.type]?.[opt.key] ?? opt.key ?? `(unset ${opt.type})`;
  const prof = opt.requiresProficiency ? ' (if proficient)' : '';
  // "2× Any Simple Weapon" reads cleaner than "2 Any Simple Weapon" for counts.
  return qty ? `${qty}× ${label}${prof}` : `${label}${prof}`;
}

/**
 * Render the equipment tree as readable text — used by the editor's live
 * preview and as a fallback display. Mirrors `formatRequirementText`: AND
 * groups join with " and ", OR groups with " or ", nested groups parenthesise.
 */
export function formatStartingEquipment(
  roots: EquipmentNode[] | null | undefined,
  lookup: StartingEquipmentLookup = {},
  _nested = false,
): string {
  if (!roots || roots.length === 0) return '';
  const formatNode = (node: EquipmentNode, nested: boolean): string => {
    if (isEquipmentOption(node)) return formatOption(node, lookup);
    const children = node.children.filter(Boolean);
    if (children.length === 0) return '';
    if (children.length === 1) return formatNode(children[0], nested);
    const joiner = node.type === 'AND' ? ' and ' : ' or ';
    const joined = children.map(c => formatNode(c, true)).join(joiner);
    return nested ? `(${joined})` : joined;
  };
  // Multiple top-level entries are independent "lines" — join with "; ".
  return roots.map(n => formatNode(n, _nested)).filter(Boolean).join('; ');
}
