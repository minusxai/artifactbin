/**
 * lib/story-runtime's DATA entry: the document's dataflow store, its transports' shape, the page engine and the
 * author-facing page bindings. For server and single-bundle code (the Lambda page runtime) and for TYPE imports
 * anywhere. Browser-bundled code imports these values from their own files: a re-export here makes every chunk that
 * imports it reach all of them (measured, row 40.2), so the island chunks would grow.
 */
export { createDataflowStore, type DataflowStore, type MutationAnswer, type QueryTransport, type StoreWriteEvent } from './store';
export type { PageCore, PageEngine } from './page-engine';
export { bindPage } from './page-bindings';
export type { RunAnswer } from './dataflow-core';
