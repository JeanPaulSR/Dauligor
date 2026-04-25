import React, { useState, useEffect } from 'react';
import { auth, db, updateProfile, updatePassword, updateEmail, OperationType, handleFirestoreError } from '../../lib/firebase';
import { usernameToEmail } from '../../lib/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Separator } from '../../components/ui/separator';
import { ImageUpload } from '../../components/ui/ImageUpload';
import { User, Shield, Key, Palette, UserCircle, Save, CheckCircle2, AlertCircle, CheckCircle2 as CheckCircle, Palette as PaletteIcon, Key as KeyIcon, UserCircle as UserIcon, Save as SaveIcon, AlertCircle as AlertIcon } from 'lucide-react';

export default function Settings({ user, userProfile }: { user: any, userProfile: any }) {
  const [activeSection, setActiveSection] = useState<'profile' | 'security' | 'appearance'>('profile');
  const [displayName, setDisplayName] = useState(userProfile?.displayName || '');
  const [pronouns, setPronouns] = useState(userProfile?.pronouns || '');
  const [bio, setBio] = useState(userProfile?.bio || '');
  const [avatarUrl, setAvatarUrl] = useState(userProfile?.avatarUrl || '');
  const [theme, setTheme] = useState(userProfile?.theme || 'parchment');
  const [accentColor, setAccentColor] = useState(userProfile?.accentColor || '#c5a059');
  
  const [username, setUsername] = useState(userProfile?.username || '');
  const [hideUsername, setHideUsername] = useState(userProfile?.hideUsername || false);
  const [isPrivate, setIsPrivate] = useState(userProfile?.isPrivate || false);
  const [recoveryEmail, setRecoveryEmail] = useState(userProfile?.recoveryEmail || '');

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (userProfile) {
      setDisplayName(userProfile.displayName || '');
      setPronouns(userProfile.pronouns || '');
      setBio(userProfile.bio || '');
      setAvatarUrl(userProfile.avatarUrl || '');
      setTheme(userProfile.theme || 'parchment');
      setAccentColor(userProfile.accentColor || (userProfile.theme === 'parchment' ? '#c5a059' : '#3b82f6'));
      setUsername(userProfile.username || '');
      setHideUsername(userProfile.hideUsername || false);
      setIsPrivate(userProfile.isPrivate || false);
      setRecoveryEmail(userProfile.recoveryEmail || '');
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
      // Update Auth Profile
      if (auth.currentUser) {
        await updateProfile(auth.currentUser, { 
          displayName,
          photoURL: avatarUrl 
        });

        if (username !== userProfile.username) {
          try {
            await updateEmail(auth.currentUser, usernameToEmail(username));
          } catch (emailErr: any) {
            if (emailErr.code === 'auth/requires-recent-login') {
              throw new Error('For security, please log out and log back in before changing your username.');
            }
            throw emailErr;
          }
        }
      }

      // Update Firestore Profile
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        displayName,
        pronouns,
        bio,
        avatarUrl,
        theme,
        accentColor,
        username,
        hideUsername,
        isPrivate,
        recoveryEmail
      });

      setSuccess('Profile updated successfully!');
    } catch (err: any) {
      console.error('Update profile error:', err);
      setError(err.message || 'Failed to update profile');
      if (err.message !== 'For security, please log out and log back in before changing your username.') {
        handleFirestoreError(err, OperationType.UPDATE, `users/${user.uid}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
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
      if (auth.currentUser) {
        await updatePassword(auth.currentUser, newPassword);
        setSuccess('Password updated successfully!');
        setNewPassword('');
        setConfirmPassword('');
      }
    } catch (err: any) {
      console.error('Update password error:', err);
      if (err.code === 'auth/requires-recent-login') {
        setError('For security, please log out and log back in before changing your password.');
      } else {
        setError(err.message || 'Failed to update password');
      }
    } finally {
      setLoading(false);
    }
  };

  if (!user || !userProfile) {
    return <div className="text-center py-20 font-serif italic">Please log in to access settings.</div>;
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-20">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="h1-title">Settings</h1>
        </div>
        <div className="flex flex-col items-start md:items-end gap-1">
          <span className="label-text text-ink/40">Current Role</span>
          <Badge variant="outline" className={`capitalize ${(userProfile.role === 'admin' || userProfile.role === 'co-dm') ? 'border-gold text-gold bg-gold/5' : 'border-ink/20 text-ink/40'}`}>
            <Shield className="w-3 h-3 mr-1.5" />
            {userProfile.role.replace('-', ' ')}
          </Badge>
        </div>
      </div>

      <div className="grid md:grid-cols-4 gap-8">
        {/* Sidebar Navigation */}
        <div className="space-y-1">
          <SettingsNavButton 
            active={activeSection === 'profile'} 
            onClick={() => setActiveSection('profile')}
            icon={<UserCircle className="w-4 h-4" />} 
            label="Public Profile" 
          />
          <SettingsNavButton 
            active={activeSection === 'appearance'} 
            onClick={() => setActiveSection('appearance')}
            icon={<Palette className="w-4 h-4" />} 
            label="Appearance" 
          />
          <SettingsNavButton 
            active={activeSection === 'security'} 
            onClick={() => setActiveSection('security')}
            icon={<Key className="w-4 h-4" />} 
            label="Security" 
          />
        </div>

        <div className="md:col-span-3 space-y-8">
          {activeSection === 'profile' && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <Card className="border-gold/20 bg-card shadow-xl relative overflow-hidden">
                {/* Parchment texture overlay */}
                <div className="absolute inset-0 opacity-[0.03] pointer-events-none bg-[url('https://www.transparenttextures.com/patterns/paper-fibers.png')]" />
                
                <CardHeader className="border-b border-gold/10 pb-6">
                  <CardTitle className="h2-title flex items-center gap-3">
                    <UserCircle className="text-gold w-8 h-8" /> Public Profile
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-8">
                  <form onSubmit={handleUpdateProfile} className="space-y-8">
                    <div className="grid md:grid-cols-2 gap-8">
                      <div className="space-y-6">
                        <div className="space-y-2">
                          <label className="label-text text-ink/60">Display Name</label>
                          <Input 
                            className="bg-background/50 border-gold/20 focus:border-gold h-12 text-lg font-serif text-ink"
                            value={displayName} 
                            onChange={e => setDisplayName(e.target.value)} 
                            placeholder="e.g. Elara the Wise" 
                          />
                        </div>

                        <div className="space-y-2">
                          <label className="label-text text-ink/60">Pronouns</label>
                          <Input 
                            className="bg-background/50 border-gold/20 focus:border-gold h-12 text-ink"
                            value={pronouns} 
                            onChange={e => setPronouns(e.target.value)} 
                            placeholder="e.g. they/them" 
                          />
                        </div>
                        
                        <div className="space-y-2">
                          <label className="label-text text-ink/60">Avatar</label>
                          <ImageUpload
                            currentImageUrl={avatarUrl}
                            storagePath={`images/users/${userProfile?.uid || 'avatar'}/`}
                            onUpload={(url) => setAvatarUrl(url)}
                          />
                          <p className="muted-text italic">Provide a direct link to an image or upload one. Leave empty for no avatar.</p>
                        </div>

                        <div className="space-y-2">
                          <label className="label-text text-ink/60">Username (Discord Name)</label>
                          <Input 
                            className="bg-background/50 border-gold/20 focus:border-gold h-12 text-ink"
                            value={username} 
                            onChange={e => setUsername(e.target.value)} 
                            placeholder="e.g. user#1234" 
                          />
                          <p className="muted-text italic">Changing this will require you to log in again.</p>
                        </div>
                      </div>

                      <div className="flex flex-col items-center justify-center p-6 bg-gold/5 rounded-2xl border border-gold/10">
                        <p className="label-text text-gold mb-4">Preview</p>
                        <div className="relative">
                          <div className="w-32 h-32 rounded-full border-4 border-gold/30 overflow-hidden shadow-inner bg-background flex items-center justify-center">
                            {avatarUrl ? (
                              <img 
                                src={avatarUrl} 
                                alt="Preview" 
                                className="w-full h-full object-cover"
                                referrerPolicy="no-referrer"
                              />
                            ) : (
                              <UserCircle className="w-20 h-20 text-gold/20" />
                            )}
                          </div>
                          <div className="absolute -bottom-2 -right-2 bg-gold text-white p-2 rounded-full shadow-lg">
                            <CheckCircle2 className="w-4 h-4" />
                          </div>
                        </div>
                        <p className="mt-4 h3-title">{displayName || userProfile.username}</p>
                        {pronouns && <p className="description-text text-xs text-ink/60">{pronouns}</p>}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="label-text text-ink/60">Biography</label>
                      <textarea 
                        className="w-full min-h-[150px] p-4 rounded-xl border border-gold/20 bg-background/50 focus:border-gold focus:ring-1 focus:ring-gold outline-none body-text text-lg"
                        value={bio}
                        onChange={e => setBio(e.target.value)}
                        placeholder="Share a brief introduction about yourself..."
                      />
                    </div>

                    <div className="grid sm:grid-cols-2 gap-6 p-6 bg-background/50 border border-gold/10 rounded-xl">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-bold text-ink">Hide Username</p>
                          <p className="text-xs text-ink/60">Do not show your username publicly.</p>
                        </div>
                        <input 
                          type="checkbox" 
                          checked={hideUsername} 
                          onChange={e => setHideUsername(e.target.checked)}
                          className="w-5 h-5 accent-gold"
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-bold text-ink">Private Profile</p>
                          <p className="text-xs text-ink/60">Hide your profile details from other players.</p>
                        </div>
                        <input 
                          type="checkbox" 
                          checked={isPrivate} 
                          onChange={e => setIsPrivate(e.target.checked)}
                          className="w-5 h-5 accent-gold"
                        />
                      </div>
                    </div>

                    <div className="flex justify-end pt-4">
                      <Button type="submit" disabled={loading} className="btn-gold-solid gap-2 px-8 h-12 shadow-lg shadow-gold/20">
                        <Save className="w-4 h-4" /> Save
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            </div>
          )}

          {activeSection === 'appearance' && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <Card className="border-gold/20 bg-card shadow-xl relative overflow-hidden">
                <div className="absolute inset-0 opacity-[0.03] pointer-events-none bg-[url('https://www.transparenttextures.com/patterns/paper-fibers.png')]" />
                
                <CardHeader className="border-b border-gold/10 pb-6">
                  <CardTitle className="h2-title flex items-center gap-3">
                    <Palette className="text-gold w-8 h-8" /> Appearance
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-8 space-y-12">
                  <div className="space-y-6">
                    <h3 className="label-text text-ink/60">Theme Selection</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                      <ThemeOption 
                        active={theme === 'parchment'} 
                        onClick={() => handleThemeChange('parchment')}
                        label="Parchment" 
                        description=""
                        className="bg-[#f5f5f0] border-gold/20 text-[#1a1a1a]" 
                      />
                      <ThemeOption 
                        active={theme === 'light'} 
                        onClick={() => handleThemeChange('light')}
                        label="Light" 
                        description=""
                        className="bg-[#ffffff] border-black/10 text-[#1a1a1a]" 
                      />
                      <ThemeOption 
                        active={theme === 'dark'} 
                        onClick={() => handleThemeChange('dark')}
                        label="Dark" 
                        description=""
                        className="bg-[#1a1a1e] border-white/10 text-[#e2e2e8]" 
                      />
                    </div>
                  </div>

                  <div className="space-y-6">
                    <h3 className="label-text text-ink/60">Highlight Color</h3>
                    <div className="flex flex-wrap gap-4 items-center">
                      {['#c5a059', '#3b82f6', '#8b0000', '#10b981', '#8b5cf6', '#f59e0b'].map(color => (
                        <button
                          type="button"
                          key={color}
                          onClick={() => handleAccentChange(color)}
                          className={`w-12 h-12 rounded-full border-4 transition-all ${accentColor === color ? 'border-ink scale-110 shadow-lg' : 'border-transparent hover:scale-105'}`}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                      <div className="relative w-12 h-12">
                        <input
                          type="color"
                          value={accentColor}
                          onChange={(e) => handleAccentChange(e.target.value)}
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        />
                        <div 
                          className="w-12 h-12 rounded-full border-4 border-ink/20 flex items-center justify-center transition-all hover:scale-105 pointer-events-none shadow-sm bg-gradient-to-br from-red-500 via-green-500 to-blue-500"
                        >
                          <div 
                            className="w-8 h-8 rounded-full border-2 border-white/50" 
                            style={{ backgroundColor: accentColor }} 
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="mt-12 p-6 bg-gold/5 rounded-2xl border border-dashed border-gold/30 text-center">
                    <p className="description-text text-sm text-ink/60">Your preferences will be remembered across all your devices.</p>
                    <Button onClick={handleUpdateProfile} disabled={loading} className="mt-4 bg-gold/10 text-gold hover:bg-gold/20 border border-gold/20">
                      Save All Preferences
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {activeSection === 'security' && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <Card className="border-gold/20 bg-card shadow-xl relative overflow-hidden">
                <div className="absolute inset-0 opacity-[0.03] pointer-events-none bg-[url('https://www.transparenttextures.com/patterns/paper-fibers.png')]" />
                
                <CardHeader className="border-b border-gold/10 pb-6">
                  <CardTitle className="h2-title flex items-center gap-3">
                    <Key className="text-gold w-8 h-8" /> Security
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-8">
                  <form onSubmit={handleUpdatePassword} className="space-y-6">
                    <div className="grid sm:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <label className="label-text text-ink/60">New Password</label>
                        <Input 
                          type="password" 
                          className="bg-background/50 border-gold/20 focus:border-gold h-12 text-ink"
                          value={newPassword} 
                          onChange={e => setNewPassword(e.target.value)} 
                          placeholder="••••••••" 
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="label-text text-ink/60">Confirm Password</label>
                        <Input 
                          type="password" 
                          className="bg-background/50 border-gold/20 focus:border-gold h-12 text-ink"
                          value={confirmPassword} 
                          onChange={e => setConfirmPassword(e.target.value)} 
                          placeholder="••••••••" 
                        />
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <Button type="submit" disabled={loading || !newPassword} className="bg-primary text-primary-foreground gap-2 px-8 h-12">
                        Update Password
                      </Button>
                    </div>
                  </form>
                  
                  <Separator className="my-8 bg-gold/10" />

                  <form onSubmit={handleUpdateProfile} className="space-y-6">
                    <div className="space-y-2">
                      <label className="label-text text-ink/60">Recovery Email</label>
                      <p className="description-text text-xs text-ink/60 mb-2">Save an email address here. If you forget your password, your GM can use this to send you a password reset link.</p>
                      <Input 
                        type="email" 
                        className="bg-background/50 border-gold/20 focus:border-gold h-12 text-ink"
                        value={recoveryEmail} 
                        onChange={e => setRecoveryEmail(e.target.value)} 
                        placeholder="e.g. your.email@example.com" 
                      />
                    </div>
                    <div className="flex justify-end">
                      <Button type="submit" disabled={loading} className="btn-gold-solid gap-2 px-8 h-12">
                        Save Recovery Email
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>

              <Card className="border-blood/20 bg-blood/5">
                <CardHeader>
                  <CardTitle className="h3-title text-blood flex items-center gap-2">
                    <AlertCircle /> Danger Zone
                  </CardTitle>
                  <CardDescription className="muted-text text-blood/60">Irreversible actions for your account.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col sm:flex-row items-center justify-between p-6 border border-blood/20 rounded-xl bg-card/50 gap-4">
                    <div>
                      <p className="font-bold text-blood">Delete Profile</p>
                      <p className="text-xs text-ink/60">This will remove your profile data from the archive. Your login will remain active until a GM removes it.</p>
                    </div>
                    <Button variant="ghost" className="btn-danger border border-blood/20 w-full sm:w-auto">
                      Delete Profile
                    </Button>
                  </div>
                </CardContent>
              </Card>
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
}

function SettingsNavButton({ icon, label, active = false, onClick }: { icon: React.ReactNode, label: string, active?: boolean, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-6 py-4 rounded-xl text-sm font-bold uppercase tracking-widest transition-all ${
        active 
        ? 'bg-gold text-white shadow-lg shadow-gold/20 scale-[1.02]' 
        : 'text-ink/60 hover:bg-gold/5 hover:text-gold'
      }`}
    >
      {icon}
      {label}
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
        : 'border-transparent hover:border-gold/20'
      }`}
    >
      <p className="font-serif text-2xl font-bold mb-2">{label}</p>
      {description && <p className="text-xs opacity-70 leading-relaxed">{description}</p>}
      {active && (
        <div className="absolute top-4 right-4 bg-gold text-white p-1 rounded-full">
          <CheckCircle2 className="w-4 h-4" />
        </div>
      )}
    </button>
  );
}
