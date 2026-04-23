import React from 'react';
import { bbcodeToHtml } from '../lib/bbcode';

interface BBCodeRendererProps {
  content: string;
  className?: string;
}

/**
 * A component that safely renders BBCode content as HTML.
 * It uses the bbcodeToHtml utility and wraps the output in a prose container.
 */
export default function BBCodeRenderer({ content, className = "" }: BBCodeRendererProps) {
  if (!content) return null;

  const html = bbcodeToHtml(content);

  return (
    <div 
      className={`prose max-w-none ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
