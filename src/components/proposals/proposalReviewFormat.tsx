// =============================================================================
// proposalReviewFormat — humanize a proposal payload for review.
// =============================================================================
//
// A proposed_payload is the raw row that will be written to D1: snake_case
// columns at the top level, camelCase inside nested JSON, and a lot of empty /
// default fields (`saving_throws: []`, all-zero `proficiencies`, `wealth: ""`).
// Rendered verbatim it reads like a SQL dump.
//
// This module turns it into something a human reviews:
//   - humanizeFieldLabel: snake_case / camelCase column → "Title Case" label
//     (with overrides for the fields whose auto-title reads badly),
//   - isBlankValue: hide empty / default / false / zero fields so a CREATE
//     shows only what was actually set,
//   - FriendlyValue: render a value readably (chips, Yes/No, nested key/values,
//     prose) instead of JSON.stringify,
//   - AdvancementList: the big one — render a class/feature `advancements`
//     array as "L2 · Grant: Wild Shape" lines, resolving feature / option-group
//     / scaling-column references to names via the block's other drafts.
//
// Used by FieldDiff in BlockReviewPane.tsx (shared admin + creator review).
// =============================================================================

import type { ReactNode } from 'react';

// ── Field labels ──────────────────────────────────────────────────────────

// Overrides where the mechanical title-case reads wrong or terse. Everything
// else falls through to titleCase().
const FIELD_LABELS: Record<string, string> = {
  hit_die: 'Hit Die',
  hitDie: 'Hit Die',
  primary_ability: 'Primary Ability',
  primaryAbility: 'Primary Ability',
  primary_ability_choice: 'Primary Ability (choose one)',
  saving_throws: 'Saving Throw Proficiencies',
  savingThrows: 'Saving Throws',
  subclass_title: 'Subclass Label',
  subclass_feature_levels: 'Subclass Feature Levels',
  asi_levels: 'Ability Score Improvement Levels',
  starting_equipment: 'Starting Equipment',
  multiclass_proficiencies: 'Multiclass Proficiencies',
  tag_ids: 'Tags',
  feat_type: 'Feat Type',
  feature_type: 'Feature Type',
  item_type: 'Item Type',
  level_prerequisite: 'Level Prerequisite',
  string_prerequisite: 'Prerequisite',
  is_repeatable: 'Repeatable',
  is_subclass_feature: 'Subclass Feature',
  uses_max: 'Uses (max)',
  uses_period: 'Uses Period',
  uses_recovery: 'Uses Recovery',
  choiceCount: 'Choices',
  fixedIds: 'Always granted',
  optionIds: 'Options',
  categoryIds: 'Categories',
  // spells
  school: 'School',
  ritual: 'Ritual',
  concentration: 'Concentration',
  preparation_mode: 'Preparation',
  components_vocal: 'Verbal Component',
  components_somatic: 'Somatic Component',
  components_material: 'Material Component',
  components_material_text: 'Materials',
  components_consumed: 'Consumes Materials',
  components_cost: 'Material Cost',
  activation_bucket: 'Casting Time',
  range_bucket: 'Range',
  duration_bucket: 'Duration',
  shape_bucket: 'Shape',
  required_tags: 'Required Tags',
  prerequisite_text: 'Prerequisite',
  // items (item_type / feat_type / feature_type already labeled above)
  rarity: 'Rarity',
  attunement: 'Attunement',
  scaling_column_id: 'Scaling Column',
  quantity_column_id: 'Quantity Column',
};

function titleCase(key: string): string {
  const spaced = key
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return spaced.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function humanizeFieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? titleCase(key);
}

// ── Noise / blank suppression ────────────────────────────────────────────

