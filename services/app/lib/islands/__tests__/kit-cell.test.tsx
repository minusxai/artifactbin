/* @jsxImportSource solid-js */
/**
 * `<Cell>` — one value of a table, live. A number renders through `format` exactly as `<Number>` always has; a
 * text cell renders as written, prefix and suffix around it, `format` ignored. The earlier export names stay: a
 * page compiled before the rename imports `Number` and `Question` from `@mx/kit/data` by name and runs against the
 * newest kit (lib/compiled-page/runtime-binding).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render } from 'solid-js/web';
import { IslandProvider } from '../context';
import { fakeIsland } from './context.test';
import * as kit from '../kit/data';
import type { TableResult } from '@/lib/dataflow';

const { Cell } = kit;
const people: TableResult = {
  rows: [{ name: 'Ada', joined: '2025-01-01', score: 1234.5 }, { name: 'Grace', joined: '2025-02-01', score: 99 }],
  columns: [{ name: 'name', type: 'string' }, { name: 'joined', type: 'date' }, { name: 'score', type: 'number' }],
};
const island = () => { const i = fakeIsland({}); i.table = (n) => (n === 'people' ? people : undefined); i.tableSnapshot = i.table; return i; };
const mount = (view: () => import('solid-js').JSX.Element) => {
  const host = document.createElement('div'); document.body.append(host);
  const unmount = render(() => <IslandProvider value={island()}>{view()}</IslandProvider>, host);
  return { host, dispose: () => { unmount(); host.remove(); } };
};
beforeEach(() => document.documentElement.setAttribute('data-mx-ready', ''));
afterEach(() => document.documentElement.removeAttribute('data-mx-ready'));

describe('Cell', () => {
  it('renders a text cell as written, with prefix and suffix and without format', () => {
    const { host, dispose } = mount(() => <Cell data="$people" col="name" prefix="« " suffix=" »" format="$,.0f" id="c" />);
    try {
      expect(host.querySelector('#c [aria-label="Live number"]')?.textContent).toBe('« Ada »');
    } finally { dispose(); }
  });

  it('takes the last row\'s text under agg="last", and a date as written', () => {
    const { host, dispose } = mount(() => <><Cell data="$people" col="name" agg="last" id="a" /><Cell data="$people" col="joined" id="b" /></>);
    try {
      expect(host.querySelector('#a')?.textContent).toBe('Grace');
      expect(host.querySelector('#b')?.textContent).toBe('2025-01-01');
    } finally { dispose(); }
  });

  it('formats a number exactly as before', () => {
    const { host, dispose } = mount(() => <><Cell data="$people" col="score" format="$,.0f" id="n" /><Cell data="$people" col="score" agg="sum" format=",.1f" suffix=" pts" id="s" /><Cell data="$people" col="name" agg="avg" id="x" /></>);
    try {
      expect(host.querySelector('#n')?.textContent).toBe('$1,235');
      expect(host.querySelector('#s')?.textContent).toBe('1,333.5 pts');
      expect(host.querySelector('#x')?.textContent).toBe('—');
    } finally { dispose(); }
  });

  it('keeps the earlier export names as the same components', () => {
    expect(kit.Number).toBe(kit.Cell);
    expect(kit.Question).toBe(kit.Chart);
  });
});
