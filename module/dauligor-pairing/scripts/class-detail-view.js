// Shared "ClassView" — the rich class detail used by the character creator's
// Class tab, the standalone class-detail window (a clicked `@class[…]` ref), and
// (reusable by) the class-import + subclass wizards. ONE implementation, mounted
// into any container, so there's no duplication or drift.
//
// The render functions are PURE: they take a `view` object carrying the display
// state — `{ chosen, bundle, cvTab, cvSubclassId, cvExpanded, cvSpells, spellChart,
// onFetchSpells }` — and return HTML. The host owns the state + the data fetching
// (helpers for which are exported below) + the re-render loop. `bindClassView`
// wires the tab/subclass/feature interactions to mutate the view + re-render.
//
// Markup uses the `dauligor-character-creator__*` classes, so any host whose root
// carries the `dauligor-character-creator` class gets the identical styling.

import { getClassFeatureLabelsByLevel, fetchClassSpellList, normalizeHtmlBlock } from "./class-import-service.js";
import { baseClassHandler, formatFoundryLabel } from "./importer-base-features.js";
import { resolveApiHost } from "./auth-service.js";
import { MODULE_ID } from "./constants.js";
import { log } from "./utils.js";

// ── self-contained pure helpers (copies of the creator's; small + stable) ─────

const PB_BY_LEVEL = (lvl) => 2 + Math.floor((Math.max(1, Math.min(20, Number(lvl) || 1)) - 1) / 4);

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function prettifySlug(s) {
  return String(s ?? "").replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

function ordinal(n) {
  const v = n % 100;
  const suffix = (v >= 11 && v <= 13) ? "th" : (["th", "st", "nd", "rd"][n % 10] || "th");
  return `${n}${suffix}`;
}

// Dependency-free port of src/lib/spellcasting.ts. `progressionFormula` is
// author-controlled DB content (not user input); still whitelisted before eval.
function effectiveCastingLevel(level, formula) {
  if (!formula) return 0;
  const expr = String(formula).toLowerCase().replace(/ciel/g, "ceil").replace(/\blevel\b/g, String(Number(level) || 0));
  if (!/^[0-9+\-*/().,\s a-z]*$/.test(expr)) return 0;
  const idents = expr.match(/[a-z]+/g) || [];
  const ALLOWED = new Set(["floor", "ceil", "round", "min", "max", "abs"]);
  if (idents.some((id) => !ALLOWED.has(id))) return 0;
  try {
    const mathExpr = expr.replace(/\b(floor|ceil|round|min|max|abs)\b/g, "Math.$1");
    const v = Function(`"use strict"; return (${mathExpr});`)();
    return Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
  } catch {
    return 0;
  }
}

function slotsForEffectiveLevel(effLevel, masterTable) {
  if (!Array.isArray(masterTable) || effLevel <= 0) return [];
  const target = Math.min(20, Math.max(1, effLevel));
  const row = masterTable.find((r) => Number(r.level) === target);
  return row && Array.isArray(row.slots) ? row.slots : [];
}

// Render a stored description (HTML/BBCode/markdown) → display HTML, resolving
// cross-reference tokens to their display names. Mirrors the creator's helper.
function renderDescription(src) {
  let s = normalizeHtmlBlock(src);
  if (!s) return "";
  s = s
    .replace(/<(script|style|iframe|object|embed)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<(script|style|iframe|object|embed)\b[^>]*\/?>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*("javascript:[^"]*"|'javascript:[^']*')/gi, '$1="#"');
  s = s
    .replace(/&amp;Reference\[([a-z][a-z0-9_-]*)(?:=([a-z0-9_-]+))?[^\]]*\](?:\{([^}]*)\})?/gi,
      (_m, type, key, label) => `<span class="dauligor-character-creator__rt-ref">${label || formatFoundryLabel(key || type)}</span>`)
    .replace(/(?:@|&amp;)([a-z][a-z0-9-]*)\[([^\]\s]*)\](?:#[\w-]+)?(?:\{([^}]*)\})?/gi,
      (_m, kind, id, disp) => `<span class="dauligor-character-creator__rt-ref">${(disp != null && disp !== "") ? disp : formatFoundryLabel(String(id).replace(new RegExp(`^${kind}-`, "i"), "") || kind)}</span>`);
  s = s.replace(/^\s*<hr\s*\/?>\s*/i, "");
  s = s.replace(/^\s*<p>(?:(?!<\/p>)[\s\S]){0,80}?prerequisite[\s\S]*?<\/p>\s*/i, "");
  return s.trim();
}

