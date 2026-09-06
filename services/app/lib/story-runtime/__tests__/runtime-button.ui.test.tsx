/**
 * `<Button run="$vote">` — its two faces, and `mx.mutate`.
 *
 * The bare registry renders the STATIC face: the binding never reaches the DOM
 * (`run` is not an HTML attribute), it is stamped `data-mx-bound`, and the
 * button is disabled — the right look with no pretence of working, which is
 * what the edit canvas, a capture and a deck-rail preview need.
 *
 * The runtime overrides it with an adapter wired to the store: a click
 * performs the write, the button says it is busy while that is in flight, and
 * a refusal is SHOWN rather than swallowed — a button that silently does
 * nothing is the failure the whole publish-time validation exists to avoid.
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { parseJsx, type JsxNode } from '@/lib/jsx';
import { renderStoryNodes } from '@/lib/story-ui/interpreter';
import { STORY_UI_COMPONENTS } from '@/lib/story-ui/registry';
import { splitHelmet } from '@/lib/story/helmet';
import { StoryRuntimeApp } from '../StoryRuntimeApp';
import { createDataflowStore, type QueryTransport } from '../store';
import { createMx } from '../mx';
import type { DataflowState } from '@/lib/story/dataflow';

const HELMET =
  '<Helmet><Value name="choice" type="string" default="ramen" />'
  + '<Query name="tally">{`select choice, count(*) votes from ref_abc123 group by 1`}</Query>'
  + '<Mutation name="vote">{`insert into ref_abc123 (choice) values ($choice)`}</Mutation></Helmet>';
const BODY = '<div><Button run="$vote">Vote</Button></div>';
const STATE: DataflowState = { values: { choice: 'ramen' }, tables: { tally: { rows: [], columns: [] } }, errors: {}, mutationAccess:{vote:null} };

function build(body = BODY) {
  const parsed = parseJsx(HELMET + body);
  if (!parsed.ok) throw new Error(parsed.error);
  const { content, body: nodes } = splitHelmet(parsed.nodes as JsxNode[]);
  const flow = { values: content.values, queries: content.queries, mutations: content.mutations };
  return { nodes, dataflow: { flow, state: STATE } };
}

function storeWith(mutate?: QueryTransport['mutate']) {
  const { dataflow } = build();
  const transport: QueryTransport = {
    run: () => Promise.resolve({ tables: {}, errors: {}, mutationAccess:{vote:null} }),
    page: () => Promise.reject(new Error('unused')),
    ...(mutate ? { mutate } : {}),
  };
  return createDataflowStore(dataflow, { transport, debounceMs: 0 });
}

describe('the STATIC face (bare registry)', () => {
  it('never lets $vote reach the DOM, stamps the binding, and disables the button', () => {
    const { nodes } = build();
    const { container } = render(<>{renderStoryNodes(nodes, { components: STORY_UI_COMPONENTS })}</>);
    const button = container.querySelector('button')!;
    expect(button.getAttribute('run')).toBeNull();
    expect(button.getAttribute('data-mx-bound')).toBe('run:$vote');
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe('Vote');
  });

  it('leaves an ordinary Button alone', () => {
    const { nodes } = build('<div><Button>Plain</Button></div>');
    const { container } = render(<>{renderStoryNodes(nodes, { components: STORY_UI_COMPONENTS })}</>);
    const button = container.querySelector('button')!;
    expect(button.disabled).toBe(false);
    expect(button.getAttribute('data-mx-bound')).toBeNull();
  });
});

describe('the LIVE face (runtime registry)', () => {
  it('performs the named mutation with the document\'s current values', async () => {
    const writes: Array<{ name: string; values: Record<string, unknown> }> = [];
    const store = storeWith(async (values, name) => { writes.push({ name, values }); return { dataset: 'abc123' }; });
    const { nodes, dataflow } = build();
    const { getByRole } = render(<StoryRuntimeApp nodes={nodes} refData={{}} dataflow={dataflow} colorMode="light" chrome={true} store={store} />);
    fireEvent.click(getByRole('button', { name: 'Vote' }));
    await waitFor(() => expect(writes).toEqual([{ name: 'vote', values: { choice: 'ramen' } }]));
  });

  it('is busy — aria-busy and disabled — while the write is in flight, and recovers after', async () => {
    let settle: (r: { dataset: string }) => void = () => {};
    const store = storeWith(() => new Promise((resolve) => { settle = resolve; }));
    const { nodes, dataflow } = build();
    const { getByRole } = render(<StoryRuntimeApp nodes={nodes} refData={{}} dataflow={dataflow} colorMode="light" chrome={true} store={store} />);
    const button = getByRole('button', { name: 'Vote' }) as HTMLButtonElement;
    fireEvent.click(button);
    await waitFor(() => expect(button.getAttribute('aria-busy')).toBe('true'));
    expect(button.disabled).toBe(true);
    settle({ dataset: 'abc123' });
    await waitFor(() => expect(button.getAttribute('aria-busy')).toBeNull());
    expect(button.disabled).toBe(false);
  });

  it('SHOWS a refusal beside itself, and clears it on the next attempt', async () => {
    let fail = true;
    const store = storeWith(async () => {
      if (fail) throw new Error('this dataset is not open for writes');
      return { dataset: 'abc123' };
    });
    const { nodes, dataflow } = build();
    const { getByRole, findByRole, queryByRole } = render(
      <StoryRuntimeApp nodes={nodes} refData={{}} dataflow={dataflow} colorMode="light" chrome={true} store={store} />,
    );
    fireEvent.click(getByRole('button', { name: 'Vote' }));
    expect((await findByRole('alert')).textContent).toMatch(/not open for writes/);
    fail = false;
    fireEvent.click(getByRole('button', { name: 'Vote' }));
    await waitFor(() => expect(queryByRole('alert')).toBeNull());
  });

  it('renders a document that cannot write without throwing (no transport, no store)', () => {
    const { nodes, dataflow } = build();
    const { getByRole } = render(<StoryRuntimeApp nodes={nodes} refData={{}} dataflow={dataflow} colorMode="light" chrome={false} />);
    expect(getByRole('button', { name: 'Vote' })).toBeTruthy();
  });
});

describe('mx.mutate — the author script\'s handle on a write', () => {
  it('performs the mutation, and an override becomes a real value change first', async () => {
    const writes: Array<Record<string, unknown>> = [];
    const store = storeWith(async (values) => { writes.push(values); return { dataset: 'abc123' }; });
    const mx = createMx(store);
    await mx.mutate('vote', { choice: 'salad' });
    expect(writes).toEqual([{ choice: 'salad' }]);
    // The override is the document's value now — a bound control shows it.
    expect(mx.params.get('choice')).toBe('salad');
  });

  it('rejects with the server\'s message so a script can report it', async () => {
    const store = storeWith(async () => { throw new Error('dataset is full'); });
    await expect(createMx(store).mutate('vote')).rejects.toThrow(/full/);
  });
});
