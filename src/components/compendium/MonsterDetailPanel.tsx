import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronUp, PawPrint } from 'lucide-react';
import { bbcodeToHtml } from '../../lib/bbcode';
import { cn } from '../../lib/utils';
import { fetchDocument } from '../../lib/d1';
import {
  ABILITY_ORDER, ABILITY_ABBR, SKILL_NAME, ABILITY_NAME,
  abilityMod, formatBonus, formatCr, formatXp, formatTypeLine, formatSpeed,
  formatSenses, formatDamageMod, formatStringList, formatLanguages,
  formatUsesSuffix, cleanMonsterProse, synthesizeActivityLine, titleCase,
} from '../../lib/monsterDisplay';

/**
 * Read-only stat-block panel for a `monsters` row, mirroring the self-fetching
 * shape of `FeatDetailPanel` (fetch-by-id + per-id cache). Renders a 5etools-
 * style stat block: header → AC/HP/Speed → abilities → secondary stats →
 * traits/actions/bonus/reactions/legendary/lair/regional → spellcasting →
 * environment → collapsible lore.
 *
 * Action/trait prose is stored as Foundry-flavoured BBCode (roll enrichers +
 * stray HTML); `cleanMonsterProse` normalises it before `bbcodeToHtml`. The
 * spell list is rendered from the resolved `spellcasting[].spells[]` array (the
 * prose's `@UUID` list is label-less), each linking into the spell catalog.
 */

export type MonsterDetailSource = {
  id: string;
  name?: string;
  abbreviation?: string;
  shortName?: string;
  [key: string]: any;
};

type Activity = {
  kind?: string;
  activation?: string;
  attack?: { bonus?: number; type?: string; reach?: number; range?: number; long?: number; units?: string };
  save?: { abilities?: string[]; dc?: number; onSave?: string };
  damageParts?: Array<{ average?: number; formula?: string; types?: string[] }>;
};

type Entry = {
  name?: string;
  description?: string;
  pageBucket?: string;
  order?: number;
  source_book?: string;
  uses?: any;
  costs?: number;
  activities?: Activity[];
};

type SpellRef = {
  identifier?: string;
  name?: string;
  level?: number;
  method?: string;
  uses?: any;
};

type Spellcasting = {
  ability?: string;
  level?: number;
  saveDc?: number;
  attackBonus?: number;
  method?: string;
  slots?: Record<string, number>;
  pactSlots?: { count?: number; level?: number };
  prose?: string;
  spells?: SpellRef[];
};

type MonsterRecord = {
  id: string;
  name?: string;
  identifier?: string;
  sourceId?: string;
  page?: string;
  sourceBook?: string;
  imageUrl?: string;
  tokenImageUrl?: string;
  cr?: number | null;
  xp?: number | null;
  creatureType?: string;
  typeSubtype?: string | null;
  swarmSize?: string | null;
  size?: string;
  alignment?: string | null;
  ac?: number | null;
  acNote?: string | null;
  hp?: number | null;
  hpFormula?: string | null;
  proficiencyBonus?: number | null;
  passivePerception?: number | null;
  legendaryActionCount?: number | null;
  legendaryResistanceCount?: number | null;
  lairInitiative?: number | null;
  legendaryActionsPreamble?: string | null;
  movement?: any;
  abilities?: Record<string, number>;
  saves?: Record<string, number>;
  skills?: Record<string, { bonus?: number; expertise?: boolean }>;
  senses?: any;
  damageResistances?: any;
  damageImmunities?: any;
  damageVulnerabilities?: any;
  conditionImmunities?: any;
  languages?: any;
  habitat?: any;
  traits?: Entry[];
  actions?: Entry[];
  bonusActions?: Entry[];
  reactions?: Entry[];
  legendaryActions?: Entry[];
  lairActions?: Entry[];
  regionalEffects?: Array<{ name?: string; description?: string; sourceBook?: string }>;
  spellcasting?: Spellcasting[];
  biography?: string;
  [key: string]: any;
};

