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

it('keeps an in-progress resize anchored when the viewport scrolls', () => {
  const commit = vi.fn();
  chrome = createNodeChrome(document, commit);
  const p = document.createElement('p');
  document.body.append(p);
  p.getBoundingClientRect = () => ({
    x: 20,
    y: 30,
    left: 20,
    top: 30,
    right: 320,
    bottom: 130,
    width: 300,
    height: 100,
    toJSON: () => ({}),
  });
  chrome.select(p, '0');
  fireEvent.keyDown(screen.getByRole('button', { name: 'Resize block width' }), { key: 'ArrowLeft' });
  const overlay = document.querySelector('[data-mx-node-chrome]') as HTMLElement;
  expect(overlay.style.width).toBe('290px');
  fireEvent.scroll(window);
  expect(overlay.style.width).toBe('290px');
  expect(commit).not.toHaveBeenCalled();
});


it.each([false, true])('centers controls on the selection outline (touch: %s)', (touch) => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: touch })));
  try {
    chrome = createNodeChrome(document, vi.fn());
    const p = document.createElement('p');
    document.body.append(p);
    p.getBoundingClientRect = () => new DOMRect(0, 0, 300, 100);
    chrome.select(p, '0');
    for (const [name, left, top] of [
      ['Move selected block', '-3.5px', '-3.5px'],
      ['Delete selected block', 'calc(100% + 3.5px)', '-3.5px'],
      ['Resize selected block', 'calc(100% + 3.5px)', 'calc(100% + 3.5px)'],
      ['Resize block width', 'calc(100% + 3.5px)', '50%'],
      ['Resize block height', '50%', 'calc(100% + 3.5px)'],
    ]) {
      const button = screen.getByRole('button', { name });
      expect(button).toHaveStyle({ left, top, transform: 'translate(-50%, -50%)', width: touch ? '44px' : '28px' });
    }
    const remove = screen.getByRole('button', { name: 'Delete selected block' });
    expect(remove.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(remove).not.toHaveTextContent('×');
  } finally {
    vi.unstubAllGlobals();
  }
});


it.each([false, true])('keeps all control hit areas disjoint on small blocks (touch: %s)', (touch) => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: touch })));
  try {
    chrome = createNodeChrome(document, vi.fn());
    const p = document.createElement('p');
    document.body.append(p);
    for (const [width, height] of [[300, 20], [20, 100], [20, 20], [300, 100]]) {
      p.getBoundingClientRect = () => new DOMRect(0, 0, width, height);
      chrome.select(p, '0');
      const buttons = screen.getAllByRole('button');
      const point = (value: string, size: number) => value === '50%' ? size / 2
        : value.startsWith('calc') ? size + 3.5 : Number.parseFloat(value);
      const boxes = buttons.map((button) => {
        const style = button.style;
        const w = Number.parseFloat(style.width), h = Number.parseFloat(style.height);
        return { name: button.getAttribute('aria-label'), w, h,
          x: point(style.left, width), y: point(style.top, height) };
      });
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        expect(Math.abs(a.x - b.x) >= (a.w + b.w) / 2 || Math.abs(a.y - b.y) >= (a.h + b.h) / 2,
          `${width}x${height}: ${a.name} overlaps ${b.name}`).toBe(true);
      }
      if (width === 300 && height === 100)
        for (const button of buttons) expect(button).toHaveStyle({ width: touch ? '44px' : '28px', height: touch ? '44px' : '28px' });
    }
  } finally {
    vi.unstubAllGlobals();
  }
});
