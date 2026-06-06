import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import LayoutEditor from '../../components/layout/LayoutEditor';
import LayoutBlocks from '../../components/layout/LayoutBlocks';
import { fetchSystemPages, fetchSystemPageBlocks, saveSystemPageBlocks } from '../../lib/systemPages';
import { makeBlock, LAYOUT_BLOCK_TYPES, type LayoutBlock, type LayoutBlockType } from '../../lib/layoutBlocks';

// System-page bodies get the shared block set minus the lore/campaign-specific
// staff blocks: `recommended` (campaign), `note`/`secret` (lore campaign scope).
const SYSTEM_BLOCK_TYPES = LAYOUT_BLOCK_TYPES.filter(
  (t) => t !== 'recommended' && t !== 'note' && t !== 'secret',
) as LayoutBlockType[];

/**
 * Fullscreen designer for a system page's BODY (the intro above the entries
 * glossary). A thin host around the shared {@link LayoutEditor} fullscreen mode —
 * exactly like the campaign homepage editor. Reached from the page editor's
 * "Design Page Body" button. The entries glossary stays in SystemPageEditor.
 */
export default function SystemPageDesigner({ userProfile }: { userProfile?: any }) {
  void userProfile;
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [pageName, setPageName] = useState('');
  const [description, setDescription] = useState('');
  const [ready, setReady] = useState(false);
  const [missing, setMissing] = useState(false);

  // Fetch the page first so the header label + the "start from description" seed
  // are available before the editor mounts (the editor's load runs on mount).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const pages = await fetchSystemPages();
        const p = pages.find((x) => x.id === id) ?? null;
        if (!alive) return;
        if (!p) { setMissing(true); setReady(true); return; }
        setPageName(p.name);
        setDescription(p.description ?? '');
        setReady(true);
      } catch (err) {
        console.error('Failed to load system page', err);
        if (alive) { setMissing(true); setReady(true); }
      }
    })();
    return () => { alive = false; };
  }, [id]);

  const load = useCallback(() => fetchSystemPageBlocks(id!), [id]);
  const save = useCallback((blocks: LayoutBlock[]) => saveSystemPageBlocks(id!, blocks), [id]);
  // Seed (when the page has no blocks yet) from the existing description, so the
  // admin starts with their current intro rather than a blank canvas.
  const seedDefault = useCallback((): LayoutBlock[] => {
    const tb = makeBlock('text', crypto.randomUUID()) as any;
    tb.body = description;
    return [tb];
  }, [description]);

  if (!ready) return <div className="text-center py-20 font-serif italic text-ink/65">Loading…</div>;
  if (missing || !id) return <div className="text-center py-20 font-serif italic text-ink/65">System page not found.</div>;

  return (
    <LayoutEditor
      fullscreen
      load={load}
      save={save}
      seedDefault={seedDefault}
      allowedTypes={SYSTEM_BLOCK_TYPES}
      imageStoragePath={`images/system/${id}`}
      paneStorageKey="dauligor:systemPageDesigner:panes:v1"
      onBack={() => navigate(`/compendium/system-pages/edit/${id}`)}
      renderPreview={(b) => <LayoutBlocks blocks={b} viewContext={{ isStaff: true }} />}
      labels={{
        title: 'Page Body',
        titleSuffix: pageName || undefined,
        previewLabel: 'Live preview',
        emptyPreviewTitle: 'No body blocks yet.',
        emptyPreviewHint: 'Add a block to build the page body.',
        saveLabel: 'Save Body',
        restoreLabel: 'Reset to description',
        backLabel: 'Back to Page',
        noun: 'page body',
        seedBanner: (
          <div className="px-3 py-2.5 border border-gold/25 bg-gold/5 shrink-0">
            <p className="text-[12px] text-ink/75 leading-snug">
              Started from this page's existing <strong className="text-ink">description</strong>. Edit the blocks below, then <strong className="text-ink">Save</strong> — the description becomes a mirror of the body's text, and the page renders these blocks.
            </p>
          </div>
        ),
      }}
    />
  );
}
