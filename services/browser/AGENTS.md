# The browser service

A Chromium that renders a URL to an image (`/render`, `/render-upload`), hands back the SVG a page drew
(`/harvest`), says what went wrong in a page (`/inspect`: failed components, exceptions, failed requests, unreadable text, overflow when asked) and runs persistent isolated scripted sessions (`/sessions`). `BrowserService` and the session types
in `services/contracts/src` are the wire; `src/index.ts` is the client and the server shell, `src/local.ts`
Chromium, `src/sessions.ts` and the `session-*` files the sessions, `src/upload-gateway-server.ts` the S3 gateway.

## Rules
- Only `src/local.ts` loads Playwright, and only a composition root imports it; the package root never does.
- The service holds no credentials and sets no cookies: a render URL carries its own short-lived key, and a
  signed upload URL never enters the page, a log or the database. Uploads follow no redirect.
- The asset origin is cached-byte transport, never a fetch proxy: only GET and HEAD that `isPublicAssetRequest`
  admits, fetched from the render URL's internal origin with a fixed `Host`; no browser header, viewer credential
  or export key is forwarded, no redirect is followed and nothing falls back to the public hostname.
- Answers are the contract: an image, or a verdict (`navigation` is never retried, `failed` may be retried once,
  `no_slide`, `unavailable`). A readiness timeout is a failure, never cacheable bytes.
- A new operation must survive mixed-version rollouts: a service without it answers 503 `<op>_unavailable`,
  `browserClient` maps an older service's 404 to that same verdict, and the app falls back
  (`upload_unavailable` to the byte transport, `harvest_unavailable` to drawing with the engine).
- `/inspect`'s `internalOrigin` forwards only GET and HEAD of the page's own and allowed origins, by their own Host,
  with no browser header, credential, cookie or redirect: never widen it into a proxy.
- Sessions keep credentials in the parent broker: the worker never holds the pages cookie
  (`session-origins.ts`), the broker admits only the app's origin and document origins, strips supplied
  credential headers, revalidates the actor on every app request and bounds bodies. Google Fonts is the one
  outside exception, relayed through the app. Event streams pass only for `CATCH_UP_STREAMS`
  (`session-process.ts`), as finite segments.
- Session isolation needs Linux bubblewrap, user namespaces and a delegated cgroup v2 subtree, and fails closed
  without them. `BROWSER__SANDBOX=none` (no containment at all) stays refused under `NODE_ENV=production`;
  never widen where it applies. Limits live in `SESSION_LIMITS` and the `BROWSER__SESSION_*` settings: never
  restate a number.
- A render URL must resolve on the service's network to the app: never 127.0.0.1, never a bare host Chrome
  makes a TLD (`app` becomes the HSTS-preloaded `.app`).
- A render reaches the network only through its own proxy (`src/egress.ts`): its origin and `allowedOrigins`, none
  with `internalOrigin`. Never launch without `EGRESS_ARGS`, the refuse-all proxy and `chromiumEnv`.
- Exports and checks have a browser each; checks are admitted by `src/check-admission.ts`, renderers held to
  `src/render-limits.ts`. `BROWSER__RENDER_SANDBOX=chromium` refuses to start unsandboxed.

## Checks
- Egress, lanes, limits, sandbox: `egress.test.ts`, `render-lanes.test.ts`, `check-admission.test.ts`.
- `npm test -- --files services/browser/__tests__/contract.test.ts services/browser/__tests__/internal-assets.test.ts services/browser/__tests__/internal-assets-boundary.test.ts services/app/server/__tests__/public-assets-host.test.ts services/browser/__tests__/upload.test.ts`
- Sessions: `services/browser/__tests__/sessions.test.ts`, `session-process.test.ts`, `session-worker.test.ts`.
