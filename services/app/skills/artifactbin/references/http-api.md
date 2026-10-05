---
title: Direct HTTP API
description: Email-authenticated HTTP integration, artifact operations and conditional writes without installing Node or afbin.
---
## Authentication

Direct HTTP integrations use email authentication. Browser approval with guest access belongs to the CLI. A direct HTTP client does not need Node or npm.

Use your selected server, `[[ base ]]`, for all requests. JSON calls send `Content-Type: application/json`; the session steps also send `Origin: [[ base ]]`.

1. `POST /api/auth/email-otp/send-verification-otp` with `{"email":"you@example.com","type":"sign-in"}`. Ask the user for the emailed OTP.
2. `POST /api/auth/sign-in/email-otp` with `{"email":"you@example.com","otp":"<user's code>"}`. Retain the returned session cookies in a private cookie jar.
3. `POST /api/authentication/token` with those cookies and the selected server's Origin. Only verified email account sessions qualify. The response contains `access_token`, `token_type: "Bearer"`, `expires_in` (seconds), and `scope: "artifacts"`.
4. Use `Authorization: Bearer <access_token>` on this server's `/api` requests. Do not put bearer secrets in URLs, documents or logs. On expiry, repeat email authentication; this flow does not issue refresh tokens. `POST /api/auth/sign-out` closes the temporary session without revoking the separately issued bearer.

The CLI has a separate authentication entry: `afbin auth` opens browser approval and may continue as a guest. A valid CLI capability can use HTTP internally; User-Agent or caller-provided headers do not determine whether a credential is allowed.

## Operations

- `GET /api/artifacts`: list accessible artifacts; follow returned opaque pagination cursors.
- `GET /api/artifacts/<id>`: read source, metadata and current version/state.
- `POST /api/artifacts`: create from a supported content field; for example `{"csv":"name,value\nExample,2","title":"Example"}`.
- `PUT /api/artifacts/<id>`: update datasets/media conditionally. Include observed `expectedVersion` and `expectedState` with the new content. A 409 requires reconciliation.
- Markup changes require a prepared `document_update` graph with observed reads/claims and stable node identity. Raw replacement markup does not replace that contract. Read [direct JSX authoring](http-authoring.md) and [the graph wire contract](http-document-graph.md) to prepare it without invoking the CLI.
- `GET/POST /api/artifacts/<id>/annotations`: read/create comments; document permissions still apply. Creation requires a body and node or quote anchor.
- `DELETE /api/artifacts/<id>`: move to trash.

Inspect non-success JSON and follow its recovery instructions. After an uncertain mutation, reconcile its receipt/current head before attempting another write.

Local preview, comments, import and export use your files without these remote endpoints. Downloaded `.jsx.html` edits stay local. Publishing is an explicit remote operation. Before disconnecting, prepare the npm package cache and required browser assets; the HTTP API itself requires access to the selected server.


For direct JSX creation, reservation and executable editing examples, read [HTTP authoring](http-authoring.md). The exact wire fields and concurrency obligations are in [document graphs](http-document-graph.md). All three HTTP guides are served together in `/llms.txt`.