// Columns never worth surfacing in a review: surrogate ids, foreign keys
// (shown via resolved names where it matters), slugs, timestamps, internal
// flags. The headline (entity label + name) already identifies the row.
export const NOISE_FIELDS = new Set([
  'id', '_id', 'slug', 'identifier',
  'source_id', 'sourceId',
  'created_at', 'updated_at', 'added_at', 'createdAt', 'updatedAt',
  'parent_id', 'parent_type', 'parentId', 'parentType',
  'class_id', 'classId', 'group_id', 'groupId', 'category_id', 'categoryId',
  'isBase', // advancement bookkeeping
  // Image-positioning blobs ({x,y,scale}) — layout metadata, not content.
  'image_display', 'card_display', 'preview_display',
  'imageDisplay', 'cardDisplay', 'previewDisplay',
  // Spell: the full Foundry export blob + the flat derived/duplicate fields
  // that mirror the clean *_bucket columns we DO surface (Casting Time /
  // Range / Duration / Shape). Hiding them removes the SQL-dump clutter.
  'foundry_data', 'foundryData',
  'activation_type', 'activation_value', 'activation_condition',
  'range_units', 'range_value', 'range_special',
  'duration_units', 'duration_value',
  'scaling_column_id', 'scalingColumnId', 'quantity_column_id', 'quantityColumnId',
]);

// A value is "blank" (not worth showing) when it's empty / default / false /
// zero — including objects whose every leaf is blank (an all-zero proficiency
// block) and arrays of only-blank entries. Aggressively treating 0/false as
// blank is what strips the 0/1-as-boolean and empty-count noise these payloads
// are full of; the rare meaningful 0 (a cantrip's level) is acceptable to omit
// from a glance-summary.
export function isBlankValue(v: any): boolean {
  if (v === null || v === undefined || v === '' || v === false || v === 0) return true;
  if (Array.isArray(v)) return v.every(isBlankValue);
  if (typeof v === 'object') {
    const vals = Object.values(v);
    return vals.length === 0 || vals.every(isBlankValue);
  }
  return false;
}

// Fields kept even when "blank" by the zero/empty rule, because a literal 0 is
// meaningful (a cantrip's spell level). Absent (undefined/null) values still drop.
const ALWAYS_KEEP_IF_PRESENT = new Set(['level']);

// Meaningful [key, value] entries of an object: drop noise keys + blank values
// (keeping the ALWAYS_KEEP fields whenever they're actually present).
export function meaningfulEntries(obj: Record<string, any>): [string, any][] {
  return Object.entries(obj).filter(([k, v]) => {
    if (NOISE_FIELDS.has(k)) return false;
    if (v === undefined || v === null) return false;
    if (ALWAYS_KEEP_IF_PRESENT.has(k)) return true;
    return !isBlankValue(v);
  });
}

// ── Coded values → labels ──────────────────────────────────────────────────

const SCHOOL_LABELS: Record<string, string> = {
  abj: 'Abjuration', con: 'Conjuration', div: 'Divination', enc: 'Enchantment',
  evo: 'Evocation', ill: 'Illusion', nec: 'Necromancy', trs: 'Transmutation',
};
const ABILITY_LABELS: Record<string, string> = {
  str: 'Strength', dex: 'Dexterity', con: 'Constitution',
  int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma',
};
const SKILL_LABELS: Record<string, string> = {
  acr: 'Acrobatics', ani: 'Animal Handling', arc: 'Arcana', ath: 'Athletics',
  dec: 'Deception', his: 'History', ins: 'Insight', inv: 'Investigation',
  itm: 'Intimidation', med: 'Medicine', nat: 'Nature', per: 'Persuasion',
  prc: 'Perception', prf: 'Performance', rel: 'Religion', slt: 'Sleight of Hand',
  ste: 'Stealth', sur: 'Survival',
};
const RARITY_LABELS: Record<string, string> = {
  none: 'None', common: 'Common', uncommon: 'Uncommon', rare: 'Rare',
  veryRare: 'Very Rare', legendary: 'Legendary', artifact: 'Artifact',
};
const PREPARATION_LABELS: Record<string, string> = {
  spell: 'Spell', always: 'Always Prepared', atwill: 'At-Will',
  innate: 'Innate', pact: 'Pact Magic', ritual: 'Ritual Only',
};
// Casting time / range / duration / shape bucket codes.
const BUCKET_LABELS: Record<string, string> = {
  action: 'Action', bonus: 'Bonus Action', reaction: 'Reaction',
  minute: 'Minutes', hour: 'Hours', day: 'Days', special: 'Special', none: 'None',
  self: 'Self', touch: 'Touch', ranged: 'Ranged', any: 'Any',
  inst: 'Instantaneous', perm: 'Until Dispelled', conc: 'Concentration',
  sphere: 'Sphere', cone: 'Cone', cube: 'Cube', cylinder: 'Cylinder',
  line: 'Line', radius: 'Radius', square: 'Square', wall: 'Wall',
};

