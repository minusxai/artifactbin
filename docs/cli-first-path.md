# CLI implementation and planning evidence

Authoritative product contract: https://artifactbin.dev/@ppsreejith/cVcRIp (10 September 2026; live artifact is authoritative).
Planning base: OSS `6feb7140`; isolated branch `plan/cli-validation`.

## Decision

Implementation awaits user approval of the artifact. Preserve `remote`, HTTP operations and
the shared operation registry; remove MCP and runtime remote-skill dependencies at cutover. The CLI owns filesystem state and orchestration, not a
second publication engine. This planning branch contains probes, not the implemented CLI.

The previous review overstated strict replacement: normal body pushes can use the existing
source/edit_id protocol today. Metadata and restore need different concurrency conditions.

## Reproduced evidence

Run from the OSS root after `npm ci`:

```
npx vitest run --project api services/app/__tests__/edits.test.ts services/app/__tests__/version-conflict.test.ts
node scripts/cli-plan-probe.mjs
npx vitest run --project api services/app/__tests__/cli-plan-probe.test.ts
```

- 31 existing concurrency tests passed: disjoint rebase, overlapping refusal, deletion,
  replacement, revert and expectedVersion behavior.
- Browser-targeted parser/validator/serializer bundle: 18 inputs, 499331 unminified bytes;
  no React, database or node-pty imports. This is the syntax validator, not full publication
  validation: Helmet, dataflow, refs, policy and CSS still need their explicit layers.
- Metadata comments parse but are discarded on AST serialization. Node ids and entities
  survive the probe. Keep the fenced format; do not claim stock JSX compatibility.
- Two publication probes passed: invalid markup invokes a supplied import hook before
  refusal; withholding it prevents that invocation. No real remote import was performed.
  These characterize a gap; change/remove the characterization test when fixing the boundary.

## Inspected boundaries

| Concern | Existing owner | Implementation decision |
| --- | --- | --- |
| Source edits | `lib/artifacts.ts`, `lib/story/splice.ts`, `edit-batch.ts` | Reuse source/edit_id; one derived splice may conservatively conflict across several local regions. |
| Full replacement | `lib/artifact-wire.ts`, `replaceArtifactFor` | Keep expectedVersion; add transactional expected-state protection for metadata. |
| Metadata/governance | `setMetadataFor`, browser metadata route, operation registry | Shared conditional operation for bearer/browser; only changed fields; no new content version for metadata-only changes. |
| Publication | `story/jsx-tier.ts`, `story/input.ts` | Separate read-only preparation from persistence; capabilities must make imports/stores/refresh impossible in preflight. |
| Datasets/files | `datasets/catalog.ts`, `story/file-store.ts` | Current preparation persists bytes/rows. Add ephemeral proposed data; never call these storage paths during dry-run. |
| Query source | `story/dataflow.ts` | Currently accepts bare ids only; normalize ref-prefixed ids at the grammar boundary. |
| Native CLI | `services/cli/src/pty.ts`, `scripts/binary.mjs` | Both eagerly load/extract PTY. Put loading behind remote execution, including the SEA replacement module. |

Paths in the table without a service prefix are under `services/app`.

## Module inventory (milestone order is defined in the artifact)

1. **Server contracts.** Preparation produces validated intent and planned external work;
   apply owns side effects and rechecks authorization/concurrency. An ephemeral resolver
   validates proposed local dependencies without storing them. Extend operation schemas,
   not transport-specific business logic. Durable create recovery reserves the operation
   key and commits its result with the artifact. Compare expected state under the same
   transaction/row lock as metadata or full replacement. Fingerprint canonical content
   revision and mutable fields; ACL changes still undergo live authorization checks.
2. **Local document model.** Separate fence parsing, identity, reference parsing, source
   validation and formatting. Extract any shared React-free vocabulary into its owning
   pure module. Preserve canonical remote base source and observed versions; hashes alone
   cannot compute a base-to-head diff. Explicit null is field-specific, never universal.
3. **Sync engine and command adapters.** Transport, filesystem and clock are injected.
   Planner chooses operations; executor journals immutable request payloads and results;
   CLI adapters only parse arguments/render results. Use a directory advisory lock and
   atomic replacements plus recovery for crashes between separate file writes. Source
   push uses edits; restore/force/mixed metadata changes use conditional replacement.
