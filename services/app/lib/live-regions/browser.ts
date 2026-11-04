/**
 * The BROWSER entry of live regions: the editor side only (the editor state and its commands, the shared text, and
 * Yjs relative positions for carets). It reaches neither the server's parse5 and Markdown readers (source-html.ts)
 * nor compaction, so the page frame's lazily loaded editor (lib/html-runtime/region-editor, `@afbin/regions`) stays
 * small. Server code uses the index.
 */
export { regionText } from './lines';
export { editorState, regionCommands } from './editor';
export { absolutePosition, relativePosition } from './binding';
