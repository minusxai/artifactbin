Check origin-matched environment credentials, `[[ credentialPath ]]` (`ARTIFACTBIN_HOME` overrides `~/.artifactbin`) or your secret store. Require `ARTIFACTBIN_URL` to equal [[ base ]]; send `Authorization: Bearer <access_token>` only there. Refresh via `POST /oauth/token` before login; retain credentials on network/429/5xx failures. A 403 is not a login failure; [details]([[ references ]]http-auth.md#storage-and-refresh).

HTTP authentication requires an email account. Only missing, revoked or unrefreshable credentials need sign-in. [[ authenticationInstruction ]] Send JSON with `Content-Type: application/json` and `Origin: [[ base ]]`:

1. `POST /api/auth/email-otp/send-verification-otp` with `{"email":"<recipient email>","type":"sign-in"}`. Ask for the emailed OTP; wait for the reply.
2. `POST /api/auth/sign-in/email-otp` with `{"email":"<recipient email>","otp":"<user code>"}`. Retain cookies privately.
3. `POST /api/authentication/token` with those cookies. `201` returns `access_token`, `refresh_token`, `client_id` and `expires_in`.

Sign-in: `account_created_this_login`. Token: `has_created_document` (first-artifact design).

Save origin, tokens, client ID and expiry privately in that store across sessions (without files, a persistent secret store). Atomically replace rotated tokens and expiry; never duplicate a rotating grant.
