// Preview surfaces for the Appearance theme preview — faithful SIMULATIONS of
// the app's real pages (Article, Compendium, Class view) plus a generic
// component gallery and the opacity ladder. They mirror the actual pages'
// structure and classes (and use the real BBCodeRenderer for prose), so the
// preview looks like the real thing — but they're static (no router/fetch), so
// they render instantly inside the scoped theme wrapper and re-theme live.

import type { FC, ReactNode } from "react";
import { Search, SlidersHorizontal, Star, Settings as SettingsIcon } from "lucide-react";
import BBCodeRenderer from "../BBCodeRenderer";
import SpellDetailPanel from "../compendium/SpellDetailPanel";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Badge } from "../ui/badge";

/* ------------------------------ Article page ----------------------------- */
// Mirrors LoreArticle: card panel, centred gold title + italic subtitle, then a
// prose body (real renderer) with an "on this page" sidebar.

// Real content — the "Magic" lore article from the compendium, VERBATIM (cut
// cleanly after the Arcane section; nothing reworded). Headings + section names
// are the article's own.
const ARTICLE_BODY = `Magic is the fundamental energy found in every reality and in all things, from the spark of thought, a spell once cast or the fuel of distant stars. It is neither good nor evil. It simply is, and it infuses everything. The force that drives a spell, a healing prayer, or a feat of impossible endurance all draw from the same well, the only difference is how a practitioner accesses it. The scholars of the present age call this well the Inheritance, a last gift from a primordial entity. In common speech it is named simply the Maliath, and it is the source from which every working of magic, in every tradition, is ultimately drawn.

[h1]Traditions[/h1]

The sheer breadth of the Maliath has given rise to countless ideas about what magic is and how it ought to be used. Over time, these ideas settled into six broad traditions of practice. None of them are wrong. Each is simply shaped by the philosophy, discipline, or relationship that grants its followers access to it. A tradition is not a kind of magic, only a path toward using it. Two casters reaching the same effect through different traditions will look, feel, and cost something entirely different, yet at the core they are touching the same thing.

[h2]Arcane[/h2]

The arcane tradition is the study of the rules of magic. It begins from a single line of reasoning: what can be observed can be understood, what is understood can be modified, and what can be modified can, in turn, be controlled. Every arcane discipline of the present age descends from that thought. Arcane practitioners, through runes drawn in a precise sequence, words spoken in the correct tone and order or gestures shaped to correct measurements, have learned to instruct magic.`;

const ArticlePage: FC = () => (
  <div className="w-full">
    <div className="bg-card border border-gold/15 rounded-xl overflow-hidden">
      <div className="h-28 bg-gradient-to-b from-gold/15 to-transparent border-b border-gold/15 flex items-end justify-center pb-3">
        <span className="label-text text-gold text-[10px] uppercase tracking-widest">Lore</span>
      </div>
      <div className="text-center py-6 px-6 border-b border-gold/15">
        <h1 className="text-4xl md:text-5xl font-serif font-bold tracking-wide text-gold/95">Magic</h1>
      </div>
      <div className="grid lg:grid-cols-3 gap-8 p-6">
        <div className="lg:col-span-2">
          <BBCodeRenderer content={ARTICLE_BODY} />
        </div>
        <aside className="space-y-4">
          <div className="border border-gold/15 bg-gold/5 p-4">
            <div className="label-text text-gold mb-2">On this page</div>
            {/* The article's real top-level sections. */}
            <ul className="space-y-1.5 text-sm text-ink/65">
              <li className="hover:text-gold cursor-pointer">Traditions</li>
              <li className="hover:text-gold cursor-pointer">The Schools of Magic</li>
              <li className="hover:text-gold cursor-pointer">Branches</li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  </div>
);

/* ---------------------------- Compendium page ---------------------------- */
// The REAL compendium content view — the same `SpellDetailPanel` the live
// /compendium/spells browser renders in its right pane. It accepts a raw-row
// `spellData` prop (the proposal editor's escape hatch) so it renders the
// authentic header, stat block, and prose body from a static payload — no
// fetch, no selection plumbing — and re-themes live like every other surface.

