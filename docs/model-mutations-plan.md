# Model-backed mutations

## Contracts and boundaries

Authors call `llm(text, system, configJson)` inside an explicit stored-dataset
Mutation. Config contains a model connection name, JSON output schema and optional
temperature/maxTokens. User input and system instructions remain separate messages.
The result is a validated JSON string. Signals provide inputs; Queries read saved rows.

`GENERATION__MODELS` holds operator-owned connection JSON directly in the environment.
One entry per model, not per role: narrator and judge share `default`, with different
system instructions and sampling options. `apiKeyEnv` names an audited namespaced
environment variable; endpoints and credentials never enter author markup or SQL.
There is no separate model configuration file.

DuckDB remains network-free. A volatile scalar function emits a demand or reads a
supplied result; the app validates the schema, calls Pi, validates output and replays
SQL. Only completed SQL reaches dataset compare-and-swap. Normalized sampling options,
text, system, model and schema participate in per-invocation keys across CAS retries.
SQL CASE controls conditional judging. Local and HTTP service contracts are identical.

Shared utils own config/options normalization; app config owns secret lookup; the
executor owns call/deadline/output bounds; Pi owns transport. Routes translate results.
Text/system together are limited to 64 KB, call config to 10 KB, schema to 8 KB,
output to 64 KB, four calls per mutation, 180 seconds and four active provider calls.
No durable invocation log, public-player authority, tools or provider retries are added.

## Validation and risks

Use real DuckDB locally and over HTTP to verify demand/replay, caching, conditional
calls, publish-time zero-spend validation and rejection of effects in reactive reads.
Verify system instructions and per-call sampling reach the provider separately.
Reject unknown options, inline credentials, malformed config and unset key references
without exposing supplied values. Test permissions and dataset CAS behavior through
real handlers with isolated state; provider fixtures own deterministic gate runs.

Baseline before revised API: 46 focused generation tests passed; new signature and
system-message tests failed before implementation, then all 48 generation tests passed.
The previous full API run had 1357 passes and one unrelated edit-history timeout;
that entire file passed in isolation (28). Node 3862, UI 1296 and CLI 25 passed.
Production build, tracked-source TypeScript and generation/iframe/permissions gates
passed. Root validation has an unrelated ignored video/Grab.tsx unused fps variable.
The previous live Fireworks migration saved a branch after correcting the local
publisher's stale module cache. Revised API validation is recorded below.

Revised API: 48 focused generation tests and all 4 recursive Counterfactual probes
passed, including separate system instructions and selected-branch-only history.
Production build, tracked-source TypeScript, generation-mutations and mutation-permissions
browser gates passed. The migrated live Fireworks app generated and judged a 10/10
ending and saved it successfully.

The revised full run passed all 1358 API tests. Node passed 3863 tests with 38
skipped and one Markdown parsing timing failure; that entire file passed in
isolation (25 tests). CLI passed all 25 tests; UI passed all 1296 tests.
The local artifact also shows success/failure ending dialogs; browser checks
verified both outcomes, button dismissal and Escape without paid provider calls.
