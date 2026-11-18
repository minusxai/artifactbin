/**
 * WHERE A DATA COMPONENT'S ROWS CAME FROM (../data-source): one vocabulary for `<af-chart>` and `<af-data-table>`,
 * derived from the `source` the page SQL door puts on a read's answer (`rows.source`), never from page markup.
 */
import { expect, it } from 'vitest';
import { sourceLabel, sourceOf } from '../data-source';

const AT = '2026-11-18T14:32:00.000Z';
const STORED = '2026-11-02T09:05:00.000Z';
const live = { kind: 'live' as const, at: AT };
const stored = { kind: 'snapshot' as const, at: STORED, names: ['orders'] };

it('reads the source an answer carries, and nothing from rows the page gave itself', () => {
  const rows = Object.defineProperty([{ n: 1 }], 'source', { value: live, enumerable: false });
  expect(sourceOf(rows)).toEqual(live);
  expect(sourceOf([{ n: 1 }])).toBeNull();
  expect(sourceOf({ rows: [], source: stored })).toEqual(stored);
  expect(sourceOf(Object.assign([], { source: { kind: 'guess', at: AT } }))).toBeNull();
  expect(sourceOf(Object.assign([], { source: { kind: 'live', at: 'yesterday' } }))).toBeNull();
  expect(sourceLabel([sourceOf([{ n: 1 }])])).toBeNull();
});

it('says Live for a live read, with when and as whom in its tooltip', () => {
  const label = sourceLabel([live])!;
  expect(label).toMatchObject({ state: 'live', text: 'Live' });
  expect(label.tooltip).toMatch(/^Read live as you at .+\.$/);
  expect(label.name).toBe('Data source: Live');
});

it('says Snapshot with the stored time for stored data, naming what was stored', () => {
  const label = sourceLabel([stored])!;
  expect(label.state).toBe('snapshot');
  expect(label.text).toMatch(/^Snapshot · \S.+$/);
  expect(label.text).toContain(new Date(STORED).toLocaleString(undefined, { month: 'short', day: 'numeric' }));
  expect(label.tooltip).toMatch(/^Stored data \(orders\), captured .+\.$/);
});

it('shows Live for a mix and names the stored part in the tooltip', () => {
  const label = sourceLabel([stored, live])!;
  expect(label).toMatchObject({ state: 'live', text: 'Live' });
  expect(label.tooltip).toMatch(/^Read live as you at .+\. orders: stored data, captured .+\.$/);
});

it('says Live · paused while live data waits for the reader to allow it, whatever the rows were', () => {
  for (const sources of [[], [live], [stored]]) {
    expect(sourceLabel(sources, 'consent_required')).toMatchObject({ state: 'paused', text: 'Live · paused', tooltip: 'Live data is paused until you allow it.' });
  }
  // Any other failure says nothing about where rows came from.
  expect(sourceLabel([], 'permission_denied')).toBeNull();
});

it('says Snapshot with no time for rows from a file beside the page, naming the file in its tooltip', () => {
  const file = { kind: 'file' as const, names: ['data/churn.csv'] };
  expect(sourceOf(Object.assign([], { source: file }))).toEqual(file);
  expect(sourceOf(Object.assign([], { source: { kind: 'file', names: [] } }))).toBeNull();
  expect(sourceLabel([file])).toEqual({ state: 'snapshot', text: 'Snapshot', tooltip: 'Rows from data/churn.csv, a file beside the page.', name: 'Data source: Snapshot' });
  // Beside stored or live rows, the file is named in the tooltip and no time is invented for it.
  const mixed = sourceLabel([stored, file])!;
  expect(mixed.text).toMatch(/^Snapshot · \S.+$/);
  expect(mixed.tooltip).toMatch(/^Stored data \(orders\), captured .+\. data\/churn\.csv: rows from a file beside the page\.$/);
  const withLive = sourceLabel([live, file])!;
  expect(withLive).toMatchObject({ state: 'live', text: 'Live' });
  expect(withLive.tooltip).toMatch(/^Read live as you at .+\. data\/churn\.csv: rows from a file beside the page\.$/);
  for (const one of [mixed, withLive]) expect(one.tooltip).not.toContain('Invalid');
});
