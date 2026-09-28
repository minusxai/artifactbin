import { cn } from './cn';
import type { Recipe } from '.';
import { RECIPES as BASIC } from './basic';

export const RECIPES: Record<string, Recipe> = {
  DialogTrigger: props => typeof props.className === 'string' && props.className ? props.className : BASIC.Button!({}),
  DialogClose: props => typeof props.className === 'string' && props.className ? props.className : BASIC.Button!({ variant: 'outline' }),
  DialogContent: props => cn('m-auto max-h-[calc(100svh-4rem)] w-fit max-w-[min(32rem,calc(100vw-2rem))] overflow-auto rounded-lg border border-border bg-background p-6 text-foreground shadow-lg', !props.className && 'open:flex flex-col gap-4', props.className as string | undefined),
};
