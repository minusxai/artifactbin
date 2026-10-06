---
name: markup-embeds
description: >-
  The embed URL for each provider an <iframe> frames by default (video, posts, audio, code, design, maps). Read when framing one.
---
## Embeds

An `<iframe>`'s `src` is the provider's embed URL, never its share link. Any other host needs `<meta name="csp-frame">`; readers are asked.

Embed URLs that frame by default. Posts have no intrinsic height: set
`height` (or an `h-*` class) to fit, since nothing resizes the frame.

- Video: `www.youtube-nocookie.com/embed/<id>`, `player.vimeo.com/video/<id>`,
  `www.loom.com/embed/<id>`, `fast.wistia.net/embed/iframe/<id>`,
  `www.dailymotion.com/embed/video/<id>`, `www.tiktok.com/embed/v2/<id>`.
- Posts: X `platform.twitter.com/embed/Tweet.html?id=<status id>`,
  Instagram `www.instagram.com/p/<code>/embed`, Bluesky
  `embed.bsky.app/embed/<did>/app.bsky.feed.post/<rkey>`, Reddit
  `embed.reddit.com/r/<sub>/comments/<id>/<slug>/`, LinkedIn
  `www.linkedin.com/embed/feed/update/<urn>`, Threads
  `www.threads.net/@<user>/post/<code>/embed`.
- Audio: `open.spotify.com/embed/<track|album|playlist|episode>/<id>`,
  `w.soundcloud.com/player/?url=<encoded track url>`,
  `embed.music.apple.com/…`, `embed.podcasts.apple.com/…`.
- Code: `codepen.io/<user>/embed/<pen>`, `codesandbox.io/embed/<id>`,
  `stackblitz.com/edit/<project>?embed=1`.
- Design: `embed.figma.com/design/<key>?embed-host=share`,
  `miro.com/app/live-embed/<board>/`, `www.canva.com/design/<id>/view?embed`.
- Data and maps: `observablehq.com/embed/<notebook>`,
  `public.tableau.com/views/<workbook>/<sheet>?:embed=true`,
  `www.openstreetmap.org/export/embed.html?bbox=<w>,<s>,<e>,<n>`.
- Forms, booking tools and Google (Maps, Docs) are not default: declare
  them with `csp-frame`, and readers are asked.
