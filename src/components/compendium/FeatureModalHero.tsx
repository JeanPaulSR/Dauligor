import React from 'react';
import { Zap } from 'lucide-react';
import { ImageUpload } from '../ui/ImageUpload';
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs';

export interface FeatureModalHeroProps {
  /** Current icon URL — bound to ImageUpload's `currentImageUrl`. */
  iconUrl: string;
  /** Called with the uploaded URL after an icon swap. */
  onIconChange: (url: string) => void;
  /** R2 storage path prefix. Defaults to the features prefix. */
  iconStoragePath?: string;

  /** Current name string. */
  name: string;
  /** Called on every name keystroke. */
  onNameChange: (name: string) => void;
  /** Placeholder for the name input. */
  namePlaceholder?: string;
  /** Whether the name input is required for form submission. */
  required?: boolean;
  /** Auto-focus the name input on mount. */
  autoFocusName?: boolean;
  /**
   * Optional content rendered directly below the name input — e.g. the
   * level input + ReferenceSheetDialog on class features. Omitted for
   * pure-feat documents like Maneuvers / Invocations / Infusions.
   */
  nameExtras?: React.ReactNode;

  /** Ordered list of tab values shown in the strip. */
  tabs: readonly string[];
  /** Currently-active tab value. */
  activeTab: string;
  /** Called with the new tab value on change. */
  onTabChange: (tab: string) => void;
}

/**
 * Shared modal hero for feat-shape editors: 128×128 ImageUpload + giant
 * centered serif name input + tab strip with the Zap accent. Used by
 * ClassEditor / SubclassEditor feature modals and the
 * UniqueOptionGroupEditor option modal so authoring a Maneuver /
 * Invocation / Infusion / class feature share visual identity.
 *
 * Lives outside the scrolling body of its parent modal — pin the
 * tab-content + footer below this component inside a flex container so
 * the hero stays visible across every tab.
 */
export default function FeatureModalHero({
  iconUrl,
  onIconChange,
  iconStoragePath = 'icons/features/',
  name,
  onNameChange,
  namePlaceholder = 'Feature Name',
  required = false,
  autoFocusName = false,
  nameExtras,
  tabs,
  activeTab,
  onTabChange,
}: FeatureModalHeroProps) {
  return (
    <div className="p-6 pb-0 shrink-0 border-b border-gold/10">
      <div className="flex gap-6 items-start">
        <div className="w-32 h-32 shrink-0">
          <ImageUpload
            storagePath={iconStoragePath}
            imageType="icon"
            compact
            currentImageUrl={iconUrl}
            onUpload={onIconChange}
            className="w-full h-full"
          />
        </div>
        <div className="flex-1 space-y-2 pt-2 flex flex-col items-center">
          <input
            value={name}
            onChange={e => onNameChange(e.target.value)}
            className="w-full h-16 font-serif text-4xl tracking-tight text-center bg-transparent border border-transparent hover:border-gold/20 focus:border-gold/50 focus:bg-background/50 rounded outline-none text-gold transition-colors"
            placeholder={namePlaceholder}
            required={required}
            autoFocus={autoFocusName}
          />
          {nameExtras}
        </div>
      </div>

      <div className="flex mt-6 relative pb-4">
        <div className="absolute left-[50%] ml-[-12px] bottom-[-16px] w-6 h-6 bg-card flex items-center justify-center text-gold/40 text-sm rounded-full z-10 border border-gold/10">
          <Zap className="w-3 h-3" />
        </div>
        <Tabs value={activeTab} onValueChange={onTabChange} className="w-full bg-transparent border-none">
          <TabsList className="bg-transparent border-none h-auto p-0 flex justify-between w-full">
            {tabs.map(tab => (
              <TabsTrigger
                key={tab}
                value={tab}
                className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-gold data-[state=active]:border-b-2 data-[state=active]:border-gold rounded-none h-10 px-0 label-text transition-all opacity-60 data-[state=active]:opacity-100 flex-1 hover:text-gold/80"
              >
                {tab}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
    </div>
  );
}
