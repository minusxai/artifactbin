import { afterEach, describe, it, expect, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { createBlockSelection } from '../block-selection';
let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  window.getSelection()?.removeAllRanges();
  document.body.innerHTML = '';
});
describe('cross-region block selection fallback', () => {
  it('upgrades a cross-column range and prevents typing or paste from replacing blocks', () => {
    document.body.innerHTML =
      '<div><div class="ProseMirror" contenteditable="true"><p data-mx-ast="0.0.0">alpha</p></div><div class="ProseMirror" contenteditable="true"><p data-mx-ast="0.1.0">bravo</p></div></div>';
    const commit = vi.fn();
    const selection = createBlockSelection(document, document.body, commit);
    dispose = selection.dispose;
    const p = document.querySelectorAll('p'),
      range = document.createRange();
    range.setStart(p[0].firstChild!, 2);
    range.setEnd(p[1].firstChild!, 3);
    window.getSelection()!.addRange(range);
    fireEvent(document, new Event('selectionchange'));
    expect(selection.paths()).toEqual(['0.0.0', '0.1.0']);
    expect(fireEvent.keyDown(p[0], { key: 'x' })).toBe(false);
    expect(fireEvent.paste(p[0])).toBe(false);
    expect(commit).not.toHaveBeenCalled();
    expect(p[0].textContent).toBe('alpha');
    fireEvent.keyDown(p[0], { key: 'Delete' });
    expect(commit).toHaveBeenCalledExactlyOnceWith({
      kind: 'delete',
      paths: ['0.0.0', '0.1.0'],
    });
  });
  it('leaves ordinary selection inside one editor to the text engine', () => {
    document.body.innerHTML =
      '<div class="ProseMirror" contenteditable="true"><p data-mx-ast="0">alpha</p><p data-mx-ast="1">bravo</p></div>';
    const selection = createBlockSelection(document, document.body, vi.fn());
    dispose = selection.dispose;
    const p = document.querySelectorAll('p'),
      range = document.createRange();
    range.setStart(p[0].firstChild!, 2);
    range.setEnd(p[1].firstChild!, 3);
    window.getSelection()!.addRange(range);
    fireEvent(document, new Event('selectionchange'));
    expect(selection.paths()).toEqual([]);
    expect(fireEvent.keyDown(p[0], { key: 'x' })).toBe(true);
  });
});

it('extends a keyboard selection across the boundary with Shift+ArrowRight', () => {
  document.body.innerHTML =
    '<div class="ProseMirror" contenteditable="true"><p data-mx-ast="0">alpha</p></div><div class="ProseMirror" contenteditable="true"><p data-mx-ast="1">bravo</p></div>';
  const selection = createBlockSelection(document, document.body, vi.fn());
  dispose = selection.dispose;
  const p = document.querySelector('p')!,
    range = document.createRange();
  range.setStart(p.firstChild!, 5);
  range.collapse(true);
  window.getSelection()!.addRange(range);
  fireEvent.keyDown(p, { key: 'ArrowRight', shiftKey: true });
  expect(selection.paths()).toEqual(['0', '1']);
});
