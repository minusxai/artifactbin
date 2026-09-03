"use client"

import * as React from "react"

import { cn } from "./cn"
import { formatFileSize } from "@/lib/file-size"

/**
 * A FILE, as a card that opens it — the sanctioned way a document carries a
 * PDF, and deliberately not an embedded viewer.
 *
 * The served document is sandboxed without `allow-same-origin` and its sandbox
 * propagates to every nested browsing context, which is the same wall `<Video>`
 * ran into: a nested viewer inherits the opaque origin and readers see a dead
 * frame. A LINK is navigation, not a subresource — the document's own
 * `default-src 'none'` has nothing to say about it, and the sandbox's
 * `allow-popups allow-popups-to-escape-sandbox` flags exist for exactly this.
 * The spike measured it end to end: a real click on `<a target="_blank">`
 * opened the PDF at its own address and the browser's own viewer rendered it,
 * while the same link clicked programmatically (no user activation) opened
 * nothing.
 *
 * `src` arrives as a resolved URL: `src="ref:<id>"` is patched through
 * resolveRefProps (lib/story/ref-data) and a web URL through the serve-time
 * asset mapping (lib/story/asset-url), each before this component sees it. An
 * unresolved `ref:` string is never given to the DOM — the card says the file
 * is unavailable instead, which is what a reader needs to know when the file
 * was deleted after the document was published.
 *
 * `bytes` and `pages` ride the same patch and arrive as strings; both are
 * optional, and `pages` is absent for any file that did not say so cheaply
 * (lib/story/pdf-store) — a card never invents either.
 */
function FileCard({
  className,
  src,
  title,
  name,
  bytes,
  pages,
  interactive = true,
  ...props
}: React.ComponentProps<"div"> & {
  src?: string
  name?: string
  bytes?: string | number
  pages?: string | number
  interactive?: boolean
}) {
  const resolved = typeof src === "string" && src !== "" && !src.startsWith("ref:") ? src : null
  const label = title ?? name ?? fileNameFrom(resolved) ?? "File"
  const size = Number(bytes)
  const pageCount = Number(pages)
  const facts = [
    "PDF",
    Number.isFinite(size) && size > 0 ? formatFileSize(size) : null,
    Number.isFinite(pageCount) && pageCount > 0 ? `${pageCount} page${pageCount === 1 ? "" : "s"}` : null,
  ].filter(Boolean).join(" · ")

  return (
    <div
      data-slot="file"
      className={cn(
        "flex items-center gap-3 rounded-md border border-border bg-card p-4 text-card-foreground",
        className
      )}
      {...props}
    >
      <FileGlyph />
      <div className="min-w-0 flex-1">
        <div data-slot="file-name" className="truncate font-medium">
          {resolved && interactive ? (
            <a
              data-slot="file-link"
              href={resolved}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open ${label}`}
              className="underline underline-offset-2"
            >
              {label}
            </a>
          ) : (
            label
          )}
        </div>
        <div data-slot="file-meta" className="text-sm text-muted-foreground">
          {resolved ? facts : "file unavailable — the file this card names is gone"}
        </div>
      </div>
    </div>
  )
}

/** "…/2026/q3-report.pdf?v=2" → "q3-report.pdf" — the name a browser would give it. */
function fileNameFrom(url: string | null): string | null {
  if (!url) return null
  const path = url.split(/[?#]/)[0]
  const last = path.split("/").filter(Boolean).pop()
  return last ? decodeURIComponent(last) : null
}

/**
 * The document glyph: pure CSS and SVG so it serializes into a capture, the
 * same rule the <Video> play badge follows. Deliberately not an <Icon> — the
 * icon map is resolved by the SERVER per document (lib/story/icon-glyphs) and a
 * component that quietly needed one would draw nothing in the paths that do not
 * provide glyphs (the deck rail learned this the hard way).
 */
function FileGlyph() {
  return (
    <svg
      data-slot="file-glyph"
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="28"
      height="28"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 opacity-70"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  )
}

export { FileCard as File }
