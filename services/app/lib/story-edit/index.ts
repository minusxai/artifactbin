/**
 * The story-edit module's interface: edits to a story's JSX source — the WYSIWYG text, format and layout
 * write-back, node removal, static attributes, link hrefs and the number and mermaid embed shapes. Browser-bundled
 * code imports values from the leaf files DEEP_MODULES lists (scripts/ci/module-graph.mjs).
 */
export { applyDomEditsToJsx, applyFormatEditsToJsx, applyLayoutEditsToJsx, removeJsxNodeAtPath, setStaticJsxAttr } from './jsx-edit';
export { normalizeLinkHref } from './link-edit';
export type { MermaidEmbed, MermaidEmbedEdit } from './story-mermaid';
export { NUMBER_AGGS } from './story-number';
