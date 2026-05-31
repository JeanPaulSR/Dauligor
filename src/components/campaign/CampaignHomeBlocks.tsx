import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { ChevronRight } from 'lucide-react';
import BBCodeRenderer from '../BBCodeRenderer';
import { resolveReference, type RefResolved } from '../../lib/references';
import {
  isContainer, isPlaceholderRef, clampSpan, PLACEHOLDER_TITLE, PLACEHOLDER_DESCRIPTION,
  type EntityRef, type HomeBlock,
} from '../../lib/campaignHome';

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

/** Walk the block tree and collect every EntityRef that needs resolving.
 *  Placeholder refs are skipped — they don't point at a real entity. */
function collectRefs(blocks: HomeBlock[]): EntityRef[] {
  const out: EntityRef[] = [];
  const push = (r: EntityRef | null) => { if (r && !isPlaceholderRef(r)) out.push(r); };
  const visit = (b: HomeBlock) => {
    // Guard against a malformed/unparseable block sneaking into a children array
    // (e.g. an undefined from a missing parse case) — skip rather than crash.
    if (!b || typeof b !== 'object') return;
    if (b.blockType === 'entity-row' && b.source === 'manual') (b.refs || []).forEach(push);
    if (b.blockType === 'entity-feature') push(b.ref);
    if (b.blockType === 'recommended' && b.source === 'specific') push(b.ref);
    if (isContainer(b)) (b.children || []).forEach(visit);
  };
  blocks.forEach(visit);
  return out;
}

/** A card view-model: either resolved entity data, or a placeholder (an
 *  intentional GM placeholder, OR a real ref whose target doesn't exist yet —
 *  both render a graceful card instead of vanishing, matching the legacy
 *  "(Article not found)" tile). */
/** A resolved card view-model. `title`/`description` are the EFFECTIVE strings
 *  after applying per-card overrides (ref.title / ref.description) over the
 *  resolved entity, falling back to the Placeholder / Coming-Soon defaults.
 *  `data` is the resolved entity (image/route/sourceLabel) or null for a
 *  placeholder/missing tile. `span` is the ref's raw column span (0 = unset). */
interface CardVM {
  title: string;
  description: string;
  span: number;
  data: RefResolved | null;
  placeholder: boolean;
}
function refToCard(r: EntityRef, resolved: Record<string, RefResolved>): CardVM {
  const span = r.span == null ? 0 : clampSpan(r.span);
  if (isPlaceholderRef(r)) {
    return {
      title: r.title || r.name || PLACEHOLDER_TITLE,
      description: r.description || PLACEHOLDER_DESCRIPTION,
      span, data: null, placeholder: true,
    };
  }
  const d = resolved[refKey(r)];
  if (d) {
    return {
      title: r.title || d.name,
      description: r.description || plainExcerpt(d.summary),
      span, data: d, placeholder: false,
    };
  }
  // Real ref whose target doesn't exist yet → graceful tile (legacy "(not found)").
  return {
    title: r.title || r.name || r.id || PLACEHOLDER_TITLE,
    description: r.description || PLACEHOLDER_DESCRIPTION,
    span, data: null, placeholder: true,
  };
}

/** A graceful placeholder tile — used for GM placeholders and not-yet-created
 *  targets. Mirrors the legacy dashed "coming soon" card. */
function PlaceholderCard({ title, description, card }: { title: string; description: string; card: 'image' | 'compact' | 'list' }) {
  if (card === 'list') {
    return (
      <span className="flex items-center gap-2 py-2 border-b border-gold/10 text-ink/40">
        <ChevronRight className="w-3.5 h-3.5 text-gold/30 shrink-0" />
        <span className="font-serif text-base italic">{title}</span>
        {description && <span className="label-text ml-auto text-ink/20">{description}</span>}
      </span>
    );
  }
  return (
    <div className="h-full border border-dashed border-gold/20 bg-card/30 flex flex-col items-center justify-center text-center min-h-[150px] p-6">
      <p className="text-xs font-bold uppercase tracking-widest text-ink/30 font-serif">{title}</p>
      {/* The placeholder tile's sub-label is a tiny status string ("Coming Soon"),
          not a prose box — keep it plain (no `.prose` blowout) and use the
          documented `.field-hint` helper (tiny italic, theme-remapped) instead of
          a hand-rolled text-[10px] ink size. */}
      {description && <p className="field-hint mt-1">{description}</p>}
    </div>
  );
}

