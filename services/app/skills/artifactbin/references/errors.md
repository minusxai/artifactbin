---
name: errors
description: Refusal recovery and conflict safety across CLI and HTTP.
---
## Read first

Read the returned error code and recovery instruction. A refusal is not successful publication. Keep the proposed file after a conflict, observe the current artifact and reconcile the intended edit. Never silently overwrite a changed head. Retry uncertain writes with the same command/body and idempotency key so recovery returns the original result.

`afbin help errors` provides these rules; exact command flags are in `afbin <command> -h`. HTTP refusals carry non-success JSON; see [HTTP API](http-api.md).

- `cli_npm_required`: prepare Node with [[ base ]]/chat/install-node.sh (Windows: install-node.ps1), then run the selected server’s npm setup from [installation](npm-local.md).
- `doc_changed` / 409: reread the head and reconcile; do not reuse stale version or graph claims.
- Invalid JSX/SQL: follow the validation error and allowlist, then prepare again.
- 401: use the shared credential helper to serialize refresh and retry once. Missing or revoked credentials require email sign-in.
- 403: confirm the recipient's own identity and artifact/dataset permission. A public or unlisted link grants reading, not ownership or dataset writes.
- Capacity/transient failures: retain credentials and pending intent, follow retry guidance; avoid duplicate creation.
