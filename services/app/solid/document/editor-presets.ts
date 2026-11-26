/**
 * The comment box's elements: lib/markdown's shared elements (images on; table nodes in the schema so a body with a
 * table survives an edit elsewhere in it, but no table commands, menus or cell movement), plus what only comments
 * have: the Mention atom, private local history, the drop and gap cursors, list keys, Tab indentation (code blocks
 * indent their lines) and the document editor's Ctrl+E / Mod+Shift+E. Headings may hold a mention.
 */
import { NativeEditorShortcuts, NativeIndentation } from '@/lib/html-runtime/native-editing-behavior';
import { Extension, Node, type AnyExtension, type Mark } from '@tiptap/core';
import { ListKeymap } from '@tiptap/extension-list/keymap';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { history, redo, undo } from 'prosemirror-history';
import { markdownExtensions } from '@/lib/markdown/editor';
import { isSessionMentionHref } from '@/lib/annotations/session-mentions';
import { isPersonMentionHref } from '@/lib/document/person-mentions';
import { agentNameColor } from '../lib/agent-identity';

export const isMentionHref = (href: string): boolean => isSessionMentionHref(href) || isPersonMentionHref(href);

const Mention = Node.create({
  name: 'mention', inline: true, group: 'inline', atom: true,
  addAttributes: () => ({ label: { default: '' }, href: { default: '' } }),
  parseHTML: () => [{ tag: 'span[data-comment-mention]', getAttrs: element => {
    const href = element.getAttribute('data-mention-href') ?? '';
    return isMentionHref(href) ? { label: element.textContent ?? '', href } : false;
  }}],
  renderHTML: ({ node }) => ['span', {
    'data-comment-mention': '', 'data-mention-href': node.attrs.href,
    contenteditable: 'false',
    style: `--mention-color:${agentNameColor(String(node.attrs.label).replace(/^@/, ''))}`,
  }, node.attrs.label],
});

const LocalHistory = Extension.create({
  name: 'commentHistory',
  addProseMirrorPlugins: () => [history(), dropCursor(), gapCursor()],
  addKeyboardShortcuts() {
    const run = (command: typeof undo) => () => command(this.editor.state, this.editor.view.dispatch);
    return { 'Mod-z': run(undo), 'Shift-Mod-z': run(redo), 'Mod-y': run(redo) };
  },
});

/** The shared elements as comments configure them. */
function adapt(extension: AnyExtension): AnyExtension {
  if (extension.name === 'codeBlock') return extension.configure({ enableTabIndentation: true, tabSize: 2 });
  // Mod+E is the document editor's Ctrl+E (line end) family; inline code is Mod+Shift+E (NativeEditorShortcuts).
  if (extension.name === 'code') return (extension as Mark).extend({ addKeyboardShortcuts: () => ({}) });
  if (extension.name === 'heading') return (extension as Node).extend({ content: '(text | image | mention)*' });
  return extension;
}

export function commentExtensions(options: Parameters<typeof markdownExtensions>[0] = {}): AnyExtension[] {
  return [...markdownExtensions({ ...options, images: true }).map(adapt), LocalHistory, ListKeymap, NativeIndentation, NativeEditorShortcuts, Mention];
}
