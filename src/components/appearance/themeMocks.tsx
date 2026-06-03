// Static, representative mock-ups of the app's main surfaces, used by the
// Appearance theme preview. They render real semantic classes / theme utilities
// (text-ink, bg-card, text-gold, .h1-title, .data-table, …) so they respond to
// the active theme variables exactly like the real pages — but with hard-coded
// sample data, so the preview is instant and needs no network.
//
// Each surface deliberately stresses a different part of the token set:
//   compendium → dense cards + gold metadata tags
//   wiki       → long-form prose + headings + links
//   sheet      → tabular contrast + stat cells
//   home       → navbar chrome + buttons + dashboard cards

import type { FC, ReactNode } from "react";

/* ----------------------------- Compendium -------------------------------- */

const CompendiumMock: FC = () => (
  <div className="grid grid-cols-[150px_1fr] gap-3">
    <div className="border border-border bg-card">
      {["Fireball", "Cloak of Elvenkind", "Counterspell", "Longsword +1"].map((n, i) => (
        <div
          key={n}
          className={`px-3 py-2 border-b border-border last:border-b-0 ${i === 0 ? "bg-gold/15" : ""}`}
        >
          <div className="text-sm text-ink leading-tight">{n}</div>
          <div className="text-[10px] uppercase tracking-widest text-gold font-bold">
            {["Spell", "Item", "Spell", "Item"][i]}
          </div>
        </div>
      ))}
    </div>
    <div className="border border-border bg-card p-4">
      <div className="text-[10px] uppercase tracking-widest text-gold font-bold">Level 3 · Evocation</div>
      <h3 className="h3-title text-ink mt-0.5">Fireball</h3>
      <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
        A bright streak flashes from your pointing finger to a point you choose, then blossoms with a
        low roar into an explosion of flame.
      </p>
      <div className="flex flex-wrap gap-1.5 mt-3">
        {["Range 150 ft", "V S M", "8d6 fire"].map((t) => (
          <span key={t} className="text-[11px] px-2 py-0.5 bg-gold/15 text-gold border border-gold/35">
            {t}
          </span>
        ))}
      </div>
      <button className="btn-gold-solid mt-4">Add to spellbook</button>
    </div>
  </div>
);

/* -------------------------------- Wiki ----------------------------------- */

const WikiMock: FC = () => (
  <article className="max-w-[60ch]">
    <div className="text-[10px] uppercase tracking-widest text-gold font-bold">Lore · Geography</div>
    <h1 className="h1-title text-ink mt-1">The Sunken City of Vol</h1>
    <p className="description-text mt-1">Where the tide forgot to return, and the lamps still burn.</p>
    <p className="text-foreground mt-4 leading-relaxed text-sm">
      Beneath the tideless sea lies <a className="text-gold underline underline-offset-2">Vol</a>, once the
      jewel of the Amber Coast. Its towers stand intact in the green dark, lit by lanterns that no living
      hand has tended in three hundred years.
    </p>
    <h2 className="h2-title text-ink mt-5">History</h2>
    <p className="text-foreground mt-1.5 leading-relaxed text-sm">
      The Drowning was not a disaster but a bargain — struck between the Magister Council and something
      that answered from below. What was promised in return is recorded nowhere that survives.
    </p>
  </article>
);

/* ----------------------------- Character sheet --------------------------- */

