# CLI completion work

The [command table](cli-full-spec.md) is the implementation contract. This record tracks module boundaries,
risk-first validation and observed results; a parser accepting a flag is not feature completion.

## Boundaries

- Contracts own resource kinds, input schemas, reference parsing and enum normalization.
- CLI authentication owns browser approval, credential refresh, bounded waiting and resume;
  terminal interactivity controls prompts only. Local operations bypass this boundary.
- Shared editing primitives own node-scoped changes and rebasing. Pull reconciles locally;
  push uses the same rules and the server authorizes and conditionally commits.
- Domain services own resource state, sharing, policy revisions and atomic writes. HTTP routes
  translate their results; CLI users never supply endpoints or request methods.
- Local engines own previews, exports and supported SQL reads. Remote execution retains policy,
  credentials and model generation on the owning server where required.
- A durable operation coordinator owns unknown outcomes, retries and recovery across mutation
  kinds, including generation; a transport timeout cannot authorize a second billable execution.
- Teaching is generated from the same command/schema definitions used by parsing and validation.
  Release assembly publishes compatible binaries, skills and plugins without MCP or raw API teaching.

## Work order and evidence

1. Authentication and shared identity/argument contracts: first-use agent invocation, browser approval,
   resumption, denial/expiry, concurrent setup, no-network local work, case-sensitive identities.
2. Node-scoped pull/push and atomic content/governance: unrelated edits, overlaps, policy revision
   races, permission loss, local changes made during an in-flight response.
3. Typed YAML resource coverage and durable mutations: invitations, policies, account state,
   comments, restore/delete, datasets and long-running generation recovery.
4. Native query, fork, export, preview and remaining read surfaces; local engines and clear capability errors.
5. Generated guidance, retired surface removal, plugin release integration and agent familiarity checks.
6. Full tests, build, browser gates, native binary checks and single review PR with an empty body.

Baseline: OSS c99cd6e4. Dependency installation succeeded in an isolated worktree.
Implementation and validation remain in progress; no completion claim is implied by this record.

## Foundation checkpoint (in progress)

- Automatic auth, shared node reconciliation, force backups and mixed pushes have focused red/green evidence.
- Shared governance snapshots and sharing revisions make content + invitation edits atomic. Policy YAML is still pending.
- API reads now honor viewer access without leaking invitations, policies or connected dataset definitions.
- Local CSV/JSON SQL runs through the existing guarded engine. The macOS ARM64 SEA carries DuckDB's native package and shared library, loaded only for SQL; help remains usable without writable temporary storage.
- Direct dataset mutations reserve a durable identity before generation and save the result in the content transaction. Unknown interrupted work never expires into permission to execute twice. CLI recovery freezes inputs and preserves pending state when transport fails; confirmed refusals have explicit server receipts.
- API suite: 1,438 passed. CLI suite: 120 passed. Production/CLI builds passed. Node suite: 3,856 passed, 1 skipped after updating the CI dependency edge and table inventory. UI suite: 1,383 passed on rerun; one timing-sensitive runtime test failed under concurrent load and passed both in isolation and in the full UI rerun.
- Standalone macOS ARM64 release checks passed: offline local commands, bound SQL, no network/state for ordinary local checks, checksums and PTY outside checkout.
- Neo caught a blank production login: importing the reference parser through the server utils barrel pulled Hono's Node runtime into the browser. A pure package entry point fixes it; production login now works.
- A fresh binary push with no saved home credentials and no TTY printed approval (--no-browser), completed local email login and explicit approval, installed skills into the isolated home, saved credentials at 0600 and resumed the same push. The published page rendered in Neo; the next unchanged push skipped normally.

Open risks before completing later phases: persistent conflict resolution; dependency reconciliation and local edits during an in-flight response; atomic policy/YAML governance; declared mutation receipts and remaining resource mutation kinds; full command/flag coverage and raw API retirement; local renderer/export packaging; Linux/x64 release checks; generated skills/plugins and requested multi-model harness validation. No final PR has been created.

## Recovery and resource checkpoint (in progress)

- First foundation commit 253c6746 is pushed on the implementation branch; no final PR yet.
- Persistent conflict records now block ordinary publication, preserve both proposals and archive explicit resolutions. Dry runs leave no conflict state.
- In-flight local edits reconcile with remote nodes instead of discarding them. First-create node stamping has a guarded normalization path; arbitrary remote changes still require reconciliation.
- Dependency-bearing mixed pushes reconcile before preflight/upload and again against the final head from immutable local changes. A focused test changes the remote head during upload.
- Sharing list updates preserve retained account-bound grants, including after an email change. Policy saves now conditionally verify the content and sharing revision used during validation. Both fixes have observed failing-then-passing tests.
- Typed YAML parsing/validation is shared with JSX metadata and the existing dataset policy parser. CSV/JSON and asset bytes remain separate local source files. Initial dataset YAML push tracks its source bytes under one resource identity and detects source changes offline. In-flight YAML edits now reconcile fields against the confirmed response; policy publication remains incomplete and refuses before content/settings changes.
- Full suite after recovery changes: API 1,440 passing; Node 3,856 passing/1 skipped; UI 1,383 passing; CLI 129 passing. Subsequent resource checks: CLI 131 passing, type checks and CLI build pass; real-handler YAML publication followed by a SQL mutation passes. Root production build passed. Broader resource/release work remains incomplete.

