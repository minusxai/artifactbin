# afbin CLI implementation contract and handoff

Revision 2.1, 2026-09-11. The command table and its normative footnotes define the required final behavior. Revision 2 adds a verified baseline, resolves every design choice the first revision left to the primary, seeds the parser and failing tests, and assigns four bounded workstreams. Nothing in this document claims evidence that was not observed; each "Observed" line names the command that produced it.

## Receiving-agent instructions

This file is the handoff; no conversation history or extra planning document is required. Follow the repository `AGENTS.md` for working rules and `docs/agent-workflows.md` for the worktree and report procedure. Preserve the minimal command surface; do not add command families, raw HTTP escape hatches, compatibility aliases, or remote skill/MCP dependencies. Backward compatibility is not required: the product is pre-production, so retired surfaces are deleted rather than aliased, and parallel schemas are consolidated rather than bridged.

**Repository and baseline.** Product work is in the OSS submodule checkout at `services/artifactbin` inside the production repository, branch `feat/cli-full-surface`. The production wrapper is its parent repository; its committed submodule pin does not move until the OSS PR merges. Start with `git status --short --branch` and `git log -12 --oneline`. Do not reset to the historical main baseline.

**Delivery.** Each implementer completes one workstream brief in its own worktree and reports in `.agent/REPORT.md`. The primary integrates reviewed commits into `feat/cli-full-surface`, runs the full suite, build and browser gates, and opens one OSS PR with an empty body for the user. Nobody merges that PR, advances the production pin, or publishes plugins before review.

**Authority.** The primary owns shared contracts, the parser, dispatch, generated teaching, the seeded tests, integration, evals and the PR. Implementers own exactly the files their brief lists; a needed change elsewhere is a contract request in the report, not an edit.

### Existing code to extend

| Boundary | Starting points (repository-relative) |
| --- | --- |
| Command vocabulary and execution | `services/cli/src/commands.ts` (parser, `COMMAND_TYPES`, `FORMATS`), `arguments.ts`, `dispatch.ts` (`runCli(argv, CliContext)`, `pendingIntegration`). The parser accepts the whole table; `pendingIntegration` refuses rows that are not implemented yet and each owner deletes its own entries. |
| Local/account workflows | `workspace.ts` (`afbin.lock`), `account-workspace.ts` (`.artifactbin/accounts.json`, profile today), `resource-file.ts`, `resource-pull.ts`, `pull.ts`, `sync.ts`. Account resources and artifact resources are two tracking systems; typed kinds join one of them. |
| Safe edits and recovery | `reconcile.ts`, `conflict-state.ts`, `journal.ts`, `recoverable-operation.ts` (the only sanctioned client journal for native mutations), `pending-request.ts` (push). `mutation-command.ts` still carries a separate v1 journal schema on the same file; workstream C consolidates it onto `recoverableOperation`. |
| Native queries | CLI `local-query.ts`, `local-document-query.ts`, `remote-query.ts`, `mutation-command.ts`; app `lib/resource-query.ts`; shared `lib/datasets/sql`, `lib/sql/dataflow-core`. Cursors are base64url of `{fingerprint, offset}` in every engine. |
| Account and resource contracts | `services/contracts/src/account-resource.ts` (profile, session), `resource-file.ts` (`forked_from` added), `services/utils/src/account-resource.ts`, app `lib/account-profile.ts`, `lib/tokens.ts`, `lib/relations.ts`, `lib/remote/registry.ts`, `lib/trash.ts`, `lib/workspace.ts`, `lib/feed.ts`. |
| Server operations | `services/app/lib/operations/registry.ts` (`OPERATIONS`), `lib/operations/http.ts` (`runOperation`, idempotency allowlist), `lib/mutation-receipt.ts`. New operations register through `lib/operations/account.ts` and `lib/operations/sessions.ts` so workstreams never edit the same file. Routes are generated: run `npm run generate:routes` after adding a route file. |
| Rendering and export | `lib/export.ts` (Playwright images of the current head, `?slide=N`), `/a/<id>/raw` (standalone HTML page), `lib/datasets/definition.ts` (`<Dataset>` markup codec for connected and multi-table datasets). |
| Behavioral seeds | `services/cli/test/seed-resources.test.ts` (A), `seed-commands.test.ts` (B), `seed-query.test.ts` (C), `seed-distribution.test.ts` (D), `seed-primary.test.ts` (primary). Every seed is a `todo` test that fails today for the behavioral reason it guards; the owner removes the todo option, never the assertion. App-side real-handler templates: `services/app/__tests__/cli-mutation-recovery.test.ts`, `cli-account-resources.test.ts`, `cli-sync-integration.test.ts`. |
| Distribution | `services/app/public/chat/install.sh` (CLI installer, checksum verified), `components/GetStarted.tsx`, `app/llms.txt/route.ts`, `lib/plugin-package.ts`, `lib/plugin-id.ts` (production and OSS staging channels), `services/cli/scripts` (`build.mjs`, `binary.mjs`, `generate-teaching.mjs`), `services/cli/skill/SKILL.md`, `.github/workflows/publish-cli.yml`, `publish-plugin.yml`. |

## Verified baseline (2026-09-11, seed commit on `feat/cli-full-surface`)

| Check | Observed |
| --- | --- |
| Pinned install | `npm ci` succeeds (742 packages). The earlier checkout had no `diff`/`marked` installed; that was an environment gap, not code. |
| CLI unit suite | `node --import tsx --test services/cli/test/*.test.ts`: 138 pass, 0 fail, 25 todo (the seeds). |
| App API project | `npm run test:api -w services/app`: 1447 pass. Ten `cli-*` handler files: 27 pass. |
| App Node project | 3854 pass, 1 skipped. Two failures in the full parallel run were environmental: `evals/__tests__/cli-kit.test.ts` needs a fresh `npm run build -w services/cli` (passes after rebuild), and `lib/datasets/__tests__/postgres.test.ts` timed out under load and passes standalone (53). |
| App UI project | 1383 pass. |
| Type check | `npm run validate -w services/app` passes with the seeded parser, contracts and tests. |
| Residual-name guard | `npm run validate` fails only on this document's former line 7, which named the production checkout path; revision 2 removes the name. |
| Teaching | `npm run generate:teaching -w services/cli` regenerates 37 files; no file teaches `afbin api`, `--method`, MCP or `/docs/`. |
| Release state | GitHub release `afbin-v0.1.6` (2026-09-11) carries `afbin-darwin-arm64`, `afbin-darwin-x64`, `afbin-linux-arm64`, `afbin-linux-x64`, manifests, `SHA256SUMS`, `afbin.1`, `afbin-skills.json`. `publish-cli.yml` builds on a four-runner matrix from `afbin-v*` tags. The plugin channel and the skills tarball were removed on 2026-09-11: the CLI is the only distribution of skills. |
| Eval prerequisites | `evals/lib/harness/{opencode,pi,codex,claude-code}.ts` exist; model ids `accounts/fireworks/models/glm-5p3-flash` and `accounts/fireworks/models/deepseek-v4-flash-0731` are already referenced; the Fireworks key is present in the authorized env file. `npm run eval -- --help` errors with "unknown argument --help"; use `evals/lib/args.ts` for the argument list. |

### Integration results (2026-09-11, branch head after A, B, C and D merged)

| Check | Observed |
| --- | --- |
| CLI unit suite | `node --import tsx --test services/cli/test/*.test.ts`: 164 pass, 0 fail, 0 todo. Every seed is green. |
| Full suite | `npm test`: API 1471 pass; Node 3864 pass, 1 skipped after aligning three teaching tests to native commands; UI 1383 pass. The Postgres catalog test times out under the full parallel run and passes standalone. |
| Type check and residual names | `npm run validate` passes. |
| Production build | `npm run build` passes. |
| Native binary | `npm run build:binary -w services/cli` builds `afbin-darwin-arm64`; `npm run test:binary -w services/cli` passes offline help, validation, status, diff, bound local SQL, zero requests and the PTY round trip outside the checkout. Other platforms build on CI runners. |
| Browser gates | `npm run test:gates -- --only=dataflow,annotations,comment-targets,dataset-policies,export-slice,fork`: 6 of 6 passed. The dataflow gate had failed on the branch because it still shared with a bare address while the sharing door now requires explicit roles; the gate sends `{email, role}`. |
| Pull request | minusxai/artifactbin #94, empty body. CI failed once on the stale dataflow gate; after the fix all 27 checks pass. |
| Agent familiarity | See the eval record below. |

### Eval record (2026-09-11)

Both legs ran the CI smoke set (`--ci`: cli, comment, data, edit, no-token) against a locally booted production build with the dev-outbox login, from this checkout, with the Fireworks key exported from the authorized env file and never printed.

| Leg | Model id as invoked | cli | comment | data | edit | no-token |
| --- | --- | --- | --- | --- | --- | --- |
| pi | `fireworks/accounts/fireworks/models/deepseek-v4-flash-0731` (bare Fireworks ids are refused; pi needs the provider prefix) | pass, 17 turns, 23 tool calls | pass, 11 turns | pass, 14 turns | pass, 8 turns | unresolved: timed out after 15 minutes on both attempts (107 tool calls) |
| OpenCode | `fireworks-ai/accounts/fireworks/models/glm-5p2` | pass, 10 tool calls | pass, 10 | pass, 15 | pass, 9 | unresolved: timed out after 15 minutes on both attempts (101 tool calls), same cause as pi |

Mistakes and reruns: the first OpenCode and pi runs used the bare Fireworks ids from the earlier eval notes and failed before any tool call (pi: "Model not found"; OpenCode: "Unexpected server error", which its debug log shows is `ProviderModelNotFoundError`). OpenCode was rerun with `fireworks/` (still unknown to it) and then `fireworks-ai/`, its own provider name. A fresh OpenCode catalog does not list GLM-5p3-flash at all, only GLM-5p2, GLM-5p3 and routers, so GLM-5p2 was substituted and is recorded as such; the spec's named GLM-5p3-flash could not be run through OpenCode from a clean home.

The eval now has two flows (`evals/lib/mode.ts`) with one shared prompt that names only the server and the artifact. `installed`: the driver stages afbin and runs `afbin setup` in the run home before the harness starts, approving the pairing with its own session (`evals/lib/setup.ts`, `evals/lib/approver.ts`), so the CLI itself saved the connection and installed the skills. `not-installed`: nothing is staged; the agent must discover the installer from the server, install this checkout's built binary (served by the task proxy, `evals/lib/proxy.ts`) and run any remote command, whose first-use auth the driver approves. No plugin, MCP or staged-skill treatment exists.

The no-token flow was unresolved in the installed runs for a reason outside the CLI's contract: the harness fronts the leg server with a per-task proxy on a random port and tells the agent that port is the server, while the OAuth device door advertises the configured public origin (`services/proxy/src/routes/oauth.ts` `baseUrlOf`, "the configured public origin wins"). The CLI correctly refuses a pairing whose approval page is on another origin, so the agent never received an approval URL to hand back. The refusal now names both origins with the code `approval_origin_mismatch` instead of `invalid_response`. Making the flow measurable needs the harness to set the leg's public origin to the per-task proxy or to point the agent at the origin the server advertises; that is recorded for workstream D's follow-up, not claimed done.

### What the seed changed

- Parser: `fork`, `export`, `open` registered; `--restore`, `--refresh`, `--secret-env`, `--page`, `--session` added; `--type` and `--format` choices are per-command tables (`COMMAND_TYPES`, `FORMATS`); cross-flag rules from the footnotes enforced; `status`, `diff`, `list`, `delete` accept multiple refs; `query --write` takes `--input` or `--name`.
- Retired surfaces deleted: `afbin api`, `--method`, `ls`, `rm`, the `operations` help topic and `references/api.md`. Skill prose that taught `afbin api` now teaches file YAML and dataset definitions. Tests updated accordingly.
- Contracts: `forked_from` on resource metadata and the JSX fence; `SessionResource` and `ACCOUNT_RESOURCE_TYPES` (`profile`, `session`); the unused token resource contract was removed with the deferral.
- Server: `ACCOUNT_OPERATIONS` and `SESSION_OPERATIONS` seams spread into `OPERATIONS`.
- Dispatch: `pendingIntegration` refuses every seeded-but-unimplemented row with `command_integration_pending` and names the feature.

## Resolved design decisions

These resolve the choices revision 1 left open. They are normative; a workstream that finds one unworkable reports it rather than diverging.

### Resource vocabulary

`--type` values are one vocabulary: `artifact`, `folder`, `dataset`, `file` (artifact resources tracked in `afbin.lock`), `profile`, `session` (account resources tracked in `.artifactbin/accounts.json`). `list` adds the read-only collection `table`; `delete` adds `comment`. Token, trash, activity and analytics collections are deferred (see Deferred features). There is no `connection` type: a connection is an inline part of a dataset definition, not an addressable resource. Mixed batches of artifact and account resources are allowed everywhere; the current `mixed_resource_batch` refusals are removed by workstream A, and each file is routed by its own tracking or typed YAML.

### Dataset definitions and secrets

A flat dataset's `source` is CSV or JSON rows. A connected or multi-table dataset's `source` is a `.jsx` file holding one `<Dataset>` root with `<Connection>`, `<Notebook>` and `<Table>` children, the exact codec in `lib/datasets/definition.ts`. Pull writes the definition beside the YAML; push publishes it. The connection password never appears in YAML, definition, journal or output: `push --secret-env NAME` reads it from the named environment variable, creates the secret through `POST /api/secrets` bound to that exact connection, and substitutes the returned `passwordSecretId` into the definition before publishing. The content route must return the serialized definition for non-flat datasets (workstream C, server side). `list --type table --in <dataset>` discovers schemas, tables and columns; `query <dataset.yaml> --name <cell>` previews one notebook cell.

### Sessions, restore and refresh

Sessions map to the existing bearer registry routes: `list --type session`, `pull --type session` (read-only YAML; a push of session YAML fails with `readonly_resource`), `delete --type session` (terminate). No rename exists. `remote --session <id>` attaches as a controller mirror using the view, input and control routes; when a local recovery key for that id exists under `~/.artifactbin/remote/`, the CLI re-attaches as the runner instead. A removed session's 410 is reported, never replaced.

Restore is `push --restore <id>` through the existing bearer restore route; the id comes from the `deleted_ids` a delete returned or from the UI trash page. A pre-read distinguishes an already-restored row from a missing one. Refresh is `push --refresh <ref>` with per-target outcomes. Like and follow stay the `liked` and `following` lists in profile YAML.

### Deferred features

These are recorded so nobody rebuilds the analysis. None blocks the rest of the table.

