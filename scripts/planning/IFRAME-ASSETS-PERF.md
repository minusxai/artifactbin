# Cached third-party bundles in visible sandbox frames

Planning experiment only, September7 2026. No product changes or production writes.

## Conclusion

**This works for the tested self-contained bundle.** Native Three.js renders its
own WebGL canvas inside a visible opaque iframe, including inside the stricter
outer-wrapper/inner-author layout. The browser composites that canvas directly:
no pixel-copy transport, per-frame MessageChannel, or parent DOM access is needed.
Button and pointer interaction worked in Chromium, Firefox and WebKit.

First-render cost stayed small in this tiny scene. **WebKit has a measured
pre-interaction animation limitation:**17ms top-level versus50ms in both framed
layouts; a real in-frame button click restored17ms in all3 samples per shape,
even with cycled test order. Passive/autoplay animation remains slower in the
tested opaque frames. Physical Safari/iPhone remains unverified. Chromium/Firefox
cadence was unchanged by framing. This
does **not** prove arbitrary library compatibility, production performance, or
complete sandbox security.

## Measured results

Median milliseconds, fresh browser context per sample; same400×300 cube, DPR1,
one visible canvas,60 animation frames, no network/CPU throttle. Mac arm64,
Apple M5 Pro,18 logical cores. The fixed CDN fetch is completed once before
sampling; asset server is warm, browser HTTP context is cold.

| Engine (samples per shape) | Top-level first rendered pixel | One opaque iframe | Strict wrapper + inner | Median frame interval: top / one / wrapper |
|---|---:|---:|---:|---:|
| Chromium151.0.7922.34 (5) |79.9|82.8|83.6|8.3 /8.3 /8.3|
| Firefox153.0 (3) |51|47|51|8.34 /8.34 /8.34|
| WebKit26.5 (3) |21|22|25|17 /50 /50|

First-render time uses child `performance.timeOrigin + performance.now()` minus
the parent navigation's time origin. `readPixels` verifies a rendered pixel and
forces completion of that first render; this is not a screen-presentation/FCP
measurement. Parent wall-clock to60 frames is recorded separately in JSON.

In the initial fixed-order run, the top-level first sample pays browser/GPU warmup: observed maximum first-render
times were140.9ms Chromium,119ms Firefox,56ms WebKit. Fixed order was top→one→wrapper
within each repeat, with only3–5 samples. Therefore the small median differences
are directional evidence, not a reliable production overhead budget. P95 is
effectively the maximum with these sample sizes. Per-render JavaScript timing
mostly reads0 at timer granularity; that is **not zero GPU or CPU cost**. The
WebKit cadence regression was present in all3 samples; the earlier run's
different cadence cannot be used to dismiss it. These are headless-engine
measurements, not physical Safari/iPhone frame-rate promises.

### Controlled WebKit follow-up: real interaction

The script now cycles shape order each sample and records a second60-frame
render batch **after an actual browser button click inside the canvas's frame**,
before the separate pointer-drag test. Three samples per shape:

| Shape | First pixel median ms | Before click frame interval ms | After click frame interval ms |
|---|---:|---:|---:|
| Top-level |20|17|17|
| Single opaque iframe |22|50|17|
| Strict wrapper + inner |23|50|17|

Each sample had exactly the same before/after median for its shape. This is
direct evidence of an interaction-dependent scheduling difference, not proof
that a particular historical WebKit bug is its cause. It mitigates the concern
for the tested actively used viewer, **not for autoplay/passive animation**.
Product must accept this idle limitation or explicitly design around it. No
synthetic author-dispatched click was used. The Chromium/Firefox rows above are
the earlier fixed-order runs; their after-click variants were not rerun.

## What was actually run

The parent-side Node fixture downloads exactly this fixed public URL:

`https://cdn.jsdelivr.net/npm/three@0.160.1/build/three.min.js`

