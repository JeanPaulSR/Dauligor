// Display + render helpers for the public Monster Browser
// (`MonsterList` + `MonsterDetailPanel`). Pure functions — no React, no I/O —
// so both surfaces share one source of truth for CR formatting, slug→name
// maps, and the prose cleanup that turns stored Foundry-flavoured BBCode into
// reader-ready text.
//
// Why a prose cleaner: the importer stored each action/trait body as
// `htmlToBbcode(item.system.description.value)`. That preserves the Foundry
// dnd5e *enricher* tokens verbatim — `[[/r 1d20+11]]{+11}`,
// `[[/damage 2d10 + 6 type=piercing]]`, `[[/save ability=dex dc=18]]`,
// `@UUID[.id]{Label}` — plus raw `<ul class="ve-rd__list">` / `<hN class>`
// HTML that `htmlToBbcode` didn't fold (its tag regexes only match
// attribute-less tags). `bbcodeToHtml` escapes raw HTML and renders the roll
// enrichers as literal junk, so we normalise both BEFORE handing the string to
// `bbcodeToHtml`. `&Reference[...]` and `@UUID[...]{Label}` are left intact —
// `bbcodeToHtml` already turns those into cross-reference badges.

// ─── slug → name maps ────────────────────────────────────────────────────────

export const ABILITY_NAME: Record<string, string> = {
  str: 'Strength', dex: 'Dexterity', con: 'Constitution',
  int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma',
};

export const ABILITY_ABBR: Record<string, string> = {
  str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA',
};

export const ABILITY_ORDER = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;

// dnd5e skill slugs → display names.
export const SKILL_NAME: Record<string, string> = {
  acr: 'Acrobatics', ani: 'Animal Handling', arc: 'Arcana', ath: 'Athletics',
  dec: 'Deception', his: 'History', ins: 'Insight', itm: 'Intimidation',
  inv: 'Investigation', med: 'Medicine', nat: 'Nature', prc: 'Perception',
  prf: 'Performance', per: 'Persuasion', rel: 'Religion', slt: 'Sleight of Hand',
  ste: 'Stealth', sur: 'Survival',
};

export const SIZE_LABEL: Record<string, string> = {
  tiny: 'Tiny', sm: 'Small', med: 'Medium', lg: 'Large', huge: 'Huge', grg: 'Gargantuan',
};

export const CREATURE_TYPE_LABEL: Record<string, string> = {
  aberration: 'Aberration', beast: 'Beast', celestial: 'Celestial',
  construct: 'Construct', dragon: 'Dragon', elemental: 'Elemental',
  fey: 'Fey', fiend: 'Fiend', giant: 'Giant', humanoid: 'Humanoid',
  monstrosity: 'Monstrosity', ooze: 'Ooze', plant: 'Plant', undead: 'Undead',
};

// ─── small formatters ────────────────────────────────────────────────────────

export function titleCase(s: string): string {
  return String(s || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

/** A signed bonus string: 5 → "+5", -1 → "-1", 0 → "+0". */
export function formatBonus(n: number): string {
  const v = Math.trunc(Number(n) || 0);
  return v >= 0 ? `+${v}` : `${v}`;
}

/** 5e ability modifier from a raw score. */
export function abilityMod(score: number): number {
  return Math.floor((Number(score) - 10) / 2);
}

/** CR for display: fractions render as "1/8" / "1/4" / "1/2"; null → "—". */
export function formatCr(cr: number | null | undefined): string {
  if (cr == null) return '—';
  const n = Number(cr);
  if (n === 0.125) return '1/8';
  if (n === 0.25) return '1/4';
  if (n === 0.5) return '1/2';
  // Whole numbers print bare; any other fraction prints as-is.
  return Number.isInteger(n) ? String(n) : String(n);
}

/** XP with thousands separators (CR's XP is precomputed into the row). */
export function formatXp(xp: number | null | undefined): string {
  if (xp == null) return '';
  return Number(xp).toLocaleString('en-US');
}

// The banded CR filter axis. A creature's `cr` maps to exactly one band; the
// list filters on the band string via matchesSingleAxisFilter.
export const CR_BANDS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'cr0', label: 'CR 0' },
  { value: 'cr-frac-1', label: 'CR 1/8 – 1' },
  { value: 'cr2-4', label: 'CR 2 – 4' },
  { value: 'cr5-10', label: 'CR 5 – 10' },
  { value: 'cr11-16', label: 'CR 11 – 16' },
  { value: 'cr17', label: 'CR 17+' },
];

