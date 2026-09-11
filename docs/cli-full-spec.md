# afbin CLI implementation contract and handoff

## Receiving-agent instructions

This file is the handoff; no conversation history or extra planning document is required. Follow repository AGENTS.md and relevant design notes for implementation conventions. The required CLI behavior is the command table plus its footnotes. Preserve the minimal command surface; do not add command families, raw API escape hatches, compatibility aliases, or remote skill/MCP dependencies to make implementation easier. Internal HTTP transport is expected. Existing UI/domain authorization remains authoritative.

**Repository and baseline:** Product work is in `/Users/ppsreejith/projects/artifact-bin-prod/services/artifactbin`, branch `feat/cli-full-surface`. Production wrapper is its parent repository. The original implementation worktree `/Users/ppsreejith/projects/artifactbin-cli-full` is detached and must not be used as the active branch. Start with `git status --short --branch` and `git log -8 --oneline`; preserve any later user changes. Fetch the feature branch on another machine. Do not reset to the historical main baseline. Local main names and paths are not proof of deployment.

**Delivery:** Finish all command-table requirements, update each status with its test evidence, and prepare one OSS PR with an empty body for the user to review. Do not merge that PR or advance the committed production pin before review. Distribution repository changes needed for plugin parity must be identified separately with exact repository/revision and review status; do not claim they are covered by the OSS commit or deployed merely because local files changed.

**Authority:** If you receive this entire document as the replacement primary agent, you inherit orchestration and all unassigned integration work; you are not limited to one subagent column. If delegated one workstream, follow that ownership boundary. The three named subagents have not yet launched. Missing interface skeletons/core failure tests have not yet been seeded: this is an explicit first task for the primary, not completed preparation. A single replacement agent may implement all work without artificial delegation waits.

### Existing code to extend

| Boundary | Starting points (repository-relative) |
| --- | --- |
| Command vocabulary and execution | `services/cli/src/commands.ts`, `arguments.ts`, `dispatch.ts`; `runCli(argv, CliContext)` is the real CLI integration-test entry. |
| Local/account workflows | `workspace.ts`, `account-workspace.ts`, `resource-file.ts`, `resource-pull.ts`, `pull.ts`, `sync.ts`. AccountPlan/localAccountCommand/remoteAccountCommand are partial account handlers, not a second dispatcher. |
| Safe edits and recovery | `reconcile.ts`, `conflict-state.ts`, `journal.ts`, `recoverable-operation.ts`, `pending-request.ts`; server mutation receipts and shared node editing are existing foundations. |
| Native queries | CLI `local-document-query.ts`, `remote-query.ts`, `mutation-command.ts`; app `lib/resource-query.ts`, shared dataflow evaluator and dataset policy validation. |
| Account contracts | `services/contracts/src/account-resource.ts`, `services/utils/src/account-resource.ts`, app `lib/account-profile.ts`, `lib/relations.ts`, `lib/users.ts`. Only relations.ts owns relation-table SQL. |
| Existing behavioral seeds | `services/cli/test/{automatic-auth,pull-merge,mixed-push,inflight-reconcile,resource-workflows,account-workflows,local-query}.test.ts`; app `__tests__/cli-account-resources.test.ts`. Existing checks must be extended, not replaced by mocks mirroring implementation. |
| Distribution | `services/app/public/chat/install.sh`, `components/GetStarted.tsx`, `app/llms.txt/route.ts`, `lib/plugin-package.ts`; `services/cli/scripts`, `services/cli/skill`, `scripts/__tests__/cli-install.test.mjs`, `cli-release.test.mjs`. App paths in this cell are relative to services/app. |

### Known gaps that must not disappear during handoff

- Profile work is partial: mixed artifact/account workspaces currently reject; type flags can be accepted without fully enforced semantics. Finish mixed tracking, pending file recovery ordering, in-flight edits, readonly-field validation and safe output representations. Token schema existence is not token implementation.
- Finish token creation/metadata/revocation and protected one-time credential delivery, connection/multi-table/notebook dataset definitions, session edit/attach/termination, user relationships, trash, activity and analytics. Inspect existing UI handlers for their exact supported operations; map each to table commands/YAML. Do not guess unsupported server capabilities or claim parity from endpoint counts.
- Complete durable recovery beyond direct SQL/comment creation/profile: declared mutations, deletion/restoration/refresh and token/session operations. Preserve operation identity across unknown outcomes; never expire uncertainty into permission to repeat billable work. Do not persist bearer secrets in workspace state, journals or output.
- Finish local/remote draft queries, mixed/batch reads, historical handling, missing dependencies, pull stdout/conversions and artifact-YAML source node merging. A remote fallback must execute the requested draft, never silently execute another published version.
- Implement fork/export/open and package the required local renderer/assets. Connected data stays subject to server policy; local-first is not permission to bypass it. Complete terminal attachment in remote, owned centrally; session domain handlers belong to Resources.
- Remove api/method and ls/rm after native coverage. Old comment flags and positional pull destinations are already removed: retain regression checks, do not reintroduce compatibility. Generate help/man/examples from final command/schema definitions.
- Fix stale npm guidance in homepage, llms.txt, plugin package and CLI README. `/chat/install.sh` installs CLI; `/install.sh` installs the self-hosted server. Verify download/version/checksum/PATH behavior before documenting the one-line command. Inspect both `minusxai/artifactbin-plugins` and `minusxai/artifactbin-oss-plugins`; establish the supported mirror and synchronize or retire stale distribution explicitly. Resolve CLI/plugin version compatibility and publisher/deploy wiring; a local bundle build is not external publication.

### Required acceptance scenarios

| Gate | Required observation |
| --- | --- |
| Local-first | With network disabled and an isolated home: help/version/validate/status/diff/local SQL and unchanged ordinary push succeed without auth, polling or unexpected writes. |
| Forgiving auth | Fresh no-TTY command opens approval, waits boundedly and resumes once; existing setup plus expired credentials also resumes; denial/unavailable browser/concurrent approval/localhost server selection covered. --no-browser prints and waits; dry-run never creates credentials. |
| Reconciliation | Two writers change unrelated nodes/fields and both survive; overlap retains both proposals; force is conditional with recoverable backup; edits during a response survive; content+governance is atomic or rejected before any writes. |
| Authorization and retry | Viewer/editor/owner behavior matches UI; revoked access and stale policy/state fail safely; response loss and process restart produce one logical mutation, one invitation/event, and no leaked credentials. |
| Surface consistency | Each row has parser plus behavior tests: mixed-case fixed enums, exact IDs/data, unsupported flags, ambiguous refs, no ignored flags, batch partial failures, 20-result defaults, cursor binding, stdout/file conflicts and nonzero failures. |
| UI parity | Inventory current user-visible workflows and map each to native command/YAML plus a passing real-handler check. Record unresolved gaps in this file; do not mark complete while required functionality lacks a mapping. |
| Distribution | Clean standalone install and update outside checkout; integrity failure preserves working install; all four local skill destinations; help/man/skills agree; no npm-404/MCP/raw-API teaching; record each available native platform and actual validation. |
| Agent familiarity | OpenCode with GLM-5p3-flash and pi with current DeepSeek perform publish/edit/query/share/comment/recover tasks using bundled CLI guidance alone. Record exact provider model IDs, attempts, mistakes and reruns. Timeouts or missing auth are unresolved checks, not passes. |

