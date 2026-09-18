/**
 * The kit CONTROL components (<Select>/<Slider>/<DatePicker>/<Segmented>/
 * <Switch>) at runtime — the themed siblings of the bindable native controls:
 * resolved from the store, writing back typed through the same coercion, and
 * never letting a `$name` reach the DOM. The dropdown is our own inline
 * searchable combobox/listbox (no portal), so the SSR string is deterministic
 * (closed) and the whole thing lives happily inside the sandboxed document.
 */
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { beforeEach } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { type JsxNode } from '@/lib/jsx';
import { splitHelmet } from '@/lib/story/helmet';
import { StoryRuntimeApp } from '../StoryRuntimeApp';
import { createDataflowStore } from '../store';
import type { StoryIslandDataflow } from '../contract';
import { initialValues, initialTables } from '@/lib/story/dataflow';
import type { DataflowState } from '@/lib/story/dataflow';
import type { PersonCard } from '@artifactbin/contracts';
import { parseJsxOrThrow } from '@/test/helpers/jsx';
import { personFaceBackground, personInitial } from '@/lib/person-face';

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
  const parsed = parseJsxOrThrow(HELMET + body);
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

  it('an external store write (mx.set, a live update) reflects in every control', () => {
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

/** <Dialog> is a control too: open state is a signal, and submit runs a mutation. */
describe('<Dialog> bound to the store', () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = function () {this.open = true;};
    HTMLDialogElement.prototype.close = function () {this.open = false; this.dispatchEvent(new Event('close'));};
  });
  
  it('binds dialog state two ways and submits with current signals through the existing mutation transport', async () => {
    const parsed = parseJsxOrThrow('<Helmet><Value name="editing" type="boolean" default={false} /><Value name="title" type="string" default="First" /><Mutation name="save" source="ref:abc123">{`insert into public.rows (title) values ($title)`}</Mutation></Helmet><Dialog open="$editing"><DialogTrigger>Open</DialogTrigger><DialogContent run="$save" aria-label="Editor"><input aria-label="Title" value="$title" required /><button type="submit">Save</button><DialogClose>Cancel</DialogClose></DialogContent></Dialog>{$editing && <p>Editing</p>}');
    const {content, body: nodes} = splitHelmet(parsed.nodes);
    const flow = {values: content.values, queries: content.queries, mutations: content.mutations};
    const state = {values: initialValues(flow), tables: initialTables(flow), errors: {}, mutationAccess: {save: null}};
    const mutate = vi.fn(async () => ({dataset: 'abc123'}));
    const store = createDataflowStore({flow, state}, {transport: {run: async () => ({tables: {}, errors: {}, mutationAccess: {save:null}}), page: async () => ({rows:[],columns:[]}), mutate}, debounceMs: 0});
    const view = render(<StoryRuntimeApp nodes={nodes} refData={{}} dataflow={{flow,state}} colorMode="light" chrome={true} store={store} />);
    fireEvent.click(view.getByText('Open'));
    expect(store.getValue('editing')).toBe(true);
    expect(view.getByText('Editing')).toBeVisible();
    fireEvent.change(view.getByLabelText('Title'), {target: {value: 'Updated'}});
    const field = view.getByLabelText('Title') as HTMLInputElement;
    expect(field.value).toBe('Updated');
    expect(field.validity.valid).toBe(true);
    expect(view.getByRole('dialog').querySelector('form')!.checkValidity()).toBe(true);
    fireEvent.click(view.getByText('Save'));
    await waitFor(() => expect(store.getValue('editing')).toBe(false));
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({title:'Updated'}), 'save');
    expect(view.queryByText('Editing')).toBeNull();
  });

  /**
   * The trigger wrapping a `<Button>` — what production shipped
   * (`<DialogTrigger><Button>Add task</Button>`).
   * Two nested `<button>`s are not HTML: the parser promotes the inner one out
   * of the trigger, React hydrates against that reshaped DOM and throws the
   * minified error 418 the browser gate recorded. Hydrating the SSR string is
   * the whole check — and the dialog must still open from the author's button.
   */
  it('hydrates a DialogTrigger wrapped around a Button without a mismatch, and it still opens the dialog', () => {
    const parsed = parseJsxOrThrow('<Helmet><Value name="adding" type="boolean" default={false} /></Helmet><Dialog open="$adding"><DialogTrigger><Button>Add task</Button></DialogTrigger><DialogContent aria-label="Add a task"><DialogClose>Cancel</DialogClose></DialogContent></Dialog>');
    const {content, body: nodes} = splitHelmet(parsed.nodes);
    const flow = {values: content.values, queries: content.queries, mutations: content.mutations};
    const state = {values: initialValues(flow), tables: initialTables(flow), errors: {}};
    const props = {nodes, refData: {}, dataflow: {flow, state}, colorMode: 'light' as const, chrome: true};
    const html = renderToString(<StoryRuntimeApp {...props} />);
    expect(html).not.toMatch(/<button[^>]*>\s*<button/); // a button around a button is what the parser tears apart
    const host = document.createElement('div');
    // innerHTML runs the browser's own parsing algorithm over the served
    // markup — the step that tore the nested buttons apart.
    host.innerHTML = html;
    document.body.appendChild(host);
    const onRecoverableError = vi.fn();
    const store = createDataflowStore({flow, state});
    act(() => { hydrateRoot(host, <StoryRuntimeApp {...props} store={store} />, {onRecoverableError}); });
    expect(onRecoverableError.mock.calls.map(c => String(c[0]))).toEqual([]);
    fireEvent.click(host.querySelector('button')!); // the author's <Button>, first in the document
    expect(store.getValue('adding')).toBe(true);
    document.body.removeChild(host);
  });
});

