# Proposed afbin commands and flags

## Execution checkpoint — 2026-09-11

The remaining scope is frozen to the command table below. Earlier row audits are historical where superseded by this checkpoint; accepting a flag does not count as completing its behavior. No percentage estimate is used until every row has been re-audited.

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
| `--type <type>` | Select the kind of resource being addressed or listed. [^global] | **No** — Proposed flag is not implemented. | Infer from typed file/tracking; otherwise use the documented command default. Conflicts → error, never reinterpret. Enum values ignore case. [^syntax] |
| `--input <path\|->` | Read command input from a local file, or stdin for `-`. [^global] | **Partial (working branch)** — SQL input is implemented; comment migration and raw API removal remain. | Read stdin only with explicit -; never hang waiting for unspecified input. |
| `-o, --output <path\|->` | Write resulting content to a file/directory, or stdout for `-`. [^global] | **No** — Proposed flag is not implemented. | Suggest a free destination; reject ambiguous multiple outputs and unrelated-file overwrite. |
| `--format <format>` | Select the content representation, such as JSX, YAML, CSV, JSON, HTML, or PNG, where that resource supports it. [^global] | **No** — Proposed flag is not implemented. | Infer only where documented; reject unsupported or contradictory representations locally. Enum values ignore case. [^syntax] |
| `--in <ref>` | Scope the operation to a containing resource: a folder, artifact, or dataset. [^global] | **No** — Proposed flag is not implemented. | Infer only from unambiguous tracking; otherwise require the containing resource. |
| `--filter <field=value>` | Apply a typed filter; repeat to combine filters. [^global] | **No** — Proposed flag is not implemented. | No filters → documented collection default; invalid fields/values → supported choices. |
| `--limit <n>` | Return at most `n` results in a page, from 1 to 100. [^global] | **Yes** — Validated range 1–100 on list/log/comment. | Default to 20 results; accept 1–100. Include next cursor when more results exist. |
| `--cursor <cursor>` | Continue the same query using its returned cursor. [^global] | **Yes** — Passed through list/log/comment pagination. | Omitted → first page. Reject mismatched/expired cursors; explain how to restart. |
| `afbin pull [<ref> ...]` | Retrieve editable files and reconcile tracked changes using shared node-scoped merge rules. [^pull] [^latest-main] | **Partial (working branch)** — Node-scoped local merging and force backups now pass focused tests. Typed resource coverage, full sharing and explicit conflict resolution remain. [^implementation] | No refs → tracked files. Merge unrelated edits; retain local work on conflict. [^defaults] |
| `--type <artifact\|folder\|dataset\|file\|profile\|token\|connection\|session>` | Interpret the targets as the selected resource type; default `artifact`. [^pull] | **No** — This command does not accept this proposed flag. | Infer from typed file/tracking; otherwise use the documented command default. Conflicts → error, never reinterpret. Enum values ignore case. [^syntax] |
| `-o, --output <path\|->` | Destination file/directory. [^pull] | **Partial (working branch)** — --output replaces positional destinations; batch directories work. Stdout and representation conversion remain. | Suggest a free destination; reject ambiguous multiple outputs and unrelated-file overwrite. |
| `--format <jsx\|yaml\|csv\|json\|original>` | Select a supported editable local representation; default to the resource’s native representation. [^pull] | **No** — Representation is currently inferred. | Infer only where documented; reject unsupported or contradictory representations locally. Enum values ignore case. [^syntax] |
| `-f, --force` | Replace locally changed tracked content after preserving a recoverable local copy. [^pull] | **Yes (working branch)** — Overwritten local bytes are backed up before replacement; pending proposals are archived. | Only explicit overwrite permission; preserve recovery and enforce authorization. |
| `-n, --dry-run` | Show what would be retrieved, converted, or replaced without writing files or changing tracking. [^pull] | **Partial** — Current pull fetches without writing; proposed merges/types are absent. | No side effects or auth setup; report missing credentials/capabilities clearly. |
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
| `afbin push [<ref> ...]` | Publish local content and YAML settings, including sharing; preserve node-scoped rebasing. [^push] [^latest-main] | **Partial (working branch)** — Mixed metadata/content edits now reconcile before conditional writes. Atomic sharing/policy coverage and broader recovery remain. [^implementation] | No refs → changed tracked files; unchanged → offline success. Authenticate/resume automatically; recover writes without duplication. [^defaults] |
| `--type <artifact\|folder\|dataset\|file\|profile\|token\|connection\|session>` | Select the type when it cannot be determined from a typed file or tracking. [^push] | **No** — This command does not accept this proposed flag. | Infer from typed file/tracking; otherwise use the documented command default. Conflicts → error, never reinterpret. Enum values ignore case. [^syntax] |
| `--restore` | Restore the selected soft-deleted resources, preserving identity and applicable permissions. [^push] | **No** — This command does not accept this proposed flag. | Require explicit targets; retry the same restore safely. Never infer bulk restoration. |
| `--refresh` | Refresh the selected resources' declared external data or imported assets. [^push] | **No** — This command does not accept this proposed flag. | Require explicit targets; report changed/unchanged/failed resources independently. |
| `-n, --dry-run` | Validate content, dependencies, permissions, sharing deltas, and the proposed operation without committing. [^push] | **Partial** — Local checks plus remote preflight exist for current types. | No side effects or auth setup; report missing credentials/capabilities clearly. |
| `-f, --force` | Observe the current remote head and conditionally replace it with the local proposal. [^push] | **Yes** — Observes head and conditionally replaces; races still fail. | Only explicit overwrite permission; preserve recovery and enforce authorization. |
| `afbin validate [<path> ...]` | Validate locally; apply mechanical fixes or explicitly request remote checks. [^validate] [^latest-main] | **Partial** — Existing document/asset checks and fixes are local and unauthenticated. Expanded schemas are missing. | No paths → tracked files; offline by default. Explain fixes; apply only with --fix. |
| `--fix` | Apply explicitly documented mechanical corrections locally. [^validate] | **Yes** — Mechanical formatting is local. | Omitted → report only. Never invent content or permission changes. |
| `--remote` | Additionally check server-dependent constraints without persisting a preview or mutation. [^validate] | **No** — This command does not accept this proposed flag. | Omitted → local observations where supported; requested → refresh only. |
| `afbin status [<ref> ...]` | Report local changes, conflicts and installation state; refresh remote observations only when requested. [^status] [^latest-main] | **Partial** — Default workspace status is local and labels remote state last observed. Positional targets and the full installation/account summary are missing. | No refs → workspace/installation summary. No workspace → useful setup status; no authentication just to report status. |
| `--type <artifact\|folder\|dataset\|file\|profile\|token\|connection\|session>` | Restrict the tracked resources being reported. [^status] | **No** — This command does not accept this proposed flag. | Infer from typed file/tracking; otherwise use the documented command default. Conflicts → error, never reinterpret. Enum values ignore case. [^syntax] |
| `--remote` | Refresh remote status, authorization, and resource conditions. [^status] | **Partial** — Fetches and caches tracked artifact snapshots. | Omitted → local observations where supported; requested → refresh only. |
| `afbin diff [<ref> ...]` | Compare working files against saved, historical or explicitly refreshed remote state. [^diff] [^latest-main] | **Partial** — Ordinary diff is local; historical comparisons use cache then fetch missing versions. At most one explicit ref is accepted. | No refs → changed files. Unchanged → empty success; fetch only explicitly requested missing remote/history data. |
| `--type <artifact\|folder\|dataset\|file\|profile\|connection\|session>` | Select the resource type when it is not inferable. [^diff] | **No** — This command does not accept this proposed flag. | Infer from typed file/tracking; otherwise use the documented command default. Conflicts → error, never reinterpret. Enum values ignore case. [^syntax] |
| `--remote` | Refresh the comparison base from the server. [^diff] | **Yes** — Fetches remote content and compares locally without moving the accepted base. | Omitted → local observations where supported; requested → refresh only. |
| `-o, --output <path\|->` | Write the diff; defaults to stdout. [^diff] | **No** — This command does not accept this proposed flag. | Default to stdout; explicit file output must not overwrite unrelated content silently. |
| `afbin list [<ref> ...]` | List resources or summaries, with consistent types, filters and pagination. [^list] [^latest-main] | **Partial** — Remote artifact listing with pagination exists; typed collections, explicit refs and filters are missing. | Default to accessible artifacts and bounded pagination. Empty collection → success; automatically authenticate if needed. [^defaults] |
| `--type <artifact\|folder\|dataset\|file\|user\|token\|connection\|session\|activity\|analytics>` | Select a resource collection or read-only view; default `artifact`. [^list] | **No** — This command does not accept this proposed flag. | Infer from typed file/tracking; otherwise use the documented command default. Conflicts → error, never reinterpret. Enum values ignore case. [^syntax] |
| `--in <ref>` | Scope to a folder, artifact, user, or other supported container. [^list] | **No** — This command does not accept this proposed flag. | Infer only from unambiguous tracking; otherwise require the containing resource. |
| `--filter <field=value>` | Filter by supported fields such as search text, visibility, ownership/shared status, trash state, relationship, event kind, or date interval. [^list] | **No** — This command does not accept this proposed flag. | No filters → documented collection default; invalid fields/values → supported choices. |
| `--limit <n>` | Page size. [^list] | **Yes** — Works for artifact listing. | Default to 20 results; accept 1–100. Include next cursor when more results exist. |
| `--cursor <cursor>` | Continue the same filtered collection. [^list] | **Partial** — Works for artifact listing, without proposed filters. | Omitted → first page. Reject mismatched/expired cursors; explain how to restart. |
| `-o, --output <path\|->` | Write the listing; defaults to stdout. [^list] | **No** — This command does not accept this proposed flag. | Default to stdout; reject conflicting output modes or ambiguous multiple results. |
| `--format <table\|csv\|json\|yaml>` | Representation of the returned collection. [^list] | **No** — This command does not accept this proposed flag. | Infer only where documented; reject unsupported or contradictory representations locally. Enum values ignore case. [^syntax] |
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
| `--filter <field=value>` | Filter listed threads by supported fields, including state and author. [^comment] | **No** — This command does not accept this proposed flag. | No filters → documented collection default; invalid fields/values → supported choices. |
| `--limit <n>` | Thread page size. [^comment] | **Yes** — Listing-only pagination exists. | Default to 20 results; accept 1–100. Include next cursor when more results exist. |
| `--cursor <cursor>` | Continue one artifact's thread listing. [^comment] | **Yes** — One-artifact listing pagination exists. | Omitted → first page. Reject mismatched/expired cursors; explain how to restart. |
| `-n, --dry-run` | Check anchors, thread state, permissions, and proposed changes without posting. [^comment] | **No** — This command does not accept this proposed flag. | No side effects or auth setup; report missing credentials/capabilities clearly. |
| `afbin query <ref> [<ref> ...]` | Run reads or explicit mutations; execute locally when engines and inputs permit. [^query] [^latest-main] | **Partial (working branch)** — Local and remote dataset/declared-query reads work; direct writes recover. Declared mutations and remaining draft/batch edges remain. | Default to reads and available local inputs. Require explicit writes; bind parameters and explain missing inputs. |
| `--input <path\|->` | Read SQL from a local file or stdin. [^query] | **Yes (working branch)** — File/stdin SQL input for local reads and direct dataset writes. | Read stdin only with explicit -; never hang waiting for unspecified input. |
| `--name <name>` | Select a declared query, named table, or—with `--write`—a declared mutation. [^query] | **No** — Command and flag are proposed. | Require an existing name when selecting; explain available names. No guessed query/mutation. |
| `--param <name=value>` | Supply a typed query/mutation parameter; repeat for multiple parameters. [^query] | **Partial (working branch)** — Scalar binding and duplicate rejection work; declared-value validation remains. | Use declared defaults; report missing required parameters. Reject unknown or invalid values. |
| `--write` | Explicitly execute a supported row mutation. [^query] | **Partial (working branch)** — Direct dataset SQL uses a frozen operation, durable receipt and observed-state commit. | Omitted → read-only. Never infer permission to mutate from SQL or a query name. |
| `--remote` | Refresh remote observations/inputs for a read before execution. [^query] | **No** — Command and flag are proposed. | Omitted → local observations where supported; requested → refresh only. |
| `-n, --dry-run` | Validate a requested mutation and report its planned effect without applying it. [^query] | **No** — Command and flag are proposed. | No side effects or auth setup; report missing credentials/capabilities clearly. |
| `--limit <n>` | Bound a returned read page. [^query] | **Yes (working branch)** — Local and remote read pages default to 20; stale-input cursors are rejected. | Default to 20 results; accept 1–100. Include next cursor when more results exist. |
| `--cursor <cursor>` | Continue one read result where supported. [^query] | **Yes (working branch)** — Local and remote read pages default to 20; stale-input cursors are rejected. | Omitted → first page. Reject mismatched/expired cursors; explain how to restart. |
| `-o, --output <path\|->` | Write results; defaults to stdout. [^query] | **No** — Command and flag are proposed. | Default to stdout; reject conflicting output modes or ambiguous multiple results. |
| `--format <table\|csv\|json\|yaml>` | Result representation. [^query] | **No** — Command and flag are proposed. | Infer only where documented; reject unsupported or contradictory representations locally. Enum values ignore case. [^syntax] |
| `afbin open <ref> [<ref> ...]` | Open published resources or preview local drafts without publishing. [^open] | **No** — Native command/local preview workflow does not exist. | Local path → local preview; remote ref → published view. Failed browser launch → usable URL. |
| `--remote` | Open the published version of a tracked local resource instead of previewing the working file. [^open] | **No** — Command and flag are proposed. | Default to local preview for local paths; this flag selects the published version. |
| `--no-browser` | Return preview/view URLs without launching a browser. [^open] | **No** — Command and flag are proposed. | Return a usable URL without launching a browser; preserve preview/session lifecycle. |
| `--page <n>` | Open a selected 1-based slide/page. [^open] | **No** — Command and flag are proposed. | 1-based; reject out-of-range values with valid range. Omitted → documented whole-resource view/export. |
| `afbin setup` | Automatically authenticate and prepare local skills when needed; resume the requested operation after browser approval. [^setup] | **Partial (working branch)** — Agent invocations now authenticate, wait and resume; concurrent approval is shared. Full harness/browser/release validation remains. [^implementation] | No TTY still allows browser approval; wait and resume original operation. Reuse valid credentials and saved selections. [^setup] |
| `--harness <claude\|codex\|pi\|opencode\|none>` | Select a local skill destination; repeat for several. [^setup] | **Partial** — Selection works; enum normalization must be added. | Reuse saved selections, otherwise detected defaults; none is exclusive. No terminal checklist for agent calls. [^setup] Enum values ignore case. [^syntax] |
| `--no-browser` | Emit the approval URL without launching a browser. [^setup] | **Partial (working branch)** — Auth suppression/waiting is implemented; open/remote behavior remains pending. [^implementation] | Print usable URLs; do not infer this flag from missing TTY. Auth waits remain bounded. [^setup] |
| `-n, --dry-run` | Report configuration, authentication needs, skill destinations, and proposed changes without initiating approval or modifying local state. [^setup] | **No** — This command does not accept this proposed flag. | No side effects or auth setup; report missing credentials/capabilities clearly. |
| `afbin update` | Explicitly update the compatible binary and skills; report plugin refresh requirements. [^update] | **Partial** — Explicit compatible binary/skill update, checksum verification and binary backups exist. Plugin reporting/integration and dry-run are missing. | Reuse saved harnesses; already current → success. Verify downloads and preserve recoverable installation. [^defaults] |
| `--harness <claude\|codex\|pi\|opencode\|none>` | Same selection semantics as `setup`. [^update] | **Partial** — Selection works; enum normalization must be added. | Reuse saved selections, otherwise detected defaults; none is exclusive. No terminal checklist for agent calls. [^setup] Enum values ignore case. [^syntax] |
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
| `--body-file <path\|->` (old `comment`) | Replace with --input. [^removals] | **Present — removal required.** | Reject retired syntax with the canonical replacement; no compatibility alias or silent reinterpretation. |
| `--reply <thread-id>` (old `comment`) | Replace with --thread. [^removals] | **Present — removal required.** | Reject retired syntax with the canonical replacement; no compatibility alias or silent reinterpretation. |
| `--resolve` (old `comment`) | Replace with --state resolved/open. [^removals] | **Present — removal required.** | Reject retired syntax with the canonical replacement; no compatibility alias or silent reinterpretation. |
| `afbin ls`, `afbin rm` (aliases) | Remove aliases; retain list and delete. [^removals] | **Present — removal required.** | Reject retired syntax with the canonical replacement; no compatibility alias or silent reinterpretation. |
| `afbin pull <ref> <destination>` (old positional form) | Replace destination positional with --output. [^removals] [^latest-main] | **Removed on working branch.** | Retired destinations are no longer interpreted; use --output. |