Use isolated test homes/data and free ports; never touch the user's running servers. The user authorized the Fireworks key from `/Users/ppsreejith/projects/artifactbin/.env` for these evals only; do not print or copy it into source/reports. If unavailable to a receiving agent, report the specific missing live-eval prerequisite and continue independent deterministic validation.

### Reproducible focused checks and evidence format

Run these from the OSS repository root after installing its pinned dependencies with `npm ci` if needed. These commands identify existing checks; the missing acceptance scenarios above still require new behavioral tests. Do not report a source-inspection status as a passing test.

```sh
# CLI auth, reconciliation and resource/account baseline
node --import tsx --test services/cli/test/automatic-auth.test.ts services/cli/test/pull-merge.test.ts services/cli/test/mixed-push.test.ts services/cli/test/inflight-reconcile.test.ts services/cli/test/resource-workflows.test.ts services/cli/test/account-workflows.test.ts services/cli/test/local-query.test.ts
# Real account API handler baseline
npm exec -- vitest run --config vitest.config.ts --project=api services/app/__tests__/cli-account-resources.test.ts
# Installer/release assembly baseline (Vitest, not node --test)
npm exec -- vitest run --config vitest.config.ts --project=node scripts/__tests__/cli-install.test.mjs scripts/__tests__/cli-release.test.mjs
# Regenerate final CLI teaching after command integration
npm run generate:teaching -w services/cli
```

For every new scenario record: command-table row, fixture/setup, invoked native command, expected output/exit, local/remote state assertion, test file, exact check command, tested commit and observed result. For retries, count committed effects rather than merely checking the response. For offline tests, make unexpected fetches fail and inspect filesystem changes. For secret tests, scan captured output/journals/tracked YAML for fixture credentials. For subprocess tests, use the freshly built CLI and isolated home/workspace, not an older installed afbin.

The receiving primary owns unresolved design details: resource schema fields and editable/read-only classification, format/type support matrix, collection filter keys, credential input/delivery and renderer lifecycle. Resolve these against existing UI/domain contracts, add the concrete schemas to bundled help and acceptance tests, and update this spec before marking those rows complete. This handoff defines the required outcomes; it does not falsely claim those missing schemas or tests already exist.

### Execution and completion procedure

1. Verify checkout and read this entire contract. Inspect the named modules and compare existing UI capabilities to the table. Resolve missing schemas/format/filter matrices in this file using existing domain semantics before implementing; unresolved design choices stay explicit.
2. Seed shared interfaces and failure assertions for permissions, merges, recovery and secret handling. Observe the intended behavioral failure. Delegate the independent owned scopes below; do not create a new planning document. Implement broad cohesive batches, using focused checks while developing.
3. Integrate only reviewed commits into feat/cli-full-surface. Reproduce implementer checks; central owner wires dispatch/contracts and regenerates teaching. Never treat an implementer's report alone as validation.
4. From OSS root run `npm run validate`, `npm test`, `npm run build`; build CLI with `npm run build -w services/cli`. Discover gates using `npm run test:gates -- --list`, run affected gates against the fresh build and final required gates. Native build/test entry points are `npm run build:binary -w services/cli` and `npm run test:binary -w services/cli`; inspect platform support before claiming cross-platform results. Run installer/release checks and the named harness evaluations. Record exact commands, revision, outcomes and limitations here.
5. Update table statuses only after acceptance evidence. Confirm clean tracked tree, pushed branch, one empty-body review PR and its CI. Final report identifies the PR, remaining external release actions and actual verification. Never call the entire rollout done before required plugin publishing and production checks are complete; these occur after authorized review/merge.

## Execution checkpoint — 2026-09-11

The command table and its normative footnotes define the required final behavior. Status entries describe implementation evidence, not permission to omit unfinished requirements. Historical test checkpoints are identified separately; accepting a flag does not count as completing its behavior. No percentage estimate substitutes for acceptance evidence.

| Workstream | Current evidence | Remaining delivery and acceptance |
| --- | --- | --- |
| Resource and account workflows | Policy/query/comment/discovery checkpoint passed the full suite. Profile YAML, CAS and lost-response recovery passed focused checks only. | Complete profile/token/connection/session resources, collection views, mixed batches and durable mutations. Verify permissions, atomicity, conflict preservation and retry without duplicate effects against real handlers. |
| Commands and local execution | Shared node merging, offline checks and local SQL exist; command coverage is partial. | Finish fork/export/open, query and pull edges, consistent type/format/output/batch behavior. Remove api and legacy aliases. Verify every command-table row, including offline defaults and actionable errors. |
| Distribution and teaching | Standalone installer exists at /chat/install.sh; homepage, llms.txt and plugin guidance still contain stale npm instructions. | Unify binary bootstrap, update skills/plugins/help/man/errors and release wiring. Verify clean install/update, available platform binaries, and OpenCode GLM-5p3-flash / pi DeepSeek familiarity. |
| Integration (primary agent) | No final PR or deployment. | Review and integrate all workstreams into one feature branch; run the full suite/build and browser gates once the batch is integrated, fix failures, and open one OSS PR with an empty body. Production pin advances only after OSS merge. |

Execution: use independently owned worktrees for parallel implementation; no two implementers edit the same checkout. Shared contracts, dispatch integration and final verification have one owner. Seed bounded briefs and behavioral checks before delegation. Run focused risk checks during implementation and broad checks at integration boundaries, rather than repeating them after each small edit. Do not expand scope beyond this table without identifying the unmet requirement.

The primary checkout is `services/artifactbin` inside the production repository, on `feat/cli-full-surface`. The former `artifactbin-cli-full` worktree is retained detached as a checkpoint. Production main and its committed submodule pin remain unchanged; the local submodule checkout intentionally shows the feature work for review.