const SheetMock: FC = () => (
  <div>
    <div className="grid grid-cols-3 gap-2 mb-4">
      {[
        ["STR", "16", "+3"],
        ["DEX", "14", "+2"],
        ["CON", "15", "+2"],
      ].map(([ab, score, mod]) => (
        <div key={ab} className="border border-border bg-card text-center py-2">
          <div className="text-[10px] uppercase tracking-widest text-gold font-bold">{ab}</div>
          <div className="text-2xl font-serif text-ink leading-none mt-1">{mod}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">{score}</div>
        </div>
      ))}
    </div>
    <table className="w-full text-sm border border-border">
      <thead>
        <tr className="bg-gold/15">
          <th className="text-left px-3 py-1.5 text-[10px] uppercase tracking-widest text-gold font-bold">Skill</th>
          <th className="text-right px-3 py-1.5 text-[10px] uppercase tracking-widest text-gold font-bold">Mod</th>
        </tr>
      </thead>
      <tbody>
        {[["Athletics", "+5"], ["Perception", "+4"], ["Stealth", "+2"]].map(([s, m]) => (
          <tr key={s} className="border-t border-border">
            <td className="px-3 py-1.5 text-ink">{s}</td>
            <td className="px-3 py-1.5 text-right text-foreground">{m}</td>
          </tr>
        ))}
      </tbody>
    </table>
    <div className="mt-4">
      <div className="flex justify-between text-[11px] text-muted-foreground mb-1">
        <span className="uppercase tracking-widest text-gold font-bold">Hit Points</span>
        <span>27 / 38</span>
      </div>
      <div className="h-2 bg-secondary border border-border">
        <div className="h-full bg-gold" style={{ width: "71%" }} />
      </div>
    </div>
  </div>
);

/* -------------------------------- Home ----------------------------------- */

const HomeMock: FC = () => (
  <div>
    <div className="flex items-center gap-4 border-b border-border bg-card px-3 py-2.5 -m-4 mb-4">
      <span className="font-serif text-gold font-bold text-lg">The Archive</span>
      <nav className="flex gap-3 text-sm text-muted-foreground">
        <span className="text-ink">Compendium</span>
        <span>Lore</span>
        <span>Characters</span>
      </nav>
      <button className="btn-gold-solid ml-auto">New entry</button>
    </div>
    <div className="grid grid-cols-2 gap-3">
      {[
        ["Active Campaign", "The Amber Coast", "4 players · Session 12"],
        ["Recent Lore", "The Sunken City of Vol", "edited 2 days ago"],
      ].map(([tag, title, meta]) => (
        <div key={tag} className="border border-border bg-card p-3">
          <div className="text-[10px] uppercase tracking-widest text-gold font-bold">{tag}</div>
          <h3 className="h3-title text-ink mt-0.5">{title}</h3>
          <div className="text-[11px] text-muted-foreground mt-1">{meta}</div>
        </div>
      ))}
    </div>
  </div>
);

/* --------------------------- Opacity ladder ------------------------------ */
// The canonical 10-step opacity ramp ({5,15,…,95}) rendered live against the
// active Text and Highlight colours, so a user can vet every tier with their
// own palette. Each row is annotated with a real use-site in the app, and uses
// `color-mix(var(--ink|--gold) N%, transparent)` — exactly what `text-ink/N`
// and `border-gold/N` compile to — so it tracks the scoped theme precisely.

const mix = (v: "--ink" | "--gold", n: number) => `color-mix(in oklab, var(${v}) ${n}%, transparent)`;

// Each rung is a CONCRETE fragment of real app UI rendered at that exact
// opacity, so a user sees what the step actually controls — not an abstract
// swatch. `ink` = text hierarchy; `gold` = accent borders / fills / labels.
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

const OpacityTiersMock: FC = () => (
  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
    <TierColumn title="Text (ink)" rows={INK_ROWS} />
    <TierColumn title="Highlight (gold)" rows={GOLD_ROWS} />
  </div>
);

export type SurfaceKey = "compendium" | "wiki" | "sheet" | "home" | "tiers";

export const PREVIEW_SURFACES: { key: SurfaceKey; label: string; Component: FC }[] = [
  { key: "compendium", label: "Compendium", Component: CompendiumMock },
  { key: "wiki", label: "Wiki", Component: WikiMock },
  { key: "sheet", label: "Sheet", Component: SheetMock },
  { key: "home", label: "Home", Component: HomeMock },
  { key: "tiers", label: "Tiers", Component: OpacityTiersMock },
];