interface Props {
  monsterId: string | null;
  source?: MonsterDetailSource;
  emptyMessage?: string;
}

const SECTION_OFFSETS = ['st', 'nd', 'rd'];
function ordinal(n: number): string {
  const v = Math.abs(n) % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${SECTION_OFFSETS[(v % 10) - 1] || 'th'}`;
}

export default function MonsterDetailPanel({
  monsterId,
  source,
  emptyMessage = 'Select a monster from the list to view its stat block.',
}: Props) {
  const [byId, setById] = useState<Record<string, MonsterRecord>>({});
  const [loading, setLoading] = useState(false);
  const [showLore, setShowLore] = useState(false);

  useEffect(() => {
    if (!monsterId) return;
    if (byId[monsterId]) return;
    let active = true;
    setLoading(true);
    fetchDocument<any>('monsters', monsterId)
      .then((data) => {
        if (!active || !data) return;
        setById((prev) => ({ ...prev, [monsterId]: data as MonsterRecord }));
      })
      .catch((err) => console.error('[MonsterDetailPanel] failed to load monster:', err))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [monsterId, byId]);

  // Collapse lore whenever the selected monster changes.
  useEffect(() => { setShowLore(false); }, [monsterId]);

  const monster = monsterId ? byId[monsterId] : null;

  const sourceAbbrev = source?.abbreviation || source?.shortName || monster?.sourceBook || '';

  if (!monsterId) {
    return <div className="px-8 py-20 text-center text-ink/45">{emptyMessage}</div>;
  }
  if (loading && !monster) {
    return <div className="px-8 py-20 text-center text-ink/45">Loading stat block…</div>;
  }
  if (!monster) return null;

  const typeLine = formatTypeLine(monster);
  const acText = monster.ac != null
    ? `${monster.ac}${monster.acNote ? ` (${monster.acNote})` : ''}`
    : '—';
  const hpText = monster.hp != null
    ? `${monster.hp}${monster.hpFormula ? ` (${monster.hpFormula})` : ''}`
    : '—';
  const crText = monster.cr != null
    ? `${formatCr(monster.cr)}${monster.xp != null ? ` (${formatXp(monster.xp)} XP)` : ''}`
    : '—';

  const senseList = formatSenses(monster.senses);
  if (monster.passivePerception != null) {
    senseList.push(`passive Perception ${monster.passivePerception}`);
  }

  const dmgVuln = formatDamageMod(monster.damageVulnerabilities);
  const dmgRes = formatDamageMod(monster.damageResistances);
  const dmgImm = formatDamageMod(monster.damageImmunities);
  const condImm = formatStringList(monster.conditionImmunities);
  const languages = formatLanguages(monster.languages);
  const habitat = formatStringList(monster.habitat);

  const savesText = formatSaves(monster.saves);

  return (
    <div className="flex flex-col min-h-full">
      {/* ── Header ── */}
      <div className="border-b border-gold/15 px-6 py-5">
        <div className="flex items-start gap-5">
          <MonsterArtPreview
            src={monster.imageUrl}
            fallbackSrc={monster.tokenImageUrl}
            alt={monster.name || 'Monster'}
            size={96}
          />
          <div className="flex-1 min-w-0 space-y-1.5">
            <h2 className="font-serif text-3xl xl:text-4xl font-bold uppercase tracking-tight text-gold leading-tight">
              {monster.name}
            </h2>
            <p className="font-serif italic text-ink/75 text-sm">{typeLine}</p>
          </div>
          {sourceAbbrev ? (
            <div className="flex flex-col items-end gap-2 shrink-0">
              {monster.sourceId ? (
                <Link
                  to={`/sources/view/${monster.sourceId}`}
                  className="text-sm font-bold text-gold/75 hover:text-gold underline-offset-2 hover:underline transition-colors"
                  title={String(source?.name || sourceAbbrev)}
                >
                  {sourceAbbrev}
                  {monster.page ? <span className="text-ink/35 font-normal ml-1">p{monster.page}</span> : null}
                </Link>
              ) : (
                <span className="text-sm font-bold text-gold/75">
                  {sourceAbbrev}
                  {monster.page ? <span className="text-ink/35 font-normal ml-1">p{monster.page}</span> : null}
                </span>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {/* ── AC / HP / Speed strip ── */}
      <div className="border-b border-gold/15 px-6 py-4 grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3 text-sm">
        <StatInline label="Armor Class" value={acText} />
        <StatInline label="Hit Points" value={hpText} />
        <StatInline label="Speed" value={formatSpeed(monster.movement)} />
      </div>

      {/* ── Abilities grid ── */}
      <div className="border-b border-gold/15 px-6 py-4">
        <div className="grid grid-cols-6 gap-2 text-center">
          {ABILITY_ORDER.map((ab) => {
            const score = Number(monster.abilities?.[ab] ?? 10);
            return (
              <div key={ab} className="space-y-0.5">
                <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-gold/75">
                  {ABILITY_ABBR[ab]}
                </div>
                <div className="text-sm text-ink/95">
                  {score} <span className="text-ink/60">({formatBonus(abilityMod(score))})</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Secondary stats ── */}
      <div className="border-b border-gold/15 px-6 py-4 space-y-1.5 text-sm">
        {savesText ? <StatRow label="Saving Throws" value={savesText} /> : null}
        {monster.skills && Object.keys(monster.skills).length ? (
          <SkillsRow skills={monster.skills} />
        ) : null}
        {dmgVuln ? <StatRow label="Damage Vulnerabilities" value={dmgVuln} /> : null}
        {dmgRes ? <StatRow label="Damage Resistances" value={dmgRes} /> : null}
        {dmgImm ? <StatRow label="Damage Immunities" value={dmgImm} /> : null}
        {condImm ? <StatRow label="Condition Immunities" value={condImm} /> : null}
        {senseList.length ? <StatRow label="Senses" value={senseList.join(', ')} /> : null}
        <StatRow label="Languages" value={languages} />
        <div className="flex flex-wrap gap-x-8 gap-y-1.5 pt-0.5">
          <StatRow label="Challenge" value={crText} inline />
          {monster.proficiencyBonus != null ? (
            <StatRow label="Proficiency Bonus" value={formatBonus(monster.proficiencyBonus)} inline />
          ) : null}
        </div>
      </div>

      {/* ── Body sections ── */}
      <div className="px-6 py-4 space-y-5">
        <EntrySection entries={monster.traits} legendaryResistanceCount={monster.legendaryResistanceCount} />
        <EntrySection title="Actions" entries={monster.actions} />
        <EntrySection title="Bonus Actions" entries={monster.bonusActions} />
        <EntrySection title="Reactions" entries={monster.reactions} />
        <EntrySection
          title="Legendary Actions"
          entries={monster.legendaryActions}
          preamble={monster.legendaryActionsPreamble ? stripRefMenu(monster.legendaryActionsPreamble) : null}
        />
        <EntrySection
          title="Lair Actions"
          entries={monster.lairActions}
          lairInitiative={monster.lairInitiative}
        />
        <RegionalSection entries={monster.regionalEffects} />
        <SpellcastingSection blocks={monster.spellcasting} />
        {habitat ? (
          <p className="text-sm text-ink/80">
            <span className="font-bold text-gold/80">Environment:</span> {habitat}
          </p>
        ) : null}
      </div>

      {/* ── Lore (collapsible) ── */}
      {monster.biography && monster.biography.trim() ? (
        <div className="mt-auto border-t border-gold/10 px-6 py-3">
          <button
            type="button"
            onClick={() => setShowLore((s) => !s)}
            className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded border border-gold/15 bg-gold/[0.03] hover:bg-gold/[0.07] text-[10px] font-bold uppercase tracking-[0.18em] text-gold/75 transition-colors"
            aria-expanded={showLore}
          >
            <span>{showLore ? 'Hide lore' : 'Show lore'}</span>
            {showLore ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          {showLore ? (
            <div
              className="mt-3 prose max-w-none prose-p:text-ink/90 prose-strong:text-ink prose-em:text-ink/85 prose-li:text-ink/85 prose-headings:text-gold/90 prose-h3:text-base prose-h4:text-sm"
              dangerouslySetInnerHTML={{ __html: bbcodeToHtml(cleanMonsterProse(monster.biography)) }}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ─── stat sub-components ─────────────────────────────────────────────────────

function StatInline({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-gold/75">{label}</div>
      <div className="mt-0.5 text-ink/95">{value}</div>
    </div>
  );
}

function StatRow({ label, value, inline }: { label: string; value: string; inline?: boolean }) {
  if (inline) {
    return (
      <span className="text-ink/90">
        <span className="font-bold text-gold/80">{label}</span> {value}
      </span>
    );
  }
  return (
    <p className="text-ink/90 leading-snug">
      <span className="font-bold text-gold/80">{label}</span> {value}
    </p>
  );
}

function SkillsRow({ skills }: { skills: Record<string, { bonus?: number; expertise?: boolean }> }) {
  const parts = Object.entries(skills)
    .sort((a, b) => (SKILL_NAME[a[0]] || a[0]).localeCompare(SKILL_NAME[b[0]] || b[0]))
    .map(([slug, v]) => ({
      name: SKILL_NAME[slug] || titleCase(slug),
      bonus: formatBonus(Number(v?.bonus ?? 0)),
      expertise: !!v?.expertise,
    }));
  return (
    <p className="text-ink/90 leading-snug">
      <span className="font-bold text-gold/80">Skills</span>{' '}
      {parts.map((p, i) => (
        <React.Fragment key={p.name}>
          {i > 0 ? ', ' : ''}
          {p.name} {p.bonus}
          {p.expertise ? (
            <span
              className="ml-1 align-middle text-[9px] font-bold uppercase tracking-wider text-gold/70"
              title="Expertise (doubled proficiency)"
            >
              ◆
            </span>
          ) : null}
        </React.Fragment>
      ))}
    </p>
  );
}

function formatSaves(saves?: Record<string, number>): string {
  if (!saves || typeof saves !== 'object') return '';
  return ABILITY_ORDER
    .filter((ab) => saves[ab] != null)
    .map((ab) => `${ABILITY_ABBR[ab]} ${formatBonus(Number(saves[ab]))}`)
    .join(', ');
}

// ─── body sections ───────────────────────────────────────────────────────────

function MonsterProse({ bbcode }: { bbcode: string }) {
  const html = useMemo(() => bbcodeToHtml(cleanMonsterProse(bbcode)), [bbcode]);
  return (
    <span
      className="prose prose-sm max-w-none inline prose-p:inline prose-p:text-ink/90 prose-strong:text-ink prose-em:text-ink/85 prose-li:text-ink/85"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function EntryBody({ entry }: { entry: Entry }) {
  const raw = String(entry.description || '').trim();
  // Most monster actions carry full prose; only synthesise from the activity
  // tuple when the body is empty (rare, but keeps the entry from rendering blank).
  if (!raw) {
    const acts = Array.isArray(entry.activities) ? entry.activities : [];
    const synth = acts.map(synthesizeActivityLine).filter(Boolean).join(' ');
    if (!synth) return null;
    return <MonsterProse bbcode={synth} />;
  }
  return <MonsterProse bbcode={raw} />;
}

function entrySuffix(entry: Entry): string {
  const parts: string[] = [];
  const uses = formatUsesSuffix(entry.uses);
  if (uses) parts.push(uses);
  if (entry.costs && entry.costs > 1) parts.push(`(Costs ${entry.costs} Actions)`);
  return parts.join(' ');
}

function EntrySection({
  title, entries, preamble, lairInitiative, legendaryResistanceCount,
}: {
  title?: string;
  entries?: Entry[];
  preamble?: string | null;
  lairInitiative?: number | null;
  legendaryResistanceCount?: number | null;
}) {
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length && !preamble) return null;

  return (
    <section className="space-y-2">
      {title ? (
        <h3 className="font-serif text-lg font-bold text-gold border-b border-gold/20 pb-1">
          {title}
        </h3>
      ) : null}
      {preamble ? (
        <div className="text-sm text-ink/85">
          <MonsterProse bbcode={preamble} />
        </div>
      ) : null}
      {lairInitiative != null ? (
        <p className="text-xs italic text-ink/60">On initiative count {lairInitiative} (losing ties), the creature takes a lair action.</p>
      ) : null}
      <div className="space-y-2">
        {list.map((entry, i) => {
          const name = String(entry.name || '').trim();
          // Legendary Resistance's "(N/Day)" rides the row count, not item uses.
          let suffix = entrySuffix(entry);
          if (!suffix && /^legendary resistance$/i.test(name) && legendaryResistanceCount) {
            suffix = `(${legendaryResistanceCount}/Day)`;
          }
          // Unnamed entries (MM lair/regional bullets) render as plain bullets.
          if (!name) {
            return (
              <p key={i} className="text-sm text-ink/90 leading-snug pl-4 relative before:content-['•'] before:absolute before:left-0 before:text-gold/60">
                <EntryBody entry={entry} />
              </p>
            );
          }
          return (
            <p key={i} className="text-sm leading-snug">
              <span className="font-bold italic text-ink">{name}.</span>
              {suffix ? <span className="text-ink/70 italic"> {suffix}</span> : null}{' '}
              <EntryBody entry={entry} />
            </p>
          );
        })}
      </div>
    </section>
  );
}

function RegionalSection({ entries }: { entries?: Array<{ name?: string; description?: string }> }) {
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) return null;
  return (
    <section className="space-y-2">
      <h3 className="font-serif text-lg font-bold text-gold border-b border-gold/20 pb-1">
        Regional Effects
      </h3>
      <div className="space-y-2">
        {list.map((entry, i) => {
          const name = String(entry.name || '').trim();
          const isHeading = /^regional effects$/i.test(name);
          return (
            <div key={i} className="text-sm leading-snug">
              {name && !isHeading ? <span className="font-bold italic text-ink">{name}. </span> : null}
              <MonsterProse bbcode={String(entry.description || '')} />
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SpellcastingSection({ blocks }: { blocks?: Spellcasting[] }) {
  const list = Array.isArray(blocks) ? blocks : [];
  if (!list.length) return null;
  return (
    <section className="space-y-3">
      <h3 className="font-serif text-lg font-bold text-gold border-b border-gold/20 pb-1">
        Spellcasting
      </h3>
      {list.map((block, i) => (
        <SpellcastingBlock key={i} block={block} />
      ))}
    </section>
  );
}

// Strip an embedded `<ul>` menu of label-less `@UUID` refs from a preamble —
// used for both the spellcasting block (the spell list re-renders from the
// resolved `spells[]` array) and the legendary preamble (the action-name menu
// duplicates the legendaryActions entries rendered below).
function stripRefMenu(prose: string): string {
  return String(prose || '')
    .replace(/<ul\b[^>]*>[\s\S]*?<\/ul>/gi, '')
    .replace(/@UUID\[[^\]]*\](?:\{[^}]*\})?/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function SpellcastingBlock({ block }: { block: Spellcasting }) {
  const preamble = stripRefMenu(block.prose || '');
  const spells = Array.isArray(block.spells) ? block.spells : [];

  // Group by level. Within each level, slot count comes from `slots` (prepared
  // casters); innate casters surface per-spell uses instead.
  const byLevel = new Map<number, SpellRef[]>();
  for (const sp of spells) {
    const lvl = Number(sp.level ?? 0);
    if (!byLevel.has(lvl)) byLevel.set(lvl, []);
    byLevel.get(lvl)!.push(sp);
  }
  const levels = [...byLevel.keys()].sort((a, b) => a - b);

  return (
    <div className="space-y-2">
      {preamble ? (
        <div className="text-sm text-ink/85">
          <MonsterProse bbcode={preamble} />
        </div>
      ) : null}
      {levels.length ? (
        <ul className="space-y-1 text-sm">
          {levels.map((lvl) => {
            const slotCount = block.slots?.[`spell${lvl}`];
            const label = lvl === 0
              ? 'Cantrips (at will)'
              : `${ordinal(lvl)} Level${slotCount ? ` (${slotCount} slot${slotCount === 1 ? '' : 's'})` : ''}`;
            const group = byLevel.get(lvl)!;
            return (
              <li key={lvl} className="text-ink/90">
                <span className="font-bold text-gold/75">{label}:</span>{' '}
                {group.map((sp, idx) => (
                  <React.Fragment key={`${sp.identifier || sp.name}-${idx}`}>
                    {idx > 0 ? ', ' : ''}
                    {sp.identifier ? (
                      <Link
                        to={`/compendium/spells?focus=${encodeURIComponent(sp.identifier)}`}
                        className="italic text-ink hover:text-gold underline-offset-2 hover:underline transition-colors"
                      >
                        {sp.name || titleCase(sp.identifier)}
                      </Link>
                    ) : (
                      <span className="italic">{sp.name || '—'}</span>
                    )}
                    {sp.uses ? <span className="text-ink/55"> {formatUsesSuffix(sp.uses) || ''}</span> : null}
                  </React.Fragment>
                ))}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

// ─── art preview ─────────────────────────────────────────────────────────────

// `Image()`-probe with a token-art fallback, then a PawPrint glyph. Many
// monster portraits hotlink cdn.5e.tools; if the portrait 404s we fall back to
// the (local) token image, then the glyph — mirrors `FeatArtPreview`.
function MonsterArtPreview({ src, fallbackSrc, alt, size }: { src?: string; fallbackSrc?: string; alt: string; size: number }) {
  const candidates = useMemo(
    () => [src, fallbackSrc].map((s) => String(s ?? '').trim()).filter(Boolean),
    [src, fallbackSrc],
  );
  const [idx, setIdx] = useState(0);
  const [status, setStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>(
    () => (candidates.length ? 'loading' : 'idle'),
  );

  useEffect(() => {
    setIdx(0);
    setStatus(candidates.length ? 'loading' : 'idle');
  }, [candidates]);

  useEffect(() => {
    const current = candidates[idx];
    if (!current) { setStatus(candidates.length ? 'error' : 'idle'); return; }
    let cancelled = false;
    const image = new Image();
    setStatus('loading');
    image.onload = () => { if (!cancelled) setStatus('loaded'); };
    image.onerror = () => {
      if (cancelled) return;
      if (idx + 1 < candidates.length) setIdx(idx + 1);
      else setStatus('error');
    };
    image.src = current;
    return () => { cancelled = true; };
  }, [candidates, idx]);

  const dimensionStyle = { width: size, height: size };
  const showImage = status === 'loaded' && candidates[idx];

  return (
    <div className="relative shrink-0 overflow-hidden rounded-md border border-gold/15 bg-background/30" style={dimensionStyle}>
      {showImage ? (
        <img
          src={candidates[idx]}
          alt={alt}
          loading="lazy"
          decoding="async"
          className="block rounded object-cover"
          style={dimensionStyle}
        />
      ) : (
        <div className="flex items-center justify-center rounded bg-background/40 text-ink/35" style={dimensionStyle}>
          {status === 'loading' ? (
            <div className="h-8 w-8 rounded-full border-2 border-gold border-t-transparent animate-spin" />
          ) : (
            <PawPrint className="h-8 w-8" />
          )}
        </div>
      )}
    </div>
  );
}
