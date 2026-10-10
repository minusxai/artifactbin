/* @jsxImportSource solid-js */
import { describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { IslandProvider } from '../context';
import { fakeIsland } from './context.test';
import { DataTable } from '../kit/data';
import type { TableResult } from '@/lib/dataflow';

// A measured virtualizer can briefly retain indices from the previous query result.
vi.mock('@tanstack/solid-virtual', () => ({
  createVirtualizer: () => ({
    getVirtualItems: () => [{ index: 0, start: 0 }, { index: 1, start: 32 }],
    getTotalSize: () => 64,
    measureElement: () => {},
    scrollToOffset: () => {},
  }),
}));

describe('DataTable query result shrinking', () => {
  it('ignores a stale virtual index and paints the new row', () => {
    const columns: TableResult['columns'] = [{ name: 'id', type: 'number' }, { name: 'region', type: 'string' }, { name: 'amount', type: 'number' }];
    const [table, setTable] = createSignal<TableResult>({ rows: [{ id: 1, region: 'west', amount: 120 }, { id: 3, region: 'west', amount: 30 }], columns });
    const ctx = fakeIsland();
    ctx.table = () => table();
    const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 300; } });
    const host = document.createElement('div');
    document.body.append(host);
    try {
      const dispose = render(() => <IslandProvider value={ctx}><DataTable data="$orders" /></IslandProvider>, host);
      expect(host.querySelector('tbody')?.textContent).toContain('120');
      setTable({ rows: [{ id: 2, region: 'east', amount: 90 }], columns });
      expect(host.querySelector('tbody')?.textContent).toContain('90');
      expect(host.querySelector('tbody')?.textContent).not.toContain('120');
      dispose();
    } finally {
      host.remove();
      if (height) Object.defineProperty(HTMLElement.prototype, 'clientHeight', height);
      else Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
    }
  });
});
