import { expect, it } from 'vitest';
import { expandSurface } from '../page-transport';
it('reads a document\'s declarations from its runtime island instead of a second copy', () => {
  const dataflow = { flow: { imports: [], values: [], queries: [], mutations: [] }, values: {} };
  const surface = { runtime: { data: { dataflow }, css: '.page{}' }, title: 'Title' };
  expect(expandSurface(surface)).toEqual({ ...surface, compiledCss: null, dataflow });
});
it('preserves a data tier\'s stored sheet and its absent dataflow', () => {
  expect(expandSurface({ compiledCss: '.sheet{}', source: 'dataset' })).toEqual({ compiledCss: '.sheet{}', source: 'dataset', dataflow: null });
  expect(expandSurface({ source: 'dataset' })).toEqual({ compiledCss: null, source: 'dataset', dataflow: null });
});
