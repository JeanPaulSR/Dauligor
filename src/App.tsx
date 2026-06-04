/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import { useState, useEffect, type ReactNode } from 'react';
import { onAuthChange, getSessionToken, type Identity } from './lib/auth';
import { resolveThemeVars, THEME_VAR_NAMES, type ActiveTheme } from './lib/theme';
import { WikiPreviewContext, type WikiPreviewCampaign } from './lib/wikiPreviewContext';
import { fetchDocument, upsertDocument, fetchCollection, checkFoundationUpdate, clearCache } from './lib/d1';
import { setCurrentUserRole } from './lib/currentUser';
import { BlockProvider } from './lib/proposalBlock';
import { ProposalReviewProvider } from './lib/proposalReview';
import Navbar from './components/Navbar';

import Home from './pages/core/Home';
import Wiki from './pages/wiki/Wiki';
import LoreEditor from './pages/wiki/LoreEditor';
import LoreArticle from './pages/wiki/LoreArticle';
import SystemPageView from './pages/system/SystemPageView';
import Map from './pages/core/Map';
import AdminUsers from './pages/admin/AdminUsers';
import AdminCampaigns from './pages/admin/AdminCampaigns';
import AdminWorlds from './pages/admin/AdminWorlds';
import AdminProposals from './pages/admin/AdminProposals';
import MyProposals from './pages/core/MyProposals';
import AdminProficiencies from './pages/admin/AdminProficiencies';
import StatusesEditor from './pages/admin/StatusesEditor';
import ImageManager from './pages/admin/ImageManager';
import ImageViewer from './pages/admin/ImageViewer';
import Settings from './pages/core/Settings';
import Profile from './pages/core/Profile';
import Construction from './pages/core/Construction';
import Sources from './pages/sources/Sources';
import SourceDetail from './pages/sources/SourceDetail';
import SourceEditor from './pages/sources/SourceEditor';
import Compendium from './pages/compendium/Compendium';
import ClassList from './pages/compendium/ClassList';
import ClassView from './pages/compendium/ClassView';
import ClassEditor from './pages/compendium/ClassEditor';
import SubclassEditor from './pages/compendium/SubclassEditor';
import ScalingEditor from './pages/compendium/scaling/ScalingEditor';
import SpellcastingScalingEditor from './pages/compendium/scaling/SpellcastingScalingEditor';
import SpellsKnownScalingEditor from './pages/compendium/scaling/SpellsKnownScalingEditor';
import UniqueOptionGroupEditor from './pages/compendium/UniqueOptionGroupEditor';
import UniqueOptionGroupBrowser from './pages/compendium/UniqueOptionGroupBrowser';
import SystemPagesList from './pages/compendium/SystemPagesList';
import SystemPageEditor from './pages/compendium/SystemPageEditor';
import TagsExplorer from './pages/compendium/TagsExplorer';
import TagClassifications from './pages/compendium/TagClassifications';
import SkillsEditor from './pages/compendium/SkillsEditor';
import SpellList from './pages/compendium/SpellList';
import ToolsEditor from './pages/compendium/ToolsEditor';
import SpellsEditor from './pages/compendium/SpellsEditor';
import SpellListManager from './pages/compendium/SpellListManager';
import SpellRulesEditor from './pages/compendium/SpellRulesEditor';
import FeatsEditor from './pages/compendium/FeatsEditor';
import FeatList from './pages/compendium/FeatList';
import ItemsEditor from './pages/compendium/ItemsEditor';
import ItemList from './pages/compendium/ItemList';
import FacilitiesEditor from './pages/compendium/FacilitiesEditor';
import FacilitiesList from './pages/compendium/FacilitiesList';
import RacesList from './pages/compendium/RacesList';
import RaceEditor from './pages/compendium/RaceEditor';
import BackgroundsList from './pages/compendium/BackgroundsList';
import BackgroundEditor from './pages/compendium/BackgroundEditor';
import CompendiumFeatureEditor from './pages/compendium/CompendiumFeatureEditor';
import CharacterList from './pages/characters/CharacterList';
import CharacterBuilder from './pages/characters/CharacterBuilder';
import BBCodeTester from './pages/dev/BBCodeTester';
import CharacterErrorBoundary from './pages/characters/CharacterErrorBoundary';
import { TooltipProvider } from './components/ui/tooltip';
import CampaignManager from './pages/campaign/CampaignManager';
import CampaignEditor from './pages/campaign/CampaignEditor';
import CampaignHomeEditorPage from './pages/campaign/CampaignHomeEditorPage';
import RedeemTokenPage from './pages/auth/RedeemTokenPage';

