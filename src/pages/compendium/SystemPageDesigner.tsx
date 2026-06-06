import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import LayoutEditor from '../../components/layout/LayoutEditor';
import LayoutBlocks from '../../components/layout/LayoutBlocks';
import { fetchSystemPages, assembleSystemPageEditorBlocks, saveSystemPageBlocks } from '../../lib/systemPages';
import { makeBlock, LAYOUT_BLOCK_TYPES, type LayoutBlock, type LayoutBlockType } from '../../lib/layoutBlocks';

// System pages are authored as one block layout: prose/structure blocks for the
// body + `definition` blocks for the addressable entries (the &kind[anchor] /
// #anchor targets). Excluded:
//  - lore/campaign-only staff blocks: `recommended` (campaign), `note`/`secret` (lore);
//  - `reference` — a pointer that embeds an entity defined elsewhere; the page is the
//    canonical home for its entries, so an entry is a `definition`, never a pointer.
const EXCLUDED_SYSTEM_BLOCKS = new Set(['recommended', 'note', 'secret', 'reference']);
const SYSTEM_BLOCK_TYPES = LAYOUT_BLOCK_TYPES.filter(
  (t) => !EXCLUDED_SYSTEM_BLOCKS.has(t),
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

  // Load lazily assembles the editing blocks: existing body blocks, plus a text
  // block from the legacy description and definition blocks from legacy entries
  // when the page hasn't been block-migrated yet (see assembleSystemPageEditorBlocks).
  const load = useCallback(() => assembleSystemPageEditorBlocks(id!, description), [id, description]);
  const save = useCallback((blocks: LayoutBlock[]) => saveSystemPageBlocks(id!, blocks), [id]);
  // Only used for a truly empty page (no blocks, no description, no entries).
  const seedDefault = useCallback((): LayoutBlock[] => [makeBlock('text', crypto.randomUUID())], []);

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
        title: 'System Page',
        titleSuffix: pageName || undefined,
        previewLabel: 'Live preview',
        emptyPreviewTitle: 'Nothing here yet.',
        emptyPreviewHint: 'Add prose blocks for the body, and Definition blocks for entries.',
        saveLabel: 'Save Page',
        restoreLabel: 'Reset',
        backLabel: 'Back to Page',
        noun: 'system page',
        seedBanner: (
          <div className="px-3 py-2.5 border border-gold/25 bg-gold/5 shrink-0">
            <p className="text-[12px] text-ink/75 leading-snug">
              A system page is one block layout: prose/structure blocks for the body, plus <strong className="text-ink">Definition</strong> blocks for entries (each is a <code>&amp;kind[anchor]</code> reference target). Existing description + entries are loaded as blocks; <strong className="text-ink">Save</strong> to persist.
            </p>
          </div>
        ),
      }}
    />
  );
}
