---
name: publishing-datasets
description: >-
  Uploading a dataset (rows, CSV, a URL), an image, a PDF, a viz recipe; writable datasets. Read only when the brief's one-line upload is not enough.
order: 2
---
## Read first

Every request carries exactly ONE content field: `markup | dataset | viz | image | pdf`.
`markup` is the document; the other four are ASSETS a document reaches by id.
Create them first — a dataset's create response echoes the inferred columns AND
a ready-to-paste `<Query>` + `<Question>`, so the read path arrives written.

```
POST [[ base ]]/api/artifacts
{ "title": "Sales", "dataset": [ { "month": "2026-01", "revenue": 120 }, … ] }      ← flat rows (or a CSV string)
{ "title": "Sales", "csvUrl": "https://…/sales.csv" }                                  ← any PUBLIC csv link; fetched server-side
{ "image": "data:image/png;base64,…" }   |   raw bytes with  Content-Type: image/png  ← see Images
→ 201 { "id", "url", "columns": [...], "rowCount", "access": "read", "ref": "ref:<id>", "usage": "<Helmet><Query …" }
```

- A dataset is read by SQL (DuckDB dialect, one SELECT) as the table
  `ref_<datasetId>` inside a `<Query>`; `columns` type declarations are
  optional and win over the sniffer. Rows over 10,000 are truncated and the
  response says so (`totalRows`, `truncated`, a `note`). `usage` is the
  ready-to-paste Query+Question over the real columns.
- Images and recipes bind as `ref:<id>`; `data="ref:<id>"` and the old
  `<Param>` control are retired (400 with the replacement named).
- Your datasets and images are in the artifact listing (`GET /api/artifacts`,
  each with its `format`) — there is no separate datasets endpoint.

## Contents

Images · PDFs · Writable datasets · Viz recipes.

## Images

An `image` accepts two forms: a base64 `data:` URL in the JSON body
(`{ "image": "data:image/png;base64,…" }`), OR — with no JSON envelope —
the raw bytes as the request body under a `Content-Type: image/<type>`
header, which skips base64 entirely:

```bash
curl -X POST [[ base ]]/api/artifacts -H "Authorization: Bearer $TOKEN" \
  -H "Artifactbin-Agent: $ARTIFACTBIN_AGENT" \
  -H "Content-Type: image/png" --data-binary @chart.png
```

Either way the bytes are stored once (content-addressed) and served from
`[[ base ]]/a/<id>`; bind it in markup as `<img src="ref:<id>" />` and the
URL is resolved for you — you never write one.

**Already on the web? Just use the URL.** `{ "imageUrl": "https://…" }`
makes the artifact from a URL — artifactbin fetches it server-side, so YOU
DO NOT NEED TO DOWNLOAD IT. And in markup you can simply write
`<img src="https://example.com/chart.png" />`: the publish IMPORTS a copy and
LEAVES YOUR URL in the document — you read back what you wrote, while readers
are served our copy, so nobody talks to the original host and the picture
cannot rot from under you. A URL that will not fetch does not fail the
publish: the reply carries `asset_warnings: [{code, url, fix}]` (its own key —
`warnings` stays the dataset-dependent list) and that one image shows its alt
text. Max `[[ maxImageBytes ]]` bytes (png|jpeg|webp|gif|svg+xml), and at most
`[[ maxExternalAssets ]]` external assets per document — the rest are named in
`asset_warnings` and not fetched. The same happens to a `<Video poster>` and to
an `@font-face { src: url(…) }` in your `<Helmet>` `<style>`.

Source changed? `POST [[ base ]]/api/artifacts/assets/refresh` with
`{"id": "<document id>"}` (every external url that document names) or
`{"url": "https://…"}` (one already-stored url); naming neither is
`nothing_to_refresh`. It answers `{refreshed, unchanged, failed}` and touches
nothing else — no new version, and your markup keeps the url it has.

## PDFs

A `pdf` is a FILE a document links, never a document you publish. Two shapes,
the same two an image has:

