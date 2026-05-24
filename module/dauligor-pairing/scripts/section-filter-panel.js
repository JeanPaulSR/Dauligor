// Section Filter Panel — vanilla-JS port of `src/components/compendium/
// SectionFilterPanel.tsx`. The Foundry module's filter modals (spell
// preparation, class browser) now share the same tri-state pill UX as
// the dauligor.com `/compendium/*` filter surfaces: left-click cycles
// off → include → exclude → off; right-click reverses; each section
// carries its own All / Clear / None / OR-AND-XOR combine + exclude /
// Hide / Subtags-expand-all / Abbr-toggle controls.
//
// Render strategy
// ---------------
// Pure-function: `renderSectionFilterPanel(state)` returns an HTML
// string. The caller injects that into the modal root, then calls
// `bindSectionFilterPanelEvents(rootEl, handlers)` to wire interaction.
// Re-renders go through the caller (same pattern the existing
// `_renderFilterModal` uses in the module's own code).
//
// State shape (mirrors the React component's props)
// -------------------------------------------------
//   axes:                  FilterSection[]   — the only required input
//   axisFilters:           { [axisKey]: { states: {[v]: 1|2 }, combineMode?, exclusionMode? } }
//   tagStates:             { [tagId]: 1|2 }
//   groupCombineModes:     { [groupId]: 'AND'|'OR'|'XOR' }
//   groupExclusionModes:   { [groupId]: 'AND'|'OR'|'XOR' }
//
// Ephemeral UI state (caller owns + bumps; passed in fresh each render)
// ---------------------------------------------------------------------
//   uiState.hiddenAxes:        Set<axisKey>
//   uiState.expandedParents:   Map<axisKey, Set<parentValue>>
//   uiState.allSubtagAxes:     Set<axisKey>      // axis-level "subtags ▾" toggle
//   uiState.altLabelAxes:      Set<axisKey>      // abbr/full toggle
//   uiState.chipSearch:        string            // modal-wide pill-name search
//
// FilterSection shape
// -------------------
//   { key, name, kind: 'axis'|'tag', axisKey?, groupId?, hasDefault?,
//     values: [{ value, label, labelAlt?, parentValue?, title?, count? }] }

const STATE_OFF = 0;
const STATE_INCLUDE = 1;
const STATE_EXCLUDE = 2;

const COMBINE_MODES = ['OR', 'AND', 'XOR'];

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function matchesChipSearch(label, axisName, query) {
  if (!query) return true;
  const q = String(query).toLowerCase();
  return (
    String(label).toLowerCase().includes(q)
    || String(axisName).toLowerCase().includes(q)
  );
}

// Lookup helpers for an axis's pill state. Axis-kind reads from
// axisFilters[axisKey].states; tag-kind reads from the flat tagStates.
function stateForValue(axis, value, axisFilters, tagStates) {
  if (axis.kind === 'tag') return tagStates[value] || 0;
  const states = axisFilters[axis.axisKey ?? axis.key]?.states ?? {};
  return states[value] || 0;
}

function combineModeFor(axis, axisFilters, groupCombineModes) {
  if (axis.kind === 'tag') {
    return (axis.groupId && groupCombineModes?.[axis.groupId]) || 'OR';
  }
  return axisFilters[axis.axisKey ?? axis.key]?.combineMode || 'OR';
}

function exclusionModeFor(axis, axisFilters, groupExclusionModes) {
  if (axis.kind === 'tag') {
    return (axis.groupId && groupExclusionModes?.[axis.groupId]) || 'OR';
  }
  return axisFilters[axis.axisKey ?? axis.key]?.exclusionMode || 'OR';
}

// Tri-state cycle helpers — exported so callers can keep the cycle
// math in one place. `forward` is left-click; `reverse` is right-click.
export function nextStateForward(current) {
  if (current === STATE_OFF) return STATE_INCLUDE;
  if (current === STATE_INCLUDE) return STATE_EXCLUDE;
  return STATE_OFF;
}
export function nextStateReverse(current) {
  if (current === STATE_OFF) return STATE_EXCLUDE;
  if (current === STATE_EXCLUDE) return STATE_INCLUDE;
  return STATE_OFF;
}
export function nextCombineMode(current) {
  const idx = COMBINE_MODES.indexOf(current || 'OR');
  return COMBINE_MODES[(idx + 1) % COMBINE_MODES.length];
}
export function nextCombineModeReverse(current) {
  const idx = COMBINE_MODES.indexOf(current || 'OR');
  return COMBINE_MODES[(idx - 1 + COMBINE_MODES.length) % COMBINE_MODES.length];
}

