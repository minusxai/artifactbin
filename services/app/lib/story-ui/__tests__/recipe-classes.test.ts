/**
 * Freshness guard: lib/story-ui/recipe-classes.ts is GENERATED from the component sources
 * (npm run generate-story-ui-classes). If a component changes and the file is stale, the
 * compiled base sheet silently misses recipe classes — this test fails instead.
 */
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extractRecipeClasses, EXTRA_CLASS_SOURCES } from '../../../scripts/generate-story-ui-classes';
import { STORY_UI_RECIPE_CLASSES } from '../recipe-classes';

describe('recipe-classes.ts freshness', () => {
  it('matches a fresh extraction from components/kit + every source named beside it', () => {
    const fresh = extractRecipeClasses(join(__dirname, '..', '..', '..', 'components', 'kit'), EXTRA_CLASS_SOURCES);
    expect([...STORY_UI_RECIPE_CLASSES]).toEqual(fresh);
  });

  it("an apostrophe in a comment does not desync the quote pairing and swallow class literals", () => {
    // The naive scanner pairs quotes across the whole source: a comment like
    // "the realm's document" opened a phantom literal that ran to the next
    // apostrophe IN CODE, and every class string in between silently vanished
    // from the compiled sheet.
    const dir = mkdtempSync(join(tmpdir(), 'recipe-classes-'));
    try {
      writeFileSync(join(dir, 'fixture.tsx'), [
        "// the canvas renders into another realm's document",
        "const a = cn('rounded-[5px] px-3', flag ? 'translate-x-[18px]' : 'translate-x-0.5');",
        'const url = "http://localhost/x"; const b = "bg-muted/40 shadow-xs";',
      ].join('\n'));
      const toks = extractRecipeClasses(dir);
      for (const t of ['rounded-[5px]', 'px-3', 'translate-x-[18px]', 'translate-x-0.5', 'bg-muted/40', 'shadow-xs']) {
        expect(toks).toContain(t);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
