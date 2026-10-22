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

### Required migration verification

Ordinary fast tests do not need the frozen legacy compiler or a migration database. Release verification must provide both: `PAGEGI_ARCHIVED_COMPILER_ROOT` points to an immutable legacy checkout with its installed dependencies and generated `services/app/public/islands/manifest.json`; `MIGRATION_TEST_DATABASE_URL` points only to disposable PostgreSQL. Migration tests create and drop their own schemas. Keep database credentials in the local environment.

```sh
export PAGEGI_ARCHIVED_COMPILER_ROOT="$FROZEN_LEGACY_ROOT"
export PAGEGI_DATABASE_URL="$DISPOSABLE_TEST_DATABASE_URL"
export MIGRATION_TEST_DATABASE_URL="$DISPOSABLE_TEST_DATABASE_URL"
npm run test:migration-required
# Full release validation with the same inputs activates those migration checks too:
npm run check
```

`test:migration-required` discovers tests marked `// @requires archived-compiler` or `// @requires migration-database`, validates the compiler inputs and database connection before building, and runs those checks without silently skipping absent inputs. Add the corresponding annotation when a test uses either migration environment variable; discovery rejects a missing declaration. This stage does not build container images. Full `check` also builds the backend and SQL images, so coordinate it with other image builders.

The external-network acceptance case remains a separate opt-in. When external test traffic is allowed and matching images are already built, run `PAGEGI_TEST_INTERNET=1 node --import tsx --test test/v2/backends/lambdas.isolate.test.ts`. It is intentionally independent of migration prerequisites.
