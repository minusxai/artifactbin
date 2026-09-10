import { describe, it, expect } from 'vitest';
import { replaceProseRegion } from '../source-edit';
describe('atomic prose source replacement', () => {
  it('replaces a sibling range under Helmet without changing the surrounding bytes', () => {
    const source =
      '<Helmet><title>T</title></Helmet>\n<div><p id="a">one</p><p id="b">two</p><Question id="q" /></div>';
    expect(replaceProseRegion(source, '1.0', '<p id="a">one</p><p id="b">two</p>', '<p id="a">joined</p>')).toBe(
      '<Helmet><title>T</title></Helmet>\n<div><p id="a">joined</p><Question id="q" /></div>',
    );
  });
  it('refuses stale, invalid and non-prose replacements atomically', () => {
    const source = '<p id="a">one</p><p id="b">two</p>';
    for (const next of ['<script>evil()</script>', '<Question />', '<p onClick="evil()">x</p>', '<p>']) {
      expect(replaceProseRegion(source, '0', '<p id="a">one</p>', next)).toBe(source);
    }
    expect(replaceProseRegion(source, '0', '<p id="a">stale</p>', '<p>new</p>')).toBe(source);
  });
});
