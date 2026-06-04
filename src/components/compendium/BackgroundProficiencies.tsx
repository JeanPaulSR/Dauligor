import { cn } from '../../lib/utils';
import { bbcodeToHtml } from '../../lib/bbcode';
import { cleanFoundryHtml } from '../../lib/foundryHtmlCleanup';
import type { BackgroundProfEntry } from '../../lib/backgroundDetails';

/**
 * Renders a background's "at-a-glance" proficiency block — the classic D&D
 * book lines (Skill Proficiencies / Tool Proficiencies / Languages / Equipment,
 * plus 2024's Ability Scores / Feat). Entries come pre-parsed + ordered from
 * `parseBackgroundDetails`, with values still as raw BBCode.
 *
 * Values render through the SAME display transform feats/spells use —
 * `cleanFoundryHtml(bbcodeToHtml(value))` — so cross-references become links,
 * `[url]`s render, and any residual Foundry/5etools enricher artifact is mopped
 * up centrally rather than hand-stripped here. The single wrapping `<p>` is
 * removed so the value sits inline after its label.
 */

function toInlineHtml(bbcode: string): string {
  return cleanFoundryHtml(bbcodeToHtml(String(bbcode || '')))
    .replace(/^\s*<p>([\s\S]*?)<\/p>\s*$/i, '$1')
    .trim();
}

export default function BackgroundProficiencies({
  entries,
  className,
  size = 'md',
}: {
  entries: BackgroundProfEntry[];
  className?: string;
  /** `sm` for the narrower editor preview rail; `md` for the public detail panel. */
  size?: 'sm' | 'md';
}) {
  if (!entries.length) return null;
  return (
    <div className={cn(size === 'sm' ? 'space-y-1' : 'space-y-1.5', className)}>
      {entries.map((entry) => (
        <p key={entry.key} className={cn('leading-snug', size === 'sm' ? 'text-xs' : 'text-sm')}>
          <span className="font-semibold text-gold/80">{entry.label}:</span>{' '}
          <span
            className="text-ink/90 [&_a]:text-gold [&_a]:underline [&_a]:underline-offset-2"
            dangerouslySetInnerHTML={{ __html: toInlineHtml(entry.value) }}
          />
        </p>
      ))}
    </div>
  );
}
