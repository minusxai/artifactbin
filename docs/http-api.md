# HTTP API and npm CLI

The HTTP API is the service boundary used by the CLI. Direct integrations can use the same artifact operations without installing Node or afbin. Authorization, conditional writes, validation and idempotency stay on the server. Local preview uses local service implementations; it does not publish until a remote command is requested.

## Direct integration authentication: email OTP

Direct integrations use email verification, not a guest or browser-approval flow:

1. `POST /api/auth/email-otp/send-verification-otp` with JSON `{"email":"you@example.com","type":"sign-in"}`. The user supplies the code delivered to their email.
2. `POST /api/auth/sign-in/email-otp` with JSON `{"email":"you@example.com","otp":"123456"}`. Keep its session cookies in memory or a private cookie jar.
3. `POST /api/authentication/token` with those cookies and `Origin: https://your-artifactbin-server`. The JSON response has `id`, `access_token`, `token_type: "Bearer"`, `expires_in` (seconds), and `scope: "artifacts"`. Only a session with a verified email and account is accepted; anonymous sessions, CLI bearer tokens, and guest browser sessions cannot use this door. Requests from a different origin are refused. The bearer is restricted to this server's `/api` resource.
4. Use `Authorization: Bearer <access_token>` on artifact requests. Email and OTP are not sent with each request. Sign out the temporary session using `POST /api/auth/sign-out`; the separately issued bearer remains valid until expiry or revocation. On expiry, repeat email authentication. This direct flow does not issue a refresh token.

All JSON calls send `Content-Type: application/json`. For the session-authenticated steps, send the selected server's `Origin`; do not put secrets in URLs, source files or logs. OTP sending retains the existing email rate limits and verification protections. Token responses use `Cache-Control: no-store`. A session response's cookies are credentials; keep the cookie jar private.

CLI authentication deliberately has a different entry experience: `npx --yes @artifactbin/cli@latest auth` opens browser approval and can continue as a guest; `auth --email <email>` uses email OTP and a refreshable CLI device grant. Existing CLI capabilities remain usable through HTTP. A server cannot identify CLI versus curl from a User-Agent or caller-supplied header; this distinction is enforced at the token issuance door, not by pretending that valid guest CLI bearer requests are not HTTP requests.

## Artifact operations

The authoritative schemas and operation descriptions are in `services/app/lib/operations/registry.ts`; HTTP routes translate requests to those operations. Core routes include:

| Request | Meaning |
| --- | --- |
| `GET /api/artifacts` | List artifacts accessible to this actor; response pagination uses opaque cursors. |
| `POST /api/artifacts` | Create from one supported content field, such as `markup`, `csv`, an image or a generic file. |
| `GET /api/artifacts/:id` | Read source, metadata and current version/state. Access remains checked. |
| `PUT /api/artifacts/:id` | Replace content conditionally. |
| `PATCH /api/artifacts/:id` | Conditional metadata change; markup documents use a prepared document update instead. |
| `DELETE /api/artifacts/:id` | Move to trash. |
| `GET/POST /api/artifacts/:id/annotations` | Read/create comments, subject to document access and write permissions. |

A minimal CSV create body is `{"csv":"name,value\nExample,2","title":"Example"}`. To replace that dataset, first read its current head and send `{"csv":"name,value\nExample,3","expectedVersion":1,"expectedState":"<observed 64-character state>"}` to PUT. Use the actual observed values; a changed head/state produces a conflict instead of silently overwriting somebody else's work.

Markup updates require the prepared `document_update` graph contract in `services/contracts/src/document-update.ts`, including observed reads/claims, stable node identity and annotation operations where applicable. Sending raw replacement markup alone is not a substitute for preparing a document update. Direct HTTP clients can prepare and submit this JSON contract without invoking the CLI. The selected server's `/llms.txt` serves a complete graph-field guide and an executable JSON-only text-edit example, also maintained in [the HTTP authoring reference](../services/app/skills/artifactbin/references/http-authoring.md). The API remains independent of CLI transport; do not create a second server-side editing engine.

## Compatibility, errors and updates

The CLI sends `X-Artifactbin-Protocol` with its request. An incompatible mutation is refused with HTTP 426, `error: "cli_update_required"`, `required_protocol`, `required_version`, and an exact-version npm instruction **before token resolution and mutation execution**. No additional compatibility preflight is required. Clients must inspect non-success JSON before comparing protocol headers so that the server's actual refusal/hint is preserved. Compatible requests continue normally.

Other errors retain their HTTP status and structured `error`, `message`/`details`, `hint`/`recovery` fields when provided. A 409 is a conflict to reconcile, not an instruction to retry the same stale write. A transport failure after a mutation can leave its outcome unknown; retain recovery state and inspect the publication receipt/current head rather than blindly sending the write again.

The normal selected-server API response includes `X-Artifactbin-CLI-Version` and `X-Artifactbin-Protocol`, derived from the build's served release pointer. The CLI can print a version-validated instruction on stderr at most hourly per server using those headers. There are no extra update-check HTTP requests, even for pinned npx invocations. Notices do not download packages, install skills, replace binaries or fail the user's command. Local-only commands have no remote API response and therefore no update notice. Disabled checks, `CLI__VERSION_PIN`, and `npm_config_offline=true` suppress notices. Viewer/export responses and redirected asset hosts cannot supply notice metadata. `npx --yes @artifactbin/cli@<version> <command>` selects that package on the next launch; npm's package acquisition can require network unless its cache is prepared. afbin does not implement an hourly self-updater.

Future plugin/MCP adapters can share these service contracts and OAuth infrastructure. They are outside this implementation and must define their own consent/capability requirements; they do not automatically become email OTP clients.
