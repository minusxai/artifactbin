---
name: publishing-versions
description: >-
  Version history, revert, delete, PNG export. Read to undo an edit, remove an artifact or hand over an image.
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

## Delete an artifact

```
DELETE [[ base ]]/api/artifacts/<id>
→ 200 { "ok": true }
```

Permanent: the public link dies and version history is erased. Confirm with
your user before deleting anything they shared. An artifact other documents
reference (an image, a dataset) answers `409 has_dependents`; re-send with
`?force=true` to break them knowingly.

## Screenshot / export as an image (curlable; readable = exportable)

```
GET [[ base ]]/a/<id>/export             → image/png of the fully rendered page
GET [[ base ]]/a/<id>/export?format=jpg  → image/jpeg
GET [[ base ]]/a/<id>/export?mode=card   → 1600×840 top-viewport card (the og:image)
GET [[ base ]]/a/<id>/export?slide=2     → just slide 2 of a deck (1-based, one screen)
```

Reviewing a deck, ask for one slide at a time: the whole-document shot is every
slide stacked, and each is too small to read. A slide past the end answers
`404 slide_not_found` with the count, so one request tells you how many there
are.

Rendered on demand in a server-side headless browser — full page at 1200px
wide, repeat fetches cached until the artifact changes. Fetch it to eyeball
your own output ONLY IF YOU CAN VIEW IMAGES — otherwise read the stored markup
back instead (a 200 write has already validated the document, and a harness
that cannot take an image fails the whole run on one). Also use it to hand your
user a static image:

```bash
curl -sS -o report.png "[[ base ]]/a/<id>/export"
```

Share pages also carry `og:image` pointing at this URL, so links pasted into
Slack and the like unfurl with a live preview. A `503 render_unavailable`
means this deployment has no headless browser installed — the HTML link still
works.
