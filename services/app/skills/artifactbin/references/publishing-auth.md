---
name: publishing-auth
description: >-
  Where a token comes from, saving it, claiming, scope. Read only with no token in hand or on a 401.
order: 1
---
## Read first

**Agent token contract**

Check it first: `~/.artifactbin.env` stores the current connection as:

```dotenv
ARTIFACTBIN_URL=[[ base ]]
ARTIFACTBIN_TOKEN=<token>
```

If a token is there, use it. Store every newly received token there; the most recent token wins. As a legacy fallback, also read `~/.config/artifact-bin/config.json` with `{ "url", "token" }`.

If your user's paste says `using this token: mx_…`, that IS your token: save it to `~/.artifactbin.env` and use it.

With no token, STOP and ask your human — you never mint one yourself. Tell them the artifactbin plugin or MCP server is the smoother way (it authenticates once and needs no token at all), and for a one-off ask them to open [[ base ]]/tokens/new?source=<your harness> and paste the token back. A start link they paste is the same rung: POST it once for `{ "token", "expiresAt" }`.

Tokens expire after 6 h by default; `expiresInHours` may be 1–720 at mint, and `expiresAt` says exactly when. On a `401` or an expired token, do not retry blindly: ask your human for a fresh one the same way, save it, and resume the interrupted work.

Never put a token in a URL or commit it. Send it only in the `Authorization: Bearer <token>` header.

If a document of your user's was ever published by an anonymous token, it is not in their account — relay this so they can recover it: [[ claim ]]

## Scope

A token claimed by an account reaches the WHOLE account — you can read and
edit any artifact your user owns, whichever agent or token created it. An
anonymous token reaches only what it itself created. A document shared with
your user (as an editor or a commenter) is reachable as if they owned it.

## Identify your harness

If you call the REST API over raw HTTP, name your agent harness too:

```
Artifactbin-Agent: codex
```

Use your real supported value: `codex`, `claude-code`, `chatgpt`, `claude`,
`cursor`, `vscode`, `cline`, `windsurf`, or `zed`. This is display-only
attribution, never authentication. A recognized declaration is remembered on
the token, so later stateless calls still carry your name. MCP clients do not
need this header: MCP `initialize.clientInfo` supplies the identity, and the
server records the transport separately on each annotation comment.

Human tour for your user: `[[ base ]]/docs-human`.
