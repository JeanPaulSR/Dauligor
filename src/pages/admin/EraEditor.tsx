// =============================================================================
// Era Editor — dedicated full-page editor for a single era.
// =============================================================================
//
// Mirrors the campaign editor pattern (/campaign/edit/:id): the list page
// (/admin/eras) handles browsing; this page owns the fine details of one era.
// Route: /admin/eras/edit/:id  (id === 'new' creates a fresh era).
// Admin-only — era CRUD is admin-gated server-side.
// =============================================================================

import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { fetchCollection } from '../../lib/d1';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { FocalImageField } from '../../components/ui/FocalImageEditor';
import { ChevronLeft, Save } from 'lucide-react';
import { getSessionToken } from '../../lib/auth';

export default function EraEditor({ userProfile }: { userProfile: any }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = id === 'new';
  const isAdmin = userProfile?.role === 'admin';

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', order: 0, backgroundImageUrl: '' });

  useEffect(() => {
    if (!isAdmin || isNew) return;
    const load = async () => {
      try {
        const all = await fetchCollection<any>('eras', { orderBy: '"order" ASC' });
        const era = all.find((e: any) => e.id === id);
        if (era) {
          setForm({
            name: era.name || '',
            description: era.description || '',
            order: era.order ?? 0,
            backgroundImageUrl: era.background_image_url || '',
          });
        }
      } catch (err) {
        console.error('Failed to load era:', err);
        toast.error('Failed to load era');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [id, isNew, isAdmin]);

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Era name is required'); return; }
    setSaving(true);
    try {
      const idToken = await getSessionToken();
      const headers = {
        'Content-Type': 'application/json',
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      };
      const payload = {
        name: form.name.trim(),
        description: form.description.trim(),
        order: Number(form.order) || 0,
        background_image_url: form.backgroundImageUrl || '',
      };
      const res = isNew
        ? await fetch('/api/admin/eras', { method: 'POST', headers, body: JSON.stringify({ id: crypto.randomUUID(), ...payload }) })
        : await fetch(`/api/admin/eras/${encodeURIComponent(id!)}`, { method: 'PATCH', headers, body: JSON.stringify(payload) });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error || `Save failed (HTTP ${res.status})`);
      }
      toast.success(isNew ? 'Era created' : 'Era updated');
      navigate('/admin/eras');
    } catch (err) {
      console.error(err);
      toast.error('Failed to save era');
    } finally {
      setSaving(false);
    }
  };

  if (!isAdmin) return <div className="text-center py-20 font-serif italic text-ink/65">Access Denied</div>;
  if (loading) return <div className="text-center py-20 font-serif italic text-ink/65">Loading era…</div>;

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-20">
      <div className="page-header">
        <Button variant="ghost" onClick={() => navigate('/admin/eras')} className="text-ink/65 hover:text-gold transition-colors rounded">
          <ChevronLeft className="w-4 h-4 mr-2" /> Back to Eras
        </Button>
        <Button onClick={handleSave} disabled={saving} className="btn-gold-solid gap-2 rounded">
          <Save className="w-4 h-4" />
          {saving ? 'Saving…' : isNew ? 'Create Era' : 'Save Changes'}
        </Button>
      </div>

      <Card className="border-gold/15 bg-card/60 shadow-xl backdrop-blur-sm rounded">
        <CardHeader>
          <CardTitle className="h2-title">{isNew ? 'New Era' : 'Edit Era'}</CardTitle>
          <p className="field-hint mt-1">A historical time period. Campaigns are grouped by era.</p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2 space-y-2">
              <label className="field-label">Era Name</label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. The Age of Ash" className="field-input font-serif text-lg h-11 rounded" />
            </div>
            <div className="space-y-2">
              <label className="field-label">Display Order</label>
              <Input type="number" value={form.order} onChange={(e) => setForm({ ...form, order: Number(e.target.value) || 0 })} className="field-input h-11 rounded" />
            </div>
          </div>

          <div className="space-y-2">
            <label className="field-label">Description</label>
            <Textarea rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="A short summary of this era." className="rounded" />
          </div>

          <div className="space-y-2 pt-2 border-t border-gold/15">
            <label className="field-label">Era Background</label>
            <p className="field-hint">Backdrop for lore pages scoped to this era. Overrides the world&apos;s; a campaign background overrides this.</p>
            <FocalImageField
              aspectClass="aspect-[16/9]"
              backdrop
              image={form.backgroundImageUrl || ''}
              overrideImageUrl={form.backgroundImageUrl || ''}
              onOverrideChange={(url) => setForm({ ...form, backgroundImageUrl: url })}
              storagePath="images/wiki/eras"
              browseRoot="images"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