// ── render (pure: state passed in via `view` / explicit args) ─────────────────

function effectiveSpellcasting(c, selSub) {
  const cs = c.spellcasting || {};
  if (cs.hasSpellcasting || cs.ability) return cs;
  const ss = selSub?.spellcasting || {};
  if (ss.hasSpellcasting || ss.ability) return ss;
  return null;
}

function cvFeaturesByLevelMerged(bundle, selSub) {
  const byLevel = {};
  const base = getClassFeatureLabelsByLevel(bundle.class || {});
  for (const [lvl, names] of Object.entries(base)) byLevel[lvl] = [...names];
  if (selSub) {
    for (const f of (bundle.features || []).filter((x) => x.parentSourceId === selSub.sourceId)) {
      const lvl = String(Number(f.level) || 1);
      (byLevel[lvl] ||= []).push(f.name);
    }
  }
  for (const lvl of Object.keys(byLevel)) byLevel[lvl] = [...new Set(byLevel[lvl])];
  return byLevel;
}

function buildCasterColumns(bundle, sc, spellChart) {
  const cols = [];
  const sk = sc.spellsKnownSourceId ? bundle.spellsKnownScalings?.[sc.spellsKnownSourceId] : null;
  if (sk?.levels) {
    const lv = sk.levels;
    const anyCantrips = Object.values(lv).some((l) => Number(l?.cantrips ?? l?.cantripsKnown) > 0);
    const anySpells = Object.values(lv).some((l) => Number(l?.spellsKnown ?? l?.spells) > 0);
    if (anyCantrips) cols.push({ header: "Cantrips", value: (lvl) => lv[String(lvl)]?.cantrips ?? lv[String(lvl)]?.cantripsKnown ?? "—" });
    if (anySpells) cols.push({ header: "Spells Known", value: (lvl) => lv[String(lvl)]?.spellsKnown ?? lv[String(lvl)]?.spells ?? "—" });
  }
  const alt = sc.altProgressionSourceId ? bundle.alternativeSpellcastingScalings?.[sc.altProgressionSourceId] : null;
  if (alt?.levels) {
    const al = alt.levels;
    cols.push({ header: "Pact Slots", value: (lvl) => al[String(lvl)]?.slotCount ?? "—" });
    cols.push({ header: "Slot Lvl", value: (lvl) => { const sl = al[String(lvl)]?.slotLevel; return sl ? ordinal(Number(sl)) : "—"; } });
  }
  const progression = String(sc.progression || "").toLowerCase();
  const chart = spellChart;
  if ((sc.hasSpellcasting || sc.ability) && progression !== "pact" && sc.progressionFormula && Array.isArray(chart) && chart.length) {
    const slotsByLevel = {};
    let maxSpellLevel = 0;
    for (let lvl = 1; lvl <= 20; lvl += 1) {
      const slots = slotsForEffectiveLevel(effectiveCastingLevel(lvl, sc.progressionFormula), chart);
      slotsByLevel[lvl] = slots;
      for (let i = slots.length - 1; i >= 0; i -= 1) {
        if (Number(slots[i]) > 0) { if (i + 1 > maxSpellLevel) maxSpellLevel = i + 1; break; }
      }
    }
    for (let sl = 1; sl <= maxSpellLevel; sl += 1) {
      cols.push({ header: ordinal(sl), value: (lvl) => { const v = Number(slotsByLevel[lvl]?.[sl - 1]) || 0; return v > 0 ? v : "—"; } });
    }
  }
  return cols;
}

