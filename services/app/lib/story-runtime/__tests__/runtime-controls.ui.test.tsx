/**
 * The kit CONTROL components (<Select>/<Slider>/<DatePicker>/<Segmented>/
 * <Switch>) at runtime — the themed siblings of the bindable native controls:
 * resolved from the store, writing back typed through the same coercion, and
 * never letting a `$name` reach the DOM. The dropdown is our own inline
 * searchable combobox/listbox (no portal), so the SSR string is deterministic
 * (closed) and the whole thing lives happily inside the sandboxed document.
 */
import React from 'react';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { parseJsx, type JsxNode } from '@/lib/jsx';
import { splitHelmet } from '@/lib/story/helmet';
import { StoryRuntimeApp } from '../StoryRuntimeApp';
import { createDataflowStore } from '../store';
import type { StoryIslandDataflow } from '../contract';
import type { DataflowState } from '@/lib/story/dataflow';

const HELMET =
  '<Helmet>' +
  '<Value name="region" type="string" />' +
  '<Value name="min_rev" type="number" default={100} />' +
  '<Value name="flag" type="boolean" default={false} />' +
  '<Value name="since" type="date" default="2026-03-01" />' +
  '<Value name="until" type="date" />' +
  '<Query name="regions">{`select distinct region, region || \'!\' label from ref_abc123`}</Query>' +
  '</Helmet>';

const STATE: DataflowState = {
  values: { region: null, min_rev: 100, flag: false, since: '2026-03-01', until: null },
  tables: {
    regions: { rows: [{ region: 'EU', label: 'EU!' }, { region: 'NA', label: 'NA!' }], columns: [{ name: 'region', type: 'string' }, { name: 'label', type: 'string' }] },
  },
  errors: {},
};

function build(body: string) {
  const parsed = parseJsx(HELMET + body);
  if (!parsed.ok) throw new Error(parsed.error);
  const { content, body: nodes } = splitHelmet(parsed.nodes as JsxNode[]);
  const dataflow: StoryIslandDataflow = { flow: { values: content.values, queries: content.queries }, state: STATE };
  return { nodes, dataflow };
}

const BODY =
  '<div>' +
  '<Select label="Region" value="$region" options="$regions" placeholder="All regions" />' +
  '<Slider label="Min revenue" value="$min_rev" min={0} max={5000} step={100} format=",.0f" />' +
  '<DatePicker label="Since" value="$since" />' +
  '<Segmented label="Region segments" value="$region" options="$regions" />' +
  '<Switch label="Compare" checked="$flag" />' +
  '</div>';

