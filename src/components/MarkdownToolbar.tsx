import React, { useEffect } from 'react';
import { 
  Bold, Italic, Underline, Strikethrough, AlignCenter, AlignLeft, AlignRight, AlignJustify,
  List, ListOrdered, Heading1, Heading2, Heading3, Heading4, 
  Quote, Code, Link, Eye, EyeOff, Type, Minus, Hash, 
  EyeOff as Spoiler, MessageSquare as Comment, Subscript, Superscript,
  Undo, Redo, FileCode, Indent, Outdent, Table as TableIcon
} from 'lucide-react';
import { Button } from './ui/button';
import { Editor } from '@tiptap/react';

interface MarkdownToolbarProps {
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  onUpdate: (value: string) => void;
  isPreview?: boolean;
  onTogglePreview?: () => void;
  isWYSIWYG?: boolean;
  onToggleWYSIWYG?: () => void;
  editor?: Editor | null;
  stickyOffset?: string;
  label?: string;
}

export default function MarkdownToolbar({ 
  textareaRef, 
  onUpdate, 
  isPreview, 
  onTogglePreview,
  isWYSIWYG,
  onToggleWYSIWYG,
  editor,
  stickyOffset = "top-16",
  label
}: MarkdownToolbarProps) {
  
  const insertText = (before: string, after: string = '') => {
    if (isWYSIWYG && editor) {
      // Handle TipTap commands
      switch (before) {
        case '[b]': editor.chain().focus().toggleBold().run(); break;
        case '[i]': editor.chain().focus().toggleItalic().run(); break;
        case '[u]': editor.chain().focus().toggleUnderline().run(); break;
        case '[s]': editor.chain().focus().toggleStrike().run(); break;
        case '[h1]': editor.chain().focus().toggleHeading({ level: 1 }).run(); break;
        case '[h2]': editor.chain().focus().toggleHeading({ level: 2 }).run(); break;
        case '[h3]': editor.chain().focus().toggleHeading({ level: 3 }).run(); break;
        case '[h4]': editor.chain().focus().toggleHeading({ level: 4 }).run(); break;
        case '[left]': editor.chain().focus().setTextAlign('left').run(); break;
        case '[center]': editor.chain().focus().setTextAlign('center').run(); break;
        case '[right]': editor.chain().focus().setTextAlign('right').run(); break;
        case '[justify]': editor.chain().focus().setTextAlign('justify').run(); break;
        case '[ul]\n[li]': editor.chain().focus().toggleBulletList().run(); break;
        case '[ol]\n[li]': editor.chain().focus().toggleOrderedList().run(); break;
        case '[quote]': editor.chain().focus().toggleBlockquote().run(); break;
        case '[code]': editor.chain().focus().toggleCode().run(); break;
        case '[sub]': editor.chain().focus().toggleSubscript().run(); break;
        case '[sup]': editor.chain().focus().toggleSuperscript().run(); break;
        case '[url=url]': {
          const url = window.prompt('Enter URL:', 'https://');
          if (url) editor.chain().focus().setLink({ href: url }).run();
          break;
        }
        case '[hr]': editor.chain().focus().setHorizontalRule().run(); break;
        case '[br]': editor.chain().focus().setHardBreak().run(); break;
        case '[table]': editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); break;
        case 'indent': {
          if (editor?.isActive('bulletList') || editor?.isActive('orderedList')) {
            editor.chain().focus().sinkListItem('listItem').run();
          } else {
            editor.chain().focus().wrapIn('indentBlock').run(); 
          }
          break;
        }
        case 'outdent': {
          if (editor?.isActive('bulletList') || editor?.isActive('orderedList')) {
            editor.chain().focus().liftListItem('listItem').run();
          } else {
            editor.chain().focus().lift('indentBlock').run();
          }
          break;
        }
      }
      return;
    }

    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const selectedText = text.substring(start, end);
    
    // Smart Toggling Logic for Source Mode
    const isAlreadyTagged = text.substring(start - before.length, start) === before && 
                           text.substring(end, end + after.length) === after;

    if (isAlreadyTagged) {
      // Remove tags
      const newValue = text.substring(0, start - before.length) + selectedText + text.substring(end + after.length);
      onUpdate(newValue);
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(start - before.length, end - before.length);
      }, 0);
    } else {
      // Add tags
      // Check if selection already contains tags partially (e.g. bolding a mixed selection)
      const newValue = text.substring(0, start) + before + selectedText + after + text.substring(end);
      onUpdate(newValue);
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(start + before.length, end + before.length);
      }, 0);
    }
  };

  useEffect(() => {
    if (isWYSIWYG) return; // TipTap handles its own hotkeys

    const textarea = textareaRef.current;
    if (!textarea) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        const key = e.key.toLowerCase();
        if (['b', 'i', 'u', 'k', 'z', 'y'].includes(key)) {
          if (key === 'z' || key === 'y') return; // Let native undo handle it if possible
          
          e.preventDefault();
          switch (key) {
            case 'b': insertText('[b]', '[/b]'); break;
            case 'i': insertText('[i]', '[/i]'); break;
            case 'u': insertText('[u]', '[/u]'); break;
            case 'k': insertText('[url=url]', '[/url]'); break;
          }
        }
      }
    };

    textarea.addEventListener('keydown', handleKeyDown);
    return () => textarea.removeEventListener('keydown', handleKeyDown);
  }, [textareaRef, onUpdate, isWYSIWYG]);

  const tools = [
    { icon: Bold, label: 'Bold (Ctrl+B)', action: () => insertText('[b]', '[/b]'), active: editor?.isActive('bold') },
    { icon: Italic, label: 'Italic (Ctrl+I)', action: () => insertText('[i]', '[/i]'), active: editor?.isActive('italic') },
    { icon: Underline, label: 'Underline (Ctrl+U)', action: () => insertText('[u]', '[/u]'), active: editor?.isActive('underline') },
    { icon: Strikethrough, label: 'Strikethrough', action: () => insertText('[s]', '[/s]'), active: editor?.isActive('strike') },
    { icon: Heading1, label: 'H1', action: () => insertText('[h1]', '[/h1]'), active: editor?.isActive('heading', { level: 1 }) },
    { icon: Heading2, label: 'H2', action: () => insertText('[h2]', '[/h2]'), active: editor?.isActive('heading', { level: 2 }) },
    { icon: Heading3, label: 'H3', action: () => insertText('[h3]', '[/h3]'), active: editor?.isActive('heading', { level: 3 }) },
    { icon: Heading4, label: 'H4', action: () => insertText('[h4]', '[/h4]'), active: editor?.isActive('heading', { level: 4 }) },
    { icon: AlignLeft, label: 'Align Left', action: () => insertText('[left]', '[/left]'), active: editor?.isActive({ textAlign: 'left' }) },
    { icon: AlignCenter, label: 'Align Center', action: () => insertText('[center]', '[/center]'), active: editor?.isActive({ textAlign: 'center' }) },
    { icon: AlignRight, label: 'Align Right', action: () => insertText('[right]', '[/right]'), active: editor?.isActive({ textAlign: 'right' }) },
    { icon: AlignJustify, label: 'Align Justify', action: () => insertText('[justify]', '[/justify]'), active: editor?.isActive({ textAlign: 'justify' }) },
    { icon: List, label: 'Unordered List', action: () => insertText('[ul]\n[li]', '[/li]\n[/ul]'), active: editor?.isActive('bulletList') },
    { icon: ListOrdered, label: 'Ordered List', action: () => insertText('[ol]\n[li]', '[/li]\n[/ol]'), active: editor?.isActive('orderedList') },
    { icon: Indent, label: 'Indent (Tab)', action: () => insertText('[indent]', '[/indent]'), active: false },
    { icon: Outdent, label: 'Outdent (Shift+Tab)', action: () => insertText('', ''), active: false },
    { icon: TableIcon, label: 'Table', action: () => isWYSIWYG ? insertText('[table]', '') : insertText('\n[table]\n  [tr]\n    [th]Header 1[/th]\n    [th]Header 2[/th]\n  [/tr]\n  [tr]\n    [td]Cell 1[/td]\n    [td]Cell 2[/td]\n  [/tr]\n[/table]\n', ''), active: editor?.isActive('table') },
    { icon: Quote, label: 'Quote', action: () => insertText('[quote]', '[/quote]'), active: editor?.isActive('blockquote') },
    { icon: Code, label: 'Code', action: () => insertText('[code]', '[/code]'), active: editor?.isActive('code') },
    { icon: Link, label: 'Link (Ctrl+K)', action: () => insertText('[url=url]', '[/url]'), active: editor?.isActive('link') },
    { icon: Type, label: 'Small', action: () => insertText('[small]', '[/small]') },
    { icon: Subscript, label: 'Subscript', action: () => insertText('[sub]', '[/sub]'), active: editor?.isActive('subscript') },
    { icon: Superscript, label: 'Superscript', action: () => insertText('[sup]', '[/sup]'), active: editor?.isActive('superscript') },
    { icon: Spoiler, label: 'Spoiler', action: () => insertText('[spoiler]', '[/spoiler]') },
    { icon: Comment, label: 'Comment (Hidden)', action: () => insertText('[comment]', '[/comment]') },
    { icon: Minus, label: 'Horizontal Rule', action: () => insertText('[hr]', '') },
    { icon: Hash, label: 'Line Break', action: () => insertText('[br]', '') },
  ];

  return (
    <div className={`sticky ${stickyOffset} z-20 border-b border-gold/10 bg-card/95 backdrop-blur-sm rounded-t-md shadow-sm flex flex-col`}>
      <div className={`flex flex-wrap items-center justify-between gap-1 p-1`}>
        <div className="flex flex-wrap items-center gap-0.5">
          {label && (
            <div className="px-2 py-1 mr-1 border-r border-gold/10 flex items-center">
              <span className="label-text whitespace-nowrap">{label}</span>
            </div>
          )}
          <div className="flex items-center gap-0.5 mr-2 pr-2 border-r border-gold/10">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-gold/60 hover:text-gold"
              onClick={() => isWYSIWYG ? editor?.chain().focus().undo().run() : document.execCommand('undo')}
              title="Undo (Ctrl+Z)"
            >
              <Undo className="w-3.5 h-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-gold/60 hover:text-gold"
              onClick={() => isWYSIWYG ? editor?.chain().focus().redo().run() : document.execCommand('redo')}
              title="Redo (Ctrl+Y)"
            >
              <Redo className="w-3.5 h-3.5" />
            </Button>
          </div>

          {tools.map((tool, i) => (
            <Button
              key={i}
              type="button"
              variant="ghost"
              size="sm"
              className={`h-7 w-7 p-0 transition-colors ${tool.active ? 'text-gold bg-gold/20' : 'text-gold/60 hover:text-gold hover:bg-gold/10'}`}
              onClick={tool.action}
              title={tool.label}
            >
              <tool.icon className="w-3.5 h-3.5" />
            </Button>
          ))}
        </div>
        
        <div className="flex items-center gap-1">
          {onToggleWYSIWYG && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={`h-7 px-2 label-text gap-1.5 transition-colors ${isWYSIWYG ? 'text-gold bg-gold/10' : 'text-gold/60 hover:text-gold'}`}
              onClick={onToggleWYSIWYG}
              title={isWYSIWYG ? "Switch to BBCode Source" : "Switch to Visual Editor"}
            >
              <FileCode className="w-3 h-3" /> {isWYSIWYG ? "Visual" : "Source"}
            </Button>
          )}
        </div>
      </div>

      {/* Table tools sub-toolbar */}
      {isWYSIWYG && editor?.isActive('table') && (
        <div className="flex flex-wrap items-center gap-1 p-1 px-2 border-t border-gold/10 bg-gold/5 text-xs">
          <span className="label-text text-gold/60 mr-2">Table</span>
          <Button type="button" variant="ghost" size="sm" className="h-6 px-2 py-0 text-gold/60 hover:text-gold hover:bg-gold/10" onClick={() => editor.chain().focus().addColumnBefore().run()}>+ Col Before</Button>
          <Button type="button" variant="ghost" size="sm" className="h-6 px-2 py-0 text-gold/60 hover:text-gold hover:bg-gold/10" onClick={() => editor.chain().focus().addColumnAfter().run()}>+ Col After</Button>
          <Button type="button" variant="ghost" size="sm" className="h-6 px-2 py-0 text-gold/60 hover:text-gold hover:bg-gold/10" onClick={() => editor.chain().focus().deleteColumn().run()}>- Delete Col</Button>
          <div className="w-px h-4 bg-gold/20 mx-1"></div>
          <Button type="button" variant="ghost" size="sm" className="h-6 px-2 py-0 text-gold/60 hover:text-gold hover:bg-gold/10" onClick={() => editor.chain().focus().addRowBefore().run()}>+ Row Before</Button>
          <Button type="button" variant="ghost" size="sm" className="h-6 px-2 py-0 text-gold/60 hover:text-gold hover:bg-gold/10" onClick={() => editor.chain().focus().addRowAfter().run()}>+ Row After</Button>
          <Button type="button" variant="ghost" size="sm" className="h-6 px-2 py-0 text-gold/60 hover:text-gold hover:bg-gold/10" onClick={() => editor.chain().focus().deleteRow().run()}>- Delete Row</Button>
          <div className="w-px h-4 bg-gold/20 mx-1"></div>
          <Button type="button" variant="ghost" size="sm" className="h-6 px-2 py-0 text-red-500/60 hover:text-red-500 hover:bg-red-500/10" onClick={() => editor.chain().focus().deleteTable().run()}>Delete Table</Button>
        </div>
      )}
    </div>
  );
}
