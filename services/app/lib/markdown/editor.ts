/** Edit-only Lexical boundary. Markdown is persisted; Lexical keys and DOM never leave this module. */
import { createEditor, $getRoot, $getSelection, $isRangeSelection, $setSelection, $createParagraphNode, $isTextNode, $isElementNode, TextNode, FORMAT_TEXT_COMMAND, KEY_TAB_COMMAND, INDENT_CONTENT_COMMAND, OUTDENT_CONTENT_COMMAND, COMMAND_PRIORITY_HIGH, $createNodeSelection, $getNearestNodeFromDOMNode, CLICK_COMMAND, COMMAND_PRIORITY_LOW, $isParagraphNode, type BaseSelection, type LexicalNode, type LexicalEditor } from 'lexical';
import { HeadingNode, QuoteNode, registerRichText, $createHeadingNode, $createQuoteNode, $isHeadingNode, $isQuoteNode } from '@lexical/rich-text';
import { ListNode, ListItemNode, $isListNode, registerList, registerCheckList, INSERT_CHECK_LIST_COMMAND, INSERT_ORDERED_LIST_COMMAND, INSERT_UNORDERED_LIST_COMMAND, REMOVE_LIST_COMMAND } from '@lexical/list';
import { LinkNode, $toggleLink, $isLinkNode } from '@lexical/link';
import { CodeNode, CodeHighlightNode, $createCodeNode, $isCodeNode } from '@lexical/code';
import { $setBlocksType } from '@lexical/selection';
import { $convertFromMarkdownString, $convertToMarkdownString, $generateNodesFromMarkdownString, registerMarkdownShortcuts } from '@lexical/markdown';
import { HorizontalRuleNode, $createHorizontalRuleNode, $isHorizontalRuleNode } from '@lexical/extension';
import { $insertNodeToNearestRoot } from '@lexical/utils';
import { TableNode, TableRowNode, TableCellNode, $isTableRowNode, $isTableCellNode, $isTableSelection, $findTableNode, TableCellHeaderStates, INSERT_TABLE_COMMAND, registerTablePlugin, registerTableSelectionObserver, registerTableCellUnmergeTransform, setScrollableTablesActive, $insertTableRowAtSelection, $insertTableColumnAtSelection, $deleteTableRowAtSelection, $deleteTableColumnAtSelection } from '@lexical/table';
import { markdownTransformers as transformers, prepareEditorMarkdown } from './transformers';
import { markdownContent, markdownHref } from './content';
type MarkdownBlock = 'paragraph' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'quote' | 'bullet' | 'number' | 'code' | 'check' | 'hr' | 'table';
export type MarkdownTableAction = 'row-before' | 'row-after' | 'column-before' | 'column-after' | 'delete-row' | 'delete-column' | 'delete-table';
export interface MarkdownEditor {
  editor: LexicalEditor;
  flush(): void;
  sync(source: string): void;
  busy(): boolean;
  focus(): void;
  inline(tag: 'strong' | 'em' | 'u'): void;
  block(kind: MarkdownBlock): void;
  table(action: MarkdownTableAction): void;
  link(href: string | null): void;
  paste(text: string, kind: 'markdown' | 'text'): void;
  selection(): { strong: boolean; em: boolean; u: boolean; link?: string; block?: MarkdownBlock | 'mixed' };
  destroy(): void;
}
interface MarkdownEditorOptions {
  source: string;
  onChange(source: string): void;
  onBusy?(busy: boolean): void;
  onSelection?(): void;
  onError?(message: string): void;
}
/** Read semantic blocks from Lexical, including list ancestors around inline text. */
function selectionBlock(range: BaseSelection): MarkdownBlock | 'mixed' {
  const blockOf = (leaf: LexicalNode): MarkdownBlock => {
    if ($findTableNode(leaf)) return 'table';
    for (let node: LexicalNode | null = leaf; node; node = node.getParent()) {
      if ($isHeadingNode(node)) return node.getTag();
      if ($isListNode(node)) return node.getListType();
      if ($isHorizontalRuleNode(node)) return 'hr';
      if ($isQuoteNode(node)) return 'quote';
      if ($isCodeNode(node)) return 'code';
    }
    return 'paragraph';
  };
  const anchor = ($isRangeSelection(range) || $isTableSelection(range)) ? range.anchor.getNode() : range.getNodes()[0];
  if (!anchor) return 'paragraph';
  const leaves = range.isCollapsed() ? [anchor] : range.getNodes().filter(node => $isTextNode(node) || ($isElementNode(node) && node.isEmpty()) || $isHorizontalRuleNode(node));
  const kinds = new Set((leaves.length ? leaves : [anchor]).map(blockOf));
  return kinds.size === 1 ? kinds.values().next().value! : 'mixed';
}
const mounted = new WeakMap<Element, MarkdownEditor>();
export function markdownEditorFor(element: Element): MarkdownEditor | undefined {
  const root = element.closest('[data-mx-markdown]');
  return root ? mounted.get(root) : undefined;
}
export function mountMarkdownEditor(root: HTMLElement, options: MarkdownEditorOptions): MarkdownEditor {
  const editor = createEditor({
    namespace: 'artifactbin-markdown',
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode, CodeNode, CodeHighlightNode, HorizontalRuleNode, TableNode, TableRowNode, TableCellNode],
    theme: { text: { bold: 'mx-md-bold', italic: 'mx-md-italic', strikethrough: 'mx-md-strike', code: 'mx-md-inline-code' }, code: 'mx-md-code', hr: 'mx-md-hr', tableScrollableWrapper: 'mx-md-table-scroll', tableSelection: 'mx-md-table-selection', tableCellSelected: 'mx-md-cell-selected', list: { checklist: 'mx-md-check-list' } },
    onError(error) { options.onError?.(error.message); },
  });
  let saved = options.source;
  let changed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastSelection: BaseSelection | null = null;
  let stopped = false;
  root.setAttribute('contenteditable', 'true');
  root.setAttribute('role', 'textbox');
  root.setAttribute('aria-label', 'Markdown text');
  root.setAttribute('aria-multiline', 'true');
  root.dataset.mxLexical = '';
  setScrollableTablesActive(editor, true);
  editor.setRootElement(root);
  const load = (source: string) => {
    const prepared = prepareEditorMarkdown(source);
    editor.update(() => {
    lastSelection = null;
    $convertFromMarkdownString(prepared.source, prepared.transformers, undefined, false, true);
    $setSelection(null);
    }, { discrete: true, tag: 'markdown-source' });
  };
  load(saved);
  const stampHeadings = () => {
    root.querySelectorAll('[data-mx-markdown-heading]').forEach(el => el.removeAttribute('data-mx-markdown-heading'));
    root.querySelectorAll('h1,h2,h3').forEach((el, i) => el.setAttribute('data-mx-markdown-heading', String(i)));
  };
  const flush = () => {
    clearTimeout(timer);
    if (!changed || editor.isComposing()) return;
    const source = editor.getEditorState().read(() => $convertToMarkdownString(transformers));
    const errors = markdownContent(source).errors;
    if (errors.length) { options.onError?.(errors.join('\n')); return; }
    changed = false;
    if (source !== saved) { saved = source; options.onChange(source); }
    options.onBusy?.(false);
  };
  const dispose = [
    registerRichText(editor), registerList(editor), registerCheckList(editor),
    registerTablePlugin(editor), registerTableSelectionObserver(editor, true), registerTableCellUnmergeTransform(editor),
    registerMarkdownShortcuts(editor, transformers),
    // Lists serialize their indentation as nested Markdown; table Tab belongs to Lexical's table plugin.
    editor.registerCommand(KEY_TAB_COMMAND, event => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection) || !['bullet', 'number', 'check'].includes(selectionBlock(selection))) return false;
      event.preventDefault();
      editor.dispatchCommand(event.shiftKey ? OUTDENT_CONTENT_COMMAND : INDENT_CONTENT_COMMAND, undefined);
      return true;
    }, COMMAND_PRIORITY_LOW),
    // GFM tables have exactly one header row; row insertion/deletion keeps that invariant.
    editor.registerNodeTransform(TableNode, table => {
      table.getChildren().filter($isTableRowNode).forEach((row, index) => row.getChildren().filter($isTableCellNode).forEach(cell => {
        const header = index === 0 ? TableCellHeaderStates.ROW : TableCellHeaderStates.NO_STATUS;
        if (cell.getHeaderStyles() !== header) cell.setHeaderStyles(header);
      }));
    }),
    editor.registerCommand(CLICK_COMMAND, event => {
      if (!(event.target instanceof Node)) return false;
      const node = $getNearestNodeFromDOMNode(event.target);
      if (!$isHorizontalRuleNode(node)) return false;
      const selected = $createNodeSelection(); selected.add(node.getKey()); $setSelection(selected); return true;
    }, COMMAND_PRIORITY_LOW),
    // Markdown cannot persist these marks: never offer them or admit them from keyboard/paste.
    editor.registerCommand(FORMAT_TEXT_COMMAND, format => !['bold', 'italic', 'strikethrough', 'code'].includes(format), COMMAND_PRIORITY_HIGH),
    editor.registerNodeTransform(TextNode, node => {
      for (const format of ['underline', 'highlight', 'subscript', 'superscript'] as const) if (node.hasFormat(format)) node.toggleFormat(format);
      if (node.getStyle()) node.setStyle('');
    }),
    editor.registerNodeTransform(LinkNode, node => { if (!markdownHref(node.getURL())) { for (const child of node.getChildren()) node.insertBefore(child); node.remove(); } }),
    editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves, tags }) => {
      editorState.read(() => { const selection = $getSelection(); if (selection) lastSelection = selection.clone(); });
      stampHeadings();
      options.onSelection?.();
      if (tags.has('markdown-source') || (!dirtyElements.size && !dirtyLeaves.size)) return;
      changed = true;
      options.onBusy?.(true);
      clearTimeout(timer);
      timer = setTimeout(flush, 200);
    }),
  ];
  stampHeadings();
  const update = (fn: () => void) => {
    editor.update(() => {
      if (!$getSelection() && lastSelection) $setSelection(lastSelection.clone());
      if (!$getSelection()) $getRoot().selectEnd();
      fn();
    }, { discrete: true });
  };
  // The page owns the unified undo journal; commands and typing use the same onChange path.
  const view: MarkdownEditor = {
    editor, flush, busy: () => changed || editor.isComposing(),
    focus() { editor.focus(); },
    sync(source) {
      if (source === saved || editor.isComposing()) return;
      clearTimeout(timer); changed = false; saved = source;
      const focused = root.contains(root.ownerDocument.activeElement);
      load(source); stampHeadings();
      if (focused) editor.update(() => { $getRoot().selectEnd(); }, { discrete: true });
      options.onBusy?.(false);
    },
    inline(tag) { if (tag === 'u') return; update(() => { const selection = $getSelection(); if ($isRangeSelection(selection)) selection.formatText(tag === 'strong' ? 'bold' : 'italic'); }); },
    block(kind) {
      update(() => {
        const current = $getSelection();
        if (current && selectionBlock(current) === 'table') return;
        if (kind === 'table') { editor.dispatchCommand(INSERT_TABLE_COMMAND, { rows: '3', columns: '2', includeHeaders: { rows: true, columns: false } }); return; }
        if (kind === 'hr') {
          const paragraph = $createParagraphNode();
          const rule = $createHorizontalRuleNode();
          if ($isRangeSelection(current) && $isParagraphNode(current.anchor.getNode()) && current.anchor.getNode().getTextContent() === '') current.anchor.getNode().replace(rule);
          else $insertNodeToNearestRoot(rule);
          rule.insertAfter(paragraph); paragraph.selectStart(); return;
        }
        if (kind === 'check') { editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined); return; }
        if (kind === 'bullet' || kind === 'number') { editor.dispatchCommand(kind === 'bullet' ? INSERT_UNORDERED_LIST_COMMAND : INSERT_ORDERED_LIST_COMMAND, undefined); return; }
        editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
        const selection = $getSelection();
        if ($isRangeSelection(selection)) $setBlocksType(selection, () => kind === 'quote' ? $createQuoteNode() : kind === 'code' ? $createCodeNode() : kind === 'paragraph' ? $createParagraphNode() : $createHeadingNode(kind));
      });
      editor.focus();
    },
    table(action) {
      update(() => {
        const selected = $getSelection();
        if (!$isRangeSelection(selected) && !$isTableSelection(selected)) return;
        const table = $findTableNode(selected.anchor.getNode());
        if (!table) return;
        if (action === 'row-before' || action === 'row-after') $insertTableRowAtSelection(action === 'row-after');
        else if (action === 'column-before' || action === 'column-after') $insertTableColumnAtSelection(action === 'column-after');
        else if (action === 'delete-row') $deleteTableRowAtSelection();
        else if (action === 'delete-column') $deleteTableColumnAtSelection();
        else { const paragraph = $createParagraphNode(); table.replace(paragraph); paragraph.selectStart(); }
      });
      editor.focus();
    },
    link(href) { if (href !== null && !markdownHref(href)) return; update(() => $toggleLink(href)); },
    paste(text, kind) {
      if (kind === 'markdown' && markdownContent(text).errors.length) { options.onError?.('This Markdown contains unsupported content.'); return; }
      update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;
        if (kind === 'text') { selection.insertRawText(text); return; }
        const prepared = prepareEditorMarkdown(text);
        const nodes = $generateNodesFromMarkdownString(prepared.source, prepared.transformers, false, true);
        if (nodes.length === 1 && $isCodeNode(nodes[0])) {
          selection.removeText();
          $insertNodeToNearestRoot(nodes[0]);
        }
        else selection.insertNodes(nodes);
      });
    },
    selection() {
      return editor.getEditorState().read(() => {
        const selection = $getSelection();
        const selected = selection ?? lastSelection;
        const range = $isRangeSelection(selected) ? selected : null;
        const result = { strong: range?.hasFormat('bold') ?? false, em: range?.hasFormat('italic') ?? false, u: false, link: undefined as string | undefined, block: selected ? selectionBlock(selected) : undefined };
        if (range) { let node = range.anchor.getNode(); if ($isTextNode(node)) node = node.getParent()!; if ($isElementNode(node) && $isLinkNode(node)) result.link = node.getURL(); }
        return result;
      });
    },
    destroy() {
      if (stopped) return;
      flush(); stopped = true; clearTimeout(timer); dispose.reverse().forEach(fn => fn()); editor.setRootElement(null); setScrollableTablesActive(editor, false);
      mounted.delete(root);
      for (const attr of ['contenteditable', 'role', 'aria-label', 'aria-multiline', 'data-mx-lexical']) root.removeAttribute(attr);
      root.innerHTML = markdownContent(saved).html;
    },
  };
  mounted.set(root, view);
  return view;
}