4. **Dependencies.** Changed composed dependencies create new ids, so failure cannot alter
   a document's existing dependency. Explicit standalone updates remain conditional and
   report consumers. Reuse the small per-operation journal; do not invent a distributed
   transaction. Add an outcome-unknown state for lost transport responses.
5. **Help.** Embed version-pinned docs from the same source used for hosted docs. Local
   validation never opens a connection. Cache refresh belongs to networked commands.
6. **Setup.** Keep supported harness adapters explicit and idempotent. Confirm each
   installation path against that harness's current documentation when adding its adapter;
   test against a fake home. Planning has not validated every harness installation.
7. **Markdown on-ramp.** Specify supported syntax and refusal cases before conversion.
   Materialize JSX once and reject ambiguous repeated markdown publishing. A subset
   converter must preserve code blocks/links and report unsupported constructs.
8. **Distribution.** Document commands must start when native PTY is unavailable. Move
   package initialization and SEA extraction behind remote; guard optional preparation.
   Test fresh npm installation without native build tooling on supported targets and
   verify SEA binaries on native OS/architecture CI. Planning packaging probes now pass all four targets; repeat on signed release artifacts before cutover.
9. **Agent comparison.** Use existing `evals/lib/harness` and the rules in `docs/evals.md`.
   The full workflow tasks in the artifact, identical underlying modules and help. Require no lower
   completion and zero destructive mistakes; report each task, retries and uncertainty.
   Command-selection smoke attempts are recorded below; they do not count as end-to-end evidence.
10. **Cutover.** After parity and agent gates pass, remove MCP routes and remote-skill runtime
    dependencies. Keep local installed skills, CLI help/man pages and bundle downloads. Land OSS changes
    before advancing the production pin, then walk composed login/publish/read/revoke.

## Failure cases that must be red before implementation

- Preflight with invalid markup, external image/font, stored dataset, raw file and proposed
  dependency produces no object-store, refresh, artifact/version, journal or event writes.
- Two creates sharing a key, a lost reply, locally edited payload, expired replay and a
  deleted recovered result never create twice or replay newer local contents accidentally.
- Metadata racing metadata, body racing metadata, and a third writer during force never
  silently overwrite the unexpected state. Ordinary editors can resend pulled content
  without gaining governance rights or requesting unnecessary governance changes.
- Dirty pull, historical restore, local edits while push is in flight, duplicate identities,
  a filename ending in @digits, symlink escape and crash between file/lock writes recover
  according to the contract.
- A failed composed publication does not alter existing dependencies. New unused artifacts
  are reported and recoverable rather than silently deleted or duplicated.

## Limits of the planning evidence

There is no claim that dry-run, durable idempotency, metadata CAS, new commands, native
distribution changes or the agent gate are already implemented. The probes remove uncertain
architectural assumptions and expose the required work. Full type/build/test checks and the
running user-flow walk belong to each implementation slice. No production deployment changed.


## Risk-first proposal update

The artifact now starts with architecture/delivery risk closure and agent/grammar risk closure.
Auth, migration, native packaging, update interruption, publication side effects, retry/CAS and
agent recovery must be attempted before broad feature work; later milestones integrate and
repeat the checks. No production implementation has been authorized yet.

Additional executed checks:

```
node --import tsx --test services/cli/test/config.test.ts services/cli/test/auth.test.ts
node --import tsx --test services/cli/test/planning-onboarding.test.ts
npx vitest run --project node services/proxy/__tests__/oauth.test.ts
```

Seven existing CLI checks, two onboarding characterization probes and eight OAuth checks passed.
The new probes demonstrate that the current loader ignores ~/.artifactbin/.env and that auth
adds an eager request; they expose required changes, not implemented migration/local-first behavior.
OAuth covers MCP-audience PKCE, not the proposed CLI HTTP pairing flow. Existing release targets
are Darwin/Linux arm64/x64; Windows is not silently added to the support promise.

The tools-disabled familiarity script is `scripts/cli-familiarity-probe.py`. It uses disposable
working directories and denies agent tools. Pi reports no available authenticated models.
Both OpenCode attempts timed out after 90 seconds each, including an explicit
opencode/big-pickle retry. No commands were available to score. Neither installed harness availability nor a text response is an executable
CLI familiarity pass. Live prototype/binary trials still require isolated eval-harness legs.

