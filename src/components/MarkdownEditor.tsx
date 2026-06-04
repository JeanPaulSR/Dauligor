import React, { useState, useRef, useEffect, useMemo } from 'react';
import MarkdownToolbar from './MarkdownToolbar';
import ReferenceAutocomplete from './ReferenceAutocomplete';
import { bbcodeToHtml, htmlToBbcode } from '../lib/bbcode';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import Placeholder from '@tiptap/extension-placeholder';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import { Node, Mark, mergeAttributes } from '@tiptap/core';

const SpoilerExtension = Mark.create({
  name: 'spoiler',
  parseHTML() {
    return [{ tag: 'span.spoiler' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'spoiler', title: 'Click to reveal' }), 0];
  },
});

const IndentExtension = Node.create({
  name: 'indentBlock',
  group: 'block',
  content: 'block+',
  parseHTML() {
    return [
      { tag: 'div.indent-block' },
      { tag: 'div[style*="padding-left: 2rem"]' },
    ]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { class: 'indent-block', style: 'padding-left: 2rem' }), 0]
  },
});

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  minHeight?: string;
  maxHeight?: string;
  autoSizeToContent?: boolean;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  textareaRef?: React.RefObject<HTMLTextAreaElement>;
  stickyOffset?: string;
  label?: string;
  /**
   * Hide the formatting toolbar entirely. Useful for short-form
   * fields (proficiency description, etc.) where the toolbar would
   * be visual noise and the user is unlikely to need bold/italic/
   * tables/etc. The editor still renders BBCode correctly — only
   * the toolbar chrome is suppressed.
   *
   * When the toolbar is hidden the Visual/Source toggle is also
   * unreachable, so the user is stuck in whichever mode the editor
   * defaulted to (Visual, currently). That's deliberate: the
   * intent is "plain prose, with BBCode if the author hand-types
   * it." If a caller needs Source mode without the toolbar, expose
   * a separate prop.
   */
  hideToolbar?: boolean;
  /**
   * When true, the editor stretches to fill its flex parent instead
   * of using a fixed pixel height. minHeight / maxHeight / the
   * resize handle are all ignored; the editor relies entirely on
   * the parent's flex layout for sizing. Use this when the editor
   * lives inside a flex column with `flex-1 min-h-0` siblings —
   * e.g. SpellsEditor's Basics-tab description box, which should
   * fill the remaining space below the identity-fields grid.
   *
   * Internally this short-circuits the ResizeObserver + initial-
   * sizing useEffects (which would otherwise re-lock the editor to
   * a pixel height the first time they fire) and drops the inline
   * `style` that sets explicit height.
   */
  fillContainer?: boolean;
}

