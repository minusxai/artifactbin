/* @jsxImportSource solid-js */
/**
 * THE CONTROLS AS TODAY'S READER RUNS THEM. Today's page is the runtime's LIVE face (StoryRuntimeApp's
 * adapters over the store), not the registry's static one: no `data-mx-bound` stamp, a field with a
 * writer is not read-only, a textarea's value is its content, a native `<select>` bound to a query
 * lists its rows. Both sides are mounted over the same values and query result and compared byte for
 * byte — raw attribute values, class strings included, as the parity gate compares them.
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { IslandProvider } from '../context';
import { fakeIsland } from './context.test';
import { Input, Textarea, Segmented, Slider, Switch, DatePicker, BoundNative } from '../kit/controls';
import { RECIPES, cn } from '../kit/recipes';
import { peopleClasses } from '../kit/recipes/people';
import { StoryRuntimeApp } from '@/lib/story-runtime/StoryRuntimeApp';
import { createDataflowStore } from '@/lib/story-runtime/store';
import { compiledSource } from '@/test/helpers/compiled';
import { parseJsxOrThrow } from '@/test/helpers/jsx';
import { splitHelmet } from '@/lib/story/helmet';
import type { JsxNode } from '@/lib/jsx';
import type { DataflowState, TableResult } from '@/lib/story/dataflow';

const HELMET = '<Helmet><Value name="region" type="string" /><Value name="min_rev" type="number" default={0} /><Value name="since" type="date" default="2026-01-01" />'
  + '<Value name="compare" type="boolean" default={false} /><Value name="note" type="string" default="" url={false} /><Value name="title" type="string" default="" url={false} />'
  + '<Import name="sales_data" src="ref:abc123" /><Query name="regions">{`select distinct region from sales_data.rows order by 1`}</Query></Helmet>';
const BODY = '<div id="row"><select aria-label="Region" className="ml-2 rounded-md border" value="$region" options="$regions" id="sel" />'
  + '<Input label="Title" value="$title" placeholder="A short title" id="in" /><Textarea label="Note" value="$note" rows={2} id="ta" />'
  + '<Segmented label="Region segments" value="$region" options="$regions" id="seg" />'
  + '<Slider label="Min revenue" value="$min_rev" min={0} max={200} step={10} prefix="$" format=",.0f" id="sl" />'
  + '<DatePicker label="Since" value="$since" id="dp" /><DatePicker label="Until" value="$since" id="dp2" /><Switch label="Compare" checked="$compare" id="sw" /></div>';
const REGIONS: TableResult = { columns: [{ name: 'region', type: 'string' }], rows: [{ region: 'APAC' }, { region: 'EU' }, { region: 'NA' }] } as TableResult;

type Raw = { tag: string; attrs: Record<string, string>; text: string; kids: Raw[] };
const raw = (el: Element): Raw => ({
  tag: el.tagName.toLowerCase(),
  attrs: Object.fromEntries([...el.attributes].filter((a) => a.name !== 'data-hk' && a.name !== 'data-mx-ast').map((a) => [a.name, a.value])),
  text: [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(''),
  kids: [...el.children].map(raw),
});
const cls = (tag: string, props: Record<string, unknown> = {}) => cn(RECIPES[tag]!(props));

async function legacy(values: Record<string, unknown>) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const flow = await compiledSource(HELMET + BODY, { abc123: [{ name: 'region', type: 'string' }] });
  const state: DataflowState = { values: { region: null, min_rev: 0, since: '2026-01-01', compare: false, note: '', title: '', ...values }, tables: { regions: REGIONS }, errors: {}, mutationAccess: {} } as DataflowState;
  const { body } = splitHelmet(parseJsxOrThrow(HELMET + BODY).nodes as JsxNode[]);
  const store = createDataflowStore({ flow, state });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(createElement(StoryRuntimeApp, { nodes: body, refData: {}, dataflow: { flow, state }, store, colorMode: 'light', chrome: false })); });
  return { host, unmount: async () => { await act(async () => root.unmount()); host.remove(); } };
}
async function compiled(values: Record<string, unknown>) {
  const flow = await compiledSource(HELMET + BODY, { abc123: [{ name: 'region', type: 'string' }] });
  const all: Record<string, unknown> = { region: null, min_rev: 0, since: '2026-01-01', compare: false, note: '', title: '', ...values };
  const island = { ...fakeIsland(), values: () => all, value: (n: string) => all[n], table: (n: string) => (n === 'regions' ? REGIONS : undefined), store: () => ({ flow }) } as never;
  const host = document.createElement('div');
  document.body.append(host);
  const dispose = render(() => <IslandProvider value={island}><div id="row">
    <BoundNative tag="select" bind={{ value: 'region', options: 'regions' }} aria-label="Region" class="ml-2 rounded-md border" id="sel" />
    <Input label="Title" value="$title" placeholder="A short title" id="in" class={cls('Input', { label: 'Title' })} />
    <Textarea label="Note" value="$note" rows={2} id="ta" class={cls('Textarea', { label: 'Note' })} />
    <Segmented label="Region segments" value="$region" options="$regions" id="seg" class={cls('Segmented')} />
    <Slider label="Min revenue" value="$min_rev" min={0} max={200} step={10} prefix="$" format=",.0f" id="sl" class={cls('Slider')} />
    <DatePicker label="Since" value="$since" id="dp" class={cls('DatePicker')} />
    <DatePicker label="Until" value="$since" id="dp2" class={cls('DatePicker')} />
    <Switch label="Compare" checked="$compare" id="sw" class={cls('Switch')} />
  </div></IslandProvider>, host);
  return { host, dispose: () => { dispose(); host.remove(); } };
}

describe('bound controls, as today\'s live reader renders them', () => {
  it('writes null when a nullable query select returns to All', async () => {
    const flow = await compiledSource(HELMET + BODY, { abc123: [{ name: 'region', type: 'string' }] });
    const setValue = vi.fn();
    const island = { ...fakeIsland(), value: () => 'EU', table: () => REGIONS, store: () => ({ flow }), setValue } as never;
    const host = document.createElement('div');
    const dispose = render(() => <IslandProvider value={island}><BoundNative tag="select" bind={{ value: 'region', options: 'regions' }} aria-label="Region" /></IslandProvider>, host);
    try {
      const select = host.querySelector('select')!;
      select.value = '';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      expect(setValue).toHaveBeenCalledWith('region', null, undefined);
    } finally { dispose(); }
  });
  for (const [label, values] of [['defaults', {}], ['chosen values', { region: 'EU', min_rev: 1200, title: 'Hello', note: 'Two\nlines', compare: true }]] as const) {
    it(`${label}: every control is byte for byte today's`, async () => {
      const react = await legacy(values);
      const solid = await compiled(values);
      try {
        const ids = ['sel', 'in', 'ta', 'seg', 'sl', 'dp', 'dp2', 'sw'];
        const shapes = (host: HTMLElement) => Object.fromEntries(ids.map((id) => [id, raw(host.querySelector(`#${id}`)!)]));
        expect(shapes(solid.host)).toEqual(shapes(react.host));
      } finally { solid.dispose(); await react.unmount(); }
    });
  }
});

describe('Files, as today\'s live listing renders it', () => {
  it('a bound listing: the section carries no authored id, stamp or class, and each row draws its format\'s glyph', async () => {
    const { Files } = await import('../kit/files');
    const { Files: ReactFiles } = await import('@/components/kit/files');
    const { IconGlyphProvider } = await import('@/components/kit/icon');
    const { buildGlyphMap } = await import('@/lib/story/icon-glyphs');
    const { FILE_GLYPH_NAMES } = await import('@/lib/story-ui/file-glyphs');
    const glyphs = buildGlyphMap(FILE_GLYPH_NAMES);
    const rows = [{ id: 'a1', title: 'Report', format: 'markup' }, { id: 'f1', title: 'Folder', format: 'folder', count: 2 }, { id: 'x', title: 'Odd', format: 'weird' }];
    for (const variant of ['icons', 'tiles']) {
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
      const reactHost = document.createElement('div');
      const root = createRoot(reactHost);
      // What StoryRuntimeApp's FilesAdapter renders: rows, variant, capture — nothing authored.
      await act(async () => { root.render(createElement(IconGlyphProvider, { value: glyphs }, createElement(ReactFiles, { rows, variant, capture: false }))); });
      const island = { ...fakeIsland(), table: () => ({ rows, columns: [] }) } as never;
      const solidHost = document.createElement('div');
      const dispose = render(() => <IslandProvider value={island}><Files data="$files" variant={variant} glyphs={glyphs} id="f" data-mx-ast="1.2" /></IslandProvider>, solidHost);
      try {
        expect(raw(solidHost.firstElementChild!), variant).toEqual(raw(reactHost.firstElementChild!));
        expect(solidHost.querySelectorAll('svg[data-slot="icon"]')).toHaveLength(3);
      } finally { dispose(); await act(async () => root.unmount()); }
    }
  });
});

describe('people, as today\'s live adapters render them', () => {
  it('User, UserImage and UserHandle for a guest and for a known person: byte for byte, whatever the compile-time recipe class', async () => {
    const { User, UserImage, UserHandle } = await import('../kit/people');
    const { User: RUser } = await import('@/components/kit/user');
    const { UserImage: RUserImage } = await import('@/components/kit/user-image');
    const { UserHandle: RUserHandle } = await import('@/components/kit/user-handle');
    const ada = { id: 'usr_ada', name: 'Ada Lovelace', handle: 'ada', image: null };
    const cases: [string, Record<string, unknown>][] = [
      ['guest', { userId: undefined, fallback: 'nobody', className: 'x' }],
      ['known', { userId: 'usr_ada', fallback: 'nobody', className: 'x' }],
      ['unknown id', { userId: 'usr_zed', fallback: 'nobody', className: 'text-red-500 size-20' }],
      ['guest, conflicting class', { userId: undefined, fallback: 'nobody', className: 'text-red-500' }],
    ];
    for (const [label, props] of cases) for (const size of ['sm', 'md', 'lg'] as const) {
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
      const card = props.userId === 'usr_ada' ? ada : undefined;
      const reactHost = document.createElement('div');
      const root = createRoot(reactHost);
      await act(async () => { root.render(createElement('div', null,
        createElement(RUser, { ...props, card, id: 'u' } as never), createElement(RUserImage, { ...props, card, size, id: 'i' } as never), createElement(RUserHandle, { ...props, card, id: 'h' } as never))); });
      const island = { ...fakeIsland(), people: () => ({ usr_ada: ada }) } as never;
      const solidHost = document.createElement('div');
      // As the compiler emits them: the recipe's class, and every state's class (peopleClasses); the authored className is not passed.
      const { className: _authored, ...api } = props;
      const dispose = render(() => <IslandProvider value={island}><div>
        <User {...api} id="u" class={cls('User', props)} classes={peopleClasses('User', props) as never} />
        <UserImage {...api} size={size} id="i" class={cls('UserImage', { ...props, size })} classes={peopleClasses('UserImage', { ...props, size }) as never} />
        <UserHandle {...api} id="h" class={cls('UserHandle', props)} classes={peopleClasses('UserHandle', props) as never} />
      </div></IslandProvider>, solidHost);
      try {
        expect(raw(solidHost.firstElementChild!), `${label} ${size}`).toEqual(raw(reactHost.firstElementChild!));
      } finally { dispose(); await act(async () => root.unmount()); }
    }
  });
});

describe('a bound native control writes the bound Value\'s declared type, as today\'s NativeBoundControl coerces', () => {
  it('an empty choice is null (the "All" entry: `$region is null` in SQL), a number field a number, a text field its text', async () => {
    const flow = await compiledSource('<Helmet><Value name="region" type="string" /><Value name="n" type="number" default={1} /><Value name="q" type="string" default="" /></Helmet><div />');
    const values: Record<string, unknown> = { region: 'EU', n: 1, q: '' };
    const setValue = vi.fn();
    const island = { ...fakeIsland(), values: () => values, value: (name: string) => values[name], table: (name: string) => (name === 'regions' ? REGIONS : undefined), store: () => ({ flow }), setValue } as never;
    const host = document.createElement('div');
    document.body.append(host);
    const dispose = render(() => <IslandProvider value={island}>
      <BoundNative tag="select" bind={{ value: 'region', options: 'regions' }} aria-label="Region" />
      <BoundNative tag="input" bind={{ value: 'n' }} type="number" aria-label="N" />
      <BoundNative tag="input" bind={{ value: 'q' }} aria-label="Q" />
    </IslandProvider>, host);
    const select = host.querySelector('select')!;
    select.value = '';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(setValue).toHaveBeenLastCalledWith('region', null, undefined);
    select.value = 'NA';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(setValue).toHaveBeenLastCalledWith('region', 'NA', undefined);
    const [n, q] = [...host.querySelectorAll('input')];
    n!.value = '42';
    n!.dispatchEvent(new Event('input', { bubbles: true }));
    expect(setValue).toHaveBeenLastCalledWith('n', 42, { debounce: 250 });
    q!.value = 'ramen';
    q!.dispatchEvent(new Event('input', { bubbles: true }));
    expect(setValue).toHaveBeenLastCalledWith('q', 'ramen', { debounce: 250 });
    dispose();
    host.remove();
  });
});
