import React, { useEffect, useMemo, useState } from 'react';
import {
  ShieldCheck,
  Crosshair,
  Brain,
  Hammer,
  Settings,
  MessageCircle,
  Skull,
  Star,
  Award,
  Wand2,
  ChevronLeft,
  type LucideIcon,
} from 'lucide-react';
import { queryD1 } from '../../lib/d1';
import { Button } from '../../components/ui/button';
import { SearchInput } from '../../components/ui/SearchInput';

import SkillsEditor from '../compendium/SkillsEditor';
import ToolsEditor from '../compendium/ToolsEditor';
import WeaponsEditor from './WeaponsEditor';
import ArmorEditor from './ArmorEditor';
import ProficiencyEntityShell from '../../components/compendium/ProficiencyEntityShell';
import SpellcastingAdvancementManager from './SpellcastingAdvancementManager';

/**
 * Shared taxonomy-tab config: every simple-taxonomy tab (categories,
 * properties, attributes, etc.) drives the shell with the same
 * boilerplate (no foundry alias, no source, no basic-rules, with
 * order column). Pulled out so the per-tab render stays as a single
 * line. The `attributes` tab is the lone wrinkle — its identifier
 * must be uppercased (STR / DEX / CON / …).
 */
const TAXONOMY_TAB_BASE = {
  includeAbility: false,
  includeFoundryAlias: false,
  includeSource: false,
  includeBasicRules: false,
  includeOrder: true,
} as const;

// ─── Tab catalog ─────────────────────────────────────────────────────────────
//
// `parent` marks an entry whose authoring depends on another taxonomy
// (Tools depends on Tool Categories existing first), so the parent
// taxonomy is the natural top-of-domain entry and the child indents
// under it. Array order within a group drives display order.
//
// Past versions of this page (pre-2026-05-21) listed items as the
// parents with categories indented under them. Inverted on user
// feedback: authors build the categories first, then assign items to
// them, so categories should be the top layer.

type GroupKey = 'combat' | 'language' | 'system';

interface TabEntry {
  id: string;
  label: string;
  icon: LucideIcon;
  group: GroupKey;
  /** If set, this entry indents under the parent id within the group. */
  parent?: string;
  /** D1 table name for the row-count badge. Omit for one-off editors. */
  countTable?: string;
}

const GROUP_LABELS: Record<GroupKey, string> = {
  combat: 'Combat',
  language: 'Language',
  system: 'Game System',
};

const TABS: TabEntry[] = [
  { id: 'toolCategories', label: 'Tool Categories', icon: Hammer, group: 'combat', countTable: 'toolCategories' },
  { id: 'tools', label: 'Tools', icon: Hammer, group: 'combat', parent: 'toolCategories', countTable: 'tools' },
  { id: 'weaponCategories', label: 'Weapon Categories', icon: Crosshair, group: 'combat', countTable: 'weaponCategories' },
  { id: 'weaponProperties', label: 'Weapon Properties', icon: Hammer, group: 'combat', countTable: 'weaponProperties' },
  { id: 'weapons', label: 'Weapons', icon: Crosshair, group: 'combat', parent: 'weaponCategories', countTable: 'weapons' },
  { id: 'armorCategories', label: 'Armor Categories', icon: ShieldCheck, group: 'combat', countTable: 'armorCategories' },
  { id: 'armor', label: 'Armor', icon: ShieldCheck, group: 'combat', parent: 'armorCategories', countTable: 'armor' },
  { id: 'skills', label: 'Skills', icon: Brain, group: 'combat', countTable: 'skills' },
  { id: 'languageCategories', label: 'Language Categories', icon: MessageCircle, group: 'language', countTable: 'languageCategories' },
  { id: 'languages', label: 'Languages', icon: MessageCircle, group: 'language', parent: 'languageCategories', countTable: 'languages' },
  { id: 'damageTypes', label: 'Damage Types', icon: Skull, group: 'system', countTable: 'damageTypes' },
  { id: 'attributes', label: 'Attributes', icon: Star, group: 'system', countTable: 'attributes' },
  // Admin-managed feat taxonomy. Drives the per-row "Category"
  // column in /compendium/feats and the picker in the FeatsEditor.
  // Lives alongside Attributes / Damage Types since it's a system-
  // wide classification rather than combat-specific.
  { id: 'featCategories', label: 'Feat Categories', icon: Award, group: 'system', countTable: 'featCategories' },
  { id: 'spellcasting', label: 'Spellcasting', icon: Wand2, group: 'system' },
];

