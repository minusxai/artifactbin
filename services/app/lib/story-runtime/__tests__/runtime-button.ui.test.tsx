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
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { type JsxNode } from '@/lib/jsx';
import { renderStoryNodes } from '@/lib/story-ui/interpreter';
import { STORY_UI_COMPONENTS } from '@/lib/story-ui/registry';
import { splitHelmet } from '@/lib/story/helmet';
import { StoryRuntimeApp } from '../StoryRuntimeApp';
import { createDataflowStore, type QueryTransport } from '../store';
import { createMx } from '../mx';
import type { DataflowState } from '@/lib/story/dataflow';
import { parseJsxOrThrow } from '@/test/helpers/jsx';

const HELMET =
  '<Helmet><Value name="choice" type="string" default="ramen" />'
  + '<Query name="tally" source="ref:abc123">{`select choice, count(*) votes from public.rows group by 1`}</Query>'
  + '<Mutation name="vote" source="ref:abc123">{`insert into public.rows (choice) values ($choice)`}</Mutation></Helmet>';
const BODY = '<div><Button run="$vote">Vote</Button></div>';
const STATE: DataflowState = { values: { choice: 'ramen' }, tables: { tally: { rows: [], columns: [] } }, errors: {}, mutationAccess:{vote:null} };

function build(body = BODY) {
  const parsed = parseJsxOrThrow(HELMET + body);
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

  // A rejection carrying the server's message is store-mutate.test.ts's case: mx.mutate
  // is a pass-through, and that test also pins the busy flag and the capability refresh.
});


describe.each(['For', 'DataTable'])('%s row actions', (kind) => {
  function setup() {
    const button = '<Button run="$complete" aria-label="Complete {$_row.id}">Complete</Button>';
    const body = kind === 'For' ? '<For id="tasks" each={$tasks} keyBy="id">'+button+'</For>'
      : '<DataTable id="tasks" data="$tasks" rowKey="id"><Column col="id">'+button+'</Column></DataTable>';
    const {content, body:nodes} = splitHelmet(parseJsxOrThrow('<Helmet><Query name="tasks" source="ref:abc123">{`select * from public.rows`}</Query><Mutation name="complete" source="ref:abc123">{`update public.rows set done=true where id=$_row.id`}</Mutation></Helmet>'+body).nodes);
    const state: DataflowState = {values:{}, tables:{tasks:{columns:[{name:'id',type:'number'}],rows:[{id:1},{id:2}]}},errors:{},mutationAccess:{complete:null}};
    const dataflow = {flow:{values:content.values, queries:content.queries, mutations:content.mutations},state};
    const mutate = vi.fn().mockResolvedValue({dataset:'abc123'});
    const transport: QueryTransport = {mutate,run:async()=>({tables:state.tables,errors:{},mutationAccess:{complete:null}}),page:vi.fn()};
    const store = createDataflowStore(dataflow,{transport,debounceMs:0});
    const view = render(<StoryRuntimeApp nodes={nodes} refData={{}} dataflow={dataflow} store={store} colorMode="light" chrome />);
    return {...view,store,mutate,dataflow,nodes};
  }
  it('captures the clicked row, prevents duplicate clicks, and leaves other rows enabled through reorder', async()=>{
    const v=setup(); let settle!: (value:{dataset:string})=>void;
    v.mutate.mockImplementation(()=>new Promise(resolve=>{settle=resolve;}));
    fireEvent.click(v.getByRole('button',{name:'Complete 1'}));
    fireEvent.click(v.getByRole('button',{name:'Complete 1'}));
    expect(v.mutate).toHaveBeenCalledTimes(1);
    expect(v.mutate).toHaveBeenCalledWith({},'complete',{id:1});
    await act(async()=>v.store.replaceFlow({...v.dataflow,state:{...v.dataflow.state,tables:{tasks:{...v.dataflow.state.tables.tasks,rows:[{id:2},{id:1}]}}}}));
    expect((v.getByRole('button',{name:'Complete 1'}) as HTMLButtonElement).disabled).toBe(true);
    expect((v.getByRole('button',{name:'Complete 2'}) as HTMLButtonElement).disabled).toBe(false);
    await act(async()=>settle({dataset:'abc123'}));
    await waitFor(()=>expect((v.getByRole('button',{name:'Complete 1'}) as HTMLButtonElement).disabled).toBe(false));
  });
  it('retains pending state while a row disappears and returns', async()=>{
    const v=setup(); let settle!:(value:{dataset:string})=>void;
    v.mutate.mockImplementation(()=>new Promise(resolve=>{settle=resolve;}));
    fireEvent.click(v.getByRole('button',{name:'Complete 1'}));
    await act(async()=>v.store.replaceFlow({...v.dataflow,state:{...v.dataflow.state,tables:{tasks:{...v.dataflow.state.tables.tasks,rows:[{id:2}]}}}}));
    expect(v.queryByRole('button',{name:'Complete 1'})).toBeNull();
    await act(async()=>v.store.replaceFlow(v.dataflow));
    expect((v.getByRole('button',{name:'Complete 1'}) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(v.getByRole('button',{name:'Complete 1'}));
    expect(v.mutate).toHaveBeenCalledTimes(1);
    await act(async()=>settle({dataset:'abc123'}));
  });
  it('renders a disabled static face without leaking the binding',()=>{
    const v=setup();v.unmount();
    const view=render(<StoryRuntimeApp nodes={v.nodes} refData={{}} dataflow={v.dataflow} store={v.store} colorMode="light" chrome={false}/>);
    const button=view.getByRole('button',{name:'Complete 1'}) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('run')).toBeNull();
    fireEvent.click(button);expect(v.mutate).not.toHaveBeenCalled();
  });
  it('shows failures, retries with the current row, and respects revoked access', async()=>{
    const v=setup(); v.mutate.mockRejectedValueOnce(new Error('Write failed'));
    fireEvent.click(v.getByRole('button',{name:'Complete 2'}));
    expect((await v.findByRole('alert')).textContent).toContain('Write failed');
    fireEvent.click(v.getByRole('button',{name:'Complete 2'}));
    await waitFor(()=>expect(v.queryByRole('alert')).toBeNull());
    await act(async()=>v.store.replaceFlow({...v.dataflow,state:{...v.dataflow.state,mutationAccess:{complete:'Access revoked'}}}));
    fireEvent.click(v.getByRole('button',{name:'Complete 1'}));
    expect(v.mutate).toHaveBeenCalledTimes(2);
    expect((v.getByRole('button',{name:'Complete 1'}) as HTMLButtonElement).disabled).toBe(true);
  });
});
