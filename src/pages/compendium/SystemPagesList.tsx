import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import {
  Plus,
  Trash2,
  Pencil,
  Search,
  BookMarked,
} from 'lucide-react';
import {
  fetchSystemPages,
  deleteSystemPage,
  type SystemPage,
} from '../../lib/systemPages';

/**
 * Player-visible list of system pages — the site-consistent, reference-
 * addressable glossary type. Built for scale (30+ pages) with a searchable
 * compact list. Clicking a row navigates to the public view (`/system/:id`);
 * admin actions (New / Edit / Delete) appear only for admins.
 */
export default function SystemPagesList({ userProfile }: { userProfile?: any }) {
  const navigate = useNavigate();
  const isAdmin = userProfile?.role === 'admin';
  const [pages, setPages] = useState<SystemPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      setPages(await fetchSystemPages());
    } catch (err) {
      console.error('Failed to load system pages', err);
      toast.error('Failed to load system pages');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleDelete = async (page: SystemPage) => {
    if (!window.confirm(`Delete the system page "${page.name}" and all its entries? This cannot be undone.`)) {
      return;
    }
    try {
      await deleteSystemPage(page.id);
      toast.success(`Deleted "${page.name}".`);
      load();
    } catch (err: any) {
      console.error('Delete system page failed', err);
      toast.error(`Delete failed: ${err?.message ?? err}`);
    }
  };

  // Client-side filter — N is small, search is instant; matches name or
  // identifier (so an admin who knows the `&kind` can find a page either way).
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return pages;
    return pages.filter(
      (p) =>
        p.name.toLowerCase().includes(q) || p.identifier.toLowerCase().includes(q),
    );
  }, [pages, search]);

  const openView = (page: SystemPage) =>
    navigate(`/system/${page.identifier}`);

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-20">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="space-y-2">
          <h1 className="h2-title uppercase">System Pages</h1>
          <p className="text-sm text-ink/60 max-w-2xl">
            Site wide consistent reference articles.
          </p>
        </div>
        {isAdmin ? (
          <Button
            onClick={() => navigate('/compendium/system-pages/new')}
            className="btn-gold-solid gap-2 shadow-lg shadow-gold/20 shrink-0"
          >
            <Plus className="w-4 h-4" /> New System Page
          </Button>
        ) : null}
      </div>

      {/* Search — appears once there's anything to filter. */}
      {pages.length > 1 ? (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink/30 pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or identifier…"
            className="field-input pl-9"
          />
        </div>
      ) : null}

      {/* List */}
      {loading ? (
        <div className="text-ink/40 italic py-8 text-center">Loading…</div>
      ) : pages.length === 0 ? (
        <div className="empty-state">
          <BookMarked className="w-12 h-12 text-gold/20 mb-3" />
          <p className="description-text">No system pages yet.</p>
          {isAdmin ? (
            <p className="label-text text-gold/40 mt-1">Create one to start a reference glossary.</p>
          ) : null}
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <p className="description-text">No pages match &ldquo;{search}&rdquo;.</p>
          <button
            type="button"
            onClick={() => setSearch('')}
            className="text-gold text-sm hover:underline mt-2"
          >
            Clear search
          </button>
        </div>
      ) : (
        <div className="border border-gold/15 rounded-md overflow-hidden bg-card/40 divide-y divide-gold/10">
          {filtered.map((page) => (
            <div
              key={page.id}
              role="button"
              tabIndex={0}
              onClick={() => openView(page)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  openView(page);
                }
              }}
              className="group flex items-center gap-4 px-4 py-3 hover:bg-gold/5 transition-colors cursor-pointer outline-none focus-visible:bg-gold/5 focus-visible:ring-1 focus-visible:ring-gold/30"
            >
              <div className="flex-1 min-w-0">
                <h3 className="font-serif text-base font-semibold text-gold truncate group-hover:underline decoration-gold/40">
                  {page.name}
                </h3>
              </div>
              {isAdmin ? (
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/compendium/system-pages/edit/${page.id}`);
                    }}
                    className="h-7 px-2 text-gold hover:bg-gold/10 gap-1"
                    title="Edit"
                  >
                    <Pencil className="w-3.5 h-3.5" /> Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(page);
                    }}
                    className="h-7 w-7 p-0 btn-danger"
                    title="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

    </div>
  );
}