[^audit]: Status is based on source inspection at OSS commit `c99cd6e4` (production repository main `81da2b9`), not a fresh runtime or deployment verification. **Yes** means the described existing scope is implemented; extensions can still be listed as work. **Partial** means some required behavior is missing. **No** means the proposed command or flag is absent.

[^global]: **Common behavior — behavior and required work.**

    With no command, run `setup`.

    Common flags retain the same meaning wherever supported:

    Only applicable flags are accepted by each command; an unsupported flag is an error. Every command supports help/version/server/yes; every command except the streaming `remote` supports `--json`. Help and version never consume the other flags' operational effects.

    `<ref>` always means a URL, ID, or local path, optionally followed by `@version`. An existing complete filename wins. Resource kinds use `--type`, not alternate ID prefixes. Published references inside document content use `ref:<id>`; query-result bindings use `$name`.

    Repeat positional references for multiple targets. Omitted targets select only the explicitly documented defaults below. Multiple writes are independently conditional and recoverable; results identify each target and partial completion. A failed batch is not reported as globally atomic.

    **Work:** Complete consistent resource resolution, batch semantics and domain schemas. Keep validation, ordinary diff/status/help and unchanged ordinary push local; fetch only needed remote inputs and label cached observations. Apply the same vocabulary to parser, help, man pages, errors, skills and plugins. Remove obsolete surfaces without compatibility aliases. Verify every UI operation has a native command/YAML representation and test agent task completion without raw API use.

    **`-h, --help`:** Print bundled help for this command. Offline; no authentication or writes.

    **Work:** Retain offline execution; document the completed command set.

    **`--version`:** Print the installed CLI version and protocol version. Offline.

    **Work:** Include protocol in plain output as described.

    **`--json`:** Emit structured command results to stdout; diagnostics go to stderr. File contents selected with `--output` are separate from this result envelope.

    **Work:** Define result envelopes, partial failures and output-file/stdout interactions consistently.

    **`--server <origin>`:** Select the server. Explicit flag overrides the tracked workspace origin, then `ARTIFACTBIN_URL`, then saved configuration/default. Credentials remain origin-scoped.

    **Work:** Retain precedence across new commands; cover localhost in validation.

    **`-y, --yes`:** Accept the command's stated confirmation defaults without terminal prompts. Never approves browser authentication or bypasses permissions.

    **Work:** Reuse for new confirmation flows without adding implicit privileges.

    **`-n, --dry-run`:** Describe and validate the proposed changes without applying them, changing local tracking, installing files, refreshing credentials, or sending invitations. Contact the server only when authoritative validation is necessary.

    **Work:** Add only to the mutation/export/install commands listed below and preserve no-write/no-auth-refresh guarantees.

    **`-f, --force`:** Explicitly permit the documented overwrite for this command. Never bypass validation, permissions, or conditional-write checks.

    **Work:** Implement each documented overwrite/backup contract without bypassing conditional writes.

    **`--remote`:** Refresh the remote observations used by an otherwise local operation. Never change remote content.

    **Work:** Add explicit refresh behavior to the other listed commands.

    **`--type <type>`:** Select the kind of resource being addressed or listed. The same type names apply across commands.

    **Work:** Implement shared parsing/validation and the per-command behavior below.

    **`--input <path\|->`:** Read command input from a local file, or stdin for `-`. The command defines its domain format; never an HTTP payload.

    **Work:** Implement domain text/SQL inputs and remove raw API payload semantics.

    **`-o, --output <path\|->`:** Write resulting content to a file/directory, or stdout for `-`. Multiple outputs require a directory. Never silently overwrite an unrelated file.

    **Work:** Implement shared parsing/validation and the per-command behavior below.

    **`--format <format>`:** Select the content representation, such as JSX, YAML, CSV, JSON, HTML, or PNG, where that resource supports it. Distinct from `--json`, which formats the command result.

    **Work:** Implement shared parsing/validation and the per-command behavior below.

    **`--in <ref>`:** Scope the operation to a containing resource: a folder, artifact, or dataset.

    **Work:** Implement shared parsing/validation and the per-command behavior below.

    **`--filter <field=value>`:** Apply a typed filter; repeat to combine filters. Supported fields are documented per resource type; unknown fields and invalid values fail locally.

    **Work:** Implement shared parsing/validation and the per-command behavior below.

    **`--limit <n>`:** Return at most `n` results in a page, from 1 to 100.

    **Work:** Reuse this validation in new paginated operations.

    **`--cursor <cursor>`:** Continue the same query using its returned cursor.

    **Work:** Bind cursors to the same target/filter/query and reject ambiguous multi-target continuation.

