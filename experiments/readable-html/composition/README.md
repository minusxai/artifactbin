# Cross-phase composition proof

These tests compose real candidate modules, not mock replacements. They are planning evidence and are not imported into the shipping product.

- `all-phases.test.ts`: real GraphQL → V8 → host capability → PostgreSQL, plus optimistic GraphQL state → durable commands → reconciliation.
- `client.ts` / `browser.mjs`: bundle GraphQL and replica models for actual Chromium, Firefox and WebKit; verify optimistic rejection, observers, history and disposal without Node globals.
- `contracts.ts` / `client-contracts.ts`: bounded evidence contracts.

Run from the repository root:

```sh
node --import tsx --test experiments/readable-html/composition/all-phases.test.ts
node experiments/readable-html/composition/browser.mjs
```

Requires the root dependencies, the isolated GraphQL/workerd packages, Playwright browsers, and the same local PostgreSQL fixture as the product suite. Temporary schemas and files are removed. The top-level candidate runner includes these commands and explicit typechecks.

The browser proof does not implement a network/IndexedDB replication adapter. The durable model proof uses one owner per file. A post-write resolver error is deliberately asserted as `unknown`, not rollback.