// =============================================================================
// Render
// =============================================================================

/**
 * Render the panel. Returns an HTML string ready to be set on the modal
 * body's innerHTML. The body is a flat wall of axis rows; each row has
 * its own header + per-axis controls + pill body.
 *
 * Pass `embedded: false` (default) to include the panel's own modal-
 * wide header (chip search input + Show/Hide-All + Reset). Embedded
 * mode skips that header, relying on the caller's surrounding chrome.
 */
export function renderSectionFilterPanel({
  axes = [],
  axisFilters = {},
  tagStates = {},
  groupCombineModes = {},
  groupExclusionModes = {},
  uiState = {},
  title = 'Filters',
  searchPlaceholder = 'Filter tags…',
  resetLabel = 'Reset Filters',
  showCloseButton = true,
  embedded = false,
}) {
  const hiddenAxes = uiState.hiddenAxes instanceof Set ? uiState.hiddenAxes : new Set();
  const allSubtagAxes = uiState.allSubtagAxes instanceof Set ? uiState.allSubtagAxes : new Set();
  const altLabelAxes = uiState.altLabelAxes instanceof Set ? uiState.altLabelAxes : new Set();
  const expandedParents = uiState.expandedParents instanceof Map ? uiState.expandedParents : new Map();
  const chipSearch = String(uiState.chipSearch ?? '').trim();
  const queryLower = chipSearch.toLowerCase();

  // Count include + exclude across every axis so the header chip
  // pair reads "5 included · 2 excluded" without the caller having to
  // pre-compute it.
  let includeCount = 0;
  let excludeCount = 0;
  for (const axis of axes) {
    for (const v of axis.values) {
      const s = stateForValue(axis, v.value, axisFilters, tagStates);
      if (s === STATE_INCLUDE) includeCount++;
      else if (s === STATE_EXCLUDE) excludeCount++;
    }
  }
  const totalActive = includeCount + excludeCount;

  const headerHtml = embedded ? '' : `
    <header class="dauligor-section-filter__header">
      <div class="dauligor-section-filter__title-row">
        <h2 class="dauligor-section-filter__title">${escapeHtml(title)}</h2>
        ${showCloseButton ? `<button type="button" class="dauligor-section-filter__close" data-section-action="close" title="Close" aria-label="Close">×</button>` : ''}
      </div>
      <div class="dauligor-section-filter__toolbar">
        <input
          type="text"
          class="dauligor-section-filter__search"
          data-section-action="chip-search"
          placeholder="${escapeHtml(searchPlaceholder)}"
          value="${escapeHtml(chipSearch)}"
          aria-label="Filter pills by label"
        />
        ${chipSearch ? `<button type="button" class="dauligor-section-filter__search-clear" data-section-action="chip-search-clear" title="Clear chip search" aria-label="Clear chip search">×</button>` : ''}
        <button type="button" class="dauligor-section-filter__toolbar-btn" data-section-action="show-all" title="Expand every section">Show All</button>
        <button type="button" class="dauligor-section-filter__toolbar-btn" data-section-action="hide-all" title="Collapse every section to its header">Hide All</button>
        <button type="button" class="dauligor-section-filter__toolbar-btn" data-section-action="reset-all" title="Clear every filter">${escapeHtml(resetLabel)}</button>
        ${totalActive > 0 ? `<span class="dauligor-section-filter__count">${includeCount} <span class="dauligor-section-filter__count-sep">·</span> <span class="dauligor-section-filter__count-exclude">${excludeCount}</span></span>` : ''}
      </div>
    </header>
  `;

  // Build each axis row. Empty-section hide kicks in during chip
  // search — if no value (or the axis name itself) matches the query
  // AND no value carries an active state, drop the row.
  const rowHtmls = [];
  for (const axis of axes) {
    if (queryLower) {
      const anyMatch = axis.values.some(v => (
        matchesChipSearch(v.label, axis.name, chipSearch)
        || (v.labelAlt && matchesChipSearch(v.labelAlt, axis.name, chipSearch))
      )) || matchesChipSearch(axis.name, axis.name, chipSearch);
      if (!anyMatch) continue;
    }
    rowHtmls.push(renderAxisRow(axis, {
      axisFilters,
      tagStates,
      groupCombineModes,
      groupExclusionModes,
      hidden: hiddenAxes.has(axis.key),
      forceExpandAll: allSubtagAxes.has(axis.key),
      useAltLabel: altLabelAxes.has(axis.key),
      expanded: expandedParents.get(axis.key) || new Set(),
      chipSearch,
      queryLower,
    }));
  }

  const bodyHtml = rowHtmls.length
    ? rowHtmls.join('')
    : `<div class="dauligor-section-filter__empty">No filters match this search.</div>`;

  return `
    <div class="dauligor-section-filter">
      ${headerHtml}
      <div class="dauligor-section-filter__body">
        ${bodyHtml}
      </div>
    </div>
  `;
}

