import { cn } from './cn';
import type { Recipe } from '.';

export const RECIPES: Record<string, Recipe> = {
  AccordionItem: props => cn("border-b last:border-b-0", props.className as string | undefined),
  AccordionTrigger: props => cn("flex flex-1 items-start justify-between gap-4 rounded-md py-4 text-left text-sm font-medium transition-all outline-none hover:underline focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&[data-state=open]>svg]:rotate-180", props.className as string | undefined),
  AccordionContent: props => cn("pt-0 pb-4", props.className as string | undefined),
};
