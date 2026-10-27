---
name: commands
description: "Rules and invocations for commands."
---
## Read first

Run `afbin -h` for the command list and `afbin <command> -h` for exact invocation and flags. `afbin help <topic>` reads this same skill folder. HTTP operation methods and paths are in [HTTP API](http-api.md). Local preview, workspaces, npm scripts and filesystem registration require the CLI and shell.

## watch

```text
afbin watch <url|id|file> --comments --json [--output <file>]

Follow new comments, replies, edits and reactions (people's and agents'; skip events marked you: your own writes) as NDJSON until cancelled; a local file is followed offline from the workspace; --cursor resumes an explicit checkpoint. Run it with a tool that wakes you on each output line; a stdout that is a file or discarded is refused, and --output appends the events to a log file on purpose instead.

  -h, --help
    Show local command help.
  --version
    Show the installed CLI version.
  --json
    Write JSON to stdout (watch: NDJSON); diagnostics go to stderr.
  --server <URL>
    Use this server origin for this command.
  -y, --yes
    Accept confirmation defaults for this operation; never bypass authentication.
  --comments
    Follow new comments, replies, edits and reactions from people and agents.
  --cursor <CURSOR>
    Continue from a returned next_cursor.
  -o, --output <PATH>
    Write resulting content to this file or directory.

Examples:
  afbin watch abc123 --comments --json
  afbin watch report.jsx --comments --json
  afbin watch report.jsx --comments --json --output comments.ndjson
```

Use `--server <origin>` to select the artifact server; keep any returned cursor with that origin and artifact. Ctrl-C cancels the foreground stream. See [monitoring](monitoring.md) for checkpoint and notification rules.
