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
- Run the full suite, commit and push to the PR, and verify the affected user flow on the running app.
  Keep PR bodies empty unless the user explicitly requests a description. Do not add descriptive PR comments.
- **Verification MUST run in parallel, and as one pass, never as a serial chain.** Before editing text that
  tests pin (docs, skills, copy, error bodies), grep for every test and gate that reads it (`buildQuickSheet`,
  `agentDiscovery`, `renderDoc`, the exact phrase) and change them in the same edit. Then start `test:api`,
  `test:node`, `test:ui`, the CLI suite and `npm run build` as concurrent processes; run only the gates that
  touch the changed surface first and the full gate set once at the end. The suites already use every core;
  wall-clock is lost only by running them one after another, by fixing one pinned assertion per pass, or by
  waiting on a subagent instead of doing independent work meanwhile. Fix-cycles after the first pass are a
  planning failure to report, not a routine.
- After a merge, update the local main branch to the latest origin/main, then `git worktree prune` and
  remove the finished per-branch worktrees so stale copies do not pile up.
- Iterate with `vitest` in watch mode on only the affected files (`npx vitest <path-or-pattern>`); do NOT
  run the `integration` project or the browser gates in the inner loop — both are heavy (real Docker/DB,
  real Chromium) and are CI/PR-time checks, not per-edit ones.
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
- `npm test` — API, Node, UI and CLI tests. `test:api`, `test:node`, `test:ui` select Vitest projects.
- `npm run build` — browser bundles and the production server. Type checks do not replace this check.
- `npm run test:gates -- --list` — discover current browser gates; do not copy gate counts into docs.
- `npm run build && npm run test:gates` — disposable production servers and browser flows.
  Use `--only=<names>` for focused checks and `--servers=1` when diagnosing interference.
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
that brief without further delegation. Review by reproducing the reported checks, not just reading a report.
Use isolated worktrees, data directories and port blocks; never two implementers in one checkout.
Only one agent runs browser gates at a time. Keep PRs scoped per repository and check their CI before merge.
See [docs/agent-workflows.md](docs/agent-workflows.md) for the handoff and review procedure.
