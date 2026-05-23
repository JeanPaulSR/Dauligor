/**
 * AccentTabsList — plain rectangular tab strip with a full border
 * around every tab and a thick top-edge accent on the active one.
 *
 * Functional contract (the spec accumulated across the design pass):
 *
 *   1. Every tab carries a visible 1px border around all four
 *      sides at every state. The shared edges between adjacent
 *      tabs collapse cleanly (each tab paints its right border;
 *      only the leftmost paints a left border), so the strip
 *      reads as a row of joined cells rather than floating
 *      buttons with double-edges between them.
 *
 *   2. Unselected tabs use neutral default colors at rest — no
 *      gold accent, transparent fill, muted foreground text.
 *
 *   3. Hovering an unselected tab previews the active treatment:
 *      a slight gold-tinted fill, gold-tinted text, and a faded
 *      gold top accent (40% of the active strength). All four
 *      side borders take a faded-gold color too.
 *
 *   4. Every tab has the SAME 3px-thick top border at all times;
 *      the active state is communicated by COLOR — neutral grey
 *      on inactive, full-strength gold on the active tab. The
 *      active tab also gains a small background veil to seat the
 *      gold text without competing with the gold accent strip.
 *
 *   5. The active tab always paints on top via inline `zIndex`.
 *      The rectangles don't overlap, so this is overkill for
 *      this style — but it's a one-line safety net that keeps
 *      the previous "active loses to neighbour at the seam" bug
 *      from ever returning if anyone re-skins to an overlapping
 *      shape later.
 *
 * Layout stability: the top border is ALWAYS 3px (color varies
 * by state). Inactive tabs use `transparent` for the inactive
 * top so they reserve the same space as the active tab's gold
 * top — no vertical reflow when the selection changes.
 *
 * Must be rendered inside a controlled `<Tabs value=… onValueChange=…>`
 * — pass the same `active` value here.
 */

import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { TabsList, TabsTrigger } from './tabs';

export interface AccentTab<V extends string> {
  /** Unique value matching the parent `<Tabs value=…>`. */
  value: V;
  /** Visible label rendered inside the tab. */
  label: string;
  /** Optional lucide icon shown left of the label. */
  icon?: LucideIcon;
  /**
   * When true, a small content-present dot renders to the right
   * of the label. Use this to signal "this tab has data even
   * though you can't see it" (e.g. an Automation tab carrying
   * configured effects while you're on the Details tab).
   */
  showDot?: boolean;
  /** Optional `title` attribute on the dot for screen-reader hover. */
  dotTitle?: string;
}

export interface AccentTabsListProps<V extends string> {
  /** The currently-selected tab value (controlled). */
  active: V;
  tabs: readonly AccentTab<V>[];
  /** Extra classes for the TabsList container. */
  className?: string;
}

// Border colors per state — pulled out so the per-side wiring below
// stays readable. All theme-aware: `foreground` adapts to dark vs
// light; `--gold` is the highlight color of the active theme.
const NEUTRAL_BORDER = 'oklch(from var(--foreground) l c h / 0.22)';
const HOVER_BORDER = 'color-mix(in srgb, var(--gold) 50%, transparent)';
const ACTIVE_TOP_BORDER = 'var(--gold)';
// The active tab's SIDE borders stay neutral so the gold top edge
// reads as the singular accent. Bumping them to gold would "box
// off" the active tab in a way that competed with the top stripe.
const ACTIVE_SIDE_BORDER = NEUTRAL_BORDER;

export function AccentTabsList<V extends string>({
  active,
  tabs,
  className,
}: AccentTabsListProps<V>) {
  // Hover tracked locally so we can drive the per-tab preview state
  // from inline `style` — keeps the per-side border logic in one
  // place with the per-state color rules.
  const [hovered, setHovered] = useState<V | null>(null);

  return (
    <TabsList
      className={`flex bg-transparent rounded-none p-0 h-auto gap-0 overflow-visible w-full ${
        className ?? ''
      }`}
    >
      {tabs.map((tab, i) => {
        const isActive = active === tab.value;
        const isHover = !isActive && hovered === tab.value;
        const Icon = tab.icon;
        const isFirst = i === 0;

        // State → background + text + top-edge color.
        let backgroundColor: string;
        let color: string;
        let topBorderColor: string;
        let sideBorderColor: string;
        if (isActive) {
          backgroundColor = 'oklch(from var(--foreground) l c h / 0.08)';
          color = 'var(--gold)';
          topBorderColor = ACTIVE_TOP_BORDER;
          sideBorderColor = ACTIVE_SIDE_BORDER;
        } else if (isHover) {
          backgroundColor = 'color-mix(in srgb, var(--gold) 8%, transparent)';
          color = 'color-mix(in srgb, var(--gold) 80%, transparent)';
          topBorderColor = HOVER_BORDER;
          sideBorderColor = HOVER_BORDER;
        } else {
          backgroundColor = 'transparent';
          color = 'oklch(from var(--foreground) l c h / 0.5)';
          // Inactive tabs show a VISIBLE neutral top border at the
          // same thickness as the active sibling's gold strip —
          // each tab reads as a fully-outlined box on all four
          // sides, with the active state communicated by COLOR
          // (gold vs neutral) rather than presence/absence. Keeps
          // the row height fixed too, since every state reserves
          // the same border-top space.
          topBorderColor = NEUTRAL_BORDER;
          sideBorderColor = NEUTRAL_BORDER;
        }

        return (
          <TabsTrigger
            key={tab.value}
            value={tab.value}
            onMouseEnter={() => setHovered(tab.value)}
            onMouseLeave={() => setHovered(null)}
            style={{
              backgroundColor,
              color,
              // Top accent is always 3px so the row never reflows;
              // colour swap is what carries the active state.
              borderTopWidth: '3px',
              borderTopStyle: 'solid',
              borderTopColor: topBorderColor,
              // Right, bottom and (first-tab only) left edges are
              // 2px (T2 from the mockup compare — gives each tab a
              // substantial outline without competing with the top
              // accent strip). The leftmost tab paints its own
              // left edge; others rely on the previous tab's right
              // edge to seal that side, so adjacent tabs share a
              // single 2px line rather than doubling up to 4px.
              borderRightWidth: '2px',
              borderRightStyle: 'solid',
              borderRightColor: sideBorderColor,
              borderBottomWidth: '2px',
              borderBottomStyle: 'solid',
              borderBottomColor: sideBorderColor,
              borderLeftWidth: isFirst ? '2px' : '0',
              borderLeftStyle: 'solid',
              borderLeftColor: sideBorderColor,
              zIndex: isActive ? 30 : 1,
            }}
            className="relative flex-1 py-3 px-4 text-[10px] font-black uppercase tracking-[0.12em] inline-flex items-center justify-center gap-2 transition-all duration-200 whitespace-nowrap"
          >
            {Icon && <Icon className="w-3.5 h-3.5 shrink-0" />}
            {tab.label}
            {tab.showDot && (
              <span
                className="w-1.5 h-1.5 rounded-full bg-current opacity-80 shrink-0"
                aria-hidden="true"
                title={tab.dotTitle}
              />
            )}
          </TabsTrigger>
        );
      })}
    </TabsList>
  );
}
