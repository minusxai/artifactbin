# The browser service contract

A Chromium that renders a URL to an image. `@artifactbin/contracts` `BrowserService` is the interface; this file is the wire.

`GET /health` answers `200 {"ok":true}` — the Docker HEALTHCHECK and the compose `depends_on` condition; the one GET, every other route POST-only.

`POST /render` with a `RenderRequest`:
`url` (the page, carrying its own short-lived key — the service holds no credentials and sets no cookies) ·
`format` `png|jpg` (+ `quality`) · `viewport` · `selector` (the element to shoot) · `capture` `"full" | "card" | "preview" | { card: { x, y, width } } | { slide: n }` ·
`sameOriginOnly` (abort every other origin) · `injectCss` · `settleMs` · `timeoutMs`.

Answer: the image with `Content-Type: image/png|image/jpeg`, or a JSON verdict —
`{ ok:false, reason:"navigation" }` the page could not be reached or loaded (not retried by callers);
`{ ok:false, reason:"no_slide", slides:n }` fewer slides than asked (the count is the answer);
`{ ok:false, reason:"unavailable" }` no browser; `{ ok:false, reason:"failed" }` anything else (the one callers may retry once).

The capture modes: `full` screenshots the SELECTOR's element, however tall; `{ slide: n }` shoots the
n-th `[data-mx-slide]` inside it, 1-based; `card` is a CLIP of the page at the selector's top — the viewport's
height by the surface's width (capped at the viewport), measured, the viewport grown by the surface's offset so
the clip is not truncated, then measured again. `{ card }` instead captures a locked-ratio source rectangle and
scales it to the requested viewport without relayout. `preview` captures a bounded low-density overview. `card` is
a named MODE and not a client recipe because that dance happens inside one page load.

Stateless: one page per request, closed after. Renders are serialised inside the service. The URL must be reachable
FROM THE SERVICE'S NETWORK — behind compose that is the app's service name, not 127.0.0.1, and never a bare host
that Chrome canonicalises into a real TLD (`app` → `.app`, HSTS-preloaded). Private network only.

Entry points: `@artifactbin/browser` is the contract, the client and the server shell (no Playwright); `./local`
is the Chromium and the ONLY entry that loads Playwright — one browser, launched on first use, closed after a
minute idle, renders serialised.

Conformance: `__tests__/contract.test.ts` runs one suite over `createBrowser()` and over `browserClient(serveBrowser(createBrowser()))`, with a real Chromium.