| Command / flag | Description | Implemented now?[^audit] | Defaults & recovery (required behavior)[^defaults] |
| --- | --- | --- | --- |
| `afbin [command]` | Run setup by default; resolve artifacts by ID, tolerating decorative names. Keep local work offline. [^global] [^syntax] [^identity] | **Partial** — Default setup/common flags and artifact references exist; batch/recovery coverage varies. Case normalization is not consistently implemented. | No command → setup. Local work stays offline; remote work automatically authenticates and resumes. [^defaults] |
| `-h, --help` | Print bundled help for this command. [^global] | **Yes** — Offline bundled help. | Always offline; no authentication, setup or mutation. |
| `--version` | Print the installed CLI version and protocol version. [^global] | **Partial** — Offline; protocol is included with --json, but plain output shows only CLI version. | Always offline; no update check. |
| `--json` | Emit structured command results to stdout; diagnostics go to stderr. [^global] | **Partial** — Structured results and separate diagnostics exist; remote rejects this flag. | Keep stdout machine-readable, including errors; progress belongs on stderr. |
| `--server <origin>` | Select the server. [^global] | **Yes** — Explicit/workspace/environment/saved selection and origin-scoped credentials exist. | Reuse explicit/workspace/environment/saved origin in order; never send credentials to another origin. |
| `-y, --yes` | Accept the command's stated confirmation defaults without terminal prompts. [^global] | **Yes** — Skill-selection defaults can be accepted; browser approval remains required. | Accept stated defaults without prompts; never imply browser approval, force or broader permissions. |
| `-n, --dry-run` | Describe and validate the proposed changes without applying them, changing local tracking, installing files, refreshing credentials, or sending invitations. [^global] | **Partial** — Accepted only on pull, push and delete; these may perform remote reads/preflight. | No side effects or auth setup; report missing credentials/capabilities clearly. |
| `-f, --force` | Explicitly permit the documented overwrite for this command. [^global] | **Partial (working branch)** — Pull now preserves overwritten bytes in recoverable backups. Export overwrite support remains pending. | Only explicit overwrite permission; preserve recovery and enforce authorization. |
| `--remote` | Refresh the remote observations used by an otherwise local operation. [^global] | **Partial** — Supported on status and diff only. | Omitted → local observations where supported; requested → refresh only. |
| `--no-browser` | Suppress browser launch; print approval/view URLs instead. [^setup] | **Partial (working branch)** — Auth suppression/waiting is implemented; open/remote behavior remains pending. [^implementation] | Print usable URLs; do not infer this flag from missing TTY. Auth waits remain bounded. [^setup] |
| `--type <type>` | Select the kind of resource being addressed or listed. [^global] | **Partial** — Artifact discovery and profile-aware commands accept type; token/connection/session coverage and consistent enforcement remain. | Infer from typed file/tracking; otherwise use the documented command default. Conflicts → error, never reinterpret. Enum values ignore case. [^syntax] |
| `--input <path\|->` | Read command input from a local file, or stdin for `-`. [^global] | **Partial** — SQL and comment input work; raw API removal remains. | Read stdin only with explicit -; never hang waiting for unspecified input. |
| `-o, --output <path\|->` | Write resulting content to a file/directory, or stdout for `-`. [^global] | **Partial** — Pull and query/list outputs exist; remaining commands and batch/stdout edges remain. | Suggest a free destination; reject ambiguous multiple outputs and unrelated-file overwrite. |
| `--format <format>` | Select the content representation, such as JSX, YAML, CSV, JSON, HTML, or PNG, where that resource supports it. [^global] | **Partial** — Pull/query/list representations exist; complete format matrix remains. | Infer only where documented; reject unsupported or contradictory representations locally. Enum values ignore case. [^syntax] |
| `--in <ref>` | Scope the operation to a containing resource: a folder, artifact, or dataset. [^global] | **Partial** — Artifact folder scoping exists; other containers remain. | Infer only from unambiguous tracking; otherwise require the containing resource. |
| `--filter <field=value>` | Apply a typed filter; repeat to combine filters. [^global] | **Partial** — Artifact discovery and comment filters exist; other collections remain. | No filters → documented collection default; invalid fields/values → supported choices. |
| `--limit <n>` | Return at most `n` results in a page, from 1 to 100. [^global] | **Yes** — Validated range 1–100 on list/log/comment. | Default to 20 results; accept 1–100. Include next cursor when more results exist. |
| `--cursor <cursor>` | Continue the same query using its returned cursor. [^global] | **Yes** — Passed through list/log/comment pagination. | Omitted → first page. Reject mismatched/expired cursors; explain how to restart. |
| `afbin pull [<ref> ...]` | Retrieve editable files and reconcile tracked changes using shared node-scoped merge rules. [^pull] [^latest-main] | **Partial** — Shared merge, conflict records, force backups and native YAML source tracking exist; stdout/conversion and remaining resource kinds remain. | No refs → tracked files. Merge unrelated edits; retain local work on conflict. [^defaults] |
| `--type <artifact\|folder\|dataset\|file\|profile\|token\|connection\|session>` | Interpret the targets as the selected resource type; default `artifact`. [^pull] | **Partial** — Profile workflow exists with focused tests; other accepted type values need consistent enforcement; token/connection/session remain. | Infer from typed file/tracking; otherwise use the documented command default. Conflicts → error, never reinterpret. Enum values ignore case. [^syntax] |
| `-o, --output <path\|->` | Destination file/directory. [^pull] | **Partial (working branch)** — --output replaces positional destinations; batch directories work. Stdout and representation conversion remain. | Suggest a free destination; reject ambiguous multiple outputs and unrelated-file overwrite. |
| `--format <jsx\|yaml\|csv\|json\|original>` | Select a supported editable local representation; default to the resource’s native representation. [^pull] | **Partial** — Native YAML/source retrieval exists; full editable conversion and stdout remain. | Infer only where documented; reject unsupported or contradictory representations locally. Enum values ignore case. [^syntax] |
| `-f, --force` | Replace locally changed tracked content after preserving a recoverable local copy. [^pull] | **Yes (working branch)** — Overwritten local bytes are backed up before replacement; pending proposals are archived. | Only explicit overwrite permission; preserve recovery and enforce authorization. |
| `-n, --dry-run` | Show what would be retrieved, converted, or replaced without writing files or changing tracking. [^pull] | **Partial** — Read-only retrieval/planning exists; all resource/merge previews still need coverage. | No side effects or auth setup; report missing credentials/capabilities clearly. |
| `afbin fork <ref> [<ref> ...]` | Create a distinct local draft; publish it later with push. [^fork] [^latest-main] | **No** — Native command does not exist. | Require source; suggest a free destination. Default to private; never publish implicitly. |
| `--type <artifact\|folder\|dataset\|file>` | Select the source resource type when it cannot be inferred. [^fork] | **No** — Command and flag are proposed. | Infer from typed file/tracking; otherwise use the documented command default. Conflicts → error, never reinterpret. Enum values ignore case. [^syntax] |
| `-o, --output <path>` | Destination for the new editable draft; defaults to a collision-checked suggested filename. [^fork] | **No** — Command and flag are proposed. | Choose a free destination; never overwrite a source or existing draft. |
| `-n, --dry-run` | Show new local files, retained dependencies, and sharing defaults without creating files or resources. [^fork] | **No** — Command and flag are proposed. | No side effects or auth setup; report missing credentials/capabilities clearly. |
| `afbin export <ref> [<ref> ...]` | Export screenshots, rendered documents, data or original bytes; prefer local execution. [^export] | **No** — Native command and local rendering workflow do not exist. | Infer format from destination; choose a free filename. Missing renderer gets an actionable error; never publish implicitly. |
| `--type <artifact\|folder\|dataset\|file>` | Select the resource type when it cannot be inferred. [^export] | **No** — Command and flag are proposed. | Infer from typed file/tracking; otherwise use the documented command default. Conflicts → error, never reinterpret. Enum values ignore case. [^syntax] |
| `--format <html\|png\|csv\|json\|yaml\|original>` | Select the export representation. [^export] | **No** — Command and flag are proposed. | Infer only where documented; reject unsupported or contradictory representations locally. Enum values ignore case. [^syntax] |
| `-o, --output <path\|->` | Write exported content; default to a collision-checked filename. [^export] | **No** — Command and flag are proposed. | Suggest a free destination; reject ambiguous multiple outputs and unrelated-file overwrite. |
| `--name <name>` | Select a named table/query result, with the same meaning as in `query`. [^export] | **No** — Command and flag are proposed. | Require an existing name when selecting; explain available names. No guessed query/mutation. |
| `--page <n>` | Select a 1-based slide/page for a paginated document, with the same meaning as in `open`. [^export] | **No** — Command and flag are proposed. | 1-based; reject out-of-range values with valid range. Omitted → documented whole-resource view/export. |
| `-f, --force` | Replace an existing untracked export destination after preserving a recoverable copy. [^export] | **No** — Command and flag are proposed. | Only explicit overwrite permission; preserve recovery and enforce authorization. |
| `-n, --dry-run` | Validate export inputs and report destinations and required capabilities without rendering or writing output. [^export] | **No** — Command and flag are proposed. | No side effects or auth setup; report missing credentials/capabilities clearly. |
| `afbin push [<ref> ...]` | Publish local content and YAML settings, including sharing; preserve node-scoped rebasing. [^push] [^latest-main] | **Partial** — Content/shares and metadata/policy updates are atomic; combined content+policy delta is refused. Remaining resources and mutation recovery remain. | No refs → changed tracked files; unchanged → offline success. Authenticate/resume automatically; recover writes without duplication. [^defaults] |
| `--type <artifact\|folder\|dataset\|file\|profile\|token\|connection\|session>` | Select the type when it cannot be determined from a typed file or tracking. [^push] | **Partial** — Profile workflow exists; consistent enforcement and token/connection/session remain. | Infer from typed file/tracking; otherwise use the documented command default. Conflicts → error, never reinterpret. Enum values ignore case. [^syntax] |
| `--restore` | Restore the selected soft-deleted resources, preserving identity and applicable permissions. [^push] | **No** — This command does not accept this proposed flag. | Require explicit targets; retry the same restore safely. Never infer bulk restoration. |
| `--refresh` | Refresh the selected resources' declared external data or imported assets. [^push] | **No** — This command does not accept this proposed flag. | Require explicit targets; report changed/unchanged/failed resources independently. |
| `-n, --dry-run` | Validate content, dependencies, permissions, sharing deltas, and the proposed operation without committing. [^push] | **Partial** — Local checks plus remote preflight exist for current types. | No side effects or auth setup; report missing credentials/capabilities clearly. |
| `-f, --force` | Observe the current remote head and conditionally replace it with the local proposal. [^push] | **Yes** — Observes head and conditionally replaces; races still fail. | Only explicit overwrite permission; preserve recovery and enforce authorization. |
| `afbin validate [<path> ...]` | Validate locally; apply mechanical fixes or explicitly request remote checks. [^validate] [^latest-main] | **Partial** — Existing document/asset checks and fixes are local and unauthenticated. Expanded schemas are missing. | No paths → tracked files; offline by default. Explain fixes; apply only with --fix. |
| `--fix` | Apply explicitly documented mechanical corrections locally. [^validate] | **Yes** — Mechanical formatting is local. | Omitted → report only. Never invent content or permission changes. |
| `--remote` | Additionally check server-dependent constraints without persisting a preview or mutation. [^validate] | **No** — This command does not accept this proposed flag. | Omitted → local observations where supported; requested → refresh only. |
| `afbin status [<ref> ...]` | Report local changes, conflicts and installation state; refresh remote observations only when requested. [^status] [^latest-main] | **Partial** — Default workspace status is local and labels remote state last observed. Positional targets and the full installation/account summary are missing. | No refs → workspace/installation summary. No workspace → useful setup status; no authentication just to report status. |
| `--type <artifact\|folder\|dataset\|file\|profile\|token\|connection\|session>` | Restrict the tracked resources being reported. [^status] | **Partial** — Profile tracking exists; mixed workspaces and full resource filtering remain. | Infer from typed file/tracking; otherwise use the documented command default. Conflicts → error, never reinterpret. Enum values ignore case. [^syntax] |
| `--remote` | Refresh remote status, authorization, and resource conditions. [^status] | **Partial** — Fetches and caches tracked artifact snapshots. | Omitted → local observations where supported; requested → refresh only. |
| `afbin diff [<ref> ...]` | Compare working files against saved, historical or explicitly refreshed remote state. [^diff] [^latest-main] | **Partial** — Ordinary diff is local; historical comparisons use cache then fetch missing versions. At most one explicit ref is accepted. | No refs → changed files. Unchanged → empty success; fetch only explicitly requested missing remote/history data. |
| `--type <artifact\|folder\|dataset\|file\|profile\|connection\|session>` | Select the resource type when it is not inferable. [^diff] | **Partial** — Profile comparison exists; mixed workspaces and full type coverage remain. | Infer from typed file/tracking; otherwise use the documented command default. Conflicts → error, never reinterpret. Enum values ignore case. [^syntax] |
| `--remote` | Refresh the comparison base from the server. [^diff] | **Yes** — Fetches remote content and compares locally without moving the accepted base. | Omitted → local observations where supported; requested → refresh only. |
| `-o, --output <path\|->` | Write the diff; defaults to stdout. [^diff] | **No** — This command does not accept this proposed flag. | Default to stdout; explicit file output must not overwrite unrelated content silently. |
| `afbin list [<ref> ...]` | List resources or summaries, with consistent types, filters and pagination. [^list] [^latest-main] | **Partial** — Owned/shared discovery, filters, folder scoping and output work; exact refs and additional collections remain. | Default to accessible artifacts and bounded pagination. Empty collection → success; automatically authenticate if needed. [^defaults] |
| `--type <artifact\|folder\|dataset\|file\|user\|token\|connection\|session\|activity\|analytics>` | Select a resource collection or read-only view; default `artifact`. [^list] | **Partial** — Artifact/folder/dataset/file implemented; user/token/connection/session/activity/analytics remain. | Infer from typed file/tracking; otherwise use the documented command default. Conflicts → error, never reinterpret. Enum values ignore case. [^syntax] |
| `--in <ref>` | Scope to a folder, artifact, user, or other supported container. [^list] | **Partial** — Folder scoping implemented; other containers remain. | Infer only from unambiguous tracking; otherwise require the containing resource. |
| `--filter <field=value>` | Filter by supported fields such as search text, visibility, ownership/shared status, trash state, relationship, event kind, or date interval. [^list] | **Partial** — Search/visibility/relationship filters implemented; trash and additional collection filters remain. | No filters → documented collection default; invalid fields/values → supported choices. |
| `--limit <n>` | Page size. [^list] | **Yes** — Works for artifact listing. | Default to 20 results; accept 1–100. Include next cursor when more results exist. |
| `--cursor <cursor>` | Continue the same filtered collection. [^list] | **Yes, artifact collections** — Cursor binds account and filter set; new collections need equivalent checks. | Omitted → first page. Reject mismatched/expired cursors; explain how to restart. |
| `-o, --output <path\|->` | Write the listing; defaults to stdout. [^list] | **Yes, current collections** — Private exclusive files/stdout supported; broader batch summaries remain. | Default to stdout; reject conflicting output modes or ambiguous multiple results. |
| `--format <table\|csv\|json\|yaml>` | Representation of the returned collection. [^list] | **Yes, current collections** — Table/CSV/JSON/YAML with conflicting stdout modes rejected. | Infer only where documented; reject unsupported or contradictory representations locally. Enum values ignore case. [^syntax] |
| `afbin log <ref> [<ref> ...]` | Read version history for one or more resources. [^log] | **Partial (working branch)** — Batch history and per-target failures work; type/date/author filtering remains. | Require target; default to newest history and bounded pagination. Explain missing/inaccessible targets. [^defaults] |
| `--type <artifact\|folder\|dataset\|file>` | Select a versioned resource type; default inferred/artifact. [^log] | **No** — This command does not accept this proposed flag. | Infer from typed file/tracking; otherwise use the documented command default. Conflicts → error, never reinterpret. Enum values ignore case. [^syntax] |
| `--filter <field=value>` | Filter supported history fields such as author or date interval. [^log] | **No** — This command does not accept this proposed flag. | No filters → documented collection default; invalid fields/values → supported choices. |
| `--limit <n>` | Page size per target. [^log] | **Partial** — Works for one target. | Default to 20 results; accept 1–100. Include next cursor when more results exist. |
| `--cursor <cursor>` | Continue one target's history; incompatible with multiple targets. [^log] | **Yes** — Single-target history pagination. | Omitted → first page. Reject mismatched/expired cursors; explain how to restart. |
| `afbin delete <ref> [<ref> ...]` | Delete resources, revoke tokens or terminate sessions; preserve local source files. [^delete] | **Partial** — Single-artifact deletion preserves source files and removes tracking. Expanded actions and durable remote-deletion recovery are missing. | Require explicit targets; preserve local files. Resume confirmed same-operation retries; never infer delete-all. [^defaults] |
| `--type <artifact\|folder\|dataset\|file\|token\|connection\|session\|comment>` | Select the resource type; default inferred/artifact. [^delete] | **No** — This command does not accept this proposed flag. | Infer from typed file/tracking; otherwise use the documented command default. Conflicts → error, never reinterpret. Enum values ignore case. [^syntax] |
| `--in <ref>` | Identify the containing artifact when deleting comments. [^delete] | **No** — This command does not accept this proposed flag. | Infer only from unambiguous tracking; otherwise require the containing resource. |
| `-n, --dry-run` | Show affected resources, descendants, dependencies, and authorization checks without applying deletion/revocation. [^delete] | **Partial** — Artifact deletion server preflight exists. | No side effects or auth setup; report missing credentials/capabilities clearly. |
| `-f, --force` | Permit deleting an asset that is still referenced, after reporting affected references. [^delete] | **Yes** — Referenced-asset deletion still requires server authorization. | Only explicit overwrite permission; preserve recovery and enforce authorization. |
| `afbin comment <ref> [<ref> ...]` | List, post, reply or change thread state; reuse delete for comment removal. [^comment] | **Partial (working branch)** — Batch listing/posting, reopening and durable create/reply recovery work; dry-run and deletion remain. | No mutation flags → list. Posting requires explicit text/anchor; retries must not duplicate comments. [^defaults] |
| `--body <text>` | Comment/reply text. [^comment] | **Yes** — Text posting/replying exists. | Require nonempty text; mutually exclusive with input file/stdin. |
| `--input <path\|->` | Read comment/reply text from a file or stdin; mutually exclusive with `--body`. [^comment] | **Yes (working branch)** — --input reads comment text from a file or explicit stdin; --body-file is removed. | Read stdin only with explicit -; never hang waiting for unspecified input. |
| `--thread <thread-id>` | Select an existing thread for a reply and/or state change. [^comment] | **Yes (working branch)** — --thread selects replies/state transitions; --reply is removed. | Require one artifact and a valid thread; no anchor guessing. |
| `--node <node-id>` | Anchor a new thread to an existing persistent node. [^comment] | **Yes** — Persistent-node anchoring exists. | Validate the exact persistent node; stale/missing anchor → actionable error. |
| `--quote <text>` | Anchor a new thread to a uniquely matching quote; mutually exclusive with `--node`. [^comment] | **Yes** — Quote anchoring and node/quote exclusivity exist. | Require a unique match; report ambiguity without posting. |
| `--state <open\|resolved>` | Reopen or resolve the thread selected by `--thread`; can accompany a reply. [^comment] | **Yes (working branch)** — Explicit open/resolved transitions normalize enum case; --resolve is removed. | Require explicit open/resolved and a thread; unchanged state → safe success. Enum values ignore case. [^syntax] |
| `--filter <field=value>` | Filter listed threads by supported fields, including state and author. [^comment] | **Yes** — State and exact author filters bind pagination. | No filters → documented collection default; invalid fields/values → supported choices. |
| `--limit <n>` | Thread page size. [^comment] | **Yes** — Listing-only pagination exists. | Default to 20 results; accept 1–100. Include next cursor when more results exist. |
| `--cursor <cursor>` | Continue one artifact's thread listing. [^comment] | **Yes** — One-artifact listing pagination exists. | Omitted → first page. Reject mismatched/expired cursors; explain how to restart. |
| `-n, --dry-run` | Check anchors, thread state, permissions, and proposed changes without posting. [^comment] | **No** — This command does not accept this proposed flag. | No side effects or auth setup; report missing credentials/capabilities clearly. |
| `afbin query <ref> [<ref> ...]` | Run reads or explicit mutations; execute locally when engines and inputs permit. [^query] [^latest-main] | **Partial (working branch)** — Local and remote dataset/declared-query reads work; direct writes recover. Declared mutations and remaining draft/batch edges remain. | Default to reads and available local inputs. Require explicit writes; bind parameters and explain missing inputs. |
| `--input <path\|->` | Read SQL from a local file or stdin. [^query] | **Yes (working branch)** — File/stdin SQL input for local reads and direct dataset writes. | Read stdin only with explicit -; never hang waiting for unspecified input. |
| `--name <name>` | Select a declared query, named table, or—with `--write`—a declared mutation. [^query] | **Partial** — Named reads implemented; declared mutation selection remains. | Require an existing name when selecting; explain available names. No guessed query/mutation. |
| `--param <name=value>` | Supply a typed query/mutation parameter; repeat for multiple parameters. [^query] | **Partial** — Scalar binding and declared read defaults/types work; declared mutation validation remains. | Use declared defaults; report missing required parameters. Reject unknown or invalid values. |
| `--write` | Explicitly execute a supported row mutation. [^query] | **Partial (working branch)** — Direct dataset SQL uses a frozen operation, durable receipt and observed-state commit. | Omitted → read-only. Never infer permission to mutate from SQL or a query name. |
| `--remote` | Refresh remote observations/inputs for a read before execution. [^query] | **Partial** — Remote reads exist; draft freshness and mixed-source semantics remain. | Omitted → local observations where supported; requested → refresh only. |
| `-n, --dry-run` | Validate a requested mutation and report its planned effect without applying it. [^query] | **No** — Command and flag are proposed. | No side effects or auth setup; report missing credentials/capabilities clearly. |
| `--limit <n>` | Bound a returned read page. [^query] | **Yes (working branch)** — Local and remote read pages default to 20; stale-input cursors are rejected. | Default to 20 results; accept 1–100. Include next cursor when more results exist. |
| `--cursor <cursor>` | Continue one read result where supported. [^query] | **Yes (working branch)** — Local and remote read pages default to 20; stale-input cursors are rejected. | Omitted → first page. Reject mismatched/expired cursors; explain how to restart. |
| `-o, --output <path\|->` | Write results; defaults to stdout. [^query] | **Partial** — File/stdout output works; multi-result/directory behavior remains. | Default to stdout; reject conflicting output modes or ambiguous multiple results. |
| `--format <table\|csv\|json\|yaml>` | Result representation. [^query] | **Yes, current reads** — Table/CSV/JSON/YAML; remaining query modes need integration. | Infer only where documented; reject unsupported or contradictory representations locally. Enum values ignore case. [^syntax] |
| `afbin open <ref> [<ref> ...]` | Open published resources or preview local drafts without publishing. [^open] | **No** — Native command/local preview workflow does not exist. | Local path → local preview; remote ref → published view. Failed browser launch → usable URL. |
| `--remote` | Open the published version of a tracked local resource instead of previewing the working file. [^open] | **No** — Command and flag are proposed. | Default to local preview for local paths; this flag selects the published version. |
| `--no-browser` | Return preview/view URLs without launching a browser. [^open] | **No** — Command and flag are proposed. | Return a usable URL without launching a browser; preserve preview/session lifecycle. |
| `--page <n>` | Open a selected 1-based slide/page. [^open] | **No** — Command and flag are proposed. | 1-based; reject out-of-range values with valid range. Omitted → documented whole-resource view/export. |
| `afbin setup` | Automatically authenticate and prepare local skills when needed; resume the requested operation after browser approval. [^setup] | **Partial (working branch)** — Agent invocations now authenticate, wait and resume; concurrent approval is shared. Full harness/browser/release validation remains. [^implementation] | No TTY still allows browser approval; wait and resume original operation. Reuse valid credentials and saved selections. [^setup] |
| `--harness <claude\|codex\|pi\|opencode\|none>` | Select a local skill destination; repeat for several. [^setup] | **Yes, selection** — Case-normalized harness choices; full release/harness validation remains. | Reuse saved selections, otherwise detected defaults; none is exclusive. No terminal checklist for agent calls. [^setup] Enum values ignore case. [^syntax] |
| `--no-browser` | Emit the approval URL without launching a browser. [^setup] | **Partial (working branch)** — Auth suppression/waiting is implemented; open/remote behavior remains pending. [^implementation] | Print usable URLs; do not infer this flag from missing TTY. Auth waits remain bounded. [^setup] |
| `-n, --dry-run` | Report configuration, authentication needs, skill destinations, and proposed changes without initiating approval or modifying local state. [^setup] | **Yes, current setup** — Reports without approval or local writes; retain across added setup behavior. | No side effects or auth setup; report missing credentials/capabilities clearly. |
| `afbin update` | Explicitly update the compatible binary and skills; report plugin refresh requirements. [^update] | **Partial** — Explicit compatible binary/skill update, checksum verification and binary backups exist. Plugin reporting/integration and dry-run are missing. | Reuse saved harnesses; already current → success. Verify downloads and preserve recoverable installation. [^defaults] |
| `--harness <claude\|codex\|pi\|opencode\|none>` | Same selection semantics as `setup`. [^update] | **Yes, selection** — Same normalized choices as setup; final update integration remains. | Reuse saved selections, otherwise detected defaults; none is exclusive. No terminal checklist for agent calls. [^setup] Enum values ignore case. [^syntax] |
| `-n, --dry-run` | Resolve the compatible release and report binary/skill changes without installing them. [^update] | **No** — This command does not accept this proposed flag. | No side effects or auth setup; report missing credentials/capabilities clearly. |
| `afbin remote [<command> [args ...]]` | Launch a local terminal with browser access, or attach to an existing session. [^remote] | **Partial** — Local terminal launch and browser access exist; session attachment and typed management are missing. | Interactive omission → picker; agent invocation needs explicit command/session. Preserve session identity on reconnect. |
| `--name <name>` | Name a newly created terminal session. [^remote] | **Yes** — Names a new terminal session. | Optional for new sessions; choose a non-colliding default. Reject when attaching to an existing session. |
| `--session <ref>` | Attach to an existing authorized session instead of launching a new command; mutually exclusive with a command and `--name`. [^remote] | **No** — This command does not accept this proposed flag. | Attach to the exact authorized session; never create a replacement silently. |
| `--no-browser` | Print the session URL without opening a browser. [^remote] | **No** — This command does not accept this proposed flag. | Return a usable URL without launching a browser; preserve preview/session lifecycle. |
| `afbin help [<command-or-topic>]` | Read bundled command, schema and authoring guidance offline. [^help] | **Partial** — Bundled offline help exists but still teaches afbin api; proposed schemas and updated plugin guidance are missing. | No topic → command list. Always offline; unknown topic → valid alternatives. |
| `--format <text\|markdown\|man>` | Select a bundled documentation representation. [^help] | **No** — This command does not accept this proposed flag. | Infer only where documented; reject unsupported or contradictory representations locally. Enum values ignore case. [^syntax] |
| `-o, --output <path\|->` | Write the requested help; defaults to stdout. [^help] | **No** — This command does not accept this proposed flag. | Default to stdout; reject conflicting output modes or ambiguous multiple results. |
| `afbin api <path>` | Remove after native command/YAML coverage is verified. [^removals] | **Present — removal required.** | Reject retired syntax with the canonical replacement; no compatibility alias or silent reinterpretation. |
| `-X, --method <method>` (old `api`) | Remove HTTP-method selection. [^removals] | **Present — removal required.** | Reject retired syntax with the canonical replacement; no compatibility alias or silent reinterpretation. |
| `--input <path\|->` (old `api`) | Remove raw request-body input; retain domain input elsewhere. [^removals] | **Present — old behavior must be removed.** | Reject retired syntax with the canonical replacement; no compatibility alias or silent reinterpretation. |
| `--body-file <path\|->` (old `comment`) | Replace with --input. [^removals] | **Removed** — Canonical input/thread/state flags implemented. | Reject retired syntax with the canonical replacement; no compatibility alias or silent reinterpretation. |
| `--reply <thread-id>` (old `comment`) | Replace with --thread. [^removals] | **Removed** — Canonical input/thread/state flags implemented. | Reject retired syntax with the canonical replacement; no compatibility alias or silent reinterpretation. |
| `--resolve` (old `comment`) | Replace with --state resolved/open. [^removals] | **Removed** — Canonical input/thread/state flags implemented. | Reject retired syntax with the canonical replacement; no compatibility alias or silent reinterpretation. |
| `afbin ls`, `afbin rm` (aliases) | Remove aliases; retain list and delete. [^removals] | **Present — removal required.** | Reject retired syntax with the canonical replacement; no compatibility alias or silent reinterpretation. |
| `afbin pull <ref> <destination>` (old positional form) | Replace destination positional with --output. [^removals] [^latest-main] | **Partial** — Shared merge, conflict records, force backups and native YAML source tracking exist; stdout/conversion and remaining resource kinds remain. | Retired destinations are no longer interpreted; use --output. |

