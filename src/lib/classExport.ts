import { db } from './firebase';
import { 
  doc, 
  getDoc, 
  getDocs, 
  collection, 
  query, 
  where, 
  documentId,
  setDoc,
  serverTimestamp
} from 'firebase/firestore';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

export interface SourceExportBundle {
  catalog: any;
  sourceDetail: any;
  classCatalog: any;
  classes: { [slug: string]: any };
}

/**
 * Imports a class semantic export bundle into Firestore.
 */
export async function importClassSemantic(data: any) {
  if (!data.class || !data.class.id) {
    throw new Error("Invalid class export data: missing class information");
  }

  const {
    class: classData,
    subclasses = [],
    features = [],
    scalingColumns = [],
    uniqueOptionGroups = [],
    uniqueOptionItems = [],
    spellcastingScalings = {},
    source = null
  } = data;

  // Helper to strip internal Firestore metadata and handle Timestamps
  const prepare = (docData: any) => {
    const clean = { ...docData };
    delete clean.id; // Usually stored separately
    // If createdAt/updatedAt are objects (from JSON), we replace them with serverTimestamp or current date
    if (clean.createdAt && typeof clean.createdAt === 'object') {
      delete clean.createdAt;
    }
    if (clean.updatedAt && typeof clean.updatedAt === 'object') {
      delete clean.updatedAt;
    }
    return clean;
  };

  // 1. Handle Source
  if (source && source.id) {
    const sourceRef = doc(db, 'sources', source.id);
    const sourceSnap = await getDoc(sourceRef);
    if (!sourceSnap.exists()) {
      // Create source if it doesn't exist
      await setDoc(sourceRef, {
        ...prepare(source),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    }
  }

  // 2. Handle Spellcasting Scalings
  for (const id in spellcastingScalings) {
    const sc = spellcastingScalings[id];
    await setDoc(doc(db, 'spellcastingScalings', id), {
      ...prepare(sc),
      updatedAt: serverTimestamp()
    });
  }

  // 3. Handle Unique Option Groups
  for (const group of uniqueOptionGroups) {
    await setDoc(doc(db, 'uniqueOptionGroups', group.id), {
      ...prepare(group),
      updatedAt: serverTimestamp()
    });
  }

  // 4. Handle Unique Option Items
  for (const item of uniqueOptionItems) {
    await setDoc(doc(db, 'uniqueOptionItems', item.id), {
      ...prepare(item),
      updatedAt: serverTimestamp()
    });
  }

  // 5. Handle Scaling Columns
  for (const col of scalingColumns) {
    await setDoc(doc(db, 'scalingColumns', col.id), {
      ...prepare(col),
      updatedAt: serverTimestamp()
    });
  }

  // 6. Handle Subclasses
  for (const sub of subclasses) {
    await setDoc(doc(db, 'subclasses', sub.id), {
      ...prepare(sub),
      updatedAt: serverTimestamp()
    });
  }

  // 7. Handle Features
  for (const feat of features) {
    await setDoc(doc(db, 'features', feat.id), {
      ...prepare(feat),
      updatedAt: serverTimestamp()
    });
  }

  // 8. Handle the Class itself
  await setDoc(doc(db, 'classes', classData.id), {
    ...prepare(classData),
    updatedAt: serverTimestamp()
  });

  return classData.id;
}

/**
 * Helper to slugify strings.
 */
export function slugify(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9-]/g, '-');
}

/**
 * Robust text cleaner that converts BBCode/HTML to Markdown
 * and fixes common encoding/legacy text artifacts.
 */
function cleanText(text: string): string {
  if (!text) return "";
  let cleaned = text;
  
  // Convert BBCode to Markdown
  cleaned = cleaned.replace(/\[h(\d)\]/gi, (match, level) => '\n' + '#'.repeat(parseInt(level)) + ' ');
  cleaned = cleaned.replace(/\[\/h\d\]/gi, '\n');
  cleaned = cleaned.replace(/\[b\]/gi, '**').replace(/\[\/b\]/gi, '**');
  cleaned = cleaned.replace(/\[i\]/gi, '*').replace(/\[\/i\]/gi, '*');
  cleaned = cleaned.replace(/\[ul\]/gi, '\n').replace(/\[\/ul\]/gi, '\n');
  cleaned = cleaned.replace(/\[li\]/gi, '* ').replace(/\[\/li\]/gi, '\n');
  cleaned = cleaned.replace(/\[center\]/gi, '').replace(/\[\/center\]/gi, '');
  
  // HTML tags to Markdown (basic)
  cleaned = cleaned.replace(/<p>/gi, '').replace(/<\/p>/gi, '\n');
  cleaned = cleaned.replace(/<br\s*\/?>/gi, '\n');
  cleaned = cleaned.replace(/&nbsp;/gi, ' ');
  
  // Remove remaining HTML tags
  cleaned = cleaned.replace(/<[^>]*>?/gm, '');

  // Fix "mojibake" / Special characters (Curly quotes to straight, etc.)
  cleaned = cleaned.replace(/[\u201C\u201D]/g, '"');
  cleaned = cleaned.replace(/[\u2018\u2019]/g, "'");
  cleaned = cleaned.replace(/\u2013/g, "-");
  cleaned = cleaned.replace(/\u2014/g, "--");
  cleaned = cleaned.replace(/\u2026/g, "...");

  // Consolidate multiple newlines
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  return cleaned.trim();
}

