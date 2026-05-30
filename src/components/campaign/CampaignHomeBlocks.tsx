import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { ChevronRight } from 'lucide-react';
import BBCodeRenderer from '../BBCodeRenderer';
import { resolveReference, type RefResolved } from '../../lib/references';
import { isContainer, type EntityRef, type HomeBlock } from '../../lib/campaignHome';

interface ArticleLite {
  id: string;
  title: string;
  excerpt?: string;
  content?: string;
  imageUrl?: string;
}

interface Props {
  blocks: HomeBlock[];
  /** The campaign's auto-recommended article (resolved by Home from
   *  recommended_lore_id), used by `recommended` blocks in `auto` mode. */
  recommendedLore: ArticleLite | null;
  campaignName: string;
}

/** Strip BBCode tags + collapse whitespace for a plain card excerpt. */
function plainExcerpt(bbcode: string, max = 140): string {
  const text = (bbcode || '')
    .replace(/\[[^\]]+\]/g, ' ')      // [tags]
    .replace(/&[a-z]+\[[^\]]*\][^\s]*/gi, ' ') // @/& refs
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? text.slice(0, max).trimEnd() + '…' : text;
}

const refKey = (r: EntityRef) => `${r.kind}::${r.id}`;

/** Walk the block tree and collect every EntityRef that needs resolving. */
function collectRefs(blocks: HomeBlock[]): EntityRef[] {
  const out: EntityRef[] = [];
  const visit = (b: HomeBlock) => {
    if (b.blockType === 'entity-row' && b.source === 'manual') out.push(...b.refs);
    if (b.blockType === 'entity-feature' && b.ref) out.push(b.ref);
    if (b.blockType === 'recommended' && b.source === 'specific' && b.ref) out.push(b.ref);
    if (isContainer(b)) b.children.forEach(visit);
  };
  blocks.forEach(visit);
  return out;
}

