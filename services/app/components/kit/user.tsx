"use client"

/**
 * `<User userId="usr_…" />` — A PERSON, SHOWN WHOLE.
 *
 * A `user` value is an account id (`usr_4hioqtx…`), and an id is not a person.
 * Before this component there was exactly one place an id became a name — a
 * DataTable cell — so anywhere else a page printed the raw id. This is that
 * one renderer, and the DataTable's user cells go through it too.
 *
 * It is now a COMPOSITION rather than a renderer of its own: the face
 * (components/kit/user-image.tsx) beside the handle
 * (components/kit/user-handle.tsx), so the two halves exist separately for a
 * page that wants only one of them and there is still a single tag for the
 * ordinary case. Nothing about a person is resolved here — the runtime adapter
 * (lib/story-runtime/StoryRuntimeApp usePerson) turns the authored reference
 * (`$_me`, a scalar `<Value>`, `$_row.paid_by` inside a `<For>`/`<Column>`)
 * into a concrete id and hands down the one server-computed `PersonCard` for
 * it, built under the visibility rules that already applied (never a global
 * user lookup, never an email). A render with no adapter behind it (the deck
 * rail's inert preview) therefore shows a neutral person rather than
 * pretending to know somebody.
 *
 * Three answers, deliberately distinct:
 *  - a person we may show → their picture and their handle;
 *  - an id we cannot name (unknown, or not visible to this viewer) → a neutral
 *    "Unknown person", never the raw id and never a hint that the id exists;
 *  - no id at all (a null field) → nothing, or `fallback` when the author gave one.
 */
import type { PersonCard } from "@artifactbin/contracts"
import { cn } from "./cn"
import { UserImage, hasPersonId } from "./user-image"
import { UserHandle, UNKNOWN_PERSON } from "./user-handle"

/** What an id we cannot name reads as (components/kit/user-handle.tsx). */
export { UNKNOWN_PERSON }

export interface UserProps {
  /**
   * The account id to show. The authored value is a reference the runtime
   * adapter resolves first; `null` is an unset field, and an unresolved
   * reference (no adapter) is treated as an id we cannot name.
   */
  userId?: unknown
  /** Source node identity, independent of the account. */
  id?: string
  /** The person, as this viewer may see them. Supplied by the adapter. */
  card?: PersonCard | null
  /**
   * The picture is part of a person and is drawn by default; `avatar={false}`
   * is how a page asks for the handle alone. Any other value — absent, `true`,
   * the bare authored attribute — shows it.
   */
  avatar?: boolean | string
  /** `false` prints the handle as text instead of a link to the profile. */
  link?: boolean
  /** What to draw when there is no id at all. Default: nothing. */
  fallback?: string
  className?: string
  [key: `data-${string}`]: unknown
}

export function User({ userId: id, card, avatar, link, fallback, className, ...props }: UserProps) {
  if (!hasPersonId(id)) {
    return fallback ? <span data-slot="user" className={cn("text-muted-foreground", className)} {...props}>{fallback}</span> : null
  }
  const showImage = avatar !== false && avatar !== "false"
  return (
    <span data-slot="user" className={cn("inline-flex items-center gap-1.5 align-middle", className)} {...props}>
      {showImage ? <UserImage userId={id} card={card} size="sm" decorative /> : null}
      <UserHandle userId={id} card={card} link={link} />
    </span>
  )
}
