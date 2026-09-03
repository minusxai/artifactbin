/**
 * F2 — `<Value>` selections travel in the URL as `$name` params (SEEDED RED by the orchestrator).
 *
 * `readUrlValues` is the ONLY place a URL string becomes typed scalars: it coerces
 * per the declaration, validates like publish validates a default, ignores what is
 * not declared, and falls back to the default on anything invalid — a malformed link
 * must never break a shared document. `writeUrlValues` is its inverse and writes only
 * the values that differ from the declared defaults, keeping every non-`$` param.
 */
import { describe, expect, it } from 'vitest';
import { readUrlValues, writeUrlValues } from '@/lib/story/url-values';
import type { Dataflow } from '@/lib/story/dataflow';

const flow: Dataflow = {
  values: [
    { kind: 'scalar', name: 'season', type: 'string', default: '2026-27', start: 0, end: 0 },
    { kind: 'scalar', name: 'team', type: 'string', default: null, start: 0, end: 0 },
    { kind: 'scalar', name: 'top', type: 'number', default: 10, start: 0, end: 0 },
    { kind: 'scalar', name: 'live', type: 'boolean', default: false, start: 0, end: 0 },
    { kind: 'scalar', name: 'since', type: 'date', default: null, start: 0, end: 0 },
    { kind: 'table', name: 'rows', value: [{ a: 1 }], start: 0, end: 0 },
  ],
  queries: [],
  mutations: [],
} as unknown as Dataflow;

describe('readUrlValues', () => {
  it('reads $-prefixed params and coerces them by the declared type', () => {
    expect(readUrlValues('?$season=2024-25&$team=LAL&$top=5&$live=true&$since=2026-01-15', flow)).toEqual({
      season: '2024-25', team: 'LAL', top: 5, live: true, since: '2026-01-15',
    });
  });

  it('ignores undeclared names, table values and the reserved keys, and never throws', () => {
    expect(readUrlValues('?$nope=1&$rows=[1]&key=abc&chrome=0&edit=1&v=2&season=2020-21', flow)).toEqual({});
    expect(readUrlValues('?$season=%E2', flow)).toEqual({}); // bad percent-encoding
    expect(readUrlValues('', flow)).toEqual({});
    expect(readUrlValues('?', flow)).toEqual({});
  });

  it('falls back to the default on an invalid value (omits it) and reads an empty value as null', () => {
    expect(readUrlValues('?$top=ten&$live=maybe&$since=yesterday', flow)).toEqual({});
    expect(readUrlValues('?$team=', flow)).toEqual({ team: null });
    expect(readUrlValues('?$season=', flow)).toEqual({ season: null });
  });

  it('accepts a percent-encoded dollar sign, since some tools encode it', () => {
    expect(readUrlValues('?%24season=2024-25', flow)).toEqual({ season: '2024-25' });
  });
});

describe('writeUrlValues', () => {
  it('writes only the values that differ from the defaults, keeping every non-$ param', () => {
    expect(writeUrlValues('?v=2&key=k', flow, { season: '2024-25', team: 'LAL', top: 10, live: false, since: null }))
      .toBe('?v=2&key=k&$season=2024-25&$team=LAL');
  });

  it('writes null as an empty value when the default is not null, and drops a $ param that returned to default', () => {
    expect(writeUrlValues('?$season=2024-25&$team=LAL', flow, { season: '2026-27', team: 'LAL' })).toBe('?$team=LAL');
    expect(writeUrlValues('', flow, { season: null })).toBe('?$season=');
  });

  it('is empty when everything is at its default, and round-trips through readUrlValues', () => {
    expect(writeUrlValues('?$season=2024-25', flow, { season: '2026-27' })).toBe('');
    const search = writeUrlValues('', flow, { season: '2024-25', top: 3, live: true, since: '2026-02-01' });
    expect(readUrlValues(search, flow)).toEqual({ season: '2024-25', top: 3, live: true, since: '2026-02-01' });
  });

  it('never writes an undeclared name or a table value', () => {
    expect(writeUrlValues('', flow, { nope: 'x', rows: [{ a: 2 }] } as never)).toBe('');
  });
});
