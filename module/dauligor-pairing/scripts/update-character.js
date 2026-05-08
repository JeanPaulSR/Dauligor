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

/**
 * Reports whether a slug is *already proficient* on the actor — either
 * because the actor's current sheet has it (existing proficiency from a
 * prior class, race, etc.) OR because an earlier prompt in this same
 * import sequence already marked it via CharacterUpdater. The selection
 * prompts use this to grey out checkboxes the player has effectively
 * already chosen, so the user doesn't redundantly pick a skill they
 * already have.
 *
 * `kind` accepts the synthetic ids used by `baseClassHandler`
 * (`base-skills`, `base-saves`, `base-armor`, etc.) and the bare
 * names (`skills`, `saves`, etc.).
 */
const KNOWN_KINDS = new Set([
  "base-skills", "skills", "skill",
  "base-saves", "saves", "abilities",
  "base-tools", "tools", "tool",
  "base-armor", "armor",
  "base-weapons", "weapons", "weapon",
  "base-languages", "languages", "language",
  "base-resistances", "dr",
  "base-immunities", "di",
  "base-vulnerabilities", "dv",
  "base-condition-immunities", "ci"
]);

export function isAlreadyMarked(actor, characterUpdater, kind, slug) {
  const cleaned = stripTypePrefix(slug);
  if (!cleaned) return false;

  // Mixed-pool feature trait advancements (e.g. "choose any one skill OR
  // language") arrive without a single canonical `kind` for the whole
  // prompt — the type lives in each option's `<type>:` prefix. Fall back
  // to inferring from the slug when the supplied kind isn't a known
  // category, so already-marked options still grey out.
  let k = String(kind ?? "").toLowerCase();
  if (!KNOWN_KINDS.has(k)) {
    const m = String(slug ?? "").match(/^([a-z]+):/i);
    if (m) k = m[1].toLowerCase();
  }
  const delta = characterUpdater?.delta ?? {};

  const checkSkill = () =>
    Number(actor?.system?.skills?.[cleaned]?.value ?? 0) > 0
    || Number(delta[`system.skills.${cleaned}.value`] ?? 0) > 0;

  const checkSave = () =>
    Number(actor?.system?.abilities?.[cleaned]?.proficient ?? 0) > 0
    || Number(delta[`system.abilities.${cleaned}.proficient`] ?? 0) > 0;

  const checkTraitArray = (path) => {
    const onActor = Array.isArray(actor?.system?.traits?.[path]?.value)
      ? actor.system.traits[path].value
      : [];
    const onDelta = Array.isArray(delta[`system.traits.${path}.value`])
      ? delta[`system.traits.${path}.value`]
      : [];
    return onActor.includes(cleaned) || onDelta.includes(cleaned);
  };

  const checkTool = () =>
    Number(actor?.system?.tools?.[cleaned]?.value ?? 0) > 0
    || checkTraitArray("toolProf");

  switch (k) {
    case "base-skills":
    case "skills":
    case "skill":
      return checkSkill();
    case "base-saves":
    case "saves":
    case "abilities":
      return checkSave();
    case "base-tools":
    case "tools":
    case "tool":
      return checkTool();
    case "base-armor":
    case "armor":
      return checkTraitArray("armorProf");
    case "base-weapons":
    case "weapons":
    case "weapon":
      return checkTraitArray("weaponProf");
    case "base-languages":
    case "languages":
    case "language":
      return checkTraitArray("languages");
    case "base-resistances":
    case "dr":
      return checkTraitArray("dr");
    case "base-immunities":
    case "di":
      return checkTraitArray("di");
    case "base-vulnerabilities":
    case "dv":
      return checkTraitArray("dv");
    case "base-condition-immunities":
    case "ci":
      return checkTraitArray("ci");
    default:
      return false;
  }
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
   * Apply a mixed-prefix array of slugs (`skills:acr`, `saves:str`,
   * `tools:thief`, `armor:lgt`, `weapons:longsword`, `languages:elvish`,
   * `dr:fire`, etc.) — each slug is dispatched to the matching writer.
   *
   * Used by feature-level Trait advancement prompts where the option
   * pool can be heterogeneous (e.g. "choose one skill OR language").
   * Slugs without a recognized prefix fall back to skill (the most
   * common case) — keep the authoring side prefixing properly to avoid
   * surprises.
   */
  applyMixedTraitSelections(slugs) {
    const list = Array.isArray(slugs) ? slugs : (slugs ? [slugs] : []);
    for (const raw of list) {
      const slug = String(raw ?? "").trim();
      if (!slug) continue;
      const prefixMatch = slug.match(/^([a-z]+):/i);
      const prefix = prefixMatch ? prefixMatch[1].toLowerCase() : "";
      switch (prefix) {
        case "skills":
        case "skill":
          this.updateSkills([slug]);
          break;
        case "saves":
        case "abilities":
          this.updateSaves([slug]);
          break;
        case "tools":
        case "tool":
          this.updateTraitProficiencies("toolProf", [slug]);
          break;
        case "armor":
          this.updateTraitProficiencies("armorProf", [slug]);
          break;
        case "weapons":
        case "weapon":
          this.updateTraitProficiencies("weaponProf", [slug]);
          break;
        case "languages":
        case "language":
          this.updateTraitProficiencies("languages", [slug]);
          break;
        case "dr":
          this.updateDamageTraits("dr", [slug]);
          break;
        case "di":
          this.updateDamageTraits("di", [slug]);
          break;
        case "dv":
          this.updateDamageTraits("dv", [slug]);
          break;
        case "ci":
          this.updateDamageTraits("ci", [slug]);
          break;
        default:
          // Unprefixed — fall back to skill, the most common category
          // for unprefixed authoring data.
          this.updateSkills([slug]);
      }
    }
  }

  /**
   * Apply the queued delta to the actor in one network round-trip.
   * Returns the updated Actor on success, or null if there was nothing to write.
   *
   * After the main delta lands, if the actor's current HP is still 0 and
   * the new derived `hp.max` is positive (a fresh import — character
   * sheet just rolled out of zero), fill `hp.value` to match `max` so
   * the actor doesn't start the campaign at "0 / 8". We deliberately
   * don't auto-heal a wounded actor: only touch `hp.value` when it's
   * still at 0 after the delta has applied.
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

      const maxAfter = Number(this.actor?.system?.attributes?.hp?.max ?? 0) || 0;
      const valueAfter = Number(this.actor?.system?.attributes?.hp?.value ?? 0) || 0;
      if (maxAfter > 0 && valueAfter <= 0) {
        log("CharacterUpdater: filling hp.value to max on fresh import", { max: maxAfter });
        await this.actor.update({ "system.attributes.hp.value": maxAfter });
      }
      return result;
    } catch (error) {
      console.error("Dauligor | CharacterUpdater: commit failed", error);
      throw error;
    }
  }
}
