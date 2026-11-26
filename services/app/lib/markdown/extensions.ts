/**
 * THE SHARED ELEMENTS IN TIPTAP: the extension list whose schema holds the module's document node for node and
 * whose on-screen DOM is the display writer's markup (./render.ts). Each element renders our markup, never Tiptap's
 * default: no task-item checkbox node view, no table colgroup or resize view, no link target or rel.
 *
 * The editor's DOM differs from the display markup only by EDITOR_ONLY_MARKUP, the one list the markup tests strip:
 * - attributes ProseMirror itself writes (contenteditable and draggable on leaf nodes, the editable root's own);
 * - aria-disabled, which the display writes on its read-only task items and the editor, where a click toggles them,
 *   leaves off;
 * - the placeholder nodes ProseMirror adds (a trailing `<br>` in an empty or break-ended line, a separator image),
 *   and the class it puts on a selected node;
 * - highlighted code: the editor's decorations cut a token's span where a token nested inside it starts or ends, so
 *   the tests compare each character's token classes, outermost first, instead of the span boundaries;
 * - how a style attribute is spelled (`text-align:left` against the DOM's `text-align: left;`): the tests compare
 *   the declarations.
 *
 * Behaviour that keeps the document saveable: table cells and headings hold inline content only (no hard break in a
 * heading); a tight list whose content cannot stay tight becomes loose (serialize.ts's listCanBeTight); the code mark
 * may sit inside bold, italic, strike and links; links take only addresses the display allows.
 */
import { Extension, Node, type AnyExtension } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import Heading from '@tiptap/extension-heading';
import Bold from '@tiptap/extension-bold';
import Italic from '@tiptap/extension-italic';
import Strike from '@tiptap/extension-strike';
import Code from '@tiptap/extension-code';
import Link, { type LinkOptions } from '@tiptap/extension-link';
import HardBreak from '@tiptap/extension-hard-break';
import Blockquote from '@tiptap/extension-blockquote';
import HorizontalRule from '@tiptap/extension-horizontal-rule';
import CodeBlock from '@tiptap/extension-code-block';
import { BulletList, ListItem, OrderedList, TaskItem, TaskList } from '@tiptap/extension-list';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { codeBlockLanguage, codeHighlight } from './code-block';
import { imageAllowed, linkAllowed } from './href';
import { listCanBeTight } from './serialize';
import type { LinkClassifier } from './types';

export const EDITOR_ONLY_MARKUP = Object.freeze({
  /** Attributes ProseMirror writes for editing. */
  attributes: Object.freeze(['contenteditable', 'draggable', 'translate', 'spellcheck', 'tabindex']),
  /** Attributes only the read-only display writes. */
  displayAttributes: Object.freeze(['aria-disabled']),
  /** Placeholder elements ProseMirror adds. */
  elements: Object.freeze(['br.ProseMirror-trailingBreak', 'img.ProseMirror-separator']),
  /** The class ProseMirror puts on a selected node. */
  classes: Object.freeze(['ProseMirror-selectednode']),
  /** Highlight spans (class prefix) compared per character, outermost token first. */
  codeTokenClassPrefix: 'mx-code-token-',
  /** Attributes compared by their declarations, not their spelling. */
  declarations: Object.freeze(['style']),
});

export interface MarkdownEditorOptions {
  /** The image element (off by default), as parse's `images`. */
  images?: boolean;
  /** As renderHtml's: written as `data-mx-link` on the link. */
  classifyLink?: LinkClassifier;
  /** As renderHtml's, and may be asynchronous: the image shows once the address is known. */
  imageAddress?: (src: string) => string | Promise<string>;
}

const LISTS = new Set(['bulletList', 'orderedList', 'taskList']);
const tight = { tight: { default: true, rendered: false, parseHTML: (element: HTMLElement) => element.getAttribute('data-tight') === 'true' } };
const tightMark = (node: PMNode) => (node.attrs.tight ? { 'data-tight': 'true' } : {});
const ALIGN = /text-align:\s*(left|center|right)/;
const cellAttributes = (node: PMNode) => (node.attrs.align ? { style: `text-align:${node.attrs.align}` } : {});
const align = { align: { default: null, rendered: false, parseHTML: (element: HTMLElement) => ALIGN.exec(element.getAttribute('style') ?? '')?.[1] ?? null } };

