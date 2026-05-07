import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { fetchCollection, fetchDocument, upsertDocument, deleteDocument, queryD1 } from '../../lib/d1';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Info, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';

/**
 * Interactive Map (Phase B).
 * - Maps are era-scoped. The active campaign in the navbar selects the era.
 * - Pins (map_markers) are points placed by admins/GMs; each can optionally
 *   reference a lore article. Empty pins are allowed as placeholders.
 * - Highlights (map_highlights) are regions; rendered visually here but the
 *   click-and-drag drawing UI is intentionally out of scope for this round.
 *
 * TODO (highlight authoring UI):
 *   - Admin "Add Highlight" mode that captures rect (x,y,width,height) on map
 *   - Edit highlight label / target article / target child map
 *   - Delete highlight
 *   - Eventually: shape='circle', shape='polygon' with point-list authoring
 *   See worker/migrations/0017_map_markers.sql for the schema this hooks up to.
 */

const ACTIVE_MAP_KEY_PREFIX = 'dauligor:activeMapId:';

interface MapRecord {
  id: string;
  identifier: string;
  name: string;
  description: string | null;
  background_image_url: string | null;
  era_id: string;
  parent_marker_id: string | null;
  parent_highlight_id: string | null;
}

interface MarkerRecord {
  id: string;
  map_id: string;
  article_id: string | null;
  article_title: string | null;
  article_status: string | null;
  x: number;
  y: number;
  label: string | null;
  icon: string | null;
}

interface HighlightRecord {
  id: string;
  map_id: string;
  article_id: string | null;
  article_title: string | null;
  child_map_id: string | null;
  child_map_name: string | null;
  shape: string;
  x: number;
  y: number;
  width: number | null;
  height: number | null;
  label: string | null;
}

