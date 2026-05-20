/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { auth, onAuthStateChanged, User } from './lib/firebase';
import { WikiPreviewContext, type WikiPreviewCampaign } from './lib/wikiPreviewContext';
import { fetchDocument, upsertDocument, fetchCollection, checkFoundationUpdate, clearCache } from './lib/d1';
import { setCurrentUserRole } from './lib/currentUser';
import { BlockProvider } from './lib/proposalBlock';
import Navbar from './components/Navbar';

import Home from './pages/core/Home';
import Wiki from './pages/wiki/Wiki';
import LoreEditor from './pages/wiki/LoreEditor';
import LoreArticle from './pages/wiki/LoreArticle';
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
import UniqueOptionGroupList from './pages/compendium/UniqueOptionGroupList';
import UniqueOptionGroupEditor from './pages/compendium/UniqueOptionGroupEditor';
import UniqueOptionGroupView from './pages/compendium/UniqueOptionGroupView';
import TagsExplorer from './pages/compendium/TagsExplorer';
import SkillsEditor from './pages/compendium/SkillsEditor';
import SpellList from './pages/compendium/SpellList';
import ToolsEditor from './pages/compendium/ToolsEditor';
import SpellsEditor from './pages/compendium/SpellsEditor';
import SpellListManager from './pages/compendium/SpellListManager';
import SpellRulesEditor from './pages/compendium/SpellRulesEditor';
import FeatsEditor from './pages/compendium/FeatsEditor';
import FeatList from './pages/compendium/FeatList';
import ItemsEditor from './pages/compendium/ItemsEditor';
import CharacterList from './pages/characters/CharacterList';
import CharacterBuilder from './pages/characters/CharacterBuilder';
import CharacterErrorBoundary from './pages/characters/CharacterErrorBoundary';
import { TooltipProvider } from './components/ui/tooltip';
import CampaignManager from './pages/campaign/CampaignManager';
import CampaignEditor from './pages/campaign/CampaignEditor';
import RedeemTokenPage from './pages/auth/RedeemTokenPage';

import Sidebar from './components/Sidebar';
import ErrorBoundary from './components/ErrorBoundary';
import { AdminOnly } from './components/auth/AdminOnly';
import ProposalEditorComingSoon from './pages/proposals/ProposalEditorComingSoon';
import { ProposalEditorWrapper } from './components/proposals/ProposalEditorWrapper';

