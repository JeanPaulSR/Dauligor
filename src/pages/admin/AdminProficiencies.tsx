import React, { useState } from 'react';
import { ShieldCheck, Crosshair, Brain, Hammer, Settings, MessageCircle, Skull, Star, Wand2 } from 'lucide-react';
import SkillsEditor from '../compendium/SkillsEditor';
import ToolsEditor from '../compendium/ToolsEditor';
import WeaponsEditor from './WeaponsEditor';
import ArmorEditor from './ArmorEditor';
import SimplePropertyEditor from './SimplePropertyEditor';
import SpellcastingAdvancementManager from './SpellcastingAdvancementManager';

// Status conditions + condition categories USED to live here. They moved
// to /admin/statuses (StatusesEditor) which has the richer condition
// editor anyway — see commit "Move conditions admin under /admin/statuses".

export default function AdminProficiencies({ userProfile }: { userProfile: any }) {
  const [activeTab, setActiveTab] = useState<
    'skills' | 'tools' | 'toolCategories' | 'weapons' | 'weaponCategories' | 'weaponProperties' | 'armor' | 'armorCategories' | 'languages' | 'languageCategories' | 'damageTypes' | 'attributes' | 'spellcasting'
  >('skills');

  if (userProfile?.role !== 'admin') {
    return <div className="text-center py-20">Access Denied. Admins only.</div>;
  }

  return (
    <div className="max-w-7xl mx-auto space-y-8 pb-20">
      <div className="flex items-center gap-3 text-gold mb-2">
        <Settings className="w-6 h-6" />
        <span className="text-sm font-bold uppercase tracking-[0.3em]">Admin Tools</span>
      </div>

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-2">
          <h1 className="text-4xl font-serif font-bold text-ink tracking-tight uppercase">Proficiencies Manager</h1>
          <p className="text-ink/60 font-serif italic">Define the core skills, tools, weapons, armor, languages, damage types, and attributes available in your game system.</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-gold/10 pb-4">
        {[
          { id: 'skills', label: 'Skills', icon: Brain },
          { id: 'tools', label: 'Tools', icon: Hammer },
          { id: 'toolCategories', label: 'Tool Categories', icon: Hammer },
          { id: 'weapons', label: 'Weapons', icon: Crosshair },
          { id: 'weaponCategories', label: 'Weapon Categories', icon: Crosshair },
          { id: 'weaponProperties', label: 'Weapon Properties', icon: Hammer },
          { id: 'armor', label: 'Armor', icon: ShieldCheck },
          { id: 'armorCategories', label: 'Armor Categories', icon: ShieldCheck },
          { id: 'languages', label: 'Languages', icon: MessageCircle },
          { id: 'languageCategories', label: 'Language Categories', icon: MessageCircle },
          { id: 'damageTypes', label: 'Damage Types', icon: Skull },
          { id: 'attributes', label: 'Attributes', icon: Star },
          { id: 'spellcasting', label: 'Spellcasting', icon: Wand2 }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`flex items-center gap-2 px-4 py-2 rounded-t-lg transition-colors font-bold uppercase tracking-widest text-[10px] ${
              activeTab === tab.id 
                ? 'bg-gold text-white shadow-sm' 
                : 'bg-card text-ink/60 hover:text-ink hover:bg-gold/10'
            }`}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      <div className="pt-4">
        {activeTab === 'skills' && <SkillsEditor userProfile={userProfile} hideHeader />}
        {activeTab === 'tools' && <ToolsEditor userProfile={userProfile} hideHeader />}
        {activeTab === 'toolCategories' && <SimplePropertyEditor userProfile={userProfile} collectionName="toolCategories" title="Tool Category" descriptionText="Define broad tool proficiency groups such as Artisan's Tools, Gaming Sets, Musical Instruments, or homebrew categories." icon={Hammer} />}
        {activeTab === 'weapons' && <WeaponsEditor userProfile={userProfile} hideHeader />}
        {activeTab === 'weaponCategories' && <SimplePropertyEditor userProfile={userProfile} collectionName="weaponCategories" title="Weapon Category" descriptionText="Define broad weapon proficiency groups such as Simple, Martial, Firearms, Exotic, or other homebrew categories." icon={Crosshair} />}
        {activeTab === 'weaponProperties' && <SimplePropertyEditor userProfile={userProfile} collectionName="weaponProperties" title="Weapon Property" descriptionText="Define properties that can be applied to weapons, such as Finesse, Heavy, Reach, Versatile, or homebrew properties." icon={Hammer} />}
        {activeTab === 'armor' && <ArmorEditor userProfile={userProfile} hideHeader />}
        {activeTab === 'armorCategories' && <SimplePropertyEditor userProfile={userProfile} collectionName="armorCategories" title="Armor Category" descriptionText="Define broad armor proficiency groups such as Light, Medium, Heavy, Shields, or homebrew categories." icon={ShieldCheck} />}
        {activeTab === 'languages' && <SimplePropertyEditor userProfile={userProfile} collectionName="languages" title="Language" descriptionText="Define the languages available to be selected in race, class, and background proficiencies." icon={MessageCircle} categoryCollectionName="languageCategories" categoryLabel="Language Category" />}
        {activeTab === 'languageCategories' && <SimplePropertyEditor userProfile={userProfile} collectionName="languageCategories" title="Language Category" descriptionText="Define broad language groups such as Common Tongues, Exotic Tongues, Secret Scripts, or other homebrew categories." icon={MessageCircle} />}
        {activeTab === 'damageTypes' && <SimplePropertyEditor userProfile={userProfile} collectionName="damageTypes" title="Damage Type" descriptionText="Categories of damage a creature can be immune or resistant to." icon={Skull} />}
        {activeTab === 'attributes' && <SimplePropertyEditor userProfile={userProfile} collectionName="attributes" title="Attribute" descriptionText="Define the core ability scores/attributes of the system." icon={Star} />}
        {activeTab === 'spellcasting' && <SpellcastingAdvancementManager userProfile={userProfile} />}
      </div>
    </div>
  );
}