Redirects are refused, download has a15s deadline and2MB byte cap, and no caller
can select a URL. It is669,884 bytes, SHA256
`170c6789f43217c96b3170f4b42fafe135de7f7cd48497a4218f9757ee1d49fa`.
This deliberately old, known self-contained classic distribution is a
compatibility fixture, **not a recommendation to ship that version**. No bundler,
npm resolution, module-graph rewriting or external browser CDN requests occur.

Downloaded bytes are served from a disposable public GET-only loopback asset
origin, `http://127.0.0.1:7021`, under a content-hashed JS URL. The parent page is
`http://127.0.0.1:7020`. Successful data responses are public JSON fixtures with
`Access-Control-Allow-Origin: *`; negative fixtures deliberately omit that header.
The script uses native `fetch`, native `XMLHttpRequest`, and actual browser script
elements: no network API mocks or monkeypatches. Original known URLs are replaced
with explicit cached-asset URLs before executing the fixture; arbitrary code's
computed URLs are **not** transparently rewritten.

Each author frame uses `sandbox="allow-scripts"`, omitting `allow-same-origin`,
forms, popups, top-navigation, and downloads. Its document policy is:

```text
default-src 'none';
script-src 'unsafe-inline' http://127.0.0.1:7021;
connect-src http://127.0.0.1:7021;
style-src 'unsafe-inline';
img-src blob: data:;
frame-src 'none'; worker-src 'none';
form-action 'none'; base-uri 'none'
```

The parent allows frames on the local asset origin for the simple-child case;
the strict wrapper has the above `frame-src 'none'` policy and creates only its
inner srcdoc child. This exercises the same nested construction as the separate
navigation probe. Navigation attacks themselves belong to that probe, not this
performance result. The wrapper only constructs the child; it does not expose a
postMessage command surface for authors to inject more frames or destinations.

## Native loading / CORS outcomes

All outcomes below were asserted in all three engines and all layouts.

| Operation | Outcome | Meaning |
|---|---|---|
| Native GET fetch to cached JSON with ACAO:* |Success|Opaque child requests carry `Origin: null`; public CORS permits response reading.|
| Native GET XHR to same cached JSON |Success|No custom transport is required for public cached bytes.|
| Fetch/XHR without ACAO |Failure|Allowing the origin in CSP is insufficient for CORS-governed reads.|
| Classic script without `crossorigin`, no ACAO |Loads|Classic no-CORS script execution is allowed; do not claim every script needs CORS.|
| Classic script with `crossorigin="anonymous"`, no ACAO |Failure|Crossorigin opts the request into CORS.|
| Module script, no ACAO |Failure|Module scripts require CORS.|
| Fetch with `credentials: 'include'`, ACAO:* |Response unreadable|The request may still reach the server before CORS rejects reading; not an outbound-request firewall.|
| Direct original CDN fetch |Blocked|CSP permits only the local asset origin for connections.|
| Author reads parent document |SecurityError|Own DOM/canvas is available; parent DOM is not.|
| Own canvas rendered pixels + button/pointer rotations |Success|Canvas stays inside the visible child and is composed normally.|

The final script asserts cube-center red/green channels exceed60, distinguishing
the cube from the dark background. Recorded center pixel is128,128,255,255.

## Actual before-author-code fetch/XHR wrapper prototype

`iframe-assets-bridge.mjs` additionally implements the proposed compatibility
layer, rather than merely calling native APIs with manually rewritten URLs:

1. Trusted bootstrap runs first in the opaque child and captures native fetch/XHR.
2. The parent transfers a private MessagePort once, checking the exact child
   window; author replay of the bootstrap message cannot obtain another port.
3. Author code calls `fetch(originalFixedCdnUrl)` or asynchronous XHR GET against
   that original URL. The wrapper asks the parent to resolve the original URL.
4. The parent accepts only fixed-manifest URLs, GET, and `credentials:'omit'`,
   returning the already cached URL. It performs no arbitrary incoming-URL fetch.
5. The child performs the actual native GET to the public CORS asset URL.

