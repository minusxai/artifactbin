import { cn } from './cn';
import type { Recipe } from '.';
export const RECIPES: Record<string, Recipe> = { Mermaid: p => cn('min-w-0', 'my-4', p.className as string | undefined) };
