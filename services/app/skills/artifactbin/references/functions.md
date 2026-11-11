---
name: functions
description: "Read before a page uses an API with a key, an owner's database, server-side checks or a schedule: functions called with fetch('/fn/NAME'), roles, caps.fetch, caps.sql, caps.db, schedules, Test connection."
---
## Read first: dataset, fetch or function?

Shared rows (sign-ups, targets) live in a dataset: the page reads and writes it with `sql` under
the dataset's rules ([datasets](datasets.md)). Someone else's public API
needs no server code: declare `<meta name="csp-connect" content="https://api.example.com">` and
call it with `fetch`. Write a backend function for what the page cannot do itself: check or
derive values before a write (the tracker starter's `tracker.ts`), reach an API or database
with a secret, or refresh data on a schedule. A backend file is TypeScript published with the
page and run on the server in a sandbox:

```html
<link rel="af-resolver" data-af-name="tracker" href="./tracker.ts">
```

`node scripts/publish.mjs index.html` sends it (HTTP: `resolverSources:{"tracker":"<source>"}`);
browsers never fetch it. A page from `read.mjs` has no `href`: add `href="./NAME.ts"` beside the
file to change it, or leave the link to keep the published version.

## Contents

[File](#the-file) · [Call](#calling-from-the-page) · [roles](#roles) · [caps.fetch](#capsfetch-and-secrets) · [caps.sql](#capssql-datasets-as-the-caller) · [caps.db](#capsdb-your-own-database) · [as the viewer](#capsdb-as-the-viewer) · [schedule](#schedules)

## The file

Start from `resolvers/` (usage atop each; `resolver-public-url.ts`, `resolver-http-json.ts`,
`resolver-google-sheets.ts`, `resolver-bigquery.ts`, `resolver-supabase.ts`, `resolver-neon.ts`) or `examples/tracker.ts`. The callable
functions are the keys of an object-literal `export default {…}` and the named exported
functions, read from the source at publish (no spreads, computed keys or reassignment:
`invalid_functions`). Each gets `(input, principal, caps)`: `principal` is `{tenant, subject,
role}` (the page ID, the caller's account ID or null, their role on the page), set by the
platform; never authorize from a name typed into the page. `caps` gives `fetch`, `sql` and `db`.
No npm packages or Node built-ins.

```ts
export const secrets = {API_KEY: 'api.example.com'};
export const roles = {addNote: 'signed_in', test: 'owner'};
const list = caps => caps.fetch('https://api.example.com/v1/deals',
  {headers: {Authorization: 'Bearer {{API_KEY}}'}});
export default {
  async deals({stage}, _principal, caps) {
    const res = await list(caps);
    if (!res.ok) throw Error('API answered ' + res.status);
    return (await res.json()).filter(d => !stage || d.stage === stage);
  },
  async test(_input, _principal, caps) {
    return 'API answered ' + (await list(caps)).status;
  },
  async addNote({deal, text}, _principal, caps) {
    if (typeof text !== 'string' || !text.trim() || text.length > 280)
      throw Error('Write a note of up to 280 characters');
    return caps.sql`insert into notes (deal, text) values (${deal}, ${text.trim()})`;
  },
};
```

Per call: 15 s, 32 requests, 4 MiB result, 64 MiB memory, 64 KiB of POST input.

## Calling from the page

```js
const res=await fetch('/fn/deals?stage=Open'); // GET: a read; inputs arrive as strings
const deals=await res.json();
if(!res.ok)throw Error(deals.message||deals.error);
const saved=await fetch('/fn/addNote',{method:'POST',body:JSON.stringify({deal:'7',text})});
```

GET reads (query parameters as strings; a repeated name is a list); POST may write (its JSON
object body is the input). The answer is the function's return value as JSON with 200, or
`{error, message}`: 403 `sign_in_required`/`forbidden`, 404 `unknown_function`; 500
`backend_failed` when it threw (its own `throw Error('…')` message; an uncaught caps error or a
crash reads `The function failed`); 504 `deadline` when it ran out of time (a write may have
landed: read before retrying); 503 `retryable` with `Retry-After` when the runner was busy
(nothing ran: retry). The owner also gets `detail`. Check `res.ok`; never report a refusal as
saved. Call again when `onResolverChange` names `viewer` (sign-in or out).

## roles

`export const roles = {name: 'owner'|'editor'|'viewer'|'signed_in'|'anonymous'}` means **at
least** that role on the page: anonymous < signed_in (anyone signed in with the link) < viewer <
editor (people the page is shared with) < owner. A function it omits answers anyone who can read
the page; a guest refused gets `sign_in_required`.

## caps.fetch and secrets

`caps.fetch(url, {method, headers, body, auth})` returns `{ok, status, url, headers, text(), json()}`
for every status. HTTPS on port 443 only; private, loopback and metadata addresses are refused;
10 s, 256 KiB request body, 2 MiB response; at most 3 redirects, only for GET/HEAD without secrets.
`body` is a string.

Secrets never appear in code or pages. `export const secrets =
{NAME: 'host'}` binds each name to the one host (or `*.example.com`) that may receive it. Write
`{{NAME}}` in the URL, a header value or the body; the host fills it only in requests to that host and redacts it from
responses. `auth: {type: 'google', secret: 'GOOGLE_SA', scopes: [...]}` signs in with a Google
service-account JSON key and sends the token (Sheets, BigQuery).

Never ask for a secret value in chat: send the page owner to the page's settings → Resolvers to set
each value and press Test connection, which calls the file's `test` function (give it
`roles = {test: 'owner'}`) as them and shows its text or error. Forks and ownership changes copy
names, never values. Editors cannot change code that declares secrets; the personal owner
republishes it.

## caps.sql: datasets as the caller

`` caps.sql`…` `` is the page's `sql` over the linked datasets, as the calling reader under each
dataset's rules, so a function can check and derive but never grant more. A read answers
`{columns, rows}`; one `INSERT`/`UPDATE`/`DELETE` answers `{affected, returning}`, only in a POST
call or a scheduled run (a GET refuses it: `read_only`). Every `${…}` is bound. A table whose
select rule for the caller lacks `allow_aggregations` refuses a read (owner and editors always
may). Refusals throw an Error with `code`. For writes by readers, start the dataset from
`policy.mjs template own-rows`.

```ts
const {rows} = await caps.sql`select region, count(*) as n, sum(amount) as total from orders
  where day >= ${since} group by region`;
```

`caps.sql({queries:[{name, sql}], params, tables, only})` runs several reads in order with
inline `tables` (`{columns:[{name, type}], rows}`) and returns `{[name]: {columns, rows} |
{error}}`. Per call: 10,000 input rows, 5 s per
query, 20 s total, 4 MiB out; one of the 32 requests.

## caps.db: your own database

`secrets = {DB: 'postgres'}` (or `'mysql'`) declares a connection the owner sets in Resolvers.
`db = await caps.db('DB')` opens a session (TLS verify-full, public host, port 1024+);
`db.query(sql, [params])` (`$1`; MySQL `?`) gives `{rows, columns, command, count}`; then `db.end()`.
BIGINT and DECIMAL are strings. Your code never sees the password; **use a read-only database
user**. Per run: 4 connections, 16 MiB in, 4 MiB out.
RDS, Cloud SQL and Supabase need `ca` (the provider's CA bundle, PEM) in the connection (Resolvers → Advanced).
IP allowlists: allow the addresses `GET /api/outbound-ips` lists.

## caps.db as the viewer

`secrets = {SALES: 'viewer'}`: a trusted data service opens `caps.db('SALES')` as each viewer,
not you. Bind it in Resolvers or `PUT /api/my/resolvers/BACKEND/VERSION/secrets`
`{name, binding: {service, params}}` (from `GET /api/my/artifacts/ID/resolvers`). A refused
viewer, a guest or a schedule gets `data_access_denied: SALES`.

## Schedules

`export const schedule = {refresh: 'every 1 hour'}` runs `refresh` on its own: `every N
minutes|hours|days` (`every 15 minutes`, `every 2 days`), at least 15 minutes apart; anything
else fails publish with `invalid_schedule`. A run gets input `{}` and runs as the page's content
publisher (whoever last published it), who must still be an owner or editor, as their own POST
would: `roles` still apply and `caps.sql` may write. The page reads what it saved with `sql`. A
run never overlaps the last; failures back off and show in the owner's Resolvers settings. One
publisher has at most 20 scheduled functions (`schedule_limit`).
