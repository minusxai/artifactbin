import { cn } from './cn';
import type { Recipe } from '.';
export const RECIPES: Record<string, Recipe> = { Mermaid: p => cn('min-w-0', p.inGridItem ? 'flex h-full w-full flex-col' : 'my-4', p.className as string | undefined) };
