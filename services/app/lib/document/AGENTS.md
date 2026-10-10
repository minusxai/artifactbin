# The stored document

`lib/document` is what a document *is* and how edits to it compose: its source and the stored node
graph (codec, node ids, graph patches), the editing algebra (splices, edit batches, source changes,
prepared updates), the `<Helmet>` head (declarations, title, PWA, CSP, social preview), comment
ranges, asset URLs and the stored compiled-dataflow record. It has no I/O; the write path (SQL on
artifact tables) is `lib/artifacts/write` and the publish pipeline stays in `lib/publish`.

- It sits below the recorded cycle and imports only itself, `lib/dataflow`, `lib/jsx`, `lib/data`,
  `lib/story-ui`, `lib/validation`, `@artifactbin/contracts` and `@artifactbin/utils`. `npm run validate`
  fails any edge back into the cycle; move the shared code down or invert the dependency instead.
- Two entries: `index.ts` (browser-safe) for all outside code that is not browser-bundled, and `server.ts`
  (node-only: the compiled-dataflow record, node:crypto, zod). Browser-bundled code imports values from a
  listed leaf file, never the index: the island and app bundlers cannot drop the rest of a barrel. Its
  `import type` may name the index (types are erased).
  `DEEP_MODULES['lib/document']` (`scripts/ci/module-graph.mjs`) lists the browser importers and leaves;
  any other outside path fails validate, and a leaf nothing imports must be removed.
- Inversions that keep it below the cycle: `AnnotationOperation` is defined here and lib/editor-engine
  imports it; `StoredMermaidImage` is a contract; `runtimeId` is `@artifactbin/utils/runtime-id`;
  `prepareBrowserDocumentUpdate` takes a `{ prepare }` port (`DocumentPreparePort`), not the artifact
  backend; the document size limit is the contracts' `MAX_DOCUMENT_BYTES`;
  `readCompiledDataflow` takes the composition's SQL extensions from its caller.
