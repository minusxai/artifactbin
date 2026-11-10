# Page backend execution

A backend exports `typeDefs` (GraphQL SDL) and a default object of field resolvers.
Each resolver receives `(args, principal, caps)`. The trusted server derives
`principal.tenant` from the page ID, `principal.subject` from its authenticated
account and `principal.role` from the caller's page role (below); page variables
cannot grant identity or authority. A remote runner calls back with that caller in
its signed pin (`Actor.runner.caller`, from the admitted request), and the app
rebuilds the principal from the pin, never from resolver arguments.

## Page functions: `fetch('/fn/<name>')` (`functions.ts`)

A page calls a backend function by name with a plain `fetch`: `fetch('/fn/items', {method: 'POST', body:
JSON.stringify({limit: 50})})` answers a real `Response` whose JSON is the function's return value. Core
(`html-runtime/fn-fetch.ts`) intercepts only a `/fn/` path on the page's own origin, after URL resolution (so
`/fn/../graphql` is not one); every other fetch reaches the browser's fetch untouched (CSP and CORS as before). The
reader relays the call over the frame bridge (`html-runtime/fn-relay.ts` → `html-reader/frame-bridge/parent.ts`),
and the parent makes it with the reader's own session as `GET|POST /api/artifacts/:id/fn/:name`, the shell's
revision pinned in `x-page-revision`, no other frame header. The route (lib/page-doors `pageFunction`) admits the
caller exactly as the GraphQL door does and runs the function through the same invoker.

- Input: POST's JSON object body (empty: `{}`; any content type; at most 64 KiB, else 413), or GET's query parameters
  as strings (a repeated name is a list; `revision` is reserved, below). It is `args`; the principal is derived, never
  read from it.
- Revision: the bridge pins the reader's revision in `x-page-revision`; an unframed page (whose opaque origin cannot
  send a custom header without a preflight) sends its served revision as `?revision=`. Both present and different:
  400 `revision_conflict`. Neither: the head. The parent drops a frame's own `revision` parameter, and a read-only
  (archived) shell relays GET only (403 `read_only` for POST, no request made).
- Who: a typeDefs-free file exports `roles = {name: 'owner'|'editor'|'viewer'|'signed_in'|'anonymous'}`, checked at
  publish against the default export's functions (default anonymous, "at least", `resolverFieldRefusal`). The whole
  callable surface of a typeDefs-free file is read from its SOURCE at publish, never from the evaluated module
  (`function-source.ts`). Callable names are the keys of an object-literal `export default {…}` and the file's named
  exported functions; only those may be invoked (any other name is 404, whatever the module object exposes; a declared
  name whose run-time value is not a function is 404 too). A default export that is not an object literal (a Proxy,
  call or class) or is reassigned, spreads, computed or accessor keys, `export *`/`export … from`, `import()`, and any
  use of `module`, `exports`, `require` or `eval` fail publish with `invalid_functions`. `roles`: `export const roles =
  {…}` (or a top-level `const` exported as `roles`) must be an object literal whose keys are identifiers or string
  literals and whose values are string-literal role names; a computed or `__proto__` key, a spread, getter, method or
  shorthand, any other value, `let`/`var`, an unknown role or a key that is not a callable name fails publish with
  `invalid_roles`. A legacy
  file's Query and Mutation fields are callable too, each under its `@auth`; GraphQL still serves it. A
  typeDefs-free file mounts nothing on GraphQL. A name two linked files offer is 409.
- Kind: a legacy field's root; otherwise GET reads (`query`) and POST may write (`mutation`, so `caps.query`
  mutations work). Writes are refused on an archived revision and from an opaque origin; a GET never runs a Mutation.
- Answers: 200 with the JSON; 400 `invalid_json`/`input_not_object`, 403 `sign_in_required`/`forbidden`/
  `archived_page_readonly`/`read_only`, 404 `not_found` (cannot read the page, uniform) or `unknown_function`, 405,
  409, 413, 500 `backend_failed` with the function's own thrown message (the owner also gets `detail`), 503
  `retryable`, 504 `deadline`. A call rejects only as fetch does: `AbortError` on its signal (the parent aborts the
  request; it settles at once even while the reader loads or the bridge attaches), `TypeError` with no page connection (an offline copy, a frame that never attached within 3 s).
- An unframed page (owner host, export capture) calls the route directly as nobody (reads only): its CSP
  `connect-src` names the page's `/api/artifacts/:id/fn/` prefix, and the owner-host boundary (`server/user-host.ts`)
  admits that path for the owner's served page only, as a guest forced to `Origin: null`, with read CORS.

