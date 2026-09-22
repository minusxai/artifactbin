# Remote comment review

`afbin remote --history history.md claude --chrome` starts a detached worker and
returns its session ID, name, terminal URL and `starting` status. No local TTY is
required. The child still runs in a PTY, with the user's ordinary harness settings
and permission checks. `--foreground` retains the previous attached terminal flow.
All afbin flags precede the executable; the executable's arguments are preserved.

Names default to the executable basename. Managed names match
`[a-z][a-z0-9_-]{0,31}`; a durable partial unique index reserves each active name
per account and deployment. Use `--name claude2` for another Claude instance.
Mentions retain session IDs, so a newly launched Claude never inherits an old
session's comments. Colors derive consistently from the session ID.

## Boundaries

- `remote-launch` owns validation and the detached IPC handshake. Credentials
  cross the private pipe, never argv or a launch file. The worker owns its PTY.
- `remote-worker` snapshots optional UTF-8 history (maximum 128 KiB), writes an
  owner-only context file, and records its digest and lifecycle metadata through
  the CLI's SQLite state boundary. Context is deleted on graceful worker exit.
  A SIGKILL may leave the private directory; reboot recovery is not implemented.
- `remote-context` composes the shared review policy with each harness's initial
  prompt. The handoff names an absolute CLI shim: login shells may replace PATH.
  Arbitrary executables still run, but must explicitly acknowledge readiness if
  they are to consume managed comment requests.
- `remote/registry` keeps terminal replay and interactive input in memory.
  `remote/agents` owns durable identity, reservations and request receipts.
  This still requires one app relay process; horizontal terminal routing is not
  implemented. An app restart restores the same session, proof and color.
- Annotation transactions enqueue human mentions atomically. Only the mentioning
  account's sessions are addressed. Agent replies cannot trigger themselves.
  Artifact access is checked again before queued input is dispatched.

## Request protocol

The bootstrap calls `afbin remote --ready <session>` from the worker environment.
Queued comments are held until that receipt arrives. A request identifies the
artifact, thread, original comment and request ID; long comment notifications
carry a bounded excerpt and require reading the original thread.

One request is active per agent. `dispatching` means queued for PTY transport;
`delivered` requires the runner's input acknowledgment. Neither means the model
has started work. The agent reads the artifact and thread, then posts:

```sh
afbin comment <artifact> --thread <thread> --body 'I will check this.' \
  --request <request> --phase acknowledged
# Do and verify the requested work.
afbin comment <artifact> --thread <thread> --body 'Updated and verified.' \
  --request <request> --phase completed --state resolved
```

Use `--phase blocked` with a question when help is needed. Use the absolute
executable specified in the handoff in place of `afbin`. Session proof is sent
in headers, not the recoverable operation body. The server validates account,
session, artifact, thread and transition together with the comment write.
Resolving also checks for newer human comments and unfinished requests. An
uncorrelated reply remains a normal comment and cannot complete a work receipt.

A relay restart marks in-flight work uncertain and does not replay it. Check the
terminal; an explicit new tagged comment supersedes blocked/uncertain work in
that thread. Completed work remains completed. Stopping marks queued work
unavailable and interrupted work uncertain.

## UI and lifetime

A clean reply defaults to the latest human comment's explicit linked targets.
Agent replies and untagged human comments preserve those targets. Removing a
prefill or typing a draft prevents live updates from replacing it. Failed sends
retain the draft; a mention-only reply cannot be submitted.

Each addressed session has one latest-request line, a stable color, and a link
to its terminal. Status changes reuse annotation notifications; an open managed
thread also refreshes every 15 seconds for heartbeat/offline information. Raw
terminal text never establishes working, approval or completion status.

`afbin remote --stop <session>` requests stop. On the launching machine it uses
SQLite cancellation metadata, so it works during relay outages without signaling
a potentially reused saved PID. The worker terminates its PTY process group and
records its exit. Pending exit receipts are reconciled by the next remote/list
command after connectivity returns. On another machine Stop remains requested
until the worker confirms its exit. Legacy foreground Disconnect still leaves
its local child running; the managed UI explicitly says Stop agent.

macOS and Linux are supported; Windows background mode is refused (use WSL or
foreground). A detached process survives launcher exit, not machine reboot or an
agent host that kills all descendants. A browser-only chat agent cannot launch a
local worker without a shell-capable tool. No Claude Channels, Codex bridge,
permission bypass flags, global daemon or terminal-prose parser is used.

## Verification

Behavioral tests cover detached startup, private IPC, bounded startup failure,
history validation, real PTY delivery/exit and descendant cleanup, name conflicts,
relay restart uncertainty, scoped proofs, atomic acknowledgment/completion,
resolution guards, reply defaults and failed sends. The existing binary CI matrix
also runs detached startup from the packaged executable outside the checkout.

Live provider checks are separate from deterministic CI. On this development
machine Claude completed an acknowledgment → file task → verified final reply,
and handled a blocked request followed by a tagged follow-up. Codex/OpenCode
canary results are recorded in the implementation handoff. Pi starts its PTY but
has no authenticated models configured locally; live-model Pi behavior remains
unverified. Optional lifecycle hooks are not installed: unsupported approval and
turn states remain unknown, and the web terminal exposes the harness's normal
approval UI.
