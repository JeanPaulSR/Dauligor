import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { ChevronRight, Star } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import BBCodeRenderer from '../BBCodeRenderer';
import type { HomeBlock } from '../../lib/campaignHome';

interface ArticleLite {
  id: string;
  title: string;
  excerpt?: string;
  content?: string;
  imageUrl?: string;
}

interface Props {
  blocks: HomeBlock[];
  /** Published articles the viewer is allowed to see, keyed by id. Articles
   *  not in this map (e.g. drafts for a player) are silently skipped. */
  articlesById: Record<string, ArticleLite>;
  /** The campaign's recommended article, already resolved (or null). */
  recommendedLore: ArticleLite | null;
  campaignName: string;
}

/** A single linked article card — shared shape across article-row + recommended. */
function ArticleCard({ article }: { article: ArticleLite }) {
  return (
    <Link to={`/wiki/article/${article.id}`} className="block group h-full">
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
          <span className="label-text">Featured Article</span>
          <CardTitle className="h3-title group-hover:text-gold transition-colors leading-tight">{article.title}</CardTitle>
        </CardHeader>
        <CardContent className="p-5 pt-0 flex-grow">
          <p className="description-text line-clamp-3 text-sm text-ink/60">
            {article.excerpt || (article.content ? article.content.substring(0, 120) + '…' : '')}
          </p>
          <div className="mt-4 flex items-center text-xs font-bold text-gold uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">
            Read More <ChevronRight className="w-3 h-3 ml-1" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

/** Renders a campaign's custom homepage from its ordered block list. */
export default function CampaignHomeBlocks({ blocks, articlesById, recommendedLore, campaignName }: Props) {
  return (
    <div className="max-w-6xl mx-auto space-y-16 pb-20">
      {blocks.map((block) => {
        switch (block.blockType) {
          case 'hero':
            return (
              <section key={block.id} className="text-center space-y-6 pt-10">
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6 }}
                >
                  {block.title && <h1 className="h1-title mb-4">{block.title}</h1>}
                  {block.subtitle && (
                    <p className="description-text text-xl max-w-3xl mx-auto">{block.subtitle}</p>
                  )}
                </motion.div>
              </section>
            );

          case 'text':
            return (
              <section key={block.id}>
                <BBCodeRenderer content={block.body} />
              </section>
            );

          case 'article-row': {
            const articles = block.articleIds
              .map((id) => articlesById[id])
              .filter((a): a is ArticleLite => Boolean(a));
            if (articles.length === 0 && !block.title) return null;
            const cols = block.columns === 2 ? 'md:grid-cols-2' : 'md:grid-cols-3';
            return (
              <section key={block.id} className="space-y-8">
                {block.title && (
                  <div className="flex items-center gap-3 border-b border-gold/20 pb-4">
                    <h2 className="h2-title">{block.title}</h2>
                  </div>
                )}
                {articles.length > 0 ? (
                  <div className={`grid ${cols} gap-8`}>
                    {articles.map((a) => <ArticleCard key={a.id} article={a} />)}
                  </div>
                ) : (
                  <p className="text-ink/40 font-serif italic">No articles to show here yet.</p>
                )}
              </section>
            );
          }

          case 'image':
            if (!block.url) return null;
            return (
              <section key={block.id} className="space-y-2">
                <div className="rounded-2xl overflow-hidden border border-gold/15">
                  <img
                    src={block.url}
                    alt={block.caption || ''}
                    className="w-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                </div>
                {block.caption && (
                  <p className="text-center text-sm text-ink/50 font-serif italic">{block.caption}</p>
                )}
              </section>
            );

          case 'recommended':
            return (
              <section key={block.id} className="space-y-8">
                <div className="flex items-center gap-3 border-b border-gold/20 pb-4">
                  <Star className="text-gold w-6 h-6" />
                  <h2 className="h2-title">{block.title || `Recommended for ${campaignName}`}</h2>
                </div>
                {recommendedLore ? (
                  <div className="grid md:grid-cols-2 gap-8">
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
                            <h3 className="h3-title group-hover:text-gold transition-colors mb-4">{recommendedLore.title}</h3>
                            <p className="description-text line-clamp-3 mb-6 text-ink/60">
                              {recommendedLore.excerpt || (recommendedLore.content ? recommendedLore.content.substring(0, 150) + '…' : '')}
                            </p>
                            <div className="flex items-center text-gold font-bold uppercase tracking-widest text-sm">
                              Read Article <ChevronRight className="w-4 h-4 ml-2" />
                            </div>
                          </div>
                        </div>
                      </Card>
                    </Link>
                  </div>
                ) : (
                  <div className="py-12 text-center bg-card/30 rounded-2xl border border-dashed border-gold/10">
                    <p className="text-ink/40 font-serif italic">No recommended article set for this campaign yet.</p>
                  </div>
                )}
              </section>
            );

          default:
            return null;
        }
      })}
    </div>
  );
}
