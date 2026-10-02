/**
 * The class merger the recipes use — the retired React kit's own `cn` (tailwind-merge over clsx), re-exported so
 * a recipe merges an author's className exactly as the former component does. COMPILE TIME ONLY: the
 * compiler evaluates recipes to class strings, so readers never download clsx or tailwind-merge, and
 * nothing under lib/islands that reaches the browser imports this.
 */
export { cn } from '@/lib/islands/cn';
