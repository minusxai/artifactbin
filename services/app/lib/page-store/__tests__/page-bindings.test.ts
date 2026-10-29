/**
 * `bindPage`: the Helmet script's `signal` / `query` / `mutation` over a store — one binding per store, names checked
 * against the declarations, writes through the store, and the inert bindings a page without a store gets.
 */
import { describe, expect, it } from 'vitest';
import { bindPage, createDataflowStore } from '..';
import { compiledOf } from '@/test/helpers/compiled';

const FLOW = await compiledOf(
  '<Import name="files" src="ref:abc123" />'
  + '<Value name="region" type="string" default="EU" />'
  + '<Value name="t" type="table" value={[{"a":1}]} />'
  + '<Query name="sales">{`select $region as region`}</Query>'
  + '<Mutation name="add">{`insert into t (a) values (2)`}</Mutation>',
  { abc123: [{ name: 'id', type: 'number' }] },
);
const STATE = { values: { region: 'EU' }, tables: { sales: { rows: [{ region: 'EU' }], columns: [] }, t: { rows: [{ a: 1 }], columns: [] } }, errors: {} };
const store = () => createDataflowStore({ flow: FLOW, state: STATE });

describe('bindPage without a store', () => {
  const none = bindPage(null);

  it('names the fix for every declared-name accessor', () => {
    expect(() => none.signal('$x')).toThrow(`page: signal("$x") names no declared Value; write signal('$name') with a name the Helmet declares`);
    expect(() => none.query('$x')).toThrow(/names no declared Query/);
    expect(() => none.mutation('$x')).toThrow(/names no declared Mutation/);
  });

  it('is otherwise inert', async () => {
    await expect(none.upload('files', {} as File)).rejects.toThrow('page.upload is unavailable');
    await expect(none.uploadImage('files', {} as File)).rejects.toThrow('page.uploadImage is unavailable');
    expect([none.fileUrl('files', 'dfile:a1'), none.imageUrl('files', 'dimg:a1')]).toEqual(['', '']);
    expect(none.read('region')).toBeUndefined();
    expect(none.has('region')).toBeNull();
    expect(() => none.dispose()).not.toThrow();
    expect(bindPage(null)).toBe(none);
  });
});

describe('bindPage over a store', () => {
  it('binds once per store until disposed', () => {
    const s = store();
    const page = bindPage(s);
    expect(bindPage(s)).toBe(page);
    expect(bindPage(store())).not.toBe(page);
    page.dispose();
    expect(bindPage(s)).not.toBe(page);
  });

  it('signal reads a declared scalar and writes through the store, by value or updater', () => {
    const s = store();
    const page = bindPage(s);
    const [region, setRegion] = page.signal('$region');
    expect(region()).toBe('EU');
    expect(setRegion('US')).toBe('US');
    expect(s.getState().values.region).toBe('US');
    expect(setRegion((current) => `${current}-2`)).toBe('US-2');
    expect(s.getState().values.region).toBe('US-2');
    expect(page.signal('region')[0]).toBe(region);
    expect(() => page.signal('$sales')).toThrow(/names no declared Value/);
    page.dispose();
  });

  it('query reads a Query or table Value, with its state and a ready promise', async () => {
    const page = bindPage(store());
    const sales = page.query('$sales');
    expect(sales()).toEqual([{ region: 'EU' }]);
    expect(sales.loading()).toBe(false);
    expect(sales.error()).toBeNull();
    await expect(sales.ready).resolves.toEqual([{ region: 'EU' }]);
    expect(page.query('$t')()).toEqual([{ a: 1 }]);
    expect(() => page.query('$region')).toThrow(/names no declared Query or table Value/);
    page.dispose();
  });

  it('mutation, read and has answer by declared name only', () => {
    const page = bindPage(store());
    expect(typeof page.mutation('$add')).toBe('function');
    expect(() => page.mutation('$sales')).toThrow(/names no declared Mutation/);
    expect(page.read('region')?.()).toBe('EU');
    expect(page.read('sales')?.()).toEqual([{ region: 'EU' }]);
    expect(page.read('nope')).toBeUndefined();
    expect([page.has('region'), page.has('t'), page.has('sales'), page.has('add'), page.has('nope')]).toEqual(['value', 'query', 'query', 'mutation', null]);
    page.dispose();
  });

  it('outside a browser page: uploads refuse, and file addresses are empty', async () => {
    const page = bindPage(store());
    await expect(page.upload('files', {} as File)).rejects.toThrow('page.upload requires a browser page');
    await expect(page.uploadImage('files', {} as File)).rejects.toThrow('page.uploadImage requires a browser page');
    expect(page.fileUrl('files', 'dfile:abc')).toBe('');
    expect(page.imageUrl('files', 'dfile:abc')).toBe('');
    expect(page.fileUrl('nope', 'dfile:abc')).toBe('');
    page.dispose();
  });
});
