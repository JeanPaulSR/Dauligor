import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { Plus, Search, BookOpen, ChevronRight } from 'lucide-react';
import { Input } from '../../components/ui/input';
import { fetchCollection } from '../../lib/d1';
import { useBlockDraftedList } from '../../hooks/useBlockDraftedList';

export default function UniqueOptionGroupList({ userProfile }: { userProfile: any }) {
  const [groups, setGroups] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const isAdmin = userProfile?.role === 'admin' || userProfile?.role === 'co-dm';
  const isContentCreator = !!userProfile?.permissions &&
    Object.prototype.hasOwnProperty.call(userProfile.permissions, 'content-creator');
  const canManage = isAdmin || isContentCreator;
  // Route-aware: on /proposals/edit/option-groups, links target the
  // proposal-editor route; on the admin /compendium/unique-options
  // list, links keep their existing /compendium/* targets.
  const location = useLocation();
  const isProposalRoute = location.pathname.startsWith('/proposals/edit/');
  const newGroupHref = isProposalRoute
    ? '/proposals/edit/option-groups/new'
    : '/compendium/unique-options/new';
  const detailHref = (groupId: string) =>
    isProposalRoute
      ? `/proposals/edit/option-groups/edit/${groupId}`
      : `/compendium/unique-options/${groupId}`;

  useEffect(() => {
    fetchCollection('uniqueOptionGroups', { orderBy: 'name ASC' })
      .then(data => {
        setGroups(data);
        setLoading(false);
      })
      .catch(err => {
        console.error('Error loading option groups:', err);
        setLoading(false);
      });
  }, []);

  // F2: when this list mounts inside a <ProposalEditorWrapper> (the
  // /proposals/edit/option-groups route), overlay block-draft CREATEs
  // so a just-queued group is reachable from the list. Outside the
  // wrapper (admin /compendium/unique-options) this returns `groups`
  // unchanged, so the admin catalog list is unaffected.
  const displayGroups = useBlockDraftedList<any>('unique_option_group', groups);
  const filteredGroups = displayGroups.filter(g =>
    (g.name || "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-20">
      <div className="section-header">
        <div className="flex items-center gap-4">
          <BookOpen className="w-6 h-6 text-gold" />
          <h1 className="text-2xl font-serif font-bold text-ink uppercase tracking-tight">Unique Option Groups</h1>
        </div>
        {canManage && (
          <Link to={newGroupHref}>
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
            to={detailHref(group.id)}
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
            {group.__draft && (
              <span className="inline-block text-[9px] font-bold uppercase tracking-widest text-gold/80 bg-gold/10 border border-gold/30 px-1.5 py-0.5 rounded">
                in this block
              </span>
            )}
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
