/**
 * Story templates — registry contract (the structural-genre dimension next to design themes).
 *
 * One registry (`STORY_TEMPLATES`), projected from `lib/data/story/story-guidance.yaml`
 * (the human-edited prose source). These tests pin:
 *  - completeness: one entry per schema enum name, in enum order,
 *  - the mini-skill contract: every template carries label/description/personality, a beat
 *    list, and a guidance markdown block with a JSX skeleton and Do/Don't sections,
 *  - the lookup helper.
 */
import { describe, it, expect } from 'vitest';

import { STORY_TEMPLATES, STORY_TEMPLATE_NAMES } from '../story-templates';

describe('STORY_TEMPLATES registry', () => {
  it('has exactly one entry per schema enum name, in enum order', () => {
    expect(STORY_TEMPLATES.map(t => t.name)).toEqual([...STORY_TEMPLATE_NAMES]);
    expect([...STORY_TEMPLATE_NAMES]).toEqual(['doc', 'editorial', 'deck', 'scrolly', 'dashboard', 'plan', 'app', 'landing']);
  });

  it('every template carries label, description, personality and a beat structure', () => {
    for (const t of STORY_TEMPLATES) {
      expect(t.label.length, `${t.name}.label`).toBeGreaterThan(0);
      expect(t.description.length, `${t.name}.description`).toBeGreaterThan(0);
      expect(t.personality.length, `${t.name}.personality`).toBeGreaterThan(0);
      expect(t.beats.length, `${t.name}.beats`).toBeGreaterThanOrEqual(3);
      for (const beat of t.beats) expect(beat.length).toBeGreaterThan(0);
    }
  });
});