/** A server-computed person, as `state.people` carries them. */
const card=(name:string,extra:Partial<PersonCard>={}):PersonCard=>({name,handle:null,image:null,...extra});

describe('native user controls',()=>{
 it('uses explicit participant query choices and visible names for a user dropdown',()=>{
  const {content,body}=splitHelmet(parseJsxOrThrow('<Helmet><Value name="person" type="user" /><Query name="members">{`select person from participants`}</Query></Helmet><Select label="Participant" value="$person" options="$members" />').nodes);
  const flow={values:content.values,queries:content.queries};
  const state:DataflowState={values:{person:null},errors:{},tables:{members:{columns:[{name:'person',type:'user'}],rows:[{person:'usr_ada'}]}},userOptions:{person:[]},people:{usr_ada:card('Ada'),usr_grace:card('Grace')}};
  const view=render(<StoryRuntimeApp nodes={body} refData={{}} dataflow={{flow,state}} colorMode="light" />);
  fireEvent.click(view.getByLabelText('Participant'));
  expect(view.getByRole('option',{name:'Ada'})).toBeTruthy();
  expect(view.queryByRole('option',{name:'Grace'})).toBeNull();
 });
 it('uses server-scoped choices and renders user labels without authored options',()=>{
  const {content,body}=splitHelmet(parseJsxOrThrow('<Helmet><Value name="person" type="user" /></Helmet><Select label="Assignee" value="$person" /><DataTable data="$tasks" />').nodes);
  const flow={values:content.values,queries:[]};
  const state:DataflowState={values:{person:null},errors:{},tables:{tasks:{columns:[{name:'assigned_to',type:'user'}],rows:[{assigned_to:'usr_ada'}]}},userOptions:{person:[{value:'usr_ada',label:'Ada'},{value:'usr_grace',label:'Grace'}]},people:{usr_ada:card('Ada')}};
  const dataflow={flow,state};
  const store=createDataflowStore(dataflow,{transport:{run:vi.fn().mockResolvedValue({tables:{},errors:{}}),page:vi.fn()},debounceMs:0});
  const view=render(<StoryRuntimeApp nodes={body} refData={{}} dataflow={dataflow} store={store} colorMode="light" chrome={false}/>);
  expect(view.container.textContent).toContain('Ada');
  expect(view.container.textContent).not.toContain('usr_ada');
  fireEvent.click(view.getByLabelText('Assignee'));
  fireEvent.click(view.getByRole('option',{name:'Grace'}));
  expect(store.getValue('person')).toBe('usr_grace');
  store.dispose();
 });
});

