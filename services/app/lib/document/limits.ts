/**
 * The largest document source, in UTF-8 bytes: the publish door (lib/story/document/input), the graph
 * write and the skill guide all state this one number. The wire's `MAX_DOCUMENT_BYTES`
 * (`@artifactbin/contracts`) bounds a prepared update at the same size.
 */
export const MAX_CONTENT_BYTES = 2_000_000;
