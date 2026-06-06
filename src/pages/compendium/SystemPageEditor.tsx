import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { ChevronLeft, Save, Layers } from 'lucide-react';
import { slugify } from '../../lib/utils';
import { fetchSystemPages, saveSystemPage } from '../../lib/systemPages';

/**
 * Settings editor for a system page — name, `identifier` (the `&` reference kind),
 * and icon. The page's body AND its entries are authored as a block layout in the
 * fullscreen designer ("Design Page Body" → SystemPageDesigner): prose/structure
 * blocks for the body, `definition` blocks for the entries. So there's no
 * entry master-detail here anymore — `description` is round-tripped untouched (the
 * designer owns it as a text mirror of the body).
 *
 * New mode (`/compendium/system-pages/new`) starts with a blank page; on first
 * save we navigate to `/edit/:id` and the body designer unlocks.
 */
export default function SystemPageEditor({ userProfile }: { userProfile?: any }) {
  void userProfile;
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const isNew = !id;

  const [pageId, setPageId] = useState<string>(() => id ?? crypto.randomUUID());
  const [name, setName] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [identifierTouched, setIdentifierTouched] = useState(!isNew);
  const [icon, setIcon] = useState('');
  // Loaded + round-tripped on save; authored as the body's text mirror in the designer.
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (isNew) { setLoading(false); return; }
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const pages = await fetchSystemPages();
        const found = pages.find((p) => p.id === id) ?? null;
        if (!alive) return;
        if (!found) { setMissing(true); setLoading(false); return; }
        setPageId(found.id);
        setName(found.name);
        setIdentifier(found.identifier);
        setIcon(found.icon ?? '');
        setDescription(found.description ?? '');
      } catch (err) {
        console.error('Failed to load system page', err);
        toast.error('Failed to load system page');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [id, isNew]);

  const effectiveIdentifier = identifierTouched ? identifier : (identifier || slugify(name));

  const handleSave = useCallback(async () => {
    const pageIdentifier = slugify((identifierTouched ? identifier : slugify(name)).trim());
    if (!name.trim() || !pageIdentifier) {
      toast.error('Page name and identifier are required.');
      return;
    }
    setSaving(true);
    try {
      await saveSystemPage({
        id: pageId,
        identifier: pageIdentifier,
        name: name.trim(),
        // Round-trip the description — the body designer owns it as a mirror.
        description: description.trim() || null,
        icon: icon.trim() || null,
        order: null,
      });
      toast.success('Saved.');
      setIdentifier(pageIdentifier);
      setIdentifierTouched(true);
      if (isNew) {
        navigate(`/compendium/system-pages/edit/${pageId}`, { replace: true });
      }
    } catch (err: any) {
      console.error('Save failed', err);
      toast.error(`Save failed: ${err?.message ?? err}`);
    } finally {
      setSaving(false);
    }
  }, [pageId, name, identifier, identifierTouched, icon, description, isNew, navigate]);

  // Ctrl/Cmd-S to save.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        if (!saving) handleSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleSave, saving]);

  if (loading) {
    return <div className="max-w-6xl mx-auto px-4 py-10 text-ink/45 italic">Loading…</div>;
  }
  if (missing) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-10 text-center">
        <h1 className="h2-title text-ink/65">System page not found</h1>
        <Button variant="ghost" className="text-gold mt-4" onClick={() => navigate('/compendium/system-pages')}>
          Back to list
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 pb-12">
      {/* Sticky save bar */}
      <div className="sticky top-0 z-20 -mx-4 px-4 py-3 mb-6 bg-background/95 backdrop-blur-md border-b border-gold/15 flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/compendium/system-pages')}
          className="text-ink/65 hover:text-ink gap-1 -ml-2"
        >
          <ChevronLeft className="w-4 h-4" /> System Pages
        </Button>
        <div className="flex-1 min-w-0 text-center">
          <span className="font-serif text-gold/85 truncate text-lg">
            {name || (isNew ? 'New System Page' : 'Untitled')}
          </span>
          {isNew ? <span className="ml-2 text-[10px] uppercase tracking-widest text-gold/65">draft</span> : null}
        </div>
        <Button
          onClick={handleSave}
          disabled={saving}
          className="btn-gold-solid gap-2 shadow-lg shadow-gold/25"
          title="Save (Ctrl/⌘ S)"
        >
          <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>

      <div className="space-y-6">
        <header>
          <p className="label-text text-gold/75">Page Details</p>
          <h2 className="h2-title mt-1">{isNew ? 'New System Page' : 'Page'}</h2>
        </header>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="field-label">Name</label>
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!identifierTouched) setIdentifier(slugify(e.target.value));
              }}
              placeholder="Conditions"
              className="field-input"
              autoFocus={isNew}
            />
            <p className="field-hint">Displayed at the top of the page.</p>
          </div>
          <div className="space-y-1.5">
            <label className="field-label">Identifier (&amp; reference kind)</label>
            <Input
              value={effectiveIdentifier}
              onChange={(e) => { setIdentifierTouched(true); setIdentifier(e.target.value); }}
              placeholder="condition"
              className="field-input font-mono"
            />
            <p className="field-hint">
              URL slug + the <code className="text-gold/85">&amp;</code> reference kind:{' '}
              <code>&amp;{effectiveIdentifier || 'kind'}[entry]</code> &rarr; <code>/system/{effectiveIdentifier || 'kind'}</code>
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="field-label">Icon (optional)</label>
          <Input
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
            placeholder="Image URL"
            className="field-input"
          />
        </div>

        <div className="space-y-1.5 pt-2 border-t border-gold/15">
          <label className="field-label">Page Content</label>
          <p className="field-hint">
            The body and its entries are authored as a block layout — prose/structure blocks for the
            body, plus <strong className="text-ink/80">Definition</strong> blocks for entries (each a
            <code className="ml-1">&amp;{effectiveIdentifier || 'kind'}[anchor]</code> reference target).
          </p>
          {isNew ? (
            <p className="text-xs text-ink/45 italic mt-1">Save the page first to design its content.</p>
          ) : (
            <Button onClick={() => navigate(`/compendium/system-pages/edit/${pageId}/body`)} className="btn-gold gap-2 mt-1">
              <Layers className="w-4 h-4" /> Design Page Content
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
