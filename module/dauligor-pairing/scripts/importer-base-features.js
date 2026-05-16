
export function baseClassHandler(workflow) {
  const allAdvancements = [
    ...(workflow?.payload?.class?.advancements || []),
    ...(workflow?.payload?.classItem?.system?.advancement ? Object.values(workflow.payload.classItem.system.advancement) : []),
    ...(workflow?.payload?.classItem?.advancements || []),
    ...(workflow?.payload?.classData?.advancements || []),
    ...(workflow?.payload?.semanticClassData?.advancements || []),
    ...(workflow?.classItem?.system?.advancement ? Object.values(workflow.classItem.system.advancement) : [])
  ];

  const findAdv = (idPrefix, type) => {
    return allAdvancements.find(a => {
      const id = (a?._id || a?.id || "").toLowerCase();
      if (idPrefix && id.startsWith(idPrefix.toLowerCase())) return true;
      if (id === idPrefix.toLowerCase()) return true;
      if (type && a?.type === type) return true;
      if (type === 'HitPoints' && a?.type === 'HitPoints') return true;
      if (type && a?.type === 'Trait' && a?.configuration?.type === type) return true;
      return false;
    });
  };

  const getGuaranteedAndChoice = (adv) => {
    if (!adv) {
      return { fixed: [], options: [], choiceCount: 0 };
    }

    const rawFixed = adv.configuration?.fixed || adv.configuration?.fixedIds || adv.configuration?.grants || adv.configuration?.grantsFixed || [];
    const rawOptions = adv.configuration?.options || adv.configuration?.optionIds || adv.configuration?.choices || [];
    
    // Normalize to strings/slugs
    const fixed = extractStrings(rawFixed).filter(val => !/^\d+$/.test(String(val).trim()));
    const options = extractStrings(rawOptions).filter(val => !/^\d+$/.test(String(val).trim()));

    // Extract choice count
    let choiceCount = adv.configuration?.choiceCount || adv.configuration?.choicesCount || adv.configuration?.pool || 0;
    if (choiceCount === 0) {
      // Look for a numeric value in the raw options as a fallback
      const strings = extractStrings(rawOptions);
      const digit = strings.find(val => /^\d+$/.test(String(val).trim()));
      if (digit) choiceCount = parseInt(digit, 10);
      else if (Array.isArray(rawOptions) && rawOptions[0]?.count) choiceCount = rawOptions[0].count;
      else if (Array.isArray(rawOptions) && rawOptions[0]?.pool && typeof rawOptions[0].pool === 'number') choiceCount = rawOptions[0].pool;
    }

    return {
      fixed,
      options,
      choiceCount: typeof choiceCount === 'number' ? choiceCount : 0
    };
  };


  // Two flavors of "this is a multiclass import":
  //   1. `workflow.isMulticlassImport` — set by `buildClassImportWorkflow`
  //      when the actor has another class AND this class is fresh on
  //      the actor. This is the authoritative signal because it also
  //      honors a stored `flags.dauligor-pairing.proficiencyMode = "multiclass"`
  //      sticky bit on the existing class item.
  //   2. `workflow.actor.itemTypes.class.length > 0` — the legacy
  //      fallback when workflow construction predates the flag. Kept
  //      so older payloads still infer correctly.
  const isMulticlass = workflow?.isMulticlassImport === true
    || !!(workflow?.actor?.itemTypes?.class?.length > 0);

  const hitPoints = findAdv('base-hp', 'HitPoints') || {
    _id: 'base-hp', type: 'HitPoints', title: 'Hit Points', level: 1, configuration: { hitDie: 8 }
  };
  const savingThrows = findAdv('base-saves', 'saves') || {
    _id: 'base-saves', type: 'Trait', title: 'Saving Throws', level: 1, configuration: { type: 'saves', fixed: [], options: [], choiceCount: 0 }
  };
  const armor = findAdv('base-armor', 'armor') || {
    _id: 'base-armor', type: 'Trait', title: 'Armor Proficiencies', level: 1, configuration: { type: 'armor', fixed: [], options: [], choiceCount: 0 }
  };
  const weapons = findAdv('base-weapons', 'weapons') || {
    _id: 'base-weapons', type: 'Trait', title: 'Weapon Proficiencies', level: 1, configuration: { type: 'weapons', fixed: [], options: [], choiceCount: 0 }
  };
  const skills = findAdv('base-skills', 'skills') || {
    _id: 'base-skills', type: 'Trait', title: 'Skills', level: 1, configuration: { type: 'skills', fixed: [], options: [], choiceCount: 0 }
  };
  const tools = findAdv('base-tools', 'tools') || {
    _id: 'base-tools', type: 'Trait', title: 'Tools', level: 1, configuration: { type: 'tools', fixed: [], options: [], choiceCount: 0 }
  };
  const languages = findAdv('base-languages', 'languages') || {
    _id: 'base-languages', type: 'Trait', title: 'Languages', level: 1, configuration: { type: 'languages', fixed: [], options: [], choiceCount: 0 }
  };
  const resistances = findAdv('base-resistances', 'dr') || {
    _id: 'base-resistances', type: 'Trait', title: 'Damage Resistances', level: 1, configuration: { type: 'dr', fixed: [], options: [], choiceCount: 0 }
  };
  const immunities = findAdv('base-immunities', 'di') || {
    _id: 'base-immunities', type: 'Trait', title: 'Damage Immunities', level: 1, configuration: { type: 'di', fixed: [], options: [], choiceCount: 0 }
  };
  const vulnerabilities = findAdv('base-vulnerabilities', 'dv') || {
    _id: 'base-vulnerabilities', type: 'Trait', title: 'Damage Vulnerabilities', level: 1, configuration: { type: 'dv', fixed: [], options: [], choiceCount: 0 }
  };
  const conditionImmunities = findAdv('base-condition-immunities', 'ci') || {
    _id: 'base-condition-immunities', type: 'Trait', title: 'Condition Immunities', level: 1, configuration: { type: 'ci', fixed: [], options: [], choiceCount: 0 }
  };

  const advancements = [
    { id: 'base-hp', title: 'Hit Points', adv: hitPoints, ...getGuaranteedAndChoice(hitPoints) },
    { id: 'base-saves', title: 'Saving Throws', adv: savingThrows, ...getGuaranteedAndChoice(savingThrows) },
    { id: 'base-armor', title: 'Armor Proficiencies', adv: armor, ...getGuaranteedAndChoice(armor) },
    { id: 'base-weapons', title: 'Weapon Proficiencies', adv: weapons, ...getGuaranteedAndChoice(weapons) },
    { id: 'base-skills', title: 'Skills', adv: skills, ...getGuaranteedAndChoice(skills) },
    { id: 'base-tools', title: 'Tools', adv: tools, ...getGuaranteedAndChoice(tools) },
    { id: 'base-languages', title: 'Languages', adv: languages, ...getGuaranteedAndChoice(languages) },
    { id: 'base-resistances', title: 'Damage Resistances', adv: resistances, ...getGuaranteedAndChoice(resistances) },
    { id: 'base-immunities', title: 'Damage Immunities', adv: immunities, ...getGuaranteedAndChoice(immunities) },
    { id: 'base-vulnerabilities', title: 'Damage Vulnerabilities', adv: vulnerabilities, ...getGuaranteedAndChoice(vulnerabilities) },
    { id: 'base-condition-immunities', title: 'Condition Immunities', adv: conditionImmunities, ...getGuaranteedAndChoice(conditionImmunities) }
  ];

  // Multiclass overlay. Primary-class advancements above were built
  // from `class.system.advancement` (which is the primary tree). When
  // the actor is multiclassing INTO this class, the rules grant only
  // the proficiencies listed in `multiclassProficiencies`, which is a
  // different (usually smaller) profile authored on the class. We
  // overlay it onto the corresponding rows here so the prompt loop +
  // CharacterUpdater apply use the multiclass pool instead of the
  // primary one. HP stays primary because multiclass still grants HP
  // per level. Saves are typically empty in multiclass — keep an empty
  // overlay so any primary `fixed` saves stop being applied.
  if (isMulticlass && workflow?.semanticClassData?.multiclassProficiencies) {
    const profile = workflow.semanticClassData.multiclassProficiencies;
    const mcMap = {
      'base-saves':     { kind: 'saves',     block: profile.savingThrows },
      'base-armor':     { kind: 'armor',     block: profile.armor },
      'base-weapons':   { kind: 'weapons',   block: profile.weapons },
      'base-skills':    { kind: 'skills',    block: profile.skills },
      'base-tools':     { kind: 'tools',     block: profile.tools },
      'base-languages': { kind: 'languages', block: profile.languages }
    };
    for (const entry of advancements) {
      const mc = mcMap[entry.id];
      if (!mc) continue;
      // `fixed` / `options` use the prefixed form (`skills:acr`) to
      // match what `runSkillSelectionStep` / `runTraitSelectionStep`
      // and `CharacterUpdater.updateSkills/updateSaves/...` already
      // accept. `stripTypePrefix` handles both prefixed and bare slugs
      // downstream, but staying prefixed lines us up with the primary
      // path's authored shape.
      const block = mc.block ?? {};
      entry.fixed = (block.fixedIds || []).map((slug) => `${mc.kind}:${slug}`);
      entry.options = (block.optionIds || []).map((slug) => `${mc.kind}:${slug}`);
      entry.choiceCount = Number(block.choiceCount || 0) || 0;
    }
  }

  return { isMulticlass, advancements };
}


