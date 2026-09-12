# Agent evals

`npm run eval -- --help` describes the current CLI. A run selects one harness/model leg; there is no
hard-coded model roster in the product. `npm run eval:report -- --help` describes report aggregation.
Build the product and CLI before a local leg (`npm run build` and `npm run build -w services/cli`). Live harness runs may spend money and need explicitly selected
credentials; do not run them as part of an ordinary unit-test command.

Task filenames are the selector (`evals/lib/task-set.ts`):

- `evals/tasks/*.json` without `.eval.json` are product smoke tasks selected by `--ci`.
- `evals/tasks/*.eval.json` are creative comparison tasks selected by the default eval set.
- Explicit `--tasks` selects named tasks. Discovery validates each filename against the task's ID.

`evals/lib/leg.ts` describes one leg, `evals/lib/harness/` adapts supported harnesses, and `evals/lib/score/`
evaluates outcomes. Product checks and browser rendering checks are separate evidence. A report should
name costs, retries, skips and incomplete runs rather than treating them as equivalent to first-pass success.
CI retries failed smoke tasks once when enabled; creative comparisons do not inherit that retry policy.

## How a task gets its credential

artifactbin is CLI-only: the only credential path an agent has is afbin's OAuth device approval in a browser. The
driver stands in for the person at that browser, so every leg logs in as a real account — reading its
login code from a booted server's dev outbox, or from the eval's Resend inbox against a deployment
(`evals/lib/credential.ts`). There is no other source: a leg with no session could not approve the
agent's pairing, and that fails before an agent minute is spent rather than looking like a model that
could not publish. The agent is never handed a token; afbin obtains its own.

Every task is then handed a document the driver created as that account, and the only setup a task
still varies is whether that document arrives seeded with markup to edit or comment on (`seed`).

## The two modes, and the two prompt levels

`--mode` is how the CLI is staged, and both flows exercise the same credential path:

- `installed` — the driver stages afbin on PATH and runs `afbin auth` in the run home before the
  harness starts, approving the browser pairing with its own session (`evals/lib/auth.ts`,
  `evals/lib/approver.ts`), so the CLI itself saved the connection and eager init installed the skills.
- `not-installed` — nothing is staged. The agent must find the installer from the server, run it, and
  run a server command whose first use starts a device pairing; the driver approves that one off the
  task's proxy ledger (`approverNeeded` decides, `evals/lib/approver.ts` performs). The task proxy
  serves the installer and this checkout's built release (`evals/lib/proxy.ts`).

Skills only ever arrive through the CLI; there is no plugin, MCP or staged-skill treatment, and those
modes are refused.

`--prompt` is the prompt SHAPE and is independent of the mode — both modes get the identical text:

- `starter` (default) — the product's own handover line (`existingPaste`, imported from
  `services/app/lib/agent-copy`, so the eval cannot measure a line the product does not ship) followed
  by the task brief.
- `hardcore` — the brief and the bare base URL, nothing else. Defined for every task.

## Bounds

Both bounds are the driver's, not a CLI's. `run.maxTurns` is counted off each harness's own step
events as they arrive, and the process tree is killed when a run goes past it (`evals/lib/spawn.ts`
`TurnCap`, `HarnessAdapter.countsAsTurn`); `claude-code` is also passed its native `--max-turns`, and
the other three CLIs document no equivalent flag. `run.timeoutMs` is the backstop for a process that
has HUNG, not a budget for one that is looping. A run the driver had to stop is reported as a runaway
and is never retried, because the same prompt loops the same way; an ordinary CI failure still gets its
one extra turn, and a flow that needed it is named (`evals/lib/second-attempt.ts`).

## CI

`.github/workflows/ci.yml` runs the smoke task matrix only when `AGENT_SMOKE_ENABLED` is exactly `true`
and secrets are available to the trusted job. It runs both CLI flows — `installed` over the CI task set,
and `not-installed` over enough of it to exercise the agent's own auto-auth. Retries stay on there: a
smoke verdict is a model's behaviour rather than the product's, and a runaway is already excluded from
them. The job is currently outside the required test roll-up. Do not infer that it ran from `npm test`.
The eval harness's unit tests are included in the Vitest Node project.

The harness workspace must not expose the checkout, evaluator records or privileged credentials to
the agent being scored. Isolation is platform-specific; tests exercise macOS sandboxing and Linux
custody separately. Keep credential resolution in `evals/lib/credential.ts` and secret handling in
`evals/lib/secrets.ts`. `evals/scripts/spike-inbox-oauth.ts` is a manual live-provider probe retained as the
measurement behind the credential contract; it is not a CI task or an unused runner.

Stage eval changes by explicit filename; never use `git add -A` after an eval run. Review transcripts and
metrics before staging so task output and credentials cannot enter a commit. Only checks explicitly
selected by a task determine its verdict; other measurements remain informational.
