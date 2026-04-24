/**
 * A simple BBCode to HTML converter for the RPG Archive.
 * Supports standard tags and some custom ones inspired by World Anvil.
 */
export function bbcodeToHtml(text: string): string {
  if (!text) return '';

  let html = text;

  // Escape HTML to prevent XSS before processing BBCode
  html = html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  // Basic formatting
  html = html.replace(/\[b\]([\s\S]*?)\[\/b\]/gi, '<strong>$1</strong>');
  html = html.replace(/\[i\]([\s\S]*?)\[\/i\]/gi, '<em>$1</em>');
  html = html.replace(/\[u\]([\s\S]*?)\[\/u\]/gi, '<u>$1</u>');
  html = html.replace(/\[s\]([\s\S]*?)\[\/s\]/gi, '<del>$1</del>');
  
  // Headings
  html = html.replace(/\[h1\]([\s\S]*?)\[\/h1\]/gi, '<h1>$1</h1>');
  html = html.replace(/\[h2\]([\s\S]*?)\[\/h2\]/gi, '<h2>$1</h2>');
  html = html.replace(/\[h3\]([\s\S]*?)\[\/h3\]/gi, '<h3>$1</h3>');
  html = html.replace(/\[h4\]([\s\S]*?)\[\/h4\]/gi, '<h4>$1</h4>');
  
  // Layout & Alignment
  html = html.replace(/\[left\]([\s\S]*?)\[\/left\]/gi, '<p style="text-align: left">$1</p>');
  html = html.replace(/\[center\]([\s\S]*?)\[\/center\]/gi, '<p style="text-align: center">$1</p>');
  html = html.replace(/\[right\]([\s\S]*?)\[\/right\]/gi, '<p style="text-align: right">$1</p>');
  html = html.replace(/\[justify\]([\s\S]*?)\[\/justify\]/gi, '<p style="text-align: justify">$1</p>');
  html = html.replace(/\[indent\]([\s\S]*?)\[\/indent\]/gi, '<div style="padding-left: 2rem">$1</div>');
  
  // Lists (Handle nesting by replacing innermost tags first, multiple times)
  for (let i = 0; i < 6; i++) {
    html = html.replace(/\[li\]((?:(?!\[li\]|\[\/li\])[\s\S])*)\[\/li\]/gi, '<li>$1</li>');
    html = html.replace(/\[ul\]((?:(?!\[ul\]|\[\/ul\])[\s\S])*)\[\/ul\]/gi, '<ul>$1</ul>');
    html = html.replace(/\[ol\]((?:(?!\[ol\]|\[\/ol\])[\s\S])*)\[\/ol\]/gi, '<ol>$1</ol>');
  }
  
  // Special
  html = html.replace(/\[quote\]([\s\S]*?)\[\/quote\]/gi, '<blockquote>$1</blockquote>');
  html = html.replace(/\[indent\]([\s\S]*?)\[\/indent\]/gi, '<div class="indent-block" style="padding-left: 2rem">$1</div>');
  html = html.replace(/\[code\]([\s\S]*?)\[\/code\]/gi, '<code>$1</code>');
  html = html.replace(/\[br\]/gi, '<br/>');
  html = html.replace(/\[hr\]/gi, '<hr/>');
  html = html.replace(/\[small\]([\s\S]*?)\[\/small\]/gi, '<small>$1</small>');
  html = html.replace(/\[sub\]([\s\S]*?)\[\/sub\]/gi, '<sub>$1</sub>');
  html = html.replace(/\[sup\]([\s\S]*?)\[\/sup\]/gi, '<sup>$1</sup>');
  
  // Links
  html = html.replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi, '<a href="$1" target="_blank" rel="noopener noreferrer">$2</a>');
  html = html.replace(/\[url\]([\s\S]*?)\[\/url\]/gi, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
  
  // Tables
  html = html.replace(/\[table\]([\s\S]*?)\[\/table\]/gi, '<div class="overflow-x-auto"><table class="w-full border-collapse border border-gold/20 my-4 table-auto">$1</table></div>');
  html = html.replace(/\[tr\]([\s\S]*?)\[\/tr\]/gi, '<tr class="border-b border-gold/10 hover:bg-gold/5">$1</tr>');
  html = html.replace(/\[th\]([\s\S]*?)\[\/th\]/gi, '<th class="p-2 text-left font-bold text-gold border border-gold/20 bg-gold/5">$1</th>');
  html = html.replace(/\[td\]([\s\S]*?)\[\/td\]/gi, '<td class="p-2 border border-gold/10">$1</td>');

  // Custom World Anvil-like tags
  html = html.replace(/\[spoiler\]([\s\S]*?)\[\/spoiler\]/gi, '<span class="spoiler" title="Click to reveal">$1</span>');
  html = html.replace(/\[comment\]([\s\S]*?)\[\/comment\]/gi, '<!-- $1 -->');

  // Convert newlines to paragraphs for TipTap compatibility
  // We treat double newlines as paragraph breaks, and single newlines as line breaks
  // First, normalize all block tags to ensure they are on their own lines
  let processedHtml = html.replace(/<(h[1-4]|p|div|blockquote|ul|ol|li|hr|table|tr|th|td)([^>]*)>([\s\S]*?)<\/\1>/gi, (match) => `\n\n${match.trim()}\n\n`);
  processedHtml = processedHtml.replace(/<hr([^>]*)\/?>/gi, '\n\n<hr$1/>\n\n');
  
  const blocks = processedHtml.split(/\n\n+/);
  html = blocks.map(block => {
    const trimmed = block.trim();
    if (!trimmed) return '';
    
    // If it's already a block tag, return it as is
    if (trimmed.match(/^<(h[1-4]|div|blockquote|ul|ol|li|p|hr|table|tr|th|td)/i)) {
      // Clean up internal newlines in lists/blocks that might cause extra spacing in TipTap
      return trimmed.replace(/>\s+\n/g, '>').replace(/\n\s+</g, '<');
    }
    
    // Otherwise, wrap in a paragraph and convert single newlines to <br/>
    return `<p>${trimmed.replace(/\n/g, '<br/>')}</p>`;
  }).join('');

  return html;
}

