# Working on artifactbin

`CLAUDE.md` imports this file. Setup: [CONTRIBUTING.md](CONTRIBUTING.md).

## Working rules

- Design modules before implementation (Ousterhout): state the affected boundaries and contracts.
  Prefer a cohesive module hiding complexity behind a narrow interface. Routes translate results to HTTP.
- Use test-driven development for features and refactors: contracts first, behavioral tests second,
  observe the failure, then implement. For refactors, establish the existing tests pass, prove the
  relevant assertion detects broken behavior, then restore it through the change (Blue → Red → Blue).
  Report what actually ran; never claim red/green or end-to-end evidence you did not observe.
- Probe risky assumptions; record evidence and unknowns in the plan. Order milestones by
  plan-changing risks and finish with runnable checks.
- **Routine checks: `npm run validate` and `npm test`.** For TDD, use
  `npm test -- --files <paths>`. Run affected checks before handoff; repeat after relevant changes
  or failures, not after every edit. Verify user-facing changes on the task's running app (`npm run
  dev`, port from `APP__PORT` in `.env`; a worktree has its own block). If you changed `services/cli`
  or the skill, test it with `npm run afbin -- <args>`: it builds the branch's CLI and runs it against
  that same dev server, with its own state in `~/.artifactbin-dev/<port>`, so the released `afbin` and
  your home are untouched. To see an agent use that CLI and skill, `npm run eval -- --tasks <name>`
  runs the eval against the same server. Both take `APP__PORT=<n>` to target another checkout's
  server, exactly like `npm run dev`. Never test or iterate on production — it is confirmed after a
  deploy, not explored.
- **50 test files TOTAL across Vitest + CLI.** Above 50, `npm test` runs neither suite and exits 2:
  **DEFERRED TO CI, NOT PASSED**. No affected tests also means unverified (exit 2); discovery errors
  fail visibly. Do not count/preview tests, raise the cap, use `--all`, bypass the wrapper, or split
  a deferred suite into local batches. Focused TDD tests are allowed, not broad local reruns.
- **On deferral: commit, push, open/update a PR with an empty body, and inspect CI.** A branch push
  alone does not start CI. Report deferral accurately; require selected checks before merging.
  Full suites, Docker/Chromium integration, browser gates and production builds are
  CI-only. Collect CI failures and fix them together; never blindly retry unchanged code.
- **Reuse handoff evidence:** in the same worktree, use `npm run validate -- --reuse` and
  `npm test -- --reuse` with the original test arguments. Successful receipts last one hour and
  require matching sources, command, environment, runtime, installed lock and generated inputs.
  Failed/deferred/empty runs are never reusable passes. Label reuse as prior evidence, not a fresh
  run or branch-wide CI. Never copy receipts; omit `--reuse` after manual changes to ignored
  dependencies or external state. See [docs/agent-workflows.md](docs/agent-workflows.md).
- **Bound investigation:** use scoped `rg -l`/`rg -n`, output limits and targeted file sections.
  Exclude fixtures/transcripts/generated assets/dependencies unless relevant; batch independent
  reads and do not repeat answered searches. Separate command duration from agent turnaround time.
- Before changing pinned docs/copy/errors, find their tests and gates (`buildQuickSheet`,
  `agentDiscovery`, `renderDoc`, exact text) and update them together. Keep PR bodies empty and
  add no descriptive PR comments unless requested. Reuse only the task's own current dev server.
- After a merge, update the local main branch to the latest origin/main, then `git worktree prune` and
  remove the finished per-branch worktrees so stale copies do not pile up.
- Use top-level imports. Preserve intentional lazy browser chunks and engine-selecting imports;
  document new exceptions at the boundary and verify the resulting bundle.
- Read environment variables through the owning service's audited config/env module. CLI scripts and
  eval harnesses have their own environment boundaries. Use `MODULE__NAME` settings; spread typed objects
  instead of manually re-enumerating their keys.
- Keep product code independent of downstream deployments. Shared types/constants live in
  `services/contracts`; shared transport and assembly live in `services/utils`. The app never imports
  the proxy. Local and HTTP service implementations must preserve the same contracts.
- Keep bearer secrets out of URLs, documents, logs and storage; test tokens and real user credentials
  are distinct. Use `mxmx_test_*` accounts for disposable browser flows. Read local OTPs with
  `npm run dev:otp`, never a public app endpoint.
- UI tests use accessible names; interactive controls need accessible labels. App tooltips use
  `components/Tooltip.tsx`, not native `title` tooltips.
- Tests should exercise real handlers against isolated state. Reset database and limiter state between
  cases. Merge gates use deterministic fixtures for third parties; live-provider checks are separate.
- Do not hand-edit generated routes, schemas or CSS candidate lists. Run their generators and review the diff.

## Commands

Run these from the repository root. Keep this list current.

- `npm ci` — install the pinned workspace dependencies.
- `npm run setup` — create or repair local settings.
- `npm run dev` — full local composition; default http://localhost:3030.
- `npm run dev:app` — app with local SQL/browser, without the proxy; same default port.
- `npm run afbin -- <args>` — the branch's CLI against this checkout's dev server.
- `npm run eval -- --tasks <name>` — the agent eval against this checkout's dev server
  (`--deployment` to point elsewhere).
- `npm run dev:otp -- <email>` — a local login code from the protected outbox.
- `npm run validate` — name guard and incremental TypeScript, including unused declarations;
  shared utils/contracts also use `noUncheckedIndexedAccess` for downstream compatibility.
- `npm test` — affected api/node/ui + CLI tests, at most 50 files combined. Exit 2: use PR CI,
  never widen. `-- <ref>` selects branch changes; `-- --files <paths>` selects TDD tests;
  `-- --reuse` reuses matching evidence. Config/package edits may defer everything; that is expected.
- CI-only: `npm run test:all`, `test:api`, `test:node`, `test:ui`, `test:integration`, `build`,
  `test:gates`. Do not invoke these locally to work around deferral.
- `npm run generate:routes`, `generate-story-ui-classes`, `render:schema`, `build:runtime` —
  generated inputs.
- `npm run generate:theme-previews`, `generate:og` — theme previews and unfurl images.
- `npm run release:cli` — bump the CLI release; see Change checks.
- `npm run eval -- --help` — agent eval CLI; `evals/` is the private `minusxai/artifactbin-evals`
  repo checked out here (gitignored); its README is the guide.

## Change checks

- CLI releases: `npm run release:cli` in the CLI's
  PR or dispatched as `Release afbin` (version straight to main). `checks` refuses a CLI PR without
  a bump, a version-only diff builds only the binaries, and a tree PR CI passed is not re-tested on
  merge. [Steps](services/cli/README.md).
  Teaching is generated before install/check/dev/build consumers; never commit `services/cli/src/generated/teaching.json`.
  Successful main CI publishes the tested assets; deploys must advance their source pin and verify
  the release before serving its installer.
- Schema changes update `services/app/lib/schema.ts`, schema ownership tests, and generated SQL via
  `npm run render:schema`. Settings changes update the owning config module, `.env.example`, and the
  setup planner's `.env.example` snapshot via `npm run generate:env-snapshot` (its test fails when it has drifted).
- PGLite owns one serialized connection per process. Do not enqueue an out-of-transaction query from
  inside a transaction callback. Send notifications/telemetry after commit; preserve atomic edits.
- Preserve access checks on reads, writes, exports, live streams and dataset mutations. Public/unlisted
  link access is distinct from ownership and from dataset write access.
- Document rendering, editing and author scripts have separate trust boundaries. Read
  [services/app/lib/story-ui/AGENTS.md](services/app/lib/story-ui/AGENTS.md) before changing markup.
- After a lockfile merge, regenerate if necessary and run `npm ci --dry-run`; a populated local install
  can hide a broken lockfile. Native packages and browser assets also need build/image verification.

## Delegated work

The orchestrator defines and seeds contracts, core tests and a bounded brief; the implementer
completes that brief without further delegation. Use isolated worktrees, data directories and port
blocks; never two implementers in one checkout, and only one agent runs browser gates at a time.
Keep PRs scoped per repository. Handoff: [docs/agent-workflows.md](docs/agent-workflows.md).
