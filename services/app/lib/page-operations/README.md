# Page backend execution

A backend exports `typeDefs` (GraphQL SDL) and a default object of field resolvers.
Each resolver receives `(args, principal, caps)`. The trusted server derives
`principal.tenant` from the page ID and `principal.subject` from its authenticated
account; page variables cannot grant identity or authority. Original commenters
have resolver role `VIEWER`.

`caps.store.get()` returns `{value, version}`. `caps.store.set(value, {expected})`
returns the new version or throws an error with `code: 'conflict'`. The store is
scoped to the admitted immutable backend file, with a 60 KiB JSON limit. Successful
writes invalidate the owning page through its transactional notification channel.

`caps.fetch(url)` performs a public HTTPS GET. It accepts no request options,
headers, body, cookies, or ambient credentials. DNS addresses are checked at socket
connection; every redirect repeats the guard. Private, reserved and metadata
addresses remain forbidden under development settings. There are at most three
redirects, a three-second deadline and a 256 KiB response cap. Only HTTP 200 is
currently accepted. The response provides `ok`, `status`, `url`, a `headers` object
containing `content-type`, and asynchronous `text()` and `json()` methods.

Author code runs in the existing bounded isolated runner, never in the app process.
Imports use the runner compiler's fixed bundled allowlist:

- `@earendil-works/pi-agent-core`
- `@earendil-works/pi-ai/utils/event-stream`
- `abort-controller/dist/abort-controller.mjs`
- `fast-text-encoding`
- `core-js/web/url`
- `core-js/web/structured-clone`

These dependencies are pinned by the repository lockfile. Arbitrary npm imports,
Node built-ins and host environment variables are unavailable. Keep backend
examples import-free and never put credentials in HTML or browser configuration.

An execution failure after admission has an unknown mutation outcome. The host
never automatically retries it. Archived page revisions permit queries only.

A backend may export `secretBindings = ['API_TOKEN']`. These names are immutable
version metadata; values are held separately, encrypted and scoped to the backend
file and its owner. A resolver reads a declared value with
`await caps.secrets.get('API_TOKEN')`. Missing or revoked values fail closed.
The host verifies the admitted owner, exact source version and declaration on
every call, including direct capability calls.

Owners configure values using the existing authenticated session or bearer API:
`/api/my/backends/{backendId}/{version}/secrets` accepts `PUT {name,value}`,
`DELETE {name}`, and `GET`. Responses contain configured names only. Page editors
cannot configure another owner's credentials. Configuration never changes HTML,
backend source, version metadata or download content. Rotation and revocation
apply to already published versions immediately. Platform receipts and emitted
events redact literal values read during that run; attempts to write those literal
values into shared backend state are rejected. This is not a general information
flow restriction on owner-authored backend network requests.
