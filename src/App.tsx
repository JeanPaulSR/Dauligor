/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { auth, onAuthStateChanged, User } from './lib/firebase';
import { WikiPreviewContext, type WikiPreviewCampaign } from './lib/wikiPreviewContext';
import { fetchDocument, upsertDocument, fetchCollection, checkFoundationUpdate, clearCache } from './lib/d1';
import Navbar from './components/Navbar';

import Home from './pages/core/Home';
import Wiki from './pages/wiki/Wiki';
import LoreEditor from './pages/wiki/LoreEditor';
import LoreArticle from './pages/wiki/LoreArticle';
import Map from './pages/core/Map';
import AdminUsers from './pages/admin/AdminUsers';
import AdminCampaigns from './pages/admin/AdminCampaigns';
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
import TagManager from './pages/compendium/TagManager';
import TagGroupEditor from './pages/compendium/TagGroupEditor';
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
import { TooltipProvider } from './components/ui/tooltip';
import CampaignManager from './pages/campaign/CampaignManager';
import CampaignEditor from './pages/campaign/CampaignEditor';

import Sidebar from './components/Sidebar';
import ErrorBoundary from './components/ErrorBoundary';

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
      const data = await fetchDocument<any>('users', firebaseUser.uid);
      
      if (data) {
        const email = firebaseUser.email || '';
        const internalUsername = email.endsWith('@archive.internal') ? email.split('@')[0] : null;
        const isInternalAdmin = internalUsername === 'admin' || internalUsername === 'gm';
        const isOwnerEmail = email === 'luapnaej101@gmail.com';
        const shouldBeAdmin = isInternalAdmin || isOwnerEmail;
        
        if (shouldBeAdmin && data.role !== 'admin') {
          const updatedProfile = { 
            ...data, 
            role: 'admin',
            username: isInternalAdmin ? (internalUsername || data.username) : data.username 
          };
          await upsertDocument('users', firebaseUser.uid, updatedProfile);
          setUserProfile(updatedProfile);
        } else if (isInternalAdmin && data.username !== internalUsername) {
          const updatedProfile = { ...data, username: internalUsername };
          await upsertDocument('users', firebaseUser.uid, updatedProfile);
          setUserProfile(updatedProfile);
        } else {
          // Check for active campaign if missing
          if (!data.active_campaign_id) {
            const memberData = await fetchCollection<any>('campaignMembers', { where: 'user_id = ?', params: [firebaseUser.uid] });
            if (memberData.length > 0) {
              const updatedProfile = { ...data, active_campaign_id: memberData[0].campaign_id };
              await upsertDocument('users', firebaseUser.uid, updatedProfile);
              setUserProfile(updatedProfile);
              return;
            }
          }
          setUserProfile(data);
        }
      } else {
        // No profile yet, create one
        const email = firebaseUser.email || '';
        const internalUsername = email.endsWith('@archive.internal') ? email.split('@')[0] : null;
        const isInternalAdmin = internalUsername === 'admin' || internalUsername === 'gm';
        const isOwnerEmail = email === 'luapnaej101@gmail.com';
        
        const newProfile = {
          id: firebaseUser.uid,
          username: internalUsername || firebaseUser.displayName?.toLowerCase().replace(/\s+/g, '') || 'explorer',
          display_name: firebaseUser.displayName || 'Explorer',
          role: (isInternalAdmin || isOwnerEmail) ? 'admin' : 'user',
          theme: 'parchment',
          created_at: new Date().toISOString()
        };
        await upsertDocument('users', firebaseUser.uid, newProfile);
        setUserProfile(newProfile);
      }
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
                  <Route path="/compendium/subclasses/new" element={<SubclassEditor />} />
                  <Route path="/compendium/subclasses/edit/:id" element={<SubclassEditor />} />
                  <Route path="/compendium/spells" element={<SpellList userProfile={effectiveProfile} />} />
                  <Route path="/compendium/spells/manage" element={<SpellsEditor userProfile={effectiveProfile} />} />
                  <Route path="/compendium/spell-lists" element={<SpellListManager userProfile={effectiveProfile} />} />
                  <Route path="/compendium/spell-rules" element={<SpellRulesEditor userProfile={effectiveProfile} />} />
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
                  <Route path="/compendium/tags" element={<TagManager userProfile={effectiveProfile} />} />
                  <Route path="/compendium/tags/:id" element={<TagGroupEditor userProfile={effectiveProfile} />} />
                  
                  <Route path="/map" element={<Map userProfile={effectiveProfile} />} />
                  <Route path="/admin/users" element={<AdminUsers userProfile={effectiveProfile} />} />
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
                  <Route path="/characters/new" element={<CharacterBuilder userProfile={effectiveProfile} />} />
                  <Route path="/characters/builder/:id" element={<CharacterBuilder userProfile={effectiveProfile} />} />
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
    </WikiPreviewContext.Provider>
  );
}
