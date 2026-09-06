---
name: publishing-versions
description: >-
  Version history, revert, delete/restore, PNG export. Read to undo an edit, remove one or hand over an image.
order: 4
---
## Read first

Every `PUT`, edit and revert archives the previous state, so a bad edit is
recoverable and the link never changes:

```
GET  [[ base ]]/api/artifacts/<id>/versions           → 200 { "versions": [ { "version", "title", "created_at" } ] }
GET  [[ base ]]/api/artifacts/<id>/versions/<version> → 200 one archived version, `markup` carrying its source
POST [[ base ]]/api/artifacts/<id>/revert             { "version": 1 } → 200 { "id", "url", "version": <new> }
```

A revert creates a NEW version (the pre-revert state is archived too), so
reverts are themselves undoable. Dataset writes version the same way. A
missing/non-integer `version` is `400 version_required`; a checkpoint that was
never archived (save-less edits coalesce) is `409 version_not_archived` — the
list above shows the real ones.

## Contents

History and revert · Atomic edit batches · Delete and restore · Export.

## Atomic edit batches

`edit_artifact` accepts exactly ONE content form: one top-level `old_string` +
`new_string` pair, OR `"edits": [{"old_string":"…","new_string":"…"}, …]`.
The array must be nonempty and has a maximum of 64 pairs; never combine it with
the top-level pair. Each old string must match exactly once in the sequential
in-memory result. Later steps may edit earlier insertions and intermediate JSX
may be incomplete: only the final result is validated.

The batch is atomic. Success creates one version and one new `edit_id`; if any
step or final validation fails, nothing is written. `edit_index` is the
zero-based failing step. A stale batch rebases over unrelated edits, but a
concurrent change to any region it touches rejects the whole batch.

Move a node by removing and reinserting the same ID-bearing source in one call:

```json
{
  "edit_id": "<from your last read>",
  "edits": [
    { "old_string": "<Card id=\"summary-card\">Summary</Card>", "new_string": "" },
    { "old_string": "<section id=\"details\">", "new_string": "<section id=\"details\"><Card id=\"summary-card\">Summary</Card>" }
  ]
}
```

The first step is the source removal and the second is the destination insert;
the moved card keeps `id="summary-card"`. Use one pair for one local change.

## Delete an artifact (it goes to the trash)

```
DELETE [[ base ]]/api/artifacts/<id>          → 200 { "ok": true }
POST   [[ base ]]/api/artifacts/<id>/restore  → 200 { "id", "url", "parent_id" }
```

The link stops working at once, and the artifact is restorable with no deadline.
A FOLDER takes everything under it, and restore brings the whole subtree back —
if the folder it lived in is itself still deleted, it comes back at your root
and the answer says so. Confirm with your user before deleting anything they
shared. An artifact other documents reference (an image, a dataset) answers
`409 has_dependents`; re-send with `?force=true` to break them knowingly.

**Nothing here is ever erased.** A delete withdraws the link and nothing more:
the row, its version history, its comments and its stored bytes are kept, and
`restore_artifact` works a year later exactly as it does a minute later. Two
things follow, and your user should hear both from you rather than discover
them. A deleted artifact **still counts against your quota** — deleting does not
free you to publish another one. And really destroying something, for a legal
request or anything like it, is **an administrative act on the database, outside
this API**; do not promise your user that a delete does it.

One more limit worth knowing: the 6-level depth cap counts only what is LIVE, so
a restore can land a row deeper than the 6-level cap if the folders above it
grew while it was gone; the row is fine where it lands, and the next MOVE is
what refuses.

## Screenshot / export as an image (curlable; readable = exportable)

```
GET [[ base ]]/a/<id>/export             → image/png of the fully rendered page
GET [[ base ]]/a/<id>/export?format=jpg  → image/jpeg
GET [[ base ]]/a/<id>/export?mode=card   → 1600×840 social preview card (the og:image)
GET [[ base ]]/a/<id>/export?slide=2     → just slide 2 of a deck (1-based, one screen)
```

Reviewing a deck, ask for one slide at a time: the whole-document shot is every
slide stacked, and each is too small to read. A slide past the end answers
`404 slide_not_found` with the count, so one request tells you how many there
are.

Rendered on demand in a server-side headless browser — full page at 1200px
wide, repeat fetches cached until the artifact changes. Owners and editors can
set the card's locked 40:21 frame from the artifact controls. Fetch it to eyeball
your own output ONLY IF YOU CAN VIEW IMAGES — otherwise read the stored markup
back instead (a 200 write has already validated the document, and a harness
that cannot take an image fails the whole run on one). Also use it to hand your
user a static image:

```bash
curl -sS -o report.png "[[ base ]]/a/<id>/export"
```

### Set a social preview image

Upload an image asset first (`POST /api/artifacts` with raw image bytes and
`Content-Type: image/png`, or JSON `{ "image": "data:image/png;base64,…" }`).
Use its returned id in the document source:

```jsx
<Helmet>
  <meta name="artifactbin:og-image" content="ref:IMAGE_ID" />
</Helmet>
```

This reference must resolve to an image you can use, just like `<img src="ref:…" />`.
The card export uses the uploaded image, centered and cropped to fill 1600×840
by default. In the social preview editor, drag to pan and resize the frame to
select a different area of the uploaded image. Its bounds are saved separately:

```jsx
<meta name="artifactbin:og-image-crop" content="x=400;y=200;width=800" />
```

Image coordinates refer to the full image scaled to 1600px wide (after image
orientation); height follows the locked 40:21 ratio. Reset removes these image
bounds and restores the centered image crop. Replacing the image starts with a
fresh centered crop. The document's `artifactbin:og-crop` is preserved.
Remove the `artifactbin:og-image` meta to restore the saved document framing.
The browser's **sharing → social preview → upload image → save preview** uses the same
asset upload and Helmet reference.

Document framing is also stored in Helmet:
`<meta name="artifactbin:og-crop" content="x=0;y=400;width=1200" />`.
Coordinates use a 1600px-wide document layout; height follows the 40:21 ratio.
An uploaded image takes precedence without removing these bounds. Without
either setting, the card captures the top 1600×840 of the document. Full-page
and editor overview exports continue to render the document itself.

Share pages also carry `og:image` pointing at this URL, so links pasted into
Slack and the like unfurl with a live preview. A `503 render_unavailable`
means this deployment has no headless browser installed — the HTML link still
works.
