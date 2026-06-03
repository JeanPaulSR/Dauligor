// =============================================================================
// UniqueOptionGroupView — read-only browse page for a modular option group.
// =============================================================================
//
// Matches the pattern of ClassView: every other entity in the compendium has
// a `/compendium/<entity>/:id` route that surfaces a public-friendly read
// view, with the `/compendium/<entity>/edit/:id` route gated to authoring
// roles. Modular options (UniqueOptionGroup + UniqueOptionItem) used to skip
// the view step — the list page linked directly into the editor. This page
// closes that gap.
//
// Layout (mobile-first):
//   - Page header: name + (admin) Edit button + back link to list
//   - Group description (BBCode)
//   - Source + classes badge row
//   - Items section: one card per item with name, description, requirements
//     summary, and any uses/recovery metadata the editor lets authors set.
//
// All reads use the existing d1 helpers; no proposal flow needed here.
// =============================================================================

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import BBCodeRenderer from '../../components/BBCodeRenderer';
import { ChevronLeft, Edit, Repeat, BookOpen } from 'lucide-react';
import { fetchCollection, fetchDocument } from '../../lib/d1';
import { denormalizeCompendiumData } from '../../lib/compendium';
import {
  parseRequirementTree,
  formatRequirementText,
  type Requirement,
} from '../../lib/requirements';

type Source = { id: string; name: string };
type ClassRow = { id: string; name: string };
type Subclass = { id: string; name: string };
type SpellRule = { id: string; name: string };
type GroupRow = {
  id: string;
  name: string;
  description?: string;
  source_id?: string;
  sourceId?: string;
  class_ids?: string[];
  classIds?: string[];
};
type ItemRow = {
  id: string;
  name: string;
  description?: string;
  iconUrl?: string;
  imageUrl?: string;
  usesMax?: string | number | null;
  usesRecovery?: string | null;
  level_prereq?: number | null;
  levelPrereq?: number | null;
  level_prereq_is_total?: boolean | null;
  levelPrereqIsTotal?: boolean | null;
  requirementsTree?: Requirement | null;
};