const TAB_BY_ID: Record<string, TabEntry> = Object.fromEntries(
  TABS.map((tab) => [tab.id, tab]),
);

// SQL identifier allow-list: countTable values must appear here before
// they're interpolated into the COUNT query. Keeps the query string
// safe even though all current values come from a hardcoded list.
const COUNTABLE_TABLES = new Set(
  TABS.map((t) => t.countTable).filter((t): t is string => !!t),
);

const ACTIVE_TAB_STORAGE_KEY = 'dauligor.adminProficiencies.activeTab.v1';
const DEFAULT_ACTIVE_ID = 'skills';

function loadStoredActiveTab(): string {
  if (typeof window === 'undefined') return DEFAULT_ACTIVE_ID;
  try {
    const stored = window.localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
    if (stored && TAB_BY_ID[stored]) return stored;
  } catch {
    /* localStorage unavailable; ignore */
  }
  return DEFAULT_ACTIVE_ID;
}

// ─── Page ────────────────────────────────────────────────────────────────────

/**
 * Below `lg`, the layout collapses to a master-detail flow: only one
 * pane is visible at a time, with a back button in the body that
 * returns to the rail. At `lg+` both panes are shown side-by-side
 * and `activeView` is effectively ignored (CSS keeps both visible).
 */
type ActiveView = 'rail' | 'body';