export function crToBand(cr: number | null | undefined): string {
  if (cr == null) return '';
  const n = Number(cr);
  if (n === 0) return 'cr0';
  if (n < 2) return 'cr-frac-1';      // 1/8, 1/4, 1/2, 1
  if (n <= 4) return 'cr2-4';
  if (n <= 10) return 'cr5-10';
  if (n <= 16) return 'cr11-16';
  return 'cr17';
}

/** The type line: "Medium Humanoid (Aarakocra), Neutral Good" / swarm form. */
export function formatTypeLine(row: {
  size?: string; creatureType?: string; typeSubtype?: string | null;
  swarmSize?: string | null; alignment?: string | null;
}): string {
  const size = SIZE_LABEL[String(row.size || '')] || titleCase(String(row.size || ''));
  const type = CREATURE_TYPE_LABEL[String(row.creatureType || '')]
    || titleCase(String(row.creatureType || ''));
  let head: string;
  if (row.swarmSize) {
    // "Swarm of Tiny beasts"
    const swarm = SIZE_LABEL[String(row.swarmSize)] || titleCase(String(row.swarmSize));
    head = `${size} Swarm of ${swarm} ${type.toLowerCase()}s`;
  } else {
    head = `${size} ${type}`;
  }
  const sub = row.typeSubtype ? ` (${row.typeSubtype})` : '';
  const align = row.alignment ? `, ${row.alignment}` : '';
  return `${head}${sub}${align}`;
}

/** Speed line: walk (unlabelled) first, then fly/swim/climb/burrow. */
export function formatSpeed(movement: any): string {
  if (!movement || typeof movement !== 'object') return '—';
  const units = movement.units || 'ft';
  const parts: string[] = [];
  const walk = movement.walk;
  if (walk != null && Number(walk) > 0) parts.push(`${walk} ${units}.`);
  for (const mode of ['burrow', 'climb', 'fly', 'swim'] as const) {
    const v = movement[mode];
    if (v != null && Number(v) > 0) {
      const hover = mode === 'fly' && movement.hover ? ' (hover)' : '';
      parts.push(`${mode} ${v} ${units}.${hover}`);
    }
  }
  if (movement.special) parts.push(String(movement.special));
  return parts.length ? parts.join(', ') : '—';
}

/** Senses list (sans passive Perception, which is a scalar column). */
export function formatSenses(senses: any): string[] {
  if (!senses || typeof senses !== 'object') return [];
  const units = senses.units || 'ft';
  const out: string[] = [];
  for (const sense of ['blindsight', 'darkvision', 'tremorsense', 'truesight'] as const) {
    const v = senses[sense];
    if (v != null && Number(v) > 0) out.push(`${sense} ${v} ${units}.`);
  }
  if (senses.special) out.push(String(senses.special));
  return out;
}

// Damage-bypass slug → the "from … attacks" qualifier (mgc/sil/ada).
function bypassPhrase(bypasses: string[]): string {
  const set = new Set((bypasses || []).map((b) => String(b).toLowerCase()));
  const nonmagical = set.has('mgc');
  const extras: string[] = [];
  if (set.has('sil')) extras.push("silvered");
  if (set.has('ada')) extras.push("adamantine");
  if (!nonmagical && extras.length === 0) return '';
  let phrase = nonmagical ? 'from nonmagical attacks' : 'from attacks';
  if (extras.length) phrase += ` that aren't ${extras.join(' or ')}`;
  return phrase;
}

/** Damage R/I/V line: "bludgeoning, piercing, and slashing from nonmagical attacks". */
export function formatDamageMod(block: any): string {
  if (!block || typeof block !== 'object') return '';
  const value: string[] = Array.isArray(block.value) ? block.value : [];
  const phrase = bypassPhrase(Array.isArray(block.bypasses) ? block.bypasses : []);
  const list = value.join(', ');
  const base = phrase ? `${list}${list ? ' ' : ''}${phrase}` : list;
  const custom = block.custom ? String(block.custom).trim() : '';
  if (base && custom) return `${base}; ${custom}`;
  return base || custom;
}

/** Condition immunities / habitat etc.: comma-joined value[] + custom. */
export function formatStringList(block: any): string {
  if (!block || typeof block !== 'object') return '';
  const value: string[] = Array.isArray(block.value) ? block.value : [];
  const list = value.map((v) => titleCase(String(v))).join(', ');
  const custom = block.custom ? String(block.custom).trim() : '';
  if (list && custom) return `${list}; ${custom}`;
  return list || custom;
}

