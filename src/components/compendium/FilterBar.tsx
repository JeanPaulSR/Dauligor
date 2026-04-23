import React from 'react';
import { Search, Filter, X, Check } from 'lucide-react';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Card } from '../ui/card';
import { cn } from '../../lib/utils';

export interface FilterBarProps {
  search: string;
  setSearch: (val: string) => void;
  isFilterOpen: boolean;
  setIsFilterOpen: (val: boolean) => void;
  activeFilterCount: number;
  tagGroups: any[];
  tagsByGroup: Record<string, any[]>;
  tagStates: Record<string, number>;
  setTagStates: (val: any) => void;
  cycleTagState: (tagId: string) => void;
  groupCombineModes: Record<string, 'AND' | 'OR' | 'XOR'>;
  cycleGroupMode: (groupId: string) => void;
  groupExclusionModes: Record<string, 'AND' | 'OR' | 'XOR'>;
  cycleExclusionMode: (groupId: string) => void;
  resetFilters: () => void;
}

export function FilterBar({
  search, setSearch,
  isFilterOpen, setIsFilterOpen,
  activeFilterCount,
  tagGroups, tagsByGroup,
  tagStates, setTagStates, cycleTagState,
  groupCombineModes, cycleGroupMode,
  groupExclusionModes, cycleExclusionMode,
  resetFilters
}: FilterBarProps) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-4 items-center bg-card p-2 rounded-lg border border-gold/10 shadow-sm">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3 text-ink/30" />
          <Input 
            placeholder="Search..." 
            className="pl-8 h-8 bg-background/50 border-gold/10 focus:border-gold"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button 
          variant={isFilterOpen ? "default" : "outline"} 
          size="sm" 
          onClick={() => setIsFilterOpen(true)}
          className={`h-8 gap-2 w-full sm:w-auto ${isFilterOpen ? 'bg-gold text-white' : 'border-gold/20 text-gold hover:bg-gold/10'}`}
        >
          <Filter className="w-3 h-3" /> Filters
          {activeFilterCount > 0 && (
            <Badge className="bg-white text-gold h-4 px-1 min-w-[1rem] flex items-center justify-center text-[10px]">
              {activeFilterCount}
            </Badge>
          )}
        </Button>
      </div>

      {isFilterOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 md:p-10">
          <div 
            className="absolute inset-0 bg-ink/40 backdrop-blur-sm animate-in fade-in duration-200" 
            onClick={() => setIsFilterOpen(false)} 
          />
          <Card className="relative w-full max-w-4xl max-h-full overflow-hidden flex flex-col border-gold/20 bg-card shadow-2xl animate-in zoom-in-95 duration-200 pointer-events-auto">
            <div className="flex items-center justify-between p-6 border-b border-gold/10 bg-gold/5">
              <div className="flex items-center gap-6">
                <h2 className="h2-title uppercase text-ink">Advanced Filters</h2>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setIsFilterOpen(false)} className="text-ink/40 hover:text-gold transition-colors">
                <X className="w-5 h-5" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-12 custom-scrollbar">
              {tagGroups.map(group => {
                const groupTags = tagsByGroup[group.id] || [];
                if (groupTags.length === 0) return null;
                const mode = groupCombineModes[group.id] || 'OR';
                const exMode = groupExclusionModes[group.id] || 'OR';

                return (
                  <div key={group.id} className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-6">
                        <span className="h3-title uppercase text-ink">{group.name}</span>
                        <div className="flex items-center gap-4">
                          <Button 
                            size="sm" 
                            variant="outline"
                            onClick={() => cycleGroupMode(group.id)}
                            className="h-6 px-3 border-gold/20 text-gold text-[9px] font-bold uppercase tracking-widest hover:bg-gold/5"
                          >
                            {mode}
                          </Button>
                          <div className="flex items-center gap-2">
                            <span className="label-text text-blood/60">Exclusion Logic</span>
                            <Button 
                              size="sm" 
                              onClick={() => cycleExclusionMode(group.id)}
                              className="h-6 px-3 bg-blood text-white text-[9px] font-bold uppercase tracking-widest hover:bg-blood/90"
                            >
                              {exMode}
                            </Button>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <button 
                          onClick={() => {
                            const newStates: Record<string, number> = { ...tagStates };
                            groupTags.forEach(t => newStates[t.id] = 1);
                            setTagStates(newStates);
                          }}
                          className="label-text hover:underline"
                        >
                          Include All
                        </button>
                        <span className="text-gold/20">|</span>
                        <button 
                          onClick={() => {
                            const newStates: Record<string, number> = { ...tagStates };
                            groupTags.forEach(t => delete newStates[t.id]);
                            setTagStates(newStates);
                          }}
                          className="label-text hover:underline"
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {groupTags.map(tag => {
                        const state = tagStates[tag.id] || 0;
                        return (
                          <button
                            key={tag.id}
                            onClick={() => cycleTagState(tag.id)}
                            className={cn(
                              "px-3 py-1 rounded-full border text-[10px] font-black uppercase tracking-wider transition-all flex items-center gap-2",
                              state === 1 ? "bg-gold text-white border-gold shadow-lg shadow-gold/20" : state === 2 ? "bg-blood text-white border-blood shadow-lg shadow-blood/20" : "bg-card text-ink/60 border-gold/20 hover:border-gold/40 hover:text-gold"
                            )}
                          >
                            {state === 1 && <Check className="w-3 h-3" />}
                            {state === 2 && <X className="w-3 h-3" />}
                            {tag.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="p-6 border-t border-gold/10 bg-gold/5 flex items-center justify-between">
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={resetFilters}
                className="label-text text-ink/40 hover:text-blood"
              >
                Reset All Filters
              </Button>
              <Button onClick={() => setIsFilterOpen(false)} className="bg-gold hover:bg-gold/90 text-white px-10 h-10 uppercase tracking-widest font-bold shadow-lg shadow-gold/20">
                Apply & Close
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
