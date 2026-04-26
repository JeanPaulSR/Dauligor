export type ActivityKind = 
  | 'attack' 
  | 'cast' 
  | 'check' 
  | 'damage' 
  | 'enchant' 
  | 'forward' 
  | 'heal' 
  | 'save' 
  | 'summon' 
  | 'transform' 
  | 'utility';

export interface SemanticActivity {
  id: string;
  kind: ActivityKind;
  name: string;
  img: string;
  chatFlavor?: string;
  
  // Activation mechanics
  activation?: {
    type: string;
    value?: number;
    condition?: string;
    override?: boolean;
  };
  duration?: {
    value?: string;
    units: string;
    special?: string;
    concentration?: boolean;
    override?: boolean;
  };
  range?: {
    value?: string;
    units: string;
    special?: string;
    override?: boolean;
  };
  target?: {
    template?: {
      count?: string;
      contiguous?: boolean;
      stationary?: boolean;
      type?: string;
      size?: string;
      width?: string;
      height?: string;
      units?: string;
    };
    affects?: {
      count?: string;
      type?: string;
      choice?: boolean;
      special?: string;
    };
    override?: boolean;
    prompt?: boolean;
  };

  // Combat/Check logic
  attack?: {
    ability?: string;
    bonus?: string;
    flat?: boolean;
    type?: 'melee' | 'ranged' | '';
    classification?: 'unarmed' | 'weapon' | 'spell' | 'none' | '';
    critical?: { threshold: number | null };
  };
  check?: {
    ability?: string;
    associated?: string[];
    dc?: {
      calculation?: string;
      formula?: string;
    }
  };
  save?: {
    abilities: string[];
    dc?: {
      calculation?: string;
      formula?: string;
    }
  };
  damage?: {
    includeBase?: boolean;
    parts: {
      number?: number | null;
      denomination?: number | null;
      bonus?: string;
      types?: string[];
      custom?: { enabled: boolean; formula: string };
      scaling?: { mode: string; number?: number; formula?: string };
    }[];
    onSave?: string;
    critical?: { allow?: boolean; bonus?: string };
  };
  healing?: {
    parts: {
      number?: number | null;
      denomination?: number | null;
      bonus?: string;
      types?: string[];
      custom?: { enabled: boolean; formula: string };
      scaling?: { mode: string; number?: number; formula?: string };
    }[];
  };
  spell?: {
    uuid: string;
    ability?: string;
    challenge?: {
      attack?: number | null;
      save?: number | null;
      override?: boolean;
    };
    level?: number | null;
    properties?: string[];
    spellbook?: boolean;
  };
  enchant?: {
    self: boolean;
    restrictions?: {
      allowMagical?: boolean;
      categories?: string[];
      properties?: string[];
      type?: string;
    };
    effects?: {
      _id?: string;
      level?: { min?: number | null; max?: number | null };
      riders?: {
        activity?: string[];
        effect?: string[];
        item?: string[];
      }
    }[];
  };
  activity?: {
    id: string; // for forward
  };
  summon?: {
    profiles: {
      _id: string;
      count: string;
      cr: string;
      level: { min: number; max: number };
      name: string;
      types: string[];
      uuid: string | null;
    }[];
    bonuses?: {
      ac?: string;
      hd?: string;
      hp?: string;
      attackDamage?: string;
      saveDamage?: string;
      healing?: string;
    };
    match?: {
      ability?: string;
      attacks?: boolean;
      disposition?: boolean;
      proficiency?: boolean;
      saves?: boolean;
    };
    creatureSizes?: string[];
    creatureTypes?: string[];
    mode?: string;
    prompt?: boolean;
    tempHP?: string;
  };
  transform?: {
    profiles: {
      _id: string;
      cr?: string;
      level: { min: number; max: number };
      movement?: string[];
      name: string;
      sizes?: string[];
      types?: string[];
      uuid: string | null;
    }[];
    settings: Record<string, unknown> | null;
    customize?: boolean;
    mode?: string;
    preset?: string;
  };
  roll?: {
    formula?: string;
    name?: string;
    prompt?: boolean;
    visible?: boolean;
  };

  // Behavior & Visibility
  visibility?: {
    identifier?: string;
    level?: { min?: number | null; max?: number | null };
    requireAttunement?: boolean;
    requireIdentification?: boolean;
    requireMagic?: boolean;
  };

  // Consumption & Uses
  consumption?: {
    spellSlot?: boolean;
    scaling?: { allowed: boolean; max: string };
    targets?: {
      type: string;
      target: string;
      value: string;
      scaling?: { mode: string; formula: string };
    }[];
  };
  uses?: {
    spent?: number;
    max?: string;
    recovery?: { period: string; type: string; formula: string }[];
  }
}