/** Languages line: value[] + custom + "telepathy N ft." */
export function formatLanguages(languages: any): string {
  if (!languages || typeof languages !== 'object') return '—';
  const value: string[] = Array.isArray(languages.value) ? languages.value : [];
  const list = value.map((v) => titleCase(String(v))).join(', ');
  const custom = languages.custom ? String(languages.custom).trim() : '';
  const parts: string[] = [];
  const head = [list, custom].filter(Boolean).join(', ');
  if (head) parts.push(head);
  if (languages.telepathy != null && Number(languages.telepathy) > 0) {
    parts.push(`telepathy ${languages.telepathy} ft.`);
  }
  return parts.length ? parts.join(', ') : '—';
}

/** A usage suffix appended to an action name: "(Recharge 5–6)", "(3/Day)", … */
export function formatUsesSuffix(uses: any): string {
  if (!uses || typeof uses !== 'object') return '';
  const recovery: any[] = Array.isArray(uses.recovery) ? uses.recovery : [];
  const max = uses.max != null ? String(uses.max) : '';
  for (const rec of recovery) {
    const period = String(rec?.period || '').toLowerCase();
    if (period === 'recharge') {
      const n = Number(rec?.formula);
      if (Number.isFinite(n) && n > 0 && n < 6) return `(Recharge ${n}–6)`;
      return '(Recharge 6)';
    }
    if (period === 'day') return max ? `(${max}/Day)` : '(1/Day)';
    if (period === 'dawn') return '(Recharges at Dawn)';
    if (period === 'dusk') return '(Recharges at Dusk)';
    if (period === 'sr') return '(Recharges after a Short or Long Rest)';
    if (period === 'lr') return '(Recharges after a Long Rest)';
  }
  return '';
}

// ─── prose cleaner ───────────────────────────────────────────────────────────

// Strip Foundry `key=value` tokens from an enricher body, leaving the dice /
// number expression (e.g. "2d10 + 6 type=piercing" → "2d10 + 6").
function stripKeyValues(body: string): string {
  return String(body).replace(/\s*\b[a-z]+=[^\s\]]+/gi, '').trim();
}

/**
 * Normalise a stored monster prose string (BBCode + Foundry enrichers + stray
 * raw HTML) into clean BBCode ready for `bbcodeToHtml`. Idempotent-ish: safe to
 * run on prose that has no enrichers.
 */
