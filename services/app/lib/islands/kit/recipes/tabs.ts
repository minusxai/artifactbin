import { cva } from 'class-variance-authority';
import { cn } from './cn';
import type { Recipe } from '.';

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground group-data-[orientation=horizontal]/tabs:h-9 group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "bg-muted",
        line: "gap-1 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)
export const RECIPES: Record<string, Recipe> = {
  Tabs: props => cn("group/tabs flex gap-2 data-[orientation=horizontal]:flex-col", props.className as string | undefined),
  TabsList: props => cn(tabsListVariants({ variant: props.variant as never }), props.className as string | undefined),
  // The chosen tab takes the design system's own fill pair (primary, primary-foreground), Segmented's contract: a
  // background-on-muted face vanished wherever a system paints its page ground and muted tint near-identically, and the
  // dark-only input wash repainted it the same way. Idle tabs tint with the ink on hover. The line variant keeps its
  // idiom: an unfilled chosen tab in ink, marked by an underline in the primary colour.
  TabsTrigger: props => cn("relative inline-flex h-[calc(100%-1px)] flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap text-muted-foreground transition-all group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4", "data-[state=inactive]:hover:bg-foreground/10 data-[state=inactive]:hover:text-foreground", "data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-xs", "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-[state=active]:bg-transparent group-data-[variant=line]/tabs-list:data-[state=active]:text-foreground group-data-[variant=line]/tabs-list:data-[state=active]:shadow-none", "after:absolute after:bg-primary after:opacity-0 after:transition-opacity group-data-[orientation=horizontal]/tabs:after:inset-x-0 group-data-[orientation=horizontal]/tabs:after:bottom-[-5px] group-data-[orientation=horizontal]/tabs:after:h-0.5 group-data-[orientation=vertical]/tabs:after:inset-y-0 group-data-[orientation=vertical]/tabs:after:-right-1 group-data-[orientation=vertical]/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-[state=active]:after:opacity-100", props.className as string | undefined),
  TabsContent: props => cn("flex-1 outline-none", props.className as string | undefined),
};
