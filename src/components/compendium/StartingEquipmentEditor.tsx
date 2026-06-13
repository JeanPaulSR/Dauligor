import React from 'react';
import { Plus, Trash2, Layers, Package } from 'lucide-react';
import {
  EquipmentNode,
  EquipmentGroup,
  EquipmentOption,
  EquipmentGroupType,
  EquipmentOptionType,
  EQUIPMENT_OPTION_TYPE_OPTIONS,
  EQUIPMENT_WEAPON_OPTIONS,
  EQUIPMENT_ARMOR_OPTIONS,
  EQUIPMENT_TOOL_OPTIONS,
  EQUIPMENT_FOCUS_OPTIONS,
  EQUIPMENT_CURRENCY_OPTIONS,
  emptyEquipmentGroup,
  emptyEquipmentOption,
  isEquipmentGroup,
  isEquipmentOption,
  formatStartingEquipment,
} from '../../lib/startingEquipment';
import SingleSelectSearch from '../ui/SingleSelectSearch';

/**
 * Class / background starting-equipment editor.
 *
 * Edits the NESTED authoring tree (`EquipmentNode[]`) that serializes to the
 * `starting_equipment_data` column and flattens to dnd5e's
 * `system.startingEquipment` on export. Mirrors `RequirementsEditor`'s
 * recursive group/leaf structure:
 *
 *   - Top level is a list of independent "equipment lines" (each usually an
 *     OR group — "(a) chain mail OR (b) leather armor + longbow").
 *   - A *group* combines children with AND (granted together) or OR (choose
 *     one).
 *   - An *option* leaf is a specific item, a category ("any martial weapon"),
 *     a spellcasting focus, or currency.
 *
 * The parent owns the tree state + persistence (a JSON column); this component
 * never fetches or saves.
 */

const GROUP_TYPE_OPTIONS: Array<{ value: EquipmentGroupType; label: string; summary: string }> = [
  { value: 'OR', label: 'Choose one (or)', summary: 'the character picks one entry below' },
  { value: 'AND', label: 'All of (and)', summary: 'every entry below is granted together' },
];

export interface StartingEquipmentEditorProps {
  value: EquipmentNode[];
  onChange: (next: EquipmentNode[]) => void;
  /** Item catalog for `linked` (specific-item) leaves: `{ id, name, hint? }`. */
  items: Array<{ id: string; name: string; hint?: string }>;
  label?: string;
}

export default function StartingEquipmentEditor({
  value,
  onChange,
  items,
  label = 'Starting Equipment',
}: StartingEquipmentEditorProps) {
  const roots = value ?? [];

  const setRootAt = (index: number, node: EquipmentNode | null) => {
    const next = roots.slice();
    if (node === null) next.splice(index, 1);
    else next[index] = node;
    onChange(next);
  };
  const addRoot = (node: EquipmentNode) => onChange([...roots, node]);

  // Live preview routes through the same formatter a viewer would use, so the
  // author sees exactly how the tree reads.
  const itemNameById = React.useMemo(() => {
    const m: Record<string, string> = {};
    for (const it of items) m[it.id] = it.name;
    return m;
  }, [items]);
  const preview = formatStartingEquipment(roots, { itemNameById });

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between pt-1">
        <label className="text-xs font-bold uppercase tracking-widest text-ink/45">{label}</label>
        {roots.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="text-[10px] text-ink/35 hover:text-blood underline"
          >
            Clear all
          </button>
        )}
      </div>
      <p className="text-[10px] text-ink/45">
        Build the equipment a character of this class starts with. <span className="font-semibold">Add Item</span> grants a
        single thing; <span className="font-semibold">Add Choice Group</span> lets the player choose one of several (or
        bundles several together). Exports to Foundry's native equipment prompt.
      </p>

      {roots.length === 0 ? (
        <div className="border border-gold/15 border-dashed rounded-md bg-background/20 px-3 py-4 space-y-2">
          <p className="text-[10px] text-ink/35 italic">
            No structured starting equipment. Add a single item, or a choice group to model "(a) … or (b) …".
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => addRoot(emptyEquipmentOption('linked'))}
              className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-gold border border-gold/35 rounded hover:bg-gold/15 transition-colors"
            >
              <Plus className="w-3 h-3" /> Add Item
            </button>
            <button
              type="button"
              onClick={() => addRoot(emptyEquipmentGroup('OR'))}
              className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-gold border border-gold/35 rounded hover:bg-gold/15 transition-colors"
            >
              <Layers className="w-3 h-3" /> Add Choice Group
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          {roots.map((node, idx) => (
            <div key={idx}>
              {isEquipmentGroup(node) ? (
                <GroupNode
                  value={node}
                  onChange={(next) => setRootAt(idx, next)}
                  onDelete={() => setRootAt(idx, null)}
                  items={items}
                  depth={0}
                />
              ) : (
                <OptionNode
                  value={node}
                  onChange={(next) => setRootAt(idx, next)}
                  onDelete={() => setRootAt(idx, null)}
                  items={items}
                />
              )}
            </div>
          ))}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => addRoot(emptyEquipmentOption('linked'))}
              className="flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-gold/85 border border-gold/25 rounded hover:bg-gold/15 transition-colors"
            >
              <Plus className="w-2.5 h-2.5" /> Add Item
            </button>
            <button
              type="button"
              onClick={() => addRoot(emptyEquipmentGroup('OR'))}
              className="flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-gold/85 border border-gold/25 rounded hover:bg-gold/15 transition-colors"
            >
              <Layers className="w-2.5 h-2.5" /> Add Choice Group
            </button>
          </div>
        </div>
      )}

      {preview && (
        <div className="rounded border border-gold/15 bg-background/40 px-3 py-2">
          <span className="text-[9px] uppercase tracking-widest text-ink/45">Reads as · </span>
          <span className="text-xs italic text-ink/85">{preview}</span>
        </div>
      )}
    </div>
  );
}

