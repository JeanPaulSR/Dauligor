// Repro for the Class-step freeze investigation.
// Drives normalize/build round-trips against several plausible legacy shapes
// and reports whether each round-trip converges (effects would bail) or
// diverges (effects would ping-pong).
//
// Run: npx tsx scripts/_repro_progression_loop.mjs

import {
  normalizeProgressionState,
  buildProgressionStateForCharacter,
  buildSelectedOptionsMapFromClassPackages,
  buildNonLegacySelectedOptionsMap,
  buildCharacterSelectedOptionsMap,
  buildCurrentProgression,
  buildProgressionClassGroups,
} from "../src/lib/characterLogic.ts";

function firstDiff(a, b, path = "$", depth = 0) {
  if (depth > 12) return `${path}: depth-cap`;
  if (a === b) return null;
  if (a == null || b == null || typeof a !== typeof b) {
    return `${path}: ${JSON.stringify(a)?.slice(0, 80)} vs ${JSON.stringify(b)?.slice(0, 80)}`;
  }
  if (typeof a !== "object") {
    return a === b ? null : `${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
  }
  const aIsArr = Array.isArray(a);
  const bIsArr = Array.isArray(b);
  if (aIsArr !== bIsArr) return `${path}: array vs object`;
  if (aIsArr) {
    if (a.length !== b.length) return `${path}.length: ${a.length} vs ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const d = firstDiff(a[i], b[i], `${path}[${i}]`, depth + 1);
      if (d) return d;
    }
    return null;
  }
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) {
    const onlyA = ak.filter((k) => !bk.includes(k));
    const onlyB = bk.filter((k) => !ak.includes(k));
    return `${path}: key-set diff (only-a=[${onlyA.join(",")}] only-b=[${onlyB.join(",")}])`;
  }
  if (ak.join("|") !== bk.join("|")) {
    return `${path}: key-order diff (a=[${ak.join(",")}] b=[${bk.join(",")}])`;
  }
  for (const k of ak) {
    const d = firstDiff(a[k], b[k], `${path}.${k}`, depth + 1);
    if (d) return d;
  }
  return null;
}

