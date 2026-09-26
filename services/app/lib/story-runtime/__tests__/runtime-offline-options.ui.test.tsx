/**
 * The three seams an offline file composes the runtime with — and nothing else
 * about the runtime moves when they are absent:
 *
 *  - `frozenValues` (store): a Value whose control must stay put, with the
 *    reason the reader is shown in place of the control working;
 *  - `writesUnavailable` (InlineStoryRuntime → store): one reason that refuses
 *    every write on this render, so a button never waits on an access check
 *    that has no one to answer it;
 *  - `components` (InlineStoryRuntime → StoryRuntimeApp): registry overrides,
 *    how a map or managed frame becomes a same-size placeholder.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JsxNode } from '@/lib/jsx';
import { splitHelmet } from '@/lib/story/helmet';
import { parseJsxOrThrow } from '@/test/helpers/jsx';
import { compiledSource } from '@/test/helpers/compiled';
import { InlineStoryRuntime } from '../InlineStoryRuntime';
import { StoryRuntimeApp } from '../StoryRuntimeApp';
import { ACCESS_PENDING, createDataflowStore } from '../store';
import type { StoryIslandData } from '../contract';
import type { DataflowState } from '@/lib/story/dataflow';

afterEach(cleanup);

const REASON = 'This filter needs a connection.';
const HELMET = '<Helmet>'
  + '<Value name="region" type="string" />'
  + '<Value name="note" type="string" />'
  + '<Value name="flag" type="boolean" default={false} />'
  + '<Import name="orders" src="ref:abc123" />'
  + '<Query name="regions">{`select distinct region from orders.rows`}</Query>'
  + '<Query name="sales">{`select * from orders.rows where $region is null or region = $region or $note = region`}</Query>'
  + '<Mutation name="add">{`insert into orders.rows (region) values (\'x\')`}</Mutation>'
  + '</Helmet>';
const FLOW = await compiledSource(HELMET, { abc123: [{ name: 'region', type: 'string' }] });
const STATE: DataflowState = {
  values: { region: null, note: null, flag: false },
  tables: { regions: { rows: [{ region: 'EU' }, { region: 'NA' }], columns: [{ name: 'region', type: 'string' }] } },
  errors: {},
};

function island(body: string): StoryIslandData {
  const { body: nodes } = splitHelmet(parseJsxOrThrow(HELMET + body).nodes as JsxNode[]);
  return {
    nodes, refData: {}, colorMode: 'light', chrome: true,
    dataflow: { flow: FLOW, state: STATE },
  };
}

describe('store: frozen values', () => {
  it('answers the reason for a frozen Value and null for every other one, and nothing by default', () => {
    const { dataflow } = island('<p>x</p>');
    const frozen = createDataflowStore(dataflow!, { frozenValues: { note: REASON } });
    expect(frozen.frozenReason('note')).toBe(REASON);
    expect(frozen.frozenReason('region')).toBeNull();
    expect(createDataflowStore(dataflow!).frozenReason('note')).toBeNull();
  });
});

describe('controls bound to a frozen Value', () => {
  const BODY = '<div>'
    + '<Input label="Note" value="$note" />'
    + '<Select label="Region" value="$region" options="$regions" />'
    + '<Switch label="Flag" checked="$flag" />'
    + '<input aria-label="Native note" value="$note" />'
    + '</div>';

  it('render disabled, described by the reason, with a focusable hint that carries it too', () => {
    const data = island(BODY);
    const store = createDataflowStore(data.dataflow!, { frozenValues: { note: REASON, region: REASON } });
    render(<StoryRuntimeApp {...data} store={store} />);
    for (const name of ['Note', 'Region', 'Native note']) {
      const control = screen.getByRole(name === 'Region' ? 'button' : 'textbox', { name });
      expect(control, name).toBeDisabled();
      expect(control, name).toHaveAttribute('aria-description', REASON);
    }
    // the disabled control cannot take focus; the wrapper that explains it can
    const hints = document.querySelectorAll(`[tabindex="0"][aria-description="${REASON}"]`);
    expect(hints.length).toBe(3);
    // a Value that is not frozen keeps working
    const flag = screen.getByRole('switch', { name: 'Flag' });
    expect(flag).toBeEnabled();
    fireEvent.click(flag);
    expect(store.getValue('flag')).toBe(true);
  });

  it('are untouched when nothing is frozen (the online document)', () => {
    const data = island(BODY);
    render(<StoryRuntimeApp {...data} store={createDataflowStore(data.dataflow!)} />);
    expect(screen.getByRole('textbox', { name: 'Note' })).toBeEnabled();
    expect(screen.getByRole('textbox', { name: 'Note' })).not.toHaveAttribute('aria-description');
    expect(screen.getByRole('button', { name: 'Region' })).toBeEnabled();
    expect(document.querySelectorAll('[tabindex="0"][aria-description]').length).toBe(0);
  });
});

describe('InlineStoryRuntime offline seams', () => {
  const transport = { run: vi.fn(async () => ({ tables: {}, errors: {} })), page: vi.fn(async () => ({ rows: [], columns: [] })) };

  it('writesUnavailable names the refusal on every write button instead of an access check', async () => {
    const data = island('<Button run="$add">Add</Button>');
    render(<InlineStoryRuntime data={data} transport={transport} writesUnavailable="Saving needs a connection." onController={() => {}} />);
    const button = await screen.findByRole('button', { name: 'Add' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-description', 'Saving needs a connection.');
    expect(screen.getByText('Saving needs a connection.')).toBeInTheDocument();
    expect(screen.queryByText(ACCESS_PENDING)).toBeNull();
  });

  it('frozenValues reaches the store the runtime creates', async () => {
    render(<InlineStoryRuntime data={island('<Input label="Note" value="$note" />')} transport={transport} frozenValues={{ note: REASON }} onController={() => {}} />);
    expect(await screen.findByRole('textbox', { name: 'Note' })).toBeDisabled();
  });

  it('components replace a registry entry and receive its authored props', async () => {
    const Placeholder = (props: Record<string, unknown>) => <div role="note" aria-label="map stand-in">height {String(props.height)}</div>;
    const components = { DeckGL: Placeholder };
    render(<InlineStoryRuntime data={island('<DeckGL data="$regions" height={240} layers={[]} />')} transport={transport} components={components} onController={() => {}} />);
    await waitFor(() => expect(screen.getByRole('note', { name: 'map stand-in' })).toHaveTextContent('height 240'));
  });

  it('without the seams a mutation button still waits on the access check (online unchanged)', async () => {
    const pending = { ...transport, run: vi.fn(() => new Promise<never>(() => {})), mutate: vi.fn() };
    render(<InlineStoryRuntime data={island('<Button run="$add">Add</Button>')} transport={pending} onController={() => {}} />);
    expect(await screen.findByRole('button', { name: 'Add' })).toHaveAttribute('aria-description', ACCESS_PENDING);
  });
});