function cvTable(bundle, selSub, spellChart) {
  const c = bundle.class || {};
  const classSourceId = c.classSourceId ?? c.sourceId ?? null;
  const featsByLevel = cvFeaturesByLevelMerged(bundle, selSub);
  let scalings = (Array.isArray(bundle.scalingColumns) ? bundle.scalingColumns : [])
    .filter((col) => col.parentSourceId === classSourceId);
  if (selSub) {
    scalings = scalings.concat((bundle.scalingColumns || []).filter((col) => col.parentSourceId === selSub.sourceId));
  }
  const eff = effectiveSpellcasting(c, selSub);
  const casterCols = eff ? buildCasterColumns(bundle, eff, spellChart) : [];
  const allCols = [
    ...scalings.map((col) => ({ header: col.name || prettifySlug(col.identifier), scaling: col })),
    ...casterCols,
  ];
  const headCols = allCols.map((col) => `<th><span class="dauligor-character-creator__cp-th">${escapeHtml(col.header)}</span></th>`).join("");
  const rows = Array.from({ length: 20 }, (_, i) => i + 1).map((lvl) => {
    const feats = featsByLevel[lvl] || [];
    const featCell = feats.length ? feats.map(escapeHtml).join(", ") : `<span class="dauligor-character-creator__cp-dash">—</span>`;
    const cells = allCols.map((col) => {
      let v;
      if (col.scaling) {
        v = "—";
        for (let l = lvl; l >= 1; l--) { const val = col.scaling.values?.[String(l)]; if (val != null && val !== "") { v = val; break; } }
      } else {
        v = col.value(lvl);
      }
      return `<td class="dauligor-character-creator__cp-num">${escapeHtml(String(v))}</td>`;
    }).join("");
    return `<tr><td class="dauligor-character-creator__cp-num">${lvl}</td><td class="dauligor-character-creator__cp-num">+${PB_BY_LEVEL(lvl)}</td><td class="dauligor-character-creator__cp-feats">${featCell}</td>${cells}</tr>`;
  }).join("");
  return `<div class="dauligor-character-creator__cp-table-wrap" data-scroll-id="cp-table"><table class="dauligor-character-creator__cp-table"><thead><tr><th>Lvl</th><th>PB</th><th>Features</th>${headCols}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function cvCoreTraits(c) {
  const baseRows = baseClassHandler({ payload: { class: c } })?.advancements || [];
  const byId = Object.fromEntries(baseRows.map((r) => [r.id, r]));
  const profValue = (row) => {
    if (!row) return "";
    const cats = (row.categoryIds || []).map(formatFoundryLabel);
    if (row.choiceCount > 0) {
      const pool = cats.length ? cats : (row.options || []).map(formatFoundryLabel);
      return pool.length ? `Choose ${row.choiceCount}: ${pool.join(", ")}` : `Choose ${row.choiceCount}`;
    }
    const guaranteed = cats.length ? cats : (row.fixed || []).map(formatFoundryLabel);
    return guaranteed.join(", ");
  };
  const primary = (c.primaryAbility || []).map((a) => formatFoundryLabel(String(a)));
  const hd = Number(c.hitDie) || 8;
  const line = (label, value) => value
    ? `<div class="dauligor-character-creator__cp-prof"><span class="dauligor-character-creator__cp-prof-key">${escapeHtml(label)}</span><span>${escapeHtml(value)}</span></div>`
    : "";
  return `
    <div class="dauligor-character-creator__cp-side">
      <h4 class="dauligor-character-creator__cp-side-title">Core Traits</h4>
      ${line("Hit Die", `d${hd} per level`)}
      ${line("HP at 1st", `${hd} + CON`)}
      ${line("HP / Level", `${Math.floor(hd / 2) + 1} (avg) + CON`)}
      ${line("Saves", profValue(byId["base-saves"]))}
      ${line("Armor", profValue(byId["base-armor"]) || "None")}
      ${line("Weapons", profValue(byId["base-weapons"]) || "None")}
      ${line("Tools", profValue(byId["base-tools"]))}
      ${line("Skills", profValue(byId["base-skills"]))}
      ${primary.length ? line("Multiclass", `${primary.join(" or ")} 13+`) : ""}
    </div>`;
}

function cvFeatureCard(f, isSub, cvExpanded) {
  const key = String(f.sourceId || `${f.name}-${f.level}`);
  const expanded = cvExpanded.has(key);
  const body = expanded
    ? `<div class="dauligor-character-creator__cv-feature-body dauligor-character-creator__desc">${renderDescription(f.description) || "<p><em>No description.</em></p>"}</div>`
    : "";
  return `
    <div class="dauligor-character-creator__cv-feature ${isSub ? "dauligor-character-creator__cv-feature--sub" : ""}">
      <button type="button" class="dauligor-character-creator__cv-feature-head" data-action="cv-feature-toggle" data-key="${escapeHtml(key)}">
        <span class="dauligor-character-creator__cv-feature-name">${isSub ? `<span class="dauligor-character-creator__cv-feature-badge">Subclass</span> ` : ""}${escapeHtml(f.name || "")}</span>
        <span class="dauligor-character-creator__cv-feature-lvl">Lvl ${Number(f.level) || 1} <i class="fas fa-chevron-${expanded ? "up" : "down"}"></i></span>
      </button>
      ${body}
    </div>`;
}

function cvFeatureList(bundle, selSub, onlySub, cvExpanded) {
  const classFeats = onlySub ? [] : (bundle.features || []).filter((f) => f.featureKind === "classFeature");
  const subFeats = selSub ? (bundle.features || []).filter((f) => f.parentSourceId === selSub.sourceId) : [];
  const all = [
    ...classFeats.map((f) => ({ f, sub: false })),
    ...subFeats.map((f) => ({ f, sub: true })),
  ].sort((a, b) => (Number(a.f.level) || 0) - (Number(b.f.level) || 0));
  if (!all.length) {
    return onlySub
      ? `<div class="dauligor-character-creator__empty">No features authored for this subclass yet.</div>`
      : `<div class="dauligor-character-creator__empty">Feature details aren't authored for this class yet — the level table above lists the features by level.</div>`;
  }
  return `<div class="dauligor-character-creator__cv-features">${all.map(({ f, sub }) => cvFeatureCard(f, sub, cvExpanded)).join("")}</div>`;
}

