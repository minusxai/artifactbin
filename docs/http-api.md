# HTTP API

The HTTP API is the service boundary for artifact operations. Direct integrations need no Node installation. Authorization, conditional writes, validation and idempotency stay on the server.

## Direct integration authentication: email OTP

Direct integrations use email verification, not a browser-approval flow:

1. `POST /api/auth/email-otp/send-verification-otp` with JSON `{"email":"you@example.com","type":"sign-in"}`. The user supplies the code delivered to their email.
2. `POST /api/auth/sign-in/email-otp` with JSON `{"email":"you@example.com","otp":"123456"}`. Keep its session cookies in memory or a private cookie jar.
3. `POST /api/authentication/token` with those cookies and `Origin: https://your-artifactbin-server`. The 201 JSON response includes `access_token`, `refresh_token`, `client_id` and `expires_in` (seconds). Only a session with a verified email and account is accepted; anonymous sessions, existing bearer tokens, and guest browser sessions cannot use this door. Requests from a different origin are refused. The bearer is restricted to this server's `/api` resource.
4. Use `Authorization: Bearer <access_token>` on artifact requests. Email and OTP are not sent with each request. Sign out the temporary session using `POST /api/auth/sign-out`; the separately issued bearer remains valid until expiry or revocation. Before expiry, or after an API 401, rotate the grant through `POST /oauth/token` with `{"grant_type":"refresh_token","client_id":"<saved client_id>","refresh_token":"<saved refresh_token>","resource":"https://your-artifactbin-server/api"}`. Refresh is single-use: serialize rotation across clients and atomically replace both tokens and expiry in private origin-scoped storage. Keep the grant on transport/429/5xx failures; invalid or revoked grants require sign-in again.

All JSON calls send `Content-Type: application/json`. For the session-authenticated steps, send the selected server's `Origin`; do not put secrets in URLs, source files or logs. OTP sending retains the existing email rate limits and verification protections. Token responses use `Cache-Control: no-store`. A session response's cookies are credentials; keep the cookie jar private.

## Artifact operations

The authoritative schemas and operation descriptions are in `services/app/lib/operations/registry.ts`; HTTP routes translate requests to those operations. Core routes include:

| Request | Meaning |
| --- | --- |
| `GET /api/artifacts` | List artifacts accessible to this actor; response pagination uses opaque cursors. |
| `POST /api/artifacts` | Create from one supported content field, such as `html`, `dataset`, `viz`, an image, PDF or generic file. |
| `GET /api/artifacts/:id` | Read source, metadata and current version/state. Access remains checked. |
| `PUT /api/artifacts/:id` | Replace content conditionally. |
| `PATCH /api/artifacts/:id` | Conditional metadata change; HTML content uses PUT with a complete `html` source. |
| `DELETE /api/artifacts/:id` | Move to trash. |
| `GET/POST /api/artifacts/:id/annotations` | Read/create comments, subject to document access and write permissions. |

A minimal CSV create body is `{"dataset":"name,value\nExample,2","title":"Example"}`. To replace that dataset, first read its current head and send `{"dataset":"name,value\nExample,3","expectedVersion":1,"expectedState":"<observed 64-character state>"}` to PUT. Use the actual observed values; a changed head/state produces a conflict instead of silently overwriting somebody else's work.

Native HTML saves use the same conditional replacement door. Read the canonical `html`, `version` and `state`, preserve surviving `data-af-id` attributes, then PUT `{"html":"<complete edited HTML>","expectedVersion":1,"expectedState":"<observed state>"}`. The accepted response supplies the next head. `markup`, `jsx`, `markdown` and `document_update` inputs return `native_html_required`; there is no prepared graph edit step.

History uses `GET /api/artifacts/ID/versions`, `GET /api/artifacts/ID/versions/VERSION` and `POST /api/artifacts/ID/revert` with `version`, `expectedVersion` and `expectedState`. Revert archives the current head and creates a new one. Metadata PATCH requires `expectedState` and does not archive content or change its version.

