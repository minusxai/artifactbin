# Page runtime

What a published page's scripts run against: the core script and its import map, the reader, `@afbin/apollo`
(`browser-client.ts`), `@afbin/state` (`browser-state.ts`), the lazy modules, viewer state, and the assembly and
build that serve them. Access decisions belong to the doors behind the trusted parent, not here.

## Rules
- Keep the trust boundaries apart. Author scripts get no credential and never reach the app API: `sql`
  and uploads go through the reader's frame bridge to the parent, which adds the reader's
  sign-in and the trusted revision; `frame-door.ts` swallows every bridge envelope before author listeners
  run. Editing code (`native-region-editor.ts`) loads only when the parent opens a region session for an editor, never for readers.
- Anything assembly writes inside a `<script>` is escaped as `assembleHtmlPage` does (`<` in JSON, `</script`
  in code). Viewer state stays in this viewer's browser storage; only an explicit local Save reads it
  (`readViewerDocument`).
- Page editing uses only the native engine. `@afbin/regions` remains a small native re-export for old import maps; legacy page sessions are refused before decoding. Keep the cell Y.Text engine and historical storage compatibility. Deploy removal only after zero active and trashed legacy page heads are verified.
- Runtime modules are public code: no page, viewer, cookie or credential is an input to their bytes, so they
  never carry viewer state (`native-html.server.ts`). A retained content-addressed alias serves its exact bytes.
- A page's extra script, frame or connect origins come only from publish-validated `<head>` declarations
  (`<meta name="csp-connect" …>`, `lib/document/csp-extensions.ts`) and reader consent, never another way.
- A read-only (archived) shell relays only reads: SQL reads, no uploads. Raw pages and portable
  copies have no trusted frame, so they never upload.
- Teach new pages `sql` and `@afbin/state`. `apollo/graphql-compat.ts` is the deprecated
  GraphQL client behind module-graph rule 5 (`GRAPHQL_COMPAT`): fix it, never extend it.
- Published pages are live code: never remove or rename a name `@afbin/apollo` or `@afbin/state` exports. A name
  kept only for old pages lives in `legacy-page-names.ts` and is never taught.
- The gzipped budgets in `__tests__/build.test.ts` (core, reader, chrome, regions, collab, state) are never
  raised. New code goes in a lazy module; the reader carries no SQL code.
- A new `@afbin/*` module: its build in `build.server.ts`, its path in `RUNTIME_MODULE_PATHS` (`contract.ts`),
  its import-map entry in the core, a size test; runtime modules reach it by dynamic `import()`, as
  `browser-client.ts` loads `browser-state.ts`, so a page with an older core reaches the skew guard and reloads.
- `/af/host.js` (`lib/html-reader/host-shell`, the parent half of the bridge for a shell on the app's origin) is
  built here but is no `@afbin/*` module: no import-map entry, no skew guard, its own size test.
- The index is imported by browser, archive and fast-lane code: node-only code (esbuild, Babel, Tailwind,
  `node:*`) enters through `server.ts`, which browser-bundled code may not import.

## Checks
- `npm test -- --files services/app/lib/html-runtime/__tests__/build.test.ts services/app/lib/html-runtime/__tests__/built-watch.test.ts services/app/lib/html-runtime/__tests__/assembly.test.ts services/app/lib/html-runtime/__tests__/interface.test.ts services/app/lib/skills/__tests__/retired-phrasing.test.ts`
- `built-watch.test.ts` links the built modules as a page's import map does and runs live-page calls: run it
  after any change to what `@afbin/apollo` or `@afbin/state` export.
