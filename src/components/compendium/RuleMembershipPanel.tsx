import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { X, ExternalLink, Layers } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import EntityPicker from '../ui/EntityPicker';
import { StatusEmblem } from '../ui/StatusEmblem';
import { cn } from '../../lib/utils';
import { fetchCollection } from '../../lib/d1';
import {
  getRuleMembershipForSpell,
  getCandidateRulesForSpell,
  addSpellToRuleManual,
  removeSpellFromRuleManual,
  addRuleManualExclusion,
  type RuleMembership,
  type ConsumerType,
} from '../../lib/spellRules';

/**
 * Rule Membership surface for a spell — read-only listing of every
 * rule that currently includes this spell, with admin affordances to
 * pin the spell into a rule's `manual_spells` (Add to rule…) and to
 * detach it from a rule (Remove).
 *
 * Mounts in two places:
 *   - SpellsEditor right column (admin spell editor, full edit
 *     affordances when `canEdit`).
 *   - SpellDetailPanel (public browser + SpellListManager preview
 *     pane), where `canEdit` gates the buttons behind admin.
 *
 * The "via" badge tells the admin WHY the rule includes the spell:
 *   - `manual` — the spell id is in the rule's `manual_spells`
 *     array (rendered as "Manual"). Remove pops it out.
 *   - `query`  — the spell satisfies the rule's tag/source/level
 *     query (rendered as "Auto"). Remove pushes the spell id into
 *     the rule's `manual_exclusions` array (so the query match is
 *     overridden for this one spell without editing the query
 *     itself).
 *
 * Excluded rules don't surface here — they're shown on the
 * SpellListManager Exceptions panel per consumer. Excluded rules DO
 * appear in the Add-to-Rule picker as candidates, because picking
 * one un-excludes the spell.
 *
 * After every mutation the panel reloads via `reload()`. The parent
 * is notified through `onChanged()` so it can refresh resolver-backed
 * surfaces (cache invalidation happens implicitly via the
 * rule.updated_at bump).
 */
export type RuleMembershipPanelProps = {
  /** Spell id to probe. `null` renders the empty state. */
  spellId: string | null;
  /**
   * When false, the panel is read-only: shows the membership rows
   * with no Add/Remove buttons. When true (admin), the affordances
   * surface. Defaults to false so non-admin callers don't have to
   * remember to opt out.
   */
  canEdit?: boolean;
  /**
   * Fired after any successful mutation. Lets the parent reload
   * its own resolver-backed surfaces (e.g. SpellListManager's class
   * list, SpellDetailPanel's "On the spell list for" line).
   */
  onChanged?: () => void;
  /** Pass-through layout class so callers can constrain height. */
  className?: string;
};

type ConsumerRow = {
  id: string;
  name: string;
  type: ConsumerType;
};

