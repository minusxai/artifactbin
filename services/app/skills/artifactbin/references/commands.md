---
name: commands
description: "Rules and invocations for commands."
---
## Read first

Run `afbin -h` for the command list and `afbin <command> -h` for exact invocation and flags. `afbin help <topic>` reads this same skill folder. HTTP operation methods and paths are in [HTTP API](http-api.md). Local preview, workspaces, npm scripts and filesystem registration require the CLI and shell.

## watch

```text
afbin watch <url|id> --comments --json

Follow new human comments and replies as NDJSON until cancelled; --cursor resumes an explicit checkpoint.

  -h, --help
    Show local command help.
  --version
    Show the installed CLI version.
  --json
    Write one JSON document to stdout; diagnostics go to stderr.
  --server <URL>
    Use this server origin for this command.
  -y, --yes
    Accept confirmation defaults for this operation; never bypass authentication.
  --comments
    Follow new human comments and replies.
  --cursor <CURSOR>
    Continue from a returned next_cursor.

Examples:
  afbin watch abc123 --comments --json
```

Use `--server <origin>` to select the artifact server; keep any returned cursor with that origin and artifact. Ctrl-C cancels the foreground stream. See [monitoring](monitoring.md) for checkpoint and notification rules.
