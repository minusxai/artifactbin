"use client"

/**
 * `<UserImage id="usr_…" />` — A PERSON'S FACE, AND NOTHING ELSE.
 *
 * The picture half of `<User>` (components/kit/user.tsx), separate so a page
 * can draw a row of faces, or a face on its own, without also taking the name.
 *
 * Like every person primitive it resolves NOTHING: the runtime adapter
 * (lib/story-runtime/StoryRuntimeApp usePerson) hands it the server-computed
 * `PersonCard` for an id the server already put in front of this viewer, and a
 * render with no adapter behind it (the deck rail's inert preview) is exactly
 * an id we cannot name. The address of the picture itself comes from the ONE
 * place a stored key becomes a URL (lib/avatars avatarUrl), never from here.
 *
 * Four answers, deliberately distinct:
 *  - a card with a picture → that picture, painted over the initial below it,
 *    so an address that stops answering reveals a person and never a browser's
 *    broken-image glyph;
 *  - a card without one → the person's initial on the colour the ID alone
 *    decides (lib/person-face, shared with the app and the reader rail), so the
 *    server string and the hydrated tree agree, two people are told apart at a
 *    glance, and one person is one colour everywhere. Never a broken image,
 *    never a grey blank;
 *  - an id we cannot name → a neutral `?`, never the raw id;
 *  - no id at all → nothing, or `fallback` when the author gave one.
 */
import type { PersonCard } from "@artifactbin/contracts"
import { personFaceBackground, personInitial } from "@/lib/person-face"
import { cn } from "./cn"
import { Avatar, AvatarFallback } from "./avatar"

/** 20px / 32px / 48px — the three sizes a document may ask for. */
export type UserImageSize = "sm" | "md" | "lg"

const BOX: Record<UserImageSize, string> = { sm: "size-5", md: "size-8", lg: "size-12" }
const GLYPH: Record<UserImageSize, string> = { sm: "text-[10px]", md: "text-xs", lg: "text-base" }

export interface UserImageProps {
  /**
   * The account id to show. The authored value is a reference the runtime
   * adapter resolves first; `null` is an unset field, and an unresolved
   * reference (no adapter) is treated as an id we cannot name.
   */
  id?: unknown
  /** The person, as this viewer may see them. Supplied by the adapter. */
  card?: PersonCard | null
  size?: UserImageSize
  /**
   * The name is shown beside it (what `<User>` does), so the picture repeats it
   * and belongs out of the accessibility tree rather than read twice.
   */
  decorative?: boolean
  /** What to draw when there is no id at all. Default: nothing. */
  fallback?: string
  className?: string
  [key: `data-${string}`]: unknown
}

/**
 * Is there an id here AT ALL? The three person primitives share this one test
 * so they agree on the difference that matters: an UNSET field (nothing, or the
 * author's `fallback`) versus an id we simply cannot name. An id of a shape we
 * never mint is the second, not the first.
 */
export const hasPersonId = (id: unknown): boolean => (typeof id === "string" ? id !== "" : id !== null && id !== undefined)

export function UserImage({ id, card, size = "sm", decorative, fallback, className, ...props }: UserImageProps) {
  if (!hasPersonId(id)) {
    return fallback ? <span data-slot="user-image" className={cn("text-muted-foreground", className)} {...props}>{fallback}</span> : null
  }
  const key = typeof id === "string" ? id : null
  const box = cn("shrink-0 align-middle", BOX[size], className)
  if (!card || key === null) {
    return (
      <Avatar size="default" data-unknown="" aria-hidden="true" className={box} {...props}>
        <AvatarFallback className={GLYPH[size]}>?</AvatarFallback>
      </Avatar>
    )
  }
  // The generated avatar: the initial, on the colour lib/person-face decides
  // for the id — the same colour the app draws for this person. Inline style is
  // refused in authored markup and allowed here, which is what lets a colour
  // computed per person exist at all.
  const style = { backgroundColor: personFaceBackground(key) }
  return (
    <Avatar
      size="default"
      className={box}
      style={style}
      {...(decorative ? { "aria-hidden": "true" as const } : card.image ? {} : { role: "img", "aria-label": card.name })}
      {...props}
    >
      {/*
        * The initial is ALWAYS underneath, and the picture is painted over it.
        * A picture is an address (lib/avatars), and an address can fail — a
        * replaced object, a route not answering — so the layer below is what
        * keeps the promise this component makes: never a broken image, never a
        * grey blank. Beside a name the alt is empty, which is also what stops a
        * browser drawing its own broken-image glyph over the initial.
        */}
      <AvatarFallback className={cn("bg-transparent font-medium text-white", GLYPH[size])}>{personInitial(card.name)}</AvatarFallback>
      {card.image ? (
        <img
          data-slot="avatar-image"
          className="absolute inset-0 aspect-square size-full object-cover"
          src={card.image}
          alt={decorative ? "" : card.name}
          {...(decorative ? { "aria-hidden": "true" as const } : {})}
        />
      ) : null}
    </Avatar>
  )
}
