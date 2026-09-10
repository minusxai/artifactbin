# Model-backed mutations

## Contracts and boundaries

Authors call `llm(modelAlias, prompt, schemaJson, optionsJson?)` inside an explicit stored-dataset
Mutation. The result is a JSON string. Signals provide inputs; ordinary Queries
read saved results. Read queries and local mutations do not run models.

DuckDB stays stateless and network-free. A volatile scalar function either reads
an invocation's supplied result or returns a generation request to the app. The
app validates authorization and configured model aliases, generates and validates
JSON, then replays SQL against the same snapshot. Only completed SQL reaches the
existing dataset compare-and-swap. Identical model/prompt/schema/normalized-options arguments share
one result within an invocation, including storage retries. Conditional SQL can
request a judge only after the narrator's result exists.

Connections come from `GENERATION__MODELS_FILE`, with namespaced `apiKeyEnv` references.
Sampling options belong to calls, not role-specific connections.
The generation adapter uses Pi's model library with explicit server credentials.
It owns provider communication; the executor owns bounds and validated results.
No provider credentials or provider-selected URLs travel through the document or
SQL service. This first slice retains authenticated dataset-editor permissions.
It does not add public-player authority or durable cross-request job resumption.

## Risks, ordered milestones, and evidence

1. **Synchronous UDF / asynchronous provider boundary.** Executable probe
   `node tmp/model-udf-probe.mjs` observed a native UDF request aborting an INSERT
   with zero rows, then replay successfully inserting supplied JSON. No network
   or asynchronous callback is needed inside DuckDB.
2. **Evaluation / validation / retries.** Contract tests must exercise both local
   and HTTP SQL implementations: model requests have no mutated rows, supplied
   results resume execution, SQL CASE skips unnecessary calls, publish validation
   never requests a model, and reads cannot invoke `llm`. The existing mutation
   layer retries CAS up to eight times; generation results must live outside it.
3. **Provider behavior and failures.** Pin Pi 0.85.1, probe its exported API,
   use deterministic provider fixtures for JSON, timeouts, cancellation and usage.
   Invalid output must never persist. Bound calls and concurrent generations.
4. **End-to-end integration.** Exercise real publication/mutation handlers with
   isolated state, permissions, and generated rows. Verify a button-driven flow
   in a disposable running app with a deterministic provider endpoint.
5. **Delivery.** Document author syntax and operator configuration; run full tests,
   validate, production build and affected browser gates; commit/push an empty-body
   PR and inspect CI. Live paid-provider evidence is separate from fixture gates.

## Open assumptions

- SQL replay requires stable generation arguments. Authors supply stable IDs and
  ordered prompt data; volatile prompt expressions can exhaust the call bound.
- A canceled or failed request can already have incurred provider cost. Results
  are reused during one server invocation, not across browser retries/restarts.
- Generation may precede a later SQL error; only persistence is atomic.
- Provider-enforced schemas differ. Artifactbin validates its supported JSON
  schema subset independently before allowing SQL to consume a response.

## Verification observed

- Baseline SQL mutation/contract checks passed (29 tests). New SQL contracts
  failed on missing `llm`, then passed for both local and HTTP implementations.
- Invocation tests failed against the contract stub, then passed for validated
  JSON, retry reuse, timeouts and the call bound. A direct enum/bounds probe
  failed before normalizing enum intersections; nested regression coverage passes.
- Real API handlers passed generation persistence, unauthorized refusal, invalid
  output, concurrent dataset edits and permission revocation during generation.
- All suite projects passed: API 1,358; Node 3,838 (38 skipped); UI 1,296; CLI 25.
  The initial full run found setup example duplication and docs size regressions;
  those were fixed and the affected checks and complete Node project rerun.
  A proxy handshake timing test failed under load and passed on both reruns.
- `npm ci --dry-run` passed. The tracked-source TypeScript check passed. Root
  `npm run validate` encounters an existing unused `fps` in ignored
  `video/src/ui/Grab.tsx`; that unrelated working file was not changed.
- The local Counterfactual lab was exercised in a browser: ordinary/conditional
  judge writes, invalid output without a row, and persisted rows after reload.
- The original 34-node Counterfactual app was then ported as a local artifact
  with a recursive ancestry mutation, full-tree SVG, selected-path rail, and
  a blocking generation overlay. A live Fireworks narrator/judge call returned
  200 and saved a new ending. Its authoring source and small executable probes
  are in task scratch, independent of the platform implementation.

## Gaps exposed by the app

The first slice does not persist invocation status/output/usage independently
of successful dataset writes. Add that before durable job retries or an explicit
`SELECT llm(...)` execution surface. Ordinary reactive Queries must remain free
of paid effects. Other gaps are safe structured author-bridge errors, progress
phases, and an explicit public-player permission model. The current app uses
normal dataset editor access. Viewport-filling managed frames currently need
scoped author CSS, and dev-runner environment changes require a runner restart.

The final production build passed. Focused browser checks cover generation
mutations (including a 21-second provider fixture), author-script isolation,
managed iframe composition, and dataset mutation permissions.


## Connection and per-call settings refactor

Contract: operator JSON file (`GENERATION__MODELS_FILE`) maps connection aliases to
api/baseUrl/model/apiKeyEnv. Namespaced secret references resolve only in app config;
no inline secrets or role-specific generation defaults. Optional fourth llm argument
contains only temperature and maxTokens, bounded and normalized by shared utils.
Normalized options participate in demand keys across local and HTTP SQL. Three-argument
calls retain 0.7 / 4096 defaults. Narrator and judge use one connection.

Risks/checks: DuckDB optional arity via varargs must work on local and HTTP engines;
invalid options must never request a provider; equivalent options must reuse a result;
Pi must forward different settings on a single connection; missing config/secret errors
must not disclose values. Baseline: 4 files / 22 generation tests passed before edits.
Migrate the local artifact and fixture configuration, then run focused tests, full suite,
build, and deterministic generation browser gate. Live provider verification is separate.


Refactor evidence: initial 22 generation tests passed; added local/HTTP options and
connection-file tests failed before implementation. The resulting 46 generation tests
passed, plus 15 config/environment checks. The recursive Counterfactual contract checks
passed (4), and the migrated live Fireworks flow saved one new branch (HTTP 200).
The first live check caught stale SQL cached by the local authoring helper; republishing
with a fresh model module fixed it. The production build and tracked-source TypeScript
check passed; root validation still finds the unrelated ignored video/Grab.tsx unused fps.
Full API run: 1357 passed / 1 edit-history timeout; isolated entire edits file: 28 passed.
Initial browser gates: generation and managed iframe passed; permissions navigation timed
out while full tests ran. Follow-up results are recorded below.

Follow-up browser checks: generation-mutations and mutation-permissions both passed
in isolation (33 seconds total), with only fixture model configuration. Full Node suite:
3862 passed / 38 skipped. Provider credentials were checked against changed files;
none are present. The local model JSON contains only environment-variable references.

Final remaining suites: UI 1296 passed; CLI 25 passed. Final tracked-source TypeScript
passed after all edits. Production build passed. No broad suite was represented as
all-green: the initial full API timeout and its successful isolated rerun are retained above.
