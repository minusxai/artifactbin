import { expect, it } from 'vitest';
import { compactSurface, expandSurface } from '../page-transport';
it('round-trips runtime-bearing surfaces losslessly with only one CSS copy', () => {
  const surface = { compiledCss: '.page{}', runtime: { compiledCss: '.page{}', source: '<p />' }, source: '<p />', title: 'Title' };
  const compact = compactSurface(surface);
  expect(compact).not.toHaveProperty('compiledCss');
  expect(expandSurface(compact)).toEqual(surface);
  expect(surface.compiledCss).toBe('.page{}');
});
it('preserves non-runtime surface CSS and accepts already expanded bootstrap shapes', () => {
  const surface = { compiledCss: null, source: 'dataset' };
  expect(expandSurface(compactSurface(surface))).toEqual(surface);
  expect(expandSurface({ compiledCss: 'sheet', runtime: { compiledCss: 'sheet' } })).toEqual({ compiledCss: 'sheet', runtime: { compiledCss: 'sheet' } });
});