function renderAxisRow(axis, ctx) {
  const {
    axisFilters, tagStates, groupCombineModes, groupExclusionModes,
    hidden, forceExpandAll, useAltLabel, expanded, chipSearch, queryLower,
  } = ctx;

  const isTag = axis.kind === 'tag';
  const axisKey = axis.axisKey ?? axis.key;

  // Per-axis active count (the inline "· N active" hint).
  let axisActive = 0;
  for (const v of axis.values) {
    if (stateForValue(axis, v.value, axisFilters, tagStates)) axisActive++;
  }

  const combineMode = combineModeFor(axis, axisFilters, groupCombineModes);
  const exclusionMode = exclusionModeFor(axis, axisFilters, groupExclusionModes);

  // Header buttons. Each one renders unconditionally for an axis row;
  // the React version hides un-wired controls but here we always
  // render and rely on the caller's event handler being present.
  // Combine + exclude buttons always show (every axis benefits from
  // them); Subtags + abbr show only when relevant.
  const hasSubtagsAnywhere = axis.values.some(v => !!v.parentValue);
  const hasAltLabel = axis.values.some(v => !!v.labelAlt);

  const btn = (action, label, opts = {}) => {
    const { color = 'neutral', title = '', secondary } = opts;
    const classes = [
      'dauligor-section-filter__axis-btn',
      `dauligor-section-filter__axis-btn--${color}`,
    ].join(' ');
    const dataExtra = secondary ? ` data-section-axis-secondary="${escapeHtml(secondary)}"` : '';
    return `
      <button type="button"
        class="${classes}"
        data-section-action="${escapeHtml(action)}"
        data-section-axis="${escapeHtml(axisKey)}"
        ${axis.groupId ? `data-section-group="${escapeHtml(axis.groupId)}"` : ''}
        data-section-kind="${escapeHtml(axis.kind)}"${dataExtra}
        title="${escapeHtml(title)}"
      >${escapeHtml(label)}</button>
    `;
  };

  const headerControls = `
    ${btn('axis-all', 'all', { color: 'include-hover', title: 'Include every value in this section' })}
    ${btn('axis-clear', 'clear', { title: 'Remove every entry in this section' })}
    ${btn('axis-none', 'none', { color: 'exclude-hover', title: 'Exclude every value in this section' })}
    ${axis.hasDefault ? btn('axis-default', 'default', { title: 'Reset this section to its default' }) : ''}
    ${btn('axis-combine', combineMode, { color: 'include', title: `Include combinator (${combineMode}) — left click cycles forward, right click reverses` })}
    ${btn('axis-exclude', exclusionMode, { color: 'exclude', title: `Exclude combinator (${exclusionMode}) — left click cycles forward, right click reverses` })}
    ${hasSubtagsAnywhere ? btn('axis-subtags', forceExpandAll ? 'subtags ▾' : 'subtags ▸', { title: forceExpandAll ? 'Collapse every subtag drawer in this section' : 'Expand every subtag drawer in this section' }) : ''}
    ${hasAltLabel ? btn('axis-abbr', useAltLabel ? 'full' : 'abbr', { title: useAltLabel ? 'Show abbreviated labels' : 'Show full labels' }) : ''}
    ${btn('axis-hide', hidden ? 'show' : 'hide', { title: hidden ? 'Show this section again' : 'Collapse this section to just the header' })}
  `;

  const pillBodyHtml = hidden ? '' : renderPillBody(axis, {
    axisFilters, tagStates,
    forceExpandAll, useAltLabel, expanded, chipSearch, queryLower,
  });

  return `
    <section class="dauligor-section-filter__axis" data-section-axis-row="${escapeHtml(axisKey)}">
      <div class="dauligor-section-filter__axis-head">
        <div class="dauligor-section-filter__axis-title-wrap">
          <span class="dauligor-section-filter__axis-title">${escapeHtml(axis.name)}</span>
          ${axisActive > 0 ? `<span class="dauligor-section-filter__axis-active">· ${axisActive} active</span>` : ''}
        </div>
        <div class="dauligor-section-filter__axis-controls">${headerControls}</div>
      </div>
      ${pillBodyHtml}
    </section>
  `;
}

