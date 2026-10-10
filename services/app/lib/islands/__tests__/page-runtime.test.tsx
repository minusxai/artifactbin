/* @jsxImportSource solid-js */
/**
 * THE AUTHOR SCRIPT'S RUNTIME (lib/islands/page-runtime) on Solid: the bindings a script takes from `page`, over a
 * real store, and an exported Solid component mounted where the markup placed it, re-rendering on store changes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEffect, createRoot, For } from 'solid-js';
import { bindPage, mountComponents, pageProxyUrl, type PageBindings } from '../page-runtime';
import { createDataflowStore, type DataflowStore, type QueryTransport } from '@/lib/story-runtime/store';
import type { RunAnswer } from '@/lib/story-runtime/dataflow-core';
import { ACCESS_PENDING } from '@/lib/story-runtime/store';
import { compiledOf } from '@/test/helpers/compiled';
import type { CompiledDataflow, Row } from '@/lib/dataflow';

const reads = (imports: string[], values: string[] = []) => ({ imports, queries: [], values, builtins: [] });
const flow: CompiledDataflow = {
  imports: [{ name: 'd', ref: 'DS1', tables: [{ name: 'rows', columns: [{ name: 'month', type: 'string' }] }] }],
  values: [{ name: 'region', kind: 'scalar', type: 'string', default: 'west' }],
  queries: [{ name: 'monthly', engine: 'sqlite', sql: 'select month from d.rows where region = $region', params: ['region'], reads: reads(['d'], ['region']), columns: [{ name: 'month', type: 'string' }], start: 0, end: 0 }],
  mutations: [],
};
const ROWS: Record<string, Row[]> = { west: [{ month: 'Jan' }, { month: 'Feb' }], east: [{ month: 'Mar' }] };

let store: DataflowStore | null = null;
let bindings: PageBindings | null = null;
afterEach(() => { bindings?.dispose(); store?.dispose(); store = null; bindings = null; document.body.innerHTML = ''; });

function setup() {
  let release: (() => void) | null = null;
  const transport: QueryTransport = {
    run: vi.fn((values: Record<string, unknown>) => new Promise<RunAnswer>((resolve) => {
      const answer = () => resolve({ tables: { monthly: { rows: ROWS[String(values.region)] ?? [], columns: [{ name: 'month', type: 'string' }] } }, errors: {} });
      release = answer;
    })),
    page: vi.fn(),
  };
  store = createDataflowStore({ flow, results: { tables: { monthly: { rows: ROWS.west!, columns: [{ name: 'month', type: 'string' }] } }, errors: {} } }, { transport, debounceMs: 0 });
  bindings = bindPage(store);
  return { store, bindings, land: () => { const r = release; release = null; r?.(); } };
}

describe('the page bindings', () => {
  it('uploads a generic attachment through the declared dataset and keeps legacy image URLs readable', async () => {
    const receipt = { ref:'dfile:abc234def456', url:'/a/abc123/datasets/DS1/files/abc234def456', name:'note.txt', contentType:'text/plain', size:5 };
    const fetch = vi.fn(async (_url:string, _init?:RequestInit) => Response.json(receipt));
    const transport:QueryTransport = {run:async()=>({tables:{},errors:{}}), page:async()=>({rows:[],columns:[]}), image:['/a/abc123/query',fetch,'include']};
    store=createDataflowStore({flow,results:{tables:{},errors:{}}},{transport}); bindings=bindPage(store);
    document.body.setAttribute('data-mx-live-id','abc123'); document.body.setAttribute('data-mx-live-edit','edit1234');
    const file = new File(['hello'], 'note.txt', {type:'text/plain'});
    await expect(bindings.upload('d',file)).resolves.toEqual(receipt);
    expect(fetch).toHaveBeenCalledWith('/a/abc123/datasets/DS1/files', expect.objectContaining({body:file,headers:expect.objectContaining({'X-Filename':'note.txt','X-Edit-Id':'edit1234'})}));
    expect(bindings.fileUrl('d', receipt.ref)).toContain('/datasets/DS1/files/abc234def456');
    expect(bindings.fileUrl('d', 'dimg:abc234def456')).toContain('/datasets/DS1/images/abc234def456');
    expect(bindings.fileUrl('missing',receipt.ref)).toBe('');
    expect(bindings.fileUrl('d','ref:other')).toBe('');
    expect(bindings.imageUrl('d',receipt.ref)).toBe('');
    expect(bindings.imageUrl('d','dimg:abc234def456')).toBe(bindings.fileUrl('d','dimg:abc234def456'));
    document.body.removeAttribute('data-mx-live-id');
    expect(bindings.fileUrl('d',receipt.ref)).toBe('');
    await expect(bindings.upload('missing',file)).rejects.toThrow(/no declared dataset import/);
  });

  it('uploads only through a declared import name and returns a dataset-scoped preview URL',async()=>{
    const upload=vi.fn(async(_url:string,_init?:RequestInit)=>Response.json({ref:'dimg:abc234def456',url:'/a/abc123/datasets/DS1/images/abc234def456'}));
    const transport:QueryTransport={run:async()=>({tables:{},errors:{}}),page:async()=>({rows:[],columns:[]}),image:['/a/abc123/query',upload,'include']};
    store=createDataflowStore({flow,results:{tables:{},errors:{}}},{transport});
    bindings=bindPage(store);
    document.body.setAttribute('data-mx-live-id','abc123');
    document.body.setAttribute('data-mx-live-edit','edit1234');
    const file=new File(['bytes'],'screen.png',{type:'image/png'});
    await expect(bindings.uploadImage('d',file)).resolves.toMatchObject({ref:'dimg:abc234def456'});
    expect(upload).toHaveBeenCalledWith('/a/abc123/datasets/DS1/images',expect.objectContaining({method:'POST',body:file}));
    expect(bindings.imageUrl('d','dimg:abc234def456')).toContain('/a/abc123/datasets/DS1/images/abc234def456');
    await expect(bindings.uploadImage('missing',file)).rejects.toThrow(/no declared dataset import/);
  });

  it('binds a Value as [accessor, setter] over the store, and a Query as tracked rows with loading, error and ready', async () => {
    const { store, bindings, land } = setup();
    const [region, setRegion] = bindings.signal('$region');
    const monthly = bindings.query('$monthly');
    expect(region()).toBe('west');
    expect(monthly()).toEqual(ROWS.west);
    expect(monthly.loading()).toBe(false);
    expect(monthly.error()).toBeNull();

    const seen: string[] = [];
    const stop = createRoot((dispose) => { createEffect(() => seen.push(`${region()}:${monthly().length}:${monthly.loading()}`)); return dispose; });
    setRegion('east');
    expect(store.getState().values.region, 'the setter writes the store').toBe('east');
    expect(region()).toBe('east');
    await vi.waitFor(() => expect(monthly.loading()).toBe(true));
    expect(monthly(), 'the old rows stay while the re-run is in flight').toEqual(ROWS.west);
    const ready = monthly.ready;
    land();
    await expect(ready).resolves.toEqual(ROWS.east);
    expect(monthly()).toEqual(ROWS.east);
    expect(seen[0]).toBe('west:2:false');
    expect(seen.at(-1)).toBe('east:1:false');
    expect(setRegion((current) => `${current}!`), 'the setter takes a function of the current value, as Solid does').toBe('east!');
    stop();
  });

  it('throws loudly on an undeclared name or a name of the wrong kind', () => {
    const { bindings } = setup();
    expect(() => bindings.signal('$nope')).toThrow(/signal\("\$nope"\) names no declared Value/);
    expect(() => bindings.signal('$monthly')).toThrow(/names no declared Value/);
    expect(() => bindings.query('$region')).toThrow(/names no declared Query/);
    expect(() => bindings.mutation('$region')).toThrow(/names no declared Mutation/);
  });
});

describe('a mutation called right after load', () => {
  it('waits for the page\'s edit-access check instead of being refused while it is pending', async () => {
    const voteFlow = await compiledOf('<Import name="votes" src="ref:abc123" /><Value name="choice" type="string" default="ramen" />'
      + '<Mutation name="vote">{`insert into votes.rows (choice) values ($choice)`}</Mutation>', { abc123: [{ name: 'choice', type: 'string' }] });
    let answer!: (r: RunAnswer) => void;
    const mutate = vi.fn(() => Promise.resolve({ dataset: 'abc123' }));
    const transport: QueryTransport = { run: () => new Promise<RunAnswer>((resolve) => { answer = resolve; }), page: () => Promise.reject(new Error('unused')), mutate };
    store = createDataflowStore({ flow: voteFlow }, { transport, debounceMs: 0 });
    bindings = bindPage(store);
    store.start();
    expect(store.mutationUnavailable('vote'), 'the check is in flight').toBe(ACCESS_PENDING);
    await expect(store.mutate('vote'), 'the store alone refuses a write while access is pending').rejects.toThrow(ACCESS_PENDING);

    const written = bindings.mutation('$vote')({ choice: 'tacos' });
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(mutate, 'nothing is sent before the check lands').not.toHaveBeenCalled();
    answer({ tables: {}, errors: {}, mutationAccess: { vote: null } });
    await expect(written).resolves.toBeUndefined();
    expect(mutate).toHaveBeenCalledTimes(1);
  });
});

describe('a mounted component', () => {
  it('renders where the markup placed it, receives a $name prop as the tracked value and a literal as a value, re-renders on a store change and restores the fallback on unmount', async () => {
    const { bindings, land } = setup();
    document.body.innerHTML = `<div id="root"><div data-mx-mount="Months" data-mx-props='{"color":"teal"}' data-mx-bind='{"rows":"monthly","region":"region"}'><p id="fallback">Loading…</p></div></div>`;
    const kinds: string[] = [];
    const Months = (props: { rows: Row[]; region: string; color: string }) => {
      kinds.push(typeof props.rows, typeof props.color);
      return <ul data-color={props.color} data-region={props.region}><For each={props.rows}>{(r) => <li>{String(r.month)}</li>}</For></ul>;
    };
    const unmount = mountComponents(document.getElementById('root')!, { Months }, bindings);
    const months = () => [...document.querySelectorAll('li')].map((li) => li.textContent);
    expect(document.getElementById('fallback')).toBeNull();
    expect(months()).toEqual(['Jan', 'Feb']);
    expect(kinds, 'props.rows is the rows array, not a function; color is a plain value').toEqual(['object', 'string']);
    expect(document.querySelector('ul')?.dataset.color).toBe('teal');

    const [, setRegion] = bindings.signal('$region');
    setRegion('east');
    expect(document.querySelector('ul')?.dataset.region, 'a Value change re-renders the bound prop').toBe('east');
    await vi.waitFor(() => expect(bindings.query('$monthly').loading()).toBe(true));
    land();
    await vi.waitFor(() => expect(months()).toEqual(['Mar']));
    expect(kinds, 'the component body ran once: Solid updates in place').toHaveLength(2);

    unmount();
    expect(document.querySelector('ul')).toBeNull();
    expect(document.getElementById('fallback')?.textContent).toBe('Loading…');
  });

  it('leaves the fallback in place for a name the script does not export', () => {
    const { bindings } = setup();
    document.body.innerHTML = `<div id="root"><div data-mx-mount="Missing"><p id="fallback">Loading…</p></div></div>`;
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    mountComponents(document.getElementById('root')!, {}, bindings);
    expect(document.getElementById('fallback')).not.toBeNull();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('exports no component named Missing'));
    error.mockRestore();
  });
});

describe('proxy(url)', () => {
  it('is the document\'s own /fetch door on the origin it runs on, for an https URL only', () => {
    expect(pageProxyUrl('Ab3xK9', 'https://api.open-meteo.com/v1/forecast?lat=1&lon=2', 'https://416233784b39.lvh.me'))
      .toBe('https://416233784b39.lvh.me/a/Ab3xK9/fetch?url=https%3A%2F%2Fapi.open-meteo.com%2Fv1%2Fforecast%3Flat%3D1%26lon%3D2');
    expect(pageProxyUrl('Ab3xK9', 'https://esm.sh/')).toBe(`${window.location.origin}/a/Ab3xK9/fetch?url=https%3A%2F%2Fesm.sh%2F`);
    for (const bad of ['http://api.example.com/x', '/a/other/query', 'not a url', 42]) expect(() => pageProxyUrl('Ab3xK9', bad), String(bad)).toThrow(/https:\/\/ URL/);
    expect(() => pageProxyUrl(null, 'https://api.example.com/x')).toThrow(/published document/);
  });
});
