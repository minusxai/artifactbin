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

Send an `Idempotency-Key` header containing 16–128 letters, digits, underscores or hyphens. Generate it once and keep it with the complete request body outside the page. A successful create returns the original artifact identity, `url` and canonical `html`. Share the returned URL; do not invent a host or path.

The server inserts the core first, assigns stable `data-af-id` identities to elements and preserves the rest of the HTML source. Forms, styles, module scripts and SVG are ordinary browser content. There is no JSX/Helmet conversion step.

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
