import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { auth } from '../../lib/firebase';
import { fetchDocument } from '../../lib/d1';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card';
import { Book, Map as MapIcon, Users, ChevronRight, Sparkles, ScrollText, History, Shield, Zap, Swords, Wand2, Hammer, Star, Home as HomeIcon, Plus, LogIn } from 'lucide-react';
import { motion } from 'motion/react';
import { Badge } from '../../components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';

export default function Home({ userProfile }: { userProfile: any }) {
  const [activeCampaign, setActiveCampaign] = useState<any>(null);
  const [specialArticles, setSpecialArticles] = useState<Record<string, any>>({});
  const [recommendedLore, setRecommendedLore] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        // 1. Fetch Special Articles by Title via D1 helper
        const titles = [
          "World Primer", "World History", "Rules", 
          "Divinity", "Magic", "Character Creation Rules", 
          "Unique Tools and Skills", "Races", "Classes", 
          "Backgrounds", "Feats"
        ];
        
        // /api/lore/articles returns the (server-filtered + dm_notes-
        // stripped) published list. We filter to the special-article
        // titles client-side because the set is fixed and tiny; not
        // worth a query-param surface for this single caller.
        const articlesMap: Record<string, any> = {};
        const idToken = await auth.currentUser?.getIdToken();
        const listRes = await fetch('/api/lore/articles?orderBy=title%20ASC', {
          headers: idToken ? { Authorization: `Bearer ${idToken}` } : {},
        });
        if (listRes.ok) {
          const body = await listRes.json();
          const allArticles: any[] = Array.isArray(body?.articles) ? body.articles : [];
          const titleSet = new Set(titles);
          allArticles.forEach((art) => {
            if (titleSet.has(art.title)) {
              articlesMap[art.title] = art;
            }
          });
        }
        setSpecialArticles(articlesMap);

        // 2. Fetch Active Campaign and its Recommended Lore. Campaign
        // row still goes through /api/d1/query for now (lore-only
        // migration in this commit); the lore read goes through the
        // per-route GET so dm_notes/draft-status checks happen
        // server-side.
        if (userProfile?.active_campaign_id) {
          const campaignData = await fetchDocument<any>('campaigns', userProfile.active_campaign_id);

          if (campaignData) {
            setActiveCampaign(campaignData);

            if (campaignData.recommended_lore_id) {
              const loreRes = await fetch(
                `/api/lore/articles/${encodeURIComponent(campaignData.recommended_lore_id)}`,
                { headers: idToken ? { Authorization: `Bearer ${idToken}` } : {} },
              );
              if (loreRes.ok) {
                const loreBody = await loreRes.json();
                // Server already enforces draft visibility — if the
                // article is draft and viewer is non-staff, the
                // endpoint returns 404, which we silently skip here.
                if (loreBody?.article) {
                  setRecommendedLore(loreBody.article);
                }
              }
            }
          }
        }

      } catch (error) {
        console.error("Error fetching home data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [userProfile?.active_campaign_id, userProfile?.id]);

  const renderArticlePreview = (title: string, icon: React.ReactNode, className?: string) => {
    const article = specialArticles[title];
    if (!article) return (
      <Card className={`border-gold/10 bg-card/30 border-dashed ${className}`}>
        <CardContent className="p-6 flex flex-col items-center justify-center text-center h-full min-h-[150px]">
          <div className="opacity-20 mb-2">{icon}</div>
          <p className="text-xs font-bold uppercase tracking-widest text-ink/20">{title}</p>
          <p className="text-[10px] text-ink/20 italic mt-1">(Article not found)</p>
        </CardContent>
      </Card>
    );

    return (
      <Link to={`/wiki/article/${article.id}`} className={`block group ${className}`}>
        <Card className="h-full border-gold/10 hover:border-gold/40 transition-all bg-card/40 backdrop-blur-sm overflow-hidden flex flex-col">
          {article.imageUrl && (
            <div className="h-32 overflow-hidden border-b border-gold/10">
              <img 
                src={article.imageUrl} 
                alt={article.title} 
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                referrerPolicy="no-referrer"
              />
            </div>
          )}
          <CardHeader className="p-5 pb-2">
            <div className="flex items-center gap-2 mb-1">
              <div className="text-gold group-hover:scale-110 transition-transform">{icon}</div>
              <span className="label-text">Featured Article</span>
            </div>
            <CardTitle className="h3-title group-hover:text-gold transition-colors leading-tight">{article.title}</CardTitle>
          </CardHeader>
          <CardContent className="p-5 pt-0 flex-grow">
            <p className="description-text line-clamp-3 text-sm text-ink/60">
              {article.excerpt || (article.content?.substring(0, 120) + '...')}
            </p>
            <div className="mt-4 flex items-center text-xs font-bold text-gold uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">
              Read More <ChevronRight className="w-3 h-3 ml-1" />
            </div>
          </CardContent>
        </Card>
      </Link>
    );
  };

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto py-20 text-center">
        <div className="animate-pulse space-y-8">
          <div className="h-20 bg-gold/5 rounded-xl w-3/4 mx-auto" />
          <div className="grid grid-cols-3 gap-8">
            <div className="h-64 bg-gold/5 rounded-xl col-span-2" />
            <div className="h-64 bg-gold/5 rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-16 pb-20">
      {/* Hero Section */}
      <section className="text-center space-y-6 pt-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <h1 className="h1-title mb-4">
            Stories in Dauligor
          </h1>
          <p className="description-text text-xl max-w-3xl mx-auto">
            Jean, your dm, has made this website with the purpose of having easy access to the lore of the setting of Dauligor and to have easy access to homebrew options that he allows.
          </p>
        </motion.div>
      </section>

      {/* World Introduction Section */}
      <section className="space-y-8">
        <div className="flex items-center gap-3 border-b border-gold/20 pb-4">
          <Sparkles className="text-gold w-6 h-6" />
          <h2 className="h2-title">The World of Dauligor</h2>
        </div>
        <div className="grid md:grid-cols-3 gap-8">
          {renderArticlePreview("World Primer", <Book className="w-5 h-5" />, "md:col-span-2")}
          {renderArticlePreview("World History", <History className="w-5 h-5" />)}
        </div>
        <div className="grid md:grid-cols-3 gap-8">
          {renderArticlePreview("Rules", <ScrollText className="w-5 h-5" />)}
          {renderArticlePreview("Divinity", <Zap className="w-5 h-5" />)}
          {renderArticlePreview("Magic", <Wand2 className="w-5 h-5" />)}
        </div>
      </section>

      {/* Character Creation Section - Placeholder */}
      <section className="space-y-8">
        <div className="flex items-center gap-3 border-b border-gold/20 pb-4">
          <Users className="text-gold w-6 h-6" />
          <h2 className="h2-title">Character Creation</h2>
        </div>
        
        <div className="py-20 text-center bg-gold/5 rounded-3xl border border-dashed border-gold/20">
          <Sparkles className="w-12 h-12 text-gold mx-auto mb-4 opacity-20" />
          <h3 className="h3-title text-ink/40">The Archive is expanding...</h3>
          <p className="description-text mt-2 mb-8 text-ink/30">Character options and creation tools are currently being reorganized by the DM.</p>
          <Link to="/sources">
            <Button variant="outline" className="border-gold text-gold hover:bg-gold/5 gap-2">
              <Book className="w-4 h-4" /> Browse Sources
            </Button>
          </Link>
        </div>
      </section>

      {/* Recommended Reading Section */}
      {activeCampaign && (
        <section className="space-y-8">
          <div className="flex items-center gap-3 border-b border-gold/20 pb-4">
            <Star className="text-gold w-6 h-6" />
            <h2 className="h2-title">Recommended for {activeCampaign.name}</h2>
          </div>
          
          <div className="grid md:grid-cols-2 gap-8">
            {recommendedLore ? (
              <Link to={`/wiki/article/${recommendedLore.id}`} className="group">
                <Card className="border-gold/20 bg-gold/5 hover:border-gold/40 transition-all overflow-hidden">
                  <div className="flex flex-col md:flex-row">
                    {recommendedLore.imageUrl && (
                      <div className="md:w-1/3 h-48 md:h-auto overflow-hidden">
                        <img 
                          src={recommendedLore.imageUrl} 
                          alt={recommendedLore.title} 
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                    )}
                    <div className="p-8 flex-grow">
                      <Badge className="bg-gold text-white mb-4">ESSENTIAL READING</Badge>
                      <h3 className="h3-title group-hover:text-gold transition-colors mb-4">
                        {recommendedLore.title}
                      </h3>
                      <p className="description-text line-clamp-3 mb-6 text-ink/60">
                        {recommendedLore.excerpt || (recommendedLore.content?.substring(0, 150) + '...')}
                      </p>
                      <div className="flex items-center text-gold font-bold uppercase tracking-widest text-sm">
                        Read Article <ChevronRight className="w-4 h-4 ml-2" />
                      </div>
                    </div>
                  </div>
                </Card>
              </Link>
            ) : (
              <div className="col-span-2 py-12 text-center bg-card/30 rounded-2xl border border-dashed border-gold/10">
                <p className="text-ink/40 font-serif italic">The DM hasn't highlighted any specific scrolls for this campaign yet.</p>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