function headingAnchors(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'heading' && node.attrs.level <= 3) decorations.push(Decoration.node(pos, pos + node.nodeSize, { 'data-mx-markdown-heading': String(decorations.length) }));
    return !node.isTextblock;
  });
  return DecorationSet.create(doc, decorations);
}
function highlighting(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return true;
    // One decoration per token class over the same run, innermost first: ProseMirror wraps same-range decorations
    // outward in the order given, so the spans nest as renderCodeBlock's do.
    for (const range of codeHighlight(node.textContent, node.attrs.language)?.ranges ?? []) {
      for (const className of [...range.classNames].reverse()) decorations.push(Decoration.inline(pos + 1 + range.from, pos + 1 + range.to, { nodeName: 'span', class: className }));
    }
    return false;
  });
  return DecorationSet.create(doc, decorations);
}
const decorating = (name: string, build: (doc: PMNode) => DecorationSet) => new Plugin<DecorationSet>({
  key: new PluginKey(name),
  state: { init: (_, state) => build(state.doc), apply: (tr, set) => (tr.docChanged ? build(tr.doc) : set) },
  props: { decorations(state) { return this.getState(state); } },
});

/** Heading anchors, code highlighting, task toggling and list tightness: the behaviour the elements share. */
const MarkdownBehaviour = Extension.create({
  name: 'markdownBehaviour',
  addProseMirrorPlugins() {
    return [
      decorating('markdownHeadingAnchors', headingAnchors),
      decorating('markdownCodeHighlight', highlighting),
      new Plugin({
        key: new PluginKey('markdownTaskToggle'),
        props: {
          handleDOMEvents: {
            // A click on the item's own box (its marker), not on its text, toggles it.
            mousedown: (view, event) => {
              const item = event.target as HTMLElement | null;
              if (!view.editable || item?.nodeName !== 'LI' || item.getAttribute('role') !== 'checkbox') return false;
              const $pos = view.state.doc.resolve(view.posAtDOM(item, 0));
              for (let depth = $pos.depth; depth > 0; depth--) {
                const node = $pos.node(depth);
                if (node.type.name !== 'taskItem') continue;
                view.dispatch(view.state.tr.setNodeMarkup($pos.before(depth), undefined, { ...node.attrs, checked: !node.attrs.checked }));
                event.preventDefault();
                return true;
              }
              return false;
            },
          },
        },
      }),
      new Plugin({
        key: new PluginKey('markdownListTightness'),
        appendTransaction: (transactions, _old, state) => {
          if (!transactions.some(tr => tr.docChanged)) return null;
          let tr = state.tr;
          state.doc.descendants((node, pos) => {
            if (LISTS.has(node.type.name) && node.attrs.tight && !listCanBeTight(node)) tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, tight: false });
            return true;
          });
          return tr.docChanged ? tr : null;
        },
      }),
    ];
  },
});

const MarkdownLink = Link.extend<LinkOptions & { classify?: LinkClassifier }>({
  addAttributes() {
    return { href: { default: null, parseHTML: (element: HTMLElement) => element.getAttribute('href') }, title: { default: null } };
  },
  renderHTML({ mark }) {
    const href = linkAllowed(String(mark.attrs.href ?? '')) ? mark.attrs.href : null;
    return ['a', { href, title: mark.attrs.title, 'data-mx-link': href ? this.options.classify?.(href) ?? null : null }, 0];
  },
  addOptions() {
    return { ...this.parent!(), classify: undefined as LinkClassifier | undefined };
  },
});

function imageNode(address: MarkdownEditorOptions['imageAddress']) {
  return Node.create({
    name: 'image',
    inline: true,
    group: 'inline',
    atom: true,
    draggable: true,
    addAttributes: () => ({ src: { default: null }, alt: { default: '' }, title: { default: null } }),
    parseHTML: () => [{
      tag: 'img[src]',
      getAttrs: (element: HTMLElement) => {
        const src = element.getAttribute('src') ?? '';
        return imageAllowed(src) ? { src, alt: element.getAttribute('alt') ?? '', title: element.getAttribute('title') } : false;
      },
    }],
    renderHTML: ({ node }) => {
      const src = String(node.attrs.src ?? '');
      const shown = !imageAllowed(src) ? null : address ? address(src) : src;
      return ['img', { src: typeof shown === 'string' ? shown : null, alt: node.attrs.alt ?? '', title: node.attrs.title, loading: 'lazy' }];
    },
    addNodeView: () => (address ? ({ node }) => {
      const img = document.createElement('img');
      let shownSource: string | null = null;
      const show = (image: PMNode) => {
        const src = String(image.attrs.src ?? '');
        img.setAttribute('alt', String(image.attrs.alt ?? ''));
        if (image.attrs.title) img.setAttribute('title', String(image.attrs.title)); else img.removeAttribute('title');
        img.setAttribute('loading', 'lazy');
        if (src === shownSource) return;
        shownSource = src;
        if (!imageAllowed(src)) { img.removeAttribute('src'); return; }
        const shown = address(src);
        if (typeof shown === 'string') img.setAttribute('src', shown);
        else void shown.then(value => { if (shownSource === src) img.setAttribute('src', value); }, () => undefined);
      };
      show(node);
      return { dom: img, update: (next: PMNode) => { if (next.type !== node.type) return false; show(next); return true; } };
    } : null),
  });
}

