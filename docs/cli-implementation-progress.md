# CLI-first implementation

Approved contract: https://artifactbin.dev/@ppsreejith/cVcRIp (v29).
Review: https://github.com/minusxai/artifactbin/pull/84. One OSS PR; no merge or deployment.
The pre-production breaking-design instruction supersedes historical compatibility proposals.

## Phases

1. [x] Foundations: canonical references, migration rehearsal, read-only preparation, conditional
   state, durable create identity, browser/device auth, filesystem recovery and package boundaries.
2. [x] Shared command schema, fenced JSX model, diagnostics, recovery contracts and core agent probes.
3. [x] Local-first sync, conditional metadata/source writes and immutable request recovery.
4. [x] Dependencies, bounded pagination, comments and complete HTTP operation access.
5. [x] Generated local help, man page and skill bundle from the command/operation vocabulary.
6. [x] Browser-first setup, detected harness checklist, remembered opt-outs and unattended operation.
7. [x] One-time Markdown conversion to adjacent editable JSX, preserving the original.
8. [x] Four native release targets, npm packaging and compatible binary/skill update recovery.
9. [x] Release agent regression: two pi/DeepSeek runs and two OpenCode/GLM runs.
10. [ ] PR CI verification. The final full browser run passed. Runtime MCP and remote skills are removed;
    the production content migration is deliberately an operator action after review.

## Boundaries

Contracts own the reference vocabulary. Normal parsers reject retired syntax; only the maintenance
migration recognizes it. Publication preparation has no persistence capabilities. Apply owns the
transaction, immutable operation identity, conditional state check, object commit and notifications.
CLI adapters delegate to document, workspace, sync, auth and installation modules. Local commands
load bundled teaching and saved snapshots without authentication or release polling.

Each create/upload journals the complete frozen request before HTTP. The account/origin-scoped ledger
returns its original response for one day, then its surviving ID. Deleted results never recreate.
Working-file and lock updates have a recoverable journal and advisory lock. A failed publish remains
recoverable even from a child directory before the first lock exists. Archive collisions never discard
an older proposal. Empty dry-run pushes remain local and do not initiate authentication.

## Executed validation

- Full suite: 185 API files / 1,382 tests; 373 Node files / 3,712 passed and one skipped;
  176 UI files / 1,320 tests; 93 CLI tests. The later malformed-settings regression increases the CLI
  suite to 94 tests; the settings/updater focused run passed all 10 checks.
- TypeScript, residual-name guard, lockfile dry-run and production build passed.
- Migration: 22 focused checks cover all preview pages before writes, fingerprint refusal, retained
  history/deleted artifacts, backup records, final audit, joined query meaning and anchored comments.
- Native builds and offline/PTY gates pass on Darwin arm64, Darwin x64 under Rosetta, and Linux
  arm64/x64 in isolated Docker builds. These are local acceptance results, not CI attestations.
- Real standalone 0.1.4 → 0.1.5 replacement verifies executable and matching skill checksums and keeps
  the original binary backup. Modified skill files retain backups; shared physical destinations update once.
- Neo completed login and browser approval on the composed build. Credentials include a refresh token
  and are saved with mode 0600. The CLI created, edited and retitled a document, posted/read a comment,
  listed history and pulled. The document rendered its updated paragraph in Neo.
- That HTTP walk used one request each for create, body edit and metadata edit. Unchanged pushes,
  validation, status and diff added zero requests. All seven originally failing browser gates passed
  focused reruns, followed by a clean complete run: 52/52 gates in 336 seconds across three servers.

## Release-agent observations

Harnesses: pi 0.77 with `accounts/fireworks/models/deepseek-v4-flash-0731`; OpenCode 1.18.23 with
`accounts/fireworks/models/glm-5p3-flash`. Each ran in a disposable home/workspace with private
connections inaccessible, local skills and the real standalone executable. A controlled release mirror
served the tested binary/bundle. The HTTP fault fixture dropped a committed creation response.

| Harness | Run | Checks | Seconds | Commands | Help reads | Invalid command/flag diagnostics |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| pi / DeepSeek | 1 | 20/20 | 171.83 | 38 | 3 | 0 |
| pi / DeepSeek | 2 | 20/20 | 149.36 | 30 | 4 | 0 |
| OpenCode / GLM | 1 | 20/20 | 147.25 | 31 | 1 | 0 |
| OpenCode / GLM | 2 | 20/20 | 154.92 | 36 | 2 | 1 |

OpenCode tried `afbin status metadata.jsx`. The CLI returned `Usage: afbin status`; the run recovered.
No destructive mistakes occurred. Every run verified creation, body/metadata edits, historical restore,
conflict preservation, dependency publication, fork, anchored comment, reply/resolution, lost-response
recovery without duplicate creation, Markdown import, pagination, selected local skills, real update,
unattended approval and local-only finish. Provider cost was not reported by this runner.
These runs precede only the malformed-settings refusal fix, which has separate failing-then-passing
coverage; native builds were repeated after that fix. No claim of error-free general agent behavior.

## Release and deployment boundary

MCP and runtime remote-skill routes are absent. Versioned downloadable skill bundles remain. Release
CI builds/tests four targets and publishes only assets from the successful main CI run. This PR does
not publish a release, merge, advance a production submodule pin or migrate production data.

Follow `cli-reference-cutover.md`: rehearse on a backup, stop writers, inventory all heads/history,
back up every proposal, apply with fingerprint checks, require a clean final audit, and verify rendered
content/comments before resuming writes. Ambiguous content is refused for manual review. macOS
binaries are ad-hoc signed; public notarization requires the publisher's signing credentials.

## Final gate record

The full browser run passed 52/52 gates without retries. The npm package installed and validated JSX
in a fresh Node 22 container without Python or a compiler, creating no credential state. Final native
checks passed on all four targets after the settings fix. The 94-test CLI suite, generated teaching
check, TypeScript and whitespace/residual guards passed. PR CI verification remains pending.
