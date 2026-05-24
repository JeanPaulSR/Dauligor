import React, { useMemo, useRef, useState } from 'react';
import {
  Filter,
  X,
  Search,
  Plus,
  ChevronDown,
  Sparkles,
  Tag as TagIcon,
  Hash,
  GraduationCap,
  Clock,
  Target,
  Hourglass,
  Box,
  Settings2,
  CornerDownLeft,
  Layers,
} from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { StatusEmblem } from '../../components/ui/StatusEmblem';
import { cn } from '../../lib/utils';

/**
 * Temporary mockup page — five wild variants for replacing the
 * current filter modal in FilterBar.tsx.
 *
 * The current modal (~600px-tall vertical scroll of axis sections
 * with chips, AND/OR/XOR toggles per section, a tag-search input
 * up top, Show All / Hide All) reads as cluttered when you have
 * 8+ filter axes. The variants below explore distinct UX models
 * for the same job.
 *
 * Each variant ships as its own component + trigger button. State
 * is local — none of this actually filters real data; it's purely
 * a look + feel sandbox.
 *
 * Visible at /mockup/filter-modal. Delete this file + the route
 * once the winning design lands in the real `FilterBar`.
 */

// ============================================================================
// Mock data — representative of the spell catalogue's filter surface.
// ============================================================================

const MOCK_SOURCES = [
  { id: 's-phb', name: 'PHB', count: 246 },
  { id: 's-xgte', name: 'XGtE', count: 88 },
  { id: 's-tce', name: 'TCoE', count: 39 },
  { id: 's-scag', name: 'SCAG', count: 18 },
  { id: 's-ftod', name: "Fizban's", count: 24 },
  { id: 's-vrgr', name: 'Van Richten', count: 12 },
  { id: 's-egw', name: 'Wildemount', count: 31 },
  { id: 's-acq', name: 'Acquisitions', count: 8 },
];

const MOCK_LEVELS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
const LEVEL_LABEL = (l: string) => (l === '0' ? 'Cantrip' : `Level ${l}`);

const MOCK_SCHOOLS = [
  { id: 'abj', name: 'Abjuration' },
  { id: 'con', name: 'Conjuration' },
  { id: 'div', name: 'Divination' },
  { id: 'enc', name: 'Enchantment' },
  { id: 'evo', name: 'Evocation' },
  { id: 'ill', name: 'Illusion' },
  { id: 'nec', name: 'Necromancy' },
  { id: 'tra', name: 'Transmutation' },
];

const MOCK_CAST_TIMES = [
  { id: 'action', name: 'Action' },
  { id: 'bonus', name: 'Bonus Action' },
  { id: 'reaction', name: 'Reaction' },
  { id: 'minute', name: '1 Minute' },
  { id: 'hour', name: '1+ Hour' },
  { id: 'special', name: 'Special' },
];

const MOCK_RANGES = [
  { id: 'self', name: 'Self' },
  { id: 'touch', name: 'Touch' },
  { id: '5ft', name: '5 ft' },
  { id: '30ft', name: '30 ft' },
  { id: '60ft', name: '60 ft' },
  { id: '120ft', name: '120 ft' },
  { id: 'long', name: '500+ ft' },
];

const MOCK_DURATIONS = [
  { id: 'inst', name: 'Instant' },
  { id: 'round', name: '1 Round' },
  { id: 'minute', name: '1+ Minute' },
  { id: 'hour', name: '1+ Hour' },
  { id: 'day', name: '1+ Day' },
  { id: 'perm', name: 'Permanent' },
];

const MOCK_SHAPES = [
  { id: 'cone', name: 'Cone' },
  { id: 'cube', name: 'Cube' },
  { id: 'cylinder', name: 'Cylinder' },
  { id: 'line', name: 'Line' },
  { id: 'sphere', name: 'Sphere' },
  { id: 'square', name: 'Square' },
];

const MOCK_PROPS = [
  { id: 'concentration', name: 'Concentration' },
  { id: 'ritual', name: 'Ritual' },
  { id: 'vocal', name: 'Verbal (V)' },
  { id: 'somatic', name: 'Somatic (S)' },
  { id: 'material', name: 'Material (M)' },
];

const MOCK_TAGS_GROUPED = [
  {
    group: 'Damage Type',
    tags: [
      { id: 't-fire', name: 'Fire', count: 38 },
      { id: 't-cold', name: 'Cold', count: 27 },
      { id: 't-lightning', name: 'Lightning', count: 24 },
      { id: 't-acid', name: 'Acid', count: 14 },
      { id: 't-necrotic', name: 'Necrotic', count: 22 },
      { id: 't-radiant', name: 'Radiant', count: 31 },
    ],
  },
  {
    group: 'Effect',
    tags: [
      { id: 't-heal', name: 'Healing', count: 19 },
      { id: 't-buff', name: 'Buff', count: 47 },
      { id: 't-debuff', name: 'Debuff', count: 33 },
      { id: 't-control', name: 'Control', count: 28 },
      { id: 't-summon', name: 'Summon', count: 16 },
    ],
  },
  {
    group: 'Theme',
    tags: [
      { id: 't-arcane', name: 'Arcane' },
      { id: 't-divine', name: 'Divine' },
      { id: 't-primal', name: 'Primal' },
      { id: 't-psionic', name: 'Psionic' },
    ],
  },
];

// All axes registered together so variant components can iterate /
// look up by id without each variant redeclaring its own list.
type AxisKey =
  | 'source' | 'level' | 'school' | 'castTime'
  | 'range' | 'duration' | 'shape' | 'props' | 'tags';

type AxisDescriptor = {
  key: AxisKey;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  values: { id: string; name: string; count?: number }[];
};