// Raw spell row (snake_case, as stored in D1). `mapRawSpellRow` parses
// `foundry_data` into the foundryShell the stat-block rows read, so Casting
// Time / Range / Components / Duration render real, formatted values.
const SAMPLE_SPELL_ROW = {
  id: "preview-fireball",
  name: "Fireball",
  level: 3,
  school: "evo",
  description: `A bright streak flashes from your pointing finger to a point you choose within range, then blossoms with a low roar into an explosion of flame. Each creature in a 20-foot-radius sphere centered on that point must make a Dexterity saving throw, taking [b]8d6 fire damage[/b] on a failed save, or half as much damage on a successful one.

The fire spreads around corners. It ignites flammable objects in the area that aren't being worn or carried.

[b]At Higher Levels.[/b] When you cast this spell using a spell slot of 4th level or higher, the damage increases by 1d6 for each slot level above 3rd.`,
  tags: [],
  foundry_data: {
    activation: { type: "action", value: 1 },
    range: { value: "150", units: "feet" },
    duration: { units: "inst" },
    properties: ["vocal", "somatic", "material"],
    materials: { value: "a tiny ball of bat guano and sulfur" },
  },
};

// Static stand-ins for the list table + favorites pane — pure navigation
// chrome (the real shell owns viewport-lock + virtualization, which would
// hijack the page and blow out of the preview frame). The DETAIL pane is the
// real component; everything left of it is a faithful silhouette.
const SAMPLE_LIST: { name: string; lv: string; time: string; school: string; range: string; src: string }[] = [
  { name: "Aganazzar's Scorcher", lv: "2", time: "1 action", school: "Evoc.", range: "30 ft", src: "XGE" },
  { name: "Burning Hands", lv: "1", time: "1 action", school: "Evoc.", range: "Self", src: "PHB" },
  { name: "Counterspell", lv: "3", time: "1 reaction", school: "Abju.", range: "60 ft", src: "PHB" },
  { name: "Delayed Blast Fireball", lv: "7", time: "1 action", school: "Evoc.", range: "150 ft", src: "PHB" },
  { name: "Fireball", lv: "3", time: "1 action", school: "Evoc.", range: "150 ft", src: "PHB" },
  { name: "Fire Bolt", lv: "C", time: "1 action", school: "Evoc.", range: "120 ft", src: "PHB" },
  { name: "Fire Shield", lv: "4", time: "1 action", school: "Evoc.", range: "Self", src: "PHB" },
  { name: "Flame Strike", lv: "5", time: "1 action", school: "Evoc.", range: "60 ft", src: "PHB" },
  { name: "Hellish Rebuke", lv: "1", time: "1 reaction", school: "Evoc.", range: "60 ft", src: "PHB" },
  { name: "Meteor Swarm", lv: "9", time: "1 action", school: "Evoc.", range: "1 mile", src: "PHB" },
  { name: "Scorching Ray", lv: "2", time: "1 action", school: "Evoc.", range: "120 ft", src: "PHB" },
  { name: "Wall of Fire", lv: "4", time: "1 action", school: "Evoc.", range: "120 ft", src: "PHB" },
];

const SAMPLE_FAVORITES: { name: string; meta: string; src: string }[] = [
  { name: "Counterspell", meta: "Lv 3 · Abjuration", src: "PHB" },
  { name: "Misty Step", meta: "Lv 2 · Conjuration", src: "PHB" },
];