function renderPillBody(axis, ctx) {
  const { axisFilters, tagStates, forceExpandAll, useAltLabel, expanded, chipSearch, queryLower } = ctx;
  const axisKey = axis.axisKey ?? axis.key;

  // Partition values into roots + children. A child whose parentValue
  // doesn't refer to anything in this axis falls back to a root (cross-
  // group orphan handling — matches the React version).
  const valueIds = new Set(axis.values.map(v => v.value));
  const roots = axis.values.filter(v => !v.parentValue || !valueIds.has(v.parentValue));
  const childrenByParent = new Map();
  for (const v of axis.values) {
    if (!v.parentValue || !valueIds.has(v.parentValue)) continue;
    if (!childrenByParent.has(v.parentValue)) childrenByParent.set(v.parentValue, []);
    childrenByParent.get(v.parentValue).push(v);
  }

  // Auto-expand drivers — parents with an actively-filtering child OR
  // a child matching chip search OR matching the parent's own label
  // get their drawer auto-opened.
  const autoExpanded = new Set();
  const searching = queryLower !== '';
  for (const v of axis.values) {
    if (!v.parentValue || !valueIds.has(v.parentValue)) continue;
    const s = stateForValue(axis, v.value, axisFilters, tagStates);
    const matchesSearch = searching && matchesChipSearch(v.label, axis.name, chipSearch);
    if (s || matchesSearch) autoExpanded.add(v.parentValue);
  }
  for (const root of roots) {
    if (!childrenByParent.has(root.value)) continue;
    if (searching && matchesChipSearch(root.label, axis.name, chipSearch)) {
      autoExpanded.add(root.value);
    }
  }

  const isExpanded = (parentValue) =>
    forceExpandAll || expanded.has(parentValue) || autoExpanded.has(parentValue);

  // Visible roots — chip-search hides non-matching roots unless one of
  // their children matches (so the drawer can still be auto-opened).
  const visibleRoots = roots.filter(r => {
    if (!searching) return true;
    if (matchesChipSearch(r.label, axis.name, chipSearch)) return true;
    if (r.labelAlt && matchesChipSearch(r.labelAlt, axis.name, chipSearch)) return true;
    if (autoExpanded.has(r.value)) return true;
    return false;
  });

  const pillHtml = (v, opts = {}) => {
    const { searchHide = false } = opts;
    if (searchHide && searching) {
      if (!matchesChipSearch(v.label, axis.name, chipSearch)
          && (!v.labelAlt || !matchesChipSearch(v.labelAlt, axis.name, chipSearch))) {
        return '';
      }
    }
    const state = stateForValue(axis, v.value, axisFilters, tagStates);
    const renderedLabel = useAltLabel && v.labelAlt ? v.labelAlt : v.label;
    const modClass = state === STATE_INCLUDE
      ? 'dauligor-section-filter__pill--include'
      : state === STATE_EXCLUDE
        ? 'dauligor-section-filter__pill--exclude'
        : '';
    const tooltip = v.title || (
      !state
        ? `"${renderedLabel}"\nLeft click: include\nRight click: exclude`
        : state === STATE_INCLUDE
          ? `Including "${renderedLabel}"\nLeft click: exclude\nRight click: clear`
          : `Excluding "${renderedLabel}"\nLeft click: clear\nRight click: include`
    );
    return `
      <button type="button"
        class="dauligor-section-filter__pill ${modClass}"
        data-section-action="pill"
        data-section-axis="${escapeHtml(axisKey)}"
        data-section-kind="${escapeHtml(axis.kind)}"
        data-section-value="${escapeHtml(v.value)}"
        title="${escapeHtml(tooltip)}"
      ><span>${escapeHtml(renderedLabel)}</span></button>
    `;
  };

  // Root row + chevrons.
  const rootRowHtml = visibleRoots.map(root => {
    const subtags = childrenByParent.get(root.value) || [];
    const hasSubtags = subtags.length > 0;
    const expandedNow = hasSubtags && isExpanded(root.value);
    const chevron = hasSubtags ? `
      <button type="button"
        class="dauligor-section-filter__chevron ${expandedNow ? 'dauligor-section-filter__chevron--open' : ''}"
        data-section-action="drawer-toggle"
        data-section-axis="${escapeHtml(axisKey)}"
        data-section-parent="${escapeHtml(root.value)}"
        title="${escapeHtml(expandedNow ? `Hide ${root.label} subtags (${subtags.length})` : `Show ${root.label} subtags (${subtags.length})`)}"
        aria-expanded="${expandedNow ? 'true' : 'false'}"
        aria-label="${escapeHtml(expandedNow ? `Collapse ${root.label} subtags` : `Expand ${root.label} subtags`)}"
      >${expandedNow ? '▾' : '▸'}</button>
    ` : '';
    return `
      <span class="dauligor-section-filter__pill-anchor">
        ${pillHtml(root)}
        ${chevron}
      </span>
    `;
  }).join('');

  // Drawer rows — gathered into a single grid so the parent-label
  // column shares one width across the whole section (mirrors the
  // React grid-cols-[auto_minmax(0,1fr)] pattern).
  const drawerRows = [];
  for (const root of visibleRoots) {
    if (!isExpanded(root.value)) continue;
    const subtags = childrenByParent.get(root.value) || [];
    const pills = subtags.map(v => pillHtml(v, { searchHide: true })).filter(Boolean);
    if (pills.length === 0) continue;
    drawerRows.push({ root, pillsHtml: pills.join('') });
  }
  const drawerHtml = drawerRows.length
    ? `
      <div class="dauligor-section-filter__drawer">
        ${drawerRows.map(({ root, pillsHtml }) => `
          <span class="dauligor-section-filter__drawer-label">${escapeHtml(root.label)}:</span>
          <div class="dauligor-section-filter__drawer-pills">${pillsHtml}</div>
        `).join('')}
      </div>
    `
    : '';

  return `
    <div class="dauligor-section-filter__pill-body">
      <div class="dauligor-section-filter__pill-row">${rootRowHtml}</div>
      ${drawerHtml}
    </div>
  `;
}

