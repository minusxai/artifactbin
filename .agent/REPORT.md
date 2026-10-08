# Claude config environment report

Managed Claude launches now preserve whether `CLAUDE_CONFIG_DIR` was supplied by the caller. Implicit config removes the variable from the child environment so Claude uses its native default authentication namespace; explicit config restores the resolved absolute path. New resumable records save this choice, validate it, and restore it on resume. Legacy records keep their prior explicit-path behavior and become explicit records when resumed.

TDD evidence: the seeded `npm test -- --files services/cli/test/config.test.ts` failed before implementation because `claudeConfigEnvironment` was not exported. After implementation, the focused config, conversation, and remote-launch tests passed (3 files, 39 tests). The launch test starts real worker processes and checks both unset implicit config and explicit custom config. Conversation tests cover new metadata, implicit and explicit resume behavior, legacy metadata, and malformed metadata.

Validation: `npm run validate` passed. No credentials or account state were touched. Release/version, full suites, gates, and deployment remain with the root orchestrator.
