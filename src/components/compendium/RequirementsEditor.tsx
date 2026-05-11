import React from 'react';
import { Plus, Trash2, Layers } from 'lucide-react';
import {
  Requirement,
  RequirementGroup,
  RequirementLeaf,
  RequirementLeafType,
  RequirementGroupKind,
  AbilityKey,
  ProficiencyKind,
  emptyGroup,
  emptyLeaf,
  isGroup,
  isLeaf,
} from '../../lib/requirements';
import SingleSelectSearch from '../ui/SingleSelectSearch';

/**
 * Lookup shape consumed by the leaf-row pickers. Each list is `{ id, name }`
 * and is sorted by the caller — we render them as-is. Option groups carry
 * their items inline so the `optionItem` leaf can offer a cascading
 * group → item picker without a second fetch.
 *
 * Every list is optional: if the parent editor doesn't have a particular
 * entity loaded, the leaf type for it stays in the type dropdown but the
 * picker reads "(no … available)" and the value can't be set. We surface
 * the leaf type rather than hiding it because hiding leaves under feature
 * detection makes the editor's behaviour confusing.
 */
export interface RequirementsEditorLookups {
  classes?: Array<{ id: string; name: string }>;
  subclasses?: Array<{ id: string; name: string }>;
  features?: Array<{ id: string; name: string }>;
  spells?: Array<{ id: string; name: string }>;
  spellRules?: Array<{ id: string; name: string }>;
  /**
   * Modular Option Groups, with their items pre-attached. Used by the
   * `optionItem` leaf to render the cascading group → item picker. Pass
   * `null` for the items array if a group's items haven't been loaded;
   * the row will surface "(items not loaded)" rather than offering an
   * empty dropdown.
   */
  optionGroups?: Array<{
    id: string;
    name: string;
    items: Array<{ id: string; name: string }> | null;
  }>;
  /**
   * Proficiency pools per category, used by the `proficiency` leaf.
   * Each option carries `id` (the Foundry identifier — what gets
   * stored in `leaf.identifier`), `name` (display), and optional
   * `hint` (e.g. "Category" to distinguish e.g. "all Martial Weapons"
   * from a specific weapon, or the parent category name for
   * languages / tools).
   *
   * Callers should merge entity rows + category rows from the
   * matching tables before passing them through — see
   * UniqueOptionGroupEditor for the canonical fetch + merge pattern.
   */
  proficiencies?: Partial<Record<
    ProficiencyKind,
    Array<{ id: string; name: string; hint?: string }>
  >>;
}

export interface RequirementsEditorProps {
  value: Requirement | null;
  onChange: (next: Requirement | null) => void;
  lookups?: RequirementsEditorLookups;
  /** Inline label. Default: "Requirements". */
  label?: string;
}

// All leaf types in the order the dropdown renders them. Top section is
// the entity references most authors reach for first.
const LEAF_TYPE_OPTIONS: Array<{ value: RequirementLeafType; label: string }> = [
  { value: 'optionItem', label: 'Option Item' },
  { value: 'class', label: 'Class' },
  { value: 'subclass', label: 'Subclass' },
  { value: 'levelInClass', label: 'Class Level' },
  { value: 'feature', label: 'Class Feature' },
  { value: 'spell', label: 'Spell' },
  { value: 'spellRule', label: 'Spell Rule' },
  { value: 'abilityScore', label: 'Ability Score' },
  { value: 'proficiency', label: 'Proficiency' },
  { value: 'level', label: 'Character / Class Level' },
  { value: 'string', label: 'Free Text' },
];

const GROUP_KIND_OPTIONS: Array<{ value: RequirementGroupKind; label: string; summary: string }> = [
  { value: 'all', label: 'All (and)', summary: 'every requirement below must be met' },
  { value: 'any', label: 'Any (or)', summary: 'at least one must be met' },
  { value: 'one', label: 'Exactly One (xor)', summary: 'exactly one must be met — rare' },
];