- **Bearer access to tokens, trash listing, activity and analytics.** The CLI already holds a bearer token; the server exposes these only through cookie-session doors under `/api/page/*` and `/api/my/*`. Granting access later means registering read operations in `lib/operations/account.ts` that call `lib/tokens.ts`, `lib/trash.ts:152`, `lib/workspace.ts:31` and `lib/feed.ts`, and adding a `state=deleted` filter to `list_artifacts`. Token list, create and revoke should then require an account-claimed token, as remote sessions already do. The `ACCOUNT_OPERATIONS` seam exists for this.
- **Gaps recorded by A.** `push --restore` of a local file restores by id and does not then apply the file's desired state; `status --remote` and `diff --remote` refuse session targets; `list --type session` applies `--limit` locally and refuses `--cursor`, `--in` and `--filter`; `delete --type session --dry-run` does not contact the relay; untracked draft discovery for the mixed summary is root-level only.
- **Gaps recorded by C.** `list --type table --in` and `query --name <cell>` have no automated coverage (they need a live Postgres); `--secret-env` is a plain POST by design, so a lost reply leaves an unreferenced secret; `push --secret-env --dry-run` skips the content preflight until a secret id exists.
- **Export gaps recorded by B.** `export --name` runs locally only (remote refs are told to use `query --name`); multi-target export writes sequentially without a `completed_operations` list; Postgres `not_forkable` detection for remote datasets reads `catalog.kind` from the snapshot and is covered by the server refusal only for folders; remote fork of non-markup sources is implemented but untested.
- **Distribution notes recorded by D.** `/chat/release.json` is a deployment-visible contract read by `update`; `publish-cli.yml` and `release-cli.yml` remain two consistent paths; update downloads from the fixed GitHub release base, so self-hosted deployments cannot serve their own assets yet. The plugin channel, its workflow and the skills tarball were deleted afterwards (workstream E); `afbin setup` and `afbin update` are the only ways skills reach a harness, and both print a restart hint for Claude Code and Codex.
- **Local rendering.** Image export needs Playwright and a Chromium download that cannot live in the single-file binary; HTML preview needs runtime Tailwind, the React SSR bundle and a local server answering the document's pinned `/a/<id>/query`, `/a/<id>/mutate` and `/a/<id>/assets` paths. Workstream B puts export and open behind one renderer interface with a server-backed implementation so a local renderer can be added without touching the commands. Publishing a `private` draft and opening it is the supported preview today.
- Permanent delete, followers and liked-by lists, token and session rename: absent from the product.

### Fork, export and open

`fork` is local and offline for local sources: it writes a new draft without identity fields, with `forked_from: <source id>`, `visibility: private`, no `shares`, and the same `source` reference for typed resources. Remote sources are fetched through the pull path. The first `push` of a fork sends `forked_from` on create; the create operation accepts it when the source is readable by the actor and stores lineage. Folders and Postgres-backed datasets refuse with `not_forkable`. The server fork route is not used.

`export --format` is `png|jpg|html|csv|json|yaml|original`. `png`, `jpg` and `html` are produced by the server for the current head of a published artifact (`GET /a/<id>/export`, `GET /a/<id>/raw`). `csv`, `json`, `yaml` and `original` reuse the pull conversion path and work for local files, remote refs and `@version`. A local path with `png`, `jpg` or `html` is allowed only when the file is tracked and byte-identical to its observed head; otherwise the command fails with `renderer_unavailable` and the fix "push the draft, or export csv/json/yaml/original". `ref@version` with `png`, `jpg` or `html` fails with `unsupported_version_export`. Drafts are never uploaded for rendering. `--page <n>` maps to the server `slide` parameter for images; the server's count is returned on range errors. `--name` selects a named table or query result for data formats.

`open` opens the published view of a ref or tracked local file, or prints the URL with `--no-browser`. There is no local draft preview (see Deferred features), and uploading drafts is forbidden. Export and open call one renderer interface whose only implementation today is server-backed. An untracked or modified local file fails with `unpublished_draft`. The `--remote` and `--page` flags are removed from `open`; viewer URLs have no slide addressing.

### Durable recovery

Every remote mutation goes through `recoverableOperation` on the client. On the server, the `runOperation` idempotency allowlist widens to `restore_artifact`, `delete_artifact`, `refresh_asset` and `terminate_remote_session`, each with an authorization pre-check before the receipt is claimed. Workstream C replaces the v1 `SavedMutation` journal in `mutation-command.ts` with `recoverableOperation`; the two schemas must not coexist. Operation identity is the stable intent, never a random per-attempt value; a timed-out client never re-runs billable generation.

### Shared parsing, output and errors

Enum normalization happens once in `enumArgument`; identities and user data are never lowercased. `--json` emits one JSON document on stdout and diagnostics on stderr; `--output -` and `--json` never share stdout for bytes. Multi-target results use `batchCommand`: one target returns the bare result, several return `{results:[{ref,result|error}]}` with exit 1 on any failure. New refusal codes go in `diagnostics.ts` so help, man and errors agree. Teaching is regenerated from the registry with `npm run generate:teaching -w services/cli` after any command or flag change.

### Test protocol

Seeds are `node:test` tests with `{todo:'<owner>'}`. They run in the ordinary suite, fail visibly in TAP, and do not fail the run. An implementer turns a seed green by removing the todo option and implementing the behavior; a seed's assertions are the acceptance contract and may only be strengthened. Real-handler evidence for permissions, atomicity, retry and secret handling is added in `services/app/__tests__` using `useAppHarness` and the closed-over `fetch` pattern in `cli-sync-integration.test.ts`. Offline tests use a `fetch` that fails the test; secret tests scan YAML, journals and output for the fixture value.

## Workstreams

Run `node scripts/agent-worktree.mjs --phase <name> --brief <file> --base feat/cli-full-surface --install` from the OSS root for each workstream; the tool allocates a port block and writes `.agent/BRIEF.md`. Implementers use the `opus-implementer` agent definition (Opus, high effort). No two implementers share a checkout. Only the primary runs full suites, builds and browser gates.

| Workstream | Owner | Exclusive files | Seeds | Rows |
| --- | --- | --- | --- | --- |
| A. Resources | opus-implementer | `services/cli/src/account-workspace.ts`, `resource-file.ts`, `delete.ts`, new `services/cli/src/sessions.ts`, `restore.ts`; app `lib/operations/sessions.ts`, `lib/operations/http.ts` allowlist, `lib/remote/*`, `lib/trash.ts` (restore pre-read only); `__tests__/cli-account-resources.test.ts`, new `cli-sessions.test.ts`, `cli-restore.test.ts` | `seed-resources.test.ts` | `--type session` on pull/status/diff/delete and the `readonly_resource` push refusal; `list --type session`; `push --restore`; `push --refresh`; `delete --type folder|dataset|file|session` with multiple targets; mixed artifact and account batches; durable recovery for all of these |
| B. New commands | opus-implementer | new `services/cli/src/fork.ts`, `export.ts`, `open.ts`; app `lib/operations/registry.ts` only the `create_artifact` input (`forked_from`) and `export_artifact` (no other edits); `__tests__/cli-fork.test.ts`, `cli-export.test.ts` | `seed-commands.test.ts` | every `fork`, `export`, `open` row |
| C. Read and query edges | opus-implementer | `services/cli/src/pull.ts`, `resource-pull.ts`, `local-query.ts`, `local-document-query.ts`, `remote-query.ts`, `mutation-command.ts`, `result-output.ts`, `comparison.ts`, `local.ts`, `read-commands.ts` (`log` only); app `app/api/artifacts/[id]/content/route.ts`, `lib/resource-query.ts`, `lib/datasets/operations.ts`, `lib/datasets/secrets.ts`; `__tests__/cli-query-integration.test.ts`, `cli-content.test.ts`, new `cli-datasets-definition.test.ts` | `seed-query.test.ts` | `pull --output -`, `pull --format` conversions, connected dataset definitions, `push --secret-env`, `diff` multi-target and `--output`, `log --type|--filter` with per-target pagination, `query --dry-run`, declared mutations by `--name --write`, mixed and batch reads, draft freshness with `--remote`, journal consolidation |
| D. Distribution and teaching | opus-implementer | `services/cli/src/update.ts`, `skill-install.ts`, `man.ts`, `teaching.ts`, `scripts/compile-teaching.ts`, `skill/SKILL.md`, `README.md`; app `components/GetStarted.tsx`, `app/llms.txt/route.ts`, `lib/plugin-package.ts`, `lib/cli-release.ts`, `public/chat/install.sh`, `skills/artifactbin/**` prose; `scripts/__tests__/cli-install.test.mjs`, `cli-release.test.mjs`; `.github/workflows/publish-cli.yml`, `publish-plugin.yml` | `seed-distribution.test.ts` | `update --dry-run` and plugin provenance; `help --format|--output`; man and skills generated from definitions; stale npm guidance removed from all four sites; installer and update verified from a clean home outside the checkout; plugin publication wired to CLI release with monotonic versions; both plugin channels synchronized |
| Primary | this session | `commands.ts`, `arguments.ts`, `dispatch.ts`, `diagnostics.ts`, `recoverable-operation.ts`, `journal.ts`, `read-commands.ts` (`comment`), `runner.ts`, `launcher.ts`, contracts and utils, `docs/cli-full-spec.md` | `seed-primary.test.ts` | `comment --dry-run`, `delete --type comment --in`, bearer DELETE on annotations, `validate --remote`, `status <ref>`, `list <ref>`, `remote --session|--no-browser`, `--version` protocol in plain output, integration, evals, gates, PR |

### Brief contents (identical for every workstream)

1. Read this document in full, then the repository `AGENTS.md`, then your seed file. Run `npm ci` in the worktree and `node --import tsx --test services/cli/test/<your seed>` to observe the todo failures before changing anything.
2. Implement in cohesive batches. For each seed: remove the todo option, make it pass, and add the real-handler test the acceptance column names. Delete your entries from `pendingIntegration` in `dispatch.ts` as rows land; that file is otherwise primary-owned, so the report lists the exact lines removed.
3. Never add a second parser, transport, credential store or journal. Never persist a bearer or secret value. Never lowercase identities. Never widen sharing or infer destructive targets.
4. Verification before reporting: `npm run validate`, `node --import tsx --test services/cli/test/*.test.ts`, the vitest files you own (`npm exec -- vitest run --config vitest.config.ts --project=api <files>`), and `npm run generate:teaching -w services/cli` if help text changed. Report the exact commands and observed results; a check you did not run is reported as not run.
5. Report in `.agent/REPORT.md`: changed files, rows delivered with test evidence (file, command, result, commit), contract requests with exact signatures, remaining gaps.

### Acceptance per workstream

- **A.** Real-handler tests prove: a retried restore, refresh or terminate with the same operation identity produces one effect; viewer, editor and owner behavior matches the UI doors; restore of a live row is reported as already restored, never as failure; refresh reports per-target outcomes; sessions list, pull as read-only YAML, refuse push and terminate once; typed delete keeps local files and reports every returned identity. Mixed workspaces track both resource families and every `mixed_resource_batch` throw is gone.
- **B.** Fork never contacts the network for a local source, strips identity and shares, records lineage, refuses overwrites; the first push creates a distinct artifact with `forked_from` stored. Export of data formats is offline for local files; image and HTML export hit the export and raw routes for published heads only, honor `--page`, and refuse modified drafts and historical versions with the named codes. Open never publishes and never launches a browser under `--no-browser` or `--json`.
- **C.** Pull to stdout never tracks; conversions match the server's own CSV rendering; a connected dataset round-trips its definition byte-for-byte; `--secret-env` leaves no secret anywhere on disk or stdout; multi-target diff and log paginate per target and bind cursors to one target; declared mutations validate parameters, refuse on dry-run without executing, and recover through `recoverableOperation` with the v1 journal removed; a timed-out mutation is never re-run.
- **D.** A clean home outside the checkout installs and updates through `/chat/install.sh` with checksum failure preserving the working binary; `update --dry-run` writes nothing; all four skill destinations install and report provenance; help, man and skills agree and contain no `afbin api`, npm install, MCP or remote-skill teaching; homepage, `llms.txt`, plugin README and CLI README show the installer; both plugin channels build from the same teaching and their publication is wired to the CLI release workflow with monotonic versions; each platform binary that can be validated here is listed with its actual validation.
- **Primary.** Every command-table row audited with evidence; full suite, build, `test:gates --only=annotations,comment-targets,dataset-policies,export-slice,fork` plus any gate touched by integration; native binary build and `test:binary` on this host; OpenCode with `accounts/fireworks/models/glm-5p3-flash` and pi with `accounts/fireworks/models/deepseek-v4-flash-0731` complete publish, edit, query, share, comment and recover tasks from bundled guidance alone, with model ids, attempts and reruns recorded; one empty-body OSS PR with green CI.

### Completion order

Seed commit first (done). A, B, C and D run concurrently. C's content-route change and A's idempotency allowlist change are the only server edits with cross-workstream readers; both land through the primary's review before dependants integrate. D's stale-text fixes may integrate at any time. The primary integrates A and C before regenerating final teaching, then B, then D, then runs evals last (pi and OpenCode first, Claude Code only if requested). Production pin and plugin publication follow OSS review and merge.

## Server capability map (verified 2026-09-11)

Source inspection of `services/app` at the seed commit. "Bearer" means the `withTokenAuth` door used by the CLI; "session" means browser-only doors the CLI cannot use. Paths are relative to `services/app`.

