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

`.github/workflows/ci.yml` runs the smoke task matrix only when `AGENT_SMOKE_ENABLED` is exactly `true`
and secrets are available to the trusted job. Its two modes are treatments of the CLI: `installed` stages the built CLI, the same local skill bundle shipped to users and the account connection before the agent starts; `cold` stages only the CLI, so the agent must run `afbin setup`, and the driver approves the device pairing with its own session (`evals/lib/approver.ts`) so the flow completes headlessly and the agent never sees a token. The task proxy rewrites the device door's advertised origin to itself for that purpose (`evals/lib/proxy.ts`). The token-less task gets no approver in either mode.
MCP and remotely fetched skill modes are refused. The job is currently outside the required test roll-up. Do not infer that it ran from `npm test`.
The eval harness's unit tests are included in the Vitest Node project.

The harness workspace must not expose the checkout, evaluator records or privileged credentials to
the agent being scored. Isolation is platform-specific; tests exercise macOS sandboxing and Linux
custody separately. Keep credential resolution in `evals/lib/credential.ts` and secret handling in
`evals/lib/secrets.ts`. `evals/scripts/spike-inbox-oauth.ts` is a manual live-provider probe retained as the
measurement behind the credential contract; it is not a CI task or an unused runner.

Stage eval changes by explicit filename; never use `git add -A` after an eval run. Review transcripts and
metrics before staging so task output and credentials cannot enter a commit. Only checks explicitly
selected by a task determine its verdict; other measurements remain informational.
