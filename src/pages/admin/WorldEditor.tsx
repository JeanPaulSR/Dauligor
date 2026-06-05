// =============================================================================
// World Editor — dedicated full-page editor for a single world.
// =============================================================================
//
// Mirrors the campaign/era editor pattern: the list page (/admin/worlds)
// handles browsing; this page owns the fine details of one world.
// Route: /admin/worlds/edit/:id  (id === 'new' creates a fresh world).
// Admin-only — world CRUD is admin-gated server-side. The default world
// ("Dauligor") is editable (rename/description) but flagged read-only-ish:
// its slug powers public catalog URLs, so we warn on it.
// =============================================================================

import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { Badge } from '../../components/ui/badge';
import { FocalImageField } from '../../components/ui/FocalImageEditor';
import { ChevronLeft, Save } from 'lucide-react';
import { getSessionToken } from '../../lib/auth';

export default function WorldEditor({ userProfile }: { userProfile: any }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = id === 'new';
  const isAdmin = userProfile?.role === 'admin';

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [isDefault, setIsDefault] = useState(false);
  const [form, setForm] = useState({ name: '', slug: '', description: '', owner_user_id: '', sort_order: 0, background_image_url: '' });

  const authedFetch = async (input: string, init?: RequestInit) => {
    const idToken = await getSessionToken();
    return fetch(input, {
      ...init,
      headers: {
        ...(init?.headers || {}),
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      },
    });
  };

  useEffect(() => {
    if (!isAdmin || isNew) return;
    const load = async () => {
      try {
        const res = await authedFetch('/api/admin/worlds');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        const world = (Array.isArray(body?.worlds) ? body.worlds : []).find((w: any) => w.id === id);
        if (world) {
          setForm({
            name: world.name || '',
            slug: world.slug || '',
            description: world.description ?? '',
            owner_user_id: world.owner_user_id ?? '',
            sort_order: world.sort_order ?? 0,
            background_image_url: world.background_image_url ?? '',
          });
          setIsDefault(Number(world.is_default) === 1);
        }
      } catch (err) {
        console.error('Failed to load world:', err);
        toast.error('Failed to load world');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [id, isNew, isAdmin]);

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        slug: form.slug.trim() || undefined,
        description: form.description.trim() || null,
        owner_user_id: form.owner_user_id.trim() || null,
        sort_order: Number(form.sort_order) || 0,
        background_image_url: form.background_image_url || '',
      };
      const res = isNew
        ? await authedFetch('/api/admin/worlds', { method: 'POST', body: JSON.stringify(payload) })
        : await authedFetch(`/api/admin/worlds/${encodeURIComponent(id!)}`, { method: 'PATCH', body: JSON.stringify(payload) });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error || `Save failed (HTTP ${res.status})`);
      }
      toast.success(isNew ? 'World created' : 'World updated');
      navigate('/admin/worlds');
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || 'Failed to save world');
    } finally {
      setSaving(false);
    }
  };

  if (!isAdmin) return <div className="text-center py-20 font-serif italic text-ink/65">Access Denied. Admins only.</div>;
  if (loading) return <div className="text-center py-20 font-serif italic text-ink/65">Loading world…</div>;

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-20">
      <div className="page-header">
        <Button variant="ghost" onClick={() => navigate('/admin/worlds')} className="text-ink/65 hover:text-gold transition-colors rounded">
          <ChevronLeft className="w-4 h-4 mr-2" /> Back to Worlds
        </Button>
        <Button onClick={handleSave} disabled={saving} className="btn-gold-solid gap-2 rounded">
          <Save className="w-4 h-4" />
          {saving ? 'Saving…' : isNew ? 'Create World' : 'Save Changes'}
        </Button>
      </div>

      <Card className="border-gold/15 bg-card/60 shadow-xl backdrop-blur-sm rounded">
        <CardHeader>
          <CardTitle className="h2-title flex items-center gap-2">
            {isNew ? 'New World' : 'Edit World'}
            {isDefault && <Badge variant="outline" className="border-gold text-gold">Default</Badge>}
          </CardTitle>
          <p className="field-hint mt-1">Top-level scope for compendium content. Worlds will host scope-aware content as roles roll out.</p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <label className="field-label">Name</label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Eberron" className="field-input font-serif text-lg h-11 rounded" />
          </div>

          <div className="space-y-2">
            <label className="field-label">Slug</label>
            <Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="auto-derived from name if blank" className="field-input font-mono h-10 rounded" />
            <p className="field-hint">
              Lowercase letters, numbers, and dashes. Used in URLs once worlds scope public content.
              {isDefault && <span className="text-gold"> Changing the default world&apos;s slug affects existing catalog links.</span>}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="field-label">Owner User ID <span className="text-ink/45">(optional)</span></label>
              <Input value={form.owner_user_id} onChange={(e) => setForm({ ...form, owner_user_id: e.target.value })} placeholder="Blank = shared/admin-owned" className="field-input font-mono text-xs h-10 rounded" />
            </div>
            <div className="space-y-2">
              <label className="field-label">Sort Order</label>
              <Input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) || 0 })} className="field-input h-10 rounded" />
            </div>
          </div>

          <div className="space-y-2 pt-2 border-t border-gold/15">
            <label className="field-label">Description <span className="text-ink/45">(optional)</span></label>
            <Textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="One-line summary surfaced in pickers." className="rounded" />
          </div>

          <div className="space-y-2 pt-2 border-t border-gold/15">
            <label className="field-label">World Background</label>
            <p className="field-hint">
              The world&apos;s default lore-page backdrop. It&apos;s the bottom of the cascade — an era or campaign
              background overrides it, but otherwise this is what shows behind the wiki.
            </p>
            <FocalImageField
              aspectClass="aspect-[16/9]"
              backdrop
              image={form.background_image_url || ''}
              overrideImageUrl={form.background_image_url || ''}
              onOverrideChange={(url) => setForm({ ...form, background_image_url: url })}
              storagePath="images/wiki/background"
              browseRoot="images"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