| CLI need | Server today | Decision |
| --- | --- | --- |
| Profile pull/push, `liked`, `following` | `GET/PATCH /api/account/profile`: bearer, `state` CAS, `Idempotency-Key` honored (`app/api/account/profile/route.ts`, `lib/account-profile.ts`) | Done. Like and follow are the `liked` and `following` lists in profile YAML. |
| Token list/create/revoke | Bearer door mints via operator secret only (`app/api/tokens/route.ts`); list and revoke are session-only (`app/api/my/tokens`) | Deferred; see Deferred features. |
| Connection as a resource | Not a resource; inline in the dataset definition (`lib/datasets/definition.ts`, `lib/datasets/types.ts:15-26`); password is a write-only secret (`POST /api/secrets`) | No `connection` type. Definition `.jsx` as dataset `source`; `--secret-env` for the password. |
| Session list/get/terminate/attach | Bearer, owner-scoped: list, view with `?since`, input, control, delete (`lib/remote/route.ts`, `lib/remote/registry.ts`). No rename. In-process registry, one-hour prune. | `list`, `pull`, `delete --type session`; `remote --session` as controller mirror or runner re-attach. |
| Trash view | Session-only `GET /api/page/trash` (`lib/trash.ts:152`) | Deferred; restore works by explicit id. |
| Restore | Bearer `POST /api/artifacts/{id}/restore`, owner scope; live row returns 404 | `push --restore <id>`; pre-check distinguishes already-restored from missing. |
| Asset refresh | Bearer `POST /api/artifacts/assets/refresh`, per-url outcomes inside 200 | `push --refresh <ref>`. |
| Activity, analytics | Session-only `GET /api/page/home?part=insights` (`lib/workspace.ts:31`) | Deferred; see Deferred features. |
| Fork | Bearer `POST /api/artifacts/{id}/fork` is explicitly not idempotent | Local fork; first push creates with `forked_from`; server fork route unused. |
| Sharing | Bearer `PATCH /api/artifacts/{id}` with `shares`, `visibility`, `linkRole`; full replace; `expectedState` CAS | Done in resource YAML. |
| Dataset policy | Bearer `GET/PUT /api/artifacts/{id}/policy`, `expectedPolicyRevision` CAS | Done in dataset YAML. |
| Idempotency | Honored only for `mutate_dataset`, `annotate` (`lib/operations/http.ts:47`) and profile PATCH | Allowlist widened as listed under durable recovery. |
| Comment delete | Session-only DELETE (`app/api/my/artifacts/[id]/annotations/[annId]`) | Bearer DELETE added by the primary. |
| Permanent delete, followers list, liked-by list, token rename, session rename | Not provided | Not offered; recorded gaps. |

## Rendering, export, preview and fork map (verified 2026-09-11)

| Fact | Evidence |
| --- | --- |
| Image export is server-side Playwright; formats `png`, `jpg`; capture `full`/`card`; `?slide=N` selects a `[data-mx-slide]` locator; current head only; stored artifacts only | `lib/export.ts:1-6,34,43,90`, `services/browser/src/local.ts:102-108`, `app/a/[id]/export/route.ts:24` |
| The standalone HTML page comes from `buildStoryDocument` at `/a/<id>/raw`; it needs runtime Tailwind and a prebuilt React SSR bundle, neither shipped by the CLI | `lib/story/document.ts:333`, `lib/data/story/story-css.server.ts:10`, `lib/story/ssr.server.ts:11`, `services/cli/package.json:36-43` |
| `POST /api/preview` compiles draft markup to `{html, format, css}` without persisting; not a renderable page | `app/api/preview/route.ts:12-34` |
| Slides have no URL addressing; navigation is React state | `lib/urls.ts`, `lib/story-runtime/StoryRuntimeApp.tsx:777-801` |
| `pull --format csv/json/yaml/original` already converts content; historical versions come from `/artifacts/{id}/content?version=N`; the content route refuses non-flat datasets today | `services/cli/src/pull.ts:50-102`, `app/api/artifacts/[id]/content/route.ts:13-24` |
| Server fork re-imports assets, drops shares, stores `forked_from`; `createArtifact` accepts `forkedFrom` at creation | `lib/artifacts.ts:364,428,494-558` |
| Remote sessions re-attach by deterministic `recoveryKey`, or mirror by `GET ?since=` plus `POST input/control`; `runnerKey` is returned once | `lib/remote/registry.ts:108-115,156-163,212` |

## UI parity inventory (verified 2026-09-11)

The web UI is a Vite SPA under `services/app/web/pages` calling the `/api/my/*` cookie doors; the CLI uses the bearer doors. Every UI workflow was mapped; the table lists the resolution with the UI component as evidence.

| UI workflow | Native mapping | Status |
| --- | --- | --- |
| Create, edit, title, description, theme, color mode (`InPlaceEditor.tsx`, `ThemePicker.tsx`) | `push` with fence/YAML metadata | Exists |
| Visibility, link role, invite/change/remove share, dataset access (`ShareLink.tsx`) | `push` YAML `visibility`, `link`, `shares`, `access` | Exists |
| Folder create/rename/move/delete (`Shelf.tsx`, `FolderPicker.tsx`, `RowMenu.tsx`) | folder YAML, `folder` field for moves, `delete --type folder` | Delete typed dispatch: A |
| Dataset upload, sheet import, stored multi-table, notebook cells, connection, discover (`DatasetEditor.tsx`) | dataset YAML with rows or definition `source`; `list --type table --in`; `query --name` | C |
| Dataset policy (`DatasetPolicies.tsx`) | dataset YAML `policy` with `policy_revision` CAS | Exists |
| Comments create by node or quote, reply, resolve, reopen (`AnnotationLayer.tsx`) | `comment` | Exists |
| Comment delete (`AnnotationLayer.tsx:1105`) | `delete --type comment --in <artifact> <id>` | Primary |
| Version list, preview, revert (`VersionHistory.tsx`) | `log`, `pull ref@version` then conditional `push` | Exists |
| Trash list, restore (`Trash.tsx`) | `push --restore <id>` by explicit id; trash listing deferred | A |
| Like, follow (`ArtifactSurface.tsx:551-579`, `FollowButton.tsx`) | profile YAML `liked`, `following` | Exists |
| Username (`UsernameCard.tsx`) | profile YAML `username` | Exists |
| Dashboard metrics and engagement series (`Dashboard.tsx`) | none | Deferred |
| Activity feed (`ActivityFeed.tsx`) | none | Deferred |
| Shared with you (`SharedWithYou.tsx`) | `list --filter relationship=shared` | Exists |
| Token list, revoke, mint with expiry, one-time display (`TokensPanel.tsx`, `TokensNew.tsx`) | none; `setup` obtains the CLI's own credential | Deferred |
| Refresh external images (`RefreshAssets.tsx`) | `push --refresh <ref>` | A |
| Fork (`ForkArtifact.tsx`) | `fork` then `push` | B |
| Thumbnails and social cards (`Shelf.tsx`, `SocialPreviewDialog.tsx`) | `export --format png|jpg` full captures; social-card framing not offered | B |
| Remote sessions list, attach, input, resize, remove (`Chat.tsx`) | `list --type session`, `remote --session`, `delete --type session` | A and primary |
| Skills download and install text (`GetStarted.tsx`, `llms.txt`) | `setup`, `update`, `/chat/install.sh` | D |

Recorded gaps, not offered by the CLI: claim and reject of browser-held anonymous tokens (cookie model), the one-time start link and agent prompt, social-preview crop framing, annotation area ranges, reader appearance override, permanent delete, session and token rename, followers and liked-by lists.

## Required acceptance scenarios

| Gate | Required observation |
| --- | --- |
| Local-first | With network disabled and an isolated home: help, version, validate, status, diff, local SQL, fork of a local source, data-format export of a local file and an unchanged ordinary push succeed without auth, polling or unexpected writes. Image and HTML export of a published ref are fetched from the server after publishing. |
| Forgiving auth | Fresh no-TTY command opens approval, waits boundedly and resumes once; existing setup plus expired credentials also resumes; denial, unavailable browser, concurrent approval and localhost server selection covered. `--no-browser` prints and waits; dry-run never creates credentials. |
| Reconciliation | Two writers change unrelated nodes or fields and both survive; overlap retains both proposals; force is conditional with recoverable backup; edits during a response survive; content plus governance is atomic or refused before any write. |
| Authorization and retry | Viewer, editor and owner behavior matches the UI; revoked access and stale policy or state fail safely; response loss and process restart produce one logical mutation, one invitation or event, no leaked credentials, and no re-run of billable generation. |
| Surface consistency | Each row has parser plus behavior tests: mixed-case fixed enums, exact IDs and data, unsupported flags, ambiguous refs, no ignored flags, batch partial failures, 20-result defaults, cursor binding, stdout and file conflicts, nonzero failures. |
| UI parity | Every row of the parity inventory above maps to a passing real-handler check or a recorded gap. |
| Distribution | Clean standalone install and update outside the checkout; integrity failure preserves the working install; all four local skill destinations; help, man and skills agree; no npm, MCP or raw-HTTP teaching; each available native platform recorded with its actual validation. |
| Agent familiarity | OpenCode with `accounts/fireworks/models/glm-5p3-flash` and pi with `accounts/fireworks/models/deepseek-v4-flash-0731` perform publish, edit, query, share, comment and recover tasks using bundled CLI guidance alone. Record model ids, attempts, mistakes and reruns. Timeouts or missing auth are unresolved checks, not passes. |

Use isolated test homes, data directories and free port blocks; never touch the user's running servers. The Fireworks key in the authorized env file is for these evals only; do not print or copy it into source or reports.

### Reproducible checks

```sh
# From the OSS root after npm ci
node --import tsx --test services/cli/test/*.test.ts               # CLI suite incl. seeds (todo)
node --import tsx --test services/cli/test/seed-resources.test.ts  # one workstream's seeds
npm exec -- vitest run --config vitest.config.ts --project=api services/app/__tests__/cli-account-resources.test.ts
npm exec -- vitest run --config vitest.config.ts --project=node scripts/__tests__/cli-install.test.mjs scripts/__tests__/cli-release.test.mjs
npm run generate:teaching -w services/cli                          # after command/flag/help changes
npm run validate && npm test && npm run build                      # primary, at integration
npm run build -w services/cli && npm run build:binary -w services/cli && npm run test:binary -w services/cli
npm run test:gates -- --only=annotations,comment-targets,dataset-policies,export-slice,fork
```

For every new scenario record: command-table row, fixture, invoked command, expected output and exit, local and remote state assertion, test file, exact check command, tested commit and observed result. For retries, count committed effects rather than checking the response. For offline tests, make unexpected fetches fail and inspect filesystem changes. For secret tests, scan captured output, journals and tracked YAML for fixture credentials. For subprocess tests, use the freshly built CLI and an isolated home.

## Command table

Owner: A resources, B new commands, C read and query edges, D distribution, P primary. Status describes implementation evidence at the seed commit, not permission to omit unfinished requirements. "Seeded" means the parser accepts the row and dispatch refuses it with `command_integration_pending` until the owner lands it.

