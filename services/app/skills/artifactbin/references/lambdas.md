---
name: lambdas
description: Execute server handlers in ordinary artifacts with afbin runs.
---
# Artifact server handlers

An ordinary published JSX artifact can carry one `<script type="server">` in its Helmet that default-exports an async function. Use the same sharing, Imports, Values, Queries and Mutations as a page. The function executes headlessly on the runner, not in the reader's browser. An optional untyped `<script>` (or `type="module"`) is a separate browser module; server source is excluded from the reader bundle. There is no separate `type: lambda` metadata.

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

`start` returns `{runId}` after admission, not completion. Poll `status` until `completed`, `failed`, `cancelled` or `interrupted`. Read `output` and `receipt`; a successful CLI call only means the request succeeded, not that the program completed successfully. The receipt records the terminal reason, timing and observed service requests/usage; unknown measurements are null. An empty events list is valid when the program emitted no events; use status and the receipt to confirm completion. Events are bounded JSON pages: pass `nextSequence` as `--after` and continue when `hasMore` is true. `afbin runs cancel <runId>` requests cancellation; poll status to observe cleanup.

`--request` is required: choose one stable ID per intended execution. After a timeout or lost response, retry with the SAME artifact, published version, input and request ID. Changed content with that ID is a conflict. Use a new ID only for an intentional new run. Omitted input is null; `--input -` reads JSON from stdin. Artifact IDs, same-server URLs and registered files are accepted; publish changes before running. The server pins the published source for execution. Existing permissions still apply to datasets and mutations.

Legacy Lambda artifacts with an untyped default-exporting script remain invocable for compatibility. Republish them with `type="server"` to remove their handler from the browser module. New artifacts should always mark server code explicitly. Use `afbin runs start` to invoke the published handler, `afbin runs status` to inspect its result, `afbin runs events` to replay output and `afbin runs cancel` to stop it. The server selects the published source, version and caller identity. Sharing the artifact does not grant execution without authentication or additional dataset permissions.

## Declared data in the program

Replace `abc123` with the dataset ID returned by `afbin push sales.csv --type dataset --access readwrite --json`. Its `rows` table in this example has `region`, `month` and `revenue` columns. Do not invent a table or columns: inspect the actual dataset first with `afbin query`.

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

These are Solid accessors, not `.value` properties. `monthly()` reads rows, `monthly.loading()` and `monthly.error()` expose state. Unlike a browser's seeded first paint, a runner may start before its queries finish: await `monthly.ready` before reading. Set a signal before awaiting the dependent query. Rejected queries and mutations throw; don't report success after catching and ignoring a failure.

The runner shares the page binding implementation; it does not expose `document`, `window`, Node `process`, filesystem, shell or arbitrary network `fetch`. Imports are restricted to `page` and `solid-js`; no dynamic imports, require, CDN modules or DOM libraries. Return JSON-serializable output. Run limits are enforced by the server. Browser-only scripts are not Lambdas merely because they publish successfully: execute the actual artifact and inspect its terminal status before claiming it works.

Test writes only against your authorized disposable data. A run executes with its caller's identity; sharing the artifact never grants extra dataset write permission. Keep credentials out of the program and input.

## Native programs and schedules

A saved native command is an artifact of type `program`, with a JSON definition:

```json
{"version":1,"command":["node","-e","console.log(process.env.ARTIFACTBIN_INPUT)"],"compute":{"vcpu":1,"memoryMiB":2048,"ttlSeconds":600}}
```

Programs run in the configured external runtime (Modal in the hosted deployment). Their persisted home is `/home/runner`; installed tools and image files live outside it. A program must finish before another invocation of the same named program can start. Input is JSON in `ARTIFACTBIN_INPUT`, limited to 8 KiB for command environment transport. Large state belongs in the database through AF, and program files/configuration that need to survive belong in the home directory. Definition `env` is non-secret configuration; authenticate interactively in the sandbox instead of publishing login credentials. Reading a shared program does not grant permission to execute it with another person's credentials: native execution is owner-only. Ordinary artifact server handlers continue to run in lightweight V8 isolates, without creating a Modal sandbox.

Scheduling uses the same HTTP API from the UI and npm CLI:

```sh
afbin schedule create --artifact <artifactId> --cron '*/5 * * * *' --timezone UTC --json
afbin schedule list --json
afbin schedule pause <scheduleId> --json
afbin schedule resume <scheduleId> --json
afbin schedule run <scheduleId> --json
afbin schedule history <scheduleId> --json
```

Use five-field cron expressions (one-minute resolution), with an explicit IANA timezone such as `America/New_York`. Schedules reference the live artifact; each new attempt loads its current published definition. They never select a fixed artifact version. An admitted execution retains the code it loaded so an uncertain submission can be retried with the same request identity. Missed automatic times coalesce into one occurrence, and a schedule does not overlap its own executions. Confirmed execution failures can retry with configured backoff and a maximum attempt count; the default is one attempt. Automatic retries and user programs must tolerate repeated side effects. A lost response is an admission retry, not permission to launch a second execution.

Every app instance runs the same timer, coordinated through SQL occurrence uniqueness and fenced dispatch leases. No external cron service is required. Pausing or deleting stops future and unsubmitted work; already submitted work is observed until completion. Use the Run cancellation API to stop an execution. History records occurrences, attempts, errors, run identities and terminal results.
