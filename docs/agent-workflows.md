# Agent workflows

Delegating, worktrees, handoffs, local evals and browser gate containers. The universal rules (check tiers, the
50-file cap, exit 2, reuse receipts, empty PR bodies) are in [AGENTS.md](../AGENTS.md) and bind every implementer
and reviewer unchanged; this file adds only what delegation needs.

## Delegated work

Use the active harness and user-selected model. Old version-specific launch commands and model
comparisons are historical evidence, not portable defaults; consult the installed CLI help before using them.

The orchestrator owns the design, contracts, core behavioral tests and risk register, and seeds contracts, core
tests and skeletons before handoff. Order dependent milestones by plan-changing risk, and prove the seeded tests
detect the behavior they claim to guard. Each implementer gets a bounded brief with scope, deletion list,
constraints, verification commands and completion criteria.

- Each implementer uses its own worktree, data directory and port block, never delegates or shares a checkout, and
  does not widen its brief.
- Independent deliverables get separate briefs and implementers in parallel worktrees; shared files get one brief.
  The orchestrator merges.
- Browser gates run in containers (`scripts/gate-container.mjs`, below), up to engine CPUs ÷ container CPUs at once
  (`GATES__CONTAINER_SLOTS` overrides), never on the host.
- Gates are SLOW-tier: an implementer runs them ONCE at the end of the brief, NEVER per edit. Every brief must say so verbatim.
- Separate PRs per repository.

## Worktrees

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

## Briefs and reports

Keep the concrete handoff in `.agent/BRIEF.md` and completion evidence in `.agent/REPORT.md`.
Do not treat a process exit code as proof of completion: inspect its report, log and changes. Resume
partially completed work with its existing commits rather than recreating the seed. Shell timeouts must
work on the host (`gtimeout` or a process alarm on macOS). Never stop another session's server by name
or port; track and stop only processes the task owns.

## Review

The orchestrator reviews the diff against the brief, the report and the verification receipts. Reproduce risky
assertions and the changed user flow when evidence is missing or invalidated; do not routinely repeat the
implementer's entire red/green sequence. CI checks the combined branch: inspect the PR's `pr fast` checks. CodeQL
runs on main after merge and on a weekly schedule, not on the PR, so read its alerts there. Merge only reviewed
work and then dispatch remaining authorized work whose dependencies are satisfied. A passing test against an old
server is not verification: check the process and build you started.

## Local loop

Work up the tiers, and stop at the cheapest one that can still be wrong. Tiers 1 and 2 are FAST, after every
change; tier 3 when the skill or another agent-facing surface changed; tiers 4 and 5 are SLOW: once, at the end,
before merge, never per edit.

1. Unit tests — `npm test -- --files <paths>`.
2. The local stack — `npm run dev` on this checkout's `APP__PORT`; verify the change in the app.
3. The agent itself — `npm run eval -- --tasks <name>`, against the same server.
4. Browser gates — `node scripts/gate-container.mjs <gate ...>`, in a Linux container (below).
5. Docker and Postgres — pre-release only.

Live sessions (tiers 3–4) need Linux bubblewrap. `BROWSER__SANDBOX=none` runs the session worker as
a plain child process instead — no containment at all, refused under `NODE_ENV=production`, and
defaulted by `npm run dev` on a non-Linux development host so the loop works on macOS. A gate whose
assertions are Linux containment facts skips those by name when a session reports `sandbox: none`.

Every tier takes `APP__PORT=<n>`, so a worktree's own port block keeps it off another agent's server.
The gate container needs no port at all: it has its own network namespace.

## Eval target and candidate contract

Treat the server origin and author skill as independent harness inputs. A local dev server is a normal
product target; the evaluated agent does not receive a special local-mode task or easier scorer. Use
this worktree's dev server with its exact public origin (including scheme and port) and a candidate
skill projection from the intended source revision. Installation scenarios must serve that
candidate through the same installer/npm paths a deployed target uses. Never silently fetch a public
release or require a production deploy to make the local evaluation runnable.

