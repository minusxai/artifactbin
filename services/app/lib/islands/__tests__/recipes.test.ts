// DESTINATION: services/app/lib/islands/__tests__/recipes.test.ts
/**
 * THE KIT'S CLASS RECIPES (lib/islands/kit/recipes.ts): the class string each ported component's
 * DOM carries, evaluated AT COMPILE TIME by the compiler (readers never download cva, clsx or
 * tailwind-merge). Each recipe must produce the class set the retired React component renders for the
 * same props — the parity gate's attribute comparison, taken one recipe at a time.
 */
import { describe, expect, it } from 'vitest';
import { RECIPES, cn } from '../kit/recipes';
import { KIT_FAMILIES } from '../contract';

/**
 * The INDEX only: each family's recipe cases (today's classes for a variant, the author className
 * merge) live in that family's own test file (`kit-<family>.test.tsx`, wave 2), so no two tracks
 * edit one test file.
 */
describe('the recipes index', () => {
  it('merges one module per kit family and exports the class merger', () => {
    expect(typeof cn).toBe('function');
    expect(cn('p-2', 'p-4')).toBe('p-4');
    for (const family of KIT_FAMILIES) expect(RECIPES, family).toBeDefined();
    expect(typeof RECIPES).toBe('object');
  });
});
