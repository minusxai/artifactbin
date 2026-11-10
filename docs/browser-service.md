# The browser service

A Chromium that renders a URL to an image and, for diagrams, hands back the SVG a page drew. `BrowserService` in
`services/contracts/src/browser.ts` is the interface and carries the request and answer types. `GET /health` is
the one GET; every other route is a POST. This page holds what the types do not say. Live scripted sessions are
in [browser sessions](browser-sessions.md); deploying export uploads to S3 is in [operations](operations.md).

## Render

`POST /render` takes a `RenderRequest`. The `url` carries its own short-lived key: the service holds no
credentials and sets no cookies. `sameOriginOnly` aborts every other origin; `allowedOrigins` adds exact extra
origins for generic callers; `waitForMountsMs` waits, at most that long, until every script component mount
(`[data-mx-mount]`) under the selector has been rendered by the page's script rather than showing its server
fallback (the cap is not a failure). Both render and upload also wait until chart elements marked
`data-mx-chart-state="pending"` settle; a readiness timeout is a failure, never cacheable bytes.

App exports set `sameOriginOnly` and `assetOrigin`, never a broad exception: a page's explicitly admitted script
origins become `allowedOrigins` with a mount wait (`scriptRenderAllowance` in
`services/app/lib/export/script-origins.ts`), and a render without admitted origins gets no extra allowance.

**Asset origin.** The page loads through its internal render URL. Requests to `assetOrigin` keep that URL in
Chromium, but only public byte GET and HEAD routes admitted by `isPublicAssetRequest` are fetched, by the
renderer, from the render URL's internal origin. A fixed `Host` derived only from `assetOrigin` selects the
public-byte middleware, public-ref ACLs included. No browser request headers, viewer credentials or export keys
are forwarded; no redirect is followed, even internally; a failure never falls back to the public hostname.
Asset responses keep public serving's CORS, nosniff and sandbox policy, with cookie and redirect metadata
removed, are bounded to 64 MiB decoded and 15 seconds (or the shorter render timeout), and are aborted when the
render closes. Context-wide interception and blocked service workers stop worker or popup routing around it. So
the browser container can stay on an internal-only network: no public DNS, TLS connection to the asset host or
outbound network is needed for asset bytes. This is cached-byte transport, never an arbitrary URL fetch proxy.

**Answer.** The image (`image/png` or `image/jpeg`), or a JSON verdict: `navigation` (the page could not be
reached or loaded; callers do not retry), `no_slide` with `slides` (fewer slides than asked), `unavailable` (no
browser) or `failed` (anything else, the one callers may retry once).

**Capture modes.** `full` shoots the selector's element, however tall. `{ slide: n }` shoots the n-th
`[data-af-slide]` inside it, 1-based, hiding generated `[data-af-deck-chrome]` navigation during the shot.
`card` is a clip at the selector's top: the viewport's height by the surface's width (capped at the viewport),
measured, the viewport grown by the surface's offset so the clip is not truncated, then measured again; it is a
named mode because that happens inside one page load. `{ card }` captures a locked-ratio source rectangle and
scales it to the viewport without relayout. `preview` captures a bounded low-density overview.

Renders are stateless: one page per request, closed after, serialised inside the service. The URL must be
reachable from the service's network: a host that network resolves to the app, not 127.0.0.1, and never a bare
host Chrome canonicalises into a real TLD (`app` becomes `.app`, HSTS-preloaded).

## Render and upload

`POST /render-upload` takes a render request and an upload target (signed URL and content type) and answers
image metadata or the usual verdict. The signed URL never enters the page, logs or database. Uploads are
bounded, follow no redirects and may travel through a gateway that admits only the configured storage origin and
export prefix. A service without the capability answers `upload_unavailable`, and the app then persists through
the byte transport, so mixed-version rollouts keep working; a failed upload attempt does not switch transports.

## Harvest

`POST /harvest` loads the page exactly as a render does (the same origin admission, blocked service workers,
readiness waits, deadline and queue) and answers JSON instead of pixels: for each of one to three fresh loads, the
SVG text of every element under `selector` matching `collect` whose `<img>` holds an `image/svg+xml` `data:` URL,
with that element's own `data-*` attributes. Repeated loads tell a reproducible drawing from a random one.
Answers are bounded by `SVG_HARVEST_LIMITS` (over a bound is `failed`). The service returns text and never
interprets it: the app sanitises and stores what it keeps. A service without the operation answers `503
harvest_unavailable`, and `browserClient` maps an older service's 404 to the same verdict, so a mixed-version
rollout harvests nothing and readers keep drawing with the engine.

## Sessions

`POST /sessions` is the one stateful surface: a session request (`script`, `status` or `close`) against a
persistent isolated session whose worker keeps its browser, context and pages across calls. It answers `503
sessions_unavailable` when the composition supplied no sessions implementation. Leases, receipts and script
serialisation are in `services/browser/src/sessions.ts`.

Scripted sessions carry server-sent events only for the platform's catch-up streams (`/a/ID/events`,
`/api/my/people/events` and `/api/artifacts/ID/regions/stream`, listed in
`services/browser/src/session-process.ts`), as finite real response segments over the credential-blind IPC
bridge; other event streams are refused visibly. Each segment waits at least 250 ms and flushes only at a
complete frame boundary; a stream with no boundary after 1.5 seconds fails visibly. Bytes, event names, IDs,
retry fields and keepalives are preserved within the response byte cap, and the upstream subscription is
cancelled at the boundary, on refusal or on close. A supplied `Last-Event-ID` is forwarded, but Chromium's
intercepted native reconnects do not expose it; the platform's streams catch up from a cursor or the current head
instead, so live updates stay observable across the reconnect gap. This is not an unlimited streaming tunnel.

## Entry points and conformance

`@artifactbin/browser` (`services/browser/src/index.ts`) is the contract, the client and the server shell, with
no Playwright. `@artifactbin/browser/local` (`services/browser/src/local.ts`) is Chromium and the only entry that
loads Playwright: one browser, launched on first use, closed after a minute idle, renders serialised.

`services/browser/__tests__/contract.test.ts` and `services/browser/__tests__/internal-assets.test.ts` run over
the local service and over its HTTP client and shell, with real Chromium;
`services/browser/__tests__/internal-assets-boundary.test.ts` checks transport refusal and cancellation, and
`services/app/server/__tests__/public-assets-host.test.ts` exercises the app's real middleware.
