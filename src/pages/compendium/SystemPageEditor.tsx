import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import MarkdownEditor from '../../components/MarkdownEditor';
import {
  ChevronLeft, Plus, Trash2, ArrowUp, ArrowDown, Save, Layers,
} from 'lucide-react';
import { slugify, cn } from '../../lib/utils';
import {
  fetchSystemPages,
  fetchSystemPageEntries,
  saveSystemPage,
  saveSystemPageEntry,
  deleteSystemPageEntry,
  type SystemPageEntry,
} from '../../lib/systemPages';

/**
 * Master-detail editor for a system page. The left rail lists "Page Details"
 * plus every entry — click to edit that item on the right. The save bar is
 * sticky at the top of the viewport so it's always reachable; Ctrl/Cmd-S also
 * saves. New mode (`/compendium/system-pages/new`) drops you straight into the
 * editor with a blank page; on first save we navigate to `/edit/:id`.
 *
 * Entries live in local state until Save. On save we persist the page first
 * (entries FK to it via ON DELETE CASCADE), then each entry in order.
 */
type Selection = 'page' | string; // 'page' or an entry id

const newEntry = (pageId: string, order: number): SystemPageEntry => ({
  id: crypto.randomUUID(),
  pageId,
  identifier: '',
  name: 'New Entry',
  summary: null,
  body: '',
  sourceKind: null,
  sourceId: null,
  imageUrl: null,
  order,
});