// =============================================================================
// Event binding
// =============================================================================

/**
 * Wire up a rendered panel's interactive elements. `handlers` is a
 * grab-bag of callbacks keyed by action name. Missing callbacks
 * silently no-op so a partial migration can keep working. Each
 * handler is responsible for mutating the caller's state and
 * re-rendering the panel.
 *
 * Pill semantics:
 *   - axis-kind pills: handlers.cycleAxisState(axisKey, value)
 *                      handlers.cycleAxisStateReverse(axisKey, value)
 *   - tag-kind pills:  handlers.cycleTagState(tagId)
 *                      handlers.cycleTagStateReverse(tagId)
 *
 * Combinator buttons split by axis kind too:
 *   - axis-combine + axis-exclude on axis-kind dispatch to
 *     cycleAxisCombineMode / cycleAxisExclusionMode (with reverse on
 *     right-click).
 *   - axis-combine + axis-exclude on tag-kind dispatch to
 *     cycleGroupCombineMode / cycleGroupExclusionMode (called with
 *     groupId, not axisKey).
 */
export function bindSectionFilterPanelEvents(rootEl, handlers = {}) {
  if (!rootEl) return;

  const noop = () => {};
  const h = new Proxy(handlers, {
    get(target, key) { return target[key] || noop; },
  });

  rootEl.addEventListener('click', (ev) => {
    const target = ev.target;
    if (!(target instanceof HTMLElement)) return;
    const trigger = target.closest('[data-section-action]');
    if (!trigger || !rootEl.contains(trigger)) return;
    const action = trigger.dataset.sectionAction;
    const axisKey = trigger.dataset.sectionAxis ?? '';
    const value = trigger.dataset.sectionValue ?? '';
    const kind = trigger.dataset.sectionKind ?? '';
    const groupId = trigger.dataset.sectionGroup ?? '';
    const parent = trigger.dataset.sectionParent ?? '';

    switch (action) {
      case 'pill':
        if (kind === 'tag') h.cycleTagState(value);
        else h.cycleAxisState(axisKey, value);
        return;
      case 'axis-all':
        if (kind === 'tag') h.groupIncludeAll(axisKey, groupId);
        else h.axisIncludeAll(axisKey);
        return;
      case 'axis-clear':
        if (kind === 'tag') h.groupClear(axisKey, groupId);
        else h.axisClear(axisKey);
        return;
      case 'axis-none':
        if (kind === 'tag') h.groupExcludeAll(axisKey, groupId);
        else h.axisExcludeAll(axisKey);
        return;
      case 'axis-default':
        h.axisRestoreDefault(axisKey);
        return;
      case 'axis-combine':
        if (kind === 'tag') h.cycleGroupCombineMode(groupId);
        else h.cycleAxisCombineMode(axisKey);
        return;
      case 'axis-exclude':
        if (kind === 'tag') h.cycleGroupExclusionMode(groupId);
        else h.cycleAxisExclusionMode(axisKey);
        return;
      case 'axis-subtags':
        h.toggleAllSubtags(axisKey);
        return;
      case 'axis-abbr':
        h.toggleAltLabel(axisKey);
        return;
      case 'axis-hide':
        h.toggleAxisHidden(axisKey);
        return;
      case 'drawer-toggle':
        h.toggleParentDrawer(axisKey, parent);
        return;
      case 'show-all':
        h.showAllSections();
        return;
      case 'hide-all':
        h.hideAllSections();
        return;
      case 'reset-all':
        h.resetAll();
        return;
      case 'chip-search-clear':
        h.setChipSearch('');
        return;
      case 'close':
        h.close();
        return;
      default:
        return;
    }
  });

  // Right-click = reverse cycle. Applied to pills + combinator buttons.
  rootEl.addEventListener('contextmenu', (ev) => {
    const target = ev.target;
    if (!(target instanceof HTMLElement)) return;
    const trigger = target.closest('[data-section-action]');
    if (!trigger || !rootEl.contains(trigger)) return;
    const action = trigger.dataset.sectionAction;
    if (action !== 'pill' && action !== 'axis-combine' && action !== 'axis-exclude') return;
    ev.preventDefault();
    const axisKey = trigger.dataset.sectionAxis ?? '';
    const value = trigger.dataset.sectionValue ?? '';
    const kind = trigger.dataset.sectionKind ?? '';
    const groupId = trigger.dataset.sectionGroup ?? '';
    switch (action) {
      case 'pill':
        if (kind === 'tag') h.cycleTagStateReverse(value);
        else h.cycleAxisStateReverse(axisKey, value);
        return;
      case 'axis-combine':
        if (kind === 'tag') h.cycleGroupCombineModeReverse(groupId);
        else h.cycleAxisCombineModeReverse(axisKey);
        return;
      case 'axis-exclude':
        if (kind === 'tag') h.cycleGroupExclusionModeReverse(groupId);
        else h.cycleAxisExclusionModeReverse(axisKey);
        return;
      default:
        return;
    }
  });

  // Chip-search input — fire on input event (every keystroke), not just
  // change, so the wall reacts as the user types. The caller decides
  // whether to debounce inside its handler.
  rootEl.querySelectorAll('[data-section-action="chip-search"]').forEach((el) => {
    el.addEventListener('input', (ev) => {
      h.setChipSearch(ev.target.value);
    });
  });
}

