import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { ChevronLeft, ExternalLink, Edit, Book, Calendar, Clock, Tag, Sword, Download, ChevronDown, Database, CloudOff } from 'lucide-react';
import { fetchDocument, fetchCollection } from '../../lib/d1';
import BBCodeRenderer from '../../components/BBCodeRenderer';
import { motion } from 'motion/react';
import { exportSourceForFoundry, exportRawSourceJSON } from '../../lib/classExport';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { toast } from 'sonner';

export default function SourceDetail({ userProfile }: { userProfile: any }) {
  const { id } = useParams();
  const [source, setSource] = useState<any>(null);
  const [linkedClasses, setLinkedClasses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const navigate = useNavigate();
  const [isUsingD1, setIsUsingD1] = useState(false);

  const isStaff = userProfile?.role === 'admin' || userProfile?.role === 'co-dm' || userProfile?.role === 'lore-writer';

  const handleExport = async () => {
    if (!source || !isStaff) return;
    setExporting(true);
    const toastId = toast.loading("Generating source bundle...");
    try {
      await exportSourceForFoundry(source.id, true);
      toast.success("Source bundle exported!", { id: toastId });
    } catch (error) {
      console.error("Export failed:", error);
      toast.error("Failed to generate export bundle.", { id: toastId });
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    if (!id) return;

    const loadSourceData = async () => {
      try {
        const sourceData = await fetchDocument('sources', id);

        if (sourceData) {
          setSource(sourceData);
          
          const classesData = await fetchCollection('classes', { 
            where: `source_id = ?`, 
            params: [id], 
            orderBy: 'name ASC' 
          });
          
          setLinkedClasses(classesData);
          setIsUsingD1(true);
        } else {
          setSource(null);
        }
        setLoading(false);
      } catch (error) {
        console.error("Error loading source detail:", error);
        setLoading(false);
        setIsUsingD1(false);
      }
    };

    loadSourceData();
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-xl font-serif animate-pulse text-gold">Consulting the Archive...</div>
      </div>
    );
  }

  if (!source) {
    return (
      <div className="max-w-4xl mx-auto text-center py-20">
        <h2 className="text-3xl font-serif text-ink mb-4">Source Not Found</h2>
        <p className="text-ink/60 mb-8 italic">This document appears to have been lost to time or never existed.</p>
        <Link to="/sources">
          <Button variant="outline" className="border-gold text-gold">
            Return to Sources
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto pb-20">
      <div className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => navigate('/sources')}
            className="text-ink/60 hover:text-gold gap-2"
          >
            <ChevronLeft className="w-4 h-4" /> Back to Sources
          </Button>
          {isUsingD1 ? (
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
              <Database className="w-3.5 h-3.5 text-emerald-500" />
              <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest">D1 Linked</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20">
              <CloudOff className="w-3.5 h-3.5 text-amber-500" />
              <span className="text-[10px] font-bold text-amber-500 uppercase tracking-widest">Legacy Firebase</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          {isStaff && (
            <>
              <Button 
                variant="outline"
                size="sm"
                disabled={exporting}
                onClick={handleExport}
                className="border-gold/20 text-gold hover:bg-gold/10 gap-2"
              >
                <Download className="w-4 h-4" /> {exporting ? 'Exporting...' : 'Export for Foundry'}
              </Button>

              <Link to={`/sources/edit/${source.id}`}>
                <Button variant="outline" size="sm" className="border-gold/20 text-gold hover:bg-gold/5 gap-2">
                  <Edit className="w-4 h-4" /> Edit Source
                </Button>
              </Link>
            </>
          )}
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-12">
        {/* Sidebar / Cover */}
        <div className="space-y-8">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="aspect-[3/4] rounded-xl overflow-hidden shadow-2xl border border-gold/20 bg-card"
          >
            {source.imageUrl ? (
              <img 
                src={source.imageUrl} 
                alt={source.name} 
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center text-gold/20 p-8 text-center">
                <Book className="w-16 h-16 mb-4" />
                <span className="font-serif italic text-sm">No cover image available</span>
              </div>
            )}
          </motion.div>

          <div className="space-y-6 bg-card/40 p-6 rounded-xl border border-gold/10 backdrop-blur-sm">
            <div className="space-y-1">
              <h4 className="label-text text-gold/60">Content Tags</h4>
              <div className="flex flex-wrap gap-2 pt-1">
                {source.tags?.length > 0 ? source.tags.map((tag: string) => (
                  <Badge key={tag} variant="outline" className="bg-gold/5 border-gold/20 text-gold label-text">
                    {tag}
                  </Badge>
                )) : (
                  <span className="muted-text italic">No tags assigned</span>
                )}
              </div>
            </div>

            {(source.external_url || source.url) && (
              <div className="pt-4 border-t border-gold/10">
                <a 
                  href={source.external_url || source.url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="w-full"
                >
                  <Button className="w-full btn-gold-solid gap-2">
                    <ExternalLink className="w-4 h-4" /> Visit Webpage
                  </Button>
                </a>
              </div>
            )}

            <div className="pt-4 border-t border-gold/10 space-y-3">
              <div className="flex items-center gap-2 text-xs text-ink/60">
                <Calendar className="w-3.5 h-3.5 text-gold/60" />
                <span>Added: {new Date(source.createdAt).toLocaleDateString()}</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-ink/60">
                <Clock className="w-3.5 h-3.5 text-gold/60" />
                <span>Updated: {new Date(source.updatedAt).toLocaleDateString()}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="md:col-span-2 space-y-8">
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
          >
            <h1 className="h1-title leading-tight mb-4">
              {source.name}
            </h1>
            <div className="h-1 w-20 bg-gold rounded-full mb-8" />
            
            <BBCodeRenderer content={source.description} />
          </motion.div>

          {/* Linked Content */}
          <div className="pt-12 border-t border-gold/10">
            <h3 className="h3-title mb-6 flex items-center gap-2">
              <Tag className="w-5 h-5 text-gold" /> Linked Content
            </h3>
            
            <div className="space-y-8">
              {/* Classes Section */}
              <div className="space-y-4">
                <h4 className="label-text text-gold/60 flex items-center gap-2">
                  <Sword className="w-3 h-3" /> Classes ({linkedClasses.length})
                </h4>
                {linkedClasses.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {linkedClasses.map(cls => (
                      <Link key={cls.id} to={`/compendium/classes/view/${cls.id}`}>
                        <div className="p-3 rounded-lg bg-card/30 border border-gold/10 hover:border-gold/30 hover:bg-gold/5 transition-all flex items-center justify-between group">
                          <span className="h3-title text-lg group-hover:text-gold transition-colors">{cls.name}</span>
                          <Badge variant="outline" className="label-text h-4 px-1.5 border-gold/10">View</Badge>
                        </div>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <p className="muted-text italic">No classes linked to this source yet.</p>
                )}
              </div>

              {/* Other Placeholders */}
              <div className="grid grid-cols-2 gap-4">
                {['Spells', 'Items', 'Bestiary'].map(type => (
                  <div key={type} className="p-4 rounded-lg bg-card/20 border border-dashed border-gold/10 flex items-center justify-between group cursor-not-allowed opacity-50">
                    <span className="font-serif italic text-ink/60">{type}</span>
                    <Badge variant="outline" className="text-[8px] uppercase tracking-tighter">Coming Soon</Badge>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
