# Readable HTML design validation

These are executable candidate modules and integration harnesses for the architecture reset. They settle the risky design choices before replacing product entrypoints. They are not shipped by the existing build, and passing them does not mean the product has already migrated.

Each directory owns a bounded interface and behavioral evidence:

- `source`: canonical author source, revision hashing, envelope validation, managed boot and offline save/reopen.
- `auth`: document-scoped authorization, HTTPS virtual hosts, frame/popup sign-in and browser isolation.
- `replay`: nonexecuting historical projection and live-session publication boundaries.
- `workflow`: revision-preconditioned source operations and historical collaboration context.
- `acceptance`: authenticated HTTPS source edit, actual old comment context and offline export/reopen.
- `graphql`: atomic local drafts, reactive queries and explicit remote receipts.
- `isolates`: versioned V8 execution, authority/capability boundaries and OS resource probes.
- `connectors`: real PostgreSQL/HTTP resources behind named operations.
- `replication`: explicit durable commands, CAS, reconciliation and crash recovery.
- `composition`: cross-phase database and three-engine client proofs.
- `markdown`: optional pure Markdown rendering, source preservation and on-demand component loading.

The reports distinguish observed results from deployment work. Synthetic users, temporary certificates and fixture servers are for tests only. No real account or deployment credentials are needed. Generated files belong in temporary directories or ignored local dependencies.

The small policies should become modules during Phase 1; the harness adapters should become integration tests. Do not copy the harness servers wholesale into the product or maintain two permanent runtimes. Product migration remains the first implementation phase; GraphQL and backend isolates remain later.

## Run the complete candidate suite

From the repository root, with the root toolchain installed:

```sh
npm ci --prefix experiments/readable-html/source --ignore-scripts
npm ci --prefix experiments/readable-html/markdown --ignore-scripts
npm ci --prefix experiments/readable-html/graphql --ignore-scripts
npm ci --prefix experiments/readable-html/isolates
docker build -t pagegi-isolate-proof:local experiments/readable-html/isolates/container
node experiments/readable-html/check.mjs
npm run check
```

The candidate runner executes explicit typechecks, pure behavior, three-engine browser tests, targeted mutation checks, an active-replay negative control and the composed offline lifecycle. It exits on the first failure. The final command separately verifies the existing shipping implementation.

The HTTPS harness needs `openssl` and the installed Playwright browsers. It uses reserved `.test` names through a local restricted proxy and temporary self-signed certificates, without modifying system DNS or deploying infrastructure.

Later-phase checks need a local PostgreSQL instance through the existing product fixture. Hard sandbox checks need an already running Docker daemon; see the isolate report for pinned image setup and cleanup. No cloud account is required.
