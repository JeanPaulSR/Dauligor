import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Sparkles, Type, LayoutGrid, ImageIcon, Star,
  ChevronUp, ChevronDown, Trash2, Plus, Save, X, GripVertical,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import MarkdownEditor from '../MarkdownEditor';
import SingleSelectSearch from '../ui/SingleSelectSearch';
import { ImageUpload } from '../ui/ImageUpload';
import {
  fetchCampaignHomeBlocks, saveCampaignHomeBlocks, makeBlock,
  BLOCK_TYPE_META, HOME_BLOCK_TYPES,
  type HomeBlock, type HomeBlockType,
} from '../../lib/campaignHome';

const ICONS: Record<string, any> = { Sparkles, Type, LayoutGrid, ImageIcon, Star };

interface ArticleLite { id: string; title: string }

interface Props {
  campaignId: string;
  /** Lore articles for the article-row picker (staff list, includes drafts). */
  articles: ArticleLite[];
}

/** GM editor for a campaign's homepage layout: an ordered block list with
 *  add / reorder / delete and per-type config. Self-contained (own load +
 *  Save), rendered inside the CampaignEditor "Homepage" tab. */
export default function CampaignHomeEditor({ campaignId, articles }: Props) {
  const [blocks, setBlocks] = useState<HomeBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const loaded = await fetchCampaignHomeBlocks(campaignId);
        if (!cancelled) setBlocks(loaded);
      } catch (err) {
        console.error('Failed to load home layout:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [campaignId]);

  const articleOptions = articles.map((a) => ({ id: a.id, name: a.title }));
  const titleById = (id: string) => articles.find((a) => a.id === id)?.title ?? '(unknown article)';

  const update = useCallback((id: string, patch: Partial<HomeBlock>) => {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } as HomeBlock : b)));
    setDirty(true);
  }, []);

  const move = (index: number, dir: -1 | 1) => {
    setBlocks((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setDirty(true);
  };

  const remove = (id: string) => {
    setBlocks((prev) => prev.filter((b) => b.id !== id));
    setDirty(true);
  };

  const add = (type: HomeBlockType) => {
    setBlocks((prev) => [...prev, makeBlock(type, crypto.randomUUID())]);
    setAddOpen(false);
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveCampaignHomeBlocks(campaignId, blocks);
      setDirty(false);
      toast.success('Homepage layout saved');
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || 'Failed to save homepage layout');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="description-text py-4">Loading homepage layout…</p>;
  }

  return (
    <div className="space-y-5">
      <Card className="border-gold/10 bg-card/60 shadow-xl backdrop-blur-sm rounded">
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="h2-title flex items-center gap-2">
              <LayoutGrid className="w-5 h-5 text-gold shrink-0" /> Homepage Layout
            </CardTitle>
            <p className="field-hint mt-1">
              Arrange the blocks players see on the home page for this campaign. Empty layout = the default site home.
            </p>
          </div>
          <Button onClick={handleSave} disabled={saving || !dirty} className="btn-gold-solid gap-2 rounded shrink-0">
            <Save className="w-4 h-4" />
            {saving ? 'Saving…' : dirty ? 'Save Layout' : 'Saved'}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {blocks.length === 0 ? (
            <div className="py-10 text-center bg-background/40 rounded border border-dashed border-gold/15">
              <p className="text-ink/40 font-serif italic mb-1">No custom blocks yet.</p>
              <p className="text-[11px] text-ink/30">Players see the default home page until you add blocks below.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {blocks.map((block, index) => (
                <BlockEditor
                  key={block.id}
                  block={block}
                  index={index}
                  total={blocks.length}
                  articleOptions={articleOptions}
                  titleById={titleById}
                  campaignId={campaignId}
                  onUpdate={update}
                  onMove={move}
                  onRemove={remove}
                />
              ))}
            </div>
          )}

          {/* Add-block picker */}
          {addOpen ? (
            <div className="border border-gold/20 rounded bg-background/50 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="field-label">Add a block</span>
                <button onClick={() => setAddOpen(false)} className="text-ink/40 hover:text-blood" aria-label="Cancel">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {HOME_BLOCK_TYPES.map((type) => {
                  const meta = BLOCK_TYPE_META[type];
                  const Icon = ICONS[meta.icon] ?? LayoutGrid;
                  return (
                    <button
                      key={type}
                      onClick={() => add(type)}
                      className="flex items-start gap-3 p-3 rounded border border-gold/10 bg-card/40 hover:border-gold/40 hover:bg-gold/5 transition-all text-left"
                    >
                      <Icon className="w-4 h-4 text-gold shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-ink">{meta.label}</div>
                        <div className="text-[11px] text-ink/50 leading-snug">{meta.description}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              onClick={() => setAddOpen(true)}
              className="w-full border-dashed border-gold/30 text-gold hover:bg-gold/5 gap-2 rounded"
            >
              <Plus className="w-4 h-4" /> Add Block
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Per-block editor                                                            */
/* -------------------------------------------------------------------------- */

interface BlockEditorProps {
  block: HomeBlock;
  index: number;
  total: number;
  articleOptions: { id: string; name: string }[];
  titleById: (id: string) => string;
  campaignId: string;
  onUpdate: (id: string, patch: Partial<HomeBlock>) => void;
  onMove: (index: number, dir: -1 | 1) => void;
  onRemove: (id: string) => void;
}

function BlockEditor({ block, index, total, articleOptions, titleById, campaignId, onUpdate, onMove, onRemove }: BlockEditorProps) {
  const meta = BLOCK_TYPE_META[block.blockType];
  const Icon = ICONS[meta.icon] ?? LayoutGrid;

  return (
    <div className="border border-gold/15 rounded bg-background/40 overflow-hidden">
      {/* Block header row: type label + reorder/delete controls */}
      <div className="flex items-center gap-2 px-3 py-2 bg-gold/5 border-b border-gold/10">
        <GripVertical className="w-4 h-4 text-ink/20 shrink-0" />
        <Icon className="w-4 h-4 text-gold shrink-0" />
        <span className="text-xs font-bold uppercase tracking-widest text-ink/60 flex-1">{meta.label}</span>
        <button
          onClick={() => onMove(index, -1)}
          disabled={index === 0}
          className="p-1 text-ink/40 hover:text-gold disabled:opacity-20 disabled:cursor-not-allowed"
          aria-label="Move up"
        >
          <ChevronUp className="w-4 h-4" />
        </button>
        <button
          onClick={() => onMove(index, 1)}
          disabled={index === total - 1}
          className="p-1 text-ink/40 hover:text-gold disabled:opacity-20 disabled:cursor-not-allowed"
          aria-label="Move down"
        >
          <ChevronDown className="w-4 h-4" />
        </button>
        <button
          onClick={() => onRemove(block.id)}
          className="p-1 text-ink/40 hover:text-blood"
          aria-label="Remove block"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Block config body */}
      <div className="p-3 space-y-3">
        {block.blockType === 'hero' && (
          <>
            <Field label="Title">
              <Input
                value={block.title}
                onChange={(e) => onUpdate(block.id, { title: e.target.value })}
                placeholder="e.g. Stories in Dauligor"
                className="field-input rounded"
              />
            </Field>
            <Field label="Subtitle">
              <textarea
                value={block.subtitle}
                onChange={(e) => onUpdate(block.id, { subtitle: e.target.value })}
                placeholder="A short welcome line."
                className="w-full min-h-[70px] p-3 rounded border border-gold/10 bg-background/50 hover:border-gold/30 focus:border-gold/40 text-sm italic font-serif text-ink/80 transition-colors"
              />
            </Field>
          </>
        )}

        {block.blockType === 'text' && (
          <Field label="Body (BBCode)">
            <MarkdownEditor
              value={block.body}
              onChange={(val) => onUpdate(block.id, { body: val })}
              placeholder="Write campaign intro text…"
            />
          </Field>
        )}

        {block.blockType === 'article-row' && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3">
              <Field label="Section Title (optional)">
                <Input
                  value={block.title}
                  onChange={(e) => onUpdate(block.id, { title: e.target.value })}
                  placeholder="e.g. The World of Dauligor"
                  className="field-input rounded"
                />
              </Field>
              <Field label="Columns">
                <select
                  value={block.columns}
                  onChange={(e) => onUpdate(block.id, { columns: e.target.value === '2' ? 2 : 3 })}
                  className="h-10 px-3 rounded border border-gold/10 bg-background/50 text-sm"
                >
                  <option value={2}>2</option>
                  <option value={3}>3</option>
                </select>
              </Field>
            </div>
            <Field label="Articles">
              <div className="space-y-2">
                {block.articleIds.length === 0 ? (
                  <p className="text-[11px] text-ink/40 italic">No articles added yet.</p>
                ) : (
                  <div className="space-y-1.5">
                    {block.articleIds.map((aid, i) => (
                      <div key={`${aid}-${i}`} className="flex items-center gap-2 px-2 py-1.5 rounded bg-gold/5 border border-gold/15">
                        <span className="text-[11px] text-ink/30 w-5 shrink-0">{i + 1}.</span>
                        <span className="flex-1 text-xs text-ink truncate font-serif">{titleById(aid)}</span>
                        <button
                          onClick={() => onUpdate(block.id, { articleIds: block.articleIds.filter((_, j) => j !== i) })}
                          className="p-0.5 text-ink/30 hover:text-blood shrink-0"
                          aria-label="Remove article"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <SingleSelectSearch
                  value={undefined}
                  onChange={(id) => {
                    if (id) onUpdate(block.id, { articleIds: [...block.articleIds, id] });
                  }}
                  options={articleOptions}
                  placeholder="+ Add an article…"
                  allowClear={false}
                />
              </div>
            </Field>
          </>
        )}

        {block.blockType === 'image' && (
          <>
            <Field label="Image">
              <ImageUpload
                currentImageUrl={block.url || ''}
                onUpload={(url) => onUpdate(block.id, { url })}
                storagePath={`images/campaigns/${campaignId}/home`}
              />
            </Field>
            <Field label="Caption (optional)">
              <Input
                value={block.caption}
                onChange={(e) => onUpdate(block.id, { caption: e.target.value })}
                placeholder="A short caption beneath the image."
                className="field-input rounded"
              />
            </Field>
          </>
        )}

        {block.blockType === 'recommended' && (
          <>
            <Field label="Heading (optional)">
              <Input
                value={block.title}
                onChange={(e) => onUpdate(block.id, { title: e.target.value })}
                placeholder='Defaults to "Recommended for <campaign>"'
                className="field-input rounded"
              />
            </Field>
            <p className="text-[11px] text-ink/40 italic">
              Shows this campaign's recommended article (set under Campaign Info → Recommended Lore).
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="field-label flex items-center gap-1.5">{label}</label>
      {children}
    </div>
  );
}