| Command / flag | Owner | Description | Implemented now?[^audit] | Defaults & recovery (required behavior)[^defaults] |
| --- | --- | --- | --- | --- |
| `afbin [command]` | P | Run setup by default; resolve artifacts by ID, tolerating decorative names. Keep local work offline. [^global] [^syntax] [^identity] | **Partial** — Default setup/common flags and artifact references exist; batch/recovery coverage varies. Case normalization is not consistently implemented. | No command → setup. Local work stays offline; remote work automatically authenticates and resumes. [^defaults] |
| `-h, --help` | P | Print bundled help for this command. [^global] | **Yes** — Offline bundled help. | Always offline; no authentication, setup or mutation. |
| `--version` | P | Print the installed CLI version and protocol version. [^global] | **Yes** (ff2034b0) — Plain output reports version and protocol; offline. | Always offline; no update check. |
| `--json` | P | Emit structured command results to stdout; diagnostics go to stderr. [^global] | **Partial** — Structured results and separate diagnostics exist; remote rejects this flag. | Keep stdout machine-readable, including errors; progress belongs on stderr. |
| `--server <origin>` | P | Select the server. [^global] | **Yes** — Explicit/workspace/environment/saved selection and origin-scoped credentials exist. | Reuse explicit/workspace/environment/saved origin in order; never send credentials to another origin. |
| `-y, --yes` | P | Accept the command's stated confirmation defaults without terminal prompts. [^global] | **Yes** — Skill-selection defaults can be accepted; browser approval remains required. | Accept stated defaults without prompts; never imply browser approval, force or broader permissions. |
| `-n, --dry-run` | P | Describe and validate the proposed changes without applying them, changing local tracking, installing files, refreshing credentials, or sending invitations. [^global] | **Partial** — Accepted only on pull, push and delete; these may perform remote reads/preflight. | No side effects or auth setup; report missing credentials/capabilities clearly. |
| `-f, --force` | P | Explicitly permit the documented overwrite for this command. [^global] | **Partial (working branch)** — Pull now preserves overwritten bytes in recoverable backups. Export overwrite support remains pending. | Only explicit overwrite permission; preserve recovery and enforce authorization. |
| `--remote` | P | Refresh the remote observations used by an otherwise local operation. [^global] | **Partial** — Supported on status and diff only. | Omitted → local observations where supported; requested → refresh only. |
| `--no-browser` | P | Suppress browser launch; print approval/view URLs instead. [^setup] | **Partial (working branch)** — Auth suppression/waiting is implemented; open/remote behavior remains pending. [^implementation] | Print usable URLs; do not infer this flag from missing TTY. Auth waits remain bounded. [^setup] |
| `--type <type>` | P | Select the kind of resource being addressed or listed. [^global] | **Partial** — Artifact discovery and profile-aware commands accept type; session coverage and consistent enforcement remain. | Infer from typed file/tracking; otherwise use the documented command default. Conflicts → error, never reinterpret. Enum values ignore case. [^syntax] |
| `--input <path\|->` | P | Read command input from a local file, or stdin for `-`. [^global] | **Partial** — SQL and comment input work; raw API removal remains. | Read stdin only with explicit -; never hang waiting for unspecified input. |
| `-o, --output <path\|->` | P | Write resulting content to a file/directory, or stdout for `-`. [^global] | **Partial** — Pull and query/list outputs exist; remaining commands and batch/stdout edges remain. | Suggest a free destination; reject ambiguous multiple outputs and unrelated-file overwrite. |
| `--format <format>` | P | Select the content representation, such as JSX, YAML, CSV, JSON, HTML, or PNG, where that resource supports it. [^global] | **Partial** — Pull/query/list representations exist; complete format matrix remains. | Infer only where documented; reject unsupported or contradictory representations locally. Enum values ignore case. [^syntax] |
| `--in <ref>` | P | Scope the operation to a containing resource: a folder, artifact, or dataset. [^global] | **Partial** — Artifact folder scoping exists; other containers remain. | Infer only from unambiguous tracking; otherwise require the containing resource. |
| `--filter <field=value>` | P | Apply a typed filter; repeat to combine filters. [^global] | **Partial** — Artifact discovery and comment filters exist; other collections remain. | No filters → documented collection default; invalid fields/values → supported choices. |
| `--limit <n>` | P | Return at most `n` results in a page, from 1 to 100. [^global] | **Yes** — Validated range 1–100 on list/log/comment. | Default to 20 results; accept 1–100. Include next cursor when more results exist. |
| `--cursor <cursor>` | P | Continue the same query using its returned cursor. [^global] | **Yes** — Passed through list/log/comment pagination. | Omitted → first page. Reject mismatched/expired cursors; explain how to restart. |
| `afbin pull [<ref> ...]` | C | Retrieve editable files and reconcile tracked changes using shared node-scoped merge rules. [^pull] [^latest-main] | **Partial** — Shared merge, conflict records, force backups and native YAML source tracking exist; stdout, conversion, dataset definitions and the session kind are seeded. | No refs → tracked files. Merge unrelated edits; retain local work on conflict. [^defaults] |
| `--type <artifact\|folder\|dataset\|file\|profile\|session>` | C/A | Interpret the targets as the selected resource type; default `artifact`. [^pull] | **Partial** — Profile workflow exists with focused tests; other accepted type values need consistent enforcement; session remains. | Infer from typed file/tracking; otherwise use the documented command default. Conflicts → error, never reinterpret. Enum values ignore case. [^syntax] |
| `-o, --output <path\|->` | C | Destination file/directory. [^pull] | **Partial (working branch)** — --output replaces positional destinations; batch directories work. Stdout and representation conversion remain. | Suggest a free destination; reject ambiguous multiple outputs and unrelated-file overwrite. |
| `--format <jsx\|yaml\|csv\|json\|original>` | C | Select a supported editable local representation; default to the resource’s native representation. [^pull] | **Partial** — Native YAML/source retrieval exists; full editable conversion and stdout remain. | Infer only where documented; reject unsupported or contradictory representations locally. Enum values ignore case. [^syntax] |
| `-f, --force` | C | Replace locally changed tracked content after preserving a recoverable local copy. [^pull] | **Yes (working branch)** — Overwritten local bytes are backed up before replacement; pending proposals are archived. | Only explicit overwrite permission; preserve recovery and enforce authorization. |
| `-n, --dry-run` | C | Show what would be retrieved, converted, or replaced without writing files or changing tracking. [^pull] | **Partial** — Read-only retrieval/planning exists; all resource/merge previews still need coverage. | No side effects or auth setup; report missing credentials/capabilities clearly. |
| `afbin fork <ref> [<ref> ...]` | B | Create a distinct private local draft with recorded lineage; publish it later with push. [^fork] | **Yes** (B, merged 2026-09-11) — `seed-commands.test.ts`, `cli-fork.test.ts`, `cli-export.test.ts`. | Require source; suggest a free destination. Default to private; never publish implicitly. |
| `--type <artifact\|folder\|dataset\|file>` | B | Select the source resource type when it cannot be inferred. [^fork] | **Yes** (B, merged 2026-09-11) — `seed-commands.test.ts`, `cli-fork.test.ts`, `cli-export.test.ts`. | Infer from typed file/tracking; otherwise use the documented command default. Conflicts → error, never reinterpret. Enum values ignore case. [^syntax] |
| `-o, --output <path>` | B | Destination for the new editable draft; defaults to a collision-checked suggested filename. [^fork] | **Yes** (B, merged 2026-09-11) — `seed-commands.test.ts`, `cli-fork.test.ts`, `cli-export.test.ts`. | Choose a free destination; never overwrite a source or existing draft. |
| `-n, --dry-run` | B | Show new local files, retained dependencies, and sharing defaults without creating files or resources. [^fork] | **Yes** (B, merged 2026-09-11) — `seed-commands.test.ts`, `cli-fork.test.ts`, `cli-export.test.ts`. | No side effects or auth setup; report missing credentials/capabilities clearly. |
| `afbin export <ref> [<ref> ...]` | B | Export images or HTML of published heads through the server, or data and original bytes locally. [^export] | **Yes** (B, merged 2026-09-11) — `seed-commands.test.ts`, `cli-fork.test.ts`, `cli-export.test.ts`. | Infer format from destination; choose a free filename. Missing renderer gets an actionable error; never publish implicitly. |
| `--type <artifact\|folder\|dataset\|file>` | B | Select the resource type when it cannot be inferred. [^export] | **Yes** (B, merged 2026-09-11) — `seed-commands.test.ts`, `cli-fork.test.ts`, `cli-export.test.ts`. | Infer from typed file/tracking; otherwise use the documented command default. Conflicts → error, never reinterpret. Enum values ignore case. [^syntax] |
| `--format <png\|jpg\|html\|csv\|json\|yaml\|original>` | B | Select the export representation. [^export] | **Yes** (B, merged 2026-09-11) — `seed-commands.test.ts`, `cli-fork.test.ts`, `cli-export.test.ts`. | Infer only where documented; reject unsupported or contradictory representations locally. Enum values ignore case. [^syntax] |
| `-o, --output <path\|->` | B | Write exported content; default to a collision-checked filename. [^export] | **Yes** (B, merged 2026-09-11) — `seed-commands.test.ts`, `cli-fork.test.ts`, `cli-export.test.ts`. | Suggest a free destination; reject ambiguous multiple outputs and unrelated-file overwrite. |
| `--name <name>` | B | Select a named table/query result, with the same meaning as in `query`. [^export] | **Yes** (B, merged 2026-09-11) — `seed-commands.test.ts`, `cli-fork.test.ts`, `cli-export.test.ts`. | Require an existing name when selecting; explain available names. No guessed query/mutation. |
| `--page <n>` | B | Select a 1-based slide/page for a paginated document, with the same meaning as in `open`. [^export] | **Yes** (B, merged 2026-09-11) — `seed-commands.test.ts`, `cli-fork.test.ts`, `cli-export.test.ts`. | 1-based; reject out-of-range values with valid range. Omitted → documented whole-resource view/export. |
| `-f, --force` | B | Replace an existing untracked export destination after preserving a recoverable copy. [^export] | **Yes** (B, merged 2026-09-11) — `seed-commands.test.ts`, `cli-fork.test.ts`, `cli-export.test.ts`. | Only explicit overwrite permission; preserve recovery and enforce authorization. |
| `-n, --dry-run` | B | Validate export inputs and report destinations and required capabilities without rendering or writing output. [^export] | **Yes** (B, merged 2026-09-11) — `seed-commands.test.ts`, `cli-fork.test.ts`, `cli-export.test.ts`. | No side effects or auth setup; report missing credentials/capabilities clearly. |
| `afbin push [<ref> ...]` | A/C | Publish local content and YAML settings, including sharing; preserve node-scoped rebasing. [^push] [^latest-main] | **Partial** — Content/shares and metadata/policy updates are atomic; combined content+policy delta is refused. Remaining resources and mutation recovery remain. | No refs → changed tracked files; unchanged → offline success. Authenticate/resume automatically; recover writes without duplication. [^defaults] |
| `--type <artifact\|folder\|dataset\|file\|profile\|session>` | A | Select the type when it cannot be determined from a typed file or tracking. [^push] | **Partial** — Profile workflow exists; consistent enforcement and session remain. | Infer from typed file/tracking; otherwise use the documented command default. Conflicts → error, never reinterpret. Enum values ignore case. [^syntax] |
| `--secret-env <NAME>` | C | Read a secret value (a dataset connection password) from the named environment variable; create the bound secret and reference its id. [^push] | **Yes** (C, merged 2026-09-11) — `seed-query.test.ts`, `cli-datasets-definition.test.ts`. | Never write the value to YAML, definitions, journals or output; the definition references the returned secret id. |
| `--restore` | A | Restore the selected soft-deleted resources, preserving identity and applicable permissions. [^push] | **Yes** (A, merged 2026-09-11) — see the seed files and the app `cli-*` tests. | Require explicit targets; retry the same restore safely. Never infer bulk restoration. |
| `--refresh` | A | Refresh the selected resources' declared external data or imported assets. [^push] | **Yes** (A, merged 2026-09-11) — see the seed files and the app `cli-*` tests. | Require explicit targets; report changed/unchanged/failed resources independently. |
| `-n, --dry-run` | A/C | Validate content, dependencies, permissions, sharing deltas, and the proposed operation without committing. [^push] | **Partial** — Local checks plus remote preflight exist for current types. | No side effects or auth setup; report missing credentials/capabilities clearly. |
| `-f, --force` | A/C | Observe the current remote head and conditionally replace it with the local proposal. [^push] | **Yes** — Observes head and conditionally replaces; races still fail. | Only explicit overwrite permission; preserve recovery and enforce authorization. |
| `afbin validate [<path> ...]` | P | Validate locally; apply mechanical fixes or explicitly request remote checks. [^validate] [^latest-main] | **Partial** — Existing document/asset checks and fixes are local and unauthenticated. Expanded schemas are missing. | No paths → tracked files; offline by default. Explain fixes; apply only with --fix. |
| `--fix` | P | Apply explicitly documented mechanical corrections locally. [^validate] | **Yes** — Mechanical formatting is local. | Omitted → report only. Never invent content or permission changes. |
| `--remote` | P | Additionally check server-dependent constraints without persisting a preview or mutation. [^validate] | **Yes** (ff2034b0) — Local validation, then the read-only publication preflight; reads only. `seed-primary.test.ts`. | Omitted → local observations where supported; requested → refresh only. |
| `afbin status [<ref> ...]` | P | Report local changes, conflicts and installation state; refresh remote observations only when requested. [^status] [^latest-main] | **Partial** — Default workspace status is local; positional targets work (ff2034b0); installation/account summary pending. | No refs → workspace/installation summary. No workspace → useful setup status; no authentication just to report status. |
| `--type <artifact\|folder\|dataset\|file\|profile\|session>` | A | Restrict the tracked resources being reported. [^status] | **Partial** — Profile tracking exists; mixed workspaces and full resource filtering remain. | Infer from typed file/tracking; otherwise use the documented command default. Conflicts → error, never reinterpret. Enum values ignore case. [^syntax] |
| `--remote` | P | Refresh remote status, authorization, and resource conditions. [^status] | **Partial** — Fetches and caches tracked artifact snapshots. | Omitted → local observations where supported; requested → refresh only. |
| `afbin diff [<ref> ...]` | C | Compare working files against saved, historical or explicitly refreshed remote state. [^diff] [^latest-main] | **Partial** — Ordinary diff is local; historical comparisons cached; multiple targets and --output seeded. | No refs → changed files. Unchanged → empty success; fetch only explicitly requested missing remote/history data. |
| `--type <artifact\|folder\|dataset\|file\|profile\|session>` | A/C | Select the resource type when it is not inferable. [^diff] | **Partial** — Profile comparison exists; mixed workspaces and full type coverage remain. | Infer from typed file/tracking; otherwise use the documented command default. Conflicts → error, never reinterpret. Enum values ignore case. [^syntax] |
| `--remote` | C | Refresh the comparison base from the server. [^diff] | **Yes** — Fetches remote content and compares locally without moving the accepted base. | Omitted → local observations where supported; requested → refresh only. |
| `-o, --output <path\|->` | C | Write the diff; defaults to stdout. [^diff] | **Yes** (C, merged 2026-09-11) — see the seed files and the app `cli-*` tests. | Default to stdout; explicit file output must not overwrite unrelated content silently. |
| `afbin list [<ref> ...]` | A/P | List resources or summaries, with consistent types, filters and pagination. [^list] [^latest-main] | **Partial** — Owned/shared discovery, filters, folder scoping and output work; exact refs and additional collections remain. | Default to accessible artifacts and bounded pagination. Empty collection → success; automatically authenticate if needed. [^defaults] |
| `--type <artifact\|folder\|dataset\|file\|profile\|table\|session>` | A | Select a resource collection; default `artifact`. Token, activity and analytics collections are deferred. [^list] | **Partial** — artifact/folder/dataset/file implemented; profile/table/session seeded; token/activity/analytics deferred. | Infer from typed file/tracking; otherwise use the documented command default. Conflicts → error, never reinterpret. Enum values ignore case. [^syntax] |
| `--in <ref>` | A | Scope to a folder, artifact, user, or other supported container. [^list] | **Partial** — Folder scoping implemented; other containers remain. | Infer only from unambiguous tracking; otherwise require the containing resource. |
| `--filter <field=value>` | A | Filter by supported fields such as search text, visibility and ownership/shared status. [^list] | **Partial** — Search/visibility/relationship filters implemented; trash state is deferred with trash listing. | No filters → documented collection default; invalid fields/values → supported choices. |
| `--limit <n>` | A | Page size. [^list] | **Yes** — Works for artifact listing. | Default to 20 results; accept 1–100. Include next cursor when more results exist. |
| `--cursor <cursor>` | A | Continue the same filtered collection. [^list] | **Yes, artifact collections** — Cursor binds account and filter set; new collections need equivalent checks. | Omitted → first page. Reject mismatched/expired cursors; explain how to restart. |
| `-o, --output <path\|->` | A | Write the listing; defaults to stdout. [^list] | **Yes, current collections** — Private exclusive files/stdout supported; broader batch summaries remain. | Default to stdout; reject conflicting output modes or ambiguous multiple results. |
| `--format <table\|csv\|json\|yaml>` | A | Representation of the returned collection. [^list] | **Yes, current collections** — Table/CSV/JSON/YAML with conflicting stdout modes rejected. | Infer only where documented; reject unsupported or contradictory representations locally. Enum values ignore case. [^syntax] |
| `afbin log <ref> [<ref> ...]` | C | Read version history for one or more resources. [^log] | **Partial (working branch)** — Batch history and per-target failures work; type/date/author filtering remains. | Require target; default to newest history and bounded pagination. Explain missing/inaccessible targets. [^defaults] |
| `--type <artifact\|folder\|dataset\|file>` | C | Select a versioned resource type; default inferred/artifact. [^log] | **Yes** (C, merged 2026-09-11) — see the seed files and the app `cli-*` tests. | Infer from typed file/tracking; otherwise use the documented command default. Conflicts → error, never reinterpret. Enum values ignore case. [^syntax] |
| `--filter <field=value>` | C | Filter supported history fields such as author or date interval. [^log] | **Yes** (C, merged 2026-09-11) — see the seed files and the app `cli-*` tests. | No filters → documented collection default; invalid fields/values → supported choices. |
| `--limit <n>` | C | Page size per target. [^log] | **Partial** — Works for one target. | Default to 20 results; accept 1–100. Include next cursor when more results exist. |
| `--cursor <cursor>` | C | Continue one target's history; incompatible with multiple targets. [^log] | **Yes** — Single-target history pagination. | Omitted → first page. Reject mismatched/expired cursors; explain how to restart. |
| `afbin delete <ref> [<ref> ...]` | A | Delete resources, delete comments or terminate sessions; preserve local source files. [^delete] | **Partial** — Single-artifact deletion preserves source files and removes tracking; multiple targets and typed actions seeded; durable recovery pending. | Require explicit targets; preserve local files. Resume confirmed same-operation retries; never infer delete-all. [^defaults] |
| `--type <artifact\|folder\|dataset\|file\|session\|comment>` | P | Select the resource type; default inferred/artifact. [^delete] | **Yes** (P, merged 2026-09-11) — see the seed files and the app `cli-*` tests. | Infer from typed file/tracking; otherwise use the documented command default. Conflicts → error, never reinterpret. Enum values ignore case. [^syntax] |
| `--in <ref>` | P | Identify the containing artifact when deleting comments. [^delete] | **Yes** (ff2034b0) — `delete --type comment --in <artifact> <id...>` through the new bearer DELETE; `cli-comment-delete.test.ts` proves owner-only, account-claimed ACL. | Infer only from unambiguous tracking; otherwise require the containing resource. |
| `-n, --dry-run` | A | Show affected resources, descendants, dependencies, and authorization checks without applying deletion/revocation. [^delete] | **Partial** — Artifact deletion server preflight exists. | No side effects or auth setup; report missing credentials/capabilities clearly. |
| `-f, --force` | A | Permit deleting an asset that is still referenced, after reporting affected references. [^delete] | **Yes** — Referenced-asset deletion still requires server authorization. | Only explicit overwrite permission; preserve recovery and enforce authorization. |
| `afbin comment <ref> [<ref> ...]` | P | List, post, reply or change thread state; reuse delete for comment removal. [^comment] | **Partial (working branch)** — Batch listing/posting, reopening and durable create/reply recovery work; dry-run and deletion remain. | No mutation flags → list. Posting requires explicit text/anchor; retries must not duplicate comments. [^defaults] |
| `--body <text>` | P | Comment/reply text. [^comment] | **Yes** — Text posting/replying exists. | Require nonempty text; mutually exclusive with input file/stdin. |
| `--input <path\|->` | P | Read comment/reply text from a file or stdin; mutually exclusive with `--body`. [^comment] | **Yes (working branch)** — --input reads comment text from a file or explicit stdin; --body-file is removed. | Read stdin only with explicit -; never hang waiting for unspecified input. |
| `--thread <thread-id>` | P | Select an existing thread for a reply and/or state change. [^comment] | **Yes (working branch)** — --thread selects replies/state transitions; --reply is removed. | Require one artifact and a valid thread; no anchor guessing. |
| `--node <node-id>` | P | Anchor a new thread to an existing persistent node. [^comment] | **Yes** — Persistent-node anchoring exists. | Validate the exact persistent node; stale/missing anchor → actionable error. |
| `--quote <text>` | P | Anchor a new thread to a uniquely matching quote; mutually exclusive with `--node`. [^comment] | **Yes** — Quote anchoring and node/quote exclusivity exist. | Require a unique match; report ambiguity without posting. |
| `--state <open\|resolved>` | P | Reopen or resolve the thread selected by `--thread`; can accompany a reply. [^comment] | **Yes (working branch)** — Explicit open/resolved transitions normalize enum case; --resolve is removed. | Require explicit open/resolved and a thread; unchanged state → safe success. Enum values ignore case. [^syntax] |
| `--filter <field=value>` | P | Filter listed threads by supported fields, including state and author. [^comment] | **Yes** — State and exact author filters bind pagination. | No filters → documented collection default; invalid fields/values → supported choices. |
| `--limit <n>` | P | Thread page size. [^comment] | **Yes** — Listing-only pagination exists. | Default to 20 results; accept 1–100. Include next cursor when more results exist. |
| `--cursor <cursor>` | P | Continue one artifact's thread listing. [^comment] | **Yes** — One-artifact listing pagination exists. | Omitted → first page. Reject mismatched/expired cursors; explain how to restart. |
| `-n, --dry-run` | P | Check anchors, thread state, permissions, and proposed changes without posting. [^comment] | **Yes** (ff2034b0) — Reads the head, checks comment capability, thread and node anchors; never posts. `seed-primary.test.ts`. | No side effects or auth setup; report missing credentials/capabilities clearly. |
| `afbin query <ref> [<ref> ...]` | C | Run reads or explicit mutations; execute locally when engines and inputs permit. [^query] [^latest-main] | **Partial** — Local/remote reads and direct SQL writes exist; declared mutations and --dry-run seeded; the v1 write journal must be consolidated. | Default to reads and available local inputs. Require explicit writes; bind parameters and explain missing inputs. |
| `--input <path\|->` | C | Read SQL from a local file or stdin. [^query] | **Yes (working branch)** — File/stdin SQL input for local reads and direct dataset writes. | Read stdin only with explicit -; never hang waiting for unspecified input. |
| `--name <name>` | C | Select a declared query, named table, or—with `--write`—a declared mutation. [^query] | **Partial** — Named reads implemented; declared mutation selection remains. | Require an existing name when selecting; explain available names. No guessed query/mutation. |
| `--param <name=value>` | C | Supply a typed query/mutation parameter; repeat for multiple parameters. [^query] | **Partial** — Scalar binding and declared read defaults/types work; declared mutation validation remains. | Use declared defaults; report missing required parameters. Reject unknown or invalid values. |
| `--write` | C | Explicitly execute a supported row mutation. [^query] | **Partial** — Direct dataset SQL uses a frozen operation and receipt through a separate v1 journal; consolidation onto recoverableOperation and declared mutations are C. | Omitted → read-only. Never infer permission to mutate from SQL or a query name. |
| `--remote` | C | Refresh remote observations/inputs for a read before execution. [^query] | **Partial** — Remote reads exist; draft freshness and mixed-source semantics remain. | Omitted → local observations where supported; requested → refresh only. |
| `-n, --dry-run` | C | Validate a requested mutation and report its planned effect without applying it. [^query] | **Yes** (C, merged 2026-09-11) — see the seed files and the app `cli-*` tests. | No side effects or auth setup; report missing credentials/capabilities clearly. |
| `--limit <n>` | C | Bound a returned read page. [^query] | **Yes (working branch)** — Local and remote read pages default to 20; stale-input cursors are rejected. | Default to 20 results; accept 1–100. Include next cursor when more results exist. |
| `--cursor <cursor>` | C | Continue one read result where supported. [^query] | **Yes (working branch)** — Local and remote read pages default to 20; stale-input cursors are rejected. | Omitted → first page. Reject mismatched/expired cursors; explain how to restart. |
| `-o, --output <path\|->` | C | Write results; defaults to stdout. [^query] | **Partial** — File/stdout output works; multi-result/directory behavior remains. | Default to stdout; reject conflicting output modes or ambiguous multiple results. |
| `--format <table\|csv\|json\|yaml>` | C | Result representation. [^query] | **Yes, current reads** — Table/CSV/JSON/YAML; remaining query modes need integration. | Infer only where documented; reject unsupported or contradictory representations locally. Enum values ignore case. [^syntax] |
| `afbin open <ref> [<ref> ...]` | B | Open the published view of a resource, or print its URL with `--no-browser`; there is no local draft preview. [^open] | **Yes** (B, merged 2026-09-11) — `seed-commands.test.ts`, `cli-fork.test.ts`, `cli-export.test.ts`. | Local path → local preview; remote ref → published view. Failed browser launch → usable URL. |
| `--no-browser` | B | Return preview/view URLs without launching a browser. [^open] | **Yes** (B, merged 2026-09-11) — `seed-commands.test.ts`, `cli-fork.test.ts`, `cli-export.test.ts`. | Return a usable URL without launching a browser; preserve preview/session lifecycle. |
| `afbin setup` | P | Automatically authenticate and prepare local skills when needed; resume the requested operation after browser approval. [^setup] | **Partial (working branch)** — Agent invocations now authenticate, wait and resume; concurrent approval is shared. Full harness/browser/release validation remains. [^implementation] | No TTY still allows browser approval; wait and resume original operation. Reuse valid credentials and saved selections. [^setup] |
| `--harness <claude\|codex\|pi\|opencode\|none>` | P | Select a local skill destination; repeat for several. [^setup] | **Yes, selection** — Case-normalized harness choices; full release/harness validation remains. | Reuse saved selections, otherwise detected defaults; none is exclusive. No terminal checklist for agent calls. [^setup] Enum values ignore case. [^syntax] |
| `--no-browser` | P | Emit the approval URL without launching a browser. [^setup] | **Partial (working branch)** — Auth suppression/waiting is implemented; open/remote behavior remains pending. [^implementation] | Print usable URLs; do not infer this flag from missing TTY. Auth waits remain bounded. [^setup] |
| `-n, --dry-run` | P | Report configuration, authentication needs, skill destinations, and proposed changes without initiating approval or modifying local state. [^setup] | **Yes, current setup** — Reports without approval or local writes; retain across added setup behavior. | No side effects or auth setup; report missing credentials/capabilities clearly. |
| `afbin update` | D | Explicitly update the compatible binary and skills; report plugin refresh requirements. [^update] | **Yes** (D, merged 2026-09-11) — The server names its compatible release at `/chat/release.json`; bytes and checksums come from the GitHub release; npm update path deleted; installed or updated skills report their path and a restart hint where the harness needs one. Only darwin-arm64 validated on this host. | Reuse saved harnesses; already current → success. Verify downloads and preserve recoverable installation. [^defaults] |
| `--harness <claude\|codex\|pi\|opencode\|none>` | D | Same selection semantics as `setup`. [^update] | **Yes, selection** — Same normalized choices as setup; final update integration remains. | Reuse saved selections, otherwise detected defaults; none is exclusive. No terminal checklist for agent calls. [^setup] Enum values ignore case. [^syntax] |
| `-n, --dry-run` | D | Resolve the compatible release and report binary/skill changes without installing them. [^update] | **Yes** (D, merged 2026-09-11) — `seed-distribution.test.ts`, `update.test.ts`, `teaching.test.ts`, `cli-install.test.mjs`, `cli-release.test.mjs`. | No side effects or auth setup; report missing credentials/capabilities clearly. |
| `afbin remote [<command> [args ...]]` | P | Launch a local terminal with browser access, or attach to an existing session. [^remote] | **Partial** — Local terminal launch and browser access exist; --session attach seeded. | Interactive omission → picker; agent invocation needs explicit command/session. Preserve session identity on reconnect. |
| `--name <name>` | P | Name a newly created terminal session. [^remote] | **Yes** — Names a new terminal session. | Optional for new sessions; choose a non-colliding default. Reject when attaching to an existing session. |
| `--session <ref>` | P | Attach to an existing authorized session instead of launching a new command; mutually exclusive with a command and `--name`. [^remote] | **Yes** (ff2034b0) — Controller mirror over view/input/control; never registers a runner; 410 reported. Runner re-attach by local recovery key pending. `seed-primary.test.ts`. | Attach to the exact authorized session; never create a replacement silently. |
| `--no-browser` | P | Print the session URL without opening a browser. [^remote] | **Yes** (P, merged 2026-09-11) — see the seed files and the app `cli-*` tests. | Return a usable URL without launching a browser; preserve preview/session lifecycle. |
| `afbin help [<command-or-topic>]` | D | Read bundled command, schema and authoring guidance offline. [^help] | **Yes** (D, merged 2026-09-11) — text, markdown and man generated from the registry; no HTTP, npm or MCP teaching; YAML schema topics remain a primary follow-up. | No topic → command list. Always offline; unknown topic → valid alternatives. |
| `--format <text\|markdown\|man>` | D | Select a bundled documentation representation. [^help] | **Yes** (D, merged 2026-09-11) — `seed-distribution.test.ts`, `update.test.ts`, `teaching.test.ts`, `cli-install.test.mjs`, `cli-release.test.mjs`. | Infer only where documented; reject unsupported or contradictory representations locally. Enum values ignore case. [^syntax] |
| `-o, --output <path\|->` | D | Write the requested help; defaults to stdout. [^help] | **Yes** (D, merged 2026-09-11) — `seed-distribution.test.ts`, `update.test.ts`, `teaching.test.ts`, `cli-install.test.mjs`, `cli-release.test.mjs`. | Default to stdout; reject conflicting output modes or ambiguous multiple results. |
| `afbin api <path>` | — | Remove after native command/YAML coverage is verified. [^removals] | **Removed** — Deleted at the seed commit (2026-09-11); retired syntax is an unknown command or flag. | Reject retired syntax with the canonical replacement; no compatibility alias or silent reinterpretation. |
| `-X, --method <method>` (old `api`) | — | Remove HTTP-method selection. [^removals] | **Removed** — Deleted at the seed commit (2026-09-11); retired syntax is an unknown command or flag. | Reject retired syntax with the canonical replacement; no compatibility alias or silent reinterpretation. |
| `--input <path\|->` (old `api`) | — | Remove raw request-body input; retain domain input elsewhere. [^removals] | **Removed** — Deleted at the seed commit (2026-09-11); retired syntax is an unknown command or flag. | Reject retired syntax with the canonical replacement; no compatibility alias or silent reinterpretation. |
| `--body-file <path\|->` (old `comment`) | — | Replace with --input. [^removals] | **Removed** — Deleted at the seed commit (2026-09-11); retired syntax is an unknown command or flag. | Reject retired syntax with the canonical replacement; no compatibility alias or silent reinterpretation. |
| `--reply <thread-id>` (old `comment`) | — | Replace with --thread. [^removals] | **Removed** — Deleted at the seed commit (2026-09-11); retired syntax is an unknown command or flag. | Reject retired syntax with the canonical replacement; no compatibility alias or silent reinterpretation. |
| `--resolve` (old `comment`) | — | Replace with --state resolved/open. [^removals] | **Removed** — Deleted at the seed commit (2026-09-11); retired syntax is an unknown command or flag. | Reject retired syntax with the canonical replacement; no compatibility alias or silent reinterpretation. |
| `afbin ls`, `afbin rm` (aliases) | — | Remove aliases; retain list and delete. [^removals] | **Removed** — Deleted at the seed commit (2026-09-11); retired syntax is an unknown command or flag. | Reject retired syntax with the canonical replacement; no compatibility alias or silent reinterpretation. |
| `afbin pull <ref> <destination>` (old positional form) | — | Replace destination positional with --output. [^removals] [^latest-main] | **Partial** — Shared merge, conflict records, force backups and native YAML source tracking exist; stdout, conversion, dataset definitions and the session kind are seeded. | Retired destinations are no longer interpreted; use --output. |

