import type { Recipe } from './index';
import { cn } from './cn';
export const RECIPES: Record<string, Recipe> = { Isometric: p => cn('min-w-0', p.className as string | undefined) };
