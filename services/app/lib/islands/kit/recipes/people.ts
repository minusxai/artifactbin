import { cn } from './cn';
import type { Recipe } from '.';
const SIGN_IN = "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4 py-2 has-[>svg]:px-3";
export const RECIPES: Record<string, Recipe> = {
  User: p => cn(p.fallback && !p.userId ? 'text-muted-foreground' : 'inline-flex items-center gap-1.5 align-middle', p.className as string | undefined),
  UserHandle: p => cn('text-muted-foreground', p.className as string | undefined),
  UserImage: p => cn('group/avatar relative flex size-8 shrink-0 overflow-hidden rounded-full select-none data-[size=lg]:size-10 data-[size=sm]:size-6', 'inline-flex shrink-0 align-middle', { sm: 'size-5', md: 'size-8', lg: 'size-12' }[String(p.size ?? 'sm')], p.className as string | undefined),
  SignIn: p => cn(SIGN_IN, p.className as string | undefined),
};
