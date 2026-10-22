# Offline chart migration

`prepareArchivedChartPlans` runs inside the migration compiler subprocess. It converts static Vega, Vega-Lite and shipped `minusx/` recipe visualizations to Vega dataflow with expression ASTs. Query rows are never embedded in a plan. Templated specifications, unresolved recipes, maps/assets, external resources, ambient event streams and facet layouts require an explicit adapter and stop conversion.

`chartRendererSources` supplies a browser module exporting `charts`, suitable for the kit's `loadChart` port. Its esbuild plugin must precede the general archived resolver. It removes expression compilation and parsing, disables resource loading, and pins the installed archived renderer versions. The resulting HTML contains no JSX parser or visualization grammar compiler. The runtime interpreter receives the precompiled AST and query results through the kit context.

`createCompiledCharts` owns the view, coalesces row/resize updates, reports readiness and failures, and disposes its observer and renderer. Limits: 32 distinct plans per page, 512 KiB per plan/row batch, 10,000 rows per chart, dimensions 80–4096 by 60–4096. Container resizing uses a local ResizeObserver; generated Vega-Lite window resize listeners are removed offline. Chart theme and specification are fixed at conversion time.

Run the real renderer browser proof with `PAGEGI_ARCHIVED_COMPILER_ROOT` pointing at the installed archived compiler. It changes data, checks SVG marks, refuses compiler/parser output, and verifies that the page makes no requests and raises no page errors. Whole-page Apollo/core integration belongs to the local conversion integration test.