[^pull]: **`afbin pull` — behavior and required work.**

    Retrieve artifacts or account resources into editable local files. With no references, refresh tracked files of the selected type; do not silently fetch an entire account. With `--type profile` and no reference, retrieve the current account's profile.

    Documents use fenced JSX. Non-document resource definitions use typed YAML. Dataset rows and original asset bytes keep their appropriate file formats, with CLI-managed metadata alongside them. Pull includes editable sharing/permission state that the caller is authorized to inspect.

    For an existing tracked copy, reconcile local document edits with remote changes using the same shared node-scoped splice/rebase rules as the server and browser editor. Rebase edits affecting unrelated source spans; overlapping node spans conflict. Do not introduce a separate line-based merge strategy or infer conflicts solely from persistent node IDs. Preserve both proposals in .artifactbin/conflicts.json on conflict and report affected regions; status reports conflicted and ordinary push stays blocked. Resolve the working file, then use push --force to conditionally accept that proposal, or pull --force to accept remote content with a recoverable local backup. Archive resolved conflict records. Merge YAML metadata by field against its saved base: preserve one-sided changes, accept identical changes, and require resolution for divergent changes to the same field. Treat sharing lists as permission state, never automatically union them or silently broaden access. Binary conflicts require an explicit choice. An unchanged remote head leaves local edits untouched. Export and fork use their own commands. An explicit `ref@version` retrieves that historical content instead of merging it into the current content; refuse locally modified targets unless `--force` is supplied. Inspect the resulting diff, then push conditionally against the observed current head to revert.

    **Work:** Reuse shared node-scoped rebasing locally, preserve both proposals on conflict, and integrate conflict state with push. Add field-aware YAML reconciliation, typed account/resource files, full authorized sharing state, multiple targets and the listed output flags. Retain safe conditional historical restoration; cache observations/content and avoid fetching cached immutable versions again.

    **`--type <artifact\|folder\|dataset\|file\|profile\|token\|connection\|session>`:** Interpret the targets as the selected resource type; default `artifact`. Secret values are never returned.

    **Work:** Add the flag and described behavior, using shared validation and help definitions.

    **`-o, --output <path\|->`:** Destination file/directory. Defaults to the tracked path, otherwise a collision-checked suggested filename. Stdout does not establish tracking.

    **Work:** Replace positional destination with --output and implement safe stdout/multi-target behavior.

    **`--format <jsx\|yaml\|csv\|json\|original>`:** Select a supported editable local representation; default to the resource’s native representation. Rendered output uses `export`.

    **Work:** Add explicit supported editable formats.

    **`-f, --force`:** Replace locally changed tracked content after preserving a recoverable local copy. Never erase an uncertain pending write.

    **Work:** Add recoverable backup and protect unresolved/pending work.

    **`-n, --dry-run`:** Show what would be retrieved, converted, or replaced without writing files or changing tracking.

    **Work:** Add preview of merge/conflict and typed-resource retrieval.