// fieldKey → code→label map for enum-coded scalar / array values.
const ENUM_FIELD_MAPS: Record<string, Record<string, string>> = {
  school: SCHOOL_LABELS,
  primary_ability: ABILITY_LABELS,
  primaryAbility: ABILITY_LABELS,
  primary_ability_choice: ABILITY_LABELS,
  saving_throws: ABILITY_LABELS,
  savingThrows: ABILITY_LABELS,
  ability_id: ABILITY_LABELS,
  abilityId: ABILITY_LABELS,
  ability: ABILITY_LABELS,
  spellcasting_ability: ABILITY_LABELS,
  spellcastingAbility: ABILITY_LABELS,
  rarity: RARITY_LABELS,
  preparation_mode: PREPARATION_LABELS,
  activation_bucket: BUCKET_LABELS,
  range_bucket: BUCKET_LABELS,
  duration_bucket: BUCKET_LABELS,
  shape_bucket: BUCKET_LABELS,
};

function labelFromMap(map: Record<string, string>, code: any): string {
  const key = String(code);
  return map[key] ?? titleCase(key);
}

export function enumMapFor(fieldKey: string): Record<string, string> | null {
  return ENUM_FIELD_MAPS[fieldKey] ?? null;
}

// 0/1/true/false columns rendered as Yes/No. (false/0 are blank-suppressed, so
// in a CREATE these only ever surface as "Yes"; an UPDATE shows either side.)
const BOOLEAN_FIELDS = new Set([
  'ritual', 'concentration',
  'components_vocal', 'components_somatic', 'components_material', 'components_consumed',
  'is_repeatable', 'isRepeatable', 'is_subclass_feature', 'isSubclassFeature',
  'magical', 'optional', 'prepared', 'identified',
]);

// Returns a formatted string for a known boolean / level / price field, or null
// to defer to the generic renderer. `entityType` scopes the ambiguous keys (a
// spell `level` 0 is a cantrip; a feature `level` 0 is not).
export function formatScalarField(
  entityType: string | undefined,
  fieldKey: string,
  value: any,
): string | null {
  if (BOOLEAN_FIELDS.has(fieldKey)) {
    return value === true || value === 1 || value === '1' ? 'Yes' : 'No';
  }
  if (fieldKey === 'level' && entityType === 'spell') {
    return Number(value) === 0 ? 'Cantrip' : `Level ${value}`;
  }
  if (fieldKey === 'price' && value && typeof value === 'object') {
    const v = (value as any).value;
    const d = (value as any).denomination;
    if (v === undefined || v === null || v === '') return null;
    return d ? `${v} ${d}` : String(v);
  }
  return null;
}

// ── Reference resolution ────────────────────────────────────────────────

// id → display name, built from the block's other drafts (see BlockReviewPane).
export type RefNames = Map<string, string>;

function resolveNames(ids: any[], refNames?: RefNames): { names: string[]; unresolved: number } {
  const names: string[] = [];
  let unresolved = 0;
  for (const raw of ids) {
    const id = typeof raw === 'string' ? raw : null;
    if (!id) continue;
    const name = refNames?.get(id);
    if (name) names.push(name);
    else unresolved += 1;
  }
  return { names, unresolved };
}