const AXIS_REGISTRY: AxisDescriptor[] = [
  { key: 'source', name: 'Source', icon: Layers, values: MOCK_SOURCES },
  { key: 'level', name: 'Spell Level', icon: Hash, values: MOCK_LEVELS.map(l => ({ id: l, name: LEVEL_LABEL(l) })) },
  { key: 'school', name: 'School', icon: GraduationCap, values: MOCK_SCHOOLS },
  { key: 'castTime', name: 'Casting Time', icon: Clock, values: MOCK_CAST_TIMES },
  { key: 'range', name: 'Range', icon: Target, values: MOCK_RANGES },
  { key: 'duration', name: 'Duration', icon: Hourglass, values: MOCK_DURATIONS },
  { key: 'shape', name: 'Shape', icon: Box, values: MOCK_SHAPES },
  { key: 'props', name: 'Properties', icon: Settings2, values: MOCK_PROPS },
  { key: 'tags', name: 'Tags', icon: TagIcon, values: MOCK_TAGS_GROUPED.flatMap(g => g.tags) },
];

// Shared selection state shape used by every variant: a Set of
// selected ids per axis. Real implementation would also model the
// include/exclude tri-state + combine modes — kept simple here so
// each variant focuses on layout rather than reproducing the full
// 3-state matrix.
type Selections = Record<AxisKey, Set<string>>;
const EMPTY_SELECTIONS: Selections = {
  source: new Set(), level: new Set(), school: new Set(), castTime: new Set(),
  range: new Set(), duration: new Set(), shape: new Set(), props: new Set(), tags: new Set(),
};

const cloneSelections = (s: Selections): Selections =>
  Object.fromEntries(Object.entries(s).map(([k, v]) => [k, new Set(v)])) as Selections;

const countActive = (s: Selections): number =>
  Object.values(s).reduce((acc, set) => acc + set.size, 0);

// ============================================================================
// Page entry — header + four variant cards stacked.
// ============================================================================

export default function FilterModalVariants() {
  return (
    <div className="min-h-screen bg-background p-6 lg:p-10">
      <div className="max-w-6xl mx-auto space-y-10">
        <header className="space-y-3">
          <h1 className="font-serif text-3xl text-gold">Filter modal — wild variants</h1>
          <p className="text-sm text-ink/65 max-w-prose">
            The current filter modal stacks 8+ axis sections vertically
            with chips, mode toggles, and a chip-label search up top.
            Reads as cluttered. Five wildly different alternatives
            below — each interactive (open / close, pick chips), each
            wired to local state so you can feel the shape. None of
            them filter real spells; the data is mock. Pick one (or
            mix-and-match) and we'll build it for real.
          </p>
        </header>

        <VariantCard
          letter="A"
          name="Sidebar Workbench"
          tagline="Axes on the left as a navigable list. Click one to edit its chips in the focused right pane. No vertical scroll through axes — only the active axis is on screen."
          good="Familiar (mirrors VS Code's settings UI). Active-counts visible at a glance. Reads as 'I'm configuring one axis' rather than 'I'm fighting a long scroll.'"
          tradeoff="Two clicks to edit an axis you haven't focused yet."
        >
          <SidebarWorkbenchTrigger />
        </VariantCard>

        <VariantCard
          letter="B"
          name="Sentence Builder"
          tagline="Filters read as a sentence: 'Show me spells from PHB at level 1, 2, 3 of school Evocation.' Each clause is an editable chip; '+ Add filter' adds another clause."
          good="Most discoverable for non-power-users. Filters speak English. Less visual noise — only your active filters render; everything else is hidden behind '+'."
          tradeoff="Exploring all available axes is slower (you have to open the + menu). Heavy filters look long."
        >
          <SentenceBuilderTrigger />
        </VariantCard>

        <VariantCard
          letter="C"
          name="Card Dashboard"
          tagline="A grid of cards — one per axis. Each card shows a compact summary of the current selection. Click a card to drill into the chips for that axis (inline expansion, no second modal)."
          good="Whole filter state visible in one screen. Cards naturally hint at hierarchy (related axes can group). Scales well as new axes are added."
          tradeoff="Card grid eats vertical space when most axes are empty. Drill-down adds a click."
        >
          <CardDashboardTrigger />
        </VariantCard>

        <VariantCard
          letter="D"
          name="Spotlight Palette"
          tagline="One search box. Type 'fire', 'level 3', 'ritual' — auto-complete suggests filter values from every axis at once. Hit Enter to apply. Active filters sit below as removable chips."
          good="Fastest for power-users. Keyboard-first. Discovery happens via type-as-you-go suggestions. No modal scroll."
          tradeoff="Heavy learning curve for casual users. 'I want to see all options at once' isn't supported — there's a fallback 'show all axes' button."
        >
          <SpotlightPaletteTrigger />
        </VariantCard>

        <VariantCard
          letter="E"
          name="Mini-Pill Wall (5e.tools)"
          tagline="Every filter value across every axis renders as a tiny pill, grouped by axis label, all visible at once. Left click cycles include → exclude → clear; right click cycles in reverse (exclude → include → clear) for one-click excludes. Search bar narrows pills by typed text. Lives ABOVE the result list — no modal needed."
          good="Maximum information density. Tri-state per pill plus left/right cycling means any state is one click away. Discovery is automatic — you see every available filter value without opening anything. Pairs naturally with an always-on side panel."
          tradeoff="Visual density can feel like a wall on first glance. Tri-state + dual-direction convention needs to be learned. Doesn't degrade gracefully on narrow screens (right-click is awkward on touch)."
        >
          <MiniPillWallTrigger />
        </VariantCard>

        <footer className="text-xs text-ink/50 italic pt-6">
          Pick a letter; I'll wire the winner into <code className="text-gold">FilterBar.tsx</code> and delete this page.
        </footer>
      </div>
    </div>
  );
}