const CompendiumPage: FC = () => (
  <div className="flex h-full flex-col gap-2 text-ink">
    {/* Filter bar — search + Filters + Reset + count + Settings */}
    <div className="shrink-0 flex items-center gap-2">
      <div className="flex-1 flex items-center gap-2 h-9 px-3 border border-gold/25 bg-background/50 text-ink/40 text-sm min-w-0">
        <Search className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate">Search spell name, source, or identifier</span>
      </div>
      <span className="inline-flex items-center gap-1.5 h-9 px-3 border border-gold/25 text-gold text-[11px] font-bold uppercase tracking-wide shrink-0">
        <SlidersHorizontal className="w-3.5 h-3.5" /> Filters <span className="text-[10px] bg-gold/20 px-1.5 rounded-sm">54</span>
      </span>
      <span className="hidden sm:inline-flex items-center h-9 px-3 border border-gold/25 text-ink/55 text-[11px] uppercase tracking-wide shrink-0">Reset</span>
      <span className="hidden md:inline text-[11px] font-mono text-ink/55 shrink-0 px-1">542 / 542</span>
      <span className="inline-flex items-center gap-1.5 h-9 px-3 border border-gold/25 text-gold text-[11px] font-bold uppercase tracking-wide shrink-0">
        <SettingsIcon className="w-3.5 h-3.5" /> <span className="hidden lg:inline">Settings</span>
      </span>
    </div>

    {/* Three panes — favorites | list | detail */}
    <div className="flex-1 min-h-0 flex gap-3">
      {/* Favorites pane */}
      <div className="hidden lg:flex w-[190px] flex-none flex-col border border-gold/15 bg-card/50 overflow-hidden">
        <div className="flex items-center justify-between gap-2 border-b border-gold/15 bg-background/35 px-3 py-2.5 shrink-0">
          <span className="flex items-center gap-1.5">
            <Star className="w-3.5 h-3.5 text-gold/85 fill-gold/45" />
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gold/75">Favorites</span>
          </span>
          <span className="text-[10px] text-ink/45">{SAMPLE_FAVORITES.length}</span>
        </div>
        <div className="px-2 py-2 border-b border-gold/10">
          <div className="h-7 flex items-center px-2 border border-gold/20 bg-background/40 text-[11px] text-ink/55">Universal Favorite</div>
        </div>
        <div className="divide-y divide-gold/5 overflow-y-auto custom-scrollbar">
          {SAMPLE_FAVORITES.map((f) => (
            <div key={f.name} className="px-3 py-2 hover:bg-gold/5">
              <div className="flex items-center justify-between gap-1">
                <span className="truncate text-sm text-ink">{f.name}</span>
                <Star className="w-3 h-3 text-gold/80 fill-gold/40 shrink-0" />
              </div>
              <div className="text-[9px] uppercase tracking-wide text-ink/45 mt-0.5">{f.meta}</div>
            </div>
          ))}
        </div>
      </div>

      {/* List pane */}
      <div className="hidden md:flex w-[300px] flex-none flex-col border border-gold/15 bg-card/50 overflow-hidden">
        <div className="grid gap-2 px-3 py-2.5 border-b border-gold/15 bg-background/35 text-[10px] font-bold uppercase tracking-[0.16em] text-gold/75"
          style={{ gridTemplateColumns: "minmax(0,1fr) 1.4rem 2.4rem 2.6rem" }}>
          <span>Name</span><span className="justify-self-center">Lv</span><span className="justify-self-center">Sch</span><span className="justify-self-end">Src</span>
        </div>
        <div className="divide-y divide-gold/5 overflow-y-auto custom-scrollbar">
          {SAMPLE_LIST.map((s) => {
            const selected = s.name === "Fireball";
            return (
              <div key={s.name}
                className={`grid gap-2 items-center px-3 h-9 cursor-pointer transition-colors ${selected ? "bg-gold/15" : "hover:bg-gold/5"}`}
                style={{ gridTemplateColumns: "minmax(0,1fr) 1.4rem 2.4rem 2.6rem" }}>
                <span className="truncate text-[12px] font-semibold text-ink">{s.name}</span>
                <span className="justify-self-center text-[11px] text-ink/65">{s.lv}</span>
                <span className="justify-self-center text-[11px] text-ink/65">{s.school}</span>
                <span className="justify-self-end text-[11px] font-bold text-gold/80">{s.src}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Detail pane — the REAL SpellDetailPanel */}
      <div className="flex-1 min-w-0 flex flex-col border border-gold/15 bg-card/50 overflow-hidden">
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
          <SpellDetailPanel spellId={SAMPLE_SPELL_ROW.id} spellData={SAMPLE_SPELL_ROW} />
        </div>
      </div>
    </div>
  </div>
);

/* ----------------------------- Class view page --------------------------- */
// Mirrors the revamped ClassView: hero banner, Core Traits row, full-width tab
// strip, a feature list with level badges, and an in-page jump rail. Populated
// with the REAL Artificer class + its actual features from the compendium.

// Real Artificer fields (verbatim). Core Traits are limited to values that are
// actually stored on the class record — hit die, saving throws, spellcasting,
// ASI levels — rather than invented proficiency names (those are stored as
// unresolved ID refs the static preview can't expand).
const ARTIFICER_PREVIEW = "Artificers are magical inventors that use arcane knowledge and engineering to infuse tools, weapons and constructs with enchantments.";
const ARTIFICER_DESCRIPTION = `Artificers are arcane casters who channel their magic through a specific tool and are defined by their ability to infuse mundane items with magic, effectively turning equipment into customizable, semi-permanent magical gear. They are also capable of overcoming unique challenges thanks to their ability to attune to more than three items, as well as their talent for finding solutions to problems through their Flash of Genius.

Each artificer specialization reflects a distinct approach to invention, centered around particular tools and techniques. Some brew potent elixirs with alchemist's supplies, others inscribe powerful sigils using calligrapher's tools, while more mechanically inclined artificers construct intricate devices or deploy magical constructs using tinker's tools.`;

const CLASS_TRAITS = [
  { k: "Hit Die", v: "d8" },
  { k: "Saving Throws", v: "CON · INT" },
  { k: "Spellcasting", v: "Yes" },
  { k: "ASI Levels", v: "4 · 8 · 12 · 16 · 19" },
];

// Real Artificer features — names, levels, and the opening of each feature's
// description, VERBATIM (cut at a sentence boundary; nothing reworded).
const CLASS_FEATURES = [
  { level: 1, name: "Magical Tinkering", desc: "At 1st level, you've learned how to invest a spark of magic into mundane objects. To use this ability, you must have thieves' tools or artisan's tools in hand." },
  { level: 2, name: "Infuse Item", desc: "At 2nd level, you've gained the ability to imbue mundane items with certain magical infusions, turning those objects into magic items." },
  { level: 3, name: "The Right Tool for the Job", desc: "At 3rd level, you've learned how to produce exactly the tool you need: with thieves' tools or artisan's tools in hand, you can magically create one set of artisan's tools in an unoccupied space within 5 feet of you." },
  { level: 7, name: "Flash of Genius", desc: "At 7th level, you've gained the ability to come up with solutions under pressure. When you or another creature you can see within 30 feet of you makes an ability check or a saving throw, you can use your reaction to add your Intelligence modifier to the roll." },
];

const ClassViewPage: FC = () => (
  <div className="w-full space-y-6">
    <div className="bg-card border border-gold/15 rounded-xl overflow-hidden">
      <div className="h-44 relative flex items-end p-6"
        style={{ background: "linear-gradient(to top, color-mix(in oklab, var(--card) 92%, black), color-mix(in oklab, var(--gold) 12%, transparent))" }}>
        <div>
          <h1 className="font-serif text-5xl font-bold text-gold/95 drop-shadow-sm leading-none">Alternate Artificer</h1>
          <p className="text-sm italic text-ink/75 mt-2 max-w-2xl">{ARTIFICER_PREVIEW}</p>
        </div>
      </div>
      <div className="p-6 border-t border-gold/15">
        <div className="description-text text-ink/80 max-w-3xl">
          <BBCodeRenderer content={ARTIFICER_DESCRIPTION} />
        </div>
        {/* Core Traits — only values actually on the class record. */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-px mt-5 border border-gold/15 bg-gold/15">
          {CLASS_TRAITS.map((t) => (
            <div key={t.k} className="bg-card px-3 py-2">
              <div className="text-[9px] uppercase tracking-widest text-gold/70 font-bold">{t.k}</div>
              <div className="text-sm text-ink mt-0.5">{t.v}</div>
            </div>
          ))}
        </div>
      </div>
    </div>

    <div className="flex gap-1 border-b border-gold/20">
      {["Features", "Subclasses", "Spell list"].map((t, i) => (
        <span key={t} className={`px-5 py-2.5 text-xs font-bold uppercase tracking-widest border-b-2 -mb-px ${i === 0 ? "border-gold text-gold" : "border-transparent text-ink/55"}`}>{t}</span>
      ))}
    </div>

    <div className="grid lg:grid-cols-[1fr_180px] gap-6">
      <div className="space-y-3 min-w-0">
        {CLASS_FEATURES.map((f) => (
          <div key={f.name} className="border border-gold/15 bg-card/40 p-4">
            <div className="flex items-baseline gap-3">
              <span className="label-text text-gold shrink-0">Level {f.level}</span>
              <h3 className="h3-title text-ink">{f.name}</h3>
            </div>
            <p className="text-sm text-ink/65 mt-1.5 leading-relaxed">{f.desc}</p>
          </div>
        ))}
      </div>
      {/* In-page jump rail (mirrors the revamped class view) */}
      <aside className="hidden lg:block">
        <div className="sticky top-2 border border-gold/15 bg-gold/5 p-3">
          <div className="label-text text-gold mb-2">Jump to</div>
          <ul className="space-y-1 text-xs text-ink/65">
            {CLASS_FEATURES.map((f) => (
              <li key={f.name} className="flex items-baseline gap-2 hover:text-gold cursor-pointer">
                <span className="font-mono text-[10px] text-gold/70 w-4 shrink-0">{f.level}</span>
                <span className="truncate">{f.name}</span>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  </div>
);

/* --------------------------- Component gallery --------------------------- */

const ComponentsPage: FC = () => (
  <div className="max-w-3xl mx-auto px-4 space-y-7">
    <div>
      <div className="label-text text-gold mb-3">Buttons</div>
      <div className="flex flex-wrap gap-3 items-center">
        <Button>Primary</Button>
        <Button variant="outline" className="border-gold/35 text-gold">Outline</Button>
        <Button variant="ghost">Ghost</Button>
        <button className="btn-gold-solid px-4 py-2">Gold solid</button>
        <Button variant="destructive">Delete</Button>
      </div>
    </div>
    <div>
      <div className="label-text text-gold mb-3">Tags &amp; badges</div>
      <div className="flex flex-wrap gap-2 items-center">
        <Badge variant="outline" className="border-gold text-gold">Trusted player</Badge>
        <span className="px-2 py-0.5 text-[11px] border border-gold/35 text-gold uppercase tracking-wide font-bold">Evocation</span>
        <span className="px-2 py-0.5 text-[11px] bg-gold/15 text-gold border border-gold/35">Range 150 ft</span>
        <span className="px-2 py-0.5 text-[11px] bg-blood/10 text-blood border border-blood/35">Danger</span>
      </div>
    </div>
    <div>
      <div className="label-text text-gold mb-3">Form field</div>
      <div className="max-w-md space-y-1.5">
        <label className="field-label">Display name</label>
        <Input placeholder="e.g. Elara the Wise" className="bg-background border-gold/25" />
        <p className="text-[11px] text-ink/45 italic">Shown on your public profile.</p>
      </div>
    </div>
    <div>
      <div className="label-text text-gold mb-3">Cards</div>
      <div className="grid sm:grid-cols-2 gap-4">
        {[["Active campaign", "The Amber Coast", "4 players · Session 12"], ["Recent lore", "The Sunken City of Vol", "edited 2 days ago"]].map(([tag, title, meta]) => (
          <div key={tag} className="bg-card border border-gold/25 p-5">
            <div className="label-text text-gold">{tag}</div>
            <h3 className="h3-title text-ink mt-1">{title}</h3>
            <p className="text-sm text-ink/55 mt-1">{meta}</p>
          </div>
        ))}
      </div>
    </div>
  </div>
);

/* --------------------------- Opacity ladder ------------------------------ */

const mix = (v: "--ink" | "--gold", n: number) => `color-mix(in oklab, var(${v}) ${n}%, transparent)`;

const INK_ROWS: { n: number; note: string; el: ReactNode }[] = [
  { n: 5, note: "divider rule", el: (
    <span className="inline-flex flex-col text-[11px] leading-tight" style={{ color: mix("--ink", 85) }}>
      Spells<span className="my-1 border-t" style={{ borderColor: mix("--ink", 5) }} />Feats
    </span>) },
  { n: 15, note: "disabled item", el: <span className="text-xs line-through" style={{ color: mix("--ink", 15) }}>Archived spell</span> },
  { n: 25, note: "captions / counts", el: <span className="text-[11px]" style={{ color: mix("--ink", 25) }}>12 results</span> },
  { n: 35, note: "input placeholder", el: (
    <span className="inline-block px-2 py-1 text-xs border" style={{ borderColor: mix("--ink", 15) }}>
      <span style={{ color: mix("--ink", 35) }}>Search the compendium…</span>
    </span>) },
  { n: 45, note: "muted metadata", el: <span className="text-[11px]" style={{ color: mix("--ink", 45) }}>Updated 2 days ago · v3</span> },
  { n: 55, note: "secondary label", el: <span className="text-[10px] uppercase tracking-widest font-bold" style={{ color: mix("--ink", 55) }}>Prerequisites</span> },
  { n: 65, note: "help / hint text", el: <span className="text-xs" style={{ color: mix("--ink", 65) }}>Visible to all players in this campaign.</span> },
  { n: 75, note: "emphasised note", el: <span className="text-xs italic" style={{ color: mix("--ink", 75) }}>Requires attunement.</span> },
  { n: 85, note: "field label", el: <span className="text-[10px] uppercase tracking-widest font-bold" style={{ color: mix("--ink", 85) }}>Display name</span> },
  { n: 95, note: "primary body copy", el: <span className="text-sm" style={{ color: mix("--ink", 95) }}>A bright streak flashes from your finger.</span> },
];

const GOLD_ROWS: { n: number; note: string; el: ReactNode }[] = [
  { n: 5, note: "row hover fill", el: <span className="inline-block px-2 py-1 text-xs" style={{ background: mix("--gold", 5), color: mix("--ink", 85) }}>Fireball</span> },
  { n: 15, note: "panel border / selected row", el: <span className="inline-block px-2 py-1 text-xs border" style={{ borderColor: mix("--gold", 15), background: mix("--gold", 15), color: mix("--ink", 85) }}>Selected: Fireball</span> },
  { n: 25, note: "section border", el: <span className="inline-block border-t pt-1 text-[11px]" style={{ borderColor: mix("--gold", 25), color: mix("--ink", 55) }}>Spell details</span> },
  { n: 35, note: "tag / chip border", el: <span className="inline-block px-2 py-0.5 text-[10px] uppercase tracking-wide font-bold border" style={{ borderColor: mix("--gold", 35), color: mix("--gold", 85) }}>Evocation</span> },
  { n: 45, note: "active / focus border", el: <span className="inline-block px-2 py-1 text-xs border" style={{ borderColor: mix("--gold", 45), color: mix("--ink", 85) }}>Focused field</span> },
  { n: 55, note: "emphasis border", el: <span className="inline-block px-2 py-0.5 text-[11px] border-2" style={{ borderColor: mix("--gold", 55), color: mix("--ink", 85) }}>Highlighted</span> },
  { n: 65, note: "secondary gold label", el: <span className="text-[11px] uppercase tracking-widest font-bold" style={{ color: mix("--gold", 65) }}>Level 3 · Evocation</span> },
  { n: 75, note: "gold sublabel", el: <span className="text-xs font-bold" style={{ color: mix("--gold", 75) }}>8d6 fire</span> },
  { n: 85, note: "near-full accent", el: <span className="text-sm font-bold" style={{ color: mix("--gold", 85) }}>Add to spellbook</span> },
  { n: 95, note: "full accent text", el: <span className="font-serif text-base font-bold" style={{ color: mix("--gold", 95) }}>Fireball</span> },
];

const TierColumn: FC<{ title: string; rows: { n: number; note: string; el: ReactNode }[] }> = ({ title, rows }) => (
  <div>
    <div className="text-[10px] uppercase tracking-widest text-gold font-bold mb-2">{title} — real examples</div>
    <div className="space-y-2.5">
      {rows.map((r) => (
        <div key={r.n} className="flex items-center gap-3 min-h-[26px]">
          <span className="text-[10px] font-mono w-7 shrink-0 text-muted-foreground">/{r.n}</span>
          <span className="flex-1 min-w-0">{r.el}</span>
          <span className="text-[9px] text-muted-foreground italic shrink-0 w-24 text-right leading-tight">{r.note}</span>
        </div>
      ))}
    </div>
  </div>
);

const OpacityTiersPage: FC = () => (
  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
    <TierColumn title="Text (ink)" rows={INK_ROWS} />
    <TierColumn title="Highlight (gold)" rows={GOLD_ROWS} />
  </div>
);

export type SurfaceKey = "article" | "compendium" | "class";

// User-facing surfaces are the real pages only. ComponentsPage / OpacityTiersPage
// stay defined (handy for our own design checks) but aren't shown to users —
// there's no reason to expose a component/opacity catalogue in the picker.
export const PREVIEW_SURFACES: { key: SurfaceKey; label: string; Component: FC }[] = [
  { key: "class", label: "Class view", Component: ClassViewPage },
  { key: "article", label: "Article", Component: ArticlePage },
  { key: "compendium", label: "Compendium", Component: CompendiumPage },
];

void ComponentsPage; void OpacityTiersPage;