All three engines passed: original-URL fetch, an explicit credentials-omit Request,
and asynchronous XHR returned the full669,884-byte cached bundle. POST, credentials,
headers, unknown URLs, XHR withCredentials and synchronous XHR were refused.
Bootstrap replay returned no extra port in all three engines.
Direct parent resolver tests also rejected forged POST/credential/unknown-URL
envelopes. Asset-server logs contain only declared GETs with `Origin:null`.
Unknown URLs appear in resolver refusal logs but never in actual network hits.

A **positive self-contained ESM** fixture was served with JS MIME type and ACAO:*;
native `import(cachedModuleUrl)` returned exported value42 in all three engines.
This proves positive module+CORS loading, not package dependency resolution.

This prototype deliberately is **not** a drop-in fetch/XHR replacement:

- Request objects require explicit `credentials:'omit'`; custom headers refused.
- Native response `url`/XHR `responseURL` name the cached URL, not the original.
- XHR open/readyState timing changes while asynchronous resolution occurs; headers,
  sync requests and credentialed modes are refused. Native timeout starts later.
- Full abort/progress/event-order/redirect/stream parity is not demonstrated.
- Installing wrappers before author code is useful routing, **not tamper-proof
  security**. CSP, fixed parent manifest checks and a public/read-only asset
  origin remain the actual boundaries; library-generated script/img/module URLs
  do not automatically pass through these fetch/XHR wrappers.

The asset origin must be public/read-only and have no account authority or
state-changing GETs. This fixture refuses non-GET requests. CORS, HttpOnly, and
opaque origins alone are not sufficient to make an authority-bearing asset host
safe. Private files, data-dependent permissions, credentialed asset access,
cache-key poisoning, malicious imported bytes, dependency provenance and asset
quota policy were not validated by this fixture.

## Compatibility limits

- Works here because the supplied library is already self-contained.
- Does not automatically resolve bare imports, relative module dependencies,
  computed URLs, `import.meta.url` asset paths, GLTF external resources or workers.
- Blob/data textures are permitted, but decoding/model-loader coverage is not
  part of this cube experiment (existing product GLB gate covers another path).
- No WebSockets, Service Workers, SharedArrayBuffer, cross-origin isolation,
  credentialed third-party APIs, arbitrary module graph, multiple-canvas scale,
  memory/CPU hard limits, physical-device accessibility or mobile thermal tests.
- Keeping `fetch`/XHR native preserves their normal browser semantics once URLs
  point at readable cached assets. It does not make every library's resource
  discovery work without author cooperation or a separately specified resolver.

## Reproduce / evidence

From the interaction-policy worktree:

```sh
node scripts/planning/iframe-assets-perf.mjs chromium 5
node scripts/planning/iframe-assets-perf.mjs firefox 3
node scripts/planning/iframe-assets-perf.mjs webkit 3
node scripts/planning/iframe-assets-bridge.mjs chromium
node scripts/planning/iframe-assets-bridge.mjs firefox
node scripts/planning/iframe-assets-bridge.mjs webkit
```

Ports7020/7021 (performance) and7022/7023 (bridge) must be free; all fixture
servers and browsers close at completion.
No product app, database, tokens, login, remote writes or artifact edits needed.
The only outside request is the fixed public CDN download.

Measured JSON records, including individual samples, request origins, bundle hash
and assertions:

- `/tmp/afbin-iframe-assets-chromium.json`
- `/tmp/afbin-iframe-assets-firefox.json`
- `/tmp/afbin-iframe-assets-webkit.json`
- `/tmp/afbin-iframe-assets-webkit-after-click.json`
- `/tmp/afbin-iframe-bridge-chromium.json`
- `/tmp/afbin-iframe-bridge-firefox.json`
- `/tmp/afbin-iframe-bridge-webkit.json`

All seven runs exited successfully. WebKit additionally reports expected access-control
denials through page-error events; these correspond to the deliberate negative
fetch/XHR/script tests, not failed scenes. No claim that BrowserOS or physical
devices were measured: these are explicitly reproducible Playwright fixtures.
