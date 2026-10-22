# HTTP API

Everything an agent needs to publish and work on a page over HTTP. Send JSON, and pass your account token as `Authorization: Bearer <token>`. Errors come back as `{ "error": "message" }` with a 4xx or 5xx status.

The server is `https://app.artefactbin.dev`. If `AF_SERVER` and `AF_TOKEN` are set in your environment (a test harness may set them), use `AF_SERVER` as the server and `AF_TOKEN` as the token, and skip signing in.

## Signing in

| Method and path | Body | Returns |
|---|---|---|
| `POST /api/auth/email/request` | `{ email }` | Sends a one-time code to that address |
| `POST /api/auth/email/verify` | `{ email, code }` | `{ token, username }` |
| `GET /api/auth/session` | none; send the token | `{ username, handle }` while the token works (`handle` is `null` until you choose one; see Handle), 401 once it doesn't |

`node scripts/auth.mjs` does all of this and saves the token for the other scripts. Keep the token out of the page. Store it with your other credentials.

## Publishing and saving

| Method and path | Body | Returns |
|---|---|---|
| `POST /api/publish` | `{ source, files?, requestId, path?, visibility?, linkRole? }` | `{ id, version, url, path, source }` |
| `POST /api/ids` | `{ count }`, with header `Idempotency-Key` | `{ ids }`: IDs reserved for you, for files you haven't published yet. `scripts/add.mjs` calls this. |
| `GET /api/files/:id/source` | | `{ source, version }`, plus an `ETag` header |
| `PUT /api/files/:id/source` | `{ source }`, with header `If-Match: <version>` and optionally `Idempotency-Key` | `{ version, source }` |
| `DELETE /api/files/:id` | | `{ id, deleted: true }`. Only the page's owner can delete it. |

- **`files`:** any linked backend files that aren't published yet, by ID: `{ "Bk7Qa2": "<file contents>" }`. The same field works on `PUT /source`.
- **`requestId`:** any unique string you choose. If a publish times out, send the same request again with the same `requestId`; it won't create a second page. The same `requestId` with a different body is rejected with `409`.
- **`id` in the meta block:** leave it out for a new page. An ID there must be one you reserved with `POST /api/ids` and haven't published yet; any other ID (someone else's, already published, unknown) is rejected with `422` naming it, so a copied page is never published under a new ID by accident.
- **Without a token:** `POST /api/ids`, `POST /api/publish`, `DELETE /api/files/:id` and `/api/paths` answer `401`; the page routes under `/api/files/:id/` (source, comments, sharing, backends, graphql) answer `403`, even on an unlisted page. Only the page's address (the hosted view) works for anyone with the link.
- **`source` in the response:** the page exactly as the platform saved it, with the header metadata block (`id`, `version`) and every `data-af-id` filled in. Replace your local file with it.
- **`url` in the response:** the page's address, `https://app.artefactbin.dev/a/<id>` (see Addresses).
- **`If-Match`:** a save is rejected with `409` if someone else saved first. The `409` body is `{ error, version, source }`: the current version and its source. Merge your change into that source and save again with the new version.
- **Deleting:** `DELETE /api/files/:id` moves the page to indefinitely recoverable trash. Versions, comments, IDs and storage usage are retained. Hosted, download, source, comment and backend routes stop working while trashed. `GET /api/trash` lists managed deleted items; `POST /api/trash/:id/restore` restores the same ID and version. If the original parent folder is absent, restoration uses the root. A path collision returns `409` without overwriting anything. `POST /api/trash/folders` with `{ path }` atomically trashes a folder subtree; restoring its returned ID restores that subtree. These endpoints accept `?owner=` for an active group editor's namespace. No permanent purge is exposed.
- **Downloading:** `GET /a/:id?download=1` returns the page as one HTML file that works on its own, with the core inlined and the page's starting state (its `data-af="state"` block). Local state belongs to each viewer, so the server doesn't have it; a viewer who downloads from the page gets their own state in the file. The file records the server it came from and its version on the core tag, next to the `id` and `version` in its metadata block, so a browser that can reach the server shows the platform bar in it and the viewer can connect to the page (see SKILL.md). It carries no credential.
- **`data-af="state"`:** a block in a published or saved page becomes the page's starting state, where each viewer's own local state begins. It is taken out of the saved source. A save without one keeps the current starting state.
- **`visibility`:** `private`, `unlisted` or `public`. **`linkRole`:** `viewer`, `commenter` or `editor`, for people who open the link.
- Pages are unlisted by default: anyone with the link can view. Pass visibility to change that.