export default function AdminProficiencies({ userProfile }: { userProfile: any }) {
  const [activeTab, setActiveTab] = useState<string>(loadStoredActiveTab);
  const [activeView, setActiveView] = useState<ActiveView>('rail');
  const [search, setSearch] = useState('');
  const [counts, setCounts] = useState<Record<string, number>>({});

  // Opt into fullscreen layout: strips the global <main>'s padding and
  // max-width so this page can fill the viewport, and locks body
  // overflow so the rail and editor body are the only scroll surfaces.
  // The class itself is scoped to `lg+` via a media query in
  // src/index.css so narrow screens scroll the document normally.
  // We tag both <html> and <body> so the page-scroll scrollbar styling
  // (which targets the actual scroll-owning element — html in Firefox,
  // either in Chrome/Safari) lands consistently across browsers.
  useEffect(() => {
    document.documentElement.classList.add('admin-page-fullscreen');
    document.body.classList.add('admin-page-fullscreen');
    return () => {
      document.documentElement.classList.remove('admin-page-fullscreen');
      document.body.classList.remove('admin-page-fullscreen');
    };
  }, []);

  // Persist active tab on change.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, activeTab);
    } catch {
      /* ignore */
    }
  }, [activeTab]);

  // Lazy-load row counts. Each `SELECT COUNT(*) FROM <table>` is a
  // lightweight single-row query, cached by queryD1's normal caching
  // layer. We don't fetch a count for tabs without a `countTable`
  // (e.g., Spellcasting which is a single-document editor).
  useEffect(() => {
    if (userProfile?.role !== 'admin') return;
    let active = true;

    const tablesToCount = Array.from(COUNTABLE_TABLES);
    Promise.all(
      tablesToCount.map(async (table) => {
        try {
          const rows = await queryD1<{ n: number }>(
            `SELECT COUNT(*) AS n FROM ${table}`,
          );
          return [table, Number(rows?.[0]?.n ?? 0)] as const;
        } catch {
          return [table, 0] as const;
        }
      }),
    ).then((entries) => {
      if (!active) return;
      setCounts(Object.fromEntries(entries));
    });

    return () => {
      active = false;
    };
  }, [userProfile?.role]);

  const grouped = useMemo(() => {
    const byGroup: Record<GroupKey, TabEntry[]> = {
      combat: [],
      language: [],
      system: [],
    };
    for (const tab of TABS) byGroup[tab.group].push(tab);
    return byGroup;
  }, []);

  const matchesSearch = (tab: TabEntry): boolean => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      tab.label.toLowerCase().includes(q) ||
      tab.id.toLowerCase().includes(q) ||
      GROUP_LABELS[tab.group].toLowerCase().includes(q)
    );
  };

  // Selecting a tab always pushes the user into the body view. At lg+
  // this is a no-op (the body was already visible); at narrow widths
  // it triggers the master→detail transition.
  const handleSelectTab = (tabId: string) => {
    setActiveTab(tabId);
    setActiveView('body');
  };

  const handleBackToRail = () => {
    setActiveView('rail');
  };

  if (userProfile?.role !== 'admin') {
    return <div className="text-center py-20">Access Denied. Admins only.</div>;
  }

  const activeTabEntry = TAB_BY_ID[activeTab];

  return (
    // Outer wrapper: at lg+ we lock the page to viewport-minus-chrome so
    // only the inner panes scroll. Below lg the wrapper falls back to
    // its natural height and the document scrolls normally. The `4rem`
    // subtraction matches the global navbar height; the main padding
    // is stripped by the `admin-page-fullscreen` body class
    // at every viewport (so the breadcrumb sits close to the navbar
    // on mobile rather than 64px below it).
    <div className="lg:h-[calc(100vh-4rem)] flex flex-col gap-2 lg:gap-4 max-w-7xl mx-auto w-full px-3 sm:px-4 py-2 lg:py-4">
      {/* Page header. Visible at lg+ always; at narrow widths only on
          the rail view (the body has its own back-nav header). */}
      <header className={`shrink-0 lg:pt-2 ${activeView === 'rail' ? '' : 'hidden'} lg:block`}>
        <div className="flex items-center gap-3 text-gold mb-1">
          <Settings className="w-5 h-5" />
          <span className="text-xs font-bold uppercase tracking-[0.3em]">
            Admin Tools
          </span>
        </div>
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-2">
          <div className="space-y-1">
            <h1 className="text-3xl font-serif font-bold text-ink tracking-tight uppercase">
              Proficiencies Manager
            </h1>
            <p className="text-ink/60 font-serif italic text-sm">
              Core skills, tools, weapons, armor, languages, damage types, and
              attributes for your game system.
            </p>
          </div>
        </div>
      </header>

      <div className="flex flex-col lg:flex-row gap-4 lg:min-h-0 flex-1">
        {/* Left rail — visible at lg+ always; at narrow widths only
            when activeView is 'rail'. */}
        <aside
          data-admin-proficiencies-rail
          className={`border border-gold/10 rounded-lg bg-card/40 shrink-0 lg:w-[260px] flex-col lg:min-h-0 ${
            activeView === 'rail' ? 'flex' : 'hidden'
          } lg:flex`}
        >
          {/* Search */}
          <div className="p-3 border-b border-gold/10 shrink-0">
            <label className="text-[9px] uppercase tracking-widest font-bold text-ink/40 block mb-1.5 px-1">
              Find proficiency
            </label>
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Filter the list…"
              size="sm"
            />
          </div>

          {/* Nav list */}
          <nav className="lg:flex-1 lg:overflow-y-auto custom-scrollbar p-3 space-y-4">
            {(Object.keys(GROUP_LABELS) as GroupKey[]).map((group) => {
              const items = grouped[group].filter(matchesSearch);
              if (items.length === 0) return null;
              return (
                <div key={group} className="space-y-1">
                  <div className="text-[9px] font-bold uppercase tracking-[0.25em] text-gold/60 px-2 py-1 border-b border-gold/5 mb-1">
                    {GROUP_LABELS[group]}
                  </div>
                  {items.map((tab) => {
                    const active = tab.id === activeTab;
                    const Icon = tab.icon;
                    const countValue = tab.countTable
                      ? counts[tab.countTable]
                      : undefined;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => handleSelectTab(tab.id)}
                        className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded text-left transition-colors text-xs font-bold uppercase tracking-wider ${
                          active
                            ? 'bg-gold text-white'
                            : 'text-ink/70 hover:bg-gold/10 hover:text-ink'
                        } ${tab.parent ? 'pl-6' : ''}`}
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <Icon
                            className={`w-3 h-3 shrink-0 ${
                              active ? 'text-white' : 'text-gold/60'
                            }`}
                          />
                          <span className="truncate">{tab.label}</span>
                        </span>
                        {typeof countValue === 'number' && (
                          <span
                            className={`text-[9px] font-mono shrink-0 ${
                              active ? 'text-white/80' : 'text-ink/35'
                            }`}
                          >
                            {countValue}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })}
            {search.trim() && !TABS.some(matchesSearch) && (
              <p className="text-xs italic text-ink/40 text-center py-2 px-2">
                No taxonomy matches “{search}”.
              </p>
            )}
          </nav>
        </aside>

        {/* Body — visible at lg+ always; at narrow widths only when
            activeView is 'body'. */}
        <main
          className={`flex-1 lg:overflow-y-auto custom-scrollbar lg:min-h-0 flex-col ${
            activeView === 'body' ? 'flex' : 'hidden'
          } lg:flex`}
        >
          {/* Narrow-only back nav. Sticks just below the fixed navbar
              (top: var(--navbar-height)) so it never slides underneath
              it as the document scrolls. At lg+ the body has its own
              scroll container and we render the editor flush with the
              top, so this row is hidden.
              `z-20` keeps it above the sticky search toolbar inside
              the editor body (which uses `z-10`). The
              `bg-background/95 backdrop-blur-sm` lets a hint of the
              content below show through while staying legible —
              matches the global navbar's docked feel. */}
          <div className="lg:hidden sticky top-[var(--navbar-height)] z-20 -mx-3 sm:-mx-4 px-3 sm:px-4 py-2 bg-background/95 backdrop-blur-sm border-b border-gold/15 shadow-sm flex items-center gap-2 h-12">
            <Button
              onClick={handleBackToRail}
              variant="ghost"
              size="sm"
              className="text-gold gap-2 hover:bg-gold/5 px-2"
            >
              <ChevronLeft className="w-4 h-4" /> Proficiencies
            </Button>
            {activeTabEntry && (
              <>
                <span className="text-ink/30">/</span>
                <activeTabEntry.icon className="w-3.5 h-3.5 text-gold/70" />
                <span className="text-xs uppercase tracking-widest font-bold text-ink truncate">
                  {activeTabEntry.label}
                </span>
              </>
            )}
          </div>

          <div className="flex-1 lg:min-h-0">
            {activeTab === 'skills' && <SkillsEditor userProfile={userProfile} hideHeader />}
            {activeTab === 'tools' && <ToolsEditor userProfile={userProfile} hideHeader />}
            {activeTab === 'toolCategories' && (
              <ProficiencyEntityShell
                userProfile={userProfile}
                hideHeader
                table="toolCategories"
                singular="Tool Category"
                plural="Tool Categories"
                icon={Hammer}
                description="Define broad tool proficiency groups such as Artisan's Tools, Gaming Sets, Musical Instruments, or homebrew categories."
                {...TAXONOMY_TAB_BASE}
              />
            )}
            {activeTab === 'weapons' && <WeaponsEditor userProfile={userProfile} hideHeader />}
            {activeTab === 'weaponCategories' && (
              <ProficiencyEntityShell
                userProfile={userProfile}
                hideHeader
                table="weaponCategories"
                singular="Weapon Category"
                plural="Weapon Categories"
                icon={Crosshair}
                description="Define broad weapon proficiency groups such as Simple, Martial, Firearms, Exotic, or other homebrew categories."
                {...TAXONOMY_TAB_BASE}
              />
            )}
            {activeTab === 'weaponProperties' && (
              <ProficiencyEntityShell
                userProfile={userProfile}
                hideHeader
                table="weaponProperties"
                singular="Weapon Property"
                plural="Weapon Properties"
                icon={Hammer}
                description="Define properties that can be applied to weapons, such as Finesse, Heavy, Reach, Versatile, or homebrew properties."
                {...TAXONOMY_TAB_BASE}
              />
            )}
            {activeTab === 'armor' && <ArmorEditor userProfile={userProfile} hideHeader />}
            {activeTab === 'armorCategories' && (
              <ProficiencyEntityShell
                userProfile={userProfile}
                hideHeader
                table="armorCategories"
                singular="Armor Category"
                plural="Armor Categories"
                icon={ShieldCheck}
                description="Define broad armor proficiency groups such as Light, Medium, Heavy, Shields, or homebrew categories."
                {...TAXONOMY_TAB_BASE}
              />
            )}
            {activeTab === 'languages' && (
              <ProficiencyEntityShell
                userProfile={userProfile}
                hideHeader
                table="languages"
                singular="Language"
                plural="Languages"
                icon={MessageCircle}
                description="Define the languages available to be selected in race, class, and background proficiencies."
                {...TAXONOMY_TAB_BASE}
                categoryFreeText={{
                  column: 'category',
                  suggestionsCollection: 'languageCategories',
                  label: 'Language Category',
                }}
              />
            )}
            {activeTab === 'languageCategories' && (
              <ProficiencyEntityShell
                userProfile={userProfile}
                hideHeader
                table="languageCategories"
                singular="Language Category"
                plural="Language Categories"
                icon={MessageCircle}
                description="Define broad language groups such as Common Tongues, Exotic Tongues, Secret Scripts, or other homebrew categories."
                {...TAXONOMY_TAB_BASE}
              />
            )}
            {activeTab === 'damageTypes' && (
              <ProficiencyEntityShell
                userProfile={userProfile}
                hideHeader
                table="damageTypes"
                singular="Damage Type"
                plural="Damage Types"
                icon={Skull}
                description="Categories of damage a creature can be immune or resistant to."
                {...TAXONOMY_TAB_BASE}
              />
            )}
            {activeTab === 'attributes' && (
              <ProficiencyEntityShell
                userProfile={userProfile}
                hideHeader
                table="attributes"
                singular="Attribute"
                plural="Attributes"
                icon={Star}
                description="Define the core ability scores/attributes of the system."
                {...TAXONOMY_TAB_BASE}
                // Attribute identifiers (STR/DEX/CON/...) live uppercased
                // by convention; auto-uppercase the slug so the user
                // doesn't have to type the casing themselves.
                identifierTransform={(slug) => slug.toUpperCase()}
              />
            )}
            {activeTab === 'featCategories' && (
              <ProficiencyEntityShell
                userProfile={userProfile}
                hideHeader
                table="featCategories"
                singular="Feat Category"
                plural="Feat Categories"
                icon={Award}
                description="Define broad feat groupings such as General, Fighting Style, Epic Boon, Origin, or homebrew categories. The Feat Editor picker and the public compendium list both read from this list."
                {...TAXONOMY_TAB_BASE}
              />
            )}
            {activeTab === 'spellcasting' && <SpellcastingAdvancementManager userProfile={userProfile} />}
          </div>
        </main>
      </div>
    </div>
  );
}
