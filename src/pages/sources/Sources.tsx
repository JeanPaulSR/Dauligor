import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Book, Plus, ExternalLink, Edit, RefreshCw, AlertTriangle, Download, ChevronDown } from 'lucide-react';
import { fetchCollection } from '../../lib/d1';
import { Input } from '../../components/ui/input';
import { SearchInput } from '../../components/ui/SearchInput';

// Page reload helper for the "rebuild cache" buttons. Replaces the historical
// `resetFirestore()` which existed to clear Firestore's IndexedDB cache; with
// Firestore gone, a plain reload achieves the same intent.
const reloadPage = () => window.location.reload();
import { motion, AnimatePresence } from 'motion/react';
import { exportFullSourceLibrary, exportRawLibraryCatalogJSON } from '../../lib/classExport';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { toast } from 'sonner';

export default function Sources({ userProfile }: { userProfile: any }) {
  const [sources, setSources] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [exporting, setExporting] = useState(false);
  const navigate = useNavigate();

  const isStaff = userProfile?.role === 'admin' || userProfile?.role === 'co-dm' || userProfile?.role === 'lore-writer';

  const handleLibraryExport = async () => {
    if (!isStaff) return;
    setExporting(true);
    const toastId = toast.loading("Generating full library export...");
    try {
      await exportFullSourceLibrary(true);
      toast.success("Full library exported!", { id: toastId });
    } catch (error) {
      console.error("Export failed:", error);
      toast.error("Failed to generate library export.", { id: toastId });
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    const loadSources = async () => {
      try {
        const data = await fetchCollection('sources', { orderBy: 'name ASC' });
        
        setSources(data);
        setLoading(false);
        setError(null);
      } catch (err: any) {
        console.error("Error loading sources:", err);
        setError(err.message);
        setLoading(false);
      }
    };
    loadSources();
  }, []);

  const filteredSources = sources.filter(s => 
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.tags?.some((t: string) => t.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-xl font-serif animate-pulse text-gold">Consulting the Archive...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto py-20 text-center space-y-6">
        <div className="bg-blood/10 p-6 rounded-2xl border border-blood/20">
          <AlertTriangle className="w-12 h-12 text-blood mx-auto mb-4" />
          <h2 className="text-2xl font-serif font-bold text-blood mb-2">Archive Connection Error</h2>
          <p className="text-ink/65 font-serif italic mb-6">
            The archive is currently inaccessible. This is often caused by a corrupted local cache after a project update.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button 
              onClick={() => window.location.reload()}
              variant="outline"
              className="border-gold/25 text-gold hover:bg-gold/5"
            >
              Try Simple Refresh
            </Button>
            <Button 
              onClick={reloadPage}
              className="btn-gold-solid gap-2"
            >
              <RefreshCw className="w-4 h-4" /> Clear Cache & Hard Reset
            </Button>
          </div>
          <p className="mt-6 text-[10px] text-ink/45 font-mono uppercase tracking-widest">
            Error: {error}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gold/25 pb-6">
        <div className="flex items-center gap-4">
          <h1 className="h1-title">Sources & Documents</h1>
        </div>
        <div className="flex items-center gap-3">
          <SearchInput
            placeholder="Search sources..."
            value={searchQuery}
            onChange={setSearchQuery}
            wrapperClassName="w-64"
            className="bg-card/50"
          />
          {isStaff && (
            <div className="flex items-center gap-3">
              <Button 
                variant="outline"
                disabled={exporting}
                onClick={handleLibraryExport}
                className="border-gold/25 text-gold hover:bg-gold/15 gap-2"
              >
                <Download className="w-4 h-4" /> {exporting ? 'Exporting...' : 'Export for Foundry'}
              </Button>
              
              <Button 
                variant="ghost" 
                size="icon"
                onClick={reloadPage}
                title="Clear Cache & Hard Reset"
                className="text-gold/45 hover:text-gold hover:bg-gold/15"
              >
                <RefreshCw className="w-4 h-4" />
              </Button>

              <Link to="/sources/new">
                <Button className="btn-gold-solid gap-2 shadow-lg shadow-gold/25">
                  <Plus className="w-4 h-4" /> New Source
                </Button>
              </Link>
            </div>
          )}
        </div>
      </div>

      {filteredSources.length === 0 ? (
        <div className="py-20 text-center bg-card/30 rounded-2xl border border-dashed border-gold/15">
          <Book className="w-12 h-12 text-gold mx-auto mb-4 opacity-20" />
          <p className="text-ink/45 font-serif italic">No sources found matching your search.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <AnimatePresence mode="popLayout">
            {filteredSources.map((source, index) => (
              <motion.div
                key={source.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                layout
              >
                <Card className="group h-full border-gold/15 hover:border-gold/35 transition-all bg-card/40 backdrop-blur-sm overflow-hidden flex flex-col">
                  {source.imageUrl && (
                    <div className="h-48 overflow-hidden border-b border-gold/15 relative">
                      <img 
                        src={source.imageUrl} 
                        alt={source.name} 
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        referrerPolicy="no-referrer"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-card/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-4">
                        <Link to={`/sources/view/${source.id}`} className="w-full">
                          <Button variant="secondary" className="w-full bg-card/90 hover:bg-card text-ink font-serif italic">
                            View Details
                          </Button>
                        </Link>
                      </div>
                    </div>
                  )}
                  <CardHeader className="p-5 pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="h3-title group-hover:text-gold transition-colors leading-tight">
                        <Link to={`/sources/view/${source.id}`}>{source.name}</Link>
                      </CardTitle>
                      {isStaff && (
                        <Link to={`/sources/edit/${source.id}`}>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-ink/45 hover:text-gold">
                            <Edit className="w-4 h-4" />
                          </Button>
                        </Link>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="p-5 pt-0 flex-grow flex flex-col">
                    <p className="description-text text-sm line-clamp-3 mb-4">
                      {source.description?.replace(/[#*`]/g, '').substring(0, 120)}...
                    </p>
                    <div className="mt-auto pt-4 flex flex-wrap gap-1.5">
                      {source.tags?.map((tag: string) => (
                        <Badge key={tag} variant="outline" className="label-text border-gold/25 text-gold/75 bg-gold/5">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
