/**
 * SAVING WITHOUT AN EDITOR: the shared elements' schema and the Markdown serializer, for code that builds a document
 * and writes it back to Markdown with no editor on screen (documents' Markdown export on the server). It loads no
 * code highlighter (./highlight.ts belongs to the editor entry).
 */
import { getSchema } from '@tiptap/core';
import type { Schema } from 'prosemirror-model';
import { markdownExtensions, type MarkdownEditorOptions } from './extensions';

export { serialize } from './serialize';

/** The schema the extensions define, for serializing or checking a document without an editor. */
export const markdownSchema = (options: MarkdownEditorOptions = {}): Schema => getSchema(markdownExtensions(options));
