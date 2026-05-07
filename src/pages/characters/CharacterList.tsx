import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { Plus, User, Shield, Sparkles, BookOpen, Book } from 'lucide-react';
import { queryD1 } from '../../lib/d1';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from '../../components/ui/dialog';

export default function CharacterList({ userProfile }: { userProfile: any }) {
  const [characters, setCharacters] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const isStaff = ['admin', 'co-dm', 'lore-writer'].includes(userProfile?.role);

  useEffect(() => {
    if (!userProfile?.id) return;

    const loadCharacters = async () => {
      try {
        let sql = "SELECT * FROM characters";
        let params: any[] = [];

        if (!isStaff) {
          sql += " WHERE user_id = ?";
          params = [userProfile.id];
        }
        
        sql += " ORDER BY updated_at DESC";
        
        const results = await queryD1<any>(sql, params);
        setCharacters(results);
      } catch (error) {
        console.error("Error loading characters from D1:", error);
      } finally {
        setLoading(false);
      }
    };

    loadCharacters();
  }, [userProfile?.id, isStaff]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-20">
        <div className="text-xl font-serif text-gold animate-pulse">Loading Characters...</div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-20">
      <div className="section-header">
        <div className="flex items-center gap-4">
          <User className="w-8 h-8 text-gold" />
          <div>
            <h1 className="text-3xl font-serif font-bold text-ink uppercase tracking-tight">Characters</h1>
            {isStaff && <p className="text-sm text-ink/60 font-bold tracking-widest uppercase">Archive Administration View</p>}
          </div>
        </div>
        <Dialog>
          <DialogTrigger render={<Button className="btn-gold-solid gap-2 font-bold uppercase tracking-widest text-xs h-10 px-6 ring-offset-background">
            <Plus className="w-4 h-4" /> Create Character
          </Button>} />
          <DialogContent className="sm:max-w-5xl bg-background border-gold/30 p-0 shadow-2xl overflow-hidden rounded-xl">
            <div className="bg-gold/5 border-b border-gold/10 p-4 sm:p-6 transition-all">
              <DialogHeader>
                <DialogTitle className="text-2xl sm:text-3xl font-serif font-black text-gold uppercase text-center tracking-tighter italic">
                  Character Creation Options
                </DialogTitle>
              </DialogHeader>
            </div>

            <div className="p-4 sm:p-6 md:p-8 space-y-4">
              <p className="text-center text-ink/60 font-serif translate-y-[-5px] sm:translate-y-[-10px] italic text-xs sm:text-sm px-4">
                Choose the method that best suits your familiarity with character options in Dauligor.
              </p>

              <div className="grid grid-cols-1 gap-4">
                {/* Manual */}
                <div 
                  onClick={() => navigate('/characters/new')}
                  className="p-4 sm:p-6 border border-gold/20 bg-card/40 rounded-lg relative group flex flex-col sm:flex-row items-center sm:items-start gap-4 sm:gap-8 transition-all hover:bg-gold/10 cursor-pointer hover:border-gold/50 shadow-sm min-h-[100px] sm:min-h-[140px] text-center sm:text-left"
                >
                  <div className="w-16 h-16 sm:w-20 sm:h-20 flex-shrink-0 bg-gold/10 rounded-lg flex items-center justify-center border border-gold/20 text-gold shadow-sm group-hover:scale-105 transition-transform duration-500">
                    <User className="w-8 h-8 sm:w-10 sm:h-10" />
                  </div>
                  <div className="flex-1 space-y-2">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                      <h4 className="text-xl sm:text-2xl font-serif font-black text-gold uppercase leading-tight tracking-tight">Manual</h4>
                    </div>
                    <p className="text-xs sm:text-sm text-ink/70 font-medium max-w-2xl leading-relaxed">
                      You are already familiar with the character options provided in Dauligor. And are simply interested in creating your character without guided assistance.
                    </p>
                  </div>
                </div>

                {/* Assisted */}
                <div 
                  onClick={() => navigate('/construction')}
                  className="p-4 sm:p-6 border border-gold/20 bg-card/40 rounded-lg relative group flex flex-col sm:flex-row items-center sm:items-start gap-4 sm:gap-8 transition-all hover:bg-gold/10 cursor-pointer hover:border-gold/50 shadow-sm min-h-[100px] sm:min-h-[140px] text-center sm:text-left opacity-90"
                >
                  <div className="w-16 h-16 sm:w-20 sm:h-20 flex-shrink-0 bg-gold/10 rounded-lg flex items-center justify-center border border-gold/20 text-gold shadow-sm group-hover:scale-105 transition-transform duration-500">
                    <Sparkles className="w-8 h-8 sm:w-10 sm:h-10" />
                  </div>
                  <div className="flex-1 space-y-2">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                      <h4 className="text-xl sm:text-2xl font-serif font-black text-gold uppercase leading-tight tracking-tight">Assisted</h4>
                    </div>
                    <p className="text-xs sm:text-sm text-ink/70 font-medium max-w-2xl leading-relaxed">
                      You aren't sure about the character options that Dauligor provides, or are currently unsure about what you are interested in playing.
                    </p>
                    <div className="flex items-center justify-center sm:justify-start gap-2 pt-1">
                       <div className="hidden sm:block h-[1px] w-4 bg-gold/30" />
                       <p className="text-[10px] sm:text-[11px] text-gold/60 font-black uppercase tracking-widest italic">
                         Answering Questions will provide a curated list of options for you
                       </p>
                    </div>
                  </div>
                </div>

                {/* Lore */}
                <div 
                  onClick={() => navigate('/construction')}
                  className="p-4 sm:p-6 border border-gold/20 bg-card/40 rounded-lg relative group flex flex-col sm:flex-row items-center sm:items-start gap-4 sm:gap-8 transition-all hover:bg-gold/10 cursor-pointer hover:border-gold/50 shadow-sm min-h-[100px] sm:min-h-[140px] text-center sm:text-left opacity-90"
                >
                  <div className="w-16 h-16 sm:w-20 sm:h-20 flex-shrink-0 bg-gold/10 rounded-lg flex items-center justify-center border border-gold/20 text-gold shadow-sm group-hover:scale-105 transition-transform duration-500">
                    <BookOpen className="w-8 h-8 sm:w-10 sm:h-10" />
                  </div>
                  <div className="flex-1 space-y-2">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                      <h4 className="text-xl sm:text-2xl font-serif font-black text-gold uppercase leading-tight tracking-tight">Lore</h4>
                    </div>
                    <p className="text-xs sm:text-sm text-ink/70 font-medium max-w-2xl leading-relaxed">
                      You're unsure about the world of Dauligor. You can read various curated articles and choose options based on what interests you.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex justify-center sm:justify-end pt-6">
                <DialogClose render={<Button variant="outline" className="border-gold/20 text-ink/60 hover:text-ink hover:bg-gold/5 font-bold uppercase tracking-widest text-[10px] px-6 h-9">
                  Cancel
                </Button>} />
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {characters.map(char => (
          <Link key={char.id} to={`/characters/builder/${char.id}`}>
            <div className="border border-gold/20 bg-card/40 p-6 rounded hover:bg-gold/5 transition-all group flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <h2 className="font-serif font-bold text-xl text-ink group-hover:text-gold transition-colors">{char.name}</h2>
                <div className="w-8 h-8 rounded border border-gold/30 bg-gold/10 flex items-center justify-center font-bold text-gold">
                  {char.level || 1}
                </div>
              </div>
              <div className="text-xs text-ink/50 uppercase tracking-widest font-bold">
                {char.campaign_id ? 'Assigned to Campaign' : 'No Campaign'}
              </div>
              {isStaff && char.user_id !== userProfile.id && (
                <div className="mt-2 pt-2 border-t border-gold/10 flex items-center gap-2 text-xs text-ink/40">
                  <Shield className="w-3 h-3" /> Player ID: {String(char.user_id || '').substring(0,6)}...
                </div>
              )}
            </div>
          </Link>
        ))}
        {characters.length === 0 && (
          <div className="col-span-full py-20 text-center border border-dashed border-gold/20 rounded">
            <p className="text-ink/40 italic">You haven't created any characters yet.</p>
          </div>
        )}
      </div>
    </div>
  );
}
