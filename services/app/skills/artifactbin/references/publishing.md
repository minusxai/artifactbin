---
name: publishing
description: >-
  The HTTP API beyond the brief: replace, the edit_id protocol, read back, list, fork, the error table. Read when a call is refused or a human may be editing the same page.
---
## Read first

Upload a self-contained document, get back a **link** to share with your user.

- **Publish** is one `POST [[ base ]]/api/artifacts`; the deliverable is the `url`.
- **Every `/api` call, `GET` included, sends `Authorization: Bearer mx_...`.**
  No token? Read [auth](publishing-auth.md): use a pasted token or start link,
  send your user to `[[ base ]]/tokens/new`, or without a human `POST
  [[ base ]]/api/tokens/anonymous`.
- A document is **static JSX**, not HTML — the tags, the components and the
  JSX rules are [markup.md](markup.md).
- Datasets, images and chart recipes are their own artifacts, created first:
  [datasets](publishing-datasets.md). Also [annotations](publishing-annotations.md),
  [versions](publishing-versions.md), [mcp](publishing-mcp.md).

## Contents

Rules every document lives by · Endpoints (create, update, edit, fork, read, list) · Errors.

## Rules every document lives by

A document is served sandboxed with an opaque origin under a strict
per-document Content-Security-Policy: **no outbound network except the
same-origin endpoints it names** — `/a/<id>/query` (data), `/a/<id>/events`
and `/a/<id>/events/frame` (live stream), `/a/<id>/mutate` (declared writes),
`/geojson/` (map boundaries). So a CDN `<script src>`, an external stylesheet
or any other `fetch`/XHR is a 400 at publish (a runtime `fetch()` elsewhere is
blocked silently); CSS and JS live in `<Helmet>` only, and an image is a
`data:` URI, a `ref:<id>` or an imported `https://` URL.
Max [[ maxContentBytes ]] bytes.

## Endpoints

### Create an artifact

```
POST [[ base ]]/api/artifacts
{ "title": "Optional title", "description": "Optional", "markup": "<h1 className=\"text-4xl font-bold\">Hello</h1>" }
→ 201 { "id": "<6-char id>", "url": "[[ base ]]/a/<id>", "version": 1, "visibility": "public", "edit_id": "<head pointer>", "markup_changed": false }
```

`markup` is one of four content fields — `markup | dataset | viz | image`;
every endpoint takes exactly ONE. `markup_changed` true means storing rewrote
the document and the CANONICAL `markup` comes back; false means it stored
unchanged, byte-for-byte. Edit against the echo (`/edits` always returns the
resulting `markup`: you sent a splice).

**Visibility (who can open that url).** An account-owned token publishes
`private` by default — **when your user wants a link for OTHER people, pass
`"visibility": "public"` or `"unlisted"` on create or PUT.** `public` =
anyone with the link, listed on the owner's `/@username`; `unlisted` = the
same link, listed nowhere; `private` = the owner plus the emails invited on
the share page ([auth](publishing-auth.md): what a share reaches).
Anonymous tokens publish `public`, images and datasets
`unlisted`; `private` without an account is `400 private_requires_account`,
never a silent downgrade.

### Update an artifact (the link never changes)

```
PUT [[ base ]]/api/artifacts/<id>
{ "markup": "<h1 className=\"text-4xl\">Replaced</h1>", "title": "optional new title" }
→ 200 { "id", "url", "version": <bumped> }
```

Also the place for metadata: `"folder": "2026/08/reports"` (segments
`[a-zA-Z0-9_-]`, max 8 deep; the URL keeps working) and `"visibility"`.

Full replacement — send the complete new content, not a diff; the previous
version is archived. Omitted `title`/`description` keep their values.
Optionally include `expectedVersion` (from your last read): a concurrent edit
then answers `409 {"error":"version_conflict","currentVersion":N}` instead of
being overwritten — re-read, merge, retry with `expectedVersion: N`.

### Edit part of a document (preferred for `markup`)

```
POST [[ base ]]/api/artifacts/<id>/edits
{ "edit_id": "<from your last read>", "old_string": "exact text to replace", "new_string": "replacement" }
→ 200 { "id", "version", "edit_id": "<new>", "markup", ... }
```

