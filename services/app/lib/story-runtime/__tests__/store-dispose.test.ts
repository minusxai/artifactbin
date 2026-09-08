import { describe, expect, it, vi } from 'vitest';
import { createDataflowStore, type QueryTransport } from '../store';

describe('document store disposal', () => {
  it('revokes pending results and later writes/subscriptions', async () => {
    let finish!: (value: {tables: {}; errors: {}}) => void;
    const run = vi.fn(() => new Promise<{tables: {}; errors: {}}>(resolve => { finish = resolve; }));
    const transport = { run, page: vi.fn() } satisfies QueryTransport;
    const store = createDataflowStore({ flow: { values: [{ kind:'scalar', name:'n', type:'number', default:0, start:0, end:0 }], queries:[{name:'q',sql:'select 1',start:0,end:0,params:[],refs:[]}] } }, { transport });
    store.start();
    const before = store.getState();
    const listener = vi.fn();
    store.subscribe(listener);
    store.dispose();
    store.setValue('n', 5);
    store.refresh();
    finish({tables:{},errors:{}});
    await Promise.resolve();
    expect(store.getState()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(1);
    const late = vi.fn(); store.subscribe(late); store.setValue('n', 6);
    expect(late).not.toHaveBeenCalled();
  });
});
