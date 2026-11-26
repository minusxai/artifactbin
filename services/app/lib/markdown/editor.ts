/**
 * THE MARKDOWN EDITOR ENTRY (imports Tiptap): the shared elements as Tiptap extensions whose on-screen markup is the
 * display entry's (`markdownExtensions`), their schema (`markdownSchema`), and saving the editor's document back to
 * Markdown (`serialize`, on prosemirror-markdown's MarkdownSerializer). Loading goes through the display entry's one
 * parser: `editor.commands.setContent(parse(markdown, options))`, with the same `images` switch on both sides.
 * EDITOR_ONLY_MARKUP lists everything the editor's DOM may add to the display markup. Code highlighting is a lazy
 * chunk an editor loads for its first code block with a language (`loadCodeHighlighting` loads it now); the
 * behaviour editors share beyond the elements (list indentation, the clipboard rule) is ./editing.ts.
 */
import './highlight';

export { parse } from './parse';
export { markdownExtensions, loadCodeHighlighting, EDITOR_ONLY_MARKUP } from './extensions';
export { markdownSchema, serialize } from './save';
export { imageAllowed } from './href';