function cvSpellsTab(view) {
  const { chosen, cvSpells } = view;
  const entry = cvSpells.get(chosen.bundleUrl);
  if (!entry || entry.status === "loading") {
    view.onFetchSpells?.(chosen);
    return `<div class="dauligor-character-creator__loading"><i class="fas fa-spinner fa-spin"></i> Loading spell list…</div>`;
  }
  if (entry.status === "error") return `<div class="dauligor-character-creator__empty">Could not load the spell list.</div>`;
  const spells = entry.spells || [];
  if (!spells.length) return `<div class="dauligor-character-creator__empty">No curated spell list for this class.</div>`;
  const byLevel = {};
  for (const sp of spells) {
    const f = sp.flags?.[MODULE_ID] ?? {};
    const lvl = Number(f.level ?? sp.system?.level ?? 0) || 0;
    (byLevel[lvl] ||= []).push(sp);
  }
  const levels = Object.keys(byLevel).map(Number).sort((a, b) => a - b);
  return `<div class="dauligor-character-creator__cv-spells">${levels.map((lvl) => {
    const list = byLevel[lvl].slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const heading = lvl === 0 ? "Cantrips" : `Level ${lvl}`;
    return `<div class="dauligor-character-creator__cv-spell-group">
      <div class="dauligor-character-creator__cv-spell-heading">${heading} <span>(${list.length})</span></div>
      <div class="dauligor-character-creator__cv-spell-rows">${list.map((sp) => `<span class="dauligor-character-creator__cv-spell">${escapeHtml(String(sp.name || ""))}</span>`).join("")}</div>
    </div>`;
  }).join("")}</div>`;
}

function cvHeader(chosen, c) {
  const sourceTag = escapeHtml((chosen.sourceSlug || "").toUpperCase());
  const img = c.previewImageUrl || c.imageUrl || c.cardImageUrl || chosen.img || "";
  const hitDie = c.hitDie ? `d${c.hitDie}` : "—";
  const isCaster = !!(c.spellcasting && (c.spellcasting.hasSpellcasting || c.spellcasting.ability));
  const ability = c.spellcasting?.ability ? formatFoundryLabel(String(c.spellcasting.ability)) : "";
  const tags = (c.tagIds || []).map(prettifySlug).filter(Boolean);
  const headerStyle = img
    ? ` style="background-image: linear-gradient(to top, var(--dauligor-panel) 35%, rgba(0,0,0,0.25)), url('${escapeHtml(img)}')"`
    : "";
  return `
    <header class="dauligor-character-creator__cp-header"${headerStyle}>
      <div class="dauligor-character-creator__cp-heading">
        <h3 class="dauligor-character-creator__cp-name">${escapeHtml(chosen.name)}</h3>
        <span class="dauligor-character-creator__cp-source">${sourceTag}</span>
      </div>
      <div class="dauligor-character-creator__cp-badges">
        <span class="dauligor-character-creator__cp-badge">Hit Die ${hitDie}</span>
        ${isCaster ? `<span class="dauligor-character-creator__cp-badge">Caster${ability ? ` · ${ability}` : ""}</span>` : ""}
      </div>
      ${tags.length ? `<div class="dauligor-character-creator__cp-tags">${tags.map((t) => `<span class="dauligor-character-creator__cp-tag">${escapeHtml(t)}</span>`).join("")}</div>` : ""}
    </header>`;
}