## Addresses

| Method and path | Returns |
|---|---|
| `GET /a/<id>` | The page, hosted. `https://app.artefactbin.dev/a/<id>-<title>` is the same page: anything after the ID and a hyphen is ignored. |
| `GET /@<handle>/<path>` | The page at that path in the library of the account with that handle, exactly as `/a/<id>`. Only accounts that chose a handle have these addresses (see Handle); the path is as `GET /api/paths` lists it, percent-encoded. 404 once the page is renamed or moved, or the handle changes. |
| `GET /af/v1/ids/<id>` | Any file by ID: a page as `/a/<id>`; a backend file as `{ id, kind, version }` to its owner only. |

Each form takes `?download=1`. A private page sends a signed-out visitor to sign in; anything unknown, including a page the viewer may not read, is `404`.

## Imported media

Imported image, file and PDF pages can contain immutable media links. These links read bytes; they do not accept uploads or edits.

| Method and path | Returns |
|---|---|
| `GET /af/v1/ids/<id>/assets/<revision>/<variant>/<sha256>` | Exact stored bytes, with the asset page's current read permission. `variant` is `original` or `small`; the importer supplies the revision and full SHA-256. |
| `HEAD /af/v1/ids/<id>/assets/<revision>/<variant>/<sha256>` | The same authorization and headers, without a body. |

- The asset's own sharing policy applies, even when another page embeds it. Public and unlisted assets allow guest reads; private assets require an authorized account session or a document grant for that asset. A containing page's grant does not authorize another asset. Missing or denied assets return `404`.
- `Range: bytes=start-end`, open-ended and suffix ranges return `206`; invalid, multiple or unsatisfiable ranges return `416`. Authorized bytes unavailable on the server return `503`.
- PNG, JPEG, WebP and GIF images display inline. SVG, PDF and other files download as sandboxed attachments. Responses are private and uncached, with no CORS access or credentials in URLs. Hosted sibling runners can use the platform browser session. A downloaded HTML file needs the hosted media link and sign-in for private assets; connecting to its parent page does not grant access to another asset.

## Comments

| Method and path | Body | Returns |
|---|---|---|
| `GET /api/files/:id/comments` | | `{ comments, head, cursor }` |
| `POST /api/files/:id/comments` | `{ comment }`, optionally with header `Idempotency-Key` | The saved comment |
| `PUT /api/files/:id/comments/:commentId` | The change, for example `{ resolved: true }`, with header `If-Match: <revision>` | The updated comment |
| `GET /api/files/:id/context/:commentId` | | `{ comment, source, state, url }`: the page source and the commenter's own local state when they commented |

Imported comments may include read-only `attachments`: `{ id, name, variants }`, where each variant has `variant` (`original`, `preview`, or `thumbnail`), `mimeType`, `width`, `height`, `bytes`, and `sha256`. These describe verified raster bytes; creating or editing a comment cannot add attachments. Preserve the comment's body, quote and anchor independently of its images. Prefer `preview` for the expanded view: it retains annotations baked into that image; `original` is the unannotated capture.

