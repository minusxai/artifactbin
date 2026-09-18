"use client"

/**
 * `<UserHandle id="usr_…" />` — A PERSON, BY THE NAME THEY CHOSE.
 *
 * The name half of `<User>` (components/kit/user.tsx). A handle is the one
 * public address a person has, so this is also the one place a document turns
 * into a door to somebody's profile — and every door out of a document opens
 * the TOP window (`target="_top"`, lib/story/reader-chrome), never the frame
 * the document is served in.
 *
 * It resolves NOTHING itself: the runtime adapter
 * (lib/story-runtime/StoryRuntimeApp usePerson) hands it the server-computed
 * `PersonCard` for an id the server already put in front of this viewer.
 *
 * Four answers, deliberately distinct:
 *  - a card with a handle → `@handle`, linked unless the author said not to;
 *  - a card without one → the display name, and no link to nowhere;
 *  - an id we cannot name → a neutral "Unknown person", never the raw id and
 *    never a hint that the id exists;
 *  - no id at all → nothing, or `fallback` when the author gave one.
 */
import type { PersonCard } from "@artifactbin/contracts"
import { cn } from "./cn"
import { hasPersonId } from "./user-image"

/** What an id we cannot name reads as. Never the raw id. */
export const UNKNOWN_PERSON = "Unknown person"

export interface UserHandleProps {
  /**
   * The account id to show. The authored value is a reference the runtime
   * adapter resolves first; `null` is an unset field, and an unresolved
   * reference (no adapter) is treated as an id we cannot name.
   */
  id?: unknown
  /** The person, as this viewer may see them. Supplied by the adapter. */
  card?: PersonCard | null
  /** `false` prints the handle as text instead of a link to the profile. */
  link?: boolean
  /** What to draw when there is no id at all. Default: nothing. */
  fallback?: string
  className?: string
  [key: `data-${string}`]: unknown
}

export function UserHandle({ id, card, link, fallback, className, ...props }: UserHandleProps) {
  if (!hasPersonId(id)) {
    return fallback ? <span data-slot="user-handle" className={cn("text-muted-foreground", className)} {...props}>{fallback}</span> : null
  }
  if (!card) {
    return <span data-slot="user-handle" data-unknown="" className={cn("text-muted-foreground", className)} {...props}>{UNKNOWN_PERSON}</span>
  }
  if (!card.handle) {
    return <span data-slot="user-handle" className={cn(className)} {...props}>{card.name}</span>
  }
  const handle = `@${card.handle}`
  if (link === false) {
    return <span data-slot="user-handle" className={cn(className)} {...props}>{handle}</span>
  }
  return (
    <a
      data-slot="user-handle"
      href={`/${handle}`}
      target="_top"
      rel="noopener"
      className={cn("underline-offset-2 hover:underline", className)}
      {...props}
    >
      {handle}
    </a>
  )
}