/**
 * The rich class view. `view`:
 *   { chosen, bundle, cvTab, cvSubclassId, cvExpanded:Set, cvSpells:Map,
 *     spellChart, onFetchSpells(chosen) }
 * Returns HTML. When `bundle` is null, returns a loading shell.
 */
export function renderClassView(view) {
  const { chosen, bundle } = view;
  if (!bundle) {
    const sourceTag = escapeHtml((chosen?.sourceSlug || "").toUpperCase());
    return `
      <div class="dauligor-detail">
        <div class="dauligor-detail__pane">
          <header class="dauligor-detail__header">
            <h3 class="dauligor-detail__name">${escapeHtml(chosen?.name || "")}</h3>
            <div class="dauligor-detail__meta">Class · ${sourceTag}</div>
          </header>
          <div class="dauligor-detail__body"><p class="dauligor-character-creator__loading"><i class="fas fa-spinner fa-spin"></i> Loading class details…</p></div>
        </div>
      </div>`;
  }

  const c = bundle.class || {};
  const subclasses = Array.isArray(bundle.subclasses) ? bundle.subclasses : [];
  const selSub = subclasses.find((s) => s.sourceId === view.cvSubclassId) || null;
  const showSpells = !!effectiveSpellcasting(c, selSub);

  const tabDefs = [
    { id: "features", label: "Features" },
    ...(selSub ? [{ id: "subclass", label: "Subclass" }] : []),
    ...(showSpells ? [{ id: "spells", label: "Spell List" }] : []),
    { id: "info", label: "Info" },
    { id: "flavor", label: "Flavor" },
  ];
  const tab = tabDefs.some((t) => t.id === view.cvTab) ? view.cvTab : "features";
  const tabBtns = tabDefs.map((t) =>
    `<button type="button" class="dauligor-character-creator__cv-tab ${t.id === tab ? "dauligor-character-creator__cv-tab--active" : ""}" data-action="cv-tab" data-tab="${t.id}">${escapeHtml(t.label)}</button>`
  ).join("");

  const subPicker = subclasses.length
    ? `<select class="dauligor-character-creator__cv-subpicker" data-action="cv-subclass">
         <option value="">${escapeHtml(c.subclassTitle || "Subclass")}…</option>
         ${subclasses.map((s) => `<option value="${escapeHtml(s.sourceId)}" ${s.sourceId === view.cvSubclassId ? "selected" : ""}>${escapeHtml(s.name || "")}</option>`).join("")}
       </select>`
    : "";

  let content = "";
  if (tab === "features") {
    content = cvFeatureList(bundle, selSub, false, view.cvExpanded);
  } else if (tab === "subclass") {
    content = selSub
      ? `${selSub.description ? `<div class="dauligor-character-creator__cv-prose dauligor-character-creator__desc">${renderDescription(selSub.description)}</div>` : ""}${cvFeatureList(bundle, selSub, true, view.cvExpanded)}`
      : `<div class="dauligor-character-creator__empty">Pick a subclass above to view its features.</div>`;
  } else if (tab === "spells") {
    content = cvSpellsTab(view);
  } else if (tab === "info") {
    const desc = c.description ? `<h4 class="dauligor-character-creator__cp-side-title">Class Description</h4><div class="dauligor-character-creator__cv-prose dauligor-character-creator__desc">${renderDescription(c.description)}</div>` : "";
    const lore = c.lore ? `<h4 class="dauligor-character-creator__cp-side-title">Class Lore</h4><div class="dauligor-character-creator__cv-prose dauligor-character-creator__desc">${renderDescription(c.lore)}</div>` : "";
    content = (desc || lore) ? `${desc}${lore}` : `<div class="dauligor-character-creator__empty">No description or lore written yet.</div>`;
  } else if (tab === "flavor") {
    content = `<div class="dauligor-character-creator__empty">Flavor &amp; roleplaying guidance — coming soon.</div>`;
  }

  const showSidebar = tab !== "spells";
  return `
    <div class="dauligor-character-creator__cv">
      ${cvHeader(chosen, c)}
      ${cvTable(bundle, selSub, view.spellChart)}
      <div class="dauligor-character-creator__cv-tabsrow">
        <div class="dauligor-character-creator__cv-tabs">${tabBtns}</div>
        ${subPicker}
      </div>
      <div class="dauligor-character-creator__cv-bottom ${showSidebar ? "" : "dauligor-character-creator__cv-bottom--full"}">
        <div class="dauligor-character-creator__cv-content">${content}</div>
        ${showSidebar ? `<aside class="dauligor-character-creator__cv-sidecol">${cvCoreTraits(c)}</aside>` : ""}
      </div>
    </div>`;
}

