import { log } from "./utils.js";

export class CharacterUpdater {
  constructor(actor) {
    if (!actor) throw new Error("An actor document is required for CharacterUpdater.");
    this.actor = actor;
    this.tempData = null;
  }

  /**
   * Retrieves and reads the raw data of the character sheet as a plain JSON object.
   * Initializes the temporary data if it hasn't been already.
   * @returns {object|null} Plain JSON object representing the actor data, or null.
   */
  getCharacterJson() {
    if (!this.actor) return null;
    if (!this.tempData) {
      this.tempData = this.actor.toObject();
      log("Successfully initialized temporary character JSON data", this.tempData);
    }
    return this.tempData;
  }

  /**
   * Updates the temporary data with a change object.
   * @param {object} changes - Object containing updates to the temporary data.
   */
  updateTempData(changes) {
    if (!this.tempData) this.getCharacterJson();
    foundry.utils.mergeObject(this.tempData, changes);
    log("Updated temporary character data", changes);
  }

  /**
   * Commits the temporary data changes back to the actual actor document.
   * @returns {Promise<Actor|null>} The updated actor document.
   */
  async commit() {
    if (!this.actor || !this.tempData) return null;
    log("Committing temporary character data to actor", this.tempData);
    try {
      const result = await this.actor.update(this.tempData);
      return result;
    } catch (error) {
      console.error("Dauligor | CharacterUpdater: Failed to commit character updates", error);
      throw error;
    }
  }

  /**
   * Updates skill proficiencies in the temporary data.
   * @param {string[]} skillSlugs - Array of skill slugs (e.g., 'acr', 'ath').
   * @param {number} value - Proficiency level (0: none, 1: proficient, 2: expert).
   */
  updateSkills(skillSlugs, value = 1) {
    const updates = {};
    for (const slug of skillSlugs) {
      updates[`system.skills.${slug}.value`] = value;
    }
    this.updateTempData(updates);
  }

  /**
   * Updates ability saving throw proficiencies in the temporary data.
   * @param {string[]} abilities - Array of ability keys (e.g., 'str', 'dex').
   * @param {number} value - Proficiency level (usually 0 or 1).
   */
  updateSaves(abilities, value = 1) {
    const updates = {};
    for (const abl of abilities) {
      updates[`system.abilities.${abl}.proficient`] = value;
    }
    this.updateTempData(updates);
  }

  /**
   * Updates trait proficiencies (armor, weapons, tools, languages).
   * @param {string} traitPath - Path to the trait (e.g., 'armorProf', 'weaponProf', 'toolProf', 'languages').
   * @param {string[]} values - Array of slugs to add.
   */
  updateTraitProficiencies(traitPath, values) {
    if (!this.tempData) this.getCharacterJson();
    const current = new Set(foundry.utils.getProperty(this.tempData, `system.traits.${traitPath}.value`) || []);
    for (const val of values) current.add(val);
    const updates = {};
    updates[`system.traits.${traitPath}.value`] = [...current];
    this.updateTempData(updates);
  }

  /**
   * Updates the actor's hit points based on the level up.
   * @param {number} amount - Amount to increase max HP by.
   */
  updateHp(amount) {
    if (!this.tempData) this.getCharacterJson();
    const currentBase = foundry.utils.getProperty(this.tempData, "system.attributes.hp.base") || 0;
    
    const updates = {
      "system.attributes.hp.base": currentBase + amount
    };
    this.updateTempData(updates);
  }

  /**
   * Updates damage resistances, immunities, or vulnerabilities.
   * @param {string} type - Trait type ('dr', 'di', 'dv').
   * @param {string[]} values - Array of slugs to add.
   */
  updateDamageTraits(type, values) {
    if (!this.tempData) this.getCharacterJson();
    const current = new Set(foundry.utils.getProperty(this.tempData, `system.traits.${type}.value`) || []);
    for (const val of values) current.add(val);
    const updates = {};
    updates[`system.traits.${type}.value`] = [...current];
    this.updateTempData(updates);
  }
}