// ── Advancements ──────────────────────────────────────────────────────────

const ADVANCEMENT_LABELS: Record<string, string> = {
  HitPoints: 'Hit Points',
  AbilityScoreImprovement: 'Ability Score Improvement',
  ItemGrant: 'Grant',
  ItemChoice: 'Choice',
  ScaleValue: 'Scaling Value',
  Size: 'Size',
  Trait: 'Proficiency',
  Subclass: 'Subclass',
  GrantSpells: 'Grant Spells',
  ExtendSpellList: 'Extend Spell List',
  ItemBumpUses: 'Bump Uses',
};

// One-line human detail for a single advancement, resolving any referenced
// features / option groups / scaling columns to names from the block.
function advancementDetail(adv: any, refNames?: RefNames): string {
  const cfg = (adv && typeof adv.configuration === 'object' && adv.configuration) || {};
  switch (adv?.type) {
    case 'HitPoints':
      return cfg.hitDie ? `d${cfg.hitDie}` : '';
    case 'AbilityScoreImprovement':
      return '';
    case 'Subclass':
      return 'character chooses a subclass';
    case 'ScaleValue': {
      const ref = resolveNames([cfg.scalingColumnId, cfg.quantityColumnId], refNames);
      if (ref.names.length) return ref.names.join(', ');
      return cfg.identifier ? String(cfg.identifier) : '';
    }
    case 'Trait':
      return cfg.type ? `${titleCase(String(cfg.type))} proficiency` : 'proficiency';
    case 'GrantSpells':
    case 'ExtendSpellList':
      return 'spells';
    case 'ItemGrant':
    case 'ItemChoice': {
      const pool = [
        adv.featureId,
        ...(Array.isArray(cfg.pool) ? cfg.pool : []),
        ...(Array.isArray(cfg.optionalPool) ? cfg.optionalPool : []),
      ];
      const { names, unresolved } = resolveNames(pool, refNames);
      const count = adv.type === 'ItemChoice' && cfg.count ? `choose ${cfg.count} of ` : '';
      if (names.length) {
        const extra = unresolved > 0 ? ` +${unresolved} more` : '';
        return `${count}${names.join(', ')}${extra}`;
      }
      const total = pool.filter(Boolean).length;
      return total ? `${count}${total} linked ${total === 1 ? 'entry' : 'entries'}` : (adv.title || '');
    }
    default:
      return adv?.title || '';
  }
}

export function AdvancementList({ items, refNames }: { items: any[]; refNames?: RefNames }) {
  const sorted = [...items]
    .filter((a) => a && typeof a === 'object')
    .sort((a, b) => (Number(a.level) || 0) - (Number(b.level) || 0));
  if (!sorted.length) return <span className="text-ink/55">—</span>;
  return (
    <ul className="mt-1 space-y-1">
      {sorted.map((adv, i) => {
        const label = ADVANCEMENT_LABELS[adv.type] || titleCase(String(adv.type || 'Advancement'));
        const detail = advancementDetail(adv, refNames);
        return (
          <li key={adv._id || i} className="flex items-baseline gap-2 text-sm">
            <span className="shrink-0 text-[10px] font-mono text-gold/75 tabular-nums w-7">
              L{Number(adv.level) || 1}
            </span>
            <span className="font-semibold text-ink/85">{label}</span>
            {detail && <span className="text-ink/65 min-w-0">{detail}</span>}
          </li>
        );
      })}
    </ul>
  );
}

// ── Generic value rendering ────────────────────────────────────────────────

