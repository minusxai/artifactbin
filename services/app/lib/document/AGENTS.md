# The stored document

`lib/document` is what a document *is* and how edits to it compose: its source and the stored node
graph (codec, node ids, graph patches), the editing algebra (splices, edit batches, source changes,
prepared updates), the `<Helmet>` head (declarations, title, PWA, CSP, social preview), comment
ranges, asset URLs and the stored compiled-dataflow record. It has no I/O; the write path (SQL on
artifact tables) is `lib/artifacts/write` and the publish pipeline stays in `lib/story`.

- It sits below the recorded cycle and imports only itself, `lib/dataflow`, `lib/jsx`, `lib/data`,
  `lib/story-ui`, `lib/validation`, `@artifactbin/contracts` and `@artifactbin/utils`. `npm run validate`
  fails any edge back into the cycle; move the shared code down or invert the dependency instead.
- `index.ts` (model and edits), `head.ts` and `annotations.ts` are browser-safe; `server.ts` holds the
  compiled-dataflow record (node:crypto, zod). Browser-bundled code imports leaf files directly: the
  island and app bundlers cannot drop the rest of a barrel.
- Inversions that keep it below the cycle: `AnnotationOperation` is defined here and lib/editor-v2
  imports it; `StoredMermaidImage` is a contract; `runtimeId` is `@artifactbin/utils/runtime-id`;
  `prepareBrowserDocumentUpdate` takes a `{ prepare }` port (`DocumentPreparePort`), not the artifact
  backend; `MAX_CONTENT_BYTES` is defined here (`limits.ts`) and the publish door imports it;
  `readCompiledDataflow` takes the composition's SQL extensions from its caller.