/** One entity card — image-led, links to the entity's route when it has one. */
function EntityCard({ data, card, excerpt }: { data: RefResolved; card: 'image' | 'compact' | 'list'; excerpt: boolean }) {
  if (card === 'list') {
    const inner = (
      <span className="flex items-center gap-2 py-2 border-b border-gold/10 text-ink/80 hover:text-gold transition-colors">
        <ChevronRight className="w-3.5 h-3.5 text-gold shrink-0" />
        <span className="font-serif text-base">{data.name}</span>
        {data.sourceLabel && <span className="label-text ml-auto">{data.sourceLabel}</span>}
      </span>
    );
    return data.route ? <Link to={data.route} className="block group">{inner}</Link> : <div>{inner}</div>;
  }

  const body = (
    <div className="h-full border border-gold/15 hover:border-gold/40 transition-all bg-card/40 backdrop-blur-sm overflow-hidden flex flex-col">
      {card === 'image' && data.imageUrl && (
        <div className="h-32 overflow-hidden border-b border-gold/10">
          <img
            src={data.imageUrl}
            alt={data.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            referrerPolicy="no-referrer"
          />
        </div>
      )}
      <div className="p-5 pb-2">
        {data.sourceLabel && <span className="label-text">{data.sourceLabel}</span>}
        <h3 className="h3-title group-hover:text-gold transition-colors leading-tight">{data.name}</h3>
      </div>
      {excerpt && (
        <div className="p-5 pt-0 flex-grow">
          <p className="description-text line-clamp-3 text-sm">{plainExcerpt(data.summary)}</p>
        </div>
      )}
    </div>
  );
  return data.route
    ? <Link to={data.route} className="block group h-full">{body}</Link>
    : <div className="group h-full">{body}</div>;
}

/** Renders a campaign's custom homepage from its (possibly nested) block list.
 *  Resolves every entity ref once up front via `resolveReference`, then renders
 *  synchronously from the resolved map. */
export default function CampaignHomeBlocks({ blocks, recommendedLore, campaignName }: Props) {
  const refs = useMemo(() => collectRefs(blocks), [blocks]);
  // Stable signature of WHICH entities are referenced — so the resolve effect
  // fires only when the set of refs changes, not on every unrelated edit
  // (e.g. typing a hero title) that produces a fresh `refs` array.
  const refsSig = useMemo(() => refs.map(refKey).join('|'), [refs]);
  const [resolved, setResolved] = useState<Record<string, RefResolved>>({});

  useEffect(() => {
    let cancelled = false;
    if (refs.length === 0) { setResolved({}); return; }
    // De-dupe by kind::id so the same entity isn't resolved twice.
    const unique = new Map<string, EntityRef>();
    refs.forEach((r) => unique.set(refKey(r), r));
    (async () => {
      const entries = await Promise.all(
        [...unique.values()].map(async (r) => {
          try {
            const d = await resolveReference(r.kind, r.id);
            return d ? ([refKey(r), d] as const) : null;
          } catch {
            return null;
          }
        }),
      );
      if (cancelled) return;
      const map: Record<string, RefResolved> = {};
      for (const e of entries) if (e) map[e[0]] = e[1];
      setResolved(map);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refsSig]);

  const recoData: RefResolved | null = recommendedLore
    ? {
        kind: 'article', id: recommendedLore.id, name: recommendedLore.title,
        summary: recommendedLore.excerpt || recommendedLore.content || '',
        prereq: '', prereqFull: '', imageUrl: recommendedLore.imageUrl ?? null,
        route: `/wiki/article/${recommendedLore.id}`,
      }
    : null;

  const renderBlock = (block: HomeBlock): React.ReactNode => {
    switch (block.blockType) {
      case 'hero':
        return (
          <section key={block.id} className={`space-y-6 pt-10 ${block.align === 'left' ? 'text-left' : 'text-center'}`}>
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
              {block.title && (
                <h1 className={`${block.size === 'large' ? 'h1-title' : 'h2-title'} mb-4`}>{block.title}</h1>
              )}
              {block.subtitle && (
                <p className={`description-text text-xl ${block.align === 'left' ? '' : 'max-w-3xl mx-auto'}`}>{block.subtitle}</p>
              )}
            </motion.div>
          </section>
        );

      case 'text': {
        const w = block.width === 'narrow' ? 'max-w-2xl' : block.width === 'wide' ? 'max-w-none' : 'max-w-4xl';
        return <section key={block.id} className={w}><BBCodeRenderer content={block.body} /></section>;
      }

      case 'image': {
        if (!block.url) return null;
        const h = block.height === 'small' ? 'max-h-48' : block.height === 'large' ? 'max-h-[32rem]' : 'max-h-80';
        const img = (
          <img src={block.url} alt={block.caption || ''} className={`w-full object-cover ${h}`} referrerPolicy="no-referrer" />
        );
        return (
          <section key={block.id} className="space-y-2">
            <div className="overflow-hidden border border-gold/15">
              {block.link ? <Link to={block.link}>{img}</Link> : img}
            </div>
            {block.caption && <p className="text-center text-sm description-text">{block.caption}</p>}
          </section>
        );
      }

      case 'divider':
        if (block.style === 'space') return <div key={block.id} className="h-8" />;
        if (block.style === 'dots') return <div key={block.id} className="text-center text-gold tracking-[0.5em] py-2">• • •</div>;
        return <hr key={block.id} className="border-gold/20" />;

      case 'entity-row': {
        // Auto mode is article-only and resolved server-naively for now —
        // fall back to manual rendering of whatever refs exist. (Auto-by-category
        // fetch is a follow-up; manual covers the user's "specific entities" ask.)
        const cards = block.refs
          .map((r) => resolved[refKey(r)])
          .filter((d): d is RefResolved => Boolean(d));
        if (cards.length === 0 && !block.title) return null;
        const colClass = block.card === 'list'
          ? ''
          : { 1: '', 2: 'md:grid-cols-2', 3: 'md:grid-cols-3', 4: 'md:grid-cols-2 lg:grid-cols-4' }[block.columns];
        return (
          <section key={block.id} className="space-y-8">
            {block.showHeading && block.title && (
              <div className="flex items-center gap-3 border-b border-gold/20 pb-4"><h2 className="h2-title">{block.title}</h2></div>
            )}
            {cards.length > 0 ? (
              block.card === 'list' ? (
                <div>{cards.map((d, i) => <EntityCard key={i} data={d} card="list" excerpt={false} />)}</div>
              ) : (
                <div className={`grid ${colClass} gap-8`}>
                  {cards.map((d, i) => <EntityCard key={i} data={d} card={block.card} excerpt={block.excerpt} />)}
                </div>
              )
            ) : (
              <p className="description-text">Nothing to show here yet.</p>
            )}
          </section>
        );
      }

      case 'entity-feature': {
        const d = block.ref ? resolved[refKey(block.ref)] : null;
        if (!d) return null;
        const img = d.imageUrl ? (
          <div className="md:w-1/3 h-48 md:h-auto overflow-hidden">
            <img src={d.imageUrl} alt={d.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" referrerPolicy="no-referrer" />
          </div>
        ) : null;
        const text = (
          <div className="p-8 flex-grow">
            {d.sourceLabel && <span className="label-text">{d.sourceLabel}</span>}
            <h3 className="h3-title group-hover:text-gold transition-colors mb-4">{d.name}</h3>
            {block.excerpt && <p className="description-text line-clamp-3 mb-6">{plainExcerpt(d.summary)}</p>}
            {d.route && (
              <div className="flex items-center text-gold font-bold uppercase tracking-widest text-sm">
                View <ChevronRight className="w-4 h-4 ml-2" />
              </div>
            )}
          </div>
        );
        const inner = (
          <div className="border border-gold/20 bg-gold/5 hover:border-gold/40 transition-all overflow-hidden">
            <div className={`flex flex-col md:flex-row ${block.imageSide === 'right' ? 'md:flex-row-reverse' : ''}`}>{img}{text}</div>
          </div>
        );
        return (
          <section key={block.id} className="space-y-8">
            {block.title && <div className="flex items-center gap-3 border-b border-gold/20 pb-4"><h2 className="h2-title">{block.title}</h2></div>}
            {d.route ? <Link to={d.route} className="group block">{inner}</Link> : <div className="group">{inner}</div>}
          </section>
        );
      }

      case 'recommended': {
        const d = block.source === 'specific' && block.ref ? resolved[refKey(block.ref)] : recoData;
        return (
          <section key={block.id} className="space-y-8">
            <div className="flex items-center gap-3 border-b border-gold/20 pb-4">
              <h2 className="h2-title">{block.title || `Recommended for ${campaignName}`}</h2>
            </div>
            {d ? (
              <div className={block.layout === 'stacked' ? '' : 'grid md:grid-cols-2 gap-8'}>
                {d.route ? (
                  <Link to={d.route} className="group block">
                    <RecoCard data={d} />
                  </Link>
                ) : <div className="group"><RecoCard data={d} /></div>}
              </div>
            ) : (
              <div className="py-12 text-center bg-card/30 border border-dashed border-gold/10">
                <p className="description-text">No recommended article set for this campaign yet.</p>
              </div>
            )}
          </section>
        );
      }

      case 'group':
        return (
          <section key={block.id} className={block.style === 'card' || block.style === 'bordered' ? 'border border-gold/20 p-6' : ''}>
            {block.showTitle && block.title && (
              <h2 className="h2-title mb-6 pb-3 border-b border-gold/20">{block.title}</h2>
            )}
            <div className="space-y-12">{block.children.map(renderBlock)}</div>
          </section>
        );

      case 'columns': {
        const colClass = { 2: 'md:grid-cols-2', 3: 'md:grid-cols-3', 4: 'md:grid-cols-2 lg:grid-cols-4' }[block.columns];
        const gap = block.gap === 'small' ? 'gap-4' : block.gap === 'large' ? 'gap-12' : 'gap-8';
        return (
          <section key={block.id} className={`grid ${colClass} ${gap}`}>
            {block.children.map((c) => <div key={c.id} className="space-y-12">{renderBlock(c)}</div>)}
          </section>
        );
      }

      default:
        return null;
    }
  };

  return <div className="max-w-6xl mx-auto space-y-16 pb-20">{blocks.map(renderBlock)}</div>;
}

/** The recommended / featured wide card body. */
function RecoCard({ data }: { data: RefResolved }) {
  return (
    <div className="border border-gold/20 bg-gold/5 hover:border-gold/40 transition-all overflow-hidden">
      <div className="flex flex-col md:flex-row">
        {data.imageUrl && (
          <div className="md:w-1/3 h-48 md:h-auto overflow-hidden">
            <img src={data.imageUrl} alt={data.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" referrerPolicy="no-referrer" />
          </div>
        )}
        <div className="p-8 flex-grow">
          <span className="inline-block bg-gold text-white text-[10px] font-black uppercase tracking-widest px-2 py-1 mb-4">Essential Reading</span>
          <h3 className="h3-title group-hover:text-gold transition-colors mb-4">{data.name}</h3>
          <p className="description-text line-clamp-3 mb-6">{plainExcerpt(data.summary, 150)}</p>
          <div className="flex items-center text-gold font-bold uppercase tracking-widest text-sm">
            Read Article <ChevronRight className="w-4 h-4 ml-2" />
          </div>
        </div>
      </div>
    </div>
  );
}
