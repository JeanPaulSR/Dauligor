import { db } from './firebase';
import { doc, getDoc } from 'firebase/firestore';
import { saveAs } from 'file-saver';
import { slugify } from './classExport';

/**
 * Interface representing the export format for a Character.
 * We align this conceptually with Foundry VTT's actor schema
 * and the applet's internal representation.
 */
export interface CharacterExportBundle {
  _id: string;
  name: string;
  type: string;
  system: any;
  flags: any;
  items: any[];
}

/**
 * Fetches the complete character data from Firestore and constructs
 * a JSON payload ready for external systems (e.g., Foundry VTT) or backups.
 */
export async function buildCharacterExport(characterId: string): Promise<CharacterExportBundle | null> {
  const charDoc = await getDoc(doc(db, 'characters', characterId));
  
  if (!charDoc.exists()) {
    return null;
  }
  
  const charData = charDoc.data() as any;

  // We abstract the raw data into a modular export payload, mimicking standard schema
  const payload: CharacterExportBundle = {
    _id: charDoc.id,
    name: charData.name || "Unnamed Character",
    type: "character",
    system: {
      attributes: {
        hp: {
          value: charData.hp?.current || 0,
          max: charData.hp?.max || 0,
          temp: charData.hp?.temp || 0,
        },
        ac: {
          flat: charData.ac || 10
        },
        movement: {
          walk: charData.speed || 30
        },
        init: {
          value: charData.initiative || 0
        },
        prof: charData.proficiencyBonus || 2
      },
      details: {
        level: charData.level || 1,
        alignment: charData.info?.alignment || "",
        race: charData.raceId || "",
        background: charData.backgroundId || "",
        biography: {
          value: charData.info?.appearance || ""
        }
      },
      traits: {
        size: charData.raceData?.size || "med",
        dr: {
          value: charData.resistances || []
        },
        di: {
          value: charData.immunities || []
        },
        dv: {
          value: charData.vulnerabilities || []
        },
        languages: {
          value: charData.languages || []
        }
      },
      abilities: {
        str: { value: charData.stats?.base?.STR || 10 },
        dex: { value: charData.stats?.base?.DEX || 10 },
        con: { value: charData.stats?.base?.CON || 10 },
        int: { value: charData.stats?.base?.INT || 10 },
        wis: { value: charData.stats?.base?.WIS || 10 },
        cha: { value: charData.stats?.base?.CHA || 10 }
      },
      resources: {
        spellPoints: {
          value: charData.spellPoints?.current || 0,
          max: charData.spellPoints?.max || 0
        }
      }
    },
    flags: {
      "dauligor-pairing": {
        isLevelLocked: charData.isLevelLocked || false,
        campaignId: charData.campaignId || "",
        classId: charData.classId || "",
        subclassId: charData.subclassId || "",
        selectedOptions: charData.selectedOptions || {},
      }
    },
    items: [] // Items and spells could be populated here later
  };

  return payload;
}

/**
 * Triggers a download of the semantic character export JSON file.
 * @param characterId The ID of the character in the database.
 */
export async function exportCharacterJSON(characterId: string) {
  const payload = await buildCharacterExport(characterId);
  if (!payload) {
    throw new Error("Character not found or could not be loaded for export.");
  }
  
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const safeName = slugify(payload.name);
  saveAs(blob, `dauligor-character-${safeName}-${characterId}.json`);
}
