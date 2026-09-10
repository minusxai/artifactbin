# Agent handoffs

Use the active harness and user-selected model. Old version-specific launch commands and model
comparisons are historical evidence, not portable defaults; consult the installed CLI help before using them.

For delegated implementation, the orchestrator owns the design, contracts, core behavioral tests and
risk register. Order dependent milestones by plan-changing risk. Seed the tests and skeletons before
handoff; prove the tests detect the behavior they claim to guard. Give each implementer a bounded brief
with scope, deletion list, constraints, verification commands and completion criteria. Implementers do
not delegate further or widen their brief.

`node scripts/agent-worktree.mjs --phase <name> --brief <file> --base <branch> --install` creates a worktree,
allocates a free 100-port block and installs its dependencies. The default base is `main`; use an explicit
base when continuing dependent work. Downstream repositories can use `--pin-submodule`. `--secrets`
adds fresh local secrets; never commit `.env` or `.agent/`. Each worktree owns its database/object paths,
compose project and ports. `node scripts/port-block.mjs --env` measures availability instead of guessing.

Keep the concrete handoff in `.agent/BRIEF.md` and completion evidence in `.agent/REPORT.md`.
Do not treat a process exit code as proof of completion: inspect its report, log and changes. Resume
partially completed work with its existing commits rather than recreating the seed. Shell timeouts must
work on the host (`gtimeout` or a process alarm on macOS). Never stop another session's server by name
or port; track and stop only processes the task owns.

The orchestrator reproduces type checks, tests, at least one relevant failure demonstration, and the
changed user flow. Review the diff against the brief and inspect PR checks, including CodeQL when
configured. Merge only reviewed work and then dispatch remaining authorized work whose dependencies
are satisfied. A passing test against an old server is not verification: check the process and build you
started. Browser gates run in one agent at a time; other agents may run isolated unit tests.

After merging lockfile changes, regenerate the lock if needed and run `npm ci --dry-run`. Read install
output unfiltered: an already populated `node_modules` can hide a missing lock entry. Preserve empty
PR bodies unless the user explicitly requests a description.
