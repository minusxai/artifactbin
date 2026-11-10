# Live browser sessions

A browser session drives native HTML through ordinary Playwright locators and
page evaluation. There is no platform `window.page` binding API. Use the page
DOM or its explicitly authored interfaces to inspect and interact with it.

The session service owns authentication scope, leases, execution receipts, and
script serialization. Each isolated worker owns an actual Playwright browser,
context, and pages across calls. Clients submit async function bodies and poll
receipts, keeping the recovery IDs before waiting. `context` is standard Playwright;
`pages` is a frozen map of stable page IDs; `output.image(bytes)` attaches PNG/JPEG.
Open artifacts with `await page.goto('/a/<id>')` and use normal locators,
page evaluation and screenshots. Independent page work
can use `Promise.all`. Source editing is not a session operation.

Clients use the HTTP API `POST /api/browser-sessions`, with ops `script` (a new
session, or an existing session ID with the next function body), `status`
(a session's execution receipt) and `close`. The served `/llms/html-operations` guide documents the calls
and the session limits; `SESSION_LIMITS` in `services/contracts/src/browser-sessions.ts` holds them.

```js
const page = await context.newPage();
await page.goto('/a/abc123');
await page.getByRole('heading', {name: 'Report'}).waitFor();
const text = await page.locator('body').innerText();
await output.image(await page.screenshot());
return {text};
```

Session routes use `/api/browser-sessions`. Credentials remain in the parent
broker. Workers have no network namespace access to the host, no host checkout,
and only private writable storage. The broker admits the configured app origin and, under
`APP__PAGES_HOST`, the document origins the app page frames (`<hex id>.<pages host>`),
forwards the authenticated actor (revalidating its token on each app request), strips supplied credential headers, and bounds
request and response bodies. Canonical redirects are resolved by the broker (at most ten same-origin hops).
The broker fulfills the originally requested URL; the app may then update its displayed URL through client-side navigation.
The frame's first URL is the document's own origin, which spends the frame's one-time ticket and sets its own
host-only pages cookie in the response that serves the document. That cookie is held by the broker per document host
and attached only to requests for that host; the worker's browser never holds it. On a page
that frames a document, `page.evaluate`, `waitForFunction`, locators and selector actions resolve in the document
frame after it has loaded; `page.url()`, `goto` and `screenshot` stay the app page's.

Google Fonts is the only external resource exception for scripted sessions. The broker relays GETs to the shared
`fonts.googleapis.com` and `fonts.gstatic.com` origins to an app-only `/api/internal` route; the app permits only the
CSS stylesheet endpoints and Google font file paths, then fetches them with its existing DNS-pinned, redirect-checked,
size- and time-bounded transport. The worker's cookies, authorization, actor and user agent never leave the broker.
Other third-party requests remain refused, and the browser service keeps no public egress network.

Every hop revalidates the actor. Linux bubblewrap/user namespaces are required;
unsupported hosts fail closed. A delegated cgroup v2 subtree bounds every worker
to 1 GiB memory, 512 processes/threads, and one CPU. Set
`BROWSER__SESSION_CGROUP_ROOT` to that subtree (default `/sys/fs/cgroup/afbin-sessions`). Split services additionally configure
`BROWSER__SESSION_APP_URL`, `APP__PUBLIC_BASE_URL`, `APP__PAGES_HOST`, and `CONTRACT__ACTOR_SECRET`.

`BROWSER__SESSION_MAX` (default 2) caps the live browsers one browser service holds, shared by
every owner; `BROWSER__SESSION_MAX_PER_ACTOR` (default 2) caps how many of them one credential
may hold, so one agent cannot take every slot. Both are whole numbers of at least 1, read by the
process that runs the sessions: the browser service when it is split out, the app otherwise.
A create over the server's cap is refused with `SESSION_CAPACITY`, over the credential's with
`SESSION_ACTOR_CAPACITY`; neither creates anything, and both list the caller's own open sessions.
Raising them does not change a session's own resources: every browser still gets the cgroup
bounds above, so size the host for `BROWSER__SESSION_MAX` of them.

Current limits: `BROWSER__SESSION_MAX` active browsers per service, at most
`BROWSER__SESSION_MAX_PER_ACTOR` per credential, eight pages per browser, sixteen
execution receipts per session, 30-minute idle leases, 64-KiB scripts, 8-MiB
outputs, 5-second Playwright actions, 10-second navigation, and a 20-second hard
script deadline. A hard deadline destroys the instance. Script errors preserve
pages; committed mutations are never rolled back or automatically replayed.
Page objects are retained in memory; arbitrary JS heaps are not serialized to disk.

## Hosting requirements

A host that runs sessions needs bubblewrap installed, user namespaces permitted and the configured cgroup
subtree delegated; an ordinary container without those permissions cannot run sessions, and an unsupported
deployment fails closed. On a development host such as macOS, `BROWSER__SANDBOX=none` runs the session worker
as a plain child process with no containment; it is refused in production.

Isolation policy follows the [bubblewrap security guidance](https://github.com/containers/bubblewrap/blob/main/README.md#sandbox-security); namespace configuration and resource cgroups are separate boundaries.
