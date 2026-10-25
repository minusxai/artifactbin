---
name: html-authoring
description: Native HTML creation, conditional replacement, stable node identities and durable write recovery.
---
## Read first

Use the original artifact API with an email-authenticated bearer; [sign in and store credentials privately](http-auth.md). JSON requests use `Content-Type: application/json`. Send `Authorization: Bearer <access token>` only to the selected origin. Session-cookie requests also require `Origin: [[ base ]]`.

## Create

`POST [[ base ]]/api/artifacts`:

```json
{"html":"<!doctype html><html><head><title>Field notes</title></head><body><h1>Field notes</h1><p>A useful first version.</p></body></html>","title":"Field notes","visibility":"unlisted"}
```

Send an `Idempotency-Key` header containing 16–128 letters, digits, underscores or hyphens. Generate it once and keep it with the complete request body outside the page. Custom request-generation scripts must create the saved file exclusively (`writeFile` with `flag:"wx"` or Python `open(path,"x")`). If it exists, reuse it; never rerun a recipe that overwrites its body or generates a replacement key after an uncertain send. A successful create returns the original artifact identity, `url` and canonical `html`. Share the returned URL; do not invent a host or path.

The server inserts the core first, assigns stable `data-af-id` identities to elements and preserves the rest of the HTML source. Forms, styles, module scripts and SVG are ordinary browser content. Initial inline scripts and authored handlers are admitted by their exact code. Put new behavior in authored scripts or assign DOM event handlers from them; inserting a new inline script body after rendering is blocked. Removing the generated policy element does not remove the browser policy. There is no JSX/Helmet conversion step.

## Edit the same page

1. `GET /api/artifacts/ID`. Require `format:"html"`; retain canonical `html`, `version` and `state`.
2. Edit that HTML. Keep existing `data-af-id` values, including when moving elements. New elements in source can omit identities; the server assigns them on save. Script-created elements need stable identities derived from their logical data; keep them beneath a saved source container. Never assign a retired identity to another element. See [dynamic elements and comments](html-runtime.md#dynamic-elements-and-comments).
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

Declare additional network origins with normal `<meta>` elements directly in `<head>`, for example `<meta name="csp-script" content="https://cdn.example.com">`. Supported names are `csp-connect`, `csp-script`, `csp-style` (styles and fonts), `csp-img`, `csp-frame` and `csp-media`. Each accepts at most ten space-separated HTTPS origins: no credentials, paths, queries, fragments, HTTP, eval or policy keywords. A wildcard may only be a complete leading subdomain label (`https://*.example.com`). Invalid declarations refuse publication without saving a version.

The publisher trusts the origins they introduced. Other readers choose Allow once for their browser session, Always for this document (signed-in accounts), or Never; revocation forgets the choice. New origins require new consent. Declarations and their publication history belong to each immutable page version; current access permissions and reader consent still apply. These choices never grant access to another page or account credentials.

On the page runner origin, declared `csp-connect` hosts are reached through the page's guarded `/a/PAGE_ID/fetch?url=ENCODED_HTTPS_URL` door, not directly. The door checks current page access, declared origins and reader consent, then applies the existing public-network, redirect, size and time limits. It forwards no account credentials to the remote host. The page sandbox and platform isolation remain in force.

## Installable page presentation

Opt in with static `<meta>` elements directly in `<head>`. Script-created metadata, template contents and body metadata do not declare install settings.

```html
<meta name="artifactbin:pwa-enabled" content="true">
<meta name="artifactbin:pwa-name" content="Garden tasks">
<meta name="artifactbin:pwa-short-name" content="Garden">
<meta name="artifactbin:pwa-theme-color" content="#234b35">
<meta name="artifactbin:pwa-background-color" content="#ffffff">
<meta name="artifactbin:pwa-icon" content="ref:Ab1234">
```

These are the six supported names. `enabled` accepts `true` or `false`; name is nonblank and at most 100 characters, short name at most 30. Colors require six-digit hex. The optional icon references an actual readable image artifact (6–12 alphanumeric ID characters); replace the example ID. Its original admission and read permissions still apply. An unavailable icon uses the generated page mark. Omit optional settings to use platform defaults.

The platform owns the manifest, app identity, start URL and scope at `/a/ID/app/`; do not author custom scope or service-worker declarations. Installation does not grant access, embed credentials or make shared backend writes work offline.

## Slides and image capture

Mark author-owned slide containers explicitly, and style their layout with normal CSS:

```html
<section data-af-slide><h1>Garden review</h1><p>September results</p></section>
<section data-af-slide><h2>Next month</h2><p>Repair the gate.</p></section>
```

Use `GET /a/ID/export?format=png&slide=N` (or `format=jpg`). Rendering starts at a 1200×630 viewport; slide images crop to the selected element, so dimensions follow its layout. Reader chrome reduces page height; inspect the image for clipping or author navigation inside the slide. An export's `slide=N` selects the Nth visible marked element in document order, starting at 1; hidden miniatures do not count. Missing slides return HTTP 404 `slide_not_found` and the visible count. Whole-page export captures the full HTML body. The marker declares capture boundaries; it does not create navigation or presentation controls. Preserve each slide's canonical `data-af-id` when editing.
