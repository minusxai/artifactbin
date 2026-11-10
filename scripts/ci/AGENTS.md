# CI

The scripts behind the workflows: the required PR lane and its budget, the test lists, the timings that pack shards, merge
admission, and the validate checks (`module-graph.mjs`, `check-ui-primitives.mjs`, `table-ownership.mjs`).
The workflows themselves are `.github/workflows/*.yml`; job, runner and shard counts live there and in
`test-timings.mjs`, never in prose.

## Rules
- The required check for PRs into `main` is `pr fast` (`.github/workflows/pr-fast.yml`). Aim under 40 s, warn at
  40 s, fail above 60 s, measured from `run_started_at` to the last workload job; `pr-fast-timing.yml` runs
  `observe-fast.mjs`, which publishes the required `pr fast timing` status from the last workload job's
  completion; its scheduling and publication overhead is separate and its own teardown is not measured.
  Each job's last step (`scripts/lib/ci-elapsed.mjs --pr`) is an early diagnostic.
- The full post-merge chain (`ci.yml` on main, or run by hand on a branch) is measured from `run_started_at`
  through the final rollup, setup, dependency waits and uploads included: aim under 3 minutes, normal maximum under 4, fail above
  8. Job times, parallel sums and workflow durations differ; a job over four minutes is a diagnostic, not the
  limit. Report optional cache warming and release-notification tails, and cold and warm timings, separately.
- `CI_BUDGETS` in `scripts/lib/ci-elapsed.mjs`, pinned by `scripts/__tests__/ci-budget.test.mjs`, owns these
  numbers. Never raise a budget, skip coverage, subtract queues or rerun unchanged code to hide slowness,
  and never move a file out of the lane: investigate the critical path and repetition.
- `ci.yml`, page-speed, credential-platform and runner-design run on main or by hand, never on automatic PRs.
  Never add an unbounded PR workflow or wait for full release checks before merging. The 40/60 policy holds in
  the application, proxy, evaluator and deployment repositories alike.
- Every post-merge failure on main gets a fast-lane guard: find why `pr fast` missed it and add a
  deterministic check that would have caught it, within the budget, to one list:
  - `fast-tests.json`: node tests whose whole import graph passes the capability audit
    (`scripts/lib/fast-test-policy.mjs`): no DOM test, only reviewed externals (`SAFE_EXTERNALS`), and no
    timers, fetch, sockets, workers or eval beyond its reviewed package rows.
  - `guard-tests.json`: node tests that read repository files by path (workflows, scripts, the skill tree).
  - `contract-tests.json`: route contracts another repository runs after merge, with the full suite's setup.
  A file sits in at most one list; enrollment only narrows the lane and the full suite still runs every file.
- `test-timings.json` packs the shards by measured time: refresh it from a CI run's logs with
  `node scripts/ci/test-timings.mjs --run <id>`; files a log does not mention keep their recorded time.
- Merge a PR into `main` only with `node scripts/ci/merge-fast.mjs owner/repo PR`: it checks the completed fast
  attempt, its timing status and the exact head, then squash-merges.

## Checks
- `npm test -- --files scripts/__tests__/ci-budget.test.mjs scripts/__tests__/workflows.test.mjs scripts/__tests__/ci-plan.test.mjs scripts/__tests__/fast-test-policy.test.mjs scripts/__tests__/merge-admission.test.mjs`
- A list edit: `node scripts/ci/fast-tests.mjs` runs the capability audit and the fast list.
- A validate check edit: its test (`scripts/__tests__/module-graph.test.mjs`, `ui-primitives-guard.test.mjs`,
  `table-ownership.test.mjs`) and `npm run validate`.
