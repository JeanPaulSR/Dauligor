// TEMPORARY — Phase 2 preview harness (route: /appearance-lab).
//
// This is NOT the final builder. It exists only to exercise and demonstrate the
// scoped <ThemePreview> in isolation, with raw, unguarded colour inputs. Phase 3
// replaces it with the real guided builder (preset cards, contrast guard-rails,
// reset, save → persist) integrated into Settings → Appearance, at which point
// this file and its route are removed.
//
// What it proves: edits here change ONLY the preview pane — the surrounding app
// chrome (navbar, this page's own text) keeps the user's real active theme.

import { useState } from "react";
import { ThemePreview } from "../../components/appearance/ThemePreview";
import { PRESET_PRIMARIES, type ThemePreset, type ThemeTokens } from "../../lib/theme";

const PRESETS: ThemePreset[] = ["parchment", "light", "dark"];
const FIELDS: { key: keyof ThemeTokens; label: string }[] = [
  { key: "background", label: "Background" },
  { key: "card", label: "Card surface" },
  { key: "text", label: "Text" },
  { key: "textMuted", label: "Secondary text" },
  { key: "accent", label: "Highlight" },
];

export default function AppearanceLab() {
  const [preset, setPreset] = useState<ThemePreset>("parchment");
  const [tokens, setTokens] = useState<ThemeTokens>({});

  const defaults = PRESET_PRIMARIES[preset];
  const valueFor = (k: keyof ThemeTokens) => tokens[k] ?? defaults[k];

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      <div className="border border-gold/45 bg-gold/5 px-3 py-2 mb-5 text-xs text-muted-foreground">
        <span className="text-gold font-bold uppercase tracking-widest">Preview harness</span> — temporary
        Phase-2 scaffold. The real builder (with guard-rails + save) lands in Settings → Appearance in
        Phase 3. Notice the page chrome around the preview keeps your real theme.
      </div>

      <h1 className="h1-title text-ink">Theme preview lab</h1>
      <p className="description-text mb-6">Tweak the four colours; only the preview pane reacts.</p>

      <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-6">
        {/* Raw controls (unguarded — Phase 3 adds the guard-rails) */}
        <div className="space-y-4">
          <div>
            <div className="field-label mb-1">Base preset</div>
            <div className="inline-flex border border-border text-xs">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => { setPreset(p); setTokens({}); }}
                  className={`px-3 py-1.5 border-r border-border last:border-r-0 capitalize ${
                    preset === p ? "bg-gold text-white font-semibold" : "text-muted-foreground hover:text-ink"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {FIELDS.map(({ key, label }) => (
            <div key={key}>
              <div className="field-label mb-1">{label}</div>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={valueFor(key)}
                  onChange={(e) => setTokens((t) => ({ ...t, [key]: e.target.value }))}
                  className="w-9 h-9 border border-border bg-transparent cursor-pointer p-0"
                />
                <span className="text-xs font-mono text-muted-foreground">{valueFor(key)}</span>
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={() => setTokens({})}
            className="text-xs uppercase tracking-wide text-muted-foreground hover:text-ink border border-border px-3 py-1.5"
          >
            Reset to preset
          </button>
        </div>

        {/* Scoped preview */}
        <ThemePreview theme={{ base_preset: preset, tokens }} />
      </div>
    </div>
  );
}