[^fork]: **`afbin fork` — behavior and required work.**

    Create new editable local drafts from existing resources or local drafts. Remove source write identity and invitations, preserve dependency references and source lineage, and use safe private sharing defaults. Nothing is published until `push`; the first push creates a distinct resource. Explicit targets are required.

    **Work:** Implement local draft creation, safe identity/permission stripping, retained lineage and dependencies, multiple targets, and conditional first-push creation. Reuse local source files; retrieve only missing remote source data.

    **`--type <artifact\|folder\|dataset\|file>`:** Select the source resource type when it cannot be inferred. Fork only the selected resource; folder children and referenced resources are not recursively copied.

    **Work:** Implement this flag with the described semantics; reuse shared parsing and validation.

    **`-o, --output <path>`:** Destination for the new editable draft; defaults to a collision-checked suggested filename. Multiple sources require a directory. Never overwrite a source or existing destination.

    **Work:** Implement this flag with the described semantics; reuse shared parsing and validation.

    **`-n, --dry-run`:** Show new local files, retained dependencies, and sharing defaults without creating files or resources.

    **Work:** Implement this flag with the described semantics; reuse shared parsing and validation.

[^export]: **`afbin export` — behavior and required work.**

    Export screenshots, rendered documents, dataset results, or original asset bytes. Local paths export working content without publishing; IDs/URLs export the selected remote version. Reuse local engines and available inputs where possible; report missing rendering capabilities or remote inputs explicitly. Exports do not establish or replace editable tracking.

    **Work:** Implement supported render/data/original-byte exports, deterministic format selection, local engines, explicit missing-capability diagnostics and safe output handling. Cover the product’s existing screenshot capture modes and selectors in bundled export schemas/help; do not silently publish drafts or upload them for rendering.

    **`--type <artifact\|folder\|dataset\|file>`:** Select the resource type when it cannot be inferred. Unsupported resource/format combinations fail with the supported choices.

    **Work:** Implement this flag with the described semantics; reuse shared parsing and validation.

    **`--format <html\|png\|csv\|json\|yaml\|original>`:** Select the export representation. Infer it from a recognized output extension; otherwise require this flag. A conflicting extension is an error.

    **Work:** Implement this flag with the described semantics; reuse shared parsing and validation.

    **`-o, --output <path\|->`:** Write exported content; default to a collision-checked filename. Multiple outputs require a directory. Stdout supports one output and is incompatible with `--json`, which emits a separate result envelope.

    **Work:** Implement this flag with the described semantics; reuse shared parsing and validation.

    **`--name <name>`:** Select a named table/query result, with the same meaning as in `query`.

    **Work:** Implement this flag with the described semantics; reuse shared parsing and validation.

    **`--page <n>`:** Select a 1-based slide/page for a paginated document, with the same meaning as in `open`.

    **Work:** Implement this flag with the described semantics; reuse shared parsing and validation.

    **`-f, --force`:** Replace an existing untracked export destination after preserving a recoverable copy. Never overwrite tracked source files.

    **Work:** Implement this flag with the described semantics; reuse shared parsing and validation.

    **`-n, --dry-run`:** Validate export inputs and report destinations and required capabilities without rendering or writing output.

    **Work:** Implement this flag with the described semantics; reuse shared parsing and validation.