[^audit]: Status reconciled against implementation code through `133620ff` (subsequent commits before this handoff changed documentation only). **Yes** describes the stated bounded behavior; **Partial** leaves the named gaps open; **No** means missing. These are not claims of fresh end-to-end validation. Footnote acceptance requirements still apply even where a bounded behavior is marked Yes. See the handoff evidence and risk register for exact verification limits.

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

    **`--server <origin>`:** Select the server. Explicit flag overrides the tracked workspace origin, then `ARTIFACTBIN_URL`, then saved configuration/default. Credentials remain origin-scoped.

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

    **`--type <artifact\|folder\|dataset\|file\|profile\|token\|connection\|session>`:** Interpret the targets as the selected resource type; default `artifact`. Secret values are never returned.

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

    Create new editable local drafts from existing resources or local drafts. Remove source write identity and invitations, preserve dependency references and source lineage, and use safe private sharing defaults. Nothing is published until `push`; the first push creates a distinct resource. Explicit targets are required.

    **Acceptance / remaining work:** Implement local draft creation, safe identity/permission stripping, retained lineage and dependencies, multiple targets, and conditional first-push creation. Reuse local source files; retrieve only missing remote source data.

    **`--type <artifact\|folder\|dataset\|file>`:** Select the source resource type when it cannot be inferred. Fork only the selected resource; folder children and referenced resources are not recursively copied.

    **Acceptance / remaining work:** Implement this flag with the described semantics; reuse shared parsing and validation.

    **`-o, --output <path>`:** Destination for the new editable draft; defaults to a collision-checked suggested filename. Multiple sources require a directory. Never overwrite a source or existing destination.

    **Acceptance / remaining work:** Implement this flag with the described semantics; reuse shared parsing and validation.

    **`-n, --dry-run`:** Show new local files, retained dependencies, and sharing defaults without creating files or resources.

    **Acceptance / remaining work:** Implement this flag with the described semantics; reuse shared parsing and validation.

