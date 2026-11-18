/**
 * The shape checks a chart description passes before any engine sees it, and the locator that names the part of a
 * composed spec an engine failed on.
 */
import { expect, it } from 'vitest';
import { locateChartFailure, parseChartDescription } from '../chart-spec';

const BAR = { mark: 'bar', encoding: { x: { field: 'k', type: 'nominal' } } };
const refused = (spec: unknown) => {
  const parsed = parseChartDescription(spec);
  return parsed.ok ? null : parsed.error;
};

it('refuses a Vega-Lite data object with no source, naming where and how to filter rows instead', () => {
  const error = refused({ layer: [{ ...BAR, data: { filter: "datum.kind == 'actual'" } }] });
  expect(error).toMatch(/^layer\[0\]\.data: /);
  expect(error).toMatch(/values, name, sequence, sphere or graticule/);
  expect(error).toMatch(/has filter/);
  expect(error).toMatch(/transform: \[\{filter: …\}\]/);
  expect(refused({ ...BAR, data: { format: { type: 'json' } } })).toMatch(/^data: .*has format/);
  expect(refused({ hconcat: [BAR, { vconcat: [{ ...BAR, data: { filter: 'x' } }] }] })).toMatch(/^hconcat\[1\]\.vconcat\[0\]\.data: /);
  expect(refused({ facet: { field: 'g' }, spec: { ...BAR, data: { calculate: 'x' } } })).toMatch(/^spec\.data: /);
  expect(refused({ ...BAR, transform: [{ lookup: 'k', from: { data: { filter: 'x' }, key: 'k' } }] }))
    .toMatch(/^transform\[0\]\.from\.data: /);
});

it('accepts every data source Vega-Lite knows, inherited or empty data, and a column named data in the rows', () => {
  for (const data of [{ values: [] }, { name: 'main' }, { sequence: { start: 0, stop: 3 } }, { sphere: true },
    { graticule: true }, { name: 'main', format: { type: 'json' } }, null, {}]) {
    expect(refused({ ...BAR, data }), JSON.stringify(data)).toBeNull();
    expect(refused({ layer: [{ ...BAR, data }] }), JSON.stringify(data)).toBeNull();
  }
  expect(refused({ ...BAR, data: { values: [{ data: { filter: 'x' } }] } })).toBeNull();
  expect(refused({ ...BAR, datasets: { main: [{ data: { filter: 'x' } }] }, data: { name: 'main' } })).toBeNull();
  expect(refused({ ...BAR, usermeta: { data: { filter: 'x' } } })).toBeNull();
  // Vega's data is a list of named datasets, its own grammar: not checked here.
  expect(refused({ $schema: 'https://vega.github.io/schema/vega/v6.json', data: [{ name: 't', transform: [] }], marks: [] }))
    .toBeNull();
});

it('names the first child of a composed spec that fails alone, and nothing when none does', () => {
  const bad = { mark: 'bogus' };
  const attempt = (spec: Record<string, unknown>) => {
    if (JSON.stringify(spec).includes('bogus')) throw new Error('engine');
  };
  expect(locateChartFailure({ layer: [BAR, bad] }, attempt)).toBe('layer[1]');
  expect(locateChartFailure({ hconcat: [BAR, { vconcat: [BAR, bad] }] }, attempt)).toBe('hconcat[1].vconcat[1]');
  expect(locateChartFailure({ ...bad, encoding: {} }, attempt)).toBeNull();
  expect(locateChartFailure({ layer: [BAR, BAR] }, () => { throw new Error('always'); })).toBeNull();
});