export default function UniqueOptionGroupView({ userProfile }: { userProfile: any }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState<GroupRow | null>(null);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [subclasses, setSubclasses] = useState<Subclass[]>([]);
  const [spellRules, setSpellRules] = useState<SpellRule[]>([]);
  const [allOptionItems, setAllOptionItems] = useState<Array<{ id: string; name: string }>>([]);

  const canEdit = userProfile?.role === 'admin' || userProfile?.role === 'co-dm';

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // Single pass — group + its items + the lookup tables needed
        // to format requirement summaries. Subclasses / spell rules /
        // siblings are tiny; the cost is dominated by the items query.
        const [groupRow, itemRows, sourceRows, classRows, subclassRows, ruleRows, allItems] =
          await Promise.all([
            fetchDocument<GroupRow>('uniqueOptionGroups', id),
            fetchCollection('uniqueOptionItems', {
              where: 'group_id = ?',
              params: [id],
              orderBy: 'name ASC',
            }),
            fetchCollection<Source>('sources', { orderBy: 'name ASC' }),
            fetchCollection<ClassRow>('classes', { orderBy: 'name ASC' }),
            fetchCollection<Subclass>('subclasses', { orderBy: 'name ASC' }),
            fetchCollection<SpellRule>('spellRules', { orderBy: 'name ASC' }),
            fetchCollection<{ id: string; name: string }>('uniqueOptionItems', {
              orderBy: 'name ASC',
            }),
          ]);
        if (cancelled) return;
        if (!groupRow) {
          setError('Modular option group not found.');
          setLoading(false);
          return;
        }
        setGroup(groupRow);
        // Denormalize + parse requirementsTree once so the render path
        // can rely on a typed shape.
        setItems(
          (itemRows as any[]).map((row) => {
            const denorm = denormalizeCompendiumData(row);
            return {
              ...denorm,
              requirementsTree: parseRequirementTree(
                denorm.requirementsTree ?? denorm.requirements_tree,
              ),
              levelPrereqIsTotal: Boolean(
                denorm.levelPrereqIsTotal ?? denorm.level_prereq_is_total,
              ),
            };
          }),
        );
        setSources(sourceRows);
        setClasses(classRows);
        setSubclasses(subclassRows);
        setSpellRules(ruleRows);
        setAllOptionItems(allItems);
      } catch (err: any) {
        console.error(err);
        if (!cancelled) setError(err?.message || 'Failed to load group.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  // Lookup the names that `formatRequirementText` needs to render a
  // requirement leaf as plain English.
  const reqLookup = useMemo(() => ({
    classNameById: Object.fromEntries(classes.map((c) => [c.id, c.name])),
    subclassNameById: Object.fromEntries(subclasses.map((s) => [s.id, s.name])),
    spellRuleNameById: Object.fromEntries(spellRules.map((r) => [r.id, r.name])),
    optionItemNameById: Object.fromEntries(allOptionItems.map((it) => [it.id, it.name])),
  }), [classes, subclasses, spellRules, allOptionItems]);

  const sourceName = useMemo(() => {
    const sourceId = group?.source_id ?? group?.sourceId;
    if (!sourceId) return null;
    return sources.find((s) => s.id === sourceId)?.name ?? null;
  }, [group, sources]);

  const groupClassIds = useMemo(() => {
    const raw = group?.class_ids ?? group?.classIds;
    return Array.isArray(raw) ? raw : [];
  }, [group]);

  const groupClasses = useMemo(
    () => groupClassIds
      .map((cid) => classes.find((c) => c.id === cid))
      .filter((c): c is ClassRow => !!c),
    [groupClassIds, classes],
  );

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto py-20 text-center text-ink/55 italic">Loading…</div>
    );
  }
  if (error || !group) {
    return (
      <div className="max-w-4xl mx-auto py-20 text-center space-y-4">
        <p className="text-ink/65 italic">{error || 'Not found.'}</p>
        <Button variant="outline" onClick={() => navigate('/compendium/unique-options')}>
          <ChevronLeft className="w-4 h-4 mr-2" /> Back to Modular Options
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-20">
      <div className="flex items-center justify-between gap-4">
        <Link
          to="/compendium/unique-options"
          className="inline-flex items-center text-xs text-ink/65 hover:text-gold transition-colors uppercase tracking-widest"
        >
          <ChevronLeft className="w-4 h-4 mr-1" /> All Modular Options
        </Link>
        {canEdit && (
          <Link to={`/compendium/unique-options/edit/${group.id}`}>
            <Button variant="outline" size="sm" className="gap-2">
              <Edit className="w-4 h-4" /> Edit
            </Button>
          </Link>
        )}
      </div>

      <div className="section-header">
        <div className="flex items-center gap-4">
          <Repeat className="w-6 h-6 text-gold" />
          <h1 className="text-3xl font-serif font-bold text-ink uppercase tracking-tight">
            {group.name}
          </h1>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {sourceName && (
          <Badge variant="outline" className="border-gold/35 text-gold/85">
            <BookOpen className="w-3 h-3 mr-1" /> {sourceName}
          </Badge>
        )}
        {groupClasses.map((c) => (
          <Badge key={c.id} variant="outline" className="border-ink/25 text-ink/65">
            {c.name}
          </Badge>
        ))}
        {groupClassIds.length === 0 && (
          <span className="text-[10px] text-ink/45 italic">No classes assigned</span>
        )}
      </div>

      {group.description ? (
        <div className="prose prose-sm max-w-none text-ink/85">
          <BBCodeRenderer content={group.description} />
        </div>
      ) : (
        <p className="text-ink/45 italic">No description provided.</p>
      )}

      <div className="section-header">
        <h2 className="text-xl font-serif font-bold text-ink uppercase tracking-widest">
          Options ({items.length})
        </h2>
      </div>

      {items.length === 0 ? (
        <Card className="border-dashed border-gold/25">
          <CardContent className="py-12 text-center text-ink/45 italic">
            No options have been added to this group yet.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <ItemCard key={item.id} item={item} reqLookup={reqLookup} />
          ))}
        </div>
      )}
    </div>
  );
}

function ItemCard({
  item, reqLookup,
}: {
  item: ItemRow;
  reqLookup: {
    classNameById: Record<string, string>;
    subclassNameById: Record<string, string>;
    spellRuleNameById: Record<string, string>;
    optionItemNameById: Record<string, string>;
  };
}) {
  const reqText = useMemo(() => {
    if (!item.requirementsTree) return null;
    try {
      return formatRequirementText(item.requirementsTree, reqLookup);
    } catch {
      return null;
    }
  }, [item.requirementsTree, reqLookup]);

  const level = item.levelPrereq ?? item.level_prereq ?? null;
  const isTotalLevel = item.levelPrereqIsTotal ?? item.level_prereq_is_total ?? false;
  const usesMax = item.usesMax ?? null;
  const usesRecovery = item.usesRecovery ?? null;

  return (
    <Card className="border-gold/15">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-3 flex-wrap">
          <span>{item.name || 'Unnamed option'}</span>
          {level !== null && level !== undefined && (
            <Badge variant="outline" className="text-[9px] border-gold/35 text-gold/85">
              {isTotalLevel ? `Character Lv ${level}` : `Class Lv ${level}`}
            </Badge>
          )}
          {usesMax !== null && usesMax !== '' && (
            <Badge variant="outline" className="text-[9px] border-ink/25 text-ink/65">
              {String(usesMax)} use{String(usesMax) === '1' ? '' : 's'}{usesRecovery ? ` / ${usesRecovery}` : ''}
            </Badge>
          )}
        </CardTitle>
        {reqText && (
          <p className="text-[11px] text-ink/55 italic mt-1">
            Requires: {reqText}
          </p>
        )}
      </CardHeader>
      <CardContent>
        {item.description ? (
          <div className="prose prose-sm max-w-none text-ink/85">
            <BBCodeRenderer content={item.description} />
          </div>
        ) : (
          <p className="text-ink/45 italic text-sm">No description.</p>
        )}
      </CardContent>
    </Card>
  );
}
