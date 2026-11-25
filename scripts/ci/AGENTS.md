# CI

CI scripts own test selection, shard timings, merge admission and validation. Workflow files and
`test-timings.mjs` specify job, runner and shard counts.

## Rules
- PRs into `main` require `pr fast` (pr-fast.yml). Warn at 40 s and fail above 60 s, from first job start
  through the final runner step, including post-actions and orphan cleanup. GitHub finalization and observer
  publication follow. Both merge admission and `pr-fast-timing.yml` (`observe-fast.mjs`, status `pr fast timing`)
  require successful completed jobs with terminal `Complete job` records. Each job runs
  `scripts/lib/ci-elapsed.mjs --pr` for early diagnostics.
- Main verifies in batches: one `ci.yml` run per ref at a time, never cancelled; the newest pending run tests
  every merge since. A red one names those commits and failing files; production admits only green revisions.
- Its chain runs from the attempt's first job starting (not `run_started_at`, which keeps a batch's wait) through
  the rollup: aim under 6 minutes, fail above 8. A job over four minutes is a diagnostic, not the limit.
- `CI_BUDGETS` in `scripts/lib/ci-elapsed.mjs`, pinned by `scripts/__tests__/ci-budget.test.mjs`, owns these
  numbers. Never raise a budget, skip coverage, subtract waits or rerun unchanged code to hide slowness: fix the
  critical path, or move a test that cannot fit to `ci.yml` (redesign a critical one).
- `ci.yml`, page-speed, credential-platform and node-timings run on main or by hand, never on automatic PRs.
  Never add an unbounded PR workflow or wait for full release checks before merging; a green `pr fast` is
  never tested-release evidence. The 40/60 policy holds in every repository.
- When adding an app table, give it one writer in the table-ownership check. Document cross-module exceptions there
  by file, operation and table, with the transaction that needs each exception.
- A test's white-box import of another module is recorded in `module-graph.allowed-test-imports.json`, which
  only shrinks: shared resets and test seams belong in the harness.
- Every post-merge failure on main gets a fast-lane guard: find why `pr fast` missed it and add a
  deterministic check that would have caught it, within the budget, to one list:
  - `fast-tests.json`: node tests whose whole import graph passes the capability audit
    (`scripts/lib/fast-test-policy.mjs`): no DOM test, only reviewed externals (`SAFE_EXTERNALS`), and no
    timers, fetch, sockets, workers or eval beyond its reviewed package rows.
  - `guard-tests.json`: node tests that read repository files by path (workflows, scripts, the skill tree).
  - `contract-tests.json`: route contracts another repository runs after merge, with the full suite's setup.
  A file sits in at most one list; enrollment only narrows the lane and the full suite still runs every file.
- `test-timings.json` packs shards by measured time; refresh from both workflows' runs:
  `node scripts/ci/test-timings.mjs --projects api,api-isolated --run <id> …`; others keep their time.
  Node files join the batch via `node-timings.yml`; a changed one, and slower ones it reaches, run beside it
  (`scripts/lib/node-batch.mjs`).
- A `pr fast` Vitest runner makes one cache download, its kind's kit (install, test builds), retried once if
  abandoned; never add a tier.
- The timing observer reads main's workflow: a PR may add `fast (…)` jobs, but one that drops or renames a job
  main expects is refused (`completedFastAttempt`).
- Merge a PR into `main` only with `node scripts/ci/merge-fast.mjs owner/repo PR`: it checks the completed fast
  attempt, its timing, the exact head and that it contains current main (else rebase), then squash-merges.

## Checks
- `npm test -- --files scripts/__tests__/{ci-budget,workflows,ci-plan,fast-test-policy,merge-admission,node-batch}.test.mjs`
- A list edit: `node scripts/ci/fast-tests.mjs` runs the capability audit and the fast list.
- A validate check edit: its test (`scripts/__tests__/module-graph.test.mjs`, `ui-primitives-guard.test.mjs`,
  `table-ownership.test.mjs`) and `npm run validate`.
