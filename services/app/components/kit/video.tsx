"use client"

import * as React from "react"

import { cn } from "./cn"
import { videoWatchUrl } from "@/lib/story-ui/video-embed"

/**
 * The sanctioned video component — a click-to-open CARD, not an embedded
 * player. The served document's sandbox propagates to every nested browsing
 * context, so a third-party player iframe inherits the opaque origin and
 * refuses to run; readers saw a dead black frame. The card renders the poster
 * (an author-hosted image ref, or the CSS slab) under a play badge, and links
 * to the video's own page in a new tab — the sandbox's allow-popups flags
 * exist for exactly this. videoWatchUrl (lib/story-ui/video-embed, the whole
 * trust boundary) constructs the href or refuses; raw <iframe> stays banned
 * and nothing here emits one.
 *
 * `poster` arrives as a resolved URL: both render paths patch
 * `poster="ref:<id>"` through resolveRefProps (lib/story/ref-data) before it
 * reaches this component. An unresolved ref string is never given to the DOM
 * — the slab shows instead.
 *
 * The wrapper carries the spread props (incl. the interpreter's data-mx-ast
 * stamp), so a video is click-selectable component chrome like any other
 * embed. 16:9 by default; size with className. `interactive={false}` renders
 * the same card without the link — edit mode sets it (the document's own edit
 * session), where a click must select the embed, never navigate.
 */

/**
 * The play badge over every poster: pure CSS so it serializes into SVG
 * captures — an og card or profile thumbnail shows the finished card.
 */
function VideoPlayBadge({ className }: { className?: string }) {
  return (
    <div
      data-slot="video-play"
      aria-hidden="true"
      className={cn("flex h-14 w-20 items-center justify-center rounded-xl", className)}
    >
      <div className="ml-1 h-0 w-0 border-y-[12px] border-l-[20px] border-y-transparent border-l-white" />
    </div>
  )
}

/** The no-image poster: a dark slab with the play badge. */
function VideoPoster() {
  return (
    <div
      data-slot="video-poster"
      aria-hidden="true"
      className="absolute inset-0 flex items-center justify-center bg-neutral-900"
    >
      <VideoPlayBadge className="bg-[#FF0000]" />
    </div>
  )
}

function Video({
  className,
  src,
  poster,
  title,
  interactive = true,
  ...props
}: React.ComponentProps<"div"> & { src?: string; poster?: string; interactive?: boolean }) {
  const url = videoWatchUrl(src)
  if (!url) {
    return (
      <div
        data-slot="video"
        className={cn(
          "flex aspect-video w-full items-center justify-center rounded-md border border-border bg-muted text-sm text-muted-foreground",
          className
        )}
        {...props}
      >
        {/* The label rides an inner element — the wrapper label belongs to the author. */}
        <span aria-label="Video unavailable">video unavailable — unsupported source</span>
      </div>
    )
  }
  // A still-unresolved ref (deleted image, wrong kind, no refData yet) must
  // not reach the DOM as a URL — it would be a broken image and a CSP hit.
  const thumb = poster && !poster.startsWith("ref:") ? poster : null
  return (
    <div
      data-slot="video"
      className={cn("relative aspect-video w-full overflow-hidden rounded-md bg-muted", className)}
      {...props}
    >
      {thumb ? (
        <>
          <img
            data-slot="video-thumb"
            src={thumb}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div aria-hidden="true" className="absolute inset-0 flex items-center justify-center">
            <VideoPlayBadge className="bg-[#FF0000]" />
          </div>
        </>
      ) : (
        <VideoPoster />
      )}
      {interactive ? (
        <a
          data-slot="video-link"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={title ? `Play video: ${title}` : "Play video"}
          className="absolute inset-0"
        />
      ) : null}
    </div>
  )
}

export { Video, VideoPoster, VideoPlayBadge }
