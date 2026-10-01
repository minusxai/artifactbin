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
adds fresh local secrets; `--from <port>` starts the search for a free 100-port block at that port,
`--dir <path>` places the tree (default `../<repo>-<phase>`), `--reuse` resumes an existing task tree,
`--remove` tears the worktree down (the branch is kept) and `--harness claude|codex|pi` prints the exact
launch line for that coding agent (check the installed CLI's help before trusting it); never commit `.env` or `.agent/`. Each worktree owns its database/object paths,
compose project and ports. `node scripts/port-block.mjs --env` measures availability instead of guessing.

Keep the concrete handoff in `.agent/BRIEF.md` and completion evidence in `.agent/REPORT.md`.
Do not treat a process exit code as proof of completion: inspect its report, log and changes. Resume
partially completed work with its existing commits rather than recreating the seed. Shell timeouts must
work on the host (`gtimeout` or a process alarm on macOS). Never stop another session's server by name
or port; track and stop only processes the task owns.

The orchestrator reviews the diff, report and verification receipts. The local-check rules the
implementer worked under — the file cap, exit 2, reuse receipts, empty PR bodies — are stated once in
[AGENTS.md](../AGENTS.md) and apply unchanged to the review; what follows is only what review adds.

Reproduce risky assertions and the changed user flow when evidence is missing or invalidated;
do not routinely repeat the implementer's entire red/green sequence. CI checks the combined branch.
Review the diff against the brief and inspect PR checks, including CodeQL when
configured. Merge only reviewed work and then dispatch remaining authorized work whose dependencies
are satisfied. A passing test against an old server is not verification: check the process and build you
started. Browser gates run in containers via `scripts/gate-container.mjs`, up to N at once (below).

After merging lockfile changes, regenerate the lock if needed and run `npm ci --dry-run`. Read install
output unfiltered: an already populated `node_modules` can hide a missing lock entry.

## Local loop

Work up the tiers, and stop at the cheapest one that can still be wrong:

1. Unit tests — `npm test -- --files <paths>`.
2. The local stack — `npm run dev` on this checkout's `APP__PORT`; verify the change in the app.
3. The branch's CLI — `npm run afbin -- <args>` builds `services/cli` when it is stale and runs it
   against that same server, with its state in `~/.artifactbin-dev/<port>` and
   `ARTIFACTBIN_SKILLS=off`, so the released `afbin`, `~/.artifactbin` and `~/.claude/skills` are
   untouched. A dev server that is not answering `/api/health` is refused in one line.
4. Browser gates — `node scripts/gate-container.mjs <gate ...>`, in a Linux container, up to N at once.
5. The agent itself — `npm run eval -- --tasks <name>`, against the same server.
6. Docker and Postgres — pre-release only, not a routine loop.

Live sessions (tiers 3–5) need Linux bubblewrap. `BROWSER__SANDBOX=none` runs the session worker as
a plain child process instead — no containment at all, refused under `NODE_ENV=production`, and
defaulted by `npm run dev` on a non-Linux development host so the loop works on macOS. A gate whose
assertions are Linux containment facts skips those by name when a session reports `sandbox: none`.

Every tier takes `APP__PORT=<n>`, so a worktree's own port block keeps it off another agent's server.
The gate container needs no port at all: it has its own network namespace.

## Browser gates in containers

`node scripts/gate-container.mjs [--cpus 4] [--memory 8g] [--servers N] <gate ...>` runs the named
gates the way CI's gate job does, from any worktree: the official Playwright image for the pinned
Playwright (Linux Chromium, Firefox, WebKit and fonts) with Node 22 and bubblewrap; the worktree's
source copied from a read-only mount; `npm run build` and `npm run build -w services/cli`; then
`node scripts/gates.mjs --servers=N --only=<gates>` against production servers inside the container,
with the real bubblewrap session sandbox instead of `BROWSER__SANDBOX=none`. The output streams, the
exit status is the gates', and the container is removed afterwards, also when the runner is killed.

- **Up to N at once.** Each container holds a slot (`/tmp/afbin-gate-slots/<n>`, a `mkdir`); N is
  `GATES__CONTAINER_SLOTS`, else the engine's CPUs ÷ `--cpus` or memory ÷ `--memory`, whichever is
  smaller (3 on a 14-CPU, 36 GB Colima). A runner that finds every slot taken waits and names the
  holders; a slot whose runner died is reclaimed.
- **Caches.** Dependencies install once per `afbin-gate-deps-<key>` volume, keyed like CI's install
  cache, and are copied into each container; the `afbin-gate:*` image is built once per Playwright
  version. Both persist; nothing else does. Remove stale ones with
  `docker volume ls -q --filter label=afbin.gate-container=1 | xargs docker volume rm`.
- **Not in a container:** `postgres-datasets` starts Postgres through the host's Docker, which the
  container cannot reach; the runner refuses it by name and PR CI runs it.
- The worktree must be under `$HOME`, which Colima shares. The gates run as root in the container:
  the Colima VM restricts unprivileged user namespaces, and root there is what lets bubblewrap build
  the session sandbox without changing a VM-wide setting.
- Host runs (`node scripts/gate-*.mjs`, `node scripts/gates.mjs`) are discouraged: they compete with
  every container for the same CPUs. If one is unavoidable, hold the old single lock
  (`mkdir /tmp/afbin-gate-lock`, `rmdir` after) so two host runs never overlap.

## Exercising the agent policy

Run `node scripts/agent-dev-flow.mjs` to create a disposable checkout with the current
instructions and real local-check wrappers. Give its printed `.agent/BRIEF.md` to a bounded agent
(e.g. GPT Sol). It provides 51 affected test identities, simulated validation/discovery/GitHub tools,
and a local bare Git remote; no real PR, install, browser, or paid model call is made by the fixture.
Inspect `.agent/commands.jsonl`, the agent's transcript, and `.agent/REPORT.md`: discovery only,
exit 2 reported as deferred, no cap override/full suite/batches, a pushed commit, empty PR body,
and no merge while CI is pending. Review searches for bounded output as well. This is an observed
policy smoke test, not proof of product behavior or a guarantee about every future agent.
Remove the printed fixture directory and local remote after retaining the evidence you need.
