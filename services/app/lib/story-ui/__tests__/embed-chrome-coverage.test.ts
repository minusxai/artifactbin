/**
 * Compile-coverage guarantee for the story embed WRAPPER chrome (staging regression, Jul 2026).
 *
 * The story iframe's only stylesheet is the compiled story CSS (recipe union = kit +
 * EXTRA_CLASS_SOURCES ∪ per-story authored candidates). Any component that renders chrome
 * INSIDE the iframe must therefore be in EXTRA_CLASS_SOURCES, or its Tailwind classes silently
 * miss the sheet and the chrome renders unstyled (the collapsed-embed bug).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { EXTRA_CLASS_SOURCES } from '../../../scripts/generate-story-ui-classes';
import { STORY_UI_RECIPE_CLASSES } from '../recipe-classes';

const REQUIRED_FILES = [
  'components/viz/VegaChart.tsx',
  'components/views/story/InlineNumber.tsx',
  'components/views/story/QuestionEmbed.tsx',
  'lib/story-runtime/StoryRuntimeApp.tsx',
  // A registered story component that lives outside components/kit is the same
  // hazard by a different route: nothing about its NAME says its classes have
  // stopped compiling.
  'components/Tooltip.tsx',
];

describe('embed wrapper chrome is covered by the story CSS compile', () => {
  it('EXTRA_CLASS_SOURCES includes every file whose classes reach the iframe from outside kit', () => {
    for (const f of REQUIRED_FILES) {
      expect(EXTRA_CLASS_SOURCES.some((p) => p.endsWith(f)), `${f} missing from EXTRA_CLASS_SOURCES`).toBe(true);
    }
  });

  it('every listed file exists on disk — a renamed file must not silently fall out of the sheet', () => {
    // The extractor skips missing entries with existsSync, so a stale path is
    // not an error there; THIS is where it becomes one.
    for (const p of EXTRA_CLASS_SOURCES) {
      expect(existsSync(join(p)), `${p} listed in EXTRA_CLASS_SOURCES but not on disk`).toBe(true);
    }
  });

  it('the generated recipe union carries the wrapper token classes', () => {
    // Card chrome (QuestionEmbed) + the dataset-backed table chrome + the
    // InlineNumber figure — the classes the collapsed-embed bug was missing.
    for (const cls of ['bg-card', 'border-border', 'tabular-nums', 'text-muted-foreground']) {
      expect(STORY_UI_RECIPE_CLASSES, `${cls} missing from recipe classes`).toContain(cls);
    }
  });
});
