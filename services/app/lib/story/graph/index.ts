/** What server code outside lib/story imports from this sub-module. Browser-bundled code imports the leaf files directly: the island and app bundlers cannot drop the rest of a barrel. */
export { graphNodes } from './document-graph';
export type { ProseOperation } from './document-prose';