Comments are read separately with `GET /api/artifacts/ID/annotations?status=all` (follow `next_cursor`). Create with `POST /api/artifacts/ID/annotations`, an idempotency key and an anchor such as `{"kind":"html-node","v":1,"revision":"7","nodeId":"results-heading","quote":"March results"}`. Use the saved revision and exact current quote. Dynamic nodes also supply `ancestorId`. Replies and resolution go to `POST /api/artifacts/ID/annotations/THREAD_ID`; resolution/reopening require the observed `expected_revision`. Comments never rewrite source. The served `/llms/html-operations` guide documents watching, reactions and uncertain-write recovery.

Page GraphQL is separate from artifact source: `GET /api/artifacts/ID/graphql?revision=VERSION` returns `{sdl,revision}`; POST to the same path with `{"revision":"VERSION","query":"query {garden{count}}","variables":{}}`. Use the namespace and types from that version's SDL. Page access does not grant dataset write authority; GraphQL errors must be checked even on HTTP 200.

Create a folder with `{"format":"folder","title":"Reports"}`; place artifacts using its ID as `parent_id`. Folders carry no content. Media inputs include `image`/`imageUrl`, `pdf`/`pdfUrl` and `file`; datasets use `dataset` (rows or CSV), `csvUrl` or `sheetUrl`. See [file uploads](file-uploads.md). Command-program artifact publication returns `unsupported_format`; native resolvers use `resolverSources`, not a command artifact.

Resolvers are TypeScript files a page declares with `<link rel="af-resolver" data-af-name="NAME" href="./NAME.ts">` and sends, keyed by `NAME`, in `resolverSources` on the same create or PUT as its `html`. `rel="af-backend"` and `backendSources` are permanent aliases; one name under both rels, or both fields in one request (`conflicting_resolver_sources`), is refused. A resolver exports `typeDefs`, a `default` object of resolvers, an optional `secrets` map of names to the one host each may be sent to (`{"SHEETS_KEY":"sheets.googleapis.com"}`, exact or one leading `*.` label; at most 32 names; never values) and an optional owner-only Query field `test: String! @auth(role: OWNER)` with no required arguments. Publishing validates these and records the version's file contract: `api` 2, or 1 when its source still uses `caps.store`, `caps.secrets.get` or legacy `secretBindings` (accepted for published code; a file declares `secrets` or `secretBindings`, not both). The owner's `GET /api/my/backends/ID/VERSION/secrets` returns `names` (those set), `secrets` (declared names and hosts), `test` and `api`; it never returns values.

Viz recipe artifacts remain an accepted data input: `viz` contains `description`, `engine` (`vega` or `vega-lite`), nonempty `bindings` (`name`, `label`, `accepts`), and an object `template`, with optional `params`. Template tokens must name declared bindings or params. Reads return the inert `recipe` and `slots`; this is not executable code. Native HTML charts import the hosted Vega libraries and author their specs directly; publishing a recipe does not automatically bind it into a native page.

## Compatibility, errors and updates

The CLI sends `X-Artifactbin-Protocol` with its request. An incompatible mutation is refused with HTTP 426, `error: "cli_update_required"`, `required_protocol`, `required_version`, and an exact-version npm instruction **before token resolution and mutation execution**. No additional compatibility preflight is required. Clients must inspect non-success JSON before comparing protocol headers so that the server's actual refusal/hint is preserved. Compatible requests continue normally.

Other errors retain their HTTP status and structured `error`, `message`/`details`, `hint`/`recovery` fields when provided. A 409 is a conflict to reconcile, not an instruction to retry the same stale write. A transport failure after a mutation can leave its outcome unknown; retain recovery state and inspect the publication receipt/current head rather than blindly sending the write again.

The normal selected-server API response includes `X-Artifactbin-CLI-Version` and `X-Artifactbin-Protocol` headers, derived from the build's served release pointer.

Future plugin/MCP adapters can share these service contracts and OAuth infrastructure. They are outside this implementation and must define their own consent/capability requirements; they do not automatically become email OTP clients.

## Groups and group sharing