`GET` or `HEAD /api/files/:id/comments/:commentId/attachments/:attachmentId/:variant` reads one attachment under the page's current read permission, including fresh group membership. A readable public or unlisted page permits its guest image reads; a private page requires its own valid account or page grant. A grant for another page does not apply. Missing or denied images return `404`; temporarily unavailable stored bytes return `503`. Responses are private and not cached, have no credentialed CORS access, and support one byte range on `GET`. Never put a credential in an image URL. The hosted comment panel and connected downloaded file fetch images through the trusted connection and use temporary Blob URLs; a disconnected file keeps its text but cannot retrieve private images.

Bound person-card images use `/af/v1/ids/:id/person-images/:valueName/:opaqueAssetId`. Each read rechecks the current registered person selection as well as page permission. This is not a profile directory or a generic digest-download route. Migrated person cards use the trusted image bridge, which accepts only these exact page-bound paths, WebP responses, and at most 4 MiB per image. It fails closed while disconnected or after the caller changes.

Imported comments whose original page version was not retained have `version: null`, `nodeId: null`, and `context: { status: "unavailable", originalRevision: "17", reason: "not-retained" }`. Their body, quote, author and thread remain intact. Their context response includes the same `context` metadata and `source: null`, `state: null`, `url: null`; there is no original view to replay or node to highlight. Never treat the current page as their original context.

Use `context` before acting on a comment. It shows exactly what the commenter saw: `state` is their local state (their filters, open tab and drafts), and `url` is the page's address with `#af-state=` of that state, so opening it shows the page as they saw it.

- **`comment`:** `{ nodeId, quote, body }`, where `nodeId` is the `data-af-id` the comment is on, or `null` for the whole page. To reply, add `parentId`: the ID of the comment you are answering.
- A `nodeId` is the exact `data-af-id`, kept unchanged: nonempty, well-formed Unicode without control characters, at most 16 KiB of UTF-8. Comments, cursor presence and text selections share this bound. Never shorten or re-encode an existing ID.
- **Editing and resolving:** send the comment's `revision` as `If-Match`. Every edit adds one to it. If the comment changed since you read it, you get `409`; fetch the comments again and retry.
- **Watching for new comments:** every list returns a `cursor`. Call `GET /api/files/:id/comments?since=<cursor>` to get only comments created or edited after it, with a new `cursor`. Each change comes back once, so a watcher that keeps its last cursor can stop and resume without duplicates. Replies are listed flat; group them by `parentId`. The cursor is opaque: don't build or change it.

## Retrying safely

Saves (`PUT /source`) and new comments and replies (`POST /comments`) accept an `Idempotency-Key` header: any string you choose, 1 to 200 printable characters (longer or empty is `400`), new for each change you mean to make.

- If the request timed out or you don't know whether it worked, send it again with the same key and the same body. If the first one worked, you get its original response, even if the page changed since. Nothing is saved twice. If it didn't work, the request runs now.
- The same key with a different body is rejected with `422`.
- A key is kept for 24 hours for that page and your account. Requests that fail are not recorded, so you can retry them with the same key.
- Without the header, requests behave as before.

### Imported group ownership

Imported group pages retain a distinct non-login group owner. An active group editor can read, edit, manage sharing and delete its pages; an active group viewer can read them. Membership is checked again for each operation, including document grants. Named invitations and link access still apply; an invited editor gains no ownership management authority. Group pages appear in members’ shared library. Group creation, membership administration, group backend publication/execution are not exposed by this API. Group membership grants no access to any user’s account secrets.

## Sharing

| Method and path | Body | Returns |
|---|---|---|
| `GET /api/files/:id/sharing` | | `{ policy, permissions, url, owner }` |
| `PUT /api/files/:id/sharing` | One of `{ visibility }`, `{ linkRole }` or `{ email, role }` (`role: null` removes a person), with header `If-Match: <policy version>` | The updated sharing |