/** The Tiptap extensions for the shared elements, configured to emit the display writer's markup. */
export function markdownExtensions(options: MarkdownEditorOptions = {}): AnyExtension[] {
  const images = options.images ?? false;
  return [
    Document,
    Paragraph,
    Text,
    Heading.extend({ content: images ? '(text | image)*' : 'text*' }),
    MarkdownLink.configure({ openOnClick: false, autolink: false, linkOnPaste: false, isAllowedUri: url => linkAllowed(url), classify: options.classifyLink }),
    Bold,
    Italic,
    Strike,
    Code.extend({ excludes: '' }),
    HardBreak,
    Blockquote,
    HorizontalRule,
    CodeBlock.extend({
      renderHTML({ node }) {
        const known = codeBlockLanguage(node.textContent, node.attrs.language);
        return ['pre', ['code', known ? { class: `language-${known}`, 'data-language': known } : {}, 0]];
      },
    }),
    BulletList.extend({ addAttributes: () => tight, renderHTML: ({ node }) => ['ul', tightMark(node), 0] }),
    OrderedList.extend({
      addAttributes: () => ({ start: { default: 1, rendered: false, parseHTML: (element: HTMLElement) => Number.parseInt(element.getAttribute('start') ?? '1', 10) || 1 }, ...tight }),
      renderHTML: ({ node }) => ['ol', { start: node.attrs.start !== 1 ? node.attrs.start : null, ...tightMark(node) }, 0],
    }),
    ListItem.extend({ content: 'block+' }),
    TaskList.extend({
      addAttributes: () => tight,
      parseHTML: () => [{ tag: 'ul[data-type="taskList"]', priority: 51 }, { tag: 'ul.mx-md-check-list', priority: 51 }],
      renderHTML: ({ node }) => ['ul', { class: 'mx-md-check-list', ...tightMark(node) }, 0],
    }),
    TaskItem.configure({ nested: true }).extend({
      addNodeView: () => null,
      addAttributes: () => ({ checked: { default: false, keepOnSplit: false, rendered: false, parseHTML: (element: HTMLElement) => element.getAttribute('aria-checked') === 'true' || element.getAttribute('data-checked') === 'true' } }),
      parseHTML: () => [{ tag: 'li[data-type="taskItem"]', priority: 51 }, { tag: 'li[role="checkbox"]', priority: 51 }],
      renderHTML: ({ node }) => ['li', { role: 'checkbox', 'aria-checked': String(node.attrs.checked === true) }, 0],
      addKeyboardShortcuts() {
        return {
          ...this.parent?.(),
          'Mod-Enter': () => this.editor.commands.command(({ tr, state }) => {
            const { $from } = state.selection;
            for (let depth = $from.depth; depth > 0; depth--) {
              const node = $from.node(depth);
              if (node.type.name === 'taskItem') { tr.setNodeMarkup($from.before(depth), undefined, { ...node.attrs, checked: !node.attrs.checked }); return true; }
            }
            return false;
          }),
        };
      },
    }),
    Table.configure({ resizable: false, View: null, allowTableNodeSelection: false }).extend({
      renderHTML: () => ['div', { class: 'mx-md-table-scroll' }, ['table', ['tbody', 0]]],
    }),
    TableRow,
    TableHeader.extend({ content: 'inline*', addAttributes() { return { ...this.parent!(), ...align }; }, renderHTML: ({ node }) => ['th', cellAttributes(node), 0] }),
    TableCell.extend({ content: 'inline*', addAttributes() { return { ...this.parent!(), ...align }; }, renderHTML: ({ node }) => ['td', cellAttributes(node), 0] }),
    ...(images ? [imageNode(options.imageAddress)] : []),
    MarkdownBehaviour,
  ];
}
