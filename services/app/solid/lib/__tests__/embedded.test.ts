/** The embedded view applies only to `?embed=1` in a window that really is framed. */
import { expect, it } from 'vitest';
import { isEmbeddedView } from '../embedded';

const top = {};
const win = (search: string, framed: boolean) => {
  const self = {};
  return { location: { search }, self, top: framed ? top : self };
};

it('is the embedded view only when asked for and framed', () => {
  expect(isEmbeddedView(win('?embed=1', true))).toBe(true);
  expect(isEmbeddedView(win('?embed=1', false)), 'opened on its own: the ordinary page').toBe(false);
  expect(isEmbeddedView(win('', true)), 'framed without asking: the ordinary page').toBe(false);
  expect(isEmbeddedView(win('?embed=0', true))).toBe(false);
});
