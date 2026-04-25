import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { db, OperationType, handleFirestoreError, resetFirestore } from '../../lib/firebase';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Book, Plus, ExternalLink, Edit, Search, RefreshCw, AlertTriangle, Download, ChevronDown } from 'lucide-react';
import { Input } from '../../components/ui/input';
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
    const q = query(collection(db, 'sources'), orderBy('name', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setSources(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setLoading(false);
      setError(null);
    }, (err) => {
      console.error("Raw Firestore Error in Sources:", err);
      setError(err.message);
      setLoading(false);
    });

    return () => unsubscribe();
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
          <p className="text-ink/60 font-serif italic mb-6">
            The archive is currently inaccessible. This is often caused by a corrupted local cache after a project update.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button 
              onClick={() => window.location.reload()}
              variant="outline"
              className="border-gold/20 text-gold hover:bg-gold/5"
            >
              Try Simple Refresh
            </Button>
            <Button 
              onClick={resetFirestore}
              className="btn-gold-solid gap-2"
            >
              <RefreshCw className="w-4 h-4" /> Clear Cache & Hard Reset
            </Button>
          </div>
          <p className="mt-6 text-[10px] text-ink/40 font-mono uppercase tracking-widest">
            Error: {error}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gold/20 pb-6">
        <div>
          <h1 className="h1-title">Sources & Documents</h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink/40" />
            <Input 
              placeholder="Search sources..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 bg-card/50 border-gold/10 w-64"
            />
          </div>
          {isStaff && (
            <div className="flex items-center gap-3">
              <Button 
                variant="outline"
                disabled={exporting}
                onClick={handleLibraryExport}
                className="border-gold/20 text-gold hover:bg-gold/10 gap-2"
              >
                <Download className="w-4 h-4" /> {exporting ? 'Exporting...' : 'Export for Foundry'}
              </Button>
              
              <Link to="/sources/new">
                <Button className="btn-gold-solid gap-2 shadow-lg shadow-gold/20">
                  <Plus className="w-4 h-4" /> New Source
                </Button>
              </Link>
            </div>
          )}
        </div>
      </div>

      {filteredSources.length === 0 ? (
        <div className="py-20 text-center bg-card/30 rounded-2xl border border-dashed border-gold/10">
          <Book className="w-12 h-12 text-gold mx-auto mb-4 opacity-20" />
          <p className="text-ink/40 font-serif italic">No sources found matching your search.</p>
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
                <Card className="group h-full border-gold/10 hover:border-gold/30 transition-all bg-card/40 backdrop-blur-sm overflow-hidden flex flex-col">
                  {source.imageUrl && (
                    <div className="h-48 overflow-hidden border-b border-gold/10 relative">
                      <img 
                        src={source.imageUrl} 
                        alt={source.name} 
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        referrerPolicy="no-referrer"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-card/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-4">
                        <Link to={`/sources/view/${source.id}`} className="w-full">
                          <Button variant="secondary" className="w-full bg-white/90 hover:bg-white text-ink font-serif italic">
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
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-ink/40 hover:text-gold">
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
                        <Badge key={tag} variant="outline" className="label-text border-gold/20 text-gold/70 bg-gold/5">
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
