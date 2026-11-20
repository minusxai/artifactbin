# CI

The scripts behind the workflows: the required PR lane and its budget, the test lists, the timings that pack shards, merge
admission, and the validate checks (`module-graph.mjs`, `check-ui-primitives.mjs`, `table-ownership.mjs`).
The workflows themselves are `.github/workflows/*.yml`; job, runner and shard counts live there and in
`test-timings.mjs`, never in prose.

## Rules
- The required check for PRs into `main` is `pr fast` (`.github/workflows/pr-fast.yml`). Aim under 40 s, warn at
  40 s, fail above 60 s, measured from its first job's start to the last workload job; `pr-fast-timing.yml` runs
  `observe-fast.mjs`, which publishes the required `pr fast timing` status from the last workload job's
  completion; its own scheduling, publication and teardown are not measured.
  Each job's last step (`scripts/lib/ci-elapsed.mjs --pr`) is an early diagnostic.
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
- A `pr fast` Vitest runner makes one cache download, its kind's kit (install, test builds); never add a tier.
- The timing observer reads main's workflow: a PR may add `fast (…)` jobs, but one that drops or renames a job
  main expects is refused (`completedFastAttempt`).
- Merge a PR into `main` only with `node scripts/ci/merge-fast.mjs owner/repo PR`: it checks the completed fast
  attempt, its timing, the exact head and that it contains current main (else rebase), then squash-merges.

## Checks
- `npm test -- --files scripts/__tests__/{ci-budget,workflows,ci-plan,fast-test-policy,merge-admission,node-batch}.test.mjs`
- A list edit: `node scripts/ci/fast-tests.mjs` runs the capability audit and the fast list.
- A validate check edit: its test (`scripts/__tests__/module-graph.test.mjs`, `ui-primitives-guard.test.mjs`,
  `table-ownership.test.mjs`) and `npm run validate`.
