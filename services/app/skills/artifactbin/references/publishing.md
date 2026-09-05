---
name: publishing
description: >-
  The HTTP API beyond the brief: replace, the edit_id protocol, folders, fork, read back, list, errors. Read when a call is refused or a human may be editing the same page.
---
## Read first

- **Publish** is one `POST [[ base ]]/api/artifacts` of a self-contained
  document; the deliverable is the `url` you hand your user.
- **Every `/api` call, `GET` included, sends `Authorization: Bearer mx_...`.**
  No token? [auth](publishing-auth.md) — never mint one; ask your user at
  `[[ base ]]/tokens/new`.
- A document is **static JSX**, not HTML — tags, components and the JSX rules
  are [markup.md](markup.md).
- Datasets, images and chart recipes are their own artifacts, created first:
  [datasets](publishing-datasets.md). Also [annotations](publishing-annotations.md)
  and [mcp](publishing-mcp.md).

## Contents

Rules every document lives by · Endpoints (create, update, edit, folders, fork, read, list) · Errors.

## Rules every document lives by

Served sandboxed at an opaque origin under a strict per-document CSP: **no
outbound network except the same-origin endpoints it names** — `/a/<id>/query`
(data), `/a/<id>/events` + `/events/frame` (live), `/a/<id>/mutate` (declared
writes), `/geojson/` (maps). A CDN `<script src>`, an external stylesheet or any
other `fetch`/XHR is a 400 at publish. CSS and JS live in `<Helmet>` only.
Max [[ maxContentBytes ]] bytes.

## Endpoints

### Create an artifact

```
POST [[ base ]]/api/artifacts
{ "title": "Optional title", "description": "Optional", "markup": "<h1 className=\"text-4xl font-bold\">Hello</h1>" }
→ 201 { "id": "<6-char id>", "url": "[[ base ]]/a/<id>", "version": 1, "edit_id": "<head pointer>", "markup_changed": false }
```

`markup` is one of the content fields — `markup | dataset | viz | image | pdf`
— and every endpoint takes exactly ONE.
`markup_changed` true means storing rewrote the document and the CANONICAL
`markup` comes back; edit against that echo (`/edits` always returns the
resulting `markup`).

**Visibility (who can open that url).** An account-owned token publishes
`private` by default — **when your user wants a link for OTHER people, pass
`"visibility": "public"` or `"unlisted"` on create or PUT.** `public` = anyone
with the link, listed on `/@username`; unlisted is listed nowhere, a folder
page included; `private` = the owner plus emails invited on the share page
([auth](publishing-auth.md)). Anonymous tokens publish `public`, images and
datasets `unlisted`; `private` with no account is
`400 private_requires_account`, never a silent downgrade.

### Update an artifact (the link never changes)

```
PUT [[ base ]]/api/artifacts/<id>
{ "markup": "<h1 className=\"text-4xl\">Replaced</h1>", "title": "new title" }
→ 200 { "id", "url", "version": <bumped> }
```

Full replacement — the complete new content, not a diff; the previous version is
archived, omitted `title`/`description` keep their values, and it is also where
`"visibility"` goes. Optionally `expectedVersion` (from your last
read): a concurrent edit then answers `409 version_conflict` with its
`currentVersion` instead of overwriting — re-read, merge, retry.

### Folders, and the trash

`format: 'folder'` with NO content field makes one — an artifact like any
other, with its own url, title, visibility and sharing. `parent_id` files
anything under it, on create, fork or PUT; `null` is your root.

```
POST [[ base ]]/api/artifacts  { "format": "folder", "title": "Reports" } → 201 { "id": "hAoPxJ" }
POST [[ base ]]/api/artifacts  { "markup": "…", "title": "Q3", "parent_id": "hAoPxJ" }
```

Ids, never paths (two sibling folders may share a name); max 6 deep. Every read
carries `parent_id` and `ancestor_ids` (the trail, root→parent), so one call
draws breadcrumbs and the url keeps working wherever a file moves.

A folder's page is its own stored markup — a `<Query>` over its children table
`ref_<folderId>`, drawn by `<Files>` ([markup-data.md](markup-data.md)) — so you
edit one like any document. DELETE is a TRASH: a folder goes with everything
under it, and `restore_artifact` takes it back for 30 days
([publishing-versions.md](publishing-versions.md)).

