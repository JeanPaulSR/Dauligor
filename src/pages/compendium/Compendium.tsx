import React from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card';
import { 
  Book, 
  Sword, 
  Wand2, 
  Scroll, 
  Shield, 
  Users, 
  Hammer, 
  Dna,
  Brain,
  ChevronRight,
  Tags as TagsIcon
} from 'lucide-react';

export default function Compendium({ userProfile }: { userProfile: any }) {
  const categories = [
    {
      title: 'Character Options',
      items: [
        { name: 'Classes', icon: Sword, path: '/compendium/classes', description: 'Core character classes and their progressions.' },
        { name: 'Subclasses', icon: Shield, path: '/compendium/subclasses', description: 'Specializations for each class.' },
        { name: 'Races', icon: Dna, path: '/compendium/races', description: 'Species and lineages of the world.' },
        { name: 'Feats', icon: Scroll, path: '/compendium/feats', description: 'Special talents and abilities.' },
        { name: 'Modular Options', icon: Scroll, path: '/compendium/unique-options', description: 'Customizable options like Invocations or Metamagic.' },
        { name: 'Backgrounds', icon: Users, path: '/compendium/backgrounds', description: 'Origins and life before adventuring.' },
      ]
    },
    {
      title: 'Magic & Equipment',
      items: [
        { name: 'Spells', icon: Wand2, path: '/compendium/spells', description: 'The complete archive of magical arts.' },
        { name: 'Items', icon: Hammer, path: '/compendium/items', description: 'Weapons, armor, and wondrous artifacts.' },
      ]
    },
    {
      title: 'Reference',
      items: [
        { name: 'Sources', icon: Book, path: '/sources', description: 'Official books and homebrew documents.' },
      ]
    },
    ...(userProfile?.role === 'admin' ? [{
      title: 'Admin Tools',
      items: [
        { name: 'Proficiencies', icon: Brain, path: '/admin/proficiencies', description: 'Manage skills, tools, weapons, and armor.' },
        { name: 'Tag Management', icon: TagsIcon, path: '/compendium/tags', description: 'Organize and categorize compendium entries with custom tags.' },
      ]
    }] : [])
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-12 pb-20">
      <div className="text-center space-y-2">
        <h1 className="h1-title">The Compendium</h1>
      </div>

      <div className="grid gap-12">
        {categories.map((category) => (
          <div key={category.title} className="space-y-4">
            <div className="flex items-center gap-4">
              <h2 className="label-text text-gold shrink-0">{category.title}</h2>
              <div className="h-px bg-gold/10 w-full" />
            </div>
            
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {category.items.map((item) => (
                <Link key={item.name} to={item.path} className="group">
                  <div className="p-3 border border-gold/10 bg-card/50 hover:border-gold/40 hover:bg-gold/5 transition-all flex items-center gap-3">
                    <item.icon className="w-3.5 h-3.5 text-gold/50 group-hover:text-gold transition-colors" />
                    <span className="h3-title text-lg group-hover:text-gold transition-colors">
                      {item.name}
                    </span>
                    <ChevronRight className="w-3 h-3 text-gold ml-auto opacity-0 group-hover:opacity-100 transition-all" />
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
