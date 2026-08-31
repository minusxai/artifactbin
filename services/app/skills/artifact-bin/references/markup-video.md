---
name: markup-video
description: >-
  The <Video> card for YouTube, Vimeo and Loom links (no embedded player). Read only when embedding a video.
order: 3
---
## Read first

`<Video src="…" title="…" poster="ref:<id>" />` renders a video CARD — a
thumbnail with a play button that opens the video on its own page in a new
tab. There is NO embedded player: the document's sandbox admits no
third-party frames, so a player iframe could never run (and a raw
`<iframe>` stays rejected). 16:9 and full-width by default (size it with
`className`).

- `src` takes the link you would share — a YouTube watch/short/embed URL, a
  Vimeo page, a Loom share. Only these hosts are accepted; anything else is
  refused at publish.
- `poster` (optional) is the thumbnail, and takes exactly what an
  `<img src>` takes: a `ref:<id>` image artifact, or a web URL, which is
  IMPORTED at publish and echoed back rewritten to `ref:<id>`. Without a
  poster the card shows a dark slab with the play badge.
