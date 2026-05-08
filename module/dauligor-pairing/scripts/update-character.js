import { log } from "./utils.js";

// Build a flat dotted-key delta from a series of "set this proficiency",
// "add these languages", etc. calls and commit it once via `actor.update`.
//
// Two design points worth flagging:
//
//   * We strip the `<type>:` prefix that the base-advancement prompts
//     attach to their option slugs (`saves:str`, `skills:acr`, `armor:lgt`,
//     etc.). dnd5e expects the bare ability/skill/trait id, e.g.
//     `system.skills.acr.value`, not `system.skills.skills:acr.value`.
//     Forgetting to strip is invisible — Foundry silently swallows writes
//     to non-existent paths and the sheet shows nothing changed. Hours of
//     debugging well spent.
//
//   * We send only the delta on commit, never the full `actor.toObject()`.
//     toObject pulls in `items` and `effects` arrays of embedded documents,
//     which `actor.update` can't apply (those need
//     `actor.updateEmbeddedDocuments`). Including them either errors or
//     gets dropped silently; either way it's noise.

const TYPE_PREFIX_RE = /^(saves|abilities|skills|skill|armor|armorprof|weapons|weapon|weaponprof|tools|tool|toolprof|languages|language|dr|di|dv|ci):/i;

function stripTypePrefix(slug) {
  const s = String(slug ?? "").trim();
  if (!s) return "";
  return s.replace(TYPE_PREFIX_RE, "");
}

function uniqueClean(values) {
  const seen = new Set();
  const out = [];
  for (const v of values) {
    const clean = stripTypePrefix(v);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

export class CharacterUpdater {
  constructor(actor) {
    if (!actor) throw new Error("An actor document is required for CharacterUpdater.");
    this.actor = actor;
    /** @type {Record<string, any>} flat dotted-key delta we send to actor.update */
    this.delta = {};
  }

  /** @deprecated retained for the BEFORE-import debug log only; reads the live actor each time. */
  getCharacterJson() {
    return this.actor?.toObject?.() ?? null;
  }

  /** Lets the sequence inspect what's about to be committed. */
  get tempData() {
    return this.delta;
  }

  /** Direct delta merge — escape hatch if a caller already has the right shape. */
  updateTempData(changes) {
    Object.assign(this.delta, changes ?? {});
    log("CharacterUpdater: queued delta", changes);
  }

  /**
   * Mark skills proficient (value=1) / expert (value=2). Slugs accept the
   * prompt-side prefixed form (`skills:acr`) or the bare dnd5e key (`acr`).
   */
  updateSkills(skillSlugs, value = 1) {
    for (const slug of skillSlugs ?? []) {
      const key = stripTypePrefix(slug);
      if (!key) continue;
      this.delta[`system.skills.${key}.value`] = value;
    }
  }

  /**
   * Mark saving throws proficient. Accepts `saves:str` or `str`.
   */
  updateSaves(abilities, value = 1) {
    for (const slug of abilities ?? []) {
      const key = stripTypePrefix(slug);
      if (!key) continue;
      this.delta[`system.abilities.${key}.proficient`] = value;
    }
  }

  /**
   * Add to a `system.traits.<traitPath>.value` array, merging with the
   * actor's current array so we don't clobber prior proficiencies.
   *
   * `traitPath` is the dnd5e key — `armorProf`, `weaponProf`, `toolProf`,
   * `languages`. Slugs accept either `armor:lgt` or `lgt`.
   */
  updateTraitProficiencies(traitPath, values) {
    const current = this.actor?.system?.traits?.[traitPath]?.value ?? [];
    const merged = uniqueClean([...current, ...(values ?? [])]);
    this.delta[`system.traits.${traitPath}.value`] = merged;
  }

  /**
   * Add to a damage-trait array (`dr`, `di`, `dv`, `ci`).
   */
  updateDamageTraits(type, values) {
    const current = this.actor?.system?.traits?.[type]?.value ?? [];
    const merged = uniqueClean([...current, ...(values ?? [])]);
    this.delta[`system.traits.${type}.value`] = merged;
  }

  /**
   * Increase the actor's HP base by `amount`. dnd5e derives `hp.max` from
   * `hp.base + size + per-level rolls`, so we only touch base.
   */
  updateHp(amount) {
    if (!Number.isFinite(amount) || amount === 0) return;
    const currentBase = Number(this.actor?.system?.attributes?.hp?.base ?? 0) || 0;
    this.delta["system.attributes.hp.base"] = currentBase + amount;
  }

  /**
   * Apply the queued delta to the actor in one network round-trip.
   * Returns the updated Actor on success, or null if there was nothing to write.
   */
  async commit() {
    if (!this.actor) return null;
    if (Object.keys(this.delta).length === 0) {
      log("CharacterUpdater: commit skipped — empty delta");
      return null;
    }
    log("CharacterUpdater: committing delta", { actor: this.actor.name, delta: this.delta });
    try {
      const result = await this.actor.update(this.delta);
      log("CharacterUpdater: commit successful");
      return result;
    } catch (error) {
      console.error("Dauligor | CharacterUpdater: commit failed", error);
      throw error;
    }
  }
}