- **`If-Match`:** the `policy.version` from `GET`. A missing or stale version is `412` (this route differs from saves and comments, which answer `428` and `409`); read the sharing again and retry.
- **`linkRole`** applies to anyone who opens the link, signed in or not: with `linkRole: "editor"`, an anonymous viewer passes a backend's `@auth(role: EDITOR)`. People named with `{ email, role }` get their role when signed in.

## Paths

Paths are yours to organise; a page's ID and address never change when it moves.

Both methods accept an optional `?owner=<group-principal-id>` to select an imported group's namespace. Active group viewers may list it; active group editors may change it. Membership is checked inside the operation's transaction. Omit `owner` for your personal namespace. Selecting another user's namespace or a group you cannot access returns `403`; moves always stay within the selected owner and preserve page ownership.

| Method and path | Body | Returns |
|---|---|---|
| `GET /api/paths` | | `{ entries }`: your pages and folders, each `{ path, fileId, url? }` (`fileId` and `url` are null or absent for a folder) |
| `POST /api/paths` | One operation, below | The updated `{ entries }` |

The body is one of:

- `{ "kind": "move", "from": "<path>", "path": "<path>" }`: rename or move a page or a folder (with everything in it).
- `{ "kind": "folder", "path": "<path>" }`: create an empty folder.
- `{ "kind": "move-many", "paths": ["<path>", …], "destination": "<folder path or />" }`: move several pages or folders into a folder (`/` is the top).
- `{ "kind": "remove-folder", "path": "<path>" }`: remove an empty folder.

Paths are `folder/name` without a leading slash. An unknown path is `404`, a path already in use (or a folder moved into itself) is `409`, and a malformed path or unknown `kind` is `422`.

## Backend

Backend files are published with the page (`files` above). To see what's deployed:

| Method and path | Body | Returns |
|---|---|---|
| `GET /api/files/:id/backends` | | Each linked backend's name, file, version and `typeDefs` |

Pages call backend fields through `client`, not over HTTP.

## Secrets

The account's secrets, which backend lambdas it owns read as `env` (see `references/backend.md`). `scripts/secrets.mjs` calls these.

| Method and path | Body | Returns |
|---|---|---|
| `GET /api/secrets` | | `{ secrets: [{ name, updatedAt }] }`, sorted by name. Never a value. |
| `PUT /api/secrets/:name` | `{ value }` | `{ name, updatedAt }`. Creates the secret or replaces its value. |
| `DELETE /api/secrets/:name` | | `{ name, deleted: true }`; `404` when there is no such secret. |

- **`name`:** a capital letter, then up to 63 capitals, digits and underscores. **`value`:** 1 to 4096 bytes of text without NUL (U+0000). Either wrong, or a 65th secret, is `422`.
- Every route needs your account token; `401` without one. A server that keeps no secrets answers `503` with `Secrets are not configured`.
- Values are stored encrypted and never returned: keep your own copy if you need it again.

## Handle

An account's optional public name, used in `/@<handle>/<path>` page addresses (see Addresses). A new account has none; it can also be set on the Account page.

| Method and path | Body | Returns |
|---|---|---|
| `GET /api/account/handle` | | `{ handle }`, `null` when the account has none |
| `PUT /api/account/handle` | `{ handle }` | `{ handle }` as saved. `409` when another account has it, `422` when it breaks a rule below. |
| `DELETE /api/account/handle` | | `{ handle: null }`, also when there was none |

- **`handle`:** 3 to 32 lowercase letters, digits, underscores and hyphens, without a hyphen at either end or two in a row. Underscores may appear anywhere, including repeated or at either end; existing public handles retain their exact spelling. It is trimmed and lowercased before it is checked, so handles are unique regardless of case. Platform words and the server's own top-level paths (such as `api`, `af`, `a`, `connect`, `admin`) are refused with `422`.
- Changing or removing a handle frees the old one at once: its `/@<old>/…` addresses answer `404` (no redirect) and another account may take it. `/a/<id>` never changes.
- Every route needs your account token; `401` without one.
