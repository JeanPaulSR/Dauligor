import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { db, handleFirestoreError, OperationType } from "../../lib/firebase";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  query,
  getDocs,
  where,
  documentId,
} from "firebase/firestore";
import { Button } from "../../components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { ImageUpload } from "../../components/ui/ImageUpload";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "../../components/ui/dialog";
import {
  Save,
  ChevronLeft,
  User,
  Shield,
  Package,
  Zap,
  Wind,
  Star,
  Clock,
  Settings,
  Plus,
  Minus,
  Edit2,
  Hammer,
  Check,
  Users,
  Scroll,
  Dna,
  Sword,
  ShieldCheck,
  Eye,
  Copy,
  ChevronUp,
  Download,
} from "lucide-react";
import { ClassList } from "../compendium/ClassList";
import BBCodeRenderer from "../../components/BBCodeRenderer";
import { exportCharacterJSON } from "../../lib/characterExport";

const getModifier = (score: number) => {
  const mod = Math.floor((score - 10) / 2);
  return mod >= 0 ? `+${mod}` : mod.toString();
};

const StatBlock = ({
  label,
  value,
  score,
  onPlus,
  onMinus,
}: {
  label: string;
  value: string;
  score: number;
  onPlus: () => void;
  onMinus: () => void;
}) => (
  <div className="flex flex-col items-center group relative pb-4">
    <div className="mb-1">
      <span className="text-xs uppercase font-black text-ink/60 tracking-widest leading-none">
        {label}
      </span>
    </div>
    <div className="w-full h-20 bg-card border-2 border-gold/20 rounded-lg flex flex-col items-center justify-center p-2 shadow-sm transition-all group-hover:border-gold group-hover:shadow-[0_0_15px_rgba(197,160,89,0.2)]">
      <span className="text-3xl font-black text-ink leading-none">{value}</span>
    </div>
    <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 bg-gold px-3 py-1 rounded-sm z-10 border border-gold/40 shadow-md">
      <span className="text-xs font-black text-white leading-none">
        {score}
      </span>
    </div>
    <div className="absolute -right-3 top-1/2 -translate-y-1/2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-20">
      <button
        onClick={onPlus}
        className="p-1 px-1.5 bg-ink text-gold rounded border border-gold/30 shadow-lg hover:bg-gold hover:text-white transition-all active:scale-90"
      >
        <Plus className="w-3 h-3" />
      </button>
      <button
        onClick={onMinus}
        className="p-1 px-1.5 bg-ink text-gold rounded border border-gold/30 shadow-lg hover:bg-gold hover:text-white transition-all active:scale-90"
      >
        <Minus className="w-3 h-3" />
      </button>
    </div>
  </div>
);

const STEPS = [
  { id: "sheet", label: "Character Sheet", icon: <Save className="w-4 h-4" /> },
  { id: "race", label: "Race", icon: <User className="w-4 h-4" /> },
  { id: "class", label: "Class", icon: <Shield className="w-4 h-4" /> },
  {
    id: "equipment",
    label: "Equipment",
    icon: <Package className="w-4 h-4" />,
  },
  { id: "spells", label: "Spells", icon: <Zap className="w-4 h-4" /> },
  { id: "actions", label: "Actions", icon: <Wind className="w-4 h-4" /> },
  {
    id: "proficiencies",
    label: "Proficiencies",
    icon: <Star className="w-4 h-4" />,
  },
  { id: "history", label: "History", icon: <Clock className="w-4 h-4" /> },
];

