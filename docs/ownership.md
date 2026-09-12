# Ownership: anonymous by default, accounts when you want them

- **Anonymous**: `POST /api/tokens/anonymous` → a bearer token (`mx_…`),
  IP-rate-limited. Artifacts belong to the token.
- **Claim**: sign up, paste the token on `/tokens` — everything it published
  (past and future) attaches to your account.
- **CLI browser authentication**: afbin opens browser approval automatically the first time a command
  needs the server (run `afbin auth` to do it deliberately) and saves
  an account connection privately in `~/.artifactbin/.env`. Access tokens cover the `/api` resource;
  rotating refresh tokens keep approved clients signed in without extending access-token lifetime.
  Noninteractive setup returns a pending approval URL and expiry; browser consent remains required.
- Tokens are stored hash-only, shown once, soft-revocable from `/tokens`.
