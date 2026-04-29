import React, { useState, useRef, useEffect, useMemo } from 'react';
import MarkdownToolbar from './MarkdownToolbar';
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
import { Node, mergeAttributes } from '@tiptap/core';

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
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  textareaRef?: React.RefObject<HTMLTextAreaElement>;
  stickyOffset?: string;
  label?: string;
}

export default function MarkdownEditor({ 
  value, 
  onChange, 
  placeholder, 
  className = "", 
  minHeight = "350px",
  maxHeight = "70vh",
  onKeyDown,
  textareaRef: externalRef,
  stickyOffset,
  label
}: MarkdownEditorProps) {
  const [showPreview, setShowPreview] = useState(false);
  const [isWYSIWYG, setIsWYSIWYG] = useState(true);
  const [currentHeight, setCurrentHeight] = useState<string | number>(minHeight);
  const [hasManuallyResized, setHasManuallyResized] = useState(false);
  const resizableRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const internalRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef = externalRef || internalRef;

  const lastHeightRef = useRef<number>(0);

  // Track height changes to persist across mode switches
  useEffect(() => {
    if (!resizableRef.current) return;
    
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
  }, []);

  // Initial sizing based on content
  useEffect(() => {
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
  }, [value, isWYSIWYG, minHeight, maxHeight, hasManuallyResized]);

  // Detect manual resize start
  const handleMouseDown = () => {
    setHasManuallyResized(true);
  };

  // TipTap Editor Setup
  const editor = useEditor({
    extensions: [
      StarterKit,
      IndentExtension,
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
    content: bbcodeToHtml(value),
    onUpdate: ({ editor }) => {
      if (isWYSIWYG) {
        const html = editor.getHTML();
        const bbcode = htmlToBbcode(html);
        if (bbcode !== value) {
          setTimeout(() => {
            onChange(bbcode);
          }, 0);
        }
      }
    },
    onSelectionUpdate: ({ editor }) => {
      // Force a slight state change to ensure toolbar re-evaluates isActive
      if (isWYSIWYG) {
        setHasManuallyResized(prev => prev); // dummy update
      }
    },
    editorProps: {
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

  // Sync TipTap content when BBCode changes externally or when switching modes
  useEffect(() => {
    if (!editor) return;
    const currentHtml = editor.getHTML();
    const newHtml = bbcodeToHtml(value);
    if (currentHtml !== newHtml) {
      editor.commands.setContent(newHtml, { emitUpdate: false });
    }
  }, [value, editor, isWYSIWYG]);

  // Pre-process text for the preview pane
  const processedValue = useMemo(() => {
    let text = value;
    text = text.replace(/(\*\*|__)([\s\S]*?)(\s+)(\*\*|__)/g, '$1$2$4$3');
    text = text.replace(/(\*|_)([\s\S]*?)(\s+)(\*|_)/g, '$1$2$4$3');
    return bbcodeToHtml(text);
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
      <MarkdownToolbar 
        textareaRef={textareaRef} 
        onUpdate={onChange} 
        isWYSIWYG={isWYSIWYG}
        onToggleWYSIWYG={() => setIsWYSIWYG(!isWYSIWYG)}
        editor={editor}
        stickyOffset={stickyOffset}
        label={label}
      />
      
      <div 
        ref={resizableRef}
        className="flex-grow resize-y overflow-hidden flex flex-col" 
        style={{ height: currentHeight, minHeight, maxHeight }}
        onMouseDown={handleMouseDown}
      >
        {isWYSIWYG ? (
          <div 
            ref={contentRef}
            className="prose prose-sm max-w-none flex-grow overflow-auto custom-scrollbar cursor-text flex flex-col" 
          >
            <EditorContent 
              editor={editor}
              className="flex-grow flex flex-col overflow-hidden [&>.tiptap]:flex-grow [&>.tiptap]:outline-none [&>.tiptap]:p-4" 
            />
          </div>
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