export function extractStrings(val) {
  if (!val) return [];
  if (typeof val === 'string') return [val];
  if (Array.isArray(val)) {
    return val.flatMap(item => extractStrings(item));
  }
  if (typeof val === 'object') {
    if (val.label) return [val.label];
    if (val.name) return [val.name];
    if (val.id) return [val.id];
    if (Array.isArray(val.options)) return val.options.flatMap(opt => extractStrings(opt));
    if (Array.isArray(val.choices)) return val.choices.flatMap(opt => extractStrings(opt));
    return Object.values(val).flatMap(sub => extractStrings(sub));
  }
  return [String(val)];
}

/**
 * Formats a slug or internal ID into a human-readable label.
 * Attempts to use Foundry VTT's internal DND5E configuration if available.
 * @param {string} slug - The slug to format (e.g., 'skills:arc').
 * @returns {string} Human-readable label.
 */
export function formatFoundryLabel(slug) {
  if (!slug || typeof slug !== 'string') return String(slug ?? '');

  const originalSlug = slug.trim();
  const cleaned = originalSlug.replace(/^(saves|armor|weapons|weapon|skills|languages|tools|tool|dr|di|dv|ci):/i, "");
  const lowerCleaned = cleaned.toLowerCase();

  // Try Foundry VTT Localization/Config first if available
  if (typeof CONFIG !== 'undefined' && CONFIG.DND5E) {
    const config = CONFIG.DND5E;
    const sources = [
      config.skills,
      config.abilities,
      config.armorProficiencies,
      config.weaponProficiencies,
      config.toolProficiencies,
      config.languages,
      config.damageTypes,
      config.damageResistanceTypes,
      config.conditionTypes
    ];

    for (const source of sources) {
      if (!source) continue;
      const entry = source[lowerCleaned];
      if (entry) {
        if (typeof entry === 'string') return entry;
        if (entry.label) return entry.label;
      }
    }
  }

  const lookup = {
    str: "Strength",
    dex: "Dexterity",
    con: "Constitution",
    int: "Intelligence",
    wis: "Wisdom",
    cha: "Charisma",
    lgt: "Light Armor",
    med: "Medium Armor",
    hvy: "Heavy Armor",
    shl: "Shields",
    shield: "Shields",
    padded: "Padded",
    leather: "Leather",
    "studded-leather": "Studded Leather",
    hide: "Hide",
    "chain-shirt": "Chain Shirt",
    scale: "Scale Mail",
    "scale-mail": "Scale Mail",
    breastplate: "Breastplate",
    "half-plate": "Half Plate",
    ring: "Ring Mail",
    chain: "Chain Mail",
    "chain-mail": "Chain Mail",
    splint: "Splint",
    plate: "Plate",
    sim: "Simple Weapons",
    mar: "Martial Weapons",
    longsword: "Longsword",
    shortsword: "Shortsword",
    shortbow: "Shortbow",
    longbow: "Longbow",
    dagger: "Dagger",
    handcrossbow: "Hand Crossbow",
    rapier: "Rapier",
    club: "Club",
    lightcrossbow: "Light Crossbow",
    dart: "Dart",
    greatclub: "Greatclub",
    handaxe: "Handaxe",
    javelin: "Javelin",
    lighthammer: "Light Hammer",
    mace: "Mace",
    quarterstaff: "Quarterstaff",
    sickle: "Sickle",
    sling: "Sling",
    spear: "Spear",
    acr: "Acrobatics",
    ani: "Animal Handling",
    arc: "Arcana",
    ath: "Athletics",
    dec: "Deception",
    his: "History",
    ins: "Insight",
    itm: "Intimidation",
    inv: "Investigation",
    med: "Medicine",
    nat: "Nature",
    prc: "Perception",
    prf: "Performance",
    per: "Persuasion",
    rel: "Religion",
    slt: "Sleight of Hand",
    ste: "Stealth",
    sur: "Survival",
    common: "Common",
    dwarvish: "Dwarvish",
    elvish: "Elvish",
    giant: "Giant",
    gnomish: "Gnomish",
    goblin: "Goblin",
    halfling: "Halfling",
    orc: "Orc",
    abyssal: "Abyssal",
    celestial: "Celestial",
    draconic: "Draconic",
    deep: "Deep Speech",
    infernal: "Infernal",
    primordial: "Primordial",
    sylvan: "Sylvan",
    undercommon: "Undercommon",
    alchemist: "Alchemist's Supplies",
    brewer: "Brewer's Supplies",
    carpenter: "Carpenter's Tools",
    cartographer: "Cartographer's Tools",
    cobbler: "Cobbler's Tools",
    glassblower: "Glassblower's Tools",
    leatherworker: "Leatherworker's Tools",
    woodcarver: "Woodcarver's Tools",
    calligrapher: "Calligrapher's Supplies",
    cook: "Cook's Utensils",
    mason: "Mason's Tools",
    jeweler: "Jeweler's Tools",
    painter: "Painter's Supplies",
    potter: "Potter's Tools",
    smith: "Smith's Tools",
    weaver: "Weaver's Tools",
    tinker: "Tinker's Tools",
    thief: "Thieves' Tools",
    disg: "Disguise Kit",
    forg: "Forgery Kit",
    herb: "Herbalism Kit",
    navg: "Navigator's Tools",
    pois: "Poisoner's Kit",
    music: "Musical Instrument",
    acid: "Acid",
    bludgeoning: "Bludgeoning",
    cold: "Cold",
    fire: "Fire",
    force: "Force",
    lightning: "Lightning",
    necrotic: "Necrotic",
    piercing: "Piercing",
    poison: "Poison",
    psychic: "Psychic",
    radiant: "Radiant",
    slashing: "Slashing",
    thunder: "Thunder",
    blinded: "Blinded",
    charmed: "Charmed",
    deafened: "Deafened",
    exhaustion: "Exhaustion",
    frightened: "Frightened",
    grappled: "Grappled",
    incapacitated: "Incapacitated",
    invisible: "Invisible",
    paralyzed: "Paralyzed",
    petrified: "Petrified",
    poisoned: "Poisoned",
    prone: "Prone",
    restrained: "Restrained",
    stunned: "Stunned",
    unconscious: "Unconscious"
  };


  if (lookup[lowerCleaned]) return lookup[lowerCleaned];

  // If all else fails, capitalize and format the cleaned string
  return cleaned
    .split(/[-_ ]+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}



