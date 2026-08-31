/**
 * Story templates — registry contract (the structural-genre dimension next to design themes).
 *
 * One registry (`STORY_TEMPLATES`), projected from `orchestrator/prompts/story-guidance.yaml`
 * (the human-edited prose source). These tests pin:
 *  - completeness: one entry per schema enum name, in enum order,
 *  - the mini-skill contract: every template carries label/description/personality, a beat
 *    list, and a guidance markdown block with a JSX skeleton and Do/Don't sections,
 *  - the lookup helper.
 */
import { describe, it, expect } from 'vitest';
import { renderDoc } from '@/lib/skills';

/** A genre's authoring guidance is its docs file — `skills/artifact-bin/references/templates-<name>.md`, the one copy agents read. */
const guidanceOf = (name: string) => renderDoc(`artifact-bin/references/templates-${name}.md`, 'https://example.test');
import { STORY_TEMPLATES, STORY_TEMPLATE_NAMES, getStoryTemplate } from '../story-templates';

describe('STORY_TEMPLATES registry', () => {
  it('has exactly one entry per schema enum name, in enum order', () => {
    expect(STORY_TEMPLATES.map(t => t.name)).toEqual([...STORY_TEMPLATE_NAMES]);
    expect([...STORY_TEMPLATE_NAMES]).toEqual(['editorial', 'deck', 'scrolly', 'dashboard']);
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

  it('every guidance is a className-first mini-skill with no INLINE style escape hatch', () => {
    for (const t of STORY_TEMPLATES) {
      const guidance = guidanceOf(t.name);
      expect(guidance.length, `${t.name}.guidance`).toBeGreaterThan(400);
      // A skeleton or kit snippets — either way, concrete markup with literal classes.
      expect(guidance, `${t.name} markup snippet`).toMatch(/className="/);
      expect(guidance, `${t.name} legacy class attr`).not.toMatch(/\bclass="/);
      // Authored <style> BLOCKS are allowed vocabulary (no-inline-style policy) and guidance
      // may reference them; inline style attributes remain banned everywhere.
      expect(guidance, `${t.name} inline style`).not.toMatch(/\sstyle=\{|\sstyle="/);
      expect(guidance, `${t.name} Do section`).toMatch(/\bDo\b/);
      expect(guidance, `${t.name} Don't section`).toContain("Don't");
    }
  });

  it('deck: the accent divider is a PICKABLE slide type, not just document structure', () => {
    // The bug this pins: an author filling N slots shops from the SLIDE TYPES menu. A divider
    // described only under "acts" (structure, conditional on deck length) gets dropped from every
    // short deck, and the deck ships with no saturated slide at all.
    const guidance = guidanceOf('deck');
    // Bounded by the Do list, not by the skeleton: the skeleton now LEADS the page (it is the
    // thing agents copy, so it sits in the top half), and slicing to it read backwards.
    const start = guidance.indexOf('SLIDE TYPES');
    const slideTypes = guidance.slice(start, guidance.indexOf('\nDo\n', start));
    expect(slideTypes, 'deck SLIDE TYPES block').toMatch(/divider/i);
    // …and a floor, so "5 slides" cannot argue its way out of the one saturated slide.
    expect(guidance, 'deck short-deck floor').toMatch(/at least one/i);
  });

  it('deck: every slide is a <Slide>, never a raw <section>', () => {
    // guidance told authors "never a raw <section> for a slide" and then built the divider out of
    // one — the contradiction lands on the exact construct short decks already skip.
    // (the prose prohibition "never a raw `<section>`" is fine — only authored markup is banned)
    expect(guidanceOf('deck'), 'deck raw <section> slide').not.toMatch(/<section\s/);
  });

  it('getStoryTemplate looks up by name and misses safely', () => {
    expect(getStoryTemplate('deck')?.label.length).toBeGreaterThan(0);
    expect(getStoryTemplate('bogus')).toBeUndefined();
    expect(getStoryTemplate(null)).toBeUndefined();
    expect(getStoryTemplate(undefined)).toBeUndefined();
  });
});