const ABILITY_OPTIONS: Array<{ value: AbilityKey; label: string }> = [
  { value: 'str', label: 'STR' },
  { value: 'dex', label: 'DEX' },
  { value: 'con', label: 'CON' },
  { value: 'int', label: 'INT' },
  { value: 'wis', label: 'WIS' },
  { value: 'cha', label: 'CHA' },
];

const PROFICIENCY_OPTIONS: Array<{ value: ProficiencyKind; label: string }> = [
  { value: 'weapon', label: 'Weapon' },
  { value: 'armor', label: 'Armor' },
  { value: 'tool', label: 'Tool' },
  { value: 'skill', label: 'Skill' },
  { value: 'language', label: 'Language' },
];

/**
 * Shared requirements tree editor — used by Modular Option Group items
 * and (in batch 2) feats. The tree stores arbitrary And/Or/Xor groups of
 * typed leaves; this component is the single authoring surface.
 *
 * `value === null` renders a stub with two seed buttons (one requirement
 * vs one group). The author picks the entry point, and everything from
 * there cascades through recursive `<GroupNode>` / `<LeafNode>` renders.
 *
 * The component never persists itself — the parent owns the tree state
 * and the persistence path (a JSON column). `onChange(null)` is emitted
 * when the user empties the tree all the way back to nothing.
 */
export default function RequirementsEditor({
  value,
  onChange,
  lookups = {},
  label = 'Requirements',
}: RequirementsEditorProps) {
  const seedWithGroup = (kind: RequirementGroupKind) => {
    onChange({ kind, children: [] });
  };
  const seedWithLeaf = () => {
    // Default to optionItem since that's the most common gate authors reach
    // for on Modular Option Group items (Pact-of-X chains, invocation tiers).
    onChange(emptyLeaf('optionItem'));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-bold uppercase tracking-widest text-ink/40">{label}</label>
        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-[10px] text-ink/30 hover:text-blood underline"
          >
            Clear all
          </button>
        )}
      </div>

      {!value ? (
        <div className="border border-gold/10 border-dashed rounded-md bg-background/20 px-3 py-4 space-y-2">
          <p className="text-[10px] text-ink/30 italic">
            No compound requirements. Add a single rule, or start with a group to combine multiple rules.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={seedWithLeaf}
              className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-gold border border-gold/30 rounded hover:bg-gold/10 transition-colors"
            >
              <Plus className="w-3 h-3" /> Add Requirement
            </button>
            <button
              type="button"
              onClick={() => seedWithGroup('all')}
              className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-gold border border-gold/30 rounded hover:bg-gold/10 transition-colors"
            >
              <Layers className="w-3 h-3" /> Add Group
            </button>
          </div>
        </div>
      ) : isGroup(value) ? (
        <GroupNode
          value={value}
          onChange={onChange}
          onDelete={() => onChange(null)}
          lookups={lookups}
          depth={0}
        />
      ) : (
        <LeafNode
          value={value}
          onChange={(next) => onChange(next)}
          onDelete={() => onChange(null)}
          lookups={lookups}
        />
      )}
    </div>
  );
}

// ─── Group ───────────────────────────────────────────────────────────────

interface GroupNodeProps {
  value: RequirementGroup;
  onChange: (next: RequirementGroup) => void;
  onDelete: () => void;
  lookups: RequirementsEditorLookups;
  depth: number;
}

