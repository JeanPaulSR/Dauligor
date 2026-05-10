/**
 * Compute a character's "effective tag set" — the union of every tag attached
 * to entities the character has accumulated:
 *   - each progression class (`tagIds` on classes table)
 *   - each progression subclass (`tagIds` on subclasses table)
 *   - each accessible class/subclass feature at level <= current class level
 *     (`tags` on features table)
 *   - each chosen option item from `selectedOptionsMap` (`tags` on
 *     unique_option_items table)
 *
 * Used by the Spell Manager to gate spells whose `required_tags` aren't a
 * subset of the character's tags. Future: feats, backgrounds, equipped items.
 *
 * Pure helper — caches are passed in. Stable across renders for the same
 * inputs so it can be used inside a useMemo.
 */

export interface EffectiveTagSetSources {
  progression: any[]; // [{classId, subclassId, level}, ...]
  classCache: Record<string, any>;
  subclassCache: Record<string, any>;
  featureCache: Record<string, any[]>; // keyed by classId AND by subclassId
  optionsCache: Record<string, any>;
  selectedOptionsMap: Record<string, string[]>;
}

export interface CharacterTagAttribution {
  tagId: string;
  source: 'class' | 'subclass' | 'feature' | 'option';
  sourceId: string;
  sourceName: string;
}

function pushTags(
  out: Map<string, CharacterTagAttribution>,
  tagIds: any,
  source: CharacterTagAttribution['source'],
  sourceId: string,
  sourceName: string,
) {
  if (!Array.isArray(tagIds)) return;
  for (const tagId of tagIds) {
    if (typeof tagId !== 'string' || !tagId) continue;
    if (out.has(tagId)) continue; // first attribution wins for the panel display
    out.set(tagId, { tagId, source, sourceId, sourceName });
  }
}

/**
 * Returns a Map<tagId, attribution>. Use `Set(map.keys())` for subset checks.
 * The attribution side is for UI display ("from feature X").
 */
export function buildCharacterEffectiveTagAttributions(
  sources: EffectiveTagSetSources,
): Map<string, CharacterTagAttribution> {
  const out = new Map<string, CharacterTagAttribution>();
  const { progression, classCache, subclassCache, featureCache, optionsCache, selectedOptionsMap } =
    sources;

  // Per-class iteration. Each entry is one class level; we deduplicate via
  // class+subclass identity below.
  const seenClasses = new Set<string>();
  const seenSubclasses = new Set<string>();

  for (const entry of progression || []) {
    const classId = String(entry?.classId || '').trim();
    const subclassId = String(entry?.subclassId || '').trim();

    if (classId && !seenClasses.has(classId)) {
      seenClasses.add(classId);
      const cls = classCache[classId];
      if (cls) {
        pushTags(out, cls.tagIds, 'class', cls.id, cls.name || classId);
      }
    }

    if (subclassId && !seenSubclasses.has(subclassId)) {
      seenSubclasses.add(subclassId);
      const sub = subclassCache[subclassId];
      if (sub) {
        pushTags(out, sub.tagIds, 'subclass', sub.id, sub.name || subclassId);
      }
    }
  }

  // Accessible features per class+subclass at the current class level.
  const classLevelByClassId = new Map<string, number>();
  for (const entry of progression || []) {
    const cid = String(entry?.classId || '').trim();
    if (!cid) continue;
    classLevelByClassId.set(cid, (classLevelByClassId.get(cid) || 0) + 1);
  }

  for (const [cid, lvl] of classLevelByClassId.entries()) {
    const features = featureCache[cid];
    if (Array.isArray(features)) {
      for (const f of features) {
        if ((Number(f?.level || 1) || 1) > lvl) continue;
        pushTags(out, f.tags, 'feature', f.id, f.name || 'Feature');
      }
    }
  }

  for (const subId of seenSubclasses) {
    const features = featureCache[subId];
    // Find this subclass's parent class level by walking the progression.
    const parentClassId = subclassCache[subId]?.classId;
    const parentLevel = parentClassId ? classLevelByClassId.get(parentClassId) || 0 : 0;
    if (Array.isArray(features)) {
      for (const f of features) {
        if ((Number(f?.level || 1) || 1) > parentLevel) continue;
        pushTags(out, f.tags, 'feature', f.id, f.name || 'Feature');
      }
    }
  }

  // Chosen option items contribute their tags.
  const allSelectedIds = new Set<string>();
  for (const ids of Object.values(selectedOptionsMap || {})) {
    if (Array.isArray(ids)) ids.forEach((id) => allSelectedIds.add(id));
  }
  for (const optId of allSelectedIds) {
    const opt = optionsCache[optId];
    if (!opt) continue;
    pushTags(out, opt.tags, 'option', opt.id, opt.name || optId);
  }

  return out;
}

/**
 * Convenience: returns just the tag-ID Set for subset checks.
 */
export function buildCharacterEffectiveTagSet(sources: EffectiveTagSetSources): Set<string> {
  return new Set(buildCharacterEffectiveTagAttributions(sources).keys());
}

/**
 * True if the character's effective tag set covers all of the spell's
 * `required_tags`. Returns true for spells with no prerequisites (the common
 * case). The free-text `prerequisite_text` is informational only and never
 * blocks here — surface it in UI for the player to read.
 */
export function characterMeetsSpellPrerequisites(
  effectiveTagSet: Set<string>,
  spell: { requiredTags?: string[] | null },
): boolean {
  const required = Array.isArray(spell.requiredTags) ? spell.requiredTags : [];
  if (required.length === 0) return true;
  for (const tagId of required) {
    if (!effectiveTagSet.has(tagId)) return false;
  }
  return true;
}

/**
 * The subset of `required_tags` the character is missing. Empty array means
 * the spell's prereqs are met.
 */
export function missingPrerequisiteTags(
  effectiveTagSet: Set<string>,
  spell: { requiredTags?: string[] | null },
): string[] {
  const required = Array.isArray(spell.requiredTags) ? spell.requiredTags : [];
  return required.filter((tagId) => !effectiveTagSet.has(tagId));
}
