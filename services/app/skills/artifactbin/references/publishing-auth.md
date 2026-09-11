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

The new-token page defaults to 1 year (365 days). API mints with no expiry specified default to 6 h; `expiresInHours` may be 1–8760 at mint, and `expiresAt` says exactly when. On a `401` or an expired token, do not retry blindly: ask your human for a fresh one the same way, save it, and resume the interrupted work.

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

## Dataset access policies

Owners change write policies through `GET` / `PUT [[ base ]]/api/artifacts/<id>/policy`
(`get_dataset_policy` / `set_dataset_policy` over MCP). GET returns the current
policy, revision, columns and dependent actions. Editors can inspect policies;
GET includes `canManage`. PUT accepts
`{ "policy": {…}, "expectedPolicyRevision": 0 }`; use the revision you just read.
`400 invalid_policy` identifies an unsupported field or invalid value;
`409 policy_changed` requires reading the current policy before saving again.

Version 1 uses Hasura write-permission entries: `insert_permissions`,
`update_permissions`, `delete_permissions`, with `role`, `permission`, `columns`,
`filter`, `check`, and trusted `set` presets. Use `role: "viewer"` for everyone
with dataset view access, including commenters, editors and owners. Missing
operations deny writes. Sharing is the only audience control; there is no
separate mutation grant or audience selector. Public/unlisted datasets allow
anonymous readers to execute declared actions permitted by these rules; private
datasets require a share. A public app does not bypass private dataset access.
Existing datasets without policy retain editor-only writes. Read-only remains
absolute. Write policies do not hide data or filter reads.

Policy actions grant no raw SQL submission, artifact editing or policy administration.
Policy refusals return `403 policy_denied`. To replace or revert the entire file,
the owner must explicitly remove its policy first (`policy: null`); ordinary
editors cannot bypass row rules through those paths.