[^export]: **`afbin export` — behavior and required work.**

    Export screenshots, rendered documents, dataset results, or original asset bytes. Local paths export working content without publishing; IDs/URLs export the selected remote version. Reuse local engines and available inputs where possible; report missing rendering capabilities or remote inputs explicitly. Exports do not establish or replace editable tracking.

    **Acceptance / remaining work:** Implement supported render/data/original-byte exports, deterministic format selection, local engines, explicit missing-capability diagnostics and safe output handling. Cover the product’s existing screenshot capture modes and selectors in bundled export schemas/help; do not silently publish drafts or upload them for rendering.

    **`--type <artifact\|folder\|dataset\|file>`:** Select the resource type when it cannot be inferred. Unsupported resource/format combinations fail with the supported choices.

    **Acceptance / remaining work:** Implement this flag with the described semantics; reuse shared parsing and validation.

    **`--format <html\|png\|csv\|json\|yaml\|original>`:** Select the export representation. Infer it from a recognized output extension; otherwise require this flag. A conflicting extension is an error.

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

    Document edits use the same node-scoped rebase rules as pull and the existing server editor protocol. A stale base alone does not reject unrelated edits; overlapping touched spans require resolution. Metadata accompanying content must not silently switch the operation to whole-document replacement and lose these semantics. Server-side validation and conditional commit remain authoritative. The file defines the operation's domain state: document content and metadata, folder settings, dataset definitions/rows, connection configuration, profile settings, or remote-session configuration. YAML also expresses personal state such as liking an artifact or following a user. Resource-specific validation and authorization apply; these are typed resource files, not generic request bodies.

    Sharing is part of the resource's YAML: `visibility`, `link`, `shares` entries containing `email` and `role`, and dataset `access`. The same push publishes content and permission changes. Omitted fields preserve existing values; explicit lists replace their corresponding lists, so `shares: []` removes explicit invitations. Ordinary pull includes the current values. Content and governance changes on one resource commit together or are refused together. Invitations are sent only after a successful commit and are not duplicated by retries.

    Other editable product metadata—including description and default color mode—also belongs in YAML, rather than one flag per property. Fields invisible or unavailable to the caller are never represented as empty values that a later push could overwrite. Secret values come from an explicitly named local environment variable or protected input file and are never copied into tracked YAML, output, or journals.

    `--restore` and `--refresh` are mutually exclusive. Unchanged ordinary pushes perform no network requests. All remote mutations use durable recovery records; secret-bearing operations use redacted records and an operation identifier instead of persisting secrets. There is no separate metadata, sharing, invitation, like, follow, folder-create, or connection-create command.

    **Acceptance / remaining work:** Retain node-scoped rebasing when metadata accompanies edits; commit content/governance atomically. Add typed folders, datasets/connections, profile, token, session and personal-state YAML, sharing invitations/access, restore and refresh. Define explicit secret input/output and one-time token delivery without journaling secrets. Extend durable recovery to every mutation and handle local edits made while a response is in flight without losing either writer.

    **`--type <artifact\|folder\|dataset\|file\|profile\|token\|connection\|session>`:** Select the type when it cannot be determined from a typed file or tracking. A conflicting file type is an error.

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

    **`--type <artifact\|folder\|dataset\|file\|profile\|token\|connection\|session>`:** Restrict the tracked resources being reported.

    **Acceptance / remaining work:** Add the flag and described behavior, using shared validation and help definitions.

    **`--remote`:** Refresh remote status, authorization, and resource conditions. Does not publish or update the CLI/skills.

    **Acceptance / remaining work:** Extend to listed resource/authorization conditions without installing updates.

