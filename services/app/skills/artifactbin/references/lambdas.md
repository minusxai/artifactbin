---
name: lambdas
description: Execute published server handlers through HTTP runs or afbin runs.
---
# Artifact server handlers

Published JSX can carry one `<script type="server">` in Helmet, default-exporting an async function. It executes headlessly, excluded from the browser bundle. Imports, Values, Queries, Mutations and sharing work as for a page; there is no `type: lambda` metadata. An untyped or module script is separate browser code.

## Create, publish, run

Save `hello.jsx`:

```jsx
---
title: Greeting Lambda
visibility: private
---
<Helmet>
  <script type="server">{`
export default async function(input) {
  console.log('Greeting requested');
  return { greeting: 'Hello, ' + (input?.name ?? 'world') };
}
`}</script>
</Helmet>
<main><h1>Greeting Lambda</h1><p>Returns a greeting for the supplied name.</p></main>
```

```sh
afbin push hello.jsx --json
# Write input.json containing {"name":"Ada"}, then:
afbin runs start hello.jsx --input input.json --request greeting-1 --json
afbin runs status <runId> --json
afbin runs events <runId> --after 0 --json
```

`--request` supplies the stable request ID described below; `--input -` reads JSON from stdin and omitted input is null. IDs, same-server URLs and registered files are accepted. Publish changes before running. `afbin runs cancel <runId>` requests cancellation; poll status for termination. Both transports share the lifecycle and permissions below.

Legacy untyped default-exporting scripts remain invocable. Republish with `type="server"` to exclude handler source from the browser module; always mark new server handlers explicitly.

## Run through HTTP

Create JSX through `POST /api/artifacts` ([HTTP authoring](http-authoring.md)), then run its returned ID. Use an email-authenticated bearer ([HTTP API](http-api.md)); no CLI is needed.

```js
// BEGIN HTTP RUN
const headers = {'Content-Type':'application/json', Authorization:'Bearer ' + accessToken};
async function runRequest(path, method = 'GET', body) {
  const response = await fetch(base + path, {method, headers,
    ...(body === undefined ? {} : {body:JSON.stringify(body)})});
  if (!response.ok) throw Error(await response.text());
  return response.json();
}
const {runId} = await runRequest('/api/artifacts/' + artifactId + '/runs', 'POST', {
  requestId:'greeting-1', input:{name:'Ada'}
});
const status = await runRequest('/api/runs/' + runId);
const page = await runRequest('/api/runs/' + runId + '/events?after=0&limit=100');
// Call only when this execution is no longer wanted.
async function cancelRun() {
  return runRequest('/api/runs/' + runId + '/cancel', 'POST', {});
}
// END HTTP RUN
```

Start returns HTTP 202 with `{runId}` on admission, not completion. Omit optional cancellation for normal execution; poll status until `completed`, `failed`, `cancelled` or `interrupted`, then inspect `output` and `receipt`. Receipts record terminal reason, timing and observed requests/usage; unknown measurements are null. Events return `{events,nextSequence,hasMore}`: continue with `after=nextSequence` while `hasMore`. Empty events are valid. Cancellation returns `{ok:true}` on request; poll for actual termination.

`requestId` is required, nonempty, at most 128 characters. Retry uncertain admission with the SAME artifact, input, request ID and unchanged published version. Changed execution content with that ID returns `start_conflict`; reconcile instead of launching another run. New intentional executions need new IDs. The server pins published source/version and caller identity: do not supply `userId`, `program` or an invented version fence. Omitted input is null. Native `program` JSON input is limited to 8192 UTF-8 bytes; ordinary handlers use configured runner limits.

Authentication and artifact read permission are required. Native programs are owner-only. Status/events/cancel belong to the caller who started the run. Sharing grants neither authentication nor extra dataset permissions. Request identity protects admission retries, not arbitrary handler side effects. Scheduler dispatch leases are internal server fences, not client fields.

## Declared data in the program

Replace `abc123` with your dataset ID (CLI: `afbin push sales.csv --type dataset --access readwrite --json`). Inspect actual tables/columns first. This example assumes `rows(region,month,revenue)`.

```jsx
<Helmet>
  <Import name="sales" src="ref:abc123" />
  <Value name="region" type="string" default="west" />
  <Query name="monthly">{`SELECT month, SUM(revenue) AS total FROM sales.rows WHERE region = $region GROUP BY month`}</Query>
  <Mutation name="rename">{`UPDATE sales.rows SET region = $to WHERE region = $from`}</Mutation>
  <script type="server">{`
import { signal, query, mutation } from 'page';
const [region, setRegion] = signal('$region');
const monthly = query('$monthly');
const rename = mutation('$rename');

export default async function(input) {
  setRegion(input?.region ?? 'west');
  await monthly.ready;
  const before = monthly();
  // An explicit mutation commits before resolving; permission failures throw.
  if (input?.renameTo) {
    await rename({ from: region(), to: input.renameTo });
    setRegion(input.renameTo);
    await monthly.ready;
  }
  return { before, rows: monthly(), loading: monthly.loading() };
}
`}</script>
</Helmet>
<main><h1>Regional sales operation</h1></main>
```

Bindings are Solid accessors, not `.value`: read `monthly()`, `monthly.loading()` and `monthly.error()`. Set signals before awaiting dependent queries' `.ready`. Rejected queries/mutations throw; do not swallow failures and report success.

The shared page runtime exposes no document, window, Node process, filesystem, shell or arbitrary fetch. Only `page` and `solid-js` imports are allowed; no dynamic imports, require, CDNs or DOM libraries. Return JSON-serializable output within server limits. Execute and inspect terminal status before claiming success. Test writes on authorized disposable data; caller identity controls dataset permissions. Keep credentials out of source/input.

## Native programs and schedules

A saved native command is an artifact of type `program`, with a JSON definition:

```json
{"version":1,"command":["node","-e","console.log(process.env.ARTIFACTBIN_INPUT)"],"compute":{"vcpu":1,"memoryMiB":2048,"ttlSeconds":600}}
```

Native programs run in the configured external runtime (Modal when hosted), with persisted home `/home/runner`; tools/images live outside it. Same named programs cannot overlap. Input arrives as JSON in `ARTIFACTBIN_INPUT` (8 KiB limit). Keep large state in AF's database and persistent files in home. Definition `env` is non-secret configuration; sign in interactively rather than publish credentials. Native execution is owner-only, even for shared artifacts. Ordinary handlers use lightweight V8 isolates, without Modal sandboxes.

Scheduling uses the same HTTP API from the UI and npm CLI:

```sh
afbin schedule create --artifact <artifactId> --cron '*/5 * * * *' --timezone UTC --json
afbin schedule list --json
afbin schedule pause <scheduleId> --json
afbin schedule resume <scheduleId> --json
afbin schedule run <scheduleId> --json
afbin schedule history <scheduleId> --json
```

Use five-field cron (one-minute resolution) with an IANA timezone. Schedules load current published code per attempt, not a fixed version; admitted executions retain their loaded code. Retry uncertain submission with the same request identity. Missed times coalesce and schedules do not overlap their own executions. Failure retries use configured backoff/maximum attempts (default one); handlers must tolerate repeated side effects.

App replicas coordinate timers through SQL uniqueness and fenced dispatch leases; no external cron is needed. Pause/delete stops future and unsubmitted work; submitted work remains observed until completion. Cancel through the Run API. History records occurrences, attempts, errors, run IDs and results. Identity conflicts pause scheduling until resumed. Bounded dispatch keeps slow submissions from blocking unrelated schedules.
