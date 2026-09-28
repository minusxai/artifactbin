import { cn } from './cn';
import type { Recipe } from '.';
export const RECIPES: Record<string, Recipe> = { Files: p => cn('my-6', p.className as string | undefined) };
