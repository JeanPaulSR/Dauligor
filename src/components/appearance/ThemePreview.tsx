// ThemePreview — a live, SCOPED preview of a custom theme.
//
// The key property: the in-progress theme is applied as inline CSS custom
// properties on a single wrapper <div> (plus the base-preset class), so the
// cascade overrides theme variables ONLY for the mock-ups inside this pane.
// The surrounding real app keeps the user's actual active theme untouched —
// editing here never leaks out until the builder explicitly saves (Phase 3).
//
// `resolveThemeVars()` (the same engine the global apply uses) turns the sparse
// token overrides into the concrete variable set, so the preview is guaranteed
// to match what a Save would actually produce.

import { useState, type CSSProperties } from "react";
import { resolveThemeVars, type ActiveTheme } from "../../lib/theme";
import { PREVIEW_SURFACES, type SurfaceKey } from "./themeMocks";

interface ThemePreviewProps {
  /** The theme to render — base preset + sparse colour overrides. */
  theme: ActiveTheme;
  /** Optional controlled surface; falls back to internal state when omitted. */
  surface?: SurfaceKey;
  onSurfaceChange?: (s: SurfaceKey) => void;
  className?: string;
}

export function ThemePreview({ theme, surface, onSurfaceChange, className }: ThemePreviewProps) {
  const [internal, setInternal] = useState<SurfaceKey>("compendium");
  const active = surface ?? internal;
  const setActive = (s: SurfaceKey) => (onSurfaceChange ? onSurfaceChange(s) : setInternal(s));

  const entry = PREVIEW_SURFACES.find((s) => s.key === active) ?? PREVIEW_SURFACES[0];
  const Surface = entry.Component;

  // The resolved override set — injected as inline custom properties so it only
  // affects descendants of the scope div. Cast because React.CSSProperties does
  // not statically allow arbitrary `--*` keys (it passes them through at runtime).
  const vars = resolveThemeVars(theme) as unknown as CSSProperties;

  return (
    <div className={className}>
      {/* Surface switcher */}
      <div className="inline-flex border border-border mb-2 text-xs">
        {PREVIEW_SURFACES.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setActive(s.key)}
            className={`px-3 py-1.5 border-r border-border last:border-r-0 uppercase tracking-wide transition-colors ${
              active === s.key
                ? "bg-gold text-[var(--primary-foreground)] font-semibold"
                : "text-muted-foreground hover:text-ink"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Scoped theme container: base-preset class + injected overrides. */}
      <div className={theme.base_preset} style={vars}>
        <div className="bg-background text-ink p-4 border border-border overflow-auto max-h-[460px]">
          <Surface />
        </div>
      </div>
    </div>
  );
}
