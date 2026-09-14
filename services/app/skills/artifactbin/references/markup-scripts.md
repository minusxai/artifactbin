---
name: markup-scripts
description: >-
  Script APIs.
---
## Read first

One `<script>` in `<Helmet>` runs after hydration in a hidden opaque-origin
iframe. The visible markup is rendered by the trusted runtime. Author scripts
cannot access that DOM, cookies, or storage. Fetch is blocked by CSP.

Use declarative controls for visible interactions and the `mx` data API for
logic. Existing scripts that attach listeners to visible elements or manipulate
them must be migrated; there is no legacy same-realm execution fallback. Not
every DOM interaction currently has a declarative equivalent.

For new canvas/library interfaces, use [managed Iframe](markup-iframe.md), with
static DOM, style and script children. Its script may manipulate **its own
internal HTML**, never the parent document, and receives the same bounded `mx`
bridge plus anonymous cached assets.

## Data API

`window.mx` is defined before the script runs:

Author a classic script body, without `import` or `export` declarations.
`describe()` returns arrays, not dictionaries:
`{instanceEpoch, signals:[{name, kind, writable, type?, columns?}], mutations:[{name, scope, args, available, unavailableReason}]}`.
List names with `description.signals.map(signal => signal.name)` and
`description.mutations.map(mutation => mutation.name)`.

- `await mx.describe()` lists scalar/table/query signals and declared mutations with their arguments and current availability.
- `await mx.read(['count', 'results'], options?)` returns `{instanceEpoch, revision, signals}`. Each selected signal is `{value, status, error?}`; status is `ready`, `pending`, or `error`. Scalars are primitive values; tables are detached `{columns, rows, truncated?}` objects. Query rows may be null before the first result. This reads authoritative host state, including across the iframe boundary.
- `await mx.read(['results'], {wait:true})` waits for selected queries to settle. `{refresh:true}` forces selected queries to rerun and waits. Refresh accepts query names only. `timeoutMs` defaults to 10000, capped at 30000; a timeout rejects with `code: 'TIMEOUT'` and the latest `snapshot`.
- `await mx.set({count: 2})` validates the entire scalar patch before writing. Bound controls update and dependent queries rerun. Tables and query results cannot be set. The acknowledgment includes `instanceEpoch` and `revision`; it does not wait for queries.
- `await mx.mutate('save', {count: 3})` executes a declared mutation with per-call arguments, without changing scalar signals. It returns `{operationId, scope, status:'committed'}`. Declared row/cell parameters can be passed as `{_row:{id:1}, _value:3}`. Permissions still apply; a concurrent call to the same mutation rejects with `BUSY`. A committed write is not undone by a later refresh failure.
- `const stop = mx.subscribe(['count', 'results'], snapshot => { ... })` delivers an asynchronous initial snapshot and subsequent selected value/status/error changes. It coalesces rapid updates. `stop()` is synchronous and idempotent; call it on `pagehide`. Callback arguments have exactly the same shape as `read()`.

Use `snapshot.signals.results.value.rows`, not `snapshot.results` or `snapshot.tables`.
Render pending and error states explicitly. Keep event handlers in `try/catch/finally`
so failed writes restore disabled controls. Do not await a never-ending lifetime
promise at module top level: finish startup, register handlers, and return.
Errors expose `code` and `message`; query errors are also carried on their signal.

Only currently declared signals, queries, and mutations are accepted. There is
no script API for liking, following, commenting, source edits, arbitrary URLs,
or authenticated fetch. Requests are bounded; a script must not flood the bridge.

Changed or removed scripts revoke their old iframe and subscriptions on live
updates; unchanged scripts survive prose edits. Revocation does not undo a write
already accepted by the server. Origin isolation is not a guarantee of CPU or
memory isolation.

In Helmet script text, split `</script` as `'</scr' + 'ipt'`.
See [markup](markup.md) for a signal-subscription example and the Helmet syntax.