### Edit part of a document

```
POST [[ base ]]/api/artifacts/<id>/edits
{ "edit_id": "<from your last read>", "old_string": "exact text to replace", "new_string": "replacement" }
→ 200 { "id", "version", "edit_id": "<new>", "markup", ... }
```

Like editing a file: `old_string` must appear EXACTLY ONCE in the version named
by `edit_id`. Prefer it over PUT: smaller, and A HUMAN MAY BE EDITING THE SAME
PAGE LIVE. `edit_id` is opaque, returned by every create/read/edit — never
invent one. Concurrency is per NODE, so most edits just apply:

| Result | Meaning | What to do |
|---|---|---|
| 200 | Applied — even if someone edited a DIFFERENT part | Use the returned `edit_id` |
| 409 `doc_changed` | Someone changed the SAME part | Re-anchor on the returned `edit_id` + `source`, retry |
| 409 `stale_edit_id` | That `edit_id` is unknown (too old, or never read) | `GET` it, start from its `edit_id` |
| 400 `bad_diff` | `old_string` matched zero or many times | Pick a longer unique anchor |

You may also set `title`, `theme` or `colorMode` in the same request, with or
without a text change: document-level, so they never conflict.

### Fork an artifact

```
POST [[ base ]]/api/artifacts/<id>/fork
{ "title": "My copy", "visibility": "unlisted", "parent_id": "<folderId>" }  ← all optional
→ 201 { "id": "<new id>", "url", "version": 1, "edit_id", "markup", "forked_from": "<id>" }
```

**To adapt a document you can read, fork it, then edit the copy** — yours, one
shared with you, or any public/unlisted one. The reply is the create
reply: `id` and `edit_id` go straight into the edit loop. Content and settings
travel; history, comments and shares do not; the original is untouched; and refs
re-check as YOU (someone else's `<Mutation>` target is `400 invalid_refs`).

### Read one back

```
GET [[ base ]]/api/artifacts/<id>
→ 200 { "id", "url", "title", "format", "markup", "version", "edit_id",
        "parent_id", "ancestor_ids", "annotations": [...], "open_annotations": <n> }
```

### List your artifacts

```
GET [[ base ]]/api/artifacts → 200 { "artifacts": [ { "id", "url", "title", "format", ... } ] }
```

EVERYTHING you own — datasets, images, viz recipes and folders are artifacts
too; there is no separate datasets endpoint.

## Errors

| Status | Meaning | What to do |
|---|---|---|
| 400 | `invalid_json` / `markup_only` / `one_of_markup_dataset_viz_image_pdf` / `invalid_jsx` / `invalid_refs` / `invalid_sql` / `invalid_dataset` / `invalid_image` / `unknown_theme` / `retired_theme` | Fix the body — `details` names each problem with its span; a retired theme's hint names its successor |
| 400 | `invalid_visibility` / `private_requires_account` / `public_not_enabled` | The three values are above; a deployment that does not offer `public` takes `unlisted` (already anyone-with-the-link) |
| 400 | `invalid_parent` / `folder_retired` / `not_forkable` | `parent_id` is the id of a FOLDER you own, outside what you are moving, under 6 deep — one code, since naming which would say whether an id exists. `folder` paths are gone; a folder is not forkable |
| 401 | `unauthorized` | Token wrong/revoked — ask your user, don't retry |
| 403 | `quota_exceeded` | This token is at its cap — delete something, or use another |
| 404 | `not_found` | No artifact with that id is reachable by your token |
| 409 | `version_conflict` | `expectedVersion` is stale — re-read, merge, retry (`400 invalid_expected_version`: it must be a number) |
| 400 | `not_editable` | Not markup — PUT it whole |
| 400 | `image_fetch_failed` | An `https://` image would not import (unreachable, not an image, private address, over the cap) — `details` names it |
| 403 | `owner_only` | `visibility` and `access` are the owner's — you are a named editor here, so send the write without them |
| 409 | `has_dependents` | Other documents reference it — re-send DELETE with `?force=true` |
| 413 / 429 | `too_large` / `rate_limited` | Shrink the content; back off a minute |
