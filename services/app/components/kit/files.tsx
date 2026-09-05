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
 * Five rules, each with a reason:
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
 *  - THE HEAD IS THE ROW'S, NOT THE SHELF'S. Name, trail and id arrive as
 *    `folder` (lib/story-ui/folder-head) because none of them can be derived
 *    from the children — a folder with one document and a folder with none
 *    must both say where they are. A listing that is not a folder's gets none
 *    and looks exactly as it did.
 *  - EMPTY NEEDS TWO FACTS. "Nothing here yet" is a claim about the QUERY —
 *    that it answered, and answered with nothing — and only `settled` carries
 *    the first. Without it, "not asked yet" and "nothing here" are the same
 *    blank page, which is what shipped: a folder either lies for a round trip
 *    or never says anything at all. Blank while unsettled is paint-first, the
 *    same trade the whole document makes.
 *
 * WHAT THE HEAD LOOKS LIKE, and why. A folder page is not a document — nobody
 * reads it, they scan it and leave — so the one thing given any weight is the
 * NAME, set larger than the document's body against a count that is
 * deliberately quiet, with a single hairline between the two of them and the
 * shelf. That rule is the only line on the page and it is structural: identity
 * above, contents below. No label saying FOLDER (the address says so), no icon
 * beside the name (every tile below already carries one), no interpuncts (the
 * count is a sentence, because "3 documents and 1 folder" is something a
 * person would say and "3 · 1" is something a database would).
 */
import * as React from "react"

import { cn } from "./cn"
import { Icon } from "./icon"
import { fileGlyphName } from "@/lib/story-ui/file-glyphs"
import type { FolderHead } from "@/lib/story-ui/folder-head"
import { sparklineSvg } from "@/lib/viz/spark-markup"
import type { Row } from "@/lib/story/dataflow"

export interface FilesProps extends Omit<React.ComponentProps<"ul">, "children"> {
  /** The bound rows — a folder's children table (lib/folders CHILDREN_COLUMNS). */
  rows?: Row[]
  /**
   * TRUE ONCE THE BOUND QUERY HAS ANSWERED. The store knows it (its pending
   * set); the component cannot, and the empty state is a lie without it.
   */
  settled?: boolean
  /** The folder this is a listing OF — absent on any other bound `<Files>`. */
  folder?: FolderHead
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
 * WHAT IS ON THE SHELF, as a sentence. Folders are counted apart from
 * everything else because they are the one row that is a place rather than a
 * thing — "4 items" answers a different question from "3 documents and 1
 * folder", and the second is the one somebody scanning a shelf is asking.
 */
function summarise(rows: Row[]): string {
  const folders = rows.filter((r) => text(r.format) === "folder").length
  const docs = rows.length - folders
  const parts: string[] = []
  if (docs) parts.push(`${docs} document${docs === 1 ? "" : "s"}`)
  if (folders) parts.push(`${folders} folder${folders === 1 ? "" : "s"}`)
  return parts.join(" and ")
}

/** The trail, the name and the count — the folder saying where it is. */
function Head({ folder, summary }: { folder: FolderHead; summary: string }) {
  return (
    <header data-slot="files-head" className="mb-4 border-b border-border pb-3">
      {folder.trail.length > 0 && (
        <nav data-slot="files-trail" className="mb-1 flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
          {folder.trail.map((crumb, i) => (
            <React.Fragment key={crumb.id}>
              {i > 0 && <span aria-hidden="true">/</span>}
              <a
                href={crumb.url}
                aria-label={`Up to ${crumb.title ?? crumb.id}`}
                className="text-muted-foreground no-underline hover:text-foreground"
              >
                {crumb.title ?? crumb.id}
              </a>
            </React.Fragment>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 data-slot="files-name" className="m-0 text-2xl leading-tight font-semibold tracking-tight text-foreground">
          {folder.title ?? folder.id}
        </h2>
        {summary && (
          <span data-slot="files-count" className="shrink-0 text-sm tabular-nums text-muted-foreground">
            {summary}
          </span>
        )}
      </div>
    </header>
  )
}

/**
 * AN EMPTY SCREEN IS AN INVITATION TO ACT, so it names both ways in: the one a
 * person has (the row menu in the chrome around this document) and the one an
 * agent has (the id it publishes under). The id is the folder's OWN, which is
 * why it comes down with the head rather than being read out of the query's
 * SQL — a customised folder can name anything in there.
 */
function Empty({ id }: { id: string }) {
  return (
    <div data-slot="files-empty" className="rounded-md border border-dashed border-border px-4 py-6 text-muted-foreground">
      <p className="m-0 text-foreground">Nothing here yet.</p>
      <p className="m-0 mt-1 text-sm">
        Move a document in from its ⋯ menu, or give your agent{" "}
        <code className="rounded-sm bg-muted px-1 py-0.5 text-[0.9em]">parent_id: &quot;{id}&quot;</code> when it publishes.
      </p>
    </div>
  )
}

/**
 * The rest of the props reach the ROOT so the node's `data-mx-ast` stamp lands
 * in the DOM — that stamp is what makes a component selectable in the editor
 * and writable back into the source, and a component that swallows it is
 * unreachable (lib/story-ui selectable-kit). It moved from the `<ul>` to the
 * section when the head arrived: the stamp names the whole component, and a
 * click on the folder's own name is still a click on `<Files>`.
 */
function Files({ rows, settled = false, folder, variant = "icons", capture = false, className, ...rest }: FilesProps) {
  const items = rows ?? []
  const density = variant === "tiles" ? "tiles" : "icons"
  // Settled AND empty AND a folder to name. Without the last, an authored
  // `<Files data="$q">` over a query with no rows would be told to file
  // documents into an id that is not a folder's.
  const empty = settled && items.length === 0 && !!folder
  return (
    <section
      data-slot="files"
      /*
       * THE GUTTER IS THE HEAD'S, and only the head's. `folder` present means
       * this component IS the document — a folder's whole source is one
       * `<Files>` and the column it renders in (`.mx-doc`) supplies no padding
       * of its own, so the listing sat flush against both edges of the window
       * and of every og card taken of it. An authored `<Files data="$q">`
       * inside somebody's own layout keeps the plain vertical rhythm, because
       * there the wrapper already owns the gutter and a second one would show.
       */
      className={cn(folder ? "px-6 py-8 sm:px-8" : "my-6", className)}
      {...rest}
    >
      {folder && <Head folder={folder} summary={summarise(items)} />}
      {empty && <Empty id={folder.id} />}
      <ul
        aria-label="Files"
        data-slot="files-list"
        data-variant={density}
        className={cn("m-0 list-none p-0", items.length ? GRID[density] : "")}
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
                "group flex flex-col gap-2 rounded-md border border-border bg-card p-2 text-card-foreground no-underline transition-colors hover:border-muted-foreground/40",
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
    </section>
  )
}

export { Files }
