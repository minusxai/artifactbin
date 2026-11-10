# Working on artifactbin

`CLAUDE.md` imports this file; setup: [CONTRIBUTING.md](CONTRIBUTING.md). Read it whole, then the card for the
area you touch. Keep links plain, never `@` imports.

## Working in → read first

| Working in | Read first when |
|---|---|
| [lib/platform](services/app/lib/platform/AGENTS.md) | the schema, settings/config, how code reaches the database |
| [lib/artifact-access](services/app/lib/artifact-access/AGENTS.md) | read, write, export, live-stream or dataset-mutation paths; locking |
| [lib/html-runtime](services/app/lib/html-runtime/AGENTS.md) | page scripts, viewer state, the built runtime, what pages may do |
| [lib/html-components](services/app/lib/html-components/AGENTS.md) | native components, specs, generated lists, the reader build |
| [lib/page-operations](services/app/lib/page-operations/AGENTS.md) | the SQL and function doors, schedules, capabilities |
| [lib/dataflow](services/app/lib/dataflow/AGENTS.md) | the data language: references, evaluation, browser leaves |
| [lib/graphql-compat](services/app/lib/graphql-compat/AGENTS.md) | anything that touches GraphQL (deprecated, fenced) |
| [lib/skills](services/app/lib/skills/AGENTS.md) | the author skill (`services/app/skills`), served `/llms` copy, evals |
| [solid](services/app/solid/AGENTS.md) | any app UI: chrome, controls, overlays, UI tests |
| [scripts/ci](scripts/ci/AGENTS.md) | workflows, PR lane budgets, test lists and timings, a red main |

| Doc | Read when |
|---|---|
| [agent-workflows](docs/agent-workflows.md) | delegating: briefs, worktrees, gates, handoffs |
| [serving-and-security](docs/serving-and-security.md) | before markup, rendering or trust-boundary changes |
| [http-api](docs/http-api.md) | changing HTTP behaviour |
| [operations](docs/operations.md) | deployment and settings |
| [scripts](docs/scripts.md) | what each script does |
| [sql-service](docs/sql-service.md), [browser-service](docs/browser-service.md), [runner](docs/runner.md) | changing a service's routes or wire shapes |

## Check tiers (read before running commands)

**FAST — after every change:** `npm run validate`, `npm test -- --files <paths>`, the running dev app.

**SLOW — once, at completion before merge, never per edit:** gate containers, PR CI push, bare `npm test`.

- **Finish on FAST, then SLOW once.** Never push, poll CI or gate per edit.
- **Pre-merge:** FAST → commit, push ONCE → open/update an empty-body PR (no descriptive comments unless
  requested) → `pr fast` green → merge. The full `ci.yml` suite, build, browser gates, page speed and CodeQL run
  on main after merge and gate release. Local gates only for a failed CI gate shard or a reader/hydration change.
- **PRs into `main`: ONLY squash and merge**, via `node scripts/ci/merge-fast.mjs owner/repo PR`: it checks the exact
  completed fast attempt and its timing, then squash-merges with `--admin --match-head-commit` (admin bypass is for
  reviews only). NEVER `--merge` or `--rebase`. Rebasing a working branch is fine.
- **Deferred (exit 2) mid-task?** Return to `--files`; report the deferral; PR CI runs the rest. On a red PR: fetch
  every failed job's log in ONE command, fix all failures together (independent ones in parallel agents), never
  retry unchanged code.
- **CI speed:** the required check is `pr fast` (`.github/workflows/pr-fast.yml`): aim under 40 s, fail above 60 s,
  never raise a budget. Every post-merge failure on main gets a fast-lane guard.

## Working rules

- Design modules first (Ousterhout): cohesive boundaries/contracts, narrow interfaces; routes translate to HTTP.
- Layers: entry points `server.ts`, `scripts`, `services/app/{app,server,scripts}`; UI `services/app/{solid,web}`;
  libraries `services/app/lib/*`; packages the other `services/*`, importing only contracts, utils and themselves.
  No cycles; enter a lib module through its index; `npm run validate` enforces it.