// ============================================================================
// Shared chrome — variant card + the trigger pattern
// ============================================================================

function VariantCard({
  letter,
  name,
  tagline,
  good,
  tradeoff,
  children,
}: {
  letter: string;
  name: string;
  tagline: string;
  good: string;
  tradeoff: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="border-gold/20 bg-card/40 overflow-hidden">
      <div className="grid md:grid-cols-[140px_1fr] gap-0">
        <div className="bg-gold/5 border-r border-gold/10 p-5 flex flex-col items-center justify-center text-center">
          <span className="text-5xl font-serif text-gold">{letter}</span>
          <span className="text-[10px] uppercase tracking-[0.2em] text-ink/45 mt-2">variant</span>
        </div>
        <div className="p-5 space-y-3">
          <h2 className="text-xl font-bold text-ink tracking-wide">{name}</h2>
          <p className="text-sm text-ink/70">{tagline}</p>
          <div className="grid sm:grid-cols-2 gap-3 text-xs">
            <div className="rounded border border-emerald-500/30 bg-emerald-500/[0.04] p-3">
              <div className="text-[10px] uppercase tracking-widest text-emerald-500 font-bold mb-1">Good for</div>
              <p className="text-ink/70 leading-snug">{good}</p>
            </div>
            <div className="rounded border border-amber-400/30 bg-amber-400/[0.04] p-3">
              <div className="text-[10px] uppercase tracking-widest text-amber-400 font-bold mb-1">Trade-off</div>
              <p className="text-ink/70 leading-snug">{tradeoff}</p>
            </div>
          </div>
          <div className="pt-2">{children}</div>
        </div>
      </div>
    </Card>
  );
}

// Helper used by every variant trigger — opens / closes the variant
// modal and tracks its own selections.
function useFilterModal() {
  const [open, setOpen] = useState(false);
  const [selections, setSelections] = useState<Selections>(() => cloneSelections(EMPTY_SELECTIONS));
  const toggle = (axis: AxisKey, value: string) => {
    setSelections(prev => {
      const next = cloneSelections(prev);
      const set = next[axis];
      if (set.has(value)) set.delete(value);
      else set.add(value);
      return next;
    });
  };
  const reset = () => setSelections(cloneSelections(EMPTY_SELECTIONS));
  return { open, setOpen, selections, toggle, reset };
}

// Modal backdrop — same animation chrome the current FilterBar uses.
function ModalShell({
  open,
  onClose,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 md:p-10">
      <div
        className="absolute inset-0 bg-ink/40 backdrop-blur-sm animate-in fade-in duration-200"
        onClick={onClose}
      />
      <Card
        className={cn(
          'relative max-h-full overflow-hidden flex flex-col border-gold/20 bg-card shadow-2xl animate-in zoom-in-95 duration-200 pointer-events-auto',
          className,
        )}
      >
        {children}
      </Card>
    </div>
  );
}

// ============================================================================
// A — Sidebar Workbench
// ============================================================================

