// The guided Appearance builder (Settings → Appearance) — "Grouped Studio".
//
// Five colour controls grouped into Surfaces / Text / Accent over a base
// preset, with live WCAG-AA contrast guard-rails ("nudge to readable"),
// accessible quick-picks, per-control + global reset, a height-adaptive scoped
// live preview, and save/CRUD against /api/me/themes. Danger (--blood) is never
// user-editable.

import { useEffect, useState, type ReactNode } from "react";
import { getSessionToken } from "../../lib/auth";
import {
  PRESET_PRIMARIES,
  contrastRatio,
  nudgeToContrast,
  type ThemePreset,
  type ThemeTokens,
  type ActiveTheme,
} from "../../lib/theme";
import { ThemePreview } from "./ThemePreview";
import { Check, AlertTriangle, RotateCcw, Plus, Trash2, Undo2 } from "lucide-react";

const PRESETS: ThemePreset[] = ["parchment", "light", "dark"];

type SavedTheme = { id: string; name: string; base_preset: ThemePreset; tokens: ThemeTokens };

// Accessible accent palette — mid-tone / vibrant so they clear the highlight
// contrast check on both light and dark backgrounds (no instant "nudge").
const QUICK = ["#c5a059", "#4a90d9", "#d14d4d", "#2fa36b", "#9b6dd6", "#e0922f"];

// Tokens that, when overridden, constitute a genuinely new look (a "Custom"
// theme). The highlight (accent) is deliberately excluded — it can ride on top
// of a base preset as a per-user override (accent_color) without forking it.
const SURFACE_TEXT_KEYS: (keyof ThemeTokens)[] = ["background", "card", "text", "textMuted"];

async function authHeaders(): Promise<Record<string, string>> {
  const t = await getSessionToken();
  return { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) };
}

/* ------------------------------ sub-components ----------------------------- */

/** Default-theme chooser — each card previews that preset's actual colors. A
 *  card reads as "selected" only when no custom theme is loaded (`active`), so
 *  defaults and saved themes are mutually-exclusive, always-clickable states. */
function PresetCards({ preset, active, onSelect }: { preset: ThemePreset; active: boolean; onSelect: (p: ThemePreset) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {PRESETS.map((p) => {
        const c = PRESET_PRIMARIES[p];
        const sel = active && preset === p;
        return (
          <button
            key={p}
            type="button"
            onClick={() => onSelect(p)}
            className={`border p-2 text-left transition-all ${sel ? "border-gold ring-1 ring-gold" : "border-gold/25 hover:border-gold/50"}`}
          >
            <div className="flex gap-0.5 mb-2 h-6">
              {[c.background, c.card, c.text, c.accent].map((col, i) => (
                <span key={i} className="flex-1 border border-ink/10" style={{ background: col }} />
              ))}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold capitalize">{p}</span>
              {sel && <Check className="w-3.5 h-3.5 text-gold" />}
            </div>
          </button>
        );
      })}
    </div>
  );
}

/** Labelled sub-panel grouping a couple of colour rows. */
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border border-gold/20">
      <div className="px-4 py-2 bg-gold/5 border-b border-gold/15 text-[10px] uppercase tracking-widest font-bold text-gold">{title}</div>
      <div className="p-4 space-y-3">{children}</div>
    </div>
  );
}

/** Accessible highlight quick-picks — values chosen to clear the contrast check
 *  on any base, so a one-click pick never trips the legibility guard. Large
 *  swatches with room of their own, since this is the most common edit. */
function QuickPicks({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {QUICK.map((c) => {
        const sel = value.toLowerCase() === c.toLowerCase();
        return (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            title={c}
            className={`w-9 h-9 border-2 transition-transform hover:scale-110 ${sel ? "border-ink ring-1 ring-ink/40" : "border-black/10"}`}
            style={{ background: c }}
          />
        );
      })}
    </div>
  );
}

type ContrastCheck = { label: string; key: keyof ThemeTokens; against: string; target: number; ratio: number };

