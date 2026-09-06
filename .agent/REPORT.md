# Dataset catalog migration report

## Design

`services/app/lib/datasets/migrate.ts` is the deep module. Its pure surface plans legacy dataset metadata and JSX/SQL source rewrites; its database surface applies a bounded artifact plus every retained version atomically after locking and rechecking the whole live head. The admin route and CLI only validate/transport inputs and render diagnostics.

The SQL rewrite is lexical and span-based. It edits only unquoted `ref_<id>` identifier tokens inside parsed Query/Mutation expression spans, skips SQL strings, quoted identifiers, line comments, nested block comments and dollar-quoted strings, and preserves all other source bytes. Unsupported/unterminated constructs are diagnostics and cause no write.

## RED evidence

Before implementation:

`npx vitest run --config ../../vitest.config.ts --project=node lib/datasets/__tests__/migrate.test.ts`

Result: 1 failed suite, 0 tests; `Cannot find module '../migrate'`.

## Verification

- `npm ci`: clean, 552 packages added.
- `npm run validate -w services/app`: PASS.
- focused API: 2 files, 7 tests PASS.
- focused pure/CLI/compatibility: 3 files, 9 tests PASS.
- `git diff --check`: PASS.
- Full suite was started, then stopped at the orchestrator's request to avoid cross-agent CPU/RAM contention. Before interruption it exposed one existing timing failure in `services/app/__tests__/edits.test.ts`; the process was interrupted with exit 130. The orchestrator owns the post-integration full suite.

## Scope and limits

- No schema or generated-route edit; canonical state is detected from `meta.catalog` and declaration `source=`.
- Dataset object bytes are not copied. Legacy `objectKey`, `columns`, and `rowCount` remain alongside the catalog for the later compatibility-removal phase.
- Live heads and retained versions migrate transactionally per artifact without version/edit history changes. A concurrent source/meta/edit-id change is reported as `concurrent_change`.
- Multi-source queries receive deterministic upstream `source_<id>` Queries; dependent SQL keeps its original aliases. Mutations with multiple legacy sources are refused.
- Dry-run is the CLI and HTTP default. No production command or write was run.

## Commit

`9b860c3` (`Add explicit dataset catalog migration`) and `e256c42` (`Harden dataset migration planning`).

## Review follow-up

Added RED tests proving three gaps: single-ref queries with local table dependencies were incorrectly converted into remote source queries; escaped/tagged SQL and quoted relation identifiers were incomplete; and the executor had no transformed-source validation hook. The RED runs were 2/6 failures in the pure suite and 1/5 failures in the API suite.

The planner now federates any legacy Query that also reads a local Query/table Value, reserves all Value/Query/Mutation names, preserves E-strings and tagged dollar strings, and rewrites quoted legacy identifiers. Apply validates transformed current and historical markup through an injected callback before writes; the admin route supplies `checkDocumentData` with the document owner's ref loader. Historical validation failures report their version and leave head/history untouched. Body node ids and authored bytes remain unchanged; inserting declarations inside Helmet does not change body-relative node paths.

Follow-up verification: TypeScript PASS; focused pure/CLI 2 files, 8 tests PASS; focused API/admin 2 files, 8 tests PASS.

Second review follow-up: added RED coverage for a canonical head with legacy retained history, a harmless leading SQL literal before later migration work, and omitted `dryRun` at the library boundary (3/8 API tests failed). Candidate discovery now includes retained versions, only actual planned changes consume the bounded batch, false positives cannot starve later ids, history uses each version's own format, and the executor defaults to dry-run. TypeScript PASS; focused API/admin 2 files, 11 tests PASS.

===CONCISE===
Implemented a dry-run-first, retryable catalog migration with dependency-safe federation, quote-aware SQL rewrites, transformed-source preflight, retained-history transactions, concurrency refusal, admin route, CLI, and focused passing tests. No production writes. Full suite deferred to orchestrator by explicit request.

## PostgreSQL access review follow-up

Added route-level refusal for PostgreSQL `readwrite` sharing updates before the sharing transaction begins, preventing visibility or share changes from being partially applied. Sharing GET/PUT state now reports authoritative `datasetKind`. Catalog-backed flat stored datasets retain the legacy raw row-array response; multi-table and PostgreSQL datasets expose their catalog.

The RED API run had 3 tests with 2 failures: a combined PostgreSQL sharing patch returned 200 and applied other fields, and flat raw returned a catalog envelope. The connection-claim test passed while RED, confirming account ownership follows a claimed token and remains unavailable to a different account.

Focused verification: 6 API files, 58 tests PASS, covering the new regressions plus dataset access, URLs, data tiers, mutation routes, and mutation permission revocation. TypeScript validation and `git diff --check` PASS. Full suite was intentionally left to the orchestrator.
