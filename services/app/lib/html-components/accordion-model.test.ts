import { describe, expect, it } from 'vitest';
import { equalAccordionValue, normalizeAccordionValue, toggleAccordionValue } from './accordion-model';

describe('accordion selection model', () => {
  it('normalizes selection by mode and preserves first-open ordering', () => {
    expect(normalizeAccordionValue('single',['a','b'])).toBe('a');
    expect(normalizeAccordionValue('multiple','a')).toEqual(['a']);
    expect(normalizeAccordionValue('multiple',['a','a','','b'])).toEqual(['a','b']);
  });
  it('toggles single selections according to collapsible and independently toggles multiple values', () => {
    expect(toggleAccordionValue('single','a','b',false)).toBe('b');
    expect(toggleAccordionValue('single','a','a',false)).toBe('a');
    expect(toggleAccordionValue('single','a','a',true)).toBe('');
    expect(toggleAccordionValue('multiple',['a'],'b',false)).toEqual(['a','b']);
    expect(toggleAccordionValue('multiple',['a','b'],'a',false)).toEqual(['b']);
  });
  it('compares arrays by their normalized ordered values', () => {
    expect(equalAccordionValue('multiple',['a','a','b'],['a','b'])).toBe(true);
    expect(equalAccordionValue('multiple',['b','a'],['a','b'])).toBe(false);
  });
});