[^push]: **`afbin push` — behavior and required work.**

    Create or update resources from local files. With no references, push changed tracked files only. Ordinary targets must be local files; remote IDs/URLs are accepted only with `--restore` or `--refresh`.

    Document edits use the same node-scoped rebase rules as pull and the existing server editor protocol. A stale base alone does not reject unrelated edits; overlapping touched spans require resolution. Metadata accompanying content must not silently switch the operation to whole-document replacement and lose these semantics. Server-side validation and conditional commit remain authoritative. The file defines the operation's domain state: document content and metadata, folder settings, dataset definitions/rows, connection configuration, profile settings, or remote-session configuration. YAML also expresses personal state such as liking an artifact or following a user. Resource-specific validation and authorization apply; these are typed resource files, not generic request bodies.

    Sharing is part of the resource's YAML: `visibility`, `link`, `shares` entries containing `email` and `role`, and dataset `access`. The same push publishes content and permission changes. Omitted fields preserve existing values; explicit lists replace their corresponding lists, so `shares: []` removes explicit invitations. Ordinary pull includes the current values. Content and governance changes on one resource commit together or are refused together. Invitations are sent only after a successful commit and are not duplicated by retries.

    Other editable product metadata—including description and default color mode—also belongs in YAML, rather than one flag per property. Fields invisible or unavailable to the caller are never represented as empty values that a later push could overwrite. Secret values come from an explicitly named local environment variable or protected input file and are never copied into tracked YAML, output, or journals.

    `--restore` and `--refresh` are mutually exclusive. Unchanged ordinary pushes perform no network requests. All remote mutations use durable recovery records; secret-bearing operations use redacted records and an operation identifier instead of persisting secrets. There is no separate metadata, sharing, invitation, like, follow, folder-create, or connection-create command.

    **Work:** Retain node-scoped rebasing when metadata accompanies edits; commit content/governance atomically. Add typed folders, datasets/connections, profile, token, session and personal-state YAML, sharing invitations/access, restore and refresh. Define explicit secret input/output and one-time token delivery without journaling secrets. Extend durable recovery to every mutation and handle local edits made while a response is in flight without losing either writer.

    **`--type <artifact\|folder\|dataset\|file\|profile\|token\|connection\|session>`:** Select the type when it cannot be determined from a typed file or tracking. A conflicting file type is an error.

    **Work:** Add the flag and described behavior, using shared validation and help definitions.

    **`--restore`:** Restore the selected soft-deleted resources, preserving identity and applicable permissions. For a local file, restore first and apply its desired state conditionally. No target means no action, not bulk restoration.

    **Work:** Add the flag and described behavior, using shared validation and help definitions.

    **`--refresh`:** Refresh the selected resources' declared external data or imported assets. Requires explicit targets; reports what changed and preserves the resource identity.

    **Work:** Add the flag and described behavior, using shared validation and help definitions.

    **`-n, --dry-run`:** Validate content, dependencies, permissions, sharing deltas, and the proposed operation without committing.

    **Work:** Extend preflight to full sharing/resources and shared merge semantics.

    **`-f, --force`:** Observe the current remote head and conditionally replace it with the local proposal. A race after observation still fails. Never fixes invalid content or overrides ownership checks.

    **Work:** Extend consistently to supported resource kinds.

[^validate]: **`afbin validate` — behavior and required work.**

    Validate local document content, resource YAML, sharing fields, references, queries, and dependencies. With no paths, validate tracked files. Static validation runs locally and does not authenticate.

    Use `push --dry-run` when checking the exact proposed publication and its conditions.

    **Work:** Add shared typed-resource, permission and query validation locally; add explicit read-only remote checks. Reuse server validation rules without importing server boot/database dependencies.

    **`--fix`:** Apply explicitly documented mechanical corrections locally. Never invent permissions, change sharing intent, or publish.

    **Work:** Preserve narrow safe fixes while expanding schemas.

    **`--remote`:** Additionally check server-dependent constraints without persisting a preview or mutation. If authentication is needed, report how to authenticate rather than modifying credentials.

    **Work:** Add the flag and described behavior, using shared validation and help definitions.

[^status]: **`afbin status` — behavior and required work.**

    Report local changes, observed remote versions, pending recovery, selected account/server, and installed CLI/skill versions. With no references, summarize the current workspace and installation. Default output uses local state and explicitly labels remote information as last observed.

    **Work:** Add target/type selection, pending/conflict reporting and local account/CLI/skill/plugin version provenance. Keep default status network-free; make remote refresh explicit and clearly distinguish observed from current state.

    **`--type <artifact\|folder\|dataset\|file\|profile\|token\|connection\|session>`:** Restrict the tracked resources being reported.

    **Work:** Add the flag and described behavior, using shared validation and help definitions.

    **`--remote`:** Refresh remote status, authorization, and resource conditions. Does not publish or update the CLI/skills.

    **Work:** Extend to listed resource/authorization conditions without installing updates.

[^diff]: **`afbin diff` — behavior and required work.**

    Compare local content, metadata, sharing, and personal-state changes with the accepted base. With no references, compare changed tracked files. Historical `@version` references select the comparison base without changing the working file or the current-head write condition.

    Binary resources report metadata and byte-level change summaries rather than fabricated text diffs. Secret values are always redacted.

    **Work:** Add multiple targets, typed resource/permission/personal-state differences, output handling and redaction. Show actionable node-scoped conflict regions while retaining familiar text diffs. Keep remote comparisons from changing the accepted write base.

    **`--type <artifact\|folder\|dataset\|file\|profile\|connection\|session>`:** Select the resource type when it is not inferable.

    **Work:** Add the flag and described behavior, using shared validation and help definitions.

    **`--remote`:** Refresh the comparison base from the server.

    **Work:** Extend to new types and multiple targets.

    **`-o, --output <path\|->`:** Write the diff; defaults to stdout.

    **Work:** Add the flag and described behavior, using shared validation and help definitions.

[^list]: **`afbin list` — behavior and required work.**

    List discoverable resources or read the selected resources' summaries. With no references, list the current account's accessible artifacts, including items shared with it. Use type and filters to select other collections. Listing remote collections is a remote operation; it never downloads full content unless the selected information requires it.

    `list --type artifact --filter state=deleted` is the trash view. `list --type user --filter relationship=following` is the following view. Tokens are listed by safe metadata, never bearer values. There is no separate search, trash, activity, analytics, or account-token-list command.

    **Work:** Add all listed collections, exact-ref summaries, shared/owned discovery, typed filters, scoped listing and output formats. Include UI-visible account/activity/analytics views. Fetch summaries rather than full artifacts; validate filters locally.

    **`--type <artifact\|folder\|dataset\|file\|user\|token\|connection\|session\|activity\|analytics>`:** Select a resource collection or read-only view; default `artifact`. Analytics includes the metrics and time-series data available to the same user in the UI.

    **Work:** Add the flag and described behavior, using shared validation and help definitions.

    **`--in <ref>`:** Scope to a folder, artifact, user, or other supported container.

    **Work:** Add the flag and described behavior, using shared validation and help definitions.

    **`--filter <field=value>`:** Filter by supported fields such as search text, visibility, ownership/shared status, trash state, relationship, event kind, or date interval. Filter schemas are local help content.

    **Work:** Add the flag and described behavior, using shared validation and help definitions.

    **`--limit <n>`:** Page size.

    **Work:** Reuse across typed collections.

    **`--cursor <cursor>`:** Continue the same filtered collection.

    **Work:** Bind to selected type/container/filters.

    **`-o, --output <path\|->`:** Write the listing; defaults to stdout.

    **Work:** Add the flag and described behavior, using shared validation and help definitions.

    **`--format <table\|csv\|json\|yaml>`:** Representation of the returned collection. `--json` selects the structured result envelope, including pagination.

    **Work:** Add the flag and described behavior, using shared validation and help definitions.

