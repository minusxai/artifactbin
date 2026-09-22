# Screenshot comments

Select starts a native capture session from its click, then picks a block or drags a
rectangle. Screenshots are the default for this flow. Native text-selection comments
remain text comments. Opening the comment sidebar does not itself request permission:
the reader explicitly presses Select. The brush editor provides freehand strokes,
color, thickness and undo. The comment retains both its existing source-node anchor
and an independently captured rectangle; cross-block drags are not clipped to the anchor.

## Boundaries

- `lib/capture/screen.ts`: browser resources behind `beginCapture`, `capture`, `dispose`.
  Capture Handle verifies the exact tab. Region Capture crops a transparent rectangle;
  canvas cropping is the fallback only on a verified tab. Frames use actual source
  dimensions, not devicePixelRatio. Streams stop on completion, failure, navigation,
  source change or timeout. Capture is invoked before asynchronous imports.
- `use-comment-capture.ts`: draft lifecycle, explicit retry/upload/text-only recovery,
  captured revision and staged upload. The brush editor is a separate lazy chunk.
- `comment-images.ts`: validated private raster stages, quota reservations, single-use
  attachment consumption inside the root-comment transaction, and authorized reads.
  Routes translate HTTP. Comment images are not independently public artifacts.

The original crop, flattened preview and 480px thumbnail are decoded and re-encoded as
WebP. Metadata includes image-coordinate brush strokes, captured edit ID and time,
viewport and capture rectangle. Images are capped at 2048px / 4 megapixels; uploads at
8MB per raster. Drafts survive upload or revision errors. A stale revision is refused;
the reader can retake or explicitly choose a comment without a screenshot.

Stage rows reserve all stored bytes against the uploader. Screenshot reservations
serialize per account (or unclaimed token). Abandoned stages expire after 24 hours;
each subsequent image upload sweeps up to 20 expired stages. Failed deletions retain
rows and their byte charges for retry. Attached images retain their charges on soft
deletion, matching the existing artifact retention policy. Every image request checks
current parent-document access and live-comment state, with private/no-store caching.
Disposable-user erasure expires its image records for object cleanup.

## Browser policy and checks

Automatic capture requires both screen sharing and exact-tab verification. Unsupported
browsers offer manual image upload and an explicit text-only choice. A generic
getDisplayMedia wrapper does not establish source identity or supply Region Capture.
Firefox/WebKit fallback coverage is not a claim of native capture support there.

Focused contracts live in capture, screenshot-editor and comment-images tests. The
CI-only `screenshot-comments` gate exercises Chromium native tab capture and the
Firefox/WebKit upload path, including brush markup, comment save, thumbnail loading
and reload. It is run by the normal gate manifest. Real Chrome picker acceptance
requires a person; an automated chooser in CI tests a separate permission setup.
