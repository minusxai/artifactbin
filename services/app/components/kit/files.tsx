"use client"

/**
 * `<Files>` — a folder's listing, and the ONE visual thing a folder document
 * has. Every folder is created with the same two-line scaffold (lib/folders
 * `folderScaffold`), so what this component draws is what every folder in the
 * deployment looks like, and improving it improves all of them at once.
 *
 * Rows come from the store like every other bound embed (StoryRuntimeApp's
 * FilesAdapter): absent means the query has not answered yet, which on a folder
 * is the round trip between first paint and the children landing. Their shape
 * is fixed — lib/folders CHILDREN_COLUMNS — and every viewer-dependent decision
 * was already made on the server: which rows exist at all, whether a row has a
 * `thumbnail`, and whether it carries `views`/`sparkline`. NOTHING here filters;
 * a null is a null because the server decided this viewer does not get it.
 *
 * Three rules, each with a reason:
 *
 *  - THE CARD, ELSE THE GLYPH. A public or unlisted document has an og card
 *    (`/a/<id>/export?mode=card`) worth showing; a private one, and every
 *    folder, has none, and draws the glyph for its FORMAT instead
 *    (lib/story-ui/file-glyphs, the list the SERVER resolves for this component
 *    — see lib/story/icon-glyphs, which learned `<Files>` because a folder's
 *    document names no `<Icon>` anywhere and would otherwise ship no glyphs).
 *  - THE NUMBERS ARE OPTIONAL FIELDS, and absent is not zero. `views: null`
 *    means "not counted for you", so the mark is omitted entirely rather than
 *    printed as 0 — the same judgement the shelf's ViewsMark makes.
 *  - A CAPTURE DRAWS GLYPHS ONLY. `/export` photographs this document at
 *    `chrome=0`; a thumbnail here is another artifact's own capture, so a card
 *    of a folder would be a capture waiting on N captures, and a private
 *    child's card is a 404 to the session-less browser taking the shot.
 */
import * as React from "react"

import { cn } from "./cn"
import { Icon } from "./icon"
import { fileGlyphName } from "@/lib/story-ui/file-glyphs"
import { sparklineSvg } from "@/lib/viz/spark-markup"
import type { Row } from "@/lib/story/dataflow"

export interface FilesProps extends Omit<React.ComponentProps<"ul">, "children"> {
  /** The bound rows — a folder's children table (lib/folders CHILDREN_COLUMNS). */
  rows?: Row[]
  /** Density: `icons` is the compact grid a folder is scaffolded with; `tiles` is the shelf's card size. */
  variant?: string
  /** True inside a `chrome=0` capture — glyphs only. */
  capture?: boolean
}

const text = (value: unknown): string => (typeof value === "string" && value ? value : "")
const count = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null)

/** The two densities, as the only thing `variant` decides. */
const GRID: Record<string, string> = {
  icons: "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4",
  tiles: "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3",
}

/**
 * The rest of the props reach the <ul> so the node's `data-mx-ast` stamp lands
 * in the DOM — that stamp is what makes a component selectable in the editor
 * and writable back into the source, and a component that swallows it is
 * unreachable (lib/story-ui selectable-kit).
 */
function Files({ rows, variant = "icons", capture = false, className, ...rest }: FilesProps) {
  const items = rows ?? []
  const density = variant === "tiles" ? "tiles" : "icons"
  return (
    <ul
      aria-label="Files"
      data-slot="files"
      data-variant={density}
      className={cn("my-6 list-none p-0", items.length ? GRID[density] : "", className)}
      {...rest}
    >
      {items.map((row, i) => {
        const id = text(row.id)
        const name = text(row.title) || id || "Untitled"
        const url = text(row.url) || (id ? `/a/${id}` : "")
        const format = text(row.format) || "markup"
        const thumbnail = capture ? "" : text(row.thumbnail)
        const views = count(row.views)
        const spark = text(row.sparkline)
        // A folder's own child count, when the document's query computed one.
        // The children table carries no such column today, so this draws for an
        // author who selected one and for nobody else.
        const inside = format === "folder" ? count(row.count) : null
        return (
          <li key={id || i} data-slot="files-item" className="m-0 p-0">
            <a
              href={url || undefined}
              aria-label={`Open ${name}`}
              data-format={format}
              className={cn(
                "group flex flex-col gap-2 rounded-md border border-border bg-card p-2 text-card-foreground no-underline",
                density === "tiles" && "gap-3 p-3",
              )}
            >
              <span className="flex aspect-[40/21] w-full items-center justify-center overflow-hidden rounded-sm bg-muted">
                {thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element -- the card IS the artifact's own capture; no optimizer.
                  <img src={thumbnail} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                ) : (
                  <span data-glyph={format} className="flex items-center justify-center opacity-70">
                    <Icon name={fileGlyphName(format)} className={density === "tiles" ? "size-8" : "size-6"} />
                  </span>
                )}
              </span>
              <span data-slot="files-title" className={cn("truncate font-medium", density === "icons" && "text-sm")}>
                {name}
              </span>
              {inside !== null && (
                <span data-slot="files-count" className="text-xs text-muted-foreground">
                  {inside} item{inside === 1 ? "" : "s"}
                </span>
              )}
              {views !== null && (
                <span
                  aria-label={`${views} views`}
                  data-slot="files-views"
                  className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground"
                >
                  <span className="shrink-0 tabular-nums">
                    {views} view{views === 1 ? "" : "s"}
                  </span>
                  {spark && (
                    <span
                      aria-hidden="true"
                      className="flex h-4 min-w-0 flex-1 items-center [&>svg]:h-full [&>svg]:w-full"
                      // The picture is a server render (lib/viz/sparkline) made
                      // fluid by the pure module the shelf also draws through;
                      // anything that is not one comes back an empty <svg>.
                      dangerouslySetInnerHTML={{ __html: sparklineSvg(spark) }}
                    />
                  )}
                </span>
              )}
            </a>
          </li>
        )
      })}
    </ul>
  )
}

export { Files }
