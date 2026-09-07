---
name: markup-iframe
description: "Managed frames."
---
## Read first

Use `<Iframe>` for new scripted canvas, Three.js or other DOM interfaces.
Write its HTML, CSS and scripts directly as static JSX children; the platform
packages them into an opaque sandboxed `srcdoc` child inside a protective
wrapper. Its script can use **its own DOM/canvas**, never the parent artifact,
account APIs, cookies or parent storage. Do not supply `sandbox`, `srcdoc`,
`api`, `store` or `compiled`; these are platform-owned.

This is separate from the trusted controls iframe. Signals and declared
mutations cross a bounded message bridge; this does not grant account authority.
Persistent writes remain authenticated and permission-checked.

External assets require the deployment to configure **`APP__ASSETS_ORIGIN`**:
a distinct public cached-byte hostname, not the artifact or trusted-controls
hostname, with HTTPS/routing configured in app and proxy. Missing configuration
refuses external asset resolution; it never falls back to contacting the CDN
from author code. A local canvas with no external assets needs no CDN.

## Counter and canvas

```jsx
<Helmet><Value name="count" type="number" default={0} /></Helmet>
<p>Shared count: {$count}</p>
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

Rewriting is convenience, **CSP is enforcement**: the author frame can request
only the configured public cached-asset origin, not arbitrary external hosts or
the trusted controls origin. Unsupported/unrewritten requests are blocked.
Sandbox and the protective wrapper restrict navigation; do not remove the wrapper
or weaken its policies to make a library load.

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
source edits. See [script API](markup-scripts.md) and [local state](markup-state.md).

The hidden Helmet script and legacy `<Sandbox html="…" script="…" />` remain
compatible. Use generic `<Iframe>` for new visible scenes; the legacy pinned
library helper is documented in [libraries](markup-libraries.md).
