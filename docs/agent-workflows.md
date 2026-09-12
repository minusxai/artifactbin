# Agent handoffs

Use the active harness and user-selected model. Old version-specific launch commands and model
comparisons are historical evidence, not portable defaults; consult the installed CLI help before using them.

For delegated implementation, the orchestrator owns the design, contracts, core behavioral tests and
risk register. Order dependent milestones by plan-changing risk. Seed the tests and skeletons before
handoff; prove the tests detect the behavior they claim to guard. Give each implementer a bounded brief
with scope, deletion list, constraints, verification commands and completion criteria. Implementers do
not delegate further or widen their brief.

`node scripts/agent-worktree.mjs --phase <name> --brief <file> --base <branch> --install` creates a worktree,
allocates a free 100-port block and installs pinned dependencies with checked `npm ci`.
Resume the same task with `--reuse --install`: its environment, data and brief are preserved;
a matching successful installation receipt avoids reinstalling and refreshes generated assets.
A failed install stops the handoff. Each worktree owns its dependencies and caches. The default base is `main`; use an explicit
base when continuing dependent work. Downstream repositories can use `--pin-submodule`. `--secrets`
adds fresh local secrets; never commit `.env` or `.agent/`. Each worktree owns its database/object paths,
compose project and ports. `node scripts/port-block.mjs --env` measures availability instead of guessing.

Keep the concrete handoff in `.agent/BRIEF.md` and completion evidence in `.agent/REPORT.md`.
Do not treat a process exit code as proof of completion: inspect its report, log and changes. Resume
partially completed work with its existing commits rather than recreating the seed. Shell timeouts must
work on the host (`gtimeout` or a process alarm on macOS). Never stop another session's server by name
or port; track and stop only processes the task owns.

The orchestrator reviews the diff, report and verification receipts. Use
`npm run validate -- --reuse` and `npm test -- --reuse` with the implementer's original test arguments
in the same checkout. Matching receipts reuse successful evidence for one hour; invalid inputs rerun
checks. Do not copy receipts across worktrees or present a reused result as a fresh run.
Reproduce risky assertions and the changed user flow when evidence is missing or invalidated;
do not routinely repeat the implementer's entire red/green sequence. CI checks the combined branch.
Above 50 affected files (Vitest + CLI combined), `npm test` exits 2 without running either suite.
Report DEFERRED TO CI, commit/push, and open/update a PR with an empty body. Never widen the cap,
run a full suite locally, or split deferred work into batches. A branch push alone does not trigger CI. Review the diff against the brief and inspect PR checks, including CodeQL when
configured. Merge only reviewed work and then dispatch remaining authorized work whose dependencies
are satisfied. A passing test against an old server is not verification: check the process and build you
started. Browser gates run in one agent at a time; other agents may run isolated unit tests.

After merging lockfile changes, regenerate the lock if needed and run `npm ci --dry-run`. Read install
output unfiltered: an already populated `node_modules` can hide a missing lock entry. Preserve empty
PR bodies unless the user explicitly requests a description.

## Exercising the agent policy

Run `node scripts/probes/agent-dev-flow.mjs` to create a disposable checkout with the current
instructions and real local-check wrappers. Give its printed `.agent/BRIEF.md` to a bounded agent
(e.g. GPT Sol). It provides 51 affected test identities, simulated validation/discovery/GitHub tools,
and a local bare Git remote; no real PR, install, browser, or paid model call is made by the fixture.
Inspect `.agent/commands.jsonl`, the agent's transcript, and `.agent/REPORT.md`: discovery only,
exit 2 reported as deferred, no cap override/full suite/batches, a pushed commit, empty PR body,
and no merge while CI is pending. Review searches for bounded output as well. This is an observed
policy smoke test, not proof of product behavior or a guarantee about every future agent.
Remove the printed fixture directory and local remote after retaining the evidence you need.
