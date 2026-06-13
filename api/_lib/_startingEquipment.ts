// =============================================================================
// SERVER COPY of the export-relevant half of src/lib/startingEquipment.ts —
// the types, parse, collectLinkedItemKeys, and flatten helpers that
// `_classExport.ts` needs to emit `startingEquipmentData` into the Foundry
// class bundle. The editor-only helpers (factory/format/option lists) are NOT
// copied here.
//
// DRIFT WARNING: mirrors src/lib/startingEquipment.ts. When you change the
// EquipmentEntryData shape, parse normalization, or flatten logic, update BOTH.
// =============================================================================

export type EquipmentOptionType = 'linked' | 'weapon' | 'armor' | 'tool' | 'focus' | 'currency';
export type EquipmentGroupType = 'AND' | 'OR';

const OPTION_TYPES = new Set<EquipmentOptionType>(['linked', 'weapon', 'armor', 'tool', 'focus', 'currency']);

export interface EquipmentOption {
  kind: 'option';
  type: EquipmentOptionType;
  key: string;
  count?: number;
  requiresProficiency?: boolean;
}

export interface EquipmentGroup {
  kind: 'group';
  type: EquipmentGroupType;
  children: EquipmentNode[];
}

export type EquipmentNode = EquipmentGroup | EquipmentOption;

export interface EquipmentEntryData {
  _id: string;
  group: string | null;
  sort: number;
  type: EquipmentGroupType | EquipmentOptionType;
  count?: number;
  key?: string;
  requiresProficiency?: boolean;
}

export function isEquipmentGroup(node: EquipmentNode): node is EquipmentGroup {
  return node.kind === 'group';
}
export function isEquipmentOption(node: EquipmentNode): node is EquipmentOption {
  return node.kind === 'option';
}

export function parseEquipmentTree(raw: unknown): EquipmentNode[] {
  if (raw == null || raw === '') return [];
  let value: any = raw;
  if (typeof raw === 'string') {
    try { value = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(value)) return [];
  return value.map(normalizeNode).filter(Boolean) as EquipmentNode[];
}

function normalizeNode(input: any): EquipmentNode | null {
  if (!input || typeof input !== 'object') return null;
  if (input.kind === 'group' || input.type === 'AND' || input.type === 'OR') {
    const type: EquipmentGroupType = input.type === 'AND' ? 'AND' : 'OR';
    const children = Array.isArray(input.children)
      ? (input.children.map(normalizeNode).filter(Boolean) as EquipmentNode[])
      : [];
    return { kind: 'group', type, children };
  }
  if (input.kind === 'option' || OPTION_TYPES.has(input.type)) {
    if (!OPTION_TYPES.has(input.type)) return null;
    const node: EquipmentOption = { kind: 'option', type: input.type, key: String(input.key ?? '') };
    if (input.count != null && Number.isFinite(Number(input.count))) node.count = Number(input.count);
    if (input.requiresProficiency) node.requiresProficiency = true;
    return node;
  }
  return null;
}

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function makeEntryId(): string {
  let s = '';
  for (let i = 0; i < 16; i++) s += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
  return s;
}

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
  makeId?: () => string;
  linkedKeyFor?: (key: string) => string;
}

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
