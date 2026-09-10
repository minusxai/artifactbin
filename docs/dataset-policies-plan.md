# Dataset write policies

## Contracts and boundaries

Artifact access and the readwrite flag establish reachability and write authority.
An owner-controlled public declared-mutation grant extends authority to visitors;
Hasura-compatible table permissions narrow that authority, including editors.
No policy preserves legacy behavior. Policy roles are server-selected: editor or visitor.

Shared contracts own the versioned metadata and SQL execution policy. Shared pure
utilities validate Hasura permission syntax and compile bounded typed predicates.
The app dataset policy module owns administration, authority, revision fencing,
and paid-generation grants. SQL owns bound-plan analysis and atomic pre/post checks.
Settings consume the same canonical parser and capability decisions.

## Risk order and evidence

1. Probe native DuckDB analysis, function resolution and changed-row capture.
   Observed: json_serialize_sql only accepts SELECT; json_serialize_plan supports
   INSERT/UPDATE/DELETE and reports bound target columns, expanded expressions and
   function names, including parameterized statements. Do not use SQL regexes as
   an authorization boundary. Unsupported constructs must be rejected explicitly.
2. Establish baseline, then failing Hasura DSL and SQL enforcement tests.
   Initial baseline could not load the PR's pi-ai dependency; repairing with npm ci.
3. Persist policy/revision, close alternate write paths, fence commits and provider calls.
4. Add public grants, settings and per-mutation live capabilities.
5. Validate full suites, production build, browser flows and PR CI.

Read permissions, remote PostgreSQL writes, relationship predicates, raw policy SQL
and full Hasura metadata APIs remain out of scope. Generation must use operator
connections and enforce a reserved usage allowance; no paid live probe by default.

Reference: https://hasura.io/docs/2.0/api-reference/metadata-api/permission/

## Implementation evidence

The existing stored-mutation and SQL mutation baseline passed (27 tests).
The initial compatibility suite failed because the parser did not exist, then
all 8 compatibility tests passed. All 14 local/HTTP policy behavior tests failed
against the old engine. Native plan analysis plus staged candidates made all 14
pass, including bound columns, presets, mixed-batch checks, filtered updates and
resolved nested function denial. The anonymous API first returned 403 despite
an explicit grant; after integration, public inserts and revocation tests pass.
The generation allowance test first observed an unauthorized provider dispatch;
a pre-dispatch reservation boundary now rejects it without any provider call.

DuckDB JSON AST positions include uint64 sentinels outside JavaScript's integer
range. Positions are nonsemantic and normalized before deserialization. The
supported envelope is INSERT VALUES/SELECT (including source CTEs), ordinary
UPDATE SET/WHERE and DELETE WHERE, with quoted names and aliases. Policy mode
rejects RETURNING, upsert/conflict handling, CTE-prefixed writes and UPDATE FROM.
Predicates are separate native AST nodes. Proposed rows are staged in a typed
table; trusted presets and SQL three-valued post-checks run before applying the
whole result. There is no fallback to ungoverned execution on analysis failure.

Generation dispatches require an operator-configured per-dataset daily call pool
and token ceiling, plus the owner's model grant and cumulative call allowance.
These are enforceable call/token bounds, not a dollar cap. Failed dispatched
calls remain charged. The existing invocation cache handles dataset CAS retries;
a fresh HTTP mutation is a fresh request and may charge again. No live paid
provider was used for validation.

Further regression tests observed and fixed: editor-to-visitor demotion during
commit; function names lowered by DuckDB (COALESCE); mixed-case insert column
references; managed-script capability delivery and tombstone removal. The managed
generation browser fixture now waits for permission readiness before invoking
its declared mutation. Public controls also receive grant revocation live.

Validation: API 174 files / 1,367 tests; Node 370 files / 3,949 passed and one
existing skipped test; UI 177 files / 1,341 tests; CLI 25 tests. Type checks and
production build passed. The full-suite Node run intentionally overlapped the
mixed-case regression's red phase; the subsequent complete Node run passed.
Browser validation uses deterministic generation fixtures, with no paid calls.
