/** lib/validation through its index: the design and template enums. */
import { describe, expect, it } from 'vitest';
import { STORY_DESIGN_NAMES, STORY_SYSTEM_NAMES, STORY_TEMPLATE_NAMES } from '..';

describe('the name enums', () => {
  it('list each design once: the six themes, then the design systems', () => {
    expect(STORY_DESIGN_NAMES.slice(0, 6)).toEqual(['modernist', 'organic', 'industry', 'terminal', 'manuscript', 'pop']);
    expect(STORY_DESIGN_NAMES.slice(6)).toEqual([...STORY_SYSTEM_NAMES]);
    expect(new Set(STORY_DESIGN_NAMES).size).toBe(STORY_DESIGN_NAMES.length);
    expect(STORY_SYSTEM_NAMES).toContain('volta');
    expect(STORY_SYSTEM_NAMES).not.toContain('modernist');
  });

  it('name the eight templates a document may carry', () => {
    expect(STORY_TEMPLATE_NAMES).toEqual(['doc', 'editorial', 'deck', 'scrolly', 'dashboard', 'plan', 'app', 'landing']);
  });
});
