import { describe, it, expect } from 'vitest';
import { replaceProseRegion } from '../source-edit';
import { parseJsx, serializeJsx } from '@/lib/jsx';
import { editorDocument, sourceNodes } from '../model';
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
  it('saves checkbox state while refusing live controls and bound checkboxes as prose', () => {
    const old = '<p id="a">Task</p>';
    const replacement = '<p id="a"><input id="check" type="checkbox" disabled checked={true} /> Task</p>';
    const saved = replaceProseRegion(old, '0', old, replacement);
    expect(saved).toContain('disabled checked />');
    const parsed = parseJsx(saved);
    if (!parsed.ok) throw Error(parsed.error);
    const normalized = serializeJsx(sourceNodes(editorDocument(parsed.nodes)));
    expect(replaceProseRegion(saved, '0', saved, normalized)).toBe(normalized);
    for (const input of ['<input type="checkbox" />', '<input type="text" disabled />', '<input type="checkbox" disabled checked="$flag" />']) {
      expect(replaceProseRegion(old, '0', old, `<p id="a">${input}Task</p>`)).toBe(old);
    }
  });
});
