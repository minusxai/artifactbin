# Local state in depth

SKILL.md covers the basics: read with a query, write with `client.updateQuery`. This file covers the details.

## Whose state it is

Local state belongs to one viewer. The platform keeps their working state in their browser, for that page, so it survives reloads and new page versions without changing another viewer's working state. This is a scope for edits, not a confidentiality boundary: downloads include local state, comments and shared viewer snapshots send state and rendered content to the server for authorized viewers, and shared state addresses carry their state to recipients. Never put secrets in local state or promise that a draft stays only on the device.

A viewer opening the page for the first time starts from the page's `<script type="application/json" data-af="state">` block, or from nothing if it has none.

Keep viewer-specific state in local state: filters, the open tab, selections and drafts. Render shared backend data directly from `watchQuery` results; do not mirror it into local state. Comments and "view as person" retain a rendered snapshot with local state. Downloads retain local state, but need a connection to read fresh shared backend data. Viewer state kept only in plain variables is missing from these saved views.

To share data between viewers, use a backend. See [`backend.md`](backend.md) for its store.

## Reading

`client.watchQuery({ query }).subscribe(callback)` calls `callback` straight away with the current data, then again whenever any field in the query changes. It returns a subscription; call `.unsubscribe()` to stop watching. `client.query({ query })` returns the current data once. Use `client.watchQuery({ query, clearOnRefresh: true })` when an old remote result must disappear immediately on invalidation or reconnect: backend fields become `null` before the replacement read. `result.loading` is `true` during a backend read and `false` on its answer or error. Use this flag to distinguish the pending clear from a completed guest, unavailable or empty answer; `null` alone cannot identify loading. Clear previously displayed private data on a completed unavailable answer or error. Local fields stay intact, and the default retains the previous result while refreshing.

A watch may also select backend namespaces, alongside local fields. Local fields emit immediately and backend fields initially emit `null`; the first remote response supplies their data. Authorized server changes and reconnects trigger fresh reads automatically, without a polling timer. Callback results include `errors` when a read fails or access is refused; the affected backend fields are `null`. Remote results never enter the viewer’s local state. Dispose subscriptions when removing a view (`subscription.unsubscribe()`); `client.dispose()` stops all watches. At most 16 remote watches may be active per client, each keeping one request and one coalesced invalidation.

A namespace is remote only when its `<link rel="af-backend" data-af-name="…">` declaration exists. If a page supports running without that link, show the shared data as unavailable; never substitute a same-named local field.

A field that has never been written is `null`, so give it a default when you read it: `data.products ?? []`.

## Writing

`client.updateQuery({ query }, fn)` passes the current data, in the query's shape, to `fn`, and saves what `fn` returns. Only the top-level fields named in the query are changed; everything else is left alone. Each of those fields is replaced by what `fn` returns for it, so select every subfield you want to keep.

`fn` may run more than once (see below), so it must only compute the new value. It must not change the page, call the network or start timers.

## Two tabs of the same viewer

A viewer can have the page open in two tabs. Both use the same saved state. Each write starts from the latest saved copy: if the other tab changed a field since this tab read it, `fn` runs again with the data that now includes that change, then saves the result. A change in one tab shows up in the other.

## Changes that must combine

Some changes should add up rather than replace each other, such as a counter. Register these as named mutations with `client.addResolvers`:

```js
import { gql, client } from '@afbin/apollo';

client.addResolvers({
  Mutation: { vote: (draft) => (draft.votes = (draft.votes ?? 0) + 1) },
});

await client.mutate({ mutation: gql`mutation { vote }` });
```

A resolver is called as `(draft, args)`. It changes `draft`, the viewer's whole local state, directly, and what it returns is the mutation's result. If it throws, nothing is saved. If another tab changed the state first, it runs again on their result, since it may have read any field. Like `updateQuery`, it must not have side effects.

Votes that every viewer should see add up in a backend instead: read and write its store with compare-and-swap, as [`backend.md`](backend.md) shows.

## Snapshot a view in a URL

An address ending in `#af-state=<state>` opens the page with that local state. `<state>` is the state's JSON, encoded as UTF-8 and then base64url, without padding. In Node: `Buffer.from(JSON.stringify(state)).toString('base64url')`.

- The state replaces the viewer's local state for that page, so a reload keeps it. The platform removes `#af-state` from the address bar.
- It must be a JSON object that local state can hold, and at most 256 KB. Anything else is ignored, with a warning in the console, and the viewer's own state loads instead.
- It changes only the viewer who opens the address.
- A comment's context (`GET /api/files/:id/context/:commentId`) returns `url`: the page's address with the commenter's state. Open it to see exactly what they saw.

## What can be stored

Strings, numbers, booleans, `null`, arrays and plain objects. Store dates as ISO strings (`'2026-10-20'`). Functions, DOM nodes, class instances, `undefined`, `NaN` and `Infinity` are rejected.

## History

When someone comments, the platform saves their local state with the comment. Viewing that comment later shows the page as they saw it, read-only, without running your scripts. Clicking another viewer in the toolbar shows their current page the same way, until you return to your own.

For a local recovery record that must survive reload before sending a shared write, use `client.updateQuery({ query, requireDurable: true }, fn)`. It rejects if browser storage is unavailable or full; ordinary local updates still work in memory. The acknowledgement covers the browser's successful storage write, not backup or protection from the viewer clearing storage. A memory-only client cannot acknowledge durability.


`client.authorizationContext()` returns a credential-free opaque marker for the current
page and caller after fresh server authorization. It is stable across reloads for
that account incarnation or exact guest share capability. Account switch or
recreation, another page, or a replaced share capability changes it. It is `null`
while disconnected or unauthorized, or when an anonymous request carries no
specific share capability. Use it only to compare the caller that saved a pending
local intent with the caller about to retry it; it grants no access and must never
replace server authorization. Guests using the same share capability have the same
effective authorization identity; the marker does not identify an individual person.
