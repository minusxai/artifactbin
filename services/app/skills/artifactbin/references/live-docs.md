---
name: live-docs
description: "Read to change the text of a doc (or any page's editable region) while people may be typing in it: Markdown through the installed script or the HTTP API."
---
## Read first

A doc is a page whose text lives in an editable region (`data-af-editable="rich"` or `"text"`),
which people with edit access type into live. To change that text, never republish the page
(this is about the text, not the page's CSS or layout): read the region as Markdown, edit it, and write it back with the version you read. Your edit is
merged with everyone's unsaved typing (nothing of theirs is lost), appears in their open page
live, and is saved as a new version.

```sh
node scripts/doc.mjs read ID --output doc.md   # saves people's typing first, then reads
node scripts/doc.mjs write doc.md              # edit doc.md in place, then write it
```

`doc.md.af.json` beside the file remembers the page, the region and the version read; write
rewrites both files with the merged, saved text, so keep editing the same file. Send the whole
region back: text you remove is removed, text you leave alone is kept as it is (including what
others typed meanwhile). Change only what the request asks for.

## Contents

- [Regions and Markdown](#regions-and-markdown)
- [HTTP contract](#http-contract)
- [Refusals](#refusals)

## Regions and Markdown

A page may declare several regions. `_doc` (the default) names the page's only rich region: a
doc's body. Name another with `--region ID` (its `data-af-id`); a refusal lists the regions the
page has. `text` regions (a title) hold one line of plain text: escape Markdown characters you
mean literally (`\*`).

Rich regions keep CommonMark headings, paragraphs, bullet and numbered lists (nested), block
quotes, fenced code blocks, horizontal rules, bold, italic, inline code and links (http, https,
mailto or relative). Images, tables, hard line breaks and raw HTML are refused by name. Markdown
has no empty paragraph: blank paragraphs are dropped. `--html` reads and writes the region's
HTML in the same subset instead (`p`, `h1`-`h6`, `ul`/`ol`/`li`, `blockquote`, `pre>code`, `hr`,
`strong`, `em`, `code`, `a href`).

Docs and `af-markdown` share one Markdown stylesheet (`components/markdown-styles.ts`, root class
`af-markdown-body`); the design
system sets fonts and colours. For one page, add a small `<style>` override such as
`article { line-height: 1.4 }`: read the page (`scripts/read.mjs`), add it, republish it
(`scripts/publish.mjs`). A whole-page write merges live regions three-way, keeping people's typing.

Reading includes everyone's unsaved typing, as the open page shows it. With edit access, `read`
(and `GET /api/artifacts/ID`) first saves that typing as a version, so the version you write from
holds exactly what you read; readers read it live. Comments anchor to saved versions as usual.

## HTTP contract

Only when the script cannot do the job. Use the bearer credential; bodies are JSON.

| Action | Request | Body/result |
|---|---|---|
| Save typing | `POST /api/artifacts/ID/regions/flush` | `{version}` |
| Read | `GET /api/artifacts/ID/regions/REGION?format=markdown` | `{regionId, kind, version, markdown}` |
| Read HTML | `GET /api/artifacts/ID/regions/REGION?format=html` | `{regionId, kind, version, html}` |
| Write | `PUT /api/artifacts/ID/regions/REGION` | `{markdown, base_version}` → `{regionId, kind, version, html, markdown}` |

`REGION` is a `data-af-id` or `_doc`. `base_version` is the `version` the read returned. Send a
durable `Idempotency-Key` with every write and reuse it when retrying the same write: a write
applied twice inserts its new text twice. The reply's `version` is the new saved head; read
again from it for the next edit, or write from the same base again (both writes are kept).

## Refusals

| Code | Meaning | Do |
|---|---|---|
| `region_not_found` (404) | No region by that id; `regions` lists them | Pick one from `regions` |
| `region_ambiguous` (409) | `_doc` on a page with several rich regions | Name one from `regions` |
| `region_snapshot_missing` (409) | The version you read is too old | Read again (`version`), reapply |
| `unsupported_content` (422) | `details` names what the region cannot hold | Remove it, write again |
| `not_found` (404) | Unknown page, or you may not edit it | Check the ID and access |
