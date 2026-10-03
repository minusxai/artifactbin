# Hosted agent completion

The production composition enables one persistent managed agent identity per account through `createAppHost({hostedAgent:{secret,model}})`. OSS does not enable it. The existing remote-session UI and comment mentions address that identity; each request runs the packaged Pi program through the existing runner.

The app owns conversation branches, input, checkpoints and cancellation retries. The runner owns execution and receipts. Provider credentials stay in the runner host capability, outside the program. Tool schemas come from the operation registry. Document edits use the shared authoring compiler and the observed `edit_id`; neither a model nor the runner bypasses permissions or conflict checks.

## Acceptance evidence

- `hosted-tools.test.ts`: real creation/read/edit, refusal of stale edits and another user's private document, denied unsupported operations.
- `hosted-runner.test.ts` and `runner-orchestration.test.ts`: Pi execution, comment receipts/fallback replies, durable input across replicas, session-name collision, preserved history, checkpoint/error display, isolated failures and cancellation through late admission/restart.
- `hosted-live.eval.test.ts`: manual paid-provider test using Pi inside the actual local isolate runner and app operation handler. Creates a private report, edits the same report, recalls prior context without tools, and answers a comment from its contents. The four-turn Fireworks DeepSeek v4p1-flash probe passed on October 4, 2026 (29 seconds of test execution). Earlier probe failures were corrected test-adapter issues: the operation prefix was not stripped like the real HTTP bridge, and the test read the obsolete source column instead of canonical markup.
- Production repository composition checks cover the authenticated browser session, signed HTTP runner boundary, network-disabled Docker worker, deterministic model fixture, persisted follow-up context, agent creation/edit read-back and completed comment receipts. These must pass before deployment; the live probe alone does not prove image packaging or production routing.

To repeat the paid local probe, provide `FIREWORKS_API_KEY` in the process environment and run:

```sh
HOSTED_AGENT_LIVE_EVAL=1 npm test -- --files services/app/__tests__/hosted-live.eval.test.ts
```

It uses disposable local database state. Normal CI skips the paid probe and uses deterministic fixtures. Do not put provider secrets in programs, artifacts or test output.

## Deployment boundary

The private deployment enables `HOSTED_AGENT__ENABLED=true`, sets `RUNNER__MODEL`, and configures the runner's `RUNNER__OPENAI_BASE_URL` and `RUNNER__OPENAI_API_KEY`. The app receives no provider credential. Its image must include `agent.ts.txt` beside the app bundle. Hosted requests allow 120 seconds; ordinary Lambda requests retain their 30-second default.

Concurrent requests remain separate preserved branches. Completed conversation history seeds subsequent requests; active branches are reference context, not a guarantee that their unfinished actions succeeded. Cancellation prevents queued dispatch and persists revocation retries. An interrupted run is not automatically replayed because it may already have performed writes.