## Field authorization: `@auth`

The caller's page role is the same derivation datasets use (`datasetRoleFrom` in
`services/contracts`), applied to the page's own sharing by `pageRole`
(`lib/dataset-permissions`): owner (group editors included), editor (a named editor
share, the link's editor role or the host's document-editor grant, for an account),
viewer (a named viewer or commenter share, or group viewer), signed_in (any other
account reaching the page) and anonymous (no account: a visitor, a guest, a test user
outside the sandbox). A caller who cannot read the page has no role and is refused.

`@auth(role: …)` on a Query or Mutation field means **at least** that role, in the order
anonymous < signed_in < viewer < editor < owner (`resolverFieldRefusal` in
`namespaces.ts`, pinned by the role table in `__tests__/namespaces.test.ts`).
Dataset rules differ: they match exactly one role per request, as in Hasura.

| Directive | Who may call |
| --- | --- |
| none | anyone who can read the page (anonymous) |
| `@auth(signedIn: true)`, `@auth(role: signed_in)` | at least signed_in |
| `@auth(role: viewer)` | at least viewer |
| `@auth(role: editor)` | at least editor |
| `@auth(role: owner)` | owner |

Any other role name, an uppercase one included, is refused at publish (`boundedBackendSchema`).
An anonymous caller refused a field that needs signed_in gets `Sign in required`;
every other refusal is `Not allowed`.

A resolver declares its secrets as a map such as `{API_KEY: 'api.example.com'}` and gets `caps`
with `fetch`, `query`, `sql` and `postgres` only (below): `caps.fetch(url, {method, headers, body})` (`public-fetch.ts`).
The app performs the request. It fills `{{NAME}}` in the URL (percent-encoded),
header values and body only for a declared name whose bound host (exact, or any
subdomain under one leading `*.`) matches the request host. Anything else is
refused before a value is read or a socket opens (`unknown_secret`,
`secret_host_forbidden`); an unset value fails with `secret_unavailable`. The same address guard applies on
every hop; redirects are followed only for GET and HEAD requests that carry no
secret. Every status is returned. `set-cookie` is dropped, and each value used,
with its URL-encoded and base64 forms, is replaced with `[redacted]` in the body,
headers and URL. Resolver code never receives a value: the host offers no other
capability. The run receipt records method, host, the
path as written, status, duration, bytes and secret names, never a query string,
header value or body. `auth: {type: 'google', secret, scopes}` (`google-auth.ts`)
treats the named secret as a Google service-account JSON key: the app signs an RS256
JWT, exchanges it at the fixed `oauth2.googleapis.com` endpoint (never the key's
`token_uri`), caches the token per owner, resolver, secret, key and scope set until a
minute before expiry, and sends `Authorization: Bearer` only to a `*.googleapis.com`
host the secret is bound to, never across a redirect. The token joins the redacted
values; failures are `auth_key_invalid` or `auth_failed`. Size and time limits are one table, `RESOLVER_LIMITS` in
`services/contracts`: 2 MiB response, 256 KiB request body and 10 s per fetch,
4 MiB per runner message and remote callback reply, 15 s wall time and a 16 s app
wait.

## `caps.db`

