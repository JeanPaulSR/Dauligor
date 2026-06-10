/**
 * Foundry activity → `SemanticActivity` converter — SHARED by every
 * Foundry importer (items / feats / spells).
 *
 * Mirrors the `foundryHtmlCleanup.ts` pattern: the small per-importer
 * helpers (slugify wrappers, source matching, image-URL resolution) are
 * deliberately COPIED across the three sibling import libs so a tweak in
 * one can't cascade into the others — but the genuinely non-trivial,
 * schema-shaped logic lives in ONE module that all three import (exactly
 * like `cleanFoundryHtml`). This ~90-line activity mapper is the worst
 * possible place for three copies to drift, so it lives here.
 *
 * Why this is needed: Foundry dnd5e v5 discriminates an activity on
 * `type` ("attack" / "cast" / …) with an `_id` key and nests the attack
 * mode as `attack.type = { value, classification }`. Our `ActivityEditor`
 * (and the `SemanticActivity` type) discriminates on `kind` with an `id`,
 * and stores the attack mode FLAT (`attack.type = "melee"`,
 * `attack.classification = "weapon"`). Stored raw, imported activities
 * carry no `kind`, so the kind-based editor can't classify or render them
 * — they show up blank. Every other sub-shape (activation / duration /
 * range / target / consumption / uses / visibility / spell / effects)
 * already matches dnd5e v5, so we preserve those by spread and only remap
 * the three that differ (id/kind discriminators, `attack.type`,
 * `save.ability`), plus surface `description.chatFlavor` → `chatFlavor`.
 *
 * The INVERSE lives on the module side (dauligor-pairing
 * `class-import-service.js → normalizeSemanticActivity`), which turns a
 * `SemanticActivity` back into a Foundry-native activity on
 * import-into-Foundry. Keep the two in sync: a field this converter
 * drops/renames must be reconstructable there, and vice-versa.
 */
export function foundryActivityToSemantic(raw: any, index: number): any {
  if (!raw || typeof raw !== 'object') return raw;
  const a: any = { ...raw };

  // id / kind discriminators (drop Foundry's `_id` / `type` + ordering noise).
  a.id = String(raw._id || raw.id || `act${String(index).padStart(13, '0')}`);
  a.kind = String(raw.type || raw.kind || 'utility');
  delete a.type;
  delete a._id;
  delete a.sort;

  // name / img — Foundry leaves item-activity names blank; the editor
  // falls back to the kind label, so '' is fine. Default the icon to the
  // kind's activity glyph when Foundry shipped none.
  a.name = String(raw.name ?? '');
  a.img = String(raw.img || `systems/dnd5e/icons/svg/activity/${a.kind}.svg`);

  // chatFlavor lives in `description` on the Foundry side (`{ chatFlavor }`
  // in v5; a bare string in older exports).
  a.chatFlavor = (raw.description && typeof raw.description === 'object')
    ? String(raw.description.chatFlavor ?? '')
    : String(raw.description ?? '');
  delete a.description;

  // attack — flatten `{ value, classification }` → flat fields.
  if (raw.attack && typeof raw.attack === 'object') {
    const at = raw.attack;
    const atType = at.type;
    a.attack = {
      ability: at.ability ?? '',
      bonus: String(at.bonus ?? ''),
      flat: !!at.flat,
      type: (atType && typeof atType === 'object') ? (atType.value ?? '') : String(atType ?? ''),
      classification: (atType && typeof atType === 'object') ? (atType.classification ?? '') : (at.classification ?? ''),
      critical: at.critical ?? { threshold: null },
    };
  }

  // save — Foundry stores `ability` (a Set serialized to an array); the
  // editor reads `abilities`.
  if (raw.save && typeof raw.save === 'object') {
    const rawAbility = raw.save.abilities ?? raw.save.ability;
    a.save = {
      abilities: Array.isArray(rawAbility) ? rawAbility : (rawAbility ? [rawAbility] : []),
      dc: raw.save.dc ?? { calculation: '', formula: '' },
    };
  }

  // damage — normalize the `critical` sub-shape (Foundry: `{ bonus }`;
  // editor: `{ allow, bonus }`). Parts already match the dnd5e v5 shape.
  if (raw.damage && typeof raw.damage === 'object') {
    a.damage = {
      ...raw.damage,
      includeBase: raw.damage.includeBase ?? false,
      parts: Array.isArray(raw.damage.parts) ? raw.damage.parts : [],
      critical: {
        allow: raw.damage.critical?.allow ?? false,
        bonus: String(raw.damage.critical?.bonus ?? ''),
      },
    };
  }

  return a;
}