export default function RuleMembershipPanel({
  spellId,
  canEdit = false,
  onChanged,
  className,
}: RuleMembershipPanelProps) {
  const [memberships, setMemberships] = useState<RuleMembership[]>([]);
  const [candidates, setCandidates] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [consumersById, setConsumersById] = useState<Record<string, ConsumerRow>>({});
  // In-flight rule ids → disables the row's button until the await resolves.
  const [pendingRuleIds, setPendingRuleIds] = useState<Set<string>>(new Set());

  // Cross-editor link prefix — stay on the user's current route family
  // (admin direct vs proposal-wrapped).
  const location = useLocation();
  const editorPrefix = location.pathname.startsWith('/proposals/edit/')
    ? '/proposals/edit'
    : '/compendium';

  const reload = async () => {
    if (!spellId) {
      setMemberships([]);
      setCandidates([]);
      return;
    }
    setLoading(true);
    try {
      const [m, c] = await Promise.all([
        getRuleMembershipForSpell(spellId),
        getCandidateRulesForSpell(spellId),
      ]);
      setMemberships(m);
      setCandidates(c);
    } catch (err) {
      console.error('[RuleMembershipPanel] reload failed:', err);
      toast.error('Failed to load rule membership.');
    } finally {
      setLoading(false);
    }
  };

  // Per-spell-change reload. Consumers map is loaded once for the
  // lifetime of the panel mount (classes / subclasses change rarely
  // enough that re-fetching per spell would be wasteful).
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spellId]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [classes, subclasses] = await Promise.all([
          fetchCollection<{ id: string; name: string }>('classes', {
            select: 'id, name',
            orderBy: 'name ASC',
          }),
          fetchCollection<{ id: string; name: string }>('subclasses', {
            select: 'id, name',
            orderBy: 'name ASC',
          }),
        ]);
        if (!active) return;
        const map: Record<string, ConsumerRow> = {};
        for (const c of classes) {
          map[String(c.id)] = { id: String(c.id), name: String(c.name), type: 'class' };
        }
        for (const s of subclasses) {
          map[String(s.id)] = { id: String(s.id), name: String(s.name), type: 'subclass' };
        }
        setConsumersById(map);
      } catch (err) {
        console.error('[RuleMembershipPanel] failed to load consumer names:', err);
      }
    })();
    return () => { active = false; };
  }, []);

  const markPending = (ruleId: string, on: boolean) => {
    setPendingRuleIds(prev => {
      const next = new Set(prev);
      if (on) next.add(ruleId); else next.delete(ruleId);
      return next;
    });
  };

  const handleAddRule = async (ruleId: string) => {
    if (!spellId) return;
    markPending(ruleId, true);
    try {
      await addSpellToRuleManual(spellId, ruleId);
      const ruleName = candidates.find(c => c.id === ruleId)?.name ?? 'rule';
      toast(`Added to "${ruleName}".`);
      await reload();
      onChanged?.();
    } catch (err) {
      console.error('[RuleMembershipPanel] addToRule failed:', err);
      toast.error('Failed to add spell to rule.');
    } finally {
      markPending(ruleId, false);
    }
  };

  /**
   * Remove dispatches based on the mechanism that currently
   * contributes the spell. `manual` -> pop from manual_spells (undo
   * the pin). `query` -> push to manual_exclusions (override the
   * query match for this spell).
   */
  const handleRemove = async (membership: RuleMembership) => {
    if (!spellId) return;
    markPending(membership.ruleId, true);
    try {
      if (membership.via === 'manual') {
        await removeSpellFromRuleManual(spellId, membership.ruleId);
        toast(`Removed from "${membership.ruleName}".`);
      } else {
        await addRuleManualExclusion(spellId, membership.ruleId);
        toast(`Excluded from "${membership.ruleName}" — the rule's query still matches, but this spell is now overridden.`);
      }
      await reload();
      onChanged?.();
    } catch (err) {
      console.error('[RuleMembershipPanel] remove failed:', err);
      toast.error('Failed to remove spell from rule.');
    } finally {
      markPending(membership.ruleId, false);
    }
  };

  /**
   * Variant D — Layers icon + ink-toned chips (no "Applied to:"
   * label, the icon carries the semantic). For 1-3 consumers each
   * gets its own chip; for 4+ we collapse to a single chip with
   * "N classes · M subclasses" so the row stays scannable. The
   * tooltip carries the full list either way.
   */
  const renderAppliedTo = (membership: RuleMembership) => {
    if (membership.appliedTo.length === 0) {
      return (
        <div
          className="flex items-center gap-1 text-[10px] text-ink/30 italic"
          title="Applied to no consumers yet"
        >
          <Layers className="w-3 h-3 text-ink/30 shrink-0" aria-hidden />
          <span className="not-italic">—</span>
        </div>
      );
    }
    const named = membership.appliedTo
      .map(a => {
        const c = consumersById[a.appliesToId];
        return c
          ? { name: c.name, type: c.type }
          : { name: `${a.appliesToType}:${a.appliesToId.slice(0, 6)}…`, type: a.appliesToType };
      });
    const full = named.map(n => n.name).join(', ');
    if (named.length <= 3) {
      return (
        <div
          className="flex flex-wrap items-center gap-1"
          title={`Applied to: ${full}`}
        >
          <Layers className="w-3 h-3 text-ink/45 shrink-0" aria-hidden />
          {named.map((n, i) => (
            <span
              key={i}
              className="text-[9px] px-1.5 py-0.5 rounded border border-ink/15 bg-ink/[0.03] text-ink/65 leading-tight"
            >
              {n.name}
            </span>
          ))}
        </div>
      );
    }
    const byType = new Map<string, number>();
    for (const n of named) byType.set(n.type, (byType.get(n.type) ?? 0) + 1);
    const compact = [...byType.entries()]
      .map(([t, n]) => `${n} ${t}${n === 1 ? '' : 's'}`)
      .join(' · ');
    return (
      <div
        className="flex flex-wrap items-center gap-1"
        title={`Applied to: ${full}`}
      >
        <Layers className="w-3 h-3 text-ink/45 shrink-0" aria-hidden />
        <span className="text-[9px] px-1.5 py-0.5 rounded border border-ink/15 bg-ink/[0.03] text-ink/65 leading-tight">
          {compact}
        </span>
      </div>
    );
  };

  const candidateEntities = useMemo(
    () => candidates.map(r => ({ id: r.id, name: r.name })),
    [candidates],
  );

  /**
   * Sort applied rules first (`appliedTo.length > 0`), then the
   * orphan rules (rule exists + matches this spell but isn't yet
   * applied to any consumer). Within each group, alphabetical by
   * rule name so the listing is stable across reloads. The orphan
   * group at the bottom is a soft warning — "you've authored these
   * rules but they don't shape any consumer's list yet."
   */
  const sortedMemberships = useMemo(() => {
    return [...memberships].sort((a, b) => {
      const aApplied = a.appliedTo.length > 0;
      const bApplied = b.appliedTo.length > 0;
      if (aApplied !== bApplied) return aApplied ? -1 : 1;
      return a.ruleName.localeCompare(b.ruleName);
    });
  }, [memberships]);

  if (!spellId) {
    return (
      <div className={cn('text-xs text-ink/40 italic p-3', className)}>
        Select a spell to see its rule membership.
      </div>
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      {/* Add-to-rule picker FIRST — the typical curator workflow is
          "I have a new spell, I want to put it on these rules", so
          the picker is the primary affordance and gets the eye-level
          slot. Existing memberships read below as confirmation. */}
      {canEdit ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-ink/55">
              Add to rule
            </span>
            <span className="text-[9px] text-ink/35">
              {candidates.length === 0
                ? 'no candidates'
                : `${candidates.length} available`}
            </span>
          </div>
          {candidates.length === 0 ? (
            <p className="text-[10px] text-ink/35 italic">
              No rules left to add — every rule already includes this spell.
            </p>
          ) : (
            <EntityPicker
              entities={candidateEntities}
              selectedIds={[]}
              onChange={(next) => {
                if (next.length > 0) void handleAddRule(next[0]);
              }}
              single
              showChips={false}
              searchPlaceholder="Search rules to add…"
              emptyText="No rules match that name."
              noEntitiesText="No candidate rules."
            />
          )}
        </div>
      ) : null}

      {/* Status header — separates the picker from the membership
          listing. Single line so the section reads as a tight
          summary even when the membership list is empty. */}
      <div className="border-t border-gold/10 pt-3 text-[10px] font-bold uppercase tracking-[0.18em] text-ink/55">
        {loading
          ? 'Loading rule membership…'
          : memberships.length === 0
            ? 'Not on any rule.'
            : `On ${memberships.length} rule${memberships.length === 1 ? '' : 's'}`}
      </div>

      {/* Existing memberships — sorted so applied rules float to the
          top and orphan ones (rule matches but isn't applied to any
          consumer) sink to the bottom. */}
      {sortedMemberships.length > 0 ? (
        <div className="space-y-1.5">
          {sortedMemberships.map(m => {
            const isPending = pendingRuleIds.has(m.ruleId);
            return (
              <div
                key={m.ruleId}
                className="flex items-stretch gap-3 px-3 py-2 rounded border border-gold/15 bg-background/30 hover:border-gold/30 transition-colors"
              >
                {/* Left column — rule identity on top, applied-to
                    chips pinned to the bottom of the row via
                    `mt-auto`. The row's vertical height is dictated
                    by the right column (Remove + emblem stack); the
                    left column stretches to match and uses
                    flex-direction:column so the applied-to chip row
                    can hug the bottom edge instead of floating
                    directly under the rule name. */}
                <div className="flex-1 min-w-0 flex flex-col">
                  <Link
                    to={`${editorPrefix}/spell-rules?rule=${m.ruleId}`}
                    className="text-sm text-ink font-bold truncate max-w-[18rem] hover:text-gold inline-flex items-center gap-1 self-start"
                    title="Open in Spell Rules editor"
                  >
                    {m.ruleName}
                    <ExternalLink className="w-3 h-3 text-ink/30" aria-hidden />
                  </Link>
                  <div className="mt-auto pt-1">
                    {renderAppliedTo(m)}
                  </div>
                </div>
                {/* Right column — fixed width so the Remove button and
                    mechanism emblem visually align as a single
                    column. Both children stretch to the full width
                    (`w-full`) and centre their content. Vertical
                    eye-path: button on top, emblem directly below. */}
                <div className="flex flex-col items-stretch gap-1 shrink-0 w-[110px]">
                  {canEdit ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => handleRemove(m)}
                      disabled={isPending}
                      className="w-full h-7 px-2 text-[10px] uppercase tracking-[0.18em] border-gold/20 text-ink/45 hover:bg-blood/10 hover:text-blood hover:border-blood/40"
                      title={
                        m.via === 'manual'
                          ? "Removes the spell from this rule's manual list."
                          : "Excludes this spell from the rule's query match (overrides via manual_exclusions)."
                      }
                    >
                      {isPending ? '…' : <><X className="w-3 h-3 mr-0.5" />Remove</>}
                    </Button>
                  ) : null}
                  <StatusEmblem
                    tone={m.via === 'manual' ? 'manual' : 'auto'}
                    size="md"
                    className="w-full"
                    title={
                      m.via === 'manual'
                        ? 'Manual — the spell was added directly to this rule. Remove pops it back out.'
                        : "Auto — this rule's tag query matches the spell. Remove will override the match by excluding this spell only."
                    }
                  >
                    {m.via === 'manual' ? 'Manual' : 'Auto'}
                  </StatusEmblem>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

    </div>
  );
}
