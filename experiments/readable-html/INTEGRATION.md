# Candidate composition verification

The source, Markdown and historical-view modules are tested together, not only through separate illustrative fixtures. `integration-runtime.ts` composes their actual implementations against `integration-contracts.ts`. `integration.mjs` builds this adapter into a portable HTML file and drives all three browser engines with HTTP(S) blocked.

The test first failed because the composed adapter did not exist. After implementation it exposed a real packaging issue: the bundled Markdown entity table contained four literal control characters. Those caused strict HTML canonicalization to reject the embedded runtime. The shared AST-aware build packager now escapes JavaScript string/template data and safely reconstructs sensitive regex literals before embedding, while preserving their values. It also handles HTML comment/script tokens introduced by the CSS parser. Runtime identity uses the final HTML-safe bundle bytes.

Independent review then caught document-level comment capture and a rejected history update leaking into export. The composition now uses the shared complete-document capture helper, rejects history updates before mutation, and restores state on return; the test tries count 99 during history and verifies the reopened file still contains count 7.

Final result: Chromium, Firefox and WebKit all pass this sequence:

1. Capture source and hash with the same codec as Node, before app or component rendering.
2. Hydrate actual Markdown into light DOM; retain root identity and source JSON.
3. Change app state to count 7; export original authoring markup, excluding generated Markdown and live heading changes.
4. Capture the rendered view and open a nonexecuting historical projection; the rendered Markdown remains visible, publication is suspended.
5. Return to own state unchanged.
6. Write the returned export bytes directly to disk, reopen without a repair/materialization step or network, recover count 7 and the original revision.
7. Re-export the same bytes.

This candidate does not replace the product runtime. It closes the cross-module planning uncertainty around ordering, source authority, export and history. Auth/host isolation is separately exercised over HTTPS by the auth harness; repository concurrency/ACLs by the workflow harness. Neither a browser simulation nor an in-memory repository is presented as a deployed database implementation.

```sh
node experiments/readable-html/integration.mjs
./node_modules/.bin/tsc --noEmit --strict --allowJs --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext --allowImportingTsExtensions --lib ES2022,DOM,DOM.Iterable --types node experiments/readable-html/integration-contracts.ts experiments/readable-html/integration-runtime.ts
```
