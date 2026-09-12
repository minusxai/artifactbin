# Working on artifactbin

These are the shared working rules for this repository. `CLAUDE.md` imports this file.
Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup and [docs/design-notes.md](docs/design-notes.md)
when working on the relevant subsystem. Historical rollout narratives remain in Git history.

## Working rules

- Design modules before implementation (Ousterhout): state the affected boundaries and contracts.
  Prefer a cohesive module hiding complexity behind a narrow interface. Routes translate results to HTTP.
- Use test-driven development for features and refactors: contracts first, behavioral tests second,
  observe the failure, then implement. For refactors, establish the existing tests pass, prove the
  relevant assertion detects broken behavior, then restore it through the change (Blue → Red → Blue).
  Report what actually ran; never claim red/green or end-to-end evidence you did not observe.
- Validate risky assumptions with executable probes; record open assumptions and evidence in the plan.
  Rank implementation milestones by the risks that could change the plan. Finish with runnable checks.
- **The routine local checks are `npm run validate` and `npm test`.** Use focused behavioral
  tests during implementation: `npm test -- --files <test-path> [...]`. Run validation and the
  affected tests once before handoff; repeat only after relevant edits, failures or integration changes.
- **The local budget is 50 test files TOTAL across Vitest and CLI.** `npm test` discovers and
  budgets both before executing either. Above 50, it runs neither and exits 2: **DEFERRED TO CI,
  NOT PASSED**. No affected tests also exits 2 as unverified. Discovery errors fail visibly.
  Do not preview/count tests yourself, increase the cap, pass `--all`, invoke a full suite,
  or bypass the wrapper with raw Vitest/Node commands to get around deferral. A focused TDD
  check may name the relevant behavioral tests; do not split a deferred suite into local batches.
- **On deferral: commit, push, and open or update a PR; keep its body empty.** A feature-branch
  push alone does not trigger CI. Report local testing as deferred, inspect all selected CI results,
  and wait for required checks before merging. Fix observed failures; do not retry unchanged code
  blindly. Full tests, integration, browser gates and production builds belong on CI.
- **Reuse evidence at handoff instead of automatically repeating work.** Successful normal checks
  save local receipts. In the SAME worktree, a reviewer can run `npm run validate -- --reuse` and
  `npm test -- --reuse` (with the original test arguments). Reuse requires matching source contents,
  commands, environment, runtime, installed lock state and generated inputs, within one hour.
  Failed, deferred, empty and input-changing runs produce no reusable pass. Report reuse as prior
  evidence, not a new run or branch-wide coverage. CI never reuses these receipts. After manual edits
  to ignored dependencies or external state, omit `--reuse`. Never copy receipts between worktrees.
- **Keep agent investigation bounded.** Start with `rg -l` for filenames or a narrowly scoped `rg -n`;
  exclude fixtures, recorded transcripts, generated assets and dependency trees unless they are the
  subject. Set an output/line limit, read the needed sections, and batch independent reads. Do not
  dump entire files or repeat searches already answered. Separate command duration from agent
  turnaround time when diagnosing slowness. Keep low-risk fixes small; avoid speculative abstractions.
- Verify the affected user flow on the running app for user-facing changes. Reuse the task's own
  server after confirming its checkout and current code. Keep PR bodies empty and add no descriptive
  PR comments unless explicitly requested.
- **Never run the full or heavy suites locally as a routine — they are slow and belong to CI:** the full
  suite (`npm run test:all`), the `integration` project (Docker Postgres + real Chromium), the browser gates,
  `npm run build` and the agent smoke. CI runs them sharded and only for affected modules; push, read CI, and
  fix a failure in ONE pass, not a serial chain. Before editing text that tests pin (docs, skills, copy,
  error bodies), grep for every test and gate that reads it (`buildQuickSheet`, `agentDiscovery`, `renderDoc`,
  the exact phrase) and change them in the same edit, so `npm test` catches it before CI does.
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
  `npm run dev:otp -- <email>` from the protected outbox, never a public app endpoint.
- UI tests use accessible names; interactive controls need accessible labels. App tooltips use
  `components/Tooltip.tsx`, not native `title` tooltips.