A complete candidate may need runtime asset compilation before packing. Prepare it with normal package assembly,
cache it by all relevant inputs and run it once per source snapshot; it is not a production deployment or evidence
that CI passed. Do not replace the real skill with a limited fixture or silently remove its capabilities to make the
evaluation cheaper. Full suites and merge gates still belong to CI.

For direct HTTP, supply the target artifact URL and serve its root/references/API on that target.
Separate API-task fixtures with preauthenticated access from login/persistence fixtures that start
without a token, follow normal auth, save credentials, restart and refresh. The harness can retrieve a
local OTP from the protected outbox to play the user's approval role; that is not an agent auth bypass.

Each run owns its home, credential store, fixtures and server ports. Record target and product revision,
skill checksum, eval revision (including dirty inputs), model/provider, harness
version and task settings. Candidate preparation must notice changes to
skill sources, shared packages and the lockfile. Fail visibly on absent/stale candidates or unreachable
targets; no production fallback. Keep baseline and candidate fixtures/settings matched,
retain raw success/failure and token/latency/cost evidence, and disclose missing metrics. The eval
repository's README owns the exact runnable commands and provider preflight, not copied policy prose.

## Browser gates in containers

`node scripts/gate-container.mjs [--cpus 4] [--memory 8g] [--servers N] <gate ...>` runs the named
gates the way CI's gate job does, from any worktree: the official Playwright image for the pinned
Playwright (Linux Chromium, Firefox, WebKit and fonts) with Node 22 and bubblewrap; the worktree's
source copied from a read-only mount; CI's gate build (`scripts/build/build-gate-inputs.mjs`: the app and the
server bundle), restored instead from the `afbin-gate-builds` volume when no build input changed since it last ran;
then `node scripts/gates.mjs --servers=N --only=<gates>` against production servers inside the container,
with the real bubblewrap session sandbox instead of `BROWSER__SANDBOX=none`. The output streams, the
exit status is the gates', and the container is removed afterwards, also when the runner is killed.

- **Up to N at once.** Each container holds a slot (`/tmp/afbin-gate-slots/<n>`, a `mkdir`); N is
  `GATES__CONTAINER_SLOTS`, else the engine's CPUs ÷ `--cpus` or memory ÷ `--memory`, whichever is
  smaller (3 on a 14-CPU, 36 GB Colima). A runner that finds every slot taken waits and names the
  holders; a slot whose runner died is reclaimed.
- **Caches.** Dependencies install once per `afbin-gate-deps-<key>` volume, keyed like CI's install
  cache, and are copied into each container; the `afbin-gate-builds` volume keeps the last few gate builds; the
  `afbin-gate:*` image is built once per Playwright version. These persist; nothing else does. Remove stale
  volumes with `docker volume ls -q --filter label=afbin.gate-container=1 | xargs docker volume rm`.
- The worktree must be under `$HOME`, which Colima shares. The gates run as root in the container:
  the Colima VM restricts unprivileged user namespaces, and root there is what lets bubblewrap build
  the session sandbox without changing a VM-wide setting.
- Host runs (`node scripts/gates/gate-*.mjs`, `node scripts/gates.mjs`) are discouraged: they compete with
  every container for the same CPUs. If one is unavoidable, hold the old single lock
  (`mkdir /tmp/afbin-gate-lock`, `rmdir` after) so two host runs never overlap.

## Exercising the agent policy

Run `node scripts/agent-dev-flow.mjs` to create a disposable checkout with the current
instructions and real local-check wrappers. Give its printed `.agent/BRIEF.md` to a bounded agent.
It provides 51 affected test identities, simulated validation/discovery/GitHub tools,
and a local bare Git remote; no real PR, install, browser, or paid model call is made by the fixture.
Inspect `.agent/commands.jsonl`, the agent's transcript, and `.agent/REPORT.md`: discovery only,
exit 2 reported as deferred, no cap override/full suite/batches, a pushed commit, empty PR body,
and no merge while CI is pending. Review searches for bounded output as well. This is an observed
policy smoke test, not proof of product behavior or a guarantee about every future agent.
Remove the printed fixture directory and local remote after retaining the evidence you need.
