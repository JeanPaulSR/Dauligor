import React, { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useParams, useNavigate, Link } from 'react-router-dom';
import ActivityEditor from '../../components/compendium/ActivityEditor';
import { db, handleFirestoreError } from '../../lib/firebase';
import { doc, getDoc, setDoc, updateDoc, collection, query, orderBy, onSnapshot, addDoc, deleteDoc, where } from 'firebase/firestore';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { ImageUpload } from '../../components/ui/ImageUpload';
import { Sword, Save, Plus, Trash2, ChevronLeft, Shield, Scroll, Wand2, Heart, Hammer, BookOpen, Tag, Edit, Check, Image as ImageIcon, Zap, ListChecks } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '../../components/ui/dialog';
import { ScrollArea } from '../../components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Checkbox } from '../../components/ui/checkbox';
import MarkdownEditor from '../../components/MarkdownEditor';
import { slugify, cn } from '../../lib/utils';
import AdvancementManager, { Advancement } from '../../components/compendium/AdvancementManager';

const FEATURE_TYPES = [
  { id: 'background', name: 'Background Feature' },
  { id: 'class', name: 'Class Feature' },
  { id: 'monster', name: 'Monster Feature' },
  { id: 'species', name: 'Species Feature' },
  { id: 'enchantment', name: 'Enchantment' },
  { id: 'feat', name: 'Feat' },
  { id: 'gift', name: 'Supernatural Gift' },
  { id: 'vehicle', name: 'Vehicle Feature' }
];

function getScalingBreakpoints(values: Record<string, any> = {}) {
  let lastValue: string | undefined;
  return Object.entries(values)
    .sort(([a], [b]) => Number(a) - Number(b))
    .filter(([, value]) => {
      const normalized = String(value ?? '');
      if (!normalized || normalized === lastValue) return false;
      lastValue = normalized;
      return true;
    });
}

function resolveLegacyProficiencyIds(legacyValue: string, entries: any[] = []) {
  if (!legacyValue?.trim() || entries.length === 0) return [];
  const parts = legacyValue
    .split(',')
    .map(part => part.trim().toLowerCase())
    .filter(Boolean);

  return entries
    .filter(entry => {
      const comparableValues = [
        entry.name,
        entry.identifier,
        entry.category,
        entry.foundryAlias
      ]
        .filter(Boolean)
        .map((value: string) => String(value).trim().toLowerCase());

      return parts.some(part => comparableValues.includes(part));
    })
    .map(entry => entry.id);
}

