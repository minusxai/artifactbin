import { describe, it, expect } from 'vitest';
import { slug } from '../lib/slug';

describe('slug', () => {
  it('lowercases, collapses runs of non-alphanumerics, and trims the edges', () => {
    expect(slug('Story Creation / v2')).toBe('story-creation-v2');
    expect(slug('  leading & trailing  ')).toBe('leading-trailing');
  });

  it('handles the labels a run actually carries', () => {
    expect(slug('claude-code · claude-opus-5')).toBe('claude-code-claude-opus-5');
    expect(slug('opencode · minimax-m3')).toBe('opencode-minimax-m3');
  });

  it('truncates when asked, so a long label cannot make an unusable path', () => {
    expect(slug('a'.repeat(80), 40)).toHaveLength(40);
    expect(slug('short', 40)).toBe('short');
  });

  it('is empty when there is nothing alphanumeric — callers supply their own fallback', () => {
    expect(slug('···')).toBe('');
  });
});