import Sidebar from './components/Sidebar';
import ErrorBoundary from './components/ErrorBoundary';
import { AdminOnly } from './components/auth/AdminOnly';
import ProposalEditorComingSoon from './pages/proposals/ProposalEditorComingSoon';
import { ProposalEditorWrapper } from './components/proposals/ProposalEditorWrapper';

import DebugConsole from './components/DebugConsole';
import ReferenceHoverCard from './components/reference/ReferenceHoverCard';
import { Toaster } from 'sonner';

// Global OGL/copyright footer — suppressed on system pages (/system/*) so those
// reference glossaries read clean, and on the Settings surfaces (which own the
// full viewport with their own master-detail + height-adaptive preview chrome;
// the copyright band just steals vertical space there). Lives inside <Router>
// so it can read the route.
function RouteAwareFooter() {
  const location = useLocation();
  const p = location.pathname;
  if (
    p.startsWith('/system/') ||
    p.startsWith('/compendium/system-pages') ||
    p === '/settings'
  ) return null;
  return (
    <footer className="bg-card border-t border-gold/15 text-ink py-8 mt-auto">
      <div className="container mx-auto px-4 text-center opacity-70">
        <p className="font-serif italic">"This site contains material used under the Open Game License (OGL). All original content is the property of its respective creators. Access to this website is restricted to registered players for use within private tabletop roleplaying sessions."</p>
        <p className="text-xs mt-2">© 2026 Dauligor: Compendium and Lore Manager</p>
      </div>
    </footer>
  );
}