/** Contrast guard-rails with an explanation + per-row "nudge to fix". */
function Readability({
  checks,
  valueFor,
  setField,
}: {
  checks: ContrastCheck[];
  valueFor: (k: keyof ThemeTokens) => string;
  setField: (k: keyof ThemeTokens, v: string) => void;
}) {
  return (
    <div className="border border-gold/20 p-4">
      <div className="field-label mb-1">Legibility check</div>
      <p className="text-[11px] text-ink/45 italic mb-3">How easy each pairing is to read — tap “nudge” to auto-fix a low one.</p>
      <div className="space-y-2">
        {checks.map((c) => {
          const ok = c.ratio >= c.target;
          return (
            <div key={c.label} className="flex items-center gap-2 text-xs">
              {ok
                ? <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                : <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
              <span className={ok ? "text-ink/65" : "text-ink"}>{c.label}</span>
              {ok
                ? <span className="ml-auto text-[10px] font-bold uppercase tracking-wide text-emerald-600">Good</span>
                : <button
                    type="button"
                    onClick={() => setField(c.key, nudgeToContrast(valueFor(c.key), c.against, c.target))}
                    className="ml-auto text-[10px] font-bold uppercase tracking-wide text-gold border border-gold/35 px-2 py-0.5 hover:bg-gold/10"
                  >
                    Nudge
                  </button>}
              <span className="font-mono text-[10px] text-ink/40 w-14 text-right" title="contrast ratio">{c.ratio.toFixed(1)} : 1</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Saved-theme chooser — pick a theme you've created to load + adjust it. The
 *  active (currently-applied) theme is badged; the loaded-for-editing one is
 *  ring-highlighted. Includes a "New theme" tile and per-theme delete. */
function ThemeChooser({
  themes,
  editingId,
  activeId,
  onLoad,
  onNew,
  onDelete,
}: {
  themes: SavedTheme[];
  editingId: string | null;
  activeId: string | null;
  onLoad: (t: SavedTheme) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}) {
  const swatchesFor = (t: SavedTheme) => {
    const d = PRESET_PRIMARIES[t.base_preset];
    return [t.tokens.background ?? d.background, t.tokens.card ?? d.card, t.tokens.accent ?? d.accent];
  };
  return (
    <div className="flex flex-wrap gap-2">
      {themes.map((t) => {
        const editing = t.id === editingId;
        const isActive = t.id === activeId;
        return (
          <div key={t.id} className="relative group">
            <button
              type="button"
              onClick={() => onLoad(t)}
              className={`flex items-center gap-2 pl-2 pr-8 py-1.5 border text-xs transition-colors ${editing ? "border-gold ring-1 ring-gold bg-gold/10" : "border-gold/25 hover:border-gold/50"}`}
              title={isActive ? `${t.name} (currently applied)` : `Load “${t.name}” to adjust`}
            >
              <span className="flex gap-0.5 shrink-0">
                {swatchesFor(t).map((c, i) => (
                  <span key={i} className="w-3.5 h-3.5 border border-ink/10" style={{ background: c }} />
                ))}
              </span>
              <span className="font-semibold truncate max-w-[140px]">{t.name}</span>
              {isActive && (
                <span className="text-[8px] font-bold uppercase tracking-wide text-emerald-600 shrink-0">Active</span>
              )}
            </button>
            <button
              type="button"
              onClick={() => onDelete(t.id)}
              title="Delete this theme"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-ink/30 hover:text-blood opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={onNew}
        className={`flex items-center gap-1.5 px-3 py-1.5 border border-dashed text-xs transition-colors ${editingId === null ? "border-gold text-gold bg-gold/5" : "border-gold/35 text-ink/65 hover:border-gold/60 hover:text-gold"}`}
        title="Start a fresh theme"
      >
        <Plus className="w-3.5 h-3.5" /> New theme
      </button>
    </div>
  );
}

/* --------------------------------- builder -------------------------------- */

interface Props {
  userProfile: any;
  /** App-wide profile refresh — re-applies the active theme globally. */
  onSaved: () => void | Promise<void>;
}

export function AppearanceBuilder({ userProfile, onSaved }: Props) {
  const active = (userProfile?.active_theme ?? null) as ActiveTheme | null;

  const initialPreset = (active?.base_preset || (userProfile?.theme as ThemePreset) || "parchment") as ThemePreset;
  const [preset, setPreset] = useState<ThemePreset>(initialPreset);
  const [tokens, setTokens] = useState<ThemeTokens>(() => {
    if (active?.tokens) return active.tokens;
    // No custom theme active — reflect a base-level highlight override (the
    // legacy per-user accent_color) so the editor shows the accent in effect.
    const ac = userProfile?.accent_color as string | undefined;
    const def = PRESET_PRIMARIES[initialPreset]?.accent;
    return ac && def && ac.toLowerCase() !== def.toLowerCase() ? { accent: ac } : {};
  });
  const [themeId, setThemeId] = useState<string | null>(active?.id ?? null);
  const [name, setName] = useState(active?.name || "Custom");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [themes, setThemes] = useState<SavedTheme[]>([]);

  const activeId = active?.id ?? null;

  // Re-seed the editor when a DIFFERENT theme becomes active externally (e.g.
  // applied elsewhere). Guarded against `active == null` so a "Revert (keep
  // saved)" — which nulls the active theme — does NOT wipe the in-progress
  // editor: the user explicitly wants to keep adjusting it after reverting.
  useEffect(() => {
    if (!active) return;
    setPreset(active.base_preset || (userProfile?.theme as ThemePreset) || "parchment");
    setTokens(active.tokens || {});
    setThemeId(active.id ?? null);
    setName(active.name || "Custom");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // Fetch the user's saved themes for the chooser.
  const loadThemes = async () => {
    try {
      const headers = await authHeaders();
      const res = await fetch("/api/me/themes", { headers });
      if (!res.ok) return;
      const data = await res.json();
      setThemes(Array.isArray(data.themes) ? data.themes : []);
    } catch { /* non-fatal — chooser just stays empty */ }
  };
  useEffect(() => { loadThemes(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Load a saved theme into the editor (does NOT apply globally until Save).
  const loadTheme = (t: SavedTheme) => {
    setPreset(t.base_preset);
    setTokens(t.tokens || {});
    setThemeId(t.id);
    setName(t.name);
    setMsg(null);
  };

  // Start a fresh, unsaved theme — keeps the current base preset for convenience.
  const newTheme = () => {
    setThemeId(null);
    setTokens({});
    setName("Custom");
    setMsg(null);
  };

  // Pick a built-in default theme. Clears surface/text overrides + deselects any
  // loaded custom theme so the editor shows that pure default — but PRESERVES the
  // chosen highlight, since the accent rides on top of any base. "Save as Custom
  // Theme" then persists any tweaks into Your themes.
  const selectDefault = (p: ThemePreset) => {
    setPreset(p);
    setTokens((t) => (t.accent != null ? { accent: t.accent } : {}));
    setThemeId(null);
    setName("Custom");
    setMsg(null);
  };

  async function deleteTheme(id: string) {
    if (!window.confirm("Delete this saved theme? This can't be undone.")) return;
    setSaving(true); setMsg(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/me/themes/${id}`, { method: "DELETE", headers });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Delete failed (HTTP ${res.status})`);
      await loadThemes();
      if (themeId === id) newTheme();
      // The DB nulls users.active_theme_id (ON DELETE SET NULL); refresh the
      // app-wide profile so the global theme reverts if we deleted the active one.
      if (activeId === id) await onSaved();
      setMsg({ type: "ok", text: "Theme deleted." });
    } catch (e: any) {
      setMsg({ type: "err", text: e.message || "Delete failed." });
    } finally {
      setSaving(false);
    }
  }

  const defaults = PRESET_PRIMARIES[preset];
  const valueFor = (k: keyof ThemeTokens) => tokens[k] ?? defaults[k];
  const setField = (k: keyof ThemeTokens, v: string) => setTokens((t) => ({ ...t, [k]: v }));
  const resetField = (k: keyof ThemeTokens) => setTokens((t) => { const c = { ...t }; delete c[k]; return c; });

  // True once the user has changed a surface/text colour (vs. only the
  // highlight) — that's the threshold for needing a real "Custom" theme.
  const hasSurfaceTextEdits = SURFACE_TEXT_KEYS.some((k) => tokens[k] != null);

  const bg = valueFor("background"), card = valueFor("card"), text = valueFor("text"), muted = valueFor("textMuted"), accent = valueFor("accent");
  const CHECKS: ContrastCheck[] = [
    { label: "Text on background", key: "text", against: bg, target: 4.5, ratio: contrastRatio(text, bg) },
    { label: "Text on card", key: "text", against: card, target: 4.5, ratio: contrastRatio(text, card) },
    { label: "Secondary text on card", key: "textMuted", against: card, target: 4.5, ratio: contrastRatio(muted, card) },
    { label: "Highlight on background", key: "accent", against: bg, target: 3, ratio: contrastRatio(accent, bg) },
  ];

  // Single colour row — rendered as a plain function (NOT a <Component/>) so the
  // colour/hex inputs keep their identity across re-renders and don't lose focus.
  const renderRow = (k: keyof ThemeTokens, label: string) => {
    const overridden = tokens[k] != null;
    return (
      <div className="flex items-center gap-3">
        <label className="relative block w-9 h-9 shrink-0 border border-gold/30 cursor-pointer" style={{ background: valueFor(k) }}>
          <input type="color" value={valueFor(k)} onChange={(e) => setField(k, e.target.value)}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
        </label>
        <span className="field-label flex-1">{label}</span>
        {overridden && (
          <button type="button" onClick={() => resetField(k)} title="Reset to preset"
            className="text-ink/40 hover:text-gold shrink-0">
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        )}
        <input type="text" value={valueFor(k)} onChange={(e) => setField(k, e.target.value)}
          spellCheck={false} autoComplete="off" autoCorrect="off"
          className="w-24 text-xs font-mono px-2 py-1.5 border border-gold/25 bg-background text-ink" />
      </div>
    );
  };

  async function save() {
    setSaving(true); setMsg(null);
    try {
      const headers = await authHeaders();
      const payload = { name, base_preset: preset, tokens };
      let id = themeId;
      const res = id
        ? await fetch(`/api/me/themes/${id}`, { method: "PATCH", headers, body: JSON.stringify(payload) })
        : await fetch("/api/me/themes", { method: "POST", headers, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Save failed (HTTP ${res.status})`);
      const data = await res.json();
      id = data.theme?.id ?? id;
      if (id) setThemeId(id);
      // Ensure it's the active theme (POST already does this; PATCH may not if it
      // was previously deactivated). Idempotent.
      await fetch("/api/me", { method: "PATCH", headers, body: JSON.stringify({ active_theme_id: id }) });
      await onSaved();
      await loadThemes();
      setMsg({ type: "ok", text: "Theme saved and applied." });
    } catch (e: any) {
      setMsg({ type: "err", text: e.message || "Save failed." });
    } finally {
      setSaving(false);
    }
  }

  // Apply a built-in default preset as the active look — no custom theme row,
  // just `active_theme_id = null` + `theme = <preset>` + an optional per-user
  // `accent_color` highlight that rides on top WITHOUT forking the base. This
  // is per-user; it never changes the base preset for anyone else.
  async function applyBuiltIn(p: ThemePreset, accent: string | null) {
    setSaving(true); setMsg(null);
    try {
      const headers = await authHeaders();
      const res = await fetch("/api/me", { method: "PATCH", headers, body: JSON.stringify({ active_theme_id: null, theme: p, accent_color: accent }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Failed (HTTP ${res.status})`);
      await onSaved();
      setMsg({ type: "ok", text: accent ? `Applied the ${p} base with your highlight.` : `Applied the ${p} theme.` });
    } catch (e: any) {
      setMsg({ type: "err", text: e.message || "Failed." });
    } finally {
      setSaving(false);
    }
  }

  // Write the current surface/text colours into the per-user "Custom" scratch
  // theme (find-or-create by name) and apply it. Used by Apply when you've
  // changed surfaces/text on a base — those can't live as a bare accent override.
  async function saveToCustom() {
    setSaving(true); setMsg(null);
    try {
      const headers = await authHeaders();
      const existing = themes.find((t) => t.name.toLowerCase() === "custom");
      const payload = { name: "Custom", base_preset: preset, tokens };
      let id = existing?.id ?? null;
      const res = id
        ? await fetch(`/api/me/themes/${id}`, { method: "PATCH", headers, body: JSON.stringify(payload) })
        : await fetch("/api/me/themes", { method: "POST", headers, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Save failed (HTTP ${res.status})`);
      const data = await res.json();
      id = data.theme?.id ?? id;
      if (id) { setThemeId(id); setName("Custom"); }
      await fetch("/api/me", { method: "PATCH", headers, body: JSON.stringify({ active_theme_id: id }) });
      await onSaved();
      await loadThemes();
      setMsg({ type: "ok", text: "Saved to your Custom theme and applied." });
    } catch (e: any) {
      setMsg({ type: "err", text: e.message || "Save failed." });
    } finally {
      setSaving(false);
    }
  }

  // "Apply" — applies the current selection WITHOUT creating a NEW named theme:
  //   • a loaded custom theme       → save its edits in place + apply (update)
  //   • a base + surface/text edits → write them into the "Custom" scratch theme
  //   • a base + highlight-only      → apply the base preset with that highlight
  //                                    rolled in (base stays a base, just your accent)
  async function applyCurrent() {
    if (themeId) return save();
    if (hasSurfaceTextEdits) return saveToCustom();
    return applyBuiltIn(preset, tokens.accent ?? null);
  }

  // Save the current colors as a NEW custom theme (always POST), then apply it.
  // Distinct from Save, which updates the loaded theme in place — this branches
  // a fresh entry into "Your themes" (a "Save As").
  async function saveAsNew() {
    setSaving(true); setMsg(null);
    try {
      const headers = await authHeaders();
      const res = await fetch("/api/me/themes", { method: "POST", headers, body: JSON.stringify({ name, base_preset: preset, tokens }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Save failed (HTTP ${res.status})`);
      const data = await res.json();
      const id = data.theme?.id ?? null;
      if (id) setThemeId(id);
      await fetch("/api/me", { method: "PATCH", headers, body: JSON.stringify({ active_theme_id: id }) });
      await onSaved();
      await loadThemes();
      setMsg({ type: "ok", text: "Saved as a new theme and applied." });
    } catch (e: any) {
      setMsg({ type: "err", text: e.message || "Save failed." });
    } finally {
      setSaving(false);
    }
  }

  // Revert the most recent Save & apply: deactivate the active theme (back to
  // the built-in preset) WITHOUT deleting it — the theme stays in the chooser
  // and loaded in the editor so the user can keep adjusting and re-apply.
  async function revertKeepSaved() {
    setSaving(true); setMsg(null);
    try {
      const headers = await authHeaders();
      const res = await fetch("/api/me", { method: "PATCH", headers, body: JSON.stringify({ active_theme_id: null }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Failed (HTTP ${res.status})`);
      await onSaved();
      setMsg({ type: "ok", text: "Reverted to the built-in look — your theme is still saved here." });
    } catch (e: any) {
      setMsg({ type: "err", text: e.message || "Failed." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* ---- Studio bar: theme pickers + name + apply/revert (kept at the TOP) ---- */}
      <div className="border border-gold/20 bg-card/40 p-4 space-y-4">
        <div>
          <div className="field-label mb-1.5">Default themes</div>
          {/* A base stays "selected" through a highlight-only change (the accent
              rides on top); a surface/text edit means you've diverged into the
              Custom theme, so no base reads as selected. */}
          <PresetCards preset={preset} active={themeId === null && !hasSurfaceTextEdits} onSelect={selectDefault} />
        </div>
        <div>
          <div className="field-label mb-1.5">Your themes</div>
          <ThemeChooser
            themes={themes}
            editingId={themeId}
            activeId={activeId}
            onLoad={loadTheme}
            onNew={newTheme}
            onDelete={deleteTheme}
          />
        </div>
        <div className="flex flex-wrap items-end gap-3 pt-1 border-t border-gold/10">
          <div className="w-full sm:w-64 pt-3">
            <div className="field-label mb-1.5">Theme name</div>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={60}
              autoComplete="off" autoCorrect="off" spellCheck={false}
              className="w-full text-sm px-2 py-1.5 border border-gold/25 bg-background text-ink" />
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto pt-3">
            <button type="button" onClick={applyCurrent} disabled={saving}
              title="Apply the selected theme. A base preset applies as-is; a loaded custom theme saves its changes in place and applies. (Use “Save as Custom Theme” to keep edits made on a base.)"
              className="btn-gold-solid inline-flex items-center justify-center gap-2 h-10 px-5 text-xs font-bold uppercase tracking-widest disabled:opacity-50">
              Apply
            </button>
            <button type="button" onClick={saveAsNew} disabled={saving}
              title="Save the current colors as a new custom theme and apply"
              className="btn-gold-solid inline-flex items-center justify-center gap-2 h-10 px-5 text-xs font-bold uppercase tracking-widest disabled:opacity-50">
              Save as Custom Theme
            </button>
            <button type="button" onClick={revertKeepSaved} disabled={saving || !activeId}
              title="Undo the last apply — back to the built-in look. Your theme stays saved here to adjust."
              className="btn-gold-solid inline-flex items-center justify-center gap-2 h-10 px-5 text-xs font-bold uppercase tracking-widest disabled:opacity-50">
              <Undo2 className="w-3.5 h-3.5" /> Revert
            </button>
          </div>
          {msg && (
            <p className={`w-full text-xs ${msg.type === "ok" ? "text-emerald-600" : "text-blood"}`}>{msg.text}</p>
          )}
        </div>
      </div>

      <div className="grid xl:grid-cols-[minmax(300px,360px)_minmax(0,1fr)] gap-6 items-stretch">
        {/* ---- Controls ---- */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="field-label">Customize colors</span>
            <button type="button" onClick={() => setTokens({})}
              className="text-[10px] uppercase tracking-wide text-ink/45 hover:text-gold inline-flex items-center gap-1">
              <RotateCcw className="w-3 h-3" /> Reset to base
            </button>
          </div>

          {/* Highlight first — it's the change most users actually want, and the
              ready-made swatches make "just pick a highlight" a one-click path. */}
          <Group title="Highlight">
            {renderRow("accent", "Color")}
            <div className="pt-2">
              <div className="text-[11px] text-ink/55 mb-2">Or pick a ready-made highlight — each stays legible on any base:</div>
              <QuickPicks value={valueFor("accent")} onChange={(v) => setField("accent", v)} />
            </div>
          </Group>

          <Group title="Surfaces">
            {renderRow("background", "Background")}
            {renderRow("card", "Card surface")}
          </Group>

          <Group title="Text">
            {renderRow("text", "Primary")}
            {renderRow("textMuted", "Secondary")}
          </Group>

          <Readability checks={CHECKS} valueFor={valueFor} setField={setField} />
        </div>

        {/* ---- Live preview ---- fills its column (grid is items-stretch) so it
             matches the controls' height and stays put instead of jumping. */}
        <div className="flex flex-col min-h-[520px]">
          <div className="field-label mb-2 shrink-0">Live preview</div>
          <ThemePreview theme={{ base_preset: preset, tokens }} className="flex-1 min-h-0" />
          <p className="text-[11px] text-ink/45 italic mt-2 shrink-0">
            Scoped preview — nothing changes elsewhere until you save.
          </p>
        </div>
      </div>
    </div>
  );
}