[^log]: **`afbin log` — behavior and required work.**

    Read version history for the selected versioned resources. `@version` starts at that version or earlier. Account-wide activity is `list --type activity`.

    **Work:** Add multiple targets, supported versioned resource types and typed filters; enforce per-target pagination. Cache immutable history entries where useful without presenting a cached head as current.

    **`--type <artifact\|folder\|dataset\|file>`:** Select a versioned resource type; default inferred/artifact.

    **Work:** Add the flag and described behavior, using shared validation and help definitions.

    **`--filter <field=value>`:** Filter supported history fields such as author or date interval.

    **Work:** Add the flag and described behavior, using shared validation and help definitions.

    **`--limit <n>`:** Page size per target.

    **Work:** Apply independently to each target.

    **`--cursor <cursor>`:** Continue one target's history; incompatible with multiple targets.

    **Work:** Retain single-target restriction.

[^delete]: **`afbin delete` — behavior and required work.**

    Soft-delete artifacts/folders, revoke tokens, remove connections, terminate remote sessions, or delete comments according to the selected type. Preserve local source files. Never interprets omitted references as “delete everything.” Each result states the domain action taken.

    Repeated deletion/revocation of the same owned resource is recoverable and does not affect another resource. Permanent deletion is exposed only if the product provides it, through an explicit future contract rather than overloading `--force`.

    **Work:** Add typed token/connection/session/comment actions, multiple targets and durable operation identities. Preserve enough identity/state for restoration and reconcile descendants/dependencies. Specify supported permanent deletion only after checking the product contract; never hide it behind force.

    **`--type <artifact\|folder\|dataset\|file\|token\|connection\|session\|comment>`:** Select the resource type; default inferred/artifact.

    **Work:** Add the flag and described behavior, using shared validation and help definitions.

    **`--in <ref>`:** Identify the containing artifact when deleting comments.

    **Work:** Add the flag and described behavior, using shared validation and help definitions.

    **`-n, --dry-run`:** Show affected resources, descendants, dependencies, and authorization checks without applying deletion/revocation.

    **Work:** Extend to all supported typed actions and affected descendants/dependencies.

    **`-f, --force`:** Permit deleting an asset that is still referenced, after reporting affected references. Does not bypass permissions, active-operation checks, or make a soft deletion permanent.

    **Work:** Retain narrow meaning across added resource actions.

[^comment]: **`afbin comment` — behavior and required work.**

    With no mutation flags, list threads and replies. Mutation flags create an anchored thread, reply, or change thread state. Multiple references support listing or posting the same explicitly supplied comment on each target; validation is performed for every target before starting the batch.

    New threads require `--node` or `--quote`; replies retain the thread's anchor. Posting and resolving use durable operation identities so retries do not duplicate comments. Deleting a comment uses `delete --type comment --in <artifact> <comment-id>`.

    **Work:** Add --thread, --input, --state, filtering, dry-run and multi-target behavior. Route comment deletion through delete. Persist operation identities for posts/replies/state changes; enforce anchor validation and authorization. Remove --body-file, --reply and --resolve after teaching their replacements.

    **`--body <text>`:** Comment/reply text.

    **Work:** Reuse for multiple targets; add durable write recovery.

    **`--input <path\|->`:** Read comment/reply text from a file or stdin; mutually exclusive with `--body`.

    **Work:** Replace --body-file with --input; preserve file/stdin and exclusivity checks.

    **`--thread <thread-id>`:** Select an existing thread for a reply and/or state change. Requires exactly one artifact.

    **Work:** Replace --reply with --thread for both replying and state changes.

    **`--node <node-id>`:** Anchor a new thread to an existing persistent node.

    **Work:** Reuse in dry-run and batch validation.

    **`--quote <text>`:** Anchor a new thread to a uniquely matching quote; mutually exclusive with `--node`.

    **Work:** Reuse in dry-run and batch validation.

    **`--state <open\|resolved>`:** Reopen or resolve the thread selected by `--thread`; can accompany a reply.

    **Work:** Replace --resolve with --state open/resolved.

    **`--filter <field=value>`:** Filter listed threads by supported fields, including state and author. Listing only.

    **Work:** Add the flag and described behavior, using shared validation and help definitions.

    **`--limit <n>`:** Thread page size. Listing only.

    **Work:** Retain mutation-mode rejection.

    **`--cursor <cursor>`:** Continue one artifact's thread listing. Listing only; one target.

    **Work:** Retain single-target/listing-only restriction.

    **`-n, --dry-run`:** Check anchors, thread state, permissions, and proposed changes without posting. Mutation mode only.

    **Work:** Add the flag and described behavior, using shared validation and help definitions.

[^query]: **`afbin query` — behavior and required work.**

    Read dataset rows or execute a document's declared queries. Local files execute locally where the required engine and inputs are available; unavailable remote inputs are identified explicitly. With no query input or name, a dataset returns its rows and a document runs its declared read queries.

    Mutation permissions and dataset read-only policies apply equally to UI and CLI. Writes use conditional, recoverable transactions. Connection creation/configuration uses YAML with `push`; source discovery is `list --type dataset --in <connection>`.

    **Work:** Implement local execution for available engines/inputs and explicit remote execution when required; define cache freshness. Cover declared reads, parameters, dataset reads/mutations and notebook cell/dependency previews. Use shared query validation and conditional recoverable writes; keep read-only execution the default.

    **`--input <path\|->`:** Read SQL from a local file or stdin. SQL addresses the selected dataset's named tables, not HTTP routes. Requires one dataset target.

    **Work:** Implement this flag with the described semantics; reuse shared parsing and validation.

    **`--name <name>`:** Select a declared query, named table, or—with `--write`—a declared mutation.

    **Work:** Implement this flag with the described semantics; reuse shared parsing and validation.

    **`--param <name=value>`:** Supply a typed query/mutation parameter; repeat for multiple parameters. Bind parameters rather than interpolate SQL text.

    **Work:** Implement this flag with the described semantics; reuse shared parsing and validation.

    **`--write`:** Explicitly execute a supported row mutation. Requires one target and either a declared mutation name or supported SQL input. Read-only execution is the default.

    **Work:** Implement this flag with the described semantics; reuse shared parsing and validation.

    **`--remote`:** Refresh remote observations/inputs for a read before execution. Cannot accompany `--write`.

    **Work:** Implement this flag with the described semantics; reuse shared parsing and validation.

    **`-n, --dry-run`:** Validate a requested mutation and report its planned effect without applying it. Requires `--write`; never executes arbitrary side effects to simulate them.

    **Work:** Implement this flag with the described semantics; reuse shared parsing and validation.

    **`--limit <n>`:** Bound a returned read page. Does not silently limit which rows a mutation changes.

    **Work:** Implement this flag with the described semantics; reuse shared parsing and validation.

    **`--cursor <cursor>`:** Continue one read result where supported.

    **Work:** Implement this flag with the described semantics; reuse shared parsing and validation.

    **`-o, --output <path\|->`:** Write results; defaults to stdout. Multiple named/target results require a directory or structured JSON output.

    **Work:** Implement this flag with the described semantics; reuse shared parsing and validation.

    **`--format <table\|csv\|json\|yaml>`:** Result representation.

    **Work:** Implement this flag with the described semantics; reuse shared parsing and validation.

