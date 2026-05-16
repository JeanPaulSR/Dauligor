import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { auth, OperationType, reportClientError, firebaseConfig, usernameToEmail, createUserWithEmailAndPassword, signOut, updateProfile, initializeApp } from '../../lib/firebase';
import { fetchCollection, upsertDocument, deleteDocument, deleteDocuments } from '../../lib/d1';


import { getAuth, sendPasswordResetEmail } from 'firebase/auth';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '../../components/ui/dialog';
import { UserPlus, Trash2, Shield, User, LayoutGrid, Check, KeyRound, Copy, Link2 } from 'lucide-react';

export default function AdminUsers({ userProfile }: { userProfile: any }) {
  const [users, setUsers] = useState<any[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [roleDialogOpen, setRoleDialogOpen] = useState<{ isOpen: boolean, userId: string, currentRole: string }>({ isOpen: false, userId: '', currentRole: '' });
  const [campaignDialogOpen, setCampaignDialogOpen] = useState<{ isOpen: boolean, userId: string, currentIds: string[] }>({ isOpen: false, userId: '', currentIds: [] });
  const [temporaryPasswordDialog, setTemporaryPasswordDialog] = useState<{ isOpen: boolean, displayName: string, password: string, generatedAt: string }>({
    isOpen: false,
    displayName: '',
    password: '',
    generatedAt: '',
  });
  // Non-destructive sign-in link. Mirrors temporaryPasswordDialog but
  // holds the redemption URL + expiry instead of a plaintext password.
  // We render a separate dialog (rather than overloading the existing
  // one) so the visual + copy language stays unambiguous — admins need
  // to know at a glance whether they just overwrote a password or
  // issued a side-channel link.
  const [signInLinkDialog, setSignInLinkDialog] = useState<{ isOpen: boolean, displayName: string, link: string, expiresAt: string }>({
    isOpen: false,
    displayName: '',
    link: '',
    expiresAt: '',
  });
  const [signInLinkUserId, setSignInLinkUserId] = useState('');
  const [campaignSearch, setCampaignSearch] = useState('');
  const [newUser, setNewUser] = useState({ username: '', password: '', displayName: '', role: 'user', campaignIds: [] as string[] });
  const [loading, setLoading] = useState(false);
  const [passwordResetUserId, setPasswordResetUserId] = useState('');
  const [error, setError] = useState('');

  const [campaignMembers, setCampaignMembers] = useState<any[]>([]);

  useEffect(() => {
    if (userProfile?.role !== 'admin') return;

    const loadAdminUsersData = async () => {
      try {
        // Fetch Users via D1 helper (D1-only)
        const usersData = await fetchCollection<any>('users', { orderBy: 'username ASC' });
        setUsers(usersData);

        // Fetch Campaigns via D1 helper (D1-only)
        const campaignsData = await fetchCollection<any>('campaigns', { orderBy: 'name ASC' });
        setCampaigns(campaignsData);

        // Fetch Campaign Members (Junction Table)
        const membersData = await fetchCollection<any>('campaignMembers');
        setCampaignMembers(membersData);
      } catch (err) {
        console.error("Error loading admin users data:", err);
      }
    };

    loadAdminUsersData();
  }, [userProfile]);

  // Helper to get campaign IDs for a user from the junction table
  const getUserCampaignIds = (userId: string) => {
    return campaignMembers.filter(m => m.user_id === userId).map(m => m.campaign_id);
  };

  const handleCreateUser = async () => {
    if (!newUser.username || !newUser.displayName || !newUser.password) {
      setError('All fields are required');
      return;
    }
    if (newUser.password.length < 6) {
      setError('Password must be at least 6 characters long');
      return;
    }

    setLoading(true);
    setError('');
    try {
      // Create secondary app to register user without logging out admin
      const secondaryApp = initializeApp(firebaseConfig, 'Secondary');
      const secondaryAuth = getAuth(secondaryApp);
      
      const email = usernameToEmail(newUser.username);
      const userCredential = await createUserWithEmailAndPassword(secondaryAuth, email, newUser.password);
      await updateProfile(userCredential.user, { displayName: newUser.displayName });
      
      // Create profile in D1
      const uid = userCredential.user.uid;
      await upsertDocument('users', uid, {
        username: newUser.username.toLowerCase(),
        display_name: newUser.displayName,
        role: newUser.role,
        active_campaign_id: newUser.campaignIds[0] || null,
        created_at: new Date().toISOString()
      });

      // Assign campaigns in junction table
      for (const campaignId of newUser.campaignIds) {
        await upsertDocument('campaignMembers', `${campaignId}_${uid}`, {
          campaign_id: campaignId,
          user_id: uid,
          role: 'player',
          joined_at: new Date().toISOString()
        });
      }

      // Sign out secondary app and delete it
      await signOut(secondaryAuth);

      setIsAddOpen(false);
      setNewUser({ username: '', password: '', displayName: '', role: 'user', campaignIds: [] });
      toast.success('User created successfully');
      
      // Refresh data
      const usersData = await fetchCollection<any>('users', { orderBy: 'username ASC' });
      setUsers(usersData);
      const membersData = await fetchCollection<any>('campaignMembers');
      setCampaignMembers(membersData);
    } catch (err: any) {
      console.error('Failed to create user:', err);
      setError(err.message || 'Failed to create user');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteUser = async (id: string) => {
    if (confirm('Are you sure? This only deletes the D1 profile, not the Auth account.')) {
      try {
        await deleteDocument('users', id);
        setUsers(prev => prev.filter(u => u.id !== id));
        toast.success('User profile deleted');
      } catch (err) {
        console.error(err);
        toast.error('Failed to delete user');
      }
    }
  };

  const toggleCampaign = (campaignId: string) => {
    setNewUser(prev => {
      const ids = prev.campaignIds.includes(campaignId)
        ? prev.campaignIds.filter(id => id !== campaignId)
        : [...prev.campaignIds, campaignId];
      return { ...prev, campaignIds: ids };
    });
  };

  const handleToggleUserCampaign = async (userId: string, campaignId: string, currentIds: string[] = []) => {
    try {
      const isAssigned = currentIds.includes(campaignId);
      if (isAssigned) {
        // Remove from junction table
        await deleteDocuments('campaignMembers', 'campaign_id = ? AND user_id = ?', [campaignId, userId]);
      } else {
        await upsertDocument('campaignMembers', `${campaignId}_${userId}`, {
          campaign_id: campaignId,
          user_id: userId,
          role: 'player',
          joined_at: new Date().toISOString()
        });
      }
      
      // Refresh members
      const membersData = await fetchCollection<any>('campaignMembers');
      setCampaignMembers(membersData);

      if (campaignDialogOpen.isOpen && campaignDialogOpen.userId === userId) {
        const newIds = isAssigned 
          ? currentIds.filter(id => id !== campaignId)
          : [...currentIds, campaignId];
        setCampaignDialogOpen(prev => ({ ...prev, currentIds: newIds }));
      }
    } catch (err) {
      console.error(err);
      toast.error('Failed to update campaign assignment');
    }
  };

  const handleUpdateRole = async (userId: string, newRole: string) => {
    try {
      const user = users.find(u => u.id === userId);
      if (!user) return;
      await upsertDocument('users', userId, {
        ...user,
        role: newRole
      });
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole } : u));
      setRoleDialogOpen({ ...roleDialogOpen, isOpen: false });
      toast.success('User role updated');
    } catch (err) {
      console.error(err);
      toast.error('Failed to update role');
    }
  };

  const handleSendRecoveryEmail = async (email: string) => {
    try {
      await sendPasswordResetEmail(auth, email);
      toast.success(`Password reset email sent to ${email}`);
    } catch (err: any) {
      console.error('Failed to send recovery email:', err);
      toast.error(err.message || 'Failed to send recovery email');
    }
  };

  const handleGenerateTemporaryPassword = async (userRecord: any) => {
    if (!auth.currentUser) {
      toast.error('You must be signed in to generate a temporary password.');
      return;
    }

    setPasswordResetUserId(userRecord.id);
    try {
      const idToken = await auth.currentUser.getIdToken();
      const response = await fetch(`/api/admin/users/${userRecord.id}/temporary-password`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('Temporary-password endpoint not found. Restart the dev server so the updated backend route is loaded.');
        }
        throw new Error(result.error || 'Failed to generate a temporary password.');
      }

      setTemporaryPasswordDialog({
        isOpen: true,
        displayName: userRecord.displayName || userRecord.username || 'User',
        password: result.temporaryPassword,
        generatedAt: result.generatedAt || new Date().toISOString(),
      });
      toast.success(`Temporary password generated for ${userRecord.displayName || userRecord.username}.`);
    } catch (err: any) {
      console.error('Failed to generate temporary password:', err);
      toast.error(err.message || 'Failed to generate temporary password.');
    } finally {
      setPasswordResetUserId('');
    }
  };

  const handleCopyTemporaryPassword = async () => {
    try {
      await navigator.clipboard.writeText(temporaryPasswordDialog.password);
      toast.success('Temporary password copied.');
    } catch (err: any) {
      console.error('Failed to copy temporary password:', err);
      toast.error('Failed to copy temporary password.');
    }
  };

  /**
   * Non-destructive password recovery. Hits /api/admin/users/:id/sign-in-token
   * which mints a Firebase custom token (1 hour TTL). We then build a
   * https://<origin>/auth/redeem?token=... URL the admin can share. The
   * target user's Firebase Auth password is NOT changed — when they
   * click the link, signInWithCustomToken authenticates them for that
   * session only and their original password keeps working.
   *
   * Prefer this over handleGenerateTemporaryPassword unless you
   * explicitly want to invalidate the user's existing password.
   */
  const handleGenerateSignInLink = async (userRecord: any) => {
    if (!auth.currentUser) {
      toast.error('You must be signed in to generate a sign-in link.');
      return;
    }

    setSignInLinkUserId(userRecord.id);
    try {
      const idToken = await auth.currentUser.getIdToken();
      const response = await fetch(`/api/admin/users/${userRecord.id}/sign-in-token`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('Sign-in-token endpoint not found. The deploy may be stale — refresh the page.');
        }
        throw new Error(result.error || 'Failed to mint sign-in token.');
      }

      // Build the redemption URL against the current origin so it works
      // identically across prod / preview / local dev without the API
      // having to know its own public URL.
      const link = `${window.location.origin}/auth/redeem?token=${encodeURIComponent(result.token)}`;

      setSignInLinkDialog({
        isOpen: true,
        displayName: userRecord.displayName || userRecord.username || 'User',
        link,
        expiresAt: result.expiresAt || '',
      });
      toast.success(`Sign-in link generated for ${userRecord.displayName || userRecord.username}.`);
    } catch (err: any) {
      console.error('Failed to generate sign-in link:', err);
      toast.error(err.message || 'Failed to generate sign-in link.');
    } finally {
      setSignInLinkUserId('');
    }
  };

  const handleCopySignInLink = async () => {
    try {
      await navigator.clipboard.writeText(signInLinkDialog.link);
      toast.success('Sign-in link copied.');
    } catch (err: any) {
      console.error('Failed to copy sign-in link:', err);
      toast.error('Failed to copy sign-in link.');
    }
  };

  const filteredCampaigns = campaigns.filter(c => 
    c.name.toLowerCase().includes(campaignSearch.toLowerCase())
  );

  const handleSeedUsers = async () => {
    const testUsers = [
      { username: 'codm', displayName: 'Co-DM', role: 'co-dm' },
      { username: 'lorewriter', displayName: 'Lore Writer', role: 'lore-writer' },
      { username: 'trustedplayer', displayName: 'Trusted Player', role: 'trusted-player' }
    ];

    setLoading(true);
    setError('');
    try {
      const secondaryApp = initializeApp(firebaseConfig, 'SeedApp');
      const secondaryAuth = getAuth(secondaryApp);

      for (const u of testUsers) {
        try {
          const email = usernameToEmail(u.username);
          const userCredential = await createUserWithEmailAndPassword(secondaryAuth, email, 'password123');
          await updateProfile(userCredential.user, { displayName: u.displayName });
          
          await upsertDocument('users', userCredential.user.uid, {
            username: u.username,
            display_name: u.displayName,
            role: u.role,
            created_at: new Date().toISOString()
          });
          await signOut(secondaryAuth);
        } catch (e: any) {
          console.warn(`User ${u.username} might already exist:`, e.message);
        }
      }
      toast.success('Test users created! Default password: password123');
      const usersData = await fetchCollection<any>('users', { orderBy: 'username ASC' });
      setUsers(usersData);
    } catch (err: any) {
      setError(err.message || 'Failed to seed users');
    } finally {
      setLoading(false);
    }
  };

  const handleSeedLore = async () => {
    const testLore = [
      {
        title: 'The Silver Spire',
        excerpt: 'A towering monument of ancient elven architecture.',
        content: '# The Silver Spire\n\nThe Silver Spire stands as the last remaining structure of the **Old Elven Empire**. It was built during the *Age of Starlight* and served as a beacon for planar travelers.\n\n## History\nLegend says the spire was grown from a single seed of pure moonlight...',
        category: 'location',
        status: 'published',
        image_url: 'https://picsum.photos/seed/spire/800/600',
        metadata: {
          locationType: 'Monument',
          ruler: 'The Council of Stars',
          population: '0 (Abandoned)'
        },
        tags: ['ancient', 'elven', 'magic']
      },
      {
        title: 'High King Valerius',
        excerpt: 'The legendary unifier of the Dauligor plains.',
        content: '# High King Valerius\n\nValerius was the first mortal to wear the **Crown of Thorns**. He led the human tribes against the giant lords during the *Great Migration*.\n\n## Personality\nKnown for his stoicism and tactical brilliance...',
        category: 'character',
        status: 'published',
        image_url: 'https://picsum.photos/seed/king/800/600',
        metadata: {
          race: 'Human',
          occupation: 'High King',
          lifeStatus: 'Dead',
          alignment: 'Lawful Good'
        },
        tags: ['king', 'legend', 'warrior']
      }
    ];

    setLoading(true);
    try {
      for (const lore of testLore) {
        const id = crypto.randomUUID();
        const slug = lore.title.toLowerCase().replace(/\s+/g, '-');
        await upsertDocument('lore', id, {
          ...lore,
          slug,
          author_id: userProfile?.id,
          updated_at: new Date().toISOString(),
          created_at: new Date().toISOString()
        });
      }
      toast.success('Lore seeded successfully!');
    } catch (err) {
      console.error(err);
      toast.error('Failed to seed lore');
    } finally {
      setLoading(false);
    }
  };

  if (userProfile?.role !== 'admin' && userProfile?.role !== 'co-dm') {
    return <div className="text-center py-20 font-serif italic">Access Denied</div>;
  }

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-4xl font-serif font-bold text-ink">User Management</h1>
          <p className="text-ink/60">Manage your players and their access to the archive.</p>
        </div>

        <div className="flex items-center gap-4">
          <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
            <DialogTrigger render={
              <Button className="btn-gold-solid gap-2">
                <UserPlus className="w-4 h-4" /> Create User
              </Button>
            } />
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle className="font-serif text-2xl">Create New Player</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Profile Name</label>
                  <Input value={newUser.displayName} onChange={e => setNewUser({...newUser, displayName: e.target.value})} placeholder="e.g. John the Brave" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Username</label>
                  <Input value={newUser.username} onChange={e => setNewUser({...newUser, username: e.target.value})} placeholder="Unique username" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Password</label>
                  <Input type="password" value={newUser.password} onChange={e => setNewUser({...newUser, password: e.target.value})} placeholder="••••••••" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Role</label>
                  <select 
                    className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                    value={newUser.role}
                    onChange={e => setNewUser({...newUser, role: e.target.value})}
                  >
                    <option value="user">User (Player)</option>
                    <option value="trusted-player">Trusted Player</option>
                    <option value="lore-writer">Lore Writer</option>
                    <option value="co-dm">Co-DM (Limited Admin)</option>
                    <option value="admin">Admin (GM)</option>
                  </select>
                </div>
              </div>
              
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className="text-sm font-medium">Assign Campaigns</label>
                  <Input 
                    className="h-7 w-32 text-[10px]" 
                    placeholder="Search..." 
                    value={campaignSearch}
                    onChange={e => setCampaignSearch(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2 max-h-[150px] overflow-y-auto p-2 border rounded-md bg-background/50">
                  {filteredCampaigns.map(c => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleCampaign(c.id)}
                      className={`flex items-center justify-between px-3 py-2 rounded-md text-xs transition-colors ${
                        newUser.campaignIds.includes(c.id) 
                        ? 'bg-gold/20 text-gold border border-gold/30' 
                        : 'bg-ink/5 text-ink/60 border border-transparent hover:bg-ink/10'
                      }`}
                    >
                      <span className="truncate mr-2">{c.name}</span>
                      {newUser.campaignIds.includes(c.id) && <Check className="w-3 h-3" />}
                    </button>
                  ))}
                  {filteredCampaigns.length === 0 && (
                    <p className="col-span-2 text-center py-4 text-xs text-ink/40 italic">No campaigns found</p>
                  )}
                </div>
              </div>

              {error && <p className="text-xs text-blood bg-blood/5 p-2 rounded">{error}</p>}
              <Button onClick={handleCreateUser} disabled={loading} className="w-full bg-gold text-white">
                {loading ? 'Creating...' : 'Create Account'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>

    <Card className="border-gold/10">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Username</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Campaigns</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">
                    <div className="flex flex-col">
                      <span>{u.displayName}</span>
                      <span className="text-[10px] text-ink/40 font-serif italic">Active: {campaigns.find(c => c.id === u.active_campaign_id)?.name || 'None'}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-ink/60">@{u.username}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Badge 
                        variant="outline" 
                        className={`
                          ${(u.role === 'admin' || u.role === 'co-dm') ? 'border-gold text-gold bg-gold/5' : 'border-ink/20 text-ink/40'}
                          capitalize
                        `}
                      >
                        {(u.role === 'admin' || u.role === 'co-dm') ? <Shield className="w-3 h-3 mr-1" /> : <User className="w-3 h-3 mr-1" />}
                        {u.role.replace('-', ' ')}
                      </Badge>
                      {(userProfile?.role === 'admin') && (
                        <Button 
                          variant="ghost" 
                          size="xs" 
                          onClick={() => setRoleDialogOpen({ isOpen: true, userId: u.id, currentRole: u.role })}
                          className="h-6 px-2 text-[10px] text-gold hover:bg-gold/10 border border-gold/10"
                        >
                          Change
                        </Button>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="flex flex-wrap gap-1 max-w-[200px]">
                        {(() => {
                          const userCampaignIds = getUserCampaignIds(u.id);
                          return (
                            <>
                              {campaigns.filter(c => userCampaignIds.includes(c.id)).slice(0, 2).map(c => (
                                <Badge key={c.id} variant="outline" className="text-[10px] border-gold/20 text-gold/60">
                                  {c.name}
                                </Badge>
                              ))}
                              {userCampaignIds.length > 2 && (
                                <span className="text-[10px] text-ink/40">+{userCampaignIds.length - 2} more</span>
                              )}
                              {userCampaignIds.length === 0 && (
                                <span className="text-[10px] text-ink/20 italic">None</span>
                              )}
                            </>
                          );
                        })()}
                      </div>
                      <Button 
                        variant="ghost" 
                        size="xs" 
                        onClick={() => {
                          const userCampaignIds = getUserCampaignIds(u.id);
                          setCampaignDialogOpen({ isOpen: true, userId: u.id, currentIds: userCampaignIds });
                          setCampaignSearch('');
                        }}
                        className="h-6 px-2 text-[10px] text-gold hover:bg-gold/10 border border-gold/10 ml-auto"
                      >
                        Manage
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      {userProfile?.role === 'admin' && (
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => handleGenerateSignInLink(u)}
                          disabled={signInLinkUserId === u.id}
                          className="h-6 px-2 text-[10px] text-archive-blue hover:bg-archive-blue/10 border border-archive-blue/10"
                          title="Mint a one-hour sign-in link. Does NOT change the user's password."
                        >
                          <Link2 className="w-3 h-3 mr-1" />
                          {signInLinkUserId === u.id ? 'Generating...' : 'Sign-in Link'}
                        </Button>
                      )}
                      {userProfile?.role === 'admin' && (
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => handleGenerateTemporaryPassword(u)}
                          disabled={passwordResetUserId === u.id}
                          className="h-6 px-2 text-[10px] text-gold hover:bg-gold/10 border border-gold/10"
                          title="Overwrite the user's password with a new random one. Destructive — their existing password stops working."
                        >
                          <KeyRound className="w-3 h-3 mr-1" />
                          {passwordResetUserId === u.id ? 'Generating...' : 'Temp Password'}
                        </Button>
                      )}
                      {userProfile?.role === 'admin' && u.recoveryEmail && (
                        <Button 
                          variant="ghost" 
                          size="xs" 
                          onClick={() => handleSendRecoveryEmail(u.recoveryEmail)}
                          className="h-6 px-2 text-[10px] text-archive-blue hover:bg-archive-blue/10 border border-archive-blue/10"
                        >
                          Send Recovery Email
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" className="btn-danger" onClick={() => handleDeleteUser(u.id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {userProfile?.role === 'admin' && (
        <Card className="border-gold/10 bg-gold/5 mt-8">
          <CardHeader>
            <CardTitle className="text-sm font-serif font-bold text-gold uppercase tracking-widest">System Actions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-sm font-bold text-ink">Seed Test Accounts</p>
                <p className="text-xs text-ink/40 italic">Create the Co-DM, Lore Writer, and Trusted Player accounts for testing.</p>
              </div>
              <Button variant="outline" onClick={handleSeedUsers} disabled={loading} className="border-gold/20 text-gold hover:bg-gold/10">
                {loading ? 'Seeding...' : 'Seed Accounts'}
              </Button>
            </div>
            <div className="flex items-center justify-between pt-4 border-t border-gold/10">
              <div className="space-y-1">
                <p className="text-sm font-bold text-ink">Seed Lore Articles</p>
                <p className="text-xs text-ink/40 italic">Populate the wiki with structured World Anvil-style articles.</p>
              </div>
              <Button variant="outline" onClick={handleSeedLore} disabled={loading} className="border-gold/20 text-gold hover:bg-gold/10">
                {loading ? 'Seeding...' : 'Seed Lore'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Role Selection Dialog */}
      <Dialog open={roleDialogOpen.isOpen} onOpenChange={(open) => setRoleDialogOpen(prev => ({ ...prev, isOpen: open }))}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">Assign Role</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2 py-4">
            {['user', 'trusted-player', 'lore-writer', 'co-dm', 'admin'].map((role) => (
              <Button
                key={role}
                variant={roleDialogOpen.currentRole === role ? 'default' : 'outline'}
                className={`justify-start gap-3 h-12 capitalize ${roleDialogOpen.currentRole === role ? 'bg-gold text-white' : 'border-gold/20 text-ink/60 hover:bg-gold/5'}`}
                onClick={() => handleUpdateRole(roleDialogOpen.userId, role)}
              >
                {role === 'admin' || role === 'co-dm' ? <Shield className="w-4 h-4" /> : <User className="w-4 h-4" />}
                {role.replace('-', ' ')}
                {roleDialogOpen.currentRole === role && <Check className="ml-auto w-4 h-4" />}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Campaign Management Dialog */}
      <Dialog open={campaignDialogOpen.isOpen} onOpenChange={(open) => setCampaignDialogOpen(prev => ({ ...prev, isOpen: open }))}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">Manage Campaigns</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="relative">
              <Input 
                placeholder="Search campaigns..." 
                value={campaignSearch}
                onChange={e => setCampaignSearch(e.target.value)}
                className="pl-9"
              />
              <LayoutGrid className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink/30" />
            </div>
            
            <div className="grid grid-cols-1 gap-2 max-h-[300px] overflow-y-auto p-2 border rounded-md bg-background/50">
              {filteredCampaigns.map(c => {
                const isAssigned = campaignDialogOpen.currentIds.includes(c.id);
                return (
                  <button
                    key={c.id}
                    onClick={() => handleToggleUserCampaign(campaignDialogOpen.userId, c.id, campaignDialogOpen.currentIds)}
                    className={`flex items-center justify-between px-4 py-3 rounded-md text-sm transition-all ${
                      isAssigned 
                      ? 'bg-gold/10 text-gold border border-gold/30 shadow-sm' 
                      : 'bg-ink/5 text-ink/60 border border-transparent hover:bg-ink/10'
                    }`}
                  >
                    <div className="flex flex-col items-start">
                      <span className="font-medium">{c.name}</span>
                      <span className="text-[10px] opacity-60">{c.description?.slice(0, 60)}...</span>
                    </div>
                    {isAssigned && <Check className="w-4 h-4" />}
                  </button>
                );
              })}
              {filteredCampaigns.length === 0 && (
                <div className="text-center py-10 space-y-2">
                  <p className="text-sm text-ink/40 italic">No campaigns found matching "{campaignSearch}"</p>
                </div>
              )}
            </div>
            <div className="flex justify-end pt-2">
              <Button onClick={() => setCampaignDialogOpen(prev => ({ ...prev, isOpen: false }))} className="bg-gold text-white">
                Done
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={temporaryPasswordDialog.isOpen}
        onOpenChange={(open) => setTemporaryPasswordDialog(prev => ({ ...prev, isOpen: open }))}
      >
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">Temporary Password</DialogTitle>
            <DialogDescription>
              Share this with {temporaryPasswordDialog.displayName}. It is only shown here once, so copy it before closing. <strong>The user's previous password no longer works</strong> — they must use this one to sign in.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-lg border border-gold/20 bg-gold/5 p-4">
              <p className="text-[10px] uppercase tracking-[0.2em] text-gold/70">Generated Password</p>
              <p className="mt-2 break-all font-mono text-lg font-bold text-ink">{temporaryPasswordDialog.password}</p>
            </div>
            <p className="text-xs text-ink/50">
              Generated at {temporaryPasswordDialog.generatedAt ? new Date(temporaryPasswordDialog.generatedAt).toLocaleString() : 'just now'}.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleCopyTemporaryPassword} className="gap-2">
              <Copy className="w-4 h-4" /> Copy Password
            </Button>
            <Button onClick={() => setTemporaryPasswordDialog(prev => ({ ...prev, isOpen: false }))} className="bg-gold text-white">
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={signInLinkDialog.isOpen}
        onOpenChange={(open) => setSignInLinkDialog(prev => ({ ...prev, isOpen: open }))}
      >
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">One-Time Sign-In Link</DialogTitle>
            <DialogDescription>
              Share this link with {signInLinkDialog.displayName}. Anyone who opens it within the next hour will be signed in as them. Their current password is unchanged.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-lg border border-archive-blue/20 bg-archive-blue/5 p-4">
              <p className="text-[10px] uppercase tracking-[0.2em] text-archive-blue/70">Redemption Link</p>
              <p className="mt-2 break-all font-mono text-xs text-ink">{signInLinkDialog.link}</p>
            </div>
            <p className="text-xs text-ink/50">
              {signInLinkDialog.expiresAt
                ? `Expires at ${new Date(signInLinkDialog.expiresAt).toLocaleString()}.`
                : 'Expires in approximately one hour.'}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleCopySignInLink} className="gap-2">
              <Copy className="w-4 h-4" /> Copy Link
            </Button>
            <Button onClick={() => setSignInLinkDialog(prev => ({ ...prev, isOpen: false }))} className="bg-archive-blue text-white">
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
