"use client"

/**
 * `<User id="usr_…" />` — A PERSON, SHOWN BY NAME.
 *
 * A `user` value is an account id (`usr_4hioqtx…`), and an id is not a person.
 * Before this component there was exactly one place an id became a name — a
 * DataTable cell — so anywhere else a page printed the raw id. This is that
 * one renderer, and the DataTable's user cells now go through it too.
 *
 * It resolves NOTHING itself: the runtime adapter
 * (lib/story-runtime/StoryRuntimeApp) turns the authored reference
 * (`$_me`, a scalar `<Value>`, `$_row.paid_by` inside a `<For>`/`<Column>`)
 * into a concrete id and looks its label up in the SAME `userLabels` map the
 * DataTable reads — which the server computes under the visibility rules that
 * already applied (never a global user lookup, never an email). A render with
 * no adapter behind it (the deck rail's inert preview) therefore shows the
 * neutral label rather than pretending to know somebody.
 *
 * Three answers, deliberately distinct:
 *  - a name we may show → the name, plus an initial avatar when `avatar` is set;
 *  - an id we cannot name (unknown, or not visible to this viewer) → a neutral
 *    "Unknown person", never the raw id and never a hint that the id exists;
 *  - no id at all (a null field) → nothing, or `fallback` when the author gave one.
 */
import * as React from "react"

import { cn } from "./cn"
import { Avatar, AvatarFallback } from "./avatar"

/** What an id we cannot name reads as. Never the raw id. */
export const UNKNOWN_PERSON = "Unknown person"

export interface UserProps {
  /**
   * The account id to show. The authored value is a reference the runtime
   * adapter resolves first; `null` is an unset field, and an unresolved
   * reference (no adapter) is treated as an id we cannot name.
   */
  id?: unknown
  /** The display name, when this viewer may see one. Supplied by the adapter. */
  label?: string | null
  /** Draw an initial avatar before the name. */
  avatar?: boolean | string
  /** What to draw when there is no id at all. Default: nothing. */
  fallback?: string
  className?: string
  [key: `data-${string}`]: unknown
}

/** The first letter of a display name, for the initial avatar. */
const initialOf = (name: string): string => (name.trim()[0] ?? "?").toUpperCase()

export function User({ id, label, avatar, fallback, className, ...props }: UserProps) {
  const hasId = typeof id === "string" ? id !== "" : id !== null && id !== undefined
  if (!hasId) {
    return fallback ? <span data-slot="user" className={cn("text-muted-foreground", className)} {...props}>{fallback}</span> : null
  }
  const name = typeof label === "string" && label.trim() !== "" ? label : null
  if (!name) {
    return <span data-slot="user" data-unknown="" className={cn("text-muted-foreground", className)} {...props}>{UNKNOWN_PERSON}</span>
  }
  const showAvatar = avatar === true || avatar === "" || avatar === "true"
  if (!showAvatar) return <span data-slot="user" className={cn(className)} {...props}>{name}</span>
  return (
    <span data-slot="user" className={cn("inline-flex items-center gap-1.5 align-middle", className)} {...props}>
      <Avatar size="sm" aria-hidden="true"><AvatarFallback>{initialOf(name)}</AvatarFallback></Avatar>
      {name}
    </span>
  )
}
