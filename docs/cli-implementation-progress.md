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
10. [x] Product release gates: full browser, unit, native, image and compose checks passed.
    Each head’s final PR checks remain the review gate. Runtime MCP and remote skills are removed;
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

- Full merged suite: 186 API files / 1,385 tests; 382 Node files / 3,772 passed and one skipped;
  185 UI files / 1,363 tests. The final CLI suite passes 97 tests. Later evaluator changes pass
  all 45 evaluator files / 499 tests, including browser-first authorization and health readiness.
- TypeScript, residual-name guard, lockfile dry-run and production build passed.
- Migration: 22 focused checks cover all preview pages before writes, fingerprint refusal, retained
  history/deleted artifacts, backup records, final audit, joined query meaning and anchored comments.
- Native builds and offline/PTY gates pass on Darwin arm64, Darwin x64 under Rosetta, and Linux
  arm64/x64 in isolated Docker builds. The four corresponding native CI jobs also pass.
- Real standalone 0.1.4 → 0.1.5 replacement verifies executable and matching skill checksums and keeps
  the original binary backup. Modified skill files retain backups; shared physical destinations update once.
- Neo completed login and browser approval on the composed build. Credentials include a refresh token
  and are saved with mode 0600. The CLI created, edited and retitled a document, posted/read a comment,
  listed history and pulled. The document rendered its updated paragraph in Neo.
- That HTTP walk used one request each for create, body edit and metadata edit. Unchanged pushes,
  validation, status and diff added zero requests. All seven originally failing browser gates passed
  focused reruns, followed by a clean complete run. After merging the new editor, both full CI browser
  shards passed; Neo confirmed title/theme persistence and an intact comment.

## Release-agent observations

Harnesses: pi 0.77 with `accounts/fireworks/models/deepseek-v4-flash-0731`; OpenCode 1.18.23 with
`accounts/fireworks/models/glm-5p3-flash`. Each ran in a disposable home/workspace with private
connections inaccessible, local skills and the real standalone executable. A controlled release mirror
served the tested binary/bundle. The HTTP fault fixture dropped a committed creation response.

| Harness | Run | Checks | Seconds | Commands | Help reads | Invalid command/flag diagnostics |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| pi / DeepSeek | 1 | 20/20 | 152.45 | 36 | 0 | 0 |
| pi / DeepSeek | 2 | 20/20 | 155.48 | 39 | 4 | 0 |
| OpenCode / GLM | 1 | 20/20 | 140.08 | 34 | 3 | 0 |
| OpenCode / GLM | 2 | 20/20 | 160.35 | 30 | 3 | 0 |

These final merged-build runs produced no invalid command/flag diagnostics or destructive mistakes.
An earlier OpenCode run tried `afbin status metadata.jsx`, received `Usage: afbin status`, and recovered.
Every final run verified creation, body/metadata edits, historical restore, conflict preservation,
dependency publication, fork, anchored comment, reply/resolution, lost-response recovery without
creating duplicates, Markdown import, pagination, selected local skills, real update, unattended
approval and local-only finish. The approval transcript includes `approval_required` and a verification
URL; no credentials were fabricated. Provider cost was not reported by this runner.

The grader now requires the actual quote/node anchor and accepts an optional terminal period in the
comment body. Its test reproduces the previous punctuation-only false failure. Failed or timed-out
probe legs exit unsuccessfully. The man-page-only refactor after these runs preserves visible teaching
and has an observed passing → broken → passing literal-escaping check. No claim of error-free general
agent behavior follows from four successful trials.

One interrupted run against an older disposable QA database received a missing `pg_publication`
relation-file error during device setup. The database was retained; no speculative product change was
made. The current build passed fresh persistent-database restart checks, including retaining the same
pending approval across shutdown and issuing another afterwards. Reproduce with
`npx tsx scripts/probes/device-restart.ts` after building. The final agent runs used fresh isolated state.

## Release and deployment boundary

MCP and runtime remote-skill routes are absent. Versioned downloadable skill bundles remain. Release
CI builds/tests four targets and publishes only assets from the successful main CI run. This PR does
not publish a release, merge, advance a downstream pin or migrate production data.

Follow `cli-reference-cutover.md`: rehearse on a backup, stop writers, inventory all heads/history,
back up every proposal, apply with fingerprint checks, require a clean final audit, and verify rendered
content/comments before resuming writes. Ambiguous content is refused for manual review. macOS
binaries are ad-hoc signed; public notarization requires the publisher's signing credentials.

## Final gate record

The full browser shards, split-stack compose walk, image, build, type checks, all unit-test shards,
and four native targets passed in [CI run 34536577027](https://github.com/minusxai/artifactbin/actions/runs/34536577027).
Compose and agent seed fixtures now supply the same observed version/state guards required of every replacement;
the evaluator probes `/health`, because runtime remote-skill routes are gone. The npm package also
installed and validated JSX in a fresh Node 22 container without Python or a compiler, creating no
credential state. The final branch checks, including CodeQL and paid agent smoke, are attached to
[PR #84](https://github.com/minusxai/artifactbin/pull/84).
