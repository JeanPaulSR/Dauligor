/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { auth, db, onAuthStateChanged, User } from './lib/firebase';
import { doc, getDoc, setDoc, onSnapshot, updateDoc } from 'firebase/firestore';
import Navbar from './components/Navbar';
import Home from './pages/core/Home';
import Wiki from './pages/wiki/Wiki';
import LoreEditor from './pages/wiki/LoreEditor';
import LoreArticle from './pages/wiki/LoreArticle';
import Map from './pages/core/Map';
import AdminUsers from './pages/admin/AdminUsers';
import AdminCampaigns from './pages/admin/AdminCampaigns';
import AdminProficiencies from './pages/admin/AdminProficiencies';
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
import AlternativeSpellcastingScalingEditor from './pages/compendium/scaling/AlternativeSpellcastingScalingEditor';
import SpellsKnownScalingEditor from './pages/compendium/scaling/SpellsKnownScalingEditor';
import UniqueOptionGroupList from './pages/compendium/UniqueOptionGroupList';
import UniqueOptionGroupEditor from './pages/compendium/UniqueOptionGroupEditor';
import TagManager from './pages/compendium/TagManager';
import TagGroupEditor from './pages/compendium/TagGroupEditor';
import SkillsEditor from './pages/compendium/SkillsEditor';
import ToolsEditor from './pages/compendium/ToolsEditor';
import CharacterList from './pages/characters/CharacterList';
import CharacterBuilder from './pages/characters/CharacterBuilder';
import { TooltipProvider } from './components/ui/tooltip';

import Sidebar from './components/Sidebar';
import ErrorBoundary from './components/ErrorBoundary';

import DebugConsole from './components/DebugConsole';
import { Toaster } from 'sonner';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [previewMode, setPreviewMode] = useState(false);
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
    
    if (effectiveProfile?.accentColor) {
      document.documentElement.style.setProperty('--gold', effectiveProfile.accentColor);
      document.documentElement.style.setProperty('--primary', effectiveProfile.accentColor);
      document.documentElement.style.setProperty('--ring', effectiveProfile.accentColor);
    } else {
      const defaultColor = theme === 'parchment' ? '#c5a059' : '#3b82f6';
      document.documentElement.style.setProperty('--gold', defaultColor);
      document.documentElement.style.setProperty('--primary', defaultColor);
      document.documentElement.style.setProperty('--ring', defaultColor);
    }
  }, [effectiveProfile?.theme, effectiveProfile?.accentColor]);

  useEffect(() => {
    let unsubscribeProfile: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      
      if (unsubscribeProfile) {
        unsubscribeProfile();
        unsubscribeProfile = null;
      }

      if (firebaseUser) {
        const docRef = doc(db, 'users', firebaseUser.uid);
        
        unsubscribeProfile = onSnapshot(docRef, async (docSnap) => {
          if (docSnap.exists()) {
            const data = docSnap.data();
            const email = firebaseUser.email || '';
            const isInternalAdmin = email === 'admin@archive.internal' || email === 'gm@archive.internal';
            const isOwnerEmail = email === 'luapnaej101@gmail.com';
            const shouldBeAdmin = isInternalAdmin || isOwnerEmail;
            
            if (shouldBeAdmin && (data.role !== 'admin' || (isInternalAdmin && data.username !== email.split('@')[0]))) {
              const updatedProfile = { 
                ...data, 
                role: 'admin',
                // Force correct username for internal admin accounts
                username: isInternalAdmin ? email.split('@')[0] : data.username 
              };
              await setDoc(docRef, updatedProfile);
              setUserProfile(updatedProfile);
            } else {
              // Set default activeCampaignId if missing
              if (data.campaignIds?.length > 0 && !data.activeCampaignId) {
                await updateDoc(docRef, { activeCampaignId: data.campaignIds[0] });
              }
              setUserProfile(data);
            }
          } else {
            const email = firebaseUser.email || '';
            const isInternal = email.endsWith('@archive.internal');
            const internalUsername = isInternal ? email.split('@')[0] : null;
            
            const newProfile = {
              uid: firebaseUser.uid,
              displayName: firebaseUser.displayName || (internalUsername ? internalUsername.charAt(0).toUpperCase() + internalUsername.slice(1) : 'Adventurer'),
              username: internalUsername || firebaseUser.displayName?.toLowerCase().replace(/\s/g, '') || 'user',
              role: (internalUsername === 'admin' || internalUsername === 'gm' || email === 'luapnaej101@gmail.com') ? 'admin' : 'user',
              createdAt: new Date().toISOString()
            };
            await setDoc(docRef, newProfile);
            setUserProfile(newProfile);
          }
          setLoading(false);
        }, (error) => {
          console.error("Profile listener error:", error);
          setLoading(false);
        });
      } else {
        setUserProfile(null);
        setLoading(false);
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeProfile) unsubscribeProfile();
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-parchment">
        <div className="text-2xl font-serif animate-pulse text-gold">Loading Archive...</div>
      </div>
    );
  }

  return (
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
                  <Route path="/compendium/scaling/new" element={<ScalingEditor userProfile={effectiveProfile} />} />
                  <Route path="/compendium/scaling/edit/:id" element={<ScalingEditor userProfile={effectiveProfile} />} />
                  <Route path="/compendium/spellcasting-scaling/new" element={<SpellcastingScalingEditor userProfile={effectiveProfile} />} />
                  <Route path="/compendium/spellcasting-scaling/edit/:id" element={<SpellcastingScalingEditor userProfile={effectiveProfile} />} />
                  <Route path="/compendium/pact-scaling/new" element={<AlternativeSpellcastingScalingEditor userProfile={effectiveProfile} />} />
                  <Route path="/compendium/pact-scaling/edit/:id" element={<AlternativeSpellcastingScalingEditor userProfile={effectiveProfile} />} />
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
                  <Route path="/admin/proficiencies" element={<AdminProficiencies userProfile={effectiveProfile} />} />
                  <Route path="/settings" element={<Settings user={user} userProfile={userProfile} />} />
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
                <p className="text-xs mt-2">© 2026 Dungeon Master's Archive</p>
              </div>
            </footer>
            {effectiveProfile?.role === 'admin' && <DebugConsole />}
            <Toaster position="top-center" richColors />
          </div>
        </div>
      </Router>
    </TooltipProvider>
  );
}
