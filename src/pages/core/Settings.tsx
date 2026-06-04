import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fetchCollection, upsertDocument, queryD1 } from '../../lib/d1';
import { useWikiPreview } from '../../lib/wikiPreviewContext';
import { Button } from '../../components/ui/button';

import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
import { ImageUpload } from '../../components/ui/ImageUpload';
import { User, Shield, Key, Palette, UserCircle, Save, CheckCircle2, AlertCircle, CheckCircle2 as CheckCircle, Palette as PaletteIcon, Key as KeyIcon, UserCircle as UserIcon, Save as SaveIcon, AlertCircle as AlertIcon, Wrench, AlertTriangle, Trash2, RefreshCw, Search } from 'lucide-react';
import { getIdentity, getSessionToken } from "../../lib/auth";
import { AppearanceBuilder } from '../../components/appearance/AppearanceBuilder';
import { FavoriteCharacters } from '../../components/profile/FavoriteCharacters';

type SectionKey = 'profile' | 'appearance' | 'security' | 'maintenance';

// Master list for the searchable settings rail. `keywords` power the search so
// typing "password", "highlight", "purge" etc. surfaces the right section even
// though the term isn't in the section label.
const SETTINGS_SECTIONS: { key: SectionKey; label: string; icon: React.ReactNode; adminOnly?: boolean; keywords: string[] }[] = [
  { key: 'profile', label: 'Public Profile', icon: <UserCircle className="w-4 h-4" />, keywords: ['display name', 'avatar', 'username', 'discord', 'pronouns', 'bio', 'public', 'private profile', 'hide username'] },
  { key: 'appearance', label: 'Appearance', icon: <Palette className="w-4 h-4" />, keywords: ['theme', 'color', 'colour', 'highlight', 'accent', 'background', 'card', 'text', 'secondary text', 'dark', 'light', 'parchment', 'preview', 'opacity', 'contrast'] },
  { key: 'security', label: 'Security', icon: <Key className="w-4 h-4" />, keywords: ['password', 'change password', 'recovery email', 'privacy', 'login', 'account'] },
  { key: 'maintenance', label: 'Maintenance', icon: <Wrench className="w-4 h-4" />, adminOnly: true, keywords: ['purge', 'reset', 'cache', 'danger', 'delete data', 'prune', 'cleanup'] },
];