// =============================================================================
// Matching helpers — exported for callers that want to reuse the same
// inclusion/exclusion+combine math without rolling their own.
// =============================================================================

/**
 * Does `value` pass the include + exclude rules for a single-valued
 * axis? `axisState` is `{ states, combineMode, exclusionMode }`.
 *
 * Semantics for the simple single-valued case (level, school, etc.):
 *   - If no include chips, every value passes the include test.
 *   - Else: with OR/XOR (collapses to OR for single-value), the value
 *     must be one of the includes.
 *   - With AND on a single-valued axis, multiple includes can never
 *     all match — UI shows AND but matches behave as OR (matches
 *     SectionFilterPanel's documented behaviour).
 *   - Excludes always kick the value out if it's in the exclude set.
 */
export function matchesSingleAxis(value, axisState) {
  if (!axisState) return true;
  const states = axisState.states ?? {};
  const includes = [];
  const excludes = [];
  for (const k of Object.keys(states)) {
    if (states[k] === STATE_INCLUDE) includes.push(k);
    else if (states[k] === STATE_EXCLUDE) excludes.push(k);
  }
  const v = String(value);
  if (excludes.includes(v)) return false;
  if (includes.length === 0) return true;
  return includes.includes(v);
}

/**
 * Multi-valued axis match — for the spell-properties axis (a spell
 * carries a SET of properties: concentration, ritual, V/S/M). Caller
 * passes `valueSet` (a Set or array of the item's values for the
 * axis) and we apply include + exclude + combine modes.
 */
