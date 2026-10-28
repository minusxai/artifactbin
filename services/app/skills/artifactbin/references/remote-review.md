---
name: remote-review
description: Existing remote agent review, session and completion rules.
---
## Read first

Start a background listener with afbin remote --history history.md claude (or codex, pi, opencode). Use --name claude2 for another instance; stop with --stop <id>. Names are lowercase letters, digits, underscores and hyphens, starting with a letter. Explicit same-account human mentions drive work. Read each request, acknowledge in its thread before work, verify, then reply completed or blocked. Use --thread <id> --request <id> --phase acknowledged|completed|blocked with a reply. Resolve only when addressed and no later request remains. Use the exact CLI executable in the private handoff. Background launch defaults: Claude uses --dangerously-skip-permissions (skips permission prompts); Codex uses --yolo (no approval prompts or Codex sandbox). Explicit permission flags and Codex profiles override these defaults, for example afbin remote codex --sandbox workspace-write --ask-for-approval on-request or afbin remote claude --permission-mode default. Pi has no built-in tool approval prompts, so it needs no extra flag; extensions and project trust can still ask. OpenCode receives OPENCODE_PERMISSION={"*":"allow"} only in its child environment; an explicitly supplied OPENCODE_PERMISSION is preserved. These defaults apply only to new background sessions, not --foreground or --session attachments, and do not edit user configuration files. Login, project trust, managed policies and remaining harness prompts may still require the person in the terminal. Terminal output is not completion evidence. Background mode survives launcher exit on macOS/Linux; host process cleanup and reboot can stop it. Live model/provider authentication must already be configured.
## Complete the requested work

For editing requests, update and publish the artifact before reporting completion or resolving; a reply alone is not completion. For questions, answer directly without unsolicited edits.

## Managed context and sandbox approval

Managed helpers restore only their session’s Artifactbin context through a private memory-only local socket on macOS and Linux. If shell filtering removes the context, use the exact helper in the private handoff. A sandbox that blocks local sockets reports remote_context_blocked: request approval for that exact command through the harness’s existing approval flow, then retry once approved. Never change sandbox, shell environment policy or permissions. If approval is unavailable or denied, report the block and wait for the operator. A stopped worker reports remote_context_unavailable and requires restarting the remote agent. Windows retains inherited environment behavior without this socket bridge.

## Flag placement

Put every afbin flag before the agent executable (codex, claude, pi or opencode), including --json, --yes, --server, --name and --history. For a JSON launch receipt:

```sh
afbin remote --json codex
```

Do not use `afbin remote codex --json` when --json is intended for afbin: everything after codex is passed unchanged to Codex. Leave the agent name last unless you deliberately want to pass agent-specific arguments, such as `afbin remote --json claude --chrome`. --json is supported for background launches, not --foreground or --session attachments.

## Inspect comment screenshots

Read [comment screenshots](publishing-annotations.md#inspect-comment-screenshots) before replying about attached images; the shared guide supplies the image download and viewing instructions.