// Most routes read better in a centered container; a few (Settings' wide
// master–detail layout) want to fill the content column. Route-aware so we
// don't force every page full-width.
function RouteAwareMain({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const wide = pathname === '/settings';
  // Settings owns a viewport-bounded master-detail shell (its detail pane
  // scrolls internally), so it gets full width + a slim top pad and NO bottom
  // pad — the bottom padding would otherwise add a sliver of page scroll below
  // the height-locked shell.
  return (
    <main className={`flex-grow relative ${wide ? 'w-full px-4 sm:px-6 lg:px-8 pt-6' : 'container mx-auto px-4 py-8'}`}>
      {children}
    </main>
  );
}

export default function App() {
  const [user, setUser] = useState<Identity | null>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [previewMode, setPreviewMode] = useState(false);
  const [previewCampaign, setPreviewCampaign] = useState<WikiPreviewCampaign | null>(null);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  // Computed profile that respects preview mode
  const effectiveProfile = (userProfile?.role === 'admin' || userProfile?.role === 'co-dm' || userProfile?.role === 'lore-writer') && previewMode
    ? { ...userProfile, role: 'user' }
    : userProfile;

  // Mirror the active role to the module-level cache so components off the
  // userProfile prop-drill chain (e.g. IconPickerModal) can gate admin-only UI.
  useEffect(() => {
    setCurrentUserRole(effectiveProfile?.role ?? null);
  }, [effectiveProfile?.role]);

  // A custom theme (if the user has one active) is `{ base_preset, tokens }`,
  // attached by /api/me. The key drives the effect so it re-runs when the
  // theme's contents change, not just its identity.
  const activeTheme = (effectiveProfile?.active_theme ?? null) as ActiveTheme | null;
  const activeThemeKey = activeTheme
    ? `${activeTheme.base_preset}:${JSON.stringify(activeTheme.tokens ?? {})}`
    : '';

  useEffect(() => {
    const root = document.documentElement;
    const baseClass = activeTheme?.base_preset || effectiveProfile?.theme || 'parchment';
    root.classList.remove('light', 'dark', 'parchment');
    root.classList.add(baseClass);

    // Clear any previously-injected custom-theme vars first, so switching
    // themes — or reverting to a built-in preset — never leaves stale overrides.
    THEME_VAR_NAMES.forEach((v) => root.style.removeProperty(v));

    if (activeTheme) {
      // Full custom theme: inject the resolved token set over the preset class.
      const vars = resolveThemeVars(activeTheme);
      for (const [k, val] of Object.entries(vars)) root.style.setProperty(k, val);
    } else if (effectiveProfile?.accent_color) {
      // Legacy accent-only personalisation (users without a custom theme).
      root.style.setProperty('--gold', effectiveProfile.accent_color);
      root.style.setProperty('--primary', effectiveProfile.accent_color);
      root.style.setProperty('--ring', effectiveProfile.accent_color);
    } else {
      const defaultColor = baseClass === 'parchment' ? '#c5a059' : '#3b82f6';
      root.style.setProperty('--gold', defaultColor);
      root.style.setProperty('--primary', defaultColor);
      root.style.setProperty('--ring', defaultColor);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveProfile?.theme, effectiveProfile?.accent_color, activeThemeKey]);

  // Global Foundation Sync Polling
  const [lastFoundationTimestamp, setLastFoundationTimestamp] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;

    // Initial check
    checkFoundationUpdate().then(setLastFoundationTimestamp);

    const interval = setInterval(async () => {
      try {
        const currentTimestamp = await checkFoundationUpdate();
        if (lastFoundationTimestamp && currentTimestamp && currentTimestamp !== lastFoundationTimestamp) {
          console.info(`[Foundation] Update detected (${currentTimestamp}). Clearing cache...`);
          clearCache(); // Wipes in-memory and session storage
          setLastFoundationTimestamp(currentTimestamp);
          
          // Optionally refresh the current profile as well if it might be affected
          if (user) loadProfile();
        } else if (!lastFoundationTimestamp && currentTimestamp) {
          setLastFoundationTimestamp(currentTimestamp);
        }
      } catch (err) {
        console.error("Failed to poll foundation update:", err);
      }
    }, 30000); // 30 seconds

    return () => clearInterval(interval);
  }, [user, lastFoundationTimestamp]);

  const loadProfile = async () => {
    try {
      // GET /api/me does all of the work that used to live here:
      //   - the SELECT * FROM users WHERE id = ? lookup
      //   - the auto-create on first sign-in
      //   - the bootstrap-admin promote for the owner email + the
      //     synthetic `admin` / `gm` usernames
      //   - the active_campaign_id auto-pick from the first
      //     campaign_members row
      // Server-side because letting the client decide which profile
      // fields to upsert was the H6 role-self-promotion vector. With
      // this migration the client never writes to `users.role` again.
      const idToken = await getSessionToken();
      const res = await fetch('/api/me', {
        headers: idToken ? { Authorization: `Bearer ${idToken}` } : {},
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `Failed to load profile (HTTP ${res.status})`);
      }
      const body = await res.json();
      setUserProfile(body?.profile || null);
    } catch (err) {
      console.error("Error loading user profile:", err);
    } finally {
      setLoading(false);
    }
  };

  const refreshProfile = async () => {
    if (user) {
      await loadProfile();
    }
  };

  useEffect(() => {
    const unsubscribeAuth = onAuthChange((identity) => {
      setUser(identity);
      if (identity) {
        loadProfile();
      } else {
        // NOTE: deliberately do NOT clearCache() here — the D1 cache holds shared
        // content (compendium/lore), so it persists across logout/login to avoid
        // re-fetching everything on each sign-in.
        setUserProfile(null);
        setLoading(false);
      }
    });

    return () => unsubscribeAuth();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-parchment">
        <div className="text-2xl font-serif animate-pulse text-gold">Loading Dauligor...</div>
      </div>
    );
  }

  return (
    <WikiPreviewContext.Provider value={{
      previewCampaign,
      setPreviewCampaign,
      refreshProfile
    }}>
    <BlockProvider>
    <TooltipProvider>
      <Router>
        <div className="min-h-screen flex">
          <Sidebar 
            userProfile={effectiveProfile} 
            isOpen={isMobileSidebarOpen} 
            onClose={() => setIsMobileSidebarOpen(false)} 
            isCollapsed={isSidebarCollapsed}
            onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          />
      <div className="flex-grow flex flex-col min-w-0">
        <Navbar 
          user={user} 
          userProfile={userProfile} 
          previewMode={previewMode} 
          setPreviewMode={setPreviewMode} 
          onMenuClick={() => {
            if (window.innerWidth < 768) {
              setIsMobileSidebarOpen(true);
            } else {
              setIsSidebarCollapsed(!isSidebarCollapsed);
            }
          }}
        />
        <RouteAwareMain>
          <ErrorBoundary>
            <div className="animate-in fade-in duration-500">
              <ProposalReviewProvider>
              <Routes>
                <Route path="/" element={<Home userProfile={effectiveProfile} />} />
                  <Route path="/auth/redeem" element={<RedeemTokenPage />} />
                  <Route path="/wiki" element={<Wiki userProfile={effectiveProfile} />} />
                  <Route path="/wiki/new" element={<LoreEditor userProfile={effectiveProfile} />} />
                  <Route path="/wiki/edit/:id" element={<LoreEditor userProfile={effectiveProfile} />} />
                  <Route path="/wiki/article/:id" element={<LoreArticle userProfile={effectiveProfile} />} />
                  {/* System pages — public reader for the reference-addressable
                      glossary type (&condition[prone] -> /system/condition#prone). */}
                  <Route path="/system/:identifier" element={<SystemPageView />} />
                  <Route path="/sources" element={<Sources userProfile={effectiveProfile} />} />
                  <Route path="/sources/view/:id" element={<SourceDetail userProfile={effectiveProfile} />} />
                  <Route path="/sources/new" element={<SourceEditor userProfile={effectiveProfile} />} />
                  <Route path="/sources/edit/:id" element={<SourceEditor userProfile={effectiveProfile} />} />
                  
                  <Route path="/compendium" element={<Compendium userProfile={effectiveProfile} />} />
                  <Route path="/compendium/classes" element={<ClassList userProfile={effectiveProfile} />} />
                  <Route path="/compendium/classes/view/:slug" element={<ClassView userProfile={effectiveProfile} />} />
                  <Route path="/compendium/classes/new" element={<ClassEditor userProfile={effectiveProfile} />} />
                  <Route path="/compendium/classes/edit/:slug" element={<ClassEditor userProfile={effectiveProfile} />} />
                  <Route path="/compendium/subclasses/new" element={<SubclassEditor userProfile={effectiveProfile} />} />
                  <Route path="/compendium/subclasses/edit/:id" element={<SubclassEditor userProfile={effectiveProfile} />} />
                  <Route path="/compendium/spells" element={<SpellList userProfile={effectiveProfile} />} />
                  <Route path="/compendium/spells/manage" element={<SpellsEditor userProfile={effectiveProfile} />} />
                  <Route path="/compendium/spell-lists" element={<AdminOnly userProfile={effectiveProfile}><SpellListManager userProfile={effectiveProfile} /></AdminOnly>} />
                  <Route path="/compendium/spell-rules" element={<AdminOnly userProfile={effectiveProfile}><SpellRulesEditor userProfile={effectiveProfile} /></AdminOnly>} />
                  <Route path="/compendium/feats" element={<FeatList userProfile={effectiveProfile} />} />
                  <Route path="/compendium/feats/manage" element={<FeatsEditor userProfile={effectiveProfile} />} />
                  {/* Items — public list at /items, admin editor at
                      /items/manage. Mirrors the spells + feats route
                      convention (/<entity> for the read-only browser,
                      /<entity>/manage for the admin CRUD surface). */}
                  <Route path="/compendium/items" element={<ItemList userProfile={effectiveProfile} />} />
                  <Route path="/compendium/items/manage" element={<ItemsEditor userProfile={effectiveProfile} />} />
                  {/* Facilities (Bastions, 2024 DMG) — separate table
                      + page from items. Public browser at /facilities,
                      admin editor at /facilities/manage. Migration
                      20260526-2000 (C7 of items-completeness work). */}
                  <Route path="/compendium/facilities" element={<FacilitiesList userProfile={effectiveProfile} />} />
                  <Route path="/compendium/facilities/manage" element={<FacilitiesEditor userProfile={effectiveProfile} />} />
                  {/* Races + Backgrounds — public list pages plus
                      admin /manage editors. Both currently live in the
                      `feats` table with a `feat_type='race'/'background'`
                      discriminator; RaceEditor / BackgroundEditor thread
                      `scopeFeatType` into FeatsEditor to constrain the
                      list + new-entry default to the matching type. */}
                  <Route path="/compendium/races" element={<RacesList userProfile={effectiveProfile} />} />
                  <Route path="/compendium/races/manage" element={<RaceEditor userProfile={effectiveProfile} />} />
                  <Route path="/compendium/backgrounds" element={<BackgroundsList userProfile={effectiveProfile} />} />
                  <Route path="/compendium/backgrounds/manage" element={<BackgroundEditor userProfile={effectiveProfile} />} />
                  <Route path="/compendium/background-features/manage" element={<CompendiumFeatureEditor userProfile={effectiveProfile} kind="background" />} />
                  <Route path="/compendium/scaling/new" element={<ScalingEditor userProfile={effectiveProfile} />} />
                  <Route path="/compendium/scaling/edit/:id" element={<ScalingEditor userProfile={effectiveProfile} />} />
                  <Route path="/compendium/spellcasting-scaling/new" element={<SpellcastingScalingEditor userProfile={effectiveProfile} />} />
                  <Route path="/compendium/spellcasting-scaling/edit/:id" element={<SpellcastingScalingEditor userProfile={effectiveProfile} />} />
                  <Route path="/compendium/spells-known-scaling/new" element={<SpellsKnownScalingEditor userProfile={effectiveProfile} />} />
                  <Route path="/compendium/spells-known-scaling/edit/:id" element={<SpellsKnownScalingEditor userProfile={effectiveProfile} />} />
                  
                  {/* 3-pane browse surface (groups | options | detail) replaces
                      the old card-grid list AND the single-group read view.
                      `/new` + `/edit/:id` keep the comprehensive editor; `/:id`
                      deep-links the browser with that group preselected. */}
                  <Route path="/compendium/unique-options" element={<UniqueOptionGroupBrowser userProfile={effectiveProfile} />} />
                  <Route path="/compendium/unique-options/new" element={<UniqueOptionGroupEditor userProfile={effectiveProfile} />} />
                  <Route path="/compendium/unique-options/edit/:id" element={<UniqueOptionGroupEditor userProfile={effectiveProfile} />} />
                  <Route path="/compendium/unique-options/:id" element={<UniqueOptionGroupBrowser userProfile={effectiveProfile} />} />
                  {/* System pages — admin authoring for the reference-addressable
                      glossary type. Public reader is /system/:identifier. */}
                  <Route path="/compendium/system-pages" element={<SystemPagesList userProfile={effectiveProfile} />} />
                  <Route path="/compendium/system-pages/new" element={<AdminOnly userProfile={effectiveProfile}><SystemPageEditor userProfile={effectiveProfile} /></AdminOnly>} />
                  <Route path="/compendium/system-pages/edit/:id" element={<AdminOnly userProfile={effectiveProfile}><SystemPageEditor userProfile={effectiveProfile} /></AdminOnly>} />
                  <Route path="/compendium/tags" element={<AdminOnly userProfile={effectiveProfile}><TagsExplorer userProfile={effectiveProfile} /></AdminOnly>} />
                  <Route path="/compendium/tags/classifications" element={<AdminOnly userProfile={effectiveProfile}><TagClassifications userProfile={effectiveProfile} /></AdminOnly>} />
                  <Route path="/compendium/tags/:id" element={<AdminOnly userProfile={effectiveProfile}><TagsExplorer userProfile={effectiveProfile} /></AdminOnly>} />
                  
                  <Route path="/map" element={<Map userProfile={effectiveProfile} />} />
                  <Route path="/admin/users" element={<AdminUsers userProfile={effectiveProfile} />} />
                  <Route path="/admin/worlds" element={<AdminWorlds userProfile={effectiveProfile} />} />
                  <Route path="/admin/proposals" element={<AdminProposals userProfile={effectiveProfile} />} />
                  <Route path="/my-proposals" element={<MyProposals userProfile={effectiveProfile} />} />
                  {/* Phase 4.5 — per-entity proposal-editor routes. Each one
                      wraps the existing editor component with
                      ProposalEditorWrapper so Save/auto-update accumulates
                      locally and flushes on Submit Changes. */}
                  <Route path="/proposals/edit/tags" element={
                    <ProposalEditorWrapper entityType="tag" fullscreen>
                      <TagsExplorer userProfile={effectiveProfile} />
                    </ProposalEditorWrapper>
                  } />
                  <Route path="/proposals/edit/tags/:id" element={
                    <ProposalEditorWrapper entityType="tag" fullscreen>
                      <TagsExplorer userProfile={effectiveProfile} />
                    </ProposalEditorWrapper>
                  } />
                  <Route path="/proposals/edit/spell-rules" element={
                    <ProposalEditorWrapper entityType="spell_rule">
                      <SpellRulesEditor userProfile={effectiveProfile} />
                    </ProposalEditorWrapper>
                  } />
                  {/* Phase 4.6: the proposal-mode route for the spell-list
                      manager now wraps in `spell_rule` entity type because
                      the manager submits rule-level updates (mutating
                      manualSpells / manualExclusions) instead of class_-
                      spell_list revisions. The route URL stays the same
                      so content-creator bookmarks keep working. */}
                  <Route path="/proposals/edit/spell-lists" element={
                    <ProposalEditorWrapper entityType="spell_rule">
                      <SpellListManager userProfile={effectiveProfile} />
                    </ProposalEditorWrapper>
                  } />
                  <Route path="/proposals/edit/spells" element={
                    <ProposalEditorWrapper entityType="spell" enableFocusMode>
                      <SpellsEditor userProfile={effectiveProfile} />
                    </ProposalEditorWrapper>
                  } />
                  {/* Option Groups — hybrid: the 3-pane browser is the
                      group picker (wrapped + enableFocusMode so the In
                      Block / Full Catalog toggle filters the Groups pane
                      to the user's block work), then the per-group editor
                      (wrapped, takes both entity types for the queue).
                      Same browser component as the admin /compendium route;
                      it goes proposal-aware purely on the client. */}
                  <Route path="/proposals/edit/option-groups" element={
                    <ProposalEditorWrapper entityType={['unique_option_group', 'unique_option_item']} enableFocusMode>
                      <UniqueOptionGroupBrowser userProfile={effectiveProfile} />
                    </ProposalEditorWrapper>
                  } />
                  <Route path="/proposals/edit/option-groups/new" element={
                    <ProposalEditorWrapper entityType={['unique_option_group', 'unique_option_item']}>
                      <UniqueOptionGroupEditor userProfile={effectiveProfile} />
                    </ProposalEditorWrapper>
                  } />
                  <Route path="/proposals/edit/option-groups/edit/:id" element={
                    <ProposalEditorWrapper entityType={['unique_option_group', 'unique_option_item']}>
                      <UniqueOptionGroupEditor userProfile={effectiveProfile} />
                    </ProposalEditorWrapper>
                  } />
                  {/* Classes — single-work: one route per class instance.
                      Nested entity edits (features, scaling columns,
                      subclasses) remain admin-only inside the editor —
                      those tables aren't in the proposal allowlist. */}
                  <Route path="/proposals/edit/classes" element={
                    <ClassList userProfile={effectiveProfile} />
                  } />
                  <Route path="/proposals/edit/classes/new" element={
                    <ProposalEditorWrapper entityType="class">
                      <ClassEditor userProfile={effectiveProfile} />
                    </ProposalEditorWrapper>
                  } />
                  <Route path="/proposals/edit/classes/edit/:id" element={
                    <ProposalEditorWrapper entityType="class">
                      <ClassEditor userProfile={effectiveProfile} />
                    </ProposalEditorWrapper>
                  } />
                  {/* Subclasses — same single-work pattern as Classes.
                      Reachable via the parent ClassEditor's Subclasses
                      tab (which routes here when the user is editing
                      a class through /proposals/edit/*). */}
                  <Route path="/proposals/edit/subclasses/new" element={
                    <ProposalEditorWrapper entityType="subclass">
                      <SubclassEditor userProfile={effectiveProfile} />
                    </ProposalEditorWrapper>
                  } />
                  <Route path="/proposals/edit/subclasses/edit/:id" element={
                    <ProposalEditorWrapper entityType="subclass">
                      <SubclassEditor userProfile={effectiveProfile} />
                    </ProposalEditorWrapper>
                  } />
                  {/* Feats — multi-work editor (catalog + inline form),
                      same focus-mode + auto-stage pattern as Spells. */}
                  <Route path="/proposals/edit/feats" element={
                    <ProposalEditorWrapper entityType="feat" enableFocusMode>
                      <FeatsEditor userProfile={effectiveProfile} />
                    </ProposalEditorWrapper>
                  } />
                  {/* Items — delegates to DevelopmentCompendiumManager
                      which detects proposal mode via the wrapper's
                      context (entityType + focus-mode wiring lives
                      inside the manager). */}
                  <Route path="/proposals/edit/items" element={
                    <ProposalEditorWrapper entityType="item" enableFocusMode>
                      <ItemsEditor userProfile={effectiveProfile} />
                    </ProposalEditorWrapper>
                  } />
                  {/* Catch-all placeholder for editors not yet wired. */}
                  <Route path="/proposals/edit/*" element={<ProposalEditorComingSoon />} />
                  <Route path="/admin/campaigns" element={<AdminCampaigns userProfile={effectiveProfile} />} />
                  <Route path="/campaign/:id" element={<CampaignManager userProfile={effectiveProfile} />} />
                  <Route path="/campaign/edit/:id" element={<CampaignEditor userProfile={effectiveProfile} />} />
                  <Route path="/campaign/edit/:id/homepage" element={<CampaignHomeEditorPage userProfile={effectiveProfile} />} />
                  <Route path="/admin/proficiencies" element={<AdminProficiencies userProfile={effectiveProfile} />} />
                  <Route path="/admin/statuses" element={<StatusesEditor userProfile={effectiveProfile} />} />
                  <Route path="/admin/images" element={<ImageManager userProfile={effectiveProfile} />} />
                  <Route path="/images/view" element={<ImageViewer userProfile={effectiveProfile} />} />
                  {/* Dev tools — admin-only. BBCode tester for the
                      ongoing BBCode audit + cross-reference authoring
                      work. Lives under /dev/* so other dev surfaces
                      can sit alongside. */}
                  <Route path="/dev/bbcode" element={<AdminOnly userProfile={effectiveProfile}><BBCodeTester userProfile={effectiveProfile} /></AdminOnly>} />
                  <Route path="/settings" element={<Settings user={user} userProfile={effectiveProfile} />} />
                  <Route path="/profile/:username" element={<Profile viewerProfile={effectiveProfile} />} />
                  <Route path="/construction" element={<Construction />} />
                  <Route path="/characters" element={<CharacterList userProfile={effectiveProfile} />} />
                  <Route
                    path="/characters/new"
                    element={
                      <CharacterErrorBoundary>
                        <CharacterBuilder userProfile={effectiveProfile} />
                      </CharacterErrorBoundary>
                    }
                  />
                  <Route
                    path="/characters/builder/:id"
                    element={
                      <CharacterErrorBoundary>
                        <CharacterBuilder userProfile={effectiveProfile} />
                      </CharacterErrorBoundary>
                    }
                  />
                </Routes>
              </ProposalReviewProvider>
            </div>
          </ErrorBoundary>
        </RouteAwareMain>
          <RouteAwareFooter />
            {effectiveProfile?.role === 'admin' && <DebugConsole />}
            <ReferenceHoverCard />
            <Toaster position="top-center" richColors />
          </div>
        </div>
      </Router>
    </TooltipProvider>
    </BlockProvider>
    </WikiPreviewContext.Provider>
  );
}
