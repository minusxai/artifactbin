---
name: markup-scripts
description: >-
  Script APIs.
---
## Read first

One `<script>` in `<Helmet>` runs after hydration in a bounded JavaScript
interpreter on the page. It is not a browser realm: there is no `document`,
`fetch`, `XMLHttpRequest`, `WebAssembly`, storage, history or `top`. The script
sees exactly `mx` (the document's data), `dom` (the page's elements),
`console`, `setTimeout`/`clearTimeout`, and `window`/`self` as names for its
own global. `import`/`export` are not available; author a classic script body.

Bindings first. `$value` in markup covers selection, filtering and display
without a line of script and is rendered by the server. Write JavaScript for
what bindings cannot express: branching, sequencing, computed state, reacting
to one control with several changes. Canvas, WebGL and library code go in a
managed [Iframe](markup-iframe.md), which runs real browser code in its own
frame with the same `mx` bridge.

Budgets: a script's first run and every later entry (an event, a snapshot, a
timer) run under a deadline, and the realm has its own memory cap. Exceeding
either ENDS the script — it is not an exception to catch. Keep handlers short;
never spin-wait. A live update ends the realm before the new version is drawn
and runs the script again on the new page, so write startup as "find the
elements, bind, done": created elements and listeners from the previous run are
gone.

## `mx` — the document's data

`describe()` returns arrays, not dictionaries:
`{instanceEpoch, signals:[{name, kind, writable, type?, columns?}], mutations:[{name, scope, args, available, unavailableReason}]}`.

- `await mx.describe()` lists scalar/table/query signals and declared mutations with their arguments and current availability.
- `await mx.read(['count', 'results'], options?)` returns `{instanceEpoch, revision, signals}`. Each selected signal is `{value, status, error?}`; status is `ready`, `pending`, or `error`. Scalars are primitive values; tables are `{columns, rows, truncated?}`. Query rows may be null before the first result.
- `await mx.read(['results'], {wait:true})` waits for selected queries to settle. `{refresh:true}` forces selected queries to rerun and waits. Refresh accepts query names only. `timeoutMs` defaults to 10000, capped at 30000; a timeout rejects with `code: 'TIMEOUT'` and the latest `snapshot`.
- `await mx.set({count: 2})` validates the entire scalar patch before writing. Bound controls update and dependent queries rerun. Tables and query results cannot be set.
- `await mx.mutate('save', {count: 3})` executes a declared mutation with per-call arguments. It returns `{operationId, scope, status:'committed'}`. Row/cell parameters pass as `{_row:{id:1}, _value:3}`. Permissions still apply; a concurrent call to the same mutation rejects with `BUSY`.
- `const stop = mx.subscribe(['count', 'results'], snapshot => { ... })` delivers an asynchronous initial snapshot and later changes, coalesced. `stop()` is synchronous and idempotent.

Use `snapshot.signals.results.value.rows`. Errors expose `code` and `message`.
Read tables through queries that select what you need: a large table read is
a large copy into the realm's memory.

## `dom` — the page's elements

Handles are integers; a handle for an element that left the page is refused
(`STALE_NODE`). Only elements under the story root are reachable, never the
app chrome, a managed Iframe's inside, or anything outside the document.

- `dom.query('#id')`, `dom.queryAll('.row')` — CSS selectors under the story root; `null` or `[]` for none.
- `dom.text(h)`, `dom.setText(h, 'Total: 5')` — text content. On an element whose text is a binding (`{$value}`) the binding wins again at its next change; change bound text with `mx.set`.
- `dom.value(h)`, `dom.setValue(h, 'b')` — `input`, `textarea`, `select` (checkbox/radio take a boolean). `setValue` fires `input` and `change`, so a bound control writes its `$value`.
- `dom.addClass(h, 'hidden')`, `dom.removeClass(h, 'hidden')`, `dom.toggleClass(h, 'open', force?)`, `dom.hasClass(h, 'open')` — Tailwind tokens allowed; the runtime's `mx-*` classes are not.
- `dom.on(h, 'click', event => { ... }, {prevent?: true})` — `click`, `dblclick`, `input`, `change`, `keydown`, `keyup`, `focus`, `blur`, `pointerdown`, `pointerup`, `toggle`. The handler receives `{type, target, value?, checked?, key?, clientX?, clientY?, altKey, ctrlKey, metaKey, shiftKey}`, never the browser event. Returns a function that removes the listener.
- `dom.create('li', 'text')`, `dom.append(parentHandle, childHandle)`, `dom.remove(h)` — plain HTML elements only (no `script`, `img`, media, `dialog`, `canvas`). Created elements carry `data-mx-author`, are never saved as source, and are removed when the realm ends.
- `dom.attr(h, 'name')`, `dom.setAttr(h, 'name', value)`, `dom.removeAttr(h, 'name')` — attributes can be set only on elements the script created, and go through the same policy as stored markup: no `on*`, no `style`, no `id`/`class`/`data-mx-*`, no `javascript:` or `data:` URLs.

Each refusal throws an Error with a `code`: `UNKNOWN_NODE`, `STALE_NODE`,
`PAGE_OWNED`, `INVALID_ATTRIBUTE`, `INVALID_CLASS`,
`INVALID_SELECTOR`, `INVALID_TAG`, `INVALID_EVENT`, `NOT_A_CONTROL`, `LIMIT`.

## Example

```jsx
<Helmet>
  <Value name="count" type="number" default={0} />
  <script>{`
    const total = dom.query('#total');
    const render = (snapshot) => dom.setText(total, 'Clicked ' + snapshot.signals.count.value + ' times');
    mx.subscribe(['count'], render);
    dom.on(dom.query('#more'), 'click', async () => {
      const now = await mx.read(['count']);
      await mx.set({ count: now.signals.count.value + 1 });
    });
  `}</script>
</Helmet>
<p id="total">Clicked 0 times</p>
<button id="more">More</button>
```

Only currently declared signals, queries, and mutations are accepted. There is
no script API for liking, following, commenting, source edits, arbitrary URLs,
or any network request. In Helmet script text, split `</script` as
`'</scr' + 'ipt'`. See [markup](markup.md) for the Helmet syntax.