[^audit]: Status reconciled against implementation code at the revision 2 seed commit (2026-09-11). **Yes** describes the stated bounded behavior; **Partial** leaves the named gaps open; **No** means missing. These are not claims of fresh end-to-end validation. Footnote acceptance requirements still apply even where a bounded behavior is marked Yes. See the handoff evidence and risk register for exact verification limits.

[^global]: **Common behavior — behavior and required work.**

    With no command, run `setup`.

    Common flags retain the same meaning wherever supported:

    Only applicable flags are accepted by each command; an unsupported flag is an error. Every command supports help/version/server/yes; every command except the streaming `remote` supports `--json`. Help and version never consume the other flags' operational effects.

    `<ref>` always means a URL, ID, or local path, optionally followed by `@version`. An existing complete filename wins. Resource kinds use `--type`, not alternate ID prefixes. Published references inside document content use `ref:<id>`; query-result bindings use `$name`.

    Repeat positional references for multiple targets. Omitted targets select only the explicitly documented defaults below. Multiple writes are independently conditional and recoverable; results identify each target and partial completion. A failed batch is not reported as globally atomic.

    **Acceptance / remaining work:** Complete consistent resource resolution, batch semantics and domain schemas. Keep validation, ordinary diff/status/help and unchanged ordinary push local; fetch only needed remote inputs and label cached observations. Apply the same vocabulary to parser, help, man pages, errors, skills and plugins. Remove obsolete surfaces without compatibility aliases. Verify every UI operation has a native command/YAML representation and test agent task completion without raw API use.

    **`-h, --help`:** Print bundled help for this command. Offline; no authentication or writes.

    **Acceptance / remaining work:** Retain offline execution; document the completed command set.

    **`--version`:** Print the installed CLI version and protocol version. Offline.

    **Acceptance / remaining work:** Include protocol in plain output as described.

    **`--json`:** Emit structured command results to stdout; diagnostics go to stderr. File contents selected with `--output` are separate from this result envelope.

    **Acceptance / remaining work:** Define result envelopes, partial failures and output-file/stdout interactions consistently.

    **`--server <origin>`:** Select the server. Explicit flag overrides the tracked workspace origin, then `ARTIFACTBIN_URL`, then saved configuration/default. Credentials remain origin-scoped and are stored one file per origin under the state directory (`~/.artifactbin`, or `ARTIFACTBIN_HOME`), so switching origins selects the matching credential without re-approval; the first origin set up is the default.

    **Acceptance / remaining work:** Retain precedence across new commands; cover localhost in validation.

    **`-y, --yes`:** Accept the command's stated confirmation defaults without terminal prompts. Never approves browser authentication or bypasses permissions.

    **Acceptance / remaining work:** Reuse for new confirmation flows without adding implicit privileges.

    **`-n, --dry-run`:** Describe and validate the proposed changes without applying them, changing local tracking, installing files, refreshing credentials, or sending invitations. Contact the server only when authoritative validation is necessary.

    **Acceptance / remaining work:** Add only to the mutation/export/install commands listed below and preserve no-write/no-auth-refresh guarantees.

    **`-f, --force`:** Explicitly permit the documented overwrite for this command. Never bypass validation, permissions, or conditional-write checks.

    **Acceptance / remaining work:** Implement each documented overwrite/backup contract without bypassing conditional writes.

    **`--remote`:** Refresh the remote observations used by an otherwise local operation. Never change remote content.

    **Acceptance / remaining work:** Add explicit refresh behavior to the other listed commands.

    **`--type <type>`:** Select the kind of resource being addressed or listed. The same type names apply across commands.

    **Acceptance / remaining work:** Implement shared parsing/validation and the per-command behavior below.

    **`--input <path\|->`:** Read command input from a local file, or stdin for `-`. The command defines its domain format; never an HTTP payload.

    **Acceptance / remaining work:** Implement domain text/SQL inputs and remove raw API payload semantics.

    **`-o, --output <path\|->`:** Write resulting content to a file/directory, or stdout for `-`. Multiple outputs require a directory. Never silently overwrite an unrelated file.

    **Acceptance / remaining work:** Implement shared parsing/validation and the per-command behavior below.

    **`--format <format>`:** Select the content representation, such as JSX, YAML, CSV, JSON, HTML, or PNG, where that resource supports it. Distinct from `--json`, which formats the command result.

    **Acceptance / remaining work:** Implement shared parsing/validation and the per-command behavior below.

    **`--in <ref>`:** Scope the operation to a containing resource: a folder, artifact, or dataset.

    **Acceptance / remaining work:** Implement shared parsing/validation and the per-command behavior below.

    **`--filter <field=value>`:** Apply a typed filter; repeat to combine filters. Supported fields are documented per resource type; unknown fields and invalid values fail locally.

    **Acceptance / remaining work:** Implement shared parsing/validation and the per-command behavior below.

    **`--limit <n>`:** Return at most `n` results in a page, from 1 to 100.

    **Acceptance / remaining work:** Reuse this validation in new paginated operations.

    **`--cursor <cursor>`:** Continue the same query using its returned cursor.

    **Acceptance / remaining work:** Bind cursors to the same target/filter/query and reject ambiguous multi-target continuation.

