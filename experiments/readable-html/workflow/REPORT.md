# Readable source agent workflow candidate

The agent workflow design is now exercised by a concrete, typed semantic repository candidate, using the actual source codec candidate and a temporary HTML file edited on disk. This closes the planning question of whether readable source, separate captured state, atomic revision preconditions and immutable historical context compose. It does not claim the production CLI or database was replaced.

## Decisions

- `pull` returns author-readable HTML plus document/revision metadata and separately owned initial state. Canonical source is an internal representation with empty managed blocks; it is materialized with a neutral state envelope for authoring. A source edit does not reset app state to that neutral projection. Source pushes preserve the repository's separately retained initial state.
- Agents edit ordinary Unicode HTML and visible inert managed JavaScript. They inspect comments/context through separate semantic operations; no rendered DOM scraping, base64 decoding or platform credentials.
- Revision comparison and commit are a single synchronous critical section after asynchronous normalization. Permissions are rechecked after normalization, so a revoked editor cannot finish an outstanding push. Database implementation must translate this exact boundary into a transaction/CAS; an in-memory candidate does not prove database isolation.
- Every source/history/context read checks current document ACL. Public/unlisted readability does not grant mutation. Historical data uses the comment's source revision plus its captured JSON, never today's source or app state.
- Comment retry IDs are document-scoped. Repeating the identical semantic payload is idempotent; changing payload or principal under the same key rejects. Actor attribution is supplied by the authenticated operations boundary; an input `author` field is ignored.
- The source codec owns format/canonicalization. Repository owns ACL, revisions and atomic semantic operations. Bridge lifecycle owns generation/suspension; it does not pretend to authenticate actors. This keeps framework, HTTP, database and DOM policy out of the repository.

## Observed verification

Interfaces were written first. The behavioral suite first failed because the implementation was absent, then passed after implementation. All **13 tests pass** (12 pure operation/lifecycle tests and one actual-codec/disk roundtrip). Five targeted mutants were independently detected: stale overwrite, private-read bypass, current-source historical substitution, duplicate retry overwrite and stale bridge callback. The candidate and both test files pass explicit strict TypeScript checking with the source-owned `codec.d.mts` import contract; root project configuration does not include experiments.

Commands from repository root:

```sh
node --import tsx --test experiments/readable-html/workflow/*.test.ts
node experiments/readable-html/workflow/mutations.mjs
npx tsc --noEmit --strict --target es2022 --module nodenext --moduleResolution nodenext --allowImportingTsExtensions --skipLibCheck experiments/readable-html/workflow/contracts.ts experiments/readable-html/workflow/workflow.ts experiments/readable-html/workflow/workflow.test.ts experiments/readable-html/workflow/codec-integration.test.ts
```

Covered behaviors: pull/inspect/edit/push/stale-push/history; two competing same-revision pushes; all private source projections; public/unlisted read-only behavior; revocation including in-flight normalization; malformed source failure atomicity; missing historical source refusal; stable explicit target identity in the actual-codec roundtrip; retry deduplication and conflict; server-derived attribution; snapshot alias isolation; invalid/cyclic JSON; duplicate create; sharing ownership; replaced/suspended bridge callback refusal; source projection never replacing initial state.

## Boundaries of the evidence

This is a planning candidate, not new product code. It uses an in-memory repository and trusted principal arguments; authentication belongs to the separately tested transport/auth boundary. A production adapter must derive the principal from its verified session/grant, never accept an actor claim from the parent page, request body or app resolver. Fixture principal strings are intentionally inputs to policy tests, not an authentication mechanism. Parent UI placement does not confer authority. It proves one-process atomic operations, not database transactions, crash recovery, multi-process races, after-commit delivery or network transport. The actual-codec test writes/reads a temporary file using ordinary filesystem operations rather than invoking the existing CLI; production wiring remains implementation work, with the candidate's semantic contracts and fixtures available for reuse. Stable IDs are preserved when an agent retains them, and duplicate IDs are rejected by the codec; no algorithm infers identity after an agent deliberately deletes/replaces an ID. Bridge generation tests concern stale callbacks, not origin/message-schema validation (separate boundary). No scope expansion into GraphQL, replication or backend isolates.
