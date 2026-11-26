/**
 * THE MARKDOWN EDITOR ENTRY (imports Tiptap): the shared elements as Tiptap extensions whose on-screen markup is the
 * display entry's (`markdownExtensions`), their schema (`markdownSchema`), and saving the editor's document back to
 * Markdown (`serialize`, on prosemirror-markdown's MarkdownSerializer). Loading goes through the display entry's one
 * parser: `editor.commands.setContent(parse(markdown, options))`, with the same `images` switch on both sides.
 * EDITOR_ONLY_MARKUP lists everything the editor's DOM may add to the display markup.
 */
import { getSchema } from '@tiptap/core';
import type { Schema } from 'prosemirror-model';
import { markdownExtensions, type MarkdownEditorOptions } from './extensions';

export { parse } from './parse';
export { markdownExtensions, EDITOR_ONLY_MARKUP, type MarkdownEditorOptions } from './extensions';
export { serialize, listCanBeTight, type SerializeOptions } from './serialize';
export type { MarkdownDoc, MarkdownNode, ParseOptions } from './types';

/** The schema the extensions define, for serializing or checking a document without an editor. */
export const markdownSchema = (options: MarkdownEditorOptions = {}): Schema => getSchema(markdownExtensions(options));
