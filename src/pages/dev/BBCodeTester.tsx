import { useMemo, useState } from 'react';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import MarkdownEditor from '../../components/MarkdownEditor';
import BBCodeRenderer from '../../components/BBCodeRenderer';
import { bbcodeToHtml, htmlToBbcode, type BbcodeViewContext } from '../../lib/bbcode';
import { Copy, CheckCircle2, AlertCircle, FileText, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Dev-only BBCode testbed.
 *
 * Two-pane layout: editor on the left, live preview + round-trip diagnostics on
 * the right. The bottom row carries a catalog of preset BBCode snippets so each
 * tag can be exercised in isolation.
 *
 * Goal: make it cheap to find and report BBCode defects. The "Copy bug report"
 * button assembles a structured snippet (input / rendered HTML / round-trip /
 * stability flag) ready to paste into a bug tracker or chat.
 *
 * Lives under /dev/bbcode and is gated by AdminOnly in App.tsx.
 */

interface BBCodeTesterProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  userProfile: any;
}

interface TestCase {
  name: string;
  bbcode: string;
  note?: string;
}

interface TestGroup {
  group: string;
  cases: TestCase[];
}

const TEST_CASES: TestGroup[] = [
  {
    group: 'Basic formatting',
    cases: [
      { name: 'Bold', bbcode: '[b]Bold text[/b]' },
      { name: 'Italic', bbcode: '[i]Italic text[/i]' },
      { name: 'Underline', bbcode: '[u]Underlined text[/u]' },
      { name: 'Strikethrough', bbcode: '[s]Crossed out[/s]' },
      { name: 'Nested b+i+u', bbcode: '[b][i][u]Bold italic underline[/u][/i][/b]' },
    ],
  },
  {
    group: 'Headings',
    cases: [
      { name: 'H1', bbcode: '[h1]Heading 1[/h1]' },
      { name: 'H2', bbcode: '[h2]Heading 2[/h2]' },
      { name: 'H3', bbcode: '[h3]Heading 3[/h3]' },
      { name: 'H4', bbcode: '[h4]Heading 4[/h4]' },
      { name: 'H1 + paragraph', bbcode: '[h1]Title[/h1]\n\nIntro paragraph follows the heading.' },
    ],
  },
  {
    group: 'Alignment',
    cases: [
      { name: 'Left', bbcode: '[left]Left-aligned paragraph.[/left]' },
      { name: 'Center', bbcode: '[center]Centered paragraph.[/center]' },
      { name: 'Right', bbcode: '[right]Right-aligned paragraph.[/right]' },
      {
        name: 'Justify',
        bbcode:
          '[justify]Justified prose extends across the full width of its container without leaving ragged right edges. Spacing between words varies to fill the line.[/justify]',
      },
    ],
  },
  {
    group: 'Lists',
    cases: [
      { name: 'Unordered', bbcode: '[ul][li]First[/li][li]Second[/li][li]Third[/li][/ul]' },
      { name: 'Ordered', bbcode: '[ol][li]First[/li][li]Second[/li][li]Third[/li][/ol]' },
      {
        name: 'Nested',
        bbcode: '[ul][li]Top one[ul][li]Sub-A[/li][li]Sub-B[/li][/ul][/li][li]Top two[/li][/ul]',
      },
      {
        name: 'Deeply nested',
        bbcode:
          '[ul][li]Level 1[ul][li]Level 2[ul][li]Level 3[ul][li]Level 4[/li][/ul][/li][/ul][/li][/ul][/li][/ul]',
      },
    ],
  },
  {
    group: 'Tables',
    cases: [
      {
        name: 'Simple',
        bbcode:
          '[table][tr][th]Col 1[/th][th]Col 2[/th][/tr][tr][td]A[/td][td]B[/td][/tr][tr][td]C[/td][td]D[/td][/tr][/table]',
      },
      {
        name: 'With colspan',
        bbcode:
          '[table][tr][th colspan=2]Spanning header[/th][/tr][tr][td]A[/td][td]B[/td][/tr][/table]',
      },
      {
        name: 'With rowspan',
        bbcode:
          '[table][tr][td rowspan=2]Tall[/td][td]Top[/td][/tr][tr][td]Bot[/td][/tr][/table]',
      },
    ],
  },
  {
    group: 'Links',
    cases: [
      { name: 'URL with href', bbcode: '[url=https://www.dauligor.com]The Archive[/url]' },
      { name: 'Plain URL', bbcode: '[url]https://www.dauligor.com[/url]' },
    ],
  },
  {
    group: 'Cross-references — working kinds',
    cases: [
      {
        name: 'Spell ref',
        bbcode: 'Cast [ref|spell|fire-bolt]Fire Bolt[/ref] at the door.',
        note: 'Should render as a gold-dotted-underline link routing to /compendium/spells?focus=fire-bolt.',
      },
      {
        name: 'Class ref',
        bbcode: 'The [ref|class|wizard]Wizard[/ref] approached.',
        note: 'Routes to /compendium/classes/view/wizard.',
      },
      {
        name: 'Condition ref',
        bbcode: 'You become [ref|condition|prone]prone[/ref].',
        note: 'Routes to /admin/statuses?focus=prone (admin-only destination; link still styled for non-admins).',
      },
    ],
  },
  {
    group: 'Cross-references — missing kinds (render as dangling badges)',
    cases: [
      {
        name: 'Item ref (dangling)',
        bbcode: 'He drew [ref|item|longsword]the longsword[/ref].',
        note: 'No item kind wired up. Renders as ref-dangling span.',
      },
      {
        name: 'Article ref (dangling)',
        bbcode: 'See the article on [ref|article|deep-shadow-cult]the Deep Shadow Cult[/ref].',
      },
      {
        name: 'Feat ref (dangling)',
        bbcode: 'Take [ref|feat|great-weapon-master]Great Weapon Master[/ref].',
      },
      {
        name: 'Creature ref (placeholder)',
        bbcode: 'A [ref|creature|adult-red-dragon]red dragon[/ref] emerges.',
        note: 'creature kind is in RefKind but resolveRefRoute returns null — intentional placeholder.',
      },
    ],
  },
  {
    group: 'Code & quotes',
    cases: [
      {
        name: 'Inline code',
        bbcode: 'Use [code]@scale.wizard.cantrip-damage[/code] in formulas.',
      },
      {
        name: 'Code with HTML chars',
        bbcode: 'Tag opening: [code]<script>[/code] should be escaped, not executed.',
      },
      {
        name: 'Block quote',
        bbcode: '[quote]"All that is gold does not glitter, not all those who wander are lost."[/quote]',
      },
    ],
  },
  {
    group: 'Misc tags',
    cases: [
      { name: 'Horizontal rule', bbcode: 'Above the rule.\n[hr]\nBelow the rule.' },
      { name: 'Line break', bbcode: 'Line one[br]Line two on the same paragraph.' },
      { name: 'Small text', bbcode: 'Normal text and [small]small text inline[/small] back to normal.' },
      { name: 'Subscript', bbcode: 'Chemical formula: H[sub]2[/sub]O' },
      { name: 'Superscript', bbcode: 'Equation: x[sup]2[/sup] + y[sup]2[/sup] = r[sup]2[/sup]' },
      { name: 'Spoiler', bbcode: 'The killer was [spoiler]the butler[/spoiler].' },
      {
        name: 'Comment (hidden)',
        bbcode: 'Visible. [comment]This is a hidden TODO note for the author.[/comment] Also visible.',
      },
      {
        name: 'Indent',
        bbcode: 'Not indented.\n[indent]Indented one level.[/indent]\nNot indented again.',
      },
    ],
  },
  {
    group: 'Combined / edge cases',
    cases: [
      {
        name: 'Mixed paragraph',
        bbcode:
          'A paragraph with [b]bold[/b], [i]italic[/i], [url=https://example.com]a link[/url], and a [ref|spell|fire-bolt]spell ref[/ref] all together.',
      },
      {
        name: 'Heading + list + ref',
        bbcode:
          '[h2]Spells[/h2]\n[ul][li][ref|spell|fire-bolt]Fire Bolt[/ref] — cantrip[/li][li][ref|spell|magic-missile]Magic Missile[/ref] — 1st level[/li][/ul]',
      },
      {
        name: 'Special chars in body',
        bbcode: 'Less than: <, greater than: >, ampersand: &, double quote: ", apostrophe: \'',
        note: 'These must be HTML-escaped before rendering, NOT after BBCode parsing.',
      },
      {
        name: 'Empty input',
        bbcode: '',
      },
      {
        name: 'Whitespace only',
        bbcode: '   \n\n   \t\n   ',
      },
      {
        name: 'Trailing newlines',
        bbcode: 'Paragraph one.\n\n\n\n\nParagraph two after many newlines.',
      },
    ],
  },
];