export function cleanMonsterProse(input: string): string {
  let s = String(input || '');

  // ── Foundry roll enrichers → readable text ──
  // [[/save ability=dex dc=18 …]]{label} → label || "DC 18 Dexterity"
  s = s.replace(/\[\[\/save\s+([^\]]*)\]\](?:\{([^}]*)\})?/gi, (_m, body, label) => {
    if (label) return label;
    const dc = /dc=(\d+)/i.exec(body)?.[1];
    const abilities = [...String(body).matchAll(/ability=([a-z]{3})/gi)]
      .map((m) => ABILITY_NAME[m[1].toLowerCase()] || m[1]);
    const ability = abilities.join(' or ');
    if (dc && ability) return `DC ${dc} ${ability}`;
    if (dc) return `DC ${dc}`;
    return ability || 'saving throw';
  });
  // [[/damage 2d10 + 6 type=piercing]]{label} → label || "2d10 + 6 piercing"
  s = s.replace(/\[\[\/damage\s+([^\]]*)\]\](?:\{([^}]*)\})?/gi, (_m, body, label) => {
    if (label) return label;
    const type = /type=([a-z]+)/i.exec(body)?.[1] || '';
    const formula = stripKeyValues(body);
    return type ? `${formula} ${type}` : formula;
  });
  // [[/check …]] / [[/skill …]]{label} → label || "DC N Ability (Skill)"
  s = s.replace(/\[\[\/(?:check|skill)\s+([^\]]*)\]\](?:\{([^}]*)\})?/gi, (_m, body, label) => {
    if (label) return label;
    const dc = /dc=(\d+)/i.exec(body)?.[1];
    const ability = /ability=([a-z]{3})/i.exec(body)?.[1];
    const skill = /skill=([a-z]+)/i.exec(body)?.[1];
    const out: string[] = [];
    if (dc) out.push(`DC ${dc}`);
    if (ability) out.push(ABILITY_NAME[ability.toLowerCase()] || ability);
    if (skill) out.push(SKILL_NAME[skill.toLowerCase()] || titleCase(skill));
    return out.join(' ') || 'check';
  });
  // [[/r 1d20+11]]{+11} → +11  ;  [[/r 1d10]] → 1d10
  s = s.replace(/\[\[\/r\s+([^\]]*)\]\](?:\{([^}]*)\})?/gi, (_m, body, label) =>
    (label ? label : stripKeyValues(body)));
  // Any remaining [[/verb …]]{label} → label || cleaned body
  s = s.replace(/\[\[\/[a-z]+\s*([^\]]*)\]\](?:\{([^}]*)\})?/gi, (_m, body, label) =>
    (label ? label : stripKeyValues(body)));

  // @creature[Name||display] — bbcodeToHtml's ref regex bails on the inner
  // space; collapse to the display segment as plain text.
  s = s.replace(/@creature\[([^\]]*)\](?:\{([^}]*)\})?/gi, (_m, body, label) => {
    if (label) return label;
    const segs = String(body).split('|').filter(Boolean);
    return segs[segs.length - 1] || String(body);
  });

  // ── stray raw HTML → BBCode (htmlToBbcode left attributed tags alone) ──
  s = s
    .replace(/<ul\b[^>]*>/gi, '[ul]').replace(/<\/ul>/gi, '[/ul]')
    .replace(/<ol\b[^>]*>/gi, '[ol]').replace(/<\/ol>/gi, '[/ol]')
    .replace(/<li\b[^>]*>/gi, '[li]').replace(/<\/li>/gi, '[/li]')
    // Demote authored headings — h1/h2 in a side panel are too loud.
    .replace(/<h1\b[^>]*>/gi, '[h3]').replace(/<\/h1>/gi, '[/h3]')
    .replace(/<h2\b[^>]*>/gi, '[h3]').replace(/<\/h2>/gi, '[/h3]')
    .replace(/<h3\b[^>]*>/gi, '[h4]').replace(/<\/h3>/gi, '[/h4]')
    .replace(/<h4\b[^>]*>/gi, '[h4]').replace(/<\/h4>/gi, '[/h4]')
    .replace(/<caption\b[^>]*>/gi, '[b]').replace(/<\/caption>/gi, '[/b]\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?p\b[^>]*>/gi, '\n\n')
    .replace(/<(strong|b)\b[^>]*>/gi, '[b]').replace(/<\/(strong|b)>/gi, '[/b]')
    .replace(/<(em|i)\b[^>]*>/gi, '[i]').replace(/<\/(em|i)>/gi, '[/i]');

  return s;
}

/**
 * For the rare action whose stored `description` is empty: synthesise a minimal
 * mechanical line from a single activity tuple so the entry isn't blank. Most
 * monster actions DO carry full prose, so this is a fallback, not the norm.
 */
export function synthesizeActivityLine(activity: any): string {
  if (!activity || typeof activity !== 'object') return '';
  const parts: string[] = [];
  const atk = activity.attack;
  if (atk && typeof atk === 'object') {
    const kind = atk.type === 'ranged' ? 'Ranged' : 'Melee';
    const units = atk.units || 'ft';
    const reachRange: string[] = [];
    if (atk.reach != null) reachRange.push(`reach ${atk.reach} ${units}.`);
    if (atk.range != null) {
      reachRange.push(atk.long != null
        ? `range ${atk.range}/${atk.long} ${units}.`
        : `range ${atk.range} ${units}.`);
    }
    parts.push(`*${kind} Attack:* ${formatBonus(Number(atk.bonus || 0))} to hit${reachRange.length ? `, ${reachRange.join(', ')}` : ''}.`);
  }
  const save = activity.save;
  if (save && typeof save === 'object' && save.dc) {
    const abilities = (Array.isArray(save.abilities) ? save.abilities : [])
      .map((a: string) => ABILITY_NAME[String(a).toLowerCase()] || a).join(' or ');
    parts.push(`DC ${save.dc} ${abilities} saving throw${save.onSave === 'half' ? ' (half damage on a success)' : ''}.`);
  }
  const dmg: any[] = Array.isArray(activity.damageParts) ? activity.damageParts : [];
  if (dmg.length) {
    const hit = dmg.map((p) => {
      const types = Array.isArray(p.types) ? p.types.join(', ') : '';
      return `${p.average != null ? `${p.average} ` : ''}(${p.formula})${types ? ` ${types}` : ''}`;
    }).join(' plus ');
    parts.push(`*Hit:* ${hit} damage.`);
  }
  return parts.join(' ');
}