[^open]: **`afbin open` — behavior and required work.**

    Open an existing artifact in the browser, or preview a local draft without publishing it. Browser layout, drag gestures, and interactive viewing remain browser operations; their underlying content, state, and data are accessible through the other commands.

    `--json` implies `--no-browser`. A local preview serves only its declared workspace resources and never publishes, changes permissions, or grants broader filesystem access. Export preview content with `export <local-path>`.

    **Work:** Implement local draft preview and published view opening, bounded filesystem access, page selection and no-browser output. Share rendering with export and validation; no implicit publish.

    **`--remote`:** Open the published version of a tracked local resource instead of previewing the working file.

    **Work:** Implement this flag with the described semantics; reuse shared parsing and validation.

    **`--no-browser`:** Return preview/view URLs without launching a browser.

    **Work:** Implement this flag with the described semantics; reuse shared parsing and validation.

    **`--page <n>`:** Open a selected 1-based slide/page.

    **Work:** Implement this flag with the described semantics; reuse shared parsing and validation.

[^setup]: **`afbin setup` — behavior and required work.**

    Authenticate, save private local credentials, and prepare selected local skills automatically when a requested operation needs them. A missing TTY means no terminal prompts, not no browser: both user and agent invocations should open the local browser when approval is needed, wait within the approval window, then continue the original operation without requiring the agent to run setup or handle credentials. With valid credentials, continue immediately; refresh expired credentials silently first, and open browser approval only when refresh cannot restore authentication. Reuse saved harness selections or detected defaults; expose any required user choices in the browser instead of blocking an agent on a terminal checklist. Local-only commands and unchanged pushes must still complete without authentication or network access; dry-run must not initiate authentication or mutate credentials.

    `--yes` accepts selected local installation changes, not browser approval. Store credentials under `~/.artifactbin/` with private permissions. A plugin can invoke this same setup flow after ensuring that the compatible binary is installed; it does not introduce a different authentication command.

    **Work:** Decouple browser availability and approval waiting from TTY detection. Add automatic first-use setup and browser reauthentication to agent-invoked commands, preserving their original arguments and safe write identity. Coalesce concurrent authentication requests by server so multiple agents reuse one approval rather than opening duplicate tabs. Resume the original operation after approval; preserve account/origin checks and do not replay writes with unknown outcomes blindly. Keep progress on stderr and final results on stdout. For an unavailable browser, emit an actionable approval URL; for denial, expiry or interruption, return structured status and retain valid resumable state without looping indefinitely. Add explicit no-browser and dry-run. Complete plugin bootstrap using the same compatible binary/setup flow. Verify first use, valid credentials, refresh success/failure, no TTY with a desktop browser, headless use, denial, timeout, concurrent invocations, interruption, wrong-account approval and nonduplicating write resumption across supported harnesses. Never treat --yes as browser consent.

    **`--harness <claude\|codex\|pi\|opencode\|none>`:** Select a local skill destination; repeat for several. `none` is exclusive. Otherwise use saved selections, or preselect detected harnesses in an interactive checklist.

    **Work:** Reuse selection for plugin bootstrap without duplicate unmanaged installs.

    **`--no-browser`:** Emit the approval URL without launching a browser; continue bounded approval waiting and resume the operation if approved. No TTY alone must not imply this flag. Apply the flag consistently to commands that may need browser authentication; it must not disable silent token refresh.

    **Work:** Expose browser suppression independently of terminal mode and share its parsing with all authentication-capable commands.

    **`-n, --dry-run`:** Report configuration, authentication needs, skill destinations, and proposed changes without initiating approval or modifying local state.

    **Work:** Add the flag and described behavior, using shared validation and help definitions.

[^update]: **`afbin update` — behavior and required work.**

    Update the installed CLI and selected local skills to the newest compatible published release. Reuse the saved harness selection by default. Verify downloaded files, preserve a recoverable previous binary, and report plugin-managed copies that require the owning harness to refresh its plugin cache.

    Normal authoring commands do not check for updates. Installed plugin and standalone skill copies must report their source/version consistently; update does not silently edit a harness-owned immutable plugin cache.

    **Work:** Add dry-run, plugin-copy provenance and owning-harness refresh guidance. Wire compatible plugin publication into release/deployment, keep plugin versions monotonic, and replace unpublished npm instructions with the verified installer. Keep ordinary authoring free of update polls and remove obsolete npm update paths.

    **`--harness <claude\|codex\|pi\|opencode\|none>`:** Same selection semantics as `setup`.

    **Work:** Retain saved selections and consistent destination reporting.

    **`-n, --dry-run`:** Resolve the compatible release and report binary/skill changes without installing them.

    **Work:** Add the flag and described behavior, using shared validation and help definitions.

[^remote]: **`afbin remote` — behavior and required work.**

    Launch an agent/command in a local terminal with browser access. Omitted command opens an interactive agent picker; a noninteractive caller must provide a command or an existing session.

    Flags after the command belong to the child command. Streaming terminal output does not support `--json` or pretend to be a paginated result. List sessions with `list --type session`, edit supported session configuration through YAML and `push`, and terminate a session with `delete --type session`.

    **Work:** Add attach/no-browser flags, deterministic noninteractive requirements and typed session read/edit/terminate support through existing commands. Reuse authentication and keep terminal streaming separate from structured command output.

    **`--name <name>`:** Name a newly created terminal session.

    **Work:** Reject alongside session attachment.

    **`--session <ref>`:** Attach to an existing authorized session instead of launching a new command; mutually exclusive with a command and `--name`.

    **Work:** Add the flag and described behavior, using shared validation and help definitions.

    **`--no-browser`:** Print the session URL without opening a browser.

    **Work:** Add the flag and described behavior, using shared validation and help definitions.

[^help]: **`afbin help` — behavior and required work.**

    Print bundled command help, resource/YAML schemas, permission rules, references, markup, templates, themes, examples, or recovery guidance. With no topic, show the command list. Help teaches native commands and local file formats; there is no `api` command or endpoint-reference topic.

    `afbin <command> -h`, `afbin help <command>`, generated man pages, installed skills, and plugin guidance describe the same flags and examples.

    **Work:** Generate command/flag documentation, domain/YAML schemas, man pages and examples from shared definitions. Remove endpoint teaching and obsolete commands from all local skills, discovery pages and plugin packages. Align errors and validations with the same recovery instructions and verify agents can complete tasks from bundled guidance.

    **`--format <text\|markdown\|man>`:** Select a bundled documentation representation.

    **Work:** Add the flag and described behavior, using shared validation and help definitions.

    **`-o, --output <path\|->`:** Write the requested help; defaults to stdout.

    **Work:** Add the flag and described behavior, using shared validation and help definitions.