Group operations use the existing `artifacts` bearer authority and also accept same-site account sessions. An explicit Authorization header never falls back to cookies. Groups retain editor/viewer membership; a group editor governs group-owned artifacts, while `created_by` is attribution only. Read group detail by stable ID, handle or `@handle`; every mutation uses a stable ID.

| Request | Body and response |
| --- | --- |
| `GET /api/groups` | `{groups:[...]}` with your live memberships. |
| `POST /api/groups` | `{handle,name,description?}`; 201 group summary. |
| `GET /api/groups/ID` | `{group,members,linked_groups,invitations?}`; only editors see invitation addresses. |
| `PATCH /api/groups/ID` | Nonempty `{name?,description?}`; handles cannot change. |
| `DELETE /api/groups/ID` | `{handle}` echoes the exact stored handle after user confirmation. |
| `GET /api/groups/ID/members?query=TEXT` | `{members:[{user_id,username,name,role}]}`; group-local exact ID or fuzzy handle/name search. |
| `PUT /api/groups/ID/members/USER_ID` | `{role:"editor"|"viewer"}` changes an existing member only; nonmember 404. |
| `DELETE /api/groups/ID/members/USER_ID` | Editor removes a member; self-removal also permits viewers. |
| `DELETE /api/groups/ID/members/me` | Leave; last editor receives 409 `last_editor`. |
| `GET /api/groups/ID/invitations` | Editor-only `{invitations:[{id,email,role,invited_by,created_at}]}`. |
| `POST /api/groups/ID/invitations` | One `{email,role}`; 201 invitation includes `changed`. Same pending role is unchanged, with no duplicate mail. |
| `DELETE /api/groups/ID/invitations/INVITATION_ID` | Withdraw a pending invitation. |
| `PUT/DELETE /api/groups/ID/links/OTHER_ID` | Directional navigation only; no inherited access. |
| `PUT /api/artifacts/PAGE_ID/group-shares/GROUP_ID` | `{role:"viewer"|"commenter"|"editor"}`; `{changed}`. Requires governance and target membership. |
| `DELETE /api/artifacts/PAGE_ID/group-shares/GROUP_ID` | Idempotent `{changed}`; missing share is unchanged. |
| `POST /api/artifacts/PAGE_ID/transfer` | Explicit ownership move with `{destination:{type:"group",id}}` or `{destination:{type:"personal"}}`. |

Invitation acceptance is automatic only after verified-email account authentication, including the next normal authenticated request. It preserves existing editor membership and company admission behavior. A navigation link never joins a group. Group shares cap at editor, preserve the personal or group owner, and grant no dataset mutation authority beyond the existing dataset policy. Removing membership, unsharing, or deleting the group revokes access on subsequent checks, including streams and prepared access facts for new requests.

`GET /api/artifacts?group_id=ID` lists live group-owned or explicitly group-shared work, intersected with the caller's membership and normal filters. It preserves each artifact's actual owner, deduplicates rows, and binds the opaque cursor to the group and other filters. Sharing with a group never transfers ownership or changes a personal page's host.

Deletion requires no live owned artifacts of any format. Trashed history stays historical and cannot restore into a deleted group. Deletion clears shares, invitations, links in both directions and memberships, resets affected saved defaults to inherit, and retains the handle reservation as a tombstone. Errors include 409 `group_not_empty`, `handle_mismatch`, `default_group_locked`; 404 hides unknown or inaccessible group detail. A deployment default cannot be deleted.

Durable account quotas are shared across tokens and app replicas: 10 create attempts/day, 100 invitation attempts/hour, 500 pending invitations/group, and 60 successful group-share changes/minute. Unchanged invitations still charge the invitation attempt quota; unchanged shares do not charge the change quota. HTTP 429 includes `retry_after` seconds and `Retry-After`. Audit actor account, actual token and stored harness attribution commit with mutations; group recipients and email outbox entries commit atomically, while provider delivery runs after commit. Delivery honors preferences, blocks and test-account isolation, and retries with stable provider idempotency keys.
