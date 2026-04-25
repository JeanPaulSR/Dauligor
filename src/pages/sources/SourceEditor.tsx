import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db, OperationType, handleFirestoreError } from '../../lib/firebase';
import { doc, getDoc, setDoc, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import MarkdownEditor from '../../components/MarkdownEditor';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { ImageUpload } from '../../components/ui/ImageUpload';
import { ChevronLeft, Save, Trash2, Image as ImageIcon, Link as LinkIcon, Book } from 'lucide-react';
import { Checkbox } from '../../components/ui/checkbox';

const AVAILABLE_TAGS = ["Bestiary", "Classes", "Items", "Spells", "Feats"];

export default function SourceEditor({ userProfile }: { userProfile: any }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(id ? true : false);
  const [saving, setSaving] = useState(false);
  
  const [formData, setFormData] = useState({
    name: '',
    abbreviation: '',
    slug: '',
    rules: '2014',
    status: 'ready',
    description: '',
    url: '',
    imageUrl: '',
    tags: [] as string[]
  });

  const isStaff = userProfile?.role === 'admin' || userProfile?.role === 'co-dm' || userProfile?.role === 'lore-writer';

  useEffect(() => {
    if (!isStaff) {
      navigate('/sources');
      return;
    }

    if (id) {
      const fetchSource = async () => {
        try {
          const docSnap = await getDoc(doc(db, 'sources', id));
          if (docSnap.exists()) {
            const data = docSnap.data();
            setFormData({
              name: data.name || '',
              abbreviation: data.abbreviation || '',
              slug: data.slug || '',
              rules: data.rules || '2014',
              status: data.status || 'ready',
              description: data.description || '',
              url: data.url || '',
              imageUrl: data.imageUrl || '',
              tags: data.tags || []
            });
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, `sources/${id}`);
        } finally {
          setLoading(false);
        }
      };
      fetchSource();
    }
  }, [id, isStaff, navigate]);

  const handleTagToggle = (tag: string) => {
    setFormData(prev => ({
      ...prev,
      tags: prev.tags.includes(tag)
        ? prev.tags.filter(t => t !== tag)
        : [...prev.tags, tag]
    }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.description) return;

    setSaving(true);
    try {
      const sourceData = {
        ...formData,
        updatedAt: new Date().toISOString(),
        createdAt: formData.name ? (id ? undefined : new Date().toISOString()) : new Date().toISOString()
      };

      // Remove undefined fields
      Object.keys(sourceData).forEach(key => (sourceData as any)[key] === undefined && delete (sourceData as any)[key]);

      if (id) {
        await setDoc(doc(db, 'sources', id), sourceData, { merge: true });
      } else {
        const docRef = await addDoc(collection(db, 'sources'), sourceData);
        navigate(`/sources/view/${docRef.id}`);
        return;
      }
      navigate(`/sources/view/${id}`);
    } catch (error) {
      handleFirestoreError(error, id ? OperationType.UPDATE : OperationType.CREATE, 'sources');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-xl font-serif animate-pulse text-gold">Consulting the Archive...</div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto pb-20">
      <div className="mb-8 flex items-center justify-between">
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={() => navigate(id ? `/sources/view/${id}` : '/sources')}
          className="text-ink/60 hover:text-gold gap-2"
        >
          <ChevronLeft className="w-4 h-4" /> Cancel
        </Button>
        <h1 className="text-3xl font-serif font-bold text-ink">
          {id ? 'Edit Source' : 'New Source'}
        </h1>
      </div>

      <form onSubmit={handleSave} className="grid md:grid-cols-3 gap-8">
        <div className="md:col-span-2 space-y-6">
          <Card className="border-gold/10 bg-card/40 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="font-serif text-xl">Basic Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-4 gap-4">
                <div className="col-span-3 space-y-2">
                  <Label htmlFor="name">Source Name</Label>
                  <Input 
                    id="name"
                    required
                    value={formData.name}
                    onChange={e => setFormData({...formData, name: e.target.value})}
                    placeholder="e.g. Valda's Spire of Secrets"
                    className="bg-card/50 border-gold/10"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="abbreviation">Abbreviation</Label>
                  <Input 
                    id="abbreviation"
                    value={formData.abbreviation}
                    onChange={e => setFormData({...formData, abbreviation: e.target.value})}
                    placeholder="e.g. VSS"
                    className="bg-card/50 border-gold/10 uppercase"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="slug">Slug (System ID)</Label>
                  <Input 
                    id="slug"
                    required
                    value={formData.slug}
                    onChange={e => setFormData({...formData, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-')})}
                    placeholder="e.g. players-handbook"
                    className="bg-card/50 border-gold/10"
                  />
                  <p className="text-[10px] text-ink/40 font-serif italic">Permanent URL/Export key. Use lowercase and hyphens.</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="rules">Rules Version</Label>
                  <select 
                    id="rules"
                    value={formData.rules}
                    onChange={e => setFormData({...formData, rules: e.target.value})}
                    className="w-full h-10 px-3 py-2 bg-card/50 border border-gold/10 rounded-md text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="2014">2014 Core</option>
                    <option value="2024">2024 Core</option>
                    <option value="universal">Universal / Homebrew</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="status">Ready Status</Label>
                  <select 
                    id="status"
                    value={formData.status}
                    onChange={e => setFormData({...formData, status: e.target.value})}
                    className="w-full h-10 px-3 py-2 bg-card/50 border border-gold/10 rounded-md text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="ready">Ready (Visible in Library)</option>
                    <option value="draft">Draft (Staff Only)</option>
                    <option value="retired">Retired / Archived</option>
                  </select>
                </div>
              </div>

              <MarkdownEditor 
                value={formData.description}
                onChange={val => setFormData({...formData, description: val})}
                placeholder="Describe the source book or document..."
                minHeight="300px"
                label="Description"
              />
            </CardContent>
          </Card>

          <Card className="border-gold/10 bg-card/40 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="font-serif text-xl">External Links</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="url" className="flex items-center gap-2">
                  <LinkIcon className="w-3 h-3 text-gold" /> Webpage URL
                </Label>
                <Input 
                  id="url"
                  type="url"
                  value={formData.url}
                  onChange={e => setFormData({...formData, url: e.target.value})}
                  placeholder="https://..."
                  className="bg-card/50 border-gold/10"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="imageUrl" className="flex items-center gap-2">
                  <ImageIcon className="w-3 h-3 text-gold" /> Cover Image
                </Label>
                <ImageUpload 
                  currentImageUrl={formData.imageUrl}
                  storagePath={`images/sources/${id || 'new'}/`}
                  onUpload={(url) => setFormData({...formData, imageUrl: url})}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="border-gold/10 bg-card/40 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="font-serif text-xl">Content Tags</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-3">
                {AVAILABLE_TAGS.map(tag => (
                  <div key={tag} className="flex items-center space-x-2">
                    <Checkbox 
                      id={`tag-${tag}`} 
                      checked={formData.tags.includes(tag)}
                      onCheckedChange={() => handleTagToggle(tag)}
                    />
                    <Label 
                      htmlFor={`tag-${tag}`}
                      className="text-sm font-serif italic cursor-pointer"
                    >
                      {tag}
                    </Label>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="space-y-3">
            <Button 
              type="submit" 
              disabled={saving}
              className="w-full btn-gold-solid gap-2 py-6 text-lg shadow-xl shadow-gold/20"
            >
              <Save className="w-5 h-5" /> {saving ? 'Saving...' : 'Save Source'}
            </Button>
            
            {id && (
              <Button 
                type="button" 
                variant="ghost" 
                className="w-full text-blood hover:bg-blood/5 gap-2"
                onClick={() => {/* Add delete logic if needed */}}
              >
                <Trash2 className="w-4 h-4" /> Delete Source
              </Button>
            )}
          </div>

          {/* Preview Card */}
          <div className="pt-4">
            <Label className="text-[10px] uppercase tracking-widest font-bold text-gold/60 mb-2 block">Cover Preview</Label>
            <div className="aspect-[3/4] rounded-lg border border-gold/10 bg-card overflow-hidden flex items-center justify-center text-gold/10">
              {formData.imageUrl ? (
                <img src={formData.imageUrl} alt="Preview" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <Book className="w-12 h-12" />
              )}
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