## Pull and native source checkpoint (in progress)

- Recovery/YAML foundations are committed and pushed as 67871468.
- Pull now accepts multiple refs and --output; the positional destination is retired. Bundled command help and skill examples are regenerated. Stdout output remains pending.
- --format yaml retrieves authorized sharing/access/policy metadata and a separate native source file under one tracked identity. Unchanged immutable content is reused locally; local metadata and source edits survive an unchanged remote head. Forced source replacement saves recoverable bytes.
- The real-handler publication → SQL mutation → pull test detected JSON being written into a CSV source; shared CSV encoding fixes the round trip. Focused integration tests pass.
- Remaining YAML gaps include policy publication, connected/multi-table dataset definitions, remote field reconciliation before push, source diffs, representation conversion and complete type/format validation. Other command/resource/release phases remain open.


## Native resource workflows (in progress)

- Metadata, invitations, dataset access and policy changes now commit together. Policy validation uses the locked current dataset; policy audit failure rolls back all changes. Content plus a policy delta is explicitly refused before preparation or uploads. CLI YAML policy publication recovers a lost reply without another policy revision.
- YAML settings reconcile against remote changes before conditional publication. Tracked native source bytes retain their own content version, including when metadata acknowledgement observes a newer remote dataset. Local source diffs and queries read the actual CSV/JSON file.
- Native remote query reads use shared dataset SQL and document dataflow. They bound pages, bind scalar parameters, reject stale cursors and recheck access. Local declared document queries share the server evaluator through an injected local engine; defaults, exact parameter names/types and source fingerprints stay local.
- Comment --input, --thread and --state replace the old flags without aliases. Create/reply receipts commit with the annotation transaction; the real CLI test loses both responses and recovers one thread with one reply. A generic frozen-operation coordinator is available for the remaining mutation families.
- Multi-target comment and history commands preserve per-target outcomes and return failure when any target fails. Query/list output supports JSON, YAML, CSV and table representations, private exclusive output files and separate JSON result envelopes.
- Artifact discovery includes owned and explicitly shared viewer resources, without exposing unrelated public/unlisted resources. Type, search, relationship, visibility and folder filters apply before paging. Comment listing filters state and exact author identity. Filtered cursors bind their target/account/query.
- Consolidated verification passes: API 1,446; Node 3,856 with one skip; UI 1,383; CLI 138. Type checks and CLI build pass. The production build passed earlier in the block and is being repeated at the final checkpoint. Browser gates and distribution verification remain for final integration.

Remaining work is substantial: profile/token/connection/session YAML and account views; all remaining collection kinds/filters; declared mutations; generalized delete/restore/refresh/session/token recovery; remote/draft and multi-source query edges; pull stdout/conversion and connected dataset definitions; fork/export/open/local rendering; the complete type/flag surface; retirement of raw API and remaining aliases; distribution/plugin updates; multi-platform binaries, browser gates and requested harness validation. No final PR has been created, merged or deployed.

## Execution checkpoint — 2026-09-11

The remaining scope is frozen to the command table in cli-full-spec.md. Earlier row audits are historical where superseded by this checkpoint; accepting a flag does not count as completing its behavior. No percentage estimate is used until every row has been re-audited.

| Workstream | Current evidence | Remaining delivery and acceptance |
| --- | --- | --- |
| Resource and account workflows | Policy/query/comment/discovery checkpoint passed the full suite. Profile YAML, CAS and lost-response recovery passed focused checks only. | Complete profile/token/connection/session resources, collection views, mixed batches and durable mutations. Verify permissions, atomicity, conflict preservation and retry without duplicate effects against real handlers. |
| Commands and local execution | Shared node merging, offline checks and local SQL exist; command coverage is partial. | Finish fork/export/open, query and pull edges, consistent type/format/output/batch behavior. Remove api and legacy aliases. Verify every command-table row, including offline defaults and actionable errors. |
| Distribution and teaching | Standalone installer exists at /chat/install.sh; homepage, llms.txt and plugin guidance still contain stale npm instructions. | Unify binary bootstrap, update skills/plugins/help/man/errors and release wiring. Verify clean install/update, available platform binaries, and OpenCode GLM-5p3-flash / pi DeepSeek familiarity. |
| Integration (primary agent) | No final PR or deployment. | Review and integrate all workstreams into one feature branch; run the full suite/build and browser gates once the batch is integrated, fix failures, and open one OSS PR with an empty body. Production pin advances only after OSS merge. |

Execution: use independently owned worktrees for parallel implementation; no two implementers edit the same checkout. Shared contracts, dispatch integration and final verification have one owner. Seed bounded briefs and behavioral checks before delegation. Run focused risk checks during implementation and broad checks at integration boundaries, rather than repeating them after each small edit. Do not expand scope beyond this table without identifying the unmet requirement.

The primary checkout is `services/artifactbin` inside the production repository, on `feat/cli-full-surface`. The former `artifactbin-cli-full` worktree is retained detached as a checkpoint. Production main and its committed submodule pin remain unchanged; the local submodule checkout intentionally shows the feature work for review.


Profile checkpoint: account schema/domain/route, typed local tracking and generic operation finalization are committed as in-progress work. Focused API and CLI recovery checks and type checks passed before this checkpoint; the full suite has not been rerun for these account changes. Mixed artifact/account workspaces, token implementation and broader account integration remain open.
