/**
 * Builder-side resolution for the two Layer 2 spell-access advancement types.
 * Mirrors `collectGrantedItemsFromAdvancementList` (in CharacterBuilder.tsx) but
 * for `GrantSpells` and `ExtendSpellList`.
 *
 * - `GrantSpells` -> ownedSpells entries (writes to character_spells on save).
 * - `ExtendSpellList` -> spellListExtensions entries (writes to
 *   character_spell_list_extensions on save). The character still has to learn
 *   the spell via their class's normal progression — this just expands the pool.
 *
 * Both resolver kinds are supported:
 * - `resolver.kind === 'explicit'` — `spellIds[]` is the pool directly.
 * - `resolver.kind === 'rule'` — `ruleId` + a `resolveRulePool` callback (passed
 *   from CharacterBuilder once the rules + spell summaries are loaded). The
 *   callback returns the matched spell IDs, or [] if not yet resolved.
 */
import { buildAdvancementSelectionKey, uniqueStringList } from './characterLogic';

export type GrantedByType =
  | 'class'
  | 'subclass'
  | 'feature'
  | 'feat'
  | 'background'
  | 'item'
  | 'option_item';

export interface OwnedSpellGrant {
  spellId: string;
  level: number;
  grantedByType: GrantedByType;
  grantedById: string;
  grantedByAdvancementId: string;
  countsAsClassId: string | null;
  alwaysPrepared: boolean;
  doesntCountAgainstPrepared: boolean;
  doesntCountAgainstKnown: boolean;
}

export interface SpellListExtension {
  classId: string;
  spellId: string;
  level: number;
  grantedByType: GrantedByType;
  grantedById: string;
  grantedByAdvancementId: string;
}

interface AdvancementWalkOptions {
  maxLevel: number;
  defaultLevel?: number;
  parentType: GrantedByType;
  parentId: string;
  sourceScope: string;
  selectedOptionsMap: Record<string, string[]>;
  classId?: string;
  spellcastingClassIds?: string[];
  /**
   * Resolver for `resolver.kind === 'rule'`. Passed from CharacterBuilder
   * after rules + spell summaries are loaded. Returns the spell IDs matched
   * by the named rule, or [] if not loaded yet (callers tolerate the empty
   * pool — it'll fill in when the resolver becomes available).
   */
  resolveRulePool?: (ruleId: string) => string[];
}

function normaliseLevel(value: any, fallback = 1) {
  const n = Number(value || fallback) || fallback;
  return Math.max(1, n);
}

/**
 * Resolve the spell pool for a `GrantSpells` / `ExtendSpellList` resolver.
 * - `explicit` returns its `spellIds[]` directly.
 * - `rule` calls `resolveRulePool(ruleId)`. Returns [] if the resolver isn't
 *   wired yet, which is expected on first render before rules load.
 * - Any other resolver kind returns [].
 */
export function resolveAdvancementSpellPool(
  resolver: any,
  resolveRulePool?: (ruleId: string) => string[],
): string[] {
  if (!resolver) return [];
  if (resolver.kind === 'explicit') {
    return uniqueStringList(Array.isArray(resolver.spellIds) ? resolver.spellIds : []);
  }
  if (resolver.kind === 'rule') {
    const ruleId = String(resolver.ruleId || '').trim();
    if (!ruleId || !resolveRulePool) return [];
    return uniqueStringList(resolveRulePool(ruleId));
  }
  return [];
}

function resolveChoiceSelection(
  adv: any,
  level: number,
  sourceScope: string,
  selectedOptionsMap: Record<string, string[]>,
): string[] {
  const key = buildAdvancementSelectionKey({
    sourceScope,
    advancementId: adv?._id,
    level,
  });
  return uniqueStringList(selectedOptionsMap?.[key] || []);
}

