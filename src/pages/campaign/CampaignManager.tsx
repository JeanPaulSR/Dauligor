import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { auth } from '@/lib/firebase';
import { fetchDocument, fetchCollection } from '@/lib/d1';

import { Shield, ChevronLeft, Calendar, Users, MapPin, Sparkles, Edit, FileText, Scroll, History, LayoutGrid } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ClassImageStyle, DEFAULT_DISPLAY } from '@/components/compendium/ClassImageEditor';

export default function CampaignManager({ userProfile }: { userProfile: any }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [campaign, setCampaign] = useState<any>(null);
  const [articles, setArticles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('info');

  const isStaff = userProfile?.role === 'admin' || userProfile?.role === 'co-dm' || userProfile?.role === 'lore-writer';

  const tabs = [
    { id: 'info', label: 'Campaign Info', icon: LayoutGrid },
    { id: 'characters', label: 'Player Characters', icon: Users },
    { id: 'articles', label: 'Articles', icon: FileText },
    { id: 'maps', label: 'Maps', icon: MapPin },
    { id: 'sessions', label: 'Session Notes', icon: Scroll },
    { id: 'players', label: 'Player Notes', icon: Users },
    { id: 'timeline', label: 'Timeline', icon: History }
  ];

  useEffect(() => {
    const fetchCampaignAndArticles = async () => {
      if (!id) return;
      try {
        // Per-route campaign endpoint. Member-or-staff gate runs
        // server-side; non-members get a 404 (collapsed with "doesn't
        // exist" so probes can't enumerate ids).
        const idToken = await auth.currentUser?.getIdToken();
        const campRes = await fetch(`/api/campaigns/${encodeURIComponent(id)}`, {
          headers: idToken ? { Authorization: `Bearer ${idToken}` } : {},
        });
        if (!campRes.ok) {
          setLoading(false);
          return;
        }
        const campData = (await campRes.json())?.campaign;

        if (campData) {
          setCampaign(campData);

          // Per-route endpoint; server strips dm_notes and filters
          // drafts for non-staff. The visibility filter (campaign /
          // era scoping) still runs in JS below because the page does
          // its own client-side preview/era logic.
          const idToken = await auth.currentUser?.getIdToken();
          const loreRes = await fetch('/api/lore/articles', {
            headers: idToken ? { Authorization: `Bearer ${idToken}` } : {},
          });
          if (!loreRes.ok) throw new Error(`HTTP ${loreRes.status}`);
          const loreBody = await loreRes.json();
          const lorePages: any[] = Array.isArray(loreBody?.articles) ? loreBody.articles : [];

          // Fetch visibility data from junction tables
          const articleCampaigns = await fetchCollection<any>('loreArticleCampaigns');
          const articleEras = await fetchCollection<any>('loreArticleEras');

          setArticles(lorePages.filter(page => {
            // If user is not staff, exclude draft articles
            if (!isStaff && page.status === 'draft') return false;

            const visibleInCampaigns = articleCampaigns.filter(ac => ac.article_id === page.id).map(ac => ac.campaign_id);
            const visibleInEras = articleEras.filter(ae => ae.article_id === page.id).map(ae => ae.era_id);

            const hasCampaignScope = visibleInCampaigns.length > 0;
            const hasEraScope = visibleInEras.length > 0;

            // General article: no specific visibility scopes at all
            if (!hasCampaignScope && !hasEraScope) return true;

            // Explicitly assigned to this campaign
            if (hasCampaignScope && visibleInCampaigns.includes(id)) return true;

            // Assigned to the campaign's era
            if (hasEraScope && campData.era_id && visibleInEras.includes(campData.era_id)) return true;

            return false;
          }));
        }
      } catch (error) {
        console.error("Error fetching campaign details:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchCampaignAndArticles();
  }, [id, isStaff]);

  if (loading) {
    return (
      <div className="text-center py-20 font-serif italic text-ink/60">
        Loading campaign details...
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="text-center py-20 font-serif italic text-ink/60">
        This campaign could not be found.
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-20">
      {/* Header Actions */}
      <div className="page-header">
        <Button variant="ghost" onClick={() => navigate(-1)} className="text-ink/60 hover:text-gold transition-colors rounded">
          <ChevronLeft className="w-4 h-4 mr-2" /> Back
        </Button>
        {isStaff && (
          <Link to={`/campaign/edit/${campaign.id}`}>
            <Button size="sm" variant="outline" className="border-gold/30 hover:border-gold hover:bg-gold/10 text-gold gap-2 transition-colors btn-gold rounded">
              <Edit className="w-3.5 h-3.5" /> Edit Campaign
            </Button>
          </Link>
        )}
      </div>

      <div className="flex flex-col md:flex-row gap-8">
        {/* Left Tabs Sidebar */}
        <div className="w-full md:w-60 shrink-0 flex flex-col gap-1.5">
          {tabs.map(tab => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-3 px-4 py-3 rounded text-xs lg:text-sm font-bold transition-all text-left border ${
                  isActive 
                    ? 'bg-gold/15 text-gold border-gold/30 shadow-sm' 
                    : 'text-ink/60 border-transparent hover:bg-gold/5 hover:text-gold/80'
                }`}
              >
                <tab.icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-gold' : 'text-ink/40'}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Right Tab Content Container */}
        <div className="flex-1 min-w-0">
          {activeTab === 'info' && (
            <div className="space-y-6 animate-in fade-in duration-300">
              {/* Hero Header */}
              <div className="relative rounded-2xl border border-gold/20 overflow-hidden bg-card/60 shadow-xl backdrop-blur-sm">
                {campaign.image_url && (
                  <div className="absolute inset-0 h-full w-full">
                    <img 
                      src={campaign.image_url} 
                      alt={campaign.name} 
                      className="w-full h-full object-cover opacity-10 filter blur-sm select-none pointer-events-none" 
                      crossOrigin="anonymous"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-card via-card/80 to-transparent" />
                  </div>
                )}

                <div className="relative p-6 md:p-10 flex flex-col md:flex-row gap-6 items-center">
                  {campaign.image_url ? (
                    <div className="w-24 h-24 md:w-32 md:h-32 rounded overflow-hidden border-2 border-gold/30 shadow-2xl flex-shrink-0 bg-background flex items-center justify-center">
                      <img 
                        src={campaign.image_url} 
                        alt={campaign.name} 
                        className="w-full h-full object-cover select-none pointer-events-none"
                        style={ClassImageStyle({ display: campaign.image_display || DEFAULT_DISPLAY })}
                        crossOrigin="anonymous"
                      />
                    </div>
                  ) : (
                    <div className="w-24 h-24 md:w-32 md:h-32 rounded bg-gold/5 border-2 border-gold/20 flex items-center justify-center flex-shrink-0 shadow-xl">
                      <Shield className="w-12 h-12 text-gold/40" />
                    </div>
                  )}

                  <div className="flex-1 text-center md:text-left space-y-2">
                    <div className="flex flex-wrap items-center justify-center md:justify-start gap-2">
                      <span className="label-text bg-gold/10 border border-gold/30 text-gold px-2.5 py-1 rounded text-[10px] tracking-widest uppercase">Campaign</span>
                    </div>
                    <h1 className="h2-title leading-tight">
                      {campaign.name}
                    </h1>
                    {campaign.description && (
                      <p className="description-text max-w-2xl">
                        {campaign.description}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Campaign Highlights Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card className="border-gold/10 bg-card/40 backdrop-blur-sm hover:border-gold/20 transition-all rounded">
                  <CardHeader>
                    <CardTitle className="label-text text-gold flex items-center gap-2">
                      <Users className="w-4 h-4" /> Players & Access
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="body-text text-xs leading-relaxed">
                      Active players can review lore, manage their characters, and explore custom rules tailored to this campaign.
                    </p>
                    <div className="p-3 bg-gold/5 border border-gold/10 rounded flex items-center gap-2 text-xs text-gold/80">
                      <Sparkles className="w-4 h-4 shrink-0" />
                      Campaign Manager features are coming soon.
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}

          {activeTab === 'characters' && (
            <Card className="border-gold/10 bg-card/60 shadow-xl backdrop-blur-sm rounded">
              <CardHeader>
                <CardTitle className="h2-title flex items-center gap-2">
                  <Users className="w-5 h-5 text-gold shrink-0" /> Player Characters
                </CardTitle>
                <p className="field-hint mt-1">Review active player characters in the campaign.</p>
              </CardHeader>
              <CardContent>
                <p className="description-text py-4">No active player characters found.</p>
              </CardContent>
            </Card>
          )}

          {activeTab === 'articles' && (
            <Card className="border-gold/10 bg-card/60 shadow-xl backdrop-blur-sm rounded">
              <CardHeader>
                <CardTitle className="h2-title flex items-center gap-2">
                  <FileText className="w-5 h-5 text-gold shrink-0" /> Articles
                </CardTitle>
                <p className="field-hint mt-1">Review and manage linked articles for this campaign.</p>
              </CardHeader>
              <CardContent>
                {articles.length === 0 ? (
                  <p className="description-text py-4">No articles linked to this campaign yet.</p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                    {articles.map(article => (
                      <Link key={article.id} to={`/wiki/article/${article.id}`} className="p-3 border border-gold/10 bg-background/40 hover:border-gold/30 hover:bg-gold/5 transition-all duration-200 rounded block">
                        <div className="flex items-center justify-between">
                          <span className="font-serif font-bold text-lg text-ink hover:text-gold transition-colors">{article.title}</span>
                          <span className="text-[10px] uppercase font-bold tracking-widest text-gold bg-gold/10 px-2 py-0.5 rounded border border-gold/20">{article.category}</span>
                        </div>
                        {article.excerpt && (
                          <p className="text-xs italic text-ink/60 mt-1 line-clamp-2 leading-relaxed">{article.excerpt}</p>
                        )}
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {activeTab === 'maps' && (
            <Card className="border-gold/10 bg-card/60 shadow-xl backdrop-blur-sm rounded">
              <CardHeader>
                <CardTitle className="h2-title flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-gold shrink-0" /> Maps
                </CardTitle>
                <p className="field-hint mt-1">A visual guide of the regions active in this campaign.</p>
              </CardHeader>
              <CardContent>
                <p className="description-text py-4">No maps assigned to this campaign yet.</p>
              </CardContent>
            </Card>
          )}

          {activeTab === 'sessions' && (
            <Card className="border-gold/10 bg-card/60 shadow-xl backdrop-blur-sm rounded">
              <CardHeader>
                <CardTitle className="h2-title flex items-center gap-2">
                  <Scroll className="w-5 h-5 text-gold shrink-0" /> Session Notes
                </CardTitle>
                <p className="field-hint mt-1">The game master's records of game sessions.</p>
              </CardHeader>
              <CardContent>
                <p className="description-text py-4">No session notes recorded for this campaign yet.</p>
              </CardContent>
            </Card>
          )}

          {activeTab === 'players' && (
            <Card className="border-gold/10 bg-card/60 shadow-xl backdrop-blur-sm rounded">
              <CardHeader>
                <CardTitle className="h2-title flex items-center gap-2">
                  <Users className="w-5 h-5 text-gold shrink-0" /> Player Notes
                </CardTitle>
                <p className="field-hint mt-1">A shared or individual notebook for active campaign players.</p>
              </CardHeader>
              <CardContent>
                <p className="description-text py-4">No player notes recorded for this campaign yet.</p>
              </CardContent>
            </Card>
          )}

          {activeTab === 'timeline' && (
            <Card className="border-gold/10 bg-card/60 shadow-xl backdrop-blur-sm rounded">
              <CardHeader>
                <CardTitle className="h2-title flex items-center gap-2">
                  <History className="w-5 h-5 text-gold shrink-0" /> Timeline
                </CardTitle>
                <p className="field-hint mt-1">Events mapped historically within the campaign scope.</p>
              </CardHeader>
              <CardContent>
                <p className="description-text py-4">No timeline events recorded for this campaign yet.</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
