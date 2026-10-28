# Ownership: the CLI connects, the account owns

- **The one door**: `afbin` opens browser sign-in the first time a command needs the server (run
  `afbin auth` to do it deliberately). A browser already signed in on the same machine connects with no
  click (loopback redirect + PKCE); otherwise the person logs in with email, or approves a code on the
  device page from a remote machine; the connection
  then belongs to their account, and so does everything it publishes. No agent-facing surface issues a credential:
  there is no public mint, no token page, and no surface that asks a person to paste one. (An operator
  holding the deployment's `ADMIN__SECRET` can mint for operational use; without it that door is a 404.)
- **Where the credential lives**: privately in `~/.artifactbin/hosts/<origin-id>/credentials.env` (0600), scoped to its server
  origin. Access tokens cover the `/api` resource; rotating refresh tokens keep approved clients
  signed in without extending access-token lifetime. Noninteractive setup returns a pending approval
  URL and expiry; server browser consent remains required. File preview needs no server login;
  shared preview names are attribution, not verified identity.
- **Reach**: a connection reaches everything its account owns.
- Connections are stored hash-only, shown once to the CLI alone, and listed and revoked on `/account`.
