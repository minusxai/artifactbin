"use client"

/**
 * `<SignIn>Join in</SignIn>` — THE ONE THING A GUEST CAN DO ABOUT BEING A GUEST.
 *
 * A button-styled link to `/login` that comes back to this exact address —
 * path, query and hash — so a reader who narrowed a dashboard and then signed
 * in is returned to the document they were looking at, not to its default.
 * That address is `lib/login-href`'s job and this reuses it verbatim, including
 * its deliberate "bare /login until mounted": the callback cannot be computed
 * during a server render without the two renders disagreeing, and React throws
 * the whole server tree away when they do (#418).
 *
 * `target="_top"`, as every other door out of a document has (lib/story/reader-chrome):
 * a served document is a framed, sandboxed page, and navigating it in place
 * would put the login form inside the document's own frame.
 *
 * Static markup only — no script reaches it, and it carries no state. For a
 * signed-in viewer the runtime adapter renders nothing at all, because there is
 * nothing to ask them for.
 */
import * as React from "react"

import { cn } from "./cn"
import { buttonVariants } from "./button"
import { useLoginHref } from "@/lib/login-href"

export interface SignInProps {
  children?: React.ReactNode
  className?: string
  [key: `data-${string}`]: unknown
}

/** The label when the author wrote no children. */
export const SIGN_IN_LABEL = "Sign in"

export function SignIn({ children, className, ...props }: SignInProps) {
  const { href, onClick } = useLoginHref()
  const empty = React.Children.toArray(children).length === 0
  return (
    <a
      data-slot="sign-in"
      href={href}
      onClick={onClick}
      target="_top"
      rel="noopener"
      className={cn(buttonVariants({ variant: "default", size: "default" }), className)}
      {...props}
    >
      {empty ? SIGN_IN_LABEL : children}
    </a>
  )
}
