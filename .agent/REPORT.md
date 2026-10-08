# Claude resume agent name report

Root cause: `parseCommand` rejected every `remote --resume ... --name ...` invocation, even though dispatch already supports a launch name. In addition, resumable Claude records did not store the original remote agent name, so a resume silently returned to the default `claude` name and could collide with another active agent.

The parser now permits an explicit resume name. New conversation records save the effective name and normal resumes reuse it; explicit `--name` overrides are propagated into worker IPC and the updated record. Legacy records get a deterministic `claude-<first 16 UUID hex>` name. No remote session is removed or stopped automatically.

TDD: the new `remote --resume ID --name claude2` test failed before the parser fix with `invalid_arguments`. After the full change, selected checks passed: `services/cli/test/claude-conversation.test.ts`, `services/cli/test/remote-launch.test.ts`, and `services/cli/test/help.test.ts` (64 tests); `npm run validate` passed. `npm run release:cli` bumped afbin from 0.4.47 to 0.4.48.

## Managed Claude comment delivery

On official Claude Code 2.1.293, a synthetic managed comment was sent after a benign manual turn. An exact 1,316-character candidate written as ordinary PTY input appeared in the transcript only as its final 296 characters; the first 1,020 characters were missing. The same candidate with bracketed-paste delimiters appeared intact. A follow-up replay invoked the actual `deliverRemoteInput` helper after a completed benign manual turn: it emitted paste-start, payload, paste-end, and submit in that order with no delay between the final two writes. Claude recorded the full candidate, artifact ID, and request ID (with its pasted-content wrapper). Tools were disabled; no credentials, trust settings, or permission settings were changed. The probe script and sanitized result are `/tmp/afbin-claude-immediate-paste-probe.mjs` and `/tmp/afbin-claude-immediate-paste-evidence.json`.

Managed Claude comments now use the existing explicit bracketed-paste boundary used for managed Codex comments, followed by one distinct submit. Unmanaged comments and keyboard input retain existing behavior. The `runRemote` regression test uses a large synthetic body and verifies the complete request, including artifact/request IDs, plus exactly one submit. A separate test verifies an exited PTY does not receive Enter for either provider.

TDD: the new selected test failed before implementation because managed Claude input had no paste prefix. After implementation and CLI version bump, `npm test -- --files services/cli/test/runner.test.ts` passed 17/17 and `npm run validate` passed. `git diff --check` passed. No full suite, gates, push, or deploy were run.
