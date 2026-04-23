import React, { useState, useEffect } from 'react';
import { db, OperationType, handleFirestoreError } from '../../lib/firebase';
import { collection, onSnapshot, query, where, addDoc, deleteDoc, doc, getDocs } from 'firebase/firestore';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { MapPin, Info, Plus, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';

export default function Map({ userProfile }: { userProfile: any }) {
  const [markers, setMarkers] = useState<any[]>([]);
  const [selectedMarker, setSelectedMarker] = useState<any>(null);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newMarker, setNewMarker] = useState({ title: '', category: 'location', x: 50, y: 50 });

  useEffect(() => {
    const isStaff = userProfile?.role === 'admin' || userProfile?.role === 'co-dm' || userProfile?.role === 'lore-writer';
    let q;
    if (isStaff) {
      q = query(collection(db, 'lore'), where('mapCoordinates', '!=', null));
    } else {
      q = query(collection(db, 'lore'), where('mapCoordinates', '!=', null), where('status', '==', 'published'));
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      setMarkers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'lore');
    });
    return () => unsubscribe();
  }, [userProfile?.role]);

  const handleMapClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (userProfile?.role !== 'admin') return;
    
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    
    setNewMarker({ ...newMarker, x, y });
    setIsAddOpen(true);
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-serif font-bold text-ink">Interactive Map</h1>
        <p className="text-ink/60">Explore the world of your campaign. {userProfile?.role === 'admin' && 'Click anywhere to add a landmark.'}</p>
      </div>

      <div className="grid lg:grid-cols-4 gap-8">
        <div className="lg:col-span-3">
          <div className="map-container cursor-crosshair" onClick={handleMapClick}>
            {/* Placeholder Map Background */}
            <div className="absolute inset-0 bg-[url('https://picsum.photos/seed/map/1200/800')] bg-cover bg-center opacity-40 grayscale" />
            <div className="absolute inset-0 bg-gold/5 mix-blend-multiply" />
            
            {/* Grid overlay for texture */}
            <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle, #000 1px, transparent 1px)', backgroundSize: '20px 20px' }} />

            {markers.map(marker => (
              <div
                key={marker.id}
                className="map-marker group"
                style={{ left: `${marker.mapCoordinates.x}%`, top: `${marker.mapCoordinates.y}%` }}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedMarker(marker);
                }}
              >
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block bg-ink text-white text-[10px] px-2 py-1 rounded whitespace-nowrap z-10">
                  {marker.title}
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
                  <h3 className="text-xl font-serif font-bold">{selectedMarker.title}</h3>
                  <Badge className="bg-gold/10 text-gold hover:bg-gold/10 capitalize">
                    {selectedMarker.category}
                  </Badge>
                  <p className="text-sm text-ink/70 leading-relaxed line-clamp-6">
                    {selectedMarker.content}
                  </p>
                  <Button variant="outline" className="w-full border-gold text-gold hover:bg-gold/5" render={
                    <a href={`/wiki?id=${selectedMarker.id}`}>Read Full Lore</a>
                  } />
                </div>
              ) : (
                <p className="text-sm text-ink/40 italic text-center py-10">
                  Select a marker on the map to view details.
                </p>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>

      {/* Add Marker Dialog */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">Add Landmark</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Landmark Name</label>
              <Input value={newMarker.title} onChange={e => setNewMarker({...newMarker, title: e.target.value})} placeholder="e.g. The Whispering Woods" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Category</label>
              <select 
                className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                value={newMarker.category}
                onChange={e => setNewMarker({...newMarker, category: e.target.value})}
              >
                <option value="location">Location</option>
                <option value="character">Character</option>
                <option value="history">History</option>
              </select>
            </div>
            <p className="text-xs text-ink/40">Coordinates: {newMarker.x.toFixed(1)}%, {newMarker.y.toFixed(1)}%</p>
            <Button className="w-full bg-gold text-white" onClick={async () => {
              try {
                await addDoc(collection(db, 'lore'), {
                  title: newMarker.title,
                  category: newMarker.category,
                  content: 'New landmark discovered. Lore details pending...',
                  mapCoordinates: { x: newMarker.x, y: newMarker.y },
                  status: 'published',
                  updatedAt: new Date().toISOString(),
                  createdAt: new Date().toISOString()
                });
                setIsAddOpen(false);
              } catch (error) {
                handleFirestoreError(error, OperationType.CREATE, 'lore');
              }
            }}>Create Landmark</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
