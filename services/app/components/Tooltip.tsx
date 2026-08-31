"use client"

import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"
// Composed here rather than through `kit/cn`: this is APP chrome, and the
// reader graph must not reach the story component layer to merge two class
// strings (lib/__tests__/reader-bundle-hygiene.test.ts). tailwind-merge is not
// optional decoration — without it a caller's `px-4` and the built-in `px-2.5`
// both survive and stylesheet order decides which one paints.
import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

const TooltipPortalContext = React.createContext(true)

type TooltipSide = "top" | "right" | "bottom" | "left"
type TooltipAlign = "start" | "center" | "end"
type TooltipPlacement = TooltipSide | `${TooltipSide}-${Exclude<TooltipAlign, "center">}`

type TooltipRootProps = React.ComponentProps<typeof TooltipPrimitive.Root>

export interface TooltipProps extends Omit<TooltipRootProps, "children"> {
  children: React.ReactElement
  content: React.ReactNode
  contentProps?: Omit<React.ComponentProps<typeof TooltipPrimitive.Content>, "children"> & {
    portalled?: boolean
  }
  disabled?: boolean
  portalled?: boolean
  positioning?: {
    placement?: TooltipPlacement
    gutter?: number
  }
}

function TooltipProvider({
  delayDuration = 300,
  portalled,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider> & {
  /**
   * App tooltips portal to the document by default so transformed and
   * overflow-hidden panels cannot clip or offset them. Story embeds opt out
   * once at their root, and content stays inline rather than portalling out.
   */
  portalled?: boolean
}) {
  const inheritedPortalled = React.useContext(TooltipPortalContext)

  return (
    <TooltipPortalContext.Provider value={portalled ?? inheritedPortalled}>
      <TooltipPrimitive.Provider
        data-slot="tooltip-provider"
        delayDuration={delayDuration}
        skipDelayDuration={100}
        {...props}
      />
    </TooltipPortalContext.Provider>
  )
}

function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

// STORY PATCH vs shadcn source: `portalled={false}` keeps a document's floating
// content inside the document's own root rather than the app's body — a served
// document is its own window, and a portal to `document.body` would land in the
// wrong one. `collisionBoundary` is left at its Radix default; mounting code may
// pass the document root where it matters.
function TooltipContent({
  className,
  sideOffset = 6,
  collisionPadding = 8,
  portalled,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content> & {
  /** Override the nearest provider's portal behavior for an exceptional host. */
  portalled?: boolean
}) {
  const inheritedPortalled = React.useContext(TooltipPortalContext)
  const isPortalled = portalled ?? inheritedPortalled
  const content = (
    <TooltipPrimitive.Content
      data-slot="tooltip-content"
      data-story-floating=""
      sideOffset={sideOffset}
      collisionPadding={collisionPadding}
      className={twMerge(clsx(
        "pointer-events-none z-[100] w-max max-w-[min(28rem,calc(100vw-1rem))] whitespace-normal rounded-md px-2.5 py-1.5 text-left text-xs leading-normal shadow-md",
        isPortalled
          ? "border border-edge-bright bg-surface text-fg"
          : "bg-foreground text-background",
        className
      ))}
      {...props}
    >
      {children}
      <TooltipPrimitive.Arrow
        width={10}
        height={5}
        stroke={isPortalled ? "var(--color-edge-bright)" : undefined}
        strokeWidth={isPortalled ? 1 : undefined}
        strokeLinejoin="round"
        className={isPortalled ? "z-[100] fill-surface" : "z-[100] fill-foreground"}
      />
    </TooltipPrimitive.Content>
  )

  return isPortalled
    ? (
        <TooltipPrimitive.Portal>
          {/* Theme tokens are scoped to data-mx-theme-host. A body portal is
              outside the app/file host, so it must carry its own token scope. */}
          <div data-mx-theme-host="">{content}</div>
        </TooltipPrimitive.Portal>
      )
    : content
}

/**
 * The single app tooltip supports both the Radix compound API and the compact
 * `content="…"` form used by older call sites.
 */
function Tooltip(props: TooltipRootProps | TooltipProps) {
  if (!("content" in props)) {
    return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
  }

  const {
    children,
    content,
    contentProps,
    disabled,
    portalled = true,
    positioning,
    ...rootProps
  } = props

  if (disabled) return children

  const [side = "top", placementAlign] = (positioning?.placement ?? "top").split("-") as [TooltipSide, TooltipAlign?]
  const align = placementAlign ?? "center"

  return (
    <TooltipProvider>
      <TooltipPrimitive.Root data-slot="tooltip" {...rootProps}>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent
          side={side}
          align={align}
          sideOffset={positioning?.gutter}
          portalled={portalled}
          {...contentProps}
        >
          {content}
        </TooltipContent>
      </TooltipPrimitive.Root>
    </TooltipProvider>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
