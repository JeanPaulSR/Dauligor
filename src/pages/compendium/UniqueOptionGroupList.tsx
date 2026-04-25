import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../../lib/firebase';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { Button } from '../../components/ui/button';
import { Plus, Search, BookOpen, ChevronRight } from 'lucide-react';
import { Input } from '../../components/ui/input';

export default function UniqueOptionGroupList({ userProfile }: { userProfile: any }) {
  const [groups, setGroups] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const isAdmin = userProfile?.role === 'admin' || userProfile?.role === 'co-dm';

  useEffect(() => {
    const q = query(collection(db, 'uniqueOptionGroups'), orderBy('name', 'asc'));
    const unsubscribe = onSnapshot(q, (snap) => {
      setGroups(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const filteredGroups = groups.filter(g => 
    (g.name || "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-20">
      <div className="section-header">
        <div className="flex items-center gap-4">
          <BookOpen className="w-6 h-6 text-gold" />
          <h1 className="text-2xl font-serif font-bold text-ink uppercase tracking-tight">Unique Option Groups</h1>
        </div>
        {isAdmin && (
          <Link to="/compendium/unique-options/new">
            <Button size="sm" className="btn-gold-solid gap-2">
              <Plus className="w-4 h-4" /> New Group
            </Button>
          </Link>
        )}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink/30" />
        <Input 
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search groups (e.g. Invocations, Maneuvers)..."
          className="pl-10 h-10 bg-card/50 border-gold/10 focus:border-gold"
        />
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredGroups.map(group => (
          <Link 
            key={group.id} 
            to={`/compendium/unique-options/edit/${group.id}`}
            className="group p-4 border border-gold/20 bg-card/50 hover:bg-gold/5 transition-all space-y-2"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-serif font-bold text-lg text-ink group-hover:text-gold transition-colors">
                {group.name || 'Unnamed Group'}
              </h3>
              <ChevronRight className="w-4 h-4 text-gold/30 group-hover:text-gold transition-all" />
            </div>
            <p className="text-xs text-ink/60 line-clamp-2 italic">
              {group.description || 'No description provided.'}
            </p>
          </Link>
        ))}
        {filteredGroups.length === 0 && !loading && (
          <div className="col-span-full py-20 text-center border border-dashed border-gold/20">
            <p className="text-ink/40 italic">No groups found.</p>
          </div>
        )}
      </div>
    </div>
  );
}
