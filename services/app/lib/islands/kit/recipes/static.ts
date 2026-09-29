import { cn } from './cn';
import type { Recipe } from '.';
import { videoWatchUrl } from '@/lib/story-ui/video-embed';

const withClass = (base: string): Recipe => (props) => cn(base, props.className as string | undefined);

/** Static faces: every class is calculated at publish, using the same merger as the React kit. */
export const RECIPES: Record<string, Recipe> = {
  Table: withClass('w-full caption-bottom text-sm'),
  TableHeader: withClass('[&_tr]:border-b'),
  TableBody: withClass('[&_tr:last-child]:border-0'),
  TableFooter: withClass('border-t bg-muted/50 font-medium [&>tr]:last:border-b-0'),
  TableRow: withClass('border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted'),
  TableHead: withClass('h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]'),
  TableCell: withClass('p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]'),
  TableCaption: withClass('mt-4 text-sm text-muted-foreground'),
  Separator: withClass('shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px'),
  Skeleton: withClass('animate-pulse rounded-md bg-accent'),
  BreadcrumbList: withClass('flex flex-wrap items-center gap-1.5 text-sm break-words text-muted-foreground sm:gap-2.5'),
  BreadcrumbItem: withClass('inline-flex items-center gap-1.5'),
  BreadcrumbLink: withClass('transition-colors hover:text-foreground'),
  BreadcrumbPage: withClass('font-normal text-foreground'),
  BreadcrumbSeparator: withClass('[&>svg]:size-3.5'),
  BreadcrumbEllipsis: withClass('flex size-9 items-center justify-center'),
  SlideDeck: withClass('@container w-full'),
  Slide: withClass('relative flex flex-col min-h-[var(--mx-vh,760px)]'),
  Video: (props) => withClass(videoWatchUrl(props.src as string | undefined) ? 'relative aspect-video w-full overflow-hidden rounded-md bg-muted' : 'flex aspect-video w-full items-center justify-center rounded-md border border-border bg-muted text-sm text-muted-foreground')(props),
  File: withClass('flex items-center gap-3 rounded-md border border-border bg-card p-4 text-card-foreground'),
};