/**
 * WHO IS READING, at runtime. `$_me` is the viewer's account id and comes off
 * the ISLAND, not the store — so a document that declares no data at all still
 * branches correctly, and it does so on the FIRST paint: a guest must never
 * flash the signed-in branch, and the server string and the hydrated tree must
 * be the same tree.
 */
describe('the viewer in markup', () => {
  const bodyOf = (source: string): JsxNode[] => splitHelmet(parseJsxOrThrow(source).nodes as JsxNode[]).body;
  const BRANCH = '<div>{$_me ? <p>in</p> : <SignIn>Join</SignIn>}</div>';
  const MEL = { id: 'usr_mel', card: card('Mel') };

  it('gives a guest the sign-in door, returning to the address they are on', () => {
    window.history.pushState({}, '', '/a/abc123?$team=LAL#notes');
    // Restored even on a failure: the address is global to this jsdom, and a
    // single bad assertion would otherwise run every later test on /a/abc123.
    try {
      const view = render(<StoryRuntimeApp nodes={bodyOf(BRANCH)} refData={{}} colorMode="light" />);
      const link = view.getByRole('link', { name: 'Join' });
      expect(link.getAttribute('target')).toBe('_top');
      expect(link.getAttribute('href')).toBe(`/login?callbackUrl=${encodeURIComponent('/a/abc123?$team=LAL#notes')}`);
      expect(view.queryByText('in')).toBeNull();
    } finally {
      window.history.pushState({}, '', '/');
    }
  });

  it('gives a signed-in reader the other branch and no door at all', () => {
    const view = render(<StoryRuntimeApp nodes={bodyOf(BRANCH)} refData={{}} viewer={MEL} colorMode="light" />);
    expect(view.getByText('in')).toBeTruthy();
    expect(view.queryByRole('link', { name: 'Join' })).toBeNull();
  });

  it('hydrates the signed-in branch against the server string without a mismatch', () => {
    const props = { nodes: bodyOf(BRANCH), refData: {}, viewer: MEL, colorMode: 'light' as const };
    const html = renderToString(<StoryRuntimeApp {...props} />);
    expect(html).toContain('in</p>');
    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.appendChild(host);
    const onRecoverableError = vi.fn();
    act(() => { hydrateRoot(host, <StoryRuntimeApp {...props} />, { onRecoverableError }); });
    expect(onRecoverableError.mock.calls.map(c => String(c[0]))).toEqual([]);
    document.body.removeChild(host);
  });

  it('names a person by literal id, by $_me, and inside a For; nothing for a null id', () => {
    const source = '<Helmet><Value name="payer" type="user" default="usr_ada" />'
      + '<Value name="rows" type="table" value={[{"paid_by":"usr_grace"},{"paid_by":"usr_nobody"},{"paid_by":null}]} /></Helmet>'
      + '<p id="literal"><User userId="usr_ada" /></p>'
      + '<p id="mine"><User userId="$_me" /></p>'
      + '<p id="bound"><User userId="$payer" /></p>'
      + '<For each={$rows}><span><User userId="$_row.paid_by" fallback="nobody" /></span></For>';
    const { content, body } = splitHelmet(parseJsxOrThrow(source).nodes as JsxNode[]);
    const flow = { values: content.values, queries: [] };
    const state: DataflowState = {
      values: { payer: 'usr_ada' }, errors: {}, tables: initialTables(flow),
      people: { usr_ada: card('Ada'), usr_grace: card('Grace') },
    };
    const view = render(<StoryRuntimeApp nodes={body} refData={{}} dataflow={{ flow, state }} viewer={MEL} colorMode="light" />);
    const named = (selector: string) => view.container.querySelector(`${selector} [data-slot="user-handle"]`)!.textContent;
    expect(named('#literal')).toBe('Ada');
    expect(named('#mine')).toBe('Mel');
    expect(named('#bound')).toBe('Ada');
    // The picture is part of a person now, so the composition draws one by default.
    expect(view.container.querySelector('#literal [data-slot="avatar"]')).toBeTruthy();
    const cells = [...view.container.querySelectorAll('span')].map(s => s.textContent);
    expect(cells).toContain('Grace');
    // An id this viewer cannot name is a neutral person, never the raw id.
    expect(cells).toContain('Unknown person');
    expect(view.container.textContent).not.toContain('usr_nobody');
    expect(cells).toContain('nobody');
  });

  /*
   * A DataTable cell is NOT the <For> path: <For> sets `repeatScope` and a
   * <Column> template sets `tableCommentScope`, and scopeProps branches on
   * which one it is. The <User> seam takes `id` out before either sees it, so
   * both must resolve a row field the same way.
   */
  it('names a row field inside a Column, and still names the user cells beside it', () => {
    const source = '<Helmet><Value name="tasks" type="table" value={[{"id":1,"paid_by":"usr_grace","who":"usr_ada"}]} /></Helmet>'
      + '<DataTable data="$tasks" rowKey="id"><Column col="who" /><Column col="paid_by"><User userId="$_row.paid_by" /></Column></DataTable>';
    const { content, body } = splitHelmet(parseJsxOrThrow(source).nodes as JsxNode[]);
    const flow = { values: content.values, queries: [] };
    const tables = { tasks: { columns: [{ name: 'id', type: 'number' as const }, { name: 'paid_by', type: 'string' as const }, { name: 'who', type: 'user' as const }], rows: [{ id: 1, paid_by: 'usr_grace', who: 'usr_ada' }] } };
    const state: DataflowState = { values: {}, errors: {}, tables, people: { usr_ada: card('Ada'), usr_grace: card('Grace') } };
    const store = createDataflowStore({ flow, state }, { transport: { run: vi.fn().mockResolvedValue({ tables: {}, errors: {} }), page: vi.fn() }, debounceMs: 0 });
    const view = render(<StoryRuntimeApp nodes={body} refData={{}} dataflow={{ flow, state }} store={store} viewer={MEL} colorMode="light" />);
    expect(view.container.textContent).toContain('Grace');
    expect(view.container.textContent).toContain('Ada');
    expect(view.container.textContent).not.toContain('usr_');
    store.dispose();
  });

  /*
   * THE SAME PERSON, TWICE. A document may name the viewer in more than one
   * place — a byline and a big face beside it, a row of faces. Every one of
   * them must resolve, on the server string itself (not only after hydration).
   */
  it.each([
    ['a User and a UserImage', '<p><User userId="$_me" /> <UserImage userId="$_me" size="lg" /></p>'],
    ['two UserImages', '<p><UserImage userId="$_me" /> <UserImage userId="$_me" size="lg" /></p>'],
    ['a UserHandle and a UserImage', '<p><UserHandle userId="$_me" /> <UserImage userId="$_me" size="lg" /></p>'],
  ])('resolves every $_me tag in one document to the viewer, on the server: %s', (_label, markup) => {
    const html = renderToString(<StoryRuntimeApp nodes={bodyOf(markup)} refData={{}} viewer={MEL} colorMode="light" />);
    const host = document.createElement('div');
    host.innerHTML = html;
    expect(host.querySelectorAll('[data-unknown]')).toHaveLength(0);
    expect(host.textContent).not.toContain('Unknown person');
    // Every face is the viewer's: their initial on their colour — the named
    // one alone, and the one inside a <User> beside its handle.
    const faces = [...host.querySelectorAll('[data-slot="avatar"]')];
    expect(faces.length).toBeGreaterThan(0);
    expect(host.querySelector('[role="img"][aria-label="Mel"]')).toBeTruthy();
    for (const face of faces) {
      expect(face.textContent).toBe(personInitial('Mel'));
      expect(face.getAttribute('style')).toContain(personFaceBackground('usr_mel'));
    }
    for (const handle of host.querySelectorAll('[data-slot="user-handle"]')) expect(handle.textContent).toBe('Mel');
  });

  it('shows the viewer their own name even before any query has answered', () => {
    const view = render(<StoryRuntimeApp nodes={bodyOf('<p id="mine"><User userId="$_me" avatar /></p>')} refData={{}} viewer={MEL} colorMode="light" />);
    expect(view.container.querySelector('#mine')!.textContent).toContain('Mel');
    expect(view.container.querySelector('#mine')!.textContent).toContain('M');
  });

  /*
   * THE FACE AND THE HANDLE, SEPARATELY. The same three reference shapes, the
   * same one card — a page that wants only a picture, or only a clickable
   * handle, must not have to take the other, and neither may resolve an id the
   * server did not already put in front of this viewer.
   */
  it('draws a face and a handle from the same card, and asks nobody about an id it was not given', () => {
    const ADA = { name: 'Ada', handle: 'ada', image: '/api/users/usr_ada/avatar?v=abc' };
    const source = '<Helmet><Value name="payer" type="user" default="usr_ada" /></Helmet>'
      + '<p id="face"><UserImage userId="$payer" size="lg" /></p>'
      + '<p id="handle"><UserHandle userId="$payer" /></p>'
      + '<p id="mine"><UserHandle userId="$_me" /></p>'
      + '<p id="stranger"><UserImage userId="usr_nobody" /><UserHandle userId="usr_nobody" /></p>'
      + '<p id="plain"><User userId="$payer" avatar={false} /></p>';
    const { content, body } = splitHelmet(parseJsxOrThrow(source).nodes as JsxNode[]);
    const flow = { values: content.values, queries: [] };
    const state: DataflowState = { values: { payer: 'usr_ada' }, errors: {}, tables: initialTables(flow), people: { usr_ada: ADA } };
    const view = render(<StoryRuntimeApp nodes={body} refData={{}} dataflow={{ flow, state }} viewer={MEL} colorMode="light" />);
    expect(view.container.querySelector('#face img')!.getAttribute('src')).toBe(ADA.image);
    const link = view.container.querySelector('#handle a')!;
    expect(link.textContent).toBe('@ada');
    expect(link.getAttribute('href')).toBe('/@ada');
    expect(link.getAttribute('target')).toBe('_top');
    // The viewer's own card comes off the island, before any query answers.
    expect(view.container.querySelector('#mine')!.textContent).toBe('Mel');
    // An id nobody put in front of this viewer: neutral in BOTH halves.
    expect(view.container.querySelector('#stranger')!.textContent).toBe('?Unknown person');
    expect(view.container.textContent).not.toContain('usr_nobody');
    // `avatar={false}` is how a page asks for the handle alone.
    expect(view.container.querySelector('#plain [data-slot="avatar"]')).toBeNull();
    expect(view.container.querySelector('#plain')!.textContent).toBe('@ada');
  });
});

it('replaces a guest identity action with the login door instead of a disabled action',()=>{
 const {content,body}=splitHelmet(parseJsxOrThrow('<Helmet><Mutation name="add" source="ref:abc123">{`insert into public.rows values ($_me)`}</Mutation></Helmet><Button id="add1" run="$add">Add expense</Button>').nodes);
 const flow={values:content.values,queries:content.queries,mutations:content.mutations};
 const state={values:{},tables:{},errors:{},mutationAccess:{add:'sign_in_required'}};
 const mutate=vi.fn();
 const store=createDataflowStore({flow,state},{transport:{run:vi.fn(),page:vi.fn(),mutate}});
 const view=render(<StoryRuntimeApp nodes={body} refData={{}} dataflow={{flow,state}} store={store} colorMode="light" chrome />);
 expect(view.queryByRole('button',{name:'Add expense'})).toBeNull();
 const login=view.getByRole('link',{name:'Sign in to do this'});
 expect(login.getAttribute('href')).toMatch(/^\/login(?:\?callbackUrl=|$)/);
 expect(login.id).toBe('add1');
 expect(mutate).not.toHaveBeenCalled();
 store.dispose();
});