export function collectGrantedSpellsFromAdvancementList(
  advancements: any[] = [],
  opts: AdvancementWalkOptions,
): OwnedSpellGrant[] {
  const out: OwnedSpellGrant[] = [];
  (Array.isArray(advancements) ? advancements : []).forEach((adv: any) => {
    if (!adv || adv.type !== 'GrantSpells') return;
    const level = normaliseLevel(adv.level, opts.defaultLevel || 1);
    if (level > opts.maxLevel) return;

    const cfg = adv.configuration || {};
    const mode = cfg.mode === 'choice' ? 'choice' : 'fixed';
    const resolver = cfg.resolver || { kind: 'explicit', spellIds: [] };

    const pool = resolveAdvancementSpellPool(resolver, opts.resolveRulePool);
    if (pool.length === 0) return;

    const chosen =
      mode === 'choice'
        ? resolveChoiceSelection(adv, level, opts.sourceScope, opts.selectedOptionsMap).filter(id =>
            pool.includes(id),
          )
        : pool;

    if (chosen.length === 0) return;

    const advancementId = String(adv._id || '');
    const countsAsClassId =
      typeof cfg.countsAsClassId === 'string' && cfg.countsAsClassId
        ? cfg.countsAsClassId
        : null;

    chosen.forEach(spellId => {
      out.push({
        spellId,
        level,
        grantedByType: opts.parentType,
        grantedById: opts.parentId,
        grantedByAdvancementId: advancementId,
        countsAsClassId,
        alwaysPrepared: Boolean(cfg.alwaysPrepared),
        doesntCountAgainstPrepared: Boolean(cfg.doesntCountAgainstPrepared),
        doesntCountAgainstKnown: Boolean(cfg.doesntCountAgainstKnown),
      });
    });
  });
  return out;
}

export function collectSpellListExtensionsFromAdvancementList(
  advancements: any[] = [],
  opts: AdvancementWalkOptions,
): SpellListExtension[] {
  const out: SpellListExtension[] = [];
  (Array.isArray(advancements) ? advancements : []).forEach((adv: any) => {
    if (!adv || adv.type !== 'ExtendSpellList') return;
    const level = normaliseLevel(adv.level, opts.defaultLevel || 1);
    if (level > opts.maxLevel) return;

    const cfg = adv.configuration || {};
    const resolver = cfg.resolver || { kind: 'rule', ruleId: '' };
    const spellIds = resolveAdvancementSpellPool(resolver, opts.resolveRulePool);
    if (spellIds.length === 0) return;

    const scope =
      cfg.scope === 'all-spellcasting' || cfg.scope === 'specific' ? cfg.scope : 'self';

    let targetClassIds: string[] = [];
    if (scope === 'self') {
      if (opts.classId) targetClassIds = [opts.classId];
    } else if (scope === 'all-spellcasting') {
      targetClassIds = uniqueStringList(opts.spellcastingClassIds || []);
    } else if (scope === 'specific') {
      const explicit = typeof cfg.scopeClassId === 'string' ? cfg.scopeClassId.trim() : '';
      if (explicit) targetClassIds = [explicit];
    }

    if (targetClassIds.length === 0) return;

    const advancementId = String(adv._id || '');
    targetClassIds.forEach(classId => {
      spellIds.forEach(spellId => {
        out.push({
          classId,
          spellId,
          level,
          grantedByType: opts.parentType,
          grantedById: opts.parentId,
          grantedByAdvancementId: advancementId,
        });
      });
    });
  });
  return out;
}

export function dedupeOwnedSpellGrants(entries: OwnedSpellGrant[]): OwnedSpellGrant[] {
  const seen = new Map<string, OwnedSpellGrant>();
  entries.forEach(entry => {
    const key = `${entry.grantedByType}:${entry.grantedById}:${entry.grantedByAdvancementId}:${entry.spellId}`;
    if (!seen.has(key)) seen.set(key, entry);
  });
  return Array.from(seen.values());
}

export function dedupeSpellListExtensions(entries: SpellListExtension[]): SpellListExtension[] {
  const seen = new Map<string, SpellListExtension>();
  entries.forEach(entry => {
    const key = `${entry.classId}:${entry.spellId}`;
    if (!seen.has(key)) seen.set(key, entry);
  });
  return Array.from(seen.values());
}
