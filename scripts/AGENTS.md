# Scripts and delegated work

The programs under `scripts/` (each file's header says what it does and who runs it) and the tooling for
delegated agents: `agent-worktree.mjs`, `gate-container.mjs`, `gates.mjs`, `port-block.mjs` and
`agent-dev-flow.mjs`. The CI scripts in `scripts/ci` have a card of their own.

## Rules
- A new script opens with a header comment saying what it does and who runs it. A path a workflow or package
  script names must exist (`scripts/__tests__/script-paths.test.mjs`). Paths another repository runs or
  imports are a contract pinned by `services/app/__tests__/downstream-script-paths.test.ts`: move one only with
  a paired change there.
- Benchmarks (`*-latency.ts`) are never run by CI and assert no budget; their results are not kept in the repo.
- Delegating: the orchestrator owns the design, contracts, core behavioural tests and risk register, seeds them
  before handoff and proves the seeded tests catch what they claim to. Each implementer gets a bounded brief
  (scope, deletion list, constraints, verification commands, completion criteria) in `.agent/BRIEF.md` and
  reports in `.agent/REPORT.md`. Independent deliverables get parallel implementers; shared files one brief.
- An implementer works in its own worktree, data directory and port block, never delegates, never shares a
  checkout and never widens its brief. Give it one with
  `node scripts/agent-worktree.mjs --phase <name> --brief <file> --install` (`--reuse --install` resumes;
  `--remove` tears it down; its header lists the rest). Never commit `.env` or `.agent/`.
- Gates are SLOW-tier: an implementer runs them ONCE at the end of the brief, NEVER per edit. Every brief must say so verbatim.
- Browser gates run in containers, `node scripts/gate-container.mjs <gate ...>`, never on the host: host runs
  compete with every container for CPU. If one is unavoidable, hold `mkdir /tmp/afbin-gate-lock` (then
  `rmdir`) so two never overlap. The worktree must sit under `$HOME`, which Colima shares.
- Every tier takes `APP__PORT=<n>`: use this worktree's own block (`node scripts/port-block.mjs --env`
  measures one). Never stop another session's server by name or port; stop only processes the task started.
- A process exit is not completion: read the report, the log and the diff. Resume partial work from its
  existing commits. Shell timeouts must work on macOS (`gtimeout` or a process alarm).
- Review: check the diff against the brief, the report and its receipts; reproduce risky assertions and the
  changed flow where evidence is missing, never routinely the whole red/green run. CI checks the combined
  branch (`pr fast`); CodeQL runs on main, so read its alerts there. A test against an old server proves
  nothing: check the process and build you started. One PR per repository.
- Harness launch lines (`--harness`) move with each CLI: check the installed help before trusting one.

## Checks
- `npm test -- --files scripts/__tests__/script-paths.test.mjs services/app/__tests__/downstream-script-paths.test.ts`
- A gate tooling edit: its own `scripts/__tests__` file (`gate-container.test.mjs`, `gates-manifest.test.mjs`).
- The policy smoke test: `node scripts/agent-dev-flow.mjs`, then give a bounded agent the brief it prints.
