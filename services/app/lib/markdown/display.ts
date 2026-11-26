/**
 * THE MARKDOWN DISPLAY ENTRY (browser and server; imports neither ProseMirror nor Tiptap): Markdown → the module's
 * JSON document (`parse`) → the shared markup (`renderHtml`, or `renderHtmlAsync` with an asynchronous image-address
 * function), its preview text (`plainText`) and its heading list (`headings`). The editor entry (./editor.ts) holds
 * the same document in Tiptap, renders the same markup and saves it back to Markdown.
 *
 * Rules every surface shares: a single newline is a line break (`breaks`, on by default); bare addresses link only
 * with a scheme or `www.`; links allow http, https, mailto, tel and relative addresses, and anything else shows as
 * typed; images (`images`, off unless a surface turns them on) allow https, relative and `ref:<id>` sources; raw HTML
 * is text. Each rule's detail is in ./parse.ts, ./href.ts and ./render.ts.
 */
export { parse, NESTING_CAP } from './parse';
export { renderHtml, renderHtmlAsync, plainText, headings } from './render';
export { linkAllowed, imageAllowed } from './href';
export type { AsyncRenderOptions, LinkClassifier, MarkdownDoc, MarkdownMark, MarkdownNode, MarkName, ParseOptions, Refusal, RenderOptions } from './types';
