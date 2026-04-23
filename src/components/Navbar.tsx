import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { 
  auth, 
  db,
  usernameToEmail, 
  signInWithEmailAndPassword, 
  signOut 
} from '../lib/firebase';
import { doc, getDoc, collection, query, where, onSnapshot, updateDoc } from 'firebase/firestore';
import { Button } from './ui/button';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from './ui/dropdown-menu';
import { Shield, Book, BookOpen, Map as MapIcon, Users, Bookmark, LogOut, LogIn, Eye, EyeOff, Settings, LayoutGrid, UserCircle, ChevronDown, Swords, Menu } from 'lucide-react';
import { Badge } from './ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog';
import { Input } from './ui/input';

export default function Navbar({ 
  user, 
  userProfile, 
  previewMode, 
  setPreviewMode,
  onMenuClick
}: { 
  user: any, 
  userProfile: any,
  previewMode: boolean,
  setPreviewMode: (val: boolean) => void,
  onMenuClick: () => void
}) {
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [authData, setAuthData] = useState({
    username: '',
    password: ''
  });
  const [error, setError] = useState('');
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [activeCampaign, setActiveCampaign] = useState<any>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!userProfile) {
      setCampaigns([]);
      setActiveCampaign(null);
      return;
    }

    const isAdmin = userProfile.role === 'admin';
    const isCoDM = userProfile.role === 'co-dm';
    
    let q;
    if (isAdmin) {
      q = collection(db, 'campaigns');
    } else if (isCoDM && userProfile.campaignIds?.length > 0) {
      q = query(collection(db, 'campaigns'), where('__name__', 'in', userProfile.campaignIds));
    } else if (userProfile.campaignIds?.length > 0) {
      q = query(collection(db, 'campaigns'), where('__name__', 'in', userProfile.campaignIds));
    } else {
      setCampaigns([]);
      setActiveCampaign(null);
      return;
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const campaignList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setCampaigns(campaignList);
      
      const active = campaignList.find(c => c.id === userProfile.activeCampaignId);
      setActiveCampaign(active || campaignList[0]);
    }, (error) => {
      console.error("Error fetching campaigns in navbar:", error);
    });

    return () => unsubscribe();
  }, [userProfile?.campaignIds, userProfile?.activeCampaignId, userProfile?.role, userProfile?.username]);

  const handleSwitchCampaign = async (campaignId: string) => {
    if (!user?.uid) return;
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        activeCampaignId: campaignId
      });
    } catch (err) {
      console.error("Error switching campaign:", err);
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    const email = usernameToEmail(authData.username);

    try {
      await signInWithEmailAndPassword(auth, email, authData.password);
      setIsAuthOpen(false);
      setAuthData({ username: '', password: '' });
    } catch (err: any) {
      console.error('Auth error:', err);
      if (err.code === 'auth/operation-not-allowed') {
        setError('Email/Password login is not enabled in Firebase Console. Please enable it in Authentication > Sign-in method.');
      } else if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setError('Invalid username or password. Please contact your GM for access.');
      } else {
        setError(err.message || 'Authentication failed');
      }
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    navigate('/');
  };

  return (
    <nav className="bg-background border-b border-gold/20 sticky top-0 z-50 shadow-sm">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-4">
          {/* Mobile Menu Trigger */}
          <Button 
            variant="ghost" 
            size="sm" 
            className="px-2" 
            onClick={onMenuClick}
          >
            <Menu className="w-5 h-5 text-ink/70" />
          </Button>

          <Link to="/" className="flex items-center gap-2 group">
            <span className="text-xl font-serif font-bold tracking-tight text-ink">Homepage</span>
          </Link>
          
          {user && (
            <Badge variant="outline" className={`ml-2 uppercase text-[10px] font-bold ${(userProfile?.role === 'admin' || userProfile?.role === 'co-dm') ? 'border-gold text-gold bg-gold/5' : 'border-ink/20 text-ink/40'}`}>
              {(userProfile?.role || 'User').replace('-', ' ')} {previewMode && (userProfile?.role === 'admin' || userProfile?.role === 'co-dm') && '(Preview)'}
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-4">
          {/* Campaign Selector */}
          {user && activeCampaign && (
            <div className="hidden sm:block">
              {campaigns.length > 1 ? (
                <DropdownMenu>
                  <DropdownMenuTrigger render={
                    <Button variant="outline" size="sm" className="border-gold/20 text-ink/70 hover:text-gold hover:border-gold/50 gap-2 font-serif italic">
                      <Swords className="w-4 h-4 text-gold" />
                      {activeCampaign.name}
                      <ChevronDown className="w-3 h-3 opacity-50" />
                    </Button>
                  } />
                  <DropdownMenuContent align="end" className="w-56">
                    <div className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest text-gold/60">Switch Campaign</div>
                    {campaigns.map((campaign) => (
                      <DropdownMenuItem 
                        key={campaign.id} 
                        onClick={() => handleSwitchCampaign(campaign.id)}
                        className={`cursor-pointer ${campaign.id === activeCampaign.id ? 'bg-gold/10 text-gold' : ''}`}
                      >
                        {campaign.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-gold/10 bg-gold/5 text-ink/60 font-serif italic text-sm">
                  <Swords className="w-4 h-4 text-gold/40" />
                  {activeCampaign.name}
                </div>
              )}
            </div>
          )}

          {(userProfile?.role === 'admin' || userProfile?.role === 'co-dm') && (
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => setPreviewMode(!previewMode)}
              className={`hidden sm:flex items-center gap-2 ${previewMode ? 'text-gold bg-gold/10' : 'text-ink/40'}`}
            >
              {previewMode ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              {previewMode ? 'Exit Preview' : 'User Preview'}
            </Button>
          )}

          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger render={
                <Button variant="ghost" className="relative h-10 w-10 rounded-full border border-gold/20">
                  <Avatar className="h-9 w-9">
                    <AvatarImage src={userProfile?.avatarUrl || user.photoURL} alt={user.displayName} />
                    <AvatarFallback className="bg-gold/10 text-gold">{user.displayName?.[0]}</AvatarFallback>
                  </Avatar>
                </Button>
              } />
              <DropdownMenuContent align="end" className="w-56 p-1">
                <div className="flex items-center justify-start gap-2 p-3 bg-background/50">
                  <div className="flex flex-col space-y-1 leading-none">
                    <p className="font-medium">{userProfile?.displayName || user.displayName}</p>
                    <p className="text-xs text-muted-foreground">@{userProfile?.username || 'user'}</p>
                    <div className="flex items-center gap-1 mt-1">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase font-bold ${(userProfile?.role === 'admin' || userProfile?.role === 'co-dm') ? 'bg-gold/20 text-gold' : 'bg-ink/10 text-ink/40'}`}>
                      {(userProfile?.role || 'User').replace('-', ' ')} {previewMode && (userProfile?.role === 'admin' || userProfile?.role === 'co-dm') && '(Preview)'}
                    </span>
                    </div>
                  </div>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem nativeButton={false} render={
                  <Link to={`/profile/${userProfile?.username}`} className="w-full flex items-center px-2 py-1.5 cursor-pointer">
                    <UserCircle className="mr-2 h-4 w-4" />
                    <span>View Profile</span>
                  </Link>
                } />
                <DropdownMenuSeparator />
                {(userProfile?.role === 'admin' || userProfile?.role === 'co-dm') && (
                  <>
                    <DropdownMenuItem nativeButton={false} render={
                      <Link to="/admin/users" className="w-full flex items-center px-2 py-1.5 cursor-pointer">
                        <Users className="mr-2 h-4 w-4" />
                        <span>Manage Users</span>
                      </Link>
                    } />
                    <DropdownMenuItem nativeButton={false} render={
                      <Link to="/admin/campaigns" className="w-full flex items-center px-2 py-1.5 cursor-pointer">
                        <LayoutGrid className="mr-2 h-4 w-4" />
                        <span>Manage Campaigns</span>
                      </Link>
                    } />
                    <DropdownMenuItem nativeButton={false} render={
                      <Link to="/admin/proficiencies" className="w-full flex items-center px-2 py-1.5 cursor-pointer">
                        <BookOpen className="mr-2 h-4 w-4" />
                        <span>Manage Proficiencies</span>
                      </Link>
                    } />
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setPreviewMode(!previewMode)} className="w-full flex items-center px-2 py-1.5 cursor-pointer sm:hidden">
                      {previewMode ? <EyeOff className="mr-2 h-4 w-4" /> : <Eye className="mr-2 h-4 w-4" />}
                      <span>{previewMode ? 'Exit Preview' : 'User Preview'}</span>
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuItem nativeButton={false} render={
                  <Link to="/settings" className="w-full flex items-center px-2 py-1.5 cursor-pointer">
                    <Settings className="mr-2 h-4 w-4" />
                    <span>Settings</span>
                  </Link>
                } />
                <DropdownMenuItem onClick={handleLogout} className="w-full flex items-center px-2 py-1.5 text-blood cursor-pointer">
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Logout</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Dialog open={isAuthOpen} onOpenChange={setIsAuthOpen}>
              <DialogTrigger render={
                <Button className="bg-gold hover:bg-gold/90 text-white gap-2">
                  <LogIn className="w-4 h-4" />
                  Login
                </Button>
              } />
              <DialogContent className="sm:max-w-[400px]">
                <DialogHeader>
                  <DialogTitle className="font-serif text-2xl text-center">
                    Enter the Archive
                  </DialogTitle>
                </DialogHeader>
                <form onSubmit={handleAuth} className="space-y-4 py-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Username</label>
                    <Input 
                      required
                      value={authData.username} 
                      onChange={e => setAuthData({...authData, username: e.target.value})} 
                      placeholder="Unique username" 
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Password</label>
                    <Input 
                      required
                      type="password"
                      value={authData.password} 
                      onChange={e => setAuthData({...authData, password: e.target.value})} 
                      placeholder="••••••••" 
                    />
                  </div>
                  {error && <p className="text-xs text-blood bg-blood/5 p-2 rounded">{error}</p>}
                  <Button type="submit" className="w-full bg-gold text-white">
                    Login
                  </Button>
                  <div className="text-center text-xs text-ink/40 italic">
                    GM-managed access only. Contact your DM for credentials.
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>
    </nav>
  );
}