function SidebarWorkbenchTrigger() {
  const m = useFilterModal();
  const [activeAxis, setActiveAxis] = useState<AxisKey>('source');
  return (
    <>
      <Button onClick={() => m.setOpen(true)} className="bg-gold/15 text-gold border border-gold/30 hover:bg-gold/25">
        <Filter className="w-3 h-3 mr-2" /> Open Variant A
        {countActive(m.selections) > 0 && (
          <span className="ml-2 text-[10px] font-bold">({countActive(m.selections)})</span>
        )}
      </Button>
      <ModalShell open={m.open} onClose={() => m.setOpen(false)} className="w-full max-w-5xl h-[640px]">
        <header className="flex items-center justify-between px-5 py-3 border-b border-gold/10 bg-gold/5">
          <div className="flex items-center gap-3">
            <Filter className="w-4 h-4 text-gold" />
            <h2 className="text-base font-bold uppercase tracking-[0.2em] text-ink">Filters</h2>
            <span className="text-xs text-ink/40">{countActive(m.selections)} active · 243 / 539 spells</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={m.reset} className="text-ink/50 hover:text-blood">Reset</Button>
            <Button variant="ghost" size="sm" onClick={() => m.setOpen(false)} className="text-ink/40 hover:text-gold">
              <X className="w-4 h-4" />
            </Button>
          </div>
        </header>
        <div className="flex-1 grid grid-cols-[220px_1fr] min-h-0 overflow-hidden">
          {/* Left rail — axis list */}
          <nav className="border-r border-gold/10 bg-background/30 overflow-y-auto custom-scrollbar p-2 space-y-0.5">
            {AXIS_REGISTRY.map(axis => {
              const Icon = axis.icon;
              const activeCount = m.selections[axis.key].size;
              const isActive = activeAxis === axis.key;
              return (
                <button
                  key={axis.key}
                  type="button"
                  onClick={() => setActiveAxis(axis.key)}
                  className={cn(
                    'w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-left transition-colors text-xs',
                    isActive
                      ? 'bg-gold/15 text-gold border border-gold/30'
                      : 'text-ink/70 hover:bg-gold/5 border border-transparent',
                  )}
                >
                  <Icon className={cn('w-3.5 h-3.5 shrink-0', isActive ? 'text-gold' : 'text-ink/45')} />
                  <span className="flex-1 truncate font-bold uppercase tracking-widest text-[10px]">{axis.name}</span>
                  {activeCount > 0 && (
                    <StatusEmblem tone="manual" size="sm" className="shrink-0">
                      {activeCount}
                    </StatusEmblem>
                  )}
                </button>
              );
            })}
          </nav>
          {/* Right canvas — chips for the active axis */}
          <section className="overflow-y-auto custom-scrollbar p-6 space-y-4">
            {(() => {
              const axis = AXIS_REGISTRY.find(a => a.key === activeAxis)!;
              const Icon = axis.icon;
              return (
                <>
                  <div className="flex items-center gap-3 border-b border-gold/10 pb-3">
                    <Icon className="w-5 h-5 text-gold" />
                    <h3 className="text-lg font-bold text-ink">{axis.name}</h3>
                    <span className="text-xs text-ink/45">{axis.values.length} options</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {axis.values.map(v => {
                      const isSelected = m.selections[activeAxis].has(v.id);
                      return (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => m.toggle(activeAxis, v.id)}
                          className={cn(
                            'rounded border px-3 py-1.5 text-xs font-bold uppercase tracking-wide transition-all',
                            isSelected
                              ? 'border-gold/60 bg-gold/15 text-gold'
                              : 'border-gold/15 text-ink/55 hover:border-gold/30 hover:text-gold/80',
                          )}
                        >
                          {v.name}
                          {v.count !== undefined && (
                            <span className={cn('ml-2 text-[9px]', isSelected ? 'text-gold/70' : 'text-ink/30')}>
                              {v.count}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </>
              );
            })()}
          </section>
        </div>
        <footer className="px-5 py-3 border-t border-gold/10 bg-gold/5 flex items-center justify-end gap-2">
          <Button onClick={() => m.setOpen(false)} className="bg-gold text-white">Done</Button>
        </footer>
      </ModalShell>
    </>
  );
}

// ============================================================================
// B — Sentence Builder
// ============================================================================

function SentenceBuilderTrigger() {
  const m = useFilterModal();
  // Active axes are those with at least one selection. We seed with a
  // few so the page demos non-empty state on first open.
  const seededRef = useRef(false);
  const ensureSeed = () => {
    if (seededRef.current) return;
    seededRef.current = true;
    m.toggle('source', 's-phb');
    m.toggle('level', '1');
    m.toggle('level', '2');
    m.toggle('school', 'evo');
  };
  const [openAxisPopover, setOpenAxisPopover] = useState<AxisKey | null>(null);
  const [showAddMenu, setShowAddMenu] = useState(false);

  const activeAxes = AXIS_REGISTRY.filter(a => m.selections[a.key].size > 0);
  const availableAxes = AXIS_REGISTRY.filter(a => m.selections[a.key].size === 0);

  return (
    <>
      <Button
        onClick={() => { ensureSeed(); m.setOpen(true); }}
        className="bg-gold/15 text-gold border border-gold/30 hover:bg-gold/25"
      >
        <Filter className="w-3 h-3 mr-2" /> Open Variant B
        {countActive(m.selections) > 0 && (
          <span className="ml-2 text-[10px] font-bold">({countActive(m.selections)})</span>
        )}
      </Button>
      <ModalShell open={m.open} onClose={() => m.setOpen(false)} className="w-full max-w-3xl">
        <header className="flex items-center justify-between px-5 py-3 border-b border-gold/10 bg-gold/5">
          <div className="flex items-center gap-3">
            <Sparkles className="w-4 h-4 text-gold" />
            <h2 className="text-base font-bold uppercase tracking-[0.2em] text-ink">Build a Spell Filter</h2>
          </div>
          <Button variant="ghost" size="sm" onClick={() => m.setOpen(false)} className="text-ink/40 hover:text-gold">
            <X className="w-4 h-4" />
          </Button>
        </header>
        <div className="p-8 space-y-3 max-h-[60vh] overflow-y-auto custom-scrollbar">
          {/* Sentence-shaped layout: each active axis is a clause. */}
          <div className="text-lg leading-relaxed font-serif text-ink/85">
            Show me spells
            {activeAxes.map((axis, i) => (
              <React.Fragment key={axis.key}>
                {i === 0 ? ' ' : ', '}
                <SentenceClause
                  axis={axis}
                  selectedIds={Array.from(m.selections[axis.key])}
                  popoverOpen={openAxisPopover === axis.key}
                  onTogglePopover={() =>
                    setOpenAxisPopover(prev => (prev === axis.key ? null : axis.key))
                  }
                  onToggleValue={(id) => m.toggle(axis.key, id)}
                  onClearAll={() => {
                    const ids = Array.from(m.selections[axis.key]);
                    ids.forEach(id => m.toggle(axis.key, id));
                  }}
                />
              </React.Fragment>
            ))}
            {activeAxes.length === 0 && (
              <span className="italic text-ink/40"> (no filters yet — start by adding one)</span>
            )}
            <span className="text-ink/60">.</span>
          </div>
          {/* + Add filter button + menu */}
          <div className="relative pt-4">
            <button
              type="button"
              onClick={() => setShowAddMenu(s => !s)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-dashed border-gold/30 text-[11px] uppercase tracking-widest text-gold/80 hover:bg-gold/10 hover:border-gold transition-colors font-bold"
            >
              <Plus className="w-3 h-3" /> Add filter
            </button>
            {showAddMenu && availableAxes.length > 0 && (
              <div className="absolute z-10 mt-2 w-64 rounded-md border border-gold/30 bg-card shadow-lg p-1">
                {availableAxes.map(axis => {
                  const Icon = axis.icon;
                  return (
                    <button
                      key={axis.key}
                      type="button"
                      onClick={() => {
                        m.toggle(axis.key, axis.values[0].id);
                        setOpenAxisPopover(axis.key);
                        setShowAddMenu(false);
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-ink/75 hover:bg-gold/10 hover:text-gold rounded"
                    >
                      <Icon className="w-3.5 h-3.5 text-ink/45" />
                      <span className="flex-1 text-left">{axis.name}</span>
                      <span className="text-[9px] text-ink/35">{axis.values.length}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {showAddMenu && availableAxes.length === 0 && (
              <span className="ml-3 text-xs text-ink/40 italic">All filter axes are active.</span>
            )}
          </div>
        </div>
        <footer className="px-5 py-3 border-t border-gold/10 bg-gold/5 flex items-center justify-between gap-2">
          <span className="text-xs text-ink/60">
            <span className="text-gold font-bold">243</span> of <span className="text-ink/80">539</span> spells match
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={m.reset} className="text-ink/50 hover:text-blood">Reset</Button>
            <Button onClick={() => m.setOpen(false)} className="bg-gold text-white">Done</Button>
          </div>
        </footer>
      </ModalShell>
    </>
  );
}

function SentenceClause({
  axis,
  selectedIds,
  popoverOpen,
  onTogglePopover,
  onToggleValue,
  onClearAll,
}: {
  axis: AxisDescriptor;
  selectedIds: string[];
  popoverOpen: boolean;
  onTogglePopover: () => void;
  onToggleValue: (id: string) => void;
  onClearAll: () => void;
}) {
  const labels = selectedIds
    .map(id => axis.values.find(v => v.id === id)?.name ?? id);
  const preview = labels.length <= 3
    ? labels.join(', ')
    : `${labels.slice(0, 2).join(', ')} + ${labels.length - 2} more`;
  const linker = axis.key === 'source' ? 'from'
    : axis.key === 'level' ? 'at'
    : axis.key === 'school' ? 'of school'
    : axis.key === 'castTime' ? 'cast as'
    : axis.key === 'range' ? 'with range'
    : axis.key === 'duration' ? 'lasting'
    : axis.key === 'shape' ? 'shaped as'
    : axis.key === 'props' ? 'tagged'
    : 'about';
  return (
    <span className="relative inline-flex items-baseline gap-1">
      <span className="text-ink/55">{linker}</span>
      <button
        type="button"
        onClick={onTogglePopover}
        className="inline-flex items-center gap-1 rounded border border-gold/30 bg-gold/10 px-2 py-0.5 text-base font-bold text-gold hover:bg-gold/20 transition-colors"
      >
        {preview || axis.name}
        <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', popoverOpen && 'rotate-180')} />
      </button>
      {popoverOpen && (
        <div className="absolute top-full left-0 mt-2 w-72 rounded-md border border-gold/30 bg-card shadow-lg z-10 p-3 text-sm font-sans">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] uppercase tracking-widest text-ink/55 font-bold">{axis.name}</span>
            <button
              type="button"
              onClick={onClearAll}
              className="text-[10px] uppercase tracking-widest text-ink/40 hover:text-blood"
            >
              Clear
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {axis.values.map(v => {
              const isSelected = selectedIds.includes(v.id);
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => onToggleValue(v.id)}
                  className={cn(
                    'rounded border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide transition-colors',
                    isSelected
                      ? 'border-gold/60 bg-gold/15 text-gold'
                      : 'border-gold/15 text-ink/55 hover:border-gold/30',
                  )}
                >
                  {v.name}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </span>
  );
}

// ============================================================================
// C — Card Dashboard
// ============================================================================

function CardDashboardTrigger() {
  const m = useFilterModal();
  const [expandedAxis, setExpandedAxis] = useState<AxisKey | null>(null);
  return (
    <>
      <Button onClick={() => m.setOpen(true)} className="bg-gold/15 text-gold border border-gold/30 hover:bg-gold/25">
        <Filter className="w-3 h-3 mr-2" /> Open Variant C
        {countActive(m.selections) > 0 && (
          <span className="ml-2 text-[10px] font-bold">({countActive(m.selections)})</span>
        )}
      </Button>
      <ModalShell open={m.open} onClose={() => m.setOpen(false)} className="w-full max-w-5xl">
        <header className="flex items-center justify-between px-5 py-3 border-b border-gold/10 bg-gold/5">
          <div className="flex items-center gap-3">
            <Filter className="w-4 h-4 text-gold" />
            <h2 className="text-base font-bold uppercase tracking-[0.2em] text-ink">Filters · Dashboard</h2>
            <span className="text-xs text-ink/40">
              <span className="text-gold font-bold">243</span> of 539 spells
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={m.reset} className="text-ink/50 hover:text-blood">Reset</Button>
            <Button variant="ghost" size="sm" onClick={() => m.setOpen(false)} className="text-ink/40 hover:text-gold">
              <X className="w-4 h-4" />
            </Button>
          </div>
        </header>
        <div className="p-5 grid grid-cols-2 md:grid-cols-3 gap-3 max-h-[60vh] overflow-y-auto custom-scrollbar">
          {AXIS_REGISTRY.map(axis => {
            const Icon = axis.icon;
            const selected = m.selections[axis.key];
            const isActive = selected.size > 0;
            const isExpanded = expandedAxis === axis.key;
            const labels = Array.from(selected)
              .map(id => axis.values.find(v => v.id === id)?.name ?? id);
            const summary = labels.length === 0
              ? '—'
              : labels.length <= 2
                ? labels.join(', ')
                : `${labels[0]} +${labels.length - 1}`;
            return (
              <div
                key={axis.key}
                className={cn(
                  'rounded border transition-all',
                  isActive ? 'border-gold/40 bg-gold/[0.06]' : 'border-gold/15 bg-background/20 hover:border-gold/30',
                  isExpanded && 'col-span-full md:col-span-3 row-span-2',
                )}
              >
                <button
                  type="button"
                  onClick={() => setExpandedAxis(prev => (prev === axis.key ? null : axis.key))}
                  className="w-full p-4 text-left"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Icon className={cn('w-4 h-4', isActive ? 'text-gold' : 'text-ink/45')} />
                    <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-ink/70">{axis.name}</span>
                    <span className="ml-auto text-[10px] text-ink/40">
                      {selected.size} / {axis.values.length}
                    </span>
                    <ChevronDown className={cn('w-3.5 h-3.5 text-ink/40 transition-transform', isExpanded && 'rotate-180')} />
                  </div>
                  <div className={cn('text-sm truncate', isActive ? 'text-gold/90 font-bold' : 'text-ink/40 italic')}>
                    {summary}
                  </div>
                </button>
                {isExpanded && (
                  <div className="border-t border-gold/15 p-4 bg-background/30">
                    <div className="flex flex-wrap gap-1.5">
                      {axis.values.map(v => {
                        const isSelected = selected.has(v.id);
                        return (
                          <button
                            key={v.id}
                            type="button"
                            onClick={() => m.toggle(axis.key, v.id)}
                            className={cn(
                              'rounded border px-2 py-1 text-[11px] font-bold uppercase tracking-wide transition-colors',
                              isSelected
                                ? 'border-gold/60 bg-gold/15 text-gold'
                                : 'border-gold/15 text-ink/55 hover:border-gold/30',
                            )}
                          >
                            {v.name}
                            {v.count !== undefined && (
                              <span className={cn('ml-1.5 text-[9px]', isSelected ? 'text-gold/70' : 'text-ink/30')}>
                                {v.count}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <footer className="px-5 py-3 border-t border-gold/10 bg-gold/5 flex justify-end gap-2">
          <Button onClick={() => m.setOpen(false)} className="bg-gold text-white">Done</Button>
        </footer>
      </ModalShell>
    </>
  );
}

// ============================================================================
// D — Spotlight Palette
// ============================================================================

function SpotlightPaletteTrigger() {
  const m = useFilterModal();
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Build a flat suggestion list: every (axis, value) pair filtered
  // by the typed query against the value name + axis name.
  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [] as Array<{ axis: AxisDescriptor; value: { id: string; name: string; count?: number } }>;
    const out: Array<{ axis: AxisDescriptor; value: { id: string; name: string; count?: number } }> = [];
    for (const axis of AXIS_REGISTRY) {
      for (const v of axis.values) {
        if (m.selections[axis.key].has(v.id)) continue;
        const text = `${axis.name} ${v.name}`.toLowerCase();
        if (text.includes(q)) out.push({ axis, value: v });
      }
    }
    return out.slice(0, 8);
  }, [query, m.selections]);

  const apply = (axisKey: AxisKey, valueId: string) => {
    m.toggle(axisKey, valueId);
    setQuery('');
    setHighlight(0);
    inputRef.current?.focus();
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight(h => Math.min(h + 1, Math.max(0, suggestions.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight(h => Math.max(0, h - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = suggestions[highlight];
      if (pick) apply(pick.axis.key, pick.value.id);
    }
  };

  return (
    <>
      <Button onClick={() => { m.setOpen(true); setTimeout(() => inputRef.current?.focus(), 50); }}
        className="bg-gold/15 text-gold border border-gold/30 hover:bg-gold/25">
        <Filter className="w-3 h-3 mr-2" /> Open Variant D
        {countActive(m.selections) > 0 && (
          <span className="ml-2 text-[10px] font-bold">({countActive(m.selections)})</span>
        )}
      </Button>
      <ModalShell open={m.open} onClose={() => m.setOpen(false)} className="w-full max-w-2xl">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gold/10 bg-background/30">
          <Search className="w-5 h-5 text-gold shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); setHighlight(0); }}
            onKeyDown={handleKey}
            placeholder="Type to filter: fire, level 3, ritual, PHB…"
            className="flex-1 bg-transparent text-base outline-none placeholder:text-ink/30 text-ink"
            autoFocus
          />
          <kbd className="hidden sm:inline text-[10px] uppercase tracking-widest text-ink/40 border border-gold/15 rounded px-1.5 py-0.5">esc</kbd>
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-3 max-h-[60vh]">
          {suggestions.length > 0 ? (
            <div>
              <div className="text-[10px] uppercase tracking-widest text-ink/45 font-bold px-2 py-1">Suggestions</div>
              <div className="space-y-0.5">
                {suggestions.map((s, idx) => {
                  const Icon = s.axis.icon;
                  return (
                    <button
                      key={`${s.axis.key}-${s.value.id}`}
                      type="button"
                      onClick={() => apply(s.axis.key, s.value.id)}
                      onMouseEnter={() => setHighlight(idx)}
                      className={cn(
                        'w-full flex items-center gap-3 px-3 py-2 rounded text-left transition-colors',
                        idx === highlight ? 'bg-gold/15 text-gold' : 'text-ink/80 hover:bg-gold/10',
                      )}
                    >
                      <Icon className={cn('w-4 h-4 shrink-0', idx === highlight ? 'text-gold' : 'text-ink/45')} />
                      <span className="text-[9px] uppercase tracking-widest text-ink/45 font-bold w-20 shrink-0">
                        {s.axis.name}
                      </span>
                      <span className="text-sm font-bold flex-1">{s.value.name}</span>
                      {s.value.count !== undefined && (
                        <span className="text-[10px] text-ink/40">{s.value.count} spells</span>
                      )}
                      {idx === highlight && (
                        <CornerDownLeft className="w-3.5 h-3.5 text-gold/60 shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : query ? (
            <div className="text-center py-8 text-sm text-ink/40 italic">No matches for "{query}"</div>
          ) : (
            <div className="text-center py-8 text-sm text-ink/40 italic">
              Start typing to search across every filter axis.
              <div className="mt-2 text-[10px] uppercase tracking-widest text-ink/35">
                Try: <span className="text-gold/60">fire</span> · <span className="text-gold/60">level 3</span> · <span className="text-gold/60">ritual</span>
              </div>
            </div>
          )}
          {countActive(m.selections) > 0 && (
            <div className="pt-3 border-t border-gold/10">
              <div className="text-[10px] uppercase tracking-widest text-ink/45 font-bold px-2 py-1">Active</div>
              <div className="flex flex-wrap gap-1.5 px-2">
                {AXIS_REGISTRY.flatMap(axis =>
                  Array.from(m.selections[axis.key]).map(id => {
                    const v = axis.values.find(vv => vv.id === id);
                    if (!v) return null;
                    return (
                      <button
                        key={`${axis.key}-${id}`}
                        type="button"
                        onClick={() => m.toggle(axis.key, id)}
                        className="inline-flex items-center gap-1.5 rounded-full border border-gold/40 bg-gold/15 pl-2.5 pr-1.5 py-1 text-[11px] font-bold text-gold hover:bg-blood/15 hover:text-blood hover:border-blood/40 transition-colors group"
                        title={`${axis.name}: ${v.name}`}
                      >
                        <span className="text-[8px] uppercase tracking-widest text-gold/60 group-hover:text-blood/60">
                          {axis.name}
                        </span>
                        {v.name}
                        <X className="w-2.5 h-2.5" />
                      </button>
                    );
                  })
                ).filter(Boolean)}
              </div>
            </div>
          )}
        </div>
        <footer className="px-5 py-3 border-t border-gold/10 bg-gold/5 flex items-center justify-between gap-2">
          <span className="text-xs text-ink/55">
            <span className="text-gold font-bold">243</span> of 539 spells · {countActive(m.selections)} filters active
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={m.reset} className="text-ink/50 hover:text-blood">Clear all</Button>
            <Button onClick={() => m.setOpen(false)} className="bg-gold text-white">Done</Button>
          </div>
        </footer>
      </ModalShell>
    </>
  );
}

// ============================================================================
// E — Mini-Pill Wall (5e.tools-inspired)
// ============================================================================
//
// Departs from the modal-only mental model used by A–D: in production
// this panel would live ABOVE the result list as a persistent strip,
// not behind a button. We mock it as a modal here only so it stacks
// fairly against the others on the variant page.
//
// Each pill is tri-state: off → include (+) → exclude (−) → off.
// One click does what A/B/C take two clicks for ("pick a chip + close
// the picker"), at the cost of a learned convention.
//
// A few seeded pills (PHB, Cantrip, Level 1, Fire, Concentration) so
// the page demos non-empty state and the tri-state coloring on first
// open.

type PillState = 'include' | 'exclude';

function MiniPillWallTrigger() {
  const [open, setOpen] = useState(false);
  const [pillStates, setPillStates] = useState<Record<string, PillState>>({});
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'level' | 'school' | 'source' | 'time' | 'range'>('name');
  const seededRef = useRef(false);

  const ensureSeed = () => {
    if (seededRef.current) return;
    seededRef.current = true;
    setPillStates({
      'source:s-phb': 'include',
      'level:0': 'include',
      'level:1': 'include',
      'tags:t-fire': 'include',
      'props:concentration': 'exclude',
    });
  };

  // Left click cycles forward: off → include → exclude → off.
  // Right click cycles in reverse: off → exclude → include → off.
  // Lets a power user toggle exclude directly without two clicks.
  const cyclePill = (axisKey: AxisKey, valueId: string, direction: 'forward' | 'reverse') => {
    const key = `${axisKey}:${valueId}`;
    setPillStates(prev => {
      const current = prev[key];
      const next: PillState | undefined = direction === 'forward'
        ? (current === undefined ? 'include' : current === 'include' ? 'exclude' : undefined)
        : (current === undefined ? 'exclude' : current === 'exclude' ? 'include' : undefined);
      const out = { ...prev };
      if (next === undefined) delete out[key];
      else out[key] = next;
      return out;
    });
  };

  const reset = () => setPillStates({});

  const counts = useMemo(() => {
    let include = 0, exclude = 0;
    Object.values(pillStates).forEach(s => {
      if (s === 'include') include++;
      else if (s === 'exclude') exclude++;
    });
    return { include, exclude, total: include + exclude };
  }, [pillStates]);

  const queryLower = query.trim().toLowerCase();
  const matchesQuery = (axis: AxisDescriptor, v: { name: string }) => {
    if (!queryLower) return true;
    return v.name.toLowerCase().includes(queryLower) ||
           axis.name.toLowerCase().includes(queryLower);
  };

  const sortOptions: Array<{ key: typeof sortBy; label: string }> = [
    { key: 'name', label: 'Name' },
    { key: 'level', label: 'Level' },
    { key: 'school', label: 'School' },
    { key: 'source', label: 'Source' },
    { key: 'time', label: 'Time' },
    { key: 'range', label: 'Range' },
  ];

  return (
    <>
      <Button
        onClick={() => { ensureSeed(); setOpen(true); }}
        className="bg-gold/15 text-gold border border-gold/30 hover:bg-gold/25"
      >
        <Filter className="w-3 h-3 mr-2" /> Open Variant E
        {counts.total > 0 && (
          <span className="ml-2 text-[10px] font-bold">({counts.total})</span>
        )}
      </Button>
      <ModalShell open={open} onClose={() => setOpen(false)} className="w-full max-w-6xl h-[720px]">
        {/* Top row — search + count + sort + actions, all on one strip */}
        <header className="px-5 py-2.5 border-b border-gold/10 bg-gold/5 space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 border border-gold/15 rounded px-2 py-1 bg-background/30 min-w-[260px]">
              <Search className="w-3.5 h-3.5 text-gold/70 shrink-0" />
              <input
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search spells (or pill names)…"
                className="bg-transparent outline-none placeholder:text-ink/30 text-ink text-xs flex-1 min-w-0"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="text-ink/40 hover:text-blood shrink-0"
                  title="Clear search"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
            <div className="flex items-baseline gap-1 px-2.5 py-1 border border-gold/15 rounded bg-background/30">
              <span className="text-base font-bold text-gold">243</span>
              <span className="text-[10px] text-ink/40">/</span>
              <span className="text-[11px] text-ink/55">539</span>
              <span className="text-[9px] uppercase tracking-widest text-ink/40 ml-1">matches</span>
            </div>
            {counts.include > 0 && (
              <StatusEmblem tone="success" size="sm">+{counts.include}</StatusEmblem>
            )}
            {counts.exclude > 0 && (
              <StatusEmblem tone="error" size="sm">−{counts.exclude}</StatusEmblem>
            )}
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                className="text-[10px] uppercase tracking-widest text-ink/55 hover:text-gold px-2 py-1 rounded border border-gold/10 hover:border-gold/30 inline-flex items-center gap-1"
                title="Advanced filters (range sliders, regex, etc.)"
              >
                <Settings2 className="w-3 h-3" />
                Advanced
              </button>
              <Button variant="ghost" size="sm" onClick={reset} className="text-ink/50 hover:text-blood">Reset</Button>
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)} className="text-ink/40 hover:text-gold">
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
          {/* Sort row */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[9px] uppercase tracking-widest text-ink/40 mr-1">Sort</span>
            {sortOptions.map(s => {
              const active = sortBy === s.key;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setSortBy(s.key)}
                  className={cn(
                    'text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded border transition-colors',
                    active
                      ? 'border-gold/40 bg-gold/10 text-gold'
                      : 'border-gold/10 text-ink/55 hover:text-gold hover:border-gold/30',
                  )}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
        </header>

        {/* Pill wall — every axis, every value, simultaneously visible */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3">
          {AXIS_REGISTRY.map(axis => {
            const Icon = axis.icon;
            const axisCount = axis.values.reduce((acc, v) => {
              const key = `${axis.key}:${v.id}`;
              return pillStates[key] ? acc + 1 : acc;
            }, 0);
            return (
              <div key={axis.key} className="rounded border border-gold/10 bg-background/20 p-2.5">
                <div className="flex items-baseline gap-2 mb-1.5">
                  <Icon className="w-3 h-3 text-ink/40" />
                  <span className="text-[9px] uppercase tracking-[0.22em] text-ink/60 font-bold">{axis.name}</span>
                  <span className="text-[9px] text-ink/30">{axis.values.length}</span>
                  {axisCount > 0 && (
                    <span className="text-[9px] text-gold/70 font-bold">· {axisCount} active</span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1">
                  {axis.values.map(v => {
                    const key = `${axis.key}:${v.id}`;
                    const state = pillStates[key];
                    const dimmed = queryLower !== '' && !matchesQuery(axis, v);
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => cyclePill(axis.key, v.id, 'forward')}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          cyclePill(axis.key, v.id, 'reverse');
                        }}
                        className={cn(
                          'inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide transition-colors select-none',
                          state === undefined && 'border-gold/15 bg-card text-ink/55 hover:border-gold/40 hover:text-ink/90',
                          state === 'include' && 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300',
                          state === 'exclude' && 'border-blood/50 bg-blood/15 text-blood line-through',
                          dimmed && 'opacity-20',
                        )}
                        title={
                          state === undefined
                            ? `"${v.name}"\nLeft click: include\nRight click: exclude`
                            : state === 'include'
                              ? `Including "${v.name}"\nLeft click: exclude\nRight click: clear`
                              : `Excluding "${v.name}"\nLeft click: clear\nRight click: include`
                        }
                      >
                        {state === 'include' && <span className="text-emerald-400/80">+</span>}
                        {state === 'exclude' && <span className="text-blood/70">−</span>}
                        <span>{v.name}</span>
                        {v.count !== undefined && state === undefined && (
                          <span className="text-[8px] text-ink/30 ml-0.5">·{v.count}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer — tri-state legend (left + right click) + Done */}
        <footer className="px-5 py-2.5 border-t border-gold/10 bg-gold/5 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4 text-[10px] text-ink/55 flex-wrap">
            <div className="inline-flex items-center gap-1.5">
              <span className="text-[9px] uppercase tracking-widest text-ink/40 font-bold">Left click</span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block w-2.5 h-2.5 border border-gold/30 rounded-sm bg-card" />
                <span className="text-ink/30">›</span>
                <span className="inline-block w-2.5 h-2.5 border border-emerald-500/50 rounded-sm bg-emerald-500/30" />
                <span className="text-ink/30">›</span>
                <span className="inline-block w-2.5 h-2.5 border border-blood/50 rounded-sm bg-blood/30" />
                <span className="text-ink/30">›</span>
                <span className="inline-block w-2.5 h-2.5 border border-gold/30 rounded-sm bg-card" />
              </span>
              <span className="text-ink/45 italic">include → exclude → clear</span>
            </div>
            <div className="inline-flex items-center gap-1.5">
              <span className="text-[9px] uppercase tracking-widest text-ink/40 font-bold">Right click</span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block w-2.5 h-2.5 border border-gold/30 rounded-sm bg-card" />
                <span className="text-ink/30">›</span>
                <span className="inline-block w-2.5 h-2.5 border border-blood/50 rounded-sm bg-blood/30" />
                <span className="text-ink/30">›</span>
                <span className="inline-block w-2.5 h-2.5 border border-emerald-500/50 rounded-sm bg-emerald-500/30" />
                <span className="text-ink/30">›</span>
                <span className="inline-block w-2.5 h-2.5 border border-gold/30 rounded-sm bg-card" />
              </span>
              <span className="text-ink/45 italic">exclude → include → clear</span>
            </div>
          </div>
          <Button onClick={() => setOpen(false)} className="bg-gold text-white">Done</Button>
        </footer>
      </ModalShell>
    </>
  );
}