function MarkdownEditor({
  value,
  onChange,
  placeholder,
  className = "",
  minHeight = "350px",
  maxHeight = "70vh",
  autoSizeToContent = true,
  onKeyDown,
  textareaRef: externalRef,
  stickyOffset,
  label,
  hideToolbar = false,
  fillContainer = false,
}: MarkdownEditorProps) {
  const [showPreview, setShowPreview] = useState(false);
  const [isWYSIWYG, setIsWYSIWYG] = useState(true);
  const [currentHeight, setCurrentHeight] = useState<string | number>(minHeight);
  const [hasManuallyResized, setHasManuallyResized] = useState(false);
  // Bumped on every TipTap selection change to force a real re-render so the
  // toolbar re-evaluates isActive(...) — table-tools visibility + button active
  // states — on cursor CLICK / arrow movement, not only on typing.
  const [, setSelectionTick] = useState(0);
  const resizableRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const internalRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef = externalRef || internalRef;
  const internalUpdateRef = useRef(false);
  const editorRef = useRef<any>(null);

  const lastHeightRef = useRef<number>(0);

  // Track height changes to persist across mode switches
  useEffect(() => {
    if (!resizableRef.current) return;
    // In fill-container mode the parent's flex layout drives the
    // editor's height. Skipping the observer prevents it from
    // measuring the rendered height and locking us into a pixel
    // value that no longer follows the parent's growth.
    if (fillContainer) return;

    const observer = new ResizeObserver((entries) => {
      if (!entries || !entries.length) return;
      
      const entry = entries[0];
      const newHeight = entry.contentRect.height;
      
      // Use requestAnimationFrame to defer the state update to the next frame
      // and prevent "ResizeObserver loop completed with undelivered notifications"
      window.requestAnimationFrame(() => {
        if (newHeight > 0 && Math.abs(lastHeightRef.current - newHeight) > 3) {
          lastHeightRef.current = newHeight;
          setCurrentHeight(newHeight);
        }
      });
    });

    observer.observe(resizableRef.current);
    return () => observer.disconnect();
  }, [fillContainer]);

  // Initial sizing based on content
  useEffect(() => {
    // Fill-container mode opts out of the height calculation
    // entirely — the parent flex layout determines size.
    if (fillContainer) return;
    if (!autoSizeToContent) {
      if (!hasManuallyResized) {
        setCurrentHeight(minHeight);
        lastHeightRef.current = typeof minHeight === 'string' ? parseInt(minHeight) || 0 : Number(minHeight) || 0;
      }
      return;
    }
    if (hasManuallyResized) return;

    const measureAndSetHeight = () => {
      const viewportHeight = window.innerHeight;
      let maxLimit = viewportHeight * 0.6;
      
      if (maxHeight.endsWith('vh')) {
        maxLimit = viewportHeight * (parseInt(maxHeight) / 100);
      } else if (maxHeight.endsWith('px')) {
        maxLimit = parseInt(maxHeight);
      }
      
      let contentHeight = 0;
      if (isWYSIWYG && contentRef.current) {
        // Measure the actual TipTap content
        const tiptapContent = contentRef.current.querySelector('.tiptap');
        if (tiptapContent) {
          contentHeight = tiptapContent.scrollHeight + 100; // Buffer for toolbar and padding
        }
      } else if (!isWYSIWYG && textareaRef.current) {
        contentHeight = textareaRef.current.scrollHeight + 50;
      }

      if (contentHeight > 0) {
        const finalHeight = Math.min(Math.max(contentHeight, parseInt(minHeight as string)), maxLimit);
        setCurrentHeight(finalHeight);
      }
    };

    // Small delay to ensure content is rendered
    const timer = setTimeout(measureAndSetHeight, 100);
    return () => clearTimeout(timer);
  }, [value, isWYSIWYG, minHeight, maxHeight, hasManuallyResized, autoSizeToContent, fillContainer]);

  // Detect manual resize start
  const handleMouseDown = () => {
    setHasManuallyResized(true);
  };

  // TipTap Editor Setup
  const editor = useEditor({
    extensions: [
      StarterKit,
      IndentExtension,
      SpoilerExtension,
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' },
      }),
      Subscript,
      Superscript,
      Table.configure({
        resizable: true,
        HTMLAttributes: { class: 'editor-table' },
      }),
      TableRow.configure({
        HTMLAttributes: { class: 'editor-table-row' },
      }),
      TableHeader.configure({
        HTMLAttributes: { class: 'editor-table-th' },
      }),
      TableCell.configure({
        HTMLAttributes: { class: 'editor-table-td' },
      }),
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      Placeholder.configure({
        placeholder: placeholder || 'Start writing...',
      }),
    ],
    content: bbcodeToHtml(value, { editor: true }),
    onUpdate: ({ editor }) => {
      if (isWYSIWYG) {
        const html = editor.getHTML();
        const bbcode = htmlToBbcode(html);
        if (bbcode !== value) {
          internalUpdateRef.current = true;
          setTimeout(() => {
            onChange(bbcode);
          }, 0);
        }
      }
    },
    onSelectionUpdate: () => {
      // Force a REAL re-render so the toolbar re-evaluates isActive(...) on every
      // selection change. The previous `setHasManuallyResized(prev => prev)` was
      // a no-op (React bails on same-value setState), so the toolbar — table
      // tools visibility AND button active highlights — only refreshed on typing,
      // never on a plain click or arrow-key move into/out of a table.
      if (isWYSIWYG) {
        setSelectionTick((t) => t + 1);
      }
    },
    editorProps: {
      attributes: {
        class: 'tiptap custom-scrollbar flex-grow outline-none p-4 overflow-y-auto',
      },
      handlePaste: (view, event) => {
        const plainText = event.clipboardData?.getData('text/plain') || '';
        // Option C: Auto-parse pasted BBCode
        if (plainText && plainText.match(/\[(b|i|u|s|h[1-4]|left|center|right|justify|indent|li|ul|ol|quote|code|table|tr|th|td|url|spoiler)(?:=.*?)?\]/i)) {
          event.preventDefault();
          const convertedHtml = bbcodeToHtml(plainText, { editor: true });
          setTimeout(() => {
            editorRef.current?.commands.insertContent(convertedHtml);
          }, 0);
          return true;
        }
        
        // Option B: Sanitized HTML paste is naturally handled by TipTap's schema 
        // dropping unsupported tags since we now have exactly the extensions we need.
        return false;
      },
      handleKeyDown: (view, event) => {
        if (event.key === 'Tab') {
          if (editor?.isActive('bulletList') || editor?.isActive('orderedList')) {
            // Let TipTap handle list indentation
            return false;
          }
          
          // If not in a list, handle indentation with [indent]
          event.preventDefault();
          if (event.shiftKey) {
            // Outdent: lift the block
            editor?.chain().focus().lift('indentBlock').run();
          } else {
            // Indent: wrap in our custom indent structure
            editor?.chain().focus().wrapIn('indentBlock').run();
          }
          return true;
        }
        return false;
      },
    },
  });

  editorRef.current = editor;

  // Sync TipTap content when BBCode changes externally or when switching modes
  useEffect(() => {
    if (!editor) return;

    if (internalUpdateRef.current) {
      internalUpdateRef.current = false;
      return;
    }

    // While the editor is focused the USER is typing, and the editor is the
    // source of truth — never setContent here. setContent rebuilds the doc and
    // resets the caret to the end. Fast typing (or holding a key, which
    // auto-repeats) queues several deferred onChange echoes; the single
    // `internalUpdateRef` boolean only masks the first, so a later stale echo
    // would otherwise reach setContent mid-type and jump the caret to the end.
    // External value changes (loading a different entry, Visual/Source toggle)
    // happen while the editor is NOT focused, so they still sync through below.
    if (editor.isFocused) return;

    const currentHtml = editor.getHTML();
    const newHtml = bbcodeToHtml(value, { editor: true });
    if (currentHtml !== newHtml) {
      editor.commands.setContent(newHtml, { emitUpdate: false });
    }
  }, [value, editor, isWYSIWYG]);

  // Pre-process text for the preview pane
  const processedValue = useMemo(() => {
    const text = value || '';
    const processed = text
      .replace(/(\*\*|__)([\s\S]*?)(\s+)(\*\*|__)/g, '$1$2$4$3')
      .replace(/(\*|_)([\s\S]*?)(\s+)(\*|_)/g, '$1$2$4$3');
    return bbcodeToHtml(processed);
  }, [value]);

  // Handle Tab key for indentation in Source mode
  const handleTab = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const val = textarea.value;

      if (e.shiftKey) {
        // Outdent: Remove up to 4 spaces from the start of the line
        // Find the start of the current line
        const lineStart = val.lastIndexOf('\n', start - 1) + 1;
        const lineText = val.substring(lineStart, end);
        
        if (lineText.startsWith('    ')) {
          const newValue = val.substring(0, lineStart) + val.substring(lineStart + 4);
          onChange(newValue);
          setTimeout(() => {
            textarea.setSelectionRange(Math.max(lineStart, start - 4), Math.max(lineStart, end - 4));
          }, 0);
        } else if (lineText.startsWith('\t')) {
          const newValue = val.substring(0, lineStart) + val.substring(lineStart + 1);
          onChange(newValue);
          setTimeout(() => {
            textarea.setSelectionRange(Math.max(lineStart, start - 1), Math.max(lineStart, end - 1));
          }, 0);
        }
      } else {
        // Indent: Insert 4 spaces
        const newValue = val.substring(0, start) + "    " + val.substring(end);
        onChange(newValue);

        setTimeout(() => {
          textarea.setSelectionRange(start + 4, start + 4);
        }, 0);
      }
    }
    if (onKeyDown) onKeyDown(e);
  };

  return (
    <div className={`relative border border-gold/10 rounded-md focus-within:border-gold transition-colors bg-card/50 flex flex-col overflow-hidden ${className}`}>
      {!hideToolbar && (
        <MarkdownToolbar
          textareaRef={textareaRef}
          onUpdate={onChange}
          isWYSIWYG={isWYSIWYG}
          onToggleWYSIWYG={() => setIsWYSIWYG(!isWYSIWYG)}
          editor={editor}
          stickyOffset={stickyOffset}
          label={label}
        />
      )}
      
      <div
        ref={resizableRef}
        className={
          fillContainer
            // Fill-container mode: just grow with the flex parent.
            // No resize handle (the user can't drag-resize an
            // auto-stretched pane in a meaningful way) and no
            // explicit height — flex-grow + min-h-0 handle sizing.
            ? "flex-grow overflow-hidden flex flex-col min-h-0"
            : "flex-grow resize-y overflow-hidden flex flex-col min-h-0"
        }
        style={fillContainer ? undefined : { height: currentHeight, minHeight, maxHeight }}
        onMouseDown={fillContainer ? undefined : handleMouseDown}
      >
        {isWYSIWYG ? (
          <>
          <div
            ref={contentRef}
            className="prose prose-sm max-w-none cursor-text flex-grow flex flex-col min-h-0"
          >
            <EditorContent
              editor={editor}
              className="flex-grow flex flex-col overflow-hidden min-h-0"
            />
          </div>
          {editor && <ReferenceAutocomplete editor={editor} enabled={isWYSIWYG} />}
          </>
        ) : (
          <textarea 
            ref={textareaRef}
            value={value} 
            onChange={e => onChange(e.target.value)}
            onKeyDown={handleTab}
            placeholder={placeholder}
            className="w-full flex-grow p-6 outline-none text-base font-serif leading-relaxed resize-none bg-transparent overflow-auto custom-scrollbar"
          />
        )}
      </div>
    </div>
  );
}

// Memoized: a ClassEditor (or any editor) holding several MarkdownEditors
// re-renders the whole form on every keystroke in ANY field. Each TipTap
// editor rebuilds ~13 extensions + re-parses bbcode on render, so an
// unmemoized re-render of 3 idle editors per keystroke was the dominant
// cost of the editor "typing lag". Props at the call sites are stable
// (value, a stable state setter onChange, string literals), so memo lets
// idle editors skip re-render entirely — only the one whose `value`
// actually changed re-renders.
export default React.memo(MarkdownEditor);