/**
 * Fetches all data for a single class and formats it for semantic export.
 */
export async function exportClassSemantic(classId: string) {
  const classDoc = await getDoc(doc(db, 'classes', classId));
  if (!classDoc.exists()) return null;
  const classDataRaw: any = { id: classDoc.id, ...classDoc.data() };

  // Fetch Skills for mapping
  const skillsSnap = await getDocs(collection(db, 'skills'));
  const skillMap: { [id: string]: string } = {};
  skillsSnap.docs.forEach(d => {
    const data = d.data();
    skillMap[d.id] = data.foundryAlias || data.identifier || slugify(data.name);
  });

  // Fetch Tools for mapping
  const toolsSnap = await getDocs(collection(db, 'tools'));
  const toolMap: { [id: string]: string } = {};
  toolsSnap.docs.forEach(d => {
    const data = d.data();
    toolMap[d.id] = data.identifier || slugify(data.name);
  });

  // Fetch Tags for mapping
  const tagsSnap = await getDocs(collection(db, 'tags'));
  const tagMap: { [id: string]: string } = {};
  tagsSnap.docs.forEach(d => {
    tagMap[d.id] = slugify(d.data().name);
  });

  // Helper to map array of IDs to semantic strings
  const mapIds = (ids: string[] | undefined, map: { [id: string]: string }) => {
    if (!ids) return [];
    return ids.map(id => map[id] || id);
  };

  // 1. Prepare Root Class Object
  let mappedAdvancements = (classDataRaw.advancements || []).map((adv: any) => {
    if (adv._id === "implicit-proficiencies") {
      const configuration = { ...adv.configuration };
      const choices = (configuration.choices || []).map((choice: any) => {
        // Find if this is skills or tools
        let mappedPool = [];
        if (choice.pool && classDataRaw.proficiencies?.skills?.optionIds?.includes(choice.pool[0])) {
           mappedPool = mapIds(choice.pool, skillMap).map(s => `skills:${s.substring(0,3)}`);
        } else if (choice.pool && classDataRaw.proficiencies?.tools?.optionIds?.includes(choice.pool[0])) {
           mappedPool = mapIds(choice.pool, toolMap).map(t => `tools:${t.replace(/[^a-z0-9]/g,'').substring(0,3)}`);
        } else {
           mappedPool = mapIds(choice.pool, skillMap).map(s => `skills:${s.substring(0,3)}`);
        }
        return { ...choice, pool: mappedPool };
      });
      // Grants are already using the mapped skills/tools in handleSave? Wait, I didn't map them in handleSave, I just added raw IDs!
      const mappedGrants = [];
      const rawGrants = configuration.grants || [];
      rawGrants.forEach((grantId: string) => {
        if (skillMap[grantId]) {
          mappedGrants.push(`skills:${skillMap[grantId].substring(0,3)}`);
        } else if (toolMap[grantId]) {
          mappedGrants.push(`tools:${toolMap[grantId].replace(/[^a-z0-9]/g,'').substring(0,3)}`);
        } else if (
          ["STR","DEX","CON","INT","WIS","CHA"].includes(grantId.toUpperCase()) || 
          grantId.toLowerCase().startsWith('saves:')
        ) {
          mappedGrants.push(grantId.toLowerCase().startsWith('saves:') ? grantId.toLowerCase() : `saves:${grantId.toLowerCase()}`);
        } else {
          mappedGrants.push(grantId); 
        }
      });
      return {
        ...adv,
        configuration: {
          ...configuration,
          choices,
          grants: mappedGrants
        }
      };
    }
    return adv;
  });

  const hasHitPoints = mappedAdvancements.some((a: any) => a.type === 'HitPoints');
  if (!hasHitPoints && classDataRaw.hitDie) {
    mappedAdvancements.push({
      _id: "implicit-hit-points",
      type: "HitPoints",
      level: 1,
      title: "Hit Points",
      icon: "systems/dnd5e/icons/svg/hit-points.svg",
      configuration: {
        hitDie: classDataRaw.hitDie
      }
    });
  }

  const classData = {
    ...classDataRaw,
    advancements: mappedAdvancements,
    id: classDataRaw.id, // App Record ID
    identifier: classDataRaw.identifier || slugify(classDataRaw.name), // Semantic identity
    lore: cleanText(classDataRaw.lore),
    description: cleanText(classDataRaw.description),
    startingEquipment: cleanText(classDataRaw.startingEquipment),
    multiclassing: cleanText(classDataRaw.multiclassing),
    tagIds: mapIds(classDataRaw.tagIds, tagMap),
    proficiencies: {
      ...classDataRaw.proficiencies,
      skills: {
        choiceCount: classDataRaw.proficiencies?.skills?.choiceCount || 0,
        options: mapIds(classDataRaw.proficiencies?.skills?.optionIds, skillMap),
        fixed: mapIds(classDataRaw.proficiencies?.skills?.fixedIds, skillMap),
      },
      tools: {
        choiceCount: classDataRaw.proficiencies?.tools?.choiceCount || 0,
        options: mapIds(classDataRaw.proficiencies?.tools?.optionIds, toolMap),
        fixed: mapIds(classDataRaw.proficiencies?.tools?.fixedIds, toolMap),
      }
    }
  };

  // Source mapping logic (SourceId = Book IDs in semantic export)
  const sourceCache: { [id: string]: string } = {};
  const resolveBookId = async (sid: string | undefined) => {
    if (!sid) return undefined;
    if (sourceCache[sid]) return sourceCache[sid];
    if (sid.startsWith('source-')) return sid; // Already semantic
    
    const sourceSnap = await getDoc(doc(db, 'sources', sid));
    if (sourceSnap.exists()) {
      sourceCache[sid] = getSemanticSourceId(sourceSnap.data(), sid);
      return sourceCache[sid];
    }
    return sid;
  };

  const resolvedClassBookId = await resolveBookId(classDataRaw.sourceId) || "";
  classData.sourceId = resolvedClassBookId;

  // Build ID to semantic identity maps
  const idToSourceIdMap: { [id: string]: string } = {};
  const idToBookIdMap: { [id: string]: string } = {};
  
  idToSourceIdMap[classId] = `class-${classData.identifier}`;
  idToBookIdMap[classId] = resolvedClassBookId;

  // Handle Spellcasting
  if (classData.spellcasting) {
    classData.spellcasting.description = cleanText(classData.spellcasting.description);
  }

  // Fetch Subclasses
  const subclassesSnap = await getDocs(query(collection(db, 'subclasses'), where('classId', '==', classId)));
  const subclasses = await Promise.all(subclassesSnap.docs.map(async (d) => {
    const data: any = d.data();
    const identifier = data.identifier || slugify(data.name);
    
    // Resolve own book or fallback to class
    const resolvedLocal = await resolveBookId(data.sourceId);
    const sourceBookId = (resolvedLocal && resolvedLocal.startsWith('source-')) ? resolvedLocal : resolvedClassBookId;

    return {
      ...data,
      id: d.id, // Record ID
      identifier: identifier,
      sourceId: `subclass-${identifier}`, // Semantic Entity ID
      sourceBookId: sourceBookId, 
      classSourceId: `class-${classData.identifier}`,
      description: cleanText(data.description),
      lore: cleanText(data.lore),
      tagIds: mapIds(data.tagIds, tagMap)
    };
  }));

  subclasses.forEach(s => {
    idToSourceIdMap[s.id] = s.sourceId;
    idToBookIdMap[s.id] = s.sourceBookId;
  });

  const subclassIds = subclassesSnap.docs.map(s => s.id);

  // Fetch Features (Class + Subclass)
  const allParentIds = [classId, ...subclassIds];
  let featuresRaw: any[] = [];
  if (allParentIds.length > 0) {
    const featuresSnap = await getDocs(query(collection(db, 'features'), where('parentId', 'in', allParentIds)));
    featuresRaw = featuresSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  // Fetch Scaling Columns early so we can reference them
  const scalingSnap = await getDocs(query(collection(db, 'scalingColumns'), where('parentId', '==', classId)));
  const scalingColumns = scalingSnap.docs.map(d => {
    const data: any = d.data();
    const identifier = data.identifier || slugify(data.name);
    return {
      ...data,
      id: d.id,
      identifier: identifier,
      sourceId: `scale-${identifier}`,
      sourceBookId: resolvedClassBookId, // Scaling columns always belong to root class
      classSourceId: `class-${classData.identifier}`
    };
  });

  // Collect all unique option group IDs
  const allGroupIds = new Set([
    ...(classData.uniqueOptionGroupIds || []),
    ...featuresRaw.flatMap(f => f.uniqueOptionGroupIds || [])
  ]);
  const groupIds = Array.from(allGroupIds) as string[];

  // Fetch Unique Option Groups FIRST so we can map them in Features
  let uniqueOptionGroups: any[] = [];
  const groupIdToSourceIdMap: { [id: string]: string } = {};
  
  if (groupIds.length > 0) {
    const groupsSnap = await getDocs(query(collection(db, 'uniqueOptionGroups'), where(documentId(), 'in', groupIds)));
    uniqueOptionGroups = groupsSnap.docs.map(d => {
      const data: any = d.data();
      const identifier = data.identifier || slugify(data.name || "");
      const sourceId = `class-option-group-${identifier}`;
      
      groupIdToSourceIdMap[d.id] = sourceId;
      
      const { maxSelections, ...rest } = data; // Remove stale field
      
      return {
        ...rest,
        id: d.id,
        identifier: identifier,
        sourceId: sourceId,
        sourceBookId: resolvedClassBookId, // We'll update this later if it's tied to a feature
        featureSourceId: undefined, // We'll update this later
        scalingSourceId: data.scalingId ? scalingColumns.find(sc => sc.id === data.scalingId)?.sourceId : undefined,
        description: "" // We'll update this later
      };
    });
  }

  const features = await Promise.all(featuresRaw.map(async (f) => {
    const identifier = f.identifier || slugify(f.name);
    const parentPrefix = f.parentType === 'subclass' ? 'subclass' : 'class';
    
    // Inheritance: Resolve own book, or fallback to parent book
    const resolvedLocal = await resolveBookId(f.sourceId);
    const sourceBookId = (resolvedLocal && resolvedLocal.startsWith('source-')) 
      ? resolvedLocal 
      : (idToBookIdMap[f.parentId] || resolvedClassBookId);

    return {
      ...f,
      id: f.id,
      identifier: identifier,
      sourceId: `${parentPrefix}-feature-${identifier}`, // Semantic Entity ID
      sourceBookId: sourceBookId, 
      parentSourceId: idToSourceIdMap[f.parentId] || f.parentId,
      classSourceId: `class-${classData.identifier}`,
      featureKind: f.featureKind || (f.parentType === 'subclass' ? 'subclassFeature' : 'classFeature'),
      description: cleanText(f.description),
      uniqueOptionGroupIds: (f.uniqueOptionGroupIds || []).map((id: string) => groupIdToSourceIdMap[id] || id),
      automation: {
        activities: Array.isArray(f.automation?.activities) 
          ? f.automation.activities 
          : Object.values(f.automation?.activities || {}),
        effects: f.automation?.effects || []
      }
    };
  }));

  // Generate implicit ItemGrant advancements for class features
  const classFeaturesByLevel: { [level: number]: string[] } = {};
  features.filter(f => f.parentType === 'class').forEach(f => {
    const level = f.level || 1;
    if (!classFeaturesByLevel[level]) classFeaturesByLevel[level] = [];
    classFeaturesByLevel[level].push(f.sourceId);
  });

  for (const levelStr in classFeaturesByLevel) {
    const level = parseInt(levelStr);
    const hasItemGrant = classData.advancements.some((a: any) => a.type === 'ItemGrant' && a.level === level);
    // Even if it has an ItemGrant, we might want to generate our implicit one for features
    classData.advancements.push({
      _id: `implicit-class-features-${level}`,
      type: "ItemGrant",
      level: level,
      title: "Class Features",
      icon: "systems/dnd5e/icons/svg/item-grant.svg",
      configuration: {
        items: classFeaturesByLevel[level].map(id => ({ uuid: id })),
        optional: false,
        spell: null
      }
    });
  }

  // Generate implicit ItemGrant advancements for subclass features
  subclasses.forEach(sub => {
    const subFeaturesByLevel: { [level: number]: string[] } = {};
    features.filter(f => f.parentId === sub.id).forEach(f => {
      const level = f.level || 1;
      if (!subFeaturesByLevel[level]) subFeaturesByLevel[level] = [];
      subFeaturesByLevel[level].push(f.sourceId);
    });

    if (!sub.advancements) sub.advancements = [];

    for (const levelStr in subFeaturesByLevel) {
      const level = parseInt(levelStr);
      sub.advancements.push({
        _id: `implicit-subclass-features-${level}`,
        type: "ItemGrant",
        level: level,
        title: "Subclass Features",
        icon: "systems/dnd5e/icons/svg/item-grant.svg",
        configuration: {
          items: subFeaturesByLevel[level].map(id => ({ uuid: id })),
          optional: false,
          spell: null
        }
      });
    }
  });

  // Update Unique Option Groups with associated feature references
  uniqueOptionGroups = uniqueOptionGroups.map(group => {
    const associatedFeature = features.find(f => f.id === group.featureId);
    return {
      ...group,
      sourceBookId: associatedFeature ? associatedFeature.sourceBookId : resolvedClassBookId,
      featureSourceId: associatedFeature ? associatedFeature.sourceId : undefined,
      description: associatedFeature ? associatedFeature.description : group.description
    };
  });

  // classData also needs its uniqueOptionGroupIds updated to semantic IDs
  classData.uniqueOptionGroupIds = (classData.uniqueOptionGroupIds || []).map((id: string) => groupIdToSourceIdMap[id] || id);

  // Fetch Unique Options for those groups (Correct collection: uniqueOptionItems)
  let uniqueOptions: any[] = [];
  if (groupIds.length > 0) {
    const optionsSnap = await getDocs(query(collection(db, 'uniqueOptionItems'), where('groupId', 'in', groupIds)));
    uniqueOptions = optionsSnap.docs.map(d => {
      const data: any = d.data();
      const group = uniqueOptionGroups.find(g => g.id === data.groupId);
      const identifier = data.identifier || slugify(data.name || "");
      return {
        ...data,
        id: d.id,
        identifier: identifier,
        sourceId: `class-option-${identifier}`,
        sourceBookId: group ? group.sourceBookId : resolvedClassBookId,
        groupSourceId: group ? group.sourceId : data.groupId,
        description: cleanText(data.description),
        levelPrerequisite: data.levelPrerequisite // Make sure levelPrerequisite is properly included
      };
    });
  }

  // Fetch Spellcasting Scalings
  const spellcastingIds = [
    classData.spellcastingId,
    classData.spellcasting?.progressionId,
    classData.spellcasting?.spellsKnownId,
  ].filter(id => id && typeof id === 'string');
  
  const spellcastingScalings: { [id: string]: any } = {};
  if (spellcastingIds.length > 0) {
    const uniqueIds = Array.from(new Set(spellcastingIds));
    const scSnap = await getDocs(query(collection(db, 'spellcastingScalings'), where(documentId(), 'in', uniqueIds)));
    scSnap.docs.forEach(d => {
      spellcastingScalings[d.id] = { id: d.id, ...d.data() };
    });
  }

  // Fetch Source metadata for the class
  let source = null;
  if (classDataRaw.sourceId) {
    const sourceSnap = await getDoc(doc(db, 'sources', classDataRaw.sourceId));
    if (sourceSnap.exists()) {
      source = { id: sourceSnap.id, ...sourceSnap.data() };
    }
  }

  return {
    class: classData,
    subclasses,
    features,
    scalingColumns,
    uniqueOptionGroups,
    uniqueOptionItems: uniqueOptions, // Renamed for compatibility
    spellcastingScalings,
    source
  };
}

/**
 * Generates a semantic ID for a source suitable for stable linking in external systems.
 * e.g. source-phb-2014 or source-xanathars-guide
 */
export function getSemanticSourceId(sourceData: any, originalId: string) {
  const slug = sourceData.slug;
  const abbr = sourceData.abbreviation?.toLowerCase();
  const rules = sourceData.rules || "2014";
  
  if (abbr) return `source-${abbr.replace(/[^a-z0-9]/g, '')}-${rules}`;
  if (slug) return `source-${slug}`;
  return originalId;
}

/**
 * Generates the source export bundle for a specific source.
 */
export async function exportSourceForFoundry(sourceId: string, includePayloads: boolean = true) {
  const sourceDoc = await getDoc(doc(db, 'sources', sourceId));
  if (!sourceDoc.exists()) throw new Error("Source not found");
  const sourceData: any = sourceDoc.data();
  const slug = sourceData.slug || sourceId;
  const semanticId = getSemanticSourceId(sourceData, sourceId);

  // Helper to ensure ISO date strings in JSON
  const toISO = (val: any) => {
    if (!val) return null;
    if (typeof val.toDate === 'function') return val.toDate().toISOString();
    if (val instanceof Date) return val.toISOString();
    return val;
  };

  // 1. Source Detail (source.json)
  const sourceDetail = {
    kind: "dauligor.source.v1",
    schemaVersion: 1,
    sourceId: semanticId,
    slug: slug,
    name: sourceData.name,
    shortName: sourceData.abbreviation || sourceData.name,
    description: sourceData.description,
    coverImage: sourceData.imageUrl || "",
    status: sourceData.status || "ready",
    rules: sourceData.rules || "2014",
    tags: sourceData.tags || [],
    dates: {
      addedAt: toISO(sourceData.createdAt),
      updatedAt: toISO(sourceData.updatedAt)
    },
    linkedContent: {
      classes: { count: 0, catalogUrl: "classes/catalog.json" },
      spells: { count: 0, catalogUrl: null },
      items: { count: 0, catalogUrl: null },
      bestiary: { count: 0, catalogUrl: null },
      journals: { count: 0, catalogUrl: null }
    }
  };

  // 2. Fetch Classes (using Firestore ID for DB query)
  const classesSnap = await getDocs(query(collection(db, 'classes'), where('sourceId', '==', sourceId)));
  const classes = classesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  sourceDetail.linkedContent.classes.count = classes.length;

  // 3. Class Catalog (classes/catalog.json)
  const classCatalog = {
    kind: "dauligor.class-catalog.v1",
    schemaVersion: 1,
    source: {
      system: "dauligor",
      entity: "class-catalog",
      id: `${semanticId}-classes`,
      sourceId: semanticId
    },
    entries: classes.map((cls: any) => ({
      sourceId: `class-${(cls as any).identifier || slugify(cls.name)}`,
      name: cls.name,
      type: "class",
      img: cls.imageUrl || "icons/svg/item-bag.svg",
      rules: sourceData.rules || "2014",
      description: cleanText(cls.description).substring(0, 200),
      payloadKind: "dauligor.semantic.class-export",
      payloadUrl: `${(cls as any).identifier || cls.id}.json`
    }))
  };

  // 4. Source Library Index (catalog.json)
  const sourceCatalog = {
    kind: "dauligor.source-catalog.v1",
    schemaVersion: 1,
    source: {
      system: "dauligor",
      entity: "source-catalog",
      id: "exported-source-library"
    },
    entries: [
      {
        sourceId: semanticId,
        slug: slug,
        name: sourceData.name,
        shortName: sourceData.abbreviation || sourceData.name,
        description: sourceData.description?.substring(0, 200) || "",
        status: sourceData.status || "ready",
        rules: sourceData.rules || "2014",
        tags: sourceData.tags || [],
        supportedImportTypes: ["classes-subclasses"],
        counts: {
          classes: classes.length,
          spells: 0,
          items: 0,
          bestiary: 0,
          journals: 0
        },
        detailUrl: `${slug}/source.json`,
        classCatalogUrl: `${slug}/classes/catalog.json`
      }
    ]
  };

  // 5. Build ZIP
  const zip = new JSZip();
  // We use the slug as the root folder in the zip
  const sourceFolder = zip.folder(slug);
  if (!sourceFolder) throw new Error("Could not create source folder");

  sourceFolder.file("source.json", JSON.stringify(sourceDetail, null, 2));
  
  // Create family folders as per contract, even if empty
  const classFolder = sourceFolder.folder("classes");
  const spellsFolder = sourceFolder.folder("spells");
  const itemsFolder = sourceFolder.folder("items");
  const bestiaryFolder = sourceFolder.folder("bestiary");
  const journalsFolder = sourceFolder.folder("journals");

  if (classes.length > 0 && classFolder) {
    classFolder.file("catalog.json", JSON.stringify(classCatalog, null, 2));
    
    // Always include payloads in this standard export
    for (const cls of classes) {
      const fullExport = await exportClassSemantic(cls.id);
      if (fullExport) {
        classFolder.file(`${(cls as any).identifier || cls.id}.json`, JSON.stringify(fullExport, null, 2));
      }
    }
  } else if (classFolder) {
    // Ensure catalog exists even if empty for the wizard
    classFolder.file("catalog.json", JSON.stringify({ ...classCatalog, entries: [] }, null, 2));
  }
  
  // Ensure other family catalogs exist (empty)
  if (spellsFolder) spellsFolder.file("catalog.json", JSON.stringify({ kind: "dauligor.spell-catalog.v1", schemaVersion: 1, entries: [] }, null, 2));
  if (itemsFolder) itemsFolder.file("catalog.json", JSON.stringify({ kind: "dauligor.item-catalog.v1", schemaVersion: 1, entries: [] }, null, 2));
  if (bestiaryFolder) bestiaryFolder.file("catalog.json", JSON.stringify({ kind: "dauligor.bestiary-catalog.v1", schemaVersion: 1, entries: [] }, null, 2));
  if (journalsFolder) journalsFolder.file("catalog.json", JSON.stringify({ kind: "dauligor.journal-catalog.v1", schemaVersion: 1, entries: [] }, null, 2));

  const content = await zip.generateAsync({ type: "blob" });
  saveAs(content, `dauligor-source-${slug}.zip`);
}

/**
 * Generates a full library export containing all ready sources.
 */
export async function exportFullSourceLibrary(includePayloads: boolean = true) {
  const sourcesSnap = await getDocs(query(collection(db, 'sources'), where('status', '==', 'ready')));
  const sources = sourcesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  // 5. Build ZIP
  const zip = new JSZip();
  
  const sourceEntries: any[] = [];
  const toISO = (val: any) => {
    if (!val) return null;
    if (typeof val.toDate === 'function') return val.toDate().toISOString();
    if (val instanceof Date) return val.toISOString();
    return val;
  };

  for (const sourceDocData of sources) {
    const sourceData: any = sourceDocData;
    const sourceId = sourceData.id;
    const slug = sourceData.slug || sourceId;
    const semanticId = getSemanticSourceId(sourceData, sourceId);

    // Fetch Classes for this source (using Firestore ID for DB query)
    const classesSnap = await getDocs(query(collection(db, 'classes'), where('sourceId', '==', sourceId)));
    const classes = classesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Source Detail
    const sourceDetail = {
      kind: "dauligor.source.v1",
      schemaVersion: 1,
      sourceId: semanticId,
      slug: slug,
      name: sourceData.name,
      shortName: sourceData.abbreviation || sourceData.name,
      description: sourceData.description,
      coverImage: sourceData.imageUrl || "",
      status: sourceData.status || "ready",
      rules: sourceData.rules || "2014",
      tags: sourceData.tags || [],
      dates: {
        addedAt: toISO(sourceData.createdAt),
        updatedAt: toISO(sourceData.updatedAt)
      },
      linkedContent: {
        classes: { count: classes.length, catalogUrl: "classes/catalog.json" },
        spells: { count: 0, catalogUrl: "spells/catalog.json" },
        items: { count: 0, catalogUrl: "items/catalog.json" },
        bestiary: { count: 0, catalogUrl: "bestiary/catalog.json" },
        journals: { count: 0, catalogUrl: "journals/catalog.json" }
      }
    };

    // Class Catalog
    const classCatalog = {
      kind: "dauligor.class-catalog.v1",
      schemaVersion: 1,
      source: {
        system: "dauligor",
        entity: "class-catalog",
        id: `${semanticId}-classes`,
        sourceId: semanticId
      },
      entries: classes.map((cls: any) => ({
        sourceId: `class-${(cls as any).identifier || slugify(cls.name)}`,
        name: cls.name,
        type: "class",
        img: cls.imageUrl || "icons/svg/item-bag.svg",
        rules: sourceData.rules || "2014",
        description: cleanText(cls.description).substring(0, 200),
        payloadKind: "dauligor.semantic.class-export",
        payloadUrl: `${(cls as any).identifier || cls.id}.json`
      }))
    };

    // Add to library catalog entries
    sourceEntries.push({
      sourceId: semanticId,
      slug: slug,
      name: sourceData.name,
      shortName: sourceData.abbreviation || sourceData.name,
      description: sourceData.description?.substring(0, 200) || "",
      status: sourceData.status || "ready",
      rules: sourceData.rules || "2014",
      tags: sourceData.tags || [],
      supportedImportTypes: ["classes-subclasses"],
      counts: {
        classes: classes.length,
        spells: 0,
        items: 0,
        bestiary: 0,
        journals: 0
      },
      detailUrl: `${slug}/source.json`,
      classCatalogUrl: `${slug}/classes/catalog.json`
    });

    // Add files to zip
    const sourceFolder = zip.folder(slug);
    if (sourceFolder) {
      sourceFolder.file("source.json", JSON.stringify(sourceDetail, null, 2));
      
      const classFolder = sourceFolder.folder("classes");
      const spellsFolder = sourceFolder.folder("spells");
      const itemsFolder = sourceFolder.folder("items");
      const bestiaryFolder = sourceFolder.folder("bestiary");
      const journalsFolder = sourceFolder.folder("journals");

      if (classFolder) {
        classFolder.file("catalog.json", JSON.stringify(classCatalog, null, 2));
        for (const cls of classes) {
          const fullExport = await exportClassSemantic(cls.id);
          if (fullExport) {
            classFolder.file(`${(cls as any).identifier || cls.id}.json`, JSON.stringify(fullExport, null, 2));
          }
        }
      }

      // Empty families
      if (spellsFolder) spellsFolder.file("catalog.json", JSON.stringify({ kind: "dauligor.spell-catalog.v1", schemaVersion: 1, entries: [] }, null, 2));
      if (itemsFolder) itemsFolder.file("catalog.json", JSON.stringify({ kind: "dauligor.item-catalog.v1", schemaVersion: 1, entries: [] }, null, 2));
      if (bestiaryFolder) bestiaryFolder.file("catalog.json", JSON.stringify({ kind: "dauligor.bestiary-catalog.v1", schemaVersion: 1, entries: [] }, null, 2));
      if (journalsFolder) journalsFolder.file("catalog.json", JSON.stringify({ kind: "dauligor.journal-catalog.v1", schemaVersion: 1, entries: [] }, null, 2));
    }
  }

  // Final Library Catalog
  const sourceCatalog = {
    kind: "dauligor.source-catalog.v1",
    schemaVersion: 1,
    source: {
      system: "dauligor",
      entity: "source-catalog",
      id: "full-exported-source-library"
    },
    entries: sourceEntries
  };

  zip.file("catalog.json", JSON.stringify(sourceCatalog, null, 2));

  const content = await zip.generateAsync({ type: "blob" });
  saveAs(content, "dauligor-full-library.zip");
}

/**
 * Specifically exports the master library catalog.json as a raw file for manual verification.
 */
export async function exportRawLibraryCatalogJSON() {
  const sourcesSnap = await getDocs(query(collection(db, 'sources'), where('status', '==', 'ready')));
  const sources = sourcesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  const entries: any[] = [];
  for (const source of sources) {
    const s: any = source;
    // Fetch count for display in catalog
    const classesSnap = await getDocs(query(collection(db, 'classes'), where('sourceId', '==', s.id)));
    const semanticId = getSemanticSourceId(s, s.id);
    
    entries.push({
      sourceId: semanticId,
      slug: s.slug || s.id,
      name: s.name,
      shortName: s.abbreviation || s.name,
      description: s.description?.substring(0, 200) || "",
      status: s.status || "ready",
      rules: s.rules || "2014",
      tags: s.tags || [],
      supportedImportTypes: ["classes-subclasses"],
      counts: {
        classes: classesSnap.size,
        spells: 0,
        items: 0,
        bestiary: 0,
        journals: 0
      },
      detailUrl: `${s.slug || s.id}/source.json`,
      classCatalogUrl: `${s.slug || s.id}/classes/catalog.json`
    });
  }

  const catalog = {
    kind: "dauligor.source-catalog.v1",
    schemaVersion: 1,
    source: {
      system: "dauligor",
      entity: "source-catalog",
      id: "manual-export-catalog"
    },
    entries
  };

  const blob = new Blob([JSON.stringify(catalog, null, 2)], { type: "application/json" });
  saveAs(blob, "catalog.json");
}

/**
 * Specifically exports a single source.json as a raw file for manual verification.
 */
export async function exportRawSourceJSON(sourceId: string) {
  const sourceDoc = await getDoc(doc(db, 'sources', sourceId));
  if (!sourceDoc.exists()) throw new Error("Source not found");
  const sourceData: any = sourceDoc.data();
  const slug = sourceData.slug || sourceId;
  const semanticId = getSemanticSourceId(sourceData, sourceId);

  // Fetch Classes for count
  const classesSnap = await getDocs(query(collection(db, 'classes'), where('sourceId', '==', sourceId)));

  const toISO = (val: any) => {
    if (!val) return null;
    if (typeof val.toDate === 'function') return val.toDate().toISOString();
    if (val instanceof Date) return val.toISOString();
    return val;
  };

  const sourceDetail = {
    kind: "dauligor.source.v1",
    schemaVersion: 1,
    sourceId: semanticId,
    slug: slug,
    name: sourceData.name,
    shortName: sourceData.abbreviation || sourceData.name,
    description: sourceData.description,
    coverImage: sourceData.imageUrl || "",
    status: sourceData.status || "ready",
    rules: sourceData.rules || "2014",
    tags: sourceData.tags || [],
    dates: {
      addedAt: toISO(sourceData.createdAt),
      updatedAt: toISO(sourceData.updatedAt)
    },
    linkedContent: {
      classes: { count: classesSnap.size, catalogUrl: "classes/catalog.json" },
      spells: { count: 0, catalogUrl: null },
      items: { count: 0, catalogUrl: null },
      bestiary: { count: 0, catalogUrl: null },
      journals: { count: 0, catalogUrl: null }
    }
  };

  const blob = new Blob([JSON.stringify(sourceDetail, null, 2)], { type: "application/json" });
  saveAs(blob, `${slug}.json`);
}