// ─── Group ───────────────────────────────────────────────────────────────

interface GroupNodeProps {
  value: EquipmentGroup;
  onChange: (next: EquipmentGroup) => void;
  onDelete: () => void;
  items: StartingEquipmentEditorProps['items'];
  depth: number;
}

function GroupNode({ value, onChange, onDelete, items, depth }: GroupNodeProps) {
  const update = (patch: Partial<EquipmentGroup>) => onChange({ ...value, ...patch });
  const setChildAt = (index: number, child: EquipmentNode | null) => {
    const next = value.children.slice();
    if (child === null) next.splice(index, 1);
    else next[index] = child;
    update({ children: next });
  };
  const addChild = (child: EquipmentNode) => update({ children: [...value.children, child] });

  const summary = GROUP_TYPE_OPTIONS.find(o => o.value === value.type)?.summary ?? '';

  return (
    <div className={`border border-gold/15 rounded-md bg-background/20 ${depth > 0 ? 'mt-2' : ''}`}>
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-gold/15 bg-card/30">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Layers className="w-3 h-3 text-gold/65 shrink-0" />
          <select
            value={value.type}
            onChange={e => update({ type: e.target.value as EquipmentGroupType })}
            className="h-6 px-1.5 text-[11px] font-bold uppercase tracking-wider bg-background/50 border border-gold/15 focus:border-gold rounded outline-none"
          >
            {GROUP_TYPE_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <span className="text-[10px] italic text-ink/35 truncate">{summary}</span>
        </div>
        <button
          type="button"
          onClick={onDelete}
          className="text-blood/60 hover:text-blood shrink-0"
          aria-label="Remove group"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      <div className="px-3 py-2 space-y-1.5">
        {value.children.length === 0 && (
          <p className="text-[10px] text-ink/35 italic">Empty group — add at least one item or sub-group.</p>
        )}
        {value.children.map((child, idx) => (
          <div key={idx}>
            {isEquipmentGroup(child) ? (
              <GroupNode
                value={child}
                onChange={(next) => setChildAt(idx, next)}
                onDelete={() => setChildAt(idx, null)}
                items={items}
                depth={depth + 1}
              />
            ) : (
              <OptionNode
                value={child}
                onChange={(next) => setChildAt(idx, next)}
                onDelete={() => setChildAt(idx, null)}
                items={items}
              />
            )}
          </div>
        ))}
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={() => addChild(emptyEquipmentOption('linked'))}
            className="flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-gold/85 border border-gold/25 rounded hover:bg-gold/15 transition-colors"
          >
            <Plus className="w-2.5 h-2.5" /> Add Item
          </button>
          <button
            type="button"
            onClick={() => addChild(emptyEquipmentGroup('AND'))}
            className="flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-gold/85 border border-gold/25 rounded hover:bg-gold/15 transition-colors"
          >
            <Layers className="w-2.5 h-2.5" /> Add Group
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Option (leaf) ───────────────────────────────────────────────────────

interface OptionNodeProps {
  value: EquipmentOption;
  onChange: (next: EquipmentOption) => void;
  onDelete: () => void;
  items: StartingEquipmentEditorProps['items'];
}

function OptionNode({ value, onChange, onDelete, items }: OptionNodeProps) {
  // Switching type reseeds the leaf — a weapon category key is meaningless
  // once the type is "linked", so we don't try to preserve key across types.
  const changeType = (next: EquipmentOptionType) => onChange(emptyEquipmentOption(next));

  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5 border border-gold/15 rounded bg-background/30 flex-wrap">
      <Package className="w-3 h-3 text-gold/55 shrink-0" />
      <select
        value={value.type}
        onChange={e => changeType(e.target.value as EquipmentOptionType)}
        className="h-7 px-1.5 text-[11px] bg-background/50 border border-gold/15 focus:border-gold rounded outline-none shrink-0"
      >
        {EQUIPMENT_OPTION_TYPE_OPTIONS.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      <div className="flex items-center gap-1.5 flex-1 min-w-0 flex-wrap">
        <OptionPayload value={value} onChange={onChange} items={items} />
      </div>

      <button
        type="button"
        onClick={onDelete}
        className="text-blood/60 hover:text-blood shrink-0"
        aria-label="Remove item"
      >
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  );
}

function OptionPayload({
  value,
  onChange,
  items,
}: {
  value: EquipmentOption;
  onChange: (next: EquipmentOption) => void;
  items: StartingEquipmentEditorProps['items'];
}) {
  // Shared count input (quantity). Hidden for category leaves where a count
  // rarely makes sense; shown for linked + currency.
  const countInput = (
    <label className="flex items-center gap-1 text-[10px] text-ink/45 shrink-0">
      <span className="uppercase tracking-wider">×</span>
      <input
        type="number"
        min={1}
        value={value.count ?? 1}
        onChange={e => onChange({ ...value, count: parseInt(e.target.value) || 1 })}
        className="h-7 w-14 px-2 text-[11px] bg-background/50 border border-gold/15 focus:border-gold rounded outline-none no-number-spin"
      />
    </label>
  );

  // requiresProficiency toggle — relevant to category leaves ("a martial
  // weapon you are proficient with").
  const profToggle = (
    <label className="flex items-center gap-1 text-[10px] text-ink/55 cursor-pointer shrink-0">
      <input
        type="checkbox"
        checked={!!value.requiresProficiency}
        onChange={e => onChange({ ...value, requiresProficiency: e.target.checked })}
        className="w-3 h-3 rounded border-gold/25 text-gold focus:ring-gold"
      />
      if proficient
    </label>
  );

  switch (value.type) {
    case 'linked':
      return (
        <>
          <SingleSelectSearch
            value={value.key}
            onChange={(id) => onChange({ ...value, key: id })}
            options={items}
            placeholder={items.length === 0 ? '(no items loaded)' : 'Select item…'}
            noEntitiesText="No items in the catalog."
            disabled={items.length === 0}
            triggerClassName="min-w-[180px] max-w-[260px]"
          />
          {countInput}
        </>
      );

    case 'weapon':
      return (
        <>
          <CategorySelect value={value.key} options={EQUIPMENT_WEAPON_OPTIONS} onChange={(k) => onChange({ ...value, key: k })} placeholder="Weapon category…" />
          {profToggle}
        </>
      );

    case 'armor':
      return (
        <>
          <CategorySelect value={value.key} options={EQUIPMENT_ARMOR_OPTIONS} onChange={(k) => onChange({ ...value, key: k })} placeholder="Armor category…" />
          {profToggle}
        </>
      );

    case 'tool':
      return (
        <>
          <CategorySelect value={value.key} options={EQUIPMENT_TOOL_OPTIONS} onChange={(k) => onChange({ ...value, key: k })} placeholder="Tool category…" />
          {profToggle}
        </>
      );

    case 'focus':
      return (
        <CategorySelect value={value.key} options={EQUIPMENT_FOCUS_OPTIONS} onChange={(k) => onChange({ ...value, key: k })} placeholder="Focus type…" />
      );

    case 'currency':
      return (
        <>
          {countInput}
          <CategorySelect value={value.key} options={EQUIPMENT_CURRENCY_OPTIONS} onChange={(k) => onChange({ ...value, key: k })} placeholder="Denomination…" />
        </>
      );
  }
}

function CategorySelect({
  value,
  options,
  onChange,
  placeholder,
}: {
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (key: string) => void;
  placeholder: string;
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="h-7 px-1.5 text-[11px] bg-background/50 border border-gold/15 focus:border-gold rounded outline-none min-w-[160px]"
    >
      <option value="">{placeholder}</option>
      {options.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}
