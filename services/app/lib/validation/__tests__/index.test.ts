/** lib/validation through its index: the design and template enums and the TypeBox shapes stored content is checked against. */
import { describe, expect, it } from 'vitest';
import { Value } from 'typebox/value';
import {
  ColumnFormatConfig, STORY_DESIGN_NAMES, STORY_SYSTEM_NAMES, STORY_TEMPLATE_NAMES, VizEnvelope, VizRecipeBinding, VizRecipeContent, VizRecipeParam,
} from '..';

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

describe('ColumnFormatConfig', () => {
  it('accepts an empty or nulled config and refuses a wrong type', () => {
    expect(Value.Check(ColumnFormatConfig, {})).toBe(true);
    expect(Value.Check(ColumnFormatConfig, { alias: 'Revenue', format: null, prefix: '$', suffix: null })).toBe(true);
    expect(Value.Check(ColumnFormatConfig, { prefix: 5 })).toBe(false);
  });
});

describe('VizEnvelope', () => {
  const vegaLite = { kind: 'vega-lite', grammar: 'vega-lite@6', spec: { mark: 'bar' } };

  it('accepts version 2 over each source kind', () => {
    expect(Value.Check(VizEnvelope, { version: 2, source: vegaLite })).toBe(true);
    expect(Value.Check(VizEnvelope, { version: 2, source: { kind: 'recipe', recipe: 'bar', bindings: { x: 'a', y: ['b', 'c'] } } })).toBe(true);
  });

  it('refuses another version, an unpinned grammar or an unknown kind', () => {
    expect(Value.Check(VizEnvelope, { version: 1, source: vegaLite })).toBe(false);
    expect(Value.Check(VizEnvelope, { version: 2, source: { ...vegaLite, grammar: 'vega-lite@5' } })).toBe(false);
    expect(Value.Check(VizEnvelope, { version: 2, source: { kind: 'svg', spec: {} } })).toBe(false);
    expect(Value.Check(VizEnvelope, { version: 2 })).toBe(false);
  });
});

describe('the viz recipe file', () => {
  const binding = { name: 'x', label: 'X axis', accepts: ['nominal', 'temporal'] };

  it('checks bindings by column kind and params by name', () => {
    expect(Value.Check(VizRecipeBinding, binding)).toBe(true);
    expect(Value.Check(VizRecipeBinding, { ...binding, multi: true })).toBe(true);
    expect(Value.Check(VizRecipeBinding, { ...binding, accepts: ['ordinal'] })).toBe(false);
    expect(Value.Check(VizRecipeParam, { name: 'opacity', label: 'Opacity', default: 0.5 })).toBe(true);
    expect(Value.Check(VizRecipeParam, { name: 'opacity' })).toBe(false);
  });

  it('accepts a template over either grammar and refuses any other engine', () => {
    const recipe = { description: 'Bars by category', engine: 'vega-lite', bindings: [binding], template: { mark: 'bar' } };
    expect(Value.Check(VizRecipeContent, recipe)).toBe(true);
    expect(Value.Check(VizRecipeContent, { ...recipe, engine: 'vega', params: null })).toBe(true);
    expect(Value.Check(VizRecipeContent, { ...recipe, engine: 'd3' })).toBe(false);
    expect(Value.Check(VizRecipeContent, { ...recipe, bindings: undefined })).toBe(false);
  });
});
