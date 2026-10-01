import { afterEach, expect, it } from 'vitest';
import { EDIT_PANEL_BREAKPOINT } from '@/lib/story/reader/edit-bar';
import { createWideEditViewport } from '../create-edit-panel';
import { renderHook } from '@/solid/__tests__/helpers';

const setWidth = (width: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
};
const original = window.innerWidth;
afterEach(() => setWidth(original));

it('reads the live window width and follows a resize across the breakpoint', () => {
  setWidth(EDIT_PANEL_BREAKPOINT + 100);
  const { result: wide } = renderHook(() => createWideEditViewport());
  expect(wide()).toBe(true);

  setWidth(EDIT_PANEL_BREAKPOINT - 100);
  window.dispatchEvent(new Event('resize'));
  expect(wide()).toBe(false);

  setWidth(EDIT_PANEL_BREAKPOINT + 50);
  window.dispatchEvent(new Event('resize'));
  expect(wide()).toBe(true);
});

it('starts narrow below the breakpoint without waiting for a resize', () => {
  setWidth(EDIT_PANEL_BREAKPOINT - 1);
  const { result: wide } = renderHook(() => createWideEditViewport());
  expect(wide()).toBe(false);
});