function canonicalStringify(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalStringify).join(",")}]`;
  const keys = Object.keys(v).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(v[k])}`).join(",")}}`;
}

const wizardClass = {
  id: "wizard",
  name: "Wizard",
  identifier: "wizard",
  sourceId: "class-wizard",
  hitDie: 6,
  spellcasting: {
    hasSpellcasting: true,
    progression: "full",
    ability: "INT",
    type: "leveled",
    level: 1,
    isRitualCaster: true,
  },
  advancements: [],
};
const fighterClass = {
  id: "fighter",
  name: "Fighter",
  identifier: "fighter",
  sourceId: "class-fighter",
  hitDie: 10,
  spellcasting: { hasSpellcasting: false },
  advancements: [],
};

const classCache = { wizard: wizardClass, fighter: fighterClass };
const subclassCache = {};

// Simulates the React effect 1's data flow:
//   character → selectedOptionsMap → buildProgressionStateForCharacter
//                                 ↘  buildSelectedOptionsMapFromClassPackages
// Compares output against the normalized current state. Returns the next
// character if the effect would write, or null if it would bail.
function effect1Tick(character) {
  const progression = buildCurrentProgression(character);
  const groups = buildProgressionClassGroups(
    progression,
    classCache,
    subclassCache,
    character.subclassId,
  );
  const selectedOptionsMap = buildCharacterSelectedOptionsMap(character);
  const nextProgressionState = buildProgressionStateForCharacter(
    character,
    groups,
    selectedOptionsMap,
    subclassCache,
  );
  const nextSelectedOptions = buildSelectedOptionsMapFromClassPackages(
    nextProgressionState.classPackages,
  );
  const currentProgressionState = normalizeProgressionState(character.progressionState);
  const currentSelectedOptions = buildNonLegacySelectedOptionsMap(
    character.selectedOptions || {},
  );

  // Match the in-app guard: canonical (key-order-insensitive) equality.
  const progEq =
    canonicalStringify(currentProgressionState) ===
    canonicalStringify(nextProgressionState);
  const selEq =
    canonicalStringify(currentSelectedOptions) ===
    canonicalStringify(nextSelectedOptions);

  if (progEq && selEq) return { wrote: false, character };
  return {
    wrote: true,
    progDiff: progEq
      ? null
      : firstDiff(currentProgressionState, nextProgressionState, "progressionState"),
    selDiff: selEq
      ? null
      : firstDiff(currentSelectedOptions, nextSelectedOptions, "selectedOptions"),
    character: {
      ...character,
      progressionState: nextProgressionState,
      selectedOptions: nextSelectedOptions,
    },
  };
}

function runScenario(label, character, maxTicks = 8) {
  console.log(`\n=== ${label} ===`);
  let cur = character;
  for (let i = 1; i <= maxTicks; i++) {
    const r = effect1Tick(cur);
    if (!r.wrote) {
      console.log(`  tick ${i}: CONVERGED (no write)`);
      return { converged: true, ticks: i };
    }
    console.log(
      `  tick ${i}: wrote — progDiff=${r.progDiff || "-"} | selDiff=${r.selDiff || "-"}`,
    );
    cur = r.character;
  }
  console.log(`  !! NEVER CONVERGED in ${maxTicks} ticks — LOOP CONFIRMED`);
  return { converged: false, ticks: maxTicks };
}

// Scenario A: clean canonical-shape character (control)
runScenario("A: empty wizard L1 (clean)", {
  id: "test-a",
  classId: "wizard",
  level: 1,
  progression: [{ classId: "wizard", className: "Wizard", subclassId: "", level: 1 }],
  selectedOptions: {},
  progressionState: {
    classPackages: [],
    ownedFeatures: [],
    ownedItems: [],
    ownedSpells: [],
    spellListExtensions: [],
    spellLoadouts: [],
    derivedSync: {},
  },
});

// Scenario B: wizard L2 with persisted package in legacy KEY ORDER but
// canonical SHAPE (no missing fields).
runScenario("B: wizard L2 with legacy key order, canonical shape", {
  id: "test-b",
  classId: "wizard",
  level: 2,
  progression: [
    { classId: "wizard", className: "Wizard", subclassId: "", level: 1 },
    { classId: "wizard", className: "Wizard", subclassId: "", level: 2 },
  ],
  selectedOptions: {},
  progressionState: {
    classPackages: [
      {
        // Reverse-ish key order
        scaleState: {},
        hitPointHistory: { 1: 6, 2: 6 },
        spellcasting: { class: wizardClass.spellcasting, subclass: null },
        grantedItemRefs: [],
        grantedFeatureRefs: [],
        advancementSelections: [],
        subclassName: "",
        subclassSourceId: "",
        subclassIdentifier: "",
        subclassId: "",
        introductionMode: "primary",
        classLevel: 2,
        className: "Wizard",
        classSourceId: "class-wizard",
        classIdentifier: "wizard",
        classId: "wizard",
      },
    ],
    ownedFeatures: [],
    ownedItems: [],
    ownedSpells: [],
    spellListExtensions: [],
    spellLoadouts: [],
    derivedSync: {},
  },
});

// Scenario C: wizard L2 with PRE-MIGRATION spellcasting shape (legacy flat
// {progression, ability, ...}) instead of the new {class, subclass} shape.
runScenario("C: wizard L2 with legacy flat spellcasting shape", {
  id: "test-c",
  classId: "wizard",
  level: 2,
  progression: [
    { classId: "wizard", className: "Wizard", subclassId: "", level: 1 },
    { classId: "wizard", className: "Wizard", subclassId: "", level: 2 },
  ],
  selectedOptions: {},
  progressionState: {
    classPackages: [
      {
        classId: "wizard",
        classIdentifier: "wizard",
        classSourceId: "class-wizard",
        className: "Wizard",
        classLevel: 2,
        introductionMode: "primary",
        subclassId: "",
        subclassIdentifier: "",
        subclassSourceId: "",
        subclassName: "",
        advancementSelections: [],
        grantedFeatureRefs: [],
        grantedItemRefs: [],
        // Legacy: flat shape, not {class, subclass}
        spellcasting: {
          progression: "full",
          ability: "INT",
          type: "leveled",
          level: 1,
          hasSpellcasting: true,
        },
        hitPointHistory: { 1: 6, 2: 6 },
        scaleState: {},
      },
    ],
    ownedFeatures: [],
    ownedItems: [],
    ownedSpells: [],
    spellListExtensions: [],
    spellLoadouts: [],
    derivedSync: {},
  },
});

// Scenario D: multi-class wizard 1 / fighter 1.
runScenario("D: wizard 1 / fighter 1 multiclass — clean shape", {
  id: "test-d",
  classId: "wizard",
  level: 2,
  progression: [
    { classId: "wizard", className: "Wizard", subclassId: "", level: 1 },
    { classId: "fighter", className: "Fighter", subclassId: "", level: 1 },
  ],
  selectedOptions: {},
  progressionState: {
    classPackages: [],
    ownedFeatures: [],
    ownedItems: [],
    ownedSpells: [],
    spellListExtensions: [],
    spellLoadouts: [],
    derivedSync: {},
  },
});

// Scenario E: wizard L2 with selectedOptions in LEGACY (non-scoped) key form.
runScenario("E: wizard L2 with legacy selectedOptions keys", {
  id: "test-e",
  classId: "wizard",
  level: 2,
  progression: [
    { classId: "wizard", className: "Wizard", subclassId: "", level: 1 },
    { classId: "wizard", className: "Wizard", subclassId: "", level: 2 },
  ],
  selectedOptions: {
    "Cantrips-1": ["fire-bolt"],
    "adv123-1": ["spell-1"],
  },
  progressionState: {
    classPackages: [],
    ownedFeatures: [],
    ownedItems: [],
    ownedSpells: [],
    spellListExtensions: [],
    spellLoadouts: [],
    derivedSync: {},
  },
});
