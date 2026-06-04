// Featured-characters picker for Settings → Public Profile.
//
// Lets a user choose + order up to MAX of their OWN characters to showcase on
// their public profile. Self-saving (PUT /api/me/favorite-characters on every
// change) — independent of the profile form's Save button, mirroring how the
// compendium favorites toggles persist immediately.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getSessionToken } from "../../lib/auth";
import { User, Plus, X, ArrowUp, ArrowDown, Check } from "lucide-react";

type Char = { id: string; name: string; image_url?: string | null; level?: number | null };

const MAX = 8;

async function authHeaders(): Promise<Record<string, string>> {
  const t = await getSessionToken();
  return { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) };
}

function Thumb({ c }: { c: Char }) {
  return (
    <span className="w-9 h-9 rounded-full overflow-hidden border border-gold/30 bg-gold/10 flex items-center justify-center shrink-0">
      {c.image_url ? (
        <img src={c.image_url} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
      ) : (
        <User className="w-4 h-4 text-gold/45" />
      )}
    </span>
  );
}

export function FavoriteCharacters() {
  const [all, setAll] = useState<Char[]>([]);
  const [featured, setFeatured] = useState<Char[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const headers = await authHeaders();
        const [cRes, fRes] = await Promise.all([
          fetch("/api/me/characters?fields=id,name,image_url,level", { headers }),
          fetch("/api/me/favorite-characters", { headers }),
        ]);
        const cBody = cRes.ok ? await cRes.json() : { characters: [] };
        const fBody = fRes.ok ? await fRes.json() : { characters: [] };
        if (!active) return;
        setAll(Array.isArray(cBody.characters) ? cBody.characters : []);
        setFeatured(Array.isArray(fBody.characters) ? fBody.characters : []);
      } catch {
        /* non-fatal — picker just shows empty */
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const persist = async (next: Char[]) => {
    setFeatured(next);
    setSaving(true); setSaved(false);
    try {
      const headers = await authHeaders();
      const res = await fetch("/api/me/favorite-characters", {
        method: "PUT",
        headers,
        body: JSON.stringify({ character_ids: next.map((c) => c.id) }),
      });
      if (res.ok) {
        const b = await res.json();
        if (Array.isArray(b.characters)) setFeatured(b.characters);
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      }
    } catch {
      /* non-fatal */
    } finally {
      setSaving(false);
    }
  };

  const featuredIds = new Set(featured.map((c) => c.id));
  const available = all.filter((c) => !featuredIds.has(c.id));

  const add = (c: Char) => { if (featured.length < MAX) persist([...featured, c]); };
  const remove = (id: string) => persist(featured.filter((c) => c.id !== id));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= featured.length) return;
    const next = featured.slice();
    [next[i], next[j]] = [next[j], next[i]];
    persist(next);
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <label className="label-text text-ink/65">Featured Characters</label>
        {saving ? (
          <span className="text-[10px] uppercase tracking-wide text-ink/40">Saving…</span>
        ) : saved ? (
          <span className="text-[10px] uppercase tracking-wide text-emerald-600 inline-flex items-center gap-1"><Check className="w-3 h-3" /> Saved</span>
        ) : null}
      </div>
      <p className="text-[11px] text-ink/45 italic mb-3">Show up to {MAX} of your characters on your public profile. Click to add, reorder with the arrows.</p>

      {loading ? (
        <p className="text-xs text-ink/45 italic py-2">Loading your characters…</p>
      ) : all.length === 0 ? (
        <p className="text-xs text-ink/45 italic py-2">
          You don't have any characters yet. <Link to="/characters" className="text-gold hover:underline">Create one</Link> to feature it here.
        </p>
      ) : (
        <div className="space-y-3">
          {/* Featured (ordered) */}
          {featured.length > 0 && (
            <div className="space-y-1.5">
              {featured.map((c, i) => (
                <div key={c.id} className="flex items-center gap-2.5 p-2 border border-gold/20 bg-background/40">
                  <Thumb c={c} />
                  <span className="flex-1 min-w-0 truncate text-sm text-ink font-serif">{c.name}</span>
                  {c.level != null && <span className="label-text text-gold shrink-0">Lv {c.level}</span>}
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0}
                      className="p-1 text-ink/40 hover:text-gold disabled:opacity-25" title="Move up">
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === featured.length - 1}
                      className="p-1 text-ink/40 hover:text-gold disabled:opacity-25" title="Move down">
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    <button type="button" onClick={() => remove(c.id)}
                      className="p-1 text-ink/40 hover:text-blood" title="Remove">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Available to add */}
          {available.length > 0 && featured.length < MAX && (
            <div>
              <div className="text-[10px] uppercase tracking-widest text-ink/40 mb-1.5">Add a character</div>
              <div className="flex flex-wrap gap-1.5">
                {available.map((c) => (
                  <button key={c.id} type="button" onClick={() => add(c)}
                    className="inline-flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 border border-gold/25 hover:border-gold/55 text-xs text-ink transition-colors">
                    <Thumb c={c} />
                    <span className="truncate max-w-[140px]">{c.name}</span>
                    <Plus className="w-3 h-3 text-gold/70" />
                  </button>
                ))}
              </div>
            </div>
          )}
          {featured.length >= MAX && (
            <p className="text-[11px] text-ink/45 italic">Showcase full ({MAX}). Remove one to add another.</p>
          )}
        </div>
      )}
    </div>
  );
}
