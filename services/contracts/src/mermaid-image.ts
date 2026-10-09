/**
 * A server-harvested Mermaid drawing (lib/mermaid-images): fixed layout, and
 * the document's fonts carried inside it, so a reader shows it as it is.
 * The harvester stores it, the document model reads it (lib/document/lazy-code),
 * the reader runtime and the islands draw it.
 */
export interface StoredMermaidImage { src: string; type: string; width?: number; height?: number; palette: string }