Skill discovery references checked:
- https://code.claude.com/docs/en/skills
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md
- https://opencode.ai/docs/skills/

Shared discovery means an unchecked harness can still discover a skill installed for another.
Consent covers installer writes; do not promise discovery isolation. Installed-version fake-home
checks, including Codex, remain early gates.

The shared command schema, diagnostic catalog and examples generate -h/--help, local topic help,
man pages and installed skill references. Errors carry stable codes and safe next commands;
validate the examples as executable fixtures. Local teaching surfaces never fetch documentation.
Advanced `afbin api` covers long-tail HTTP operations so removing MCP loses no capability while
keeping the common command grammar small. The complete operation mapping is an early audit.


## Fireworks follow-up

The user supplied an authorized credential source after the initial blocked trials. Both pi and
OpenCode completed original/revised command-selection studies using the same versioned Fireworks
model. See `docs/cli-familiarity-study.md` for observed mistakes, corrections, timing/token evidence
and limitations. The original credential/model failures above are historical, not the current blocker.
The executable follow-up below supersedes this earlier status. The full release-binary gate remains an implementation acceptance check.


## Executable follow-up (10 September)

The next planning pass completed the previously deferred probes. Reproduction and limitations:
`scripts/probes/README.md`; complete HTTP inventory: `docs/cli-operation-parity.md`.

- Real composed-stack browser login/approval, PKCE loopback token delivery, private credential
  file, HTTP create/read, refresh rotation, browser revocation and refused write/refresh all passed.
  OAuth already works for HTTP; retain/generalize it when removing MCP.
- Standalone binaries passed offline help with PTY extraction impossible and real PTY round trips
  on Darwin arm64, Darwin x64 under Rosetta, and Linux arm64/x64 containers.
- Current required node-pty installation fails without Python/compiler. A package prototype with
  optional node-pty and lazy remote loading installs and runs help in a slim Linux image without
  native tooling. This changes the packaging implementation, not the supported target list.
- 17 standalone checks pass: journal crash recovery/migration/permissions/checksum/local-edit/
  symlink refusal (7), PGlite create ledger/recovery/metadata races (4), pairing state (2), fence
  separation and round trips (2), selected-skill installation/update/opt-outs/backups (1), command-specific option refusal (1).
- Two real preparation-boundary tests pass without durable store writes or fetch. Raw dataset
  arrays bypass prepareDataset, so the extraction must cover storeDatasetRows too. File/image/PDF
  capability adapters and exhaustive format checks remain required during integration.
- Ten runs each of offline executable help/validate/status/diff with no credential and a dead
  server origin created no state. Median startup was approximately 97/133/112/100ms under load.
- Full repository suite passed: API 1358, Node 3872 (one skipped), UI 1338, CLI 27; 6595 passed.
  `npm run validate` and `npm run build` passed. No product source or deployment was changed.

The executable agent study found actual integration defects before implementation: duplicate
tracking from temporary pulls, incomplete replacement-response handling, fixed /tmp backup
contamination, and a semantic conflict merge that concatenated contradictory values. The corrected
prototype enforces one artifact per working path, uses submitted bytes when markup_changed=false,
provides nonmutating remote diff, and teaches a concrete base/local/head merge and unique backups.
The final proposed-grammar trial passed all four checks in both harnesses: pi 45.21s, OpenCode
64.19s. Each used the locally discovered skill and one help lookup; each made exactly three writes.
They also made optional read requests (15 total HTTP calls for pi, 11 for OpenCode), so this is
evidence of zero-overhead local operations, not proof that agents minimize total workflow requests.
See `docs/cli-familiarity-study.md` for the matched comparison and failed/interrupted attempts.

Additional implementation requirements exposed by the operation audit: bearer creation of new
annotation threads, cursor pagination, source/edit_id in the generated input schema, binary api
output, and no auth refresh/onboarding side effects during dry-run. All 15 existing MCP operations
have HTTP routes; route presence is not a substitute for executing every final CLI mapping.

This is planning evidence. Product schema integration, complete file-format support, integrated
headless approval, every supported harness adapter, signed/released update artifacts, all 15
operation adapters and repeated multi-model regression are acceptance work in the implementation
sequence. They are not silently reported as complete by the prototypes.
