/* @jsxImportSource solid-js */
/**
 * THE CONTROLS AS TODAY'S READER RUNS THEM. Today's page is the runtime's LIVE face (StoryRuntimeApp's
 * adapters over the store), not the registry's static one: no `data-mx-bound` stamp, a field with a
 * writer is not read-only, a textarea's value is its content, a native `<select>` bound to a query
 * lists its rows. Both sides are mounted over the same values and query result and compared byte for
 * byte — raw attribute values, class strings included, as the parity gate compares them.
 */
import { describe, expect, it } from 'vitest';
import { render } from 'solid-js/web';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { IslandProvider } from '../context';
import { fakeIsland } from './context.test';
import { Input, Textarea, Segmented, Slider, Switch, DatePicker, BoundNative } from '../kit/controls';
import { RECIPES, cn } from '../kit/recipes';
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
