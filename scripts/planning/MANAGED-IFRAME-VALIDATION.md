# Managed iframe planning validation

September 7, 2026. Planning probes, not a product implementation or release sign-off.

## Decision under test

Keep the artifact top-level. Compile a managed `Iframe`'s HTML/CSS/scripts into
an opaque inner `srcdoc` frame. A separate opaque outer frame runs only our
bootstrap, with `frame-src 'none'`; the trusted `i.` controls frame is its sibling.
Neither author realm gets `allow-same-origin`, forms, popups or top-navigation.
Only our runtime creates the wrapper and transfers the private state/asset port.

Authors may declare third-party CDN URLs for self-contained browser bundles.
Extend the existing guarded import/cache/rewrite pipeline, not a Three.js registry
or recursive bundler. Scripts and supported assets load from a public, read-only
asset origin. Ignore cookies/auth there; reject write methods, arbitrary proxy
routes and redirects. Importing upstream must never forward viewer credentials.
Private assets require a separate ACL-preserving delivery path, not this cache.

Asset fetch/XHR wrappers are convenience adapters for anonymous asynchronous GET,
not arbitrary API virtualization or a security boundary. CSP must still block
bypasses; asset-serving endpoints must be harmless even if a request reaches them.
Signal reads/writes, named subscriptions and declared mutations use the existing
bounded capability bridge; asset resolution must inherit its lifecycle, payload,
in-flight and rate limits rather than copying an unbounded prototype handler.

## Navigation: reproducible negative and positive controls

Run `node scripts/planning/author-navigation.mjs chromium` (also firefox/webkit).
The script uses disposable loopback origins, requires author execution before
counting requests, and asserts actual server hits rather than relying on browser
console errors or an inaccessible response. The allowed target stands in for `i.`.

Each engine exercises 18 attempts in three layouts: parent permits the target;
parent denies it; parent permits it but an intermediate wrapper denies frames.
Location assignment/replacement, links, meta refresh and a real-click self
navigation are positive controls: the simple frame really requests the target.
The wrapper must prevent those requests. Other cases cover top/parent navigation,
popups, forms, nested frames, CSP element removal, document replacement,
data/blob navigation, a fresh realm's fetch, and actual-click top/parent/popups.

Final run: Chromium, Firefox and WebKit each passed all 54 cases (162 total).
Each engine recorded five successful positive-control requests in the simple
allowed-host layout and zero target requests for all 18 strict-wrapper attempts.
Logs: `/tmp/afbin-navigation-final-{chromium,firefox,webkit}.json`.

The child's own `connect-src 'none'` does NOT prevent self-navigation. Its own
`frame-src` is not a replacement for the embedding parent's navigation policy.
Refusing the resulting trusted page with `frame-ancestors` is too late to prevent
the initial request. This is why the extra bootstrap-only wrapper exists.

## Asset and performance probes

See `iframe-assets-perf.mjs`, `iframe-assets-bridge.mjs` and
`IFRAME-ASSETS-PERF.md` for the fixed CDN bundle, hashes, browser versions,
positive WebGL pixels, real interactions, CORS checks and GET-wrapper tests.
No animation pixels cross the bridge: the browser composites the inner canvas.

WebKit's pre-interaction animation penalty is MEASURED, not resolved by nesting.
A controlled cycled-order rerun (three samples per shape) measured median frame
intervals of 17ms top-level and 50ms in both opaque layouts. After an actual
in-frame button click, all three layouts measured 17ms. This is consistent with
WebKit's documented cross-origin animation throttling, not proof that every
Safari/device behaves identically: https://bugs.webkit.org/show_bug.cgi?id=170534 .
The passive/autoplay performance limit must be disclosed; do not claim top-level
frame-rate parity or weaken isolation to evade browser power-saving policies.

Independent reviewer rerun reproduced 17ms top-level versus 50ms in either frame
before interaction and 17ms in all shapes afterward, each across three samples.
First-render medians were 19/22/26ms (top/single/nested), a small synthetic scene
with already-imported assets, not production loading or a complex ocean benchmark.

Reviewer-added default Request and already-cached URL cases initially failed the
asset adapter. Normalizing same-origin to omit and accepting exact cached aliases
fixed both without permitting credentials or arbitrary URLs. All three engines
were rerun; this is still a bounded GET adapter, not a full XHR implementation.

The previously requested no-consent/anonymous-live policy is independently
reviewed at 1f7a796: full suite 6,207 passed, one optional skip, validate/build pass,
and the real trusted-controls flow passes with anonymous live disabled. Deliberate
policy fault produced anonymous HTTP200 instead of204; restored code passed all
three focused contracts. An initial suite run lacked a generated runtime manifest;
after a completed build, the full rerun passed. No parallel builds during rerun.

## What this does not prove

- Integration of the proposed nested markup compiler/asset bridge with the app.
- Arbitrary library compatibility, full fetch/XHR semantics or module graphs.
- Physical Safari/iPhone performance, mobile keyboard or assistive technology.
- A hard CPU/GPU/memory quota, zero covert channels, or protection against all
  browser implementation vulnerabilities. Scripts may invoke permitted mutations
  automatically; origin isolation is not user consent.
- Staging HTTPS/cookie/CDN cutover, private-asset handling and safe rollout.

Do not weaken sandbox/origin protections to obtain a better performance number.
Keep the PR draft until integrated negative tests and the open rollout gates pass.
