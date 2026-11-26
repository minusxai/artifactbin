/**
 * Internal: af-markdown-editor's vocabulary: lib/markdown's shared elements (images on), its
 * parse (reading older saves' spaced tables) and save. Strikethrough is Mod-Shift-X; tables have
 * no prosemirror-tables plugin or keys, the field moves and repairs cells itself.
 * Used by: markdown-editor.ts and its -commands and -paste siblings.
 */
import { getSchema, type AnyExtension, type JSONContent, type Mark, type Node } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import type { Node as ProseNode, Schema } from 'prosemirror-model';
import { markdownExtensions, parse, serialize } from '../markdown/editor';

/** A document back to Markdown source: '' when it holds no text. */
export { serialize as serializeMarkdown };

const OFF = ['blockquote', 'bold', 'bulletList', 'code', 'codeBlock', 'document', 'hardBreak',
  'heading', 'horizontalRule', 'italic', 'link', 'listItem', 'listKeymap', 'orderedList',
  'paragraph', 'strike', 'text', 'underline', 'trailingNode', 'undoRedo'];
/** StarterKit adds only the drop and gap cursors. */
const cursors = StarterKit.configure(Object.fromEntries(OFF.map(name => [name, false])));

const noKeys = { addKeyboardShortcuts: () => ({}) };
function adapt(extension: AnyExtension): AnyExtension {
  if (extension.name === 'strike') return (extension as Mark).extend({
    addKeyboardShortcuts() { return { 'Mod-Shift-x': () => this.editor.commands.toggleStrike() }; },
  });
  if (extension.name === 'table') {
    return (extension as Node).extend({ ...noKeys, addProseMirrorPlugins: () => [] });
  }
  // The field binds Shift-Enter; Mod-Enter stays the page's outside code and task items.
  return extension.name === 'hardBreak' ? (extension as Node).extend(noKeys) : extension;
}

/** The field's elements, adapted as above, and the cursors. */
export const fieldExtensions = (): AnyExtension[] =>
  [...markdownExtensions({ images: true }).map(adapt), cursors];
export const editorSchema: Schema = getSchema(fieldExtensions());

/** Markdown source as the field's document JSON; empty source is one empty paragraph. */
export function markdownContent(source: string | null | undefined): JSONContent {
  const doc = parse(source ?? '', { images: true, recoverSpacedTables: true });
  return doc.content.length ? doc : { type: 'doc', content: [{ type: 'paragraph' }] };
}
/** Markdown source to a document of `schema` (the field's own by default). */
export const parseMarkdown = (source: string | null | undefined,
  schema = editorSchema): ProseNode => schema.nodeFromJSON(markdownContent(source));
/** The source as the editor would write it back, so equal content compares equal. */
export const normalizeMarkdown = (source: string | null | undefined): string =>
  serialize(parseMarkdown(source));