[^diff]: **`afbin diff` — behavior and required work.**

    Compare local content, metadata, sharing, and personal-state changes with the accepted base. With no references, compare changed tracked files. Historical `@version` references select the comparison base without changing the working file or the current-head write condition.

    Binary resources report metadata and byte-level change summaries rather than fabricated text diffs. Secret values are always redacted.

    **Acceptance / remaining work:** Add multiple targets, typed resource/permission/personal-state differences, output handling and redaction. Show actionable node-scoped conflict regions while retaining familiar text diffs. Keep remote comparisons from changing the accepted write base.

    **`--type <artifact\|folder\|dataset\|file\|profile\|connection\|session>`:** Select the resource type when it is not inferable.

    **Acceptance / remaining work:** Add the flag and described behavior, using shared validation and help definitions.

    **`--remote`:** Refresh the comparison base from the server.

    **Acceptance / remaining work:** Extend to new types and multiple targets.

    **`-o, --output <path\|->`:** Write the diff; defaults to stdout.

    **Acceptance / remaining work:** Add the flag and described behavior, using shared validation and help definitions.

[^list]: **`afbin list` — behavior and required work.**

    List discoverable resources or read the selected resources' summaries. With no references, list the current account's accessible artifacts, including items shared with it. Use type and filters to select other collections. Listing remote collections is a remote operation; it never downloads full content unless the selected information requires it.

    `list --type artifact --filter state=deleted` is the trash view. `list --type user --filter relationship=following` is the following view. Tokens are listed by safe metadata, never bearer values. There is no separate search, trash, activity, analytics, or account-token-list command.

    **Acceptance / remaining work:** Add all listed collections, exact-ref summaries, shared/owned discovery, typed filters, scoped listing and output formats. Include UI-visible account/activity/analytics views. Fetch summaries rather than full artifacts; validate filters locally.

    **`--type <artifact\|folder\|dataset\|file\|user\|token\|connection\|session\|activity\|analytics>`:** Select a resource collection or read-only view; default `artifact`. Analytics includes the metrics and time-series data available to the same user in the UI.

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

    Soft-delete artifacts/folders, revoke tokens, remove connections, terminate remote sessions, or delete comments according to the selected type. Preserve local source files. Never interprets omitted references as “delete everything.” Each result states the domain action taken.

    Repeated deletion/revocation of the same owned resource is recoverable and does not affect another resource. Permanent deletion is exposed only if the product provides it, through an explicit future contract rather than overloading `--force`.

    **Acceptance / remaining work:** Add typed token/connection/session/comment actions, multiple targets and durable operation identities. Preserve enough identity/state for restoration and reconcile descendants/dependencies. Specify supported permanent deletion only after checking the product contract; never hide it behind force.

    **`--type <artifact\|folder\|dataset\|file\|token\|connection\|session\|comment>`:** Select the resource type; default inferred/artifact.

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

    Mutation permissions and dataset read-only policies apply equally to UI and CLI. Writes use conditional, recoverable transactions. Connection creation/configuration uses YAML with `push`; source discovery is `list --type dataset --in <connection>`.

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

    Open an existing artifact in the browser, or preview a local draft without publishing it. Browser layout, drag gestures, and interactive viewing remain browser operations; their underlying content, state, and data are accessible through the other commands.

    For `open` only, `--json` suppresses launching the resulting preview/view URL. It does not suppress browser authentication needed to resolve an authorized remote resource; only explicit `--no-browser` does that. A local preview serves only its declared workspace resources and never publishes, changes permissions, or grants broader filesystem access. Export preview content with `export <local-path>`.

    **Acceptance / remaining work:** Implement local draft preview and published view opening, bounded filesystem access, page selection and no-browser output. Share rendering with export and validation; no implicit publish.

    **`--remote`:** Open the published version of a tracked local resource instead of previewing the working file.

    **Acceptance / remaining work:** Implement this flag with the described semantics; reuse shared parsing and validation.

    **`--no-browser`:** Return preview/view URLs without launching a browser.

    **Acceptance / remaining work:** Implement this flag with the described semantics; reuse shared parsing and validation.

    **`--page <n>`:** Open a selected 1-based slide/page.

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

    Launch an agent/command in a local terminal with browser access. Omitted command opens an interactive agent picker; a noninteractive caller must provide a command or an existing session.

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

