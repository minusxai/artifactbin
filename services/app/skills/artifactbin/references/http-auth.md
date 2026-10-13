---
name: http-auth
description: Shared origin-scoped credentials, email authentication and serialized refresh for CLI and HTTP.
---
## Read first

[% include "fragments/http-authentication.md" %]

Verified email sessions receive `access_token`, `refresh_token`, `client_id` and `expires_in` from the token endpoint.

## Storage and refresh

The installed helper is `scripts/credentials.mjs`; substitute that path for `credentials.mjs` above. `refresh_unavailable` and transient errors retain the saved grant; retry later without another OTP. The helper’s `path --origin` command reports the actual backing file. Do not install the CLI to work around missing HTTP credentials.

Storage root: `ARTIFACTBIN_HOME`, otherwise `~/.artifactbin`; private directories `0700`, credentials `0600`. HTTPS port 443 uses `hosts/<hostname>/credentials.env`; other origins use `hosts/<hostname>@<scheme>-<port>/credentials.env` (safe hostname encoding). The helper returns the actual backing path: readable locations may alias an existing hashed store for compatibility with older CLI writers. Do not copy, rename or independently rotate an alias. Fields are `ARTIFACTBIN_URL`, `ARTIFACTBIN_TOKEN`, `ARTIFACTBIN_REFRESH_TOKEN`, `ARTIFACTBIN_CLIENT_ID`, `ARTIFACTBIN_EXPIRES_AT` (Unix milliseconds).

Each runtime has its own grant. Without filesystem access use a persistent secret store with atomic replacement and serialized single-use refresh; otherwise sandbox replacement requires email login. For that adapter `POST /oauth/token` with `{"grant_type":"refresh_token","client_id":"<saved client_id>","refresh_token":"<saved refresh_token>","resource":"[[ base ]]/api"}`. Atomically replace both tokens/expiry before retry once. Repeat email login only for missing credentials or `invalid_grant`; retain credentials on transient errors.

## Account destination preferences

See [groups](groups.md) for the authenticated group/default API and editor/viewer permissions. Reuse this origin’s recipient credential helper for those calls.