export default function ClassEditor({ userProfile }: { userProfile: any }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(!!id);
  const [sources, setSources] = useState<any[]>([]);
  const [scalings, setScalings] = useState<any[]>([]);
  const [pactScalings, setPactScalings] = useState<any[]>([]);
  const [knownScalings, setKnownScalings] = useState<any[]>([]);
  const [allSkills, setAllSkills] = useState<any[]>([]);
  const [allTools, setAllTools] = useState<any[]>([]);
  const [allArmor, setAllArmor] = useState<any[]>([]);
  const [allWeapons, setAllWeapons] = useState<any[]>([]);
  const [subclasses, setSubclasses] = useState<any[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [lore, setLore] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [hitDie, setHitDie] = useState(8);
  const [savingThrows, setSavingThrows] = useState<string[]>([]);
  const [proficiencies, setProficiencies] = useState<any>({
    armor: '',
    weapons: '',
    armorIds: [],
    weaponIds: [],
    tools: {
      choiceCount: 0,
      optionIds: [],
      fixedIds: []
    },
    skills: {
      choiceCount: 0,
      optionIds: [],
      fixedIds: []
    }
  });
  const [startingEquipment, setStartingEquipment] = useState('');
  const [multiclassing, setMulticlassing] = useState('');
  const [primaryAbility, setPrimaryAbility] = useState<string[]>([]);
  const [wealth, setWealth] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [spellcasting, setSpellcasting] = useState({
    hasSpellcasting: false,
    description: '',
    level: 1,
    ability: 'INT',
    type: 'prepared',
    progression: 'none',
    progressionId: '',
    altProgressionId: '',
    spellsKnownId: '',
    spellsKnownFormula: ''
  });
  const [excludedOptionIds, setExcludedOptionIds] = useState<Record<string, string[]>>({});
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [subclassTitle, setSubclassTitle] = useState('');
  const [subclassFeatureLevels, setSubclassFeatureLevels] = useState<number[]>([]);
  const [levelsInput, setLevelsInput] = useState('');

  // Features State
  const [features, setFeatures] = useState<any[]>([]);
  const [editingFeature, setEditingFeature] = useState<any>(null);
  const [isFeatureModalOpen, setIsFeatureModalOpen] = useState(false);
  const [featureTab, setFeatureTab] = useState('description');

  // Groups for selection
  const [allOptionGroups, setAllOptionGroups] = useState<any[]>([]);
  const [allOptionItems, setAllOptionItems] = useState<any[]>([]);
  const [tagGroups, setTagGroups] = useState<any[]>([]);
  const [allTags, setAllTags] = useState<any[]>([]);
  const [scalingColumns, setScalingColumns] = useState<any[]>([]);
  const [advancements, setAdvancements] = useState<Advancement[]>([]);

  // Unique Options Management
  const [managingGroupId, setManagingGroupId] = useState<string | null>(null);
  const [managingGroupSearch, setManagingGroupSearch] = useState('');

  // Refs for Markdown Toolbar
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const equipmentRef = useRef<HTMLTextAreaElement>(null);
  const multiclassingRef = useRef<HTMLTextAreaElement>(null);
  const spellcastingRef = useRef<HTMLTextAreaElement>(null);
  const featureDescRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    console.log(`[ClassEditor] Initializing global listeners`);
    const globalStartTime = performance.now();

    // Fetch Sources
    const unsubscribeSources = onSnapshot(query(collection(db, 'sources'), orderBy('name')), (snap) => {
      console.log(`[ClassEditor] Sources snapshot received. Count: ${snap.docs.length}`);
      setSources(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (err) => console.error("[ClassEditor] Sources listener error:", err));

    // Fetch Scalings
    const unsubscribeScalings = onSnapshot(query(collection(db, 'spellcastingScalings'), orderBy('name')), (snap) => {
      console.log(`[ClassEditor] Scalings snapshot received. Count: ${snap.docs.length}`);
      setScalings(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (err) => console.error("[ClassEditor] Scalings listener error:", err));

    // Fetch Pact Scalings
    const unsubscribePactScalings = onSnapshot(query(collection(db, 'pactMagicScalings'), orderBy('name')), (snap) => {
      setPactScalings(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    // Fetch Known Scalings
    const unsubscribeKnownScalings = onSnapshot(query(collection(db, 'spellsKnownScalings'), orderBy('name')), (snap) => {
      setKnownScalings(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    // Fetch Skills
    const unsubscribeSkills = onSnapshot(query(collection(db, 'skills'), orderBy('name')), (snap) => {
      setAllSkills(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    // Fetch Tools
    const unsubscribeTools = onSnapshot(query(collection(db, 'tools'), orderBy('name')), (snap) => {
      setAllTools(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    // Fetch Armor
    const unsubscribeArmor = onSnapshot(query(collection(db, 'armor'), orderBy('name')), (snap) => {
      setAllArmor(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    // Fetch Weapons
    const unsubscribeWeapons = onSnapshot(query(collection(db, 'weapons'), orderBy('name')), (snap) => {
      setAllWeapons(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    // Fetch All Option Groups
    const unsubscribeGroups = onSnapshot(query(collection(db, 'uniqueOptionGroups'), orderBy('name')), (snap) => {
      console.log(`[ClassEditor] Option groups snapshot received. Count: ${snap.docs.length}`);
      setAllOptionGroups(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (err) => console.error("[ClassEditor] Option groups listener error:", err));

    // Fetch All Option Items
    const unsubscribeItems = onSnapshot(query(collection(db, 'uniqueOptionItems')), (snap) => {
      setAllOptionItems(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (err) => console.error("[ClassEditor] Option items listener error:", err));

    // Fetch Tag Groups for Classes
    const unsubscribeTagGroups = onSnapshot(query(collection(db, 'tagGroups'), where('classifications', 'array-contains', 'class')), (snap) => {
      console.log(`[ClassEditor] Tag groups snapshot received. Count: ${snap.docs.length}`);
      setTagGroups(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (err) => console.error("[ClassEditor] Tag groups listener error:", err));

    // Fetch All Tags
    const unsubscribeTags = onSnapshot(query(collection(db, 'tags')), (snap) => {
      console.log(`[ClassEditor] Tags snapshot received. Count: ${snap.docs.length}`);
      setAllTags(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (err) => console.error("[ClassEditor] Tags listener error:", err));

    if (id) {
      console.log(`[ClassEditor] Fetching class data for ID: ${id}`);
      const classStartTime = performance.now();
      const fetchClass = async () => {
        try {
          const docSnap = await getDoc(doc(db, 'classes', id));
          if (docSnap.exists()) {
            const data = docSnap.data();
            console.log(`[ClassEditor] Class data loaded: ${data.name}`);
            setName(data.name || '');
            setDescription(data.description || '');
            setLore(data.lore || '');
            setSourceId(data.sourceId || '');
            setHitDie(data.hitDie || 8);
            setSavingThrows(data.savingThrows || []);
            const rawProf = data.proficiencies || {};
            const tools = rawProf.tools || {};
            const skills = rawProf.skills || {};
            setProficiencies({
              armor: rawProf.armor || '',
              weapons: rawProf.weapons || '',
              armorIds: rawProf.armorIds || [],
              weaponIds: rawProf.weaponIds || [],
              tools: {
                choiceCount: tools.choiceCount || 0,
                optionIds: tools.optionIds || [],
                fixedIds: tools.fixedIds || []
              },
              skills: {
                choiceCount: skills.choiceCount || 0,
                optionIds: skills.optionIds || [],
                fixedIds: skills.fixedIds || []
              }
            });
            setStartingEquipment(data.startingEquipment || '');
            setPrimaryAbility(data.primaryAbility || []);
            setWealth(data.wealth || '');
            setImageUrl(data.imageUrl || '');
            setMulticlassing(data.multiclassing || '');
            setSpellcasting(data.spellcasting || {
              description: '',
              level: 1,
              ability: 'INT',
              type: 'prepared',
              progression: 'none',
              progressionId: '',
              altProgressionId: '',
              spellsKnownId: '',
              spellsKnownFormula: ''
            });
            setTagIds(data.tagIds || []);
            setAdvancements(data.advancements || []);
            setSubclassTitle(data.subclassTitle || '');
            const levels = data.subclassFeatureLevels || [];
            setSubclassFeatureLevels(levels);
            setLevelsInput(levels.join(', '));
          } else {
            console.warn(`[ClassEditor] Class document ${id} does not exist.`);
          }
        } catch (error) {
          console.error("[ClassEditor] Error fetching class:", error);
          toast.error("Failed to load class data. It might be corrupted.");
        } finally {
          setInitialLoading(false);
          console.log(`[ClassEditor] Class data fetch complete. Time: ${(performance.now() - classStartTime).toFixed(2)}ms`);
        }
      };
      fetchClass();

      // Fetch Features
      console.log(`[ClassEditor] Setting up features listener for parentId: ${id}`);
      const featuresQuery = query(
        collection(db, 'features'),
        where('parentId', '==', id),
        where('parentType', '==', 'class'),
        orderBy('level', 'asc')
      );
      const unsubscribeFeatures = onSnapshot(featuresQuery, (snap) => {
        console.log(`[ClassEditor] Features snapshot received. Count: ${snap.docs.length}`);
        setFeatures(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      }, (err) => console.error("[ClassEditor] Features listener error:", err));

      // Fetch Scaling Columns
      const scalingQuery = query(
        collection(db, 'scalingColumns'),
        where('parentId', '==', id),
        where('parentType', '==', 'class'),
        orderBy('name', 'asc')
      );
      const unsubscribeScaling = onSnapshot(scalingQuery, (snap) => {
        setScalingColumns(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      });

      // Fetch Subclasses
      const subclassesQuery = query(
        collection(db, 'subclasses'),
        where('classId', '==', id),
        orderBy('name', 'asc')
      );
      const unsubscribeSubclasses = onSnapshot(subclassesQuery, (snap) => {
        setSubclasses(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      });

      return () => {
        console.log(`[ClassEditor] Cleaning up all listeners for ID: ${id}`);
        unsubscribeSources();
        unsubscribeScalings();
        unsubscribePactScalings();
        unsubscribeKnownScalings();
        unsubscribeSkills();
        unsubscribeTools();
        unsubscribeArmor();
        unsubscribeWeapons();
        unsubscribeGroups();
        unsubscribeItems();
        unsubscribeTagGroups();
        unsubscribeTags();
        unsubscribeFeatures();
        unsubscribeScaling();
        unsubscribeSubclasses();
      };
    }

    setInitialLoading(false); // No ID, so not loading anything specific
    return () => {
      console.log(`[ClassEditor] Cleaning up all listeners`);
      unsubscribeSources();
      unsubscribeScalings();
      unsubscribePactScalings();
      unsubscribeKnownScalings();
      unsubscribeSkills();
      unsubscribeTools();
      unsubscribeArmor();
      unsubscribeWeapons();
      unsubscribeGroups();
      unsubscribeItems();
      unsubscribeTagGroups();
      unsubscribeTags();
    };
  }, [id]);

  useEffect(() => {
    if (allArmor.length === 0 && allWeapons.length === 0) return;

    setProficiencies((prev: any) => {
      const nextArmorIds = (prev.armorIds?.length ?? 0) > 0
        ? prev.armorIds
        : resolveLegacyProficiencyIds(prev.armor || '', allArmor);
      const nextWeaponIds = (prev.weaponIds?.length ?? 0) > 0
        ? prev.weaponIds
        : resolveLegacyProficiencyIds(prev.weapons || '', allWeapons);

      if (
        JSON.stringify(nextArmorIds) === JSON.stringify(prev.armorIds || []) &&
        JSON.stringify(nextWeaponIds) === JSON.stringify(prev.weaponIds || [])
      ) {
        return prev;
      }

      return {
        ...prev,
        armorIds: nextArmorIds,
        weaponIds: nextWeaponIds
      };
    });
  }, [
    allArmor,
    allWeapons,
    proficiencies.armor,
    proficiencies.weapons,
    proficiencies.armorIds,
    proficiencies.weaponIds
  ]);

  const handleSaveFeature = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;

    try {
      let parsedActivities = {};
      let parsedEffects = [];
      try {
        if (editingFeature.activitiesStr) parsedActivities = JSON.parse(editingFeature.activitiesStr);
        if (editingFeature.effectsStr) parsedEffects = JSON.parse(editingFeature.effectsStr);
      } catch (err) {
        toast.error("Invalid JSON in Activities or Effects");
        return;
      }

      const featureData: any = {
        ...editingFeature,
        parentId: id,
        parentType: 'class',
        quantityColumnId: editingFeature.quantityColumnId || '',
        scalingColumnId: editingFeature.scalingColumnId || '',
        automation: {
          activities: Array.isArray(editingFeature.activities) 
            ? editingFeature.activities 
            : Object.values(editingFeature.activities || {}),
          effects: parsedEffects
        },
        updatedAt: new Date().toISOString()
      };
      
      delete featureData.activitiesStr;
      delete featureData.effectsStr;
      delete featureData.activities;

      if (editingFeature.id) {
        await updateDoc(doc(db, 'features', editingFeature.id), featureData);
      } else {
        await addDoc(collection(db, 'features'), {
          ...featureData,
          createdAt: new Date().toISOString()
        });
      }
      setIsFeatureModalOpen(false);
      setEditingFeature(null);
    } catch (error) {
      console.error("Error saving feature:", error);
    }
  };

  const handleDeleteFeature = async (featureId: string) => {
    try {
      await deleteDoc(doc(db, 'features', featureId));
      toast.success('Feature deleted');
    } catch (error) {
      console.error("Error deleting feature:", error);
      toast.error('Failed to delete feature');
    }
  };

  const handleDeleteScaling = async (scalingId: string) => {
    try {
      await deleteDoc(doc(db, 'scalingColumns', scalingId));
      toast.success('Scaling column deleted');
    } catch (error) {
      console.error("Error deleting scaling:", error);
      toast.error('Failed to delete scaling');
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const updatedAdvancements = [...advancements];
      const implicitTraitId = "implicit-proficiencies";
      const traitIndex = updatedAdvancements.findIndex(a => a._id === implicitTraitId);
      
      const skillChoices = [];
      if (proficiencies?.skills?.choiceCount > 0 && proficiencies.skills?.optionIds?.length > 0) {
        skillChoices.push({
          count: proficiencies.skills.choiceCount,
          pool: proficiencies.skills.optionIds,
        });
      }

      if (proficiencies?.tools?.choiceCount > 0 && proficiencies.tools?.optionIds?.length > 0) {
        skillChoices.push({
          count: proficiencies.tools.choiceCount,
          pool: proficiencies.tools.optionIds,
        });
      }

      const implicitTrait: Advancement = {
        _id: implicitTraitId,
        type: "Trait" as const,
        level: 1,
        title: "Starting Proficiencies",
        configuration: {
          mode: "default",
          allowReplacements: false,
          grants: [
            ...(savingThrows || []),
            ...(proficiencies?.skills?.fixedIds || []),
            ...(proficiencies?.tools?.fixedIds || [])
          ],
          choices: skillChoices,
          choiceCount: proficiencies?.skills?.choiceCount || 0
        },
        value: {}
      };

      if (implicitTrait.configuration.grants.length > 0 || implicitTrait.configuration.choices.length > 0) {
        if (traitIndex !== -1) {
          updatedAdvancements[traitIndex] = implicitTrait;
        } else {
          updatedAdvancements.push(implicitTrait);
        }
      } else if (traitIndex !== -1) {
        updatedAdvancements.splice(traitIndex, 1);
      }

      const armorSelections = (proficiencies.armorIds || [])
        .map((id: string) => allArmor.find((item: any) => item.id === id))
        .filter(Boolean);
      const weaponSelections = (proficiencies.weaponIds || [])
        .map((id: string) => allWeapons.find((item: any) => item.id === id))
        .filter(Boolean);

      const normalizedProficiencies = {
        ...proficiencies,
        armorIds: proficiencies.armorIds || [],
        weaponIds: proficiencies.weaponIds || [],
        armor: armorSelections.map((item: any) => item.name).join(', '),
        weapons: weaponSelections.map((item: any) => item.name).join(', ')
      };

      const classData = {
        name,
        identifier: slugify(name),
        description,
        lore,
        sourceId,
        hitDie,
        savingThrows,
        proficiencies: normalizedProficiencies,
        startingEquipment,
        primaryAbility,
        wealth,
        multiclassing,
        spellcasting,
        excludedOptionIds,
        tagIds,
        subclassTitle,
        subclassFeatureLevels,
        advancements: updatedAdvancements,
        imageUrl,
        updatedAt: new Date().toISOString()
      };

      if (id) {
        await updateDoc(doc(db, 'classes', id), classData);
      } else {
        const docRef = await addDoc(collection(db, 'classes'), {
          ...classData,
          createdAt: new Date().toISOString()
        });
        navigate(`/compendium/classes/edit/${docRef.id}`);
      }
      toast.success('Class saved successfully!');
    } catch (error) {
      console.error("Error saving class:", error);
      toast.error('Failed to save class.');
    } finally {
      setLoading(false);
    }
  };

  if (initialLoading) {
    return (
      <div className="max-w-6xl mx-auto py-20 text-center space-y-4">
        <div className="font-serif italic text-gold animate-pulse">Consulting the archives...</div>
        <Button variant="ghost" size="sm" onClick={() => navigate('/compendium/classes')} className="text-ink/40">
          <ChevronLeft className="w-4 h-4 mr-2" /> Return to Compendium
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-20">
      <div className="flex items-center justify-between border-b border-gold/10 pb-4">
        <div className="flex items-center gap-4">
          <Link to="/compendium/classes">
            <Button variant="ghost" size="sm" className="text-gold gap-2 hover:bg-gold/5">
              <ChevronLeft className="w-4 h-4" /> Back
            </Button>
          </Link>
          <h1 className="text-2xl font-serif font-bold text-ink uppercase tracking-tight">
            {id ? `Edit ${name || 'Class'}` : 'New Class'}
          </h1>
        </div>
        <Button onClick={handleSave} disabled={loading} size="sm" className="bg-gold hover:bg-gold/90 text-white gap-2">
          <Save className="w-4 h-4" /> Save Class
        </Button>
      </div>

      <div className="grid lg:grid-cols-4 gap-6">
        <div className="lg:col-span-3 space-y-6">
          {/* Basic Info */}
          <div className="p-4 border border-gold/20 bg-card/50 space-y-4">
            <h2 className="label-text text-gold border-b border-gold/10 pb-2">Basic Information</h2>
            <div className="flex flex-col md:flex-row gap-6">
              <div className="w-full md:w-1/3">
                <label className="label-text mb-2 block text-xs uppercase tracking-widest text-gold/60">Class Icon / Artwork</label>
                <ImageUpload 
                  currentImageUrl={imageUrl}
                  storagePath={`images/classes/${id || 'new'}/`}
                  onUpload={setImageUrl}
                />
              </div>
              <div className="flex-1 grid sm:grid-cols-2 gap-4 h-fit">
                <div className="space-y-1">
                  <label className="label-text">Class Name</label>
                  <Input 
                    value={name} 
                    onChange={e => setName(e.target.value)} 
                    placeholder="e.g. Fighter" 
                    className="h-8 text-sm bg-background/50 border-gold/10 focus:border-gold"
                  />
                </div>
                <div className="space-y-1">
                  <label className="label-text">Source</label>
                  <select 
                    value={sourceId} 
                    onChange={e => setSourceId(e.target.value)}
                    className="w-full h-8 px-2 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-sm text-ink"
                  >
                    <option value="">Select a Source</option>
                    {sources.map(s => (
                      <option key={s.id} value={s.id}>{s.name} {s.abbreviation ? `(${s.abbreviation})` : ''}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="label-text">Hit Die</label>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono text-gold">d</span>
                    <select 
                      value={hitDie}
                      onChange={e => setHitDie(parseInt(e.target.value))}
                      className="flex-1 h-8 px-2 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-sm text-ink"
                    >
                      {[4, 6, 8, 10, 12].map(d => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </div>
            <div className="space-y-4">
              <MarkdownEditor 
                value={description} 
                onChange={setDescription}
                placeholder="A brief thematic overview for the grid view..."
                minHeight="80px"
                label="Description (Short Preview)"
              />
              <MarkdownEditor 
                value={lore} 
                onChange={setLore}
                placeholder="Detailed lore and setting info..."
                minHeight="120px"
                label="Lore (Setting Details)"
              />
            </div>
          </div>

          {/* Subclasses */}
          {id && (
            <div className="p-4 border border-gold/20 bg-card/50 space-y-4">
              <div className="flex items-center justify-between border-b border-gold/10 pb-2">
                <h2 className="label-text text-gold">Subclasses</h2>
                <Link to={`/compendium/subclasses/new?classId=${id}`}>
                  <Button 
                    size="sm"
                    className="h-6 text-xs bg-gold/10 text-gold hover:bg-gold/20 border border-gold/20 gap-1"
                  >
                    <Plus className="w-3 h-3" /> Add Subclass
                  </Button>
                </Link>
              </div>

              {/* Subclass Feature Progression */}
              <div className="space-y-4 bg-gold/5 p-3 border border-gold/10 rounded">
                <div className="space-y-3">
                  <div className="flex items-center justify-between border-b border-gold/10 pb-2">
                    <div className="space-y-1 flex-1">
                      <label className="label-text text-[10px] text-gold/60">Subclass Title (e.g. Sorcerous Origin)</label>
                      <Input 
                        value={subclassTitle}
                        onChange={e => setSubclassTitle(e.target.value)}
                        placeholder="Archetype, Domain, Path..."
                        className="h-7 text-xs bg-background/50 border-gold/10 focus:border-gold"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="label-text text-[10px] text-gold/60">Subclass Feature Levels (comma separated, e.g. 1, 6, 14, 18)</label>
                    <Input 
                      value={levelsInput}
                      onChange={e => {
                        const val = e.target.value;
                        setLevelsInput(val);
                        const levels = val.split(',').map(v => parseInt(v.trim())).filter(n => !isNaN(n));
                        setSubclassFeatureLevels(levels);
                      }}
                      placeholder="1, 6, 14, 18"
                      className="h-8 text-xs bg-background/50 border-gold/10 focus:border-gold"
                    />
                  </div>
                </div>
              </div>

              <div className="divide-y divide-gold/10">
                {subclasses.map(sub => (
                  <div key={sub.id} className="py-2 flex items-center justify-between group">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-bold text-ink">{sub.name}</span>
                      <span className="text-[10px] text-ink/40 uppercase font-mono">
                        {sources.find(s => s.id === sub.sourceId)?.abbreviation || 'Unknown'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Link to={`/compendium/subclasses/edit/${sub.id}`}>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-gold">
                          <Edit className="w-3 h-3" />
                        </Button>
                      </Link>
                    </div>
                  </div>
                ))}
                {subclasses.length === 0 && (
                  <p className="py-4 text-center muted-text italic text-[10px]">No subclasses added.</p>
                )}
              </div>
            </div>
          )}

          {/* Proficiencies */}
          <div className="p-4 border border-gold/20 bg-card/50 space-y-6">
            <div className="flex items-center justify-between border-b border-gold/10 pb-2">
              <h2 className="label-text text-gold">Proficiencies</h2>
              <Shield className="w-4 h-4 text-gold/40" />
            </div>

            <div className="grid sm:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="label-text">Armor</label>
                    <span className="text-[10px] text-ink/35">
                      {(proficiencies.armorIds || []).length} selected
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 p-3 border border-gold/10 bg-background/30 rounded-md min-h-[100px]">
                    {allArmor.map(armor => {
                      const isSelected = proficiencies.armorIds?.includes(armor.id);
                      return (
                        <label key={armor.id} className="flex items-center gap-2 cursor-pointer group">
                          <div className={`w-3 h-3 rounded border flex items-center justify-center transition-all ${isSelected ? 'bg-gold border-gold' : 'border-gold/30 group-hover:border-gold/50'}`}>
                            {isSelected && <Check className="w-2 h-2 text-white" />}
                          </div>
                          <input
                            type="checkbox"
                            className="hidden"
                            checked={isSelected}
                            onChange={e => {
                              const current = proficiencies.armorIds || [];
                              const next = e.target.checked
                                ? [...current, armor.id]
                                : current.filter((id: string) => id !== armor.id);
                              setProficiencies({
                                ...proficiencies,
                                armorIds: next
                              });
                            }}
                          />
                          <span className="text-[10px] font-bold text-ink/60 truncate">
                            {armor.name}
                            {armor.category ? <span className="font-normal text-ink/35"> ({armor.category})</span> : null}
                          </span>
                        </label>
                      );
                    })}
                    {allArmor.length === 0 && <p className="text-[10px] text-ink/30 italic col-span-2">No armor proficiencies defined. <Link to="/admin/proficiencies" className="text-gold underline">Manage proficiencies</Link></p>}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="label-text">Weapons</label>
                    <span className="text-[10px] text-ink/35">
                      {(proficiencies.weaponIds || []).length} selected
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 p-3 border border-gold/10 bg-background/30 rounded-md min-h-[100px]">
                    {allWeapons.map(weapon => {
                      const isSelected = proficiencies.weaponIds?.includes(weapon.id);
                      return (
                        <label key={weapon.id} className="flex items-center gap-2 cursor-pointer group">
                          <div className={`w-3 h-3 rounded border flex items-center justify-center transition-all ${isSelected ? 'bg-gold border-gold' : 'border-gold/30 group-hover:border-gold/50'}`}>
                            {isSelected && <Check className="w-2 h-2 text-white" />}
                          </div>
                          <input
                            type="checkbox"
                            className="hidden"
                            checked={isSelected}
                            onChange={e => {
                              const current = proficiencies.weaponIds || [];
                              const next = e.target.checked
                                ? [...current, weapon.id]
                                : current.filter((id: string) => id !== weapon.id);
                              setProficiencies({
                                ...proficiencies,
                                weaponIds: next
                              });
                            }}
                          />
                          <span className="text-[10px] font-bold text-ink/60 truncate">
                            {weapon.name}
                            {weapon.category ? <span className="font-normal text-ink/35"> ({weapon.category})</span> : null}
                          </span>
                        </label>
                      );
                    })}
                    {allWeapons.length === 0 && <p className="text-[10px] text-ink/30 italic col-span-2">No weapon proficiencies defined. <Link to="/admin/proficiencies" className="text-gold underline">Manage proficiencies</Link></p>}
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="label-text">Saving Throws</label>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].map(stat => (
                      <button
                        key={stat}
                        type="button"
                        onClick={() => {
                          if (savingThrows.includes(stat)) {
                            setSavingThrows(savingThrows.filter(s => s !== stat));
                          } else {
                            setSavingThrows([...savingThrows, stat]);
                          }
                        }}
                        className={`px-2 py-1 rounded text-[10px] font-bold transition-all border ${
                          savingThrows.includes(stat)
                          ? 'bg-gold text-white border-gold'
                          : 'bg-gold/5 text-gold border-gold/10 hover:bg-gold/10'
                        }`}
                      >
                        {stat}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-6 pt-4 border-t border-gold/10">
              {/* Skills Section */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-ink/60">Skills</h3>
                  <div className="flex items-center gap-2">
                    <label className="text-[10px] font-bold uppercase text-ink/40">Choices:</label>
                    <Input 
                      type="number"
                      value={proficiencies.skills.choiceCount}
                      onChange={e => setProficiencies({
                        ...proficiencies,
                        skills: { ...proficiencies.skills, choiceCount: parseInt(e.target.value) || 0 }
                      })}
                      className="w-12 h-6 text-center text-xs bg-background/50 border-gold/10"
                    />
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-gold/60">Skill Options</label>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 p-3 border border-gold/10 bg-background/30 rounded-md min-h-[100px]">
                      {allSkills.map(skill => {
                        const isOption = proficiencies.skills.optionIds?.includes(skill.id);
                        const isFixed = proficiencies.skills.fixedIds?.includes(skill.id);
                        return (
                          <label
                            key={skill.id}
                            className={`flex items-center gap-2 cursor-pointer group ${isFixed ? 'opacity-50 cursor-not-allowed' : ''}`}
                          >
                            <div className={`w-3 h-3 rounded border flex items-center justify-center transition-all ${isOption || isFixed ? 'bg-gold border-gold' : 'border-gold/30 group-hover:border-gold/50'}`}>
                              {(isOption || isFixed) && <Check className="w-2 h-2 text-white" />}
                            </div>
                            <input
                              type="checkbox"
                              className="hidden"
                              disabled={isFixed}
                              checked={isOption || isFixed}
                              onChange={e => {
                                const current = proficiencies.skills.optionIds;
                                const next = e.target.checked ? [...current, skill.id] : current.filter((id: string) => id !== skill.id);
                                setProficiencies({
                                  ...proficiencies,
                                  skills: { ...proficiencies.skills, optionIds: next }
                                });
                              }}
                            />
                            <span className="text-[10px] font-bold text-ink/60 truncate">{skill.name}</span>
                          </label>
                        );
                      })}
                      {allSkills.length === 0 && <p className="text-[10px] text-ink/30 italic col-span-2">No skills defined. <Link to="/compendium/skills" className="text-gold underline">Add skills</Link></p>}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-gold/60">Fixed Skills (Automatic)</label>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 p-3 border border-gold/10 bg-background/30 rounded-md min-h-[100px]">
                      {allSkills.map(skill => {
                        const isFixed = proficiencies.skills.fixedIds?.includes(skill.id);
                        return (
                          <label
                            key={skill.id}
                            className="flex items-center gap-2 cursor-pointer group"
                          >
                            <div className={`w-3 h-3 rounded border flex items-center justify-center transition-all ${isFixed ? 'bg-gold border-gold' : 'border-gold/30 group-hover:border-gold/50'}`}>
                              {isFixed && <Check className="w-2 h-2 text-white" />}
                            </div>
                            <input
                              type="checkbox"
                              className="hidden"
                              checked={isFixed}
                              onChange={e => {
                                const current = proficiencies.skills.fixedIds;
                                const next = e.target.checked ? [...current, skill.id] : current.filter((id: string) => id !== skill.id);
                                
                                // If adding to fixed, remove from options
                                let nextOptions = proficiencies.skills.optionIds;
                                if (e.target.checked) {
                                  nextOptions = nextOptions.filter((id: string) => id !== skill.id);
                                }

                                setProficiencies({
                                  ...proficiencies,
                                  skills: { ...proficiencies.skills, fixedIds: next, optionIds: nextOptions }
                                });
                              }}
                            />
                            <span className="text-[10px] font-bold text-ink/60 truncate">{skill.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              {/* Tools Section */}
              <div className="space-y-4 pt-4 border-t border-gold/10">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-ink/60">Tools</h3>
                  <div className="flex items-center gap-2">
                    <label className="text-[10px] font-bold uppercase text-ink/40">Choices:</label>
                    <Input 
                      type="number"
                      value={proficiencies.tools.choiceCount}
                      onChange={e => setProficiencies({
                        ...proficiencies,
                        tools: { ...proficiencies.tools, choiceCount: parseInt(e.target.value) || 0 }
                      })}
                      className="w-12 h-6 text-center text-xs bg-background/50 border-gold/10"
                    />
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-gold/60">Tool Options</label>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 p-3 border border-gold/10 bg-background/30 rounded-md min-h-[100px]">
                      {allTools.map(tool => {
                        const isOption = proficiencies.tools.optionIds?.includes(tool.id);
                        const isFixed = proficiencies.tools.fixedIds?.includes(tool.id);
                        return (
                          <label
                            key={tool.id}
                            className={`flex items-center gap-2 cursor-pointer group ${isFixed ? 'opacity-50 cursor-not-allowed' : ''}`}
                          >
                            <div className={`w-3 h-3 rounded border flex items-center justify-center transition-all ${isOption || isFixed ? 'bg-gold border-gold' : 'border-gold/30 group-hover:border-gold/50'}`}>
                              {(isOption || isFixed) && <Check className="w-2 h-2 text-white" />}
                            </div>
                            <input
                              type="checkbox"
                              className="hidden"
                              disabled={isFixed}
                              checked={isOption || isFixed}
                              onChange={e => {
                                const current = proficiencies.tools.optionIds;
                                const next = e.target.checked ? [...current, tool.id] : current.filter((id: string) => id !== tool.id);
                                setProficiencies({
                                  ...proficiencies,
                                  tools: { ...proficiencies.tools, optionIds: next }
                                });
                              }}
                            />
                            <span className="text-[10px] font-bold text-ink/60 truncate">{tool.name}</span>
                          </label>
                        );
                      })}
                      {allTools.length === 0 && <p className="text-[10px] text-ink/30 italic col-span-2">No tools defined. <Link to="/compendium/tools" className="text-gold underline">Add tools</Link></p>}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-gold/60">Fixed Tools (Automatic)</label>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 p-3 border border-gold/10 bg-background/30 rounded-md min-h-[100px]">
                      {allTools.map(tool => {
                        const isFixed = proficiencies.tools.fixedIds?.includes(tool.id);
                        return (
                          <label
                            key={tool.id}
                            className="flex items-center gap-2 cursor-pointer group"
                          >
                            <div className={`w-3 h-3 rounded border flex items-center justify-center transition-all ${isFixed ? 'bg-gold border-gold' : 'border-gold/30 group-hover:border-gold/50'}`}>
                              {isFixed && <Check className="w-2 h-2 text-white" />}
                            </div>
                            <input
                              type="checkbox"
                              className="hidden"
                              checked={isFixed}
                              onChange={e => {
                                const current = proficiencies.tools.fixedIds;
                                const next = e.target.checked ? [...current, tool.id] : current.filter((id: string) => id !== tool.id);
                                
                                // If adding to fixed, remove from options
                                let nextOptions = proficiencies.tools.optionIds;
                                if (e.target.checked) {
                                  nextOptions = nextOptions.filter((id: string) => id !== tool.id);
                                }

                                setProficiencies({
                                  ...proficiencies,
                                  tools: { ...proficiencies.tools, fixedIds: next, optionIds: nextOptions }
                                });
                              }}
                            />
                            <span className="text-[10px] font-bold text-ink/60 truncate">{tool.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Spellcasting */}
          <div className="p-4 border border-gold/20 bg-card/50 space-y-4">
            <div className="flex items-center justify-between border-b border-gold/10 pb-2">
              <div className="flex items-center gap-3">
                <h2 className="label-text text-gold">Spellcasting</h2>
                <label className="flex items-center gap-2 cursor-pointer group">
                  <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${spellcasting.hasSpellcasting ? 'bg-gold border-gold' : 'border-gold/30 group-hover:border-gold/50'}`}>
                    {spellcasting.hasSpellcasting && <Check className="w-3 h-3 text-white" />}
                  </div>
                  <input 
                    type="checkbox"
                    className="hidden"
                    checked={spellcasting.hasSpellcasting}
                    onChange={e => setSpellcasting({...spellcasting, hasSpellcasting: e.target.checked})}
                  />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-ink/40">Enable Spellcasting</span>
                </label>
              </div>
              <Wand2 className="w-4 h-4 text-gold/40" />
            </div>

            {spellcasting.hasSpellcasting && (
              <div className="space-y-6 animate-in fade-in slide-in-from-top-2 duration-300">
                <div className="grid sm:grid-cols-4 gap-4">
                  <div className="space-y-1">
                    <label className="label-text">Level Obtained</label>
                    <Input 
                      type="number" 
                      value={spellcasting.level} 
                      onChange={e => setSpellcasting({...spellcasting, level: parseInt(e.target.value) || 1})}
                      className="h-8 text-xs bg-background/50 border-gold/10 focus:border-gold"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="label-text">Ability</label>
                    <select 
                      value={spellcasting.ability} 
                      onChange={e => setSpellcasting({...spellcasting, ability: e.target.value})}
                      className="w-full h-8 px-2 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-xs text-ink"
                    >
                      <option value="INT">Intelligence</option>
                      <option value="WIS">Wisdom</option>
                      <option value="CHA">Charisma</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="label-text">Progression</label>
                    <select 
                      value={spellcasting.progression || 'none'} 
                      onChange={e => setSpellcasting({...spellcasting, progression: e.target.value})}
                      className="w-full h-8 px-2 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-xs text-ink"
                    >
                      <option value="none">None</option>
                      <option value="full">Full Caster</option>
                      <option value="half">Half Caster</option>
                      <option value="third">Third Caster</option>
                      <option value="pact">Pact Magic</option>
                      <option value="artificer">Artificer</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="label-text">Type</label>
                    <select 
                      value={spellcasting.type} 
                      onChange={e => setSpellcasting({...spellcasting, type: e.target.value})}
                      className="w-full h-8 px-2 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-xs text-ink"
                    >
                      <option value="prepared">Prepared</option>
                      <option value="known">Known</option>
                      <option value="spellbook">Spellbook</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="label-text">Spells Known Formula</label>
                    <Input 
                      value={spellcasting.spellsKnownFormula} 
                      onChange={e => setSpellcasting({...spellcasting, spellsKnownFormula: e.target.value})}
                      placeholder="e.g. WIS + Level"
                      className="h-8 text-xs bg-background/50 border-gold/10 focus:border-gold"
                    />
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="label-text">Spellcasting Progression (1st-9th)</label>
                      <div className="flex gap-1">
                        <select 
                          value={spellcasting.progressionId} 
                          onChange={e => setSpellcasting({...spellcasting, progressionId: e.target.value})}
                          className="flex-1 h-8 px-2 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-xs text-ink"
                        >
                          <option value="">None</option>
                          {scalings.map(s => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                          ))}
                        </select>
                        <div className="flex gap-1">
                          {spellcasting.progressionId && (
                            <Link to={`/compendium/spellcasting-scaling/edit/${spellcasting.progressionId}`}>
                              <Button variant="outline" size="sm" className="h-8 w-8 border-gold/10 text-gold hover:bg-gold/5 p-0">
                                <Edit className="w-3 h-3" />
                              </Button>
                            </Link>
                          )}
                          <Link to="/compendium/spellcasting-scaling/new">
                            <Button variant="outline" size="sm" className="h-8 w-8 border-gold/10 text-gold hover:bg-gold/5 p-0">
                              <Plus className="w-3 h-3" />
                            </Button>
                          </Link>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="label-text">Alternative Progression (Pact)</label>
                      <div className="flex gap-1">
                        <select 
                          value={spellcasting.altProgressionId} 
                          onChange={e => setSpellcasting({...spellcasting, altProgressionId: e.target.value})}
                          className="flex-1 h-8 px-2 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-xs text-ink"
                        >
                          <option value="">None</option>
                          {pactScalings.map(s => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                          ))}
                        </select>
                        <div className="flex gap-1">
                          {spellcasting.altProgressionId && (
                            <Link to={`/compendium/pact-scaling/edit/${spellcasting.altProgressionId}`}>
                              <Button variant="outline" size="sm" className="h-8 w-8 border-gold/10 text-gold hover:bg-gold/5 p-0">
                                <Edit className="w-3 h-3" />
                              </Button>
                            </Link>
                          )}
                          <Link to="/compendium/pact-scaling/new">
                            <Button variant="outline" size="sm" className="h-8 w-8 border-gold/10 text-gold hover:bg-gold/5 p-0">
                              <Plus className="w-3 h-3" />
                            </Button>
                          </Link>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="label-text">Spells Known Scaling (Cantrips/Spells)</label>
                    <div className="flex gap-1">
                      <select 
                        value={spellcasting.spellsKnownId} 
                        onChange={e => setSpellcasting({...spellcasting, spellsKnownId: e.target.value})}
                        className="flex-1 h-8 px-2 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-xs text-ink"
                      >
                        <option value="">None</option>
                        {knownScalings.map(s => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                      <div className="flex gap-1">
                        {spellcasting.spellsKnownId && (
                          <Link to={`/compendium/spells-known-scaling/edit/${spellcasting.spellsKnownId}`}>
                            <Button variant="outline" size="sm" className="h-8 w-8 border-gold/10 text-gold hover:bg-gold/5 p-0">
                              <Edit className="w-3 h-3" />
                            </Button>
                          </Link>
                        )}
                        <Link to="/compendium/spells-known-scaling/new">
                          <Button variant="outline" size="sm" className="h-8 w-8 border-gold/10 text-gold hover:bg-gold/5 p-0">
                            <Plus className="w-3 h-3" />
                          </Button>
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="label-text">Spellcasting Description</label>
                  <MarkdownEditor 
                    value={spellcasting.description} 
                    onChange={(val) => setSpellcasting({...spellcasting, description: val})}
                    placeholder="Describe how this class casts spells..."
                    minHeight="120px"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Equipment & Multiclassing */}
          <div className="p-4 border border-gold/20 bg-card/50 space-y-4">
            <h2 className="label-text text-gold border-b border-gold/10 pb-2">Equipment & Multiclassing</h2>
            
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="label-text">Primary Ability (Multiclassing)</label>
                <div className="flex flex-wrap gap-2 pt-1 border border-gold/10 bg-background/50 p-2 rounded-md">
                  {['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].map(stat => (
                    <button
                      key={stat}
                      type="button"
                      onClick={() => {
                        if (primaryAbility.includes(stat)) {
                          setPrimaryAbility(primaryAbility.filter(s => s !== stat));
                        } else {
                          setPrimaryAbility([...primaryAbility, stat]);
                        }
                      }}
                      className={`px-2 py-1 rounded text-[10px] font-bold transition-all border ${
                        primaryAbility.includes(stat)
                        ? 'bg-gold text-white border-gold'
                        : 'bg-gold/5 text-gold border-gold/10 hover:bg-gold/10'
                      }`}
                    >
                      {stat}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <label className="label-text">Foundry Wealth Formula</label>
                <Input 
                  value={wealth} 
                  onChange={e => setWealth(e.target.value)}
                  placeholder="e.g. 3d4*10"
                  className="h-full min-h-[42px] text-sm bg-background/50 border-gold/10 focus:border-gold"
                />
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-1">
                <label className="label-text">Starting Equipment</label>
                <MarkdownEditor 
                  value={startingEquipment} 
                  onChange={setStartingEquipment}
                  minHeight="60px"
                />
              </div>
              <div className="space-y-1">
                <label className="label-text">Multiclassing Requirements</label>
                <MarkdownEditor 
                  value={multiclassing} 
                  onChange={setMulticlassing}
                  minHeight="40px"
                />
              </div>
            </div>
          </div>

          {/* Tags */}
          <div className="p-4 border border-gold/20 bg-card/50 space-y-4">
            <div className="flex items-center justify-between border-b border-gold/10 pb-2">
              <h2 className="label-text text-gold">Tags & Categorization</h2>
              <Link to="/compendium/tags">
                <Button 
                  size="sm"
                  className="h-6 text-xs bg-gold/10 text-gold hover:bg-gold/20 border border-gold/20 gap-1"
                >
                  <Plus className="w-3 h-3" /> Manage Tags
                </Button>
              </Link>
            </div>
            <div className="space-y-6">
              {tagGroups.map(group => {
                const groupTags = allTags.filter(t => t.groupId === group.id);
                if (groupTags.length === 0) return null;
                return (
                  <div key={group.id} className="space-y-2">
                    <label className="label-text text-ink/30">{group.name}</label>
                    <div className="flex flex-wrap gap-2">
                      {groupTags.map(tag => (
                        <button
                          key={tag.id}
                          type="button"
                          onClick={() => {
                            if (tagIds.includes(tag.id)) {
                              setTagIds(tagIds.filter(id => id !== tag.id));
                            } else {
                              setTagIds([...tagIds, tag.id]);
                            }
                          }}
                          className={cn(
                            "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider transition-all border",
                            tagIds.includes(tag.id)
                            ? 'bg-gold/20 border-gold/40 text-gold shadow-sm shadow-gold/10'
                            : 'bg-card text-ink/60 border-gold/10 hover:border-gold/30 hover:text-gold'
                          )}
                        >
                          <div className="flex items-center gap-2">
                            {tag.name}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
              {tagGroups.length === 0 && (
                <p className="muted-text italic">No class tags defined. <Link to="/compendium/tags" className="text-gold hover:underline">Manage tags</Link>.</p>
              )}
            </div>
          </div>

          {/* Progression & Advancements */}
          <div className="p-4 border border-gold/20 bg-card/50 space-y-4">
            <div className="flex items-center justify-between border-b border-gold/10 pb-2">
              <h2 className="label-text text-gold">Class Progression & Advancements</h2>
              <Zap className="w-4 h-4 text-gold/40" />
            </div>
            <div className="space-y-4">
              <p className="text-[10px] text-ink/40 italic">Global progression rules for this class (Ability Score Improvements, Hit Points, etc.)</p>
              <AdvancementManager 
                advancements={advancements}
                onChange={setAdvancements}
                availableFeatures={features}
                availableScalingColumns={scalingColumns}
                availableOptionGroups={allOptionGroups}
                availableOptionItems={allOptionItems}
                defaultHitDie={hitDie}
              />
            </div>
          </div>

          {/* Features */}
          {id && (
            <div className="p-4 border border-gold/20 bg-card/50 space-y-4">
              <div className="flex items-center justify-between border-b border-gold/10 pb-2">
                <h2 className="label-text text-gold">Class Features</h2>
                <Button 
                  size="sm"
                  onClick={() => {
                    setEditingFeature({ 
                      id: doc(collection(db, 'features')).id,
                      name: '', 
                      description: '', 
                      level: 1, 
                      isSubclassFeature: false,
                      type: 'class',
                      configuration: {
                        requiredLevel: 1,
                        requiredIds: [],
                        repeatable: false
                      },
                      properties: ['passive'],
                      usage: {
                        spent: 0,
                        max: ''
                      },
                      quantityColumnId: '',
                      scalingColumnId: '',
                      uniqueOptionGroupIds: [],
                      activities: {},
                      effectsStr: '[]',
                      advancements: []
                    });
                    setIsFeatureModalOpen(true);
                  }}
                  className="h-6 text-xs bg-gold/10 text-gold hover:bg-gold/20 border border-gold/20 gap-1"
                >
                  <Plus className="w-3 h-3" /> Add Feature
                </Button>
              </div>
              <div className="divide-y divide-gold/10">
                {features.map((feature) => (
                  <div key={feature.id} className="py-2 flex items-center justify-between group">
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-mono text-gold/60 w-4">L{feature.level}</span>
                      <span className="text-sm font-bold text-ink">{feature.name}</span>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button variant="ghost" size="sm" onClick={() => { 
                        setEditingFeature({
                          ...feature,
                          type: feature.type || 'class',
                          configuration: feature.configuration || {
                            requiredLevel: feature.level || 1,
                            requiredIds: [],
                            repeatable: false
                          },
                          properties: feature.properties || ['passive'],
                          usage: feature.usage || {
                            spent: 0,
                            max: ''
                          },
                          activities: feature.automation?.activities || {},
                          effectsStr: feature.automation?.effects ? JSON.stringify(feature.automation.effects, null, 2) : '[]',
                          advancements: feature.advancements || []
                        }); 
                        setIsFeatureModalOpen(true); 
                      }} className="h-6 w-6 p-0 text-gold"><Edit className="w-3 h-3" /></Button>
                      <Button variant="ghost" size="sm" onClick={() => handleDeleteFeature(feature.id)} className="h-6 w-6 p-0 text-blood"><Trash2 className="w-3 h-3" /></Button>
                    </div>
                  </div>
                ))}
                {features.length === 0 && <p className="py-4 text-center muted-text italic">No features added.</p>}
              </div>
            </div>
          )}

          {/* Danger Zone */}
          <div className="p-4 border border-blood/20 bg-blood/5 space-y-4 rounded-xl">
            <h2 className="label-text text-blood border-b border-blood/10 pb-2 flex items-center gap-2 uppercase tracking-tighter">
              <Trash2 className="w-4 h-4" />
              Danger Zone
            </h2>
            <Button 
              variant="ghost" 
              size="sm"
              className="w-full text-blood hover:text-white hover:bg-blood border border-blood/20 gap-2 text-[10px] font-black uppercase tracking-widest transition-all"
              onClick={async () => {
                if (id && confirm('Are you sure you want to delete this class? This cannot be undone.')) {
                  try {
                    await deleteDoc(doc(db, 'classes', id));
                    toast.success('Class deleted');
                    navigate('/compendium/classes');
                  } catch (error) {
                    toast.error('Failed to delete class');
                  }
                }
              }}
            >
              Delete Class
            </Button>
          </div>
        </div>

        {/* Sidebar */}
        <div className="xl:col-span-1 space-y-6">
          <div className="p-4 border border-gold/20 bg-card/50 space-y-4 rounded-xl">
            <div className="flex items-center justify-between border-b border-gold/10 pb-2">
              <h2 className="label-text text-gold uppercase tracking-tighter">Class Columns</h2>
              <Link to={`/compendium/scaling/new?parentId=${id}&parentType=class`}>
                <Button 
                  size="sm" 
                  className="h-6 text-[10px] bg-gold/10 text-gold hover:bg-gold/20 border border-gold/20"
                >
                  <Plus className="w-3 h-3 mr-1" /> Add
                </Button>
              </Link>
            </div>
            
            <div className="space-y-4">
              {scalingColumns.map(col => (
                <div key={col.id} className="p-3 bg-gold/5 border border-gold/10 rounded space-y-2 group relative">
                  <div className="flex items-center justify-between">
                    <Input 
                      value={col.name} 
                      onChange={e => updateDoc(doc(db, "scalingColumns", col.id), { name: e.target.value })}
                      className="h-6 text-[11px] font-bold bg-transparent border-none p-0 focus-visible:ring-0"
                    />
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Link to={`/compendium/scaling/edit/${col.id}?parentId=${id}&parentType=class`}>
                        <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-gold">
                          <Edit className="w-3 h-3" />
                        </Button>
                      </Link>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => handleDeleteScaling(col.id)}
                        className="h-5 w-5 p-0 text-blood"
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-[9px] uppercase font-black tracking-widest text-gold/50">Breakpoints</p>
                    {getScalingBreakpoints(col.values || {}).length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {getScalingBreakpoints(col.values || {}).map(([level, value]) => (
                          <div key={level} className="rounded border border-gold/10 bg-background/60 px-2 py-1 min-w-[3.5rem]">
                            <p className="text-[8px] text-ink/30 font-mono">L{level}</p>
                            <p className="text-[10px] font-black text-ink">{String(value)}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[10px] text-ink/30 italic">No saved matrix values yet.</p>
                    )}
                  </div>

                  <div className="pt-1">
                    <Link to={`/compendium/scaling/edit/${col.id}?parentId=${id}&parentType=class`}>
                      <Button variant="ghost" size="sm" className="w-full h-6 text-[9px] font-bold uppercase tracking-widest text-gold/60 hover:text-gold hover:bg-gold/5 border border-gold/10">
                        Open Full Matrix Editor
                      </Button>
                    </Link>
                  </div>
                </div>
              ))}
              {scalingColumns.length === 0 && (
                <p className="text-[10px] text-ink/30 text-center italic py-4">No scaling columns defined.</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Feature Modal */}
      <Dialog open={isFeatureModalOpen} onOpenChange={(open) => {
        setIsFeatureModalOpen(open);
        if (open) setFeatureTab('description');
      }}>
        <DialogContent className="max-w-[95vw] lg:max-w-6xl bg-card border-gold/20 p-0 overflow-hidden flex flex-col h-[90vh]">
          {editingFeature && (
            <>
              <div className="p-6 pb-0 shrink-0 border-b border-gold/10">
                <div className="flex gap-6 items-start">
                  <div className="w-32 h-32 bg-background rounded-lg border border-gold/20 flex flex-col items-center justify-center shrink-0">
                    <div className="label-text opacity-40">Icon</div>
                  </div>
                  <div className="flex-1 space-y-2 pt-2">
                    <Input 
                      value={editingFeature.name || ''} 
                      onChange={e => setEditingFeature({...editingFeature, name: e.target.value})}
                      className="h-14 font-serif text-4xl text-center bg-transparent border-none focus-visible:ring-1 focus-visible:ring-gold/50"
                      placeholder="Feature Name"
                      required
                    />
                    <Input 
                      value={editingFeature.configuration?.requiredLevel ? `Level ${editingFeature.configuration.requiredLevel}` : ''}
                      readOnly
                      placeholder="Requirements"
                      className="h-8 bg-transparent border-none text-center text-xs text-ink/60"
                    />
                  </div>
                </div>

                <div className="flex mt-6 relative">
                  <div className="absolute left-[50%] ml-[-12px] bottom-[-10px] w-6 h-6 bg-card flex items-center justify-center text-gold/40 text-sm rounded-full z-10 border border-gold/10">
                    <Zap className="w-3 h-3" />
                  </div>
                  <Tabs value={featureTab} onValueChange={setFeatureTab} className="w-full bg-transparent border-none">
                    <TabsList className="bg-transparent border-none h-auto p-0 flex justify-between w-full">
                      {['description', 'details', 'activities', 'effects', 'advancement'].map(tab => (
                        <TabsTrigger 
                          key={tab} 
                          value={tab} 
                          className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-gold data-[state=active]:border-b-2 data-[state=active]:border-gold rounded-none h-10 px-0 label-text transition-all opacity-60 data-[state=active]:opacity-100 flex-1 hover:text-gold/80"
                        >
                          {tab}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                </div>
              </div>

              <ScrollArea className="flex-1 p-6">
                {featureTab === 'description' && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase text-ink/60 font-bold">Level</label>
                        <Input 
                          type="number"
                          min="1"
                          max="20"
                          value={editingFeature.level || 1} 
                          onChange={e => setEditingFeature({...editingFeature, level: parseInt(e.target.value)})}
                          className="h-8 text-xs bg-background/50 border-gold/10 focus:border-gold"
                        />
                      </div>
                    </div>
                    <MarkdownEditor 
                      value={editingFeature.description || ''} 
                      onChange={(val) => setEditingFeature({...editingFeature, description: val})}
                      minHeight="400px"
                      label="Description"
                    />
                  </div>
                )}

                {featureTab === 'details' && (
                  <div className="space-y-6">
                    <div className="space-y-4 pt-2">
                       <h4 className="text-[10px] text-gold uppercase tracking-widest font-black">Feature Details</h4>
                       <div className="p-4 border border-gold/10 bg-gold/5 rounded-md space-y-4">
                          <div className="grid gap-4">
                            <div className="space-y-1.5">
                              <label className="text-[10px] uppercase text-ink/80 font-bold">Type</label>
                              <Select 
                                value={editingFeature.type || 'class'} 
                                onValueChange={val => setEditingFeature({...editingFeature, type: val})}
                              >
                                <SelectTrigger className="w-full h-8 px-2 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-sm text-ink">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {FEATURE_TYPES.map(t => (
                                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-[10px] uppercase text-ink/80 font-bold">Required Level</label>
                              <Input 
                                type="number"
                                value={editingFeature.configuration?.requiredLevel || editingFeature.level || 1}
                                onChange={e => setEditingFeature({
                                  ...editingFeature, 
                                  configuration: { ...editingFeature.configuration, requiredLevel: parseInt(e.target.value) }
                                })}
                                className="h-8 text-xs bg-background/50 border-gold/10 focus:border-gold"
                              />
                              <p className="text-[10px] text-ink/40">Character or class level required to select this feature when levelling up.</p>
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-[10px] uppercase text-ink/80 font-bold">Required Items</label>
                              <Input 
                                value={editingFeature.configuration?.requiredIds?.join(', ') || ''} 
                                onChange={e => setEditingFeature({
                                  ...editingFeature, 
                                  configuration: { 
                                    ...editingFeature.configuration, 
                                    requiredIds: e.target.value.split(',').map(s => s.trim()).filter(Boolean) 
                                  }
                                })}
                                placeholder="item-identifier-1, item-identifier-2"
                                className="h-8 text-xs bg-background/50 border-gold/10 focus:border-gold"
                              />
                              <p className="text-[10px] text-ink/40">Identifiers for items that the character must have before selecting this item.</p>
                            </div>
                            
                            <div className="flex items-center justify-between pt-2">
                              <label htmlFor="feat-repeatable" className="text-[11px] text-ink/80 font-black cursor-pointer">Repeatable</label>
                              <Checkbox 
                                id="feat-repeatable"
                                className="border-gold/30 data-[state=checked]:bg-gold data-[state=checked]:text-white"
                                checked={editingFeature.configuration?.repeatable || false}
                                onCheckedChange={checked => setEditingFeature({
                                  ...editingFeature, 
                                  configuration: { ...editingFeature.configuration, repeatable: !!checked }
                                })}
                              />
                            </div>
                            <p className="text-[10px] text-ink/40 mt-[-8px]">This feature can be chosen more than once.</p>

                            <div className="space-y-2 pt-2">
                               <label className="text-[11px] text-ink/80 font-black">Feature Properties</label>
                               <div className="flex items-center gap-6">
                                  <div className="flex items-center gap-2">
                                    <Checkbox 
                                      id="feat-magical"
                                      className="border-gold/30 data-[state=checked]:bg-gold data-[state=checked]:text-white"
                                      checked={editingFeature.properties?.includes('magical') || false}
                                      onCheckedChange={checked => {
                                        const props = editingFeature.properties || [];
                                        if (checked) {
                                          setEditingFeature({...editingFeature, properties: [...props, 'magical']});
                                        } else {
                                          setEditingFeature({...editingFeature, properties: props.filter(p => p !== 'magical')});
                                        }
                                      }}
                                    />
                                    <label htmlFor="feat-magical" className="text-[10px] text-ink/60 font-medium cursor-pointer">Magical</label>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Checkbox 
                                      id="feat-passive"
                                      className="border-gold/30 data-[state=checked]:bg-gold data-[state=checked]:text-white"
                                      checked={editingFeature.properties?.includes('passive') || false}
                                      onCheckedChange={checked => {
                                        const props = editingFeature.properties || [];
                                        if (checked) {
                                          setEditingFeature({...editingFeature, properties: [...props, 'passive']});
                                        } else {
                                          setEditingFeature({...editingFeature, properties: props.filter(p => p !== 'passive')});
                                        }
                                      }}
                                    />
                                    <label htmlFor="feat-passive" className="text-[10px] text-ink/60 font-medium cursor-pointer">Passive Trait</label>
                                  </div>
                               </div>
                            </div>
                          </div>
                       </div>
                    </div>

                    <div className="space-y-4 pt-2">
                       <h4 className="text-[10px] text-gold uppercase tracking-widest font-black">Usage</h4>
                       <div className="p-4 border border-gold/10 bg-gold/5 rounded-md space-y-4 flex items-center justify-between">
                          <label className="text-[11px] text-ink/80 font-black">Limited Uses</label>
                          <div className="flex items-center gap-4">
                             <div className="space-y-1">
                              <label className="text-[9px] uppercase text-ink/60 font-black">Spent</label>
                              <Input 
                                type="number"
                                value={editingFeature.usage?.spent || 0}
                                onChange={e => setEditingFeature({
                                  ...editingFeature, 
                                  usage: { ...editingFeature.usage, spent: parseInt(e.target.value) || 0 }
                                })}
                                className="h-8 text-center text-xs bg-background/50 border-gold/10 focus:border-gold w-20"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[9px] uppercase text-ink/60 font-black">Max</label>
                              <Input 
                                value={editingFeature.usage?.max || ''}
                                onChange={e => setEditingFeature({
                                  ...editingFeature, 
                                  usage: { ...editingFeature.usage, max: e.target.value }
                                })}
                                placeholder="Value or formula"
                                className="h-8 text-center text-xs bg-background/50 border-gold/10 focus:border-gold w-32"
                              />
                            </div>
                          </div>
                       </div>
                    </div>

                    <div className="space-y-4 pt-2">
                       <h4 className="text-[10px] text-gold uppercase tracking-widest font-black">Dauligor Extensions</h4>
                       <div className="p-4 border border-gold/10 bg-gold/5 rounded-md space-y-4">
                         <div className="flex items-center gap-2 pb-2 border-b border-gold/10">
                          <input 
                            type="checkbox" 
                            id="isSubclassFeature"
                            checked={editingFeature?.isSubclassFeature || false}
                            onChange={e => setEditingFeature({...editingFeature, isSubclassFeature: e.target.checked})}
                            className="w-4 h-4 rounded border-gold/20 text-gold focus:ring-gold"
                          />
                          <label htmlFor="isSubclassFeature" className="label-text text-ink/60">
                            Subclass Choice Point
                          </label>
                         </div>
                       </div>
                    </div>
                  </div>
                )}

                {featureTab === 'activities' && (
                  <div className="pt-2">
                    <ActivityEditor 
                      activities={editingFeature.activities || {}}
                      onChange={(acts) => setEditingFeature({ ...editingFeature, activities: acts })}
                    />
                  </div>
                )}

                {featureTab === 'effects' && (
                  <div className="space-y-4 pt-2">
                    <h4 className="label-text text-gold uppercase tracking-widest text-[10px]">Effects (JSON Array)</h4>
                    <textarea
                      value={editingFeature.effectsStr || ''}
                      onChange={e => setEditingFeature({ ...editingFeature, effectsStr: e.target.value })}
                      className="w-full h-64 p-4 text-xs font-mono bg-background/50 border border-gold/10 rounded focus:border-gold outline-none"
                      placeholder='[ { "name": "EffectName" } ]'
                    />
                  </div>
                )}

                {featureTab === 'advancement' && (
                  <div className="pt-4 space-y-4">
                    <div className="flex items-center justify-between border-b border-gold/10 pb-2">
                       <h4 className="text-[10px] text-gold uppercase tracking-widest font-black">Linked Advancements</h4>
                       <p className="text-[10px] text-ink/40">Link this feature to progression rules defined on the class.</p>
                    </div>
                    <AdvancementManager 
                      advancements={[]} // Not used for management here
                      onChange={() => {}} // Not used for management here
                      availableFeatures={features}
                      availableScalingColumns={scalingColumns}
                      availableOptionGroups={allOptionGroups}
                      isInsideFeature={true}
                      featureId={editingFeature.id}
                      rootAdvancements={advancements}
                      defaultLevel={editingFeature.level}
                      onLinkAdvancement={(advId, featId) => {
                        const nextAdvs = advancements.map(a => {
                          if (a._id === advId) {
                            const next = { ...a, featureId: featId };
                            if (featId) next.level = editingFeature.level || 1;
                            return next;
                          }
                          return a;
                        });
                        setAdvancements(nextAdvs);
                      }}
                    />
                  </div>
                )}
              </ScrollArea>

              <div className="p-4 border-t border-gold/10 bg-background flex justify-end shrink-0 gap-3">
                 <Button type="button" variant="ghost" onClick={() => setIsFeatureModalOpen(false)} className="label-text opacity-70 hover:opacity-100">Cancel</Button>
                 <Button onClick={handleSaveFeature} className="bg-primary hover:bg-primary/90 text-primary-foreground gap-2 px-8 label-text">
                   Save Feature
                 </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      {/* Unique Options Management Dialog */}
      <Dialog open={!!managingGroupId} onOpenChange={(open) => {
        if (!open) {
          setManagingGroupId(null);
          setManagingGroupSearch('');
        }
      }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto bg-card border-gold/30">
          <DialogHeader>
            <DialogTitle className="text-gold font-serif uppercase tracking-tight">
              Manage {allOptionGroups.find(g => g.id === managingGroupId)?.name} Options
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <p className="text-xs text-ink/60 italic">
              Uncheck options that are NOT available to the {name || 'this'} class.
            </p>
            
            <Input 
              placeholder="Search options..."
              value={managingGroupSearch}
              onChange={e => setManagingGroupSearch(e.target.value)}
              className="h-8 text-xs bg-background/50 border-gold/10"
            />
            
            <div className="grid sm:grid-cols-2 gap-2">
              {allOptionItems
                .filter(item => item.groupId === managingGroupId)
                .filter(item => !managingGroupSearch || item.name.toLowerCase().includes(managingGroupSearch.toLowerCase()))
                .map(item => {
                  const isExcluded = (excludedOptionIds[managingGroupId!] || []).includes(item.id);
                  const isClassRestricted = item.classIds && Array.isArray(item.classIds) && item.classIds.length > 0 && !item.classIds.includes(id);
                  
                  return (
                    <label 
                      key={item.id} 
                      className={`flex items-start gap-3 p-2 border transition-all cursor-pointer ${
                        isExcluded || isClassRestricted
                        ? 'bg-background/20 border-gold/5 opacity-50 text-ink/50'
                        : 'bg-gold/10 border-gold/30 text-ink'
                      }`}
                    >
                      <input 
                        type="checkbox"
                        checked={!isExcluded && !isClassRestricted}
                        disabled={isClassRestricted}
                        onChange={e => {
                          const currentExcluded = excludedOptionIds[managingGroupId!] || [];
                          let newExcluded;
                          if (e.target.checked) {
                            newExcluded = currentExcluded.filter(eid => eid !== item.id);
                          } else {
                            newExcluded = [...currentExcluded, item.id];
                          }
                          setExcludedOptionIds({
                            ...excludedOptionIds,
                            [managingGroupId!]: newExcluded
                          });
                        }}
                        className="mt-1 w-3 h-3 rounded border-gold/20 text-gold focus:ring-gold"
                      />
                      <div className="space-y-0.5">
                        <span className="text-xs font-bold text-ink block">{item.name}</span>
                        {item.levelPrerequisite > 0 && (
                          <span className="text-[10px] text-gold/60 font-mono block">Level {item.levelPrerequisite}+</span>
                        )}
                        {isClassRestricted && (
                          <span className="text-[9px] text-blood font-bold uppercase block">Restricted by Item</span>
                        )}
                      </div>
                    </label>
                  );
                })}
            </div>
          </div>
          
          <DialogFooter>
            <Button onClick={() => setManagingGroupId(null)} className="bg-gold hover:bg-gold/90 text-white">
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
