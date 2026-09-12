# Ownership: the CLI connects, the account owns

- **The one door**: `afbin` opens browser approval the first time a command needs the server (run
  `afbin auth` to do it deliberately). The person approving either logs in — the connection then
  belongs to their account, and so does everything it publishes — or continues anonymously, in which
  case the connection owns what it creates and no account does. Nothing else issues a credential:
  there is no public mint, no token page, and no surface that asks a person to paste one.
- **Where the credential lives**: privately in `~/.artifactbin/.env` (0600), scoped to its server
  origin. Access tokens cover the `/api` resource; rotating refresh tokens keep approved clients
  signed in without extending access-token lifetime. Noninteractive setup returns a pending approval
  URL and expiry; browser consent remains required.
- **Reach**: an account-bound connection reaches everything that account owns; an anonymous one
  reaches only what it itself created.
- Connections are stored hash-only, shown once to the CLI alone, and listed and revoked on `/account`.