[^removals]: **Retired surfaces — behavior and required work.**

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

[^implementation]: **Implementation is incomplete and not deployed.** Foundation commit `253c6746` introduced automatic auth, shared reconciliation and direct SQL recovery; `67871468` added recovery/YAML foundations; `9ebe2f8e` added pull destinations/native sources; `895f66ee` added native policy/query/comment/discovery workflows; `133620ff` checkpointed partial account/profile work. Continue this branch rather than rebuilding these modules.

    **Observed evidence:** The resource checkpoint passed API 1,446 tests; Node 3,856 with one skip; UI 1,383; CLI 138. Type checks and CLI build passed. Earlier foundation production build, macOS ARM64 binary SQL/PTY and a fresh noninteractive browser-auth publication flow passed; these do not validate the later account changes or final release. Profile API and CLI lost-response recovery checks and type checks passed separately. No full suite for the account checkpoint, final browser gates, Linux/x64 release validation or requested model/harness evaluation has completed.

## Parallel implementation assignments

The command table in cli-full-spec.md is the scope contract. Primary agent owns shared interfaces, behavioral test seeds, dispatch integration, review, cherry-picks, final validation and the single empty-body OSS PR. Implementers work in separate worktrees and do not delegate, merge, deploy or expand scope. No percentage estimates substitute for row-level evidence.

