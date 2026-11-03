---
name: resolvers
description: Resolver files for pages, caps.fetch with host-filled secrets, caps.query over linked datasets as the caller, read-only caps.sql, caps.postgres to the owner's database, @auth roles and Test connection.
---
## Read first: dataset or resolver?

Shared rows (sign-ups, targets) live in a dataset. A page reads and writes it directly
through the generated API under the dataset's [permissions](permissions.md); that needs no
resolver. Add a resolver for what the page cannot do itself: check or derive values before a write,
or call an external API with a secret. A resolver is a TypeScript file published with the page and run
on the server in a sandbox, one immutable version per change:

```html
<link rel="af-resolver" data-af-name="budget" href="./budget.ts">
```

`node scripts/publish.mjs index.html` sends the file (HTTP: `resolverSources:{"budget":"<source>"}`);
browsers never fetch it. A page from `read.mjs` has no `href`: add `href="./NAME.ts"` beside the
file to change it, or leave the link as is to keep the published version. Removing the link unlinks
it from new versions only.

## Contents

[File](#the-file) · [caps.fetch](#capsfetch-and-secrets) · [caps.query](#capsquery-datasets-as-the-caller) · [caps.sql](#capssql-read-only-sql) · [caps.postgres](#capspostgres-your-own-database) · [@auth](#auth-roles) · [Page](#calling-from-the-page) · [Library](#library)

## The file

Start from a library file below (`resolvers/resolver-*.ts`; each top comment says how to use it)
or `examples/budget.ts`. Export `typeDefs`, a default object of root field resolvers, optionally
`secrets` and a `test` field. Each resolver gets `(args, principal, caps)`: `principal` is
`{tenant, subject, role}` (the page ID, the caller's account ID or null, their role), set by the
platform; never authorize from a name typed into the page. `caps` holds exactly `fetch`, `query`,
`sql` and `postgres`. No npm packages or Node built-ins.

```ts
export const secrets = {API_KEY: 'api.example.com'};
export const typeDefs = `
  type Deal { name: String! stage: String! }
  type Query { deals(stage: String): [Deal!]!  test: String! @auth(role: owner) }
  type Mutation { addNote(deal: String!, text: String!): Boolean! @auth(role: signed_in) }
`;
export default {
  async deals({stage}, _principal, caps) {
    const res = await caps.fetch('https://api.example.com/v1/deals', {
      headers: {Authorization: 'Bearer {{API_KEY}}'}});
    if (!res.ok) throw Error('API answered ' + res.status);
    return (await res.json()).filter(d => !stage || d.stage === stage);
  },
  async test(_args, _principal, caps) {
    return 'API answered ' + (await caps.fetch('https://api.example.com/v1/deals', {
      headers: {Authorization: 'Bearer {{API_KEY}}'}})).status;
  },
  async addNote({deal, text}, _principal, caps) {
    if (!text.trim() || text.length > 280) throw Error('Write a note of up to 280 characters');
    await caps.query(`mutation($o: notes_insert_input!){insert_notes_one(object:$o){_id}}`,
      {o: {deal, text: text.trim()}});
    return true;
  },
};
```

Per call: 15 s wall time, 32 requests, 4 MiB result, 64 MiB memory.

A resolver's own `throw Error('...')` reaches every caller as `errors[0].message` (first line, 200
characters, secrets redacted); a caps error you don't catch, a timeout or a crash reads `Backend
execution failed`, with the reason in `extensions.detail` for the owner only.

## caps.fetch and secrets

`caps.fetch(url, {method, headers, body, auth})` returns `{ok, status, url, headers, text(), json()}`
for every status. HTTPS on port 443 only; private, loopback and metadata addresses are refused;
10 s, 256 KiB request body, 2 MiB response; at most 3 redirects, only for GET/HEAD without secrets.
`body` is a string (JSON.stringify yourself).

Secrets never appear in code, pages or replies (but see caps.postgres). `export const secrets =
{NAME: 'host'}` binds each name to the one host (or `*.example.com`) that may receive it. Write
`{{NAME}}` in the URL, a header value or the body; the host fills it only in requests to that host and redacts the value from
responses. `auth: {type: 'google', secret: 'GOOGLE_SA', scopes: [...]}` signs in with a Google
service-account JSON key and sends the token (Sheets, BigQuery).

Never ask for a secret value in chat. After publishing, send the page owner to the page's
settings → Resolvers tab: they set each value there and press Test connection, which
runs `test: String! @auth(role: owner)` (no required arguments) as them and shows its text or the
error. Forks and ownership changes copy names, never values. Editors cannot change code that
declares secrets; the personal owner republishes it.

## caps.query: datasets as the caller

`await caps.query(graphql, variables)` runs the generated API over the datasets the page links,
under their page names, as the calling reader: the same rules apply as if the page called it, so a
resolver can check and derive but never grant more. Mutations run only inside mutation resolvers.
It returns `data`; refusals throw an Error with `code` (`permission_denied`,
`validation_failed`...). For writes by readers, give the dataset rules for `viewer` and
`signed_in` (see [permissions](permissions.md)). There is no upsert: read the row, then
`update_X_by_pk(pk_columns:{_id})` or `insert_X_one`.

## caps.sql: read-only SQL

`await caps.sql(sql, params)` runs one read-only SQLite query (joins, CTEs, window functions,
`date_trunc`...) over the linked datasets as the caller and returns `{columns, rows}`. Data changes only through `caps.query` mutations. A single-table dataset
is the table `<link>`, a multi-table one `<link>.<table>`; each has `_id`. You read the rows and
columns `caps.query` gives you; a dataset whose rule for you lacks `allow_aggregations` refuses the
call. Bind values as `$name`:

```ts
const {rows} = await caps.sql('SELECT region, count(*) AS n, sum(amount) AS total FROM orders ' +
  'WHERE day >= $since GROUP BY region', {since: '2026-01-01'});
```

`caps.sql({queries:[{name, sql}], params, paramTypes, tables, only})` runs several in order (a later one
reads an earlier by name) with inline `tables` (`{columns:[{name, type}], rows}`) and returns
`{[name]: {columns, rows} | {error}}`, only the `only` names if given. Per call: 10,000 input rows, 8 MiB in, 5 s
per query, 20 s total, 4 MiB out; one of the 32 requests.

## caps.postgres: your own database

`secrets = {DB: 'postgres'}` declares a connection the owner sets in Resolvers.
`db = await caps.postgres('DB')` opens a session (TLS verify-full, public host, port 1024+);
`db.query(sql, [params])` gives `{rows, columns, command, count}`; then `db.end()`. The password
enters the run: **use a read-only database user**. Per run: 4 connections, 16 MiB in, 4 MiB out.

## @auth roles

`@auth(role: owner|editor|viewer|signed_in|anonymous)` means "at least" (anonymous < signed_in <
viewer < editor < owner); no directive means any reader. A guest calling a `signed_in` field gets
"Sign in required". Gate writes in the schema and in the UI.

## Calling from the page

Fields stay under the link name; your own input types get its prefix (`input BudgetInput` is
`budget__BudgetInput`). Copy exact names from `node scripts/graphql.mjs schema PAGE_ID`.

```js
import {client,gql,onResolverChange} from '@afbin/apollo';
const r=await client.query({query:gql`{pipeline{deals(stage:"Open"){name stage}}}`});
if(r.errors?.length)throw Error(r.errors[0].message);
await client.mutate({mutation:gql`mutation Save($items:[budget__BudgetInput!]!){budget{save(items:$items)}}`,variables:{items:[{category:"Food",amount:200}]}});
onResolverChange(names=>{ /* a linked dataset or resolver changed: reload */ });
```

Show `errors`; never report them as saved.

## Library

| File | Source | Secret |
|---|---|---|
| `resolver-public-url.ts` | Public CSV/JSON URL | none |
| `resolver-dataset-sql.ts` | Linked dataset, totals with `caps.sql` | none |
| `resolver-http-json.ts` | JSON API with a bearer key | `API_KEY` |
| `resolver-google-sheets.ts` | Private Google Sheet | `GOOGLE_SA` (service account) |
| `resolver-bigquery.ts` | BigQuery SQL | `GOOGLE_SA` |
| `resolver-supabase.ts` | Supabase table (PostgREST) | `SUPABASE_KEY` |
| `resolver-neon.ts` | Neon Postgres over HTTP SQL | `NEON_PASSWORD` |

