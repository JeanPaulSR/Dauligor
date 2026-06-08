import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { fetchSystemPageDetail, type SystemPageDetail } from '../../lib/systemPages';
import SystemPageGlossary from '../../components/compendium/SystemPageGlossary';

/**
 * Public reader for a system page — `/system/:identifier`. This is the
 * navigation target for `&`-references (e.g. `&condition[prone]` →
 * `/system/condition#prone`). Fetches the page + its display-ready entries and
 * scrolls to the `#anchor` once content has loaded (the deep-link from a ref).
 */
export default function SystemPageView() {
  const { identifier } = useParams<{ identifier: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [detail, setDetail] = useState<SystemPageDetail | null>(null);
  const [loading, setLoading] = useState(true);

  // Back to wherever the reader came from (often a `&`-reference link). When this
  // page is the first history entry (direct visit / shared link), fall back home
  // rather than leaving the app.
  const goBack = () => {
    if (location.key && location.key !== 'default') navigate(-1);
    else navigate('/');
  };

  useEffect(() => {
    let alive = true;
    setLoading(true);
    if (!identifier) {
      setDetail(null);
      setLoading(false);
      return;
    }
    fetchSystemPageDetail(identifier)
      .then((d) => {
        if (!alive) return;
        setDetail(d);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load system page', identifier, err);
        if (!alive) return;
        setDetail(null);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [identifier]);

  // Deep-link scrolling lives in SystemPageGlossary now — it can coordinate
  // setActiveId + the scroll-spy lock with the scroll itself, so the entry
  // we jumped to is both centered AND marked active. Doing it here was
  // racing the spy and landing the highlight on the next entry.

  return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      {loading ? (
        <div className="text-ink/45 italic">Loading…</div>
      ) : !detail ? (
        <div className="text-center py-20">
          <h1 className="h2-title text-ink/65">System page not found</h1>
          <p className="text-ink/45 mt-2">
            No system page with identifier “{identifier}”.
          </p>
          <Link to="/" className="text-gold hover:underline mt-4 inline-block">
            Go home
          </Link>
        </div>
      ) : (
        <>
          <div className="mb-6">
            <Button variant="ghost" onClick={goBack} className="text-ink/65 hover:text-gold gap-2 -ml-2">
              <ChevronLeft className="w-4 h-4" /> Back
            </Button>
          </div>
          <SystemPageGlossary page={detail.page} entries={detail.entries} blocks={detail.blocks} />
        </>
      )}
    </div>
  );
}
