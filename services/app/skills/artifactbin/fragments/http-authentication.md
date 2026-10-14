First check `[[ credentialPath ]]` (replace `~/.artifactbin` with `ARTIFACTBIN_HOME` when set), or your persistent secret store. Reuse saved credentials only when `ARTIFACTBIN_URL` equals [[ base ]]. Send `Authorization: Bearer <access_token>` to that origin. Refresh expired credentials with `POST /oauth/token` before login; [storage and refresh]([[ references ]]http-auth.md#storage-and-refresh).

For missing or revoked credentials, HTTP authentication requires an email account. [[ authenticationInstruction ]] Send JSON with `Content-Type: application/json` and `Origin: [[ base ]]`:

1. `POST /api/auth/email-otp/send-verification-otp` with `{"email":"<recipient email>","type":"sign-in"}`. Ask for the emailed OTP and wait for the reply.
2. `POST /api/auth/sign-in/email-otp` with `{"email":"<recipient email>","otp":"<user code>"}`. Retain cookies privately.
3. `POST /api/authentication/token` with those cookies. `201` returns `access_token`, `refresh_token`, `client_id` and `expires_in`.

`sign-in/email-otp` returns `account_created_this_login`. Token responses include current `has_created_document`, based on documents this user created, including group-owned documents and trash. Use the latter for first-artifact design guidance.

Save the origin, access token, refresh token, client ID and calculated expiry privately in the existing store for reuse across sessions. Without files, use a persistent secret store. Atomically replace rotated tokens and expiry; never copy a rotating grant into another store.
