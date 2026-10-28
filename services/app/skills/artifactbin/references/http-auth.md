---
name: http-auth
description: Direct HTTP email sign-in, origin-scoped credential storage and OAuth refresh.
---
## Read first

Check origin-matched environment credentials, `[[ credentialPath ]]` (`ARTIFACTBIN_HOME` overrides `~/.artifactbin`) or your secret store. Require `ARTIFACTBIN_URL` to equal [[ base ]]; send `Authorization: Bearer <access_token>` only there. Refresh via `POST /oauth/token` before login; retain credentials on network/429/5xx failures. A 403 is not a login failure; [details](http-auth.md#storage-and-refresh).

HTTP authentication requires an email account. Only missing, revoked or unrefreshable credentials need sign-in. [[ authenticationInstruction ]] Send JSON with `Content-Type: application/json` and `Origin: [[ base ]]`:

1. `POST /api/auth/email-otp/send-verification-otp` with `{"email":"<recipient email>","type":"sign-in"}`. Ask for the emailed OTP; wait for the reply.
2. `POST /api/auth/sign-in/email-otp` with `{"email":"<recipient email>","otp":"<user code>"}`. Retain cookies privately.
3. `POST /api/authentication/token` with those cookies. `201` returns `access_token`, `refresh_token`, `client_id` and `expires_in`.

Sign-in: `account_created_this_login`. Token: `has_created_document` (first-artifact design).

Save origin, tokens, client ID and expiry privately in that store across sessions (without files, a persistent secret store). Atomically replace rotated tokens and expiry; never duplicate a rotating grant.

Verified email sessions receive an OAuth bearer/refresh grant through the email-session token endpoint; email OTP is not an OAuth grant type. No product installation is needed.

`account_created_this_login` says whether this sign-in created the account. `has_created_document` reflects documents the user created, including group-owned documents and trash; use it for first-artifact guidance.

## Installed scripts

`node scripts/auth.mjs status` reports this origin's grant without secrets. Start `auth.mjs login --email ADDRESS`; wait for the user's emailed OTP, then `auth.mjs login --challenge HANDLE --code-file FILE`. The private wrapper handle is origin-bound. Credentials reuse the existing private origin store and serialized refresh. `auth.mjs logout` removes the local grant only: no self-revocation endpoint exists, and an environment grant remains active. Select `--server ORIGIN` if different from the archive origin. No token appears in results or journals.

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
