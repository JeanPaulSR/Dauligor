import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { HardHat, ArrowLeft } from 'lucide-react';

export default function Construction() {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-8 max-w-2xl mx-auto px-4">
      <div className="w-24 h-24 bg-gold/10 rounded-full flex items-center justify-center border border-gold/30">
        <HardHat className="w-12 h-12 text-gold animate-bounce" />
      </div>
      
      <div className="space-y-4">
        <h1 className="text-4xl font-serif font-bold text-ink uppercase tracking-tighter">Under Construction</h1>
        <p className="text-lg text-ink/60 font-medium">
          The Scribes of Dauligor are still compiling the necessary scrolls and logic for this feature. 
          Guided assistance and Lore-integrated creation will be available in a future chronicle.
        </p>
      </div>

      <div className="pt-8 flex flex-col items-center gap-4">
        <div className="p-4 bg-card border border-gold/10 rounded-lg shadow-sm w-full italic text-ink/40 text-sm">
          "Patience is the first virtue of an adventurer. Or so the tavern bards say after they run out of ale."
        </div>
        
        <Button 
          variant="outline" 
          onClick={() => navigate(-1)}
          className="border-gold/30 text-gold hover:bg-gold/5 gap-2"
        >
          <ArrowLeft className="w-4 h-4" /> Go Back
        </Button>
      </div>
    </div>
  );
}