// Light markup strip for the long prose columns so a review shows readable
// text rather than raw [b]…[/b] / <p>…</p>. Not a renderer — just declutter.
const TEXT_FIELDS = new Set([
  'preview', 'description', 'lore', 'multiclassing', 'wealth',
  'starting_equipment', 'prerequisite_text', 'string_prerequisite',
]);
function stripMarkup(s: string): string {
  return s.replace(/\[\/?[^\]]+\]/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/* -------------------------------------------------------------------------- */
/* Proficiencies — use the editor's stored filter-preview display name.         */
/*                                                                              */
/* A class proficiency block stores per-group selections as option slugs/ids    */
/* (armor/weapons/tools/skills/savingThrows/languages) PLUS the editor's        */
/* computed `armorDisplayName` / `weaponsDisplayName` / `toolsDisplayName`       */
/* (the same "filter preview" string shown in ClassEditor —                     */
/* buildGroupedProficiencyDisplayName). Show that preview instead of dumping    */
/* each option slug; resolve saving-throw / skill keys to names too.            */
/* -------------------------------------------------------------------------- */

function normalizeChoiceCount(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// One proficiency sub-group (skills / savingThrows / languages) → "fixed names;
// choose N from options" using the supplied key→name map.
function proficiencyGroupSummary(group: any, labelMap: Record<string, string>): string {
  if (!group || typeof group !== 'object') return '';
  const nameOf = (id: any) => labelMap[String(id)] || titleCase(String(id));
  const fixed = (Array.isArray(group.fixedIds) ? group.fixedIds : []).map(nameOf);
  const options = (Array.isArray(group.optionIds) ? group.optionIds : []).map(nameOf);
  const count = normalizeChoiceCount(group.choiceCount);
  const parts: string[] = [];
  if (fixed.length) parts.push(fixed.join(', '));
  if (count > 0) parts.push(options.length ? `choose ${count} from ${options.join(', ')}` : `choose ${count}`);
  return parts.join('; ');
}

export function ProficiencySummary({ value }: { value: any }) {
  if (!value || typeof value !== 'object') return <span className="text-ink/45">—</span>;
  const lines: Array<[string, string]> = [];
  // armor/weapons/tools: the editor's stored filter-preview display name.
  const grouped: Array<[string, string, string]> = [
    ['armor', 'armorDisplayName', 'Armor'],
    ['weapons', 'weaponsDisplayName', 'Weapons'],
    ['tools', 'toolsDisplayName', 'Tools'],
  ];
  for (const [groupKey, dnKey, label] of grouped) {
    const dn = typeof value[dnKey] === 'string' ? value[dnKey].trim() : '';
    if (dn) { lines.push([label, dn]); continue; }
    const summary = proficiencyGroupSummary(value[groupKey], {});
    if (summary) lines.push([label, summary]);
  }
  const st = proficiencyGroupSummary(value.savingThrows, ABILITY_LABELS);
  if (st) lines.push(['Saving Throws', st]);
  const sk = proficiencyGroupSummary(value.skills, SKILL_LABELS);
  if (sk) lines.push(['Skills', sk]);
  const lang = proficiencyGroupSummary(value.languages, {});
  if (lang) lines.push(['Languages', lang]);
  if (!lines.length) return <span className="text-ink/45">—</span>;
  return (
    <dl className="mt-1 space-y-1 pl-3 border-l border-gold/15">
      {lines.map(([label, text]) => (
        <div key={label} className="text-sm">
          <dt className="text-[10px] uppercase tracking-wide text-ink/45">{label}</dt>
          <dd className="text-ink/75">{text}</dd>
        </div>
      ))}
    </dl>
  );
}

export function FriendlyValue({
  fieldKey,
  value,
  refNames,
  entityType,
  depth = 0,
}: {
  fieldKey: string;
  value: any;
  refNames?: RefNames;
  entityType?: string;
  depth?: number;
}): ReactNode {
  // Advancements get the dedicated list renderer.
  if (fieldKey === 'advancements' && Array.isArray(value)) {
    return <AdvancementList items={value} refNames={refNames} />;
  }

  // Proficiencies: show the editor's filter-preview display names (Armor /
  // Weapons / Tools) + name-resolved saving throws / skills, not option slugs.
  if (
    (fieldKey === 'proficiencies' ||
      fieldKey === 'multiclass_proficiencies' ||
      fieldKey === 'multiclassProficiencies') &&
    value &&
    typeof value === 'object'
  ) {
    return <ProficiencySummary value={value} />;
  }

  if (value === null || value === undefined || value === '') {
    return <span className="text-ink/45">—</span>;
  }

  // Known boolean / spell-level / price fields → a friendly string.
  const scalar = formatScalarField(entityType, fieldKey, value);
  if (scalar !== null) return <span>{scalar}</span>;

  // Enum-coded scalar or array (school, abilities, rarity, casting-time …) → labels.
  const enumMap = enumMapFor(fieldKey);
  if (enumMap) {
    const codes = Array.isArray(value) ? value : [value];
    if (!codes.length) return <span className="text-ink/45">—</span>;
    return (
      <span className="flex flex-wrap gap-1 mt-0.5">
        {codes.map((c, i) => (
          <span key={i} className="text-[11px] px-1.5 py-0.5 rounded bg-gold/15 border border-gold/25 text-ink/75">
            {labelFromMap(enumMap, c)}
          </span>
        ))}
      </span>
    );
  }

  if (typeof value === 'boolean') return <span>{value ? 'Yes' : 'No'}</span>;
  if (typeof value === 'number') return <span>{String(value)}</span>;

  if (typeof value === 'string') {
    const text = TEXT_FIELDS.has(fieldKey) ? stripMarkup(value) : value;
    return <span className="break-words whitespace-pre-wrap">{text || '—'}</span>;
  }

  if (Array.isArray(value)) {
    const scalars = value.filter((v) => typeof v !== 'object' || v === null);
    // Array of scalars (ability ids, levels, tag ids) → chips.
    if (scalars.length === value.length) {
      if (!value.length) return <span className="text-ink/45">—</span>;
      // Tag/option id arrays we can resolve to names; otherwise show raw.
      const { names } = resolveNames(value, refNames);
      const display = names.length === value.length ? names : value.map((v) => String(v));
      return (
        <span className="flex flex-wrap gap-1 mt-0.5">
          {display.map((v, i) => (
            <span key={i} className="text-[11px] px-1.5 py-0.5 rounded bg-gold/15 border border-gold/25 text-ink/75">
              {v}
            </span>
          ))}
        </span>
      );
    }
    // Array of objects (activities, effects, …) → name (+ type) list.
    return (
      <ul className="mt-0.5 space-y-0.5">
        {value.map((o, i) => {
          const nm = (o && (o.name || o.title || o.label)) || `Item ${i + 1}`;
          const ty = o && (o.type || o.kind) ? ` · ${titleCase(String(o.type || o.kind))}` : '';
          return (
            <li key={i} className="text-sm text-ink/75">• {nm}<span className="text-ink/45">{ty}</span></li>
          );
        })}
      </ul>
    );
  }

  if (typeof value === 'object') {
    const entries = meaningfulEntries(value);
    if (!entries.length) return <span className="text-ink/45">—</span>;
    // Cap nesting so a deeply-structured blob doesn't explode the panel.
    if (depth >= 2) {
      return <span className="text-ink/65">{entries.map(([k]) => humanizeFieldLabel(k)).join(', ')}</span>;
    }
    return (
      <dl className="mt-1 space-y-1 pl-3 border-l border-gold/15">
        {entries.map(([k, v]) => (
          <div key={k} className="text-sm">
            <dt className="text-[10px] uppercase tracking-wide text-ink/45">{humanizeFieldLabel(k)}</dt>
            <dd className="text-ink/75">
              <FriendlyValue fieldKey={k} value={v} refNames={refNames} entityType={entityType} depth={depth + 1} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }

  return <span>{String(value)}</span>;
}