/** One entity card — image-led, links to the entity's route when it has one.
 *  `title`/`description` are the effective strings (per-card override, else the
 *  resolved entity's name / plain summary). */
function EntityCard({ data, card, excerpt, title, description }: { data: RefResolved; card: 'image' | 'compact' | 'list'; excerpt: boolean; title: string; description: string }) {
  if (card === 'list') {
    const inner = (
      <span className="flex items-center gap-2 py-2 border-b border-gold/10 text-ink/80 hover:text-gold transition-colors">
        <ChevronRight className="w-3.5 h-3.5 text-gold shrink-0" />
        <span className="font-serif text-base">{title}</span>
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
            alt={title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            referrerPolicy="no-referrer"
          />
        </div>
      )}
      <div className="p-5 pb-2">
        {data.sourceLabel && <span className="label-text">{data.sourceLabel}</span>}
        <h3 className="h3-title group-hover:text-gold transition-colors leading-tight">{title}</h3>
      </div>
      {excerpt && description && (
        <div className="p-5 pt-0 flex-grow">
          {/* Use the documented `.description-text` helper (theme-remapped
              supporting copy) on BBCodeRenderer's `.prose` element — the same way
              the rest of the app styles BBCode (e.g. ClassView `body-text`).
              `text-sm` (standard token) + `line-clamp-3` ride alongside. */}
          <BBCodeRenderer content={description} className="description-text text-sm line-clamp-3" />
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
      case 'hero': {
        const alignClass = block.align === 'left' ? 'text-left' : block.align === 'right' ? 'text-right' : 'text-center';
        return (
          <section key={block.id} className={`space-y-6 pt-10 ${alignClass}`}>
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
              {block.title && (
                <h1 className={`${block.size === 'large' ? 'h1-title' : 'h2-title'} mb-4`}>{block.title}</h1>
              )}
              {block.subtitle && (
                // BBCode subtitle — the wrapper carries the size/serif/colour so
                // the classic italic look comes from the default's [i]…[/i], not a
                // hardcoded `italic`. Only the centered variant gets the readable
                // max-width; left/right stay full-width so text-align positions them.
                <div className={`text-xl text-ink/70 font-serif ${block.align === 'center' ? 'max-w-3xl mx-auto' : ''}`}>
                  <BBCodeRenderer content={block.subtitle} />
                </div>
              )}
            </motion.div>
          </section>
        );
      }

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
        // Each ref → a card view-model: resolved entity OR a placeholder
        // (intentional, or a not-yet-created target). Placeholders render a
        // graceful tile instead of vanishing — matching the legacy home.
        // (Auto-by-category fetch is a follow-up; manual covers the
        // "specific entities" ask.)
        const vms = block.refs.map((r) => refToCard(r, resolved));
        if (vms.length === 0 && !block.title) return null;
        const colClass = block.card === 'list'
          ? ''
          : { 1: '', 2: 'md:grid-cols-2', 3: 'md:grid-cols-3', 4: 'md:grid-cols-2 lg:grid-cols-4' }[block.columns];
        const isGrid = block.card !== 'list';
        const renderCard = (vm: CardVM, i: number) => {
          // Per-card column span (set in the entity picker, default 1), clamped to
          // the row's column count so a card never overflows its grid.
          const span = Math.min(vm.span > 1 ? vm.span : 1, block.columns);
          // Static classes (Tailwind needs literal strings). For the 4-col grid
          // (md:grid-cols-2 lg:grid-cols-4) a 4-span is full width at both stops.
          const spanCls = isGrid && span >= 2
            ? ({ 2: 'md:col-span-2', 3: 'md:col-span-3', 4: 'md:col-span-2 lg:col-span-4' }[span] || '')
            : '';
          const inner = vm.data
            ? <EntityCard key={i} data={vm.data} card={block.card} excerpt={block.card === 'list' ? false : block.excerpt} title={vm.title} description={vm.description} />
            : <PlaceholderCard key={i} title={vm.title} description={vm.description} card={block.card} />;
          return spanCls ? <div key={i} className={spanCls}>{inner}</div> : inner;
        };
        return (
          <section key={block.id} className="space-y-8">
            {block.showHeading && block.title && (
              <div className="flex items-center gap-3 border-b border-gold/20 pb-4"><h2 className="h2-title">{block.title}</h2></div>
            )}
            {vms.length > 0 ? (
              block.card === 'list'
                ? <div>{vms.map(renderCard)}</div>
                : <div className={`grid ${colClass} gap-8`}>{vms.map(renderCard)}</div>
            ) : (
              <p className="description-text">Nothing to show here yet.</p>
            )}
          </section>
        );
      }

      case 'callout': {
        if (!block.title && !block.body) return null;
        const hasButton = block.buttonLabel && block.buttonLink;
        const box = block.style === 'soft'
          ? 'py-16 px-6 text-center bg-gold/5 border border-dashed border-gold/20'
          : 'py-10 px-6 text-center bg-card/40 border border-gold/15';
        return (
          <section key={block.id} className="space-y-8">
            <div className={box}>
              {block.title && <h2 className="h3-title text-ink/50">{block.title}</h2>}
              {block.body && (
                // Documented `.description-text` helper on BBCodeRenderer's
                // `.prose` element (theme-remapped supporting copy), plus layout
                // utilities (margins + centered max-width are layout, not colour,
                // so no theme concern). Matches how the app styles BBCode.
                <BBCodeRenderer content={block.body} className="description-text mt-2 mb-6 max-w-2xl mx-auto" />
              )}
              {hasButton && (
                <Link to={block.buttonLink}>
                  <span className="inline-flex items-center gap-2 border border-gold text-gold hover:bg-gold/5 transition-colors px-4 py-2 text-sm font-medium">
                    {block.buttonLabel}
                  </span>
                </Link>
              )}
            </div>
          </section>
        );
      }

      case 'entity-feature': {
        if (!block.ref) return null;
        const ph = isPlaceholderRef(block.ref);
        const d = ph ? null : resolved[refKey(block.ref)];
        // Intentional placeholder OR unresolved real ref → graceful feature tile.
        if (!d) {
          const name = block.ref.name || block.ref.id || 'Untitled';
          return (
            <section key={block.id} className="space-y-8">
              {block.title && <div className="flex items-center gap-3 border-b border-gold/20 pb-4"><h2 className="h2-title">{block.title}</h2></div>}
              <div className="border border-dashed border-gold/20 bg-card/30 flex flex-col items-center justify-center text-center min-h-[120px] p-8">
                <p className="text-sm font-bold uppercase tracking-widest text-ink/30 font-serif">{name}</p>
                <p className="field-hint mt-1">{ph ? 'Placeholder' : 'Coming soon'}</p>
              </div>
            </section>
          );
        }
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
        // Each child is a `column` cell that stacks its own blocks. Grid column
        // count follows the actual number of columns (clamped 2–4).
        const cols = (block.children || []).filter((c) => c.blockType === 'column').slice(0, 4);
        if (cols.length === 0) return null;
        const n = Math.max(2, cols.length) as 2 | 3 | 4;
        const colClass = { 2: 'md:grid-cols-2', 3: 'md:grid-cols-3', 4: 'md:grid-cols-2 lg:grid-cols-4' }[n];
        const gap = block.gap === 'small' ? 'gap-4' : block.gap === 'large' ? 'gap-12' : 'gap-8';
        return <section key={block.id} className={`grid ${colClass} ${gap}`}>{cols.map(renderBlock)}</section>;
      }

      case 'column':
        // One column cell: its own blocks, stacked. (Rendered only as a child of
        // a `columns` block; an empty column simply contributes an empty cell.)
        return <div key={block.id} className="space-y-12">{block.children.map(renderBlock)}</div>;

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
