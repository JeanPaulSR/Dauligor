import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar';

import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { UserCircle, Calendar, Shield, Book, ChevronLeft, Users, Lock } from 'lucide-react';
import { motion } from 'motion/react';
import { getSessionToken } from "../../lib/auth";

export default function Profile({ viewerProfile }: { viewerProfile?: any }) {
  const { username } = useParams<{ username: string }>();
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [featuredCharacters, setFeaturedCharacters] = useState<any[]>([]);

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
        const idToken = await getSessionToken();
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
        setFeaturedCharacters(Array.isArray(body?.featured_characters) ? body.featured_characters : []);
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
        <Shield className="w-16 h-16 text-gold/25 mx-auto" />
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
        <Button variant="ghost" className="text-ink/45 hover:text-gold -ml-4" nativeButton={false} render={<Link to="/"><ChevronLeft className="w-4 h-4 mr-1" /> Back</Link>} />
        <Card className="border-gold/25 bg-card/80 backdrop-blur-sm shadow-2xl overflow-hidden text-center py-16">
          <CardContent className="space-y-6">
            <Lock className="w-16 h-16 text-gold/45 mx-auto" />
            <h1 className="text-4xl font-serif font-bold text-ink">{profile.display_name || profile.username}</h1>
            <p className="text-ink/65 font-serif italic text-lg">This archivist has sealed their records.</p>
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-4xl mx-auto space-y-6 pb-16"
    >
      <Button variant="ghost" className="text-ink/45 hover:text-gold -ml-4" nativeButton={false} render={<Link to="/"><ChevronLeft className="w-4 h-4 mr-1" /> Back</Link>} />

      <div className="relative">
        {/* Profile Header Card */}
        <Card className="border-gold/25 bg-card/80 backdrop-blur-sm shadow-2xl overflow-hidden">
          <div className="h-24 bg-gold/15 relative">
            <div className="absolute inset-0 opacity-[0.05] bg-[url('https://www.transparenttextures.com/patterns/paper-fibers.png')]" />
          </div>
          <CardContent className="relative pt-0 pb-6 px-6 sm:px-8">
            <div className="flex flex-col md:flex-row gap-6 items-start md:items-end -mt-12">
              <div className="relative">
                <Avatar className="w-32 h-32 border-4 border-card shadow-xl">
                  <AvatarImage src={profile.avatar_url} referrerPolicy="no-referrer" />
                  <AvatarFallback className="bg-gold text-[var(--primary-foreground)] text-4xl font-serif">
                    {profile.display_name?.[0] || profile.username?.[0]}
                  </AvatarFallback>
                </Avatar>
              </div>
              
              <div className="flex-grow space-y-2">
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-4xl font-serif font-bold text-ink">{profile.display_name || profile.username}</h1>
                  {profile.pronouns && (
                    <span className="text-sm text-ink/45 italic mt-2">({profile.pronouns})</span>
                  )}
                </div>
                {!profile.hide_username && (
                  <p className="text-ink/45 font-medium">@{profile.username}</p>
                )}
              </div>
            </div>

            <div className="mt-8 grid md:grid-cols-3 gap-6">
              <div className="md:col-span-2 space-y-6">
                <div className="space-y-2">
                  <h3 className="text-sm font-bold uppercase tracking-widest text-ink/45 flex items-center gap-2">
                    <Book className="w-4 h-4" /> Biography
                  </h3>
                  <p className="text-ink/85 font-serif text-lg leading-relaxed italic">
                    {profile.bio || "No biography recorded"}
                  </p>
                </div>
              </div>

              <div className="space-y-6">
                <div className="space-y-4">
                  <h3 className="text-sm font-bold uppercase tracking-widest text-ink/45">Archive Stats</h3>
                  <div className="space-y-3">
                    <StatItem icon={<Calendar className="w-4 h-4" />} label="Joined" value={profile.created_at ? new Date(profile.created_at).toLocaleDateString() : "The Early Ages"} />
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-8">
        <Card className="border-gold/15 bg-card/50">
          <CardHeader>
            <CardTitle className="font-serif text-xl flex items-center gap-2">
              <UserCircle className="w-5 h-5 text-gold" /> Featured Characters
            </CardTitle>
          </CardHeader>
          <CardContent>
            {featuredCharacters.length === 0 ? (
              <p className="text-sm text-ink/45 italic text-center py-8">
                No featured characters
              </p>
            ) : (
              <div className="space-y-2">
                {featuredCharacters.map((c) => (
                  <div key={c.id} className="flex items-center gap-3 p-3 border border-gold/15 rounded">
                    <Avatar className="w-10 h-10 border border-gold/25">
                      <AvatarImage src={c.image_url || undefined} referrerPolicy="no-referrer" />
                      <AvatarFallback className="bg-gold/15 text-gold text-sm font-serif">
                        {String(c.name || '?')[0]}
                      </AvatarFallback>
                    </Avatar>
                    <span className="flex-1 min-w-0 truncate font-serif font-bold text-ink">{c.name}</span>
                    {c.level != null && (
                      <span className="text-[10px] font-bold uppercase tracking-wide text-gold/80 shrink-0">Lv {c.level}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-gold/15 bg-card/50">
          <CardHeader>
            <CardTitle className="font-serif text-xl flex items-center gap-2">
              <Users className="w-5 h-5 text-gold" /> Active Campaigns
            </CardTitle>
          </CardHeader>
          <CardContent>
            {campaigns.length === 0 ? (
              <p className="text-sm text-ink/45 italic text-center py-8">
                This archivist is not currently assigned to any active campaigns.
              </p>
            ) : (
              <div className="space-y-2">
                {campaigns.map(c => (
                  <Link key={c.id} to={`/campaign/${c.id}`} className="flex items-center justify-between p-3 border border-gold/15 rounded hover:bg-gold/5 transition-all group">
                    <span className="font-serif font-bold text-ink group-hover:text-gold transition-colors">{c.name}</span>
                    <Shield className="w-4 h-4 text-gold/45 group-hover:text-gold transition-colors" />
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
      <div className="flex items-center gap-2 text-ink/45">
        {icon}
        <span>{label}</span>
      </div>
      <span className="font-bold text-ink/75">{value}</span>
    </div>
  );
}
