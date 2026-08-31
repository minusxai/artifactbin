# Ownership: anonymous by default, accounts when you want them

- **Anonymous**: `POST /api/tokens/anonymous` → a bearer token (`mx_…`),
  IP-rate-limited. Artifacts belong to the token.
- **Claim**: sign up, paste the token on `/tokens` — everything it published
  (past and future) attaches to your account.
- **OAuth (MCP clients)**: add `/mcp` with no credentials and the client pops
  a browser — approve in one click as a guest (anonymous claimable token) or
  while logged in (user-owned token). The access token IS an `mx_` token.
- Tokens are stored hash-only, shown once, soft-revocable from `/tokens`.
