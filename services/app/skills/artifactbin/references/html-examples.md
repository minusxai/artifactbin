---
name: html-examples
description: Installed native HTML samples, payload preparation, replay-safe publication and browser verification.
---
## Read first

The skill archive contains three ordinary HTML examples. Their figures and tasks are explicit sample content:

- `examples/report.html`: a responsive illustrated field report using semantic HTML/CSS and viewer-local disclosure state.
- `examples/csv-dashboard.html` with `examples/repairs.csv`: a chart computed from a linked dataset’s discovered table/column IDs, all result pages and a consistent revision.
- `examples/shared-app.html` with `examples/garden.ts`: a shared task board with role-protected backend mutations; its display filter is local to each viewer.

Read and adapt the files to the actual task. Preserve canonical node IDs when updating an existing page. The dashboard needs a real dataset ID; never publish its `DATASET_ID` marker.

## Optional helper

Node.js 22+ is needed only for this installed helper. Authentication remains the [HTTP email flow](http-auth.md). Keep the access token outside page files, request JSON and receipts. The helper requires `ARTIFACTBIN_URL` to equal the selected server origin and reads `ARTIFACTBIN_TOKEN` from the environment. Never print either token value or put it in a URL.

Prepare a request once, then send that saved request:

```sh
node scripts/publish.mjs --prepare report --server https://example.test --output report-request.json
node scripts/publish.mjs --send report-request.json
```

Use the actual selected origin in place of `https://example.test`. Preparation includes the selected example’s linked stylesheet and pinned local fonts as a bounded publication bundle, without copying unrelated files. It refuses to overwrite a saved request and stores a durable idempotency key with its complete body. It makes no network call. Sending reuses the exact saved body/key; a timeout keeps the request for replay.

Prepare CSV data with `--prepare repairs-data`, send it and save the returned dataset ID. Then prepare `--prepare csv-dashboard --dataset-id RETURNED_ID`. `--prepare shared-app` includes the paired backend source automatically. Helpers prepare new artifacts; edits follow [conditional replacement](html-authoring.md).

## Verify

Open the returned page URL with the intended account. Check a whole-page desktop view and a 390px viewport, keyboard focus, labels, overflow and console/network errors. Test each changed control. Validate chart values from the source cells, including empty/missing values. Test an editor’s allowed action and a viewer’s refusal on the shared app. A local filter must stay private in a second browser profile; shared task changes must be visible after a fresh remote read.

Test offline behavior separately: local controls can work; remote writes must report their unavailable outcome. Never call a source receipt visual QA. Report passed checks and any remaining limitation.
