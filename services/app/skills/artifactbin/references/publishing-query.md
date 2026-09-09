---
name: publishing-query
description: >-
  Optional query-result checks: routes and access.
---
## Read first

A successful save validates markup and SQL with default values. It does not
prove that a chart answers the intended question or a caption states the right
period. Inspect an export and the actual values when useful; direct query calls
are optional, not an extra publishing requirement.

Stored documents run their **declared Query names**, not arbitrary SQL. The route
belongs to the **document ID**, not its dataset. There is no
`/api/artifacts/<id>/query` route.

For a **public or unlisted document**, this anonymous GET returns just the named
query. Replace both placeholders with the published document ID and Query name:

```sh
curl --fail-with-body --get '[[ base ]]/a/<documentId>/query' \
  --data-urlencode 'q={"only":["sales"]}'
```

The response has `tables.sales.rows` and `errors`. Check both: HTTP 200 can carry
query execution errors. Prove one request works before looping. A 404 calls for
checking the documented route, method and access, not trying more dataset IDs.

The request object accepts `only` (array of declared names), `values` (named
scalar inputs), `page` (a result window), and `localTables` (local table state).
Omitting `only` runs all declared queries. `name`, `query`, `sql` and `source`
are not request fields.

## Private documents and drafts

- `GET /a/<documentId>/query?q=<JSON>` always uses anonymous read access; adding
  a bearer does not make a private document readable here.
- `POST /a/<documentId>/query` takes the same object as JSON and uses the
  reader's session. This is the signed-in page's transport, not a bearer API.
- For an agent checking a draft or private markup with its bearer, use
  `POST [[ base ]]/api/query` with `Authorization: Bearer mx_...`,
  `Content-Type: application/json`, and
  `{"markup":"<the document JSX>","only":["sales"]}`. Queries access datasets
  under that authenticated actor. Nothing is saved.

Declare SQL inside `<Query>` in markup; see [data grammar](markup-data.md).
For latest-row inline numbers, order that Query descending and limit to one row,
then use `agg="first"`. `Number` has no `agg="last"`.
