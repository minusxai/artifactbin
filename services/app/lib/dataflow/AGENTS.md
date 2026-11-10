# The data language

`lib/dataflow` holds the pure half of a page's data: the `CompiledDataflow` record and the questions asked of
it, built-ins, stored-flow evaluation over a SQL engine, number formats, URL values and the `$name` SQL lexer.
It owns no database, access check or HTTP; those stay with its callers.

## Rules
- Two entries: the index (browser-safe) and `server.ts` (the SQL lexing helpers). Re-export from them only
  what something outside imports; knip refuses unused exports.
- Browser-bundled code imports VALUES from a leaf in `DATAFLOW_BROWSER_LEAVES` (`number-format`, `url-values`),
  never the index: a barrel import keeps every re-exported file in the bundle. Types come from the index. A
  new leaf or importer is a reviewed edit to the `lib/dataflow` row in `scripts/ci/module-graph.mjs`.
- Import only `@artifactbin/contracts`, `@artifactbin/utils/shape` and `d3-format`. Take utils by subpath,
  never its root: the root reaches `node:http`, which breaks the reader build.
- Evaluation is pure over what the caller passes: `evaluateDataflow` takes the engine, the imports' rows and an
  optional `sourceQuery` for connected databases. Never read process state, settings or the database here.
- Number formats are author input: `numberFormatter` never throws on a bad spec, so neither publish nor
  rendering can fail on one.

## Checks
- `npm test -- --files services/app/lib/dataflow/__tests__/interface-vocabulary.test.ts services/app/lib/dataflow/__tests__/interface-server.test.ts services/app/lib/dataflow/__tests__/compiled-flow.test.ts services/app/lib/dataflow/__tests__/number-format.test.ts services/app/lib/dataflow/__tests__/cell-value.test.ts`
- `npm run validate` after any import change (module graph and knip).
