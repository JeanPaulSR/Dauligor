// Shared theme resolution for the custom-appearance system.
//
// A custom theme is a base preset (parchment | light | dark) plus a SPARSE set
// of colour overrides. `resolveThemeVars()` expands that into the concrete
// CSS-variable values to inject at the document root. The base preset class
// still supplies every token we don't override here (borders, radius, charts,
// sidebar, fonts, …), so a custom theme is intentionally only the handful of
// colours the user can actually set: background, card, text, accent.
//
// This module is the single source of truth for derivation and is shared by
// both the global apply step (App.tsx) and the scoped live preview (Phase 2).

export type ThemePreset = "parchment" | "light" | "dark";

export interface ThemeTokens {
  background?: string;
  card?: string;
  text?: string;
  textMuted?: string;
  accent?: string;
}

export interface ActiveTheme {
  id?: string;
  name?: string;
  base_preset: ThemePreset;
  tokens: ThemeTokens;
}

/**
 * Built-in primaries per preset — the starting point a user tweaks from and the
 * fallback for any primary they leave unset. Mirrors the `.parchment/.light/
 * .dark` blocks in src/index.css (accent = the accent-aware `--gold`).
 */
export const PRESET_PRIMARIES: Record<ThemePreset, Required<ThemeTokens>> = {
  parchment: { background: "#f5f5f0", card: "#ffffff", text: "#1a1a1a", textMuted: "#6b7280", accent: "#c5a059" },
  light:     { background: "#ffffff", card: "#ffffff", text: "#1a1a1a", textMuted: "#6b7280", accent: "#3b82f6" },
  dark:      { background: "#1a1a1e", card: "#24242a", text: "#e2e2e8", textMuted: "#a1a1aa", accent: "#c5a059" },
};

/**
 * Every CSS variable a custom theme may set. The apply step clears these before
 * (re)applying so switching themes — or reverting to a built-in preset — never
 * leaves stale inline overrides on the document root.
 */
export const THEME_VAR_NAMES: readonly string[] = [
  "--background", "--card", "--popover",
  "--foreground", "--card-foreground", "--popover-foreground", "--ink",
  "--muted-foreground", "--secondary", "--secondary-foreground", "--muted",
  "--accent", "--accent-foreground",
  "--gold", "--primary", "--primary-foreground", "--ring",
];

/* --------------------------- colour helpers ------------------------------- */

/** Accept only well-formed #rgb / #rrggbb; anything else → null (use fallback). */
function normHex(v?: string): string | null {
  if (!v || typeof v !== "string") return null;
  const s = v.trim();
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s) ? s : null;
}

function parseHex(hex: string): [number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(r: number, g: number, b: number): string {
  const c = (x: number) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Linear blend from a toward b by t (0..1). */
function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parseHex(a);
  const [br, bg, bb] = parseHex(b);
  return toHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

function relLuminance(hex: string): number {
  const lin = parseHex(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** Readable foreground (#1a1a1a or #ffffff) for text drawn on top of `hex`. */
function onColor(hex: string): string {
  return relLuminance(hex) > 0.4 ? "#1a1a1a" : "#ffffff";
}

/** WCAG contrast ratio (1..21). Exported for the builder's readability guard. */
export function contrastRatio(a: string, b: string): number {
  const la = relLuminance(a);
  const lb = relLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Nudge `fg` toward black or white (whichever raises contrast against `bg`)
 * until it clears `target`, in 10% steps. Returns the first passing shade, or
 * the closest pole if even that can't reach the target. Used by the builder's
 * "nudge to readable" guard-rail.
 */
export function nudgeToContrast(fg: string, bg: string, target = 4.5): string {
  if (!normHex(fg) || !normHex(bg) || contrastRatio(fg, bg) >= target) return fg;
  const pole = relLuminance(bg) < 0.5 ? "#ffffff" : "#1a1a1a";
  for (let t = 0.1; t <= 1.0001; t += 0.1) {
    const candidate = mix(fg, pole, t);
    if (contrastRatio(candidate, bg) >= target) return candidate;
  }
  return pole;
}

/* --------------------------- resolution ----------------------------------- */

/**
 * Expand a custom theme into the concrete CSS-variable overrides to inject at
 * the document root. Unset primaries fall back to the base preset; secondary
 * surfaces and on-colours are derived so the result is always coherent.
 */
export function resolveThemeVars(theme: ActiveTheme): Record<string, string> {
  const preset: ThemePreset = PRESET_PRIMARIES[theme.base_preset] ? theme.base_preset : "parchment";
  const p = PRESET_PRIMARIES[preset];
  const t = theme.tokens || {};

  const background = normHex(t.background) ?? p.background;
  const card = normHex(t.card) ?? p.card;
  const text = normHex(t.text) ?? p.text;
  const textMuted = normHex(t.textMuted) ?? mix(text, background, 0.45);
  const accent = normHex(t.accent) ?? p.accent;

  return {
    "--background": background,
    "--card": card,
    "--popover": card,
    "--foreground": text,
    "--card-foreground": text,
    "--popover-foreground": text,
    "--ink": text,
    "--muted-foreground": textMuted,
    "--secondary": mix(background, text, 0.06),
    "--secondary-foreground": text,
    "--muted": mix(background, text, 0.06),
    "--accent": mix(background, accent, 0.14),
    "--accent-foreground": text,
    "--gold": accent,
    "--primary": accent,
    "--primary-foreground": onColor(accent),
    "--ring": accent,
  };
}
