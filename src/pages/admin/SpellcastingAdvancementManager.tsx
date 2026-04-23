import React, { useState, useEffect } from 'react';
import { db } from '../../lib/firebase';
import { collection, query, orderBy, onSnapshot, doc, deleteDoc } from 'firebase/firestore';
import { Button } from '../../components/ui/button';
import { Plus, Edit, Trash2, Wand2, BookOpen, Zap, ShieldAlert, Calculator } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import StandardMulticlassEditor from './StandardMulticlassEditor';
import SpellcastingTypeEditor from './SpellcastingTypeEditor';

export default function SpellcastingAdvancementManager({ userProfile }: { userProfile: any }) {
  const [standardScalings, setStandardScalings] = useState<any[]>([]);
  const [pactScalings, setPactScalings] = useState<any[]>([]);
  const [knownScalings, setKnownScalings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showMulticlassChart, setShowMulticlassChart] = useState(false);
  const [showTypeEditor, setShowTypeEditor] = useState(false);

  useEffect(() => {
    const unsubStandard = onSnapshot(
      query(collection(db, 'spellcastingScalings'), orderBy('name')), 
      (snap) => {
        setStandardScalings(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      },
      (error) => {
        console.error("Standard scaling listener error:", error);
      }
    );

    const unsubPact = onSnapshot(
      query(collection(db, 'pactMagicScalings'), orderBy('name')), 
      (snap) => {
        setPactScalings(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      },
      (error) => {
        console.error("Pact scaling listener error:", error);
      }
    );

    const unsubKnown = onSnapshot(
      query(collection(db, 'spellsKnownScalings'), orderBy('name')), 
      (snap) => {
        setKnownScalings(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        setLoading(false);
      },
      (error) => {
        console.error("Known scaling listener error:", error);
        setLoading(false);
      }
    );

    return () => {
      unsubStandard();
      unsubPact();
      unsubKnown();
    };
  }, []);

  const handleDelete = async (id: string, collectionName: string) => {
    if (confirm('Are you sure you want to delete this advancement template? Any classes using it may lose their progression data.')) {
      try {
        await deleteDoc(doc(db, collectionName, id));
        toast.success('Advancement template deleted');
      } catch (err) {
        console.error(err);
        toast.error('Failed to delete template');
      }
    }
  };

  if (loading) {
    return <div className="text-center py-10 italic text-gold/60">Loading advancements...</div>;
  }

  return (
    <div className="space-y-12 pb-12">
      {/* Global Reference Table */}
      <section className="p-1 border border-gold/10 rounded-2xl bg-card/20 shadow-sm">
        <div className="p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gold/10 flex items-center justify-center border border-gold/20 shadow-inner">
                <ShieldAlert className="w-5 h-5 text-gold" />
              </div>
              <div>
                <h3 className="font-serif text-lg font-bold text-ink">Multiclass Master Chart</h3>
                <p className="text-xs text-ink/40">The definitive reference for multi-casting characters.</p>
              </div>
            </div>
            <Button 
              onClick={() => setShowMulticlassChart(!showMulticlassChart)}
              variant="outline"
              className="border-gold/20 text-gold hover:bg-gold/5"
            >
              {showMulticlassChart ? 'Hide Chart' : 'Edit Master Chart'}
            </Button>
          </div>

          {showMulticlassChart && (
            <div className="pt-4 border-t border-gold/5">
              <StandardMulticlassEditor />
            </div>
          )}
        </div>
      </section>

      {/* Spellcasting Type Config */}
      <section className="p-1 border border-gold/10 rounded-2xl bg-card/20 shadow-sm">
        <div className="p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gold/10 flex items-center justify-center border border-gold/20 shadow-inner">
                <Calculator className="w-5 h-5 text-gold" />
              </div>
              <div>
                <h3 className="font-serif text-lg font-bold text-ink">Foundry Formula Mapping</h3>
                <p className="text-xs text-ink/40">Define how class levels map to multiclass slots (Full, Half, Third, etc).</p>
              </div>
            </div>
            <Button 
              onClick={() => setShowTypeEditor(!showTypeEditor)}
              variant="outline"
              className="border-gold/20 text-gold hover:bg-gold/5"
            >
              {showTypeEditor ? 'Hide Types' : 'Edit Calculator Types'}
            </Button>
          </div>

          {showTypeEditor && (
            <div className="pt-4 border-t border-gold/5">
              <SpellcastingTypeEditor userProfile={userProfile} />
            </div>
          )}
        </div>
      </section>

      {/* Standard Spell Slots */}
      <section className="space-y-4">
        <div className="flex items-center justify-between border-b border-gold/10 pb-2">
          <div className="flex items-center gap-2">
            <Wand2 className="w-4 h-4 text-gold" />
            <h3 className="text-sm font-bold uppercase tracking-widest text-ink/80">Standard Spell slot Progressions</h3>
          </div>
          <Link to="/compendium/spellcasting-scaling/new">
            <Button size="sm" className="h-7 text-[10px] bg-gold/10 text-gold hover:bg-gold/20 border border-gold/20 gap-1 uppercase tracking-widest font-bold">
              <Plus className="w-3 h-3" /> New Standard
            </Button>
          </Link>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {standardScalings.map(s => (
            <div key={s.id} className="p-4 border border-gold/10 bg-card/50 rounded-lg group hover:border-gold/30 transition-all">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-serif font-bold text-ink">{s.name}</h4>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Link to={`/compendium/spellcasting-scaling/edit/${s.id}`}>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-gold hover:bg-gold/10">
                      <Edit className="w-3.5 h-3.5" />
                    </Button>
                  </Link>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => handleDelete(s.id, 'spellcastingScalings')}
                    className="h-7 w-7 p-0 text-blood hover:bg-blood/10"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
              <p className="text-[10px] text-ink/40 uppercase tracking-widest font-bold">Standard Slots (1st-9th)</p>
            </div>
          ))}
          {standardScalings.length === 0 && (
            <div className="col-span-full py-8 text-center border border-dashed border-gold/10 rounded-lg text-ink/20 italic text-sm">
              No standard progressions defined.
            </div>
          )}
        </div>
      </section>

      {/* Pact Magic */}
      <section className="space-y-4">
        <div className="flex items-center justify-between border-b border-gold/10 pb-2">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-gold" />
            <h3 className="text-sm font-bold uppercase tracking-widest text-ink/80">Alternative (Pact) Progressions</h3>
          </div>
          <Link to="/compendium/pact-scaling/new">
            <Button size="sm" className="h-7 text-[10px] bg-gold/10 text-gold hover:bg-gold/20 border border-gold/20 gap-1 uppercase tracking-widest font-bold">
              <Plus className="w-3 h-3" /> New Alternative
            </Button>
          </Link>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {pactScalings.map(s => (
            <div key={s.id} className="p-4 border border-gold/10 bg-card/50 rounded-lg group hover:border-gold/30 transition-all">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-serif font-bold text-ink">{s.name}</h4>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Link to={`/compendium/pact-scaling/edit/${s.id}`}>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-gold hover:bg-gold/10">
                      <Edit className="w-3.5 h-3.5" />
                    </Button>
                  </Link>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => handleDelete(s.id, 'pactMagicScalings')}
                    className="h-7 w-7 p-0 text-blood hover:bg-blood/10"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
              <p className="text-[10px] text-ink/40 uppercase tracking-widest font-bold">Focus Points / Pact Slots</p>
            </div>
          ))}
          {pactScalings.length === 0 && (
            <div className="col-span-full py-8 text-center border border-dashed border-gold/10 rounded-lg text-ink/20 italic text-sm">
              No alternative progressions defined.
            </div>
          )}
        </div>
      </section>

      {/* Spells Known */}
      <section className="space-y-4">
        <div className="flex items-center justify-between border-b border-gold/10 pb-2">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-gold" />
            <h3 className="text-sm font-bold uppercase tracking-widest text-ink/80">Spells Known & Cantrips</h3>
          </div>
          <Link to="/compendium/spells-known-scaling/new">
            <Button size="sm" className="h-7 text-[10px] bg-gold/10 text-gold hover:bg-gold/20 border border-gold/20 gap-1 uppercase tracking-widest font-bold">
              <Plus className="w-3 h-3" /> New Known Scaling
            </Button>
          </Link>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {knownScalings.map(s => (
            <div key={s.id} className="p-4 border border-gold/10 bg-card/50 rounded-lg group hover:border-gold/30 transition-all">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-serif font-bold text-ink">{s.name}</h4>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Link to={`/compendium/spells-known-scaling/edit/${s.id}`}>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-gold hover:bg-gold/10">
                      <Edit className="w-3.5 h-3.5" />
                    </Button>
                  </Link>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => handleDelete(s.id, 'spellsKnownScalings')}
                    className="h-7 w-7 p-0 text-blood hover:bg-blood/10"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
              <p className="text-[10px] text-ink/40 uppercase tracking-widest font-bold">Cantrips & Known Counts</p>
            </div>
          ))}
          {knownScalings.length === 0 && (
            <div className="col-span-full py-8 text-center border border-dashed border-gold/10 rounded-lg text-ink/20 italic text-sm">
              No known count progressions defined.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