describe('StoryRuntimeApp — kit control components', () => {
  it('renders every control from the store, and no $name reaches the DOM', () => {
    const { nodes, dataflow } = build(BODY);
    const { container, getByLabelText } = render(
      <StoryRuntimeApp nodes={nodes} refData={{}} dataflow={dataflow} colorMode="light" chrome={false} />,
    );
    // Select: its original polished trigger stays closed until opened.
    const trigger = getByLabelText('Region') as HTMLButtonElement;
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.textContent).toContain('All regions');
    // Slider: native range seeded from the store, with a formatted readout.
    const range = getByLabelText('Min revenue') as HTMLInputElement;
    expect(range.type).toBe('range');
    expect(range.value).toBe('100');
    expect(range.min).toBe('0');
    expect(range.max).toBe('5000');
    // DatePicker: a themed trigger showing the store's date; the calendar is
    // OUR popover (the native popup is unstylable browser chrome).
    const date = getByLabelText('Since') as HTMLButtonElement;
    expect(date.tagName).toBe('BUTTON');
    expect(date.getAttribute('aria-expanded')).toBe('false');
    expect(date.textContent).toContain('2026-03-01');
    // Segmented: one segment per option plus the null "All" segment, current pressed.
    const group = getByLabelText('Region segments');
    const segments = [...group.querySelectorAll('button')];
    expect(segments.map((b) => b.textContent)).toEqual(['All', 'EU!', 'NA!']);
    expect(segments[0].getAttribute('aria-pressed')).toBe('true');
    // Switch: off.
    const toggle = getByLabelText('Compare');
    expect(toggle.getAttribute('role')).toBe('switch');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    // The binding never reaches the DOM as a literal.
    expect(container.innerHTML).not.toContain('$region');
    expect(container.innerHTML).not.toContain('$min_rev');
    expect(container.innerHTML).not.toContain('$since');
    expect(container.innerHTML).not.toContain('$flag');
  });

  it('the dropdown opens to a listbox of the table options (values + labels) and a change writes the store', () => {
    const { nodes, dataflow } = build(BODY);
    const store = createDataflowStore(dataflow);
    const { getByLabelText, getAllByRole, queryByRole } = render(
      <StoryRuntimeApp nodes={nodes} refData={{}} dataflow={dataflow} store={store} colorMode="light" chrome={false} />,
    );
    const trigger = getByLabelText('Region') as HTMLButtonElement;
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const options = getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['All regions', 'EU!', 'NA!']);
    expect(options[0].getAttribute('aria-selected')).toBe('true'); // null is the current value
    fireEvent.click(options[2]);
    expect(store.getValue('region')).toBe('NA');
    expect(queryByRole('listbox')).toBeNull(); // picking closes it
    expect(trigger.textContent).toContain('NA!');
    // …and the null choice writes null (how "$region is null" means "all").
    fireEvent.click(trigger);
    fireEvent.click(getAllByRole('option')[0]);
    expect(store.getValue('region')).toBeNull();
    // Escape closes without choosing.
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(queryByRole('listbox')).toBeNull();
  });

  it('filters dropdown options as the reader types and selects from the filtered list', () => {
    const { nodes, dataflow } = build(BODY);
    const store = createDataflowStore(dataflow);
    const { getByLabelText, getAllByRole, getByRole, queryAllByRole } = render(
      <StoryRuntimeApp nodes={nodes} refData={{}} dataflow={dataflow} store={store} colorMode="light" chrome={false} />,
    );
    fireEvent.click(getByLabelText('Region'));
    const search = getByLabelText('Search Region') as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'na' } });
    expect(search.value).toBe('na');
    expect(getAllByRole('option').map((o) => o.textContent)).toEqual(['NA!']);
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(store.getValue('region')).toBe('NA');
    expect((getByLabelText('Region') as HTMLButtonElement).textContent).toContain('NA!');

    fireEvent.click(getByLabelText('Region'));
    fireEvent.change(getByLabelText('Search Region'), { target: { value: 'missing' } });
    expect(queryAllByRole('option')).toHaveLength(0);
    expect(getByRole('status').textContent).toBe('No matches');
  });

  it('every control writes the store with the declared type', () => {
    const { nodes, dataflow } = build(BODY);
    const store = createDataflowStore(dataflow);
    const { getByLabelText } = render(
      <StoryRuntimeApp nodes={nodes} refData={{}} dataflow={dataflow} store={store} colorMode="light" chrome={false} />,
    );
    fireEvent.change(getByLabelText('Min revenue'), { target: { value: '2500' } });
    expect(store.getValue('min_rev')).toBe(2500);
    fireEvent.click(getByLabelText('Since'));
    fireEvent.click(getByLabelText('2026-03-15')); // day cells carry their ISO date
    expect(store.getValue('since')).toBe('2026-03-15');
    fireEvent.click(getByLabelText('Compare'));
    expect(store.getValue('flag')).toBe(true);
    const group = getByLabelText('Region segments');
    const segments = [...group.querySelectorAll('button')];
    fireEvent.click(segments[1]);
    expect(store.getValue('region')).toBe('EU');
    fireEvent.click(segments[0]);
    expect(store.getValue('region')).toBeNull();
  });

  it('an external store write (mx.params.set, a live update) reflects in every control', () => {
    const { nodes, dataflow } = build(BODY);
    const store = createDataflowStore(dataflow);
    const { getByLabelText } = render(
      <StoryRuntimeApp nodes={nodes} refData={{}} dataflow={dataflow} store={store} colorMode="light" chrome={false} />,
    );
    act(() => {
      store.setValue('region', 'EU');
      store.setValue('flag', true);
      store.setValue('min_rev', 4000);
    });
    expect((getByLabelText('Region') as HTMLButtonElement).textContent).toContain('EU!');
    const group = getByLabelText('Region segments');
    expect([...group.querySelectorAll('button')][1].getAttribute('aria-pressed')).toBe('true');
    expect(getByLabelText('Compare').getAttribute('aria-checked')).toBe('true');
    expect((getByLabelText('Min revenue') as HTMLInputElement).value).toBe('4000');
  });

  it('inline options (array of strings or {value,label}) work without a table', () => {
    const { nodes, dataflow } = build(
      '<Segmented label="Grain" value="$region" options={["day","week"]} />' +
      '<Select label="Pick" value="$region" options={[{"value":"EU","label":"Europe"}]} />',
    );
    const store = createDataflowStore(dataflow);
    const { getByLabelText, getAllByRole } = render(
      <StoryRuntimeApp nodes={nodes} refData={{}} dataflow={dataflow} store={store} colorMode="light" chrome={false} />,
    );
    const group = getByLabelText('Grain');
    const segments = [...group.querySelectorAll('button')];
    expect(segments.map((b) => b.textContent)).toEqual(['All', 'day', 'week']);
    fireEvent.click(segments[2]);
    expect(store.getValue('region')).toBe('week');
    fireEvent.click(getByLabelText('Pick'));
    expect(getAllByRole('option').map((o) => o.textContent)).toEqual(['All', 'Europe']);
  });

  it('the calendar opens on the bound month, navigates, disables days outside min/max, and Clear appears only for a null-default Value', () => {
    const { nodes, dataflow } = build(
      '<DatePicker label="Since" value="$since" min="2026-03-03" max="2026-04-10" />' +
      '<DatePicker label="Until" value="$until" />',
    );
    const store = createDataflowStore(dataflow);
    const { getByLabelText, queryByText, getByText } = render(
      <StoryRuntimeApp nodes={nodes} refData={{}} dataflow={dataflow} store={store} colorMode="light" chrome={false} />,
    );
    fireEvent.click(getByLabelText('Since'));
    expect(getByText('March 2026')).toBeTruthy(); // opens on the value's month
    expect((getByLabelText('2026-03-02') as HTMLButtonElement).disabled).toBe(true); // before min
    expect((getByLabelText('2026-03-10') as HTMLButtonElement).disabled).toBe(false);
    expect(queryByText('Clear')).toBeNull(); // `since` declares a default — null is not offered
    fireEvent.click(getByLabelText('Next month'));
    expect(getByText('April 2026')).toBeTruthy();
    expect((getByLabelText('2026-04-11') as HTMLButtonElement).disabled).toBe(true); // after max
    fireEvent.keyDown(getByLabelText('Since'), { key: 'Escape' });
    // A null-default date Value gets the Clear affordance, writing null.
    const today = new Date();
    const currentMonthDay = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-05`;
    fireEvent.click(getByLabelText('Until'));
    fireEvent.click(getByLabelText(currentMonthDay));
    expect(store.getValue('until')).toBe(currentMonthDay);
    fireEvent.click(getByLabelText('Until'));
    fireEvent.click(getByText('Clear'));
    expect(store.getValue('until')).toBeNull();
  });

  it('the SSR string hydrates without a mismatch (closed dropdown, same store state)', () => {
    const { nodes, dataflow } = build(BODY);
    const html = renderToString(
      <StoryRuntimeApp nodes={nodes} refData={{}} dataflow={dataflow} colorMode="light" chrome={false} />,
    );
    expect(html).not.toContain('$region');
    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.appendChild(host);
    const onRecoverableError = vi.fn();
    const store = createDataflowStore(dataflow);
    act(() => {
      hydrateRoot(
        host,
        <StoryRuntimeApp nodes={nodes} refData={{}} dataflow={dataflow} store={store} colorMode="light" chrome={false} />,
        { onRecoverableError },
      );
    });
    expect(onRecoverableError).not.toHaveBeenCalled();
    document.body.removeChild(host);
  });
});
