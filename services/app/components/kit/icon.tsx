"use client"

import * as React from "react"

import { cn } from "./cn"
import { iconGlyphKey, FALLBACK_ICON_KEY, type GlyphMap } from "@/lib/story-ui/icon-contract"

/**
 * The glyphs available to this render, resolved server-side and carried in the
 * island beside refData (lib/story/icon-glyphs). Deliberately a SEPARATE channel
 * from the AST of the document: the glyph is injected as raw markup, so letting an
 * author reach it — by writing the prop themselves — would be an injection hole.
 * Nothing an author writes lands here; the server builds this map from the names
 * it found and nothing else.
 *
 * There is no second, full-map renderer: a draft an author is typing resolves
 * its icons through the same door every stored version does (storyUpdateParts,
 * pushed into the document), so the map can never be out of step with the
 * names the server actually found.
 */
const GlyphContext = React.createContext<GlyphMap>({})

export const IconGlyphProvider = GlyphContext.Provider

/** Sized text-small by default; an authored size-* class wins via cn(). */
export const ICON_BASE_CLASS = "inline-block size-4 shrink-0 align-[-0.125em]"

/*
 * The <svg> attributes lucide uses, in the order lucide writes them. Both matter:
 * a document is server-rendered to a string and client-rendered into a DOM, and
 * React compares them — so this component must emit exactly what lucide emits, or
 * every document with an icon takes a hydration mismatch (#418: React discards the
 * server tree and repaints the root). Proven byte-for-byte against the real
 * component in lib/story/__tests__/icon-glyphs.test.tsx.
 */
const SVG_ATTRS = {
  xmlns: "http://www.w3.org/2000/svg",
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const

/** The lucide rule: an a11y prop on the icon means it is NOT decorative. */
const hasA11yProp = (props: Record<string, unknown>): boolean => {
  for (const prop in props) {
    if (prop.startsWith("aria-") || prop === "role" || prop === "title") return true
  }
  return false
}

/** The mergeClasses of lucide: drop empties, drop duplicates, join. */
const mergeClasses = (...classes: (string | undefined)[]): string =>
  classes
    .filter((c, i, arr): c is string => Boolean(c) && c!.trim() !== "" && arr.indexOf(c) === i)
    .join(" ")
    .trim()

export interface IconProps extends React.SVGAttributes<SVGSVGElement> {
  /** Lucide icon name — kebab-case ('circle-check') or PascalCase ('CircleCheck'). */
  name: string
}

/**
 * A lucide icon by name, rendered from the resolved glyph. An unresolved name
 * renders nothing rather than a wrong glyph — the server resolves unknown names to
 * the question-mark glyph, so a typo still stays visible in the document.
 */
function Icon({ name, className, ...props }: IconProps) {
  const glyphs = React.useContext(GlyphContext)
  // A name that resolves to nothing — a typo, an empty string, or no `name` at
  // all — draws the question mark, which the resolver ships with any document that
  // has an <Icon> in it. A bad name must stay VISIBLE.
  const glyph = glyphs[iconGlyphKey(String(name))] ?? glyphs[FALLBACK_ICON_KEY]
  if (!glyph) return null
  return (
    <svg
      {...SVG_ATTRS}
      className={mergeClasses("lucide", glyph.cls, cn(ICON_BASE_CLASS, className))}
      {...(!hasA11yProp(props) && { "aria-hidden": "true" })}
      data-slot="icon"
      {...props}
      dangerouslySetInnerHTML={{ __html: glyph.inner }}
    />
  )
}

export { Icon }
