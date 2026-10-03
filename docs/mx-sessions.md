# Live browser sessions and `window.page`

A browser session drives a public artifact page through `window.page`, which
the island boot (`lib/islands/boot.ts`) installs on a top-level page that
declares data, while it reads. It reads and writes the page runtime's bindings
(`lib/islands/page-runtime.ts` `bindPage`, `exposePage`), the very Solid signals
the page's own `<Helmet>` script binds from `page`, as plain data: `get(name)` is
a Value's current value or a Query's (or table Value's) current rows, `set(name,
value)` writes a scalar Value (queries re-run), `ready(name)` a Query's next
settled rows, and `mutation(name)` an async function that waits for the page's
access check, resolves after commit and rejects with the server's message. An
undeclared name gives `undefined` (`set` and `ready` throw). Editing removes it
and reading again restores it. There is no cached read API and no subscription
API beside the signals.

The session service owns authentication scope, leases, execution receipts, and
script serialization. Each isolated worker owns an actual Playwright browser,
context, and pages across calls. The CLI submits async function bodies and polls
receipts. It prints recovery IDs before waiting. `context` is standard Playwright;
`pages` is a frozen map of stable page IDs; `output.image(bytes)` attaches PNG/JPEG.
Open artifacts with `await page.goto('/a/<id>')`, call `window.page` through
`page.evaluate()`, and use normal locators and screenshots. Independent page work
can use `Promise.all`. Source editing is not a session operation.

```
afbin sessions script new --input actions.js --json
afbin sessions script SESSION_ID --input next.js --json
afbin sessions status SESSION_ID --execution EXECUTION_ID --json
afbin sessions close SESSION_ID --json
```

```js
const page = await context.newPage();
await page.goto('/a/abc123');
await page.waitForFunction(() => Boolean(window.page));
await page.evaluate(() => { window.page.set('region', 'West'); });
const rows = await page.evaluate(() => window.page.ready('sales'));
await output.image(await page.screenshot());
return rows;
```

Session routes use `/api/browser-sessions`; existing remote terminal resources
under `/api/sessions` retain their contract. Credentials remain in the parent
broker. Workers have no network namespace access to the host, no host checkout,
and only private writable storage. The broker admits the configured app origin,
forwards the authenticated actor (revalidating its token on each app request), strips supplied credential headers, and bounds
request and response bodies. Canonical redirects are resolved by the broker (at most ten same-origin hops).
The broker fulfills the originally requested URL; the app may then update its displayed URL through client-side navigation.
Every hop revalidates the actor. Linux bubblewrap/user namespaces are required;
unsupported hosts fail closed. A delegated cgroup v2 subtree bounds every worker
to 1 GiB memory, 512 processes/threads, and one CPU. Set
`BROWSER__SESSION_CGROUP_ROOT` to that subtree (default `/sys/fs/cgroup/afbin-sessions`). Split services additionally configure
`BROWSER__SESSION_APP_URL`, `APP__PUBLIC_BASE_URL`, and `CONTRACT__ACTOR_SECRET`.

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

Both browser images include bubblewrap. Hosting must also permit user namespaces
and delegate the configured cgroup subtree; an ordinary container without those
permissions cannot run sessions. Unsupported deployments fail closed.

Isolation policy follows the [bubblewrap security guidance](https://github.com/containers/bubblewrap/blob/main/README.md#sandbox-security); namespace configuration and resource cgroups are separate boundaries.
