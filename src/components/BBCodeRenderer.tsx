import React from 'react';
import { bbcodeToHtml, type BbcodeViewContext } from '../lib/bbcode';

interface BBCodeRendererProps {
  content: string;
  className?: string;
  viewContext?: BbcodeViewContext;
}

/**
 * A component that safely renders BBCode content as HTML.
 * Accepts an optional viewContext to filter era/campaign conditional blocks.
 */
export default function BBCodeRenderer({ content, className = "", viewContext }: BBCodeRendererProps) {
  if (!content) return null;

  const html = bbcodeToHtml(content, viewContext);

  return (
    <div 
      className={`prose max-w-none ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
