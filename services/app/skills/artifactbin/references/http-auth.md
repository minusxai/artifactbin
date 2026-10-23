---
name: http-auth
description: Direct HTTP email sign-in, origin-scoped credential storage and OAuth refresh.
---
## Read first

[% include "fragments/http-authentication.md" %]

Verified email sessions receive an OAuth bearer/refresh grant through the email-session token endpoint; email OTP is not an OAuth grant type. No product installation is needed.

`account_created_this_login` says whether this sign-in created the account. `has_created_document` reflects documents the user created, including group-owned documents and trash; use it for first-artifact guidance.

## Storage and refresh

The exact backing file for [[ base ]] is `[[ credentialPath ]]`. Storage root is `ARTIFACTBIN_HOME`, otherwise `~/.artifactbin`. Use private directories (`0700`) and a private file (`0600`), with one `NAME=value` per line:

| Field | Value |
| --- | --- |
| `ARTIFACTBIN_URL` | `[[ base ]]` |
| `ARTIFACTBIN_TOKEN` | `access_token` |
| `ARTIFACTBIN_REFRESH_TOKEN` | `refresh_token` |
| `ARTIFACTBIN_CLIENT_ID` | `client_id` |
| `ARTIFACTBIN_EXPIRES_AT` | Current Unix milliseconds + `expires_in` × 1000 |

An existing client may expose a readable hostname-directory alias to this same backing file. Update the backing file atomically; preserve any alias and never create a second credential copy. Parse values as data, not executable shell. Reuse the current session's grant and saved credentials before starting another sign-in.

Before expiry, or after an API `401`, send `POST /oauth/token` with `Content-Type: application/json` and:

```json
{"grant_type":"refresh_token","client_id":"<saved client_id>","refresh_token":"<saved refresh_token>","resource":"[[ base ]]/api"}
```

Refresh is single-use and must be serialized across every process sharing the grant. Direct file updates require exclusive ownership of the credential store: coordinate with other clients, sharing this grant, before refreshing. Re-read the saved values after acquiring exclusive access; another client may already have refreshed. Atomically save the returned access token, refresh token and calculated expiry, retaining origin and client ID, then retry the API request once. Release exclusive access after saving. Never rotate the same grant concurrently from separate copies.

Keep credentials on network errors, `429`, server errors or incomplete refresh responses and retry later. Missing credentials or `invalid_grant`, `invalid_client` or `revoked_token` require sign-in again. Never log tokens or put them in URLs. Without filesystem access, keep the same values in a persistent secret store with atomic replacement and serialized refresh; if neither storage option is available, credentials cannot survive a new session.

## Account destination preferences

See [groups](html-sharing.md) for group/default APIs and editor/viewer permissions. Use the same origin-bound bearer credential for those requests.