export function matchesMultiAxis(valueSet, axisState) {
  if (!axisState) return true;
  const states = axisState.states ?? {};
  const have = valueSet instanceof Set ? valueSet : new Set([...(valueSet || [])].map(String));
  const includes = [];
  const excludes = [];
  for (const k of Object.keys(states)) {
    if (states[k] === STATE_INCLUDE) includes.push(k);
    else if (states[k] === STATE_EXCLUDE) excludes.push(k);
  }
  // Exclude: caller-configured combinator. OR (any exclude in the
  // value-set → fail), AND (all excludes must be in the set → fail),
  // XOR (exactly one).
  if (excludes.length > 0) {
    const exMode = axisState.exclusionMode || 'OR';
    const exHits = excludes.filter(k => have.has(k)).length;
    if (exMode === 'OR' && exHits > 0) return false;
    if (exMode === 'AND' && exHits === excludes.length) return false;
    if (exMode === 'XOR' && exHits === 1) return false;
  }
  if (includes.length === 0) return true;
  const inMode = axisState.combineMode || 'OR';
  const inHits = includes.filter(k => have.has(k)).length;
  if (inMode === 'OR') return inHits > 0;
  if (inMode === 'AND') return inHits === includes.length;
  if (inMode === 'XOR') return inHits === 1;
  return true;
}

/**
 * Tag-group match — same shape as `matchesTagFilters` in
 * src/components/compendium/FilterBar.tsx but adapted to the module's
 * flat `tagStates` record and per-group combine/exclude modes.
 *
 * `itemTagIds` should already be expanded with ancestors via the
 * caller's parent-tag map; this fn doesn't walk hierarchy.
 */
export function matchesTagGroupsTriState({
  itemTagIds,
  tagGroups,
  tagsByGroup,
  tagStates,
  groupCombineModes = {},
  groupExclusionModes = {},
}) {
  if (!tagStates || Object.keys(tagStates).length === 0) return true;
  const have = itemTagIds instanceof Set ? itemTagIds : new Set((itemTagIds || []).map(String));
  for (const group of tagGroups) {
    const groupTags = tagsByGroup[group.id] || [];
    const ids = groupTags.map(t => String(t.id));
    const includes = ids.filter(id => tagStates[id] === STATE_INCLUDE);
    const excludes = ids.filter(id => tagStates[id] === STATE_EXCLUDE);
    if (includes.length === 0 && excludes.length === 0) continue;

    if (excludes.length > 0) {
      const exMode = groupExclusionModes[group.id] || 'OR';
      const exHits = excludes.filter(id => have.has(id)).length;
      if (exMode === 'OR' && exHits > 0) return false;
      if (exMode === 'AND' && exHits === excludes.length) return false;
      if (exMode === 'XOR' && exHits === 1) return false;
    }
    if (includes.length > 0) {
      const inMode = groupCombineModes[group.id] || 'OR';
      const inHits = includes.filter(id => have.has(id)).length;
      if (inMode === 'OR' && inHits === 0) return false;
      if (inMode === 'AND' && inHits !== includes.length) return false;
      if (inMode === 'XOR' && inHits !== 1) return false;
    }
  }
  return true;
}

export const SECTION_FILTER_STATE = {
  OFF: STATE_OFF,
  INCLUDE: STATE_INCLUDE,
  EXCLUDE: STATE_EXCLUDE,
};
