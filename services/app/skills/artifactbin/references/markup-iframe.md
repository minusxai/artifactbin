---
name: markup-iframe
description: "Managed frames."
---
## Read first

Prefer native JSX and kit components for document content, layouts, charts and
ordinary interactions. Use `<Iframe>` only for an isolated widget that requires
its own DOM scripts or canvas/library APIs, such as Three.js, a game or a simulation.
Keep headings, prose, controls and charts outside the frame when the kit supports
them; unrestricted HTML/CSS/JS alone is not a reason to frame the entire document.
The child has its own styles and DOM. Parent theme styling and inline editing
do not reach its internal elements; commenting uses the managed selection bridge.
Write its HTML, CSS and scripts directly as static JSX children; the platform
packages them into an opaque sandboxed `srcdoc` child inside a protective
wrapper. Its script can use **its own DOM/canvas**, never the parent artifact,
account APIs, cookies or parent storage. Do not supply `sandbox`, `srcdoc`,
`api`, `store` or `compiled`; these are platform-owned.

Signals and declared mutations cross a bounded message bridge; this does not grant account authority.
Persistent writes remain authenticated and permission-checked.

External assets require the deployment to configure **`APP__ASSETS_ORIGIN`**:
a distinct public cached-byte hostname, not the artifact
hostname, with HTTPS/routing configured in app and proxy. Missing configuration
refuses external asset resolution; it never falls back to contacting the CDN
from author code. A local canvas with no external assets needs no CDN.

## Contents

Counter and canvas · Libraries and assets · Comments and dynamic elements · State and compatibility.

## Counter and canvas

```jsx
<Helmet><Value name="count" type="number" default={0} /></Helmet>
<p>The canvas below reads the shared count.</p>
<Iframe title="Counter canvas" height={220}>
  <style>{`body {margin:16px;font:16px system-ui} canvas {display:block;margin-top:12px}`}</style>
  <button id="increment" aria-label="Increment count">Add one</button>
  <canvas id="counter" width={280} height={100} />
  <script>{`
    const canvas = document.getElementById('counter');
    const ctx = canvas.getContext('2d');
    function draw(values) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#2563eb';
      ctx.font = '32px system-ui';
      ctx.fillText('Count: ' + (values.count ?? 0), 12, 55);
    }
    draw({count: mx.params.get('count')});
    const stop = mx.params.subscribe(['count'], draw);
    document.getElementById('increment').addEventListener('click', () => {
      mx.params.set('count', Number(mx.params.get('count') ?? 0) + 1);
    });
    addEventListener('pagehide', stop);
  `}</script>
</Iframe>
```

The parent owns data declarations. Parent Tailwind/CSS does not style the child;
use its own `<style>` or static inline style. Height is 100–4096 pixels; width
follows its container. Inner markup stays static data: no JSX callbacks, handler
attributes, nested frames, forms, meta/base tags or custom React components.
Attach listeners inside script text. DOM is assembled before scripts run in
document order. Changing source replaces the realm; clean up animation loops,
observers and GPU resources on `pagehide`.

## Libraries and assets

Inside `<Iframe>`, declare `<script src="https://cdn.example/bundle.js" />`
before the script that uses its globals. Supply a **self-contained bundle**;
there is no Three.js exception or recursive dependency bundler. Classic scripts
and `type="module"` scripts are supported, but relative/transitive module imports,
workers and libraries requiring `eval`/`new Function` are not supported. A module's
exports are not globals. Prefer a bundled classic build for the simple ordered
script pattern. The importer checks JavaScript MIME type, size and URL safety.

Declared image/script URLs are resolved to cached assets before insertion.
Public/unlisted `ref:<id>` assets are supported; private, deleted or missing
refs are refused, even when the viewer can read the containing document.
Use a real uploaded ID, never a private ref as a way to share viewer credentials.

GET `fetch` and asynchronous GET `XMLHttpRequest` go through the asset resolver,
as do supported dynamic image/script `src` assignments. Requests do not forward
viewer credentials upstream. Unsupported methods or APIs are not a general HTTP
proxy. Arbitrary `innerHTML` and CSS URL strings are **not automatically rewritten**.

Rewriting is convenience; **CSP enforces HTTP/resource destinations**: the frame can request
only the configured public cached-asset origin, not arbitrary external hosts or
another application origin. Unsupported/unrewritten requests are blocked.
The inner sandbox and protective wrapper restrict navigation; do not remove the wrapper
or weaken its policies to make a library load. WebRTC peer-connection constructors
are disabled before author code and cannot be restored by it.

## Comments and dynamic elements

The platform supplies comment selection and highlighting inside managed frames.
Authors do not install a second comment UI or message listener. The parent sends
Select mode and active comment state; the child captures blocks, words and areas,
paints highlights, and reports geometry. The comment composer stays in the app.
The controls and highlight styles are shared with markup. Existing comments open
from the app's markers or sidebar, leaving content clicks and text selection native.
Explicit Select mode supports block picking and area dragging; ending it restores
native selection and touch scrolling. Touch long-press exposes the Select action.
This bridge grants no new data-write or account permissions.

Static JSX elements already receive persistent source IDs. Preserve those IDs
when editing source. For elements your script creates or rebuilds, provide stable
`data-comment-key` values:

```js
const row = document.createElement('article');
row.dataset.commentKey = 'order:' + order.order_id;
const customer = document.createElement('p');
customer.dataset.commentKey = 'customer';
customer.textContent = order.customer;
row.append(customer);
```

The target is the key path `order:123 → customer`, scoped to this Iframe's source
ID. Rebuilding with the same key path reconnects comments. Keys must identify
logical items, not row positions, current text or random values. Do not reuse a
removed item's key for an unrelated item. Duplicate paths are ambiguous and must
not highlight an arbitrary match.

Unkeyed script-created elements can still be selected, but their automatic handles
last only for that iframe session. Replacement/reload cannot reliably reconnect
them. Comments always retain the Iframe's source ID as a fallback when an internal
target disappears. The exact target is retained so a keyed element can reconnect
when it returns. A text quote or area is a refinement, not a substitute for stable
identity. Canvas pixels and closed shadow-root internals need an explicit author
adapter to expose semantic nodes; otherwise select the containing element or area.

## State and compatibility

`mx.params.subscribe(['count'], fn)` supplies a detached object containing those
scalar values when relevant state changes. `mx.data.subscribe(['results'], fn)`
supplies `(state, pendingNames)`: results are at `state.tables.results`, with
selected errors at `state.errors`. Subscriptions return
unsubscribe functions; initial results can arrive after script startup.
Legacy `.subscribe(fn)` still subscribes broadly; prefer explicit names to avoid
unrelated updates. `.get(name)` reads the current snapshot, not a synchronous
acknowledgment of `.set(name, value)`.

Use `mx.refresh(names)` for declared queries and `await mx.mutate(name, values)`
for declared mutations. No bridge operation permits arbitrary account APIs or
source edits. See [script API](markup-scripts.md).

The hidden Helmet script remains compatible. Use generic `<Iframe>` for new
visible scenes; pinned libraries are documented in [libraries](markup-libraries.md).