| Owner / model | Exclusive implementation scope | Acceptance |
| --- | --- | --- |
| Resources — gpt-6-astra, high | Account profile/token/connection/session domain services, typed YAML handlers, account collections, durable resource mutations and their handler tests. Finish profile recovery and mixed resource preparation. | Real-handler permission/CAS/atomicity tests; retry cannot duplicate effects; tokens stay out of YAML/journals/logs; omission preserves and explicit lists replace; all assigned resource rows mapped to evidence. |
| Commands — gpt-6-astra, high | New fork/export/preview modules and command tests; finish pull representation/stdout behavior and local/remote query edges in pull.ts, resource-pull.ts, local-document-query.ts, remote-query.ts and result-output.ts. | Local drafts never publish; private fork defaults; local preview/export with assets and data; source files survive conflicts; batch outcomes and output/type/format validation tested; no implicit network for offline operations. |
| Distribution — gpt-5.6-sol, medium | Installer/release assembly, homepage/llms/plugin install guidance, CLI README, skill installation/update packaging, plugin mirrors and packaging tests. | One verified standalone binary bootstrap; no npm-404 instructions, MCP or runtime remote skill dependency; checksum/install/update/skill placement tests; enumerate external publication still required. |
| Primary agent | contracts/utils shared schemas, commands.ts, arguments.ts, dispatch.ts, generic auth/recovery/workspace primitives, mixed-workspace orchestration, remaining collection/delete/comment wiring, generated teaching, final integration, harness evals and browser gates. | Every command-table row audited; no afbin api or legacy aliases; complete consistent help/errors/man/skills; full tests/build and affected browser flows; requested OpenCode GLM and pi DeepSeek evals; one reviewed feature branch. |

### Interface and ownership rules

- Existing parsed-command/workspace/client/result-envelope types remain the boundary. New handlers expose typed functions and receive these dependencies; they do not invent a second parser, authentication flow or transport.
- Domain writes enforce authorization and conditional state, and use the existing durable receipt mechanism. Account/profile work at 133620ff and its API/CLI tests are the initial resource seed; they are not proof of full account support.
- Primary owns shared contract changes. An implementer sends the required signature/schema before depending on it; primary supplies the common commit to affected worktrees.
- Implementers do not edit primary-owned files. Supply integration calls and command metadata requirements in the report; primary wires and generates teaching once integrated.
- Resources owns account-workspace.ts and resource domain modules; Commands owns pull/query/output modules listed above; Distribution does not edit the parser or generated teaching. Other overlapping files require explicit reassignment before editing.
- Read AGENTS.md and relevant design notes. Establish baseline tests, add behavioral failures for missing features, then implement a cohesive batch. Run targeted suites during work; only primary runs final full suites and browser gates.
- Before implementation handoff, primary seeds missing interface skeletons and core risk assertions and observes that the assertions detect the intended failure. Initial delegation may inspect scope/baseline and identify concrete seed requirements; it may not bypass this gate.
- Report changed files, command rows delivered, observed test commands/results, gaps and integration requirements. Commit in the isolated branch; primary reviews and reproduces checks before cherry-picking.

### Completion order

Run the three independent workstreams concurrently once seeded. Primary resolves contract requests and completes central orchestration concurrently. Integrate resource and command handlers before regenerating final teaching. Distribution bootstrap fixes can integrate earlier. Finish with one consolidated validation/fix cycle and an empty-body OSS PR; production pin and publishing follow OSS review/merge.