export default function Map({ userProfile }: { userProfile: any }) {
  const isAdmin = userProfile?.role === 'admin' || userProfile?.role === 'co-dm' || userProfile?.role === 'lore-writer';
  const activeCampaignId = userProfile?.activeCampaignId ?? userProfile?.active_campaign_id ?? null;

  const [eraId, setEraId] = useState<string | null>(null);
  const [maps, setMaps] = useState<MapRecord[]>([]);
  const [selectedMapId, setSelectedMapId] = useState<string | null>(null);
  const [markers, setMarkers] = useState<MarkerRecord[]>([]);
  const [highlights, setHighlights] = useState<HighlightRecord[]>([]);
  const [selectedMarker, setSelectedMarker] = useState<MarkerRecord | null>(null);
  const [selectedHighlight, setSelectedHighlight] = useState<HighlightRecord | null>(null);

  const [allArticles, setAllArticles] = useState<Array<{ id: string; title: string }>>([]);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newPin, setNewPin] = useState({ x: 50, y: 50, articleId: '', label: '' });
  const [refreshTick, setRefreshTick] = useState(0);

  const selectedMap = useMemo(() => maps.find(m => m.id === selectedMapId) || null, [maps, selectedMapId]);

  // 1. Resolve the active campaign's era.
  useEffect(() => {
    let cancelled = false;
    if (!activeCampaignId) { setEraId(null); return; }
    (async () => {
      try {
        const camp = await fetchDocument<any>('campaigns', activeCampaignId);
        if (cancelled) return;
        setEraId(camp?.era_id ?? null);
      } catch (err) {
        console.error('Failed to load active campaign:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [activeCampaignId]);

  // 2. Load maps available for that era. Also load all articles (for the picker dropdown).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!eraId) { setMaps([]); return; }
        const rows = await fetchCollection<MapRecord>('maps', {
          where: 'era_id = ?',
          params: [eraId],
          orderBy: 'name ASC',
        });
        if (cancelled) return;
        setMaps(rows);

        // Restore last-viewed map for this era from localStorage, else pick first.
        const stored = localStorage.getItem(ACTIVE_MAP_KEY_PREFIX + eraId);
        const valid = rows.find(m => m.id === stored)?.id ?? rows[0]?.id ?? null;
        setSelectedMapId(valid);
      } catch (err) {
        console.error('Failed to load maps:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [eraId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await fetchCollection<{ id: string; title: string }>('lore', {
          select: 'id, title',
          orderBy: 'title ASC',
        });
        if (!cancelled) setAllArticles(rows);
      } catch (err) {
        console.error('Failed to load articles list:', err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // 3. Persist selectedMapId per era.
  useEffect(() => {
    if (eraId && selectedMapId) {
      localStorage.setItem(ACTIVE_MAP_KEY_PREFIX + eraId, selectedMapId);
    }
  }, [eraId, selectedMapId]);

  // 4. Load markers + highlights for the current map. JOIN with lore_articles
  //    (and child maps) so the side panel can show titles without extra queries.
  const loadMarkersAndHighlights = useCallback(async () => {
    if (!selectedMapId) { setMarkers([]); setHighlights([]); return; }
    try {
      const markerRows = await queryD1<any>(
        `SELECT m.id, m.map_id, m.article_id, m.x, m.y, m.label, m.icon,
                a.title AS article_title, a.status AS article_status
         FROM map_markers m
         LEFT JOIN lore_articles a ON a.id = m.article_id
         WHERE m.map_id = ?`,
        [selectedMapId]
      );
      const filteredMarkers = isAdmin
        ? markerRows
        : markerRows.filter((r: any) => !r.article_id || r.article_status === 'published');
      setMarkers(filteredMarkers as MarkerRecord[]);

      const highlightRows = await queryD1<any>(
        `SELECT h.id, h.map_id, h.article_id, h.child_map_id, h.shape,
                h.x, h.y, h.width, h.height, h.label,
                a.title AS article_title,
                cm.name AS child_map_name
         FROM map_highlights h
         LEFT JOIN lore_articles a ON a.id = h.article_id
         LEFT JOIN maps cm ON cm.id = h.child_map_id
         WHERE h.map_id = ?`,
        [selectedMapId]
      );
      setHighlights(highlightRows as HighlightRecord[]);
    } catch (err) {
      console.error('Failed to load markers/highlights:', err);
    }
  }, [selectedMapId, isAdmin]);

  useEffect(() => {
    loadMarkersAndHighlights();
  }, [loadMarkersAndHighlights, refreshTick]);

  // ─── Admin actions ──────────────────────────────────────────────────────

  const handleMapClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isAdmin || !selectedMapId) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setNewPin({ x, y, articleId: '', label: '' });
    setIsAddOpen(true);
  };

  const handleCreatePin = async () => {
    if (!selectedMapId) return;
    try {
      const id = crypto.randomUUID();
      await upsertDocument('mapMarkers', id, {
        map_id: selectedMapId,
        article_id: newPin.articleId || null,
        x: newPin.x,
        y: newPin.y,
        label: newPin.label || null,
      });
      setIsAddOpen(false);
      setNewPin({ x: 50, y: 50, articleId: '', label: '' });
      setRefreshTick(t => t + 1);
    } catch (err) {
      console.error('Failed to create pin:', err);
    }
  };

  const handleDeletePin = async (markerId: string) => {
    try {
      await deleteDocument('mapMarkers', markerId);
      setSelectedMarker(null);
      setRefreshTick(t => t + 1);
    } catch (err) {
      console.error('Failed to delete pin:', err);
    }
  };

  // ─── Render ─────────────────────────────────────────────────────────────

  if (!activeCampaignId) {
    return (
      <div className="space-y-4 max-w-xl">
        <h1 className="text-4xl font-serif font-bold text-ink">Interactive Map</h1>
        <p className="text-ink/60 italic">Select a campaign in the navbar to view its world maps.</p>
      </div>
    );
  }

  if (!eraId) {
    return (
      <div className="space-y-4 max-w-xl">
        <h1 className="text-4xl font-serif font-bold text-ink">Interactive Map</h1>
        <p className="text-ink/60 italic">The active campaign has no era assigned, so no maps are available.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-4xl font-serif font-bold text-ink">Interactive Map</h1>
          <p className="text-ink/60">
            Explore the world of your campaign.
            {isAdmin && selectedMap && ' Click anywhere on the map to drop a pin.'}
          </p>
        </div>

        {maps.length > 0 && (
          <div className="space-y-1">
            <label className="text-xs font-medium uppercase tracking-widest text-ink/50">Map</label>
            <select
              className="h-10 px-3 rounded-md border border-input bg-background text-sm min-w-[14rem]"
              value={selectedMapId || ''}
              onChange={(e) => setSelectedMapId(e.target.value)}
            >
              {maps.map(m => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {maps.length === 0 ? (
        <p className="text-ink/40 italic">No maps available for this era yet.</p>
      ) : !selectedMap ? (
        <p className="text-ink/40 italic">Pick a map to begin.</p>
      ) : (
        <div className="grid lg:grid-cols-4 gap-8">
          <div className="lg:col-span-3">
            <div
              className={`map-container ${isAdmin ? 'cursor-crosshair' : 'cursor-default'}`}
              onClick={handleMapClick}
            >
              {/* Background — fall back to a placeholder until a real map image is uploaded */}
              <div
                className="absolute inset-0 bg-cover bg-center opacity-50"
                style={{
                  backgroundImage: `url('${selectedMap.background_image_url || 'https://picsum.photos/seed/map/1200/800'}')`,
                  filter: selectedMap.background_image_url ? 'none' : 'grayscale(1)',
                }}
              />
              <div className="absolute inset-0 bg-gold/5 mix-blend-multiply" />
              <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle, #000 1px, transparent 1px)', backgroundSize: '20px 20px' }} />

              {/* Highlights — visible regions (no edit UI yet) */}
              {highlights.map(h => (
                <div
                  key={h.id}
                  className="absolute border-2 border-gold/40 bg-gold/10 hover:bg-gold/20 transition pointer-events-auto cursor-pointer"
                  style={{
                    left: `${h.x}%`,
                    top: `${h.y}%`,
                    width: `${h.width ?? 0}%`,
                    height: `${h.height ?? 0}%`,
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedHighlight(h);
                    setSelectedMarker(null);
                  }}
                >
                  {h.label && (
                    <div className="absolute -top-6 left-0 hidden group-hover:block bg-ink text-white text-[10px] px-2 py-0.5 rounded whitespace-nowrap">
                      {h.label}
                    </div>
                  )}
                </div>
              ))}

              {/* Pins */}
              {markers.map(marker => (
                <div
                  key={marker.id}
                  className="map-marker group"
                  style={{ left: `${marker.x}%`, top: `${marker.y}%` }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedMarker(marker);
                    setSelectedHighlight(null);
                  }}
                >
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block bg-ink text-white text-[10px] px-2 py-1 rounded whitespace-nowrap z-10">
                    {marker.label || marker.article_title || 'Unnamed pin'}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <aside className="space-y-6">
            <Card className="border-gold/20">
              <CardHeader>
                <CardTitle className="font-serif flex items-center gap-2">
                  <Info className="w-5 h-5 text-gold" /> Details
                </CardTitle>
              </CardHeader>
              <CardContent>
                {selectedMarker ? (
                  <div className="space-y-4">
                    <h3 className="text-xl font-serif font-bold">
                      {selectedMarker.label || selectedMarker.article_title || 'Unnamed pin'}
                    </h3>
                    {selectedMarker.article_title ? (
                      <>
                        <Badge className="bg-gold/10 text-gold hover:bg-gold/10">Article</Badge>
                        <Button variant="outline" className="w-full border-gold text-gold hover:bg-gold/5" render={
                          <a href={`/wiki?id=${selectedMarker.article_id}`}>Read Full Lore</a>
                        } />
                      </>
                    ) : (
                      <p className="text-sm text-ink/40 italic">This pin has no article linked yet.</p>
                    )}
                    {isAdmin && (
                      <Button
                        variant="outline"
                        className="w-full border-blood/40 text-blood hover:bg-blood/5 gap-2"
                        onClick={() => handleDeletePin(selectedMarker.id)}
                      >
                        <Trash2 className="w-4 h-4" /> Delete Pin (article kept)
                      </Button>
                    )}
                  </div>
                ) : selectedHighlight ? (
                  <div className="space-y-4">
                    <h3 className="text-xl font-serif font-bold">
                      {selectedHighlight.label || selectedHighlight.article_title || selectedHighlight.child_map_name || 'Highlighted area'}
                    </h3>
                    {selectedHighlight.article_title && (
                      <Button variant="outline" className="w-full border-gold text-gold hover:bg-gold/5" render={
                        <a href={`/wiki?id=${selectedHighlight.article_id}`}>Read Full Lore</a>
                      } />
                    )}
                    {selectedHighlight.child_map_id && (
                      <Button
                        variant="outline"
                        className="w-full border-gold text-gold hover:bg-gold/5"
                        onClick={() => {
                          setSelectedMapId(selectedHighlight.child_map_id);
                          setSelectedHighlight(null);
                        }}
                      >
                        Travel to {selectedHighlight.child_map_name || 'submap'}
                      </Button>
                    )}
                    {!selectedHighlight.article_title && !selectedHighlight.child_map_id && (
                      <p className="text-sm text-ink/40 italic">This region has no link yet.</p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-ink/40 italic text-center py-10">
                    Select a pin or highlight to view details.
                  </p>
                )}
              </CardContent>
            </Card>
          </aside>
        </div>
      )}

      {/* Add Pin Dialog */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">Add Pin</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Label (optional)</label>
              <Input
                value={newPin.label}
                onChange={e => setNewPin({ ...newPin, label: e.target.value })}
                placeholder="e.g. The Whispering Woods"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Linked Article (optional)</label>
              <select
                className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                value={newPin.articleId}
                onChange={e => setNewPin({ ...newPin, articleId: e.target.value })}
              >
                <option value="">— No article (placeholder) —</option>
                {allArticles.map(a => (
                  <option key={a.id} value={a.id}>{a.title}</option>
                ))}
              </select>
              <p className="text-[10px] text-ink/40 italic">
                Leave blank to drop a placeholder pin you can link later.
              </p>
            </div>
            <p className="text-xs text-ink/40">Coordinates: {newPin.x.toFixed(1)}%, {newPin.y.toFixed(1)}%</p>
            <Button className="w-full bg-gold text-white" onClick={handleCreatePin}>
              Create Pin
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
