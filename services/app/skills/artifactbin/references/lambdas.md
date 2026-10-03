---
name: lambdas
description: Create, execute and inspect headless Lambda artifacts with afbin runs.
---
# Lambda artifacts

A Lambda is a published JSX artifact whose Helmet script default-exports an async function. Use the same sharing, Imports, Values, Queries and Mutations as a page. The function executes headlessly on the runner, not in the reader's browser. There is no separate `type: lambda` metadata.

## Create, publish, run

Save `hello.jsx`:

```jsx
---
title: Greeting Lambda
visibility: private
---
<Helmet>
  <script>{`
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

## Declared data in the program

Replace `abc123` with the dataset ID returned by `afbin push sales.csv --type dataset --access readwrite --json`. Its `rows` table in this example has `region`, `month` and `revenue` columns. Do not invent a table or columns: inspect the actual dataset first with `afbin query`.

```jsx
<Helmet>
  <Import name="sales" src="ref:abc123" />
  <Value name="region" type="string" default="west" />
  <Query name="monthly">{`SELECT month, SUM(revenue) AS total FROM sales.rows WHERE region = $region GROUP BY month`}</Query>
  <Mutation name="rename">{`UPDATE sales.rows SET region = $to WHERE region = $from`}</Mutation>
  <script>{`
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