```
{ "title": "Q3 report", "pdf": "data:application/pdf;base64,…" }   ← bytes you hold
{ "pdfUrl": "https://…/q3.pdf" }                                   ← already on the web; fetched server-side
→ 201 { "id", "url", "bytes", "pages", "rawUrl" }
```

The bytes are stored exactly as sent — nothing re-encodes a PDF — up to
`[[ maxPdfBytes ]]` bytes, and `pages` is present only when the file says so
cheaply. The type comes from the BYTES: a file that is not a PDF is
`400 invalid_pdf` (or `400 pdf_fetch_failed` for a URL) however it is named,
and one over the cap is `413 pdf_too_large`.

Link it with `<File src="ref:<id>" />` — a card showing the name, the size and
the page count, which opens the file in a new tab in the reader's own PDF
viewer. `title="…"` names it something other than the artifact's title. A
public URL works in the same position (`<File src="https://…/paper.pdf" />`):
publish imports a copy and LEAVES YOUR URL in the document, exactly as an
`<img>` URL behaves, and a URL that will not fetch is a warning rather than a
refused publish.

## Writable datasets (preview)

A dataset carries a write ACL beside its visibility: `"access": "read"` (the
default — documents may only read it) or `"access": "readwrite"`. Set it on
create or PUT with your bearer token, or your user flips it from the
document's share menu in the browser (`/api/my/*` is a browser-session
surface and answers a bearer token 401). It is in PREVIEW: add `?v=2` to the
request that sets it (a browser opens any app page with `?v=2` and the app
carries it from there). Nothing else needs the flag — a document that writes
a writable dataset works for every reader, and readers never carry it.

A document writes it by declaring a `<Mutation>` in `<Helmet>` — a `<Query>`
that writes — and running it with `<Button run="$name">` or
`mx.mutate(name)`; the grammar (one INSERT/UPDATE/DELETE, one `ref_<id>`,
`$name` bound never interpolated) is in [markup-data.md](markup-data.md). The target must be a dataset YOU own with `access: readwrite` —
reading a public dataset you do not own is fine, writing one is not.
Everything is checked at publish, so a button that would fail is a 400
naming the fix.

**A write is live.** Anyone who can read the document can run the mutations
it declares (with values only — the SQL is the one you stored), every write
is a new dataset VERSION you can revert, and every open copy of every
document reading that dataset re-runs its queries within about a second.
Capped at 10,000 rows (`409 dataset_full`) and rate-limited per visitor.

An agent writes rows without a document through
`POST [[ base ]]/api/artifacts/<id>/mutate { "sql": "insert into ref_<id> …", "values": {…} }`
— the same rules, and cheaper than re-PUTting a whole table. Refusals:
`400 not_a_dataset` (the id is another tier), `403 dataset_read_only` (set
`access: readwrite` first), `400 invalid_sql` (the detail says why), and
`503 dataset_busy` (concurrent writes contended — retry after a moment).

## Viz recipes

A `viz` recipe is a vega/vega-lite `template` whose `{{token}}`s are filled
from declared `bindings` (every token must name a declared slot, else
`400 invalid_viz`; `accepts` is `nominal | quantitative | temporal`). Only
worth creating for a chart you'll REUSE — for a one-off, put the spec inline
in `<Question viz={{"kind":"vega-lite","spec":{…}}} />`:

```json
{ "title": "Bar by category",
  "viz": { "description": "Bar chart of a category against a measure",
           "engine": "vega-lite",
           "bindings": [ { "name": "x", "label": "Category", "accepts": ["nominal", "temporal"] },
                         { "name": "y", "label": "Measure", "accepts": ["quantitative"] } ],
           "template": { "mark": "bar",
                         "encoding": { "x": { "field": "{{x}}", "type": "nominal" },
                                       "y": { "field": "{{y}}", "type": "quantitative" } } } } }
```

`PUT` replaces content wholesale; `GET` returns the `markup` source plus
`theme` for round-trip editing.