[^removals]: **Retired surfaces — behavior and required work.**

    **`afbin api <path>`:** **Work:** Remove the raw HTTP escape hatch after native command/YAML coverage is implemented and verified. Migrate all generated help, skills, plugin packages, examples and errors; do not retain a compatibility alias.

    **`-X, --method <method>` (old `api`):** **Work:** Remove with api; agents select domain commands rather than HTTP methods.

    **`--input <path\|->` (old `api`):** **Work:** Remove raw JSON request-body behavior with api. The shared --input flag remains for documented comment/SQL domain input.

    **`--body-file <path\|->` (old `comment`):** **Work:** Remove; replace with comment --input. Update all teaching and errors without a compatibility alias.

    **`--reply <thread-id>` (old `comment`):** **Work:** Remove; replace with comment --thread for replies and state transitions.

    **`--resolve` (old `comment`):** **Work:** Remove; replace with comment --state resolved, and support --state open for reopening.

    **`afbin ls`, `afbin rm` (aliases):** **Work:** Remove redundant aliases; teach and accept list and delete as the single canonical command names.

    **`afbin pull <ref> <destination>` (old positional form):** **Work:** Remove the destination positional form; use pull <ref> --output <path>. Repeated positionals then consistently identify sources.


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

    **Work:** Implement normalization once in shared typed argument/schema validation and reuse it across commands, YAML, filters, help and diagnostics. Verify mixed-case enums are accepted while case-sensitive identities and data remain byte-for-byte unchanged. These are required semantics, not a claim about the current binary.


[^latest-main]: **Rechecked against latest main: OSS `c99cd6e4`, production composition `81da2b9`.** The CLI runtime/parser/auth code is unchanged from the earlier audit; generated teaching changed. Main now includes dataset data policies, model-backed SQL mutations and editor-access sharing management. These expand the required parity work, rather than making the missing native commands implemented.

    **Pull/push:** Round-trip authorized dataset policy configuration in typed YAML using the existing shared policy schema: table permissions, row predicates, allowed columns, presets, execution/function restrictions and generation model/call/token/document limits. Track the separate policy revision and use conditional policy writes; do not treat artifact version alone as the governance condition. Preserve server-derived actor roles/session values rather than accepting caller impersonation. Content, sharing and policy updates must have an explicit atomic contract; otherwise refuse the combined write before any partial changes.

    **Sharing:** Match current editor-access sharing rules, including capability reporting and governance validation. Do not carry forward the old owner-only assumption for sharing. Deletion/restoration remain governed by their existing owner-only contracts. Preserve private-access constraints and server authorization under concurrent changes.

    **Validate/diff/status/list:** Reuse policy schemas and static validation locally; report policy deltas/revisions, supported capabilities, generation usage and UI-visible writer relationships where authorized. Keep default local observations clearly labeled. Expose remote inspection through existing resource summaries and explicit refresh, rather than adding policy/usage command families.

    **Query:** Cover existing model-backed SQL mutations through --write and the selected document/dataset context. Preserve declared parameters, output schemas, policy checks, generation limits and usage reporting. Model/provider execution follows the server’s configured capability and authorization contract; local-first is not permission to bypass policy or copy server credentials locally. Dry-run validates without invoking a model or charging for generation.

    **Timeout/recovery:** The server allows 180 seconds of generation plus 20 seconds of mutation reply overhead; the current CLI request timeout is 30 seconds. Implement operation-aware bounded waiting and durable status/recovery for these writes. A timed-out client must not automatically rerun billable generation. Existing per-invocation server reuse is not evidence of durable idempotency across independent client retries; verify and implement that separately.

    **Fork/restore/replace:** Main refuses some replacement/revert paths for policy-managed datasets. Respect those constraints and specify authorized copying/restoration behavior explicitly; never strip governance as a workaround. A local fork proposal must retain the policy restrictions needed to validate its eventual publication, independently of stripping source invitations and write identity.

    **Implementation validation:** Frontload policy/content transaction design, authenticated editor sharing parity, long-running mutation recovery and the shared node-scoped merge path. Exercise restrictive policies, stale policy revisions, permission loss, generation timeout and interrupted retry before marking corresponding rows complete. This audit is source inspection, not a new full test run or production verification.


[^identity]: **Artifact identity is the ID; names are decoration.** The server’s `urls.ts` explicitly resolves pretty artifact URLs by ID and treats username/title slug as decorative. CLI artifact URL resolution must use the same shared identity rules: outdated usernames, renamed titles and different casing in decorative labels must not change which artifact is selected. Do not fetch merely to validate or canonicalize decorative names; use canonical details returned by an operation when available. Keep selected-origin and permission checks intact.

    Preserve the exact case of the ID. Ignoring a decorative title is different from lowercasing an opaque identifier. Do not use fuzzy title/name matching to select an artifact for reads or writes. Name searches belong to list/filter; their results provide the IDs.

    A local filename locates bytes using filesystem rules; the embedded/tracked ID determines the remote artifact. A local rename must not create a new remote artifact. Reject contradictory or duplicate identities with a clear fix instead of guessing. Explicit fork creates a new identity. Non-artifact identifiers such as query/table/model names follow their own domain contracts and cannot be assumed to be decorative.

    **Current gap/work:** The CLI already ignores username/title spelling in the pretty URLs its regex accepts, but its URL grammar is narrower than the server parser. Share the canonical parser and cover renamed/stale decorative labels, exact IDs, local renames and wrong-origin URLs. Keep only the intended canonical reference forms; this is not authorization to add legacy aliases or accept arbitrary URL routes as artifact references.

[^implementation]: **Implementation in progress on `feat/cli-full-surface`, based on c99cd6e4.** Automatic agent authentication, bounded approval waiting, same-operation resumption, coalesced browser approval, setup dry-run, shared node-scoped reconciliation and force backups are implemented locally. Sharing lists now commit atomically with content/metadata and invalidate stale observations. Viewer reads enforce the existing read ACL while withholding invitations and connection definitions. Local CSV/JSON SQL reads and recoverable direct dataset mutations are implemented; declared queries/mutations and the rest of the table remain pending.

    **Observed validation:** CLI suite 120 passing; API suite 1,438 passing; Node suite 3,856 passing/1 skipped; UI suite 1,383 passing on rerun; production build and macOS ARM64 standalone binary build pass. The binary executes bound local SQL and a PTY round trip outside the checkout. Real-handler tests recover a lost mutation response without duplicate rows, coalesce concurrent model calls, roll back data when receipt storage fails, and reject stale/governance-raced writes. A fresh noninteractive binary push with --no-browser completed browser login/approval through Neo, installed all four local skills into an isolated test home, saved credentials at mode 0600, and resumed publication. Automatic browser launch itself is covered by injected-opener tests. The browser check caught and fixed a server-runtime import entering the login bundle.

    The first foundation checkpoint is committed and pushed as 253c6746; subsequent recovery and resource work is in progress. Nothing on this branch is merged or deployed. Remaining checks include final full-suite reconciliation, browser gates, Linux/x64 binaries, agent familiarity and all incomplete command/resource rows. See docs/cli-full-implementation.md in the implementation checkout for open risks.

Concrete parallel assignments and ownership: [CLI workstreams](cli-full-workstreams.md).
