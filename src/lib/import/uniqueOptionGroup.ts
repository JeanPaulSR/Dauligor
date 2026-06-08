// Unique Option Group import descriptor — groups of modular options (Eldritch
// Invocations, Fighting Styles, Metamagic, Maneuvers, Infusions, Pact Boons, …)
// that classes grant choices from. This is what "rounds out" class imports:
// import the class, then import the option groups its advancements draw from.
//
// FIDELITY — UniqueOptionGroupEditor builds the group + each item's snake_case
// `d1Data` INLINE and calls the GENERIC `upsertDocument` (no dedicated wrapper,
// and — unlike class/subclass/feature — NO `queueRebake`: option groups & items
// don't trigger a rebake). This descriptor mirrors BOTH writes:
//   • group → upsertDocument('uniqueOptionGroups', id, { name, description,
//             source_id, class_ids, updated_at })   ← no `identifier` column
//   • item  → upsertDocument('uniqueOptionItems', iid, { …full item row… })
//             with `group_id`, `feature_type` = the GROUP name, and the
//             empty-default shapes a fresh option saves (requirements_tree null,
//             [] arrays, null icon/uses, 0 prereq flags).
// A group + options created here are byte-identical to a hand save.
//
// STRUCTURE — a GROUP (parent) + OPTION ITEMS (children via `group_id`), exactly
// like a class + its features, so the items REUSE the class feature pipeline (the
// `features` field kind + the section/parse splitter). The only per-item field
// captured beyond name/description is the level PREREQUISITE (sniffed from the
// option prose → `level_prerequisite`). Deep authoring — the requirements tree,
// activities, effects, advancements, uses — stays in the editor (skeleton scope,
// like spells skip activities and the class importer skips the advancement tree).
//
// Component guide + recipe: docs/architecture/import-system.md

import { upsertDocument } from '../d1';
import { splitClassSections, parseFeatureSpan, reflowText, firstLevel, stripBbcodeTags, type FeatureDraft } from './classParse';
import type { ImportDescriptor, ImportContext, ParseResult, ParsedField, ImportFieldOption } from './types';

const hi = (value: unknown): ParsedField => ({ value, confidence: 'high' });

// Light name normalize — strip bbcode + collapse whitespace (group names carry
// small words: "Pact Boons", "Eldritch Invocations").
const cleanName = (raw: string): string =>
  String(raw || '').replace(/\[[^\]\n]*\]/g, '').replace(/\s+/g, ' ').trim();
const tidy = (s: string) => s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

// Sniff an option's level PREREQUISITE → `level_prerequisite`. Options gate via a
// "Prerequisite: 9th level" line (invocations / infusions), which the class
// `firstLevel` ("at 9th level…") doesn't catch — so check the prereq form first,
// then fall back to firstLevel. null when there's no level gate (→ 0 on commit).
function optionLevel(body: string): number | null {
  const m = String(body || '').match(/prerequisite:?[^.\n]*?(\d+)(?:st|nd|rd|th)\s+level/i);
  if (m) return Number(m[1]);
  return firstLevel(body);
}

// The OPTION-item kinds for the Features-organizer dropdown. Options aren't
// routed (no spellcasting / asi / subclass), so it's just Option / Skip.
const OPTION_KINDS: ImportFieldOption[] = [
  { value: 'feature', label: 'Option' },
  { value: 'skip', label: 'Skip' },
];

// Split an option-group write-up into ONE draft per option. Unlike the class
// pipeline, options are NOT folded into one another: each header is its own
// option, even with no level cue. (Most options gate on a "Prerequisite:" line or
// nothing, so the class fold rule — which folds level-less sub-headers into the
// section above — would collapse every option into the first.) Identity/meta
// sections (Hit Points, Class Features…) aren't options, so they're dropped.
// Every draft is kind 'feature' (an "Option" — no spellcasting/asi/subclass).
function splitOptions(text: string): FeatureDraft[] {
  return splitClassSections(text)
    .filter((s) => s.kind !== 'identity' && s.kind !== 'meta')
    .map((s, i) => ({ id: `opt-${i}`, kind: 'feature', name: s.name, level: optionLevel(s.body), levels: s.levels, body: s.body }));
}

// Interpret an option-group write-up → one draft per option. Group name + class
// restrictions are set in the form fields.
function parseOptionGroupText(text: string): ParseResult {
  const fields: Record<string, ParsedField> = {};
  const notes: string[] = [];
  const drafts = splitOptions(text);
  if (drafts.length) {
    fields._items = hi(drafts);
    notes.push(`Parsed ${drafts.length} option${drafts.length === 1 ? '' : 's'} — organize them in the Options panel below (each becomes a uniqueOptionItem; the sniffed level is its prerequisite). The first row is usually the group title — Skip or rename it.`);
  }
  notes.push('Set the group name + (optional) class restrictions in the fields on the right, or drop the name text into the Name box.');
  return { fields, leftovers: [], notes };
}

/** Route the Options-panel drafts → the child option-item rows. Any non-skip
 * draft with a name is an option; its `level` → `level_prerequisite`. Pure. */
function routeOptions(drafts: FeatureDraft[]) {
  return (Array.isArray(drafts) ? drafts : [])
    .filter((d) => d.kind !== 'skip' && String(d.name || '').trim())
    .map((d) => ({ name: d.name, level: Number(d.level) || 0, body: String(d.body || '') }));
}