const INITIAL_SAMPLE = `[h2]BBCode Tester[/h2]

This page tests the BBCode pipeline end-to-end. Edit the BBCode on the left; the right pane updates in real time.

[ul]
[li]The [b]Live preview[/b] shows the rendered output.[/li]
[li]The [b]Round-trip check[/b] re-converts the rendered HTML back to BBCode. If it differs from the input, the round-trip is unstable — the editor's Visual/Source toggle would mutate content.[/li]
[li]The [b]Rendered HTML[/b] block shows the generator's output verbatim.[/li]
[li]Click [i]Copy bug report[/i] to assemble a structured snippet for filing.[/li]
[/ul]

Try a cross-reference: [ref|spell|fire-bolt]Fire Bolt[/ref] (working) vs [ref|item|longsword]Longsword[/ref] (dangling — no [code]item[/code] kind wired up yet).`;

export default function BBCodeTester(_props: BBCodeTesterProps) {
  const [bbcode, setBbcode] = useState<string>(INITIAL_SAMPLE);

  // Pretend the viewer is staff so [secret]/[campaign=…] blocks render.
  // Real consumers pass a real context; this is a dev surface.
  const viewContext: BbcodeViewContext = useMemo(
    () => ({ isStaff: true, campaignId: null }),
    []
  );

  const renderedHtml = useMemo(
    () => bbcodeToHtml(bbcode, viewContext),
    [bbcode, viewContext]
  );
  const roundTripBbcode = useMemo(() => htmlToBbcode(renderedHtml), [renderedHtml]);

  const isRoundTripStable = bbcode === roundTripBbcode;
  const charDelta = roundTripBbcode.length - bbcode.length;
  const lineCountInput = bbcode.split('\n').length;
  const lineCountRT = roundTripBbcode.split('\n').length;

  const copyReport = () => {
    const report = [
      '## BBCode Bug Report',
      '',
      `_Captured from /dev/bbcode at ${new Date().toISOString()}_`,
      '',
      '### Input BBCode',
      '```',
      bbcode || '(empty)',
      '```',
      '',
      '### Rendered HTML',
      '```html',
      renderedHtml || '(empty)',
      '```',
      '',
      '### After round-trip (input → bbcodeToHtml → htmlToBbcode)',
      '```',
      roundTripBbcode || '(empty)',
      '```',
      '',
      `### Round-trip stable? ${isRoundTripStable ? 'YES ✓' : 'NO ✗ — diverged'}`,
      `### Char count: input ${bbcode.length}, round-trip ${roundTripBbcode.length} (Δ ${charDelta >= 0 ? '+' : ''}${charDelta})`,
      `### Line count: input ${lineCountInput}, round-trip ${lineCountRT}`,
      '',
      '### Expected behaviour',
      '[describe what you expected]',
      '',
      '### Observed behaviour',
      '[describe what actually happened]',
    ].join('\n');

    navigator.clipboard.writeText(report).then(
      () => toast.success('Bug report copied to clipboard'),
      () => toast.error('Clipboard write failed — select and copy manually below')
    );
  };

  const resetSample = () => {
    setBbcode(INITIAL_SAMPLE);
    toast.message('Reset to initial sample');
  };

  return (
    <div className="container mx-auto px-4 py-6 space-y-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-3xl font-serif text-gold">BBCode Tester</h1>
          <p className="text-sm text-ink/60 mt-1">
            Dev tool. Edit BBCode on the left; preview + round-trip diagnostics update live on the right.
          </p>
        </div>
        <div className="text-xs text-ink/40 flex items-center gap-2">
          <FileText className="w-3.5 h-3.5" />
          src/pages/dev/BBCodeTester.tsx
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* LEFT — editor */}
        <Card className="p-4 flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-serif text-gold">Editor</h2>
            <div className="flex items-center gap-3 text-xs text-ink/50">
              <span>{bbcode.length} chars</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={resetSample}
                className="h-7 text-xs text-ink/50 hover:text-gold gap-1"
                title="Reset to initial sample"
              >
                <RotateCcw className="w-3 h-3" /> Reset
              </Button>
            </div>
          </div>
          <MarkdownEditor
            value={bbcode}
            onChange={setBbcode}
            placeholder="Type BBCode here..."
            minHeight="500px"
            maxHeight="70vh"
          />
        </Card>

        {/* RIGHT — preview + diagnostics */}
        <Card className="p-4 flex flex-col gap-4">
          <section>
            <h2 className="text-lg font-serif text-gold mb-2">Live preview</h2>
            <div className="border border-gold/20 rounded-md p-4 bg-background min-h-[200px]">
              <BBCodeRenderer content={bbcode} viewContext={viewContext} />
            </div>
          </section>

          <section className="border-t border-gold/10 pt-3">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-serif text-gold">Round-trip check</h2>
              {isRoundTripStable ? (
                <span className="flex items-center gap-1 text-emerald-500 text-sm font-semibold">
                  <CheckCircle2 className="w-4 h-4" /> Stable
                </span>
              ) : (
                <span className="flex items-center gap-1 text-blood text-sm font-semibold">
                  <AlertCircle className="w-4 h-4" /> Diverged
                </span>
              )}
            </div>
            <p className="text-xs text-ink/60 mb-2">
              Round-trip means <code>bbcodeToHtml &rarr; htmlToBbcode</code>. A stable
              round-trip is the contract that lets the editor toggle Visual &harr; Source
              without mutating content.
            </p>

            {!isRoundTripStable && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                <div>
                  <div className="text-ink/50 mb-1">
                    Input ({bbcode.length} chars, {lineCountInput} lines)
                  </div>
                  <pre className="bg-muted text-foreground border border-gold/10 p-2 rounded overflow-auto max-h-48 whitespace-pre-wrap break-all font-mono text-xs">
                    {bbcode || '(empty)'}
                  </pre>
                </div>
                <div>
                  <div className="text-ink/50 mb-1">
                    Round-trip ({roundTripBbcode.length} chars, {lineCountRT} lines, &Delta;{' '}
                    {charDelta >= 0 ? '+' : ''}
                    {charDelta})
                  </div>
                  <pre className="bg-muted text-foreground border border-gold/10 p-2 rounded overflow-auto max-h-48 whitespace-pre-wrap break-all font-mono text-xs">
                    {roundTripBbcode || '(empty)'}
                  </pre>
                </div>
              </div>
            )}
          </section>

          <section className="border-t border-gold/10 pt-3">
            <h2 className="text-lg font-serif text-gold mb-2">Rendered HTML (raw)</h2>
            <pre className="bg-muted text-foreground border border-gold/10 p-3 rounded text-xs overflow-auto max-h-64 whitespace-pre-wrap break-all font-mono">
              {renderedHtml || '(empty)'}
            </pre>
          </section>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-gold/10">
            <Button onClick={copyReport} variant="outline" size="sm" className="gap-2">
              <Copy className="w-3.5 h-3.5" /> Copy bug report
            </Button>
          </div>
        </Card>
      </div>

      {/* Test case presets */}
      <Card className="p-4">
        <h2 className="text-lg font-serif text-gold mb-1">Test cases</h2>
        <p className="text-xs text-ink/60 mb-4">
          Click any preset to load it into the editor. Use these to exercise each tag in
          isolation, then catalog the ones that produce unexpected output.
        </p>
        <div className="space-y-4">
          {TEST_CASES.map((group) => (
            <div key={group.group}>
              <div className="text-xs uppercase tracking-wider text-gold/80 font-semibold mb-1.5">
                {group.group}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {group.cases.map((tc) => (
                  <Button
                    key={tc.name}
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setBbcode(tc.bbcode);
                      if (tc.note) {
                        toast.message(tc.name, { description: tc.note });
                      }
                    }}
                    className="h-7 text-xs"
                    title={tc.note ?? tc.bbcode}
                  >
                    {tc.name}
                  </Button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
