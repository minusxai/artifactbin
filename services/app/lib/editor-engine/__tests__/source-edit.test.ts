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


describe('concurrent prose region boundaries', () => {
  const old = '<p id="a">alpha</p>';
  const next = '<h2 id="a">local heading</h2>';

  it.each([
    ['inserted before', '<p id="new">remote insert</p>' + old + '<p id="b">bravo</p>'],
    ['moved to another container', '<section><p id="b">bravo</p></section><article>' + old + '</article>'],
    ['neighbor changed', old + '<p id="b">remote text</p>'],
    ['neighbor deleted', old],
    ['dataset changed', '<Question id="q">select 42</Question>' + old],
  ])('preserves remote changes when the unchanged target was %s', (_name, source) => {
    expect(replaceProseRegion(source, '0', old, next)).toBe(source.replace(old, next));
  });

  it.each([
    ['same block changed', '<p id="a">remote text</p>'],
    ['target deleted', '<p id="b">bravo</p>'],
    ['duplicate exact target', old + old],
    ['target only in expression text', '<p id="b">{`' + old + '`}</p>'],
    ['target only in a comment', '{/* ' + old + ' */}<p id="b">bravo</p>'],
  ])('refuses a stale edit atomically when %s', (_name, source) => {
    expect(replaceProseRegion(source, '0', old, next)).toBe(source);
  });

  it('merges a concurrent neighbor when the runtime submits its entire prose region', () => {
    const expected = old + '<p id="b">bravo</p>';
    const remote = old + '<p id="b">remote text</p>';
    expect(replaceProseRegion(remote, '0', expected, next + '<p id="b">bravo</p>')).toBe(next + '<p id="b">remote text</p>');
  });

  it('rejects a stale Markdown conversion after a remote deletion', () => {
    const remote = '<article id="doc"><p id="b">bravo</p></article>';
    expect(replaceProseRegion(remote, '0.0', old, '<ul id="list"><li id="item">' + old + '</li></ul>')).toBe(remote);
  });
});


describe('three-way collaborative prose transactions', () => {
  const base = '<article id="doc"><p id="a">alpha</p><p id="b">bravo</p></article>';
  const localChanges = [
    ['typing', '<p id="a">local words</p>'],
    ['heading', '<h2 id="a">alpha</h2>'],
    ['bold', '<p id="a"><strong>alpha</strong></p>'],
    ['list', '<ul id="list"><li id="item"><p id="a">alpha</p></li></ul>'],
    ['split', '<p id="a">al</p><p id="new">pha</p>'],
  ];
  const remoteChanges = [
    ['typing', '<p id="b">their words</p>'],
    ['heading', '<h3 id="b">bravo</h3>'],
    ['italic', '<p id="b"><em>bravo</em></p>'],
    ['list', '<ol id="remote-list"><li id="remote-item"><p id="b">bravo</p></li></ol>'],
  ];
  it.each(localChanges.flatMap(([localName, localBlock]) => remoteChanges.map(([remoteName, remoteBlock]) => [localName, remoteName, localBlock, remoteBlock])))('converges in both commit orders for local %s and remote %s', (_localName, _remoteName, localBlock, remoteBlock) => {
    const local = base.replace('<p id="a">alpha</p>', localBlock);
    const remote = base.replace('<p id="b">bravo</p>', remoteBlock);
    const merged = local.replace('<p id="b">bravo</p>', remoteBlock);
    expect(replaceProseRegion(remote, '0', base, local)).toBe(merged);
    expect(replaceProseRegion(local, '0', base, remote)).toBe(merged);
  });

  it('preserves a concurrently inserted child while merging a disjoint Markdown conversion', () => {
    const remote = base.replace('</article>', '<p id="c">remote addition</p></article>');
    const local = base.replace('<p id="a">alpha</p>', '<h2 id="a">alpha</h2>');
    expect(replaceProseRegion(remote, '0', base, local)).toBe(local.replace('</article>', '<p id="c">remote addition</p></article>'));
  });

  it.each([
    ['overlapping text', base.replace('alpha', 'their words')],
    ['target deleted', base.replace('<p id="a">alpha</p>', '')],
    ['container replaced', base.replace('id="doc"', 'id="another"')],
  ])('does not apply a stale transaction when %s', (_name, remote) => {
    const local = base.replace('alpha', 'my words');
    expect(replaceProseRegion(remote, '0', base, local)).toBe(remote);
  });
});
