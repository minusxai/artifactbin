/**
 * The offline edit view projects static markup without a compiler. A templated string reads the page,
 * so it is dynamic: a new one is never written into the DOM as its raw `{$…}` text (an href of
 * `{$link}`), and adopting a source that adds one asks for the local compiler.
 */
import { describe, expect, it } from 'vitest';
import { parseJsx, type JsxNode } from '@/lib/jsx';
import { assertProjectionSupported, projectDocument } from '../project-document';

const nodes = (source: string): JsxNode[] => {
  const parsed = parseJsx(source);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.nodes;
};

describe('templated strings in the offline view', () => {
  it('refuses to adopt a source that adds one, like any widget it cannot compile', () => {
    const before = '<p id="a">Plain</p>';
    expect(() => assertProjectionSupported(before, '<p id="a">Plain</p><p id="b">Also plain</p>')).not.toThrow();
    expect(() => assertProjectionSupported(before, '<p id="a">Plain</p><a id="b" href="{$link}">Go</a>')).toThrow(/local compiler/);
    expect(() => assertProjectionSupported(before, '<p id="a" title="Hi {$name}">Plain</p>')).toThrow(/local compiler/);
    expect(() => assertProjectionSupported(before, '<p id="a" title="{$_row.x} literal outside a row">Plain</p>')).not.toThrow();
  });

  it('never writes an unresolved template into the projected DOM', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p data-mx-ast="0" id="a">Plain</p>';
    projectDocument(root, nodes('<p id="a">Plain</p><a id="b" href="{$link}" title="Open {$link}">Go</a>'), '<p id="a">Plain</p>');
    expect(root.querySelector('[href]')).toBeNull();
    expect(root.innerHTML).not.toContain('{$link}');
  });
});