export default function Settings({ user, userProfile }: { user: any, userProfile: any }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const { refreshProfile } = useWikiPreview();
  
  const [activeSection, setActiveSection] = useState<SectionKey>(
    (tabParam === 'maintenance' && userProfile?.role === 'admin') ? 'maintenance' : 'profile'
  );
  const [query, setQuery] = useState('');
  const [displayName, setDisplayName] = useState(userProfile?.display_name || '');
  const [pronouns, setPronouns] = useState(userProfile?.pronouns || '');
  const [bio, setBio] = useState(userProfile?.bio || '');
  const [avatarUrl, setAvatarUrl] = useState(userProfile?.avatar_url || '');
  const [theme, setTheme] = useState(userProfile?.theme || 'parchment');
  const [accentColor, setAccentColor] = useState(userProfile?.accent_color || '#c5a059');
  
  const [username, setUsername] = useState(userProfile?.username || '');
  const [hideUsername, setHideUsername] = useState(userProfile?.hide_username || false);
  const [isPrivate, setIsPrivate] = useState(userProfile?.is_private || false);
  const [recoveryEmail, setRecoveryEmail] = useState(userProfile?.recovery_email || '');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  
  // Maintenance State
  const [safetyLock, setSafetyLock] = useState('');
  const [isPurging, setIsPurging] = useState(false);
  const [purgeStatus, setPurgeStatus] = useState('');

  const isAdmin = userProfile?.role === 'admin';

  useEffect(() => {
    if (tabParam === 'maintenance' && isAdmin) {
      setActiveSection('maintenance');
    }
  }, [tabParam, isAdmin]);

  useEffect(() => {
    if (userProfile) {
      setDisplayName(userProfile.display_name || '');
      setPronouns(userProfile.pronouns || '');
      setBio(userProfile.bio || '');
      setAvatarUrl(userProfile.avatar_url || '');
      setTheme(userProfile.theme || 'parchment');
      setAccentColor(userProfile.accent_color || (userProfile.theme === 'parchment' ? '#c5a059' : '#3b82f6'));
      setUsername(userProfile.username || '');
      setHideUsername(userProfile.hide_username || false);
      setIsPrivate(userProfile.is_private || false);
      setRecoveryEmail(userProfile.recovery_email || '');
    }
  }, [userProfile]);

  const handleThemeChange = (newTheme: string) => {
    setTheme(newTheme);
    const defaultColor = newTheme === 'parchment' ? '#c5a059' : '#3b82f6';
    setAccentColor(defaultColor);
    // Instant preview
    document.documentElement.classList.remove('light', 'dark', 'parchment');
    document.documentElement.classList.add(newTheme);
    document.documentElement.style.setProperty('--gold', defaultColor);
    document.documentElement.style.setProperty('--primary', defaultColor);
    document.documentElement.style.setProperty('--ring', defaultColor);
  };

  const handleAccentChange = (color: string) => {
    setAccentColor(color);
    document.documentElement.style.setProperty('--gold', color);
    document.documentElement.style.setProperty('--primary', color);
    document.documentElement.style.setProperty('--ring', color);
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setSuccess('');
    setError('');

    try {
      // display_name + avatar_url are written straight to D1 via PATCH /api/me
      // below — D1 is the source of truth. (The former Firebase Auth
      // updateProfile() call was dropped with the Firebase exit.)

      // PATCH /api/me — allow-listed fields only; the server drops any
      // column the client tries to set that isn't in its allow-list
      // (which deliberately excludes `role`). Closes H6.
      const idToken = await getSessionToken();
      const res = await fetch('/api/me', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          display_name: displayName,
          pronouns,
          bio,
          avatar_url: avatarUrl,
          theme,
          accent_color: accentColor,
          username,
          hide_username: hideUsername,
          is_private: isPrivate,
          recovery_email: recoveryEmail,
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `Failed to update profile (HTTP ${res.status})`);
      }

      // Refresh the app-wide profile state so other components pick up
      // the new values without a manual reload.
      await refreshProfile();
      setSuccess('Profile updated successfully!');
    } catch (err: any) {
      console.error('Update profile error:', err);
      setError(err.message || 'Failed to update profile');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword) {
      setError('Enter your current password');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);
    setSuccess('');
    setError('');

    try {
      // Native change-password — writes the new scrypt hash to D1, authenticated
      // by the current session (replaces Firebase updatePassword + its
      // "requires-recent-login" dance).
      const idToken = await getSessionToken();
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `Failed to update password (HTTP ${res.status})`);
      }
      setSuccess('Password updated successfully!');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      console.error('Update password error:', err);
      setError(err.message || 'Failed to update password');
    } finally {
      setLoading(false);
    }
  };

  // Searchable section list: gate admin-only, then match label + keywords.
  const q = query.trim().toLowerCase();
  const visibleSections = SETTINGS_SECTIONS
    .filter((s) => !s.adminOnly || isAdmin)
    .map((s) => {
      if (!q) return { ...s, hint: undefined as string | undefined };
      const inLabel = s.label.toLowerCase().includes(q);
      const kw = s.keywords.find((k) => k.includes(q));
      return inLabel || kw ? { ...s, hint: inLabel ? undefined : kw } : null;
    })
    .filter(Boolean) as { key: SectionKey; label: string; icon: React.ReactNode; hint?: string }[];

  // When a search hides the active section, jump to the top match.
  useEffect(() => {
    if (q && visibleSections.length && !visibleSections.some((s) => s.key === activeSection)) {
      setActiveSection(visibleSections[0].key);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  // Viewport-bounded shell: measure the shell's top and fill down to the
  // viewport bottom so the PAGE never scrolls — only the detail pane scrolls
  // internally when a section is tall. Resize-only (never on scroll) to avoid
  // the feedback loop the preview frame had. Mirrors ThemePreview's approach.
  const shellRef = useRef<HTMLDivElement>(null);
  const [shellHeight, setShellHeight] = useState<number>(640);
  useLayoutEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const measure = () => {
      const top = el.getBoundingClientRect().top;
      setShellHeight(Math.max(420, Math.round(window.innerHeight - top - 12)));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  if (!user || !userProfile) {
    return <div className="text-center py-20 font-serif italic">Please log in to access settings.</div>;
  }

  return (
    <div ref={shellRef} className="w-full flex flex-col overflow-hidden" style={{ height: shellHeight }}>
      <div className="grid md:grid-cols-[240px_1fr] gap-8 flex-1 min-h-0">
        {/* Master — title, role, and the searchable settings list */}
        <div className="flex flex-col min-h-0">
          <div className="mb-5 shrink-0">
            <h1 className="h2-title leading-none">Settings</h1>
            <div className="flex items-center gap-2 mt-2">
              <span className="label-text text-ink/45">Role</span>
              <Badge variant="outline" className={`capitalize text-[10px] px-2 py-0 ${(userProfile.role === 'admin' || userProfile.role === 'co-dm') ? 'border-gold text-gold bg-gold/5' : 'border-ink/25 text-ink/45'}`}>
                <Shield className="w-3 h-3 mr-1" />
                {userProfile.role.replace('-', ' ')}
              </Badge>
            </div>
          </div>
          <div className="relative mb-3 shrink-0">
            <Search className="w-4 h-4 text-ink/35 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <Input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search settings…"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              className="pl-9 h-10 bg-background border-gold/25 focus:border-gold text-sm text-ink"
            />
          </div>
          <nav className="space-y-1 overflow-y-auto custom-scrollbar -mr-1 pr-1">
            {visibleSections.map((s) => (
              <SettingsNavButton
                key={s.key}
                active={activeSection === s.key}
                onClick={() => setActiveSection(s.key)}
                icon={s.icon}
                label={s.label}
                hint={s.hint}
              />
            ))}
            {visibleSections.length === 0 && (
              <p className="text-xs text-ink/45 italic px-3 py-2">No settings match “{query}”.</p>
            )}
          </nav>
        </div>

        {/* Detail pane — scrolls internally so the page itself never scrolls */}
        <div className="min-w-0 h-full overflow-y-auto custom-scrollbar pb-10 -mr-2 pr-2">
          {activeSection === 'profile' && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-3xl mx-auto">
              {/* Slim header — consistent with Appearance; no heavy Card chrome. */}
              <div className="flex items-center gap-3 mb-6 pb-4 border-b border-gold/15">
                <UserCircle className="text-gold w-7 h-7 shrink-0" />
                <div className="min-w-0">
                  <h2 className="h2-title leading-none">Public Profile</h2>
                  <p className="text-xs text-ink/55 mt-1">How you appear to other players in the archive.</p>
                </div>
              </div>

              <form onSubmit={handleUpdateProfile} className="space-y-6">
                {/* Identity row — avatar preview beside the fields. Stacks on
                    narrow screens (flex-col) so it stays usable on mobile. */}
                <div className="flex flex-col sm:flex-row gap-6">
                  {/* Avatar preview — solid surface + a person glyph (no nested
                      circle / translucent badge), so nothing overlaps oddly. */}
                  <div className="flex flex-col items-center gap-2 shrink-0">
                    <div className="w-28 h-28 rounded-full overflow-hidden border-2 border-gold/30 bg-gold/10 flex items-center justify-center">
                      {avatarUrl ? (
                        <img src={avatarUrl} alt="Avatar preview" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        <User className="w-11 h-11 text-gold/45" />
                      )}
                    </div>
                    <span className="label-text text-ink/45">Preview</span>
                  </div>

                  <div className="flex-1 min-w-0 space-y-4">
                    <div className="space-y-1.5">
                      <label className="label-text text-ink/65">Display Name</label>
                      <Input
                        className="bg-background/50 border-gold/25 focus:border-gold h-10 font-serif text-ink"
                        value={displayName}
                        onChange={e => setDisplayName(e.target.value)}
                        placeholder="e.g. Elara the Wise"
                      />
                    </div>
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="label-text text-ink/65">Pronouns</label>
                        <Input
                          className="bg-background/50 border-gold/25 focus:border-gold h-10 text-ink"
                          value={pronouns}
                          onChange={e => setPronouns(e.target.value)}
                          placeholder="e.g. they/them"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="label-text text-ink/65">Username (Discord)</label>
                        <Input
                          className="bg-background/50 border-gold/25 focus:border-gold h-10 text-ink"
                          value={username}
                          onChange={e => setUsername(e.target.value)}
                          placeholder="e.g. user#1234"
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label className="label-text text-ink/65">Avatar image</label>
                      <ImageUpload
                        currentImageUrl={avatarUrl}
                        storagePath={`images/users/${userProfile?.id || 'avatar'}/`}
                        onUpload={(url) => setAvatarUrl(url)}
                      />
                      <p className="text-[11px] text-ink/45 italic">Paste a direct image link or upload one. Leave empty for no avatar. Changing your username requires re-login.</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="label-text text-ink/65">Biography</label>
                  <textarea
                    className="w-full min-h-[110px] p-3 border border-gold/25 bg-background/50 focus:border-gold focus:ring-1 focus:ring-gold outline-none body-text text-sm text-ink"
                    value={bio}
                    onChange={e => setBio(e.target.value)}
                    placeholder="Share a brief introduction about yourself..."
                  />
                </div>

                <div className="grid sm:grid-cols-2 gap-3">
                  <label className="flex items-center justify-between gap-3 p-3 border border-gold/15 bg-background/40 cursor-pointer">
                    <span className="min-w-0">
                      <span className="block font-bold text-sm text-ink">Hide Username</span>
                      <span className="block text-[11px] text-ink/55">Don't show your username publicly.</span>
                    </span>
                    <input type="checkbox" checked={hideUsername} onChange={e => setHideUsername(e.target.checked)} className="w-5 h-5 accent-gold shrink-0" />
                  </label>
                  <label className="flex items-center justify-between gap-3 p-3 border border-gold/15 bg-background/40 cursor-pointer">
                    <span className="min-w-0">
                      <span className="block font-bold text-sm text-ink">Private Profile</span>
                      <span className="block text-[11px] text-ink/55">Hide your profile from other players.</span>
                    </span>
                    <input type="checkbox" checked={isPrivate} onChange={e => setIsPrivate(e.target.checked)} className="w-5 h-5 accent-gold shrink-0" />
                  </label>
                </div>

                <div className="flex justify-end pt-1">
                  <Button type="submit" disabled={loading} className="btn-gold-solid gap-2 px-6 h-10">
                    <Save className="w-4 h-4" /> Save
                  </Button>
                </div>
              </form>

              {/* Featured characters — self-saving, so it lives outside the
                  profile <form> (its own PUT endpoint, not the profile PATCH). */}
              <div className="mt-8 pt-6 border-t border-gold/15">
                <FavoriteCharacters />
              </div>
            </div>
          )}

          {activeSection === 'appearance' && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              {/* No Card wrapper — the builder owns its own two-column studio
                  layout (controls + sticky live preview) and needs the full
                  width to breathe, so we give it a slim header and let it run. */}
              <div className="flex items-center gap-3 mb-6 pb-4 border-b border-gold/15">
                <Palette className="text-gold w-7 h-7 shrink-0" />
                <div className="min-w-0">
                  <h2 className="h2-title leading-none">Appearance</h2>
                  <p className="text-xs text-ink/55 mt-1">Personalize your colors over a base theme — changes stay in the preview until you save.</p>
                </div>
              </div>
              <AppearanceBuilder userProfile={userProfile} onSaved={refreshProfile} />
            </div>
          )}

          {activeSection === 'security' && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-3xl mx-auto space-y-8">
              {/* Slim header — matches Profile/Appearance; no heavy Card chrome. */}
              <div className="flex items-center gap-3 pb-4 border-b border-gold/15">
                <Key className="text-gold w-7 h-7 shrink-0" />
                <div className="min-w-0">
                  <h2 className="h2-title leading-none">Security</h2>
                  <p className="text-xs text-ink/55 mt-1">Password, recovery, and account safety.</p>
                </div>
              </div>

              <form onSubmit={handleUpdatePassword} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="label-text text-ink/65">Current Password</label>
                  <Input
                    type="password"
                    autoComplete="current-password"
                    className="bg-background/50 border-gold/25 focus:border-gold h-10 text-ink"
                    value={currentPassword}
                    onChange={e => setCurrentPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="label-text text-ink/65">New Password</label>
                    <Input type="password" className="bg-background/50 border-gold/25 focus:border-gold h-10 text-ink"
                      value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="••••••••" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="label-text text-ink/65">Confirm Password</label>
                    <Input type="password" className="bg-background/50 border-gold/25 focus:border-gold h-10 text-ink"
                      value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="••••••••" />
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button type="submit" disabled={loading || !currentPassword || !newPassword} className="btn-gold-solid gap-2 px-6 h-10">
                    Update Password
                  </Button>
                </div>
              </form>

              <form onSubmit={handleUpdateProfile} className="space-y-3 pt-6 border-t border-gold/15">
                <div className="space-y-1.5">
                  <label className="label-text text-ink/65">Recovery Email</label>
                  <p className="text-[11px] text-ink/45 italic">If you forget your password, your GM can use this address to send you a reset link.</p>
                  <Input type="email" className="bg-background/50 border-gold/25 focus:border-gold h-10 text-ink"
                    value={recoveryEmail} onChange={e => setRecoveryEmail(e.target.value)} placeholder="e.g. your.email@example.com" />
                </div>
                <div className="flex justify-end">
                  <Button type="submit" disabled={loading} className="btn-gold-solid gap-2 px-6 h-10">
                    Save Recovery Email
                  </Button>
                </div>
              </form>

              {/* Danger zone — compact inline panel, not a full Card. */}
              <div className="border border-blood/30 bg-blood/5 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <AlertCircle className="w-4 h-4 text-blood" />
                  <span className="label-text text-blood">Danger Zone</span>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold text-sm text-blood">Delete Profile</p>
                    <p className="text-[11px] text-ink/55">Removes your profile data from the archive. Your login stays active until a GM removes it.</p>
                  </div>
                  <Button variant="ghost" className="btn-danger border border-blood/20 w-full sm:w-auto h-9 text-xs shrink-0">
                    Delete Profile
                  </Button>
                </div>
              </div>
            </div>
          )}
          
          {activeSection === 'maintenance' && isAdmin && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-3xl mx-auto space-y-6">
              {/* Slim header with the Admin-Only marker. */}
              <div className="flex items-center justify-between gap-3 pb-4 border-b border-gold/15">
                <div className="flex items-center gap-3 min-w-0">
                  <Wrench className="text-gold w-7 h-7 shrink-0" />
                  <div className="min-w-0">
                    <h2 className="h2-title leading-none">Maintenance</h2>
                    <p className="text-xs text-ink/55 mt-1">Destructive admin data tools.</p>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-bold text-blood border border-blood/40 bg-blood/5 px-2 py-1 shrink-0">
                  <AlertTriangle className="w-3.5 h-3.5" /> Admin Only
                </span>
              </div>

              {/* Safety lock — compact inline panel. */}
              <div className="border border-blood/25 bg-blood/5 p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="text-blood w-5 h-5 shrink-0 mt-0.5" />
                  <p className="text-xs text-ink/65 italic">These actions are irreversible and permanently delete data from the archive. Type <strong className="text-blood not-italic">PURGE</strong> to unlock the tools below.</p>
                </div>
                <Input
                  value={safetyLock}
                  onChange={e => setSafetyLock(e.target.value)}
                  placeholder="Type PURGE to unlock"
                  className={`h-10 max-w-xs text-center font-mono font-black tracking-[0.4em] transition-all ${safetyLock === 'PURGE' ? 'border-blood bg-blood/10 text-blood' : 'border-gold/15 bg-background/50'}`}
                />
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <MaintenanceCard
                  title="Spells"
                  description="Deletes all spell records. Use before a full spell re-import."
                  onPurge={() => handlePurge('spells', ['spells'])}
                  disabled={safetyLock !== 'PURGE' || isPurging}
                />
                <MaintenanceCard
                  title="Feats"
                  description="Deletes all feat records (favorites cascade). Use before a full re-import."
                  onPurge={() => handlePurge('feats', ['feats'])}
                  disabled={safetyLock !== 'PURGE' || isPurging}
                />
                <MaintenanceCard
                  title="Species (Races)"
                  description="Deletes all species records (favorites cascade). Use before a full re-import."
                  onPurge={() => handlePurge('species', ['species'])}
                  disabled={safetyLock !== 'PURGE' || isPurging}
                />
                <MaintenanceCard
                  title="Backgrounds"
                  description="Deletes all background records (favorites cascade). Use before a full re-import."
                  onPurge={() => handlePurge('backgrounds', ['backgrounds'])}
                  disabled={safetyLock !== 'PURGE' || isPurging}
                />
                <MaintenanceCard
                  title="Tags & Taxonomy"
                  description="Deletes all tags and tag groups. Disconnects tags from every item."
                  onPurge={() => handlePurge('tags', ['tags', 'tagGroups'])}
                  disabled={safetyLock !== 'PURGE' || isPurging}
                />
                <MaintenanceCard
                  title="Classes & Subclasses"
                  description="Deletes all class and subclass data. Linked features are orphaned."
                  onPurge={() => handlePurge('classes', ['classes', 'features', 'scalingColumns'])}
                  disabled={safetyLock !== 'PURGE' || isPurging}
                />
                <MaintenanceCard
                  title="Sources & Documents"
                  description="Deletes all source metadata and book entries. The nuclear option."
                  onPurge={() => handlePurge('sources', ['sources'])}
                  disabled={safetyLock !== 'PURGE' || isPurging}
                />
              </div>

              {isPurging && (
                <div className="p-4 bg-gold/5 border border-gold/25 flex items-center gap-3 animate-pulse">
                  <RefreshCw className="w-5 h-5 text-gold animate-spin shrink-0" />
                  <div className="min-w-0">
                    <p className="font-bold text-sm text-gold">Purge in progress…</p>
                    <p className="text-[11px] text-ink/65">{purgeStatus}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Status Messages */}
          <div className="fixed bottom-8 right-8 z-50 space-y-2">
            {success && (
              <div className="flex items-center gap-3 p-4 bg-card text-archive-blue rounded-xl border-2 border-archive-blue/10 shadow-2xl animate-in fade-in slide-in-from-right-8">
                <CheckCircle2 className="w-6 h-6 text-archive-blue" />
                <p className="text-sm font-bold">{success}</p>
              </div>
            )}
            {error && (
              <div className="flex items-center gap-3 p-4 bg-card text-blood rounded-xl border-2 border-blood/10 shadow-2xl animate-in fade-in slide-in-from-right-8">
                <AlertCircle className="w-6 h-6 text-blood" />
                <p className="text-sm font-bold">{error}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  async function handlePurge(label: string, collections: string[]) {
    if (!window.confirm(`FINAL WARNING: This will permanently delete ALL ${label} data from D1. Are you sure?`)) return;
    
    setIsPurging(true);
    setSuccess('');
    setError('');
    
    try {
      for (const collectionName of collections) {
        setPurgeStatus(`Purging ${collectionName}...`);
        // We use a direct DELETE query for the entire table
        // D1 table names are resolved via getTableName in our lib, but here we can just use the mapped ones or snake_case
        const tableName = collectionName.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
        await queryD1(`DELETE FROM ${tableName}`, []);
      }
      setSuccess(`Archive Purge Complete: All ${label} data has been removed from D1.`);
      setSafetyLock('');
    } catch (err: any) {
      console.error(`Purge failed for ${label}:`, err);
      setError(`Purge failed: ${err.message}`);
    } finally {
      setIsPurging(false);
      setPurgeStatus('');
    }
  }
}

function MaintenanceCard({ title, description, onPurge, disabled }: { title: string, description: string, onPurge: () => void, disabled: boolean }) {
  return (
    <div className={`p-4 border transition-all ${disabled ? 'opacity-50 grayscale border-gold/5 bg-card/20' : 'border-gold/15 bg-card hover:border-blood/30'}`}>
      <h4 className="font-serif text-base font-bold text-ink mb-1">{title}</h4>
      <p className="text-[11px] text-ink/60 mb-3 leading-relaxed italic">{description}</p>
      <Button
        onClick={onPurge}
        disabled={disabled}
        className="w-full btn-danger gap-2 h-9 text-xs border border-blood/20"
      >
        <Trash2 className="w-3.5 h-3.5" /> Purge Collection
      </Button>
    </div>
  );
}

function SettingsNavButton({ icon, label, active = false, onClick, hint }: { icon: React.ReactNode, label: string, active?: boolean, onClick: () => void, hint?: string }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left rounded-md text-xs font-bold uppercase tracking-wider transition-colors ${
        active
          ? 'bg-gold text-[var(--primary-foreground)]'
          : 'text-ink/65 hover:bg-gold/10 hover:text-gold'
      }`}
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {hint && (
          <span className={`block text-[9px] font-normal normal-case tracking-normal truncate ${active ? 'text-[var(--primary-foreground)]/80' : 'text-ink/45'}`}>
            matches “{hint}”
          </span>
        )}
      </span>
    </button>
  );
}

function ThemeOption({ label, description, className, active, onClick }: { label: string, description: string, className: string, active: boolean, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={`relative p-6 rounded-2xl border-2 flex flex-col items-start text-left transition-all h-full ${className} ${
        active 
        ? 'ring-4 ring-gold ring-offset-4 ring-offset-background scale-[1.02] border-gold' 
        : 'border-transparent hover:border-gold/25'
      }`}
    >
      <p className="font-serif text-2xl font-bold mb-2">{label}</p>
      {description && <p className="text-xs opacity-70 leading-relaxed">{description}</p>}
      {active && (
        <div className="absolute top-4 right-4 bg-gold text-[var(--primary-foreground)] p-1 rounded-full">
          <CheckCircle2 className="w-4 h-4" />
        </div>
      )}
    </button>
  );
}
