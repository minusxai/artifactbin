Reuse credentials for [[ base ]]. Use the installed `scripts/credentials.mjs` or download [[ base ]]/skills/artifactbin/credentials.mjs as `credentials.mjs`:

```sh
node credentials.mjs request --origin '[[ base ]]' --path /api/artifacts
```

Only `auth_required` needs login. HTTP authentication requires an email account. [[ authenticationInstruction ]] Send JSON with `Content-Type: application/json` and `Origin: [[ base ]]`:

1. `POST /api/auth/email-otp/send-verification-otp` with `{"email":"<recipient email>","type":"sign-in"}`. Ask for the emailed OTP and wait for the reply.
2. `POST /api/auth/sign-in/email-otp` with `{"email":"<recipient email>","otp":"<user code>"}`. Retain cookies privately.
3. `POST /api/authentication/token` with those cookies. Save the response privately:

```sh
node credentials.mjs save --origin '[[ base ]]' < private-oauth-response.json
```

The helper saves credentials per origin in `ARTIFACTBIN_HOME` or `~/.artifactbin`. Across sessions without files, use a persistent secret store for origin, `access_token`, `refresh_token`, `client_id` and expiry from `expires_in`; serialize refresh and atomically replace credentials. Requests use `Authorization: Bearer <access_token>` only on its origin. Protect/delete temporary secrets. [Storage and refresh]([[ references ]]http-auth.md#storage-and-refresh).
