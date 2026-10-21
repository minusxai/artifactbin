# Fast development validation

With dependencies installed (`npm ci`), run these commands while editing:

```sh
npm run validate
npm test
```

`npm run validate` runs the TypeScript checks for the main project and the browser runtime, followed by the architectural policy checker. That checker enforces module boundaries, pure-module effects, app authority separation, cycles, and resolvable imports. `npm run typecheck` remains a compatible entry point to the same checks.

Validation uses the pinned TypeScript compiler and unchanged project options, with separate incremental metadata for each config under `node_modules/.cache/pagegi/typecheck`. Changed source files, imported dependencies, and compiler options are rechecked. CI restores this metadata for the same OS, architecture, Node version, dependency lockfile, configs, and validation runner; validation still runs on every cache hit. Delete that directory to measure a cold check.

This is TypeScript and architectural policy validation. It does not include a general ESLint pass, formatting enforcement, or an unused-dependency checker.

`npm test` runs the pure unit/model tier; `npm run test:unit` is an alias. The runner and unit tests use native Node TypeScript support, available within the existing Node `>=22.18` requirement. These tests need no browser, HTTP server, database, Docker, or network. Prefer typed contracts, failing behavioral tests, and injected clocks for changes to domain behavior.

Use the relevant adapter tier when changing I/O: `npm run test:local`, `npm run test:database`, `npm run test:isolate`, `npm run test:integration`, or `npm run test:browser`. These have their own infrastructure requirements. Every stage includes the v2 acceptance tests under `test/v2/`; `npm run test:v2:<stage>` runs only those. `npm run test:all-node` includes every tier, and `npm run check` is validation followed by it; see the README for prerequisites and the [CI policy](ci-policy.md) for merge and deployment gates.