[^pull]: **`afbin pull` — behavior and required work.**

    Retrieve artifacts or account resources into editable local files. With no references, refresh tracked files of the selected type; do not silently fetch an entire account. With `--type profile` and no reference, retrieve the current account's profile.

    Documents use fenced JSX. Non-document resource definitions use typed YAML. Dataset rows and original asset bytes keep their appropriate file formats, with CLI-managed metadata alongside them. Pull includes editable sharing/permission state that the caller is authorized to inspect.

    For an existing tracked copy, reconcile local document edits with remote changes using the same shared node-scoped splice/rebase rules as the server and browser editor. Rebase edits affecting unrelated source spans; overlapping node spans conflict. Do not introduce a separate line-based merge strategy or infer conflicts solely from persistent node IDs. Preserve both proposals in .artifactbin/conflicts.json on conflict and report affected regions; status reports conflicted and ordinary push stays blocked. Resolve the working file, then use push --force to conditionally accept that proposal, or pull --force to accept remote content with a recoverable local backup. Archive resolved conflict records. Merge YAML metadata by field against its saved base: preserve one-sided changes, accept identical changes, and require resolution for divergent changes to the same field. Treat sharing lists as permission state, never automatically union them or silently broaden access. Binary conflicts require an explicit choice. An unchanged remote head leaves local edits untouched. Export and fork use their own commands. An explicit `ref@version` retrieves that historical content instead of merging it into the current content; refuse locally modified targets unless `--force` is supplied. Inspect the resulting diff, then push conditionally against the observed current head to revert.

    **Acceptance / remaining work:** Reuse shared node-scoped rebasing locally, preserve both proposals on conflict, and integrate conflict state with push. Add field-aware YAML reconciliation, typed account/resource files, full authorized sharing state, multiple targets and the listed output flags. Retain safe conditional historical restoration; cache observations/content and avoid fetching cached immutable versions again.

    **`--type <artifact\|folder\|dataset\|file\|profile\|session>`:** Interpret the targets as the selected resource type; default `artifact`. Secret values are never returned.

    **Acceptance / remaining work:** Add the flag and described behavior, using shared validation and help definitions.

    **`-o, --output <path\|->`:** Destination file/directory. Defaults to the tracked path, otherwise a collision-checked suggested filename. Stdout does not establish tracking.

    **Acceptance / remaining work:** Replace positional destination with --output and implement safe stdout/multi-target behavior.

    **`--format <jsx\|yaml\|csv\|json\|original>`:** Select a supported editable local representation; default to the resource’s native representation. Rendered output uses `export`.

    **Acceptance / remaining work:** Add explicit supported editable formats.

    **`-f, --force`:** Replace locally changed tracked content after preserving a recoverable local copy. Never erase an uncertain pending write.

    **Acceptance / remaining work:** Add recoverable backup and protect unresolved/pending work.

    **`-n, --dry-run`:** Show what would be retrieved, converted, or replaced without writing files or changing tracking.

    **Acceptance / remaining work:** Add preview of merge/conflict and typed-resource retrieval.

[^fork]: **`afbin fork` — behavior and required work.**

    Create new editable local drafts from existing resources or local drafts. Remove source write identity and invitations, preserve dependency references, record `forked_from: <source id>` in the fence or YAML, and use private sharing defaults. Nothing is published until `push`; the first push sends `forked_from` on create and the server stores lineage when the source is readable by the actor. Folders and Postgres-backed datasets refuse with `not_forkable`. The server fork route is not used. Explicit targets are required.

    **Acceptance / remaining work:** Implement local draft creation, safe identity/permission stripping, retained lineage and dependencies, multiple targets, and conditional first-push creation. Reuse local source files; retrieve only missing remote source data.

    **`--type <artifact\|folder\|dataset\|file>`:** Select the source resource type when it cannot be inferred. Fork only the selected resource; folder children and referenced resources are not recursively copied.

    **Acceptance / remaining work:** Implement this flag with the described semantics; reuse shared parsing and validation.

    **`-o, --output <path>`:** Destination for the new editable draft; defaults to a collision-checked suggested filename. Multiple sources require a directory. Never overwrite a source or existing destination.

    **Acceptance / remaining work:** Implement this flag with the described semantics; reuse shared parsing and validation.

    **`-n, --dry-run`:** Show new local files, retained dependencies, and sharing defaults without creating files or resources.

    **Acceptance / remaining work:** Implement this flag with the described semantics; reuse shared parsing and validation.

[^export]: **`afbin export` — behavior and required work.**

    Export screenshots, rendered pages, dataset results, or original asset bytes. Data formats export local working content without publishing and work for remote refs and `@version`. Image and HTML formats are produced by the server for the current head of a published artifact; a tracked local file that is byte-identical to its observed head may be exported that way, a modified draft is refused with `renderer_unavailable`, and drafts are never uploaded for rendering. Exports do not establish or replace editable tracking.

    **Acceptance / remaining work:** Implement supported render/data/original-byte exports, deterministic format selection, local engines, explicit missing-capability diagnostics and safe output handling. Cover the product’s existing screenshot capture modes and selectors in bundled export schemas/help; do not silently publish drafts or upload them for rendering.

    **`--type <artifact\|folder\|dataset\|file>`:** Select the resource type when it cannot be inferred. Unsupported resource/format combinations fail with the supported choices.

    **Acceptance / remaining work:** Implement this flag with the described semantics; reuse shared parsing and validation.

    **`--format <png\|jpg\|html\|csv\|json\|yaml\|original>`:** Select the export representation. Infer it from a recognized output extension; otherwise require this flag. A conflicting extension is an error. `png`, `jpg` and `html` are rendered by the server for the current head of a published artifact; a modified local draft fails with `renderer_unavailable` and `ref@version` fails with `unsupported_version_export`.

    **Acceptance / remaining work:** Implement this flag with the described semantics; reuse shared parsing and validation.

    **`-o, --output <path\|->`:** Write exported content; default to a collision-checked filename. Multiple outputs require a directory. Stdout supports one output and is incompatible with `--json`, which emits a separate result envelope.

    **Acceptance / remaining work:** Implement this flag with the described semantics; reuse shared parsing and validation.

    **`--name <name>`:** Select a named table/query result, with the same meaning as in `query`.

    **Acceptance / remaining work:** Implement this flag with the described semantics; reuse shared parsing and validation.

    **`--page <n>`:** Select a 1-based slide/page for a paginated document, with the same meaning as in `open`.

    **Acceptance / remaining work:** Implement this flag with the described semantics; reuse shared parsing and validation.

    **`-f, --force`:** Replace an existing untracked export destination after preserving a recoverable copy. Never overwrite tracked source files.

    **Acceptance / remaining work:** Implement this flag with the described semantics; reuse shared parsing and validation.

    **`-n, --dry-run`:** Validate export inputs and report destinations and required capabilities without rendering or writing output.

    **Acceptance / remaining work:** Implement this flag with the described semantics; reuse shared parsing and validation.

[^push]: **`afbin push` — behavior and required work.**

    Create or update resources from local files. With no references, push changed tracked files only. Ordinary targets must be local files; remote IDs/URLs are accepted only with `--restore` or `--refresh`.

    Document edits use the same node-scoped rebase rules as pull and the existing server editor protocol. A stale base alone does not reject unrelated edits; overlapping touched spans require resolution. Metadata accompanying content must not silently switch the operation to whole-document replacement and lose these semantics. Server-side validation and conditional commit remain authoritative. The file defines the operation's domain state: document content and metadata, folder settings, dataset definitions/rows, or profile settings. YAML also expresses personal state such as liking an artifact or following a user. Resource-specific validation and authorization apply; these are typed resource files, not generic request bodies.

    Sharing is part of the resource's YAML: `visibility`, `link`, `shares` entries containing `email` and `role`, and dataset `access`. The same push publishes content and permission changes. Omitted fields preserve existing values; explicit lists replace their corresponding lists, so `shares: []` removes explicit invitations. Ordinary pull includes the current values. Content and governance changes on one resource commit together or are refused together. Invitations are sent only after a successful commit and are not duplicated by retries.

    Other editable product metadata—including description and default color mode—also belongs in YAML, rather than one flag per property. Fields invisible or unavailable to the caller are never represented as empty values that a later push could overwrite. Secret values come from `--secret-env NAME` and are never copied into tracked YAML, definitions, output, or journals; the bound secret id is what the definition references.

    `--restore` and `--refresh` are mutually exclusive. Unchanged ordinary pushes perform no network requests. All remote mutations use durable recovery records; secret-bearing operations use redacted records and an operation identifier instead of persisting secrets. There is no separate metadata, sharing, invitation, like, follow, folder-create, or connection-create command.

    **Acceptance / remaining work:** Retain node-scoped rebasing when metadata accompanies edits; commit content/governance atomically. Add typed folders, dataset definitions, restore and refresh; session YAML is read-only. Define explicit secret input/output and one-time token delivery without journaling secrets. Extend durable recovery to every mutation and handle local edits made while a response is in flight without losing either writer.

    **`--type <artifact\|folder\|dataset\|file\|profile\|session>`:** Select the type when it cannot be determined from a typed file or tracking. A conflicting file type is an error. `session` accepts no push; terminate with `delete --type session`.

    **Acceptance / remaining work:** Add the flag and described behavior, using shared validation and help definitions.

    **`--restore`:** Restore the selected soft-deleted resources, preserving identity and applicable permissions. For a local file, restore first and apply its desired state conditionally. No target means no action, not bulk restoration.

    **Acceptance / remaining work:** Add the flag and described behavior, using shared validation and help definitions.

    **`--refresh`:** Refresh the selected resources' declared external data or imported assets. Requires explicit targets; reports what changed and preserves the resource identity.

    **Acceptance / remaining work:** Add the flag and described behavior, using shared validation and help definitions.

    **`-n, --dry-run`:** Validate content, dependencies, permissions, sharing deltas, and the proposed operation without committing.

    **Acceptance / remaining work:** Extend preflight to full sharing/resources and shared merge semantics.

    **`-f, --force`:** Observe the current remote head and conditionally replace it with the local proposal. A race after observation still fails. Never fixes invalid content or overrides ownership checks.

    **Acceptance / remaining work:** Extend consistently to supported resource kinds.

