import { cn } from './cn';
import type { Recipe } from '.';
export const RECIPES: Record<string, Recipe> = { FileUpload: p => cn('mx-control flex flex-col gap-3', p.className as string | undefined) };