function GroupNode({ value, onChange, onDelete, lookups, depth }: GroupNodeProps) {
  const update = (patch: Partial<RequirementGroup>) => {
    onChange({ ...value, ...patch });
  };
  const setChildAt = (index: number, child: Requirement | null) => {
    const next = value.children.slice();
    if (child === null) next.splice(index, 1);
    else next[index] = child;
    update({ children: next });
  };
  const addChild = (child: Requirement) => {
    update({ children: [...value.children, child] });
  };

  const currentSummary = GROUP_KIND_OPTIONS.find(o => o.value === value.kind)?.summary ?? '';

  return (
    <div
      className={`border border-gold/15 rounded-md bg-background/20 ${depth > 0 ? 'mt-2' : ''}`}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-gold/10 bg-card/30">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Layers className="w-3 h-3 text-gold/60 shrink-0" />
          <select
            value={value.kind}
            onChange={e => update({ kind: e.target.value as RequirementGroupKind })}
            className="h-6 px-1.5 text-[11px] font-bold uppercase tracking-wider bg-background/50 border border-gold/10 focus:border-gold rounded outline-none"
          >
            {GROUP_KIND_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <span className="text-[10px] italic text-ink/30 truncate">{currentSummary}</span>
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
          <p className="text-[10px] text-ink/30 italic">
            Empty group — add at least one requirement below.
          </p>
        )}
        {value.children.map((child, idx) => (
          <div key={idx}>
            {isGroup(child) ? (
              <GroupNode
                value={child}
                onChange={(next) => setChildAt(idx, next)}
                onDelete={() => setChildAt(idx, null)}
                lookups={lookups}
                depth={depth + 1}
              />
            ) : (
              <LeafNode
                value={child}
                onChange={(next) => setChildAt(idx, next)}
                onDelete={() => setChildAt(idx, null)}
                lookups={lookups}
              />
            )}
          </div>
        ))}
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={() => addChild(emptyLeaf('optionItem'))}
            className="flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-gold/80 border border-gold/20 rounded hover:bg-gold/10 transition-colors"
          >
            <Plus className="w-2.5 h-2.5" /> Add Requirement
          </button>
          <button
            type="button"
            onClick={() => addChild(emptyGroup('all'))}
            className="flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-gold/80 border border-gold/20 rounded hover:bg-gold/10 transition-colors"
          >
            <Layers className="w-2.5 h-2.5" /> Add Group
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Leaf ────────────────────────────────────────────────────────────────

interface LeafNodeProps {
  value: RequirementLeaf;
  onChange: (next: RequirementLeaf) => void;
  onDelete: () => void;
  lookups: RequirementsEditorLookups;
}

function LeafNode({ value, onChange, onDelete, lookups }: LeafNodeProps) {
  // Type-change cycles the payload back to the empty seed for the new
  // type. We don't try to preserve fields across a type change — every
  // payload's fields are distinct enough that a "smart merge" tends to
  // surface as bugs (e.g. carrying a stale classId after switching to
  // levelInClass would re-bind to the same class silently).
  const changeType = (next: RequirementLeafType) => onChange(emptyLeaf(next));

  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5 border border-gold/10 rounded bg-background/30">
      <select
        value={value.type}
        onChange={e => changeType(e.target.value as RequirementLeafType)}
        className="h-7 px-1.5 text-[11px] bg-background/50 border border-gold/10 focus:border-gold rounded outline-none shrink-0"
      >
        {LEAF_TYPE_OPTIONS.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      <div className="flex items-center gap-1.5 flex-1 min-w-0 flex-wrap">
        <LeafPayload value={value} onChange={onChange} lookups={lookups} />
      </div>

      <button
        type="button"
        onClick={onDelete}
        className="text-blood/60 hover:text-blood shrink-0"
        aria-label="Remove requirement"
      >
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  );
}

// Per-type payload renderer. Keeping this as a switch inside one component
// (rather than 10 sibling components) keeps the leaf row layout local and
// avoids prop-drilling lookups through wrappers that just unpack one field.
function LeafPayload({
  value,
  onChange,
  lookups,
}: {
  value: RequirementLeaf;
  onChange: (next: RequirementLeaf) => void;
  lookups: RequirementsEditorLookups;
}) {
  switch (value.type) {
    case 'level':
      return (
        <>
          <input
            type="number"
            min={1}
            value={value.minLevel}
            onChange={e => onChange({ ...value, minLevel: parseInt(e.target.value) || 1 })}
            className="h-7 w-16 px-2 text-[11px] bg-background/50 border border-gold/10 focus:border-gold rounded outline-none"
          />
          <label className="flex items-center gap-1 text-[10px] text-ink/50 cursor-pointer">
            <input
              type="checkbox"
              checked={value.isTotal}
              onChange={e => onChange({ ...value, isTotal: e.target.checked })}
              className="w-3 h-3 rounded border-gold/20 text-gold focus:ring-gold"
            />
            Total character level
          </label>
        </>
      );

    case 'levelInClass':
      return (
        <>
          <EntitySelect
            entities={lookups.classes}
            value={value.classId}
            onChange={(id) => onChange({ ...value, classId: id })}
            placeholder="Select class…"
            emptyLabel="(no classes available)"
          />
          <input
            type="number"
            min={1}
            value={value.minLevel}
            onChange={e => onChange({ ...value, minLevel: parseInt(e.target.value) || 1 })}
            className="h-7 w-14 px-2 text-[11px] bg-background/50 border border-gold/10 focus:border-gold rounded outline-none"
          />
          <span className="text-[10px] text-ink/40">level+</span>
        </>
      );

    case 'class':
      return (
        <EntitySelect
          entities={lookups.classes}
          value={value.classId}
          onChange={(id) => onChange({ ...value, classId: id })}
          placeholder="Select class…"
          emptyLabel="(no classes available)"
        />
      );

    case 'subclass':
      return (
        <EntitySelect
          entities={lookups.subclasses}
          value={value.subclassId}
          onChange={(id) => onChange({ ...value, subclassId: id })}
          placeholder="Select subclass…"
          emptyLabel="(no subclasses available)"
        />
      );

    case 'optionItem': {
      // Cascading group → item picker, both promoted to SingleSelectSearch
      // (searchable single-pick comboboxes) — with 50+ option groups
      // and hundreds of items in aggregate, a plain <select> for either
      // half is unusable.
      //
      // `resolvedGroupId` derives a group either from the leaf's own
      // `groupId` (the editor stores it as a convenience for the
      // formatter / exporter) or by walking groups to find one that
      // contains the chosen itemId. Picking a new group clears the
      // itemId; picking an item locks in the resolved group.
      const groups = lookups.optionGroups ?? [];
      const resolvedGroupId =
        value.groupId ??
        groups.find(g => (g.items ?? []).some(i => i.id === value.itemId))?.id ??
        '';
      const items = groups.find(g => g.id === resolvedGroupId)?.items;
      const itemsLoaded = items != null;
      return (
        <>
          <SingleSelectSearch
            value={resolvedGroupId}
            onChange={(nextGroupId) => onChange({
              kind: 'leaf',
              type: 'optionItem',
              itemId: '',
              groupId: nextGroupId || undefined,
            })}
            options={groups.map(g => ({ id: g.id, name: g.name }))}
            placeholder="Select group…"
            noEntitiesText="No option groups available."
            triggerClassName="min-w-[160px] max-w-[200px]"
          />
          <SingleSelectSearch
            value={value.itemId}
            onChange={(nextItemId) => onChange({
              ...value,
              itemId: nextItemId,
              groupId: resolvedGroupId || undefined,
            })}
            options={(items ?? []).map(it => ({ id: it.id, name: it.name }))}
            placeholder={!resolvedGroupId ? 'Pick group first' : 'Select option…'}
            noEntitiesText={itemsLoaded ? 'Group has no options yet.' : '(items not loaded)'}
            disabled={!resolvedGroupId || !itemsLoaded}
            triggerClassName="min-w-[180px] max-w-[240px]"
          />
        </>
      );
    }

    case 'feature':
      return (
        <EntitySelect
          entities={lookups.features}
          value={value.featureId}
          onChange={(id) => onChange({ ...value, featureId: id })}
          placeholder="Select feature…"
          emptyLabel="(no features available)"
        />
      );

    case 'spell':
      return (
        <EntitySelect
          entities={lookups.spells}
          value={value.spellId}
          onChange={(id) => onChange({ ...value, spellId: id })}
          placeholder="Select spell…"
          emptyLabel="(no spells available)"
        />
      );

    case 'spellRule':
      return (
        <EntitySelect
          entities={lookups.spellRules}
          value={value.spellRuleId}
          onChange={(id) => onChange({ ...value, spellRuleId: id })}
          placeholder="Select spell rule…"
          emptyLabel="(no spell rules available)"
        />
      );

    case 'abilityScore':
      return (
        <>
          <select
            value={value.ability}
            onChange={e => onChange({ ...value, ability: e.target.value as AbilityKey })}
            className="h-7 px-1.5 text-[11px] bg-background/50 border border-gold/10 focus:border-gold rounded outline-none"
          >
            {ABILITY_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <input
            type="number"
            min={1}
            max={30}
            value={value.min}
            onChange={e => onChange({ ...value, min: parseInt(e.target.value) || 1 })}
            className="h-7 w-14 px-2 text-[11px] bg-background/50 border border-gold/10 focus:border-gold rounded outline-none"
          />
          <span className="text-[10px] text-ink/40">or higher</span>
        </>
      );

    case 'proficiency': {
      // Pulls from the campaign's authored proficiency pools rather
      // than asking the author to remember Foundry-key identifiers.
      // `lookups.proficiencies[category]` is expected to be a merged
      // list of specific entities (weapons / armor / tools / skills /
      // languages) plus their category rows (e.g. "all Martial
      // Weapons" → identifier `mar`). Hint badge differentiates them.
      const pool = lookups.proficiencies?.[value.category] ?? [];
      return (
        <>
          <select
            value={value.category}
            onChange={e => onChange({
              kind: 'leaf',
              type: 'proficiency',
              // Reset the identifier when changing category — a
              // weapon identifier doesn't make sense once the category
              // is "language" anymore.
              category: e.target.value as ProficiencyKind,
              identifier: '',
            })}
            className="h-7 px-1.5 text-[11px] bg-background/50 border border-gold/10 focus:border-gold rounded outline-none"
          >
            {PROFICIENCY_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <SingleSelectSearch
            value={value.identifier}
            onChange={(id) => onChange({ ...value, identifier: id })}
            options={pool}
            placeholder={`Select ${value.category}…`}
            noEntitiesText={`No ${value.category} proficiencies available. Seed the table in the admin panel.`}
            triggerClassName="min-w-[160px] max-w-[240px]"
          />
        </>
      );
    }

    case 'string':
      return (
        <input
          type="text"
          autoComplete="off"
          value={value.value}
          onChange={e => onChange({ ...value, value: e.target.value })}
          placeholder="Free-text requirement (e.g. 'Member of the Crimson Order')"
          className="h-7 flex-1 min-w-[200px] px-2 text-[11px] bg-background/50 border border-gold/10 focus:border-gold rounded outline-none"
        />
      );
  }
}

// Single-entity picker for the requirement leaves. Promoted from a
// plain <select> to <SingleSelectSearch> after authoring against ~50
// option groups exposed how unusable a native dropdown is at that
// scale — searching for "Pact of the Blade" in a flat list of
// invocations + maneuvers + pacts + fighting styles + mutations
// without a filter input is painful.
function EntitySelect({
  entities,
  value,
  onChange,
  placeholder,
  emptyLabel,
}: {
  entities: Array<{ id: string; name: string }> | undefined;
  value: string;
  onChange: (id: string) => void;
  placeholder: string;
  emptyLabel: string;
}) {
  const opts = entities ?? [];
  const empty = opts.length === 0;
  return (
    <SingleSelectSearch
      value={value}
      onChange={onChange}
      options={opts}
      placeholder={empty ? emptyLabel : placeholder}
      disabled={empty}
      triggerClassName="min-w-[140px] max-w-[240px]"
    />
  );
}
