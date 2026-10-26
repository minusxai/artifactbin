---
name: html-authoring
description: Native HTML creation, conditional replacement, stable node identities and durable write recovery.
---
## Read first

Use an email-authenticated bearer ([authentication](http-auth.md)). JSON uses `Content-Type: application/json`; send bearer only to the selected origin. Cookie requests require `Origin: [[ base ]]`.

## Script workflow

`publish.mjs FILE` discovers CSS, fonts, images, modules, datasets and declared backend TypeScript. JSON/CSV publishes datasets; media publishes assets. `--root` bounds files; `--manifest` accepts `{ "manifest": ["extra.json"] }`. `--dry-run` plans without writes. Backend TypeScript publishes through its declaring page.

Edit with `read.mjs ID --output page.html`, retain `page.html.af.json`, then `publish.mjs page.html`. Canonical IDs and observed version/state survive. Publish updates the input and companion in place (beside it if edited meanwhile). Historical, missing or mismatched baselines refuse updates. Never attach a fresh head to stale bytes. `--artifact ID --baseline FILE` requires the matching pair. Explicit `--create` recovers exported source as a new identity; lost HTML markers plus companion defeat detection. Data/media identity lives only in the companion.

Credential-free journals live outside the project (`--request FILE` or private store default). `--resume FILE` reuses the exact saved origin/method/body/key without rereading source. Retain partial dependency receipts. No force overwrite exists.

`read.mjs list` lists artifacts. `read.mjs ID` returns JSON. `--output page.html` saves canonical HTML + `page.html.af.json`, even with `--json` (receipt formatting only). Dataset outputs require `.json`. `export.mjs ID --format html|png|jpg --output FILE` saves portable HTML or image; image-only `--slide N` is supported, version/viewport flags are not. See offline `--help` for all flags.

## Create

`POST [[ base ]]/api/artifacts`:

```json
{"html":"<!doctype html><html><head><title>Field notes</title></head><body><h1>Field notes</h1><p>A useful first version.</p></body></html>","title":"Field notes","visibility":"unlisted"}
```

Send an `Idempotency-Key` (16–128 letters, digits, underscores or hyphens). Save it once with the complete body outside the page, exclusively (`writeFile` with `flag:"wx"`). Reuse an existing intent; never overwrite it or replace its key after uncertainty. Success returns identity, `url` and canonical `html`; share that URL.

The server inserts the core first and assigns stable `data-af-id`s. Initial inline scripts/handlers are admitted by exact code; inserting new inline code after rendering is blocked. Use authored scripts or assign DOM handlers from them. See [runtime](html-runtime.md).

## Edit the same page

1. `GET /api/artifacts/ID`. Require `format:"html"`; retain canonical `html`, `version` and `state`.
2. Edit that HTML. Keep existing `data-af-id` values, including when moving elements. New page: omit `data-af-id`s for server assignment. Existing page: preserve existing IDs; only new elements may omit them. Script-created elements need stable identities derived from their logical data; keep them beneath a saved source container. Never assign a retired identity to another element. See [dynamic elements and comments](html-runtime.md#dynamic-elements-and-comments).
3. `PUT /api/artifacts/ID` with `{"html":"<edited complete HTML>","expectedVersion":<observed version>,"expectedState":"<observed state>"}` and a new durable idempotency key.
4. Save the successful canonical response for further edits. A 409 means another writer advanced the page; read the new head, reconcile and submit a newly intended write. Never silently overwrite it.

Historical source: `GET /api/artifacts/ID/versions/VERSION`. Preserve every saved version and current identity. Restoring old source is a new conditional edit of the current head, not an overwrite of history.

## Replay and recovery

On timeout, disconnection or uncertain result, resend exactly the same method, path, key and body. A committed matching request replays its original receipt. A reused key with a different payload returns 409. A deleted result returns 410 and is never recreated. If a retained ledger reports `recovered:true,response_expired:true`, follow its returned identity and read the page rather than creating a replacement.

Keep source, the saved request and receipt; keep credentials separately. Non-success JSON is a refusal, never proof of publication. Retain credentials on network, 429 and server failures; use the documented serialized refresh only for an expired grant.

## Linked data

Backend source is published atomically with HTML as `backendSources:{"garden":"<TypeScript source>"}`. Declare the matching name in an `af-backend` link; [backend files](html-backends.md) define the store and role contract. Dataset links bind existing data with original dataset permissions; [datasets](html-datasets.md) explain discovery and live/pinned versions.

On an update, unchanged backend sources may be omitted. Keep their HTML namespace links to retain those immutable backend versions. A new or changed backend source needs the matching `backendSources` member. Removing its link unlinks it from the new page version; older versions keep their original binding.

## Network consent

Declare origins with `<meta name="csp-connect" content="https://api.example.com">` directly in `<head>`. Also supported: `csp-script`, `csp-style` (including fonts), `csp-img`, `csp-frame`, `csp-media`. Each allows ten HTTPS origins; no credentials, paths, queries, fragments, HTTP, eval or policy keywords. Wildcards require a complete leading subdomain (`https://*.example.com`). Invalid declarations refuse saving.

Publisher-introduced origins are trusted by that publisher. Other readers choose Allow once, Always for this document (signed-in), or Never; revocation forgets the choice. Immutable versions retain declarations/history, subject to current access and consent. No account credentials or cross-page access is granted.

Runner `csp-connect` requests use `/a/PAGE_ID/fetch?url=ENCODED_HTTPS_URL`. The guarded door checks access, origins and consent, then public-network, redirect, size and time limits. It forwards no account credentials. Platform isolation remains enforced.

## Installable page presentation

Declare static install metadata in `<head>`, outside scripts and templates:

```html
<meta name="artifactbin:pwa-enabled" content="true">
<meta name="artifactbin:pwa-name" content="Garden tasks">
<meta name="artifactbin:pwa-short-name" content="Garden">
<meta name="artifactbin:pwa-theme-color" content="#234b35">
<meta name="artifactbin:pwa-background-color" content="#ffffff">
<meta name="artifactbin:pwa-icon" content="ref:Ab1234">
```

`enabled` accepts `true|false`; name is nonblank, ≤100 characters; short name ≤30. Colors use six-digit hex. Icon references a readable image artifact (6–12 alphanumeric ID); replace the example. Original permissions apply; unavailable icons use the page mark. Omitted settings use defaults.

The platform owns manifest, app identity, scope/start URL `/a/ID/app/` and workers. Installation grants no access, credentials or offline backend writes.

## Slides and image capture

Mark slide containers and style them with CSS:

```html
<section data-af-slide><h1>Garden review</h1><p>September results</p></section>
<section data-af-slide><h2>Next month</h2><p>Repair the gate.</p></section>
```

Use `GET /a/ID/export?format=png&slide=N` (or `format=jpg`). Rendering starts at a 1200×630 viewport. A slide image is a screenshot of that element's box, so its layout sets the size; capture hides `data-af-deck-chrome`, so mark your deck navigation with it. `slide=N` selects the Nth visible marked element (1-based, in order); stacked or scrolling slides each scroll into view, `display:none` ones are skipped. Missing slides return HTTP 404 `slide_not_found` and the visible count. Whole-page export captures the full HTML body. Reply with `slide=N` export links; no export button is needed. Preserve each slide's canonical `data-af-id` when editing.
