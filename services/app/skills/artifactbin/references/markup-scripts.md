---
name: markup-scripts
description: >-
  Isolated scripts and their data bridge.
---
## Read first

One `<script>` in `<Helmet>` runs after hydration in a hidden opaque-origin
iframe. The visible markup is rendered by the trusted runtime. Author scripts
cannot access that DOM, cookies, or storage. Fetch is blocked by CSP.

Use declarative controls for visible interactions and the `mx` data API for
logic. Existing scripts that attach listeners to visible elements or manipulate
them must be migrated; there is no legacy same-realm execution fallback. Not
every DOM interaction currently has a declarative equivalent.

`window.mx` is defined before the script runs:

- `mx.params.get(name)`, `.set(name, value)`, `.subscribe(fn)`: declared scalar
  signals. Writes re-run dependent queries and update bound embeds. A set crosses
  an asynchronous channel; an immediate get can return the preceding snapshot.
  Subscribe to observe the accepted value. The subscription returns an unsubscribe
  function.
- `mx.data.get(name)`: a detached `{rows, columns}` result, or undefined before it
  arrives. **Rows arrive after the script starts**; use `mx.data.subscribe(fn)`.
  Subscribers receive `(state, pendingNames)`. `.pending()` returns pending names.
- `mx.refresh(names?)`: refresh all queries or the named declared queries.
- `await mx.mutate(name, values?)`: run a declared mutation with optional scalar
  signal overrides. Store and server permissions still apply; failures reject.

Only currently declared signals, queries, and mutations are accepted. There is
no script API for liking, following, commenting, source edits, arbitrary URLs,
or authenticated fetch. Requests are bounded; a script must not flood the bridge.

Changed or removed scripts revoke their old iframe and subscriptions on live
updates; unchanged scripts survive prose edits. Revocation does not undo a write
already accepted by the server. Origin isolation is not a guarantee of CPU or
memory isolation.

`</script` cannot appear in script text; split it as `'</scr' + 'ipt'`.
See [markup](markup.md) for a signal-subscription example and the Helmet syntax.