- Tests should exercise real handlers against isolated state. Reset database and limiter state between
  cases. Merge gates use deterministic fixtures for third parties; live-provider checks are separate.
- Do not hand-edit generated routes, schemas or CSS candidate lists. Run their generators and review the diff.

## Commands

Run commands from this repository root (the submodule root in a downstream checkout).

- `npm ci` — install the pinned workspace dependencies.
- `npm run setup` — create or repair local settings.
- `npm run dev` — full local composition; default http://localhost:3030.
- `npm run dev:app` — app with local SQL/browser, without the proxy; same default port.
- `npm run validate` — residual-name guard and TypeScript, including unused declarations/parameters, plus
  `validate:shared`: `services/utils` and `services/contracts` under `noUncheckedIndexedAccess`, since
  downstream consumers compile these packages with that flag.
- `npm test` — affected api/node/ui tests plus CLI tests when that package changes; at most
  50 files combined. Exit 2 means unverified/deferred: open/update a PR and use CI, never widen
  the budget. `npm test -- <ref>` selects branch changes; `npm test -- --files <paths>` selects
  focused behavioral tests. `--reuse` reuses matching successful local evidence during handoff.
  Package/config changes may select everything and defer; that is expected, not a failure to fix.
- CI/PR-time only, slow — do NOT run locally as a routine (CI shards them per affected module):
  `npm run test:all` (whole API/Node/UI/CLI suite; `test:api`/`test:node`/`test:ui` select projects),
  `npm run test:integration` (Docker Postgres + real Chromium), `npm run build` (bundles + prod server), and
  `npm run test:gates` (browser flows; `-- --list`, `--only=<names>`, `--servers=1`).
- `npm run generate:routes`, `npm run generate-story-ui-classes`, `npm run render:schema` — generated inputs.
- `npm run eval -- --help` and `npm run eval:report -- --help` — agent eval CLI; see
  [docs/evals.md](docs/evals.md) before running paid legs.

## Change checks

- Releasing the CLI: `services/app/public/chat/release.json` is the pointer `afbin update` reads, and
  `curl … /chat/install.sh | sh` installs the version it names. `npm run release:cli` bumps
  `services/cli/package.json`, `package-lock.json`, the installer and `release.json` together; then run
  `npm run generate:teaching -w services/cli`. A merged CLI change WITHOUT a bump leaves the live
  installer serving the old binary. `.github/workflows/release-cli.yml` publishes the GitHub release when
  the CLI version changes on main and CI passes; the downstream image ships the new `release.json` when
  its submodule pin advances.

- Schema changes update `services/app/lib/schema.ts`, schema ownership tests, and generated SQL via
  `npm run render:schema`. Settings changes update the owning config module, `.env.example`, and the
  setup planner's `ENV_EXAMPLE_BASE64` snapshot in `scripts/lib/setup-plan.mjs` where applicable.
- PGLite owns one serialized connection per process. Do not enqueue an out-of-transaction query from
  inside a transaction callback. Send notifications/telemetry after commit; preserve atomic edits.
- Preserve access checks on reads, writes, exports, live streams and dataset mutations. Public/unlisted
  link access is distinct from ownership and from dataset write access.
- Document rendering, editing and author scripts have separate trust boundaries. Read
  [services/app/lib/story-ui/AGENTS.md](services/app/lib/story-ui/AGENTS.md) before changing markup.
- After a lockfile merge, regenerate if necessary and run `npm ci --dry-run`; a populated local install
  can hide a broken lockfile. Native packages and browser assets also need build/image verification.

## Delegated work

The orchestrator defines and seeds contracts, core tests and a bounded brief; the implementer completes
that brief without further delegation. Review the diff and matching verification evidence; reproduce risky behavior or invalidated checks.
Use isolated worktrees, data directories and port blocks; never two implementers in one checkout.
Only one agent runs browser gates at a time. Keep PRs scoped per repository and check their CI before merge.
See [docs/agent-workflows.md](docs/agent-workflows.md) for the handoff and review procedure.