- TDD for features and refactors: contracts, behavioral tests, observe the failure, implement. Refactors go
  Blue → Red → Blue: tests pass, prove the assertion catches broken behavior, restore. Report only observed runs.
- Probe assumptions; record evidence/unknowns. Order milestones by risk; end with runnable checks.
- Verify user-facing changes on the task's running app (`npm run dev` on the worktree's own `APP__PORT`, in `.env`).
  Never iterate/test on production; confirm after deploy.
- **50 files TOTAL.** Above 50: nothing runs; exit 2 means **DEFERRED, NOT PASSED**.
  No affected tests: unverified (exit 2). Discovery errors fail. No counting/previewing, cap increases,
  `--all`, wrapper bypasses or deferred-suite batching.
- **Reuse evidence** in the same worktree: `npm run validate -- --reuse`, `npm test -- --reuse` (same arguments).
  One-hour receipts need matching sources, command, environment, runtime, lock and generated inputs; failed,
  deferred or empty runs never count. Label it prior evidence; skip reuse after external-state changes; never copy.
- **Bound investigation:** scoped `rg -l`/`rg -n`, bounded output; skip irrelevant fixtures, transcripts, assets
  and dependencies; batch reads, never repeat searches.
- After a merge: local main to latest origin/main, `git worktree prune`, remove finished worktrees.
- Top-level imports, except intentional lazy browser chunks and engine-selecting imports; document a
  new exception at the boundary and verify the bundle.
- Read env vars through the owning service's audited config (scripts/eval harnesses own theirs). `MODULE__NAME`
  settings; spread typed objects, never re-enumerate keys.
- Product code ignores downstream deployments; the app never imports the proxy. Shared types/constants:
  `services/contracts`; shared transport/assembly: `services/utils`. Local and HTTP services keep one contract.
- Keep bearer secrets out of URLs/docs/logs/storage; test tokens are not credentials. Use `mxmx_test_*` accounts for
  disposable browser flows; read local OTPs only with `npm run dev:otp`.
- Tests: real handlers, isolated state, reset database/limiter. Gates: deterministic third-party
  fixtures; separate live-provider checks.
- PGLite owns one serialized connection per process: never enqueue an out-of-transaction query inside
  a transaction callback. Send notifications/telemetry after commit; preserve atomic edits.
- Preserve access checks on reads, writes, exports, live streams and dataset mutations; public/unlisted
  link access is neither ownership nor dataset write access.
- After a lockfile merge, regenerate if needed and run `npm ci --dry-run` (a populated install hides a broken
  lock); native packages and browser assets need build/image verification.
- Delegating: read the agent-workflows doc first; every brief inherits these rules.

## Commands (from the repo root)

- `npm ci` — install pinned dependencies. `npm run setup` — create or repair local settings.
- `npm run dev` — full local composition, default http://localhost:3030; `dev:app` the app alone, without login/OAuth.
- `npm run dev:otp -- <email>` — a local login code from the protected outbox.
- `npm run eval -- --tasks <name>` — the agent eval against that server (setup: the `lib/skills` row).
- `npm run validate` — FAST: UI primitives, module graph, table ownership, knip (unused files, exports,
  dependencies), the incremental type check.
- `npm test` — affected api/node/ui/islands tests (cap above). `-- --files <paths>` is the FAST loop; bare and `-- <ref>` are SLOW, pre-merge only. Config/package edits may defer everything.
- `node scripts/gate-container.mjs <gate ...>` — **SLOW, PRE-MERGE ONLY, NEVER AFTER AN EDIT**: named browser
  gates in a Linux container, built and served as CI does.
  `node scripts/gate-container.mjs kit-and-fonts` verifies the compiled reader handover (reader/islands changes).
- CI-only, never a deferral bypass: `npm run test:all`, `test:{api,node,ui,islands,integration,gates}`, `build`.
- Generated routes, schemas and CSS lists are never hand-edited: rerun `npm run generate:routes`, `render:schema`,
  `generate:og` or `generate:design-systems` and review the diff.