[^validate]: **`afbin validate` — behavior and required work.**

    Validate local document content, resource YAML, sharing fields, references, queries, and dependencies. With no paths, validate tracked files. Static validation runs locally and does not authenticate.

    Use `push --dry-run` when checking the exact proposed publication and its conditions.

    **Acceptance / remaining work:** Add shared typed-resource, permission and query validation locally; add explicit read-only remote checks. Reuse server validation rules without importing server boot/database dependencies.

    **`--fix`:** Apply explicitly documented mechanical corrections locally. Never invent permissions, change sharing intent, or publish.

    **Acceptance / remaining work:** Preserve narrow safe fixes while expanding schemas.

    **`--remote`:** Additionally check server-dependent constraints without persisting a preview or mutation. If authentication is needed, report how to authenticate rather than modifying credentials.

    **Acceptance / remaining work:** Add the flag and described behavior, using shared validation and help definitions.

[^status]: **`afbin status` — behavior and required work.**

    Report local changes, observed remote versions, pending recovery, selected account/server, and installed CLI/skill versions. With no references, summarize the current workspace and installation. Default output uses local state and explicitly labels remote information as last observed.

    **Acceptance / remaining work:** Add target/type selection, pending/conflict reporting and local account/CLI/skill/plugin version provenance. Keep default status network-free; make remote refresh explicit and clearly distinguish observed from current state.

    **`--type <artifact\|folder\|dataset\|file\|profile\|session>`:** Restrict the tracked resources being reported.

    **Acceptance / remaining work:** Add the flag and described behavior, using shared validation and help definitions.

    **`--remote`:** Refresh remote status, authorization, and resource conditions. Does not publish or update the CLI/skills.

    **Acceptance / remaining work:** Extend to listed resource/authorization conditions without installing updates.

[^diff]: **`afbin diff` — behavior and required work.**

    Compare local content, metadata, sharing, and personal-state changes with the accepted base. With no references, compare changed tracked files. Historical `@version` references select the comparison base without changing the working file or the current-head write condition.

    Binary resources report metadata and byte-level change summaries rather than fabricated text diffs. Secret values are always redacted.

    **Acceptance / remaining work:** Add multiple targets, typed resource/permission/personal-state differences, output handling and redaction. Show actionable node-scoped conflict regions while retaining familiar text diffs. Keep remote comparisons from changing the accepted write base.

    **`--type <artifact\|folder\|dataset\|file\|profile\|session>`:** Select the resource type when it is not inferable.

    **Acceptance / remaining work:** Add the flag and described behavior, using shared validation and help definitions.

    **`--remote`:** Refresh the comparison base from the server.

    **Acceptance / remaining work:** Extend to new types and multiple targets.

    **`-o, --output <path\|->`:** Write the diff; defaults to stdout.

    **Acceptance / remaining work:** Add the flag and described behavior, using shared validation and help definitions.

[^list]: **`afbin list` — behavior and required work.**

    List discoverable resources or read the selected resources' summaries. With no references, list the current account's accessible artifacts, including items shared with it. Use type and filters to select other collections. Listing remote collections is a remote operation; it never downloads full content unless the selected information requires it.

    Trash listing, the following view, token listing, activity and analytics are deferred; see Deferred features. There is no separate search, trash, activity, analytics, or account-token-list command.

    **Acceptance / remaining work:** Add session and table collections, exact-ref summaries, typed filters, scoped listing and output formats. Fetch summaries rather than full artifacts; validate filters locally.

    **`--type <artifact\|folder\|dataset\|file\|profile\|table\|session>`:** Select a resource collection; default `artifact`. `table` lists the discovered schemas, tables and columns of a dataset definition (`--in <dataset>`).

    **Acceptance / remaining work:** Add the flag and described behavior, using shared validation and help definitions.

    **`--in <ref>`:** Scope to a folder, artifact, user, or other supported container.

    **Acceptance / remaining work:** Add the flag and described behavior, using shared validation and help definitions.

    **`--filter <field=value>`:** Filter by supported fields such as search text, visibility, ownership/shared status, trash state, relationship, event kind, or date interval. Filter schemas are local help content.

    **Acceptance / remaining work:** Add the flag and described behavior, using shared validation and help definitions.

    **`--limit <n>`:** Page size.

    **Acceptance / remaining work:** Reuse across typed collections.

    **`--cursor <cursor>`:** Continue the same filtered collection.

    **Acceptance / remaining work:** Bind to selected type/container/filters.

    **`-o, --output <path\|->`:** Write the listing; defaults to stdout.

    **Acceptance / remaining work:** Add the flag and described behavior, using shared validation and help definitions.

    **`--format <table\|csv\|json\|yaml>`:** Representation of the returned collection. `--json` selects the structured result envelope, including pagination.

    **Acceptance / remaining work:** Add the flag and described behavior, using shared validation and help definitions.

[^log]: **`afbin log` — behavior and required work.**

    Read version history for the selected versioned resources. `@version` starts at that version or earlier. Account-wide activity is `list --type activity`.

    **Acceptance / remaining work:** Add multiple targets, supported versioned resource types and typed filters; enforce per-target pagination. Cache immutable history entries where useful without presenting a cached head as current.

    **`--type <artifact\|folder\|dataset\|file>`:** Select a versioned resource type; default inferred/artifact.

    **Acceptance / remaining work:** Add the flag and described behavior, using shared validation and help definitions.

    **`--filter <field=value>`:** Filter supported history fields such as author or date interval.

    **Acceptance / remaining work:** Add the flag and described behavior, using shared validation and help definitions.

    **`--limit <n>`:** Page size per target.

    **Acceptance / remaining work:** Apply independently to each target.

    **`--cursor <cursor>`:** Continue one target's history; incompatible with multiple targets.

    **Acceptance / remaining work:** Retain single-target restriction.

[^delete]: **`afbin delete` — behavior and required work.**

    Soft-delete artifacts, folders, datasets and files, terminate remote sessions, or delete comments according to the selected type. Preserve local source files. Never interprets omitted references as “delete everything.” Each result states the domain action taken.

    Repeated deletion/revocation of the same owned resource is recoverable and does not affect another resource. Permanent deletion is exposed only if the product provides it, through an explicit future contract rather than overloading `--force`.

    **Acceptance / remaining work:** Add typed session/comment actions, multiple targets and durable operation identities. Preserve enough identity/state for restoration and reconcile descendants/dependencies. Specify supported permanent deletion only after checking the product contract; never hide it behind force.

    **`--type <artifact\|folder\|dataset\|file\|session\|comment>`:** Select the resource type; default inferred/artifact.

    **Acceptance / remaining work:** Add the flag and described behavior, using shared validation and help definitions.

    **`--in <ref>`:** Identify the containing artifact when deleting comments.

    **Acceptance / remaining work:** Add the flag and described behavior, using shared validation and help definitions.

    **`-n, --dry-run`:** Show affected resources, descendants, dependencies, and authorization checks without applying deletion/revocation.

    **Acceptance / remaining work:** Extend to all supported typed actions and affected descendants/dependencies.

    **`-f, --force`:** Permit deleting an asset that is still referenced, after reporting affected references. Does not bypass permissions, active-operation checks, or make a soft deletion permanent.

    **Acceptance / remaining work:** Retain narrow meaning across added resource actions.

[^comment]: **`afbin comment` — behavior and required work.**

    With no mutation flags, list threads and replies. Mutation flags create an anchored thread, reply, or change thread state. Multiple references support listing or posting the same explicitly supplied comment on each target; validation is performed for every target before starting the batch.

    New threads require `--node` or `--quote`; replies retain the thread's anchor. Posting and resolving use durable operation identities so retries do not duplicate comments. Deleting a comment uses `delete --type comment --in <artifact> <comment-id>`.

    **Acceptance / remaining work:** Add --thread, --input, --state, filtering, dry-run and multi-target behavior. Route comment deletion through delete. Persist operation identities for posts/replies/state changes; enforce anchor validation and authorization. Remove --body-file, --reply and --resolve after teaching their replacements.

    **`--body <text>`:** Comment/reply text.

    **Acceptance / remaining work:** Reuse for multiple targets; add durable write recovery.

    **`--input <path\|->`:** Read comment/reply text from a file or stdin; mutually exclusive with `--body`.

    **Acceptance / remaining work:** Replace --body-file with --input; preserve file/stdin and exclusivity checks.

    **`--thread <thread-id>`:** Select an existing thread for a reply and/or state change. Requires exactly one artifact.

    **Acceptance / remaining work:** Replace --reply with --thread for both replying and state changes.

    **`--node <node-id>`:** Anchor a new thread to an existing persistent node.

    **Acceptance / remaining work:** Reuse in dry-run and batch validation.

    **`--quote <text>`:** Anchor a new thread to a uniquely matching quote; mutually exclusive with `--node`.

    **Acceptance / remaining work:** Reuse in dry-run and batch validation.

    **`--state <open\|resolved>`:** Reopen or resolve the thread selected by `--thread`; can accompany a reply.

    **Acceptance / remaining work:** Replace --resolve with --state open/resolved.

    **`--filter <field=value>`:** Filter listed threads by supported fields, including state and author. Listing only.

    **Acceptance / remaining work:** Add the flag and described behavior, using shared validation and help definitions.

    **`--limit <n>`:** Thread page size. Listing only.

    **Acceptance / remaining work:** Retain mutation-mode rejection.

    **`--cursor <cursor>`:** Continue one artifact's thread listing. Listing only; one target.

    **Acceptance / remaining work:** Retain single-target/listing-only restriction.

    **`-n, --dry-run`:** Check anchors, thread state, permissions, and proposed changes without posting. Mutation mode only.

    **Acceptance / remaining work:** Add the flag and described behavior, using shared validation and help definitions.

[^query]: **`afbin query` — behavior and required work.**

    Read dataset rows or execute a document's declared queries. Local files execute locally where the required engine and inputs are available; unavailable remote inputs are identified explicitly. With no query input or name, a dataset returns its rows and a document runs its declared read queries.

    Mutation permissions and dataset read-only policies apply equally to UI and CLI. Writes use conditional, recoverable transactions through `recoverableOperation`. Connected datasets are defined by a `.jsx` `<Dataset>` definition named as the dataset YAML `source`; source discovery is `list --type table --in <dataset>`.

    **Acceptance / remaining work:** Implement local execution for available engines/inputs and explicit remote execution when required; define cache freshness. Cover declared reads, parameters, dataset reads/mutations and notebook cell/dependency previews. Use shared query validation and conditional recoverable writes; keep read-only execution the default.

    **`--input <path\|->`:** Read SQL from a local file or stdin. SQL addresses the selected dataset's named tables, not HTTP routes. Requires one dataset target.

    **Acceptance / remaining work:** Implement this flag with the described semantics; reuse shared parsing and validation.

    **`--name <name>`:** Select a declared query, named table, or—with `--write`—a declared mutation.

    **Acceptance / remaining work:** Implement this flag with the described semantics; reuse shared parsing and validation.

    **`--param <name=value>`:** Supply a typed query/mutation parameter; repeat for multiple parameters. Bind parameters rather than interpolate SQL text.

    **Acceptance / remaining work:** Implement this flag with the described semantics; reuse shared parsing and validation.

    **`--write`:** Explicitly execute a supported row mutation. Requires one target and either a declared mutation name or supported SQL input. Read-only execution is the default.

    **Acceptance / remaining work:** Implement this flag with the described semantics; reuse shared parsing and validation.

    **`--remote`:** Refresh remote observations/inputs for a read before execution. Cannot accompany `--write`.

    **Acceptance / remaining work:** Implement this flag with the described semantics; reuse shared parsing and validation.

    **`-n, --dry-run`:** Validate a requested mutation and report its planned effect without applying it. Requires `--write`; never executes arbitrary side effects to simulate them.

    **Acceptance / remaining work:** Implement this flag with the described semantics; reuse shared parsing and validation.

    **`--limit <n>`:** Bound a returned read page. Does not silently limit which rows a mutation changes.

    **Acceptance / remaining work:** Implement this flag with the described semantics; reuse shared parsing and validation.

    **`--cursor <cursor>`:** Continue one read result where supported.

    **Acceptance / remaining work:** Implement this flag with the described semantics; reuse shared parsing and validation.

    **`-o, --output <path\|->`:** Write results; defaults to stdout. Multiple named/target results require a directory or structured JSON output.

    **Acceptance / remaining work:** Implement this flag with the described semantics; reuse shared parsing and validation.

    **`--format <table\|csv\|json\|yaml>`:** Result representation.

    **Acceptance / remaining work:** Implement this flag with the described semantics; reuse shared parsing and validation.

[^open]: **`afbin open` — behavior and required work.**

    Open the published view of an existing artifact or of a tracked local file in the browser. There is no local draft preview: rendering needs runtime Tailwind and the React SSR bundle, which the CLI does not ship, and drafts are never uploaded. An untracked or modified local file fails with `unpublished_draft`. Browser layout, drag gestures, and interactive viewing remain browser operations.

    For `open` only, `--json` suppresses launching the resulting view URL. It does not suppress browser authentication needed to resolve an authorized remote resource; only explicit `--no-browser` does that.

    **Acceptance / remaining work:** Implement published view opening for refs and tracked files, no-browser output and the `unpublished_draft` refusal; no implicit publish, no network for tracked local files.

    **`--no-browser`:** Return preview/view URLs without launching a browser.

    **Acceptance / remaining work:** Implement this flag with the described semantics; reuse shared parsing and validation.