Like editing a file: `old_string` must appear EXACTLY ONCE in the version
named by `edit_id`. Prefer this over PUT: it is smaller, and a HUMAN MAY BE
EDITING THE SAME PAGE LIVE. `edit_id` is an opaque string returned by every
create/read/edit — never invent one; it is how the server knows which version
you read. Concurrency is per NODE, not per document, so most edits just apply:

| Result | Meaning | What to do |
|---|---|---|
| `200` | Applied — even if someone edited a DIFFERENT part meanwhile | Use the returned `edit_id` next |
| `409 doc_changed` | Someone changed the SAME part | Re-anchor on the returned `edit_id` + `source`, retry |
| `409 stale_edit_id` | That `edit_id` is unknown (too old, or never read) | `GET` the artifact, start from its `edit_id` |
| `400 bad_diff` | `old_string` matched zero times or more than once | Pick a longer unique anchor |

You may also set `title`, `theme`, or `colorMode` in the same request, with
or without a text change: they are document-level and never conflict.

### Fork an artifact (adapt one you can read)

```
POST [[ base ]]/api/artifacts/<id>/fork
{ "title": "My copy", "visibility": "unlisted", "folder": "2026/forks" }  ← all optional
→ 201 { "id": "<new id>", "url", "version": 1, "edit_id", "markup", "forked_from": "<id>" }
```

**To adapt a document you can read, fork it, then edit the copy** — your own,
one shared with your account, or any public/unlisted one. The reply is the
create reply: `id` and `edit_id` go straight into the edit loop. Content and
settings travel; history, comments and shares do not, the original is
untouched, and refs are re-checked as YOU (someone else's `<Mutation>` target
is `400 invalid_refs`).

### Read one back (before editing)

```
GET [[ base ]]/api/artifacts/<id>
→ 200 { "id", "url", "title", "description", "format", "markup", "version", "edit_id",
        "annotations": [ ... ], "open_annotations": <count>, ... }
```

### List your artifacts

```
GET [[ base ]]/api/artifacts
→ 200 { "artifacts": [ { "id", "url", "title", "format", "version", "updated_at", ... } ] }
```

EVERYTHING you own — datasets, images and viz recipes are artifacts too;
there is no separate datasets endpoint.

## Errors

| Status | Meaning | What to do |
|---|---|---|
| 400 | `invalid_json` / `markup_only` / `one_of_markup_dataset_viz_image` / `invalid_jsx` / `invalid_refs` / `invalid_sql` / `invalid_dataset` / `invalid_image` / `unknown_theme` / `retired_theme` | Fix the body — `details` names each problem with its span; `retired_theme`'s hint names the successor |
| 400 | `invalid_visibility` / `private_requires_account` | `visibility` is `public`, `unlisted` or `private`; `private` needs an account-owned token |
| 400 | `public_not_enabled` | This deployment does not offer `public`; use `unlisted` (already anyone-with-the-link) |
| 400 | `invalid_folder` | `folder` segments are `[a-zA-Z0-9_-]` (max 40 chars each, 8 deep) |
| 401 | `unauthorized` | Token wrong/revoked — ask your user, don't retry |
| 403 | `quota_exceeded` | This token is at its artifact cap — delete something, or use another token |
| 404 | `not_found` | No artifact with that id is reachable by your token |
| 409 | `version_conflict` | Your `expectedVersion` is stale — re-read, merge, retry with `currentVersion` (`400 invalid_expected_version`: it must be a number) |
| 409 / 400 | `doc_changed` / `stale_edit_id` / `bad_diff` | See the edit table above |
| 400 | `not_editable` | Not markup — PUT it whole |
| 400 | `invalid_annotation_action` / `invalid_status` | The annotation POST needs `reply`, `resolve: true` or `reopen: true`; a list `status` is `open`, `resolved` or `all` |
| 400 | `image_fetch_failed` | An `https://` image could not be imported (unreachable, not an image, private address, over the cap) — `details` names it |
| 403 | `dataset_read_only` | The `<Mutation>` target must be your own dataset with `"access": "readwrite"` |
| 409 | `has_dependents` | Other documents reference this artifact — re-send DELETE with `?force=true` |
| 413 | `too_large` | Shrink the content |
| 429 | `rate_limited` | Back off and retry after a minute |
