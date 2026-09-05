import React from 'react';
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { parseJsx, type JsxNode } from '@/lib/jsx';
import { splitHelmet } from '@/lib/story/helmet';
import { StoryRuntimeApp } from '../StoryRuntimeApp';
import type { StoryIslandDataflow } from '../contract';
import { createDataflowStore } from '../store';

const LOADED: StoryIslandDataflow = {
  flow: { values: [], queries: [] },
  state: {
    values: {},
    tables: {
      loaded: {
        rows: [{ label: 'A', amount: 12 }],
        columns: [{ name: 'label', type: 'string' }, { name: 'amount', type: 'number' }],
      },
    },
    errors: {},
  },
};

describe('persisted source ids reach runtime embed targets', () => {
  for (const tag of ['Question', 'Number', 'DataTable']) {
    it(`${tag} preserves its authored id on exactly one DOM target even without loaded data`, () => {
      const parsed = parseJsx(`<${tag} id="node-a" data="$missing" />`);
      if (!parsed.ok) throw new Error(parsed.error);
      const app = <StoryRuntimeApp nodes={parsed.nodes} refData={{}} colorMode="light" chrome={false} />;
      const { container, rerender } = render(app);
      const targets = container.querySelectorAll('[id="node-a"]');
      expect(targets).toHaveLength(1);
      expect(targets[0].getAttribute('data-mx-ast')).toBe('0');
      rerender(<StoryRuntimeApp nodes={parsed.nodes} refData={{}} colorMode="light" chrome={false} />);
      expect(container.querySelectorAll('[id="node-a"]')).toHaveLength(1);
    });
  }

  for (const tag of ['Question', 'Number', 'DataTable']) {
    it(`${tag} keeps id and AST identity on its outer target after data loads`, () => {
      const parsed = parseJsx(`<${tag} id="loaded-${tag}" data="$loaded" />`);
      if (!parsed.ok) throw new Error(parsed.error);
      const { container } = render(
        <StoryRuntimeApp nodes={parsed.nodes} refData={{}} dataflow={LOADED} colorMode="light" chrome={false} />,
      );
      const target = container.querySelector(`[id="loaded-${tag}"]`);
      expect(target?.getAttribute('data-mx-ast')).toBe('0');
      expect(container.querySelectorAll(`[id="loaded-${tag}"]`)).toHaveLength(1);
    });
  }

  it('keeps identity on a DataTable error target', () => {
    const parsed = parseJsx('<DataTable id="failed-table" data="$failed" />');
    if (!parsed.ok) throw new Error(parsed.error);
    const dataflow: StoryIslandDataflow = {
      flow: { values: [], queries: [] },
      state: { values: {}, tables: {}, errors: { failed: 'query failed' } },
    };
    const { container } = render(
      <StoryRuntimeApp nodes={parsed.nodes} refData={{}} dataflow={dataflow} colorMode="light" chrome={false} />,
    );
    const target = container.querySelector('#failed-table');
    expect(target?.getAttribute('data-mx-ast')).toBe('0');
    expect(target?.textContent).toContain('query failed');
  });

  it('keeps exactly one identity target while all three embeds are pending', async () => {
    const parsed = parseJsx(
      '<Helmet><Value name="pick" default="a" /><Query name="rows">{`select $pick label, 12 amount`}</Query></Helmet>'
      + '<div><Question id="pending-question" data="$rows" /><Number id="pending-number" data="$rows" col="amount" /><DataTable id="pending-table" data="$rows" /></div>',
    );
    if (!parsed.ok) throw new Error(parsed.error);
    const { content, body: nodes } = splitHelmet(parsed.nodes as JsxNode[]);
    const dataflow: StoryIslandDataflow = {
      flow: { values: content.values, queries: content.queries },
      state: LOADED.state,
    };
    const store = createDataflowStore(dataflow, {
      debounceMs: 0,
      transport: {
        run: () => new Promise(() => {}),
        page: () => Promise.reject(new Error('not used')),
      },
    });
    const { container } = render(
      <StoryRuntimeApp nodes={nodes} refData={{}} dataflow={dataflow} store={store} colorMode="light" chrome={false} />,
    );
    act(() => { store.setValue('pick', 'b'); });
    await waitFor(() => expect(container.querySelector('#pending-question')?.getAttribute('aria-busy')).toBe('true'));
    for (const id of ['pending-question', 'pending-number', 'pending-table']) {
      const targets = container.querySelectorAll(`#${id}`);
      expect(targets).toHaveLength(1);
      expect(targets[0].getAttribute('data-mx-ast')).toMatch(/^0\./);
    }
    expect(container.querySelector('#pending-number')?.getAttribute('aria-busy')).toBe('true');
    expect(container.querySelector('#pending-table')?.textContent).toContain('loading data');
  });

  it('keeps authored identity on native and kit bound-control outer targets', () => {
    const parsed = parseJsx(
      '<div>'
      + '<input id="native-input" value="$pick" />'
      + '<select id="native-select" value="$pick"><option value="a">A</option></select>'
      + '<textarea id="native-textarea" value="$pick" />'
      + '<Select id="kit-select" value="$pick" options={["a"]} />'
      + '<Segmented id="kit-segmented" value="$pick" options={["a"]} />'
      + '<Slider id="kit-slider" value="$amount" />'
      + '<DatePicker id="kit-date" value="$date" />'
      + '<Switch id="kit-switch" checked="$enabled" />'
      + '<Button id="kit-button" run="$save">Save</Button>'
      + '</div>',
    );
    if (!parsed.ok) throw new Error(parsed.error);
    const { container } = render(
      <StoryRuntimeApp nodes={parsed.nodes} refData={{}} colorMode="light" chrome={false} />,
    );
    for (const id of ['native-input', 'native-select', 'native-textarea', 'kit-select', 'kit-segmented', 'kit-slider', 'kit-date', 'kit-switch', 'kit-button']) {
      const targets = container.querySelectorAll(`[id="${id}"]`);
      expect(targets).toHaveLength(1);
      expect(targets[0].getAttribute('data-mx-ast')).toMatch(/^0\./);
    }
  });
});