[^setup]: **`afbin setup` — behavior and required work.**

    Authenticate, save private local credentials, and prepare selected local skills automatically when a requested operation needs them. A missing TTY means no terminal prompts, not no browser: both user and agent invocations should open the local browser when approval is needed, wait within the approval window, then continue the original operation without requiring the agent to run setup or handle credentials. With valid credentials, continue immediately; refresh expired credentials silently first, and open browser approval only when refresh cannot restore authentication. Reuse saved harness selections or detected defaults; expose any required user choices in the browser instead of blocking an agent on a terminal checklist. Local-only commands and unchanged pushes must still complete without authentication or network access; dry-run must not initiate authentication or mutate credentials.

    `--yes` accepts selected local installation changes, not browser approval. Store credentials under `~/.artifactbin/` with private permissions. A plugin can invoke this same setup flow after ensuring that the compatible binary is installed; it does not introduce a different authentication command.

    **Acceptance / remaining work:** Decouple browser availability and approval waiting from TTY detection. Add automatic first-use setup and browser reauthentication to agent-invoked commands, preserving their original arguments and safe write identity. Coalesce concurrent authentication requests by server so multiple agents reuse one approval rather than opening duplicate tabs. Resume the original operation after approval; preserve account/origin checks and do not replay writes with unknown outcomes blindly. Keep progress on stderr and final results on stdout. For an unavailable browser, emit an actionable approval URL; for denial, expiry or interruption, return structured status and retain valid resumable state without looping indefinitely. Add explicit no-browser and dry-run. Complete plugin bootstrap using the same compatible binary/setup flow. Verify first use, valid credentials, refresh success/failure, no TTY with a desktop browser, headless use, denial, timeout, concurrent invocations, interruption, wrong-account approval and nonduplicating write resumption across supported harnesses. Never treat --yes as browser consent.

    **`--harness <claude\|codex\|pi\|opencode\|none>`:** Select a local skill destination; repeat for several. `none` is exclusive. Otherwise use saved selections, or preselect detected harnesses in an interactive checklist.

    **Acceptance / remaining work:** Reuse selection for plugin bootstrap without duplicate unmanaged installs.

    **`--no-browser`:** Emit the approval URL without launching a browser; continue bounded approval waiting and resume the operation if approved. No TTY alone must not imply this flag. Apply the flag consistently to commands that may need browser authentication; it must not disable silent token refresh.

    **Acceptance / remaining work:** Expose browser suppression independently of terminal mode and share its parsing with all authentication-capable commands.

    **`-n, --dry-run`:** Report configuration, authentication needs, skill destinations, and proposed changes without initiating approval or modifying local state.

    **Acceptance / remaining work:** Add the flag and described behavior, using shared validation and help definitions.

[^update]: **`afbin update` — behavior and required work.**

    Update the installed CLI and selected local skills to the newest compatible published release. Reuse the saved harness selection by default. Verify downloaded files, preserve a recoverable previous binary, and report plugin-managed copies that require the owning harness to refresh its plugin cache.

    Normal authoring commands do not check for updates. Installed plugin and standalone skill copies must report their source/version consistently; update does not silently edit a harness-owned immutable plugin cache.

    **Acceptance / remaining work:** Add dry-run, plugin-copy provenance and owning-harness refresh guidance. Wire compatible plugin publication into release/deployment, keep plugin versions monotonic, and replace unpublished npm instructions with the verified installer. Keep ordinary authoring free of update polls and remove obsolete npm update paths.

    **`--harness <claude\|codex\|pi\|opencode\|none>`:** Same selection semantics as `setup`.

    **Acceptance / remaining work:** Retain saved selections and consistent destination reporting.

    **`-n, --dry-run`:** Resolve the compatible release and report binary/skill changes without installing them.

    **Acceptance / remaining work:** Add the flag and described behavior, using shared validation and help definitions.

[^remote]: **`afbin remote` — behavior and required work.**

    Launch an agent/command in a local terminal with browser access, or attach to an existing session. Omitted command opens an interactive agent picker; a noninteractive caller must provide a command or an existing session. Attachment is a controller mirror over the session view, input and control routes; when a local recovery key for the session exists under `~/.artifactbin/remote/`, the CLI re-attaches as the runner instead.

    Flags after the command belong to the child command. Streaming terminal output does not support `--json` or pretend to be a paginated result. List sessions with `list --type session`, edit supported session configuration through YAML and `push`, and terminate a session with `delete --type session`.

    **Acceptance / remaining work:** Add attach/no-browser flags, deterministic noninteractive requirements and typed session read/edit/terminate support through existing commands. Reuse authentication and keep terminal streaming separate from structured command output.

    **`--name <name>`:** Name a newly created terminal session.

    **Acceptance / remaining work:** Reject alongside session attachment.

    **`--session <ref>`:** Attach to an existing authorized session instead of launching a new command; mutually exclusive with a command and `--name`.

    **Acceptance / remaining work:** Add the flag and described behavior, using shared validation and help definitions.

    **`--no-browser`:** Print the session URL without opening a browser.

    **Acceptance / remaining work:** Add the flag and described behavior, using shared validation and help definitions.

[^help]: **`afbin help` — behavior and required work.**

    Print bundled command help, resource/YAML schemas, permission rules, references, markup, templates, themes, examples, or recovery guidance. With no topic, show the command list. Help teaches native commands and local file formats; there is no `api` command or endpoint-reference topic.

    `afbin <command> -h`, `afbin help <command>`, generated man pages, installed skills, and plugin guidance describe the same flags and examples.

    **Acceptance / remaining work:** Generate command/flag documentation, domain/YAML schemas, man pages and examples from shared definitions. Remove endpoint teaching and obsolete commands from all local skills, discovery pages and plugin packages. Align errors and validations with the same recovery instructions and verify agents can complete tasks from bundled guidance.

    **`--format <text\|markdown\|man>`:** Select a bundled documentation representation.

    **Acceptance / remaining work:** Add the flag and described behavior, using shared validation and help definitions.

    **`-o, --output <path\|->`:** Write the requested help; defaults to stdout.

    **Acceptance / remaining work:** Add the flag and described behavior, using shared validation and help definitions.

[^removals]: **Retired surfaces.** All of the following were deleted at the revision 2 seed commit (2026-09-11): `afbin api`, `-X/--method`, raw JSON `--input`, `--body-file`, `--reply`, `--resolve`, the `ls` and `rm` aliases, the positional pull destination and the `operations` help topic. No compatibility aliases exist; retired syntax is an unknown command or flag. The original requirements follow for the record.

    **`afbin api <path>`:** **Acceptance / remaining work:** Remove the raw HTTP escape hatch after native command/YAML coverage is implemented and verified. Migrate all generated help, skills, plugin packages, examples and errors; do not retain a compatibility alias.

    **`-X, --method <method>` (old `api`):** **Acceptance / remaining work:** Remove with api; agents select domain commands rather than HTTP methods.

    **`--input <path\|->` (old `api`):** **Acceptance / remaining work:** Remove raw JSON request-body behavior with api. The shared --input flag remains for documented comment/SQL domain input.

    **`--body-file <path\|->` (old `comment`):** **Acceptance / remaining work:** Remove; replace with comment --input. Update all teaching and errors without a compatibility alias.

    **`--reply <thread-id>` (old `comment`):** **Acceptance / remaining work:** Remove; replace with comment --thread for replies and state transitions.

    **`--resolve` (old `comment`):** **Acceptance / remaining work:** Remove; replace with comment --state resolved, and support --state open for reopening.

    **`afbin ls`, `afbin rm` (aliases):** **Acceptance / remaining work:** Remove redundant aliases; teach and accept list and delete as the single canonical command names.

    **`afbin pull <ref> <destination>` (old positional form):** **Acceptance / remaining work:** Remove the destination positional form; use pull <ref> --output <path>. Repeated positionals then consistently identify sources.


[^defaults]: **Forgiving defaults are a required contract, not a claim that they already work.** The implementation column records current command coverage; default/recovery behavior must also be verified before a row is considered complete.

    Agent callers should invoke the desired command directly. For operations needing authentication, reuse credentials, refresh silently, or open browser approval and resume the same operation. Missing TTY disables terminal prompts, not browser use. Coalesce simultaneous approval requests and preserve the selected server/account. See the setup footnote for first-use and recovery scenarios.

    Local-only work, unchanged ordinary pushes, help and version must not trigger authentication or update checks. Dry-run must not set up credentials or mutate files. Use saved choices and documented defaults; never guess destructive targets, broaden sharing, or silently choose an ambiguous reference.

    All paginated commands default to 20 results and return continuation information. Default row bounds apply to reads, never to the set of rows changed by a mutation. Empty results and already-satisfied operations are successful when authorization and resource identity are established.

    Bound waiting and retries. Retry only operations known to be safe, or recover through the same durable operation identity. Preserve local proposals and pending writes after interruption; do not duplicate remote mutations or replace sessions on an unknown outcome. Browser failure, denial, expiry, missing inputs and conflicts need actionable diagnostics and structured outcomes without polluting stdout.

    Validate these defaults with no saved setup, valid/expired/revoked credentials, agent pipes versus a terminal, unavailable browser/network, concurrent invocations, interrupted writes, missing workspaces, empty collections and conflicting inputs. No default grants browser approval or bypasses authorization.


[^syntax]: **Case handling and familiar argument syntax.** Fixed enum values are ASCII case-insensitive: `--format PNG`, `--type DATASET`, `--harness Codex` and `--state Resolved` normalize to their documented lowercase values. Recognized file extensions are compared case-insensitively without changing the filename. Apply the same normalization only to CLI-owned fixed enums in YAML and filters, such as visibility, built-in sharing roles and access. User-defined policy roles, model identifiers, SQL names, embedded JSON Schema keywords and user-defined enum values retain their domain semantics and exact spelling.

    Command names, option names and schema keys remain exact lowercase spellings. Never lowercase paths, IDs, URL paths, node/thread IDs, named queries/tables, parameter names, cursor/token values, passwords or user content. Respect filesystem and domain-specific comparison rules. Suggest corrections for unknown names without silently executing a different command.

    Support --flag=value and --flag value, documented short options, and -- to terminate option parsing for dash-prefixed paths. Do not abbreviate long options or retain legacy aliases. The remote command forwards child arguments unchanged after the child command boundary. Optional setup must never consume the requested operation’s stdin.

    Keep data on stdout, progress on stderr, stable structured errors and nonzero failure exits. Reject contradictory output selections locally: --json may accompany file output, but never mix a separate result envelope with exported bytes on stdout. For collection commands without a file destination, --json selects the structured JSON result; incompatible non-JSON --format choices must be rejected. Document resource/format support and defaults in the same bundled schemas used by validation.

    **Acceptance / remaining work:** Implement normalization once in shared typed argument/schema validation and reuse it across commands, YAML, filters, help and diagnostics. Verify mixed-case enums are accepted while case-sensitive identities and data remain byte-for-byte unchanged. These are required semantics, not a claim about the current binary.


[^latest-main]: **Historical main baseline: OSS `c99cd6e4`, production composition `81da2b9`.** This paragraph describes the starting baseline, not the current feature branch. Main now includes dataset data policies, model-backed SQL mutations and editor-access sharing management. These expand the required parity work, rather than making the missing native commands implemented.

    **Pull/push:** Round-trip authorized dataset policy configuration in typed YAML using the existing shared policy schema: table permissions, row predicates, allowed columns, presets, execution/function restrictions and generation model/call/token/document limits. Track the separate policy revision and use conditional policy writes; do not treat artifact version alone as the governance condition. Preserve server-derived actor roles/session values rather than accepting caller impersonation. Content, sharing and policy updates must have an explicit atomic contract; otherwise refuse the combined write before any partial changes.

    **Sharing:** Match current editor-access sharing rules, including capability reporting and governance validation. Do not carry forward the old owner-only assumption for sharing. Deletion/restoration remain governed by their existing owner-only contracts. Preserve private-access constraints and server authorization under concurrent changes.

    **Validate/diff/status/list:** Reuse policy schemas and static validation locally; report policy deltas/revisions, supported capabilities, generation usage and UI-visible writer relationships where authorized. Keep default local observations clearly labeled. Expose remote inspection through existing resource summaries and explicit refresh, rather than adding policy/usage command families.

    **Query:** Cover existing model-backed SQL mutations through --write and the selected document/dataset context. Preserve declared parameters, output schemas, policy checks, generation limits and usage reporting. Model/provider execution follows the server’s configured capability and authorization contract; local-first is not permission to bypass policy or copy server credentials locally. Dry-run validates without invoking a model or charging for generation.

    **Timeout/recovery:** The server allows 180 seconds of generation plus 20 seconds of mutation reply overhead; the baseline CLI request timeout was 30 seconds. Direct dataset mutation waiting/recovery now exists; extend operation-aware bounded waiting and durable recovery to remaining writes. A timed-out client must not automatically rerun billable generation. Existing per-invocation server reuse is not evidence of durable idempotency across independent client retries; verify and implement that separately.

    **Fork/restore/replace:** Main refuses some replacement/revert paths for policy-managed datasets. Respect those constraints and specify authorized copying/restoration behavior explicitly; never strip governance as a workaround. A local fork proposal must retain the policy restrictions needed to validate its eventual publication, independently of stripping source invitations and write identity.

    **Implementation validation:** Frontload policy/content transaction design, authenticated editor sharing parity, long-running mutation recovery and the shared node-scoped merge path. Exercise restrictive policies, stale policy revisions, permission loss, generation timeout and interrupted retry before marking corresponding rows complete. This audit is source inspection, not a new full test run or production verification.


[^identity]: **Artifact identity is the ID; names are decoration.** The server’s `urls.ts` explicitly resolves pretty artifact URLs by ID and treats username/title slug as decorative. CLI artifact URL resolution must use the same shared identity rules: outdated usernames, renamed titles and different casing in decorative labels must not change which artifact is selected. Do not fetch merely to validate or canonicalize decorative names; use canonical details returned by an operation when available. Keep selected-origin and permission checks intact.

    Preserve the exact case of the ID. Ignoring a decorative title is different from lowercasing an opaque identifier. Do not use fuzzy title/name matching to select an artifact for reads or writes. Name searches belong to list/filter; their results provide the IDs.

    A local filename locates bytes using filesystem rules; the embedded/tracked ID determines the remote artifact. A local rename must not create a new remote artifact. Reject contradictory or duplicate identities with a clear fix instead of guessing. Explicit fork creates a new identity. Non-artifact identifiers such as query/table/model names follow their own domain contracts and cannot be assumed to be decorative.

    **Implemented foundation / acceptance:** A shared pure reference parser now handles artifact identity. Preserve coverage for renamed/stale decorative labels, exact IDs, local renames and wrong-origin URLs. Keep only the intended canonical reference forms; this is not authorization to add legacy aliases or accept arbitrary URL routes as artifact references.

[^implementation]: **Implementation is incomplete and not deployed.** Foundation commit `253c6746` introduced automatic auth, shared reconciliation and direct SQL recovery; `67871468` added recovery/YAML foundations; `9ebe2f8e` added pull destinations/native sources; `895f66ee` added native policy/query/comment/discovery workflows; `133620ff` checkpointed partial account/profile work; the revision 2 seed commit (2026-09-11) added the full parser surface, contracts, seams and seeded tests and removed `afbin api`. Continue this branch rather than rebuilding these modules.

    **Observed evidence:** See the verified baseline section for the revision 2 observations. Earlier: the resource checkpoint passed API 1,446 tests; Node 3,856 with one skip; UI 1,383; CLI 138. Type checks and CLI build passed. Earlier foundation production build, macOS ARM64 binary SQL/PTY and a fresh noninteractive browser-auth publication flow passed; these do not validate the later account changes or final release. Profile API and CLI lost-response recovery checks and type checks passed separately. No full suite for the account checkpoint, final browser gates, Linux/x64 release validation or requested model/harness evaluation has completed.
