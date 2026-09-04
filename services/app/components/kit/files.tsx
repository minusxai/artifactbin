"use client"

/**
 * `<Files>` — a folder's listing, and the ONE visual thing a folder document
 * has. Every folder is created with the same two-line scaffold (lib/folders
 * `folderScaffold`), so what this component draws is what every folder in the
 * deployment looks like, and improving it improves all of them at once.
 *
 * P1 SHIP: a plain list of title links, no styling, SSR and hydration
 * identical. That is deliberate and temporary — the folders work landed the
 * ROW, the doors and the children table first, and the look is P2's whole
 * phase (cards where a thumbnail exists, a format glyph where it does not, the
 * owner's view count and sparkline, `variant`, glyphs only in a capture). P2
 * replaces this body; the name, the props and the registry entry stay.
 *
 * Rows come from the store like every other bound embed: absent means the
 * query has not answered yet, which on a folder is the round trip between
 * first paint and the children landing.
 */
import * as React from "react"

import type { Row } from "@/lib/story/dataflow"

export interface FilesProps {
  /** The bound rows — a folder's children table (lib/folders CHILDREN_COLUMNS). */
  rows?: Row[]
  /** Density. Read by P2; accepted here so the scaffold's own markup is already valid. */
  variant?: string
}

const text = (value: unknown): string => (typeof value === "string" && value ? value : "")

function Files({ rows }: FilesProps) {
  const items = rows ?? []
  if (items.length === 0) return <ul aria-label="Files" data-slot="files" />
  return (
    <ul aria-label="Files" data-slot="files">
      {items.map((row, i) => {
        const id = text(row.id)
        const url = text(row.url) || (id ? `/a/${id}` : "")
        return (
          <li key={id || i}>
            {url ? <a href={url}>{text(row.title) || id}</a> : text(row.title) || id}
          </li>
        )
      })}
    </ul>
  )
}

export { Files }
