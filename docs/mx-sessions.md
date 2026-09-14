# Unified mx and live browser sessions

The runtime owns one five-method data capability: `describe`, `read`, `set`,
`mutate`, and `subscribe`. Both the public artifact page and managed iframe use
this implementation; the iframe adapter transports requests and coalesced
subscription packets over its existing MessagePort. It owns no cached read API.
Signals include scalar values, local tables, and query results. Only scalars can
be set; declared mutations own row writes. Mutation arguments apply to one call.

The session service owns authentication scope, leases, execution receipts, and
script serialization. Each isolated worker owns an actual Playwright browser,
context, and pages across calls. The CLI submits async function bodies and polls
receipts. It prints recovery IDs before waiting. `context` is standard Playwright;
`pages` is a frozen map of stable page IDs; `output.image(bytes)` attaches PNG/JPEG.
Open artifacts with `await page.goto('/a/<id>')`, call mx through
`page.evaluate()`, and use normal locators and screenshots. Independent page work
can use `Promise.all`. Source editing is not an mx operation.

```
afbin sessions script new --input actions.js --json
afbin sessions script SESSION_ID --input next.js --json
afbin sessions status SESSION_ID --execution EXECUTION_ID --json
afbin sessions close SESSION_ID --json
```

```js
const page = await context.newPage();
await page.goto('/a/abc123');
await page.waitForFunction(() => Boolean(window.mx));
const description = await page.evaluate(() => window.mx.describe());
await output.image(await page.screenshot());
return description;
```

Session routes use `/api/browser-sessions`; existing remote terminal resources
under `/api/sessions` retain their contract. Credentials remain in the parent
broker. Workers have no network namespace access to the host, no host checkout,
and only private writable storage. The broker admits the configured app origin,
forwards the authenticated actor (revalidating its token on each app request), strips supplied credential headers, and bounds
request and response bodies. Linux bubblewrap/user namespaces are required;
unsupported hosts fail closed. A delegated cgroup v2 subtree bounds every worker
to 1 GiB memory, 512 processes/threads, and one CPU. Set
`BROWSER__SESSION_CGROUP_ROOT` to that subtree (default `/sys/fs/cgroup/afbin-sessions`). Split services additionally configure
`BROWSER__SESSION_APP_URL`, `APP__PUBLIC_BASE_URL`, and `CONTRACT__ACTOR_SECRET`.

Current limits: two active browsers per service, eight pages per browser, sixteen
execution receipts per session, 30-minute idle leases, 64-KiB scripts, 8-MiB
outputs, 5-second Playwright actions, 10-second navigation, and a 20-second hard
script deadline. A hard deadline destroys the instance. Script errors preserve
pages; committed mutations are never rolled back or automatically replayed.
Page objects are retained in memory; arbitrary JS heaps are not serialized to disk.

## Verification

- Shared facade: focused behavioral tests cover detached reads, atomic validation,
  selected/coalesced subscriptions, stale lifetimes, pending/error/timeout reads,
  and mutation concurrency. These passed locally.
- Managed adapter: host backpressure and shipped/minified bootstrap tests passed;
  the subsequent bridge prototype-key test correction also passed.
- Session registry: owner separation, ID conflicts, receipt recovery, serialized
  execution, and close semantics passed a focused test.
- The Linux browser gate exercises multi-artifact Playwright execution, the real
  CLI, iframe interactions, screenshots, receipt recovery, owner separation,
  filesystem/network isolation, and hard termination. These core flows passed
  in CI; the subsequent agent-fixture assertions exposed test defects, now fixed.
- The same gate replays saved pi/Fireworks iframe and session submissions against
  the shipped runtime. Replay is separate from a fresh model trial; prior design
  trials used local pi with Fireworks DeepSeek, not local model inference.
- Focused regressions cover token revocation, bounded asset-request queueing, and
  closing a session during worker startup. Each exposed its defect before the fix.
- [PR checks](https://github.com/minusxai/artifactbin/pull/148/checks) are the
  authoritative results for the latest revision, including agent-fixture replay.
  The broad local suite was deferred under the repository test budget.
- Both browser images include bubblewrap. Hosting must also permit user namespaces
  and delegate the configured cgroup subtree; an ordinary container without those
  permissions cannot run sessions. Unsupported deployments fail closed.

Isolation policy follows the [bubblewrap security guidance](https://github.com/containers/bubblewrap/blob/main/README.md#sandbox-security); namespace configuration and resource cgroups are separate boundaries.
