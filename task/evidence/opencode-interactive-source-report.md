# OpenCode 1.18.35 interactive resume evidence

The pinned CLI source supports a resumed interactive mini TUI with a startup prompt. In `cli/cmd/run.ts`, `--session` resolves the requested session and reuses its ID unless forked; mini mode passes that session, resume state, and argv prompt into `runInteractiveMode`. `cli/cmd/run/runtime.queue.ts` sends `initialInput` through the normal submit path, while the mini runner remains open to later footer input. The implementation therefore uses one native process, terminal, UUID, and history for startup and subsequent turns.

Mini mode is an interactive split-footer runner, not the full-screen TUI. Its permission rules are empty with `auto:false`, so permission and question events remain interactive. The footer exposes server-listed slash commands plus `/editor`, `/new`, `/exit`, and optional `/skills`; I found no mini built-in `/connect` or `/auth`. Provider/login completion still needs separate validation if a hosted resume requires login.

Mini requires a TTY on stdout and opens `/dev/tty` when stdin itself is not a TTY. The existing hosted PTY is consistent with that contract. The footer uses OpenTUI textarea paste handling, but exact bracketed-paste framing was not verified against the pinned terminal parser. A native smoke test remains appropriate for startup submission, later input, permission prompts, and multiline paste.

Official pinned source:

- [`cli/cmd/run.ts`](https://github.com/anomalyco/opencode/blob/v1.18.35/packages/opencode/src/cli/cmd/run.ts)
- [`cli/cmd/run/runtime.queue.ts`](https://github.com/anomalyco/opencode/blob/v1.18.35/packages/opencode/src/cli/cmd/run/runtime.queue.ts)
- [`cli/cmd/run/runtime.lifecycle.ts`](https://github.com/anomalyco/opencode/blob/v1.18.35/packages/opencode/src/cli/cmd/run/runtime.lifecycle.ts)
- [`cli/cmd/run/footer.prompt.tsx`](https://github.com/anomalyco/opencode/blob/v1.18.35/packages/opencode/src/cli/cmd/run/footer.prompt.tsx)
- [`cli/cmd/run/runtime.boot.ts`](https://github.com/anomalyco/opencode/blob/v1.18.35/packages/opencode/src/cli/cmd/run/runtime.boot.ts)

The hosted CLI now prepares resumed OpenCode with `--mini --session <pinned-id> --prompt <startup-context>` after the existing per-agent database relocation. It no longer runs a separate headless `opencode run` or emits a fallback notice before the interactive terminal. New assertions cover the native argument vector, private database/environment, and PTY-before-exchange ordering. The orchestrator separately reported native OpenCode 1.18.35 proof of startup and a later markerless turn on the same UUID/history/private cwd; that probe was not run by this worktree.
