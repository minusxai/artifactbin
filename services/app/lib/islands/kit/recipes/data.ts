/** Root class recipes evaluated at compile time, before islands load. */
import { cn } from './cn';
import type { Recipe } from '.';
const author = (props: Record<string, unknown>) => typeof props.className === 'string' ? props.className : undefined;

export const RECIPES: Record<string, Recipe> = {
  Number: props => cn(author(props)),
  Select: props => cn('mx-control relative inline-flex flex-col gap-1.5 align-top', author(props)),
  DataTable: props => cn('flex h-full w-full flex-col overflow-hidden rounded-md border border-border bg-card text-sm', author(props)),
  Question: props => cn('flex h-full w-full flex-col', author(props)),
};
