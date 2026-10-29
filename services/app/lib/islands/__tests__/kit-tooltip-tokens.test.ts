/**
 * THE KIT TOOLTIP IS PAINTED WITH PAGE TOKENS. A story's sheet defines the page token layer (`bg-popover`,
 * `text-popover-foreground`, `border-border`…), not the app chrome's (`bg-surface`, `text-fg`, `border-edge-bright`):
 * a chrome token in a kit recipe compiles to no rule at all, and the tooltip drew transparent over the text behind it.
 */
import { describe, expect, it } from 'vitest';
import { compileStoryCss } from '@/lib/story-design/server';
import { RECIPES } from '../kit/recipes';

/** The selector Tailwind writes for a plain class token (`/` and `.` escaped). */
const selectorOf = (token: string): string => `.${token.replace(/([/.:])/g, '\\$1')}`;

describe('the kit tooltip content', () => {
  it('uses only colour classes the story sheet defines, from the popover tokens every design system sets', async () => {
    const classes = RECIPES.TooltipContent!({}).split(/\s+/).filter(Boolean);
    expect(classes).toEqual(expect.arrayContaining(['bg-popover', 'text-popover-foreground', 'border-border']));
    const colours = classes.filter((token) => /^(bg|text|border|fill|stroke)-/.test(token) && !token.includes('['));
    const css = (await compileStoryCss(`<span class="${classes.join(' ')}"></span>`, { force: true }))!;
    for (const token of colours) expect(css, `${token} compiles to a rule`).toContain(selectorOf(token));
  });
});