/**
 * Converts HTML back to BBCode.
 * Used for the WYSIWYG editor to save back to the database.
 */
export function htmlToBbcode(html: string): string {
  if (!html) return '';

  let bbcode = html;

  // Basic formatting
  bbcode = bbcode.replace(/<strong>([\s\S]*?)<\/strong>/gi, '[b]$1[/b]');
  bbcode = bbcode.replace(/<b>([\s\S]*?)<\/b>/gi, '[b]$1[/b]');
  bbcode = bbcode.replace(/<em>([\s\S]*?)<\/em>/gi, '[i]$1[/i]');
  bbcode = bbcode.replace(/i>([\s\S]*?)<\/i>/gi, '[i]$1[/i]');
  bbcode = bbcode.replace(/<u>([\s\S]*?)<\/u>/gi, '[u]$1[/u]');
  bbcode = bbcode.replace(/<del>([\s\S]*?)<\/del>/gi, '[s]$1[/s]');
  bbcode = bbcode.replace(/<s>([\s\S]*?)<\/s>/gi, '[s]$1[/s]');
  
  // Headings (Ensure they have double newlines around them for source readability)
  bbcode = bbcode.replace(/<h1>([\s\S]*?)<\/h1>/gi, '\n[h1]$1[/h1]\n\n');
  bbcode = bbcode.replace(/<h2>([\s\S]*?)<\/h2>/gi, '\n[h2]$1[/h2]\n\n');
  bbcode = bbcode.replace(/<h3>([\s\S]*?)<\/h3>/gi, '\n[h3]$1[/h3]\n\n');
  bbcode = bbcode.replace(/<h4>([\s\S]*?)<\/h4>/gi, '\n[h4]$1[/h4]\n\n');
  
  // Alignment (Handle both div and p/h tags with style, being flexible with quotes and semicolons)
  bbcode = bbcode.replace(/<(?:div|p|h[1-4])[^>]*style="[^"]*text-align:\s*left;?[^"]*"[^>]*>([\s\S]*?)<\/(?:div|p|h[1-4])>/gi, '[left]$1[/left]');
  bbcode = bbcode.replace(/<(?:div|p|h[1-4])[^>]*style="[^"]*text-align:\s*center;?[^"]*"[^>]*>([\s\S]*?)<\/(?:div|p|h[1-4])>/gi, '[center]$1[/center]');
  bbcode = bbcode.replace(/<(?:div|p|h[1-4])[^>]*style="[^"]*text-align:\s*right;?[^"]*"[^>]*>([\s\S]*?)<\/(?:div|p|h[1-4])>/gi, '[right]$1[/right]');
  bbcode = bbcode.replace(/<(?:div|p|h[1-4])[^>]*style="[^"]*text-align:\s*justify;?[^"]*"[^>]*>([\s\S]*?)<\/(?:div|p|h[1-4])>/gi, '[justify]$1[/justify]');
  bbcode = bbcode.replace(/<div[^>]*style="[^"]*padding-left:\s*2rem;?[^"]*"[^>]*>([\s\S]*?)<\/div>/gi, '[indent]$1[/indent]');
  
  // Lists (Handle nesting by replacing innermost tags first, multiple times)
  for (let i = 0; i < 6; i++) {
    bbcode = bbcode.replace(/<li>((?:(?!<li>|<\/li>)[\s\S])*)<\/li>/gi, '[li]$1[/li]');
    bbcode = bbcode.replace(/<ul>((?:(?!<ul>|<\/ul>)[\s\S])*)<\/ul>/gi, '[ul]$1[/ul]');
    bbcode = bbcode.replace(/<ol>((?:(?!<ol>|<\/ol>)[\s\S])*)<\/ol>/gi, '[ol]$1[/ol]');
  }
  
  // Special
  bbcode = bbcode.replace(/<blockquote>([\s\S]*?)<\/blockquote>/gi, '[quote]$1[/quote]');
  bbcode = bbcode.replace(/<div[^>]*class="indent-block"[^>]*>([\s\S]*?)<\/div>/gi, '[indent]$1[/indent]');
  bbcode = bbcode.replace(/<div[^>]*style="[^"]*padding-left:\s*2rem;?[^"]*"[^>]*>([\s\S]*?)<\/div>/gi, '[indent]$1[/indent]');
  bbcode = bbcode.replace(/<code>([\s\S]*?)<\/code>/gi, '[code]$1[/code]');
  bbcode = bbcode.replace(/<br\s*\/?>/gi, '\n');
  bbcode = bbcode.replace(/<hr\s*\/?>/gi, '[hr]');
  bbcode = bbcode.replace(/<small>([\s\S]*?)<\/small>/gi, '[small]$1[/small]');
  bbcode = bbcode.replace(/<sub>([\s\S]*?)<\/sub>/gi, '[sub]$1[/sub]');
  bbcode = bbcode.replace(/<sup>([\s\S]*?)<\/sup>/gi, '[sup]$1[/sup]');
  
  // Links
  bbcode = bbcode.replace(/<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (match, url, text) => {
    if (url === text) return `[url]${url}[/url]`;
    return `[url=${url}]${text}[/url]`;
  });
  
  // Spoilers
  bbcode = bbcode.replace(/<span class="spoiler"[^>]*>([\s\S]*?)<\/span>/gi, '[spoiler]$1[/spoiler]');

  // Tables
  bbcode = bbcode.replace(/<div class="overflow-x-auto">\s*<table[^>]*>([\s\S]*?)<\/table>\s*<\/div>/gi, '[table]$1[/table]');
  bbcode = bbcode.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, '[table]$1[/table]');
  bbcode = bbcode.replace(/<\/?tbody[^>]*>/gi, '');
  bbcode = bbcode.replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, '[tr]$1[/tr]');
  bbcode = bbcode.replace(/<th[^>]*>([\s\S]*?)<\/th>/gi, '[th]$1[/th]');
  bbcode = bbcode.replace(/<td[^>]*>([\s\S]*?)<\/td>/gi, '[td]$1[/td]');

  // Clean up p tags and other common HTML wrappers from TipTap
  // Convert paragraphs to double newlines for Source mode readability
  bbcode = bbcode.replace(/<p>([\s\S]*?)<\/p>/gi, '$1\n\n');
  
  // Final cleanup of multiple newlines
  bbcode = bbcode.replace(/\n\n\n+/g, '\n\n');
  bbcode = bbcode.replace(/^\n+/, '');

  // Decode basic HTML entities
  bbcode = bbcode
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");

  return bbcode.trim();
}