export default function SystemPageEditor({ userProfile }: { userProfile?: any }) {
  void userProfile;
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const isNew = !id;

  // pageId is either the URL id, or a fresh uuid for a new page. Entries can
  // FK to it immediately; on Save we persist the page row before the entries.
  const [pageId, setPageId] = useState<string>(() => id ?? crypto.randomUUID());
  const [name, setName] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [identifierTouched, setIdentifierTouched] = useState(!isNew);
  const [icon, setIcon] = useState('');
  const [description, setDescription] = useState('');
  const [entries, setEntries] = useState<SystemPageEntry[]>([]);
  const [selected, setSelected] = useState<Selection>('page');
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [missing, setMissing] = useState(false);

  // Load existing page (edit mode only).
  useEffect(() => {
    if (isNew) {
      setLoading(false);
      return;
    }
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const pages = await fetchSystemPages();
        const found = pages.find((p) => p.id === id) ?? null;
        if (!alive) return;
        if (!found) {
          setMissing(true);
          setLoading(false);
          return;
        }
        setPageId(found.id);
        setName(found.name);
        setIdentifier(found.identifier);
        setIcon(found.icon ?? '');
        setDescription(found.description ?? '');
        const es = await fetchSystemPageEntries(found.id);
        if (alive) setEntries(es);
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

  const patchEntry = (entryId: string, patch: Partial<SystemPageEntry>) => {
    setEntries((prev) => prev.map((e) => (e.id === entryId ? { ...e, ...patch } : e)));
  };

  const moveEntry = (index: number, dir: -1 | 1) => {
    setEntries((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const removeEntry = async (entry: SystemPageEntry) => {
    if (!window.confirm(`Remove entry "${entry.name || entry.identifier || 'untitled'}"?`)) return;
    setEntries((prev) => prev.filter((e) => e.id !== entry.id));
    if (selected === entry.id) setSelected('page');
    try {
      // Harmless if it was never persisted (deletes 0 rows).
      await deleteSystemPageEntry(entry.id);
    } catch (err) {
      console.error('Delete entry failed', err);
    }
  };

  const addEntry = () => {
    const e = newEntry(pageId, entries.length);
    setEntries((prev) => [...prev, e]);
    setSelected(e.id);
  };

  const handleSave = useCallback(async () => {
    const pageIdentifier = slugify((identifierTouched ? identifier : slugify(name)).trim());
    if (!name.trim() || !pageIdentifier) {
      toast.error('Page name and identifier are required.');
      setSelected('page');
      return;
    }
    // Validate entries up front so we don't half-save.
    const seen = new Set<string>();
    const prepared = entries.map((e, i) => {
      const entryId = slugify((e.identifier || e.name).trim());
      return { ...e, identifier: entryId, order: i };
    });
    for (const e of prepared) {
      if (!e.name.trim() || !e.identifier) {
        toast.error(`Entry "${e.name || '(untitled)'}" needs a name and identifier.`);
        setSelected(e.id);
        return;
      }
      if (seen.has(e.identifier)) {
        toast.error(`Duplicate entry identifier "${e.identifier}" — they must be unique within the page.`);
        setSelected(e.id);
        return;
      }
      seen.add(e.identifier);
    }

    setSaving(true);
    try {
      // Page first so entries' FKs resolve.
      await saveSystemPage({
        id: pageId,
        identifier: pageIdentifier,
        name: name.trim(),
        description: description.trim() || null,
        icon: icon.trim() || null,
        order: null,
      });
      for (const e of prepared) {
        await saveSystemPageEntry({
          id: e.id,
          pageId,
          identifier: e.identifier,
          name: e.name.trim(),
          summary: e.summary?.trim() || null,
          body: e.body?.trim() || null,
          sourceKind: e.sourceKind,
          sourceId: e.sourceId,
          imageUrl: e.imageUrl,
          order: e.order,
        });
      }
      toast.success('Saved.');
      setIdentifier(pageIdentifier);
      setIdentifierTouched(true);
      setEntries(prepared);
      if (isNew) {
        // Reflect the saved id in the URL so reloads land in edit mode.
        navigate(`/compendium/system-pages/edit/${pageId}`, { replace: true });
      }
    } catch (err: any) {
      console.error('Save failed', err);
      toast.error(`Save failed: ${err?.message ?? err}`);
    } finally {
      setSaving(false);
    }
  }, [pageId, name, identifier, identifierTouched, icon, description, entries, isNew, navigate]);

  // Ctrl/Cmd-S to save without reaching for the bar.
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

  const selectedEntry = selected !== 'page' ? entries.find((e) => e.id === selected) ?? null : null;
  const selectedIndex = selectedEntry ? entries.findIndex((e) => e.id === selectedEntry.id) : -1;

  return (
    <div className="max-w-6xl mx-auto px-4 pb-12">
      {/* Sticky save bar — always reachable, no scrolling-up required. */}
      <div className="sticky top-0 z-20 -mx-4 px-4 py-3 mb-4 bg-background/95 backdrop-blur-md border-b border-gold/15 flex items-center gap-3">
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

      {/* Master / detail */}
      <div className="browser-panel" style={{ minHeight: 'calc(100vh - 180px)' }}>
        {/* Sidebar */}
        <div className="w-[260px] browser-sidebar flex flex-col">
          <button
            type="button"
            onClick={() => setSelected('page')}
            className={cn(
              'browser-row flex items-center gap-2',
              selected === 'page'
                ? 'bg-gold/25 border-r-4 border-r-gold text-gold font-bold'
                : 'text-ink/75',
            )}
          >
            <Layers className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Page Details</span>
          </button>

          <div className="px-3 pt-4 pb-1 flex items-center justify-between">
            <p className="label-text text-gold/65">
              Entries {entries.length > 0 ? `· ${entries.length}` : ''}
            </p>
          </div>

          <div className="flex-grow overflow-y-auto">
            {entries.length === 0 ? (
              <p className="px-3 py-3 text-xs text-ink/45 italic">No entries yet.</p>
            ) : (
              entries.map((entry, index) => {
                const isSelected = selected === entry.id;
                return (
                  <div
                    key={entry.id}
                    className={cn(
                      'group flex items-stretch border-b border-gold/5 transition-colors',
                      isSelected ? 'bg-gold/25 border-r-4 border-r-gold' : 'hover:bg-gold/5',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setSelected(entry.id)}
                      className={cn(
                        'flex-1 min-w-0 text-left px-3 py-2 text-sm truncate',
                        isSelected ? 'text-gold font-bold' : 'text-ink/75',
                      )}
                    >
                      {entry.name || <span className="italic text-ink/45">untitled</span>}
                    </button>
                    <div className="flex items-center gap-0.5 px-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); moveEntry(index, -1); }}
                        disabled={index === 0}
                        className="text-ink/45 hover:text-gold disabled:opacity-20 p-1"
                        title="Move up"
                      >
                        <ArrowUp className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); moveEntry(index, 1); }}
                        disabled={index === entries.length - 1}
                        className="text-ink/45 hover:text-gold disabled:opacity-20 p-1"
                        title="Move down"
                      >
                        <ArrowDown className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); removeEntry(entry); }}
                        className="text-ink/45 hover:text-blood p-1"
                        title="Remove"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="border-t border-gold/15 p-2">
            <Button size="sm" onClick={addEntry} className="w-full btn-gold gap-2 h-8">
              <Plus className="w-3.5 h-3.5" /> Add Entry
            </Button>
          </div>
        </div>

        {/* Detail */}
        <div className="browser-content">
          {selected === 'page' ? (
            <PageMetaForm
              name={name}
              setName={(v) => {
                setName(v);
                if (!identifierTouched) setIdentifier(slugify(v));
              }}
              effectiveIdentifier={effectiveIdentifier}
              onIdentifierChange={(v) => { setIdentifierTouched(true); setIdentifier(v); }}
              icon={icon}
              setIcon={setIcon}
              isNew={isNew}
              canDesign={!isNew}
              onDesignBody={() => navigate(`/compendium/system-pages/edit/${pageId}/body`)}
            />
          ) : selectedEntry ? (
            <EntryForm
              key={selectedEntry.id}
              entry={selectedEntry}
              index={selectedIndex}
              total={entries.length}
              onPatch={(patch) => patchEntry(selectedEntry.id, patch)}
              onMove={(dir) => moveEntry(selectedIndex, dir)}
              onRemove={() => removeEntry(selectedEntry)}
            />
          ) : (
            <p className="text-ink/45 italic">Select an entry from the left to edit it, or add a new one.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Page meta form -------------------------------------------------------

interface PageMetaFormProps {
  name: string;
  setName: (v: string) => void;
  effectiveIdentifier: string;
  onIdentifierChange: (v: string) => void;
  icon: string;
  setIcon: (v: string) => void;
  isNew: boolean;
  canDesign: boolean;
  onDesignBody: () => void;
}

function PageMetaForm({
  name, setName, effectiveIdentifier, onIdentifierChange, icon, setIcon, isNew, canDesign, onDesignBody,
}: PageMetaFormProps) {
  return (
    <div className="max-w-3xl space-y-6">
      <header>
        <p className="label-text text-gold/75">Page Details</p>
        <h2 className="h2-title mt-1">{isNew ? 'New System Page' : 'Page'}</h2>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="field-label">Name</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
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
            onChange={(e) => onIdentifierChange(e.target.value)}
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
        <label className="field-label">Page Body</label>
        <p className="field-hint">
          The intro shown above the entries is now a block layout (text, images, callouts,
          references, …). It's authored in the fullscreen body designer.
        </p>
        {canDesign ? (
          <Button onClick={onDesignBody} className="btn-gold gap-2 mt-1">
            <Layers className="w-4 h-4" /> Design Page Body
          </Button>
        ) : (
          <p className="text-xs text-ink/45 italic mt-1">Save the page first to design its body.</p>
        )}
      </div>
    </div>
  );
}

// --- Entry form -----------------------------------------------------------

interface EntryFormProps {
  entry: SystemPageEntry;
  index: number;
  total: number;
  onPatch: (patch: Partial<SystemPageEntry>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}

function EntryForm({ entry, index, total, onPatch, onMove, onRemove }: EntryFormProps) {
  return (
    <div className="max-w-3xl space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="label-text text-gold/75">Entry {index + 1} of {total}</p>
          <h2 className="h2-title mt-1 truncate">{entry.name || 'Untitled'}</h2>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="sm" onClick={() => onMove(-1)} disabled={index === 0} className="h-7 w-7 p-0 text-ink/55 hover:text-gold disabled:opacity-30" title="Move up">
            <ArrowUp className="w-3.5 h-3.5" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onMove(1)} disabled={index === total - 1} className="h-7 w-7 p-0 text-ink/55 hover:text-gold disabled:opacity-30" title="Move down">
            <ArrowDown className="w-3.5 h-3.5" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onRemove} className="h-7 w-7 p-0 btn-danger" title="Delete entry">
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="field-label">Name</label>
          <Input
            value={entry.name}
            onChange={(e) => onPatch({ name: e.target.value })}
            className="field-input"
          />
        </div>
        <div className="space-y-1.5">
          <label className="field-label">Identifier (#anchor)</label>
          <Input
            value={entry.identifier}
            onChange={(e) => onPatch({ identifier: e.target.value })}
            placeholder={slugify(entry.name) || 'entry-slug'}
            className="field-input font-mono"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="field-label">Summary (hover blurb)</label>
        <Input
          value={entry.summary ?? ''}
          onChange={(e) => onPatch({ summary: e.target.value })}
          placeholder="Short one-line description for the hover card"
          className="field-input"
        />
      </div>

      <MarkdownEditor
        value={entry.body ?? ''}
        onChange={(v) => onPatch({ body: v })}
        label="Body"
        placeholder="Entry text — supports BBCode and @/& references."
        minHeight="320px"
      />
    </div>
  );
}