/**
 * Wire the ClassView interactions on a rendered container: tab switch, subclass
 * pick, feature expand. Each mutates `view` then calls `onRerender()`. (The
 * creator binds these itself; this is for standalone hosts.)
 */
export function bindClassView(root, view, onRerender) {
  if (!root) return;
  root.querySelectorAll(`[data-action="cv-tab"]`).forEach((el) => {
    el.addEventListener("click", () => { view.cvTab = el.dataset.tab; onRerender(); });
  });
  root.querySelectorAll(`[data-action="cv-subclass"]`).forEach((el) => {
    el.addEventListener("change", () => {
      view.cvSubclassId = el.value || null;
      if (!view.cvSubclassId && view.cvTab === "subclass") view.cvTab = "features";
      onRerender();
    });
  });
  root.querySelectorAll(`[data-action="cv-feature-toggle"]`).forEach((el) => {
    el.addEventListener("click", () => {
      const key = el.dataset.key;
      if (view.cvExpanded.has(key)) view.cvExpanded.delete(key); else view.cvExpanded.add(key);
      onRerender();
    });
  });
}

// ── data fetch helpers (host owns the caches/state) ───────────────────────────

/** Fetch the full semantic class-export bundle (cached by URL). */
export async function fetchClassBundle(url, cache, inFlight) {
  if (!url) return null;
  if (cache.has(url)) return cache.get(url);
  if (inFlight.has(url)) return null;
  inFlight.add(url);
  try {
    const res = await fetch(url, { cache: "no-store" });
    inFlight.delete(url);
    if (!res.ok) return null;
    const payload = await res.json();
    if (!payload?.class) return null;
    cache.set(url, payload);
    return payload;
  } catch (err) {
    inFlight.delete(url);
    log("class-detail: bundle fetch failed", { url, err });
    return null;
  }
}

/** Fetch the master multiclass slot chart once. `state` = { spellChart, spellChartFetched }. */
export async function ensureSpellChart(state) {
  if (state.spellChartFetched) return state.spellChart;
  state.spellChartFetched = true;
  try {
    const res = await fetch(`${resolveApiHost()}/api/module/spellcasting/multiclass-chart.json`, { cache: "no-store" });
    if (!res.ok) return null;
    const payload = await res.json();
    if (payload?.kind !== "dauligor.spellcasting-chart.v1") return null;
    state.spellChart = Array.isArray(payload.levels) ? payload.levels : null;
    return state.spellChart;
  } catch (err) {
    log("class-detail: spell chart fetch failed", err);
    return null;
  }
}

/** Lazily fetch the class spell list into `cvSpells` (Map by bundleUrl), then onReady. */
export function fetchClassSpells(bundleUrl, cvSpells, onReady) {
  if (!bundleUrl || cvSpells.has(bundleUrl)) return;
  cvSpells.set(bundleUrl, { status: "loading", spells: [] });
  fetchClassSpellList(bundleUrl)
    .then((spells) => {
      cvSpells.set(bundleUrl, { status: "ready", spells: Array.isArray(spells) ? spells : [] });
      onReady?.(bundleUrl);
    })
    .catch((err) => {
      log("class-detail: class spell list fetch failed", err);
      cvSpells.set(bundleUrl, { status: "error", spells: [] });
    });
}
