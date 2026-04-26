import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom';
import { Checkbox } from '../../components/ui/checkbox';
import { 
  collection, 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where, 
  onSnapshot,
  orderBy,
  serverTimestamp
} from 'firebase/firestore';
import ActivityEditor from '../../components/compendium/ActivityEditor';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { 
  ChevronLeft, 
  Save, 
  Plus, 
  Trash2, 
  Edit, 
  Search,
  Check,
  Info,
  Zap,
  AlertTriangle,
  ChevronDown
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import MarkdownEditor from '../../components/MarkdownEditor';
import { ImageUpload } from '../../components/ui/ImageUpload';
import { slugify } from '../../lib/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { ScrollArea } from '../../components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import AdvancementManager, { Advancement } from '../../components/compendium/AdvancementManager';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../../components/ui/dialog";

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

export default function SubclassEditor() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const classId = searchParams.get('classId');
  const navigate = useNavigate();

  // Basic Info
  const [name, setName] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [description, setDescription] = useState('');
  const [lore, setLore] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [tagIds, setTagIds] = useState<string[]>([]);

  // Spellcasting
  const [spellcasting, setSpellcasting] = useState({
    hasSpellcasting: false,
    description: '',
    level: 3,
    ability: 'INT',
    type: 'prepared',
    progression: 'none',
    progressionId: '',
    altProgressionId: '',
    spellsKnownId: '',
    spellsKnownFormula: '',
    isRitualCaster: false
  });

  // Unique Options
  const [excludedOptionIds, setExcludedOptionIds] = useState<Record<string, string[]>>({});

  // Features & Columns
  const [features, setFeatures] = useState<any[]>([]);
  const [parentFeatures, setParentFeatures] = useState<any[]>([]);
  const [scalingColumns, setScalingColumns] = useState<any[]>([]);
  const [advancements, setAdvancements] = useState<Advancement[]>([]);
  const [parentScalingColumns, setParentScalingColumns] = useState<any[]>([]);

  // Metadata
  const [sources, setSources] = useState<any[]>([]);
  const [allTags, setAllTags] = useState<any[]>([]);
  const [tagGroups, setTagGroups] = useState<any[]>([]);
  const [allOptionGroups, setAllOptionGroups] = useState<any[]>([]);
  const [allOptionItems, setAllOptionItems] = useState<any[]>([]);
  const [progressionScalings, setProgressionScalings] = useState<any[]>([]);
  const [knownScalings, setKnownScalings] = useState<any[]>([]);
  const [parentClass, setParentClass] = useState<any>(null);

  // UI State
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('basic');
  const [isFeatureModalOpen, setIsFeatureModalOpen] = useState(false);
  const [editingFeature, setEditingFeature] = useState<any>(null);
  const [featureTab, setFeatureTab] = useState('description');
  const [managingGroupId, setManagingGroupId] = useState<string | null>(null);
  const [managingGroupSearch, setManagingGroupSearch] = useState('');

  useEffect(() => {
    const unsubSources = onSnapshot(collection(db, 'sources'), (snap) => {
      setSources(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    const unsubTagGroups = onSnapshot(query(collection(db, 'tagGroups'), where('classifications', 'array-contains', 'subclass')), (snap) => {
      setTagGroups(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    const unsubTags = onSnapshot(collection(db, 'tags'), (snap) => {
      setAllTags(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    const unsubOptionGroups = onSnapshot(collection(db, 'uniqueOptionGroups'), (snap) => {
      setAllOptionGroups(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    const unsubOptionItems = onSnapshot(collection(db, 'uniqueOptionItems'), (snap) => {
      setAllOptionItems(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    const unsubProgression = onSnapshot(collection(db, 'spellcastingScalings'), (snap) => {
      setProgressionScalings(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    const unsubKnown = onSnapshot(collection(db, 'spellsKnownScalings'), (snap) => {
      setKnownScalings(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    return () => {
      unsubSources();
      unsubTagGroups();
      unsubTags();
      unsubOptionGroups();
      unsubOptionItems();
      unsubProgression();
      unsubKnown();
    };
  }, []);

  useEffect(() => {
    async function fetchData() {
      if (!id) {
        setLoading(false);
        if (classId) {
          const classDoc = await getDoc(doc(db, 'classes', classId));
          if (classDoc.exists()) {
            setParentClass({ id: classDoc.id, ...classDoc.data() });
          }
        }
        return;
      }

      try {
        const subclassDoc = await getDoc(doc(db, 'subclasses', id));
        if (subclassDoc.exists()) {
          const data = subclassDoc.data();
          setName(data.name || '');
          setSourceId(data.sourceId || '');
          setDescription(data.description || '');
          setLore(data.lore || '');
          setImageUrl(data.imageUrl || '');
          setTagIds(data.tagIds || []);
          setAdvancements(data.advancements || []);
          setSpellcasting(data.spellcasting || {
            hasSpellcasting: false,
            description: '',
            level: 3,
            ability: 'INT',
            type: 'prepared',
            progression: 'none',
            progressionId: '',
            altProgressionId: '',
            spellsKnownId: '',
            spellsKnownFormula: '',
            isRitualCaster: false
          });
          setExcludedOptionIds(data.excludedOptionIds || {});

          const actualClassId = data.classId || classId;
          if (actualClassId) {
            const classDoc = await getDoc(doc(db, 'classes', actualClassId));
            if (classDoc.exists()) {
              setParentClass({ id: classDoc.id, ...classDoc.data() });
              
              // Fetch parent features (placeholders)
              const pfSnap = await getDoc(doc(db, 'classes', actualClassId)); // Already have it, but let's use a query for real-time if needed
              // Actually, let's just use a query for parent features
            }
          }
        }

        let unsubParentFeatures: (() => void) | undefined;
        let unsubParentColumns: (() => void) | undefined;
        const actualClassId = id ? (await getDoc(doc(db, 'subclasses', id))).data()?.classId : classId;
        if (actualClassId) {
          unsubParentFeatures = onSnapshot(
            query(collection(db, 'features'), where('parentId', '==', actualClassId), where('parentType', '==', 'class'), where('isSubclassFeature', '==', true), orderBy('level', 'asc')),
            (snap) => {
              setParentFeatures(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
            }
          );
          unsubParentColumns = onSnapshot(
            query(collection(db, 'scalingColumns'), where('parentId', '==', actualClassId), where('parentType', '==', 'class')),
            (snap) => {
              setParentScalingColumns(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
            }
          );
        }

        // Features
        const unsubFeatures = onSnapshot(
          query(collection(db, 'features'), where('parentId', '==', id), where('parentType', '==', 'subclass'), orderBy('level', 'asc')),
          (snap) => {
            setFeatures(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
          }
        );

        // Columns
        const unsubColumns = onSnapshot(
          query(collection(db, 'scalingColumns'), where('parentId', '==', id), where('parentType', '==', 'subclass')),
          (snap) => {
            setScalingColumns(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
          }
        );

        setLoading(false);
        return () => {
          unsubFeatures();
          unsubColumns();
          if (unsubParentFeatures) unsubParentFeatures();
          if (unsubParentColumns) unsubParentColumns();
        };
      } catch (error) {
        console.error("Error fetching subclass:", error);
        toast.error("Failed to load subclass");
        setLoading(false);
      }
    }

    fetchData();
  }, [id, classId]);

  const handleSave = async () => {
    if (!name) {
      toast.error("Subclass name is required");
      return;
    }
    if (!sourceId) {
      toast.error("Source is required");
      return;
    }
    if (!parentClass && !classId) {
      toast.error("Parent class is missing");
      return;
    }

    const normalizedSpellcasting = spellcasting && typeof spellcasting === 'object'
      ? {
          ...spellcasting,
          ability: String(spellcasting.ability || '').toUpperCase(),
          type: String(spellcasting.type || 'prepared').toLowerCase(),
          level: Number(spellcasting.level || 1) || 1
        }
      : spellcasting;

    const subclassData: any = {
      name,
      identifier: slugify(name),
      classIdentifier: parentClass?.identifier || slugify(parentClass?.name || ''),
      classId: parentClass?.id || classId,
      sourceId,
      description,
      lore,
      imageUrl,
      tagIds,
      spellcasting: normalizedSpellcasting,
      excludedOptionIds,
      advancements,
      updatedAt: serverTimestamp(),
    };

    if (!id) {
      subclassData.createdAt = serverTimestamp();
    }

    try {
      if (id) {
        await updateDoc(doc(db, 'subclasses', id), subclassData);
        toast.success("Subclass updated");
      } else {
        const newRef = doc(collection(db, 'subclasses'));
        await setDoc(newRef, subclassData);
        toast.success("Subclass created");
        navigate(`/compendium/subclasses/edit/${newRef.id}`);
      }
    } catch (error) {
      console.error("Error saving subclass:", error);
      toast.error("Failed to save subclass");
    }
  };

  const handleSaveFeature = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) {
      toast.error("Save the subclass first before adding features");
      return;
    }

    try {
      let parsedEffects = [];
      try {
        if (editingFeature.effectsStr) parsedEffects = JSON.parse(editingFeature.effectsStr);
      } catch (err) {
        toast.error("Invalid JSON in Effects");
        return;
      }

      const featureData: any = {
        ...editingFeature,
        parentId: id,
        parentType: 'subclass',
        level: Number(editingFeature.level || editingFeature.configuration?.requiredLevel || 1),
        name: String(editingFeature.name || '').trim(),
        quantityColumnId: editingFeature.quantityColumnId || '',
        scalingColumnId: editingFeature.scalingColumnId || '',
        automation: {
          activities: Array.isArray(editingFeature.activities) 
            ? editingFeature.activities 
            : Object.values(editingFeature.activities || {}),
          effects: parsedEffects
        },
        updatedAt: serverTimestamp()
      };
      
      delete featureData.activitiesStr;
      delete featureData.effectsStr;
      delete featureData.activities;

      if (editingFeature.id) {
        await setDoc(doc(db, 'features', editingFeature.id), {
          ...featureData,
          createdAt: editingFeature.createdAt || serverTimestamp()
        }, { merge: true });
        toast.success("Feature updated");
      } else {
        const newRef = doc(collection(db, 'features'));
        await setDoc(newRef, {
          ...featureData,
          parentId: id,
          parentType: 'subclass',
          createdAt: serverTimestamp()
        });
        toast.success("Feature added");
      }
      setIsFeatureModalOpen(false);
    } catch (error) {
      console.error("Error saving subclass feature:", error);
      toast.error("Failed to save feature");
      handleFirestoreError(error, editingFeature?.id ? OperationType.UPDATE : OperationType.CREATE, `features/${editingFeature?.id || '(new)'}`);
    }
  };

  const handleDeleteFeature = async (featureId: string) => {
    if (confirm("Delete this feature?")) {
      try {
        await deleteDoc(doc(db, 'features', featureId));
        toast.success("Feature deleted");
      } catch (error) {
        toast.error("Failed to delete feature");
      }
    }
  };

  const handleDeleteScaling = async (colId: string) => {
    if (confirm("Delete this column?")) {
      try {
        await deleteDoc(doc(db, 'scalingColumns', colId));
        toast.success("Column deleted");
      } catch (error) {
        toast.error("Failed to delete column");
      }
    }
  };

  if (loading) return <div className="p-8 text-center text-gold animate-pulse">Loading Subclass Editor...</div>;

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-6 pb-24">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link to={parentClass ? `/compendium/classes/edit/${parentClass.id}` : '/compendium/classes'}>
            <Button variant="ghost" size="sm" className="text-gold hover:bg-gold/10">
              <ChevronLeft className="w-4 h-4 mr-1" /> Back to {parentClass?.name || 'Class'}
            </Button>
          </Link>
          <div>
            <h1 className="h2-title text-gold uppercase tracking-tight">
              {id ? 'Edit Subclass' : 'New Subclass'}
            </h1>
            {parentClass && (
              <p className="text-xs text-ink/40 font-mono uppercase">For {parentClass.name}</p>
            )}
          </div>
        </div>
        <Button onClick={handleSave} className="bg-gold hover:bg-gold/90 text-white gap-2 shadow-lg shadow-gold/20">
          <Save className="w-4 h-4" /> Save Subclass
        </Button>
      </div>

      <div className="grid lg:grid-cols-4 gap-6">
        <div className="lg:col-span-3">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="w-full h-auto flex flex-col gap-1 bg-transparent border-none p-0 mb-6">
              <div className="w-full grid grid-cols-2 xl:grid-cols-6 gap-1 bg-card/50 border border-gold/10 p-1 rounded-md">
                <TabsTrigger value="basic">Basic Info</TabsTrigger>
                <TabsTrigger value="features" disabled={!id}>Features</TabsTrigger>
                <TabsTrigger value="spellcasting">Spellcasting</TabsTrigger>
                <TabsTrigger value="progression">Progression</TabsTrigger>
                <TabsTrigger value="tags">Tags</TabsTrigger>
                <TabsTrigger value="danger" disabled={!id}>Danger Zone</TabsTrigger>
              </div>
            </TabsList>

            <TabsContent value="basic" className="space-y-6 mt-0">
              {/* Basic Info */}
              <div className="p-4 border border-gold/20 bg-card/50 space-y-4">
            <h2 className="label-text text-gold border-b border-gold/10 pb-2">Basic Information</h2>
            <div className="flex flex-col md:flex-row gap-6">
              <div className="w-full md:w-1/3">
                <label className="label-text mb-2 block text-xs uppercase tracking-widest text-gold/60">Subclass Art / Icon</label>
                <ImageUpload 
                  currentImageUrl={imageUrl}
                  storagePath={`images/subclasses/${id || 'new'}/`}
                  onUpload={setImageUrl}
                />
              </div>
              <div className="flex-1 space-y-4 h-fit">
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="label-text">Subclass Name</label>
                    <Input 
                      value={name} 
                      onChange={e => setName(e.target.value)} 
                      placeholder="e.g. Battle Master" 
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
            </TabsContent>

            <TabsContent value="spellcasting" className="space-y-6 mt-0">
          {/* Spellcasting */}
          <div className="p-4 border border-gold/20 bg-card/50 space-y-4">
            <div className="section-header">
              <h2 className="label-text text-gold">Spellcasting</h2>
              <div className="flex items-center gap-2">
                <input 
                  type="checkbox" 
                  id="hasSpellcasting"
                  checked={spellcasting.hasSpellcasting}
                  onChange={e => setSpellcasting({...spellcasting, hasSpellcasting: e.target.checked})}
                  className="w-4 h-4 rounded border-gold/20 text-gold focus:ring-gold"
                />
                <label htmlFor="hasSpellcasting" className="label-text text-ink/60">Enable Spellcasting</label>
              </div>
            </div>

            {spellcasting.hasSpellcasting && (
              <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                <div className="grid sm:grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <label className="label-text">Level Gained</label>
                    <Input 
                      type="number"
                      value={spellcasting.level}
                      onChange={e => setSpellcasting({...spellcasting, level: parseInt(e.target.value)})}
                      className="h-8 text-sm bg-background/50 border-gold/10 focus:border-gold"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="label-text">Ability</label>
                    <select 
                      value={spellcasting.ability}
                      onChange={e => setSpellcasting({...spellcasting, ability: e.target.value})}
                      className="w-full h-8 px-2 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-sm text-ink"
                    >
                      {['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].map(a => (
                        <option key={a} value={a}>{a}</option>
                      ))}
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
                      className="w-full h-8 px-2 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-sm text-ink"
                    >
                      <option value="prepared">Prepared</option>
                      <option value="known">Known</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-2 pt-6">
                    <div className="flex items-center gap-2 cursor-pointer group hover:bg-gold/5 p-1 -ml-1 rounded transition-colors" onClick={() => setSpellcasting({...spellcasting, isRitualCaster: !spellcasting.isRitualCaster})}>
                      <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${spellcasting.isRitualCaster ? 'bg-gold border-gold' : 'border-gold/30 group-hover:border-gold/50'}`}>
                        {spellcasting.isRitualCaster && <Check className="w-3 h-3 text-white" />}
                      </div>
                      <span className="text-[10px] font-bold uppercase tracking-widest text-gold select-none">Ritual Caster</span>
                    </div>
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="label-text">Slot Progression</label>
                    <div className="flex gap-1">
                      <select 
                        value={spellcasting.progressionId} 
                        onChange={e => setSpellcasting({...spellcasting, progressionId: e.target.value})}
                        className="flex-1 h-8 px-2 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-xs text-ink"
                      >
                        <option value="">None</option>
                        {progressionScalings.map(s => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                      <Link to="/compendium/spellcasting-scaling/new">
                        <Button variant="outline" size="sm" className="h-8 w-8 border-gold/10 text-gold hover:bg-gold/5 p-0">
                          <Plus className="w-3 h-3" />
                        </Button>
                      </Link>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="label-text">Spells Known Scaling</label>
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
                      <Link to="/compendium/spells-known-scaling/new">
                        <Button variant="outline" size="sm" className="h-8 w-8 border-gold/10 text-gold hover:bg-gold/5 p-0">
                          <Plus className="w-3 h-3" />
                        </Button>
                      </Link>
                    </div>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="label-text">Spellcasting Description</label>
                  <MarkdownEditor 
                    value={spellcasting.description} 
                    onChange={(val) => setSpellcasting({...spellcasting, description: val})}
                    placeholder="Describe how this subclass casts spells..."
                    minHeight="120px"
                  />
                </div>
              </div>
            )}
          </div>
            </TabsContent>

            <TabsContent value="progression" className="space-y-6 mt-0">
          <div className="p-4 border border-gold/20 bg-card/50 space-y-4">
            <div className="section-header">
              <h2 className="label-text text-gold">Subclass Progression & Advancements</h2>
              <Zap className="w-4 h-4 text-gold/40" />
            </div>
            <div className="space-y-4">
              <p className="text-[10px] text-ink/40 italic">Global progression rules for this specialization.</p>
              <AdvancementManager 
                advancements={advancements}
                onChange={setAdvancements}
                availableFeatures={features}
                availableScalingColumns={[...scalingColumns, ...parentScalingColumns]}
                availableOptionGroups={allOptionGroups}
                availableOptionItems={allOptionItems}
                defaultHitDie={parentClass?.hitDie}
              />
            </div>
          </div>
            </TabsContent>

            <TabsContent value="features" className="space-y-6 mt-0">
          {/* Features */}
          {id && (
            <div className="p-4 border border-gold/20 bg-card/50 space-y-4">
              <div className="section-header">
                <h2 className="label-text text-gold">Subclass Features</h2>
              </div>

              <div className="space-y-6">
                {/* Group features by level, showing parent placeholders */}
                {(() => {
                  const validLevels = Array.from(new Set([
                    ...(parentClass?.subclassFeatureLevels || []),
                    ...parentFeatures.map(f => f.level)
                  ])).sort((a, b) => a - b);
                  
                  const deprecatedFeatures = features.filter(f => !validLevels.includes(f.level));

                  return (
                    <>
                      {validLevels.map(level => {
                        const levelParentFeatures = parentFeatures.filter(f => f.level === level);
                        const levelSubclassFeatures = features.filter(f => f.level === level);

                        return (
                          <div key={level} className="space-y-2">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-mono text-gold/60">Level {level}</span>
                              <div className="h-px flex-1 bg-gold/10" />
                              {levelParentFeatures.map(pf => (
                                <span key={pf.id} className="text-[10px] font-bold text-gold uppercase tracking-wider bg-gold/5 px-2 py-0.5 rounded border border-gold/10">
                                  {pf.name}
                                </span>
                              ))}
                              <Button 
                                variant="ghost" 
                                size="sm" 
                                onClick={() => {
                                  setEditingFeature({ 
                                    id: doc(collection(db, 'features')).id,
                                    name: '', 
                                    description: '', 
                                    level: level, 
                                    isSubclassFeature: false,
                                    type: 'class',
                                    configuration: {
                                      requiredLevel: level,
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
                                    effectsStr: '[]'
                                  });
                                  setIsFeatureModalOpen(true);
                                }}
                                className="h-6 px-2 text-gold hover:bg-gold/10 gap-1 border border-gold/20 bg-gold/5"
                              >
                                <Plus className="w-3 h-3" /> Add Feature
                              </Button>
                            </div>
                            
                            <div className="pl-4 divide-y divide-gold/5">
                              {levelSubclassFeatures.map((feature) => (
                                <div key={feature.id} className="py-2 flex items-center justify-between group">
                                  <span className="text-sm font-bold text-ink">{feature.name}</span>
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
                              {levelSubclassFeatures.length === 0 && (
                                <p className="py-2 text-[10px] muted-text italic">No features defined for this level.</p>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      {deprecatedFeatures.length > 0 && (
                        <div className="mt-8 pt-6 border-t border-blood/20 space-y-4">
                          <div className="flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4 text-blood" />
                            <h3 className="label-text text-blood">Deprecated Features</h3>
                          </div>
                          <p className="text-xs text-ink/60">
                            The parent class subclass feature progression has changed. Please reassign the levels for these features.
                          </p>
                          <div className="pl-4 divide-y divide-blood/10 border-l border-blood/20">
                            {deprecatedFeatures.map(feature => (
                              <div key={feature.id} className="py-2 flex items-center justify-between group">
                                <div>
                                  <span className="text-sm font-bold text-ink">{feature.name}</span>
                                  <span className="ml-2 text-[10px] text-ink/40 font-mono uppercase tracking-wider">(Currently Level {feature.level})</span>
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
                          </div>
                        </div>
                      )}

                      {validLevels.length === 0 && features.length === 0 && (
                        <p className="py-4 text-center muted-text italic">No features added.</p>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
          )}

            </TabsContent>

            <TabsContent value="tags" className="space-y-6 mt-0">
          {/* Tags */}
          <div className="p-4 border border-gold/20 bg-card/50 space-y-4">
            <div className="section-header">
              <h2 className="label-text text-gold">Tags</h2>
              <Link to="/compendium/tags">
                <Button size="sm" className="h-6 gap-1 btn-gold">
                  <Plus className="w-3 h-3" /> Manage
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
            </div>
          </div>

          </TabsContent>

          <TabsContent value="danger" className="space-y-6 mt-0">
          <div className="p-4 border border-blood/20 bg-blood/5 space-y-4">
            <h2 className="label-text text-blood border-b border-blood/10 pb-2">Danger Zone</h2>
            <Button 
              variant="ghost" 
              size="sm"
              className="w-full btn-danger border border-blood/20 gap-2 text-xs uppercase"
              onClick={async () => {
                if (id && confirm('Are you sure you want to delete this subclass? This cannot be undone.')) {
                  try {
                    await deleteDoc(doc(db, 'subclasses', id));
                    toast.success('Subclass deleted');
                    navigate(parentClass ? `/compendium/classes/edit/${parentClass.id}` : '/compendium/classes');
                  } catch (error) {
                    toast.error('Failed to delete subclass');
                  }
                }
              }}
            >
              <Trash2 className="w-3 h-3" /> Delete Subclass
            </Button>
          </div>
          </TabsContent>
          </Tabs>
        </div>

        <div className="lg:col-span-1 space-y-6">
          {id && (
            <div className="p-4 border border-gold/20 bg-card/50 space-y-4 rounded-xl">
              <div className="section-header">
                <h2 className="label-text text-gold uppercase tracking-tighter">Table Columns</h2>
                <Link to={`/compendium/scaling/new?parentId=${id}&parentType=subclass`}>
                  <Button size="sm" className="h-6 btn-gold">
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
                        <Link to={`/compendium/scaling/edit/${col.id}?parentId=${id}&parentType=subclass`}>
                          <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-gold"><Edit className="w-3 h-3" /></Button>
                        </Link>
                        <Button variant="ghost" size="sm" onClick={() => handleDeleteScaling(col.id)} className="h-5 w-5 p-0 text-blood"><Trash2 className="w-3 h-3" /></Button>
                      </div>
                    </div>

                    <details className="group/details">
                      <summary className="text-[9px] uppercase font-black tracking-widest text-gold/50 cursor-pointer select-none flex items-center justify-between hover:text-gold transition-colors [&::-webkit-details-marker]:hidden">
                        Breakpoints
                        <ChevronDown className="w-3 h-3 transition-transform group-open/details:rotate-180" />
                      </summary>
                      <div className="mt-2 space-y-2">
                        {getScalingBreakpoints(col.values || {}).length > 0 ? (
                          <div className="flex flex-col gap-1 w-full">
                            {getScalingBreakpoints(col.values || {}).map(([level, value]) => (
                              <div key={level} className="flex items-center gap-3 rounded border border-gold/10 bg-background/60 px-3 py-1.5 w-full">
                                <span className="text-[9px] font-black tracking-widest text-gold whitespace-nowrap min-w-[2.5rem]">Lvl {level}</span>
                                <div className="h-px bg-gold/10 flex-1" />
                                <span className="text-[11px] font-black text-ink">{String(value)}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-[10px] text-ink/30 italic">No saved matrix values yet.</p>
                        )}
                      </div>
                    </details>

                    <div className="pt-1">
                      <Link to={`/compendium/scaling/edit/${col.id}?parentId=${id}&parentType=subclass`}>
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
          )}
        </div>
      </div>

      {/* Feature Modal */}
      <Dialog open={isFeatureModalOpen} onOpenChange={(open) => {
        setIsFeatureModalOpen(open);
        if (open) setFeatureTab('description');
      }}>
        <DialogContent className="dialog-content max-w-[95vw] lg:max-w-6xl flex flex-col h-[90vh]">
          {editingFeature && (
            <>
              <div className="p-6 pb-0 shrink-0 border-b border-gold/10">
                <div className="flex gap-6 items-start">
                  <div className="w-32 h-32 bg-background rounded-lg border border-gold/20 flex flex-col items-center justify-center shrink-0">
                    <div className="label-text opacity-40">Icon</div>
                  </div>
                  <div className="flex-1 space-y-2 pt-2 flex flex-col items-center">
                    <input 
                      value={editingFeature.name || ''} 
                      onChange={e => setEditingFeature({...editingFeature, name: e.target.value})}
                      className="w-full h-16 font-serif text-4xl tracking-tight text-center bg-transparent border border-transparent hover:border-gold/20 focus:border-gold/50 focus:bg-background/50 rounded outline-none text-gold transition-colors"
                      placeholder="Feature Name"
                      required
                    />
                    <div className="flex justify-center transition-all">
                      <span className="text-xs text-ink/60 my-auto mr-1 select-none pointer-events-none">Level</span>
                      <input 
                        type="number"
                        min="1"
                        max="20"
                        value={editingFeature.level || 1}
                        readOnly
                        className="w-12 h-8 bg-transparent border border-transparent rounded text-left text-xs text-ink/60 px-2 py-0 outline-none pointer-events-none select-none opacity-80" 
                      />
                    </div>
                  </div>
                </div>

                <div className="flex mt-6 relative pb-4">
                  <div className="absolute left-[50%] ml-[-12px] bottom-[-16px] w-6 h-6 bg-card flex items-center justify-center text-gold/40 text-sm rounded-full z-10 border border-gold/10">
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

              <div className="flex-1 overflow-y-auto p-6 min-h-0 bg-background/50">
                {featureTab === 'description' && (
                  <div className="space-y-4">
                    <MarkdownEditor 
                      value={editingFeature.description || ''} 
                      onChange={(val) => setEditingFeature({...editingFeature, description: val})}
                      minHeight="400px"
                    />
                  </div>
                )}

                {featureTab === 'details' && (
                  <div className="space-y-8 pt-2">
                    <div className="space-y-4">
                      <h4 className="text-[10px] text-gold uppercase tracking-widest font-black">Feature Configuration</h4>
                      <div className="grid sm:grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] uppercase text-ink/60 font-bold">Type</label>
                          <Select 
                            value={editingFeature.type || 'class'} 
                            onValueChange={val => setEditingFeature({...editingFeature, type: val})}
                          >
                            <SelectTrigger className="h-10 bg-background/50 border-gold/10 text-sm">
                              <SelectValue placeholder="Select type" />
                            </SelectTrigger>
                            <SelectContent>
                              {FEATURE_TYPES.map(t => (
                                <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1 opacity-80">
                          <label className="text-[10px] uppercase text-ink/60 font-bold">Required Level</label>
                          <Input 
                            type="number"
                            value={editingFeature.configuration?.requiredLevel || editingFeature.level || 1}
                            readOnly
                            className="h-10 text-sm bg-background/20 border-gold/5 pointer-events-none select-none text-ink/50"
                          />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] uppercase text-ink/60 font-bold">Required Items (Identifiers)</label>
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
                          className="h-10 text-sm bg-background/50 border-gold/10 focus:border-gold"
                        />
                      </div>
                    </div>

                    <div className="space-y-4">
                       <h4 className="text-[10px] text-gold uppercase tracking-widest font-black">Traits & Usage</h4>
                       <div className="grid grid-cols-2 gap-8">
                          <div className="space-y-3">
                            <div className="flex items-center gap-2">
                              <Checkbox 
                                id="feat-repeatable"
                                className="border-gold/30 data-[state=checked]:bg-gold data-[state=checked]:text-white"
                                checked={editingFeature.configuration?.repeatable || false}
                                onCheckedChange={checked => setEditingFeature({
                                  ...editingFeature, 
                                  configuration: { ...editingFeature.configuration, repeatable: !!checked }
                                })}
                              />
                              <label htmlFor="feat-repeatable" className="text-[10px] uppercase text-ink/60 font-bold cursor-pointer">Repeatable</label>
                            </div>
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
                                    setEditingFeature({...editingFeature, properties: props.filter((p: string) => p !== 'magical')});
                                  }
                                }}
                              />
                              <label htmlFor="feat-magical" className="text-[10px] uppercase text-ink/60 font-bold cursor-pointer">Magical</label>
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
                                    setEditingFeature({...editingFeature, properties: props.filter((p: string) => p !== 'passive')});
                                  }
                                }}
                              />
                              <label htmlFor="feat-passive" className="text-[10px] uppercase text-ink/60 font-bold cursor-pointer">Passive Trait</label>
                            </div>
                          </div>

                          <div className="space-y-4">
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
                  <div className="pt-4 space-y-8">
                    <div className="space-y-4">
                       <div className="section-header">
                          <h4 className="text-[10px] text-gold uppercase tracking-widest font-black">Linked Advancements</h4>
                          <p className="text-[10px] text-ink/40">Link this feature to progression rules defined on the subclass.</p>
                       </div>
                       <AdvancementManager 
                         advancements={[]} // Not used for management here
                         onChange={() => {}} // Not used for management here
                         availableFeatures={features}
                         availableScalingColumns={[
                           ...scalingColumns.map((c: any) => ({ ...c, name: `${c.name} (Subclass)` })),
                           ...parentScalingColumns.map((c: any) => ({ ...c, name: `${c.name} (Class)` }))
                         ]}
                         availableOptionGroups={allOptionGroups}
                         isInsideFeature={true}
                         featureId={editingFeature.id}
                         rootAdvancements={advancements}
                         onLinkAdvancement={(advId, featId) => {
                           const nextAdvs = advancements.map(a => 
                             a._id === advId ? { ...a, featureId: featId } : a
                           );
                           setAdvancements(nextAdvs);
                         }}
                       />
                    </div>

                    <div className="space-y-4 pt-4 border-t border-gold/10">
                      <h4 className="text-[10px] text-gold uppercase tracking-widest font-black">Table Column Links</h4>
                      <div className="grid gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] uppercase text-ink/60 font-bold">Quantity Column</label>
                          <select 
                            value={editingFeature?.quantityColumnId || ''}
                            onChange={e => setEditingFeature({...editingFeature, quantityColumnId: e.target.value})}
                            className="w-full h-9 px-2 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-sm text-ink"
                          >
                            <option value="">None</option>
                            <optgroup label="Subclass Columns">
                              {scalingColumns.map((col: any) => (
                                <option key={col.id} value={col.id}>{col.name}</option>
                              ))}
                            </optgroup>
                            <optgroup label="Class Columns">
                              {parentScalingColumns.map((col: any) => (
                                <option key={col.id} value={col.id}>{col.name}</option>
                              ))}
                            </optgroup>
                          </select>
                          <p className="text-[10px] text-ink/40 italic">Link to a column to dictate quantity of uses or choices.</p>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] uppercase text-ink/60 font-bold">Scaling Column</label>
                          <select 
                            value={editingFeature?.scalingColumnId || ''}
                            onChange={e => setEditingFeature({...editingFeature, scalingColumnId: e.target.value})}
                            className="w-full h-9 px-2 rounded-md border border-gold/10 bg-background/50 focus:border-gold outline-none text-sm text-ink"
                          >
                            <option value="">None</option>
                            <optgroup label="Subclass Columns">
                              {scalingColumns.map((col: any) => (
                                <option key={col.id} value={col.id}>{col.name}</option>
                              ))}
                            </optgroup>
                            <optgroup label="Class Columns">
                              {parentScalingColumns.map((col: any) => (
                                <option key={col.id} value={col.id}>{col.name}</option>
                              ))}
                            </optgroup>
                          </select>
                          <p className="text-[10px] text-ink/40 italic">Link to a column to dictate scaling values like damage.</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          <div className="dialog-footer shrink-0 flex items-center justify-end gap-3">
            <Button type="button" variant="ghost" onClick={() => setIsFeatureModalOpen(false)} className="label-text opacity-70 hover:opacity-100 h-8">
              Cancel
            </Button>
            <Button onClick={handleSaveFeature} className="bg-primary hover:bg-primary/90 text-primary-foreground label-text h-8 px-6">
              Save Feature
            </Button>
          </div>
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
              Uncheck options that are NOT available to this subclass.
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
                  const isClassRestricted = item.classIds && Array.isArray(item.classIds) && item.classIds.length > 0 && !item.classIds.includes(parentClass?.id);
                  
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