export default function CharacterBuilder({
  userProfile,
}: {
  userProfile: any;
}) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeStep, setActiveStep] = useState("sheet");
  const [isSelectingClass, setIsSelectingClass] = useState(false);
  const [isSelectingSubclass, setIsSelectingSubclass] = useState({
    open: false,
    classId: "",
    level: 0,
  });
  const [availableSubclasses, setAvailableSubclasses] = useState<any[]>([]);
  const [classCache, setClassCache] = useState<Record<string, any>>({});
  const [subclassCache, setSubclassCache] = useState<Record<string, any>>({});
  const [featureCache, setFeatureCache] = useState<Record<string, any[]>>({});
  const [scalingCache, setScalingCache] = useState<Record<string, any>>({});
  const [optionsCache, setOptionsCache] = useState<Record<string, any>>({});

  const [optionDialogOpen, setOptionDialogOpen] = useState<{
    name: string;
    count: number;
    advId: string;
    level: number;
    featureType?: string;
    optionGroupId?: string;
  } | null>(null);
  const [availableOptions, setAvailableOptions] = useState<any[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);

  const handleOpenOptionDialog = async (choice: {
    name: string;
    count: number;
    advId: string;
    level: number;
    featureType?: string;
    optionGroupId?: string;
    configuration?: any;
    advType?: string;
  }) => {
    setOptionDialogOpen(choice);
    setLoadingOptions(true);
    setAvailableOptions([]);
    try {
      if (choice.optionGroupId) {
        const q = query(
          collection(db, "uniqueOptionItems"),
          where("groupId", "==", choice.optionGroupId),
        );
        const snapshot = await getDocs(q);
        const excludedOptionIds = new Set(choice.configuration?.excludedOptionIds || []);
        const items = snapshot.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((item: any) => !excludedOptionIds.has(item.id));
        setAvailableOptions(items);
        setOptionsCache((prev) => {
          const nc = { ...prev };
          items.forEach((i) => (nc[i.id] = i));
          return nc;
        });
      } else if (choice.configuration?.choiceType === "feature") {
        const pool = choice.configuration?.pool || [];
        if (pool.length > 0) {
          // Firestore 'in' query supports up to 30 values in most recent versions, but 10 in older. 
          // We'll slice just in case.
          const q = query(
            collection(db, "features"),
            where(documentId(), "in", pool.slice(0, 30))
          );
          const snapshot = await getDocs(q);
          const items = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
          setAvailableOptions(items);
          setOptionsCache((prev) => {
            const nc = { ...prev };
            items.forEach((i) => (nc[i.id] = i));
            return nc;
          });
        }
      } else if (choice.advType === "Trait") {
        let pool = choice.configuration?.choices?.[0]?.pool || [];
        if (!pool || pool.length === 0) {
          pool = choice.configuration?.pool || [];
        }
        const traitType = choice.configuration?.choices?.[0]?.type || choice.configuration?.type;

        if (pool.length > 0) {
          try {
            const skillsQuery = query(collection(db, "skills"), where(documentId(), "in", pool.slice(0, 30)));
            const toolsQuery = query(collection(db, "tools"), where(documentId(), "in", pool.slice(0, 30)));
            const attrsQuery = query(collection(db, "attributes"), where(documentId(), "in", pool.slice(0, 30)));
            
            const [skillsSnap, toolsSnap, attrsSnap] = await Promise.all([
              getDocs(skillsQuery).catch(() => ({ docs: [] })),
              getDocs(toolsQuery).catch(() => ({ docs: [] })),
              getDocs(attrsQuery).catch(() => ({ docs: [] }))
            ]);
            
            const skills = skillsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
            const tools = toolsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
            const attrs = attrsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
            
            const merged = [...skills, ...tools, ...attrs];
            setAvailableOptions(merged);
            setOptionsCache((prev) => {
              const nc = { ...prev };
              merged.forEach((i) => (nc[i.id] = i));
              return nc;
            });
          } catch (e) {
            console.error("Error fetching trait options", e);
          }
        }
      } else {
        const targetFeatureType =
          choice.featureType ||
          choice.name.toLowerCase().replace(/[^a-z0-9]/g, "-");
        const q = query(
          collection(db, "uniqueOptionItems"),
          where("featureType", "==", targetFeatureType),
        );
        const snapshot = await getDocs(q);
        const items = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        setAvailableOptions(items);
        setOptionsCache((prev) => {
          const nc = { ...prev };
          items.forEach((i) => (nc[i.id] = i));
          return nc;
        });
      }
    } catch (err) {
      console.error("Failed to load options", err);
    } finally {
      setLoadingOptions(false);
    }
  };

  const handleRemoveClass = (className: string) => {
    setCharacter((prev: any) => {
      const newProg = (prev.progression || []).filter(
        (p: any) => p.className !== className,
      );
      
      // Re-calculate level and reset main class if necessary
      const newLevel = newProg.length;
      let nextClassId = prev.classId;
      let nextSubclassId = prev.subclassId;

      // Find the class document by name to compare with prev.classId
      const removedClassDoc = Object.values(classCache).find(c => c.name === className);
      
      if (removedClassDoc && prev.classId === removedClassDoc.id) {
        if (newProg.length > 0) {
          const firstClassDoc = Object.values(classCache).find(c => c.name === newProg[0].className);
          nextClassId = firstClassDoc ? firstClassDoc.id : "";
        } else {
          nextClassId = "";
        }
      }

      // Clear subclass if NO levels of the class it belongs to remain
      if (prev.subclassId) {
        const subclassDoc = subclassCache[prev.subclassId];
        if (subclassDoc) {
          const parentClass = Object.values(classCache).find(c => c.id === subclassDoc.classId);
          if (parentClass) {
            const remainingLevels = newProg.filter(p => p.className === parentClass.name).length;
            if (remainingLevels === 0) {
              nextSubclassId = "";
            }
          }
        }
      }

      if (newProg.length === 0) {
        nextClassId = "";
        nextSubclassId = "";
      }

      return {
        ...prev,
        level: newLevel,
        progression: newProg,
        classId: nextClassId,
        subclassId: nextSubclassId,
      };
    });
  };

  const [character, setCharacter] = useState<any>({
    name: "",
    level: 1,
    isLevelLocked: false,
    campaignId: "",
    classId: "",
    subclassId: "",
    backgroundId: "",
    raceId: "",
    imageUrl: "",
    hasInspiration: false,
    exhaustion: 0,
    hp: { current: 10, max: 10, temp: 0 },
    hitDie: { current: 1, max: 1, type: "d10" },
    spellPoints: { current: 0, max: 0 },
    ac: 10,
    initiative: 0,
    speed: 30,
    proficiencyBonus: 2,
    stats: {
      base: {
        STR: 10,
        DEX: 10,
        CON: 10,
        INT: 10,
        WIS: 10,
        CHA: 10,
      },
    },
    savingThrows: [],
    proficientSkills: [],
    expertiseSkills: [],
    halfProficientSkills: [],
    halfProficientSavingThrows: [],
    overriddenSkillAbilities: {},
    resistances: [],
    immunities: [],
    vulnerabilities: [],
    armorProficiencies: [],
    weaponProficiencies: [],
    toolProficiencies: [],
    languages: [],
    senses: {
      passivePerception: 10,
      passiveInvestigation: 10,
      passiveInsight: 10,
      additional: "",
    },
    raceData: {
      creatureType: "",
      size: "",
    },
    info: {
      alignment: "",
      gender: "",
      eyes: "",
      height: "",
      hair: "",
      skin: "",
      age: "",
      weight: "",
      deity: "",
      reverate: "",
      scorn: "",
      traits: "",
      ideals: "",
      bonds: "",
      flaws: "",
      appearance: "",
    },
    bookmarks: [],
    selectedOptions: {}, // e.g. { "Invocations": ["item_id_1", "item_id_2"] }
  });

  useEffect(() => {
    const fetchSelectedOptions = async () => {
      const allSelectedIds = Object.values(
        character.selectedOptions || {},
      ).flat() as string[];
      if (allSelectedIds.length === 0) return;

      const missingIds = allSelectedIds.filter((id) => !optionsCache[id]);
      if (missingIds.length === 0) return;

      try {
        const fetchPromises = missingIds.map((id: string) =>
          getDoc(doc(db, "uniqueOptionItems", id)),
        );
        const results = await Promise.all(fetchPromises);
        setOptionsCache((prev) => {
          const nc = { ...prev };
          results.forEach((res) => {
            if (res.exists()) {
              nc[res.id] = { id: res.id, ...res.data() };
            }
          });
          return nc;
        });
      } catch (err) {
        console.error("Failed to load options cache", err);
      }
    };
    fetchSelectedOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [character.selectedOptions]);

  useEffect(() => {
    const fetchFeatures = async () => {
      try {
        const progression =
          (character.progression && character.progression.length > 0)
            ? character.progression
            : (character.classId
              ? Array.from({ length: character.level || 1 }).map((_, i) => ({
                  className: character.classId,
                  level: i + 1,
                }))
              : []);
        if (progression.length === 0) return;

        // Get unique class names
        const classNames: string[] = Array.from(
          new Set(progression.map((p: any) => p.className)),
        );

        let newClassCache = { ...classCache };
        const missingNames = classNames.filter(
          (name) => !Object.values(newClassCache).find((c) => c.name === name),
        );

        if (missingNames.length > 0) {
          const req = await getDocs(query(collection(db, "classes")));
          req.docs.forEach((doc) => {
            const data = doc.data();
            newClassCache[doc.id] = { id: doc.id, ...data };
          });
          setClassCache(newClassCache);
        }

        // Feature caching
        const classIdsInProgression = classNames
          .map((name) => {
            const found = Object.values(newClassCache).find(
              (c) => c.name === name,
            );
            return found ? found.id : null;
          })
          .filter(Boolean) as string[];

        // Subclass caching
        let newSubclassCache = { ...subclassCache };
        const missingSubclassIds = (
          character.subclassId ? [character.subclassId] : []
        ).filter((id) => !newSubclassCache[id]);
        if (missingSubclassIds.length > 0) {
          const scPromises = missingSubclassIds.map((id) =>
            getDoc(doc(db, "subclasses", id)),
          );
          const scResults = await Promise.all(scPromises);
          scResults.forEach((res) => {
            if (res.exists())
              newSubclassCache[res.id] = { id: res.id, ...res.data() };
          });
          setSubclassCache(newSubclassCache);
        }

        let newFeatureCache = { ...featureCache };
        const missingClassIds = classIdsInProgression.filter(
          (id) => !newFeatureCache[id],
        );
        const subclassIds = Object.keys(newSubclassCache);
        const missingSubclassFIds = subclassIds.filter(
          (id) => !newFeatureCache[id],
        );

        if (missingClassIds.length > 0 || missingSubclassFIds.length > 0) {
          const featurePromises = [
            ...missingClassIds.map((id) => ({ id, type: "class" })),
            ...missingSubclassFIds.map((id) => ({ id, type: "subclass" })),
          ].map(async ({ id, type }) => {
            const featureQuery = query(
              collection(db, "features"),
              where("parentId", "==", id),
              where("parentType", "==", type),
            );
            const fSnap = await getDocs(featureQuery);
            return {
              id,
              features: fSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
            };
          });

          const results = await Promise.all(featurePromises);
          results.forEach((res) => {
            newFeatureCache[res.id] = res.features;
          });
          setFeatureCache(newFeatureCache);
        }

        // Scaling Columns caching
        let newScalingCache = { ...scalingCache };
        const missingScalingParentIds = [
          ...classIdsInProgression,
          ...subclassIds,
        ].filter(
          (id) =>
            !Object.values(newScalingCache).some((col) => col.parentId === id),
        );

        if (missingScalingParentIds.length > 0) {
          const scalingPromises = missingScalingParentIds.map(async (id) => {
            const scalingQuery = query(
              collection(db, "scalingColumns"),
              where("parentId", "==", id),
            );
            const sSnap = await getDocs(scalingQuery);
            return sSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
          });

          const results = await Promise.all(scalingPromises);
          results.flat().forEach((col) => {
            newScalingCache[col.id] = col;
          });
          setScalingCache(newScalingCache);
        }
      } catch (err) {
        console.error("Failed to load class features:", err);
      }
    };
    fetchFeatures();
  }, [
    character.progression,
    character.classId,
    character.level,
    character.subclassId,
  ]);

  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [allSkills, setAllSkills] = useState<any[]>([]);
  const [allAttributes, setAllAttributes] = useState<any[]>([]);
  const isStaff = ["admin", "co-dm"].includes(userProfile?.role);
  const isAdmin = userProfile?.role === "admin";

  const generatePairingJson = () => {
    const skillMap: Record<string, string> = {
      acrobatics: "acr",
      animal_handling: "ani",
      arcana: "arc",
      athletics: "ath",
      deception: "dec",
      history: "his",
      insight: "ins",
      intimidation: "itm",
      investigation: "inv",
      medicine: "med",
      nature: "nat",
      perception: "prc",
      performance: "prf",
      persuasion: "per",
      religion: "rel",
      sleight_of_hand: "slt",
      stealth: "ste",
      survival: "sur",
    };

    const skills: Record<string, any> = {};
    allSkills.forEach((s) => {
      const isProf = character.proficientSkills?.includes(s.id);
      const isExp = character.expertiseSkills?.includes(s.id);
      const isHalf = character.halfProficientSkills?.includes(s.id);

      let val = 0;
      if (isExp) val = 2;
      else if (isProf) val = 1;
      else if (isHalf) val = 0.5;

      const key = skillMap[s.id] || s.id.substring(0, 3);
      skills[key] = {
        value: val,
        ability: (
          character.overriddenSkillAbilities?.[s.id] || s.ability
        ).toLowerCase(),
      };
    });

    const abilities: Record<string, any> = {};
    const attrIdentifiers = allAttributes.length > 0 
      ? allAttributes.map(a => a.identifier || a.id)
      : ["STR", "DEX", "CON", "INT", "WIS", "CHA"];

    attrIdentifiers.forEach((a) => {
      const key = a.toLowerCase();
      const isProf = character.savingThrows?.includes(a);
      const isHalf = character.halfProficientSavingThrows?.includes(a);

      abilities[key] = {
        value: character.stats?.base?.[a] ?? 10,
        proficient: isProf ? 1 : isHalf ? 0.5 : 0,
      };
    });

    const items: any[] = [];
    (character.classes || []).forEach((clsData: any) => {
      const clsDoc = classCache[clsData.classId];
      if (clsDoc) {
        items.push({
          name: clsDoc.name,
          type: "class",
          img: clsDoc.imageUrl || "icons/svg/item-bag.svg",
          system: {
            identifier: clsDoc.name.toLowerCase().replace(/\s+/g, "-"),
            levels: clsData.level || 1,
            hd: clsDoc.hitDie
              ? {
                  number: clsData.level || 1,
                  denomination: clsDoc.hitDie.replace("d", ""),
                }
              : { number: 1, denomination: "10" },
            spellcasting: clsDoc.spellcasting || {
              progression: "none",
              ability: "",
            },
            primaryAbility: { value: [clsDoc.primaryAbility || "str"] },
            advancement: (clsDoc.advancements || []).map((adv: any) => {
              const res = { ...adv };
              const selectionKey = `${adv._id}-${adv.level}`;
              
              if (adv.type === "HitPoints") {
                const hdMatch = (clsDoc.hitDie || "d8").match(/\d+/);
                const hdSize = hdMatch ? parseInt(hdMatch[0]) : 8;
                const avg = Math.floor(hdSize / 2) + 1;
                
                const hpValue: Record<string, string | number> = { "1": "max" };
                for (let i = 2; i <= clsData.level; i++) {
                  hpValue[i.toString()] = avg;
                }
                res.value = hpValue;
              } else if (character.selectedOptions?.[selectionKey]) {
                if (
                  adv.type === "Trait" ||
                  adv.type === "ItemChoice" ||
                  adv.type === "Subclass"
                ) {
                  const chosenRaw = character.selectedOptions[selectionKey] || [];
                  let chosenSemantic = chosenRaw;
                  if (adv.type === "Trait") {
                    chosenSemantic = chosenRaw.map((id: string) => {
                      const cached =
                        optionsCache[id] ||
                        allSkills.find((s) => s.id === id) ||
                        allAttributes.find(
                          (a) => a.id === id || a.identifier === id,
                        );
                      if (cached) {
                        if (cached.ability) {
                          // Assuming skills have 'ability'
                          const code =
                            (skillMap as any)[id] || id.substring(0, 3);
                          return `skills:${code}`;
                        } else if (
                          cached.identifier &&
                          cached.identifier.length === 3
                        ) {
                          // Attributes/Saves
                          return `saves:${cached.identifier.toLowerCase()}`;
                        } else {
                          return `tools:${id.replace(/[^a-z0-9]/g, "").substring(0, 3)}`; // Fallback for tools
                        }
                      }
                      return id;
                    });
                  }
                  res.value = {
                    chosen: chosenSemantic,
                  };
                }
              }
              return res;
            }),
          },
          flags: {
            "dauligor-pairing": {
              sourceId: `class-${clsDoc.id}`,
            },
          },
        });

        const features = featureCache[clsDoc.id] || [];
        features.forEach((feat: any) => {
          if (feat.level <= clsData.level) {
            items.push({
              name: feat.name,
              type: "feat",
              img: feat.imageUrl || "icons/svg/book.svg",
              system: {
                description: { value: feat.description || "" },
                identifier: feat.name.toLowerCase().replace(/\W+/g, "-"),
                type: { value: "class", subtype: "" },
              },
              flags: {
                "dauligor-pairing": {
                  sourceId: `feature-${feat.id}`,
                },
              },
            });
          }
        });
      }

      if (clsData.subclassId) {
        const subDoc = subclassCache[clsData.subclassId];
        if (subDoc) {
          items.push({
            name: subDoc.name,
            type: "subclass",
            img: subDoc.imageUrl || "icons/svg/item-bag.svg",
            system: {
              identifier: subDoc.name.toLowerCase().replace(/\s+/g, "-"),
              classIdentifier: clsDoc
                ? clsDoc.name.toLowerCase().replace(/\s+/g, "-")
                : "",
              advancement: (subDoc.advancements || []).map((adv: any) => {
                const res = { ...adv };
                const selectionKey = `${adv._id}-${adv.level}`;
                if (character.selectedOptions?.[selectionKey]) {
                  if (
                    adv.type === "Trait" ||
                    adv.type === "ItemChoice" ||
                    adv.type === "Subclass"
                  ) {
                    res.value = {
                      chosen: character.selectedOptions[selectionKey],
                    };
                  }
                }
                return res;
              }),
            },
            flags: {
              "dauligor-pairing": {
                sourceId: `subclass-${subDoc.id}`,
              },
            },
          });

          const subFeatures = featureCache[subDoc.id] || [];
          subFeatures.forEach((feat: any) => {
            if (feat.level <= clsData.level) {
              items.push({
                name: feat.name,
                type: "feat",
                img: feat.imageUrl || "icons/svg/book.svg",
                system: {
                  description: { value: feat.description || "" },
                  identifier: feat.name.toLowerCase().replace(/\W+/g, "-"),
                  type: { value: "subclass", subtype: "" },
                },
                flags: {
                  "dauligor-pairing": {
                    sourceId: `feature-${feat.id}`,
                  },
                },
              });
            }
          });
        }
      }
    });

    return {
      kind: "dauligor.actor-bundle.v1",
      schemaVersion: 1,
      source: {
        system: "dauligor",
        entity: "actor",
        id: character.id || id || "new",
        rules: "2014",
        revision: 1
      },
      actor: {
        name: character.name || "UNNAMED ADVENTURER",
        type: "character",
        img: character.imageUrl || "icons/svg/mystery-man.svg",
        system: {
          abilities,
          attributes: {
            hp: {
              value: character.hp?.current ?? 10,
              max: character.hp?.max ?? 10,
              temp: character.hp?.temp ?? 0,
            },
            ac: {
              flat: character.ac ?? 10,
              calc: "flat",
            },
            init: { bonus: character.initiative ?? 0 },
            movement: { walk: character.speed ?? 30, units: "ft" },
            prof: character.proficiencyBonus ?? 2,
            exhaustion: character.exhaustion ?? 0,
          },
          details: {
            alignment: character.info?.alignment ?? "",
            race: character.raceId ?? "",
            background: character.backgroundId ?? "",
            biography: {
              value: `
                ${character.info?.appearance ? `<h3>Appearance</h3><p>${character.info.appearance}</p>` : ""}
                ${character.info?.traits ? `<h3>Traits</h3><p>${character.info.traits}</p>` : ""}
                ${character.info?.ideals ? `<h3>Ideals</h3><p>${character.info.ideals}</p>` : ""}
                ${character.info?.bonds ? `<h3>Bonds</h3><p>${character.info.bonds}</p>` : ""}
                ${character.info?.flaws ? `<h3>Flaws</h3><p>${character.info.flaws}</p>` : ""}
              `.trim(),
            },
          },
          skills,
          traits: {
            size: (character.raceData?.size || "Medium")
              .toLowerCase()
              .substring(0, 3),
            languages: { value: character.languages || [] },
            dr: { value: character.resistances || [] },
            di: { value: character.immunities || [] },
            dv: { value: character.vulnerabilities || [] },
          },
        },
        flags: {
          "dauligor-pairing": {
            sourceId: `character-${character.id || id || "new"}`,
            entityKind: "character",
            schemaVersion: 1,
          },
        },
      },
      items,
    };
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        if (id && id !== "new") {
          const docRef = doc(db, "characters", id);
          const snap = await getDoc(docRef);
          if (snap.exists()) {
            const data = snap.data();
            const normalizedBase: Record<string, number> = {};
            const rawBase = data.stats?.base || { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 };
            Object.entries(rawBase).forEach(([key, val]) => {
              normalizedBase[key.toUpperCase()] = Number(val);
            });

            setCharacter({
              id: snap.id,
              ...data,
              hp: data.hp || { current: 10, max: 10, temp: 0 },
              hitDie: data.hitDie || { current: 1, max: 1, type: "d10" },
              spellPoints: data.spellPoints || { current: 0, max: 0 },
              ac: data.ac ?? 10,
              initiative: data.initiative ?? 0,
              speed: data.speed ?? 30,
              proficiencyBonus: data.proficiencyBonus ?? 2,
              savingThrows: (data.savingThrows || []).map((s: string) => s.toUpperCase()),
              expertiseSavingThrows: (data.expertiseSavingThrows || []).map((s: string) => s.toUpperCase()),
              halfProficientSavingThrows: (data.halfProficientSavingThrows || []).map((s: string) => s.toUpperCase()),
              proficientSkills: data.proficientSkills || [],
              expertiseSkills: data.expertiseSkills || [],
              halfProficientSkills: data.halfProficientSkills || [],
              overriddenSkillAbilities: data.overriddenSkillAbilities || {},
              resistances: data.resistances || [],
              immunities: data.immunities || [],
              vulnerabilities: data.vulnerabilities || [],
              armorProficiencies: data.armorProficiencies || [],
              weaponProficiencies: data.weaponProficiencies || [],
              toolProficiencies: data.toolProficiencies || [],
              languages: data.languages || [],
              senses: data.senses || {
                passivePerception: 10,
                passiveInvestigation: 10,
                passiveInsight: 10,
                additional: "",
              },
              raceData: data.raceData || { creatureType: "", size: "" },
              info: data.info || {
                alignment: "",
                gender: "",
                eyes: "",
                height: "",
                hair: "",
                skin: "",
                age: "",
                weight: "",
                deity: "",
                reverate: "",
                scorn: "",
                traits: "",
                ideals: "",
                bonds: "",
                flaws: "",
                appearance: "",
              },
              stats: {
                ...(data.stats || { method: "point-buy" }),
                base: normalizedBase,
              },
            });
          } else {
            navigate("/characters");
          }
        }

        if (isStaff) {
          const campSnap = await getDocs(query(collection(db, "campaigns")));
          setCampaigns(campSnap.docs.map((c) => ({ id: c.id, ...c.data() })));
        }

        const skillsSnap = await getDocs(query(collection(db, "skills")));
        setAllSkills(skillsSnap.docs.map((s) => ({ id: s.id, ...s.data() })));

        // Fetch Attributes
        const attrSnap = await getDocs(query(collection(db, "attributes")));
        const attrs = attrSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const uniqueAttrsMap = new Map();
        attrs.forEach((item: any) => {
          const key = (item.identifier || item.id).toUpperCase();
          if (!uniqueAttrsMap.has(key) || item.identifier) {
            uniqueAttrsMap.set(key, item);
          }
        });
        const uniqueAttrs = Array.from(uniqueAttrsMap.values());
        setAllAttributes(uniqueAttrs.sort((a: any, b: any) => {
          const orderA = typeof a.order === 'number' ? a.order : 999;
          const orderB = typeof b.order === 'number' ? b.order : 999;
          if (orderA !== orderB) return orderA - orderB;
          return (a.name || '').localeCompare(b.name || '');
        }));
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, "characters");
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [id, navigate, isStaff]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const isNew = !id || id === "new";
      const charId = isNew ? doc(collection(db, "characters")).id : id;
      const ref = doc(db, "characters", charId as string);

      const payload = {
        ...character,
        userId: isNew ? userProfile.uid : character.userId,
        updatedAt: new Date().toISOString(),
      };
      if (isNew) payload.createdAt = payload.updatedAt;

      if (isNew) {
        await setDoc(ref, payload);
        navigate(`/characters/builder/${charId}`);
      } else {
        await updateDoc(ref, payload);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, "characters");
    } finally {
      setSaving(false);
    }
  };

  const handleInfoChange = (field: string, value: string) => {
    setCharacter((prev: any) => ({
      ...prev,
      info: {
        ...prev.info,
        [field]: value,
      },
    }));
  };

  const [showPointBuy, setShowPointBuy] = useState(false);

  const getSafeStat = (attr: string) => {
    return character.stats?.base?.[attr] ?? 10;
  };

  const handleStatChange = (attr: string, delta: number) => {
    setCharacter((prev: any) => ({
      ...prev,
      stats: {
        ...prev.stats,
        base: {
          ...prev.stats.base,
          [attr]: Math.max(
            1,
            Math.min(30, (prev.stats.base[attr] || 10) + delta),
          ),
        },
      },
    }));
  };

  const getSafeModifier = (attr: string) => {
    const score = getSafeStat(attr);
    const mod = Math.floor((score - 10) / 2);
    return mod >= 0 ? `+${mod}` : mod.toString();
  };

  const getSkillTotal = (skillId: string) => {
    const skill = allSkills.find((s) => s.id === skillId);
    if (!skill) return 0;

    // Check for overridden ability
    const ability =
      character.overriddenSkillAbilities?.[skillId] || skill.ability;

    const isProficient = character.proficientSkills?.includes(skill.id);
    const isExpert = character.expertiseSkills?.includes(skill.id);
    const isHalf = character.halfProficientSkills?.includes(skill.id);
    const mod = parseInt(getSafeModifier(ability));
    const bonus = character.proficiencyBonus || 2;

    let profBonus = 0;
    if (isExpert) profBonus = bonus * 2;
    else if (isProficient) profBonus = bonus;
    else if (isHalf) profBonus = Math.floor(bonus / 2);

    return mod + profBonus;
  };

  const getPassiveScore = (skillId: string) => {
    return 10 + getSkillTotal(skillId);
  };

  if (loading) return null;

  return (
    <div className="max-w-7xl mx-auto pb-24 pt-4 px-2 sm:px-4 lg:px-6">
      {/* Top Header & Save */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-gold/20 pb-4 mb-6">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/characters")}
            className="text-gold gap-2 hover:bg-gold/5 uppercase tracking-widest text-[10px] font-black h-8"
          >
            <ChevronLeft className="w-4 h-4" />{" "}
            <span className="hidden xs:inline">Characters</span>
          </Button>
          <div className="h-4 w-px bg-gold/20" />
          <p className="label-text opacity-40 whitespace-nowrap">Workroom</p>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto sm:overflow-visible pb-1 sm:pb-0">
          {isAdmin && (
            <Dialog>
              <DialogTrigger
                render={
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-gold/30 text-gold hover:bg-gold/5 gap-2 uppercase tracking-widest text-[10px] font-black h-8"
                  >
                    <Eye className="w-3.5 h-3.5" /> View JSON
                  </Button>
                }
              />
              <DialogContent className="sm:max-w-2xl bg-parchment border-gold/30 p-0 overflow-hidden">
                <DialogHeader className="p-6 bg-ink text-gold border-b border-gold/20">
                  <DialogTitle className="text-xl font-serif font-black uppercase tracking-tight">
                    Foundry Pairing Output
                  </DialogTitle>
                  <DialogDescription className="text-gold/60 font-serif italic">
                    Formatted for the dauligor-pairing module bridge
                  </DialogDescription>
                </DialogHeader>
                <div className="p-6 bg-card/40">
                  <pre className="bg-ink p-4 rounded-lg overflow-auto max-h-[400px] text-xs font-mono text-gold/80 border border-gold/10 custom-scrollbar">
                    {JSON.stringify(generatePairingJson(), null, 2)}
                  </pre>
                </div>
                <DialogFooter className="p-4 bg-ink/5 border-t border-gold/10">
                  <Button
                    className="bg-gold text-white hover:bg-gold/80 gap-2 uppercase tracking-widest text-[10px] font-black"
                    onClick={() => {
                      navigator.clipboard.writeText(
                        JSON.stringify(generatePairingJson(), null, 2),
                      );
                    }}
                  >
                    <Copy className="w-3 h-3" /> Copy to Clipboard
                  </Button>
                  <DialogClose
                    render={
                      <Button
                        variant="ghost"
                        className="text-ink/40 hover:text-ink/60 uppercase tracking-widest text-[10px] font-black"
                      >
                        Close
                      </Button>
                    }
                  />
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}

          {id && id !== "new" && (
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  await exportCharacterJSON(id as string);
                } catch (error) {
                  console.error(error);
                }
              }}
              title="Export Full Semantic Character Payload"
              className="border-gold/20 text-gold hover:bg-gold/10 gap-2 uppercase tracking-widest text-[10px] font-black h-8 px-3"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Export</span>
            </Button>
          )}

          <Button
            onClick={handleSave}
            disabled={saving}
            size="sm"
            className="bg-gold hover:bg-gold/80 text-white gap-2 uppercase tracking-widest text-[10px] font-black px-4 h-8 transition-all shadow-md active:scale-95"
          >
            <Save className="w-3.5 h-3.5" />{" "}
            {saving ? "Writing..." : "Commit Changes"}
          </Button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* MAIN AREA */}
        <div className="flex-1 min-h-[500px] lg:min-h-[800px]">
          {activeStep === "sheet" ? (
            <div className="space-y-6 bg-card/10 p-4 sm:p-6 md:p-8 rounded-xl border border-gold/10 relative shadow-inner h-full min-h-[500px]">
              {/* COMPACT CHARACTER HEADER */}
              <div className="flex flex-col md:flex-row items-center gap-4 md:gap-6 border-b-2 border-gold/10 pb-6 md:pb-8 mb-6 md:mb-8">
                <div className="flex-1 w-full text-center md:text-left space-y-1">
                  <Input
                    value={character.name}
                    onChange={(e) =>
                      setCharacter({ ...character, name: e.target.value })
                    }
                    placeholder="UNNAMED ADVENTURER"
                    className="text-3xl sm:text-4xl md:text-5xl font-serif font-black text-ink bg-transparent border-none p-0 focus-visible:ring-0 placeholder:text-ink/10 h-auto tracking-tighter uppercase text-center md:text-left"
                  />
                  <div className="label-text flex flex-wrap items-center justify-center md:justify-start gap-2 sm:gap-3">
                    <span className="bg-gold text-white px-1.5 py-0.5 rounded-sm text-[9px] sm:text-[10px]">
                      LVL {character.level}
                    </span>
                    <span className="text-ink/60 truncate max-w-[120px]">
                      {character.classId || "No Class"}
                    </span>
                    <span className="w-1 h-1 sm:w-1.5 sm:h-1.5 bg-gold/20 rounded-full" />
                    <span className="text-ink/60 truncate max-w-[120px]">
                      {character.raceId || "No Race"}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-3 sm:gap-4 md:gap-6 flex-wrap justify-center border-t border-gold/5 pt-4 md:pt-0 md:border-none">
                  {/* HEROIC INSPIRATION */}
                  <div
                    className="flex flex-col items-center cursor-pointer group"
                    onClick={() =>
                      setCharacter({
                        ...character,
                        hasInspiration: !character.hasInspiration,
                      })
                    }
                  >
                    <div
                      className={`w-12 h-12 border-2 flex items-center justify-center rounded-lg transition-all duration-300 ${character.hasInspiration ? "bg-gold border-gold text-ink shadow-[0_0_15px_rgba(197,160,89,0.5)]" : "bg-transparent border-gold/20 text-gold/20 group-hover:border-gold/50"}`}
                    >
                      <Star
                        className={`w-7 h-7 transition-all duration-500 ${character.hasInspiration ? "scale-110 rotate-[72deg]" : ""}`}
                        fill={
                          character.hasInspiration ? "currentColor" : "none"
                        }
                      />
                    </div>
                    <span className="text-[8px] uppercase font-black text-ink/40 mt-1.5 tracking-[0.1em]">
                      Inspiration
                    </span>
                  </div>

                  {/* EXHAUSTION */}
                  <div className="flex flex-col items-center">
                    <div className="w-24 h-12 border-2 border-gold/20 flex items-center justify-between px-2 bg-muted rounded-lg group hover:border-gold/30 transition-colors shadow-sm">
                      <button
                        onClick={() =>
                          setCharacter({
                            ...character,
                            exhaustion: Math.max(0, character.exhaustion - 1),
                          })
                        }
                        className="text-ink/40 hover:text-rose-700 transition-colors"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <div className="flex flex-col items-center -space-y-1">
                        <span
                          className={`${character.exhaustion > 0 ? "text-rose-700" : "text-ink/20"} text-base font-black`}
                        >
                          {character.exhaustion}
                        </span>
                      </div>
                      <button
                        onClick={() =>
                          setCharacter({
                            ...character,
                            exhaustion: Math.min(6, character.exhaustion + 1),
                          })
                        }
                        className="text-ink/40 hover:text-rose-700 transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <span className="text-[7px] uppercase font-black text-ink/30 mt-1 tracking-widest">
                      Exhaustion
                    </span>
                  </div>
                </div>
              </div>

              {/* ABILITY SCORES - TIGHTER GRID */}
              <div className="grid grid-cols-3 md:grid-cols-6 gap-3 md:gap-4 mb-10">
                {allAttributes.map((attr) => {
                  const iden = attr.identifier || attr.id;
                  return (
                    <StatBlock
                      key={attr.id}
                      label={attr.name}
                      value={getSafeModifier(iden)}
                      score={getSafeStat(iden)}
                      onPlus={() => handleStatChange(iden, 1)}
                      onMinus={() => handleStatChange(iden, -1)}
                    />
                  );
                })}
                {allAttributes.length === 0 && ["STR", "DEX", "CON", "INT", "WIS", "CHA"].map((attr) => (
                  <StatBlock
                    key={attr}
                    label={attr}
                    value={getSafeModifier(attr)}
                    score={getSafeStat(attr)}
                    onPlus={() => handleStatChange(attr, 1)}
                    onMinus={() => handleStatChange(attr, -1)}
                  />
                ))}
              </div>

              <div className="grid xl:grid-cols-2 gap-8">
                {/* PORTRAIT & CORE STATUS */}
                <div className="border border-gold/20 p-5 flex flex-col xl:flex-row gap-6 rounded-lg bg-card/50 shadow-sm relative group transition-all hover:bg-card/80 hover:shadow-md">
                  <div className="w-full sm:w-48 xl:w-36 aspect-[3/4] border-2 border-gold/10 bg-card relative rounded-md overflow-hidden flex-shrink-0 shadow-inner group/portrait mx-auto xl:mx-0 self-center xl:self-start">
                    {character.imageUrl ? (
                      <img
                        src={character.imageUrl}
                        alt="Portrait"
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center text-ink/40 font-serif italic text-base p-4 text-center bg-muted/20">
                        <User className="w-12 h-12 mb-3 opacity-20" />
                        No Portrait
                      </div>
                    )}
                    <div className="absolute inset-0 bg-ink/60 opacity-0 group-hover/portrait:opacity-100 transition-all flex flex-col items-center justify-center p-2 text-center">
                      <ImageUpload
                        currentImageUrl={character.imageUrl}
                        storagePath={`images/characters/${id || "new"}/`}
                        onUpload={(url) =>
                          setCharacter({ ...character, imageUrl: url })
                        }
                        className="scale-75"
                      />
                    </div>
                    {/* AC SHIELD */}
                    <div
                      className="absolute top-1 left-1 w-11 h-13 bg-gold text-white border border-white/20 flex flex-col items-center justify-center shadow-lg pt-0.5"
                      style={{
                        clipPath:
                          "polygon(0% 0%, 100% 0%, 100% 80%, 50% 100%, 0% 80%)",
                      }}
                    >
                      <span className="text-lg font-black leading-none">
                        {character.ac}
                      </span>
                      <span className="text-[7px] uppercase font-black text-white/80 tracking-tighter">
                        AC
                      </span>
                    </div>
                  </div>

                  <div className="flex-1 space-y-4 py-1">
                    {/* HIT POINTS */}
                    <div className="space-y-1.5">
                      <div className="flex justify-between items-baseline px-0.5">
                        <h4 className="label-text text-ink/40">Hit Points</h4>
                        <div className="flex items-baseline gap-1 text-ink font-black leading-none">
                          <span className="text-xl">
                            {character.hp.current}
                          </span>
                          <span className="text-xs text-ink/20">/</span>
                          <span className="text-xs text-ink/60">
                            {character.hp.max}
                          </span>
                        </div>
                      </div>

                      <div className="h-4 bg-muted/50 border border-gold/10 rounded-full group relative overflow-hidden p-[1px]">
                        <div
                          className="h-full bg-emerald-600 rounded-full transition-all duration-700 shadow-[inset_0_1px_2px_rgba(255,255,255,0.3)]"
                          style={{
                            width: `${Math.min(100, (character.hp.current / character.hp.max) * 100)}%`,
                          }}
                        />
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-card/10 backdrop-blur-[1px]">
                          <div className="flex gap-2">
                            <button
                              onClick={() =>
                                setCharacter({
                                  ...character,
                                  hp: {
                                    ...character.hp,
                                    current: Math.min(
                                      character.hp.max,
                                      character.hp.current + 1,
                                    ),
                                  },
                                })
                              }
                              className="w-5 h-5 bg-card text-ink border border-gold/20 hover:bg-emerald-500 hover:text-white rounded-full flex items-center justify-center shadow-sm"
                            >
                              <Plus className="w-2.5 h-2.5" />
                            </button>
                            <button
                              onClick={() =>
                                setCharacter({
                                  ...character,
                                  hp: {
                                    ...character.hp,
                                    current: Math.max(
                                      0,
                                      character.hp.current - 1,
                                    ),
                                  },
                                })
                              }
                              className="w-5 h-5 bg-card text-ink border border-gold/20 hover:bg-rose-500 hover:text-white rounded-full flex items-center justify-center shadow-sm"
                            >
                              <Minus className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* VITAL CORE STATS */}
                    <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
                      {[
                        {
                          label: "INITIATIVE",
                          shortLabel: "INIT",
                          value:
                            character.initiative >= 0
                              ? `+${character.initiative}`
                              : character.initiative,
                        },
                        {
                          label: "SPEED",
                          shortLabel: "SPD",
                          value: `${character.speed}ft`,
                        },
                        {
                          label: "PROFICIENCY",
                          shortLabel: "PROF",
                          value: `+${character.proficiencyBonus}`,
                        },
                      ].map((stat) => (
                        <div
                          key={stat.label}
                          className="p-1 px-1 sm:p-2 sm:py-3 border border-gold/20 bg-card rounded flex flex-col items-center justify-center shadow-sm transition-all hover:-translate-y-0.5 min-w-0"
                        >
                          <span className="text-[7px] sm:text-[8px] xl:text-[7px] 2xl:text-[8px] text-ink/40 font-black tracking-tighter sm:tracking-widest leading-tight uppercase mb-0.5 truncate w-full text-center">
                            <span className="hidden sm:inline-block xl:hidden 2xl:inline-block">
                              {stat.label}
                            </span>
                            <span className="inline-block sm:hidden xl:inline-block 2xl:hidden">
                              {stat.shortLabel}
                            </span>
                          </span>
                          <span className="text-[10px] sm:text-xs font-black text-ink leading-none">
                            {stat.value}
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* SLIM RESOURCE METERS */}
                    <div className="space-y-3 pt-3 border-t border-gold/10">
                      <div className="flex items-center gap-3">
                        <span className="text-[8px] uppercase font-black text-ink/40 w-16">
                          Hit Dice
                        </span>
                        <div className="flex-1 h-2 bg-muted rounded-sm border border-gold/5 overflow-hidden">
                          <div
                            className="h-full bg-rose-700/70"
                            style={{
                              width: `${(character.hitDie.current / character.hitDie.max) * 100}%`,
                            }}
                          />
                        </div>
                        <span className="text-[10px] font-black text-ink/60 w-6 text-right">
                          {character.hitDie.current}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-[8px] uppercase font-black text-ink/40 w-16">
                          Spell Points
                        </span>
                        <div className="flex-1 h-2 bg-muted rounded-sm border border-gold/5 overflow-hidden">
                          <div
                            className="h-full bg-indigo-700/70"
                            style={{
                              width: `${character.spellPoints.max > 0 ? (character.spellPoints.current / character.spellPoints.max) * 100 : 0}%`,
                            }}
                          />
                        </div>
                        <span className="text-[10px] font-black text-ink/60 w-6 text-right">
                          {character.spellPoints.current}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* SAVING THROWS */}
                <div className="border border-gold/20 p-4 sm:p-6 rounded-lg bg-card/40 shadow-sm group">
                  <div className="section-header mb-4 sm:mb-6">
                    <h3 className="text-base sm:text-lg font-serif font-black uppercase text-ink/80 flex items-center gap-2 tracking-tight">
                      <ShieldCheck className="w-4 h-4 sm:w-5 sm:h-5 text-gold" />
                      Saving Throws
                    </h3>
                  </div>
                  <div className="grid grid-cols-1 xs:grid-cols-2 gap-x-6 sm:gap-x-12 gap-y-3 sm:gap-y-4">
                    {(allAttributes.length > 0 ? allAttributes : [
                      { id: 'STR', identifier: 'STR', name: 'STR' },
                      { id: 'DEX', identifier: 'DEX', name: 'DEX' },
                      { id: 'CON', identifier: 'CON', name: 'CON' },
                      { id: 'INT', identifier: 'INT', name: 'INT' },
                      { id: 'WIS', identifier: 'WIS', name: 'WIS' },
                      { id: 'CHA', identifier: 'CHA', name: 'CHA' }
                    ]).map((attrObj) => {
                      const attrIden = attrObj.identifier || attrObj.id;
                      const attrName = attrObj.name;
                      const isProficient =
                        character.savingThrows?.includes(attrIden);
                      const isExpert =
                        character.expertiseSavingThrows?.includes(attrIden); 
                      const isHalf =
                        character.halfProficientSavingThrows?.includes(attrIden);

                      const baseMod = parseInt(getModifier(getSafeStat(attrIden)));
                      const bonus = character.proficiencyBonus || 2;
                      let profBonus = 0;
                      if (isExpert) profBonus = bonus * 2;
                      else if (isProficient) profBonus = bonus;
                      else if (isHalf) profBonus = Math.floor(bonus / 2);

                      const total = baseMod + profBonus;

                      return (
                        <div
                          key={attrObj.id}
                          className="flex items-center justify-between group/row cursor-pointer py-1"
                          onClick={() => {
                            let newProf = [...(character.savingThrows || [])];
                            let newExp = [
                              ...(character.expertiseSavingThrows || []),
                            ];
                            let newHalf = [
                              ...(character.halfProficientSavingThrows || []),
                            ];
                            if (isHalf)
                              newHalf = newHalf.filter(
                                (s: string) => s !== attrIden,
                              );
                            else if (isExpert) {
                              newExp = newExp.filter((s: string) => s !== attrIden);
                              newHalf.push(attrIden);
                            } else if (isProficient) {
                              newProf = newProf.filter(
                                (s: string) => s !== attrIden,
                              );
                              newExp.push(attrIden);
                            } else newProf.push(attrIden);
                            setCharacter({
                              ...character,
                              savingThrows: newProf,
                              expertiseSavingThrows: newExp,
                              halfProficientSavingThrows: newHalf,
                            });
                          }}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            let newProf = [...(character.savingThrows || [])];
                            let newExp = [
                              ...(character.expertiseSavingThrows || []),
                            ];
                            let newHalf = [
                              ...(character.halfProficientSavingThrows || []),
                            ];
                            if (isHalf) {
                              newHalf = newHalf.filter(
                                (s: string) => s !== attrIden,
                              );
                              newExp.push(attrIden);
                            } else if (isExpert) {
                              newExp = newExp.filter((s: string) => s !== attrIden);
                              newProf.push(attrIden);
                            } else if (isProficient)
                              newProf = newProf.filter(
                                (s: string) => s !== attrIden,
                              );
                            else newHalf.push(attrIden);
                            setCharacter({
                              ...character,
                              savingThrows: newProf,
                              expertiseSavingThrows: newExp,
                              halfProficientSavingThrows: newHalf,
                            });
                          }}
                        >
                          <div className="flex items-center gap-4">
                            <div
                              className={`w-5 h-5 rounded-full border-2 relative transition-all flex items-center justify-center ${isProficient || isExpert || isHalf ? "border-gold" : "border-gold/30 group-hover/row:border-gold/60"} ${isProficient ? "bg-gold" : ""}`}
                            >
                              {isExpert && (
                                <div className="w-full h-full rounded-full bg-gold border-[3px] border-card flex items-center justify-center">
                                  <div className="w-1.5 h-1.5 bg-gold rounded-full" />
                                </div>
                              )}
                              {isHalf && (
                                <div
                                  className="absolute inset-0 bg-gold rounded-full"
                                  style={{
                                    clipPath:
                                      "polygon(0 0, 50% 0, 50% 100%, 0 100%)",
                                  }}
                                />
                              )}
                            </div>
                            <span
                              className={`text-xl font-black tracking-tight transition-colors ${isProficient || isExpert || isHalf ? "text-ink" : "text-ink/40"}`}
                            >
                              {attrName}
                            </span>
                          </div>
                          <span className="text-xl font-black text-ink">
                            {total >= 0 ? `+${total}` : total}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="grid md:grid-cols-3 gap-6 pt-4">
                {/* SKILLS & TOOLS COLUMN */}
                <div className="space-y-6">
                  <div className="p-4 border border-gold/20 bg-card/50 flex flex-col">
                    <div className="section-header mb-4">
                      <h3 className="label-text flex items-center gap-2">
                        <Package className="w-3 h-3 text-gold" />
                        Skills
                      </h3>
                      <Settings className="w-3 h-3 text-ink/20" />
                    </div>
                    <div className="flex flex-col">
                      {allSkills.map((skill, idx) => {
                        const isProficient =
                          character.proficientSkills?.includes(skill.id);
                        const isExpert = character.expertiseSkills?.includes(
                          skill.id,
                        );
                        const isHalf = character.halfProficientSkills?.includes(
                          skill.id,
                        );
                        const currentAbility =
                          character.overriddenSkillAbilities?.[skill.id] ||
                          skill.ability;
                        const total = getSkillTotal(skill.id);

                        return (
                          <div
                            key={skill.id}
                            className={`flex items-center gap-2 py-1 relative group ${idx !== allSkills.length - 1 ? "border-b border-dashed border-gold/10" : ""}`}
                          >
                            {/* Proficiency Cycle Button */}
                            <button
                              onClick={() => {
                                let newProf = [
                                  ...(character.proficientSkills || []),
                                ];
                                let newExp = [
                                  ...(character.expertiseSkills || []),
                                ];
                                let newHalf = [
                                  ...(character.halfProficientSkills || []),
                                ];

                                if (isHalf) {
                                  newHalf = newHalf.filter(
                                    (s: string) => s !== skill.id,
                                  );
                                } else if (isExpert) {
                                  newExp = newExp.filter(
                                    (s: string) => s !== skill.id,
                                  );
                                  newHalf.push(skill.id);
                                } else if (isProficient) {
                                  newProf = newProf.filter(
                                    (s: string) => s !== skill.id,
                                  );
                                  newExp.push(skill.id);
                                } else {
                                  newProf.push(skill.id);
                                }
                                setCharacter({
                                  ...character,
                                  proficientSkills: newProf,
                                  expertiseSkills: newExp,
                                  halfProficientSkills: newHalf,
                                });
                              }}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                let newProf = [
                                  ...(character.proficientSkills || []),
                                ];
                                let newExp = [
                                  ...(character.expertiseSkills || []),
                                ];
                                let newHalf = [
                                  ...(character.halfProficientSkills || []),
                                ];

                                if (isHalf) {
                                  newHalf = newHalf.filter(
                                    (s: string) => s !== skill.id,
                                  );
                                  newExp.push(skill.id);
                                } else if (isExpert) {
                                  newExp = newExp.filter(
                                    (s: string) => s !== skill.id,
                                  );
                                  newProf.push(skill.id);
                                } else if (isProficient) {
                                  newProf = newProf.filter(
                                    (s: string) => s !== skill.id,
                                  );
                                } else {
                                  newHalf.push(skill.id);
                                }
                                setCharacter({
                                  ...character,
                                  proficientSkills: newProf,
                                  expertiseSkills: newExp,
                                  halfProficientSkills: newHalf,
                                });
                              }}
                              className="w-5 h-5 flex items-center justify-center flex-shrink-0"
                            >
                              <div
                                className={`w-3 h-3 rounded-full border-2 relative flex items-center justify-center transition-all ${isProficient || isExpert || isHalf ? "border-gold" : "border-gold/30 group-hover:border-gold/60"} ${isProficient ? "bg-gold" : ""}`}
                              >
                                {isExpert && (
                                  <div className="w-full h-full rounded-full bg-gold border-[2px] border-card flex items-center justify-center">
                                    <div className="w-1 h-1 bg-gold rounded-full" />
                                  </div>
                                )}
                                {isHalf && (
                                  <div
                                    className="absolute inset-0 bg-gold rounded-full"
                                    style={{
                                      clipPath:
                                        "polygon(0 0, 50% 0, 50% 100%, 0 100%)",
                                    }}
                                  />
                                )}
                              </div>
                            </button>

                            {/* Ability Select */}
                            <div className="w-8 flex-shrink-0">
                              <select
                                value={currentAbility}
                                onChange={(e) => {
                                  setCharacter({
                                    ...character,
                                    overriddenSkillAbilities: {
                                      ...(character.overriddenSkillAbilities ||
                                        {}),
                                      [skill.id]: e.target.value,
                                    },
                                  });
                                }}
                                className="bg-transparent text-[9px] sm:text-[10px] font-black text-gold/60 uppercase hover:text-gold transition-colors focus:outline-none cursor-pointer appearance-none px-0.5 w-full text-center"
                              >
                                {["STR", "DEX", "CON", "INT", "WIS", "CHA"].map(
                                  (a) => (
                                    <option
                                      key={a}
                                      value={a}
                                      className="bg-card text-ink"
                                    >
                                      {a}
                                    </option>
                                  ),
                                )}
                              </select>
                            </div>

                            {/* Skill Name */}
                            <span
                              className={`text-[11px] sm:text-xs font-black uppercase flex-1 transition-colors tracking-tighter truncate ${isProficient || isExpert || isHalf ? "text-ink" : "text-ink/30"}`}
                            >
                              {skill.name}
                            </span>

                            {/* Total Bonus */}
                            <span className="text-xs font-black text-ink/80 w-6 sm:w-8 text-right font-mono flex-shrink-0">
                              {total >= 0 ? `+${total}` : total}
                            </span>

                            {/* Small context cog */}
                            <button className="opacity-0 group-hover:opacity-20 transition-opacity hover:!opacity-60">
                              <Settings className="w-2.5 h-2.5 text-ink" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="p-4 border border-gold/20 bg-card/50 space-y-3">
                    <h4 className="label-text border-b border-gold/10 pb-2 flex items-center gap-2">
                      <Hammer className="w-3 h-3" />
                      Tool Proficiencies
                    </h4>
                    <div className="space-y-1">
                      {character.toolProficiencies?.length ? (
                        character.toolProficiencies.map((item: string) => (
                          <div
                            key={item}
                            className="text-xs font-bold text-ink/70 flex items-center gap-2 uppercase tracking-tight"
                          >
                            <div className="w-1.5 h-1.5 bg-gold/40 rounded-full" />
                            {item}
                          </div>
                        ))
                      ) : (
                        <p className="text-[10px] italic text-ink/30 uppercase font-black">
                          No specialized tools
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="md:col-span-2 space-y-4">
                  {/* TAB HEADER */}
                  <div className="flex items-center gap-2 border-b border-gold/10 pb-2">
                    <button className="px-4 py-2 bg-gold text-white text-xs font-black uppercase tracking-widest border border-gold shadow-md shadow-gold/20">
                      Character Info
                    </button>
                    {/* Add future tabs here */}
                  </div>

                  {/* CONTENT */}
                  <div className="grid md:grid-cols-2 gap-6">
                    {/* SENSES & DEFENSES */}
                    <div className="space-y-6">
                      <div className="p-4 border border-gold/20 bg-card/50 space-y-3 shadow-sm">
                        <div className="section-header mb-2">
                          <span className="label-text flex items-center gap-2">
                            <Zap className="w-3 h-3" />
                            Passive Traits
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                          {[
                            {
                              label: "Perception",
                              value: getPassiveScore("perception"),
                            },
                            {
                              label: "Investigation",
                              value: getPassiveScore("investigation"),
                            },
                            {
                              label: "Insight",
                              value: getPassiveScore("insight"),
                            },
                          ].map((sense) => (
                            <div
                              key={sense.label}
                              className="flex flex-col items-center gap-1"
                            >
                              <div className="w-full aspect-square bg-card border border-gold/10 text-ink flex items-center justify-center font-black rounded-sm shadow-sm text-lg">
                                {sense.value}
                              </div>
                              <span className="text-[9px] font-black text-gold/60 tracking-tight text-center leading-[1.1]">
                                {sense.label}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="p-4 border border-gold/20 bg-card/50 space-y-5">
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <span className="label-text text-ink/30 border-l-2 border-gold pl-2">
                              Languages
                            </span>
                            <div className="flex flex-wrap gap-1">
                              {character.languages?.length ? (
                                character.languages.map((l: string) => (
                                  <span
                                    key={l}
                                    className="px-2 py-0.5 bg-gold/5 border border-gold/10 rounded-sm text-[10px] font-bold text-gold uppercase"
                                  >
                                    {l}
                                  </span>
                                ))
                              ) : (
                                <span className="text-[10px] font-bold text-ink/30 italic uppercase">
                                  Common
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="space-y-2">
                            <span className="label-text text-ink/30 border-l-2 border-rose-500 pl-2">
                              Resistances
                            </span>
                            <div className="flex flex-wrap gap-1">
                              {character.resistances?.length ? (
                                character.resistances.map((l: string) => (
                                  <span
                                    key={l}
                                    className="px-2 py-0.5 bg-rose-50 border border-rose-200/50 rounded-sm text-[10px] font-bold text-rose-800 uppercase"
                                  >
                                    {l}
                                  </span>
                                ))
                              ) : (
                                <span className="text-[10px] font-bold text-ink/10 italic uppercase">
                                  None
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* IDENTITY & PROFICIENCY STACK */}
                    <div className="space-y-4">
                      {[
                        {
                          title: character.raceId || "Select Race",
                          sub: character.raceData?.size || "Creature Size",
                          icon: <Dna className="w-5 h-5" />,
                          type: "Race",
                        },
                        {
                          title:
                            character.raceData?.creatureType || "Creature Type",
                          sub: "",
                          icon: <Users className="w-5 h-5" />,
                          type: "Creature Type",
                        },
                        {
                          title: character.backgroundId || "Select Background",
                          sub: "",
                          icon: <Scroll className="w-5 h-5" />,
                          type: "Background",
                        },
                        {
                          title: "Armor Proficiencies",
                          sub:
                            character.armorProficiencies?.join(", ") || "None",
                          icon: <Shield className="w-5 h-5" />,
                          type: "",
                        },
                        {
                          title: "Weapon Proficiencies",
                          sub:
                            character.weaponProficiencies?.join(", ") || "None",
                          icon: <Sword className="w-5 h-5" />,
                          type: "",
                        },
                      ].map((item, idx) => (
                        <div
                          key={idx}
                          className="p-3 border border-gold/20 bg-card/60 rounded-md relative group flex items-center gap-4 transition-all hover:bg-card/80"
                        >
                          <div className="w-12 h-12 flex-shrink-0 bg-gold/10 rounded flex items-center justify-center border border-gold/20 text-gold shadow-sm group-hover:scale-105 transition-transform">
                            {item.icon}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4
                              className={`text-lg font-serif font-black uppercase tracking-tight leading-none line-clamp-1 transition-colors ${
                                item.title.startsWith("Select") ||
                                item.title === "Creature Type"
                                  ? "text-ink/20 italic"
                                  : "text-ink"
                              }`}
                            >
                              {item.title}
                            </h4>
                            {item.sub && (
                              <p
                                className={`font-bold uppercase tracking-widest mt-1.5 line-clamp-2 ${
                                  item.sub === "Creature Size"
                                    ? "text-[9px] text-ink/20 italic"
                                    : "text-xs text-ink/40"
                                }`}
                              >
                                {item.sub}
                              </p>
                            )}
                          </div>
                          {item.type && (
                            <div className="absolute top-2 right-3 opacity-20 group-hover:opacity-60 transition-opacity">
                              <span className="text-[8px] font-black uppercase tracking-[0.3em] text-ink">
                                {item.type}
                              </span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : activeStep === "class" ? (
            <div className="bg-background/50 rounded-xl border border-gold/10 h-full min-h-[500px]">
              {isSelectingClass ? (
                <div className="p-4 sm:p-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <ClassList
                    userProfile={userProfile}
                    selectionMode={true}
                    onSelectClass={(cls) => {
                      setCharacter((prev: any) => {
                        const newProg = [...(prev.progression || [])];
                        // If no progression, this is the first class choice
                        if (newProg.length === 0) {
                          return {
                            ...prev,
                            classId: cls.name,
                            progression: [{ className: cls.name, level: 1 }],
                            level: 1,
                          };
                        }
                        // Adding a new class or an extra level of a selected class
                        const currentClassLevel = newProg.filter(
                          (p: any) => p.className === cls.name,
                        ).length;
                        return {
                          ...prev,
                          progression: [
                            ...newProg,
                            { className: cls.name, level: currentClassLevel + 1 },
                          ],
                          level: (prev.level || newProg.length) + 1,
                        };
                      });
                      setIsSelectingClass(false);
                    }}
                    onCancelSelection={() => setIsSelectingClass(false)}
                  />
                </div>
              ) : (
                <div className="p-4 sm:p-8 flex flex-col h-full min-h-[500px]">
                  <div className="flex-1 flex flex-col gap-6 w-full text-left max-w-4xl mx-auto">
                    {/* Top Box: Classes Summary */}
                    <div className="border border-gold/20 bg-card p-6 rounded-xl shadow-sm mb-4">
                      <div className="flex justify-end mb-4">
                        <Button
                          onClick={() => setIsSelectingClass(true)}
                          variant="ghost"
                          title="Add Class"
                          className="text-gold hover:bg-gold/10 font-bold uppercase tracking-widest text-xs gap-2"
                        >
                          <Plus className="w-4 h-4" /> Add Class
                        </Button>
                      </div>
                      <div className="space-y-3">
                        {(() => {
                          const currentProgression =
                            character.progression &&
                            character.progression.length > 0
                              ? character.progression
                              : character.classId
                                ? Array.from({
                                    length: character.level || 1,
                                  }).map((_, i) => ({
                                    className: character.classId,
                                    level: i + 1,
                                  }))
                                : [];
                          const classSummary = currentProgression.reduce(
                            (acc: Record<string, number>, prog: any) => {
                              if (!acc[prog.className]) acc[prog.className] = 0;
                              acc[prog.className]++;
                              return acc;
                            },
                            {} as Record<string, number>,
                          );
                          const classEntries = Object.entries(classSummary);

                          if (classEntries.length === 0) {
                            return (
                              <div className="text-center py-6 text-ink/40 font-serif italic text-lg">
                                No classes added yet. Select Add Class to begin.
                              </div>
                            );
                          }

                          return classEntries.map(([className, lvl]) => (
                            <div
                              key={className}
                              className="flex justify-between items-center group"
                            >
                              <div className="flex items-baseline gap-2 pl-2">
                                <span className="font-serif text-xl font-bold text-ink">
                                  {className} {lvl as number}
                                </span>
                              </div>
                               <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleRemoveClass(className)}
                                className="text-blood/60 hover:text-white hover:bg-blood uppercase font-bold tracking-widest text-[10px] transition-colors"
                              >
                                Remove Class
                              </Button>
                            </div>
                          ));
                        })()}
                      </div>
                    </div>

                    {/* Progression List */}
                    {(() => {
                      const currentProgression =
                        (character.progression && character.progression.length > 0)
                          ? character.progression
                          : character.classId
                          ? Array.from({ length: character.level || 1 }).map(
                              (_, i) => ({
                                className: character.classId,
                                level: i + 1,
                              }),
                            )
                          : [];
                      if (currentProgression.length === 0) return null;

                      return (
                        <div className="space-y-6">
                          <div className="space-y-4">
                            {currentProgression.map(
                              (prog: any, idx: number) => {
                                const matchedClass = Object.values(
                                  classCache,
                                ).find((c) => c.name === prog.className);
                                const matchedSubclass = character.subclassId
                                  ? subclassCache[character.subclassId]
                                  : null;

                                const classFeatures =
                                  matchedClass && featureCache[matchedClass.id]
                                    ? featureCache[matchedClass.id].filter(
                                        (f) => f.level === prog.level,
                                      )
                                    : [];
                                const subclassFeatures =
                                  matchedSubclass &&
                                  featureCache[matchedSubclass.id]
                                    ? featureCache[matchedSubclass.id].filter(
                                        (f) => f.level === prog.level,
                                      )
                                    : [];

                                const features = [
                                  ...classFeatures,
                                  ...subclassFeatures,
                                ];

                                // Calculate choices and advancements
                                const choicesAtThisLevel: any[] = [];

                                // 1. Check legacy optionalfeatureProgression
                                if (matchedClass?.optionalfeatureProgression) {
                                  matchedClass.optionalfeatureProgression.forEach(
                                    (opt: any) => {
                                      const currentProgVal =
                                        opt.progression[prog.level - 1] || 0;
                                      const prevProgVal =
                                        prog.level > 1
                                          ? opt.progression[prog.level - 2] || 0
                                          : 0;
                                      const newlyAcquired =
                                        currentProgVal - prevProgVal;
                                      if (newlyAcquired > 0) {
                                        choicesAtThisLevel.push({
                                          name: opt.name,
                                          count: newlyAcquired,
                                          featureType: opt.featureType,
                                          type: "legacy",
                                        });
                                      }
                                    },
                                  );
                                }

                                // Check advancements from ALL obtainable features at this point in progression
                                const allAccessibleFeatures =
                                  matchedClass && featureCache[matchedClass.id]
                                    ? featureCache[matchedClass.id].filter(
                                        (f) => f.level <= prog.level,
                                      )
                                    : [];
                                const allAccessibleSubclassFeatures =
                                  matchedSubclass &&
                                  featureCache[matchedSubclass.id]
                                    ? featureCache[matchedSubclass.id].filter(
                                        (f) => f.level <= prog.level,
                                      )
                                    : [];

                                // 2. Check Modern Advancements
                                const processAdvancement = (
                                  adv: any,
                                  sourceId: string,
                                  isSubclass = false,
                                ) => {
                                  const advLevel = adv.level || 1;
                                  const scalingSource =
                                    adv.configuration?.countSource ===
                                      "scaling" ||
                                    adv.configuration?.choiceSource ===
                                      "scaling";

                                  let resolvedCount = 0;
                                  let isIncremental = false;

                                  if (scalingSource) {
                                    if (prog.level < advLevel) return;

                                    const colId =
                                      adv.configuration?.scalingColumnId;
                                    if (!colId) return;

                                    const col = scalingCache[colId];
                                    if (col && col.values) {
                                      const currentVal =
                                        parseInt(
                                          col.values[prog.level.toString()],
                                        ) || 0;
                                      const prevVal =
                                        prog.level > 1
                                          ? parseInt(
                                              col.values[
                                                (prog.level - 1).toString()
                                              ],
                                            ) || 0
                                          : 0;
                                      resolvedCount = currentVal - prevVal;
                                      isIncremental = prog.level > advLevel;
                                    }
                                  } else {
                                    if (advLevel !== prog.level) return;
                                    resolvedCount =
                                      adv.type === "ItemChoice"
                                        ? adv.configuration?.count || 1
                                        : adv.configuration?.choiceCount || 0;
                                  }

                                  if (resolvedCount <= 0 && adv.type !== "Subclass") return;

                                  let title = adv.title || (adv.type === "ItemChoice" ? "Choice" : adv.type === "Subclass" ? "Subclass" : adv.type);
                                  
                                  if (isIncremental) {
                                    const parentFeature = [
                                      ...allAccessibleFeatures,
                                      ...allAccessibleSubclassFeatures,
                                    ].find(f => f.id === adv.featureId);
                                    
                                    if (parentFeature) {
                                      title = `${parentFeature.name} Additional Choice`;
                                    } else {
                                      title = `${title} Additional Choice`;
                                    }
                                  }

                                  const baseChoices = {
                                    name: title,
                                    count: resolvedCount,
                                    type: "advancement",
                                    advType: adv.type,
                                    featureId: adv.featureId,
                                    advId: adv._id,
                                    classId: matchedClass?.id,
                                    level: prog.level,
                                    configuration: adv.configuration,
                                  };

                                  if (
                                    adv.type === "ItemChoice" ||
                                    (adv.type === "Trait" && (resolvedCount > 0 || (adv.configuration?.choices?.length || 0) > 0))
                                  ) {
                                    if (adv.type === "Trait" && adv.configuration?.choices?.length > 0) {
                                      adv.configuration.choices.forEach((c: any, cIdx: number) => {
                                        if (c.count > 0 && c.pool?.length > 0) {
                                          choicesAtThisLevel.push({
                                            ...baseChoices,
                                            advId: `${adv._id}-${cIdx}`, // Unique ID for each sub-choice
                                            name: `${title} (${c.type.charAt(0).toUpperCase() + c.type.slice(1)})`,
                                            count: c.count,
                                            featureType: c.type,
                                            configuration: {
                                              ...adv.configuration,
                                              choices: [c] // Pass only this choice to the dialog
                                            }
                                          });
                                        }
                                      });
                                    } else if (resolvedCount > 0) {
                                      choicesAtThisLevel.push({
                                        ...baseChoices,
                                        featureType:
                                          adv.type === "ItemChoice"
                                            ? adv.configuration?.choiceType ===
                                              "feature"
                                              ? adv.configuration?.pool?.[0]
                                              : adv.configuration?.featureType
                                            : adv.configuration?.type || "trait",
                                        optionGroupId:
                                          adv.configuration?.optionGroupId ||
                                          (adv.configuration?.choiceType ===
                                          "option-group"
                                            ? adv.configuration?.optionGroupId
                                            : undefined),
                                      });
                                    }
                                  } else if (
                                    adv.type === "Subclass" &&
                                    !isSubclass
                                  ) {
                                    if (!character.subclassId) {
                                      choicesAtThisLevel.push({
                                        ...baseChoices,
                                        type: "subclass-trigger",
                                        classId: matchedClass?.id,
                                        level: prog.level,
                                      });
                                    } else {
                                      // Already have a subclass, show it as info
                                      choicesAtThisLevel.push({
                                        ...baseChoices,
                                        type: "advancement-info",
                                      });
                                    }
                                  } else if (adv.featureId) {
                                    // General attached advancement (Grant, Trait, etc)
                                    choicesAtThisLevel.push({
                                      ...baseChoices,
                                      type: "advancement-info",
                                    });
                                  }
                                };

                                if (matchedClass?.advancements) {
                                  matchedClass.advancements.forEach(
                                    (adv: any) =>
                                      processAdvancement(adv, matchedClass.id),
                                  );
                                }

                                // 3. Synthesize Subclass Choice from subclassFeatureLevels if no explicit advancement exists
                                const hasExplicitSubclassAdv = 
                                  matchedClass?.advancements?.some((a: any) => a.type === "Subclass") ||
                                  allAccessibleFeatures.some(f => f.advancements?.some((a: any) => a.type === "Subclass"));
                                if (!hasExplicitSubclassAdv && matchedClass?.subclassFeatureLevels?.length > 0) {
                                  const firstSubclassLevel = matchedClass.subclassFeatureLevels[0];
                                  if (prog.level === firstSubclassLevel) {
                                    processAdvancement({
                                      _id: `synth-subclass-${matchedClass.id}`,
                                      type: "Subclass",
                                      level: firstSubclassLevel,
                                      title: matchedClass.subclassTitle || "Subclass",
                                      configuration: {}
                                    }, matchedClass.id);
                                  }
                                }

                                if (matchedSubclass?.advancements) {
                                  matchedSubclass.advancements.forEach(
                                    (adv: any) =>
                                      processAdvancement(
                                        adv,
                                        matchedSubclass.id,
                                        true,
                                      ),
                                  );
                                }

                                allAccessibleFeatures.forEach((feat: any) => {
                                  if (feat.advancements) {
                                    feat.advancements.forEach((adv: any) => {
                                      processAdvancement(
                                        {
                                          ...adv,
                                          level: (adv.level !== undefined && adv.level !== null) ? adv.level : feat.level,
                                          featureId: feat.id,
                                        },
                                        feat.parentId,
                                        false,
                                      );
                                    });
                                  }
                                });

                                allAccessibleSubclassFeatures.forEach((feat: any) => {
                                  if (feat.advancements) {
                                    feat.advancements.forEach((adv: any) => {
                                      processAdvancement(
                                        {
                                          ...adv,
                                          level: (adv.level !== undefined && adv.level !== null) ? adv.level : feat.level,
                                          featureId: feat.id,
                                        },
                                        feat.parentId,
                                        true,
                                      );
                                    });
                                  }
                                });

                                return (
                                  <div
                                    key={idx}
                                    className="bg-transparent group border-b border-gold/10 pb-4 flex gap-4"
                                  >
                                    <div className="w-24 shrink-0 flex flex-col items-center pt-2 gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
                                      <span className="font-sans font-black text-ink uppercase tracking-widest text-[10px] text-center w-full truncate px-1">
                                        {prog.className}
                                      </span>
                                      <div className="flex flex-col items-center leading-none border border-gold/30 rounded-md p-2 bg-gold/5 w-14 shadow-sm group-hover:bg-gold/10 group-hover:border-gold/50 transition-colors">
                                        <span className="font-serif text-2xl font-black text-ink">
                                          {prog.level}
                                        </span>
                                        <span className="text-[8px] font-bold uppercase tracking-widest text-ink/60 mt-1">
                                          Level
                                        </span>
                                      </div>
                                    </div>
                                    <div className="flex-1 space-y-4 justify-center flex flex-col pt-2">
                                      {features.length > 0 ||
                                      choicesAtThisLevel.length > 0 ? (
                                        <>
                                          {features.map((f: any) => {
                                            const tiedChoiceIndex = (
                                              choicesAtThisLevel as any
                                            ).findIndex(
                                              (c: any) =>
                                                c.featureId === f.id ||
                                                c.featureType ===
                                                  f.identifier ||
                                                c.name.toLowerCase() ===
                                                  f.name.toLowerCase() ||
                                                f.name
                                                  .toLowerCase()
                                                  .includes(
                                                    c.name.toLowerCase(),
                                                  ) ||
                                                c.name
                                                  .toLowerCase()
                                                  .includes(
                                                    f.name.toLowerCase(),
                                                  ),
                                            );
                                            const choice =
                                              tiedChoiceIndex !== -1
                                                ? choicesAtThisLevel[
                                                    tiedChoiceIndex
                                                  ]
                                                : null;
                                            if (choice)
                                              (choicesAtThisLevel as any)[
                                                tiedChoiceIndex
                                              ].isParentRendered = true;

                                            return (
                                              <div
                                                key={f.id}
                                                className="space-y-1"
                                              >
                                                <div className="flex items-center gap-2">
                                                  <div className="w-1.5 h-1.5 rounded-full bg-gold/50"></div>
                                                  <span className="font-serif font-bold text-ink text-lg">
                                                    {f.name}
                                                  </span>
                                                  {f.parentId ===
                                                    character.subclassId && (
                                                    <span className="text-[8px] font-black uppercase text-gold/60 tracking-widest ml-2">
                                                      Subclass
                                                    </span>
                                                  )}
                                                </div>
                                                {f.description && (
                                                  <div className="text-ink/70 font-serif text-sm leading-relaxed pl-3.5 border-l border-gold/20 ml-[3px]">
                                                    <BBCodeRenderer
                                                      content={f.description}
                                                    />
                                                  </div>
                                                )}

                                                {choice &&
                                                  choice.type ===
                                                    "advancement-info" && (
                                                    <div className="bg-ink/5 border border-ink/10 rounded-md p-3 mt-2 mb-4 ml-[3px] text-[10px] font-serif">
                                                      <div className="flex items-center gap-2 text-ink/60 mb-1">
                                                        <Zap className="w-3 h-3 text-gold" />
                                                        <span className="font-bold uppercase tracking-tight">
                                                          {choice.name}
                                                        </span>
                                                      </div>
                                                      {choice.advType ===
                                                        "ItemGrant" && (
                                                        <div className="flex flex-wrap gap-1 mt-1">
                                                          {choice.configuration?.pool?.map(
                                                            (
                                                              itemId: string,
                                                            ) => {
                                                              const featName =
                                                                featureCache[
                                                                  matchedClass
                                                                    ?.id
                                                                ]?.find(
                                                                  (feat: any) =>
                                                                    feat.id ===
                                                                    itemId,
                                                                )?.name ||
                                                                (matchedSubclass &&
                                                                  featureCache[
                                                                    matchedSubclass
                                                                      .id
                                                                  ]?.find(
                                                                    (
                                                                      feat: any,
                                                                    ) =>
                                                                      feat.id ===
                                                                      itemId,
                                                                  )?.name) ||
                                                                itemId;
                                                              return (
                                                                <span
                                                                  key={itemId}
                                                                  className="bg-gold/10 text-gold px-1.5 py-0.5 rounded border border-gold/20"
                                                                >
                                                                  {featName}
                                                                </span>
                                                              );
                                                            },
                                                          )}
                                                        </div>
                                                      )}
                                                      {choice.advType ===
                                                        "Trait" && (
                                                        <p className="text-ink/50 italic">
                                                          Gains proficiency in:{" "}
                                                          {choice.configuration
                                                            ?.type || "Trait"}
                                                        </p>
                                                      )}
                                                      {choice.advType === "Subclass" && (
                                                        <div className="mt-1">
                                                          <span className="text-emerald-600 font-bold">
                                                            {matchedSubclass?.name || (character.subclassId ? `ID: ${character.subclassId}` : 'Not Selected')}
                                                          </span>
                                                        </div>
                                                      )}
                                                    </div>
                                                  )}

                                                {choice &&
                                                  choice.type ===
                                                    "subclass-trigger" && (
                                                    <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-md p-4 mt-2 mb-4 ml-[3px]">
                                                      <div className="flex items-center justify-between mb-2">
                                                        <span className="font-serif font-bold text-ink text-sm uppercase tracking-wider flex items-center gap-2">
                                                          <Star className="w-4 h-4 text-emerald-500" />
                                                          Select {choice.name}
                                                        </span>
                                                      </div>
                                                      <p className="text-xs text-ink/60 font-serif mb-4 italic">
                                                        You reached the level to
                                                        specialize. Choose your
                                                        path.
                                                      </p>
                                                      <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={async () => {
                                                          const q = query(
                                                            collection(
                                                              db,
                                                              "subclasses",
                                                            ),
                                                            where(
                                                              "classId",
                                                              "==",
                                                              choice.classId,
                                                            ),
                                                          );
                                                          const snap =
                                                            await getDocs(q);
                                                          setAvailableSubclasses(
                                                            snap.docs.map(
                                                              (d) => ({
                                                                id: d.id,
                                                                ...d.data(),
                                                              }),
                                                            ),
                                                          );
                                                          setIsSelectingSubclass(
                                                            {
                                                              open: true,
                                                              classId:
                                                                choice.classId,
                                                              level:
                                                                choice.level,
                                                            },
                                                          );
                                                        }}
                                                        className="w-full border-dashed border-emerald-500/40 text-emerald-700 hover:bg-emerald-500/10 hover:border-emerald-500 font-bold tracking-widest uppercase text-[10px]"
                                                      >
                                                        <Plus className="w-3 h-3 mr-2" />{" "}
                                                        Choose {choice.name}
                                                      </Button>
                                                    </div>
                                                  )}

                                                {(() => {
                                                  if (!choice) return null;
                                                  const selectionKey = `${choice.advId}-${choice.level}`;
                                                  const currentSelections =
                                                    character.selectedOptions?.[
                                                      selectionKey
                                                    ] || [];

                                                  return (
                                                    choice &&
                                                    ![
                                                      "subclass-trigger",
                                                      "advancement-info",
                                                    ].includes(choice.type) && (
                                                      <div className="bg-gold/5 border border-gold/20 rounded-md p-4 mt-2 mb-4 ml-[3px]">
                                                        <div className="flex items-center justify-between mb-2">
                                                          <span className="font-serif font-bold text-ink text-sm uppercase tracking-wider flex items-center gap-2">
                                                            <ShieldCheck className="w-4 h-4 text-gold" />
                                                            Select {choice.name}{" "}
                                                            Options
                                                          </span>
                                                          <span className="text-xs font-black text-ink/40 tracking-widest">
                                                            {choice.count}{" "}
                                                            AVAILABLE
                                                          </span>
                                                        </div>
                                                        {currentSelections.length >
                                                          0 && (
                                                          <div className="space-y-2 mb-2">
                                                            {currentSelections.map(
                                                              (
                                                                optId: string,
                                                              ) => (
                                                                <div
                                                                  key={optId}
                                                                  className="flex justify-between items-center bg-card border border-gold/20 p-2 text-sm font-serif"
                                                                >
                                                                  <span>
                                                                    {optionsCache[
                                                                      optId
                                                                    ]?.name ||
                                                                      optId}
                                                                  </span>
                                                                  <Button
                                                                    variant="ghost"
                                                                    size="sm"
                                                                    onClick={() => {
                                                                      setCharacter(
                                                                        (
                                                                          prev: any,
                                                                        ) => ({
                                                                          ...prev,
                                                                          selectedOptions:
                                                                            {
                                                                              ...prev.selectedOptions,
                                                                              [selectionKey]:
                                                                                (
                                                                                  prev
                                                                                    .selectedOptions[
                                                                                    selectionKey
                                                                                  ] ||
                                                                                  []
                                                                                ).filter(
                                                                                  (
                                                                                    id: string,
                                                                                  ) =>
                                                                                    id !==
                                                                                    optId,
                                                                                ),
                                                                            },
                                                                        }),
                                                                      );
                                                                    }}
                                                                    className="h-6 w-6 p-0 text-blood hover:text-white hover:bg-blood transition-colors"
                                                                  >
                                                                    <Minus className="w-3 h-3" />
                                                                  </Button>
                                                                </div>
                                                              ),
                                                            )}
                                                          </div>
                                                        )}
                                                        <Button
                                                          variant="outline"
                                                          size="sm"
                                                          onClick={() =>
                                                            handleOpenOptionDialog(
                                                              choice,
                                                            )
                                                          }
                                                          className="w-full border-dashed border-gold/40 text-gold hover:bg-gold/10 hover:border-gold mt-2 font-bold tracking-widest uppercase text-[10px]"
                                                        >
                                                          <Plus className="w-3 h-3 mr-2" />{" "}
                                                          Choose Options
                                                        </Button>
                                                      </div>
                                                    )
                                                  );
                                                })()}
                                              </div>
                                            );
                                          })}
                                          {choicesAtThisLevel
                                            .filter(
                                              (c: any) => !c.isParentRendered,
                                            )
                                            .map(
                                              (choice: any, cidx: number) => {
                                                if (
                                                  choice.type ===
                                                  "subclass-trigger"
                                                ) {
                                                  return (
                                                    <div
                                                      key={`subclass-${cidx}`}
                                                      className="bg-emerald-500/5 border border-emerald-500/20 rounded-md p-4 mt-2 mb-4 ml-[3px]"
                                                    >
                                                      <div className="flex items-center justify-between mb-2">
                                                        <span className="font-serif font-bold text-ink text-sm uppercase tracking-wider flex items-center gap-2">
                                                          <Star className="w-4 h-4 text-emerald-500" />
                                                          Select {choice.name}
                                                        </span>
                                                      </div>
                                                      <p className="text-xs text-ink/60 font-serif mb-4 italic">
                                                        You reached the level to
                                                        specialize. Choose your
                                                        path.
                                                      </p>
                                                      <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={async () => {
                                                          const q = query(
                                                            collection(
                                                              db,
                                                              "subclasses",
                                                            ),
                                                            where(
                                                              "classId",
                                                              "==",
                                                              choice.classId,
                                                            ),
                                                          );
                                                          const snap =
                                                            await getDocs(q);
                                                          setAvailableSubclasses(
                                                            snap.docs.map(
                                                              (d) => ({
                                                                id: d.id,
                                                                ...d.data(),
                                                              }),
                                                            ),
                                                          );
                                                          setIsSelectingSubclass(
                                                            {
                                                              open: true,
                                                              classId:
                                                                choice.classId,
                                                              level:
                                                                choice.level,
                                                            },
                                                          );
                                                        }}
                                                        className="w-full border-dashed border-emerald-500/40 text-emerald-700 hover:bg-emerald-500/10 hover:border-emerald-500 font-bold tracking-widest uppercase text-[10px]"
                                                      >
                                                        <Plus className="w-3 h-3 mr-2" />{" "}
                                                        Choose {choice.name}
                                                      </Button>
                                                    </div>
                                                  );
                                                }

                                                if (
                                                  choice.type ===
                                                  "advancement-info"
                                                ) {
                                                  return (
                                                    <div
                                                      key={`info-${cidx}`}
                                                      className="bg-ink/5 border border-ink/10 rounded-md p-3 mt-2 mb-4 ml-[3px] text-[10px] font-serif"
                                                    >
                                                      <div className="flex items-center gap-2 text-ink/60 mb-1">
                                                        <Zap className="w-3 h-3 text-gold" />
                                                        <span className="font-bold uppercase tracking-tight">
                                                          {choice.name}
                                                        </span>
                                                      </div>
                                                      {choice.advType ===
                                                        "ItemGrant" && (
                                                        <div className="flex flex-wrap gap-1 mt-1">
                                                          {choice.configuration?.pool?.map(
                                                            (
                                                              itemId: string,
                                                            ) => {
                                                              const featName =
                                                                featureCache[
                                                                  matchedClass
                                                                    ?.id
                                                                ]?.find(
                                                                  (
                                                                    feat: any,
                                                                  ) =>
                                                                    feat.id ===
                                                                    itemId,
                                                                )?.name ||
                                                                (matchedSubclass &&
                                                                  featureCache[
                                                                    matchedSubclass
                                                                      .id
                                                                  ]?.find(
                                                                    (
                                                                      feat: any,
                                                                    ) =>
                                                                      feat.id ===
                                                                      itemId,
                                                                  )?.name) ||
                                                                itemId;
                                                              return (
                                                                <span
                                                                  key={itemId}
                                                                  className="bg-gold/10 text-gold px-1.5 py-0.5 rounded border border-gold/20"
                                                                >
                                                                  {featName}
                                                                </span>
                                                              );
                                                            },
                                                          )}
                                                        </div>
                                                      )}
                                                      {choice.advType ===
                                                        "Trait" && (
                                                        <p className="text-ink/50 italic">
                                                          Gains proficiency in:{" "}
                                                          {choice.configuration
                                                            ?.type || "Trait"}
                                                        </p>
                                                      )}
                                                      {choice.advType ===
                                                        "Subclass" && (
                                                        <div className="mt-1">
                                                          <span className="text-emerald-600 font-bold">
                                                            {matchedSubclass?.name ||
                                                              (character.subclassId
                                                                ? `ID: ${character.subclassId}`
                                                                : "Not Selected")}
                                                          </span>
                                                        </div>
                                                      )}
                                                    </div>
                                                  );
                                                }

                                                if (!choice) return null;
                                                const selectionKey = `${choice.advId}-${choice.level}`;
                                                const noOtherFeatures = features.length === 0;
                                                const selectedChoicesForOption =
                                                  character.selectedOptions?.[
                                                    selectionKey
                                                  ] || []; 

                                                return (
                                                  <div key={`choice-${cidx}`}>
                                                    {noOtherFeatures && (
                                                      <div className="space-y-1 mb-4">
                                                        <div className="flex items-center gap-2">
                                                          <div className="w-1.5 h-1.5 rounded-full bg-gold/50"></div>
                                                          <span className="font-serif font-bold text-ink text-lg">
                                                            {choice.name}
                                                          </span>
                                                        </div>
                                                        <div className="text-ink/70 font-serif text-sm leading-relaxed pl-3.5 border-l border-gold/20 ml-[3px]">
                                                          You gain options for: {choice.name}.
                                                        </div>
                                                      </div>
                                                    )}
                                                    <div className="bg-gold/5 border border-gold/20 rounded-md p-4 mt-2 mb-4 ml-[3px]">
                                                      <div className="flex items-center justify-between mb-2">
                                                        <span className="font-serif font-bold text-ink text-sm uppercase tracking-wider flex items-center gap-2">
                                                          <ShieldCheck className="w-4 h-4 text-gold" />
                                                          Select {choice.name}{" "}
                                                          Options
                                                        </span>
                                                        <span className="text-xs font-black text-ink/40 tracking-widest">
                                                          {choice.count}{" "}
                                                          AVAILABLE
                                                        </span>
                                                      </div>
                                                      {selectedChoicesForOption.length >
                                                        0 && (
                                                        <div className="space-y-2 mb-2">
                                                          {selectedChoicesForOption.map(
                                                            (optId: string) => (
                                                              <div
                                                                key={optId}
                                                                className="flex justify-between items-center bg-card border border-gold/20 p-2 text-sm font-serif"
                                                              >
                                                                <span>
                                                                  {optionsCache[
                                                                    optId
                                                                  ]?.name ||
                                                                    optId}
                                                                </span>
                                                                <Button
                                                                  variant="ghost"
                                                                  size="sm"
                                                                  onClick={() => {
                                                                    setCharacter(
                                                                      (
                                                                        prev: any,
                                                                      ) => ({
                                                                        ...prev,
                                                                        selectedOptions:
                                                                          {
                                                                            ...prev.selectedOptions,
                                                                            [selectionKey]:
                                                                              (
                                                                                prev
                                                                                  .selectedOptions[
                                                                                  selectionKey
                                                                                ] ||
                                                                                []
                                                                              ).filter(
                                                                                (
                                                                                  id: string,
                                                                                ) =>
                                                                                  id !==
                                                                                  optId,
                                                                              ),
                                                                          },
                                                                      }),
                                                                    );
                                                                  }}
                                                                  className="h-6 w-6 p-0 text-blood hover:text-white hover:bg-blood transition-colors"
                                                                >
                                                                  <Minus className="w-3 h-3" />
                                                                </Button>
                                                              </div>
                                                            ),
                                                          )}
                                                        </div>
                                                      )}
                                                      <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() =>
                                                          handleOpenOptionDialog(
                                                            choice,
                                                          )
                                                        }
                                                        className="w-full border-dashed border-gold/40 text-gold hover:bg-gold/10 hover:border-gold mt-2 font-bold tracking-widest uppercase text-[10px]"
                                                      >
                                                        <Plus className="w-3 h-3 mr-2" />{" "}
                                                        Choose Options
                                                      </Button>
                                                    </div>
                                                  </div>
                                                );
                                              },
                                            )}
                                        </>
                                      ) : (
                                        <div className="text-ink/40 font-serif italic text-sm py-4">
                                          No new features gained at this level.
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                );
                              },
                            )}
                          </div>

                          <div className="flex justify-center pt-4 pb-12">
                            <Button
                              className="btn-gold-solid font-bold uppercase tracking-widest px-6 py-2 shadow-sm transition-all active:translate-y-1 text-xs"
                              onClick={() => {
                                setCharacter((prev: any) => {
                                  const newProg =
                                    prev.progression ||
                                    (prev.classId
                                      ? Array.from({
                                          length: prev.level || 1,
                                        }).map((_, i) => ({
                                          className: prev.classId,
                                          level: i + 1,
                                        }))
                                      : []);
                                  if (newProg.length === 0) return prev;
                                  const lastClass =
                                    newProg[newProg.length - 1].className;
                                  const currentClassLevel = newProg.filter(
                                    (p: any) => p.className === lastClass,
                                  ).length;
                                  return {
                                    ...prev,
                                    level: (prev.level || 1) + 1,
                                    progression: [
                                      ...newProg,
                                      {
                                        className: lastClass,
                                        level: currentClassLevel + 1,
                                      },
                                    ],
                                  };
                                });
                              }}
                            >
                              Level Up
                            </Button>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-background/50 p-8 rounded-xl border border-gold/10 h-full flex flex-col items-center justify-center text-center">
              <div className="w-24 h-24 bg-gold/5 rounded-full flex items-center justify-center mb-6 border border-gold/20">
                {STEPS.find((s) => s.id === activeStep)?.icon}
              </div>
              <h2 className="text-2xl font-serif font-black text-ink mb-2 uppercase tracking-tight">
                {STEPS.find((s) => s.id === activeStep)?.label}
              </h2>
              <p className="text-ink/60 max-w-sm font-serif italic mb-8">
                This workspace section is currently under construction. Please
                use the Character Sheet tab to manage core vitals and stats.
              </p>
              <Button
                onClick={() => setActiveStep("sheet")}
                variant="outline"
                className="border-gold/30 text-gold hover:bg-gold/5 uppercase tracking-widest text-xs font-black"
              >
                Return to Sheet
              </Button>
            </div>
          )}
        </div>

        {/* NAVIGATION RAIL - RESPONSIVE */}
        <div className="fixed bottom-0 left-0 right-0 z-40 lg:relative lg:bottom-auto lg:left-auto lg:right-auto lg:z-0 bg-background/95 backdrop-blur-md lg:bg-transparent border-t lg:border-none border-gold/10 p-2 sm:p-4 lg:p-0 lg:w-16 lg:pt-4">
          <div className="flex lg:flex-col items-center justify-between lg:justify-start gap-1 sm:gap-2 lg:gap-3 max-w-7xl mx-auto lg:sticky lg:top-24">
            {STEPS.map((step) => (
              <button
                key={step.id}
                onClick={() => {
                  setActiveStep(step.id);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                title={step.label}
                className={`w-10 h-10 sm:w-12 sm:h-12 lg:w-14 lg:h-14 border-2 lg:border-4 flex items-center justify-center transition-all shadow-md active:scale-95 flex-shrink-0 ${
                  activeStep === step.id
                    ? "bg-gold text-white border-gold scale-110"
                    : "bg-card text-ink border-gold/20 hover:bg-gold/10"
                }`}
                style={{ borderRadius: "10px" }}
              >
                {React.cloneElement(
                  step.icon as React.ReactElement<{ className?: string }>,
                  { className: "w-4 h-4 sm:w-5 sm:h-5 lg:w-6 lg:h-6" },
                )}
              </button>
            ))}
            <div className="hidden lg:block h-4" />
            <button
              className="w-10 h-10 sm:w-12 sm:h-12 lg:w-14 lg:h-14 border-2 lg:border-4 bg-ink/5 border-ink/20 flex items-center justify-center text-ink/40 cursor-not-allowed flex-shrink-0"
              style={{ borderRadius: "10px" }}
            >
              <Settings className="w-4 h-4 sm:w-5 sm:h-5 lg:w-5 lg:h-5" />
            </button>
          </div>
        </div>
      </div>

      {optionDialogOpen && (
        <div className="fixed inset-0 bg-ink/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="max-w-4xl w-full max-h-[90vh] flex flex-col border-4 border-gold bg-background shadow-2xl overflow-hidden">
            <CardHeader className="border-b border-gold/20 flex flex-row items-center justify-between shrink-0">
              <div>
                <CardTitle className="font-serif text-2xl font-black text-ink">
                  {optionDialogOpen.name}
                </CardTitle>
                <CardDescription className="text-ink/60 font-bold uppercase text-[10px] tracking-widest mt-1">
                  AVAILABLE TO SELECT: {optionDialogOpen.count}
                </CardDescription>
              </div>
              <Button variant="ghost" onClick={() => setOptionDialogOpen(null)}>
                <Plus className="w-5 h-5 rotate-45" />
              </Button>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto p-0">
              {loadingOptions ? (
                <div className="p-8 text-center text-ink/50 font-serif italic">
                  Loading options...
                </div>
              ) : availableOptions.length === 0 ? (
                <div className="p-8 text-center text-ink/50 font-serif italic">
                  No options found for this feature.
                </div>
              ) : (
                <div className="divide-y divide-gold/10">
                  {availableOptions.map((opt) => {
                    if (!optionDialogOpen) return null;
                    const selectionKey = `${optionDialogOpen.advId}-${optionDialogOpen.level}`;
                    const isSelected = (
                      character.selectedOptions[selectionKey] || []
                    ).includes(opt.id);

                    // Check if this option was already chosen in OTHER levels for the same modular group
                    const allSelectionsForGroup = Object.entries(
                      character.selectedOptions || {},
                    ).flatMap(([key, val]: any) => {
                      // We need to know if the key belongs to an advancement with the same modular group
                      // Since we don't have a direct map easily in this render scope without extra lookups,
                      // we can check if the opt.id is present in ANY other selection, assuming opt.ids are unique enough
                      // or better yet, we check ALL selected options in the character state.
                      return val;
                    });

                    const isAlreadyChosenElsewhere = allSelectionsForGroup.includes(
                      opt.id,
                    ) && !isSelected;
                    
                    const isDisabled =
                      (!isSelected &&
                        (character.selectedOptions?.[selectionKey] || []).length >=
                          optionDialogOpen.count) ||
                      (isAlreadyChosenElsewhere && !opt.isRepeatable);

                    return (
                      <div
                        key={opt.id}
                        className={`p-4 flex gap-4 hover:bg-gold/5 transition-colors ${isAlreadyChosenElsewhere && !opt.isRepeatable ? "opacity-50" : ""}`}
                      >
                        <div className="pt-1">
                          <button
                            disabled={isDisabled}
                            onClick={() => {
                              setCharacter((prev: any) => {
                                const current =
                                  prev.selectedOptions?.[selectionKey] || [];
                                if (isSelected) {
                                  return {
                                    ...prev,
                                    selectedOptions: {
                                      ...prev.selectedOptions,
                                      [selectionKey]: current.filter(
                                        (i: string) => i !== opt.id,
                                      ),
                                    },
                                  };
                                } else {
                                  if (current.length >= optionDialogOpen.count)
                                    return prev;
                                  return {
                                    ...prev,
                                    selectedOptions: {
                                      ...prev.selectedOptions,
                                      [selectionKey]: [...current, opt.id],
                                    },
                                  };
                                }
                              });
                            }}
                            className={`w-6 h-6 rounded-md border-2 flex items-center justify-center transition-colors ${isSelected ? "bg-gold border-gold text-white" : "border-gold/40 hover:border-gold"} ${isDisabled ? "cursor-not-allowed" : ""}`}
                          >
                            {isSelected && <Check className="w-4 h-4" />}
                          </button>
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center justify-between">
                            <h4 className="font-serif font-bold text-ink text-lg text-balance">
                              {opt.name}
                              {isAlreadyChosenElsewhere && !opt.isRepeatable && (
                                <span className="ml-2 text-[10px] uppercase tracking-widest text-gold bg-gold/10 px-2 py-0.5 rounded">
                                  Already Selected
                                </span>
                              )}
                            </h4>
                          </div>
                          {opt.description && (
                            <div className="text-sm font-serif text-ink/70 mt-1 leading-relaxed">
                              <BBCodeRenderer content={opt.description} />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {isSelectingSubclass.open && (
        <div className="fixed inset-0 bg-ink/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="max-w-4xl w-full max-h-[90vh] flex flex-col border-4 border-gold bg-background shadow-2xl overflow-hidden">
            <CardHeader className="border-b border-gold/20 flex flex-row items-center justify-between shrink-0">
              <div>
                <CardTitle className="font-serif text-2xl font-black text-ink">
                  Select Subclass
                </CardTitle>
                <CardDescription className="text-ink/60 font-bold uppercase text-[10px] tracking-widest mt-1">
                  CHOOSE YOUR SPECIALIZATION
                </CardDescription>
              </div>
              <Button variant="ghost" onClick={() => setIsSelectingSubclass({ open: false, classId: "", level: 0 })}>
                <Plus className="w-5 h-5 rotate-45" />
              </Button>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto p-0">
              {availableSubclasses.length === 0 ? (
                <div className="p-8 text-center text-ink/50 font-serif italic">
                  No subclasses found for this class.
                </div>
              ) : (
                <div className="divide-y divide-gold/10">
                  {availableSubclasses.map((subclass) => (
                    <div key={subclass.id} className="p-4 flex flex-col sm:flex-row gap-4 hover:bg-gold/5 transition-colors">
                      <div className="flex-1">
                        <h4 className="font-serif font-bold text-ink text-lg text-balance">
                          {subclass.name}
                        </h4>
                        {subclass.description && (
                          <div className="text-sm font-serif text-ink/70 mt-1 leading-relaxed">
                            <BBCodeRenderer content={subclass.description} />
                          </div>
                        )}
                      </div>
                      <div className="sm:self-center shrink-0">
                        <Button
                          size="sm"
                          onClick={() => {
                            setCharacter((prev: any) => ({
                              ...prev,
                              subclassId: subclass.id,
                            }));
                            setIsSelectingSubclass({ open: false, classId: "", level: 0 });
                          }}
                          className="bg-emerald-600 border-emerald-500 text-white hover:bg-emerald-700 w-full sm:w-auto uppercase tracking-widest text-[10px] font-bold"
                        >
                          Select Path
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {showPointBuy && (
        <div className="fixed inset-0 bg-ink/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="max-w-md w-full border-4 border-gold bg-background shadow-2xl">
            <CardHeader className="border-b-2 border-gold/20">
              <CardTitle className="font-serif text-2xl font-black">
                Score Management
              </CardTitle>
              <CardDescription className="text-ink/60 font-bold uppercase text-[10px] tracking-widest">
                Point Buy & Standards
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 pt-6">
              <div className="p-8 border-4 border-dashed border-ink/10 rounded-xl flex flex-col items-center justify-center text-center">
                <Edit2 className="w-10 h-10 text-gold mb-4" />
                <p className="text-ink/60 font-serif italic text-sm">
                  Ability score management logic is currently being finalized.
                  Please use the Â± controls on the sheet interface for now.
                </p>
              </div>
              <Button
                className="w-full bg-ink text-white hover:bg-gold transition-colors font-bold uppercase tracking-widest h-12"
                onClick={() => setShowPointBuy(false)}
              >
                Return to Sheet
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
