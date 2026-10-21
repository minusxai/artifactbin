# Validation record

Phases 1 and 2 were exercised on 16 October 2026.

- `npm run check` passed: TypeScript, bundling, unit/model tests, temporary SQLite/HTTP and real CLI tests, three browser engines, two viewers, first publication from the top bar, and historical network isolation.
- A subsequent cache-compaction edge case was added red-first, fixed, then passed typechecking, the pure unit suite, and the complete CLI publish/edit/context/revoke scenario. The bundled runtime was regenerated.
- Static documents also passed three-engine scroll-context restoration without needing an app store (schema zero). The final pure suite has 16 tests.
- The pure suite uses no browser, server, database or network. It takes approximately 0.7–0.8 seconds including runner startup here; its 1,000 duplicate-delivery transitions take approximately 20–23 ms.
- Browser engines: Playwright Chromium, Firefox and WebKit. Offline checks block HTTP requests while retaining direct file access. Screenshots were inspected at 390px.
- The authoring skill passed its structural validator. A fresh isolated Pi trial with `fireworks/accounts/fireworks/models/deepseek-v4p1-flash` completed in 5 turns (~54 seconds). An independent scorer used the actual Pagegi bundle to check controls, charts, drafts, stable row IDs, deletion, comment snapshots, return, file reopen and mobile layout. It passed on the final bundle. The generated app was not edited to make it pass.

Authoring/scoring candidate hashes (SHA-256):

- runtimeHash: `d1ad1973270be3d2b5d4361f75fe7da483a468e09f7c78337b402399981deee9`
- appHash: `9afa2deb062d1293ffd69322f1774867b67962487f519fdb87e6afa5e9a0d9b0`
- skillHash: `e986b578f92bf22252210d69ef49ecd012e705e4f32bced9f9dbd299c49c26e1`

Reproduce with `npm run check`. Score another generated app with `node test/agent-app.js path/to/app.html`; this uses the bundled runtime and requires the documented sales-review evaluation controls. Runtime screenshots and local scorer receipts are in ignored `test-output/`.

Observed limits: no physical Safari/iPhone testing; no claim of large-scale or multi-server certification. The earlier planning GLM/OpenCode run timed out and is not counted as a pass. Network resources required for historical replay must be embedded. Single-file downloads cannot confirm that the user kept the downloaded file.


Deployment/auth follow-up (16 October 2026): full `npm run check` passed with email-code first publication in Chromium. New pure auth tests observed red then green; HTTP tests cover normalized identity, restart, cooldown, rejected codes, single use and disabled password login. The CLI email request/verify flow also passed against the actual handler. Email delivery is injected in local tests. A subsequent production check completed real email delivery and one-use code verification. HTTPS health and disabled password login passed on the isolated deployed container. Existing host service remained responsive.

The prior Pi-generated app was scored again against the current runtime and passed all four scorer groups. This is a replay of the generated artifact, not a new agent-authoring trial. The skill subsequently changed only its CLI login instructions to email codes.


Repository-owned deployment passed in GitHub Actions (`Check and deploy`, run 38803910554): full Linux checks then restricted-SSH deployment of the checked commit, SQLite backup and container health. The observed chain took 2 minutes 25 seconds including runner setup. The deployed browser smoke passed real email authentication, local-file first publication, comment attribution, immutable saved-view restoration, return, credential-free download and a fresh viewer opening the saved context. This used the normal production auth and collaboration endpoints; no test accounts were injected into production storage. The deployment source and operator procedure live under `deploy/` in this repository.


Postgres migration validation: the repository now uses normalized Postgres tables and per-operation transactions. The full check passed against a real local Postgres 17 instance, including all three browser engines and email/CLI integration. New tests cover concurrent updates, independent-file locking, rollback, immutable context migration, unchanged-row preservation and repeat-import safety. Pure domain tests still require no database. The legacy SQLite references above record the earlier implementation; SQLite is now used only by the one-time read-only importer.
