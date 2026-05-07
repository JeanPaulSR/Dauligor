import React, { useState, useEffect } from 'react';
import { fetchCollection, deleteDocument } from '../../lib/d1';
import { Button } from '../../components/ui/button';
import { Plus, Edit, Trash2, Wand2, BookOpen, ShieldAlert, Calculator } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import StandardMulticlassEditor from './StandardMulticlassEditor';
import SpellcastingTypeEditor from './SpellcastingTypeEditor';

export default function SpellcastingAdvancementManager({ userProfile }: { userProfile: any }) {
  const [standardScalings, setStandardScalings] = useState<any[]>([]);
  const [knownScalings, setKnownScalings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showMulticlassChart, setShowMulticlassChart] = useState(false);
  const [showTypeEditor, setShowTypeEditor] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [standard, known] = await Promise.all([
          fetchCollection<any>('spellcastingScalings', { where: "type = 'standard'", orderBy: 'name' }),
          fetchCollection<any>('spellsKnownScalings', { where: "type = 'known'", orderBy: 'name' })
        ]);
        if (cancelled) return;
        setStandardScalings(standard);
        setKnownScalings(known);
      } catch (err) {
        console.error("Scaling fetch error:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [refreshTick]);

  const handleDelete = async (id: string, collectionName: string) => {
    if (confirm('Are you sure you want to delete this advancement template? Any classes using it may lose their progression data.')) {
      try {
        await deleteDocument(collectionName, id);
        toast.success('Advancement template deleted');
        setRefreshTick(t => t + 1);
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
        <div className="section-header">
          <div className="flex items-center gap-2">
            <Wand2 className="w-4 h-4 text-gold" />
            <h3 className="text-sm font-bold uppercase tracking-widest text-ink/80">Standard Spell slot Progressions</h3>
          </div>
          <Link to="/compendium/spellcasting-scaling/new">
            <Button size="sm" className="h-7 gap-1 btn-gold">
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
                    className="h-7 w-7 p-0 btn-danger"
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

      {/* Spells Known */}
      <section className="space-y-4">
        <div className="section-header">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-gold" />
            <h3 className="text-sm font-bold uppercase tracking-widest text-ink/80">Spells Known & Cantrips</h3>
          </div>
          <Link to="/compendium/spells-known-scaling/new">
            <Button size="sm" className="h-7 gap-1 btn-gold">
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
                    className="h-7 w-7 p-0 btn-danger"
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
