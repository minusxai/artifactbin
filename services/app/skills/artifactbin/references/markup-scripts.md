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

- `mx.params.get(name)`, `.set(name, value)`, `.subscribe(names, fn)`: declared scalar
  signals. Writes re-run dependent queries and update bound embeds. A set crosses
  an asynchronous channel; an immediate get can return the preceding snapshot.
  Subscribe to observe the accepted value. The subscription returns an unsubscribe
  function. Pass explicit names, e.g. `mx.params.subscribe(['count'], fn)`;
  callbacks receive only selected values when relevant state changes.
- `mx.data.get(name)`: a detached `{rows, columns}` result, or undefined before it
  arrives. **Rows arrive after the script starts**; use `mx.data.subscribe(['results'], fn)`.
  Subscribers receive `(selectedState, pendingNames)`. `.pending()` returns pending names.
  Both subscription APIs retain broad `.subscribe(fn)` compatibility.
- `mx.refresh(names?)`: refresh all queries or the named declared queries.
- `mx.canMutate(name)` and `mx.mutationReason(name)`: current permission and denial
  reason (null when allowed). Permissions arrive asynchronously and can be revoked;
  use `mx.data.subscribe(fn)` to update action controls.
- `await mx.mutate(name, values?)`: run a declared mutation with optional scalar
  signal overrides. Store and server permissions still apply; failures reject.

Only currently declared signals, queries, and mutations are accepted. There is
no script API for liking, following, commenting, source edits, arbitrary URLs,
or authenticated fetch. Requests are bounded; a script must not flood the bridge.

Changed or removed scripts revoke their old iframe and subscriptions on live
updates; unchanged scripts survive prose edits. Revocation does not undo a write
already accepted by the server. Origin isolation is not a guarantee of CPU or
memory isolation.

In Helmet script text, split `</script` as `'</scr' + 'ipt'`.
See [markup](markup.md) for a signal-subscription example and the Helmet syntax.