`const db = await caps.db(name)` opens a session on a connection the pinned version declares with a database kind
(`secrets = {NAME: 'postgres'}` or `{NAME: 'mysql'}`, RESOLVER_DATABASE_KINDS) and the owner configured
(`database.ts`: `unknown_connection` for any other name, `connection_unavailable` when unset or stored for another
kind; `caps.fetch` refuses such a name as `secret_host_forbidden`). `db.query(sql, params?)` answers
`{rows, columns, command, count}` (`$1` placeholders for Postgres, `?` for MySQL); `db.end()` closes it. There is no
`caps.postgres`. The settings, password included, go to the runner worker's driver for the kind, never to resolver
code; the runner tunnels the bytes (services/runner README, *Database connections*, which also lists the type
mapping and MySQL's differences). Resolver code never sees the password, but it can run any SQL the connection's
user may, so owners use a read-only database user. A failed run's reason is redacted of each connection's password
as of a secret value. Owners set a connection with `PUT {name, connection: {host, port, database, user, password,
tls?, ca?}}` on the secrets address; it is stored with the declared kind.

## `caps.query`

`await caps.query(graphql, variables?)` returns `data` from the generated
Hasura-style API (`lib/graphql-compat/dataset/hasura.ts` `executeLinkedDatasetGraphql`)
over the datasets the page links, under their page names: a single-table dataset's
root is the link name, a multi-table dataset's are `<name>_<table root>`. It runs as
the caller: the dataset role is each dataset's own sharing under the page audience
rule (a reader with no sharing of their own is signed_in or anonymous), never the
page owner's rights. A dataset the role reads nothing of is absent, as if unlinked;
resolver namespaces are never reachable. A failure throws an `Error` whose `code` is
`validation_failed`, `permission_denied`, `conflict`, `unavailable`,
`result_too_large` or `caller_unavailable` (a run whose pin attests no caller).
Mutations are refused in query resolvers (`permission_denied`); in mutation resolvers
they run through the generated mutation path as the caller, under each dataset's rules
for the caller's role through the page (`X-Hasura-Page-Id` is the page), one dataset
per mutation (`one_dataset_per_mutation`), with `idempotencyKey` naming the durable
receipt when the resolver passes one. A document is at most 16 KiB and an answer 4 MiB
(`RESOLVER_LIMITS`); each call counts toward the 32-request limit. A
resolver's live revision is a hash of the page's linked live dataset revisions
(`lib/html-backends/live.ts`), so a dataset write refreshes its reads.

## `caps.sql`

`await caps.sql(sql, params?)` answers `{columns, rows}`; `caps.sql({queries, params, paramTypes, tables, only})`
mirrors the SQL service's `RunInput` (queries in order, a later one reading an earlier result by name, inline
author-typed `tables`) and answers `{[name]: {columns, rows} | {error}}` (`sql.ts`), for the `only` names when
given: the other queries run as dependencies and their rows neither come back nor count against the answer cap. It is READ-ONLY: it runs on
the SQL service's `run` door, the one registered page queries use, which admits reads only; data changes only
through `caps.query` mutations. A call mounts the linked datasets its SQL names (SQLite folds ASCII identifiers,
so a link name absent from the text cannot be read): a single-table dataset is the table `<link>`, a multi-table
one `<link>.<table>` (an attached schema, as the service mounts imports), each with `_id`, the row's
generated-API id. Rows come from the same load `caps.query` uses (`lib/dataset-access` `planLinkedDatasetTables`
over `loadLinked`: each dataset's role view for the caller through the page, `X-Hasura-Page-Id` the page), so
filtered rows, hidden columns and unreadable datasets are absent. A mounted table whose rule for the caller does
not allow SQL (`allow_aggregations`, the one SQL permission) refuses the call (`permission_denied`; owner and editor
always may). caps.sql reads the page head's links (a resolver run names no revision); the page's own `_sql`
(`lib/dataset-access` `page-sql`) reads the links of the revision the reader has open, on the same engine and
permission, through keyed catalog sources rather than shipped rows. Reads of one revision under one role view are shared while in flight (`lib/datasets` `createSharedReads`).
Limits are the registered page queries' (`SQL_READ_LIMITS` in `services/contracts`): 10,000 input rows (inline
and dataset together), a million cells and 8 MiB of input, 5 s per `run`, 20 s per call; the answer is bounded
by `RESOLVER_LIMITS.queryResultBytes` and each call counts toward the 32-request limit. Refusals throw with
`code` `validation_failed` (a bad argument or SQL, a write statement), `permission_denied`, `input_too_large`,
`result_too_large`, `timeout`, `conflict`, `unavailable` or `caller_unavailable`. The local preview (`serve.mjs`)
runs no resolvers.

Author code runs in the existing bounded isolated runner, never in the app process.
Imports use the runner compiler's fixed bundled allowlist:

- `abort-controller/dist/abort-controller.mjs`
- `fast-text-encoding`
- `core-js/web/url`
- `core-js/web/structured-clone`

These dependencies are pinned by the repository lockfile. Arbitrary npm imports,
Node built-ins and host environment variables are unavailable. Keep backend
examples import-free and never put credentials in HTML or browser configuration.

An execution failure after admission has an unknown mutation outcome. The host
never automatically retries it. Archived page revisions permit queries only.

The declared secret names and hosts are immutable version metadata; values are held
separately, encrypted and scoped to the backend file and its owner. Missing or revoked
values fail closed. The host verifies the admitted owner, exact source version and
declaration on every call, including direct capability calls.

Owners configure values using the existing authenticated session or bearer API:
`/api/my/resolvers/{backendId}/{version}/secrets` accepts `PUT {name,value}`,
`DELETE {name}`, and `GET`. Responses contain configured names only. Page editors
cannot configure another owner's credentials. Configuration never changes HTML,
backend source, version metadata or download content. Rotation and revocation
apply to already published versions immediately. This is not a general information
flow restriction on owner-authored backend network requests.
