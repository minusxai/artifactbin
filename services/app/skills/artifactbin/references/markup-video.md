---
name: markup-video
description: >-
  The <Video> card for YouTube, Vimeo and Loom links (no embedded player). Read only when embedding a video.
order: 3
---
## Read first

`<Video src="…" title="…" poster="ref:<id>" />` renders a video CARD: a
thumbnail with a play button that opens the video in a new tab. There is no
embedded player and a raw `<iframe>` is rejected. `src` is the share link of a
YouTube, Vimeo or Loom video (any other host is refused at publish); `poster`
(optional) takes what an `<img src>` takes: a `ref:<id>` image, or a web URL,
which publish fetches and stores — your URL stays in the document as written.
16:9 and full-width by default; size it with `className`.
