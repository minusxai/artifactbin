import { cn } from './cn';
import type { Recipe } from '.';
const SIGN_IN = "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4 py-2 has-[>svg]:px-3";
export const RECIPES: Record<string, Recipe> = {
  User: p => cn(p.fallback && !p.userId ? 'text-muted-foreground' : 'inline-flex items-center gap-1.5 align-middle', p.className as string | undefined),
  UserHandle: p => cn('text-muted-foreground', p.className as string | undefined),
  UserImage: p => cn('group/avatar relative flex size-8 shrink-0 overflow-hidden rounded-full select-none data-[size=lg]:size-10 data-[size=sm]:size-6', 'inline-flex shrink-0 align-middle', { sm: 'size-5', md: 'size-8', lg: 'size-12' }[String(p.size ?? 'sm')], p.className as string | undefined),
  SignIn: p => cn(SIGN_IN, p.className as string | undefined),
};

const AVATAR_BASE = "group/avatar relative flex size-8 shrink-0 overflow-hidden rounded-full select-none data-[size=lg]:size-10 data-[size=sm]:size-6";
const AVATAR_FALLBACK_BASE = "flex size-full items-center justify-center rounded-full bg-muted text-sm text-muted-foreground group-data-[size=sm]/avatar:text-xs";
const BOX: Record<string, string> = { sm: 'size-5', md: 'size-8', lg: 'size-12' };
const GLYPH: Record<string, string> = { sm: 'text-[10px]', md: 'text-xs', lg: 'text-base' };
const imageClasses = (size: string, className?: string) => ({
  fallback: cn('text-muted-foreground', className),
  avatar: cn(AVATAR_BASE, cn('inline-flex shrink-0 align-middle', BOX[size], className)),
  initial: cn(AVATAR_FALLBACK_BASE, cn('bg-transparent font-medium text-white', GLYPH[size])),
  unknownInitial: cn(AVATAR_FALLBACK_BASE, GLYPH[size]),
});
const handleClasses = (className?: string) => ({
  muted: cn('text-muted-foreground', className), plain: cn(className), link: cn('underline-offset-2 hover:underline', className),
});

/**
 * A PERSON'S CLASSES, EVERY STATE, AT COMPILE TIME. Which class a person's element carries depends on whom it
 * resolves to in the browser (a guest's fallback, an unknown id, a card), and each is today's component merging
 * an author's className with tailwind-merge (components/kit/user, user-image, user-handle, avatar). Readers never
 * download tailwind-merge, so the compiler evaluates every state here and hands the port the map (`classes`).
 */
export function peopleClasses(tag: string, props: Record<string, unknown>): Record<string, unknown> | null {
  const className = typeof props.className === 'string' ? props.className : undefined;
  if (tag === 'UserImage') return imageClasses(String(props.size ?? 'sm'), className);
  if (tag === 'UserHandle') return handleClasses(className);
  if (tag === 'User') return { fallback: cn('text-muted-foreground', className), person: cn('inline-flex items-center gap-1.5 align-middle', className), image: imageClasses('sm'), handle: handleClasses() };
  return null;
}
