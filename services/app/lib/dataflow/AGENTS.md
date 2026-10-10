# The data language

`lib/dataflow` turns a document's `<Helmet>` declarations into a `CompiledDataflow` and answers every
pure question about one: reference syntax (`$name`, `ref:`), built-ins, placement, mutation requests,
URL values, reference data and the publish-time reference checks. Both realms use it: the server,
the islands, the story runtime and the CLI.

- It sits below the recorded cycle and imports only itself, `lib/jsx`, `lib/validation` (types),
  `@artifactbin/contracts`, `@artifactbin/utils` and `@artifactbin/sql`. `npm run validate` fails
  any edge back into the cycle; move the shared code down or invert the dependency instead.
- Three entries, the whole outside interface (`DEEP_MODULES` in `scripts/ci/module-graph.mjs` refuses
  any other path): `index.ts` (browser-safe), `references.ts` (reference uses, read with the JSX
  parser, kept out of the index so the islands never load it) and `server.ts` (the compiler, the
  publish checks, node-only). Re-export only names something outside imports.
- The island graph's VALUE imports name a leaf (`DATAFLOW_BROWSER_LEAVES`): esbuild places split code
  by which entries reach a file, so a barrel import puts every re-exported file in that island's
  closure (row 40.1: +3.5 to +9.2 KB raw per kit; `sideEffects: false` did not help). Types come from the index.
- The compiler never reads process state. Its caller passes the composition's SQL extensions
  (`prepareCompile`/`compileWithLoader` `{ extensions }`, the server's `sqlExtensions()`); without
  them a `<Mutation>` calling one is refused.
- `ResolvedRef` carries what the reference checks read. The dataset catalog that only the server's
  publish checks need rides on `ServerRef` in `lib/datasets/schema-loader.ts`, so this module never
  depends on `lib/datasets`. `DatasetColumn` is defined once, in `dataset-shape.ts`.
- The `$name` lexer (`sql-parameters.ts`) lives here; `lib/datasets/sql` binds with it.
