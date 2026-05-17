import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { auth } from '../../lib/firebase';
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar';

import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { UserCircle, MapPin, Calendar, Shield, Book, Bookmark, ChevronLeft, Users, Lock } from 'lucide-react';
import { motion } from 'motion/react';

export default function Profile({ viewerProfile }: { viewerProfile?: any }) {
  const { username } = useParams<{ username: string }>();
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [campaigns, setCampaigns] = useState<any[]>([]);
 
  useEffect(() => {
    const fetchProfileData = async () => {
      if (!username) return;
      setLoading(true);
      try {
        // GET /api/profiles/[username] returns BOTH the (server-filtered)
        // profile fields AND the campaign list in one round trip. The
        // server strips sensitive columns (recovery_email,
        // hide_username, active_campaign_id) based on the viewer's role
        // and the target's is_private flag — closes the H1 PII leak and
        // the per-profile slice of H7's campaign_members enumeration.
        const idToken = await auth.currentUser?.getIdToken();
        const res = await fetch(`/api/profiles/${encodeURIComponent(username)}`, {
          headers: idToken ? { Authorization: `Bearer ${idToken}` } : {},
        });
        if (res.status === 404) {
          setError('Archivist not found in the records.');
          return;
        }
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(errBody.error || `Failed to retrieve profile (HTTP ${res.status})`);
        }
        const body = await res.json();
        if (!body?.profile) {
          setError('Archivist not found in the records.');
          return;
        }
        setProfile(body.profile);
        setCampaigns(Array.isArray(body?.campaigns) ? body.campaigns : []);
      } catch (err: any) {
        console.error(err);
        setError('Failed to retrieve profile.');
      } finally {
        setLoading(false);
      }
    };

    fetchProfileData();
  }, [username]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gold"></div>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="text-center py-20 space-y-4">
        <Shield className="w-16 h-16 text-gold/20 mx-auto" />
        <h2 className="text-3xl font-serif font-bold text-ink">{error || 'Profile Not Found'}</h2>
        <Button variant="link" className="text-gold" nativeButton={false} render={<Link to="/">Return to the Archive</Link>} />
      </div>
    );
  }

  const isOwner = viewerProfile?.username === profile.username;
  const isAdmin = viewerProfile?.role === 'admin';
  const canViewFullProfile = !profile.is_private || isOwner || isAdmin;

  if (!canViewFullProfile) {
    return (
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-2xl mx-auto space-y-8 pb-20 pt-10"
      >
        <Button variant="ghost" className="text-ink/40 hover:text-gold -ml-4" nativeButton={false} render={<Link to="/"><ChevronLeft className="w-4 h-4 mr-1" /> Back</Link>} />
        <Card className="border-gold/20 bg-card/80 backdrop-blur-sm shadow-2xl overflow-hidden text-center py-16">
          <CardContent className="space-y-6">
            <Lock className="w-16 h-16 text-gold/40 mx-auto" />
            <h1 className="text-4xl font-serif font-bold text-ink">{profile.display_name || profile.username}</h1>
            <p className="text-ink/60 font-serif italic text-lg">This archivist has sealed their records.</p>
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-4xl mx-auto space-y-8 pb-20"
    >
      <Button variant="ghost" className="text-ink/40 hover:text-gold -ml-4" nativeButton={false} render={<Link to="/"><ChevronLeft className="w-4 h-4 mr-1" /> Back</Link>} />

      <div className="relative">
        {/* Profile Header Card */}
        <Card className="border-gold/20 bg-card/80 backdrop-blur-sm shadow-2xl overflow-hidden">
          <div className="h-32 bg-gold/10 relative">
            <div className="absolute inset-0 opacity-[0.05] bg-[url('https://www.transparenttextures.com/patterns/paper-fibers.png')]" />
          </div>
          <CardContent className="relative pt-0 pb-8 px-8">
            <div className="flex flex-col md:flex-row gap-8 items-start md:items-end -mt-16">
              <div className="relative">
                <Avatar className="w-32 h-32 border-4 border-card shadow-xl">
                  <AvatarImage src={profile.avatar_url} referrerPolicy="no-referrer" />
                  <AvatarFallback className="bg-gold text-white text-4xl font-serif">
                    {profile.display_name?.[0] || profile.username?.[0]}
                  </AvatarFallback>
                </Avatar>
                {profile.role === 'admin' && (
                  <div className="absolute -bottom-2 -right-2 bg-gold text-white p-1.5 rounded-full shadow-lg border-2 border-card">
                    <Shield className="w-4 h-4" />
                  </div>
                )}
              </div>
              
              <div className="flex-grow space-y-2">
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-4xl font-serif font-bold text-ink">{profile.display_name || profile.username}</h1>
                  {profile.pronouns && (
                    <span className="text-sm text-ink/40 italic mt-2">({profile.pronouns})</span>
                  )}
                  <Badge variant="outline" className="border-gold text-gold bg-gold/5 uppercase tracking-widest text-[10px]">
                    {profile.role === 'admin' ? 'Grand Archivist' : 'Seeker'}
                  </Badge>
                </div>
                {!profile.hide_username && (
                  <p className="text-ink/40 font-medium">@{profile.username}</p>
                )}
              </div>
            </div>

            <div className="mt-12 grid md:grid-cols-3 gap-8">
              <div className="md:col-span-2 space-y-6">
                <div className="space-y-2">
                  <h3 className="text-sm font-bold uppercase tracking-widest text-ink/40 flex items-center gap-2">
                    <Book className="w-4 h-4" /> Biography
                  </h3>
                  <p className="text-ink/80 font-serif text-lg leading-relaxed italic">
                    {profile.bio || "This archivist has not yet recorded their journey in the annals of history."}
                  </p>
                </div>
              </div>

              <div className="space-y-6">
                <div className="space-y-4">
                  <h3 className="text-sm font-bold uppercase tracking-widest text-ink/40">Archive Stats</h3>
                  <div className="space-y-3">
                    <StatItem icon={<Calendar className="w-4 h-4" />} label="Joined" value={profile.created_at ? new Date(profile.created_at).toLocaleDateString() : "The Early Ages"} />
                    <StatItem icon={<MapPin className="w-4 h-4" />} label="Location" value="The Great Library" />
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-8">
        <Card className="border-gold/10 bg-card/50">
          <CardHeader>
            <CardTitle className="font-serif text-xl flex items-center gap-2">
              <Bookmark className="w-5 h-5 text-gold" /> Recent Discoveries
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-ink/40 italic text-center py-8">
              No public bookmarks shared by this archivist.
            </p>
          </CardContent>
        </Card>

        <Card className="border-gold/10 bg-card/50">
          <CardHeader>
            <CardTitle className="font-serif text-xl flex items-center gap-2">
              <Users className="w-5 h-5 text-gold" /> Active Campaigns
            </CardTitle>
          </CardHeader>
          <CardContent>
            {campaigns.length === 0 ? (
              <p className="text-sm text-ink/40 italic text-center py-8">
                This archivist is not currently assigned to any active campaigns.
              </p>
            ) : (
              <div className="space-y-2">
                {campaigns.map(c => (
                  <Link key={c.id} to={`/campaign/${c.id}`} className="flex items-center justify-between p-3 border border-gold/10 rounded hover:bg-gold/5 transition-all group">
                    <span className="font-serif font-bold text-ink group-hover:text-gold transition-colors">{c.name}</span>
                    <Shield className="w-4 h-4 text-gold/40 group-hover:text-gold transition-colors" />
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

    </motion.div>
  );
}

function StatItem({ icon, label, value }: { icon: React.ReactNode, label: string, value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <div className="flex items-center gap-2 text-ink/40">
        {icon}
        <span>{label}</span>
      </div>
      <span className="font-bold text-ink/70">{value}</span>
    </div>
  );
}
