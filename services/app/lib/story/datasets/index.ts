/** What server code outside lib/story imports from this sub-module. Browser-bundled code imports the leaf files directly: the island and app bundlers cannot drop the rest of a barrel. */
export type { DatasetColumn } from './dataset-shape';
export { LocalStateInputError } from './local-tables';
export { parseMutationRequest } from './mutation-request';
export type { MutationRequest } from './mutation-request';
