# Claude resume agent name report

Root cause: `parseCommand` rejected every `remote --resume ... --name ...` invocation, even though dispatch already supports a launch name. In addition, resumable Claude records did not store the original remote agent name, so a resume silently returned to the default `claude` name and could collide with another active agent.

The parser now permits an explicit resume name. New conversation records save the effective name and normal resumes reuse it; explicit `--name` overrides are propagated into worker IPC and the updated record. Legacy records get a deterministic `claude-<first 16 UUID hex>` name. No remote session is removed or stopped automatically.

TDD: the new `remote --resume ID --name claude2` test failed before the parser fix with `invalid_arguments`. After the full change, selected checks passed: `services/cli/test/claude-conversation.test.ts`, `services/cli/test/remote-launch.test.ts`, and `services/cli/test/help.test.ts` (64 tests); `npm run validate` passed. `npm run release:cli` bumped afbin from 0.4.47 to 0.4.48.
