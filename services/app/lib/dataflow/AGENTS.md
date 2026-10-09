# The data language

`lib/dataflow` turns a document's `<Helmet>` declarations into a `CompiledDataflow` and answers every
pure question about one: reference syntax (`$name`, `ref:`), built-ins, placement, mutation requests,
URL values, reference data and the publish-time reference checks. Both realms use it: the server,
the islands, the story runtime and the CLI.

- It sits below the recorded cycle and imports only itself, `lib/jsx`, `lib/validation` (types),
  `@artifactbin/contracts`, `@artifactbin/utils` and `@artifactbin/sql`. `npm run validate` fails
  any edge back into the cycle; move the shared code down or invert the dependency instead.
- `index.ts` is browser-safe; `server.ts` holds the compiler and the reference checks (node-only).
  Browser-bundled code imports leaf files directly: the island and app bundlers cannot drop the rest of a barrel.
- The compiler never reads process state. Its caller passes the composition's SQL extensions
  (`prepareCompile`/`compileWithLoader` `{ extensions }`, the server's `sqlExtensions()`); without
  them a `<Mutation>` calling one is refused.
- `ResolvedRef` carries what the reference checks read. The dataset catalog that only the server's
  publish checks need rides on `ServerRef` in `lib/story/data/data-checks.ts`, so this module never
  depends on `lib/datasets`. `DatasetColumn` is defined once, in `dataset-shape.ts`.
- The `$name` lexer (`sql-parameters.ts`) lives here; `lib/datasets/sql` binds with it.
