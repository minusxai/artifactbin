/** Root shell shared by the seven themed controls. */
import { cn } from './cn';
import type { Recipe } from '.';
const shell: Recipe = p => cn('mx-control relative inline-flex flex-col gap-1.5 align-top', p.className as string | undefined);
export const RECIPES: Record<string, Recipe> = {
  Input: shell, Textarea: shell, Slider: shell, DatePicker: shell, Segmented: shell, Switch: shell,
};
