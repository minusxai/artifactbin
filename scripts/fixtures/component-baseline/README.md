# Component reader catalogue

The `component-baseline` gate (`scripts/gates/gate-component-baseline.mjs`) publishes this catalogue as native HTML through the normal local HTTP API and captures every fixture from its real `/raw` reader. It checks hosted components, interactions, fonts and resources; it makes no visual parity claim. Never publish these fixtures to production.

The static catalogue has **28 fixtures, 65 states and 260 captures**: each state runs at two viewports and in two color modes. It covers component interactions, rich rendering, table behavior, fallback identity and unavailable upload presentation. Mermaid images, Isometric geometry and WebGL2 readiness are actual reader checks. The static FileUpload fixture covers its unavailable face only.

## Run

Gates are SLOW-tier: run once at completion of the brief, never per edit.

```sh
node scripts/gate-container.mjs --servers 1 component-baseline
```

Without input the gate publishes the catalogue to its own disposable server; its source snapshot hash is explicitly not a Git revision. `COMPONENT_BASELINE__INPUT` may name a private JSON manifest of already-published local readers (`implementation`, `sourceRevision`, `output`, `entries: [{fixture, theme, url}]`), mounted read-only, and `COMPONENT_BASELINE__OUTPUT` an absolute directory the evidence is written to; never commit an input, nor credentials or generated test data.

Native publication checks the installed skill ZIP's complete component module closure against a source-bound build receipt; `component-assets.json` preserves the actual module hashes and input proof. Capture evidence includes source revision, browser version, fixture/image hashes, raw behavior, actual used-font bytes, resource failures and assertion results. `capture-status.json` records completion; failed captures retain partial manifests and failure diagnostics.