export const uniqueOptionGroupDescriptor: ImportDescriptor = {
  type: 'optionGroup',
  label: 'Option Group',
  collection: 'uniqueOptionGroups',
  nameField: 'name',
  descriptionField: 'description',
  fields: [
    { key: 'name', label: 'Name', kind: 'text', required: true, group: 'Identity', placeholder: 'Eldritch Invocations' },
    { key: 'sourceId', label: 'Source', kind: 'source', group: 'Identity' },
    { key: 'classRestrictions', label: 'Class Restrictions', kind: 'classMulti', default: [] as string[], group: 'Identity', help: 'Classes that can pick from this group. Empty = visible to ALL classes (optional — it’s a filter in the advancement editor).' },
    { key: 'description', label: 'Description', kind: 'markdown', group: 'Text', placeholder: 'What these options represent' },
    { key: '_items', label: 'Options', kind: 'features', default: [], featureKinds: OPTION_KINDS, group: 'Options', help: 'Each row becomes a uniqueOptionItem (name + description + a level prerequisite). Tick several and Merge to fold, edit names/levels, or Skip a row. Deep authoring (requirements tree, activities, uses) stays in the editor.' },
  ],

  buildPayload(f: Record<string, any>, ctx: ImportContext) {
    const now = ctx.now ?? new Date().toISOString();
    const name = cleanName(String(f.name ?? ''));
    // Snake_case group row — a faithful mirror of UniqueOptionGroupEditor's
    // `handleSaveGroup` d1Data (note: NO `identifier` column on this table).
    return {
      name,
      description: String(f.description ?? ''),
      // source_id is a FK to sources(id) — '' isn't a valid reference (it
      // FK-fails), so an unsourced group writes NULL (the "no source" value).
      source_id: f.sourceId || null,
      class_ids: Array.isArray(f.classRestrictions) ? f.classRestrictions : [],
      updated_at: now,
      // Carried to commit (NOT a `uniqueOptionGroups` column) — child item rows.
      __items: routeOptions(f._items),
    };
  },

  async commit(id: string, payload: Record<string, any>) {
    const { __items = [], ...groupData } = payload;
    // Group write — identical to the editor's admin direct-save branch. NO
    // queueRebake (the editor doesn't rebake option groups / items).
    await upsertDocument('uniqueOptionGroups', id, groupData);
    const now = groupData.updated_at ?? new Date().toISOString();
    const groupName = String(groupData.name ?? '');
    // FK to sources(id) — NULL for "no source" (never '', which FK-fails).
    const groupSource = groupData.source_id || null;
    // Child option rows — through the GENERIC upsert (the editor's `handleSaveItem`
    // path), parented via `group_id`. Mirrors a FRESH option's d1Data: the simple
    // captured fields + the empty-default deep shapes for the editor to author.
    for (const item of __items as { name: string; level: number; body: string }[]) {
      const itemName = stripBbcodeTags(String(item.name ?? ''));
      if (!itemName) continue;
      const iid = crypto.randomUUID();
      await upsertDocument('uniqueOptionItems', iid, {
        name: itemName,
        description: String(item.body ?? ''),
        group_id: id,
        source_id: groupSource,            // editor defaults an item's source to the group's
        level_prerequisite: Number(item.level) || 0,
        level_prereq_is_total: 0,
        is_repeatable: 0,
        string_prerequisite: '',
        page: '',
        requirements_tree: null,           // === serializeRequirementTree(null)
        feature_type: groupName,           // locked to the group name (like the editor)
        subtype: null,
        icon_url: null,
        image_url: null,
        uses_max: null,
        uses_spent: 0,
        uses_recovery: [] as unknown[],
        properties: [] as unknown[],
        activities: [] as unknown[],
        effects: [] as unknown[],
        advancements: [] as unknown[],
        tags: [] as unknown[],
        quantity_column_id: null,
        scaling_column_id: null,
        updated_at: now,
      });
    }
  },

  // Interpret a pasted option-group write-up → route its options into the
  // Options panel. Name + class restrictions are set in the form.
  parseText: parseOptionGroupText,

  // Mark-up / Paste-by-section blocks: Name, Description, and the Option repeater.
  assignTargets: [
    { key: 'name', label: 'Name', fieldKeys: ['name'], group: 'Blocks' },
    { key: 'description', label: 'Description', fieldKeys: ['description'], group: 'Blocks' },
    { key: 'option', label: 'Option (＋ add)', fieldKeys: ['_items'], group: 'Blocks', mode: 'append' },
  ],

  assignField(target: string, text: string): Record<string, unknown> {
    const clean = String(text ?? '').trim();
    switch (target) {
      case 'name': { const n = cleanName(clean); return n ? { name: n } : {}; }
      case 'description': return clean ? { description: tidy(reflowText(clean)) } : {};
      default: return {};
    }
  },

  // "Option" mark: each selected span → ONE option draft (first line = name, rest
  // = body, level prerequisite sniffed — null when none, so no false "Level 1").
  assignAppend(target: string, text: string): Record<string, unknown> | null {
    if (target !== 'option') return null;
    const d = parseFeatureSpan(text);
    if (!d.name) return null;
    return { id: crypto.randomUUID(), kind: 'feature', name: d.name, level: optionLevel(text), body: d.body };
  },

  // Bulk: paste ALL the option text → one draft per heading (each an Option,
  // never folded — see splitOptions).
  assignAppendMany(target: string, text: string): Record<string, unknown>[] {
    if (target !== 'option') return [];
    return splitOptions(text)
      .filter((d) => String(d.name || '').trim())
      .map((d) => ({ id: crypto.randomUUID(), kind: 'feature', name: d.name, level: d.level, levels: d.levels, body: d.body }));
  },
};