import DebugConsole from './components/DebugConsole';
import { Toaster } from 'sonner';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
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

  useEffect(() => {
    const theme = effectiveProfile?.theme || 'parchment';
    document.documentElement.classList.remove('light', 'dark', 'parchment');
    document.documentElement.classList.add(theme);
    
    if (effectiveProfile?.accent_color) {
      document.documentElement.style.setProperty('--gold', effectiveProfile.accent_color);
      document.documentElement.style.setProperty('--primary', effectiveProfile.accent_color);
      document.documentElement.style.setProperty('--ring', effectiveProfile.accent_color);
    } else {
      const defaultColor = theme === 'parchment' ? '#c5a059' : '#3b82f6';
      document.documentElement.style.setProperty('--gold', defaultColor);
      document.documentElement.style.setProperty('--primary', defaultColor);
      document.documentElement.style.setProperty('--ring', defaultColor);
    }
  }, [effectiveProfile?.theme, effectiveProfile?.accent_color]);

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
          if (user) loadProfile(user);
        } else if (!lastFoundationTimestamp && currentTimestamp) {
          setLastFoundationTimestamp(currentTimestamp);
        }
      } catch (err) {
        console.error("Failed to poll foundation update:", err);
      }
    }, 30000); // 30 seconds

    return () => clearInterval(interval);
  }, [user, lastFoundationTimestamp]);

  const loadProfile = async (firebaseUser: User) => {
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
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch('/api/me', {
        headers: { Authorization: `Bearer ${idToken}` },
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
      await loadProfile(user);
    }
  };

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        loadProfile(firebaseUser);
      } else {
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
        <main className="flex-grow container mx-auto px-4 py-8 relative">
          <ErrorBoundary>
            <div className="animate-in fade-in duration-500">
              <Routes>
                <Route path="/" element={<Home userProfile={effectiveProfile} />} />
                  <Route path="/auth/redeem" element={<RedeemTokenPage />} />
                  <Route path="/wiki" element={<Wiki userProfile={effectiveProfile} />} />
                  <Route path="/wiki/new" element={<LoreEditor userProfile={effectiveProfile} />} />
                  <Route path="/wiki/edit/:id" element={<LoreEditor userProfile={effectiveProfile} />} />
                  <Route path="/wiki/article/:id" element={<LoreArticle userProfile={effectiveProfile} />} />
                  <Route path="/sources" element={<Sources userProfile={effectiveProfile} />} />
                  <Route path="/sources/view/:id" element={<SourceDetail userProfile={effectiveProfile} />} />
                  <Route path="/sources/new" element={<SourceEditor userProfile={effectiveProfile} />} />
                  <Route path="/sources/edit/:id" element={<SourceEditor userProfile={effectiveProfile} />} />
                  
                  <Route path="/compendium" element={<Compendium userProfile={effectiveProfile} />} />
                  <Route path="/compendium/classes" element={<ClassList userProfile={effectiveProfile} />} />
                  <Route path="/compendium/classes/view/:id" element={<ClassView userProfile={effectiveProfile} />} />
                  <Route path="/compendium/classes/new" element={<ClassEditor userProfile={effectiveProfile} />} />
                  <Route path="/compendium/classes/edit/:id" element={<ClassEditor userProfile={effectiveProfile} />} />
                  <Route path="/compendium/subclasses/new" element={<SubclassEditor userProfile={effectiveProfile} />} />
                  <Route path="/compendium/subclasses/edit/:id" element={<SubclassEditor userProfile={effectiveProfile} />} />
                  <Route path="/compendium/spells" element={<SpellList userProfile={effectiveProfile} />} />
                  <Route path="/compendium/spells/manage" element={<SpellsEditor userProfile={effectiveProfile} />} />
                  <Route path="/compendium/spell-lists" element={<AdminOnly userProfile={effectiveProfile}><SpellListManager userProfile={effectiveProfile} /></AdminOnly>} />
                  <Route path="/compendium/spell-rules" element={<AdminOnly userProfile={effectiveProfile}><SpellRulesEditor userProfile={effectiveProfile} /></AdminOnly>} />
                  <Route path="/compendium/feats" element={<FeatList userProfile={effectiveProfile} />} />
                  <Route path="/compendium/feats/manage" element={<FeatsEditor userProfile={effectiveProfile} />} />
                  <Route path="/compendium/items" element={<ItemsEditor userProfile={effectiveProfile} />} />
                  <Route path="/compendium/scaling/new" element={<ScalingEditor userProfile={effectiveProfile} />} />
                  <Route path="/compendium/scaling/edit/:id" element={<ScalingEditor userProfile={effectiveProfile} />} />
                  <Route path="/compendium/spellcasting-scaling/new" element={<SpellcastingScalingEditor userProfile={effectiveProfile} />} />
                  <Route path="/compendium/spellcasting-scaling/edit/:id" element={<SpellcastingScalingEditor userProfile={effectiveProfile} />} />
                  <Route path="/compendium/spells-known-scaling/new" element={<SpellsKnownScalingEditor userProfile={effectiveProfile} />} />
                  <Route path="/compendium/spells-known-scaling/edit/:id" element={<SpellsKnownScalingEditor userProfile={effectiveProfile} />} />
                  
                  <Route path="/compendium/unique-options" element={<UniqueOptionGroupList userProfile={effectiveProfile} />} />
                  <Route path="/compendium/unique-options/new" element={<UniqueOptionGroupEditor userProfile={effectiveProfile} />} />
                  <Route path="/compendium/unique-options/edit/:id" element={<UniqueOptionGroupEditor userProfile={effectiveProfile} />} />
                  <Route path="/compendium/unique-options/:id" element={<UniqueOptionGroupView userProfile={effectiveProfile} />} />
                  <Route path="/compendium/tags" element={<AdminOnly userProfile={effectiveProfile}><TagsExplorer userProfile={effectiveProfile} /></AdminOnly>} />
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
                    <ProposalEditorWrapper entityType="tag">
                      <TagsExplorer userProfile={effectiveProfile} />
                    </ProposalEditorWrapper>
                  } />
                  <Route path="/proposals/edit/tags/:id" element={
                    <ProposalEditorWrapper entityType="tag">
                      <TagsExplorer userProfile={effectiveProfile} />
                    </ProposalEditorWrapper>
                  } />
                  <Route path="/proposals/edit/spell-rules" element={
                    <ProposalEditorWrapper entityType="spell_rule">
                      <SpellRulesEditor userProfile={effectiveProfile} />
                    </ProposalEditorWrapper>
                  } />
                  <Route path="/proposals/edit/spell-lists" element={
                    <ProposalEditorWrapper entityType="class_spell_list">
                      <SpellListManager userProfile={effectiveProfile} />
                    </ProposalEditorWrapper>
                  } />
                  <Route path="/proposals/edit/spells" element={
                    <ProposalEditorWrapper entityType="spell" enableFocusMode>
                      <SpellsEditor userProfile={effectiveProfile} />
                    </ProposalEditorWrapper>
                  } />
                  {/* Option Groups — hybrid: list (no wrapper, just
                      navigation) → per-group editor (wrapped, takes
                      both entity types for the queue). */}
                  <Route path="/proposals/edit/option-groups" element={
                    <UniqueOptionGroupList userProfile={effectiveProfile} />
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
                  {/* Catch-all placeholder for editors not yet wired. */}
                  <Route path="/proposals/edit/*" element={<ProposalEditorComingSoon />} />
                  <Route path="/admin/campaigns" element={<AdminCampaigns userProfile={effectiveProfile} />} />
                  <Route path="/campaign/:id" element={<CampaignManager userProfile={effectiveProfile} />} />
                  <Route path="/campaign/edit/:id" element={<CampaignEditor userProfile={effectiveProfile} />} />
                  <Route path="/admin/proficiencies" element={<AdminProficiencies userProfile={effectiveProfile} />} />
                  <Route path="/admin/statuses" element={<StatusesEditor userProfile={effectiveProfile} />} />
                  <Route path="/admin/images" element={<ImageManager userProfile={effectiveProfile} />} />
                  <Route path="/images/view" element={<ImageViewer userProfile={effectiveProfile} />} />
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
              </div>
            </ErrorBoundary>
          </main>
          <footer className="bg-card border-t border-gold/10 text-ink py-8 mt-auto">
              <div className="container mx-auto px-4 text-center opacity-70">
                <p className="font-serif italic">"This site contains material used under the Open Game License (OGL). All original content is the property of its respective creators. Access to this website is restricted to registered players for use within private tabletop roleplaying sessions."</p>
                <p className="text-xs mt-2">© 2026 Dauligor: Compendium and Lore Manager</p>
              </div>
            </footer>
            {effectiveProfile?.role === 'admin' && <DebugConsole />}
            <Toaster position="top-center" richColors />
          </div>
        </div>
      </Router>
    </TooltipProvider>
    </BlockProvider>
    </WikiPreviewContext.Provider>
  );
}
