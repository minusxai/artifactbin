---
name: http-auth
description: Shared origin-scoped credentials, email authentication and serialized refresh for CLI and HTTP.
---
## Read first

First reuse saved credentials for [[ base ]]: try the helper request below. Sign in only after `auth_required` (missing/revoked grant). `refresh_unavailable` and other transient failures retain the grant: retry later, without sending another OTP. Authenticate as the recipient; a sender’s login or public link does not grant editing.

The shared helper needs Node 22 and filesystem access. If this skill is installed, use `scripts/credentials.mjs` from its folder. Otherwise download the same standalone helper without installing afbin:

```sh
curl -fsSL '[[ base ]]/skills/artifactbin/credentials.mjs' -o artifactbin-credentials.mjs
node artifactbin-credentials.mjs request --origin '[[ base ]]' --path /api/artifacts
```

The examples below use the installed helper path; substitute `artifactbin-credentials.mjs` for the downloaded file.

## Sign in only when required

HTTP authentication requires an email account.

Send JSON to `[[ base ]]` with `Content-Type: application/json`; session requests need `Origin: [[ base ]]`.

1. `POST /api/auth/email-otp/send-verification-otp` with `{"email":"you@example.com","type":"sign-in"}`; ask for the emailed OTP.
2. `POST /api/auth/sign-in/email-otp` with `{"email":"you@example.com","otp":"<user's code>"}`; retain returned cookies in a private jar.
3. `POST /api/authentication/token` with those cookies and Origin. Verified email sessions receive `access_token`, `refresh_token`, `client_id`, `expires_in` (seconds), `token_type: "Bearer"` and `scope: "artifacts"`.
4. Save the new grant into the shared CLI/filesystem HTTP credential store; do not create a second rotating-token copy. In the installed artifactbin skill folder run:

```sh
node scripts/credentials.mjs path --origin '[[ base ]]'
node scripts/credentials.mjs save --origin '[[ base ]]' < private-oauth-response.json
node scripts/credentials.mjs request --origin '[[ base ]]' --path /api/artifacts
node scripts/credentials.mjs request --origin '[[ base ]]' --path /api/artifacts/ID/prepare --method POST --body-file edit.json
```

Requests use `Authorization: Bearer <access_token>` only on the saved origin. Save reads the OAuth JSON from private stdin; protect/delete any temporary response file. Never put tokens in command arguments, URLs, docs, source control or logs. Request reads saved credentials, serializes refresh, atomically rotates both tokens and retries once. Reuse it for API requests instead of manually refreshing. Use `--account ID` only for the account observed on this origin. Sign-out closes the temporary email session, not the saved grant.

Storage root: `ARTIFACTBIN_HOME`, otherwise `~/.artifactbin`; private directories `0700`, credentials `0600`. HTTPS port 443 uses `hosts/<hostname>/credentials.env`; other origins use `hosts/<hostname>@<scheme>-<port>/credentials.env` (safe hostname encoding). The helper returns the actual backing path: readable locations may alias an existing hashed store for compatibility with older CLI writers. Do not copy, rename or independently rotate an alias. Fields are `ARTIFACTBIN_URL`, `ARTIFACTBIN_TOKEN`, `ARTIFACTBIN_REFRESH_TOKEN`, `ARTIFACTBIN_CLIENT_ID`, `ARTIFACTBIN_EXPIRES_AT` (Unix milliseconds).

Each runtime has its own grant. Without filesystem access use a persistent secret store with atomic replacement and serialized single-use refresh; otherwise sandbox replacement requires email login. For that adapter `POST /oauth/token` with `{"grant_type":"refresh_token","client_id":"<saved client_id>","refresh_token":"<saved refresh_token>","resource":"[[ base ]]/api"}`. Atomically replace both tokens/expiry before retry once. Repeat email login only for missing credentials or `invalid_grant`; retain credentials on transient errors.
