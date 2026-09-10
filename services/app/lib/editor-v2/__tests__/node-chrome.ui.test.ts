import { afterEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { createNodeChrome, type NodeChrome } from '../node-chrome';
let chrome: NodeChrome | undefined;
afterEach(() => {
  chrome?.dispose();
  document.body.innerHTML = '';
});
describe('selected block chrome', () => {
  it('deletes only the explicitly selected block', () => {
    const commit = vi.fn();
    chrome = createNodeChrome(document, commit);
    const paragraph = document.createElement('p');
    document.body.append(paragraph);
    chrome.select(paragraph, '0.2');
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected block' }));
    expect(commit).toHaveBeenCalledExactlyOnceWith({
      kind: 'delete',
      paths: ['0.2'],
    });
    chrome.select(null, null);
    expect(screen.queryByRole('button', { name: 'Delete selected block' })).toBeNull();
  });
  it('keyboard resizing emits one minimum-height source command', () => {
    const commit = vi.fn();
    chrome = createNodeChrome(document, commit);
    const p = document.createElement('p');
    document.body.append(p);
    p.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 300,
      bottom: 100,
      width: 300,
      height: 100,
      toJSON: () => ({}),
    });
    chrome.select(p, '0');
    fireEvent.keyDown(screen.getByRole('button', { name: 'Resize selected block' }), { key: 'ArrowDown' });
    expect(commit).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Resize selected block' }), { key: 'Enter' });
    expect(commit).toHaveBeenCalledExactlyOnceWith({
      kind: 'resize',
      path: '0',
      width: 300,
      height: 110,
    });
    expect(p.getAttribute('style')).toBeNull();
  });
});

it('resize preview does not mutate editor-owned DOM and Escape cancels the gesture', () => {
  const commit = vi.fn();
  chrome = createNodeChrome(document, commit);
  const p = document.createElement('p');
  p.textContent = 'prose';
  document.body.append(p);
  chrome.select(p, '0');
  const resize = screen.getByRole('button', { name: 'Resize selected block' });
  resize.dispatchEvent(
    Object.assign(new Event('pointerdown', { bubbles: true, cancelable: true }), {
      pointerId: 1,
      clientX: 0,
      clientY: 0,
    }),
  );
  document.dispatchEvent(
    Object.assign(new Event('pointermove', { bubbles: true, cancelable: true }), {
      pointerId: 1,
      clientX: 80,
      clientY: 100,
    }),
  );
  expect(p.getAttribute('style')).toBeNull();
  fireEvent.keyDown(document, { key: 'Escape' });
  document.dispatchEvent(
    Object.assign(new Event('pointerup', { bubbles: true }), {
      pointerId: 1,
      clientX: 80,
      clientY: 100,
    }),
  );
  expect(commit).not.toHaveBeenCalled();
});
